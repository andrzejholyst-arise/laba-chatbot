import "server-only";
import { userDb } from "./user-db";
import { verifiedUser } from "./auth";

import { cleanProfile, profileKeys, profileKeyAliases, normalizeContactTime, type UserProfile } from "./profile-rules";
import { profileEditSchema, type ProfileEdit } from "./profile-edit";

export class ProfileError extends Error {
  constructor(message: string, readonly status = 503, readonly code = "PROFILE_ERROR") { super(message); }
}

function databaseFailure(error: { code?: string; message?: string }, status: number, action: string) {
  const code = typeof error.code === "string" && /^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(error.code)
    ? error.code : status === 0 ? "PROFILE_CONNECTION" : status === 401 ? "PROFILE_AUTH" : "PROFILE_DATABASE";
  let help = "Sprawdź wykonanie skryptu supabase/user-profile.sql w projekcie aplikacji.";
  if (code === "PGRST202" || code === "42883") help = "Brakuje funkcji save_studio_profile w API bazy. Wykonaj cały skrypt supabase/user-profile.sql w projekcie wskazanym przez SUPABASE_URL.";
  else if (code === "PGRST203") help = "Baza ma kilka niejednoznacznych wersji save_studio_profile. Potrzebne jest ujednolicenie funkcji SQL.";
  else if (code === "42702") help = "W funkcji SQL nazwa kolumny koliduje z nazwą parametru. Funkcja save_studio_profile wymaga poprawki.";
  else if (code === "21000") help = "Zapis narusza ograniczenie liczby wierszy lub zabezpieczenie aktualizacji bez WHERE. Wykonaj poprawkę supabase/fix-profile-update.sql, która aktualizuje profil po jego id.";
  else if (code === "42501") help = "Brak uprawnień do profilu, funkcji lub sekwencji. Sprawdź polityki RLS i uprawnienia roli authenticated dla user_profiles.";
  else if (code === "23502") {
    const column = typeof error.message === "string" ? /null value in column "([A-Za-z_][A-Za-z0-9_]{0,62})"/.exec(error.message)?.[1] : undefined;
    help = `Tabela wymaga wartości${column ? ` w kolumnie ${column}` : " w dodatkowej kolumnie"}. Sprawdź wymagane kolumny istniejącej tabeli user_profiles.`;
  }
  else if (["22P02", "42804"].includes(code)) help = "Typ kolumny profilu nie pasuje do danych. name powinno mieć typ text, a preferences typ jsonb.";
  else if (["PGRST116", "23505"].includes(code)) help = "Sprawdź, czy user_profiles zawiera jeden profil i ma unikalny user_id.";
  else if (["PROFILE_AUTH", "PGRST301", "PGRST302", "PGRST303"].includes(code)) help = "Supabase odrzucił klucz. Sprawdź zgodność NEXT_PUBLIC_SUPABASE_URL i klucza publishable oraz uruchom ponownie serwer.";
  else if (code === "PROFILE_CONNECTION") help = "Nie udało się połączyć z Supabase lub upłynął limit czasu. Sprawdź sieć i aktywność projektu.";
  return new ProfileError(`${action} [${code}]. ${help}`, 503, code);
}

// Profil należy do osoby z sesji. Jeden wiersz na użytkownika pilnuje unikalny user_id,
// a właściciela wierszy RLS; user_id wypełnia baza, nigdy przeglądarka ani model.
async function requireSession(request: Request) {
  if (!(await verifiedUser(request))) throw new ProfileError("Sesja wygasła. Zaloguj się ponownie.", 401);
  return userDb(request);
}

type ProfileDb = Awaited<ReturnType<typeof userDb>>;

// Po zalogowaniu przez Google: jeśli profil nie ma jeszcze imienia, zapisujemy imię z konta,
// żeby agent witał po imieniu już w pierwszej rozmowie. Istniejącego imienia nie nadpisujemy.
// Klient jest już zalogowany tą osobą (RLS), więc dotyczy to wyłącznie jej profilu.
// Błąd nigdy nie przerywa logowania.
export async function rememberAccountName(db: ProfileDb, name: string | null) {
  try {
    if (!name || cleanProfile({ name }).name !== name) return;
    const { data: row, error } = await db.from("user_profiles").select("id::text,name").maybeSingle();
    if (error) return;
    if (!row) await db.from("user_profiles").insert({ name, preferences: {} });
    else if (!row.name) await db.from("user_profiles").update({ name }).eq("id", row.id).is("name", null);
  } catch { /* Imię z konta jest tylko ułatwieniem. */ }
}

export async function loadUserProfile(request: Request): Promise<UserProfile> {
  const db = await requireSession(request);
  const { data, error, status } = await db.from("user_profiles").select("name,preferences").maybeSingle();
  if (error) throw databaseFailure(error, status, "Nie udało się wczytać profilu właściciela");
  return cleanProfile(data);
}

export async function saveUserProfile(request: Request, patch: UserProfile, signal?: AbortSignal) {
  const db = await requireSession(request);
  const safe = cleanProfile(patch);
  if ((patch.name && safe.name !== patch.name) || Object.entries(patch.preferences).some(([key, value]) => !profileKeys.includes(key as typeof profileKeys[number]) || safe.preferences[key] !== value)) {
    throw new ProfileError("Nie zapisano profilu: niedozwolone lub wrażliwe dane.", 400);
  }
  // Funkcja SQL z kluczem secret nie jest dostępna dla zalogowanych. Łączymy dane
  // jak dawniej: imię tylko gdy podano, preferencje dopisywane do istniejących.
  // Przy równoległym pierwszym zapisie unikalny user_id zwraca 23505; ponawiamy odczyt.
  for (let attempt = 0; attempt < 2; attempt++) {
    let read = db.from("user_profiles").select("id::text,name,preferences");
    if (signal) read = read.abortSignal(signal);
    const { data: row, error, status } = await read.maybeSingle();
    if (error) throw databaseFailure(error, status, "Nie udało się zapisać profilu");
    let write = row
      ? db.from("user_profiles").update({ name: patch.name ?? row.name, preferences: { ...(row.preferences ?? {}), ...patch.preferences } }).eq("id", row.id).select("name,preferences")
      : db.from("user_profiles").insert({ name: patch.name, preferences: patch.preferences }).select("name,preferences");
    if (signal) write = write.abortSignal(signal);
    const result = await write.maybeSingle();
    if (result.error?.code === "23505" && !row) continue;
    if (result.error) throw databaseFailure(result.error, result.status, "Nie udało się zapisać profilu");
    if (!result.data) throw new ProfileError("Nie potwierdzono zapisu profilu [PROFILE_RESULT]. Baza nie zwróciła zapisanego wiersza.");
    const saved = cleanProfile(result.data);
    if ((patch.name && saved.name !== patch.name) || Object.entries(patch.preferences).some(([key, value]) => saved.preferences[key] !== value)) {
      throw new ProfileError("Nie potwierdzono zapisu profilu [PROFILE_RESULT]. Baza zwróciła inne wartości niż przekazane do zapisu.");
    }
    return saved;
  }
  // Po ponowieniu nadal nie widzimy własnego wiersza, a baza odrzuca wstawienie: to nie wyścig,
  // tylko ograniczenie w bazie (stary indeks user_profiles_single_owner dopuszcza jeden wiersz na całą tabelę).
  throw new ProfileError("Nie zapisano profilu [23505]. Baza dopuszcza tylko jeden profil w całej tabeli. W SQL Editor wykonaj: drop index public.user_profiles_single_owner; — potem profil każdej osoby zapisze się osobno.", 503, "23505");
}

// Edytor operuje na istniejącym wierszu. Porównanie poprzedniej wartości chroni
// równoległy zapis z czatu przed nadpisaniem przez starszy odczyt edytora.
export async function editUserProfile(request: Request, input: ProfileEdit): Promise<UserProfile> {
  const db = await requireSession(request);
  const parsed = profileEditSchema.safeParse(input);
  if (!parsed.success) throw new ProfileError("Nieprawidłowa zmiana profilu.", 400);
  const edit = parsed.data;
  if (edit.action === "set-preference" && edit.key === "preferowany_czas_kontaktu") {
    const time = normalizeContactTime(edit.value);
    if (!time) throw new ProfileError("Wybierz czas kontaktu: do południa, po południu lub wieczorem.", 400);
    edit.value = time;
  }
  if (edit.action === "set-name" && edit.value !== null && cleanProfile({ name: edit.value }).name !== edit.value) {
    throw new ProfileError("Podaj poprawne imię, bez danych wrażliwych i poleceń.", 400);
  }
  if (edit.action === "set-preference" && cleanProfile({ preferences: { [edit.key]: edit.value } }).preferences[edit.key] !== edit.value) {
    throw new ProfileError("Preferencja zawiera niedozwolone dane lub nieprawidłową nazwę.", 400);
  }
  const { data: row, error, status } = await db.from("user_profiles").select("id::text,name,preferences").maybeSingle();
  if (error) throw databaseFailure(error, status, "Nie udało się wczytać profilu do edycji");
  if (!row) {
    if (edit.action === "set-name" && edit.value) return saveUserProfile(request, { name: edit.value, preferences: {} });
    if (edit.action === "set-preference") {
      if (["ulubiony_kolor", "preferowany_czas_kontaktu"].includes(edit.key)) return saveUserProfile(request, { name: null, preferences: { [edit.key]: edit.value } });
      throw new ProfileError("Ta preferencja już nie istnieje. Odśwież profil.", 409);
    }
    return { name: null, preferences: {} };
  }
  const preferences = { ...(row.preferences ?? {}) } as Record<string, unknown>;
  let name = row.name;
  if (edit.action === "set-name") name = edit.value;
  if (edit.action === "set-preference" || edit.action === "remove-preference") {
    if (!Object.hasOwn(cleanProfile(row).preferences, edit.key) && !(edit.action === "set-preference" && ["ulubiony_kolor", "preferowany_czas_kontaktu"].includes(edit.key))) throw new ProfileError("Ta preferencja już nie istnieje. Odśwież profil.", 409);
    // Usunięcie obejmuje również dawną nazwę klucza, np. response_detail.
    for (const key of Object.keys(preferences)) if ((profileKeyAliases[key] ?? key) === edit.key) delete preferences[key];
    if (edit.action === "set-preference") preferences[edit.key] = edit.value;
  }
  if (edit.action === "clear") { name = null; for (const key of Object.keys(preferences)) delete preferences[key]; }
  let query = db.from("user_profiles").update({ name, preferences }).eq("id", row.id);
  query = row.name === null ? query.is("name", null) : query.eq("name", row.name);
  query = row.preferences === null ? query.is("preferences", null) : query.eq("preferences", JSON.stringify(row.preferences));
  const result = await query.select("name,preferences").maybeSingle();
  if (result.error) throw databaseFailure(result.error, result.status, "Nie udało się zmienić profilu");
  if (!result.data) throw new ProfileError("Profil zmienił się w międzyczasie. Odśwież go i ponów zmianę.", 409, "PROFILE_CONFLICT");
  return cleanProfile(result.data);
}

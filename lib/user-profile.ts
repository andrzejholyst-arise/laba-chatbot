import "server-only";
import { getSupabase } from "./supabase";
import { sessionFromRequest, validSession } from "./session";
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
  else if (code === "42501") help = "Brak uprawnień do profilu, funkcji lub sekwencji. Sprawdź uprawnienia service_role ze skryptu user-profile.sql i serwerowy SUPABASE_SECRET_KEY.";
  else if (code === "23502") {
    const column = typeof error.message === "string" ? /null value in column "([A-Za-z_][A-Za-z0-9_]{0,62})"/.exec(error.message)?.[1] : undefined;
    help = `Tabela wymaga wartości${column ? ` w kolumnie ${column}` : " w dodatkowej kolumnie"}. Sprawdź wymagane kolumny istniejącej tabeli user_profiles.`;
  }
  else if (["22P02", "42804"].includes(code)) help = "Typ kolumny profilu nie pasuje do danych. name powinno mieć typ text, a preferences typ jsonb.";
  else if (["PGRST116", "23505"].includes(code)) help = "Sprawdź, czy user_profiles zawiera jeden profil i ma indeks user_profiles_single_owner.";
  else if (["PROFILE_AUTH", "PGRST301", "PGRST302", "PGRST303"].includes(code)) help = "Supabase odrzucił klucz. Sprawdź zgodność SUPABASE_URL i SUPABASE_SECRET_KEY oraz uruchom ponownie serwer.";
  else if (code === "PROFILE_CONNECTION") help = "Nie udało się połączyć z Supabase lub upłynął limit czasu. Sprawdź sieć i aktywność projektu.";
  return new ProfileError(`${action} [${code}]. ${help}`, 503, code);
}

function requireSession(request: Request) {
  if (!validSession(sessionFromRequest(request))) throw new ProfileError("Sesja wygasła. Zaloguj się ponownie.", 401);
}

export async function loadUserProfile(request: Request): Promise<UserProfile> {
  requireSession(request);
  const { data, error, status } = await getSupabase().from("user_profiles").select("name,preferences").maybeSingle();
  if (error) throw databaseFailure(error, status, "Nie udało się wczytać profilu właściciela");
  return cleanProfile(data);
}

export async function saveUserProfile(request: Request, patch: UserProfile, signal?: AbortSignal) {
  requireSession(request);
  const safe = cleanProfile(patch);
  if ((patch.name && safe.name !== patch.name) || Object.entries(patch.preferences).some(([key, value]) => !profileKeys.includes(key as typeof profileKeys[number]) || safe.preferences[key] !== value)) {
    throw new ProfileError("Nie zapisano profilu: niedozwolone lub wrażliwe dane.", 400);
  }
  let query = getSupabase().rpc("save_studio_profile", { p_name: patch.name, p_preferences: patch.preferences });
  if (signal) query = query.abortSignal(signal);
  const { data, error, status } = await query;
  if (error) throw databaseFailure(error, status, "Nie udało się zapisać profilu");
  if (!Array.isArray(data) || data.length !== 1) throw new ProfileError("Nie potwierdzono zapisu profilu [PROFILE_RESULT]. Funkcja powinna zwrócić dokładnie jeden wiersz z name i preferences.");
  const saved = cleanProfile(data[0]);
  if ((patch.name && saved.name !== patch.name) || Object.entries(patch.preferences).some(([key, value]) => saved.preferences[key] !== value)) {
    throw new ProfileError("Nie potwierdzono zapisu profilu [PROFILE_RESULT]. Baza zwróciła inne wartości niż przekazane do zapisu.");
  }
  return saved;
}

// Edytor operuje na istniejącym wierszu. Porównanie poprzedniej wartości chroni
// równoległy zapis z czatu przed nadpisaniem przez starszy odczyt edytora.
export async function editUserProfile(request: Request, input: ProfileEdit): Promise<UserProfile> {
  requireSession(request);
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
  const db = getSupabase();
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

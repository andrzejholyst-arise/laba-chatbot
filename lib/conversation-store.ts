import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { UIMessage } from "ai";
import { getSupabase } from "./supabase";
import { sessionFromRequest, validSession } from "./session";
import type { ConversationHistory } from "./conversation-history";

export class ConversationError extends Error {
  constructor(message: string, readonly status = 503, readonly code = "CONVERSATION_ERROR") { super(message); }
}

// Tylko własne komunikaty i dozwolone kody. Nigdy surowe message/details/hint
// z API: mogą zawierać adres projektu, dane wiadomości albo fragment zapytania.
function databaseError(error: { code?: string; message?: string }, status: number, action: string) {
  // SQLSTATE ma dokładnie 5 znaków, a kody PostgREST format PGRST123.
  // Przekazujemy sam kod, bez treści błędu, danych wiersza i wartości zapytania.
  const code = typeof error.code === "string" && /^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(error.code)
    ? error.code : status === 0 ? "DB_CONNECTION" : status === 401 ? "DB_AUTH" : status === 403 ? "DB_PERMISSION" : "DB_QUERY_FAILED";
  let help = "Sprawdź konfigurację Supabase i wykonanie skryptu SQL w tym samym projekcie.";
  if (["42P01", "PGRST205"].includes(code)) help = "Brakuje tabeli conversations lub messages w API. Wykonaj przygotowany skrypt SQL w projekcie wskazanym przez SUPABASE_URL.";
  else if (["42703", "PGRST204"].includes(code)) help = "Brakuje wymaganej kolumny albo API nie odświeżyło schematu. Sprawdź client_id, session_key, created_at i position oraz wykonanie przygotowanego skryptu SQL.";
  else if (["42501", "DB_PERMISSION"].includes(code)) help = "Brak uprawnień do tabel. Sprawdź uprawnienia service_role ze skryptu SQL oraz użycie serwerowego SUPABASE_SECRET_KEY.";
  else if (["PGRST301", "PGRST302", "PGRST303", "DB_AUTH"].includes(code)) help = "Supabase odrzucił klucz. Sprawdź, czy SUPABASE_URL i serwerowy SUPABASE_SECRET_KEY pochodzą z tego samego projektu, i uruchom ponownie serwer.";
  else if (code === "DB_CONNECTION") help = "Brak połączenia z Supabase lub przekroczony czas oczekiwania. Sprawdź SUPABASE_URL, sieć i czy projekt Supabase jest aktywny.";
  else if (code === "23502") {
    const column = typeof error.message === "string" ? /null value in column "([A-Za-z_][A-Za-z0-9_]{0,62})"/.exec(error.message)?.[1] : undefined;
    help = `Tabela wymaga wartości${column ? ` w kolumnie ${column}` : " w dodatkowej kolumnie"}. Sprawdź kolumny NOT NULL i ich wartości domyślne. Skrypt CREATE TABLE IF NOT EXISTS nie zmienia wcześniej istniejących kolumn.`;
  }
  else if (["22P02", "42804"].includes(code)) help = "Typ kolumny nie pasuje do zapisywanych danych. Kolumny id i conversation_id powinny mieć typ bigint, a client_id typ UUID.";
  else if (code === "23503") help = "Zapis narusza klucz obcy. Sprawdź powiązania tabel conversations i messages, również dodatkowe kolumny istniejące wcześniej.";
  else if (["23505", "42P10"].includes(code)) help = "Konflikt ograniczeń unikalności. Sprawdź klucze główne i dodatkowe ograniczenia UNIQUE w tabelach conversations i messages.";
  else if (code === "23514") help = "Zapis narusza ograniczenie CHECK w istniejącej tabeli. Sprawdź ograniczenia conversations i messages.";
  return new ConversationError(`${action} [${code}]. ${help}`, 503, code);
}

function sessionKey(request: Request) {
  const token = sessionFromRequest(request);
  if (!validSession(token)) throw new ConversationError("Sesja wygasła. Zaloguj się ponownie.", 401);
  return createHash("sha256").update(token!).digest("hex");
}

// Stałe UUID dla obu wiadomości danej tury, również przy ponowieniu żądania.
function messageId(conversationId: string, userId: string, role: string) {
  const bytes = createHash("sha256").update(JSON.stringify([conversationId, userId, role])).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function messageText(message: UIMessage) {
  return message.parts.flatMap(part => {
    if (part.type === "text") return [part.text];
    if (part.type === "file" && part.mediaType.startsWith("image/")) return ["[obraz]"];
    if (part.type === "tool-generujObraz" && "output" in part &&
      part.output && typeof part.output === "object" && "ok" in part.output && part.output.ok === true) return ["[obraz]"];
    return [];
  }).join("\n");
}

type StoredMessage = { client_id: string; role: "user" | "assistant"; content: string };
function uiMessage(row: StoredMessage): UIMessage {
  return { id: row.client_id, role: row.role, parts: [{ type: "text", text: row.content }] };
}

async function readMessages(conversationId: string) {
  const db = getSupabase();
  const rows: StoredMessage[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error, status } = await db.from("messages").select("client_id,role,content")
      .eq("conversation_id", conversationId).order("position", { ascending: true }).range(offset, offset + 499);
    if (error) throw databaseError(error, status, "Nie udało się wczytać wiadomości");
    rows.push(...(data as StoredMessage[]));
    if (data.length < 500) return rows.map(uiMessage);
  }
}

export async function loadLatestConversation(request: Request) {
  const key = sessionKey(request);
  // Rzutowanie w bazie zapobiega zaokrąglaniu bigint przez JSON/JavaScript.
  const { data, error, status } = await getSupabase().from("conversations").select("id::text,client_id")
    .eq("session_key", key).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle();
  if (error) throw databaseError(error, status, "Nie udało się wczytać ostatniej rozmowy");
  return { conversationId: data?.client_id ?? null, messages: data ? await readMessages(data.id) : [] };
}

export async function loadConversation(request: Request, conversationId: string) {
  const key = sessionKey(request);
  const { data, error, status } = await getSupabase().from("conversations").select("id::text,client_id")
    .eq("client_id", conversationId).eq("session_key", key).maybeSingle();
  if (error) throw databaseError(error, status, "Nie udało się wczytać wybranej rozmowy");
  if (!data) throw new ConversationError("Rozmowa nie jest dostępna w tej sesji.", 404);
  return { conversationId: data.client_id, messages: await readMessages(data.id) };
}

export async function listConversations(request: Request, offset = 0): Promise<ConversationHistory> {
  const key = sessionKey(request);
  const db = getSupabase();
  const pageSize = 50;
  const { data, error, status } = await db.from("conversations").select("id::text,client_id,title,created_at")
    .eq("session_key", key).order("created_at", { ascending: false }).order("id", { ascending: false })
    .range(offset, offset + pageSize - 1);
  if (error) throw databaseError(error, status, "Nie udało się wczytać listy rozmów");
  const counts = new Map<string, number>();
  // Liczymy tylko identyfikatory wiadomości własnych rozmów, bez pobierania
  // treści i bez zależności od automatycznego wykrywania relacji w API.
  if (data.length) {
    const ids = data.map(row => row.id);
    for (let start = 0; ; start += 500) {
      const result = await db.from("messages").select("conversation_id::text").in("conversation_id", ids)
        .order("position", { ascending: true }).range(start, start + 499);
      if (result.error) throw databaseError(result.error, result.status, "Nie udało się policzyć wiadomości");
      for (const row of result.data) counts.set(row.conversation_id, (counts.get(row.conversation_id) ?? 0) + 1);
      if (result.data.length < 500) break;
    }
  }
  return {
    conversations: data.map(row => ({
      conversationId: row.client_id, title: row.title || "Rozmowa bez tytułu",
      createdAt: row.created_at, messageCount: counts.get(row.id) ?? 0,
    })),
    nextOffset: data.length === pageSize ? offset + pageSize : null,
  };
}

export type ConversationTurn = {
  conversationId: string; user: UIMessage; assistantId: string; messages: UIMessage[]; replay?: UIMessage; isFirstResponse: boolean; initialTitle: string | null;
};

export async function prepareConversation(request: Request, messages: UIMessage[], id?: string): Promise<ConversationTurn> {
  const key = sessionKey(request);
  const conversationId = id ?? randomUUID();
  const user = messages.at(-1)!;
  if (!user.id || user.id.length > 200) throw new ConversationError("Nieprawidłowy identyfikator wiadomości.", 400);
  const db = getSupabase();
  const { error: insertError, status: insertStatus } = await db.from("conversations").upsert({
    client_id: conversationId, created_at: new Date().toISOString(), session_key: key,
    title: "Nowa rozmowa Studio Nova",
  }, { onConflict: "client_id", ignoreDuplicates: true });
  if (insertError) throw databaseError(insertError, insertStatus, "Nie udało się otworzyć rozmowy");
  const { data: owned, error, status } = await db.from("conversations").select("id::text,title").eq("client_id", conversationId).eq("session_key", key).maybeSingle();
  if (error) throw databaseError(error, status, "Nie udało się sprawdzić dostępu do rozmowy");
  if (!owned) throw new ConversationError("Rozmowa nie jest dostępna w tej sesji.", 404);
  const history = await readMessages(owned.id);
  const assistantId = messageId(conversationId, user.id, "assistant");
  return { conversationId, user, assistantId, messages: [...history, user], replay: history.find(message => message.id === assistantId), isFirstResponse: history.length === 0, initialTitle: typeof owned.title === "string" ? owned.title : null };
}

export async function saveConversationTitle(request: Request, turn: ConversationTurn, title: string) {
  const key = sessionKey(request);
  const db = getSupabase();
  let query = db.from("conversations").update({ title }).eq("client_id", turn.conversationId).eq("session_key", key);
  query = turn.initialTitle === null ? query.is("title", null) : query.eq("title", turn.initialTitle);
  const { data, error, status } = await query.select("client_id").maybeSingle();
  if (error) throw databaseError(error, status, "Nie udało się zapisać tytułu rozmowy");
  if (!data) {
    const current = await db.from("conversations").select("id::text,title").eq("client_id", turn.conversationId).eq("session_key", key).maybeSingle();
    if (current.error) throw databaseError(current.error, current.status, "Nie udało się sprawdzić tytułu rozmowy");
    if (current.data?.title && current.data.title !== turn.initialTitle) return;
    throw new ConversationError("[TITLE_SAVE] Rozmowa została usunięta lub jej tytuł nie jest już dostępny.", 409);
  }
}

export async function deleteConversation(request: Request, conversationId: string) {
  const key = sessionKey(request);
  const { data, error, status } = await getSupabase().rpc("delete_studio_conversation", {
    p_client_id: conversationId, p_session_key: key,
  });
  if (error) throw databaseError(error, status, "Nie udało się usunąć rozmowy");
  if (data !== true) throw new ConversationError("Rozmowa nie jest dostępna w tej sesji.", 404);
}

export async function saveConversationTurn(request: Request, turn: ConversationTurn, assistant: UIMessage) {
  const key = sessionKey(request);
  const db = getSupabase();
  const { data, error, status } = await db.from("conversations").select("id::text").eq("client_id", turn.conversationId).eq("session_key", key).maybeSingle();
  if (error) throw databaseError(error, status, "Nie udało się potwierdzić dostępu do zapisu");
  if (!data) throw new ConversationError("Nie udało się potwierdzić dostępu do zapisu rozmowy.");
  const createdAt = new Date().toISOString();
  // Jedna operacja INSERT dla całej pary: atomowo, użytkownik przed agentem.
  // Konflikt client_id pomija istniejące rekordy, bez nadpisywania odpowiedzi.
  // Baza sama nadaje bigint id; klucz obcy to odczytane id rozmowy, nie UUID.
  const { error: saveError, status: saveStatus } = await db.from("messages").upsert([
    { client_id: messageId(turn.conversationId, turn.user.id, "user"), conversation_id: data.id,
      created_at: createdAt, role: "user", content: messageText(turn.user) },
    { client_id: turn.assistantId, conversation_id: data.id,
      created_at: createdAt, role: "assistant", content: messageText(assistant) },
  ], { onConflict: "client_id", ignoreDuplicates: true, defaultToNull: false });
  if (saveError) throw databaseError(saveError, saveStatus, "Nie udało się zapisać rozmowy; odpowiedź może zniknąć po odświeżeniu");
}

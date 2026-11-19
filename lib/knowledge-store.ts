import "server-only";
import { getSupabase } from "./supabase";
import { sessionFromRequest, validSession } from "./session";
import { knowledgeImportSchema, splitDocument, type KnowledgeSummary, type KnowledgeVersion, type ImportStage } from "./knowledge-document";
import { embedMany } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { embeddingModelId, EMBEDDING_DIMENSIONS } from "./model";

export class KnowledgeError extends Error {
  constructor(message: string, readonly status = 503) { super(message); }
}

function requireSession(request: Request) {
  if (!validSession(sessionFromRequest(request))) throw new KnowledgeError("Sesja wygasła. Zaloguj się ponownie.", 401);
}

function databaseError(code?: string): never {
  if (["PGRST202", "42883"].includes(code ?? "")) throw new KnowledgeError("Baza wymaga aktualizacji. Wykonaj skrypt supabase/manage-knowledge.sql, a potem odśwież listę dokumentów.");
  if (code === "40001" || code === "P0001") throw new KnowledgeError("Dokumenty zmieniły się lub zastąpienie wymaga potwierdzenia. Odśwież listę i ponów operację.", 409);
  throw new KnowledgeError("Nie udało się potwierdzić operacji w bazie. Odśwież listę dokumentów przed ponowną próbą.");
}

export async function listKnowledgeDocuments(request: Request): Promise<KnowledgeSummary[]> {
  requireSession(request);
  const items: KnowledgeSummary[] = [];
  const db = getSupabase();
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db.rpc("list_knowledge_documents").range(offset, offset + 499);
    if (error) databaseError(error.code);
    if (!Array.isArray(data)) throw new KnowledgeError("Baza nie zwróciła listy dokumentów. Spróbuj odświeżyć stronę.");
    for (const row of data) {
      if (typeof row.document_id !== "string" || typeof row.title !== "string" || !Number.isFinite(Date.parse(row.created_at)) || !Number.isSafeInteger(Number(row.chunk_count))) throw new KnowledgeError("Lista dokumentów ma nieprawidłowy format. Sprawdź aktualizację bazy.");
      items.push({ id: row.document_id, title: row.title, createdAt: row.created_at, chunkCount: Number(row.chunk_count) });
    }
    if (data.length < 500) return items;
  }
}

export async function deleteKnowledgeDocument(request: Request, version: KnowledgeVersion) {
  requireSession(request);
  const { data, error } = await getSupabase().rpc("delete_knowledge_document", { p_id: version.id, p_created_at: version.createdAt });
  if (error) databaseError(error.code);
  if (data !== true) throw new KnowledgeError("Dokument już nie istnieje lub jego wersja się zmieniła. Odśwież listę.", 409);
}

export async function addKnowledgeDocument(request: Request, input: unknown, progress?: (stage: ImportStage) => void) {
  requireSession(request);
  const parsed = knowledgeImportSchema.safeParse(input);
  if (!parsed.success) throw new KnowledgeError(parsed.error.issues[0]?.message ?? "Nieprawidłowy dokument.", 400);
  progress?.("splitting");
  const chunks = splitDocument(parsed.data.content, parsed.data.chunkingMode);
  const versions = (await listKnowledgeDocuments(request)).filter(doc => doc.title.trim().toLowerCase() === parsed.data.title.toLowerCase());
  if (versions.length !== parsed.data.expectedVersions.length || versions.some(doc => !parsed.data.expectedVersions.some(version => version.id === doc.id && Date.parse(version.createdAt) === Date.parse(doc.createdAt)))) {
    throw new KnowledgeError("Dokument o tym tytule już istnieje lub jego wersja się zmieniła. Odśwież listę i potwierdź zastąpienie.", 409);
  }
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  let model: string;
  try { model = embeddingModelId(); } catch { throw new KnowledgeError("Brak konfiguracji modelu embeddingów na serwerze. Ustaw OPENROUTER_EMBEDDING_MODEL."); }
  if (!apiKey) throw new KnowledgeError("Brak konfiguracji połączenia z modelem embeddingów na serwerze.");
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]);
  const db = getSupabase();
  const pending: { id: string; content: string }[] = [];
  // Pobieramy wszystkie braki, również gdy jest ich więcej niż limit strony API.
  for (let offset = 0; ; offset += 500) {
    const result = await db.from("chunks").select("id::text,document_id::text,content").is("embedding", null).order("id").range(offset, offset + 499).abortSignal(signal);
    if (result.error) throw new KnowledgeError("Nie udało się wczytać fragmentów bez embeddingów. Dokument nie został dodany.");
    const rows = result.data as { id: string; document_id: string; content: string }[];
    if (!Array.isArray(rows) || rows.some(row => typeof row.id !== "string" || typeof row.content !== "string" || !row.content.trim())) {
      throw new KnowledgeError("W bazie są fragmenty bez poprawnej treści. Popraw je przed importem; dokument nie został dodany.");
    }
    pending.push(...rows.filter(row => !versions.some(version => version.id === row.document_id)).map(({ id, content }) => ({ id, content })));
    if (rows.length < 500) break;
  }
  let embeddings: number[][];
  progress?.("embedding");
  try {
    signal.throwIfAborted();
    let requests = 0;
    const provider = createOpenRouter({ apiKey, fetch: (url, init) => {
      if (++requests > 1) throw new Error("Import dopuszcza jedno wywołanie embeddingów.");
      return fetch(url, init);
    } });
    const result = await embedMany({
      model: provider.textEmbeddingModel(model), values: [...chunks, ...pending.map(row => row.content)],
      maxParallelCalls: 1, maxRetries: 0,
      abortSignal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]),
    });
    embeddings = result.embeddings;
    if (embeddings.length !== chunks.length + pending.length || embeddings.some(vector =>
      !Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS || !vector.every(Number.isFinite) || !vector.some(value => value !== 0))) {
      throw new Error("Niekompletne lub nieprawidłowe wektory.");
    }
  } catch {
    throw new KnowledgeError("Nie udało się utworzyć kompletnych embeddingów. Dokument nie został dodany, a wcześniejsze dane pozostają bez zmian. Spróbuj ponownie później.");
  }
  // Dokument powstaje dopiero po utworzeniu wszystkich wektorów. Jedna transakcja
  // zapisuje nowe fragmenty i uzupełnia stare; błąd wycofuje wszystkie te zmiany.
  progress?.("saving");
  const { data, error } = await db.rpc("replace_knowledge_document", {
    p_title: parsed.data.title,
    p_chunks: chunks.map((content, index) => ({ content, embedding: embeddings[index] })),
    p_backfill: pending.map((row, index) => ({ ...row, embedding: embeddings[chunks.length + index] })),
    p_expected: parsed.data.expectedVersions,
  }).abortSignal(signal);
  if (error) {
    if (["PGRST202", "42883", "40001", "P0001"].includes(error.code)) databaseError(error.code);
    const code = /^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(error.code ?? "") ? ` [${error.code}]` : "";
    throw new KnowledgeError(`Nie udało się potwierdzić zapisu dokumentu${code}. Zapis dokumentu i fragmentów odbywa się w jednej transakcji. Spróbuj ponownie później.`);
  }
  if (!Array.isArray(data) || data.length !== 1 || typeof data[0].document_id !== "string" || !data[0].document_id || data[0].title !== parsed.data.title || data[0].chunk_count !== chunks.length
    || data[0].missing_count !== 0 || !Number.isInteger(data[0].backfilled_count) || data[0].backfilled_count < 0 || data[0].backfilled_count > pending.length) {
    throw new KnowledgeError("Baza nie potwierdziła poprawnego wyniku zapisu. Sprawdź dokument w Supabase przed ponownym dodaniem.");
  }
  return { documentId: data[0].document_id as string, title: parsed.data.title, chunkCount: chunks.length, backfilledCount: data[0].backfilled_count as number };
}

import { verifiedUser } from "../../../lib/auth";
import { sameOrigin } from "../../../lib/request-origin";
import { knowledgeImportSchema, knowledgeVersionSchema, type ImportStage } from "../../../lib/knowledge-document";
import { addKnowledgeDocument, listKnowledgeDocuments, deleteKnowledgeDocument, KnowledgeError } from "../../../lib/knowledge-store";

const headers = { "Cache-Control": "no-store" };
export const maxDuration = 65;
async function denied(request: Request, mutation = false) {
  if (!(await verifiedUser(request))) return Response.json({ error: { message: "Sesja wygasła. Zaloguj się ponownie." } }, { status: 401, headers });
  if (mutation && !sameOrigin(request)) return Response.json({ error: { message: "Niedozwolone źródło żądania." } }, { status: 403, headers });
}
function failure(error: unknown, stage?: ImportStage) {
  return { message: error instanceof KnowledgeError ? error.message : "Nie udało się połączyć z bazą wiedzy.", stage,
    action: stage === "embedding" ? "Spróbuj ponownie za chwilę. Zachowaj treść formularza." : "Odśwież listę dokumentów i sprawdź jej stan przed ponowną próbą.",
    status: error instanceof KnowledgeError ? error.status : 503 };
}
export async function GET(request: Request) {
  const rejection = await denied(request); if (rejection) return rejection;
  try { return Response.json({ documents: await listKnowledgeDocuments(request) }, { headers }); }
  catch (error) { const info = failure(error); return Response.json({ error: info }, { status: info.status, headers }); }
}
export async function DELETE(request: Request) {
  const rejection = await denied(request, true); if (rejection) return rejection;
  const parsed = knowledgeVersionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: { message: "Nieprawidłowa wersja dokumentu. Odśwież listę." } }, { status: 400, headers });
  try { await deleteKnowledgeDocument(request, parsed.data); return new Response(null, { status: 204, headers }); }
  catch (error) { const info = failure(error); return Response.json({ error: info }, { status: info.status, headers }); }
}
export async function POST(request: Request) {
  const rejection = await denied(request, true); if (rejection) return rejection;
  const parsed = knowledgeImportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: { message: parsed.error.issues[0]?.message ?? "Nieprawidłowy dokument." } }, { status: 400, headers });
  let stage: ImportStage = "splitting";
  if (!request.headers.get("accept")?.includes("application/x-ndjson")) {
    try { return Response.json(await addKnowledgeDocument(request, parsed.data, value => { stage = value; }), { status: 201, headers }); }
    catch (error) { const info = failure(error, stage); return Response.json({ error: info }, { status: info.status, headers }); }
  }
  let active = true;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => { if (active) controller.enqueue(new TextEncoder().encode(JSON.stringify(event) + "\n")); };
      try {
        const result = await addKnowledgeDocument(request, parsed.data, value => { stage = value; send({ type: "progress", stage }); });
        send({ type: "complete", result });
      } catch (error) { send({ type: "error", error: failure(error, stage) }); }
      finally { if (active) { active = false; controller.close(); } }
    },
    cancel() { active = false; },
  });
  return new Response(stream, { headers: { ...headers, "Content-Type": "application/x-ndjson; charset=utf-8", "X-Accel-Buffering": "no" } });
}

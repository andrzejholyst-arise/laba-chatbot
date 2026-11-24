import { loadLatestConversation, loadConversation, listConversations, deleteConversation, ConversationError } from "../../../lib/conversation-store";
import { verifiedUser } from "../../../lib/auth";
import { sameOrigin } from "../../../lib/request-origin";
import { z } from "zod";

const querySchema = z.strictObject({
  id: z.uuid().optional(),
  list: z.literal("1").optional(),
  offset: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(0).max(1_000_000)).optional(),
}).refine(query => !(query.id && query.list) && (query.offset === undefined || query.list === "1"));

export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!(await verifiedUser(request))) {
    return Response.json({ error: { message: "Sesja wygasła. Zaloguj się ponownie." } }, { status: 401, headers });
  }
  const query = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return Response.json({ error: { message: "Nieprawidłowy adres historii lub identyfikator rozmowy." } }, { status: 400, headers });
  try {
    if (query.data.list) return Response.json(await listConversations(request, query.data.offset), { headers });
    if (query.data.id) return Response.json(await loadConversation(request, query.data.id), { headers });
    return Response.json(await loadLatestConversation(request), { headers });
  } catch (error) {
    return Response.json({ error: {
      code: error instanceof ConversationError ? error.code : "SUPABASE_CONFIG",
      message: error instanceof ConversationError ? error.message : "Nie udało się wczytać rozmowy. Sprawdź konfigurację Supabase i uruchom go ponownie.",
    } },
      { status: error instanceof ConversationError ? error.status : 503, headers });
  }
}

export async function DELETE(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!(await verifiedUser(request))) {
    return Response.json({ error: { message: "Sesja wygasła. Zaloguj się ponownie." } }, { status: 401, headers });
  }
  if (!sameOrigin(request)) return Response.json({ error: { message: "Niedozwolone źródło żądania." } }, { status: 403, headers });
  const query = z.strictObject({ id: z.uuid() }).safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return Response.json({ error: { message: "Nieprawidłowy identyfikator rozmowy." } }, { status: 400, headers });
  try {
    await deleteConversation(request, query.data.id);
    return new Response(null, { status: 204, headers });
  } catch (error) {
    return Response.json({ error: {
      message: error instanceof ConversationError ? error.message : "Nie udało się usunąć rozmowy. Sprawdź konfigurację Supabase na serwerze.",
    } }, { status: error instanceof ConversationError ? error.status : 503, headers });
  }
}

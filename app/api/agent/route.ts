import { z } from "zod";
import { sameOrigin, sessionFromRequest, validSession } from "../../../lib/session";
import { ImageUploadError, readChatBody } from "../../../lib/chat-upload";
import { analysisRequestSchema } from "../../../lib/analysis";
import { analyzeMessage, analysisError } from "../../../lib/analyze-message";
import { chatResponse } from "../../../lib/agent-chat";

export const maxDuration = 60;
const requestSchema = z.discriminatedUnion("mode", [
  analysisRequestSchema.extend({ mode: z.literal("analyze") }),
  z.strictObject({
    mode: z.literal("chat"), messages: z.array(z.unknown()),
    responseFormat: z.enum(["text", "audio"]).optional(),
    id: z.string().optional(),
    trigger: z.enum(["submit-message", "regenerate-message"]).optional(),
    messageId: z.string().optional(),
  }),
]);

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const fail = (code: string, message: string, status: number) => Response.json({ error: { code, message } }, { status, headers });
  // Pierwsza operacja: sesja. Bez niej nie czytamy body ani nie wywołujemy dostawcy.
  if (!validSession(sessionFromRequest(request))) return fail("unauthorized", "Sesja wygasła. Zaloguj się ponownie.", 401);
  if (!sameOrigin(request)) return fail("forbidden", "Niedozwolone źródło żądania.", 403);
  let body;
  try {
    const parsed = requestSchema.safeParse(await readChatBody(request));
    if (!parsed.success) return fail("invalid_request", "Nieprawidłowe dane. Wybierz mode: chat albo analyze i przekaż wiadomość w odpowiednim formacie.", 400);
    body = parsed.data;
  } catch (error) {
    return fail("invalid_request", error instanceof ImageUploadError ? error.message : "Nieprawidłowy format żądania.", error instanceof ImageUploadError ? error.status : 400);
  }
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const model = process.env.OPENROUTER_MODEL?.trim();
  if (!apiKey || !model) return fail("missing_configuration", "Brak konfiguracji: ustaw OPENROUTER_API_KEY i OPENROUTER_MODEL na serwerze i uruchom ponownie aplikację lub wykonaj ponowne wdrożenie.", 503);
  if (body.mode === "chat") return chatResponse(request, body, apiKey, model);

  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(50_000)]);
  try {
    const result = await analyzeMessage({ message: body.message, variant: body.variant, apiKey, model, signal });
    return Response.json(result, { headers });
  } catch (error) {
    const failure = analysisError(error, signal.aborted);
    return fail(failure.code, failure.message, failure.status);
  }
}

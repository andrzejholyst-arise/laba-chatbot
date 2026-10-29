import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { sameOrigin, sessionFromRequest, validSession } from "../../../lib/session";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  validateUIMessages,
} from "ai";

export const maxDuration = 60;

export async function POST(request: Request) {
  if (!validSession(sessionFromRequest(request))) {
    return new Response("Sesja wygasła lub nie jesteś zalogowany. Wpisz hasło ponownie.", {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (!sameOrigin(request)) return new Response("Niedozwolone źródło żądania.", { status: 403 });
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const model = process.env.OPENROUTER_MODEL?.trim();

  if (!apiKey || !model) {
    return new Response(
      "Brak konfiguracji: uzupełnij OPENROUTER_API_KEY i OPENROUTER_MODEL w pliku .env.local, a następnie uruchom ponownie serwer.",
      { status: 503 },
    );
  }

  let messages;
  try {
    const body = await request.json();
    messages = await validateUIMessages({ messages: body.messages });
    const last = messages.at(-1);
    if (
      !last ||
      last.role !== "user" ||
      !last.parts.some((part) => part.type === "text" && part.text.trim()) ||
      messages.some((message) =>
        !["user", "assistant"].includes(message.role) ||
        message.parts.some((part) =>
          part.type !== "text" &&
          !(message.role === "assistant" && part.type === "step-start"),
        ),
      )
    ) {
      return new Response("Wpisz niepustą wiadomość tekstową.", { status: 400 });
    }
  } catch {
    return new Response("Nieprawidłowy format rozmowy.", { status: 400 });
  }

  try {
    const openrouter = createOpenRouter({ apiKey });
    const result = streamText({
      model: openrouter(model),
      instructions: "Jesteś pomocnym asystentem. Odpowiadaj po polsku, jasno i krótko.",
      messages: await convertToModelMessages(messages),
      abortSignal: request.signal,
      maxRetries: 0,
      onError: () => {
        // Nie zapisujemy treści rozmowy ani szczegółów dostawcy w logach.
        console.error("Nie udało się połączyć z OpenRouter.");
      },
    });

    return createUIMessageStreamResponse({
      stream: toUIMessageStream({
        stream: result.stream,
        originalMessages: messages,
        sendReasoning: false,
        onError: () =>
          "Nie udało się uzyskać odpowiedzi. Sprawdź klucz, model i środki w OpenRouter, a następnie spróbuj ponownie.",
      }),
    });
  } catch {
    return new Response("Nie udało się uruchomić odpowiedzi chatbota.", { status: 502 });
  }
}

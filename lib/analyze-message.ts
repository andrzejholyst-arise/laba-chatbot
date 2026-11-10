import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { APICallError, generateText, NoObjectGeneratedError, Output } from "ai";
import { z } from "zod";
import { analysisSchema, type AnalysisVariant } from "./analysis";
import { instructionsForVariant } from "./analysis-instructions";

const configurationMessage = "Tryb analizy wymaga modelu i dostawcy obsługujących structured_outputs (JSON Schema). Sprawdź możliwości modelu w OpenRouter oraz ustawienie OPENROUTER_MODEL na serwerze i wykonaj ponowne wdrożenie. Model nie został zmieniony automatycznie; przed wyborem innego sprawdź jego koszt.";

export class AnalysisFailure extends Error {
  constructor(public code: string, message: string, public status = 502) {
    super(message);
  }
}

const catalogSchema = z.object({
  data: z.array(z.object({ id: z.string(), supported_parameters: z.array(z.string()) })),
});

export async function analyzeMessage(options: {
  message: string; apiKey: string; model: string; signal: AbortSignal;
  variant?: AnalysisVariant;
}) {
  const { message, apiKey, model, signal } = options;
  // Katalog pobieramy dopiero po ręcznym uruchomieniu analizy, bez generacji tekstu.
  const catalogResponse = await fetch("https://openrouter.ai/api/v1/models", {
    signal, cache: "no-store",
  });
  if (!catalogResponse.ok) throw new AnalysisFailure("capabilities_unavailable",
    "Nie można sprawdzić możliwości modelu w OpenRouter. Spróbuj ponownie później.", 503);
  const catalog = catalogSchema.safeParse(await catalogResponse.json());
  if (!catalog.success) throw new AnalysisFailure("capabilities_unavailable",
    "OpenRouter zwrócił nieprawidłowy katalog modeli. Analiza nie została uruchomiona.", 503);
  const selected = catalog.data.data.find((entry) => entry.id === model);
  if (!selected?.supported_parameters.includes("structured_outputs")) {
    throw new AnalysisFailure("unsupported_model", configurationMessage, 503);
  }

  const openrouter = createOpenRouter({
    apiKey,
    // Provider 3.1.0 nie udostępnia osobnego pola refusal w wyniku SDK.
    // Przechwytujemy jawną odmowę przed parsowaniem odpowiedzi przez provider.
    fetch: async (url, init) => {
      const response = await fetch(url, init);
      if (response.ok) {
        const body = await response.clone().json();
        if (body.choices?.some((choice: { message?: { refusal?: unknown }; finish_reason?: string }) =>
          choice.message?.refusal || choice.finish_reason === "content_filter")) {
          throw new AnalysisFailure("refused", "Model odmówił analizy tej wiadomości. Nie utworzono szkicu.");
        }
      }
      return response;
    },
  });
  const result = await generateText({
    model: openrouter(model, {
      structuredOutputs: { strict: true },
      provider: { require_parameters: true },
    }),
    output: Output.object({ name: "studio_nova_analysis", schema: analysisSchema }),
    instructions: instructionsForVariant(options.variant),
    messages: [{ role: "user", content: message }],
    abortSignal: signal,
    maxRetries: 0,
  });
  if (signal.aborted) throw new AnalysisFailure("interrupted", "Analiza została przerwana. Nie utworzono wyniku.", 408);
  if (result.finishReason === "content-filter") throw new AnalysisFailure("refused", "Model odmówił analizy tej wiadomości.");
  if (result.finishReason !== "stop") throw new AnalysisFailure("incomplete", "Odpowiedź modelu jest niepełna lub została przerwana. Spróbuj ponownie.");
  const parsed = analysisSchema.safeParse(result.output);
  if (!parsed.success) throw new AnalysisFailure("invalid_output", "Model zwrócił wynik niezgodny ze schematem. Nie utworzono szkicu.");
  return parsed.data;
}

// Nie zwracamy treści błędów dostawcy, promptów ani sekretów do przeglądarki.
export function analysisError(error: unknown, aborted = false): AnalysisFailure {
  if (aborted || (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name))) {
    return new AnalysisFailure("interrupted", "Analiza została przerwana lub przekroczyła limit czasu. Spróbuj ponownie.", 408);
  }
  if (error instanceof AnalysisFailure) return error;
  if (NoObjectGeneratedError.isInstance(error)) {
    if (error.finishReason === "content-filter") return new AnalysisFailure("refused", "Model odmówił analizy tej wiadomości.");
    if (error.finishReason === "length") return new AnalysisFailure("incomplete", "Odpowiedź została ucięta przed ukończeniem. Nie utworzono wyniku.");
    return new AnalysisFailure("invalid_output", "Model nie zwrócił poprawnego wyniku analizy: brak pola, zły typ, niedozwolona wartość, dodatkowe pole lub odmowa. Nie utworzono szkicu.");
  }
  if (APICallError.isInstance(error)) {
    if ([400, 404, 422].includes(error.statusCode ?? 0)) return new AnalysisFailure("provider_configuration", configurationMessage, 503);
    if ([401, 403].includes(error.statusCode ?? 0)) return new AnalysisFailure("provider_access", "OpenRouter odrzucił dostęp. Sprawdź klucz i uprawnienia po stronie serwera.", 503);
    if (error.statusCode === 402) return new AnalysisFailure("provider_credits", "OpenRouter zgłosił brak środków. Sprawdź konto; model nie został zmieniony.", 503);
    if (error.statusCode === 429) return new AnalysisFailure("provider_limit", "Limit OpenRouter został przekroczony. Spróbuj później.", 429);
  }
  return new AnalysisFailure("provider_error", "Nie udało się uzyskać analizy od dostawcy. Sprawdź połączenie i konfigurację OpenRouter lub spróbuj później.");
}

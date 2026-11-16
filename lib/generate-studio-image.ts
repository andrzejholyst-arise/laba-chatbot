import { AGENT_TOOL_TIMEOUT_MS } from "./tool-catalog";
import { imageModelId } from "./model-config";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { APICallError, generateImage, tool } from "ai";
import { MAX_IMAGE_BYTES, imageMediaType } from "./image-files";
import { modelFromBody } from "./response-model";
import { prepareStudioNovaImage, studioNovaImagePrompt } from "./studio-nova-image";
import { imagePromptSchema, imageToolResultSchema, type ImageToolResult } from "./image-tool-result";

async function generateStudioImage(prompt: string, apiKey: string, abortSignal?: AbortSignal): Promise<ImageToolResult> {
  let actualModel: string | null = null;
  const signal = AbortSignal.any([...(abortSignal ? [abortSignal] : []), AbortSignal.timeout(AGENT_TOOL_TIMEOUT_MS)]);
  try {
    const openrouter = createOpenRouter({ apiKey, fetch: async (url, init) => {
      const response = await fetch(url, init);
      if (response.ok) {
        try { actualModel = modelFromBody(await response.clone().json()); } catch { /* SDK sprawdzi format. */ }
      }
      return response;
    } });
    const result = await generateImage({
      model: openrouter.imageModel(imageModelId()),
      prompt: studioNovaImagePrompt(prompt), aspectRatio: "1:1",
      n: 1, maxRetries: 0, abortSignal: signal,
    });
    const bytes = result.image.uint8Array;
    if (!imageMediaType(bytes)) return { ok: false, error: "Model nie zwrócił poprawnego obrazu. Spróbuj ponownie." };
    if (bytes.length > MAX_IMAGE_BYTES * 4) return { ok: false, error: "Obraz jest zbyt duży do przetworzenia. Spróbuj ponownie." };
    let output: Buffer;
    try { output = await prepareStudioNovaImage(bytes); }
    catch { return { ok: false, error: "Nie można przygotować obrazu 800 × 800 pikseli. Spróbuj ponownie." }; }
    if (output.length > MAX_IMAGE_BYTES) return { ok: false, error: "Obraz jest zbyt duży do przesłania. Spróbuj ponownie." };
    // Nie używamy calls[].response.modelId — provider kopiuje tam konfigurację.
    return { ok: true, dataUrl: `data:image/png;base64,${output.toString("base64")}`, modelId: actualModel };
  } catch (error) {
    if (signal.aborted) return { ok: false, error: "Generowanie obrazu zostało przerwane lub trwało zbyt długo." };
    if (APICallError.isInstance(error) && error.statusCode === 402) return { ok: false, error: "OpenRouter zgłosił brak środków na generowanie obrazu." };
    return { ok: false, error: "Nie można wygenerować obrazu. Skonfigurowany model obrazów może być niedostępny. Sprawdź OPENROUTER_IMAGE_MODEL, dostęp, klucz i środki w OpenRouter lub spróbuj później." };
  }
}

export function imageGenerationTool(apiKey: string) {
  return tool({
    description: "Generuje obraz na wyraźną prośbę użytkownika. Przekaż opis sceny do 500 znaków. Serwer dodaje styl Studio Nova: banan, jaskrawe kolory pozostałych elementów i plik PNG 800 × 800. Obraz zostanie pokazany w przeglądarce; nie zwracaj base64 ani fikcyjnego linku w odpowiedzi. Nie wywołuj ponownie po sukcesie, chyba że użytkownik poprosi o kolejny obraz.",
    inputSchema: imagePromptSchema,
    outputSchema: imageToolResultSchema,
    execute: async ({ prompt }, { abortSignal }) => generateStudioImage(prompt, apiKey, abortSignal),
    toModelOutput: ({ output }) => ({
      type: "text" as const,
      value: output.ok ? "obraz wygenerowany" : output.error,
    }),
  });
}

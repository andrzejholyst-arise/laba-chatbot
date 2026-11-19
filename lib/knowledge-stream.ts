import { importStages, type ImportStage, type KnowledgeImportResult } from "./knowledge-document";

export async function readKnowledgeImport(response: Response, progress: (stage: ImportStage) => void): Promise<KnowledgeImportResult> {
  if (!response.ok) {
    const body = await response.json();
    throw new Error(body.error?.message ?? "Nie udało się rozpocząć importu. Odśwież listę i spróbuj ponownie.");
  }
  if (!response.body) throw new Error("Brak potwierdzenia importu. Odśwież listę dokumentów.");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let pending = "", result: KnowledgeImportResult | undefined;
  function consume(line: string) {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === "progress" && Object.hasOwn(importStages, event.stage)) progress(event.stage);
    if (event.type === "error") throw new Error(`${event.error.message} ${event.error.action ?? ""}`.trim());
    if (event.type === "complete") result = event.result;
  }
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split("\n"); pending = lines.pop() ?? "";
      lines.forEach(consume);
    }
    consume(pending + decoder.decode());
    if (!result || typeof result.title !== "string" || !Number.isSafeInteger(result.chunkCount) || result.chunkCount < 1 || !Number.isSafeInteger(result.backfilledCount)) throw new Error("Nie otrzymano pełnego potwierdzenia importu. Odśwież listę dokumentów przed kolejną próbą.");
    return result;
  } finally { void reader.cancel().catch(() => {}); }
}

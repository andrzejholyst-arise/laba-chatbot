import "server-only";

export function chatModelId() {
  return process.env.OPENROUTER_MODEL?.trim();
}

// Sprawdzone 2026-11-19 jednym embed("test"), bez wymuszania dimensions:
// openai/text-embedding-3-small -> 1536 liczb.
// Zapis dokumentów i embedding pytań mają korzystać z tego samego modelu.
export const EMBEDDING_DIMENSIONS = 1536;

export function embeddingModelId() {
  const model = process.env.OPENROUTER_EMBEDDING_MODEL?.trim();
  if (!model) throw new Error("Brak konfiguracji: ustaw OPENROUTER_EMBEDDING_MODEL na serwerze.");
  return model;
}

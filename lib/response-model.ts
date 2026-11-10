// Obserwujemy rzeczywiste pole `model` z API, bez fallbacku do nazwy z konfiguracji.
export function modelFromBody(body: unknown): string | null {
  if (!body || typeof body !== "object" || !("model" in body)) return null;
  return typeof body.model === "string" && body.model.trim() ? body.model.trim() : null;
}

export function observeStreamModel(response: Response, onModel: (model: string) => void): Response {
  if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) return response;
  const decoder = new TextDecoder();
  let pending = "";
  return new Response(response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        try {
          const model = modelFromBody(JSON.parse(line.slice(5).trim()));
          if (model) onModel(model);
        } catch { /* [DONE] i błędy formatu obsługuje właściwy parser SDK. */ }
      }
      controller.enqueue(chunk);
    },
  })), { status: response.status, statusText: response.statusText, headers: response.headers });
}

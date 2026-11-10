import { DefaultChatTransport } from "ai";
import type { ChatMessage } from "./chat-message";
import { MAX_IMAGE_BYTES, safeImageDataUrl } from "./image-files";

export const chatTransport = new DefaultChatTransport<ChatMessage>({
  api: "/api/agent",
  body: { mode: "chat", responseFormat: "text" },
  fetch: async (url, options) => {
    let prepared = options;
    if (typeof options?.body === "string") {
      const body = JSON.parse(options.body) as { messages: ChatMessage[] };
      if (Array.isArray(body.messages)) {
        // Do kontekstu trafia ostatnie zdjęcie użytkownika. Starsze miniatury
        // i wygenerowane obrazy pozostają w widoku, bez kolejnych uploadów.
        const latest = body.messages.filter((message) => message.role === "user")
          .flatMap((message) => message.parts).filter((part) => part.type === "file").at(-1);
        for (const message of body.messages) {
          message.parts = message.parts.filter((part) => part.type !== "tool-generujObraz" && part.type !== "tool-odpowiedzPoPolsku" &&
            (part.type !== "file" || (message.role === "user" && part === latest)));
        }
        body.messages = body.messages.filter((message) => message.parts.length > 0);
        if (latest?.type === "file") {
          if (!safeImageDataUrl(latest.url, latest.mediaType)) throw new Error("Dozwolone zdjęcia: JPG, PNG i WebP.");
          const encoded = latest.url.slice(latest.url.indexOf(",") + 1);
          if (encoded.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) throw new Error("Zdjęcie może mieć maksymalnie 4 MB.");
          const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
          if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("Zdjęcie może mieć maksymalnie 4 MB.");
          latest.url = "upload:image";
          const history = JSON.stringify(body);
          if (new TextEncoder().encode(history).byteLength > 100_000) throw new Error("Historia jest zbyt długa. Odśwież czat i spróbuj ponownie.");
          const form = new FormData();
          form.set("messages", history);
          form.set("image", new Blob([bytes], { type: latest.mediaType }), latest.filename || "zdjecie");
          const headers = new Headers(options.headers);
          headers.delete("content-type");
          prepared = { ...options, headers, body: form };
        } else prepared = { ...options, body: JSON.stringify(body) };
      }
    }
    const response = await fetch(url, prepared);
    if (response.status === 401) window.location.replace("/");
    if (!response.ok) {
      if (response.headers.get("content-type")?.includes("application/json")) {
        const body = await response.json();
        throw new Error(body?.error?.message || "Nie udało się wysłać wiadomości.");
      }
      throw new Error((await response.text()) || "Nie udało się wysłać wiadomości.");
    }
    return response;
  },
});

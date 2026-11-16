import type { ChatMessage } from "./chat-message";

type Source = { id: string; url: string; title: string; timestamp?: string };
const apiSources: Record<string, { name: string; host: string }> = {
  "tool-dlugoscDnia": { name: "Open-Meteo — długość dnia", host: "open-meteo.com" },
  "tool-pogoda": { name: "Open-Meteo", host: "open-meteo.com" },
  "tool-waluty": { name: "NBP", host: "api.nbp.pl" },
  "tool-swieta": { name: "Nager.Date", host: "date.nager.at" },
  "tool-wikipedia": { name: "Wikipedia", host: "pl.wikipedia.org" },
};
export function messageSources(message: ChatMessage): Source[] {
  if (message.role !== "assistant") return [];
  const sources: Source[] = [];
  for (const part of message.parts) {
    if (part.type === "source-url") {
      try {
        const url = new URL(part.url);
        if (["http:", "https:"].includes(url.protocol)) sources.push({ id: part.sourceId, url: part.url, title: part.title || part.url, timestamp: message.metadata?.retrievedAt });
      } catch { /* Nie pokazujemy nieprawidłowych linków. */ }
    } else if (apiSources[part.type] && "state" in part && part.state === "output-available" && "output" in part) {
      const output = part.output;
      if (!output || typeof output !== "object" || !("ok" in output) || output.ok !== true || !("source" in output) || typeof output.source !== "string") continue;
      try {
        const url = new URL(output.source);
        const spec = apiSources[part.type];
        if (url.protocol !== "https:" || url.hostname !== spec.host || url.port || url.username || url.password) continue;
        sources.push({ id: part.toolCallId, url: url.href,
          title: "tytul" in output && typeof output.tytul === "string" ? `Wikipedia: ${output.tytul}` : spec.name,
          timestamp: "retrievedAt" in output && typeof output.retrievedAt === "string" ? output.retrievedAt : undefined });
      } catch { /* Błędne dane nie stają się źródłem. */ }
    }
  }
  return sources;
}

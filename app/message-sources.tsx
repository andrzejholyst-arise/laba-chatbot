import type { ChatMessage } from "../lib/chat-message";

export default function MessageSources({ message }: { message: ChatMessage }) {
  if (message.role !== "assistant") return null;
  const sources = message.parts.filter((part) => {
    if (part.type !== "source-url") return false;
    try { return ["http:", "https:"].includes(new URL(part.url).protocol); }
    catch { return false; }
  }).filter((part) => part.type === "source-url");
  if (!sources.length) return null;
  const timestamp = message.metadata?.retrievedAt;
  const date = timestamp ? new Date(timestamp) : null;
  const retrieved = date && Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("pl-PL", {
      dateStyle: "short", timeStyle: "short", timeZone: "Europe/Warsaw",
    }).format(date) : null;

  return <section aria-label="Źródła">
    <h3>Źródła</h3>
    <ul>{sources.map((source, index) => <li key={`${source.sourceId}-${index}`}>
      <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title || source.url}</a>
      {retrieved && <> — <small>pobrano: <time dateTime={timestamp}>{retrieved} (Warszawa)</time></small></>}
    </li>)}</ul>
  </section>;
}

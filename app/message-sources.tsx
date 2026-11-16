import type { ChatMessage } from "../lib/chat-message";
import { messageSources } from "../lib/message-sources";

export default function MessageSources({ message }: { message: ChatMessage }) {
  const sources = messageSources(message);
  if (!sources.length) return null;
  return <section aria-label="Źródła">
    <h3>Źródła</h3>
    <ul>{sources.map((source, index) => {
      const date = source.timestamp ? new Date(source.timestamp) : null;
      const retrieved = date && Number.isFinite(date.getTime())
        ? new Intl.DateTimeFormat("pl-PL", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Warsaw" }).format(date) : null;
      return <li key={`${source.id}-${index}`}>
        <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>
        {retrieved && <> — <small>pobrano: <time dateTime={source.timestamp}>{retrieved} (Warszawa)</time></small></>}
      </li>;
    })}</ul>
  </section>;
}

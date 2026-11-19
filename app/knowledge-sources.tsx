"use client";

import { useState } from "react";
import type { ChatMessage } from "../lib/chat-message";
import { knowledgeSourcesForMessage } from "../lib/knowledge-sources";
import styles from "./chat.module.css";

const percentage = new Intl.NumberFormat("pl-PL", { style: "percent", maximumFractionDigits: 1 });
export default function KnowledgeSources({ message }: { message: ChatMessage }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const sources = knowledgeSourcesForMessage(message);
  if (!sources.length) return null;
  return <section className={styles.knowledgeSources} aria-label="Źródła z bazy wiedzy">
    <h3>Źródła z bazy wiedzy</h3>
    <ul>{sources.map(source => <li key={source.sourceId}>
      <strong>{source.title}</strong><span>Podobieństwo: {percentage.format(Math.min(1, source.similarity))}</span>
      <button type="button" aria-expanded={!!expanded[source.sourceId]} aria-controls={`${message.id}-${source.sourceId}`}
        onClick={() => setExpanded(current => ({ ...current, [source.sourceId]: !current[source.sourceId] }))}>
        {expanded[source.sourceId] ? "Ukryj fragment" : "Pokaż fragment"}
      </button>
      {expanded[source.sourceId] && <p id={`${message.id}-${source.sourceId}`} className={styles.knowledgeExcerpt}>{source.content}</p>}
    </li>)}</ul>
  </section>;
}

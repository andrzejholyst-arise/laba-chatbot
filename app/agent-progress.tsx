import type { ChatMessage } from "../lib/chat-message";
import { chatToolSteps } from "../lib/used-chat-tools";
import styles from "./chat.module.css";

export function AgentSteps({ message }: { message: ChatMessage }) {
  const steps = chatToolSteps(message);
  if (!steps.length) return null;
  return <div className={styles.toolBadges} aria-label="Użyte narzędzia">
    <ol className={styles.agentSteps} aria-label="Kroki agenta">
      {steps.map(({ step, tools }) => <li key={step} data-step={step}>
        <span title={tools.map(tool => tool.name).join(", ")}>{step}. {tools.map(tool => tool.label).join(" + ")}</span>
      </li>)}
    </ol>
  </div>;
}
export function AgentLimit({ message }: { message: ChatMessage }) {
  if (message.role !== "assistant" || (!message.metadata?.stepLimitReached && !message.metadata?.stopReason)) return null;
  const findings = message.metadata.partialFindings ?? [];
  return <section className={styles.limitSummary} aria-label="Dotychczasowe wyniki">
    <p role="status">{message.metadata.stopMessage || (message.metadata.stepLimitReached ? `Zatrzymałem się po ${message.metadata.stepLimit ?? message.metadata.stepsCompleted ?? "maksymalnej liczbie"} krokach` : "Zadanie zakończono z wynikiem częściowym.")}</p>
    {!!message.metadata.toolFailures?.length && <><h3>Nie udało się sprawdzić</h3><ul>{message.metadata.toolFailures.map((failure, index) => <li key={index}>{failure.tool}: {failure.message}</li>)}</ul></>}
    {message.metadata.stopReason === "cancelled" ? (findings.length > 0 && <><h3>Dotychczasowe wyniki</h3><ul>{findings.map((finding, index) => <li key={index}>{finding}</li>)}</ul></>) : findings.length ? <><h3>Dotychczasowe wyniki</h3><ul>{findings.map((finding, index) => <li key={index}>{finding}</li>)}</ul></>
      : message.metadata.stopReason === "provider_error" ? <p>Odpowiedź nie została ukończona. Spróbuj wysłać wiadomość ponownie.</p>
      : <p>Nie uzyskano potwierdzonych wyników narzędzi. Doprecyzuj zadanie lub spróbuj ponownie.</p>}
  </section>;
}

export function AgentStats({ message }: { message: ChatMessage }) {
  const meta = message.metadata;
  if (message.role !== "assistant" || typeof meta?.durationMs !== "number" || !Number.isFinite(meta.durationMs)) return null;
  const seconds = new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(meta.durationMs / 1000);
  return <small className={styles.taskStats} aria-label="Statystyki zadania">Kroki: {meta.modelSteps ?? meta.stepsCompleted ?? (meta.stopReason === "cancelled" ? "—" : 0)} · Wywołania narzędzi: {meta.toolCalls ?? (meta.stopReason === "cancelled" ? "—" : 0)} · Czas: {seconds} s{meta.stopReason === "cancelled" && " · dane częściowe"}</small>;
}

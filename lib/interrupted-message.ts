import type { ChatMessage } from "./chat-message";
import { toolFinding } from "./tool-findings";

// Fetch jest już przerwany, więc końcowe metadane serwera mogą nie dotrzeć.
// Zachowujemy ostatni stan SDK i dopisujemy status lokalnie, bez nowego żądania.
export function markInterrupted(messages: ChatMessage[], fallbackId: string, durationMs: number): ChatMessage[] {
  const userIndex = messages.findLastIndex(message => message.role === "user");
  if (userIndex < 0) return messages;
  const last = messages.at(-1);
  const hasResponse = last?.role === "assistant" && messages.length - 1 > userIndex;
  const response: ChatMessage = hasResponse ? last : { id: fallbackId, role: "assistant", parts: [] };
  const findings = new Set(response.metadata?.partialFindings ?? []);
  for (const part of response.parts) {
    if (findings.size >= 24) break;
    if (part.type.startsWith("tool-") && "state" in part && part.state === "output-available" && "output" in part) {
      const finding = toolFinding(part.type.slice(5), part.output);
      if (finding && !finding.startsWith("Błąd")) findings.add(finding);
    }
  }
  const observedSteps = response.parts.filter(part => part.type === "step-start").length;
  const updated: ChatMessage = { ...response, metadata: {
    ...response.metadata,
    stopReason: "cancelled", stopMessage: "Przerwane przez użytkownika", stepLimitReached: false,
    partialFindings: [...findings],
    modelSteps: Math.max(response.metadata?.modelSteps ?? 0, observedSteps) || undefined,
    durationMs: Math.max(response.metadata?.durationMs ?? 0, durationMs),
  } };
  return hasResponse ? [...messages.slice(0, -1), updated] : [...messages, updated];
}

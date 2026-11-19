import { toolLabels } from "./tool-catalog";
import type { ChatMessage } from "./chat-message";

export type ChatToolStep = { step: number; tools: { name: string; label: string }[] };
export function chatToolSteps(message: ChatMessage): ChatToolStep[] {
  if (message.role !== "assistant") return [];
  const invocation = (part: ChatMessage["parts"][number]) => {
    if ("toolCallId" in part && message.metadata?.blockedToolCallIds?.includes(part.toolCallId)) return null;
    if (!("toolCallId" in part) || !("state" in part) || part.state === "input-streaming") return null;
    const name = part.type === "dynamic-tool" ? part.toolName : part.type.startsWith("tool-") ? part.type.slice(5) : "";
    return toolLabels[name] ? { name, id: part.toolCallId } : null;
  };
  const explicitSearchSteps = new Set<number>();
  let step = 0;
  for (const part of message.parts) {
    if (part.type === "step-start") step++;
    if (invocation(part)?.name === "webSearch") explicitSearchSteps.add(Math.max(1, step));
  }
  const groups = new Map<number, ChatToolStep>();
  const seenCalls = new Set<string>(), sourceSteps = new Set<number>();
  const add = (name: string) => {
    const index = Math.max(1, step);
    if (!groups.has(index)) groups.set(index, { step: index, tools: [] });
    groups.get(index)!.tools.push({ name, label: toolLabels[name] });
  };
  step = 0;
  for (const part of message.parts) {
    if (part.type === "step-start") step++;
    const call = invocation(part);
    if (call && !seenCalls.has(call.id)) { add(call.name); seenCalls.add(call.id); }
    const index = Math.max(1, step);
    if (part.type === "source-url" && !explicitSearchSteps.has(index) && !sourceSteps.has(index)) { add("webSearch"); sourceSteps.add(index); }
  }
  if (message.metadata?.knowledgeSearched && ![...groups.values()].some(group => group.tools.some(tool => tool.name === "searchKnowledge"))) {
    if (!groups.has(1)) groups.set(1, { step: 1, tools: [] });
    groups.get(1)!.tools.unshift({ name: "searchKnowledge", label: toolLabels.searchKnowledge });
  }
  return [...groups.values()];
}
// Zachowujemy pomocniczą płaską listę etykiet dla dotychczasowych integracji.
export function usedChatTools(message: ChatMessage): string[] {
  return chatToolSteps(message).flatMap(step => step.tools.map(tool => tool.label));
}

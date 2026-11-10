import type { ChatMessage } from "./chat-message";

export function usedChatTools(message: ChatMessage): string[] {
  if (message.role !== "assistant") return [];
  const names: Record<string, string> = {
    webSearch: "🔎 wyszukiwanie", aktualnyCzas: "🕒 aktualnyCzas",
    opadyDlaOgrodnika: "🌧️ opady deszczu dla ogrodnika", generujObraz: "🎨 generowanie obrazu",
    policzKosztKonsultacji: "🧮 policzKosztKonsultacji",
    odpowiedzPoPolsku: "🔊 odpowiedzPoPolsku",
  };
  const invocation = (part: ChatMessage["parts"][number]) => {
    if (!("toolCallId" in part) || !("state" in part) || part.state === "input-streaming") return null;
    const name = part.type === "dynamic-tool" ? part.toolName
      : part.type.startsWith("tool-") ? part.type.slice(5) : "";
    return names[name] ? { name, id: part.toolCallId } : null;
  };
  // Nie dublujemy native search za cytowania, jeśli ma też jawne wywołanie.
  const explicitSearchSteps = new Set<number>();
  let step = 0;
  for (const part of message.parts) {
    if (part.type === "step-start") step++;
    if (invocation(part)?.name === "webSearch") explicitSearchSteps.add(step);
  }
  const labels: string[] = [];
  const seenCalls = new Set<string>();
  const sourceSteps = new Set<number>();
  step = 0;
  for (const part of message.parts) {
    if (part.type === "step-start") step++;
    const call = invocation(part);
    if (call && !seenCalls.has(call.id)) {
      labels.push(names[call.name]);
      seenCalls.add(call.id);
    }
    // Pierwsze cytowanie w danym kroku oznacza użycie native search.
    if (part.type === "source-url" && !explicitSearchSteps.has(step) && !sourceSteps.has(step)) {
      labels.push(names.webSearch);
      sourceSteps.add(step);
    }
  }
  return labels;
}

import { z } from "zod";
import type { UIMessage } from "ai";

// 2026-11-19, 9 prób na openai/text-embedding-3-small: najlepsze trafienia
// dla 4 pytań z odpowiedzią 0.598–0.797, dla 3 obcych tematów 0.239–0.330.
// Pułapki tematyczne osiągały 0.540–0.703: próg nie dowodzi kompletności.
export const KNOWLEDGE_SIMILARITY_THRESHOLD = 0.45;
export const knowledgeSourceSchema = z.object({
  sourceId: z.string().regex(/^K[a-f0-9]{12}$/), title: z.string().min(1).max(200),
  content: z.string().min(1).max(20_000), similarity: z.number().finite().min(KNOWLEDGE_SIMILARITY_THRESHOLD).max(1.00001),
});
export type KnowledgeSource = z.infer<typeof knowledgeSourceSchema>;

export function cleanKnowledgeContext(value: unknown): { searched: boolean; sources: KnowledgeSource[] } {
  const parsed = z.object({ searched: z.boolean(), sources: z.array(z.unknown()).max(48) }).safeParse(value);
  if (!parsed.success || !parsed.data.searched) return { searched: false, sources: [] };
  return { searched: true, sources: parsed.data.sources.flatMap(source => { const safe = knowledgeSourceSchema.safeParse(source); return safe.success ? [safe.data] : []; }) };
}

export function knowledgeSourcesForMessage(message: UIMessage): KnowledgeSource[] {
  if (message.role !== "assistant") return [];
  const text = message.parts.filter(part => part.type === "text").map(part => part.text).join("\n");
  const cited = new Set([...text.matchAll(/\[(K[a-f0-9]{12})\]/g)].map(match => match[1]));
  const metadata = message.metadata && typeof message.metadata === "object" ? message.metadata as Record<string, unknown> : {};
  const candidates: unknown[] = Array.isArray(metadata.knowledgeSources) ? metadata.knowledgeSources.slice(0, 48) : [];
  for (const part of message.parts) {
    if (part.type !== "tool-searchKnowledge" || !("state" in part) || part.state !== "output-available" || !("output" in part)) continue;
    const result = z.object({ ok: z.literal(true), fragments: z.array(z.unknown()).max(3) }).safeParse(part.output);
    if (result.success) candidates.push(...result.data.fragments);
  }
  const sources = new Map<string, KnowledgeSource>();
  for (const candidate of candidates) {
    const parsed = knowledgeSourceSchema.safeParse(candidate);
    if (!parsed.success || !cited.has(parsed.data.sourceId)) continue;
    const previous = sources.get(parsed.data.sourceId);
    if (!previous || parsed.data.similarity > previous.similarity) sources.set(parsed.data.sourceId, parsed.data);
  }
  return [...sources.values()];
}

export function visibleKnowledgeText(text: string) {
  return text.replace(/[ \t]*\[K[a-f0-9]{12}\]/g, "");
}

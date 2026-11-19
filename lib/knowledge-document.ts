import { z } from "zod";

export const DOCUMENT_CONTENT_LIMIT = 20_000;
export const CHUNK_CONTENT_LIMIT = 800;
export type ChunkingMode = "paragraphs" | "fixed";
export const documentInputSchema = z.strictObject({
  title: z.string().trim().min(1, "Podaj tytuł dokumentu.").max(200, "Tytuł może mieć najwyżej 200 znaków."),
  content: z.string().max(DOCUMENT_CONTENT_LIMIT, "Treść może mieć najwyżej 20 000 znaków.").trim().min(1, "Wklej treść dokumentu."),
  chunkingMode: z.enum(["paragraphs", "fixed"]).default("paragraphs"),
});
export const knowledgeVersionSchema = z.strictObject({ id: z.string().regex(/^(?:\d+|[0-9a-f-]{36})$/i), createdAt: z.string().max(60).refine(value => Number.isFinite(Date.parse(value))) });
export const knowledgeImportSchema = documentInputSchema.extend({ expectedVersions: z.array(knowledgeVersionSchema).max(1000).default([]) });
export type KnowledgeVersion = z.infer<typeof knowledgeVersionSchema>;
export type KnowledgeSummary = KnowledgeVersion & { title: string; chunkCount: number };
export const importStages = { splitting: "Dzielę tekst…", embedding: "Tworzę embeddingi…", saving: "Zapisuję…" };
export type ImportStage = keyof typeof importStages;
export type KnowledgeImportResult = { documentId: string; title: string; chunkCount: number; backfilledCount: number };

// Gdy pojedyncze zdanie przekracza limit, wybieramy granicę słowa.
// Dopiero słowo dłuższe niż 800 znaków wymaga podziału wewnątrz słowa.
function splitLongSentence(text: string) {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > CHUNK_CONTENT_LIMIT) {
    const prefix = rest.slice(0, CHUNK_CONTENT_LIMIT + 1);
    let boundary = prefix.search(/\s+\S*$/u);
    if (boundary <= 0) boundary = CHUNK_CONTENT_LIMIT;
    const last = rest.charCodeAt(boundary - 1);
    if (last >= 0xd800 && last <= 0xdbff) boundary--;
    parts.push(rest.slice(0, boundary).trim());
    rest = rest.slice(boundary).trimStart();
  }
  if (rest.trim()) parts.push(rest.trim());
  return parts;
}

export function splitDocument(content: string, mode: ChunkingMode = "paragraphs"): string[] {
  if (mode === "fixed") {
    const characters = Array.from(content.trim());
    const chunks: string[] = [];
    for (let start = 0; start < characters.length; start += 250) {
      const chunk = characters.slice(start, start + 300).join("");
      if (chunk.trim()) chunks.push(chunk);
      if (start + 300 >= characters.length) break;
    }
    return chunks;
  }
  const paragraphs = content.replace(/\r\n?/g, "\n").split(/\n[\t ]*\n(?:[\t ]*\n)*/u).map(text => text.trim()).filter(Boolean);
  const segmenter = new Intl.Segmenter("pl", { granularity: "sentence" });
  return paragraphs.flatMap(paragraph => {
    if (paragraph.length <= CHUNK_CONTENT_LIMIT) return [paragraph];
    const chunks: string[] = [];
    let current = "";
    for (const { segment } of segmenter.segment(paragraph)) {
      const sentence = segment.trim();
      if (!sentence) continue;
      if (sentence.length > CHUNK_CONTENT_LIMIT) {
        if (current) { chunks.push(current); current = ""; }
        chunks.push(...splitLongSentence(sentence));
      } else if (!current) current = sentence;
      else if (current.length + 1 + sentence.length <= CHUNK_CONTENT_LIMIT) current += ` ${sentence}`;
      else { chunks.push(current); current = sentence; }
    }
    if (current) chunks.push(current);
    return chunks;
  });
}

import assert from "node:assert/strict";
import test from "node:test";
import { loadApp } from "./app-fixture.mjs";

test("Źródła odpowiedzi są cytowane, wystarczająco podobne i bezpieczne do wyświetlenia", async t => {
  const app = await loadApp(t);
  const { knowledgeSourcesForMessage, visibleKnowledgeText, cleanKnowledgeContext, KNOWLEDGE_SIMILARITY_THRESHOLD } = await app("lib/knowledge-sources.ts");
  const { chatToolSteps } = await app("lib/used-chat-tools.ts");
  const first = { sourceId: "K012345abcdef", title: "Cennik", content: "Dokładny tekst.\nDruga linia.", similarity: .8 };
  const second = { sourceId: "K111111111111", title: "FAQ", content: "Inny znaleziony fragment.", similarity: .7 };
  const weak = { sourceId: "K222222222222", title: "Obcy temat", content: "Słaby wynik.", similarity: KNOWLEDGE_SIMILARITY_THRESHOLD - .001 };
  const message = { id: "a", role: "assistant", parts: [{ type: "tool-searchKnowledge", toolCallId: "search", state: "output-available", input: {}, output: { ok: true, fragments: [first, second, weak] } }, { type: "text", text: "Odpowiedź [K012345abcdef]. [K222222222222] [K999999999999]" }] };
  assert.deepEqual(knowledgeSourcesForMessage(message), [first]);
  assert.equal(visibleKnowledgeText("Odpowiedź [K012345abcdef].\n📎 Źródło: Cennik [K012345abcdef]"), "Odpowiedź.\n📎 Źródło: Cennik");
  const stored = { ...message, metadata: { knowledgeSearched: true, knowledgeSources: [first, weak] }, parts: [message.parts[1]] };
  assert.deepEqual(knowledgeSourcesForMessage(stored), [first]);
  assert.equal(chatToolSteps(stored)[0].tools[0].label, "📚 baza wiedzy");
  assert.deepEqual(cleanKnowledgeContext({ searched: true, sources: [first, weak, { title: "Niepełne" }] }), { searched: true, sources: [first] });
  assert.deepEqual(knowledgeSourcesForMessage({ ...message, role: "user" }), []);
  assert.deepEqual(knowledgeSourcesForMessage({ ...stored, parts: [{ type: "text", text: "Nie mam tej informacji w bazie wiedzy" }] }), []);
  const duplicate = { ...message, parts: [...message.parts, message.parts[0]] };
  assert.equal(knowledgeSourcesForMessage(duplicate).length, 1);
});

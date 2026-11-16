import assert from "node:assert/strict";
import test from "node:test";
import { loadApp } from "./app-fixture.mjs";

test("Stop zachowuje rozmowę i przerywa zadanie — bez modelu", async t => {
  const app = await loadApp(t);
  const { markInterrupted } = await app("lib/interrupted-message.ts");
  const { TaskBudget } = await app("lib/task-budget.ts");
  const { chatResponse } = await app("lib/agent-chat.ts");
  const user = { id: "u1", role: "user", parts: [{ type: "text", text: "Zadanie." }] };

  await t.test("Tekst, obraz, nagranie, źródła i wyniki pozostają; brak pozornego ukończenia", () => {
    const parts = [
      { type: "step-start" }, { type: "text", text: "Odebrana część odpowiedzi.", state: "streaming" },
      { type: "tool-kalkulator", toolCallId: "calc", state: "output-available", input: {}, output: { ok: true, dzialanie: "dodaj", a: 2, b: 3, wynik: 5 } },
      { type: "tool-generujObraz", toolCallId: "image", state: "output-available", input: {}, output: { ok: true, dataUrl: "data:image/png;base64,LOCAL_IMAGE", modelId: "test/image" } },
      { type: "tool-odpowiedzPoPolsku", toolCallId: "voice", state: "output-available", input: {}, output: { ok: true, audioUrl: "data:audio/mpeg;base64,LOCAL_AUDIO", tekst: "Nagranie." } },
      { type: "source-url", sourceId: "source", url: "https://example.com/", title: "Źródło" },
      { type: "step-start" }, { type: "tool-pogoda", toolCallId: "pending", state: "input-available", input: { miasto: "Kraków" } },
    ];
    const response = { id: "a1", role: "assistant", parts, metadata: { modelId: "test/model", modelSteps: 1, toolCalls: 3, durationMs: 1000, stepLimitReached: true } };
    const original = [user, response];
    const updated = markInterrupted(original, "unused", 2500);
    assert.equal(updated.length, 2); assert.equal(updated[1].id, "a1"); assert.equal(updated[1].parts, parts);
    assert.equal(updated[1].metadata.stopMessage, "Przerwane przez użytkownika"); assert.equal(updated[1].metadata.stopReason, "cancelled");
    assert.equal(updated[1].metadata.stepLimitReached, false); assert.equal(updated[1].metadata.modelSteps, 2);
    assert.equal(updated[1].metadata.toolCalls, 3); assert.equal(updated[1].metadata.durationMs, 2500);
    assert.ok(updated[1].metadata.partialFindings.some(line => line.includes("wynik=5")));
    assert.ok(!JSON.stringify(updated[1].metadata).includes("LOCAL_IMAGE")); assert.ok(!JSON.stringify(updated[1].metadata).includes("LOCAL_AUDIO"));
    assert.equal(original[1].metadata.stopReason, undefined); assert.equal(parts.at(-1).state, "input-available");
  });

  await t.test("Stop przed pierwszym fragmentem tworzy tylko nowy dopisek i nie rusza starej odpowiedzi", () => {
    const old = { id: "old", role: "assistant", parts: [{ type: "text", text: "Poprzednia odpowiedź." }] };
    const messages = [old, user];
    const updated = markInterrupted(messages, "notice", 500);
    assert.equal(updated.length, 3); assert.equal(updated[0], old); assert.equal(updated[2].id, "notice");
    assert.deepEqual(updated[2].parts, []); assert.equal(updated[2].metadata.stopMessage, "Przerwane przez użytkownika");
    assert.equal(updated[2].metadata.toolCalls, undefined); assert.equal(updated[2].metadata.modelSteps, undefined);
    assert.equal(markInterrupted(updated, "duplicate", 600).length, 3);
    assert.deepEqual(markInterrupted([], "nothing", 0), []);
  });

  await t.test("Znane statystyki i zakończone wyniki są zachowane, błędów nie udajemy jako danych", () => {
    const response = { id: "a1", role: "assistant", metadata: { modelSteps: 2, stepsCompleted: 1, durationMs: 3000, partialFindings: ["Potwierdzony wynik."] }, parts: [
      { type: "tool-pogoda", toolCallId: "failed", state: "output-available", input: {}, output: { ok: false, message: "Brak danych" } },
    ] };
    const updated = markInterrupted([user, response], "unused", 2000).at(-1);
    assert.equal(updated.metadata.durationMs, 3000); assert.equal(updated.metadata.modelSteps, 2);
    assert.deepEqual(updated.metadata.partialFindings, ["Potwierdzony wynik."]);
  });

  await t.test("Abort klienta przerywa aktywne narzędzie i blokuje dalsze wykonanie", async () => {
    const client = new AbortController(), budget = new TaskBudget(client.signal);
    try {
      let signal;
      const active = budget.runTool("pogoda", "one", received => { signal = received; return new Promise(() => {}); });
      await Promise.resolve(); client.abort();
      const result = await active;
      assert.equal(signal.aborted, true); assert.equal(budget.reason, "cancelled");
      assert.equal(result.ok, false); assert.equal(budget.message, "Przerwane przez użytkownika");
      let later = false;
      await budget.runTool("notatki", "two", () => { later = true; return { ok: true }; });
      assert.equal(later, false); assert.equal(budget.toolCalls, 1);
    } finally { budget.dispose(); }
  });

  await t.test("Abort podczas oczekiwania na model domyka stream bez kolejnej generacji", async t => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => { calls++; return new Promise(() => {}); });
    const client = new AbortController();
    const request = new Request("http://localhost/api/agent", { signal: client.signal });
    const response = await chatResponse(request, { messages: [user] }, "offline-only", "test/model");
    const result = response.text();
    await new Promise(resolve => setImmediate(resolve));
    client.abort();
    const text = await result;
    const chunks = text.split("\n").filter(line => line.startsWith("data: {")).map(line => JSON.parse(line.slice(6)));
    const meta = chunks.find(chunk => chunk.type === "finish").messageMetadata;
    assert.equal(calls, 1); assert.equal(meta.stopReason, "cancelled"); assert.equal(meta.stopMessage, "Przerwane przez użytkownika");
    assert.equal(chunks.some(chunk => chunk.type === "error"), false);
  });
});

import assert from "node:assert/strict";
import test from "node:test";
import { loadApp } from "./app-fixture.mjs";

test("Budżet zadania — bez modeli i zewnętrznych API", async t => {
  const app = await loadApp(t);
  const { TaskBudget } = await app("lib/task-budget.ts");
  const { chatResponse } = await app("lib/agent-chat.ts");
  const { sessionNotes } = await app("lib/session-notes.ts");
  const { createSession } = await app("lib/session.ts");
  process.env.NODE_ENV = "test"; process.env.CHAT_PASSWORD = "offline-only";
  process.env.SESSION_SECRET = "offline-secret-".repeat(4);
  process.env.OPENROUTER_API_KEY = "offline-only"; process.env.OPENROUTER_MODEL = "test/model";
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Sieć wyłączona"); });
  const req = () => new Request("http://localhost/api/agent", { method: "POST", headers: { Cookie: `chat-session=${createSession()}` } });
  const body = { messages: [{ id: "q", role: "user", parts: [{ type: "text", text: "Zadanie testowe." }] }] };
  const events = value => value.split("\n").filter(line => line.startsWith("data: {")).map(line => JSON.parse(line.slice(6)));
  const response = chunks => new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
  const toolCall = (id, input, name = "kalkulator", index = 0) => ({ index, id, type: "function", function: { name, arguments: JSON.stringify(input) } });
  const generation = (calls, annotations) => ({ id: "test", model: "test/model", choices: [{ index: 0, delta: { role: "assistant", tool_calls: calls, ...(annotations ? { annotations } : {}) }, finish_reason: "tool_calls" }] });

  await t.test("16 rzeczywistych wykonań, siedemnaste blokowane; budżet nowego zadania niezależny", async () => {
    const budget = new TaskBudget(); let executions = 0;
    try {
      for (let i = 0; i < 16; i++) assert.equal((await budget.runTool("kalkulator", String(i), async () => { executions++; return { ok: true, wynik: i }; })).ok, true);
      assert.equal((await budget.runTool("kalkulator", "17", async () => { executions++; return { ok: true }; })).ok, false);
      assert.equal(executions, 16); assert.equal(budget.metadata().toolCalls, 16); assert.equal(budget.reason, "tool_limit");
      const next = new TaskBudget(); try { assert.equal((await next.runTool("czas", "one", async () => ({ ok: true }))).ok, true); assert.equal(next.metadata().toolCalls, 1); } finally { next.dispose(); }
    } finally { budget.dispose(); }
  });

  await t.test("Rezerwacja native search i kilka źródeł liczone raz na krok; łącznie najwyżej 16", async () => {
    const budget = new TaskBudget();
    try {
      budget.beginStep(0, true);
      for (let i = 0; i < 15; i++) await budget.runTool("czas", String(i), async () => ({ ok: true }));
      budget.nativeSearchUsed(); budget.nativeSearchUsed();
      assert.equal(budget.toolCalls, 16);
      let started = false;
      await budget.runTool("czas", "17", async () => { started = true; return { ok: true }; });
      assert.equal(started, false); assert.equal(budget.toolCalls, 16);
    } finally { budget.dispose(); }
  });

  await t.test("10 sekund obejmuje całe narzędzie, także API ignorujące sygnał; dokładny komunikat", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const budget = new TaskBudget(); let receivedSignal;
    try {
      const pending = budget.runTool("pogoda", "slow", signal => { receivedSignal = signal; return new Promise(() => {}); });
      await Promise.resolve(); t.mock.timers.tick(9999); assert.equal(budget.reason, undefined);
      t.mock.timers.tick(1);
      const result = await pending;
      assert.equal(result.ok, false); assert.equal(result.message, "źródło nie odpowiada");
      assert.equal(receivedSignal.aborted, true); assert.equal(budget.reason, "tool_error"); assert.equal(budget.toolCalls, 1);
      let repeated = false;
      await budget.runTool("pogoda", "retry", async () => { repeated = true; }); assert.equal(repeated, false);
    } finally { budget.dispose(); }
  });

  await t.test("60 sekund kończy całe zadanie nawet przy ignorowanym abort; bez dalszych narzędzi", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const budget = new TaskBudget();
    try {
      const pending = assert.rejects(budget.waitFor(new Promise(() => {})));
      t.mock.timers.tick(59999); assert.equal(budget.signal.aborted, false);
      t.mock.timers.tick(1); await pending;
      assert.equal(budget.reason, "time_limit"); assert.equal(budget.signal.aborted, true);
      let called = false;
      await budget.runTool("notatki", "late", () => { called = true; }); assert.equal(called, false);
    } finally { budget.dispose(); }
  });

  await t.test("Błąd w grupie narzędzi: zachowany wcześniejszy wynik, brak powtórki i brak późniejszych efektów", async t => {
    let modelCalls = 0;
    const request = req();
    t.mock.method(globalThis, "fetch", async () => {
      modelCalls++;
      return response([generation([
        toolCall("good", { dzialanie: "dodaj", a: 2, b: 3 }, "kalkulator", 0),
        toolCall("bad", { dzialanie: "podziel", a: 1, b: 0 }, "kalkulator", 1),
        toolCall("later", { operacja: "zapisz", tresc: "Nie wolno zapisać." }, "notatki", 2),
      ])]);
    });
    const output = events(await (await chatResponse(request, body, "offline-only", "test/model")).text());
    const meta = output.find(chunk => chunk.type === "finish").messageMetadata;
    assert.equal(modelCalls, 1); assert.equal(meta.stopReason, "tool_error"); assert.equal(meta.toolCalls, 2);
    assert.equal(meta.modelSteps, 1); assert.ok(meta.partialFindings.some(line => line.includes("wynik=5")));
    assert.match(meta.toolFailures[0].message, /dzielić przez zero/); assert.ok(meta.blockedToolCallIds.includes("later"));
    assert.equal(sessionNotes(request)({ operacja: "pokaz" }).notatki.length, 0);
    assert.ok(meta.durationMs >= 0 && Number.isFinite(meta.durationMs));
    assert.equal(output.some(chunk => chunk.type === "error"), false);
  });

  await t.test("Native search plus duża grupa narzędzi: twardy limit i brak następnej generacji", async t => {
    let modelCalls = 0;
    t.mock.method(globalThis, "fetch", async () => {
      modelCalls++;
      const annotations = [{ type: "url_citation", url_citation: { url: `https://example.com/${modelCalls}`, title: "Źródło testowe" } }];
      return response([generation(Array.from({ length: 8 }, (_, index) => toolCall(`batch-${modelCalls}-${index}`, { dzialanie: "dodaj", a: 2, b: 3 }, "kalkulator", index)), annotations)]);
    });
    const output = events(await (await chatResponse(req(), body, "offline-only", "test/model")).text());
    const meta = output.find(chunk => chunk.type === "finish").messageMetadata;
    assert.equal(modelCalls, 2); assert.equal(meta.stopReason, "tool_limit"); assert.equal(meta.toolCalls, 16);
    assert.equal(meta.modelSteps, 2); assert.ok(meta.partialFindings.length);
    assert.ok(meta.blockedToolCallIds.length >= 1);
  });

  await t.test("Globalny timeout domyka UI ze statystykami, gdy dostawca wcale nie odpowiada", async t => {
    t.mock.method(globalThis, "fetch", async () => new Promise(() => {}));
    const request = req(), budget = new TaskBudget(request.signal, { steps: 6, tools: 16, taskMs: 25, toolMs: 1000 });
    const output = events(await (await chatResponse(request, body, "offline-only", "test/model", budget)).text());
    const meta = output.find(chunk => chunk.type === "finish").messageMetadata;
    assert.equal(meta.stopReason, "time_limit"); assert.equal(meta.modelSteps, 1); assert.equal(meta.toolCalls, 0); assert.ok(meta.durationMs >= 20);
    assert.equal(output.some(chunk => chunk.type === "error"), false);
  });

  await t.test("Timeout narzędzia i niedokończonego streamu native kończy się czytelnym wynikiem", async t => {
    let mode = "tool";
    t.mock.method(globalThis, "fetch", async url => {
      if (new URL(url).hostname === "api.open-meteo.com") return new Promise(() => {});
      if (mode === "native") return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ id: "partial", model: "test/model", choices: [{ index: 0, delta: { role: "assistant", content: "Część odpowiedzi." }, finish_reason: null }] })}\n\n`));
      } }), { headers: { "Content-Type": "text/event-stream" } });
      return response([generation([toolCall("rain", { latitude: 52, longitude: 21, days: 1 }, "opadyDlaOgrodnika")])]);
    });
    for (const kind of ["tool", "native"]) {
      mode = kind;
      const request = req(), budget = new TaskBudget(request.signal, { steps: 6, tools: 16, taskMs: 1000, toolMs: 25 });
      const text = await (await chatResponse(request, body, "offline-only", "test/model", budget)).text();
      const output = events(text), meta = output.find(chunk => chunk.type === "finish").messageMetadata;
      assert.equal(meta.stopReason, "tool_error"); assert.ok(meta.toolFailures.some(failure => failure.message.includes("źródło nie odpowiada")));
      if (kind === "native") assert.ok(text.includes("Część odpowiedzi."));
      else assert.equal(meta.toolCalls, 1);
      assert.ok(meta.durationMs < 1000);
    }
  });

  await t.test("Błąd dostawcy po wykonanym kroku zachowuje wynik i liczniki", async t => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => {
      calls++;
      if (calls === 2) return new Response("provider private details", { status: 503 });
      return response([generation([toolCall("calc", { dzialanie: "dodaj", a: 2, b: 3 })])]);
    });
    const text = await (await chatResponse(req(), body, "offline-only", "test/model")).text();
    const meta = events(text).find(chunk => chunk.type === "finish").messageMetadata;
    assert.equal(calls, 2); assert.equal(meta.stopReason, "provider_error"); assert.equal(meta.modelSteps, 2); assert.equal(meta.toolCalls, 1);
    assert.ok(meta.partialFindings.some(line => line.includes("wynik=5"))); assert.equal(text.includes("provider private details"), false);
  });
});

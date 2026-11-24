import assert from "node:assert/strict";
import test from "node:test";
import { loadApp } from "./app-fixture.mjs";

test("Budżet zadania — bez modeli i zewnętrznych API", async t => {
  const app = await loadApp(t);
  const { TaskBudget, boundedModelFetch } = await app("lib/task-budget.ts");
  const { chatResponse } = await app("lib/agent-chat.ts");
  const { sessionNotes } = await app("lib/session-notes.ts");
  const { createTestSession } = await app("lib/auth.ts");
  process.env.NODE_ENV = "test";

  process.env.OPENROUTER_API_KEY = "offline-only"; process.env.OPENROUTER_MODEL = "test/model";
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Sieć wyłączona"); });
  const req = () => new Request("http://localhost/api/agent", { method: "POST", headers: { Cookie: `chat-session=${createTestSession()}` } });
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
    assert.equal((await sessionNotes(request)({ operacja: "pokaz" })).notatki.length, 0);
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

  await t.test("Timeout narzędzia i zatrzymanego streamu mają różne komunikaty i zachowują część odpowiedzi", async t => {
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
      const request = req(), budget = new TaskBudget(request.signal, { steps: 6, tools: 16, taskMs: 1000, toolMs: 25, modelIdleMs: 25 });
      const text = await (await chatResponse(request, body, "offline-only", "test/model", budget)).text();
      const output = events(text), meta = output.find(chunk => chunk.type === "finish").messageMetadata;
      if (kind === "native") {
        assert.equal(meta.stopReason, "provider_error"); assert.ok(meta.stopMessage.includes("OPENROUTER_IDLE_TIMEOUT"));
        assert.ok(text.includes("Część odpowiedzi.")); assert.equal(meta.toolFailures, undefined);
      } else {
        assert.equal(meta.stopReason, "tool_error"); assert.ok(meta.toolFailures.some(failure => failure.message.includes("źródło nie odpowiada")));
        assert.equal(meta.toolCalls, 1);
      }
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
    assert.ok(meta.stopMessage.includes("OPENROUTER_HTTP_503"));
  });

  await t.test("Model z dostępnym native search odpowiada po 12 s bez limitu narzędzia 10 s", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    t.mock.method(globalThis, "fetch", () => new Promise(resolve => setTimeout(() => resolve(new Response("Gotowe")), 12_000)));
    const budget = new TaskBudget();
    budget.beginStep(0, true);
    try {
      const pending = boundedModelFetch("https://model.test", {}, budget).then(response => response.text());
      t.mock.timers.tick(10_001); assert.equal(budget.reason, undefined);
      t.mock.timers.tick(1999); assert.equal(await pending, "Gotowe");
      assert.equal(budget.reason, undefined); assert.equal(budget.toolCalls, 0);
    } finally { budget.dispose(); }
  });

  await t.test("45 s na pierwsze dane, także gdy nagłówki już dotarły; anulowanie streamu i brak błędu narzędzia", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let cancelled = false;
    t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({ cancel() { cancelled = true; } })));
    const budget = new TaskBudget();
    try {
      const response = await boundedModelFetch("https://model.test", {}, budget);
      const pending = assert.rejects(response.text());
      t.mock.timers.tick(44_999); assert.equal(budget.reason, undefined);
      t.mock.timers.tick(1); await pending;
      assert.equal(budget.reason, "provider_error"); assert.ok(budget.message.includes("OPENROUTER_FIRST_TIMEOUT"));
      assert.equal(cancelled, true); assert.equal(budget.failures.length, 0);
    } finally { budget.dispose(); }
  });

  await t.test("Nowy fragment odnawia limit ciszy; pełny stream może trwać ponad 45 s", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let upstream;
    t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({ start(controller) { upstream = controller; } })));
    const budget = new TaskBudget();
    const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
    try {
      const response = await boundedModelFetch("https://model.test", {}, budget);
      const pending = response.text();
      t.mock.timers.tick(30_000);
      upstream.enqueue(new TextEncoder().encode("Pierwsza ")); await flush();
      t.mock.timers.tick(19_999); assert.equal(budget.reason, undefined);
      upstream.enqueue(new TextEncoder().encode("druga.")); await flush();
      t.mock.timers.tick(5000); assert.equal(budget.reason, undefined);
      upstream.close(); assert.equal(await pending, "Pierwsza druga.");
      t.mock.timers.tick(5000); assert.equal(budget.reason, undefined);
    } finally { budget.dispose(); }
  });

  await t.test("Keep-alive nie wydłuża całego zadania ponad 60 s", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let upstream;
    t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({ start(controller) { upstream = controller; } })));
    const budget = new TaskBudget();
    try {
      const response = await boundedModelFetch("https://model.test", {}, budget);
      const pending = assert.rejects(response.text());
      for (let i = 0; i < 5; i++) {
        t.mock.timers.tick(10_000); upstream.enqueue(new TextEncoder().encode(": keep-alive\n\n"));
        for (let n = 0; n < 15; n++) await Promise.resolve();
      }
      t.mock.timers.tick(10_000); await pending;
      assert.equal(budget.reason, "time_limit"); assert.equal(budget.signal.aborted, true);
    } finally { budget.dispose(); }
  });

  await t.test("HTTP 401/402/429/502/503 mają bezpieczne kody, bez ponowień i ujawniania body", async t => {
    for (const status of [401, 402, 429, 502, 503]) {
      let calls = 0;
      t.mock.method(globalThis, "fetch", async () => { calls++; return new Response("PRIVATE_PROVIDER_SECRET", { status }); });
      const output = events(await (await chatResponse(req(), body, "offline-only", "test/model")).text());
      const meta = output.find(chunk => chunk.type === "finish").messageMetadata;
      assert.equal(calls, 1); assert.equal(meta.stopReason, "provider_error");
      assert.ok(meta.stopMessage.includes(`OPENROUTER_HTTP_${status}`));
      assert.ok(!JSON.stringify(output).includes("PRIVATE_PROVIDER_SECRET"));
    }
  });

  await t.test("Błąd połączenia jest odróżniony od błędu narzędzia i nie ujawnia surowej treści", async t => {
    t.mock.method(globalThis, "fetch", async () => { throw new Error("PRIVATE_NETWORK_DETAILS"); });
    const output = events(await (await chatResponse(req(), body, "offline-only", "test/model")).text());
    const meta = output.find(chunk => chunk.type === "finish").messageMetadata;
    assert.equal(meta.stopReason, "provider_error"); assert.ok(meta.stopMessage.includes("OPENROUTER_CONNECTION"));
    assert.equal(meta.toolFailures, undefined); assert.ok(!JSON.stringify(output).includes("PRIVATE_NETWORK_DETAILS"));
  });

  await t.test("Błąd zgłoszony w HTTP 200 podczas streamingu zachowuje tekst i bezpieczny kod", async t => {
    t.mock.method(globalThis, "fetch", async () => response([
      { id: "partial", model: "test/model", choices: [{ index: 0, delta: { role: "assistant", content: "Odebrany fragment." }, finish_reason: null }] },
      { error: { code: 429, message: "PRIVATE_STREAM_ERROR" } },
    ]));
    const text = await (await chatResponse(req(), body, "offline-only", "test/model")).text();
    const meta = events(text).find(chunk => chunk.type === "finish").messageMetadata;
    assert.equal(meta.stopReason, "provider_error"); assert.ok(text.includes("Odebrany fragment."));
    assert.ok(meta.stopMessage.includes("OPENROUTER_HTTP_429"));
    assert.ok(!text.includes("PRIVATE_STREAM_ERROR"));
  });
});

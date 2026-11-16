import assert from "node:assert/strict";
import test from "node:test";
import { loadApp } from "./app-fixture.mjs";

test("ReAct: skonfigurowany limit i podsumowanie bez dodatkowej generacji", async t => {
  const app = await loadApp(t);
  const { AGENT_STEP_LIMIT } = await app("lib/tool-catalog.ts");
  const { POST } = await app("app/api/agent/route.ts");
  const { createSession } = await app("lib/session.ts");
  const { chatToolSteps } = await app("lib/used-chat-tools.ts");
  const { toolFinding } = await app("lib/tool-findings.ts");
  process.env.NODE_ENV = "test";
  process.env.CHAT_PASSWORD = "offline-password";
  process.env.SESSION_SECRET = "offline-session-secret-".repeat(4);
  process.env.OPENROUTER_API_KEY = "offline-api-key";
  process.env.OPENROUTER_MODEL = "test/model";
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Sieć wyłączona w testach"); });
  const req = () => new Request("http://localhost/api/agent", { method: "POST", headers: {
    Host: "localhost", Origin: "http://localhost", Cookie: `chat-session=${createSession()}`, "Content-Type": "application/json",
  }, body: JSON.stringify({ mode: "chat", messages: [{ id: "q", role: "user", parts: [{ type: "text", text: "Wykonaj zadanie w kilku krokach." }] }] }) });
  const events = stream => stream.split("\n").filter(line => line.startsWith("data: {")).map(line => JSON.parse(line.slice(6)));
  const response = chunks => new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });

  await t.test("Kolejny krok otrzymuje poprzedni wynik; brak wywołania ponad limit i niepuste podsumowanie", async t => {
    const previousLimit = process.env.AGENT_MAX_STEPS;
    process.env.AGENT_MAX_STEPS = "3";
    t.after(() => { if (previousLimit === undefined) delete process.env.AGENT_MAX_STEPS; else process.env.AGENT_MAX_STEPS = previousLimit; });
    const limit = 3;
    let calls = 0;
    t.mock.method(globalThis, "fetch", async (url, init) => {
      assert.equal(String(url), "https://openrouter.ai/api/v1/chat/completions"); calls++;
      assert.ok(calls <= limit, "Przekroczono limit kroków!");
      const body = JSON.parse(init.body);
      let a = 1;
      if (calls > 1) {
        const content = body.messages.filter(message => message.role === "tool").at(-1).content;
        const output = JSON.parse(Array.isArray(content) ? content.map(part => part.text || "").join("") : content);
        assert.equal(output.ok, true); assert.equal(output.wynik, calls); a = output.wynik;
      }
      return response([{ id: "chain", model: "test/model", choices: [{ index: 0, delta: { role: "assistant",
        tool_calls: [{ index: 0, id: `calc-${calls}`, type: "function", function: { name: "kalkulator", arguments: JSON.stringify({ dzialanie: "dodaj", a, b: 1 }) } }] }, finish_reason: "tool_calls" }] }]);
    });
    const output = events(await (await POST(req())).text());
    assert.equal(calls, limit); assert.equal(output.filter(event => event.type === "start-step").length, limit);
    assert.equal(output.some(event => event.type === "error"), false);
    const meta = output.find(event => event.type === "finish").messageMetadata;
    assert.equal(meta.stepLimitReached, true); assert.equal(meta.stepsCompleted, limit);
    assert.equal(meta.stepLimit, limit);
    assert.equal(meta.partialFindings.length, limit);
    assert.ok(meta.partialFindings.some(line => line.includes(`wynik=${limit + 1}`)));
  });

  await t.test("Limit z env: poprawne liczby oraz domyślne 6 dla błędnej konfiguracji", async t => {
    const { getAgentStepLimit } = await app("lib/agent-config.ts");
    const { workshopTools } = await app("lib/workshop-tools.ts");
    const previousLimit = process.env.AGENT_MAX_STEPS;
    t.after(() => { if (previousLimit === undefined) delete process.env.AGENT_MAX_STEPS; else process.env.AGENT_MAX_STEPS = previousLimit; });
    for (const value of ["", "0", "-1", "2.5", "NaN", "Infinity", "abc", "9007199254740992"]) {
      process.env.AGENT_MAX_STEPS = value;
      assert.equal(getAgentStepLimit(), AGENT_STEP_LIMIT);
    }
    delete process.env.AGENT_MAX_STEPS;
    assert.equal(getAgentStepLimit(), AGENT_STEP_LIMIT);
    for (const limit of [1, 3, 10]) {
      process.env.AGENT_MAX_STEPS = ` ${limit} `;
      assert.equal(getAgentStepLimit(), limit);
      const tools = workshopTools(req(), "test/model", () => []);
      assert.equal((await tools.diagnostyka.execute({}, {})).limitKrokow, limit);
    }
  });

  await t.test("Pierwszy błąd narzędzia kończy zadanie bez powtarzania wywołania", async t => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => {
      calls++;
      return response([{ id: "fail", model: "test/model", choices: [{ index: 0, delta: { role: "assistant",
        tool_calls: [{ index: 0, id: `divide-${calls}`, type: "function", function: { name: "kalkulator", arguments: '{"dzialanie":"podziel","a":1,"b":0}' } }] }, finish_reason: "tool_calls" }] }]);
    });
    const output = events(await (await POST(req())).text()); const meta = output.find(event => event.type === "finish").messageMetadata;
    assert.equal(calls, 1); assert.equal(meta.stepLimitReached, false);
    assert.equal(meta.stopReason, "tool_error"); assert.equal(meta.toolCalls, 1);
    assert.equal(meta.partialFindings.length, 0);
    assert.ok(meta.toolFailures[0].message.includes("dzielić przez zero"));
  });

  await t.test("Normalna odpowiedź kończy się wcześniej, bez sztucznego limitu i streszczenia", async t => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => { calls++; return response([{ id: "plain", model: "test/model", choices: [{ index: 0, delta: { role: "assistant", content: "Gotowe." }, finish_reason: "stop" }] }]); });
    const output = events(await (await POST(req())).text()); const meta = output.find(event => event.type === "finish").messageMetadata;
    assert.equal(calls, 1); assert.equal(meta.stepLimitReached, false); assert.equal(meta.partialFindings, undefined);
  });

  await t.test("Notatki: obiekt parametrów, zapis i odczyt przez pełną pętlę SDK", async t => {
    let calls = 0;
    const note = "Koszt 4 konsultacji: 600 PLN.";
    t.mock.method(globalThis, "fetch", async (_url, init) => {
      calls++;
      const body = JSON.parse(init.body);
      const schema = body.tools.find(tool => tool.function?.name === "notatki").function.parameters;
      assert.equal(schema.type, "object");
      assert.equal(schema.oneOf, undefined);
      assert.equal(schema.anyOf, undefined);
      if (calls > 1) {
        const output = JSON.parse(body.messages.filter(message => message.role === "tool").at(-1).content);
        assert.equal(output.ok, true);
        if (calls === 2) assert.equal(output.notatka.tresc, note);
        else assert.equal(output.notatki[0].tresc, note);
      }
      const delta = calls <= 2 ? { role: "assistant", tool_calls: [{ index: 0, id: `note-${calls}`, type: "function",
        function: { name: "notatki", arguments: JSON.stringify(calls === 1 ? { operacja: "zapisz", tresc: note } : { operacja: "pokaz" }) } }] }
        : { role: "assistant", content: "Zapisano i odczytano notatkę w bieżącej sesji." };
      return response([{ id: "notes", model: "test/model", choices: [{ index: 0, delta, finish_reason: calls <= 2 ? "tool_calls" : "stop" }] }]);
    });
    const output = events(await (await POST(req())).text());
    assert.equal(calls, 3);
    assert.equal(output.filter(event => event.type === "tool-output-available").length, 2);
    assert.equal(output.find(event => event.type === "finish").messageMetadata.stopReason, undefined);
  });

  await t.test("Notatki: błędne argumenty dają konkretną przyczynę bez zapisu i ponawiania", async t => {
    for (const [input, expected] of [
      [{ operacja: "zapisz" }, /wymaga pola tresc/],
      [{ operacja: "zapisz", tresc: "x".repeat(1001) }, /najwyżej 1000/],
      [{ operacja: "pokaz", tresc: "Nie zapisuj" }, /nie przyjmuje pola tresc/],
      [{ operacja: "zapis", tresc: "Nie zapisuj" }, /operacja musi/],
      [{ operacja: "zapisz", tresc: "Nie zapisuj", sessionId: "SECRET_VALUE" }, /Dozwolone pola/],
    ]) {
      let calls = 0;
      t.mock.method(globalThis, "fetch", async () => {
        calls++;
        return response([{ id: "bad-note", model: "test/model", choices: [{ index: 0, delta: { role: "assistant",
          tool_calls: [{ index: 0, id: "bad-note", type: "function", function: { name: "notatki", arguments: JSON.stringify(input) } }] }, finish_reason: "tool_calls" }] }]);
      });
      const output = events(await (await POST(req())).text());
      const meta = output.find(event => event.type === "finish").messageMetadata;
      assert.equal(calls, 1);
      assert.equal(meta.stopReason, "tool_error");
      assert.equal(meta.toolCalls, 0);
      assert.match(meta.toolFailures[0].message, expected);
      assert.equal(JSON.stringify(meta).includes("SECRET_VALUE"), false);
      assert.equal(output.some(event => event.type === "tool-output-available"), false);
    }
  });

  await t.test("Numery kroków: kilka narzędzi w jednym kroku, krok tekstowy, powtórzenia i źródła", () => {
    const call = (name, id) => ({ type: `tool-${name}`, toolCallId: id, state: "output-available", input: {}, output: {} });
    const first = call("pogoda", "p1"), second = call("waluty", "w1");
    const steps = chatToolSteps({ id: "a", role: "assistant", parts: [
      { type: "step-start" }, { type: "text", text: "Krótka informacja." },
      { type: "step-start" }, first, second, first,
      { type: "step-start" }, call("kalkulator", "k1"),
      { type: "step-start" }, call("pogoda", "p2"),
      { type: "step-start" }, { type: "source-url", sourceId: "s", url: "https://example.com/" }, call("webSearch", "s1"),
    ] });
    assert.deepEqual(steps.map(step => ({ step: step.step, tools: step.tools.map(tool => tool.name) })), [
      { step: 2, tools: ["pogoda", "waluty"] }, { step: 3, tools: ["kalkulator"] }, { step: 4, tools: ["pogoda"] }, { step: 5, tools: ["webSearch"] },
    ]);
  });

  await t.test("Podsumowanie nie zawiera plików, nieznanych pól i wartości sekretów", () => {
    assert.equal(toolFinding("generujObraz", { ok: true, dataUrl: "data:image/png;base64,SECRET" }).includes("base64"), false);
    assert.equal(toolFinding("odpowiedzPoPolsku", { ok: true, audioUrl: "data:audio/mpeg;base64,SECRET" }).includes("base64"), false);
    const finding = toolFinding("diagnostyka", { ok: true, skonfigurowanyModel: "test/model", limitKrokow: 6, narzedzia: ["czas"], wymaganeZmienne: { OPENROUTER_API_KEY: "RAW_SECRET_VALUE", SESSION_SECRET: "tak" }, extra: "RAW_SECRET_VALUE" });
    assert.ok(!finding.includes("RAW_SECRET_VALUE"));
    assert.ok(toolFinding("pogoda", { ok: false, message: "Brak prognozy." }).startsWith("Błąd"));
    assert.equal(toolFinding("unknown", { secret: "RAW_SECRET_VALUE" }), null);
    assert.ok(toolFinding("notatki", { ok: true, notatki: [{ tresc: "x".repeat(10000) }], uwaga: "Pamięć tymczasowa." }).length <= 800);
  });
});

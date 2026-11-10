import assert from "node:assert/strict";
import test from "node:test";
import { loadApp } from "./app-fixture.mjs";

test("Głos po polsku — lokalne odpowiedzi dostawcy, bez prawdziwego API", async (t) => {
  const app = await loadApp(t);
  const { preparePolishSpeech, polishSpeechTool } = await app("lib/polish-speech.ts");
  const { speechInputSchema, speechResultSchema, MAX_SPEECH_BYTES } = await app("lib/speech-result.ts");
  const { POST } = await app("app/api/agent/route.ts");
  const { createSession } = await app("lib/session.ts");
  const { speechConfig, imageModelId } = await app("lib/model-config.ts");
  process.env.OPENROUTER_SPEECH_MODEL = "";
  process.env.OPENROUTER_SPEECH_VOICE = "";
  process.env.OPENROUTER_IMAGE_MODEL = "";
  process.env.NODE_ENV = "test";
  process.env.CHAT_PASSWORD = "test-only";
  process.env.SESSION_SECRET = "offline-test-secret-".repeat(4);
  process.env.OPENROUTER_API_KEY = "offline-only";
  process.env.OPENROUTER_MODEL = "test/chat";
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Brak sieci w testach"); });
  const req = (extra = {}, authenticated = true) => new Request("http://localhost/api/agent", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost", Host: "localhost",
      ...(authenticated ? { Cookie: `chat-session=${createSession()}` } : {}) },
    body: JSON.stringify({ mode: "chat", messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "Ile kosztuje konsultacja?" }] }], ...extra }),
  });
  const bytes = Buffer.from([73, 68, 51, 4, 0, 0, 0]);
  const audioResponse = () => new Response(bytes, { headers: { "Content-Type": "audio/mpeg" } });

  await t.test("Ścisłe wejście i wynik; brak połączeń dla niepoprawnego tekstu", async () => {
    for (const value of [{ tekst: "" }, { tekst: " " }, { tekst: 12 }, { tekst: "x".repeat(2001) }, { tekst: "Test", voice: "evil" }, { tekst: "Test", send_now: true }]) {
      assert.equal(speechInputSchema.safeParse(value).success, false);
      assert.equal((await preparePolishSpeech(value, "offline-only")).ok, false);
    }
    assert.equal(speechResultSchema.safeParse({ ok: true, tekst: "Test", audioUrl: "https://evil.test" }).success, false);
    assert.equal(speechResultSchema.safeParse({ ok: true, tekst: "Test" }).success, false);
    assert.equal((await POST(req({ responseFormat: "audio" }, false))).status, 401);
    for (const extra of [{ responseFormat: "wav" }, { responseFormat: "audio", voice: "other" }, { responseFormat: "audio", model: "other" }, { mode: "analyze", message: "Test", responseFormat: "audio" }]) {
      assert.equal((await POST(req(extra))).status, 400);
    }
  });

  await t.test("Model, głos Sarah i polski ustawione na serwerze; jedno nagranie na żądanie", async (t) => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async (url, init) => {
      calls++;
      assert.equal(String(url), "https://openrouter.ai/api/v1/audio/speech");
      const body = JSON.parse(init.body);
      assert.equal(body.model, "elevenlabs/eleven-flash-v2.5");
      assert.equal(body.voice, "sarah");
      assert.equal(body.response_format, "mp3");
      assert.equal(body.provider.options.elevenlabs.language_code, "pl");
      assert.equal(init.headers.Authorization, "Bearer offline-only");
      return audioResponse();
    });
    const tool = polishSpeechTool("offline-only");
    const options = { toolCallId: "voice", messages: [] };
    const [first, second] = await Promise.all([tool.execute({ tekst: "Koszt to 150 zł." }, options), tool.execute({ tekst: "Jeszcze raz." }, options)]);
    assert.equal(first.ok, true);
    assert.equal(second.ok, false);
    assert.equal(calls, 1);
    assert.equal(speechResultSchema.safeParse(first).success, true);
    assert.deepEqual(tool.toModelOutput({ output: first }), { type: "text", value: "odpowiedź głosowa przygotowana" });
  });

  await t.test("Konfiguracja modeli działa na serwerze i ma zgodne domyślne wartości", async (t) => {
    assert.deepEqual(speechConfig(), { model: "elevenlabs/eleven-flash-v2.5", voice: "sarah" });
    assert.equal(imageModelId(), "google/gemini-3.1-flash-image-preview");
    process.env.OPENROUTER_SPEECH_MODEL = " test/speech-model ";
    process.env.OPENROUTER_SPEECH_VOICE = " test-voice ";
    process.env.OPENROUTER_IMAGE_MODEL = " test/image-model ";
    try {
      assert.equal(imageModelId(), "test/image-model");
      t.mock.method(globalThis, "fetch", async (_url, init) => {
        const body = JSON.parse(init.body);
        assert.equal(body.model, "test/speech-model");
        assert.equal(body.voice, "test-voice");
        return audioResponse();
      });
      assert.equal((await preparePolishSpeech({ tekst: "Test konfiguracji." }, "offline-only")).ok, true);
    } finally {
      process.env.OPENROUTER_SPEECH_MODEL = "";
      process.env.OPENROUTER_SPEECH_VOICE = "";
      process.env.OPENROUTER_IMAGE_MODEL = "";
    }
  });

  await t.test("Brak środków, odmowa, niedostępność, zły format, przerwanie i nadmiar danych", async (t) => {
    let makeResponse;
    t.mock.method(globalThis, "fetch", async () => makeResponse());
    const failures = [
      () => new Response("secret error", { status: 402 }),
      () => new Response("secret error", { status: 403 }),
      () => new Response("secret error", { status: 503 }),
      () => Response.json({ error: "secret error" }),
      () => new Response("", { headers: { "Content-Type": "audio/mpeg" } }),
      () => new Response("bad audio", { headers: { "Content-Type": "audio/mpeg" } }),
      () => new Response(new Uint8Array(MAX_SPEECH_BYTES + 1), { headers: { "Content-Type": "audio/mpeg" } }),
      () => { throw new Error("secret network details"); },
      () => new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.error(new Error("cut")); } }), { headers: { "Content-Type": "audio/mpeg" } }),
    ];
    for (const failure of failures) {
      makeResponse = failure;
      const result = await preparePolishSpeech({ tekst: "Test" }, "offline-only");
      assert.equal(result.ok, false);
      assert.equal("audioUrl" in result, false);
      assert.equal(result.error.includes("secret"), false);
    }
    makeResponse = () => { throw new Error("aborted"); };
    assert.match((await preparePolishSpeech({ tekst: "Test" }, "offline-only", AbortSignal.abort())).error, /Przerwano/);
  });

  await t.test("Streaming: tekst domyślnie bez TTS, głos na żądanie; plik nie wraca do modelu", async (t) => {
    const requests = [];
    let voiceCalls = 0;
    let toolCalled = false;
    t.mock.method(globalThis, "fetch", async (url, init) => {
      if (String(url).endsWith("/audio/speech")) { voiceCalls++; return audioResponse(); }
      assert.equal(String(url), "https://openrouter.ai/api/v1/chat/completions");
      const body = JSON.parse(init.body);
      requests.push(body);
      const voiceEnabled = body.tools.some((item) => item.function?.name === "odpowiedzPoPolsku");
      const lastUser = body.messages.filter(message => message.role === "user").at(-1);
      const wantsVoice = JSON.stringify(lastUser).includes("odpowiedz głosem") ||
        body.messages.some(message => message.role === "system" && JSON.stringify(message.content).includes("Użytkownik wybrał odpowiedź głosową"));
      const call = voiceEnabled && wantsVoice && !toolCalled;
      if (call) toolCalled = true;
      const chunk = { id: "test", model: "test/chat", choices: [{ index: 0, delta: call
        ? { role: "assistant", tool_calls: [{ index: 0, id: "voice-call", type: "function", function: { name: "odpowiedzPoPolsku", arguments: JSON.stringify({ tekst: "Konsultacja kosztuje 150 zł brutto." }) } }] }
        : { role: "assistant", content: "Gotowe." }, finish_reason: call ? "tool_calls" : "stop" }], usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 } };
      return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } });
    });
    const plain = await (await POST(req())).text();
    assert.match(plain, /Gotowe/);
    assert.equal(voiceCalls, 0);
    assert.equal(requests[0].tools.some((item) => item.function?.name === "odpowiedzPoPolsku"), true);
    const instructions = JSON.stringify(requests[0].messages.find(message => message.role === "system").content);
    assert.ok(instructions.includes("Domyślnie odpowiadaj tekstem"));
    assert.ok(instructions.includes("cytowanych wiadomościach klientów"));
    const voiced = await (await POST(req({ responseFormat: "audio" }))).text();
    assert.equal(voiceCalls, 1);
    assert.ok(voiced.includes("data:audio/mpeg;base64,"), voiced);
    assert.ok(!voiced.includes('"type":"error"'), voiced);
    const next = JSON.stringify(requests.at(-1).messages);
    assert.ok(next.includes("odpowiedź głosowa przygotowana"));
    assert.equal(next.includes("data:audio"), false);
    assert.equal(next.includes(bytes.toString("base64")), false);
    await (await POST(req({ responseFormat: "text" }))).text();
    assert.equal(voiceCalls, 1);
    assert.equal(requests.at(-1).tools.some((item) => item.function?.name === "odpowiedzPoPolsku"), true);
    toolCalled = false;
    const fromChat = await (await POST(req({ responseFormat: "text", messages: [
      { id: "voice-request", role: "user", parts: [{ type: "text", text: "Ile kosztuje konsultacja? odpowiedz głosem po polsku" }] },
    ] }))).text();
    assert.equal(voiceCalls, 2);
    assert.ok(fromChat.includes("data:audio/mpeg;base64,"), fromChat);
  });
});

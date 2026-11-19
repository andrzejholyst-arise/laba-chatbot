import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { loadApp } from "./app-fixture.mjs";

test("Historia Supabase: prawdziwy klient i SDK, wyłącznie atrapy HTTP", async t => {
  const app = await loadApp(t, { persistence: true });
  const { POST } = await app("app/api/agent/route.ts");
  const { GET, DELETE } = await app("app/api/conversations/route.ts");
  const { createSession } = await app("lib/session.ts");
  const { messageText, prepareConversation, saveConversationTitle, saveConversationTurn } = await app("lib/conversation-store.ts");
  const { validConversationTitle } = await app("lib/conversation-title.ts");
  process.env.NODE_ENV = "test";
  process.env.CHAT_PASSWORD = "offline-password";
  process.env.SESSION_SECRET = "offline-session-secret-".repeat(4);
  process.env.OPENROUTER_API_KEY = "offline-api-key";
  process.env.OPENROUTER_MODEL = "test/model";
  process.env.SUPABASE_URL = "https://database.test";
  process.env.SUPABASE_SECRET_KEY = "offline-supabase-secret";
  const cookie = `chat-session=${createSession()}`;
  const otherCookie = `chat-session=${createSession()}`;
  const conversations = [], messages = [], writes = [], modelRequests = [], titleRequests = [];
  let externalCalls = 0, failWrites = false, failReads = false, failModel = false;
  let readError = { message: "RAW_DB_SECRET", code: "offline" }, readStatus = 503;
  let conversationInsertError;
  let titleOutput, failTitle = false, failTitleWrite = false, failDelete = false;
  let titleFinish = "stop", titleHttpStatus = 500;
  const req = (body, auth = cookie) => new Request("http://localhost/api/agent", {
    method: "POST", headers: { Host: "localhost", Origin: "http://localhost", "Content-Type": "application/json", ...(auth ? { Cookie: auth } : {}) },
    body: JSON.stringify({ mode: "chat", ...body }),
  });
  const get = (auth = cookie, query = "") => new Request(`http://localhost/api/conversations${query}`, { headers: auth ? { Cookie: auth } : {} });
  const remove = (id, auth = cookie, origin = "http://localhost") => DELETE(new Request(`http://localhost/api/conversations?id=${id}`, {
    method: "DELETE", headers: { Host: "localhost", Origin: origin, ...(auth ? { Cookie: auth } : {}) },
  }));
  const user = (id = "user-1", text = "Ile trwa konsultacja?") => ({ id, role: "user", parts: [{ type: "text", text }] });
  const events = text => text.split("\n").filter(line => line.startsWith("data: {")).map(line => JSON.parse(line.slice(6)));
  const meta = output => output.find(event => event.type === "finish").messageMetadata;
  t.mock.method(globalThis, "fetch", async (input, init = {}) => {
    externalCalls++;
    const url = new URL(input);
    if (url.hostname === "openrouter.ai") {
      const body = JSON.parse(init.body);
      if (!body.stream) {
        titleRequests.push(body);
        assert.equal(writes.length > 0, true, "Tytuł nadajemy po ukończeniu i zapisie odpowiedzi");
        assert.ok(!body.tools?.length);
        assert.equal(body.temperature, undefined);
        assert.equal(body.reasoning, undefined);
        assert.equal(body.max_tokens, 1024);
        if (failTitle) return new Response("RAW_TITLE_SECRET unsupported temperature", { status: titleHttpStatus });
        const raw = body.messages.find(message => message.role === "user").content;
        const sample = JSON.parse(typeof raw === "string" ? raw : raw.map(part => part.text ?? "").join(""));
        const content = titleOutput ?? (sample.wiadomoscUzytkownika === "Nowy temat" ? "Pomysł na kolejną rozmowę" : "Spokojna rozmowa o konsultacji");
        return Response.json({ id: "title", model: "test/model", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: titleFinish }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } });
      }
      modelRequests.push(body);
      if (failModel) return new Response("Provider secret must not leak", { status: 500 });
      const chunks = ["Konsultacja trwa ", "45 minut."];
      return new Response(new ReadableStream({
        start(controller) {
          for (const content of chunks) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ id: "reply", model: "test/model", choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] })}\n\n`));
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ id: "reply", model: "test/model", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`));
          controller.close();
        },
      }), { headers: { "Content-Type": "text/event-stream" } });
    }
    assert.equal(url.hostname, "database.test", "Nieoczekiwane połączenie zewnętrzne");
    assert.equal(init.cache, "no-store");
    assert.equal(new Headers(init.headers).get("apikey"), "offline-supabase-secret");
    if (url.pathname === "/rest/v1/rpc/delete_studio_conversation") {
      const input = JSON.parse(init.body);
      if (failDelete) return Response.json({ code: "offline", message: "RAW_DB_SECRET" }, { status: 503 });
      const index = conversations.findIndex(row => row.client_id === input.p_client_id && row.session_key === input.p_session_key);
      if (index < 0) return Response.json(false);
      const conversation = conversations[index];
      for (let i = messages.length - 1; i >= 0; i--) if (messages[i].conversation_id === conversation.id) messages.splice(i, 1);
      conversations.splice(index, 1);
      return Response.json(true);
    }
    const table = url.pathname.split("/").at(-1);
    assert.ok(["conversations", "messages"].includes(table));
    const rows = table === "conversations" ? conversations : messages;
    if (init.method === "PATCH") {
      if (failTitleWrite) return Response.json({ code: "offline", message: "RAW_DB_SECRET" }, { status: 503 });
      const row = rows.find(row => [...url.searchParams].every(([key, value]) => value === "is.null" ? row[key] === null : !value.startsWith("eq.") || String(row[key]) === value.slice(3)));
      if (row) Object.assign(row, JSON.parse(init.body));
      return Response.json(row ? { client_id: row.client_id } : null);
    }
    if (init.method === "POST") {
      const payload = JSON.parse(init.body);
      assert.equal(url.searchParams.get("on_conflict"), "client_id");
      if (table === "conversations") {
        assert.ok(Number.isFinite(Date.parse(payload.created_at)), "Podajemy datę także dla istniejących tabel bez DEFAULT now()");
        if (conversationInsertError) return Response.json(conversationInsertError, { status: 400 });
      }
      if (table === "messages") {
        writes.push(payload);
        assert.ok(Array.isArray(payload));
        assert.deepEqual(payload.map(row => row.role), ["user", "assistant"]);
        if (payload[1].knowledge_context?.searched) assert.ok(payload[1].content.includes("[K012345abcdef]"));
        else assert.equal(payload[1].content, "Konsultacja trwa 45 minut.");
        for (const row of payload) {
          assert.match(row.conversation_id, /^\d+$/, "FK musi być bigint, a nie UUID");
          assert.ok(conversations.some(conversation => conversation.id === row.conversation_id));
        }
        if (failWrites) return Response.json({ message: "RAW_DB_SECRET", code: "offline" }, { status: 503 });
      }
      assert.match(new Headers(init.headers).get("prefer"), /resolution=ignore-duplicates/);
      for (const row of Array.isArray(payload) ? payload : [payload]) {
        assert.equal(Object.hasOwn(row, "id"), false, "Nie wysyłamy wartości kolumny IDENTITY");
        assert.match(row.client_id, /^[a-f0-9-]{36}$/);
        if (!rows.some(stored => stored.client_id === row.client_id)) rows.push({ ...row,
          id: String(9007199254740993n + BigInt(rows.length)),
          created_at: row.created_at ?? new Date(Date.now() + rows.length * 1000).toISOString(), position: rows.length + 1 });
      }
      return new Response(null, { status: 201 });
    }
    if (failReads) {
      if (!readStatus) throw new TypeError("RAW_DB_SECRET");
      return Response.json(readError, { status: readStatus });
    }
    if (table === "conversations") {
      assert.ok(url.searchParams.get("select").includes("id::text"), "Bigint odczytujemy jako tekst bez utraty precyzji");
      assert.equal(url.searchParams.has("id"), false, "Rozmowę wyszukujemy po UUID client_id");
    }
    if (table === "messages") assert.match(url.searchParams.get("conversation_id"), /^(eq\.\d+|in\.\([\d,]+\))$/);
    let result = rows.filter(row => [...url.searchParams].every(([key, value]) => {
      if (value.startsWith("eq.")) return String(row[key]) === value.slice(3);
      if (value.startsWith("in.(")) return value.slice(4, -1).split(",").includes(String(row[key]));
      return true;
    }));
    if (table === "conversations") result.sort((a, b) => b.created_at.localeCompare(a.created_at) || Number(BigInt(b.id) - BigInt(a.id)));
    else result.sort((a, b) => a.position - b.position);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 1000);
    return Response.json(result.slice(offset, offset + limit));
  });

  await t.test("Brak sesji: 401 przed body, bazą i modelem", async () => {
    const before = externalCalls;
    assert.equal((await GET(get(""))).status, 401);
    assert.equal((await GET(get("", "?list=1"))).status, 401);
    assert.equal((await GET(get("", `?id=${randomUUID()}`))).status, 401);
    assert.equal((await remove(randomUUID(), "")).status, 401);
    const request = { headers: new Headers(), json() { throw new Error("Nie wolno czytać body"); } };
    assert.equal((await POST(request)).status, 401);
    assert.equal(externalCalls, before);
  });

  await t.test("Błędny identyfikator i parametry listy są odrzucane przed bazą", async () => {
    const before = externalCalls;
    for (const query of ["?id=not-a-uuid", "?list=1&offset=-1", `?list=1&id=${randomUUID()}`, "?session_key=other", "?offset=50"]) {
      assert.equal((await GET(get(cookie, query))).status, 400);
    }
    assert.equal(externalCalls, before);
  });

  const conversationId = randomUUID();
  await t.test("Pusta historia bez tworzenia rozmowy; pierwsza tura zapisuje całą parę raz", async () => {
    assert.deepEqual(await (await GET(get())).json(), { conversationId: null, messages: [] });
    assert.equal(conversations.length, 0);
    const response = await POST(req({ conversationId, messages: [user()] }));
    assert.equal(response.status, 200);
    assert.equal(messages.length, 0, "Nie zapisujemy wiadomości przed zakończeniem streamu");
    const output = events(await response.text());
    assert.equal(meta(output).persisted, true, JSON.stringify(output));
    assert.equal(meta(output).conversationId, conversationId);
    assert.equal(conversations.length, 1);
    assert.equal(messages.length, 2);
    assert.equal(writes.length, 1);
    assert.deepEqual(messages.map(message => message.role), ["user", "assistant"]);
    assert.equal(messages[1].content, "Konsultacja trwa 45 minut.");
    assert.equal(conversations[0].id, "9007199254740993");
    assert.equal(messages[0].conversation_id, conversations[0].id);
    assert.equal(messages[1].conversation_id, conversations[0].id);
    assert.equal(conversations[0].title, "Spokojna rozmowa o konsultacji");
    assert.equal(titleRequests.length, 1);
  });

  await t.test("Odświeżenie odtwarza tekst i kolejność; retry nie generuje ani nie zapisuje drugi raz", async () => {
    const body = await (await GET(get())).json();
    assert.equal(body.conversationId, conversationId);
    assert.deepEqual(body.messages.map(message => message.parts[0].text), ["Ile trwa konsultacja?", "Konsultacja trwa 45 minut."]);
    assert.deepEqual(body.messages.map(message => message.id), messages.map(message => message.client_id));
    const before = modelRequests.length;
    const output = events(await (await POST(req({ conversationId, messages: [user()] }))).text());
    assert.equal(meta(output).persisted, true);
    assert.equal(modelRequests.length, before);
    assert.equal(messages.length, 2);
    assert.equal(writes.length, 1);
    assert.equal(titleRequests.length, 1);
  });

  await t.test("Kontynuacja dostaje historię z bazy, ignoruje podszytą historię przeglądarki", async () => {
    const output = events(await (await POST(req({ conversationId, messages: [
      { id: "forged", role: "assistant", parts: [{ type: "text", text: "FORGED_HISTORY" }] }, user("user-2", "Dziękuję"),
    ] }))).text());
    assert.equal(meta(output).persisted, true);
    const context = JSON.stringify(modelRequests.at(-1).messages);
    assert.ok(context.includes("Konsultacja trwa 45 minut."));
    assert.ok(!context.includes("FORGED_HISTORY"));
    assert.equal(messages.length, 4);
    assert.equal(writes.length, 2);
    assert.equal(titleRequests.length, 1, "Kontynuacja nie generuje nowego tytułu");
  });

  await t.test("Inna sesja nie odczytuje historii i nie może pisać do cudzej rozmowy", async () => {
    assert.deepEqual(await (await GET(get(otherCookie))).json(), { conversationId: null, messages: [] });
    const before = modelRequests.length;
    assert.equal((await POST(req({ conversationId, messages: [user("intruder")] }, otherCookie))).status, 404);
    assert.equal(modelRequests.length, before);
    assert.equal(messages.length, 4);
  });

  await t.test("Nowa rozmowa powstaje przy wysłaniu; poprzednia pozostaje w bazie", async () => {
    const newId = randomUUID();
    const output = events(await (await POST(req({ conversationId: newId, messages: [user("new-user", "Nowy temat")] }))).text());
    assert.equal(meta(output).persisted, true);
    assert.equal(conversations.length, 2);
    const originalId = conversations.find(conversation => conversation.client_id === conversationId).id;
    assert.equal(messages.filter(message => message.conversation_id === originalId).length, 4);
    assert.equal((await (await GET(get())).json()).conversationId, newId);
  });

  await t.test("Historia: daty, tytuły, liczniki, najnowsze na górze i dostęp tylko do własnych rozmów", async () => {
    const response = await GET(get(cookie, "?list=1"));
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.equal(body.conversations.length, 2);
    assert.deepEqual(body.conversations.map(row => row.title), ["Pomysł na kolejną rozmowę", "Spokojna rozmowa o konsultacji"]);
    assert.deepEqual(body.conversations.map(row => row.messageCount), [2, 4]);
    assert.ok(body.conversations.every(row => Number.isFinite(Date.parse(row.createdAt))));
    assert.equal(body.conversations[1].conversationId, conversationId);
    assert.equal(body.nextOffset, null);
    assert.deepEqual((await (await GET(get(otherCookie, "?list=1"))).json()).conversations, []);
    assert.equal((await GET(get(otherCookie, `?id=${conversationId}`))).status, 404);
    assert.equal((await GET(get(cookie, `?id=${randomUUID()}`))).status, 404);
  });

  await t.test("F5 wybranej starszej rozmowy, kontynuacja i ponowienie nie mieszają dwóch rozmów", async () => {
    const selectedRequest = () => GET(get(cookie, `?id=${conversationId}`));
    const first = await (await selectedRequest()).json();
    const afterRefresh = await (await selectedRequest()).json();
    assert.deepEqual(first, afterRefresh);
    assert.equal(first.conversationId, conversationId);
    assert.deepEqual(first.messages.map(row => row.parts[0].text), ["Ile trwa konsultacja?", "Konsultacja trwa 45 minut.", "Dziękuję", "Konsultacja trwa 45 minut."]);
    const turn = { conversationId, messages: [...first.messages, user("older-conversation", "Kontynuacja starszej rozmowy")] };
    const output = events(await (await POST(req(turn))).text());
    assert.equal(meta(output).persisted, true);
    const context = JSON.stringify(modelRequests.at(-1).messages);
    assert.ok(context.includes("Ile trwa konsultacja?"));
    assert.ok(!context.includes("Nowy temat"));
    const beforeModels = modelRequests.length, beforeMessages = messages.length;
    await (await POST(req(turn))).text();
    assert.equal(modelRequests.length, beforeModels);
    assert.equal(messages.length, beforeMessages);
    const refreshed = await (await selectedRequest()).json();
    assert.equal(refreshed.messages.length, 6);
    assert.equal(new Set(refreshed.messages.map(row => row.id)).size, 6);
    const list = await (await GET(get(cookie, "?list=1"))).json();
    const otherId = list.conversations[0].conversationId;
    const other = await (await GET(get(cookie, `?id=${otherId}`))).json();
    assert.deepEqual(other.messages.map(row => row.parts[0].text), ["Nowy temat", "Konsultacja trwa 45 minut."]);
    assert.deepEqual(list.conversations.map(row => row.messageCount), [2, 6]);
  });

  await t.test("Błąd zapisu zachowuje tekst w streamie i jawnie informuje, bez surowego błędu bazy", async () => {
    failWrites = true;
    const before = messages.length;
    const output = events(await (await POST(req({ conversationId, messages: [user("write-failure")] }))).text());
    failWrites = false;
    assert.equal(meta(output).persisted, false);
    assert.match(meta(output).persistenceError, /Nie udało się zapisać/);
    assert.ok(output.some(event => event.type === "text-delta"));
    assert.equal(messages.length, before);
    assert.ok(!JSON.stringify(output).includes("RAW_DB_SECRET"));
  });

  await t.test("Błąd modelu nie zapisuje nieukończonej pary", async () => {
    failModel = true;
    const before = messages.length;
    const output = events(await (await POST(req({ conversationId, messages: [user("model-failure")] }))).text());
    failModel = false;
    assert.equal(meta(output).persisted, false);
    assert.equal(messages.length, before);
  });

  await t.test("Błąd odczytu jest jawny i nie uruchamia modelu", async () => {
    failReads = true;
    const before = modelRequests.length;
    const response = await GET(get());
    assert.equal(response.status, 503);
    assert.ok(!(await response.text()).includes("RAW_DB_SECRET"));
    assert.equal((await POST(req({ conversationId, messages: [user("read-failure")] }))).status, 503);
    failReads = false;
    assert.equal(modelRequests.length, before);
  });

  await t.test("Obrazy to wyłącznie [obraz], bez base64, plików i wyników narzędzi", () => {
    const text = messageText({ id: "image", role: "assistant", parts: [
      { type: "text", text: "Gotowe" },
      { type: "file", mediaType: "image/png", url: "data:image/png;base64,IMAGE_SECRET" },
      { type: "tool-generujObraz", state: "output-available", output: { ok: true, dataUrl: "IMAGE_SECRET" } },
      { type: "tool-odpowiedzPoPolsku", state: "output-available", output: { ok: true, audioUrl: "AUDIO_SECRET" } },
    ] });
    assert.equal(text, "Gotowe\n[obraz]\n[obraz]");
  });

  await t.test("Bezpieczna diagnoza rozróżnia brak tabeli/kolumny, uprawnienia, klucz i sieć", async () => {
    const before = modelRequests.length;
    failReads = true;
    try {
      for (const [code, status, expectedCode, expectedMessage] of [
        ["42P01", 404, "42P01", /Brakuje tabeli/],
        ["PGRST205", 404, "PGRST205", /Brakuje tabeli/],
        ["42703", 400, "42703", /Brakuje wymaganej kolumny/],
        ["PGRST204", 400, "PGRST204", /Brakuje wymaganej kolumny/],
        ["42501", 403, "42501", /Brak uprawnień/],
        ["PGRST301", 401, "PGRST301", /odrzucił klucz/],
        ["", 401, "DB_AUTH", /odrzucił klucz/],
        ["", 0, "DB_CONNECTION", /Brak połączenia/],
        ["RAW_DB_SECRET", 500, "DB_QUERY_FAILED", /konfigurację Supabase/],
      ]) {
        readError = { code, message: "RAW_DB_SECRET", details: "RAW_DB_SECRET", hint: "RAW_DB_SECRET" };
        readStatus = status;
        const response = await GET(get());
        const body = await response.json();
        assert.equal(response.status, 503);
        assert.equal(body.error.code, expectedCode);
        assert.match(body.error.message, expectedMessage);
        assert.ok(!JSON.stringify(body).includes("RAW_DB_SECRET"));
      }
    } finally { failReads = false; }
    assert.equal(modelRequests.length, before);
  });

  await t.test("Utworzenie rozmowy: kody ograniczeń i typów oraz nazwa wymaganej kolumny bez danych wiersza", async () => {
    const before = modelRequests.length;
    try {
      for (const [code, message, expected] of [
        ["23502", 'null value in column "user_id" of relation "conversations" violates not-null constraint', /kolumnie user_id/],
        ["22P02", "RAW_DB_SECRET", /Typ kolumny/],
        ["42804", "RAW_DB_SECRET", /Typ kolumny/],
        ["23503", "RAW_DB_SECRET", /klucz obcy/],
        ["23505", "RAW_DB_SECRET", /unikalności/],
        ["42P10", "RAW_DB_SECRET", /unikalności/],
        ["23514", "RAW_DB_SECRET", /CHECK/],
      ]) {
        conversationInsertError = { code, message, details: "RAW_DB_SECRET", hint: "RAW_DB_SECRET" };
        const response = await POST(req({ conversationId, messages: [user("insert-failure")] }));
        const body = await response.json();
        assert.equal(response.status, 503);
        assert.equal(body.error.code, code);
        assert.match(body.error.message, expected);
        assert.ok(!JSON.stringify(body).includes("RAW_DB_SECRET"));
      }
    } finally { conversationInsertError = undefined; }
    assert.equal(modelRequests.length, before);
  });

  await t.test("Lista stronicuje starsze rozmowy i liczy ponad 500 wiadomości bez ucinania", async () => {
    const original = conversations.find(row => row.client_id === conversationId);
    for (let index = 0; index < 51; index++) conversations.push({
      id: String(91000000000000000n + BigInt(index)), client_id: randomUUID(), session_key: original.session_key,
      title: `Starsza rozmowa ${index}`, created_at: "2010-01-01T00:00:00.000Z",
    });
    for (let index = 0; index < 1002; index++) messages.push({
      id: String(92000000000000000n + BigInt(index)), client_id: randomUUID(), conversation_id: original.id,
      role: index % 2 ? "assistant" : "user", content: "Tekst testowy", position: 10000 + index,
    });
    const first = await (await GET(get(cookie, "?list=1"))).json();
    assert.equal(first.conversations.length, 50);
    assert.equal(first.nextOffset, 50);
    assert.equal(first.conversations.find(row => row.conversationId === conversationId).messageCount, 1008);
    const second = await (await GET(get(cookie, "?list=1&offset=50"))).json();
    assert.equal(second.conversations.length, 3);
    assert.equal(second.nextOffset, null);
    assert.equal(new Set([...first.conversations, ...second.conversations].map(row => row.conversationId)).size, 53);
  });

  await t.test("Tytuł ma 3–5 słów; nieprawidłowy wynik nie jest skracany na siłę", () => {
    assert.equal(validConversationTitle('„Spokojna odpowiedź na reklamację”'), "Spokojna odpowiedź na reklamację");
    assert.equal(validConversationTitle("Pierwsza konsultacja w Studio Nova"), "Pierwsza konsultacja w Studio Nova");
    assert.equal(validConversationTitle("Tytuł: **Spokojna odpowiedź na reklamację**"), "Spokojna odpowiedź na reklamację");
    for (const value of ["", "Tytuł", "Dwa słowa", "Ten tytuł zawiera zdecydowanie zbyt wiele słów", "--- --- ---", "x".repeat(91) + " dwa trzy"]) assert.throws(() => validConversationTitle(value));
  });

  await t.test("Błąd modelu, walidacji lub zapisu tytułu zachowuje rozmowę bez ponawiania generacji", async () => {
    try {
      for (const scenario of ["provider", "validation", "write", "length", "empty"]) {
        failTitle = scenario === "provider";
        titleOutput = scenario === "validation" ? "Za krótko" : scenario === "empty" ? "" : undefined;
        failTitleWrite = scenario === "write";
        titleFinish = scenario === "length" ? "length" : "stop";
        const id = randomUUID();
        const turn = { conversationId: id, messages: [user(`title-${scenario}`, "Pomóż odpowiedzieć klientowi")] };
        const before = titleRequests.length;
        const output = events(await (await POST(req(turn))).text());
        assert.equal(meta(output).persisted, true);
        assert.match(meta(output).titleError, /Rozmowa została zapisana/);
        const expected = { provider: "TITLE_PROVIDER", validation: "TITLE_FORMAT", write: "DB_QUERY_FAILED", length: "TITLE_LENGTH", empty: "TITLE_EMPTY" }[scenario];
        assert.ok(meta(output).titleError.includes(expected), meta(output).titleError);
        assert.equal(conversations.find(row => row.client_id === id).title, "Nowa rozmowa Studio Nova");
        assert.equal((await (await GET(get(cookie, `?id=${id}`))).json()).messages.length, 2);
        assert.equal(titleRequests.length, before + 1);
        await (await POST(req(turn))).text();
        assert.equal(titleRequests.length, before + 1);
        assert.ok(!JSON.stringify(output).includes("RAW_TITLE_SECRET"));
        assert.ok(!JSON.stringify(output).includes("RAW_DB_SECRET"));
      }
    } finally { failTitle = false; failTitleWrite = false; titleOutput = undefined; titleFinish = "stop"; }
  });

  await t.test("Błędy dostawcy tytułu mają konkretne kody bez surowej odpowiedzi", async () => {
    failTitle = true;
    try {
      for (const [status, expected] of [[400, "TITLE_CONFIGURATION"], [402, "TITLE_CREDITS"], [429, "TITLE_RATE_LIMIT"], [401, "TITLE_ACCESS"]]) {
        titleHttpStatus = status;
        const output = events(await (await POST(req({ conversationId: randomUUID(), messages: [user(`title-http-${status}`)] }))).text());
        assert.equal(meta(output).persisted, true);
        assert.ok(meta(output).titleError.includes(expected));
        assert.ok(!JSON.stringify(output).includes("RAW_TITLE_SECRET"));
        if (status === 400) assert.ok(meta(output).titleError.includes("parametr temperature"));
      }
    } finally { failTitle = false; titleHttpStatus = 500; }
  });

  await t.test("Usuń: sesja, origin i UUID przed RPC; cudza rozmowa oraz awaria nie usuwają danych", async () => {
    const before = externalCalls;
    assert.equal((await remove(conversationId, cookie, "https://other.test")).status, 403);
    assert.equal((await remove("not-a-uuid")).status, 400);
    assert.equal(externalCalls, before);
    const beforeConversations = conversations.length, beforeMessages = messages.length;
    assert.equal((await remove(conversationId, otherCookie)).status, 404);
    failDelete = true;
    const response = await remove(conversationId);
    failDelete = false;
    assert.equal(response.status, 503);
    assert.ok(!(await response.text()).includes("RAW_DB_SECRET"));
    assert.equal(conversations.length, beforeConversations);
    assert.equal(messages.length, beforeMessages);
  });

  await t.test("Usunięcie własnej rozmowy usuwa obie tabele i pozostawia inne rozmowy", async () => {
    const target = conversations.find(row => row.client_id === conversationId);
    const other = conversations.find(row => row.title === "Pomysł na kolejną rozmowę");
    const otherMessages = messages.filter(row => row.conversation_id === other.id).map(row => ({ ...row }));
    assert.equal((await remove(conversationId)).status, 204);
    assert.equal(conversations.some(row => row.client_id === conversationId), false);
    assert.equal(messages.some(row => row.conversation_id === target.id), false);
    assert.equal((await GET(get(cookie, `?id=${conversationId}`))).status, 404);
    assert.deepEqual(messages.filter(row => row.conversation_id === other.id), otherMessages);
    assert.equal((await remove(conversationId)).status, 404);
  });

  await t.test("Pierwsza odpowiedź nadaje tytuł również starszej pustej rozmowie z innym tytułem lub NULL", async () => {
    const ownerKey = conversations[0].session_key;
    for (const [index, initialTitle] of ["Stary tytuł początkowy", null].entries()) {
      const id = randomUUID();
      conversations.push({ id: String(94000000000000000n + BigInt(index)), client_id: id, session_key: ownerKey,
        title: initialTitle, created_at: new Date().toISOString() });
      const output = events(await (await POST(req({ conversationId: id, messages: [user(`legacy-${index}`)] }))).text());
      assert.equal(meta(output).persisted, true);
      assert.equal(meta(output).titleError, undefined, JSON.stringify(meta(output)));
      assert.equal(conversations.find(row => row.client_id === id).title, "Spokojna rozmowa o konsultacji");
    }
  });

  await t.test("Równoległa zmiana tytułu nie jest nadpisywana i nie daje fałszywego błędu", async () => {
    const id = randomUUID();
    const request = req({ conversationId: id, messages: [user("parallel-title")] });
    const turn = await prepareConversation(request, [user("parallel-title")], id);
    const row = conversations.find(row => row.client_id === id);
    row.title = "Tytuł zmieniony przez właściciela";
    await saveConversationTitle(request, turn, "Tytuł otrzymany od modelu");
    assert.equal(row.title, "Tytuł zmieniony przez właściciela");
  });
  await t.test("Źródła i etykieta wiedzy przetrwają F5 jako dokładny tekst użytej wersji", async () => {
    const id = randomUUID(), question = user("sources-test", "Jaki jest cennik?");
    const request = req({ conversationId: id, messages: [question] });
    const turn = await prepareConversation(request, [question], id);
    const source = { sourceId: "K012345abcdef", title: "Cennik", content: "Dokładny tekst\nz poprzedniej wersji.", similarity: .75 };
    const assistant = { id: turn.assistantId, role: "assistant", metadata: { knowledgeSearched: true, knowledgeSources: [source] }, parts: [{ type: "text", text: "Odpowiedź.\n📎 Źródło: Cennik [K012345abcdef]" }] };
    await saveConversationTurn(request, turn, assistant);
    const loaded = await (await GET(get(cookie, `?id=${id}`))).json();
    assert.equal(loaded.messages[1].metadata.knowledgeSearched, true);
    assert.deepEqual(loaded.messages[1].metadata.knowledgeSources, [source]);
    assert.deepEqual(messages.find(row => row.client_id === turn.assistantId).knowledge_context.sources, [source]);
    assert.equal((await GET(get(otherCookie, `?id=${id}`))).status, 404);
  });
});

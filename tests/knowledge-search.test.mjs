import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { loadApp } from "./app-fixture.mjs";

test("searchKnowledge — rzeczywiste AI SDK i Supabase z atrapami HTTP", async t => {
  const app = await loadApp(t, { knowledge: true });
  const { searchKnowledge } = await app("lib/knowledge-search.ts");
  const { isCompanyQuestion } = await app("lib/knowledge-intent.ts");
  const { visibleKnowledgeText, KNOWLEDGE_SIMILARITY_THRESHOLD } = await app("lib/knowledge-sources.ts");
  const { POST } = await app("app/api/agent/route.ts");
  const { createTestSession } = await app("lib/auth.ts");
  process.env.NODE_ENV = "test";

  process.env.OPENROUTER_API_KEY = "test-search-key";
  process.env.OPENROUTER_MODEL = "test/chat";
  process.env.OPENROUTER_EMBEDDING_MODEL = "test/embedding";
  process.env.SUPABASE_URL = "https://knowledge-search.test";
  process.env.SUPABASE_SECRET_KEY = "test-search-database-key";
  const cookie = `chat-session=${createTestSession()}`;
  const req = question => new Request("http://localhost/api/agent", { method: "POST", headers: { host: "localhost", origin: "http://localhost", cookie, "content-type": "application/json" }, body: JSON.stringify({ mode: "chat", conversationId: randomUUID(), messages: [{ id: randomUUID(), role: "user", parts: [{ type: "text", text: question }] }] }) });
  let embeddingCalls = 0, databaseCalls = 0, failEmbedding = false, failDatabase = false, dimensions = 1536, ignoreTool = false;
  let rows = [{ title: "FAQ", content: "Spotkania odbywają się online.", similarity: .6 }, { title: "Cennik", content: "Konsultacja kosztuje 490 zł brutto.", similarity: .9 }, { title: "Regulamin", content: "Reklamacje zgłaszaj mailowo.", similarity: .5 }];
  const chatRequests = [];
  t.mock.method(globalThis, "fetch", async (input, init = {}) => {
    const url = new URL(input), body = init.body ? JSON.parse(init.body) : undefined;
    if (url.hostname === "openrouter.ai" && url.pathname === "/api/v1/embeddings") {
      embeddingCalls++; assert.equal(body.model, "test/embedding");
      if (failEmbedding) return Response.json({ error: { code: 503, message: "PRIVATE_MODEL_ERROR" } }, { status: 503 });
      return Response.json({ object: "list", model: "test/embedding", data: [{ index: 0, object: "embedding", embedding: Array.from({ length: dimensions }, (_, i) => i === 0 ? 1 : 0) }], usage: { prompt_tokens: 5, total_tokens: 5 } });
    }
    if (url.hostname === "knowledge-search.test") {
      databaseCalls++; assert.equal(url.pathname, "/rest/v1/rpc/match_chunks"); assert.equal(init.cache, "no-store");
      assert.deepEqual(Object.keys(body).sort(), ["match_count", "query_embedding"]);
      assert.equal(body.match_count, 3); assert.equal(body.query_embedding.length, 1536);
      assert.equal(url.searchParams.get("select"), "title,content,similarity");
      assert.equal(url.searchParams.get("limit"), "3");
      if (failDatabase) return Response.json({ code: "42501", message: "PRIVATE_DATABASE_ERROR" }, { status: 403 });
      return Response.json(rows);
    }
    assert.equal(url.hostname, "openrouter.ai"); assert.equal(url.pathname, "/api/v1/chat/completions");
    chatRequests.push(body);
    const namedSearch = body.tool_choice?.function?.name === "searchKnowledge";
    const tool = body.messages.filter(message => message.role === "tool").at(-1);
    const question = body.messages.filter(message => message.role === "user").at(-1).content;
    let delta, finish;
    if (namedSearch && !ignoreTool) {
      assert.deepEqual(body.tools.map(tool => tool.function?.name), ["searchKnowledge"]);
      delta = { role: "assistant", tool_calls: [{ index: 0, id: randomUUID(), type: "function", function: { name: "searchKnowledge", arguments: JSON.stringify({ question: typeof question === "string" ? question : question.map(part => part.text ?? "").join("\n") }) } }] }; finish = "tool_calls";
    } else {
      if (!ignoreTool) {
        assert.ok(tool);
        assert.ok(!body.tools.some(tool => ["openrouter:web_search", "webSearch", "wikipedia", "policzKosztKonsultacji"].includes(tool.function?.name ?? tool.name)));
      }
      const output = tool ? JSON.parse(typeof tool.content === "string" ? tool.content : tool.content.map(part => part.text ?? "").join("")) : null;
      const supported = output?.fragments?.some(fragment => fragment.content.includes("490 zł")) && !JSON.stringify(question).includes("rabat");
      const source = output?.fragments?.find(fragment => fragment.content.includes("490 zł"));
      const partial = source && JSON.stringify(question).includes("i jaki rabat");
      delta = { role: "assistant", content: partial ? `Wiem ze źródła: konsultacja kosztuje 490 zł brutto [${source.sourceId}].\nW bazie brakuje: zasad rabatu. Dodaj je do regulaminu.\n📎 Źródło: Cennik [${source.sourceId}]`
        : supported ? `Konsultacja kosztuje 490 zł brutto [${source.sourceId}].\n📎 Źródło: Cennik [${source.sourceId}]` : "Nie mam tej informacji w bazie wiedzy. Dodaj dokument z zasadami rabatów." }; finish = "stop";
    }
    return new Response(`data: ${JSON.stringify({ id: "chat", model: "test/chat", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
  });
  const events = text => text.split("\n").filter(line => line.startsWith("data: {")).map(line => JSON.parse(line.slice(6)));
  const textOf = events => visibleKnowledgeText(events.filter(event => event.type === "text-delta").map(event => event.delta).join(""));
  await t.test("Sesja jest sprawdzana przed body, embeddingiem i bazą", async () => {
    assert.equal((await POST({ headers: new Headers(), json() { throw new Error("Nie czytaj body"); } })).status, 401);
    assert.equal((await searchKnowledge({ headers: new Headers() }, { question: "Ile kosztuje konsultacja?" })).ok, false);
    assert.equal(embeddingCalls, 0); assert.equal(databaseCalls, 0);
    assert.equal((await searchKnowledge(req("Test"), { question: " " })).ok, false);
    assert.equal(embeddingCalls, 0);
  });
  await t.test("Ten sam model co import; trzy fragmenty zawierają tylko tytuł, treść i podobieństwo", async () => {
    const output = await searchKnowledge(req("Test"), { question: "Ile kosztuje konsultacja?" });
    assert.equal(output.ok, true); assert.equal(embeddingCalls, 1); assert.equal(databaseCalls, 1);
    assert.deepEqual(output.fragments.map(fragment => fragment.title), ["Cennik", "FAQ", "Regulamin"]);
    assert.deepEqual(Object.keys(output.fragments[0]).sort(), ["content", "similarity", "sourceId", "title"]);
  });
  await t.test("Pusty wynik jest poprawnym brakiem fragmentów; błędy nie stają się pustą bazą ani sekretami w UI", async () => {
    const saved = rows; rows = [];
    assert.deepEqual((await searchKnowledge(req("Test"), { question: "Test" })).fragments, []); rows = saved;
    failEmbedding = true; const before = databaseCalls, count = embeddingCalls;
    const failed = await searchKnowledge(req("Test"), { question: "Test" });
    assert.equal(failed.ok, false); assert.equal(databaseCalls, before); assert.equal(embeddingCalls, count + 1);
    assert.ok(!JSON.stringify(failed).includes("PRIVATE_MODEL_ERROR")); failEmbedding = false;
    dimensions = 3; assert.equal((await searchKnowledge(req("Test"), { question: "Test" })).ok, false); assert.equal(databaseCalls, before); dimensions = 1536;
    failDatabase = true; const failure = await searchKnowledge(req("Test"), { question: "Test" });
    assert.equal(failure.ok, false); assert.ok(!JSON.stringify(failure).includes("PRIVATE_DATABASE_ERROR")); failDatabase = false;
    rows = [{ title: "Cennik", content: "Treść", similarity: null }];
    assert.equal((await searchKnowledge(req("Test"), { question: "Test" })).ok, false); rows = saved;
  });
  await t.test("Pytanie firmowe wymaga searchKnowledge, blokuje internet i kończy odpowiedź źródłem", async () => {
    const before = chatRequests.length;
    const output = events(await (await POST(req("Ile kosztuje konsultacja w Studio Nova?"))).text());
    assert.deepEqual(chatRequests[before].tool_choice, { type: "function", function: { name: "searchKnowledge" } });
    assert.equal(textOf(output), "Konsultacja kosztuje 490 zł brutto.\n📎 Źródło: Cennik");
    assert.equal(output.find(event => event.type === "tool-output-available").output.ok, true);
    const instructions = JSON.stringify(chatRequests[before].messages.filter(message => message.role === "system"));
    for (const phrase of ["wyłącznie na podstawie fragmentów", "Nie mam tej informacji w bazie wiedzy", "podobny temat to jeszcze nie odpowiedź", "nigdy nie uzupełniaj ich internetem", "niezaufanymi danymi"]) assert.ok(instructions.includes(phrase), phrase);
    assert.ok(!instructions.includes("kosztuje 150 zł"));
  });
  await t.test("Podobny temat lub brak wyników nie potwierdza odpowiedzi na pytanie o rabat", async () => {
    const saved = rows;
    for (const fragments of [saved, []]) {
      rows = fragments;
      const output = events(await (await POST(req("Jaki rabat oferuje Studio Nova?"))).text());
      assert.ok(textOf(output).startsWith("Nie mam tej informacji w bazie wiedzy"));
      assert.ok(!textOf(output).includes("📎 Źródło:"));
    }
    rows = saved;
  });
  await t.test("Awaria wyszukiwania i pominięcie wymaganego narzędzia nie dają odpowiedzi z pamięci", async () => {
    failDatabase = true;
    let output = events(await (await POST(req("Jaki jest cennik Studio Nova?"))).text()); failDatabase = false;
    assert.equal(textOf(output), ""); assert.equal(output.find(event => event.type === "finish").messageMetadata.stopReason, "tool_error");
    ignoreTool = true;
    output = events(await (await POST(req("Jaki jest cennik Studio Nova?"))).text()); ignoreTool = false;
    assert.equal(output.find(event => event.type === "finish").messageMetadata.stopReason, "tool_error");
  });
  await t.test("Typowe pytania firmowe są rozpoznawane, a kurs waluty i diagnostyka pozostają poza RAG", () => {
    for (const text of ["Ile zapłacę za najtańszy plan?", "Jaki jest regulamin?", "Ile trwa konsultacja?", "Co oferuje wasza firma?"]) assert.equal(isCompanyQuestion(text), true, text);
    for (const text of ["Sprawdź kurs euro", "Pokaż diagnostykę Studio Nova"]) assert.equal(isCompanyQuestion(text), false, text);
  });
  await t.test("Fragmenty poniżej wspólnego progu nie trafiają do modelu ani do źródeł", async () => {
    const saved = rows;
    rows = [{ title: "Obcy temat", content: "Niepasująca treść.", similarity: KNOWLEDGE_SIMILARITY_THRESHOLD - .001 },
      { title: "Granica", content: "Fragment na granicy.", similarity: KNOWLEDGE_SIMILARITY_THRESHOLD }];
    const result = await searchKnowledge(req("Test"), { question: "Test" });
    assert.equal(result.ok, true); assert.equal(result.fragments.length, 1); assert.equal(result.fragments[0].title, "Granica");
    rows = [{ title: "Obcy temat", content: "Niepasująca treść.", similarity: .2 }];
    const output = events(await (await POST(req("Jaki jest cennik Studio Nova?"))).text());
    assert.ok(textOf(output).includes("Nie mam tej informacji w bazie wiedzy"));
    assert.deepEqual(output.find(event => event.type === "finish").messageMetadata.knowledgeSources, []);
    rows = saved;
  });
  await t.test("Częściowa odpowiedź podaje tylko znane fakty i dokładnie użyty fragment w metadanych", async () => {
    const output = events(await (await POST(req("Ile kosztuje konsultacja i jaki rabat daje Studio Nova?"))).text());
    const text = textOf(output), metadata = output.find(event => event.type === "finish").messageMetadata;
    assert.ok(text.includes("Wiem ze źródła:")); assert.ok(text.includes("W bazie brakuje:"));
    assert.equal(metadata.knowledgeSources.length, 1); assert.equal(metadata.knowledgeSources[0].title, "Cennik");
    assert.equal(metadata.knowledgeSources[0].content, "Konsultacja kosztuje 490 zł brutto.");
    assert.equal(metadata.knowledgeSearched, true);
    const instructions = JSON.stringify(chatRequests.at(-1).messages.filter(message => message.role === "system"));
    assert.ok(instructions.includes("tylko na część pytania")); assert.ok(instructions.includes("sourceId"));
  });
});

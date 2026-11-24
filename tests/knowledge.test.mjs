import assert from "node:assert/strict";
import test from "node:test";
import { loadApp } from "./app-fixture.mjs";

test("Import dokumentów z embeddingami i uzupełnianiem braków", async t => {
  const app = await loadApp(t);
  const { splitDocument, documentInputSchema } = await app("lib/knowledge-document.ts");
  const { POST, GET, DELETE } = await app("app/api/knowledge/route.ts");
  const { readKnowledgeImport } = await app("lib/knowledge-stream.ts");
  const { addKnowledgeDocument } = await app("lib/knowledge-store.ts");
  const { createTestSession } = await app("lib/auth.ts");
  process.env.NODE_ENV = "test";

  process.env.SUPABASE_URL = "https://knowledge.test";
  process.env.SUPABASE_SECRET_KEY = "knowledge-test-key";
  process.env.OPENROUTER_API_KEY = "knowledge-test-model-key";
  process.env.OPENROUTER_EMBEDDING_MODEL = "test/embedding";
  const cookie = `chat-session=${createTestSession()}`;
  let calls = 0, failure, override, embeddingFailure = false, vectorMode = "valid", readFailure = false;
  const payloads = [], modelRequests = [], pendingRows = [], documentsRows = [];
  let deleteConflict = false, hiddenDocument = false;
  const request = (body, origin = "http://localhost") => new Request("http://localhost/api/knowledge", {
    method: "POST", headers: { host: "localhost", origin, cookie, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  t.mock.method(globalThis, "fetch", async (input, init) => {
    calls++;
    const url = new URL(input);
    if (url.hostname === "openrouter.ai") {
      assert.equal(url.pathname, "/api/v1/embeddings");
      const body = JSON.parse(init.body); modelRequests.push(body);
      assert.equal(body.model, "test/embedding");
      if (embeddingFailure) return Response.json({ error: { code: 503, message: "PRIVATE_MODEL_ERROR" } }, { status: 503 });
      return Response.json({ object: "list", model: "test/embedding", data: body.input.map((text, index) => ({ object: "embedding", index,
        embedding: Array.from({ length: vectorMode === "short" ? 3 : 1536 }, (_, i) => vectorMode === "zero" ? 0 : i === 0 ? index + 1 : 0),
      })), usage: { prompt_tokens: 10, total_tokens: 10 } });
    }
    assert.equal(url.hostname, "knowledge.test");
    if (url.pathname === "/rest/v1/rpc/list_knowledge_documents") return Response.json(documentsRows);
    if (url.pathname === "/rest/v1/documents") return Response.json(hiddenDocument ? [] : [{ id: url.searchParams.get("id").slice(3) }]);
    if (url.pathname === "/rest/v1/rpc/delete_knowledge_document") return deleteConflict ? Response.json({ code: "40001", message: "PRIVATE_CONFLICT" }, { status: 400 }) : Response.json(true);
    if (url.pathname === "/rest/v1/chunks") {
      assert.equal(init.method, "GET"); assert.equal(init.cache, "no-store");
      assert.equal(url.searchParams.get("select"), "id::text,document_id::text,content");
      assert.equal(url.searchParams.get("embedding"), "is.null");
      if (readFailure) return Response.json({ code: "42501", message: "PRIVATE_READ_ERROR" }, { status: 403 });
      const start = Number(url.searchParams.get("offset") ?? 0);
      return Response.json(pendingRows.slice(start, start + 500));
    }
    assert.equal(url.pathname, "/rest/v1/rpc/replace_knowledge_document");
    assert.equal(init.method, "POST"); assert.equal(init.cache, "no-store");
    const body = JSON.parse(init.body); payloads.push(body);
    assert.deepEqual(Object.keys(body).sort(), ["p_backfill", "p_chunks", "p_expected", "p_title"]);
    assert.ok(body.p_chunks.every(chunk => typeof chunk.content === "string" && chunk.content.length <= 800 && chunk.embedding.length === 1536));
    if (failure) return Response.json(failure, { status: 400 });
    const result = override ?? [{ document_id: "9007199254740999", title: body.p_title, chunk_count: body.p_chunks.length, backfilled_count: body.p_backfill.length, missing_count: 0 }];
    if (!override) pendingRows.splice(0);
    return Response.json(result);
  });
  await t.test("Akapity są oddzielne; puste linie, CRLF i białe znaki nie tworzą pustych fragmentów", () => {
    assert.deepEqual(splitDocument("  A.\r\n\r\nB.\r\n \t\r\n\r\n C.  "), ["A.", "B.", "C."]);
    assert.deepEqual(splitDocument("Jedna linia.\nDruga linia."), ["Jedna linia.\nDruga linia."]);
    assert.deepEqual(splitDocument("\n \n\t\n"), []);
    assert.deepEqual(splitDocument("a".repeat(800)), ["a".repeat(800)]);
  });
  await t.test("Długi akapit dzieli się na granicy zdań, bez łączenia z kolejnym akapitem", () => {
    const first = "A".repeat(499) + ".", second = "B".repeat(399) + ".";
    assert.deepEqual(splitDocument(`${first} ${second}\n\nKoniec.`), [first, second, "Koniec."]);
    const sentences = Array.from({ length: 40 }, (_, i) => `Zdanie numer ${i} opisuje konsultację.`);
    const chunks = splitDocument(sentences.join(" "));
    assert.ok(chunks.length > 1); assert.ok(chunks.every(chunk => chunk.length <= 800 && chunk.endsWith(".")));
    assert.equal(chunks.join(" "), sentences.join(" "));
  });
  await t.test("Jedno zdanie lub słowo powyżej limitu nie gubi treści i nie rozcina emoji", () => {
    const sentence = "konsultacja ".repeat(200).trim();
    assert.equal(splitDocument(sentence).join(" "), sentence);
    const word = "a".repeat(799) + "😀" + "b".repeat(1000);
    const chunks = splitDocument(word);
    assert.ok(chunks.every(chunk => chunk.length <= 800 && !/[\uD800-\uDBFF]$/u.test(chunk)));
    assert.equal(chunks.join(""), word);
  });
  await t.test("Puste pola i limit 20 000 znaków są weryfikowane przed połączeniem z bazą", async () => {
    for (const body of [{ title: " ", content: "Tekst" }, { title: "FAQ", content: "\n\t" }, { title: "FAQ", content: "a".repeat(20_001) }, { title: "FAQ", content: "Tekst", embedding: [] }]) {
      assert.equal((await POST(request(body))).status, 400);
    }
    assert.equal(calls, 0);
    assert.equal(documentInputSchema.safeParse({ title: "FAQ", content: "a".repeat(20_000) }).success, true);
  });
  await t.test("Sesja jest sprawdzana przed body, modelem i bazą; obce źródło ma 403", async () => {
    assert.equal((await POST({ headers: new Headers(), json() { throw new Error("Nie czytaj body"); } })).status, 401);
    await assert.rejects(addKnowledgeDocument({ headers: new Headers() }, {}), error => error.status === 401);
    assert.equal((await POST(request({ title: "FAQ", content: "Tekst" }, "https://obca.test"))).status, 403);
    assert.equal(calls, 0);
  });
  await t.test("Jedno embedMany i jeden zapis transakcyjny z kompletem wektorów w kolejności akapitów", async () => {
    const result = await POST(request({ title: "  Cennik  ", content: "Konsultacja kosztuje 150 zł brutto.\n\nSpotkanie trwa 45 minut." }));
    assert.equal(result.status, 201); assert.equal(result.headers.get("cache-control"), "no-store");
    assert.deepEqual(await result.json(), { documentId: "9007199254740999", title: "Cennik", chunkCount: 2, backfilledCount: 0 });
    assert.equal(payloads.at(-1).p_title, "Cennik");
    assert.deepEqual(payloads.at(-1).p_chunks.map(chunk => chunk.content), ["Konsultacja kosztuje 150 zł brutto.", "Spotkanie trwa 45 minut."]);
    assert.deepEqual(payloads.at(-1).p_chunks.map(chunk => chunk.embedding[0]), [1, 2]);
    assert.deepEqual(payloads.at(-1).p_backfill, []);
    assert.equal(calls, 4); assert.equal(modelRequests.length, 1);
  });
  await t.test("Błąd transakcji lub brak funkcji daje jasny komunikat, bez surowych danych i bez ponowień", async () => {
    for (const code of ["23502", "42501", "PGRST202"]) {
      failure = { code, message: "PRIVATE_DB_DETAILS" };
      const before = calls;
      const result = await POST(request({ title: "FAQ", content: "Tekst." }));
      assert.equal(result.status, 503); assert.equal(calls, before + 4);
      const body = await result.text(); assert.ok(!body.includes("PRIVATE_DB_DETAILS"));
      if (code === "PGRST202") assert.ok(body.includes("knowledge-per-user.sql"));
    }
    failure = undefined;
  });
  await t.test("Błędne potwierdzenie z bazy nie jest sukcesem", async () => {
    for (const result of [[], [{ document_id: "1", title: "FAQ", chunk_count: 100 }], [{ document_id: "1", title: "Inny", chunk_count: 1 }]]) {
      override = result;
      assert.equal((await POST(request({ title: "FAQ", content: "Tekst." }))).status, 503);
    }
    override = undefined;
  });
  await t.test("Nowe i stare fragmenty trafiają do jednego wywołania; przypisanie wektorów zachowuje id i treść", async () => {
    pendingRows.push({ id: "9007199254740995", content: "Stary pierwszy fragment." }, { id: "9007199254740996", content: "Stary drugi fragment." });
    const before = modelRequests.length;
    const result = await POST(request({ title: "FAQ", content: "Nowy pierwszy.\n\nNowy drugi." }));
    assert.equal(result.status, 201); assert.equal((await result.json()).backfilledCount, 2);
    assert.equal(modelRequests.length, before + 1);
    assert.deepEqual(modelRequests.at(-1).input, ["Nowy pierwszy.", "Nowy drugi.", "Stary pierwszy fragment.", "Stary drugi fragment."]);
    assert.deepEqual(payloads.at(-1).p_backfill.map(row => [row.id, row.embedding[0]]), [["9007199254740995", 3], ["9007199254740996", 4]]);
    assert.equal(pendingRows.length, 0);
  });
  await t.test("Pobieranie braków obejmuje więcej niż jedną stronę, ale nadal tylko jeden request embeddingów", async () => {
    pendingRows.push(...Array.from({ length: 501 }, (_, i) => ({ id: String(1000 + i), content: `Brakujący fragment numer ${i}.` })));
    const before = modelRequests.length;
    assert.equal((await POST(request({ title: "Nowy", content: "Nowy fragment." }))).status, 201);
    assert.equal(modelRequests.length, before + 1); assert.equal(modelRequests.at(-1).input.length, 502);
    assert.equal(payloads.at(-1).p_backfill.length, 501);
  });
  await t.test("Błąd modelu, pusty wektor lub zły wymiar nie uruchamiają zapisu i nie zmieniają starych braków", async () => {
    pendingRows.push({ id: "1", content: "Poprzedni fragment." });
    for (const mode of ["failure", "short", "zero"]) {
      embeddingFailure = mode === "failure"; vectorMode = mode === "failure" ? "valid" : mode;
      const before = payloads.length, models = modelRequests.length;
      const result = await POST(request({ title: "FAQ", content: "Nowy fragment." }));
      assert.equal(result.status, 503);
      const output = await result.text(); assert.ok(output.includes("Dokument nie został dodany"));
      assert.ok(!output.includes("PRIVATE_MODEL_ERROR"));
      assert.equal(payloads.length, before); assert.equal(modelRequests.length, models + 1);
      assert.equal(pendingRows.length, 1);
    }
    embeddingFailure = false; vectorMode = "valid"; pendingRows.splice(0);
  });
  await t.test("Błąd odczytu nie wywołuje modelu, konflikt lub pozostałe braki nie dają sukcesu", async () => {
    readFailure = true;
    const before = modelRequests.length;
    assert.equal((await POST(request({ title: "FAQ", content: "Tekst." }))).status, 503);
    assert.equal(modelRequests.length, before); readFailure = false;
    failure = { code: "40001", message: "PRIVATE_CONFLICT" };
    const conflict = await POST(request({ title: "FAQ", content: "Tekst." }));
    assert.equal(conflict.status, 409); assert.ok((await conflict.text()).includes("zmieniły się")); failure = undefined;
    override = [{ document_id: "1", title: "FAQ", chunk_count: 1, backfilled_count: 0, missing_count: 1 }];
    assert.equal((await POST(request({ title: "FAQ", content: "Tekst." }))).status, 503);
    override = undefined;
  });
  await t.test("Lista i usuwanie sprawdzają sesję przed body i bazą; DELETE wymaga źródła", async () => {
    const before = calls;
    for (const handler of [GET, DELETE]) assert.equal((await handler({ headers: new Headers(), json() { throw new Error("Nie czytaj body"); } })).status, 401);
    assert.equal((await DELETE(request({ id: "7", createdAt: "2026-11-19T12:00:00Z" }, "https://obca.test"))).status, 403);
    assert.equal(calls, before);
  });
  await t.test("Lista zwraca nazwę źródła, datę wersji i liczbę fragmentów; zastąpienie wymaga aktualnego potwierdzenia", async () => {
    documentsRows.push({ document_id: "7", title: "FAQ", created_at: "2026-11-19T12:00:00+00:00", chunk_count: 2 });
    const response = await GET(request({}));
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual((await response.json()).documents, [{ id: "7", title: "FAQ", createdAt: "2026-11-19T12:00:00+00:00", chunkCount: 2 }]);
    const before = modelRequests.length;
    assert.equal((await POST(request({ title: "faq", content: "Nowa wersja." }))).status, 409);
    assert.equal(modelRequests.length, before);
    const expectedVersions = [{ id: "7", createdAt: "2026-11-19T12:00:00+00:00" }];
    pendingRows.push({ id: "81", document_id: "7", content: "Usuwany stary fragment." }, { id: "82", document_id: "8", content: "Zachowany inny fragment." });
    assert.equal((await POST(request({ title: "FAQ", content: "Nowa wersja.", expectedVersions }))).status, 201);
    assert.deepEqual(modelRequests.at(-1).input, ["Nowa wersja.", "Zachowany inny fragment."]);
    assert.deepEqual(payloads.at(-1).p_expected, expectedVersions);
    assert.equal((await POST(request({ title: "FAQ", content: "Nowa wersja.", expectedVersions: [{ id: "7", createdAt: "2026-11-18T12:00:00Z" }] }))).status, 409);
    assert.equal((await DELETE(request(expectedVersions[0]))).status, 204);
    deleteConflict = true;
    assert.equal((await DELETE(request(expectedVersions[0]))).status, 409);
    deleteConflict = false;
    // Dokument innej osoby jest dla RLS niewidoczny: „Nie znaleziono.”, bez wywołania funkcji SQL.
    hiddenDocument = true;
    const hidden = await DELETE(request(expectedVersions[0]));
    assert.equal(hidden.status, 404);
    assert.equal((await hidden.json()).error.message, "Nie znaleziono.");
    hiddenDocument = false; documentsRows.splice(0);
  });
  await t.test("Strumień pokazuje faktyczne etapy, a błąd embeddingów nie wysyła zakończenia sukcesem", async () => {
    const req = request({ title: "Nowy", content: "Treść dokumentu." }); req.headers.set("accept", "application/x-ndjson");
    const phases = [];
    const result = await readKnowledgeImport(await POST(req), stage => phases.push(stage));
    assert.deepEqual(phases, ["splitting", "embedding", "saving"]); assert.equal(result.title, "Nowy");
    embeddingFailure = true;
    const failedReq = request({ title: "Nowy", content: "Treść dokumentu." }); failedReq.headers.set("accept", "application/x-ndjson");
    const failedPhases = [], response = await POST(failedReq);
    const raw = await response.text(); assert.ok(!raw.includes('"type":"complete"')); assert.ok(raw.includes('"stage":"embedding"'));
    await assert.rejects(readKnowledgeImport(new Response(raw), value => failedPhases.push(value)), /Spróbuj ponownie/);
    assert.deepEqual(failedPhases, ["splitting", "embedding"]); embeddingFailure = false;
  });
  await t.test("Urwany lub niepełny strumień nie daje fałszywego sukcesu", async () => {
    await assert.rejects(readKnowledgeImport(new Response('{"type":"progress","stage":"saving"}\n'), () => {}), /potwierdzenia/);
    await assert.rejects(readKnowledgeImport(new Response('{"type":"complete","result":{}}\n'), () => {}), /potwierdzenia/);
  });
  await t.test("Stałe kawałki mają 300 znaków i zakładkę 50, a domyślny tryb zachowuje akapity", () => {
    const text = Array.from({ length: 600 }, (_, i) => String.fromCharCode(65 + i % 26)).join("");
    const chunks = splitDocument(text, "fixed");
    assert.deepEqual(chunks, [text.slice(0, 300), text.slice(250, 550), text.slice(500)]);
    assert.equal(chunks[0].slice(-50), chunks[1].slice(0, 50));
    assert.equal(chunks[1].slice(-50), chunks[2].slice(0, 50));
    assert.deepEqual(splitDocument("a".repeat(300), "fixed"), ["a".repeat(300)]);
    assert.deepEqual(splitDocument("a".repeat(301), "fixed").map(chunk => chunk.length), [300, 51]);
    assert.deepEqual(splitDocument("\n \t", "fixed"), []);
    assert.deepEqual(splitDocument("A.\n\nB."), ["A.", "B."]);
    assert.equal(documentInputSchema.parse({ title: "Tytuł", content: "Treść" }).chunkingMode, "paragraphs");
    const long = splitDocument("a".repeat(20_000), "fixed");
    assert.equal(long.length, 80); assert.equal(long.reduce((sum, chunk) => sum + chunk.length, 0), 23_950);
    const unicode = splitDocument("😀".repeat(550), "fixed");
    assert.deepEqual(unicode.map(chunk => Array.from(chunk).length), [300, 300]);
  });
  await t.test("Wybrany tryb dociera przez API do embeddingów i zapisu; nieznany tryb jest odrzucany", async () => {
    const text = "a".repeat(300) + "b".repeat(300);
    const result = await POST(request({ title: "Stałe fragmenty", content: text, chunkingMode: "fixed" }));
    assert.equal(result.status, 201); assert.equal((await result.json()).chunkCount, 3);
    assert.deepEqual(payloads.at(-1).p_chunks.map(chunk => chunk.content), splitDocument(text, "fixed"));
    const before = calls;
    assert.equal((await POST(request({ title: "FAQ", content: "Treść", chunkingMode: "unknown" }))).status, 400);
    assert.equal(calls, before);
  });
});

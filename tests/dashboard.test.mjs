import assert from "node:assert/strict";
import test from "node:test";
import { loadApp } from "./app-fixture.mjs";

test("Dashboard podróży — lokalne źródła i atrapa modelu", async t => {
  const app = await loadApp(t);
  const { POST } = await app("app/api/dashboard/route.ts");
  const { createSession } = await app("lib/session.ts");
  const { timeDifferenceMinutes, twoSentences } = await app("lib/travel-dashboard.ts");
  const { countryCurrencies } = await app("lib/country-currency.ts");
  const { dashboardResponseSchema } = await app("lib/dashboard-schema.ts");
  process.env.NODE_ENV = "test";
  process.env.CHAT_PASSWORD = "offline-only";
  process.env.SESSION_SECRET = "offline-secret-".repeat(4);
  process.env.OPENROUTER_API_KEY = "offline-only-key";
  process.env.OPENROUTER_MODEL = "test/model";
  const cookie = `chat-session=${createSession()}`;
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris" }).format(new Date());
  const year = Number(today.slice(0, 4));
  const query = { miasto: "Paryż", data: today };
  const place = { name: "Paryż", latitude: 48.85, longitude: 2.35, country_code: "FR", timezone: "Europe/Paris", admin1: "Île-de-France" };
  const wroclaw = { name: "Wrocław", latitude: 51.1, longitude: 17.03, country_code: "PL", timezone: "Europe/Warsaw", admin1: "Województwo dolnośląskie" };
  let calls = [], ambiguity = false, unknown = false, badWeather = false, badModel = false, badWiki = false, badHolidays = false, rate = 4.25, finish = "stop", providerStatus = 200, lastModel, failedSource = "", hangingSource = "";

  t.mock.method(globalThis, "fetch", async (url, init) => {
    const u = new URL(url); calls.push(u.href);
    if (u.hostname === failedSource) throw new Error("offline single source");
    if (u.hostname === hangingSource) return new Promise(() => {});
    if (u.hostname === "geocoding-api.open-meteo.com" && u.searchParams.get("name") === "Wrocław") return Response.json({ results: [wroclaw] });
    if (u.hostname === "geocoding-api.open-meteo.com") return Response.json({ results: unknown ? [] : ambiguity && !u.searchParams.has("countryCode") ? [place, { ...place, country_code: "US", timezone: "America/New_York", admin1: "Texas" }] : [place] });
    if (u.hostname === "api.open-meteo.com") {
      if (badWeather) throw new Error("offline weather failure");
      return Response.json({ timezone: Number(u.searchParams.get("latitude")) > 50 ? "Europe/Warsaw" : "Europe/Paris", daily_units: { temperature_2m_max: "°C", temperature_2m_min: "°C", precipitation_sum: "mm" }, daily: { time: [u.searchParams.get("start_date")], temperature_2m_max: [9], temperature_2m_min: [2], precipitation_sum: [3], weather_code: [3] } });
    }
    if (u.hostname === "api.nbp.pl") return Response.json({ table: "A", code: "EUR", rates: [{ effectiveDate: today, mid: rate }] });
    if (u.hostname === "date.nager.at") {
      if (badHolidays) return Response.json({}, { status: 503 });
      const requestedYear = Number(u.pathname.split("/").at(-2));
      return Response.json(["01-01", "05-01", "12-25"].map(date => ({ date: `${requestedYear}-${date}`, localName: `Święto ${date}`, countryCode: "FR", global: true, counties: null, types: ["Public"] })).concat([{ date: `${requestedYear}-12-26`, localName: "Regionalne", countryCode: "FR", global: false, counties: ["FR-A"], types: ["Public"] }]));
    }
    if (u.hostname === "pl.wikipedia.org") return Response.json({ query: { pages: [{ ns: 0, title: "Paryż", ...(badWiki ? { missing: true } : { extract: "Paryż jest stolicą Francji. Leży nad Sekwaną. Trzecie zdanie nie będzie pokazane.", fullurl: "https://pl.wikipedia.org/wiki/Pary%C5%BC" }) }] } });
    assert.equal(u.href, "https://openrouter.ai/api/v1/chat/completions");
    lastModel = JSON.parse(init.body);
    if (providerStatus !== 200) return Response.json({ error: { message: "offline" } }, { status: providerStatus });
    return Response.json({ id: "offline", created: 1, model: "actual/test-model", choices: [{ index: 0, finish_reason: finish, message: { role: "assistant", content: badModel ? "niepoprawny format" : JSON.stringify({ sentences: ["Spakuj kurtkę i parasol stosownie do prognozy.", "Przed wyjazdem sprawdź dni wolne od pracy."] }) } }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } });
  });
  const request = (body = query, auth = true, origin = "http://localhost") => new Request("http://localhost/api/dashboard", { method: "POST", headers: { "Content-Type": "application/json", Host: "localhost", Origin: origin, ...(auth ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  async function run(body = query) { const response = await POST(request(body)); assert.equal(response.status, 200); return dashboardResponseSchema.parse(await response.json()); }

  await t.test("Sesja jako pierwsza, origin oraz ścisłe dane przed API i modelem", async () => {
    const noSession = request(query, false);
    noSession.json = () => { throw new Error("Nie wolno czytać body bez sesji"); };
    assert.equal((await POST(noSession)).status, 401);
    assert.equal((await POST(request(query, true, "https://other.invalid"))).status, 403);
    for (const bad of [{}, { ...query, miasto: "x" }, { ...query, data: "2026-02-30" }, { ...query, data: 1 }, { ...query, model: "paid" }, { ...query, send_now: true }]) assert.equal((await POST(request(bad))).status, 400);
    assert.equal(calls.length, 0);
  });
  await t.test("Pięć kart, jednostki, źródła, daty i jedno podsumowanie rzeczywistego modelu", async () => {
    const body = await run();
    assert.equal(Object.keys(body.cards).length, 5);
    for (const card of Object.values(body.cards)) { assert.equal(card.status, "ok"); assert.ok(Date.parse(card.retrievedAt)); assert.ok(card.sourceName); assert.ok(card.sourceUrl.startsWith("https://")); }
    assert.deepEqual(body.cards.weather.data, { date: today, minC: 2, maxC: 9, rainMm: 3, zone: "Europe/Paris" });
    assert.equal(body.cards.currency.data.rates[0].pln, 4.25);
    assert.equal(body.cards.time.data.differenceMinutes, 0);
    assert.equal(body.cards.holidays.data.items.length, 3);
    assert.ok(body.cards.holidays.data.items.every(day => day.date >= today && day.name !== "Regionalne"));
    assert.equal(body.cards.wikipedia.data.sentences.length, 2);
    assert.equal(body.summary.status, "ok"); assert.equal(body.summary.modelId, "actual/test-model");
    assert.equal(lastModel.model, "test/model"); assert.equal(lastModel.messages[0].role, "system");
    assert.equal(lastModel.messages.at(-1).role, "user"); assert.ok(lastModel.response_format.json_schema);
    assert.ok(!JSON.stringify(lastModel.messages).includes("offline-only-key"));
    assert.equal(calls.filter(url => url.includes("chat/completions")).length, 1);
    assert.ok(calls.some(url => url.includes("nbp.pl"))); assert.ok(calls.some(url => url.includes("wikipedia.org/w/api.php")));
  });
  await t.test("Odświeżenie ponownie pobiera kurs i zmienia godzinę pobrania", async () => {
    const first = await run(); rate = 4.5;
    const second = await run(first.query);
    assert.equal(second.cards.currency.data.rates[0].pln, 4.5);
    assert.ok(second.cards.currency.retrievedAt >= first.cards.currency.retrievedAt);
  });
  await t.test("Wrocław i Paryż: dziś, jutro i za tydzień mają walutę niezależną od daty podróży", async () => {
    for (const days of [0, 1, 7]) {
      const selected = new Date(`${today}T12:00:00Z`); selected.setUTCDate(selected.getUTCDate() + days);
      const date = selected.toISOString().slice(0, 10);
      for (const miasto of ["Wrocław", "Paryż"]) {
        const before = calls.length;
        const body = await run({ miasto, data: date });
        assert.equal(body.cards.currency.status, "ok");
        const value = body.cards.currency.data.rates[0];
        assert.equal(value.code, miasto === "Wrocław" ? "PLN" : "EUR");
        if (miasto === "Wrocław") { assert.equal(value.pln, 1); assert.equal(value.published, null); }
        else assert.equal(value.pln, rate);
        const used = calls.slice(before);
        assert.ok(!used.some(url => url.includes("github")));
        if (miasto === "Wrocław") assert.ok(!used.some(url => url.includes("nbp.pl")));
        else assert.ok(used.some(url => url === "https://api.nbp.pl/api/exchangerates/rates/a/EUR/?format=json"));
      }
    }
  });
  await t.test("Niejednoznaczne i nieznane miasto nie uruchamia modelu", async () => {
    ambiguity = true;
    const before = calls.filter(url => url.includes("chat/completions")).length;
    const response = await POST(request()); assert.equal(response.status, 422);
    const body = await response.json(); assert.equal(body.choices.length, 2);
    assert.equal(calls.filter(url => url.includes("chat/completions")).length, before);
    assert.equal((await run({ ...query, kraj: "FR", region: "Île-de-France" })).destination.country, "FR");
    ambiguity = false; unknown = true;
    assert.equal((await POST(request())).status, 422); unknown = false;
  });
  await t.test("Awaria jednego źródła zachowuje inne karty i jest przekazana do podsumowania", async () => {
    badWeather = true; badWiki = true; badHolidays = true;
    const body = await run();
    assert.equal(body.cards.weather.status, "error"); assert.equal(body.cards.wikipedia.status, "error"); assert.equal(body.cards.holidays.status, "error");
    assert.equal(body.cards.currency.status, "ok"); assert.equal(body.cards.time.status, "ok");
    const modelData = JSON.parse(lastModel.messages.at(-1).content);
    assert.equal(modelData.cards.weather.status, "error"); assert.ok(!("data" in modelData.cards.weather));
    badWeather = badWiki = badHolidays = false;
  });
  await t.test("Pojedyncza awaria pozostawia cztery OK, bez danych zastępczych, i jest nazwana w podsumowaniu", async () => {
    for (const [host, key, source] of [
      ["api.open-meteo.com", "weather", "Open-Meteo"],
      ["api.nbp.pl", "currency", "NBP"],
      ["date.nager.at", "holidays", "Nager.Date"],
      ["pl.wikipedia.org", "wikipedia", "Polska Wikipedia"],
    ]) {
      failedSource = host;
      const body = await run();
      assert.equal(body.cards[key].status, "error");
      assert.equal("data" in body.cards[key], false);
      assert.equal(Object.values(body.cards).filter(card => card.status === "ok").length, 4);
      assert.equal(body.summary.status, "ok");
      assert.equal(body.summary.sentences.length, 3);
      assert.ok(body.summary.sentences.at(-1).includes(source), host);
    }
    failedSource = "";
  });
  await t.test("API ignorujące abort ma ograniczony czas; cztery wyniki zostają", async child => {
    // Krótszy zegar zachowuje produkcyjną ścieżkę timeout bez czekania 10 s.
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    child.mock.method(AbortSignal, "timeout", milliseconds => timeout(Math.min(milliseconds, 40)));
    hangingSource = "api.open-meteo.com";
    const keepAlive = setInterval(() => {}, 100);
    try {
      const body = await run();
      assert.equal(body.cards.weather.status, "error");
      assert.equal(body.cards.weather.message, "źródło nie odpowiada");
      assert.equal("data" in body.cards.weather, false);
      assert.equal(Object.values(body.cards).filter(card => card.status === "ok").length, 4);
      assert.ok(body.summary.status === "ok" && body.summary.sentences.join(" ").includes("Open-Meteo"));
    } finally { clearInterval(keepAlive); hangingSource = ""; }
  });
  await t.test("Brak źródła pozostaje jawny także przy błędzie lub braku konfiguracji modelu", async () => {
    failedSource = "pl.wikipedia.org"; badModel = true;
    const bad = await run(); assert.equal(bad.summary.status, "error");
    assert.ok(bad.summary.message.includes("Polska Wikipedia")); badModel = false;
    delete process.env.OPENROUTER_API_KEY;
    const noKey = await run(); assert.equal(noKey.summary.status, "error");
    assert.ok(noKey.summary.message.includes("Polska Wikipedia"));
    process.env.OPENROUTER_API_KEY = "offline-only-key"; failedSource = "";
  });
  await t.test("Data poza horyzontem prognozy nie blokuje świąt kolejnego roku", async () => {
    const body = await run({ ...query, data: `${year + 1}-12-30` });
    assert.equal(body.cards.weather.status, "error"); assert.equal(body.cards.holidays.status, "ok");
    assert.equal(body.cards.holidays.data.items[0].date, `${year + 2}-01-01`);
  });
  await t.test("Błąd formatu modelu i brak konfiguracji nie udają poprawnego podsumowania", async () => {
    badModel = true; const body = await run(); badModel = false;
    assert.equal(body.summary.status, "error"); assert.equal(body.cards.currency.status, "ok");
    for (const reason of ["length", "content_filter"]) {
      finish = reason; assert.equal((await run()).summary.status, "error");
    }
    finish = "stop"; providerStatus = 503;
    assert.equal((await run()).summary.status, "error"); providerStatus = 200;
    const before = calls.filter(url => url.includes("chat/completions")).length;
    delete process.env.OPENROUTER_API_KEY;
    const withoutKey = await run(); assert.equal(withoutKey.summary.status, "error");
    assert.equal(calls.filter(url => url.includes("chat/completions")).length, before);
    process.env.OPENROUTER_API_KEY = "offline-only-key";
  });
  await t.test("Waluta kraju: aktualna, bez historycznej i bez umownej jednostki; wiele walut", async () => {
    assert.deepEqual(await countryCurrencies("FR", undefined, new Date("2026-11-12")), ["EUR"]);
    assert.deepEqual(await countryCurrencies("PA"), ["PAB", "USD"]);
    await assert.rejects(countryCurrencies("ZZ"));
    const before = calls.length;
    assert.deepEqual(await countryCurrencies("PL"), ["PLN"]);
    assert.deepEqual(await countryCurrencies("FR"), ["EUR"]);
    assert.equal(calls.length, before, "Ustalenie waluty kraju nie wymaga połączenia z GitHubem ani innym API");
    assert.deepEqual(await countryCurrencies("BG", undefined, new Date("2025-12-31")), ["BGN"]);
    assert.deepEqual(await countryCurrencies("BG", undefined, new Date("2026-02-01")), ["EUR"]);
  });
  await t.test("Różnica czasu uwzględnia DST i ułamkowe strefy; opis ograniczony do dwóch zdań", () => {
    assert.equal(timeDifferenceMinutes("Asia/Tokyo", new Date("2026-01-15T12:00Z")), 480);
    assert.equal(timeDifferenceMinutes("Asia/Tokyo", new Date("2026-07-15T12:00Z")), 420);
    assert.equal(timeDifferenceMinutes("Asia/Kathmandu", new Date("2026-01-15T12:00Z")), 285);
    assert.equal(timeDifferenceMinutes("America/New_York", new Date("2026-03-15T12:00Z")), -300);
    assert.deepEqual(twoSentences("Pierwsze zdanie. Drugie zdanie. Trzecie zdanie."), ["Pierwsze zdanie.", "Drugie zdanie."]);
    assert.deepEqual(twoSentences("Paryż (fr. Paris) to stolica Francji. Leży nad Sekwaną. Trzecie zdanie."), ["Paryż (fr. Paris) to stolica Francji.", "Leży nad Sekwaną."]);
  });
});

import assert from "node:assert/strict";
import test from "node:test";
import { loadApp } from "./app-fixture.mjs";

test("Porównanie miast — dane lokalne i atrapa OpenRouter", async t => {
  const app = await loadApp(t);
  const { POST } = await app("app/api/dashboard/route.ts");
  const { createTestSession } = await app("lib/auth.ts");
  const { dashboardComparisonResponseSchema } = await app("lib/dashboard-schema.ts");
  process.env.NODE_ENV = "test";

  process.env.OPENROUTER_API_KEY = "comparison-test-key"; process.env.OPENROUTER_MODEL = "test/model";
  const cookie = `chat-session=${createTestSession()}`;
  const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date());
  const query = { mode: "compare", data: date, cities: [{ miasto: "Paryż" }, { miasto: "Rzym" }] };
  const paris = { name: "Paryż", latitude: 48.85, longitude: 2.35, country_code: "FR", timezone: "Europe/Paris", admin1: "Île-de-France" };
  const rome = { name: "Rzym", latitude: 41.9, longitude: 12.5, country_code: "IT", timezone: "Europe/Rome", admin1: "Lacjum" };
  let calls = [], generations = 0, lastModel, output, badRomeWeather = false, unknown = false, ambiguity = false, badModel = false, finish = "stop", modelStatus = 200;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const u = new URL(url); calls.push(u.href);
    if (u.hostname === "geocoding-api.open-meteo.com") {
      const name = u.searchParams.get("name");
      if (unknown && name !== "Paryż") return Response.json({ results: [] });
      const city = name === "Paryż" ? paris : rome;
      const results = ambiguity && city === rome && !u.searchParams.has("countryCode") ? [rome, { ...rome, country_code: "US", admin1: "Georgia", timezone: "America/New_York" }] : [city];
      return Response.json({ results });
    }
    if (u.hostname === "api.open-meteo.com") {
      const isRome = Number(u.searchParams.get("latitude")) < 45;
      if (isRome && badRomeWeather) throw new Error("offline");
      return Response.json({ timezone: isRome ? "Europe/Rome" : "Europe/Paris", daily_units: { temperature_2m_max: "°C", temperature_2m_min: "°C", precipitation_sum: "mm" }, daily: { time: [u.searchParams.get("start_date")], temperature_2m_min: [isRome ? 12 : 2], temperature_2m_max: [isRome ? 20 : 9], precipitation_sum: [isRome ? 0 : 3], weather_code: [3] } });
    }
    if (u.hostname === "api.nbp.pl") return Response.json({ table: "A", code: "EUR", rates: [{ effectiveDate: date, mid: 4.25 }] });
    if (u.hostname === "date.nager.at") {
      const parts = u.pathname.split("/");
      return Response.json(["01-01", "05-01", "12-25"].map(day => ({ date: `${parts.at(-2)}-${day}`, localName: "Święto", countryCode: parts.at(-1), global: true, counties: null, types: ["Public"] })));
    }
    if (u.hostname === "pl.wikipedia.org") {
      const title = u.searchParams.get("titles");
      return Response.json({ query: { pages: [{ ns: 0, title, extract: `${title} to miasto w Europie. Jest stolicą kraju.`, fullurl: `https://pl.wikipedia.org/wiki/${encodeURIComponent(title)}` }] } });
    }
    assert.equal(u.href, "https://openrouter.ai/api/v1/chat/completions");
    generations++; lastModel = JSON.parse(init.body);
    if (modelStatus !== 200) return Response.json({ error: { message: "offline" } }, { status: modelStatus });
    const valid = { recommendedIndex: 1, reasons: [
      { cityIndex: 0, card: "weather", explanation: "Paryż ma opady w prognozie na ten dzień." },
      { cityIndex: 1, card: badRomeWeather ? "time" : "weather", explanation: badRomeWeather ? "Rzym ma tę samą aktualną godzinę co Polska; wybór jest ograniczony brakiem prognozy." : "Rzym ma mniej prognozowanych opadów, więc polecam go na spacer." },
    ] };
    return Response.json({ id: "comparison-local", created: 1, model: "actual/comparison-model", choices: [{ index: 0, finish_reason: finish, message: { role: "assistant", content: badModel ? "odmowa" : JSON.stringify(output ?? valid) } }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } });
  });
  const request = (body = query, auth = true, origin = "http://localhost") => new Request("http://localhost/api/dashboard", { method: "POST", headers: { "Content-Type": "application/json", Host: "localhost", Origin: origin, ...(auth ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  async function run(body = query) { const response = await POST(request(body)); assert.equal(response.status, 200); return dashboardComparisonResponseSchema.parse(await response.json()); }

  await t.test("Sesja przed body/API, origin i dokładnie dwa różne miasta na jedną datę", async () => {
    const unauthenticated = request(query, false); unauthenticated.json = () => { throw Error("body przed sesją"); };
    assert.equal((await POST(unauthenticated)).status, 401);
    assert.equal((await POST(request(query, true, "https://other.invalid"))).status, 403);
    for (const body of [
      { ...query, cities: [query.cities[0]] }, { ...query, cities: [...query.cities, { miasto: "Berlin" }] },
      { ...query, cities: [{ miasto: "Paryż" }, { miasto: " paryż " }] },
      { ...query, cities: [{ miasto: "Paryż", data: date }, { miasto: "Rzym" }] },
      { ...query, data: "2026-02-30" }, { ...query, model: "paid" }, { ...query, send_now: true },
      { ...query, cities: [{ miasto: "Paryż", permissions: ["mail"] }, { miasto: "Rzym" }] },
    ]) assert.equal((await POST(request(body))).status, 400);
    assert.equal(calls.length, 0);
  });
  await t.test("Dziesięć niezależnych kart i jedno wywołanie rekomendacji po zebraniu obu miast", async () => {
    const body = await run();
    assert.equal(body.cities.length, 2); assert.equal(generations, 1);
    for (const city of body.cities) {
      assert.equal(city.status, "ok"); assert.equal(city.report.query.data, date);
      assert.equal(Object.keys(city.report.cards).length, 5);
      assert.ok(Object.values(city.report.cards).every(card => card.status === "ok" && Date.parse(card.retrievedAt)));
    }
    assert.equal(body.cities[0].report.cards.weather.data.rainMm, 3);
    assert.equal(body.cities[1].report.cards.weather.data.rainMm, 0);
    assert.equal(body.recommendation.status, "ok"); assert.equal(body.recommendation.recommendedIndex, 1);
    assert.equal(body.recommendation.modelId, "actual/comparison-model");
    assert.ok(body.recommendation.reasons[0].evidence.includes("3 mm"));
    assert.ok(body.recommendation.reasons[1].evidence.includes("0 mm"));
    assert.deepEqual(body.recommendation.missingSources, []);
    const data = JSON.parse(lastModel.messages.at(-1).content);
    assert.equal(data.cities[0].destination.city, "Paryż"); assert.equal(data.cities[1].destination.city, "Rzym");
    assert.ok(!("summary" in data.cities[0])); assert.equal(lastModel.messages[0].role, "system");
    assert.ok(lastModel.response_format.json_schema); assert.ok(!JSON.stringify(data).includes("comparison-test-key"));
  });
  await t.test("Odświeżenie zachowuje doprecyzowane kraje i ponownie pobiera obie lokalizacje", async () => {
    const first = await run(); const before = calls.length;
    const second = await run(first.query);
    assert.equal(second.query.cities[0].kraj, "FR"); assert.equal(second.query.cities[1].kraj, "IT");
    assert.ok(calls.length > before); assert.ok(second.recommendation.retrievedAt >= first.recommendation.retrievedAt);
  });
  await t.test("Awaria jednej prognozy zachowuje dziewięć kart; rekomendacja wskazuje źródło i miasto", async () => {
    badRomeWeather = true;
    const body = await run();
    assert.equal(body.cities[0].status, "ok"); assert.equal(body.cities[1].status, "ok");
    assert.equal(body.cities[1].report.cards.weather.status, "error"); assert.ok(!("data" in body.cities[1].report.cards.weather));
    assert.equal(body.cities.flatMap(city => Object.values(city.report.cards)).filter(card => card.status === "ok").length, 9);
    assert.equal(body.recommendation.status, "ok");
    assert.ok(body.recommendation.missingSources[0].includes("Rzym")); assert.ok(body.recommendation.missingSources[0].includes("Open-Meteo"));
    output = { recommendedIndex: 1, reasons: [{ cityIndex: 0, card: "weather", explanation: "Paryż: opady." }, { cityIndex: 1, card: "weather", explanation: "Niedostępna prognoza nie jest dowodem." }] };
    const rejected = await run(); assert.equal(rejected.recommendation.status, "error");
    assert.equal(rejected.cities[0].report.cards.weather.status, "ok"); output = undefined; badRomeWeather = false;
  });
  await t.test("Nieznane lub niejednoznaczne miasto pozostawia drugie, bez fikcyjnego zwycięzcy", async () => {
    unknown = true; let before = generations;
    const body = await run(); assert.equal(body.cities[0].status, "ok"); assert.equal(body.cities[1].status, "error");
    assert.equal(body.recommendation.status, "error"); assert.equal(generations, before);
    unknown = false; ambiguity = true;
    const choices = await run(); assert.equal(choices.cities[1].status, "error"); assert.equal(choices.cities[1].choices.length, 2);
    const resolved = await run({ ...query, cities: [query.cities[0], { miasto: "Rzym", kraj: "IT", region: "Lacjum" }] });
    assert.equal(resolved.recommendation.status, "ok"); ambiguity = false;
  });
  await t.test("Aliasy tego samego miasta zachowują karty, ale nie wywołują rekomendacji", async () => {
    const before = generations;
    const body = await run({ ...query, cities: [{ miasto: "Rzym" }, { miasto: "Roma" }] });
    assert.equal(body.cities[0].status, "ok"); assert.equal(body.cities[1].status, "ok");
    assert.equal(body.recommendation.status, "error"); assert.equal(generations, before);
  });
  await t.test("Błąd schematu, wskazanie trzeciego miasta i dodatkowe pole nie stają się rekomendacją", async () => {
    const base = { recommendedIndex: 1, reasons: [{ cityIndex: 0, card: "weather", explanation: "Prognoza Paryża." }, { cityIndex: 1, card: "weather", explanation: "Prognoza Rzymu." }] };
    for (const bad of [{ ...base, recommendedIndex: 2 }, { ...base, send_now: true }, { ...base, reasons: [base.reasons[0], base.reasons[0]] }, { ...base, reasons: [{ ...base.reasons[0], card: "hotel" }, base.reasons[1]] }, { ...base, reasons: [{ ...base.reasons[0], evidence: "zmyślone" }, base.reasons[1]] }]) {
      output = bad; const body = await run(); assert.equal(body.recommendation.status, "error"); assert.equal(body.cities[0].status, "ok");
    }
    output = undefined;
  });
  await t.test("Odmowa, ucięcie, błąd dostawcy i brak klucza zachowują obie kolumny", async () => {
    badModel = true; assert.equal((await run()).recommendation.status, "error"); badModel = false;
    finish = "length"; assert.equal((await run()).recommendation.status, "error"); finish = "stop";
    modelStatus = 503; assert.equal((await run()).recommendation.status, "error"); modelStatus = 200;
    delete process.env.OPENROUTER_API_KEY; const before = generations; const body = await run();
    assert.equal(body.recommendation.status, "error"); assert.ok(body.cities.every(city => city.status === "ok")); assert.equal(generations, before);
  });
});

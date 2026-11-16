import assert from "node:assert/strict";
import test from "node:test";
import { loadApp } from "./app-fixture.mjs";

test("Długość dnia — lokalne dane, bez wywołań modelu", async t => {
  const app = await loadApp(t);
  const { dlugoscDnia, daylightInputSchema, formatSunTime } = await app("lib/daylight.ts");
  const { usedChatTools } = await app("lib/used-chat-tools.ts");
  const { messageSources } = await app("lib/message-sources.ts");
  const { POST } = await app("app/api/agent/route.ts");
  const { createSession } = await app("lib/session.ts");
  process.env.NODE_ENV = "test";
  process.env.CHAT_PASSWORD = "offline-password";
  process.env.SESSION_SECRET = "offline-session-secret-".repeat(4);
  process.env.OPENROUTER_API_KEY = "offline-api-key";
  process.env.OPENROUTER_MODEL = "test/chat";
  const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const epoch = time => Date.parse(`${date}T${time}:00Z`) / 1000;
  const input = { miasto: "Kraków", kraj: "PL", region: "Małopolskie", data: date };
  const place = { name: "Kraków", country_code: "PL", latitude: 50.06, longitude: 19.94, timezone: "Europe/Warsaw", admin1: "Województwo małopolskie" };
  const fixture = () => ({ timezone: "Europe/Warsaw", utc_offset_seconds: 3600,
    daily_units: { time: "unixtime", sunrise: "unixtime", sunset: "unixtime", daylight_duration: "s" },
    daily: { time: [epoch("00:00") - 3600], sunrise: [epoch("06:00")], sunset: [epoch("16:00")], daylight_duration: [36000] }, extra: "Nie zwracaj tego pola" });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("Sieć wyłączona w teście"); });

  await t.test("Walidacja daty, pól i typów przed siecią; sesja przed narzędziem", async () => {
    for (const value of [{ ...input, data: "2026-02-30" }, { ...input, miasto: "" }, { ...input, kraj: "Polska" }, { ...input, data: 1 }, { ...input, url: "http://localhost" }, { ...input, permissions: { admin: true } }]) {
      assert.equal(daylightInputSchema.safeParse(value).success, false);
      assert.equal((await dlugoscDnia(value)).ok, false);
    }
    assert.equal((await POST(new Request("http://localhost/api/agent", { method: "POST", body: "invalid" }))).status, 401);
    assert.equal(calls, 0);
  });

  await t.test("Zapytanie i wybrane pola, lokalne godziny, jednostka, źródło i czas pobrania", async t => {
    const urls = [];
    t.mock.method(globalThis, "fetch", async (url, init) => {
      url = new URL(url); urls.push(url);
      assert.equal(init.headers.Authorization, undefined); assert.equal(init.headers.Cookie, undefined);
      assert.equal(init.redirect, "error"); assert.equal(init.cache, "no-store");
      if (url.hostname.startsWith("geocoding")) { assert.equal(url.searchParams.get("name"), "Kraków"); assert.equal(url.searchParams.get("countryCode"), "PL"); return Response.json({ results: [place] }); }
      assert.equal(url.hostname, "api.open-meteo.com");
      assert.equal(url.searchParams.get("daily"), "sunrise,sunset,daylight_duration"); assert.equal(url.searchParams.get("timeformat"), "unixtime");
      assert.equal(url.searchParams.get("timezone"), "Europe/Warsaw"); assert.equal(url.searchParams.get("start_date"), date); assert.equal(url.searchParams.get("end_date"), date);
      return Response.json(fixture());
    });
    const result = await dlugoscDnia(input);
    assert.equal(result.ok, true); assert.equal(result.dlugoscDnia, "10 godz. 0 min"); assert.equal(result.dlugoscDniaSekundy, 36000);
    assert.equal(result.wschod, formatSunTime(epoch("06:00"), "Europe/Warsaw"));
    assert.equal(result.zachod, formatSunTime(epoch("16:00"), "Europe/Warsaw"));
    assert.equal(result.strefa, "Europe/Warsaw"); assert.equal("extra" in result, false);
    assert.equal(result.source, "https://open-meteo.com/"); assert.ok(Number.isFinite(Date.parse(result.retrievedAt)));
    assert.equal(urls.length, 2);
    assert.equal(formatSunTime(Date.parse("2026-10-25T00:30:00Z") / 1000, "Europe/Warsaw"), "02:30");
    assert.equal(formatSunTime(Date.parse("2026-10-25T01:30:00Z") / 1000, "Europe/Warsaw"), "02:30");
    assert.equal(formatSunTime(Date.parse("2026-03-29T01:30:00Z") / 1000, "Europe/Warsaw"), "03:30");
  });

  await t.test("Brak miasta, niejednoznaczność i data poza zakresem nie uruchamiają drugiego API", async t => {
    let places = [], requests = 0;
    t.mock.method(globalThis, "fetch", async url => { requests++; assert.equal(new URL(url).hostname, "geocoding-api.open-meteo.com"); return Response.json({ results: places }); });
    assert.equal((await dlugoscDnia(input)).ok, false);
    places = [place, { ...place, latitude: 50.1 }]; assert.equal((await dlugoscDnia(input)).miejsca.length, 2);
    places = [place]; assert.equal((await dlugoscDnia({ ...input, data: "1970-01-01" })).ok, false);
    const tooFar = new Date(`${date}T00:00:00Z`); tooFar.setUTCDate(tooFar.getUTCDate() + 16);
    assert.equal((await dlugoscDnia({ ...input, data: tooFar.toISOString().slice(0, 10) })).ok, false);
    assert.equal(requests, 4);
  });

  await t.test("Dzień i noc polarna: brak fikcyjnych godzin o północy", async t => {
    let seconds = 0, sunrise = null, sunset = null;
    t.mock.method(globalThis, "fetch", async url => new URL(url).hostname.startsWith("geocoding") ? Response.json({ results: [place] })
      : Response.json({ ...fixture(), daily: { ...fixture().daily, sunrise: [sunrise], sunset: [sunset], daylight_duration: [seconds] } }));
    for (const duration of [0, 86400]) {
      seconds = duration;
      for (const placeholder of [null, epoch("00:00")]) {
        sunrise = sunset = placeholder;
        const result = await dlugoscDnia(input);
        assert.equal(result.ok, true); assert.equal(result.wschod, null); assert.equal(result.zachod, null);
        assert.match(result.uwaga, /polar/); assert.equal(result.dlugoscDniaSekundy, duration);
      }
    }
    seconds = 36000; sunrise = sunset = null;
    assert.equal((await dlugoscDnia(input)).ok, false);
  });

  await t.test("Niekompletne, niespójne dane, błąd dostawcy, timeout i przerwanie pozostają błędami", async t => {
    let makeResponse;
    t.mock.method(globalThis, "fetch", async url => new URL(url).hostname.startsWith("geocoding") ? Response.json({ results: [place] }) : makeResponse());
    const f = fixture();
    const invalid = [
      {}, { ...f, timezone: "UTC" }, { ...f, daily_units: { ...f.daily_units, daylight_duration: "h" } },
      { ...f, daily: { ...f.daily, time: [epoch("00:00") - 3600 - 86400] } },
      { ...f, daily: { ...f.daily, daylight_duration: [-1] } },
      { ...f, daily: { ...f.daily, daylight_duration: [86401] } },
      { ...f, daily: { ...f.daily, sunrise: [] } },
      { ...f, daily: { ...f.daily, sunrise: [epoch("18:00")] } },
      { ...f, daily: { ...f.daily, sunrise: [epoch("06:00") - 86400], sunset: [epoch("16:00") - 86400] } },
    ];
    for (const value of invalid) {
      makeResponse = () => Response.json(value);
      const result = await dlugoscDnia(input); assert.equal(result.ok, false); assert.equal("wschod" in result, false); assert.ok(result.message);
    }
    for (const handler of [() => new Response("bad", { status: 503 }), () => new Response("bad json"),
      () => { throw new DOMException("timeout", "TimeoutError"); },
      () => new Response(new ReadableStream({ start(c) { c.error(new Error("cut")); } })),
    ]) { makeResponse = handler; assert.equal((await dlugoscDnia(input)).ok, false); }
    t.mock.method(globalThis, "fetch", async () => { throw new DOMException("abort", "AbortError"); });
    assert.equal((await dlugoscDnia(input, AbortSignal.abort())).ok, false);
  });

  await t.test("Function calling i źródło oraz etykieta w streamie /api/agent", async t => {
    const requests = [];
    t.mock.method(globalThis, "fetch", async (url, init) => {
      const host = new URL(url).hostname;
      if (host.startsWith("geocoding")) return Response.json({ results: [place] });
      if (host === "api.open-meteo.com") return Response.json(fixture());
      assert.equal(host, "openrouter.ai"); const body = JSON.parse(init.body); requests.push(body);
      assert.ok(body.tools.some(tool => tool.function?.name === "dlugoscDnia"));
      const first = requests.length === 1;
      const chunk = { id: "test", model: "test/chat", choices: [{ index: 0, delta: first
        ? { role: "assistant", tool_calls: [{ index: 0, id: "day-call", type: "function", function: { name: "dlugoscDnia", arguments: JSON.stringify(input) } }] }
        : { role: "assistant", content: "Dzień trwa 10 godzin." }, finish_reason: first ? "tool_calls" : "stop" }] };
      return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } });
    });
    const response = await POST(new Request("http://localhost/api/agent", { method: "POST", headers: {
      Host: "localhost", Origin: "http://localhost", Cookie: `chat-session=${createSession()}`, "Content-Type": "application/json",
    }, body: JSON.stringify({ mode: "chat", messages: [{ id: "q", role: "user", parts: [{ type: "text", text: "Sprawdź długość dnia w Krakowie." }] }] }) }));
    const text = await response.text();
    const events = text.split("\n").filter(line => line.startsWith("data: {")).map(line => JSON.parse(line.slice(6)));
    assert.equal(events.some(event => event.type === "error"), false, text);
    const output = events.find(event => event.type === "tool-output-available").output; assert.equal(output.ok, true);
    assert.equal(requests.length, 2); assert.ok(text.includes("Dzień trwa 10 godzin."));
    const message = { id: "a", role: "assistant", parts: [{ type: "tool-dlugoscDnia", toolCallId: "day-call", state: "output-available", input, output }] };
    assert.deepEqual(usedChatTools(message), ["🌅 długość dnia"]);
    assert.equal(messageSources(message)[0].url, "https://open-meteo.com/");
    assert.equal(messageSources(message)[0].timestamp, output.retrievedAt);
  });
});

import assert from "node:assert/strict";
import test from "node:test";
import { loadApp } from "./app-fixture.mjs";

test("Edytor profilu — prawdziwy klient Supabase z atrapą HTTP", async t => {
  const app = await loadApp(t, { profile: true });
  const { GET, PATCH, DELETE } = await app("app/api/profile/route.ts");
  const { createSession } = await app("lib/session.ts");
  process.env.NODE_ENV = "test";
  process.env.CHAT_PASSWORD = "editor-test-only-password";
  process.env.SESSION_SECRET = "editor-test-only-secret-".repeat(4);
  process.env.SUPABASE_URL = "https://editor.test";
  process.env.SUPABASE_SECRET_KEY = "editor-test-only-key";
  const cookie = `chat-session=${createSession()}`;
  const id = "9007199254740999";
  let row = { id, name: "Andrzej", preferences: { miasto: "Łódź", response_detail: "krotko", ulubione_jedzenie: "żurek", hobby: "czytanie" } };
  let calls = 0, updates = 0, inserts = 0, conflict = false, fail = false;
  const request = (method, body, { auth = true, origin = "http://localhost" } = {}) => new Request("http://localhost/api/profile", {
    method, headers: { host: "localhost", origin, "content-type": "application/json", ...(auth ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  t.mock.method(globalThis, "fetch", async (input, init = {}) => {
    calls++;
    const url = new URL(input);
    assert.equal(url.hostname, "editor.test");
    assert.equal(init.cache, "no-store");
    if (fail) return Response.json({ code: "42501", message: "PRIVATE_DATABASE_MESSAGE" }, { status: 403 });
    if (url.pathname === "/rest/v1/rpc/save_studio_profile") {
      inserts++;
      const body = JSON.parse(init.body);
      assert.equal(row, null);
      row = { id, name: body.p_name, preferences: body.p_preferences };
      return Response.json([{ name: row.name, preferences: row.preferences }]);
    }
    assert.equal(url.pathname, "/rest/v1/user_profiles");
    if (init.method === "GET") {
      if (url.searchParams.get("select").includes("id")) assert.equal(url.searchParams.get("select"), "id::text,name,preferences");
      return Response.json(row ? [row] : []);
    }
    assert.equal(init.method, "PATCH");
    updates++;
    assert.equal(url.searchParams.get("id"), `eq.${id}`);
    assert.equal(url.searchParams.get("name"), row.name === null ? "is.null" : `eq.${row.name}`);
    assert.equal(url.searchParams.get("preferences"), `eq.${JSON.stringify(row.preferences)}`);
    if (conflict) { conflict = false; row.preferences.miasto = "Kraków"; return Response.json(null); }
    Object.assign(row, JSON.parse(init.body));
    return Response.json({ name: row.name, preferences: row.preferences });
  });

  await t.test("401 przed bazą i odczytem body dla wszystkich metod; obce źródło ma 403", async () => {
    const before = calls;
    for (const handler of [GET, PATCH, DELETE]) {
      assert.equal((await handler({ headers: new Headers(), json() { throw new Error("Nie czytaj body"); } })).status, 401);
    }
    for (const [method, handler] of [["PATCH", PATCH], ["DELETE", DELETE]]) {
      assert.equal((await handler(request(method, undefined, { origin: "https://obca.test" }))).status, 403);
    }
    assert.equal(calls, before);
  });
  await t.test("Odczyt bez cache; zmiana imienia zachowuje ten sam id i wszystkie preferencje", async () => {
    const loaded = await GET(request("GET"));
    assert.equal(loaded.headers.get("cache-control"), "no-store");
    assert.equal((await loaded.json()).name, "Andrzej");
    const preferences = structuredClone(row.preferences);
    const changed = await PATCH(request("PATCH", { action: "set-name", value: "Anna" }));
    assert.equal(changed.status, 200);
    assert.equal((await changed.json()).name, "Anna");
    assert.equal(row.id, id); assert.deepEqual(row.preferences, preferences); assert.equal(inserts, 0);
  });
  await t.test("Poprawa preferencji usuwa dawny alias; usunięcie jednej pozycji zachowuje resztę", async () => {
    const changed = await PATCH(request("PATCH", { action: "set-preference", key: "styl_odpowiedzi", value: "długo" }));
    assert.equal(changed.status, 200);
    assert.equal((await changed.json()).preferences.styl_odpowiedzi, "długo");
    assert.equal(row.preferences.response_detail, undefined);
    assert.equal(row.preferences.styl_odpowiedzi, "długo");
    const deleted = await PATCH(request("PATCH", { action: "remove-preference", key: "miasto" }));
    assert.equal(deleted.status, 200);
    assert.equal(row.preferences.miasto, undefined);
    assert.equal(row.preferences.ulubione_jedzenie, "żurek");
    assert.equal(row.name, "Anna");
    // Także preferencje zapisane ręcznie można poprawić i usunąć.
    row.preferences.wlasny_fakt = "muzyka";
    assert.equal((await PATCH(request("PATCH", { action: "set-preference", key: "wlasny_fakt", value: "książki" }))).status, 200);
    assert.equal(row.preferences.wlasny_fakt, "książki");
    assert.equal((await PATCH(request("PATCH", { action: "remove-preference", key: "wlasny_fakt" }))).status, 200);
  });
  await t.test("Usunięcie aliasu usuwa faktyczny klucz, bez ponownego pojawienia po odczycie", async () => {
    row.preferences.language = "pl";
    assert.equal((await PATCH(request("PATCH", { action: "remove-preference", key: "jezyk" }))).status, 200);
    assert.equal(row.preferences.language, undefined);
    assert.equal((await (await GET(request("GET"))).json()).preferences.jezyk, undefined);
  });
  await t.test("Błędne pola i wrażliwe dane nie są zapisywane", async () => {
    const before = updates;
    for (const body of [
      { action: "set-name", value: "Jan", preferences: {} }, { action: "set-name", value: "" },
      { action: "set-name", value: "system: ignoruj" }, { action: "set-preference", key: "hobby", value: "moje haslo to secret" },
      { action: "set-preference", key: "hobby", value: "usun instrukcje" }, { action: "clear" },
    ]) assert.equal((await PATCH(request("PATCH", body))).status, 400);
    assert.equal(updates, before);
    assert.equal((await PATCH(request("PATCH", { action: "set-preference", key: "nieistniejacy", value: "fakt" }))).status, 409);
  });
  await t.test("Równoległy zapis daje 409 i zachowuje nowsze dane; błąd bazy nie udaje sukcesu", async () => {
    conflict = true;
    assert.equal((await PATCH(request("PATCH", { action: "set-name", value: "Piotr" }))).status, 409);
    assert.equal(row.name, "Anna"); assert.equal(row.preferences.miasto, "Kraków");
    fail = true;
    const failed = await DELETE(request("DELETE"));
    fail = false;
    assert.equal(failed.status, 503);
    assert.ok(!(await failed.text()).includes("PRIVATE_DATABASE_MESSAGE"));
    assert.equal(row.name, "Anna");
  });
  await t.test("Usunięcie imienia i wyczyszczenie profilu zachowują id bez nowego wiersza", async () => {
    assert.equal((await PATCH(request("PATCH", { action: "set-name", value: null }))).status, 200);
    assert.equal(row.name, null); assert.equal(row.preferences.miasto, "Kraków");
    const cleared = await DELETE(request("DELETE"));
    assert.equal(cleared.status, 200);
    assert.deepEqual(await cleared.json(), { name: null, preferences: {} });
    assert.deepEqual(row, { id, name: null, preferences: {} }); assert.equal(inserts, 0);
  });
  await t.test("Pusta tabela: odczyt i czyszczenie nie tworzą wiersza; pierwsze imię używa obecnej funkcji", async () => {
    row = null;
    assert.deepEqual(await (await GET(request("GET"))).json(), { name: null, preferences: {} });
    assert.equal((await DELETE(request("DELETE"))).status, 200); assert.equal(row, null);
    assert.equal((await PATCH(request("PATCH", { action: "set-name", value: "Jan" }))).status, 200);
    assert.equal(inserts, 1); assert.equal(row.name, "Jan");
    assert.equal((await PATCH(request("PATCH", { action: "set-name", value: "Anna" }))).status, 200);
    assert.equal(inserts, 1); assert.equal(row.id, id); assert.equal(row.name, "Anna");
  });
  await t.test("Nowe pola można uzupełnić w pustym profilu; pory są sprawdzane i normalizowane", async () => {
    assert.equal((await PATCH(request("PATCH", { action: "set-preference", key: "ulubiony_kolor", value: "żółty" }))).status, 200);
    for (const [value, saved] of [["do poludnia", "do południa"], ["po południu", "po południu"], ["wieczorem", "wieczorem"]]) {
      assert.equal((await PATCH(request("PATCH", { action: "set-preference", key: "preferowany_czas_kontaktu", value }))).status, 200);
      assert.equal(row.preferences.preferowany_czas_kontaktu, saved);
      assert.equal(row.preferences.ulubiony_kolor, "żółty");
      assert.equal(row.name, "Anna"); assert.equal(row.id, id);
    }
    const before = updates;
    assert.equal((await PATCH(request("PATCH", { action: "set-preference", key: "preferowany_czas_kontaktu", value: "nocą" }))).status, 400);
    assert.equal(updates, before);
    await PATCH(request("PATCH", { action: "remove-preference", key: "ulubiony_kolor" }));
    assert.equal(row.preferences.ulubiony_kolor, undefined);
    assert.equal(row.preferences.preferowany_czas_kontaktu, "wieczorem");
    row = null;
    assert.equal((await PATCH(request("PATCH", { action: "set-preference", key: "preferowany_czas_kontaktu", value: "po poludniu" }))).status, 200);
    assert.equal(row.preferences.preferowany_czas_kontaktu, "po południu");
  });
});

import assert from "node:assert/strict";
import test from "node:test";
import { loadApp } from "./app-fixture.mjs";

test("Logowanie przez Google: adres aplikacji, dane konta i komunikaty błędów", async t => {
  const app = await loadApp(t, { auth: true, profile: true });
  const { appOrigin } = await app("lib/request-origin.ts");
  const { accountDisplay, givenName } = await app("lib/account-display.ts");
  const { rememberAccountName } = await app("lib/user-profile.ts");
  const { userDb } = await app("lib/user-db.ts");
  const { callbackErrorMessage } = await app("lib/auth-errors.ts");
  const withHost = host => new Request("http://0.0.0.0:3000/auth/google", { headers: host ? { host } : {} });
  await t.test("Adres powrotu powstaje z nagłówka Host, bez sztywnego localhosta", () => {
    process.env.NODE_ENV = "development";
    assert.equal(appOrigin(withHost("localhost:3000")), "http://localhost:3000");
    assert.equal(appOrigin(withHost("moj-agent-git-x.vercel.app")), "http://moj-agent-git-x.vercel.app");
    process.env.NODE_ENV = "production";
    assert.equal(appOrigin(withHost("agent.example.com")), "https://agent.example.com");
    process.env.NODE_ENV = "test";
    for (const bad of [null, "", "evil.com/path", "a b", "evil.com@x.com", "x.com:99999999", "[::1]"]) assert.equal(appOrigin(withHost(bad)), null, String(bad));
  });
  await t.test("Imię i avatar: pola Google, rezerwa, tylko https; konto e-mail nie ma żadnego", () => {
    assert.deepEqual(accountDisplay({ full_name: " Anna Nowak ", avatar_url: "https://lh3.googleusercontent.com/a/x=s96-c" }), { name: "Anna Nowak", avatarUrl: "https://lh3.googleusercontent.com/a/x=s96-c" });
    assert.deepEqual(accountDisplay({ name: "Anna", picture: "https://lh3.googleusercontent.com/p" }), { name: "Anna", avatarUrl: "https://lh3.googleusercontent.com/p" });
    assert.deepEqual(accountDisplay({ avatar_url: "http://insecure.example/a.png", picture: "javascript:alert(1)" }), { name: null, avatarUrl: null });
    assert.deepEqual(accountDisplay({ full_name: 5, name: {}, avatar_url: "not a url" }), { name: null, avatarUrl: null });
    assert.deepEqual(accountDisplay(undefined), { name: null, avatarUrl: null });
    assert.equal(accountDisplay({ full_name: "x".repeat(500) }).name.length, 80);
  });
  await t.test("Komunikaty po polsku, bez treści błędu dostawcy", () => {
    for (const code of ["google_cancelled", "google_unavailable", "google_failed", "confirmation", "inny"]) assert.match(callbackErrorMessage(code), /\p{L}/u);
    assert.match(callbackErrorMessage("google_cancelled"), /anulowane/);
    assert.equal(callbackErrorMessage(null), "");
  });
  await t.test("Imię z Google trafia do profilu bez imienia i nie nadpisuje istniejącego", async t => {
    process.env.SUPABASE_URL = "https://google-profile.test";
    let row = null; const calls = [];
    t.mock.method(globalThis, "fetch", async (input, init = {}) => {
      const url = new URL(input);
      assert.equal(url.hostname, "google-profile.test");
      assert.equal(url.pathname, "/rest/v1/user_profiles");
      calls.push(init.method);
      if (init.method === "GET") return Response.json(row ? [{ id: "1", name: row.name }] : []);
      const body = JSON.parse(init.body);
      assert.equal(Object.hasOwn(body, "user_id"), false, "user_id wypełnia baza");
      if (init.method === "POST") { row = { name: body.name, preferences: body.preferences }; return new Response(null, { status: 201 }); }
      assert.equal(init.method, "PATCH");
      assert.equal(url.searchParams.get("id"), "eq.1");
      assert.equal(url.searchParams.get("name"), "is.null");
      row.name = body.name; return new Response(null, { status: 204 });
    });
    const db = await userDb(new Request("http://localhost/auth/callback", { headers: { cookie: "chat-session=test" } }));
    assert.equal(givenName("Anna Nowak"), "Anna");
    assert.equal(givenName("  "), null);
    assert.equal(givenName(null), null);
    await rememberAccountName(db, givenName("Anna Nowak"));
    assert.deepEqual(row, { name: "Anna", preferences: {} });
    await rememberAccountName(db, "Marek");
    assert.equal(row.name, "Anna", "Istniejące imię zostaje");
    row = { name: null, preferences: { ulubiony_kolor: "zielony" } };
    await rememberAccountName(db, "Zofia");
    assert.deepEqual(row, { name: "Zofia", preferences: { ulubiony_kolor: "zielony" } });
    const before = calls.length;
    for (const bad of [null, "", "Anna<script>", "12345", "a".repeat(80)]) await rememberAccountName(db, bad);
    assert.equal(calls.length, before, "Niepoprawne imię nie dotyka bazy");
    t.mock.method(globalThis, "fetch", async () => { throw new Error("Awaria sieci"); });
    await rememberAccountName(db, "Ewa");
  });
});

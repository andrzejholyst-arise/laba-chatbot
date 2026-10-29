import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

test("Ochrona czatu i logowania — bez .env i bez wywołań modelu", async (t) => {
  // Kompilujemy faktyczny kod do katalogu tymczasowego. Nie ładujemy .env.
  await mkdir(".next", { recursive: true });
  const temp = await mkdtemp(resolve(".next/auth-tests-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const files = {
    session: "lib/session.ts",
    limit: "lib/login-limit.ts",
    login: "app/api/login/route.ts",
    logout: "app/api/logout/route.ts",
    chat: "app/api/chat/route.ts",
  };
  for (const [name, file] of Object.entries(files)) {
    const source = (await readFile(file, "utf8"))
      .replaceAll('"../../../lib/session"', '"./session.mjs"')
      .replaceAll('"../../../lib/login-limit"', '"./limit.mjs"');
    await writeFile(join(temp, `${name}.mjs`), ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText);
  }
  const load = (name) => import(pathToFileURL(join(temp, `${name}.mjs`)).href);
  const session = await load("session");
  const login = await load("login");
  const logout = await load("logout");
  const chat = await load("chat");
  const { limitLogin } = await load("limit");
  // Wyłącznie sztuczne dane; nigdy nie odczytujemy sekretów użytkownika.
  process.env.NODE_ENV = "test";
  process.env.CHAT_PASSWORD = "warsztat-test-only";
  process.env.SESSION_SECRET = "test-only-secret-".repeat(4);
  process.env.OPENROUTER_API_KEY = "offline-only";
  process.env.OPENROUTER_MODEL = "test/model";
  let externalCalls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    externalCalls++;
    throw new Error("Połączenia zewnętrzne zabronione w teście");
  });
  const req = (path, body, cookie, origin = process.env.NODE_ENV === "production" ? "https://localhost" : "http://localhost") => new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Host: "localhost", Origin: origin, ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });

  await t.test("Brak konfiguracji blokuje logowanie i /api/chat", async () => {
    process.env.CHAT_PASSWORD = "";
    assert.equal((await login.POST(req("/api/login", { password: "x" }))).status, 503);
    assert.equal((await chat.POST(req("/api/chat", {}))).status, 401);
    assert.throws(() => session.createSession());
    process.env.CHAT_PASSWORD = "warsztat-test-only";
    process.env.SESSION_SECRET = "short";
    assert.equal((await login.POST(req("/api/login", { password: "x" }))).status, 503);
    assert.equal(session.validSession("anything"), false);
    process.env.SESSION_SECRET = "test-only-secret-".repeat(4);
  });

  let cookie;
  await t.test("Błędne i poprawne hasło, cookie bez hasła", async () => {
    const bad = await login.POST(req("/api/login", { password: "złe" }));
    assert.equal(bad.status, 401);
    assert.equal(bad.headers.has("set-cookie"), false);
    const good = await login.POST(req("/api/login", { password: "warsztat-test-only" }));
    assert.equal(good.status, 204);
    const header = good.headers.get("set-cookie");
    assert.match(header, /HttpOnly; SameSite=Strict; Max-Age=14400/);
    cookie = header.split(";")[0];
    const token = cookie.slice(cookie.indexOf("=") + 1);
    assert.equal(session.validSession(token), true);
    assert.ok(!Buffer.from(token.split(".")[0], "base64url").toString().includes("warsztat-test-only"));
  });

  await t.test("Podpis, termin ważności i rotacja konfiguracji", () => {
    const now = Date.now();
    const token = session.createSession(now);
    assert.equal(session.validSession(token, now), true);
    assert.equal(session.validSession(`${token}x`, now), false);
    assert.equal(session.validSession(token, now + 14_400_000), false);
    process.env.CHAT_PASSWORD = "nowe-testowe";
    assert.equal(session.validSession(token), false);
    process.env.CHAT_PASSWORD = "warsztat-test-only";
    process.env.SESSION_SECRET = "different-test-only-secret".repeat(3);
    assert.equal(session.validSession(token), false);
    process.env.SESSION_SECRET = "test-only-secret-".repeat(4);
  });

  await t.test("API odmawia bez sesji; poprawna sesja przechodzi do walidacji danych", async () => {
    assert.equal((await chat.POST(req("/api/chat", {}))).status, 401);
    assert.equal((await chat.POST(req("/api/chat", {}, "chat-session=falszywy"))).status, 401);
    assert.equal((await chat.POST(req("/api/chat", { messages: [] }, cookie))).status, 400);
    assert.equal(externalCalls, 0);
  });

  await t.test("Wyjście usuwa cookie; kolejne żądanie bez niego dostaje 401", async () => {
    const response = await logout.POST(req("/api/logout", {}, cookie));
    assert.equal(response.status, 204);
    assert.match(response.headers.get("set-cookie"), /chat-session=;.*Max-Age=0/);
    assert.equal((await chat.POST(req("/api/chat", {}))).status, 401);
  });

  await t.test("Obce pochodzenie jest odrzucane", async () => {
    assert.equal((await login.POST(req("/api/login", {}, undefined, "https://other.invalid"))).status, 403);
    assert.equal((await logout.POST(req("/api/logout", {}, cookie, "https://other.invalid"))).status, 403);
    assert.equal((await chat.POST(req("/api/chat", {}, cookie, "https://other.invalid"))).status, 403);
    assert.equal(session.sameOrigin(new Request("http://0.0.0.0:3000/api/login", {
      headers: { Host: "localhost:3000", Origin: "http://localhost:3000" },
    })), true);
    assert.equal(session.sameOrigin(new Request("http://0.0.0.0:3000/api/login", {
      headers: { Host: "localhost:3000", Origin: "http://localhost:3001" },
    })), false);
    assert.equal(session.sameOrigin(new Request("http://localhost/api/login")), false);
  });

  await t.test("Lokalny limit blokuje także poprawne hasło po wyczerpaniu prób", async () => {
    for (let i = 0; i < 8; i++) assert.equal((await login.POST(req("/api/login", { password: "złe" }))).status, 401);
    const response = await login.POST(req("/api/login", { password: "warsztat-test-only" }));
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "60");
  });

  await t.test("Produkcja: Secure, brak hostingu/reguły/łączności blokuje dostęp", async () => {
    process.env.NODE_ENV = "production";
    process.env.VERCEL = "";
    process.env.VERCEL_URL = "";
    assert.ok(session.authConfigurationError());
    assert.equal(await limitLogin(), "unavailable");
    process.env.VERCEL = "1";
    process.env.VERCEL_URL = "test.vercel.app";
    assert.match(session.sessionCookie(session.createSession()), /^__Host-chat-session=.*; Secure$/);
    assert.match(session.sessionCookie("", true), /Max-Age=0; Secure$/);
    assert.equal(await limitLogin(), "unavailable");
    t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 404 }));
    assert.equal((await login.POST(req("/api/login", { password: "warsztat-test-only" }))).status, 503);
    t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 429 }));
    assert.equal((await login.POST(req("/api/login", { password: "warsztat-test-only" }))).status, 429);
    t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 204 }));
    const good = await login.POST(req("/api/login", { password: "warsztat-test-only" }, undefined, "https://localhost"));
    assert.equal(good.status, 204);
    assert.match(good.headers.get("set-cookie"), /; Secure$/);
    const token = good.headers.get("set-cookie").split(";")[0];
    // Żądanie bez sesji nie dociera nawet do zapory ani do modelu.
    t.mock.method(globalThis, "fetch", async () => { throw new Error("Sieć zabroniona"); });
    assert.equal((await chat.POST(req("/api/chat", {}))).status, 401);
    assert.equal((await chat.POST(req("/api/chat", { messages: [] }, token))).status, 400);
  });
});

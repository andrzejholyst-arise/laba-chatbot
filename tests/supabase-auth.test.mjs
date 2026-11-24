import assert from "node:assert/strict";
import test from "node:test";
import { loadApp } from "./app-fixture.mjs";
import { NextRequest } from "next/server.js";

const jwt = (expiresAt, sub = "untrusted-cookie-id") => [
  { alg: "HS256", typ: "JWT" }, { sub, exp: expiresAt, iat: Math.floor(Date.now() / 1000), session_id: "test-session" },
].map(part => Buffer.from(JSON.stringify(part)).toString("base64url")).join(".") + ".test-signature";
function cookie({ expired = false, token } = {}) {
  const exp = Math.floor(Date.now() / 1000) + (expired ? -100 : 3600);
  return "sb-project-auth-token=base64-" + Buffer.from(JSON.stringify({
    access_token: token ?? jwt(exp), refresh_token: "test-refresh-token", token_type: "bearer", expires_at: exp, expires_in: 3600,
    user: { id: "untrusted-cookie-id", email: "forged@example.test" },
  })).toString("base64url");
}
const user = { id: "verified-by-auth-server", email: "andrzej@example.test", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const request = (path, sessionCookie = "", method = "POST") => new Request(`http://localhost${path}`, {
  method, headers: { Host: "localhost", Origin: "http://localhost", Cookie: sessionCookie, "Content-Type": "application/json" },
  ...(method === "GET" ? {} : { body: "{}" }),
});

test("Supabase Auth: rzeczywisty klient SSR, weryfikacja i odmowa przed bazą/modelem", async t => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test_only";
  const app = await loadApp(t, { auth: true, persistence: true, profile: true, knowledge: true });
  const { verifiedUser } = await app("lib/auth.ts");
  const routes = await Promise.all(["agent", "dashboard", "conversations", "profile", "knowledge", "logout"].map(async name => [name, await app(`app/api/${name}/route.ts`)]));
  await t.test("Każda metoda API bez sesji zwraca 401, bez body, bazy i modelu", async t => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("Sieć zabroniona"); });
    for (const [name, route] of routes) {
      for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
        if (!route[method]) continue;
        const req = request(`/api/${name}`, "chat-session=old-workshop-cookie", method);
        req.json = () => { throw new Error("Nie czytaj body przed sprawdzeniem sesji"); };
        assert.equal((await route[method](req)).status, 401, `${name} ${method}`);
      }
    }
    assert.equal(calls, 0);
  });
  await t.test("Dane użytkownika pochodzą z /auth/v1/user, nie z cookie; jedno sprawdzenie na Request", async t => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async (url, init) => {
      calls++; assert.equal(String(url), "https://project.supabase.co/auth/v1/user");
      assert.match(new Headers(init.headers).get("authorization"), /^Bearer /);
      return Response.json(user);
    });
    const req = request("/api/profile", cookie());
    assert.equal((await verifiedUser(req)).id, user.id);
    assert.equal((await verifiedUser(req)).email, user.email);
    assert.equal(calls, 1);
  });
  await t.test("Odrzucony token i awaria Auth nie dają dostępu mimo user w cookie", async t => {
    t.mock.method(globalThis, "fetch", async () => Response.json({ code: "bad_jwt", message: "Invalid JWT" }, { status: 401 }));
    assert.equal(await verifiedUser(request("/api/profile", cookie())), null);
    assert.equal((await routes[0][1].POST(request("/api/agent", cookie()))).status, 401);
    t.mock.method(globalThis, "fetch", async () => { throw new Error("Auth offline"); });
    assert.equal(await verifiedUser(request("/api/profile", cookie())), null);
  });
  await t.test("Zweryfikowane konto przechodzi do walidacji; obce Origin daje 403", async t => {
    t.mock.method(globalThis, "fetch", async url => {
      assert.equal(String(url), "https://project.supabase.co/auth/v1/user");
      return Response.json(user);
    });
    assert.equal((await routes[0][1].POST(request("/api/agent", cookie()))).status, 400);
    const req = request("/api/agent", cookie()); req.headers.set("Origin", "https://foreign.test");
    assert.equal((await routes[0][1].POST(req)).status, 403);
  });
  const { proxy } = await app("proxy.ts");
  await t.test("Proxy: strony do /login, API 401, logowanie i callback dostępne", async () => {
    for (const path of ["/", "/history", "/profile", "/upload?x=1", "/dashboard", "/unknown"]) {
      const response = await proxy(new NextRequest(`http://localhost${path}`));
      assert.equal(response.status, 307);
      assert.equal(response.headers.get("location"), path === "/" ? "http://localhost/login" : `http://localhost/login?next=${encodeURIComponent(path)}`);
    }
    const { safeNext } = await app("lib/safe-next.ts");
    assert.equal(safeNext("/upload?x=1"), "/upload?x=1");
    for (const bad of ["//evil.com", "https://evil.com", "/\\evil.com", "/login", "/api/agent", "javascript:alert(1)", "", null, "/a\nb"]) assert.equal(safeNext(bad), "/");
    assert.equal((await proxy(new NextRequest("http://localhost/api/agent"))).status, 401);
    for (const path of ["/login", "/auth/callback?code=test"]) assert.equal((await proxy(new NextRequest(`http://localhost${path}`))).status, 200);
  });
  await t.test("Proxy odświeża wygasłą sesję i przekazuje nowe cookies oraz zakaz cache", async t => {
    const calls = [];
    t.mock.method(globalThis, "fetch", async (url, init) => {
      calls.push(String(url));
      if (String(url).includes("/token?grant_type=refresh_token")) {
        assert.equal(JSON.parse(init.body).refresh_token, "test-refresh-token");
        return Response.json({ access_token: jwt(Math.floor(Date.now() / 1000) + 3600, user.id), refresh_token: "new-refresh-token", expires_in: 3600, token_type: "bearer", user });
      }
      assert.equal(String(url), "https://project.supabase.co/auth/v1/user");
      return Response.json(user);
    });
    const response = await proxy(new NextRequest("http://localhost/history", { headers: { Cookie: cookie({ expired: true }) } }));
    assert.equal(response.status, 200);
    assert.ok(calls.some(url => url.includes("grant_type=refresh_token")));
    assert.ok(response.cookies.getAll().some(item => item.name.startsWith("sb-project-auth-token") && item.value));
    assert.equal(response.cookies.get("chat-session"), undefined, "Ciasteczko chat-session nie jest już potrzebne: historię rozdziela user_id");
    assert.match(response.headers.get("cache-control"), /no-store/);
    assert.match(response.headers.get("x-middleware-request-cookie"), /sb-project-auth-token/);
  });
  await t.test("Polskie komunikaty nie pokazują surowych błędów Supabase", async () => {
    const { authErrorMessage } = await app("lib/auth-errors.ts");
    assert.match(authErrorMessage("invalid_credentials"), /e-mail lub hasło/);
    assert.match(authErrorMessage("user_already_exists"), /już istnieje/);
    assert.match(authErrorMessage("weak_password"), /8 znaków/);
    assert.match(authErrorMessage("email_not_confirmed"), /Potwierdź/);
    assert.match(authErrorMessage("email_address_not_authorized", 403), /SMTP.*email_address_not_authorized/);
    assert.match(authErrorMessage(undefined, 401), /publishable.*HTTP 401/);
    assert.match(authErrorMessage(undefined, 0), /AUTH_CONNECTION/);
    assert.match(authErrorMessage("raw-secret-value", 500), /HTTP 500/);
    assert.doesNotMatch(authErrorMessage("raw-secret-value", 500), /raw-secret-value/);
  });
});

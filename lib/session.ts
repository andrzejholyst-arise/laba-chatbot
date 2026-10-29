import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_SECONDS = 60 * 60 * 4;
export const cookieName = () => process.env.NODE_ENV === "production" ? "__Host-chat-session" : "chat-session";

export function authConfigurationError(): string | null {
  if (!process.env.CHAT_PASSWORD || Buffer.byteLength(process.env.SESSION_SECRET ?? "") < 32) {
    return "Brak konfiguracji ochrony. Ustaw CHAT_PASSWORD oraz SESSION_SECRET (minimum 32 bajty) w .env.local i uruchom ponownie serwer.";
  }
  if (process.env.NODE_ENV === "production" && (!process.env.VERCEL_URL || process.env.VERCEL !== "1")) {
    return "Logowanie zablokowane: ten hosting wymaga współdzielonego limitu prób. Obecnie obsługujemy Vercel Firewall.";
  }
  return null;
}

function signature(payload: string) {
  // Zmiana hasła także unieważnia wszystkie wcześniejsze cookies.
  return createHmac("sha256", process.env.SESSION_SECRET!)
    .update(JSON.stringify([payload, process.env.CHAT_PASSWORD]))
    .digest("base64url");
}

export function passwordMatches(password: string) {
  if (authConfigurationError()) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(password), digest(process.env.CHAT_PASSWORD!));
}

export function createSession(now = Date.now()) {
  if (authConfigurationError()) throw new Error("Brak konfiguracji ochrony");
  const payload = Buffer.from(JSON.stringify({
    exp: Math.floor(now / 1000) + SESSION_SECONDS,
    nonce: randomBytes(24).toString("base64url"),
  })).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function validSession(token: string | undefined, now = Date.now()) {
  if (authConfigurationError() || !token || token.length > 1024) return false;
  try {
    const [payload, signed, extra] = token.split(".");
    if (!payload || !signed || extra !== undefined) return false;
    const expected = Buffer.from(signature(payload));
    const actual = Buffer.from(signed);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const seconds = Math.floor(now / 1000);
    return Number.isSafeInteger(data.exp) && data.exp > seconds &&
      data.exp <= seconds + SESSION_SECONDS && typeof data.nonce === "string";
  } catch {
    return false;
  }
}

export function sessionFromRequest(request: Request) {
  return request.headers.get("cookie")?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName()}=`))?.slice(cookieName().length + 1);
}

export function sessionCookie(token: string, logout = false) {
  return `${cookieName()}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${logout ? 0 : SESSION_SECONDS}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try {
    const source = new URL(origin);
    // Next dev może budować request.url z wewnętrznym hostem 0.0.0.0.
    // Host to adres faktycznie wywołany przez przeglądarkę; nie ufamy X-Forwarded-Host.
    return source.origin === origin && source.host === host &&
      (source.protocol === "https:" ||
        (process.env.NODE_ENV !== "production" && source.protocol === "http:"));
  } catch {
    return false;
  }
}

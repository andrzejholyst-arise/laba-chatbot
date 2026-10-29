import { authConfigurationError, createSession, passwordMatches, sameOrigin, sessionCookie } from "../../../lib/session";
import { limitLogin } from "../../../lib/login-limit";

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!sameOrigin(request)) return new Response("Niedozwolone źródło żądania.", { status: 403, headers });
  const error = authConfigurationError();
  if (error) return new Response(error, { status: 503, headers });
  const limit = await limitLogin();
  if (limit === "unavailable") return new Response("Logowanie zablokowane: limit prób na hostingu jest niedostępny lub nieskonfigurowany.", { status: 503, headers });
  if (limit === "limited") return new Response("Za dużo prób. Odczekaj minutę i spróbuj ponownie.", { status: 429, headers: { ...headers, "Retry-After": "60" } });
  // Nie przyjmujemy nieograniczonego body ani wielkich haseł.
  const reader = request.body?.getReader();
  if (!reader) return new Response("Wpisz hasło.", { status: 400, headers });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4096) {
        await reader.cancel();
        return new Response("Zbyt długie hasło.", { status: 413, headers });
      }
      chunks.push(value);
    }
    const { password } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (typeof password !== "string" || !password) return new Response("Wpisz hasło.", { status: 400, headers });
    if (!passwordMatches(password)) return new Response("Nieprawidłowe hasło.", { status: 401, headers });
    return new Response(null, { status: 204, headers: { ...headers, "Set-Cookie": sessionCookie(createSession()) } });
  } catch {
    return new Response("Nieprawidłowe żądanie logowania.", { status: 400, headers });
  }
}

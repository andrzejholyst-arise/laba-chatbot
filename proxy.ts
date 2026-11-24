import { createServerClient } from "@supabase/ssr";
import { safeNext } from "./lib/safe-next";
import { NextResponse, type NextRequest } from "next/server";

function loginAddress(request: NextRequest) {
  const wanted = request.method === "GET" ? safeNext(request.nextUrl.pathname + request.nextUrl.search) : "/";
  return wanted === "/" ? "/login" : `/login?next=${encodeURIComponent(wanted)}`;
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  let authenticated = false;
  if (url && key) {
    try {
      const supabase = createServerClient(url, key, { cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(values, headers) {
          values.forEach(({ name, value }) => request.cookies.set(name, value));
          const previous = response.cookies.getAll();
          response = NextResponse.next({ request });
          previous.forEach(cookie => response.cookies.set(cookie));
          values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
        },
      } });
      // getUser pyta serwer Auth, więc wylogowany lub unieważniony token nie przejdzie
      // aż do własnego wygaśnięcia (getClaims sprawdza tylko podpis i datę).
      const { data, error } = await supabase.auth.getUser();
      authenticated = !error && !!data.user?.id;
    } catch { /* Brak potwierdzonej sesji oznacza brak dostępu. */ }
  }
  const path = request.nextUrl.pathname;
  const publicRoute = path === "/login" || path === "/auth/callback" || path === "/auth/google";
  if (!authenticated && !publicRoute) {
    const denied = path.startsWith("/api/")
      ? NextResponse.json({ error: { message: "Sesja wygasła. Zaloguj się ponownie." } }, { status: 401 })
      : NextResponse.redirect(new URL(loginAddress(request), request.url));
    response.cookies.getAll().forEach(cookie => denied.cookies.set(cookie));
    denied.headers.set("Cache-Control", "private, no-cache, no-store, must-revalidate, max-age=0");
    denied.headers.set("Expires", "0");
    denied.headers.set("Pragma", "no-cache");
    return denied;
  }
  response.headers.set("Cache-Control", "private, no-cache, no-store, must-revalidate, max-age=0");
  response.headers.set("Expires", "0");
  response.headers.set("Pragma", "no-cache");
  return response;
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"] };

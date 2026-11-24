import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { appOrigin, sameOrigin } from "../../../lib/request-origin";
import { safeNext } from "../../../lib/safe-next";
import { serverSupabase } from "../../../lib/supabase-server";

const noStore = { "Cache-Control": "private, no-store" };

// Start logowania przez Google po stronie serwera (PKCE). Przeglądarka wysyła formularz POST;
// serwer zapisuje w ciasteczku kod weryfikujący PKCE i odsyła do dostawcy. Adres powrotu
// powstaje z adresu, pod którym aplikacja właśnie działa. Trzeba go dodać do Redirect URLs w Supabase.
export async function POST(request: Request) {
  const origin = appOrigin(request);
  if (!origin || !sameOrigin(request)) return new Response("Niedozwolone źródło żądania.", { status: 403, headers: noStore });
  const back = (code: string) => NextResponse.redirect(new URL(`/login?error=${code}`, origin), { status: 303, headers: noStore });
  const form = await request.formData().catch(() => null);
  const requested = form?.get("next");
  // Tylko ścieżki wewnątrz aplikacji. Cel zapamiętujemy w krótkim ciasteczku, nie w adresie powrotu,
  // bo Supabase porównuje adres powrotu z listą dozwolonych adresów.
  const next = safeNext(typeof requested === "string" ? requested : null);
  try {
    const supabase = await serverSupabase();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${origin}/auth/callback`, skipBrowserRedirect: true },
    });
    if (error || !data.url) return back("google_unavailable");
    const store = await cookies();
    store.set("oauth-next", next, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/auth", maxAge: 600 });
    return NextResponse.redirect(data.url, { status: 303, headers: noStore });
  } catch {
    return back("google_failed");
  }
}

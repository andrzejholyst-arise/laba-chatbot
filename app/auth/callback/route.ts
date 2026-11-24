import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { appOrigin } from "../../../lib/request-origin";
import { accountDisplay, givenName } from "../../../lib/account-display";
import { rememberAccountName } from "../../../lib/user-profile";
import { safeNext } from "../../../lib/safe-next";
import { serverSupabase } from "../../../lib/supabase-server";

const noStore = { "Cache-Control": "private, no-store" };

// Wspólna trasa powrotu: link potwierdzający z e-maila oraz logowanie przez Google.
// Kod wymieniamy na sesję po stronie serwera; potem przenosimy do czatu albo do zapamiętanej ścieżki.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = appOrigin(request) ?? url.origin;
  const store = await cookies();
  const google = store.has("oauth-next");
  const next = safeNext(store.get("oauth-next")?.value);
  if (google) store.set("oauth-next", "", { httpOnly: true, sameSite: "lax", path: "/auth", maxAge: 0 });
  const back = (code: string) => NextResponse.redirect(new URL(`/login?error=${code}`, origin), { headers: noStore });
  // Anulowanie u dostawcy wraca z parametrem error. Jego treści nie pokazujemy.
  if (url.searchParams.has("error")) return back(url.searchParams.get("error") === "access_denied" ? "google_cancelled" : google ? "google_failed" : "confirmation");
  const code = url.searchParams.get("code");
  if (code) {
    try {
      const supabase = await serverSupabase();
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) {
        // Imię z konta Google trafia do pustego profilu (agent wita po imieniu od pierwszej rozmowy).
        await rememberAccountName(supabase, givenName(accountDisplay(data.user?.user_metadata).name));
        return NextResponse.redirect(new URL(next, origin), { headers: noStore });
      }
    } catch { /* Zwracamy własny komunikat, bez danych dostawcy. */ }
  }
  return back(google ? "google_failed" : "confirmation");
}

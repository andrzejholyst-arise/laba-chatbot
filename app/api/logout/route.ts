import { verifiedUser } from "../../../lib/auth";
import { sameOrigin } from "../../../lib/request-origin";
import { serverSupabase } from "../../../lib/supabase-server";
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store", "Clear-Site-Data": '"cache"' };
  if (!await verifiedUser(request)) return new Response("Zaloguj się ponownie.", { status: 401, headers });
  if (!sameOrigin(request)) return new Response("Niedozwolone źródło żądania.", { status: 403, headers });
  const supabase = await serverSupabase();
  const { error } = await supabase.auth.signOut();
  if (error) return new Response("Nie udało się wylogować. Spróbuj ponownie.", { status: 503, headers });
  return new Response(null, { status: 204, headers });
}

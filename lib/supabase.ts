import "server-only";
import { createClient } from "@supabase/supabase-js";

// Wywołuj dopiero po sprawdzeniu sesji. Import nie łączy się z bazą.
export function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error("Brak konfiguracji bazy: ustaw SUPABASE_URL i SUPABASE_SECRET_KEY na serwerze.");
  }
  return createClient(url, key, {
    db: { retry: false },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, {
      ...init, cache: "no-store",
      signal: AbortSignal.any([AbortSignal.timeout(10_000), ...(init?.signal ? [init.signal] : [])]),
    }) },
  });
}

import "server-only";
import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function serverSupabase(request?: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Brak konfiguracji Supabase Auth.");
  // Endpointy otrzymują odświeżone ciasteczka z proxy. Komponenty/callback używają magazynu Next.
  const store = request ? null : await cookies();
  return createServerClient(url, key, {
    db: { retry: false },
    global: { fetch: (input, init) => fetch(input, {
      ...init, cache: "no-store",
      signal: AbortSignal.any([AbortSignal.timeout(10_000), ...(init?.signal ? [init.signal] : [])]),
    }) },
    cookies: {
      getAll: () => store ? store.getAll() : parseCookieHeader(request!.headers.get("cookie") ?? "").map(({ name, value }) => ({ name, value: value ?? "" })),
      setAll(values) {
        if (!store) return; // Zapisy odświeżenia dla Request wykonuje proxy.ts.
        try { values.forEach(({ name, value, options }) => store.set(name, value, options)); }
        catch { /* W Server Component ciasteczka odświeża proxy. */ }
      },
    },
  });
}

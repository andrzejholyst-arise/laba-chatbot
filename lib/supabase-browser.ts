"use client";
import { createBrowserClient } from "@supabase/ssr";
export class SupabaseAuthConfigurationError extends Error {}

export function browserSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new SupabaseAuthConfigurationError("Ustaw NEXT_PUBLIC_SUPABASE_URL i NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. [AUTH_CONFIG]");
  }
  let projectUrl: URL;
  try {
    projectUrl = new URL(url);
  } catch {
    throw new SupabaseAuthConfigurationError("Wpisz pełny adres projektu Supabase w NEXT_PUBLIC_SUPABASE_URL. [AUTH_CONFIG]");
  }
  if (projectUrl.origin === window.location.origin) {
    throw new SupabaseAuthConfigurationError("NEXT_PUBLIC_SUPABASE_URL wskazuje na Studio Nova. Wpisz Project URL z panelu Supabase i uruchom ponownie aplikację. [AUTH_URL_POINTS_TO_APP]");
  }
  if (["supabase.com", "www.supabase.com"].includes(projectUrl.hostname)) {
    throw new SupabaseAuthConfigurationError("NEXT_PUBLIC_SUPABASE_URL wskazuje na panel Supabase. W panelu wybierz Connect i skopiuj Project URL. [AUTH_URL_POINTS_TO_DASHBOARD]");
  }
  return createBrowserClient(url, key);
}

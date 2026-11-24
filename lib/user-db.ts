import "server-only";
import { serverSupabase } from "./supabase-server";

// Klient bazy z sesją zalogowanej osoby (klucz publishable + ciasteczka).
// Dane rozmów i profilu chroni RLS; kolumnę user_id wypełnia baza (auth.uid()).
// Klucza secret tu nie używamy. Wywołuj po sprawdzeniu sesji przez verifiedUser.
export function userDb(request: Request) {
  return serverSupabase(request);
}

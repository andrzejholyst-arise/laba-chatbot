import "server-only";
import type { User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { serverSupabase } from "./supabase-server";
const verified = new WeakMap<Request, Promise<User | null>>();
async function checkUser(request?: Request): Promise<User | null> {
  try {
    const supabase = await serverSupabase(request);
    // getUser pyta serwer Auth. Zawartość cookie sama nie ustala tożsamości.
    const { data, error } = await supabase.auth.getUser();
    return error ? null : data.user;
  } catch { return null; }
}
export function verifiedUser(request: Request) {
  let result = verified.get(request);
  if (!result) { result = checkUser(request); verified.set(request, result); }
  return result;
}
export async function requirePageUser() {
  const user = await checkUser();
  if (!user) redirect("/login");
  return user;
}

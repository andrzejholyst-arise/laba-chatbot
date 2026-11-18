import type { Metadata } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { cookieName, validSession } from "../../lib/session";
import Profile from "./profile";

export const metadata: Metadata = { title: "Twój profil — Studio Nova" };
async function ProtectedProfile() {
  await connection();
  const store = await cookies();
  if (!validSession(store.get(cookieName())?.value)) redirect("/");
  return <Profile />;
}
export default function ProfilePage() {
  return <Suspense fallback={<p role="status">Sprawdzam dostęp…</p>}><ProtectedProfile /></Suspense>;
}

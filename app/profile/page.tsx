import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { requirePageUser } from "../../lib/auth";
import Profile from "./profile";

export const metadata: Metadata = { title: "Twój profil — Studio Nova" };
async function ProtectedProfile() {
  await connection();
  await requirePageUser();
  return <Profile />;
}
export default function ProfilePage() {
  return <Suspense fallback={<p role="status">Sprawdzam dostęp…</p>}><ProtectedProfile /></Suspense>;
}

import type { Metadata } from "next";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { cookieName, validSession } from "../../lib/session";
import TravelDashboard from "./travel-dashboard";

export const metadata: Metadata = { title: "Podróże — Studio Nova" };
async function ProtectedDashboard() {
  await connection();
  const store = await cookies();
  if (!validSession(store.get(cookieName())?.value)) redirect("/");
  return <TravelDashboard />;
}
export default function DashboardPage() {
  return <Suspense fallback={<p role="status">Sprawdzam dostęp…</p>}><ProtectedDashboard /></Suspense>;
}

import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { requirePageUser } from "../../lib/auth";
import TravelDashboard from "./travel-dashboard";

export const metadata: Metadata = { title: "Podróże — Studio Nova" };
async function ProtectedDashboard() {
  await connection();
  await requirePageUser();
  return <TravelDashboard />;
}
export default function DashboardPage() {
  return <Suspense fallback={<p role="status">Sprawdzam dostęp…</p>}><ProtectedDashboard /></Suspense>;
}

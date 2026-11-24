import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { requirePageUser } from "../../lib/auth";
import History from "./history";

export const metadata: Metadata = { title: "Historia rozmów — Studio Nova" };

async function ProtectedHistory() {
  await connection();
  await requirePageUser();
  return <History />;
}

export default function HistoryPage() {
  return <Suspense fallback={<p role="status">Sprawdzam dostęp…</p>}><ProtectedHistory /></Suspense>;
}

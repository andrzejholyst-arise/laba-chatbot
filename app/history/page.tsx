import type { Metadata } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { cookieName, validSession } from "../../lib/session";
import History from "./history";

export const metadata: Metadata = { title: "Historia rozmów — Studio Nova" };

async function ProtectedHistory() {
  await connection();
  const store = await cookies();
  if (!validSession(store.get(cookieName())?.value)) redirect("/");
  return <History />;
}

export default function HistoryPage() {
  return <Suspense fallback={<p role="status">Sprawdzam dostęp…</p>}><ProtectedHistory /></Suspense>;
}

import type { Metadata } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { cookieName, validSession } from "../../lib/session";
import Upload from "./upload";

export const metadata: Metadata = { title: "Baza wiedzy — Studio Nova" };
async function ProtectedUpload() {
  await connection();
  const store = await cookies();
  if (!validSession(store.get(cookieName())?.value)) redirect("/");
  return <Upload />;
}
export default function UploadPage() {
  return <Suspense fallback={<p role="status">Sprawdzam dostęp…</p>}><ProtectedUpload /></Suspense>;
}

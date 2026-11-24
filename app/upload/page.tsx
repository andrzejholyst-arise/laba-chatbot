import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { requirePageUser } from "../../lib/auth";
import Upload from "./upload";

export const metadata: Metadata = { title: "Baza wiedzy — Studio Nova" };
async function ProtectedUpload() {
  await connection();
  await requirePageUser();
  return <Upload />;
}
export default function UploadPage() {
  return <Suspense fallback={<p role="status">Sprawdzam dostęp…</p>}><ProtectedUpload /></Suspense>;
}

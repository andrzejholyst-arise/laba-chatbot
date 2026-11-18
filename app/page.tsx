import { cookies } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";
import { authConfigurationError, cookieName, validSession } from "../lib/session";
import Chat from "./chat";
import Login from "./login";
import { loadDemoCases } from "../lib/demo-cases";

type ChatSearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

async function ProtectedChat({ searchParams }: { searchParams: ChatSearchParams }) {
  // Sprawdzanie ważności sesji wymaga aktualnego czasu dla tego żądania.
  await connection();
  const cookieStore = await cookies();
  const error = authConfigurationError();
  if (error || !validSession(cookieStore.get(cookieName())?.value)) {
    return <Login configurationError={error} />;
  }
  const query = await searchParams;
  const selected = typeof query.conversation === "string" ? query.conversation : undefined;
  const startNew = query.new === "1";
  // Brak materiałów nie powinien blokować zwykłego czatu.
  const demoCases = await loadDemoCases().catch(() => []);
  return <Chat key={startNew ? "new" : selected ?? "latest"} demoCases={demoCases}
    initialConversationId={selected} startNew={startNew} />;
}

export default function Home({ searchParams }: { searchParams: ChatSearchParams }) {
  return (
    <Suspense fallback={<p role="status">Sprawdzam dostęp…</p>}>
      <ProtectedChat searchParams={searchParams} />
    </Suspense>
  );
}

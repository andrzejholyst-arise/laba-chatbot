import { connection } from "next/server";
import { Suspense } from "react";
import { requirePageUser } from "../lib/auth";
import Chat from "./chat";
import { accountDisplay } from "../lib/account-display";
import { loadDemoCases } from "../lib/demo-cases";

type ChatSearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

async function ProtectedChat({ searchParams }: { searchParams: ChatSearchParams }) {
  // Sprawdzanie ważności sesji wymaga aktualnego czasu dla tego żądania.
  await connection();
  const user = await requirePageUser();
  const account = accountDisplay(user.user_metadata);
  const query = await searchParams;
  const selected = typeof query.conversation === "string" ? query.conversation : undefined;
  const startNew = query.new === "1";
  // Brak materiałów nie powinien blokować zwykłego czatu.
  const demoCases = await loadDemoCases().catch(() => []);
  return <Chat key={`${user.id}:${startNew ? "new" : selected ?? "latest"}`} demoCases={demoCases}
    userEmail={user.email ?? ""} displayName={account.name} avatarUrl={account.avatarUrl} initialConversationId={selected} startNew={startNew} />;
}

export default function Home({ searchParams }: { searchParams: ChatSearchParams }) {
  return (
    <Suspense fallback={<p role="status">Sprawdzam dostęp…</p>}>
      <ProtectedChat searchParams={searchParams} />
    </Suspense>
  );
}

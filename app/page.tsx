import { cookies } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";
import { authConfigurationError, cookieName, validSession } from "../lib/session";
import Chat from "./chat";
import Login from "./login";
import { loadDemoCases } from "../lib/demo-cases";

async function ProtectedChat() {
  // Sprawdzanie ważności sesji wymaga aktualnego czasu dla tego żądania.
  await connection();
  const cookieStore = await cookies();
  const error = authConfigurationError();
  if (error || !validSession(cookieStore.get(cookieName())?.value)) {
    return <Login configurationError={error} />;
  }
  // Brak materiałów nie powinien blokować zwykłego czatu.
  const demoCases = await loadDemoCases().catch(() => []);
  return <Chat demoCases={demoCases} />;
}

export default function Home() {
  return (
    <Suspense fallback={<p role="status">Sprawdzam dostęp…</p>}>
      <ProtectedChat />
    </Suspense>
  );
}

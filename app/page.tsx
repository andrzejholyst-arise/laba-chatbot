import { cookies } from "next/headers";
import { Suspense } from "react";
import { authConfigurationError, cookieName, validSession } from "../lib/session";
import Chat from "./chat";
import Login from "./login";

async function ProtectedChat() {
  const cookieStore = await cookies();
  const error = authConfigurationError();
  if (error || !validSession(cookieStore.get(cookieName())?.value)) {
    return <Login configurationError={error} />;
  }
  return <Chat />;
}

export default function Home() {
  return (
    <Suspense fallback={<p role="status">Sprawdzam dostęp…</p>}>
      <ProtectedChat />
    </Suspense>
  );
}

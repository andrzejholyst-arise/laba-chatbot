"use client";

import { useState } from "react";
import styles from "./chat.module.css";

export default function Login({ configurationError }: { configurationError: string | null }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main className={styles.chat}>
      <h1>Wpisz hasło</h1>
      <form className={styles.composer} onSubmit={async (event) => {
        event.preventDefault();
        if (!password || busy || configurationError) return;
        setBusy(true);
        setError("");
        try {
          const response = await fetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password }),
          });
          setPassword("");
          if (!response.ok) {
            setError(await response.text());
            return;
          }
          window.location.replace("/");
        } catch {
          setError("Nie udało się połączyć. Spróbuj ponownie.");
        } finally {
          setBusy(false);
        }
      }}>
        <label htmlFor="password">Hasło warsztatowe</label>
        <div className={styles.controls}>
          <input id="password" type="password" autoComplete="current-password" value={password}
            onChange={(event) => setPassword(event.target.value)} maxLength={1024}
            disabled={busy || !!configurationError} required />
          <button disabled={busy || !password || !!configurationError} type="submit">Wejdź</button>
        </div>
        {busy && <p role="status">Sprawdzam hasło…</p>}
        {(configurationError || error) && <p className={styles.error} role="alert">{configurationError || error}</p>}
      </form>
    </main>
  );
}

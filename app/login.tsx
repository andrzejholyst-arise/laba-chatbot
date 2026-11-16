"use client";

import ThemeToggle from "./theme-toggle";
import { useState } from "react";
import styles from "./chat.module.css";

export default function Login({ configurationError }: { configurationError: string | null }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main className={`${styles.chat} ${styles.login}`}>
      <div className={styles.loginCard}>
        <header className={`${styles.header} ${styles.loginHeader}`}><span className={styles.brandMark} aria-hidden="true">N<span>🍌</span></span><div className={styles.controls}><ThemeToggle /></div></header>
        <p className={styles.eyebrow}>WITAJ W STUDIO NOVA</p>
        <h1>Miejsce na dobre pomysły.</h1>
        <p className={styles.subtitle}>Twój asystent do wiadomości klientów, inspiracji i codziennej pracy.</p>
        <div className={styles.loginIntro}><h2>Wpisz hasło</h2><p>Zaloguj się, aby rozpocząć rozmowę.</p></div>
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
      </div>
      <p className={styles.loginFootnote}>Studio Nova · Twój asystent w codziennej pracy</p>
    </main>
  );
}

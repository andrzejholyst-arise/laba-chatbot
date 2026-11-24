"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { browserSupabase, SupabaseAuthConfigurationError } from "../../lib/supabase-browser";
import { authErrorMessage, callbackErrorMessage } from "../../lib/auth-errors";
import { safeNext } from "../../lib/safe-next";
import ThemeToggle from "../theme-toggle";
import styles from "../chat.module.css";
export default function LoginForm() {
  const query = useSearchParams();
  const [signup, setSignup] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState(callbackErrorMessage(query.get("error")));
  const [notice, setNotice] = useState("");
  return <main className={`${styles.chat} ${styles.login}`}><div className={styles.loginCard}>
    <header className={styles.header}><h1>Studio Nova</h1><ThemeToggle /></header>
    <p>Twoje miejsce na dobre pomysły.</p>
    <div role="tablist" aria-label="Dostęp do konta" className={styles.controls}>
      {[false, true].map(value => <button key={String(value)} type="button" role="tab" aria-selected={signup === value} disabled={busy || googleBusy} onClick={() => { setSignup(value); setError(""); setNotice(""); }}>{value ? "Załóż konto" : "Zaloguj się"}</button>)}
    </div>
    {/* Start logowania Google dzieje się na serwerze: zwykły formularz POST, bez klucza w przeglądarce. */}
    <form method="post" action="/auth/google" className={styles.composer} onSubmit={() => setGoogleBusy(true)}>
      <input type="hidden" name="next" value={safeNext(query.get("next"))} />
      <button type="submit" disabled={busy || googleBusy}>{googleBusy ? "Chwileczkę…" : "Zaloguj przez Google"}</button>
    </form>
    <p aria-hidden="true">lub e-mailem</p>
    <form className={styles.composer} onSubmit={async event => {
      event.preventDefault(); if (busy) return;
      setError(""); setNotice("");
      if (password.length < 8) { setError("Hasło musi mieć minimum 8 znaków."); return; }
      setBusy(true);
      try {
        const supabase = browserSupabase();
        const { data, error } = signup
          ? await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: `${window.location.origin}/auth/callback` } })
          : await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) { setError(authErrorMessage(error.code, error.status)); return; }
        if (signup && data.user?.identities?.length === 0) { setError(authErrorMessage("user_already_exists")); return; }
        setPassword("");
        if (data.session) { window.location.replace(safeNext(query.get("next"))); return; }
        setNotice("Konto zostało utworzone. Potwierdź adres e-mail linkiem w otrzymanej wiadomości, aby przejść do czatu.");
      } catch (error) {
        setError(error instanceof SupabaseAuthConfigurationError
          ? error.message
          : "Nie udało się połączyć z logowaniem. Sprawdź połączenie i publiczną konfigurację Supabase Auth.");
      }
      finally { setBusy(false); }
    }}>
      <label htmlFor="email">E-mail</label><input id="email" type="email" autoComplete="email" required maxLength={254} value={email} disabled={busy || googleBusy} onChange={event => setEmail(event.target.value)} />
      <label htmlFor="password">Hasło (minimum 8 znaków)</label><input id="password" type="password" required minLength={8} maxLength={1024} autoComplete={signup ? "new-password" : "current-password"} value={password} disabled={busy || googleBusy} onChange={event => setPassword(event.target.value)} onInvalid={event => { if (event.currentTarget.validity.tooShort) setError("Hasło musi mieć minimum 8 znaków."); }} />
      <button disabled={busy || googleBusy} type="submit">{busy ? "Chwileczkę…" : signup ? "Załóż konto" : "Zaloguj się"}</button>
      {error && <p role="alert" className={styles.error}>{error}</p>}{notice && <p role="status">{notice}</p>}
    </form>
  </div></main>;
}

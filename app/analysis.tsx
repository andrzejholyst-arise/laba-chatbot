"use client";

import { useEffect, useRef, useState } from "react";
import { analysisSchema, type Analysis } from "../lib/analysis";
import styles from "./chat.module.css";

export default function MessageAnalysis({ disabled }: { disabled: boolean }) {
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<Analysis | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => { controller.current?.abort(); }, []);
  useEffect(() => { if (disabled) controller.current?.abort(); }, [disabled]);

  return (
    <section aria-label="Analiza wiadomości Studio Nova" className={styles.composer}>
      <p>Przygotuj szkic odpowiedzi na jedną wiadomość klienta. Wynik nie wysyła wiadomości ani nie wykonuje żadnych operacji.</p>
      <form className={styles.composer} onSubmit={async (event) => {
        event.preventDefault();
        if (!message.trim() || busy || disabled) return;
        setResult(null);
        setError("");
        setBusy(true);
        const current = new AbortController();
        controller.current = current;
        const timeout = window.setTimeout(() => current.abort(), 55_000);
        try {
          const response = await fetch("/api/agent", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "analyze", message }),
            signal: current.signal,
          });
          if (response.status === 401) {
            window.location.replace("/");
            throw new Error("Sesja wygasła. Zaloguj się ponownie.");
          }
          const body = await response.json();
          if (!response.ok) throw new Error(typeof body?.error?.message === "string"
            ? body.error.message : "Nie udało się wykonać analizy. Spróbuj ponownie.");
          const parsed = analysisSchema.safeParse(body);
          if (!parsed.success) throw new Error("Serwer zwrócił nieprawidłowy wynik. Nie można pokazać szkicu.");
          if (current.signal.aborted) throw new Error("Analiza została przerwana.");
          setResult(parsed.data);
        } catch (failure) {
          setResult(null);
          setError(current.signal.aborted
            ? "Analiza została przerwana lub przekroczyła limit czasu. Nie pokazano częściowego wyniku."
            : failure instanceof Error ? failure.message : "Nie udało się wykonać analizy.");
        } finally {
          window.clearTimeout(timeout);
          controller.current = null;
          setBusy(false);
        }
      }}>
        <label htmlFor="client-message">Wiadomość klienta</label>
        <textarea id="client-message" rows={6} maxLength={12000} required
          value={message} disabled={busy || disabled}
          onChange={(event) => { setMessage(event.target.value); setResult(null); setError(""); }} />
        <div className={styles.controls}>
          <button type="submit" disabled={busy || disabled || !message.trim()}>Analizuj wiadomość</button>
          {busy && <button type="button" onClick={() => controller.current?.abort()}>Przerwij analizę</button>}
        </div>
      </form>
      {busy && <p role="status">Analizuję wiadomość… Wynik pojawi się po sprawdzeniu kompletnej odpowiedzi.</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {result && <section className={styles.analysisResult} aria-label="Wynik analizy" aria-live="polite">
        <h2>Szkic odpowiedzi — Studio Nova</h2>
        <dl>
          <dt>Kategoria</dt><dd>{result.category}</dd>
          <dt>Priorytet</dt><dd>{result.priority === "high" ? "Wysoki (high)" : "Normalny (normal)"}</dd>
          <dt>Status sprawdzenia</dt><dd>{result.needs_review ? "Wymaga sprawdzenia przez pracownika" : "Nie wymaga dodatkowego sprawdzenia"}</dd>
        </dl>
        <h3>Propozycja odpowiedzi do klienta</h3>
        <p>{result.draft}</p>
        <details>
          <summary>Wynik JSON (po walidacji)</summary>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </details>
        <p>To zawsze szkic, także gdy nie wymaga dodatkowego sprawdzenia. Żadna wiadomość nie została wysłana.</p>
      </section>}
    </section>
  );
}

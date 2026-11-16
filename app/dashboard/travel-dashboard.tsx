"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import ThemeToggle from "../theme-toggle";
import shared from "../chat.module.css";
import styles from "./dashboard.module.css";
import { dashboardChoicesSchema, dashboardRequestSchema, dashboardResponseSchema, type DashboardQuery, type DashboardResponse } from "../../lib/dashboard-schema";

import CompareDashboard from "./compare-dashboard";
import { DashboardCardsView, dateLabel, timeLabel, countryLabel } from "./dashboard-cards";

type Choice = { miasto: string; kraj: string; region: string | null };

export default function TravelDashboard() {
  const [mode, setMode] = useState<"single" | "compare">("single");
  const [comparisonBusy, setComparisonBusy] = useState(false);
  const [city, setCity] = useState("");
  const [date, setDate] = useState("");
  const [report, setReport] = useState<DashboardResponse | null>(null);
  const [lastQuery, setLastQuery] = useState<DashboardQuery | null>(null);
  const [choices, setChoices] = useState<Choice[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  const pending = useRef(false);
  useEffect(() => () => active.current?.abort(), []);

  async function check(query: DashboardQuery) {
    if (pending.current) return;
    const input = dashboardRequestSchema.safeParse(query);
    if (!input.success) { setError("Podaj miasto i prawidłową datę od 1970 do 2100 roku."); return; }
    pending.current = true; setBusy(true); setError(""); setChoices([]);
    setReport(null); setLastQuery(input.data);
    const controller = new AbortController(); active.current = controller;
    try {
      const response = await fetch("/api/dashboard", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input.data), signal: controller.signal });
      if (response.status === 401) { window.location.replace("/"); return; }
      const payload = await response.json();
      if (!response.ok) {
        const options = dashboardChoicesSchema.safeParse(payload.choices);
        if (options.success) setChoices(options.data);
        throw new Error(typeof payload.error?.message === "string" ? payload.error.message : "Nie udało się sprawdzić podróży.");
      }
      const parsed = dashboardResponseSchema.safeParse(payload);
      if (!parsed.success) throw new Error("Serwer zwrócił nieprawidłowe dane. Nie pokazano niesprawdzonego wyniku.");
      if (!controller.signal.aborted) setReport(parsed.data);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Nie udało się połączyć. Spróbuj ponownie.");
    } finally {
      pending.current = false;
      if (!controller.signal.aborted) setBusy(false);
      if (active.current === controller) active.current = null;
    }
  }

  return <main className={`${shared.chat} ${styles.dashboard}`}>
    <header className={shared.header}>
      <div className={shared.brand}>
        <span className={shared.brandMark} aria-hidden="true">N<span>🍌</span></span>
        <div><p className={shared.eyebrow}>STUDIO NOVA · PODRÓŻE</p><h1>Dobry plan, spokojna podróż.</h1>
          <p className={shared.subtitle}>Pięć źródeł, najważniejsze informacje i mała podpowiedź na drogę.</p></div>
      </div>
      <div className={shared.controls}><ThemeToggle /><Link className={shared.navLink} href="/" prefetch={false}>← Czat</Link></div>
    </header>
    <div className={styles.modeSwitch} role="group" aria-label="Tryb dashboardu">
      <button type="button" aria-pressed={mode === "single"} disabled={busy || comparisonBusy} onClick={() => setMode("single")}>Jedno miasto</button>
      <button type="button" aria-pressed={mode === "compare"} disabled={busy || comparisonBusy} onClick={() => setMode("compare")}>Porównaj</button>
    </div>
    {mode === "compare" ? <CompareDashboard onBusyChange={setComparisonBusy} /> : <>
    <form className={styles.search} onSubmit={event => { event.preventDefault(); void check({ miasto: city, data: date }); }}>
      <div><label htmlFor="destination">Dokąd jedziesz?</label><input id="destination" name="city" placeholder="np. Paryż" autoComplete="address-level2" required minLength={2} maxLength={100}
        value={city} disabled={busy} onChange={event => { setCity(event.target.value); setChoices([]); }} /></div>
      <div><label htmlFor="travel-date">Kiedy?</label><input id="travel-date" name="date" type="date" required min="1970-01-01" max="2100-12-31"
        value={date} disabled={busy} onChange={event => { setDate(event.target.value); setChoices([]); }} /></div>
      <button type="submit" disabled={busy || !city.trim() || !date}>Sprawdź</button>
      <button type="button" className={styles.refresh} disabled={busy || !lastQuery} onClick={() => lastQuery && void check(lastQuery)} title="Pobierz ponownie ostatnio sprawdzoną podróż">Odśwież</button>
    </form>
    {busy && <p className={styles.loading} role="status">Sprawdzam źródła i przygotowuję podsumowanie…</p>}
    {error && <p className={shared.error} role="alert">{error}</p>}
    {!!choices.length && <section className={styles.choices} aria-label="Wybierz miasto"><h2>Które miejsce masz na myśli?</h2>
      <div>{choices.map((choice, index) => <button type="button" key={index} disabled={busy} onClick={() => {
        setCity(choice.miasto); void check({ miasto: choice.miasto, data: date, kraj: choice.kraj, ...(choice.region ? { region: choice.region } : {}) });
      }}>{choice.miasto} · {countryLabel(choice.kraj)}{choice.region ? ` · ${choice.region}` : ""}</button>)}</div>
    </section>}
    <div className={styles.resultHeading}>
      <h2>{report ? `${report.destination.city}, ${countryLabel(report.destination.country)}` : "Twój podróżny niezbędnik"}</h2>
      <p>{report ? `Podróż: ${dateLabel(report.query.data)} · ${report.destination.zone}` : "Wpisz miasto i datę. Dane pobierzemy dopiero po kliknięciu „Sprawdź”."}</p>
    </div>
    <DashboardCardsView report={report} busy={busy} tried={!!lastQuery} />
    <section className={styles.summary} aria-label="Podsumowanie agenta" aria-live="polite">
      <span className={styles.summaryIcon} aria-hidden="true">🐒</span>
      <div><p className={shared.eyebrow}>PODPOWIEDŹ NA DROGĘ</p><h2>Co spakować i na co uważać?</h2>
        {!report ? <p className={styles.placeholder}>{busy ? "Czekam na wyniki źródeł…" : error ? "Brak danych do podsumowania. Spróbuj odświeżyć." : "Po sprawdzeniu podróży agent przygotuje 2–3 zdania na podstawie danych w kartach."}</p>
          : report.summary.status === "error" ? <p className={styles.cardError} role="alert">{report.summary.message}</p>
            : <><p className={styles.summaryText}>{report.summary.sentences.join(" ")}</p>
              <small>Asystent Studio Nova · {timeLabel(report.summary.retrievedAt)}{report.summary.modelId && ` · model: ${report.summary.modelId}`}</small></>}
      </div>
    </section>
    </>}
    <p className={styles.footnote}>Prognoza obejmuje dziś i następne 15 dni; dla dalszych dat pozostałe karty nadal działają. Kursy i zegar pokazują stan w chwili pobrania. Odświeżanie pobiera dane i tworzy nowe podsumowanie.</p>
  </main>;
}

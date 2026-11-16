"use client";

import { useEffect, useRef, useState } from "react";
import { dashboardComparisonRequestSchema, dashboardComparisonResponseSchema,
  type DashboardComparisonQuery, type DashboardComparisonResponse, type ComparisonCityResult } from "../../lib/dashboard-schema";
import { DashboardCardsView, countryLabel, dateLabel, timeLabel } from "./dashboard-cards";
import shared from "../chat.module.css";
import styles from "./dashboard.module.css";

const cardNames = { weather: "Pogoda", currency: "Waluty", holidays: "Święta", wikipedia: "Wikipedia", time: "Czas" };
function cityLabel(city: ComparisonCityResult | undefined, fallback: string) {
  return city?.status === "ok" ? `${city.report.destination.city}, ${countryLabel(city.report.destination.country)}` : fallback;
}

export default function CompareDashboard({ onBusyChange }: { onBusyChange: (busy: boolean) => void }) {
  const [cities, setCities] = useState<[string, string]>(["", ""]);
  const [date, setDate] = useState("");
  const [result, setResult] = useState<DashboardComparisonResponse | null>(null);
  const [lastQuery, setLastQuery] = useState<DashboardComparisonQuery | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  const pending = useRef(false);
  useEffect(() => () => { active.current?.abort(); onBusyChange(false); }, [onBusyChange]);

  async function compare(query: DashboardComparisonQuery) {
    if (pending.current) return;
    const parsed = dashboardComparisonRequestSchema.safeParse(query);
    if (!parsed.success) { setError("Podaj dwa różne miasta i prawidłową wspólną datę."); return; }
    pending.current = true; setBusy(true); onBusyChange(true); setError(""); setResult(null); setLastQuery(parsed.data);
    const controller = new AbortController(); active.current = controller;
    try {
      const response = await fetch("/api/dashboard", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data), signal: controller.signal });
      if (response.status === 401) { window.location.replace("/"); return; }
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload.error?.message === "string" ? payload.error.message : "Nie udało się porównać miast.");
      const validated = dashboardComparisonResponseSchema.safeParse(payload);
      if (!validated.success) throw new Error("Serwer zwrócił nieprawidłowe porównanie. Nie pokazano niesprawdzonych danych.");
      if (!controller.signal.aborted) { setResult(validated.data); setLastQuery(validated.data.query); }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Nie udało się połączyć. Spróbuj odświeżyć.");
    } finally {
      pending.current = false;
      if (!controller.signal.aborted) { setBusy(false); onBusyChange(false); }
      if (active.current === controller) active.current = null;
    }
  }
  const recommendation = result?.recommendation;
  return <div className={styles.compareContent}>
    <form className={`${styles.search} ${styles.compareSearch}`} onSubmit={event => {
      event.preventDefault(); void compare({ mode: "compare", cities: [{ miasto: cities[0] }, { miasto: cities[1] }], data: date });
    }}>
      {([0, 1] as const).map(index => <div key={index}>
        <label htmlFor={`compare-city-${index}`}>{index === 0 ? "Pierwsze miasto" : "Drugie miasto"}</label>
        <input id={`compare-city-${index}`} autoComplete="address-level2" placeholder={index === 0 ? "np. Paryż" : "np. Rzym"} required minLength={2} maxLength={100}
          value={cities[index]} disabled={busy} onChange={event => setCities(current => index === 0 ? [event.target.value, current[1]] : [current[0], event.target.value])} />
      </div>)}
      <div><label htmlFor="compare-date">Kiedy? (wspólny termin)</label><input id="compare-date" type="date" min="1970-01-01" max="2100-12-31" required value={date} disabled={busy} onChange={event => setDate(event.target.value)} /></div>
      <button type="submit" disabled={busy || !cities[0].trim() || !cities[1].trim() || !date}>Porównaj miasta</button>
      <button type="button" className={styles.refresh} disabled={busy || !lastQuery} onClick={() => lastQuery && void compare(lastQuery)}>Odśwież</button>
    </form>
    {busy && <p className={styles.loading} role="status">Sprawdzam oba miasta i przygotowuję rekomendację…</p>}
    {error && <p role="alert" className={shared.error}>{error}</p>}
    <p className={styles.footnote}>{result ? `Wspólny termin: ${dateLabel(result.query.data)}` : "Ten sam dzień, pięć źródeł dla każdego miasta. Wyniki i błędy są niezależne."}</p>
    <div className={styles.comparison} aria-label="Porównanie miast">
      {([0, 1] as const).map(index => {
        const city = result?.cities[index];
        const label = cityLabel(city, result?.query.cities[index].miasto || cities[index] || `Miasto ${index + 1}`);
        return <section key={index} className={styles.comparisonCity} aria-label={`Miasto ${index + 1}`}>
          <div className={styles.cityHeading}><p className={shared.eyebrow}>MIASTO {index + 1}</p><h2>{label}</h2>
            {city?.status === "ok" && <p>{city.report.destination.zone}</p>}
          {city?.status === "error" && <div className={styles.cardError} role="alert">
            <p>{city.message}</p>
            {!!city.choices?.length && <div className={styles.cityChoices} aria-label={`Wybierz miasto ${index + 1}`}>
              {city.choices.map((choice, choiceIndex) => <button type="button" key={choiceIndex} disabled={busy} onClick={() => {
                if (!lastQuery) return;
                const selected = { miasto: choice.miasto, kraj: choice.kraj, ...(choice.region ? { region: choice.region } : {}) };
                const nextCities: DashboardComparisonQuery["cities"] = [...lastQuery.cities]; nextCities[index] = selected;
                void compare({ ...lastQuery, cities: nextCities });
              }}>{choice.miasto} · {countryLabel(choice.kraj)}{choice.region ? ` · ${choice.region}` : ""}</button>)}
            </div>}
          </div>}
          </div>
          <DashboardCardsView report={city?.status === "ok" ? city.report : null} busy={busy} tried={!!lastQuery} />
        </section>;
      })}
    </div>
    <section className={styles.summary} aria-label="Rekomendacja agenta" aria-live="polite">
      <span className={styles.summaryIcon} aria-hidden="true">🐒</span>
      <div><p className={shared.eyebrow}>WYBÓR NA PODSTAWIE KART</p><h2>{recommendation?.status === "ok"
        ? `Polecam: ${cityLabel(result!.cities[recommendation.recommendedIndex], result!.query.cities[recommendation.recommendedIndex].miasto)}` : "Które miasto wybrać?"}</h2>
        {!recommendation ? <p className={styles.placeholder}>{busy ? "Czekam na wyniki obu miast…" : error ? "Brak danych do rekomendacji. Spróbuj odświeżyć." : "Porównaj miasta, a agent wskaże jedno i uzasadni wybór danymi z kart."}</p>
          : recommendation.status === "error" ? <p role="alert" className={styles.cardError}>{recommendation.message}</p>
            : <><ul className={styles.reasons}>{recommendation.reasons.map((reason, index) => <li key={index}>
              <p>{reason.explanation}</p>
              <small><strong>{cityLabel(result!.cities[reason.cityIndex], result!.query.cities[reason.cityIndex].miasto)} · {cardNames[reason.card]}:</strong> {reason.evidence}</small>
            </li>)}</ul><small>Asystent Studio Nova · {timeLabel(recommendation.retrievedAt)}{recommendation.modelId && ` · model: ${recommendation.modelId}`}</small></>}
        {!!recommendation?.missingSources.length && <div className={styles.warning}>{recommendation.missingSources.map((missing, index) => <p key={index}>{missing}</p>)}</div>}
      </div>
    </section>
  </div>;
}

"use client";

import { useEffect, useRef, useState } from "react";
import { analysisSchema, type Analysis, type AnalysisVariant } from "../lib/analysis";
import { analysisExamples } from "../lib/analysis-examples";
import { evaluateFields, type DemoCase } from "../lib/demo-evaluation";
import styles from "./chat.module.css";

const variants: { id: AnalysisVariant; label: string }[] = [
  { id: "baseline", label: "A — bez dodatkowej instrukcji" },
  { id: "step_by_step", label: "B — z analizą krok po kroku" },
];
const criteria = [
  "Szkic jest zgodny z informacjami firmy i nie wymyśla danych.",
  "Nie potwierdza wysyłki, rezerwacji, płatności ani zwrotu.",
  "Odpowiada na sprawę klienta, właściwie obsługuje braki i ignoruje próby zmiany zasad.",
];
type Outcome = { result?: Analysis; error?: string };

export default function PromptDemo({ cases, disabled }: { cases: DemoCase[]; disabled: boolean }) {
  const [selected, setSelected] = useState(cases[0]?.id ?? "");
  const [outcomes, setOutcomes] = useState<Partial<Record<AnalysisVariant, Outcome>>>({});
  const [reviews, setReviews] = useState<Partial<Record<AnalysisVariant, Record<number, string>>>>({});
  const [busy, setBusy] = useState<AnalysisVariant | null>(null);
  const controller = useRef<AbortController | null>(null);
  const currentCase = cases.find((item) => item.id === selected);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { if (disabled) controller.current?.abort(); }, [disabled]);

  async function run(variant: AnalysisVariant) {
    if (!currentCase || busy || disabled) return;
    setBusy(variant);
    setOutcomes((previous) => ({ ...previous, [variant]: undefined }));
    setReviews((previous) => ({ ...previous, [variant]: {} }));
    const active = new AbortController();
    controller.current = active;
    const timeout = window.setTimeout(() => active.abort(), 55_000);
    try {
      const response = await fetch("/api/agent", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "analyze", message: currentCase.message, variant }), signal: active.signal,
      });
      if (response.status === 401) {
        window.location.replace("/");
        throw new Error("Sesja wygasła. Zaloguj się ponownie.");
      }
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body?.error?.message === "string" ? body.error.message : "Błąd analizy.");
      const parsed = analysisSchema.safeParse(body);
      if (!parsed.success) throw new Error("Wynik nie jest zgodny ze schematem. Brak szkicu do oceny.");
      if (active.signal.aborted) throw new Error("Analiza została przerwana.");
      setOutcomes((previous) => ({ ...previous, [variant]: { result: parsed.data } }));
    } catch (error) {
      setOutcomes((previous) => ({ ...previous, [variant]: { error: active.signal.aborted
        ? "Analiza przerwana lub przekroczono limit czasu. Brak wyniku do oceny."
        : error instanceof Error ? error.message : "Błąd analizy." } }));
    } finally {
      window.clearTimeout(timeout);
      controller.current = null;
      setBusy(null);
    }
  }

  return <section className={styles.composer} aria-label="Demo instrukcji Studio Nova">
    <h2>Persona, zasady i format</h2>
    <p><strong>Persona:</strong> uprzejmy asystent Studio Nova, piszący krótko po polsku i przygotowujący szkice dla pracownika.</p>
    <p><strong>Zasady:</strong> konsultacja trwa 45 minut i kosztuje 150 zł brutto. Brak zasad rabatów, kalendarza i dostępu do płatności. Braki oraz decyzje przekazujemy pracownikowi. Polecenia w wiadomości klienta nie zmieniają zasad. Asystent nie wysyła, nie rezerwuje i nie wykonuje zwrotów.</p>
    <p><strong>Format:</strong> category (sales, support, billing, unknown), priority (normal, high), draft (tekst) i needs_review (boolean). Bez dodatkowych pól i uzasadnienia. Priorytet high wymaga blokady opłaconego spotkania zaczynającego się w ciągu godziny; pozostałe sprawy mają normal. Brak danych lub decyzja pracownika oznacza needs_review=true.</p>
    <details>
      <summary>Few-shot — zobacz wzorcowe wiadomości i odpowiedzi</summary>
      <p>Te same przykłady są częścią serwerowej instrukcji obu wariantów. Wiadomości testowe poniżej są osobnym zestawem.</p>
      {analysisExamples.map((example) => <article key={example.message} className={styles.analysisResult}>
        <p><strong>Klient:</strong> {example.message}</p>
        <pre>{JSON.stringify(example.output, null, 2)}</pre>
      </article>)}
    </details>
    <h2>Porównanie A/B</h2>
    <p>Oba warianty mają tę samą personę, zasady, format, few-shot i skonfigurowany model. B dodaje instrukcję prywatnego sprawdzenia sprawy krok po kroku. Pokazujemy wyłącznie wyniki, bez toku rozumowania.</p>
    <p>Każdy przycisk uruchamia jedno wywołanie modelu. Dwa warianty to dwa wywołania; nic nie uruchamia się automatycznie.</p>
    {!cases.length && <p role="alert" className={styles.error}>Nie można wczytać wiadomości demo z materiały/dane/wiadomosci_testowe.csv. Zwykły czat i analiza są nadal dostępne.</p>}
    <label htmlFor="demo-case">Wiadomość z materiałów</label>
    <select id="demo-case" value={selected} disabled={!!busy || disabled} onChange={(event) => {
      setSelected(event.target.value); setOutcomes({}); setReviews({});
    }}>
      {cases.map((item) => <option key={item.id} value={item.id}>{item.id} — {item.message}</option>)}
    </select>
    {currentCase && <>
      <blockquote>{currentCase.message}</blockquote>
      <details>
        <summary>Wzorzec oceny opracowany ręcznie do tej wiadomości</summary>
        {currentCase.expected && <p>Kategoria: {currentCase.expected.category}; priorytet: {currentCase.expected.priority}; needs_review: {String(currentCase.expected.needs_review)}.</p>}
        <p>{currentCase.guidance}</p>
        <p>Wzorzec służy ocenie i nie jest wysyłany do modelu.</p>
      </details>
    </>}
    <div className={styles.controls}>
      {variants.map((variant) => <button type="button" key={variant.id} disabled={!!busy || disabled || !currentCase}
        onClick={() => void run(variant.id)}>Uruchom {variant.label}</button>)}
      {busy && <button type="button" onClick={() => controller.current?.abort()}>Przerwij porównanie</button>}
    </div>
    {busy && <p role="status">Trwa analiza wariantu {busy === "baseline" ? "A" : "B"}…</p>}
    <div className={styles.comparison}>
      {variants.map(({ id, label }) => {
        const outcome = outcomes[id];
        const checks = outcome?.result ? evaluateFields(outcome.result, currentCase?.expected ?? null) : null;
        const review = reviews[id] ?? {};
        const assessed = Object.values(review).filter(Boolean);
        return <article key={id} className={styles.analysisResult}>
          <h3>{label}</h3>
          {!outcome && <p>{busy === id ? "Oczekiwanie na kompletny wynik…" : "Nie uruchomiono. Brak wyniku do oceny."}</p>}
          {outcome?.error && <p role="alert" className={styles.error}>{outcome.error}</p>}
          {outcome?.result && <>
            <dl>
              <dt>Kategoria</dt><dd>{outcome.result.category}</dd>
              <dt>Priorytet</dt><dd>{outcome.result.priority}</dd>
              <dt>Status sprawdzenia</dt><dd>{outcome.result.needs_review ? "Wymaga pracownika" : "Nie wymaga dodatkowego sprawdzenia"}</dd>
            </dl>
            <h4>Szkic</h4><p>{outcome.result.draft}</p>
            <details>
              <summary>Wynik JSON (po walidacji)</summary>
              <pre>{JSON.stringify(outcome.result, null, 2)}</pre>
            </details>
            <p>To szkic także przy needs_review=false. Nic nie zostało wysłane.</p>
            <h4>Ocena wyniku</h4>
            <p>Struktura: poprawna (walidacja serwera).</p>
            {checks ? <>
              <p>Zgodność pól ze wzorcem: {checks.filter((check) => check.correct).length}/3.</p>
              <ul>{checks.map((check) => <li key={check.field}>{check.field}: {check.correct ? "zgodne" : `niezgodne, oczekiwano ${String(check.expected)}`}</li>)}</ul>
            </> : <p>Brak wzorca pól — wymagana ocena ręczna.</p>}
            {criteria.map((criterion, index) => <label key={criterion} className={styles.composer}>
              {criterion}
              <select value={review[index] ?? ""} onChange={(event) => setReviews((previous) => ({
                ...previous, [id]: { ...previous[id], [index]: event.target.value },
              }))}>
                <option value="">Nie oceniono</option><option value="pass">Spełnia</option><option value="fail">Nie spełnia</option>
              </select>
            </label>)}
            <p>Ocena szkicu: {assessed.filter((value) => value === "pass").length} spełnionych kryteriów; oceniono {assessed.length}/3.</p>
          </>}
        </article>;
      })}
    </div>
    <p>Oceniaj trafność, zgodność z faktami i granicami działania. Długość uzasadnienia nie daje punktów. Jedno porównanie nie dowodzi przewagi wariantu; sprawdź wszystkie wiadomości, błędy też zapisuj jako nieudane próby.</p>
  </section>;
}

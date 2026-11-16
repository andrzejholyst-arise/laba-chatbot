import styles from "./dashboard.module.css";
import type { DashboardCards, DashboardCityReport } from "../../lib/dashboard-schema";

const definitions = [
  { key: "weather", title: "Pogoda", icon: "🌤️", source: "Open-Meteo", hint: "Prognoza na dzień podróży" },
  { key: "currency", title: "Waluty", icon: "💱", source: "NBP", hint: "Aktualny kurs względem złotego" },
  { key: "holidays", title: "Święta", icon: "📅", source: "Nager.Date", hint: "Najbliższe dni wolne od daty wyjazdu" },
  { key: "wikipedia", title: "Poznaj miasto", icon: "📖", source: "Polska Wikipedia", hint: "Dwa zdania na dobry początek" },
  { key: "time", title: "Czas na miejscu", icon: "🕒", source: "Zegar serwera · Intl", hint: "Aktualna godzina i różnica względem Polski" },
] as const;
const number = (value: number) => new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 4 }).format(value);
export function dateLabel(value: string) {
  return new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}
export function timeLabel(value: string) {
  return new Intl.DateTimeFormat("pl-PL", { dateStyle: "short", timeStyle: "medium", timeZone: "Europe/Warsaw" }).format(new Date(value));
}
export function countryLabel(value: string) { return new Intl.DisplayNames(["pl"], { type: "region" }).of(value) || value; }
function differenceLabel(minutes: number) {
  if (minutes === 0) return "Taka sama godzina jak w Polsce";
  const delta = Math.abs(minutes), hours = Math.floor(delta / 60), rest = delta % 60;
  return `${minutes > 0 ? "+" : "−"}${hours ? `${hours} godz.` : ""}${rest ? ` ${rest} min` : ""} względem Polski`;
}
function CardValue({ name, cards }: { name: keyof DashboardCards; cards: DashboardCards }) {
  if (name === "weather" && cards.weather.status !== "error") {
    const value = cards.weather.data;
    return <><p className={styles.value}>{number(value.minC)}–{number(value.maxC)} <span>°C</span></p>
      <p>Temperatura minimalna i maksymalna</p><p className={styles.detail}>Opady: <strong>{number(value.rainMm)} mm</strong></p>
      <small>{dateLabel(value.date)} · {value.zone}</small></>;
  }
  if (name === "currency" && cards.currency.status !== "error") return <>
    {cards.currency.data.rates.map(rate => <div className={styles.rate} key={rate.code}>
      <p className={styles.value}><span>1 {rate.code} = </span>{number(rate.pln)} <span>PLN</span></p>
      <small>{rate.published ? `Notowanie: ${dateLabel(rate.published)}` : "PLN na PLN — bez notowania"}</small>
    </div>)}
    <p className={styles.detail}>{cards.currency.data.rates.every(rate => rate.code === "PLN") ? "Polska korzysta ze złotego — przeliczenie PLN na PLN." : "Ostatni opublikowany kurs średni. Bez marży i prowizji."}</p>
    <small>Kurs w chwili pobrania, niezależny od daty podróży.</small>
    <small>Waluta kraju: <a href="https://unicode.org/reports/tr35/tr35-numbers.html#Supplemental_Currency_Data" target="_blank" rel="noopener noreferrer">Unicode CLDR</a>.</small>
  </>;
  if (name === "holidays" && cards.holidays.status !== "error") return <>
    <p className={styles.value}>{cards.holidays.data.items.length} <span>{cards.holidays.data.items.length === 1 ? "najbliższy dzień wolny" : "najbliższe dni wolne"}</span></p>
    {cards.holidays.data.items.length ? <ul className={styles.holidayList}>{cards.holidays.data.items.map(day => <li key={`${day.date}-${day.name}`}>
      <time dateTime={day.date}>{dateLabel(day.date)}</time><strong>{day.name}</strong>
    </li>)}</ul> : <p>Nie znaleziono dalszych świąt w sprawdzonym zakresie do końca {cards.holidays.data.throughYear} roku.</p>}
    <small>Od {dateLabel(cards.holidays.data.from)}. Wyłącznie święta ogólnokrajowe; bez zwykłych weekendów.</small>
  </>;
  if (name === "wikipedia" && cards.wikipedia.status !== "error") return <>
    <p className={styles.unit}>{cards.wikipedia.data.sentences.length === 1 ? "1 zdanie" : "2 zdania"} o mieście</p>
    <p className={styles.wikiText}>{cards.wikipedia.data.sentences.join(" ")}</p>
    <a className={styles.articleLink} href={cards.wikipedia.data.articleUrl} target="_blank" rel="noopener noreferrer">Przeczytaj artykuł ↗</a>
  </>;
  if (name === "time" && cards.time.status !== "error") return <>
    <p className={styles.value}>{cards.time.data.time}</p>
    <p>{cards.time.data.weekday}, {dateLabel(cards.time.data.date)}</p>
    <p className={styles.difference}>{differenceLabel(cards.time.data.differenceMinutes)}</p>
    <small>{cards.time.data.zone} · różnica aktualna w chwili pobrania, z uwzględnieniem czasu letniego.</small>
  </>;
  return null;
}

export function DashboardCardsView({ report, busy, tried = false }: { report: DashboardCityReport | null; busy: boolean; tried?: boolean }) {
  return (<div className={styles.cards} aria-label="Dane podróży" aria-busy={busy}>
      {definitions.map(definition => {
        const value = report?.cards[definition.key];
        const state = busy ? "Ładuję…" : value?.status === "ok" ? "OK" : "Brak danych";
        return <article key={definition.key} className={styles.card} aria-label={definition.title} aria-busy={busy}>
          <div className={styles.cardHeader}><span className={styles.icon} aria-hidden="true">{definition.icon}</span>
            <div><h3>{definition.title}</h3><p>{definition.hint}</p></div>
            <span className={`${styles.cardState} ${state === "OK" ? styles.stateOk : state === "Ładuję…" ? styles.stateLoading : styles.stateMissing}`} role="status">{state}</span>
          </div>
          <div className={styles.cardBody}>
            {!value ? <p className={styles.placeholder}>{busy ? "Ładuję…" : tried ? "Brak danych — spróbuj odświeżyć" : "Wybierz miasto i datę, a następnie kliknij „Sprawdź”."}</p>
              : value.status === "error" ? <div role="alert" className={styles.cardError}><p>Brak danych — spróbuj odświeżyć</p><small>{value.message}</small></div>
                : <><CardValue name={definition.key} cards={report!.cards} />{value.status === "partial" && <div className={styles.warning}><p>Brak danych — spróbuj odświeżyć</p><p>Pokazano tylko potwierdzoną część: {value.message}</p></div>}</>}
          </div>
          <footer className={styles.cardFooter}>
            <span>Źródło: {value ? <a href={value.sourceUrl} target="_blank" rel="noopener noreferrer">{value.sourceName}</a> : definition.source}</span>
            {value && <span>{value.status === "error" ? "Sprawdzono" : "Pobrano"}: <time dateTime={value.retrievedAt}>{timeLabel(value.retrievedAt)}</time> (Warszawa)</span>}
          </footer>
        </article>;
      })}
    </div>);
}

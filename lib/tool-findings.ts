// Zwięzłe podsumowanie potwierdzonych wyników. Nigdy nie serializujemy całego
// outputu: obrazy, audio, sekrety i nieznane pola nie mogą trafić do metadanych.
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown, limit = 180): string {
  return typeof value === "string" ? value.replace(/[\r\n\t]+/g, " ").slice(0, limit) : "";
}
function number(value: unknown): string { return typeof value === "number" && Number.isFinite(value) ? String(value) : ""; }

export function toolFinding(name: string, value: unknown): string | null {
  const o = object(value);
  const s = (key: string, max?: number) => text(o[key], max);
  const n = (key: string) => number(o[key]);
  if (o.ok === false) return `Błąd (${name}): ${s("message", 350) || s("error", 350) || "nie uzyskano danych."}`;
  let result = "";
  switch (name) {
    case "searchKnowledge":
      if (o.ok === true && Array.isArray(o.fragments)) result = `Baza wiedzy: ${o.fragments.length} fragmentów; źródła: ${[...new Set(o.fragments.map(fragment => text(object(fragment).title, 120)))].join(", ")}`;
      break;
    case "zapiszProfil":
      if (o.ok === true) {
        const saved = object(o.zapamietano);
        const prefs = object(saved.preferences);
        result = `Zapamiętano: ${[typeof saved.name === "string" ? `imię ${text(saved.name, 60)}` : "", ...Object.entries(prefs).map(([key, value]) => `${text(key, 50)}: ${text(value, 100)}`)].filter(Boolean).join("; ")}`;
      }
      break;
    case "aktualnyCzas": case "czas":
      if (s("date") && s("time") && s("timeZone")) result = `${s("date")} ${s("time")} (${s("timeZone")})`;
      break;
    case "pogoda":
      if (o.ok === true && n("temperaturaMinC") && n("temperaturaMaxC")) result = `${s("miasto")}, ${s("data")}: ${n("temperaturaMinC")}–${n("temperaturaMaxC")} °C; opady ${n("opadyMm")} mm (${s("strefa")})`;
      break;
    case "waluty":
      if (o.ok === true && n("wynik")) result = `${n("kwota")} ${s("kierunek") === "z_PLN" ? "PLN" : s("waluta")} = ${n("wynik")} ${s("walutaWyniku")}; kurs ${n("kursPLN")} PLN/${s("waluta")}, data kursu: ${s("dataKursu") || "nie dotyczy"}`;
      break;
    case "kalkulator":
      if (o.ok === true && n("wynik")) result = `${s("dzialanie")}: a=${n("a")}, b=${n("b")}, wynik=${n("wynik")}`;
      break;
    case "policzKosztKonsultacji":
      if (n("kosztBrutto")) result = `${n("liczbaKonsultacji")} pojedynczych konsultacji: ${n("kosztBrutto")} zł brutto, bez rabatów; to nie rezerwacja ani płatność`;
      break;
    case "dlugoscDnia":
      if (o.ok === true && s("dlugoscDnia")) result = `${s("miasto")}, ${s("data")}: ${s("dlugoscDnia")}; wschód ${s("wschod") || "brak"}, zachód ${s("zachod") || "brak"} (${s("strefa")}). ${s("uwaga")}`;
      break;
    case "wikipedia":
      if (o.ok === true && s("streszczenie")) result = `${s("tytul")}: ${s("streszczenie", 450)}`;
      break;
    case "swieta":
      if (o.ok === true && Array.isArray(o.dni)) result = `${s("kraj")}, ${n("rok")}: ${o.dni.length} świąt publicznych. ` + o.dni.slice(0, 8).map(v => {
        const day = object(v); return `${text(day.data)}: ${text(day.nazwa, 70)}${day.calyKraj === false ? " (regionalne)" : ""}`;
      }).join("; ") + (o.dni.length > 8 ? "; dalsze pozycje w źródle" : "");
      break;
    case "opadyDlaOgrodnika":
      if (o.ok === true && Array.isArray(o.days)) result = `${s("timeZone")}: ` + o.days.slice(0, 7).map(v => {
        const day = object(v); return `${text(day.date)}: ${number(day.rainMm)} mm`;
      }).join("; ");
      break;
    case "notatki":
      if (o.ok === true && o.notatka) result = `Zapisano notatkę: ${text(object(o.notatka).tresc, 250)}. ${s("uwaga", 250)}`;
      else if (o.ok === true && Array.isArray(o.notatki)) result = `${o.notatki.length} notatek: ` + o.notatki.slice(0, 3).map(v => text(object(v).tresc, 100)).join("; ") + `. ${s("uwaga", 250)}`;
      break;
    case "diagnostyka":
      if (o.ok === true) {
        const flags = object(o.wymaganeZmienne);
        result = `Model: ${s("skonfigurowanyModel")}; limit: ${n("limitKrokow")}; narzędzia: ${Array.isArray(o.narzedzia) ? o.narzedzia.map(v => text(v, 40)).join(", ") : ""}. Konfiguracja: ` +
          ["OPENROUTER_API_KEY", "OPENROUTER_MODEL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"].map(key => `${key}: ${flags[key] === "tak" ? "tak" : "nie"}`).join(", ");
      }
      break;
    case "generujObraz": if (o.ok === true) result = "Obraz wygenerowany — plik jest w rozmowie."; break;
    case "odpowiedzPoPolsku": if (o.ok === true) result = "Nagranie przygotowane — odtwarzacz jest w rozmowie."; break;
    case "webSearch": result = "Odebrano wynik wyszukiwania; sprawdź podane źródła."; break;
  }
  return result ? `${name}: ${result}`.slice(0, 800) : null;
}

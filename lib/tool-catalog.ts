// Wspólne nazwy dla etykiet UI i sprawdzania historii; bez konfiguracji serwera.
export const toolLabels: Record<string, string> = {
  webSearch: "🔎 wyszukiwanie", aktualnyCzas: "🕒 aktualnyCzas",
  opadyDlaOgrodnika: "🌧️ opady deszczu dla ogrodnika", generujObraz: "🎨 generowanie obrazu",
  policzKosztKonsultacji: "🧮 policzKosztKonsultacji", odpowiedzPoPolsku: "🔊 odpowiedzPoPolsku",
  dlugoscDnia: "🌅 długość dnia",
  pogoda: "🌤️ pogoda", waluty: "💱 waluty", swieta: "📅 święta", wikipedia: "📖 Wikipedia",
  kalkulator: "🧮 kalkulator", czas: "🕒 czas", notatki: "📝 notatki", diagnostyka: "⚙️ diagnostyka",
};
export const AGENT_STEP_LIMIT = 6;

export const AGENT_TOOL_LIMIT = 16;
export const AGENT_TASK_TIMEOUT_MS = 60_000;
export const AGENT_TOOL_TIMEOUT_MS = 10_000;

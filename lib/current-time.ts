// Funkcja serwerowa. Argument jest wyłącznie punktem zaczepienia dla testów;
// Stara nazwa pozostaje aliasem czasu warszawskiego. Narzędzie czas obsługuje strefy.
export function aktualnyCzas(now: Date = new Date(), timeZone = "Europe/Warsaw") {
  return {
    date: new Intl.DateTimeFormat("sv-SE", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(now),
    weekday: new Intl.DateTimeFormat("pl-PL", { timeZone, weekday: "long" }).format(now),
    time: new Intl.DateTimeFormat("pl-PL", {
      timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).format(now),
    timeZone,
  };
}

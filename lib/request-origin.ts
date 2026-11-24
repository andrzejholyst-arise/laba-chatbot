// Adres, pod którym aplikacja właśnie działa (localhost, adres podglądu lub produkcyjny).
// Opiera się na nagłówku Host, a nie na X-Forwarded-Host. Next dev potrafi budować request.url
// z wewnętrznym hostem 0.0.0.0, więc z niego nie korzystamy. Dozwolone są tylko poprawne nazwy hostów.
export function appOrigin(request: Request) {
  const host = request.headers.get("host");
  if (!host || !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?$/i.test(host)) return null;
  return `${process.env.NODE_ENV === "production" ? "https" : "http"}://${host}`;
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try {
    const source = new URL(origin);
    // Next dev może budować request.url z wewnętrznym hostem 0.0.0.0.
    // Host to adres faktycznie wywołany przez przeglądarkę; nie ufamy X-Forwarded-Host.
    return source.origin === origin && source.host === host &&
      (source.protocol === "https:" ||
        (process.env.NODE_ENV !== "production" && source.protocol === "http:"));
  } catch {
    return false;
  }
}

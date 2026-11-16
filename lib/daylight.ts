import { z } from "zod";
import { cityDateInputSchema, resolveCity } from "./geocoding";
import { failure, publicJson, retrievedAt, validTimeZone } from "./public-api";

export const daylightInputSchema = cityDateInputSchema;
const unixTime = z.number().int().min(0).max(253402300799);
const daylightResponseSchema = z.object({
  timezone: z.string().refine(validTimeZone), utc_offset_seconds: z.number().int().min(-86400).max(86400),
  daily_units: z.object({ time: z.literal("unixtime"), sunrise: z.literal("unixtime"), sunset: z.literal("unixtime"), daylight_duration: z.literal("s") }),
  daily: z.object({ time: z.array(unixTime).length(1), sunrise: z.array(unixTime.nullable()).length(1),
    sunset: z.array(unixTime.nullable()).length(1), daylight_duration: z.array(z.number().min(0).max(86400)).length(1) }),
});
export function formatSunTime(timestamp: number, timeZone: string) {
  return new Intl.DateTimeFormat("pl-PL", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(timestamp * 1000));
}
export async function dlugoscDnia(input: z.input<typeof daylightInputSchema>, signal?: AbortSignal) {
  const parsed = daylightInputSchema.safeParse(input);
  if (!parsed.success) return failure("Podaj miasto, prawdziwą datę RRRR-MM-DD i opcjonalnie dwuliterowy kod kraju oraz region.");
  try {
    const location = await resolveCity(parsed.data, signal);
    if (!location.ok) return location;
    const { place } = location;
    const { data } = parsed.data;
    const localDay = new Intl.DateTimeFormat("sv-SE", { timeZone: place.timezone, year: "numeric", month: "2-digit", day: "2-digit" });
    const today = localDay.format(new Date());
    const daysAhead = (Date.parse(`${data}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000;
    if (daysAhead < 0 || daysAhead > 15) return failure(`Długość dnia jest dostępna od ${today} przez 16 dni w strefie ${place.timezone}. Wybierz datę z tego zakresu.`);
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    // Czas Unix pozwala poprawnie uwzględnić zmianę czasu letniego w Intl.
    url.search = new URLSearchParams({ latitude: String(place.latitude), longitude: String(place.longitude),
      daily: "sunrise,sunset,daylight_duration", timezone: place.timezone, timeformat: "unixtime", start_date: data, end_date: data }).toString();
    const response = daylightResponseSchema.parse(await publicJson(url, signal));
    const day = response.daily;
    // API granice doby zwraca według stałego utc_offset_seconds; zdarzenia
    // słoneczne są znacznikami UTC i przeliczamy je strefą IANA (z DST).
    const returnedDate = new Date((day.time[0] + response.utc_offset_seconds) * 1000).toISOString().slice(0, 10);
    if (returnedDate !== data || response.timezone !== place.timezone) throw new Error("Niezgodna data lub strefa");
    const seconds = day.daylight_duration[0];
    const polar = seconds === 0 || seconds === 86400;
    const sunrise = day.sunrise[0], sunset = day.sunset[0];
    if (!polar && (sunrise === null || sunset === null || sunset <= sunrise || sunset - sunrise > 86400)) throw new Error("Niekompletne godziny");
    if (!polar && [sunrise!, sunset!].some(timestamp => localDay.format(new Date(timestamp * 1000)) !== data)) throw new Error("Niezgodna data zdarzeń");
    const minutes = Math.round(seconds / 60);
    return { ok: true as const, miasto: place.name, kraj: place.country_code, region: place.admin1 ?? null,
      data, strefa: place.timezone,
      wschod: polar ? null : formatSunTime(sunrise!, place.timezone), zachod: polar ? null : formatSunTime(sunset!, place.timezone),
      dlugoscDnia: `${Math.floor(minutes / 60)} godz. ${minutes % 60} min`, dlugoscDniaSekundy: seconds,
      uwaga: seconds === 0 ? "Noc polarna — słońce nie wschodzi. Godziny wschodu i zachodu nie mają zastosowania."
        : seconds === 86400 ? "Dzień polarny — słońce nie zachodzi. Godziny wschodu i zachodu nie mają zastosowania."
          : "Godziny są lokalne dla wskazanej strefy. Długość dnia zaokrąglono do minuty. To czas światła dziennego, nie prognoza nasłonecznienia ani ilość światła przy roślinie.",
      source: "https://open-meteo.com/", retrievedAt: retrievedAt() };
  } catch { return failure("Nie udało się pobrać poprawnych godzin wschodu, zachodu i długości dnia z Open-Meteo. API może nie odpowiadać lub nie mieć kompletnych danych. Spróbuj później."); }
}

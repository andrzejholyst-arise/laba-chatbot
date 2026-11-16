import { AGENT_TOOL_TIMEOUT_MS } from "./tool-catalog";
import { z } from "zod";

export const retrievedAt = () => new Date().toISOString();
export const failure = (message: string) => ({ ok: false as const, message, retrievedAt: retrievedAt() });
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Podaj prawdziwą datę RRRR-MM-DD.");
export const countryCode = z.string().regex(/^[A-Za-z]{2}$/);
export function validTimeZone(value: string) {
  try { new Intl.DateTimeFormat("pl-PL", { timeZone: value }); return true; } catch { return false; }
}
export class PublicApiError extends Error {
  constructor(public status: number) { super("Nieprawidłowa odpowiedź publicznego API"); }
}
const hosts = new Set(["geocoding-api.open-meteo.com", "api.open-meteo.com", "api.nbp.pl", "date.nager.at", "pl.wikipedia.org"]);
// Wspólny limit czasu i rozmiaru. Model nie wybiera hosta ani nagłówków.
export async function publicJson(url: URL, signal?: AbortSignal): Promise<unknown> {
  if (url.protocol !== "https:" || url.port || !hosts.has(url.hostname)) throw new PublicApiError(400);
  const response = await fetch(url, {
    cache: "no-store", redirect: "error",
    signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(AGENT_TOOL_TIMEOUT_MS)]),
    headers: { Accept: "application/json", "User-Agent": "StudioNova/1.0 (https://github.com/andrzejholyst-arise/laba-chatbot)" },
  });
  if (!response.ok) { await response.body?.cancel(); throw new PublicApiError(response.status); }
  if (!response.body) throw new PublicApiError(502);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 512_000) { await reader.cancel(); throw new PublicApiError(502); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

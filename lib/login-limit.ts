import { checkRateLimit } from "@vercel/firewall";

// Wyłącznie lokalny limit deweloperski, wspólny dla prób w tym procesie.
// Produkcja zawsze korzysta ze współdzielonej zapory, bez fallbacku do pamięci.
let attempts = 0;
let resetAt = 0;

export async function limitLogin(): Promise<"allowed" | "limited" | "unavailable"> {
  if (process.env.NODE_ENV !== "production") {
    if (Date.now() >= resetAt) {
      attempts = 0;
      resetAt = Date.now() + 60_000;
    }
    return ++attempts > 10 ? "limited" : "allowed";
  }
  if (process.env.VERCEL !== "1" || !process.env.VERCEL_URL) return "unavailable";
  try {
    const result = await checkRateLimit("workshop-login", {
      headers: new Headers({ host: process.env.VERCEL_URL }),
      rateLimitKey: "workshop-login",
      timeout: 2000,
    });
    if (result.error === "not-found") return "unavailable";
    return result.rateLimited ? "limited" : "allowed";
  } catch {
    return "unavailable";
  }
}

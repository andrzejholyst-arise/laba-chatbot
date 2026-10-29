import { checkRateLimit } from "@vercel/firewall";

// Wyłącznie lokalny limit deweloperski, wspólny dla prób w tym procesie.
// Produkcja zawsze korzysta ze współdzielonej zapory, bez fallbacku do pamięci.
let attempts = 0;
let resetAt = 0;

export async function limitLogin(request: Request): Promise<"allowed" | "limited" | "unavailable"> {
  if (process.env.NODE_ENV !== "production") {
    if (Date.now() >= resetAt) {
      attempts = 0;
      resetAt = Date.now() + 60_000;
    }
    return ++attempts > 10 ? "limited" : "allowed";
  }
  if (process.env.VERCEL !== "1") return "unavailable";
  try {
    const result = await checkRateLimit("workshop-login", {
      // VERCEL_URL może wymagać Vercel Authentication nawet dla produkcji.
      // SDK używa faktycznej domeny żądania i przekazuje cookie ochrony Vercel.
      request,
      rateLimitKey: "workshop-login",
      timeout: 5000,
    });
    if (result.error === "not-found") return "unavailable";
    return result.rateLimited ? "limited" : "allowed";
  } catch {
    return "unavailable";
  }
}

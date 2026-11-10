import { z } from "zod";

export const MAX_SPEECH_BYTES = 4 * 1024 * 1024;
export const speechInputSchema = z.strictObject({ tekst: z.string().trim().min(1).max(2000) });
export const speechResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), tekst: z.string().min(1).max(2000),
    audioUrl: z.string().max(Math.ceil(MAX_SPEECH_BYTES / 3) * 4 + 23).regex(/^data:audio\/mpeg;base64,[A-Za-z0-9+/]+={0,2}$/) }),
  z.strictObject({ ok: z.literal(false), error: z.string().min(1) }),
]);

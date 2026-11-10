import { z } from "zod";
import { MAX_IMAGE_BYTES } from "./image-files";

export const imagePromptSchema = z.strictObject({ prompt: z.string().trim().min(1).max(500) });
export const imageToolResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    dataUrl: z.string().startsWith("data:image/png;base64,").max(Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 22),
    modelId: z.string().min(1).nullable(),
  }),
  z.strictObject({ ok: z.literal(false), error: z.string() }),
]);

export type ImageToolResult = z.infer<typeof imageToolResultSchema>;

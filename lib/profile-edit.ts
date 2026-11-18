import { z } from "zod";

export const profileEditSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("set-name"), value: z.string().trim().min(1).max(60).nullable() }),
  z.strictObject({ action: z.literal("set-preference"), key: z.string().min(1).max(50), value: z.string().trim().min(1).max(160) }),
  z.strictObject({ action: z.literal("remove-preference"), key: z.string().min(1).max(50) }),
  z.strictObject({ action: z.literal("clear") }),
]);
export type ProfileEdit = z.infer<typeof profileEditSchema>;

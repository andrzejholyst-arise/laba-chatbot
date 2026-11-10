import { z } from "zod";

// strictObject odrzuca dodatkowe pola zamiast je usuwać.
export const analysisSchema = z.strictObject({
  category: z.enum(["sales", "support", "billing", "unknown"]),
  priority: z.enum(["normal", "high"]),
  draft: z.string(),
  needs_review: z.boolean(),
});

export type Analysis = z.infer<typeof analysisSchema>;
export const analysisVariantSchema = z.enum(["baseline", "step_by_step"]);
export type AnalysisVariant = z.infer<typeof analysisVariantSchema>;

export const analysisRequestSchema = z.strictObject({
  message: z.string().trim().min(1).max(12000),
  variant: analysisVariantSchema.optional(),
});

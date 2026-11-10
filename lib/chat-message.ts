import type { UIMessage } from "ai";

export type ChatMessage = UIMessage<{
  retrievedAt?: string; modelId?: string | null; vision?: boolean; generatedImage?: boolean;
  stepLimitReached?: boolean; stepsCompleted?: number;
}>;

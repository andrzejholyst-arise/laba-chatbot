import type { StopReason, ToolFailure } from "./task-budget";
import type { UIMessage } from "ai";

export type ChatMessage = UIMessage<{
  retrievedAt?: string; modelId?: string | null; vision?: boolean; generatedImage?: boolean;
  modelSteps?: number; stepLimit?: number; toolCalls?: number; durationMs?: number;
  stopReason?: StopReason; stopMessage?: string; toolFailures?: ToolFailure[]; blockedToolCallIds?: string[];
  stepLimitReached?: boolean; stepsCompleted?: number; partialFindings?: string[];
}>;

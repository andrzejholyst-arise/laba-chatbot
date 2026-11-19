import type { StopReason, ToolFailure } from "./task-budget";
import type { UIMessage } from "ai";
import type { KnowledgeSource } from "./knowledge-sources";

export type ChatMessage = UIMessage<{
  retrievedAt?: string; modelId?: string | null; vision?: boolean; generatedImage?: boolean;
  modelSteps?: number; stepLimit?: number; toolCalls?: number; durationMs?: number;
  stopReason?: StopReason; stopMessage?: string; toolFailures?: ToolFailure[]; blockedToolCallIds?: string[];
  stepLimitReached?: boolean; stepsCompleted?: number; partialFindings?: string[];
  conversationId?: string; persisted?: boolean; persistenceError?: string; titleError?: string;
  knowledgeSources?: KnowledgeSource[]; knowledgeSearched?: boolean;
}>;

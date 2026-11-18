export type ConversationSummary = {
  conversationId: string;
  title: string;
  createdAt: string;
  messageCount: number;
};

export type ConversationHistory = {
  conversations: ConversationSummary[];
  nextOffset: number | null;
};

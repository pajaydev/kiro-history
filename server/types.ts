export interface ConversationEntry {
  key: string; // Directory path (PRIMARY KEY)
  value: string; // JSON string of conversation state
}

export interface ParsedConversation {
  directoryPath: string;
  conversationId: string;
  messages: ConversationMessage[];
  updatedAt?: number; // Unix timestamp in milliseconds
  /**
   * Id to pass to `kiro-cli chat --resume-id`. Absent when the conversation
   * cannot be resumed (IDE sessions, and legacy DB rows whose ids are
   * synthesized by splitting history on time gaps).
   */
  resumeId?: string;
}

export interface ToolUse {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface TurnMetadata {
  creditCost: number;       // sum of metering_usage[].value
  model: string;            // model ID ("auto", "claude-sonnet-4.6", etc.)
  requestCount: number;     // total_request_count
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  toolUses?: ToolUse[];
  turnMetadata?: TurnMetadata;
}

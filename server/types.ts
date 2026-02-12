export interface ConversationEntry {
  key: string; // Directory path (PRIMARY KEY)
  value: string; // JSON string of conversation state
}

export interface ParsedConversation {
  directoryPath: string;
  conversationId: string;
  messages: ConversationMessage[];
}

export interface ToolUse {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  toolUses?: ToolUse[];
}

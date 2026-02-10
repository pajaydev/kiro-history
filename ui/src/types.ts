// Command entry from the history table
export interface CommandEntry {
  id: number;
  command: string;
  shell: string;
  pid: number;
  sessionId: string;
  cwd: string;
  startTime: number; // Unix timestamp
  hostname: string;
  exitCode: number | null;
  endTime: number | null;
  duration: number | null;
}

// Raw conversation entry from the conversations table
export interface ConversationEntry {
  key: string; // Directory path (PRIMARY KEY)
  value: string; // JSON string of conversation state
}

// Parsed conversation after JSON extraction
export interface ParsedConversation {
  directoryPath: string;
  conversationId: string;
  messages: ConversationMessage[];
  updatedAt?: number; // Unix timestamp in milliseconds (from V2 table)
}

// Tool use entry
export interface ToolUse {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

// Individual message in a conversation
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  toolUses?: ToolUse[];
}

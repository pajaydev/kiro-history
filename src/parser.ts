import type { ParsedConversation, ConversationMessage } from './types.js';

interface RawConversation {
  conversation_id: string;
  history: RawHistoryEntry[];
}

interface RawHistoryEntry {
  user?: {
    timestamp?: string;
    content: {
      Prompt?: { prompt: string };
      ToolUseResults?: unknown;
    };
  };
  assistant?: {
    Response?: { message_id: string; content: string };
    ToolUse?: { message_id: string; content: string; tool_uses: unknown[] };
  };
}

interface SessionMessage extends ConversationMessage {
  timestamp?: Date;
}

// Gap threshold for splitting sessions (30 minutes)
const SESSION_GAP_MS = 30 * 60 * 1000;

export function parseConversationValue(
  key: string,
  jsonValue: string
): ParsedConversation[] {
  try {
    const raw = JSON.parse(jsonValue) as RawConversation;
    
    if (!raw.history || !Array.isArray(raw.history)) {
      return [{
        directoryPath: key,
        conversationId: raw.conversation_id || '',
        messages: [],
      }];
    }

    // Extract all messages with timestamps
    const allMessages: SessionMessage[] = [];
    
    for (const entry of raw.history) {
      let timestamp: Date | undefined;
      
      // Extract user message if it's a Prompt (skip ToolUseResults)
      if (entry.user?.content?.Prompt?.prompt) {
        if (entry.user.timestamp) {
          timestamp = new Date(entry.user.timestamp);
        }
        allMessages.push({
          role: 'user',
          content: entry.user.content.Prompt.prompt,
          timestamp,
        });
      }

      // Extract assistant message from Response or ToolUse
      if (entry.assistant) {
        if (entry.assistant.Response?.content) {
          allMessages.push({
            role: 'assistant',
            content: entry.assistant.Response.content,
            timestamp,
          });
        } else if (entry.assistant.ToolUse?.content) {
          allMessages.push({
            role: 'assistant',
            content: entry.assistant.ToolUse.content,
            timestamp,
          });
        }
      }
    }

    // Group messages into sessions based on time gaps
    const sessions: ParsedConversation[] = [];
    let currentSession: ConversationMessage[] = [];
    let lastTimestamp: Date | undefined;
    let sessionIndex = 0;

    for (const msg of allMessages) {
      // Check if we should start a new session
      if (msg.timestamp && lastTimestamp) {
        const gap = msg.timestamp.getTime() - lastTimestamp.getTime();
        if (gap > SESSION_GAP_MS) {
          // Save current session and start new one
          if (currentSession.length > 0) {
            sessions.push({
              directoryPath: key,
              conversationId: `${raw.conversation_id || 'unknown'}-${sessionIndex}`,
              messages: currentSession,
            });
            sessionIndex++;
            currentSession = [];
          }
        }
      }

      currentSession.push({
        role: msg.role,
        content: msg.content,
      });
      
      if (msg.timestamp) {
        lastTimestamp = msg.timestamp;
      }
    }

    // Don't forget the last session
    if (currentSession.length > 0) {
      sessions.push({
        directoryPath: key,
        conversationId: `${raw.conversation_id || 'unknown'}-${sessionIndex}`,
        messages: currentSession,
      });
    }

    return sessions.length > 0 ? sessions : [{
      directoryPath: key,
      conversationId: raw.conversation_id || '',
      messages: [],
    }];
  } catch (error) {
    console.warn(`Failed to parse conversation for ${key}:`, error);
    return [];
  }
}

// Simple parser that returns all messages without session splitting
// Used for V2 conversations which are already separate
export function parseConversationValueSimple(
  key: string,
  jsonValue: string
): ConversationMessage[] {
  try {
    const raw = JSON.parse(jsonValue) as RawConversation;
    const messages: ConversationMessage[] = [];

    if (!raw.history || !Array.isArray(raw.history)) {
      return [];
    }

    for (const entry of raw.history) {
      // Extract user message if it's a Prompt (skip ToolUseResults)
      if (entry.user?.content?.Prompt?.prompt) {
        messages.push({
          role: 'user',
          content: entry.user.content.Prompt.prompt,
        });
      }

      // Extract assistant message from Response or ToolUse
      if (entry.assistant) {
        if (entry.assistant.Response?.content) {
          messages.push({
            role: 'assistant',
            content: entry.assistant.Response.content,
          });
        } else if (entry.assistant.ToolUse?.content) {
          messages.push({
            role: 'assistant',
            content: entry.assistant.ToolUse.content,
          });
        }
      }
    }

    return messages;
  } catch (error) {
    console.warn(`Failed to parse conversation for ${key}:`, error);
    return [];
  }
}

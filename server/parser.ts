import type { ParsedConversation, ConversationMessage, ToolUse } from './types.js';

interface RawToolUse {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

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
    ToolUse?: { message_id: string; content: string; tool_uses: RawToolUse[] };
  };
}

interface SessionMessage extends ConversationMessage {
  timestamp?: Date;
}

function extractToolUses(rawToolUses?: RawToolUse[]): ToolUse[] | undefined {
  if (!rawToolUses || rawToolUses.length === 0) return undefined;
  return rawToolUses.map((t) => ({
    id: t.id,
    name: t.name,
    args: t.args,
  }));
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
        let content = '';
        let toolUses: ToolUse[] | undefined;

        if (entry.assistant.Response?.content) {
          content = entry.assistant.Response.content;
        } else if (entry.assistant.ToolUse) {
          content = entry.assistant.ToolUse.content;
          toolUses = extractToolUses(entry.assistant.ToolUse.tool_uses);
        }

        // Merge with previous assistant message if exists
        const lastMsg = messages[messages.length - 1];
        if (lastMsg && lastMsg.role === 'assistant') {
          // Append content (with separator if both have content)
          if (content) {
            lastMsg.content = lastMsg.content 
              ? lastMsg.content + '\n\n' + content 
              : content;
          }
          // Merge tool uses
          if (toolUses) {
            lastMsg.toolUses = lastMsg.toolUses 
              ? [...lastMsg.toolUses, ...toolUses] 
              : toolUses;
          }
        } else {
          messages.push({
            role: 'assistant',
            content,
            toolUses,
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

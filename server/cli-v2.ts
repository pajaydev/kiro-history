import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { ParsedConversation, ConversationMessage, ToolUse } from './types.js';

interface V2SessionMeta {
  session_id: string;
  cwd: string;
  created_at: string;
  updated_at: string;
  title: string;
}

interface V2Content {
  kind: string;
  data: unknown;
}

interface V2ToolUseData {
  toolUseId: string;
  name: string;
  input: Record<string, unknown>;
}

export interface CliV2Reader {
  getConversations(): ParsedConversation[];
  close(): void;
}

export function resolveCliV2Path(): string {
  return join(homedir(), '.kiro', 'sessions', 'cli');
}

function parseJsonlMessages(jsonlPath: string): ConversationMessage[] {
  const messages: ConversationMessage[] = [];

  let lines: string[];
  try {
    lines = readFileSync(jsonlPath, 'utf-8').split('\n').filter(l => l.trim());
  } catch {
    return [];
  }

  for (const line of lines) {
    let entry: { kind: string; data: { content?: V2Content[] } };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const content = entry.data?.content;

    if (entry.kind === 'Prompt' && Array.isArray(content)) {
      const textParts: string[] = [];
      for (const c of content) {
        if (c.kind === 'text' && typeof c.data === 'string') {
          textParts.push(c.data);
        }
      }
      if (textParts.length > 0) {
        messages.push({ role: 'user', content: textParts.join('\n') });
      }
    } else if (entry.kind === 'AssistantMessage' && Array.isArray(content)) {
      let text = '';
      const toolUses: ToolUse[] = [];

      for (const c of content) {
        if (c.kind === 'text' && typeof c.data === 'string') {
          text += c.data;
        } else if (c.kind === 'toolUse' && c.data && typeof c.data === 'object') {
          const td = c.data as V2ToolUseData;
          toolUses.push({
            id: td.toolUseId || '',
            name: td.name || '',
            args: td.input || {},
          });
        }
      }

      // Merge with previous assistant message if exists
      const last = messages[messages.length - 1];
      if (last && last.role === 'assistant') {
        if (text) {
          last.content = last.content ? last.content + '\n\n' + text : text;
        }
        if (toolUses.length > 0) {
          last.toolUses = last.toolUses ? [...last.toolUses, ...toolUses] : toolUses;
        }
      } else {
        messages.push({
          role: 'assistant',
          content: text,
          ...(toolUses.length > 0 ? { toolUses } : {}),
        });
      }
    }
    // ToolResults entries are skipped — they don't map to user-visible messages
  }

  return messages;
}

export function createCliV2Reader(sessionsDir: string): CliV2Reader {
  return {
    getConversations(): ParsedConversation[] {
      if (!existsSync(sessionsDir)) return [];

      const conversations: ParsedConversation[] = [];
      let files: string[];
      try {
        files = readdirSync(sessionsDir).filter(f => f.endsWith('.json') && !f.endsWith('.lock'));
      } catch {
        return [];
      }

      for (const file of files) {
        const metaPath = join(sessionsDir, file);
        let meta: V2SessionMeta;
        try {
          meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
        } catch {
          continue;
        }

        const jsonlPath = metaPath.replace(/\.json$/, '.jsonl');
        const messages = parseJsonlMessages(jsonlPath);
        if (messages.length === 0) continue;

        const updatedAt = meta.updated_at ? new Date(meta.updated_at).getTime() : undefined;

        conversations.push({
          directoryPath: meta.cwd || '',
          conversationId: meta.session_id || file.replace('.json', ''),
          messages,
          updatedAt,
        });
      }

      // Sort by recency
      conversations.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      return conversations;
    },

    close(): void {
      // No resources to clean up
    },
  };
}

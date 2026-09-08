import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { ParsedConversation, ConversationMessage, ToolUse, TurnMetadata } from './types.js';

// ── session.json schema ─────────────────────────────────────────────

interface IdeV1SessionMeta {
  id: string;
  title?: string;
  agentMode?: string;
  workspacePaths?: string[];
  rootPaths?: string[];
  createdAt: string;
  lastModifiedAt: string;
  modelId?: string;
  status?: string;
  description?: string;
}

// ── messages.jsonl payload types ────────────────────────────────────

interface JsonlEntry {
  id: string;
  timestamp: string;
  payload: JsonlPayload;
}

type JsonlPayload =
  | { type: 'user'; content: string }
  | { type: 'assistant'; content: string; executionId?: string }
  | { type: 'tool_call'; toolCallId: string; toolName: string; args: Record<string, unknown>; status?: string }
  | { type: 'tool_result'; toolCallId: string; content?: string; success?: boolean }
  | { type: 'turn_start'; executionId?: string }
  | { type: 'turn_end'; stopReason?: string; executionId?: string }
  | { type: string; [key: string]: unknown }; // catch-all for types we don't parse

// ── Reader interface ────────────────────────────────────────────────

export interface IdeV1Reader {
  getConversations(): ParsedConversation[];
  close(): void;
}

// ── Path resolution ─────────────────────────────────────────────────

/**
 * Returns the base path for new-format IDE sessions: ~/.kiro/sessions/
 * The actual workspace-hash directories are children of this path.
 */
export function resolveIdeV1BasePath(): string {
  return join(homedir(), '.kiro', 'sessions');
}

/**
 * Scans ~/.kiro/sessions/ and returns workspace-hash directory paths,
 * excluding the `cli` directory (that's for CLI V2 sessions).
 */
export function resolveIdeV1WorkspaceDirs(basePath?: string): string[] {
  const sessionsDir = basePath || resolveIdeV1BasePath();
  if (!existsSync(sessionsDir)) return [];

  const dirs: string[] = [];
  try {
    for (const entry of readdirSync(sessionsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      // Skip `cli` — that's the CLI V2 reader's domain
      if (entry.name === 'cli') continue;
      dirs.push(join(sessionsDir, entry.name));
    }
  } catch {
    // sessionsDir might not be readable
  }
  return dirs;
}

// ── JSONL parser ────────────────────────────────────────────────────

/**
 * Extracts tool_call entries from a sub-execution JSONL file.
 * Returns ToolUse[] for all tool calls found (excluding internal tools like subagent_response).
 */
function parseSubExecutionToolCalls(subExecPath: string): ToolUse[] {
  let lines: string[];
  try {
    lines = readFileSync(subExecPath, 'utf-8').split('\n').filter(l => l.trim());
  } catch {
    return [];
  }

  const toolUses: ToolUse[] = [];
  for (const line of lines) {
    let entry: JsonlEntry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const payload = entry.payload;
    if (!payload || payload.type !== 'tool_call') continue;

    const p = payload as { type: 'tool_call'; toolCallId: string; toolName: string; args: Record<string, unknown> };
    // Skip internal orchestration tools
    if (p.toolName === 'subagent_response' || p.toolName === 'report_progress') continue;

    toolUses.push({
      id: p.toolCallId || '',
      name: p.toolName || '',
      args: p.args || {},
    });
  }

  return toolUses;
}

function parseIdeV1Messages(jsonlPath: string, sessionDir: string, modelId?: string): ConversationMessage[] {
  let lines: string[];
  try {
    lines = readFileSync(jsonlPath, 'utf-8').split('\n').filter(l => l.trim());
  } catch {
    return [];
  }

  const messages: ConversationMessage[] = [];
  // Accumulate tool calls per turn so we can attach them to the assistant message
  let pendingToolUses: ToolUse[] = [];
  let pendingAssistantContent = '';
  let pendingTurnMetadata: TurnMetadata | undefined;
  let inTurn = false;

  for (const line of lines) {
    let entry: JsonlEntry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const payload = entry.payload;
    if (!payload || !payload.type) continue;

    switch (payload.type) {
      case 'user': {
        // Flush any pending assistant content from previous turn
        flushAssistant();
        const content = (payload as { type: 'user'; content: string }).content;
        if (content) {
          messages.push({ role: 'user', content });
        }
        break;
      }

      case 'turn_start': {
        inTurn = true;
        pendingToolUses = [];
        pendingAssistantContent = '';
        pendingTurnMetadata = undefined;
        break;
      }

      case 'assistant': {
        const content = (payload as { type: 'assistant'; content: string }).content;
        // Skip streaming placeholders ('...')
        if (content && content !== '...') {
          pendingAssistantContent = content;
        }
        break;
      }

      case 'tool_call': {
        const p = payload as { type: 'tool_call'; toolCallId: string; toolName: string; args: Record<string, unknown> };
        pendingToolUses.push({
          id: p.toolCallId || '',
          name: p.toolName || '',
          args: p.args || {},
        });
        break;
      }

      case 'usage_summary': {
        const p = payload as {
          type: 'usage_summary';
          promptTurnSummaries?: { usage?: number; unit?: string }[];
          requestIds?: string[];
        };
        const summaries = p.promptTurnSummaries;
        const creditCost = Array.isArray(summaries)
          ? summaries.reduce((sum, s) => sum + (s.usage || 0), 0)
          : 0;
        const requestCount = Array.isArray(p.requestIds) ? p.requestIds.length : 0;
        pendingTurnMetadata = {
          creditCost,
          model: modelId || 'unknown',
          requestCount,
        };
        break;
      }

      case 'turn_end': {
        flushAssistant();
        inTurn = false;
        break;
      }

      case 'sub_agent_start': {
        const p = payload as { type: 'sub_agent_start'; subSessionId?: string };
        if (p.subSessionId) {
          const subExecPath = join(sessionDir, 'sub-executions', `${p.subSessionId}.jsonl`);
          const subToolCalls = parseSubExecutionToolCalls(subExecPath);
          pendingToolUses.push(...subToolCalls);
        }
        break;
      }

      // All other payload types (session_metadata, steering_inclusion, etc.) are skipped
    }
  }

  // Flush any remaining assistant content (session might not have a final turn_end)
  flushAssistant();

  return messages;

  function flushAssistant(): void {
    if (pendingAssistantContent || pendingToolUses.length > 0) {
      const msg: ConversationMessage = {
        role: 'assistant',
        content: pendingAssistantContent,
        ...(pendingToolUses.length > 0 ? { toolUses: [...pendingToolUses] } : {}),
      };
      if (pendingTurnMetadata) {
        msg.turnMetadata = pendingTurnMetadata;
      }
      messages.push(msg);
      pendingAssistantContent = '';
      pendingToolUses = [];
      pendingTurnMetadata = undefined;
    }
  }
}

// ── Reader factory ──────────────────────────────────────────────────

export function createIdeV1Reader(workspaceDirs: string[]): IdeV1Reader {
  return {
    getConversations(): ParsedConversation[] {
      const conversations: ParsedConversation[] = [];

      for (const wsDir of workspaceDirs) {
        if (!existsSync(wsDir)) continue;

        let sessionDirs: string[];
        try {
          sessionDirs = readdirSync(wsDir, { withFileTypes: true })
            .filter(e => e.isDirectory())
            .map(e => e.name);
        } catch {
          continue;
        }

        for (const sessionId of sessionDirs) {
          const sessionDir = join(wsDir, sessionId);
          const metaPath = join(sessionDir, 'session.json');
          const jsonlPath = join(sessionDir, 'messages.jsonl');

          if (!existsSync(metaPath) || !existsSync(jsonlPath)) continue;

          let meta: IdeV1SessionMeta;
          try {
            meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
          } catch {
            continue;
          }

          const messages = parseIdeV1Messages(jsonlPath, sessionDir, meta.modelId);
          if (messages.length === 0) continue;

          const updatedAt = meta.lastModifiedAt
            ? new Date(meta.lastModifiedAt).getTime()
            : meta.createdAt
              ? new Date(meta.createdAt).getTime()
              : undefined;

          // Use workspacePaths[0] as directoryPath, fall back to rootPaths[0]
          const dirPath = meta.workspacePaths?.[0]
            || meta.rootPaths?.[0]
            || wsDir;

          conversations.push({
            directoryPath: dirPath,
            conversationId: meta.id || sessionId,
            messages,
            updatedAt,
          });
        }
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

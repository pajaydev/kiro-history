import { readdirSync, readFileSync, existsSync } from 'fs';
import { basename, join } from 'path';
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
  | { type: 'assistant'; content: string; executionId?: string; operationType?: string }
  | { type: 'tool_call'; toolCallId: string; toolName: string; args: Record<string, unknown>; status?: string }
  | { type: 'tool_result'; toolCallId: string; content?: string; success?: boolean }
  | { type: 'turn_start'; executionId?: string }
  | { type: 'turn_end'; stopReason?: string; executionId?: string }
  | { type: string; [key: string]: unknown }; // catch-all for types we don't parse

// ── Reader interface ────────────────────────────────────────────────

export interface IdeV1Reader {
  getConversations(): ParsedConversation[];
  /**
   * Re-resolve the set of workspace-hash directories under the base path.
   * Lets the reader pick up IDE workspaces created after startup without a
   * restart. No-op when the reader was created without a base path (i.e. with
   * an explicit, fixed directory list).
   */
  refresh(): void;
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

/**
 * Kiro CLI 3.x writes its sessions in the same format and under the same
 * ~/.kiro/sessions/<workspace-hash>/ directories as Kiro IDE. Only the CLI
 * records them in ~/.kiro/session-index/<workspace-hash>.jsonl, so that index
 * is what tells the two apart.
 */
export function resolveCliV3IndexPath(): string {
  return join(homedir(), '.kiro', 'session-index');
}

/**
 * Returns the set of `<workspace-hash>/<session-id>` paths that belong to
 * Kiro CLI 3.x, replaying the index's add/remove operations in order.
 */
export function readCliV3SessionPaths(indexDir: string = resolveCliV3IndexPath()): Set<string> {
  const paths = new Set<string>();
  let files: string[];
  try {
    files = readdirSync(indexDir).filter(f => f.endsWith('.jsonl'));
  } catch {
    return paths;
  }
  for (const file of files) {
    let lines: string[];
    try {
      lines = readFileSync(join(indexDir, file), 'utf-8').split('\n');
    } catch {
      continue;
    }
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as { op?: string; sessionPath?: string };
        if (typeof entry.sessionPath !== 'string') continue;
        if (entry.op === 'add') paths.add(entry.sessionPath);
        else if (entry.op === 'remove') paths.delete(entry.sessionPath);
      } catch {
        // skip malformed lines
      }
    }
  }
  return paths;
}

/**
 * Counts the session directories under ~/.kiro/sessions/ that belong to Kiro
 * IDE and to Kiro CLI 3.x, without parsing them. Used at startup to decide
 * which sources exist.
 */
export function countIdeV1Sessions(
  basePath?: string,
  indexDir?: string,
): { ide: number; cli: number } {
  const cliPaths = readCliV3SessionPaths(indexDir);
  const counts = { ide: 0, cli: 0 };
  for (const wsDir of resolveIdeV1WorkspaceDirs(basePath)) {
    let entries: string[];
    try {
      entries = readdirSync(wsDir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);
    } catch {
      continue;
    }
    for (const sessionId of entries) {
      if (!existsSync(join(wsDir, sessionId, 'session.json'))) continue;
      if (cliPaths.has(`${basename(wsDir)}/${sessionId}`)) counts.cli++;
      else counts.ide++;
    }
  }
  return counts;
}

/** Which sessions a reader returns: IDE sessions, or Kiro CLI 3.x sessions. */
export type IdeV1ReaderKind = 'ide' | 'cli';

// ── JSONL parser ────────────────────────────────────────────────────

function parseIdeV1Messages(jsonlPath: string, modelId?: string): ConversationMessage[] {
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
        const { content, operationType } = payload as { type: 'assistant'; content: string; operationType?: string };
        // Skip the model's thinking: it is logged as an assistant entry with
        // operationType 'Reasoning' and must not replace the actual reply.
        if (operationType === 'Reasoning') break;
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

/**
 * Creates a reader for new-format IDE sessions.
 *
 * @param workspaceDirs Initial list of `<workspace-hash>` directories to read.
 * @param basePath Optional `~/.kiro/sessions/` base path. When provided,
 *   `refresh()` re-scans it so workspace directories created after startup are
 *   picked up without a restart. When omitted, `refresh()` is a no-op and the
 *   reader operates on the fixed `workspaceDirs` list it was given.
 */
export function createIdeV1Reader(
  workspaceDirs: string[],
  basePath?: string,
  options: { kind?: IdeV1ReaderKind; cliIndexDir?: string } = {},
): IdeV1Reader {
  const kind = options.kind ?? 'ide';
  // Mutable so refresh() can replace it with a freshly-scanned list.
  let currentWorkspaceDirs = workspaceDirs;

  function refresh(): void {
    if (!basePath) return; // fixed-list mode: nothing to re-resolve
    currentWorkspaceDirs = resolveIdeV1WorkspaceDirs(basePath);
  }

  return {
    getConversations(): ParsedConversation[] {
      // Re-resolve first so newly-created workspace dirs are included.
      refresh();
      // Re-read each time so sessions the CLI creates later are classified.
      const cliPaths = readCliV3SessionPaths(options.cliIndexDir);

      const conversations: ParsedConversation[] = [];

      for (const wsDir of currentWorkspaceDirs) {
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
          const isCli = cliPaths.has(`${basename(wsDir)}/${sessionId}`);
          if (isCli !== (kind === 'cli')) continue;
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

          const messages = parseIdeV1Messages(jsonlPath, meta.modelId);
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
            // CLI 3.x resumes by session id: `kiro-cli chat --resume-id <id>`
            ...(kind === 'cli' ? { resumeId: meta.id || sessionId } : {}),
          });
        }
      }

      // Sort by recency
      conversations.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      return conversations;
    },

    refresh,

    close(): void {
      // No resources to clean up
    },
  };
}

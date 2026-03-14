import { readdirSync, readFileSync, existsSync, statSync, openSync, readSync, closeSync } from 'fs';
import { join } from 'path';
import type { ConversationMessage, ParsedConversation, ToolUse } from './types.js';

interface IdeSessionIndex {
  sessionId: string;
  title: string;
  dateCreated: string;
  workspaceDirectory: string;
  hidden?: boolean;
}

// ── .chat file types ────────────────────────────────────────────────

interface ChatFileMessage {
  role: 'human' | 'bot' | 'tool';
  content: string;
}

interface ChatFileMetadata {
  modelId?: string;
  workflow?: string;
  workflowId?: string;
  startTime?: number;
  endTime?: number;
}

interface ChatFile {
  executionId: string;
  actionId?: string;
  chat: ChatFileMessage[];
  metadata: ChatFileMetadata;
}

// ── Workspace-session JSON types ────────────────────────────────────

interface WsHistoryEntry {
  message: {
    role: 'user' | 'assistant';
    content: string | Array<{ type: string; text: string }>;
    id?: string;
  };
  executionId?: string;
}

interface WsSessionData {
  history: WsHistoryEntry[];
  title?: string;
  sessionId?: string;
  workspacePath?: string;
  workspaceDirectory?: string;
}

// ── Execution index stored alongside .chat files ────────────────────

interface ExecutionIndex {
  executions: Array<{ executionId: string }>;
}

// ── Execution log types (detailed action records) ───────────────────

const EXEC_LOG_DIR = '414d1636299d2b9e4ce7e17fb11f63e9';

interface ExecAction {
  actionType: string;
  actionState?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
}

interface ExecLog {
  executionId: string;
  actions?: ExecAction[];
}

interface ExecResult {
  content: string;
  toolUses: ToolUse[];
}

/**
 * Compute a simple unified-style diff between two strings.
 * Shows only changed hunks with a few lines of context.
 */
function computeSimpleDiff(original: string, modified: string): string {
  const origLines = original.split('\n');
  const modLines = modified.split('\n');

  const hunks: string[] = [];
  const CONTEXT = 3;
  let i = 0;
  let j = 0;

  while (i < origLines.length || j < modLines.length) {
    if (i < origLines.length && j < modLines.length && origLines[i] === modLines[j]) {
      i++;
      j++;
      continue;
    }

    // Found a difference — collect the hunk
    const hunkStart = Math.max(0, i - CONTEXT);
    const hunkLines: string[] = [];

    // Add context before
    for (let c = hunkStart; c < i; c++) {
      hunkLines.push(` ${origLines[c]}`);
    }

    // Collect differing lines
    const origStart = i;
    const modStart = j;

    // Simple approach: scan forward to find next matching line
    while (i < origLines.length || j < modLines.length) {
      if (i < origLines.length && j < modLines.length && origLines[i] === modLines[j]) {
        break;
      }
      // Try to find origLines[i] in upcoming modLines
      let foundInMod = -1;
      if (i < origLines.length) {
        for (let k = j; k < Math.min(j + 10, modLines.length); k++) {
          if (origLines[i] === modLines[k]) { foundInMod = k; break; }
        }
      }
      // Try to find modLines[j] in upcoming origLines
      let foundInOrig = -1;
      if (j < modLines.length) {
        for (let k = i; k < Math.min(i + 10, origLines.length); k++) {
          if (modLines[j] === origLines[k]) { foundInOrig = k; break; }
        }
      }

      if (foundInMod >= 0 && (foundInOrig < 0 || foundInMod - j <= foundInOrig - i)) {
        // Lines were added in modified
        while (j < foundInMod) {
          hunkLines.push(`+${modLines[j]}`);
          j++;
        }
      } else if (foundInOrig >= 0) {
        // Lines were removed from original
        while (i < foundInOrig) {
          hunkLines.push(`-${origLines[i]}`);
          i++;
        }
      } else {
        // Both changed
        if (i < origLines.length) { hunkLines.push(`-${origLines[i]}`); i++; }
        if (j < modLines.length) { hunkLines.push(`+${modLines[j]}`); j++; }
      }
    }

    // Add context after
    const afterEnd = Math.min(i + CONTEXT, origLines.length);
    for (let c = i; c < afterEnd; c++) {
      hunkLines.push(` ${origLines[c]}`);
    }

    if (hunkLines.some(l => l.startsWith('+') || l.startsWith('-'))) {
      hunks.push(`@@ -${origStart + 1} +${modStart + 1} @@\n${hunkLines.join('\n')}`);
    }
  }

  return hunks.join('\n\n');
}

/**
 * Extract assistant response text and tool uses from an execution log's actions array.
 * Action types:
 *   say         → output.message is the assistant's spoken text
 *   runCommand  → input.command + output.output/exitCode
 *   replace     → input.file (file path of edit)
 *   readFiles   → input.files (array of {path, range})
 *   search      → input.query
 */
function parseExecActions(actions: ExecAction[]): ExecResult {
  const sayParts: string[] = [];
  const toolUses: ToolUse[] = [];
  let toolIdx = 0;

  for (const action of actions) {
    const { actionType, input, output } = action;

    if (actionType === 'say' && output?.message) {
      sayParts.push(String(output.message));
    } else if (actionType === 'runCommand' && input?.command) {
      toolUses.push({
        id: `tool-${toolIdx++}`,
        name: 'runCommand',
        args: { command: input.command },
      });
    } else if (actionType === 'replace' && input?.file) {
      const args: Record<string, unknown> = { file: input.file };
      if (input.originalContent && input.modifiedContent) {
        args.diff = computeSimpleDiff(
          String(input.originalContent),
          String(input.modifiedContent)
        );
      }
      toolUses.push({
        id: `tool-${toolIdx++}`,
        name: 'editFile',
        args,
      });
    } else if (actionType === 'create' && input?.file) {
      toolUses.push({
        id: `tool-${toolIdx++}`,
        name: 'createFile',
        args: { file: input.file },
      });
    } else if (actionType === 'readFiles' && input?.files) {
      toolUses.push({
        id: `tool-${toolIdx++}`,
        name: 'readFiles',
        args: { files: input.files },
      });
    } else if (actionType === 'search' && input?.query) {
      toolUses.push({
        id: `tool-${toolIdx++}`,
        name: 'search',
        args: { query: input.query },
      });
    }
  }

  return {
    content: sayParts.join('\n\n'),
    toolUses,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────

function extractWsUserText(content: string | Array<{ type: string; text: string }>): string {
  if (typeof content === 'string') return cleanUserContent(content);
  if (!Array.isArray(content) || content.length === 0) return '';
  const first = content.find(item => item.type === 'text' && item.text);
  return first ? cleanUserContent(first.text) : '';
}

/**
 * From a .chat file, extract the bot response for the LAST human turn.
 * The last human message is the prompt for this execution; bot messages
 * after it are the response.
 */
function extractBotResponse(chatData: ChatFile): string {
  const chat = chatData.chat;
  if (!chat || chat.length === 0) return '';

  let lastHumanIdx = -1;
  for (let i = chat.length - 1; i >= 0; i--) {
    if (chat[i].role === 'human') {
      lastHumanIdx = i;
      break;
    }
  }
  if (lastHumanIdx < 0) return '';

  const parts: string[] = [];
  for (let i = lastHumanIdx + 1; i < chat.length; i++) {
    if (chat[i].role === 'bot' && chat[i].content.trim()) {
      parts.push(chat[i].content);
    }
  }
  return parts.join('\n\n');
}

function cleanUserContent(text: string): string {
  let cleaned = text.replace(/<steering-reminder>[\s\S]*?<\/steering-reminder>/g, '');
  cleaned = cleaned.replace(/<EnvironmentContext>[\s\S]*?<\/EnvironmentContext>/g, '');
  cleaned = cleaned.replace(/## Included Rules[\s\S]*?(?=\n\n[^#\s]|\n\n$|$)/g, '');
  return cleaned.trim();
}

function extractUserPrompt(content: string): string {
  const userTagIdx = content.lastIndexOf('<user>');
  if (userTagIdx >= 0) {
    let text = content.slice(userTagIdx + 6);
    const endIdx = text.indexOf('</user>');
    if (endIdx >= 0) text = text.slice(0, endIdx);
    return cleanUserContent(text.trim());
  }
  return cleanUserContent(content.trim());
}

/**
 * Parse a .chat file into conversation messages (for standalone .chat parsing).
 */
function parseChatFileMessages(data: ChatFile): ConversationMessage[] {
  const chat = data.chat;
  if (!chat || chat.length === 0) return [];

  const humanIndices: number[] = [];
  for (let i = 0; i < chat.length; i++) {
    if (chat[i].role === 'human') humanIndices.push(i);
  }
  if (humanIndices.length === 0) return [];

  const messages: ConversationMessage[] = [];
  const seenPrompts = new Set<string>();

  for (let t = 0; t < humanIndices.length; t++) {
    const hIdx = humanIndices[t];
    const nextHIdx = t + 1 < humanIndices.length ? humanIndices[t + 1] : chat.length;

    const userPrompt = extractUserPrompt(chat[hIdx].content);
    if (!userPrompt) continue;

    const key = userPrompt.slice(0, 200);
    if (seenPrompts.has(key)) continue;
    seenPrompts.add(key);

    const botParts: string[] = [];
    for (let i = hIdx + 1; i < nextHIdx; i++) {
      if (chat[i].role === 'bot' && chat[i].content.trim()) {
        botParts.push(chat[i].content);
      }
    }

    messages.push({ role: 'user', content: userPrompt });
    if (botParts.length > 0) {
      messages.push({ role: 'assistant', content: botParts.join('\n\n') });
    }
  }

  return messages;
}

// ── Main reader ─────────────────────────────────────────────────────

export interface IdeReader {
  getConversations(): ParsedConversation[];
  close(): void;
}

// The metadata file that stores execution index in each hash directory
const EXEC_INDEX_FILE = 'f62de366d0006e17ea00a01f6624aabf';

export function createIdeReader(basePath: string): IdeReader {
  return {
    getConversations(): ParsedConversation[] {
      const allConversations: ParsedConversation[] = [];

      // ── Build executionId → hashDir lookup ──
      const execToHashDir = new Map<string, string>();
      const hashDirs: string[] = [];
      try {
        for (const entry of readdirSync(basePath, { withFileTypes: true })) {
          if (entry.isDirectory() && entry.name.length === 32 && /^[0-9a-f]+$/.test(entry.name)) {
            hashDirs.push(entry.name);
          }
        }
      } catch {
        // basePath might not exist
      }

      for (const hd of hashDirs) {
        const indexFile = join(basePath, hd, EXEC_INDEX_FILE);
        if (!existsSync(indexFile)) continue;
        try {
          const indexData = JSON.parse(readFileSync(indexFile, 'utf-8')) as ExecutionIndex;
          for (const ex of indexData.executions || []) {
            if (ex.executionId) {
              execToHashDir.set(ex.executionId, hd);
            }
          }
        } catch {
          // skip
        }
      }

      // ── Execution log cache ──
      // Build a lightweight index: executionId → file path (by reading just the first bytes)
      const execLogFileMap = new Map<string, string>();
      const indexedExecLogDirs = new Set<string>();

      function indexExecLogDir(hd: string): void {
        if (indexedExecLogDirs.has(hd)) return;
        indexedExecLogDirs.add(hd);

        const logDir = join(basePath, hd, EXEC_LOG_DIR);
        if (!existsSync(logDir)) return;

        try {
          for (const file of readdirSync(logDir)) {
            const filePath = join(logDir, file);
            try {
              // Read just the first 200 bytes to extract executionId
              const fd = openSync(filePath, 'r');
              const buf = Buffer.alloc(200);
              readSync(fd, buf, 0, 200, 0);
              closeSync(fd);
              const header = buf.toString('utf-8');
              const match = header.match(/"executionId"\s*:\s*"([^"]+)"/);
              if (match) {
                execLogFileMap.set(match[1], filePath);
              }
            } catch {
              // skip
            }
          }
        } catch {
          // skip
        }
      }

      function getExecLog(executionId: string): ExecLog | null {
        const hd = execToHashDir.get(executionId);
        if (!hd) return null;

        // Ensure the dir is indexed
        indexExecLogDir(hd);

        const filePath = execLogFileMap.get(executionId);
        if (!filePath) return null;

        try {
          return JSON.parse(readFileSync(filePath, 'utf-8')) as ExecLog;
        } catch {
          return null;
        }
      }

      // ── Chat file cache ──
      const chatFileByExecId = new Map<string, ChatFile | null>();
      const scannedChatDirs = new Set<string>();

      function getChatFile(executionId: string): ChatFile | null {
        if (chatFileByExecId.has(executionId)) {
          return chatFileByExecId.get(executionId) || null;
        }

        const hd = execToHashDir.get(executionId);
        if (!hd) {
          chatFileByExecId.set(executionId, null);
          return null;
        }

        if (scannedChatDirs.has(hd)) {
          chatFileByExecId.set(executionId, null);
          return null;
        }

        const dirPath = join(basePath, hd);
        scannedChatDirs.add(hd);
        try {
          for (const file of readdirSync(dirPath).filter(f => f.endsWith('.chat'))) {
            try {
              const data = JSON.parse(readFileSync(join(dirPath, file), 'utf-8')) as ChatFile;
              chatFileByExecId.set(data.executionId, data);
            } catch {
              // skip
            }
          }
        } catch {
          // skip
        }

        return chatFileByExecId.get(executionId) || null;
      }

      /**
       * Get assistant response for an execution. Tries:
       * 1. Execution log (has say messages + tool use details)
       *    - If the exec log is a specAgent, follows the sub-execution
       * 2. .chat file (has bot response text)
       * 3. Returns null if neither available
       */
      function getAssistantResponse(executionId: string): { content: string; toolUses?: ToolUse[] } | null {
        // Try execution log first (richer data)
        const execLog = getExecLog(executionId);
        if (execLog?.actions && execLog.actions.length > 0) {
          const result = parseExecActions(execLog.actions);

          // If no say content, check for specAgent sub-execution
          if (!result.content && result.toolUses.length === 0) {
            const specAction = execLog.actions.find(
              a => a.actionType === 'specAgent' && a.output?.executionId
            );
            if (specAction) {
              const subExecId = String(specAction.output!.executionId);
              const subLog = getExecLog(subExecId);
              if (subLog?.actions && subLog.actions.length > 0) {
                const subResult = parseExecActions(subLog.actions);
                if (subResult.content || subResult.toolUses.length > 0) {
                  return {
                    content: subResult.content,
                    toolUses: subResult.toolUses.length > 0 ? subResult.toolUses : undefined,
                  };
                }
              }
            }
          }

          if (result.content || result.toolUses.length > 0) {
            return {
              content: result.content,
              toolUses: result.toolUses.length > 0 ? result.toolUses : undefined,
            };
          }
        }

        // Fall back to .chat file
        const chatFile = getChatFile(executionId);
        if (chatFile) {
          const text = extractBotResponse(chatFile);
          if (text) return { content: text };
        }

        return null;
      }

      // ── Parse workspace-session JSON files ──
      const wsSessionsDir = join(basePath, 'workspace-sessions');
      const processedHashDirs = new Set<string>();

      if (existsSync(wsSessionsDir)) {
        for (const wsDir of readdirSync(wsSessionsDir, { withFileTypes: true })) {
          if (!wsDir.isDirectory()) continue;

          let workspacePath = '';
          try {
            const padded = wsDir.name.replace(/_/g, '=').replace(/-/g, '+');
            workspacePath = Buffer.from(padded, 'base64').toString('utf-8');
          } catch {
            workspacePath = wsDir.name;
          }

          const wsDirPath = join(wsSessionsDir, wsDir.name);
          const sessionsIndex = join(wsDirPath, 'sessions.json');
          if (!existsSync(sessionsIndex)) continue;

          let sessions: IdeSessionIndex[] = [];
          try {
            sessions = JSON.parse(readFileSync(sessionsIndex, 'utf-8'));
            // Filter out hidden sessions
            sessions = sessions.filter(s => !s.hidden);
          } catch (err) {
            console.warn(`Failed to parse sessions.json in ${wsDirPath}:`, err);
            continue;
          }

          for (const session of sessions) {
            const sessionFile = join(wsDirPath, `${session.sessionId}.json`);
            if (!existsSync(sessionFile)) continue;

            let sessionData: WsSessionData;
            try {
              sessionData = JSON.parse(readFileSync(sessionFile, 'utf-8'));
            } catch {
              continue;
            }

            const history = sessionData.history;
            if (!history || history.length === 0) continue;

            const messages: ConversationMessage[] = [];

            for (const entry of history) {
              const msg = entry.message;

              if (msg.role === 'user') {
                const text = extractWsUserText(msg.content);
                if (text) {
                  messages.push({ role: 'user', content: text });
                }
              } else if (msg.role === 'assistant') {
                // Try to get real response from execution logs or .chat files
                let responseText = '';
                let toolUses: ToolUse[] | undefined;

                if (entry.executionId) {
                  const response = getAssistantResponse(entry.executionId);
                  if (response) {
                    responseText = response.content;
                    toolUses = response.toolUses;
                    const hd = execToHashDir.get(entry.executionId);
                    if (hd) processedHashDirs.add(hd);
                  }
                }

                // Fall back to session content if no response found
                if (!responseText && !toolUses) {
                  const raw = typeof msg.content === 'string'
                    ? msg.content
                    : extractWsUserText(msg.content);
                  responseText = raw || '';
                }

                // Include assistant message even if empty (might be in progress)
                messages.push({
                  role: 'assistant',
                  content: responseText,
                  ...(toolUses ? { toolUses } : {}),
                });
              }
            }

            // Include conversations even with just a user message (might be waiting for response)
            if (messages.length > 0) {
              const dirPath = sessionData.workspacePath
                || sessionData.workspaceDirectory
                || workspacePath
                || session.workspaceDirectory;

              allConversations.push({
                directoryPath: dirPath || wsDir.name,
                conversationId: session.sessionId,
                messages,
                updatedAt: session.dateCreated ? parseInt(session.dateCreated, 10) : undefined,
              });
            }
          }
        }
      }

      // ── Parse remaining .chat files from hash dirs not covered by sessions ──
      for (const hashDir of hashDirs) {
        if (processedHashDirs.has(hashDir)) continue;

        const dirPath = join(basePath, hashDir);
        const chatFiles = readdirSync(dirPath).filter(f => f.endsWith('.chat'));
        if (chatFiles.length === 0) continue;

        // If this dir was already scanned by getChatFile, reuse cached data.
        // Otherwise, find the largest file by file size (avoids parsing all JSON).
        let bestData: ChatFile | null = null;
        let bestStartTime = 0;

        if (scannedChatDirs.has(hashDir)) {
          // Reuse cached ChatFile objects — find the one with the most messages
          let bestChatLen = 0;
          for (const [, cf] of chatFileByExecId) {
            if (!cf) continue;
            const wfDir = execToHashDir.get(cf.executionId);
            if (wfDir !== hashDir) continue;
            const chatLen = cf.chat?.length || 0;
            const startTime = cf.metadata?.startTime || 0;
            if (chatLen > bestChatLen || (chatLen === bestChatLen && startTime > bestStartTime)) {
              bestData = cf;
              bestChatLen = chatLen;
              bestStartTime = startTime;
            }
          }
        } else {
          // Not yet scanned — find largest file by size as a proxy for most messages
          let bestSize = 0;
          let bestFile = '';
          for (const file of chatFiles) {
            try {
              const filePath = join(dirPath, file);
              const { size } = statSync(filePath);
              if (size > bestSize) {
                bestSize = size;
                bestFile = file;
              }
            } catch {
              // skip
            }
          }
          if (bestFile) {
            try {
              bestData = JSON.parse(readFileSync(join(dirPath, bestFile), 'utf-8')) as ChatFile;
              bestStartTime = bestData.metadata?.startTime || 0;
            } catch {
              // skip
            }
          }
        }

        if (!bestData) continue;

        const messages = parseChatFileMessages(bestData);
        if (messages.length === 0) continue;

        // Try to extract workspace from context
        let workspace = '';
        const context = (bestData as unknown as Record<string, unknown>).context;
        if (Array.isArray(context)) {
          for (const ctx of context) {
            if (typeof ctx === 'object' && ctx !== null && (ctx as Record<string, unknown>).type === 'fileTree') {
              const sdv = (ctx as Record<string, string>).staticDirectoryView || '';
              const folderMatch = sdv.match(/<folder name='([^']+)'/);
              if (folderMatch) {
                workspace = folderMatch[1];
                break;
              }
            }
          }
        }

        allConversations.push({
          directoryPath: workspace || hashDir,
          conversationId: `chat-${hashDir}`,
          messages,
          updatedAt: bestStartTime || undefined,
        });
      }

      // Sort by updatedAt descending
      allConversations.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

      return allConversations;
    },

    close(): void {
      // No resources to clean up
    },
  };
}

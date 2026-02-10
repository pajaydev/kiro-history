import Database from 'better-sqlite3';
import type { CommandEntry, ConversationEntry } from './types.js';

export interface ConversationEntryV2 {
  key: string;
  conversationId: string;
  value: string;
  createdAt: number;
  updatedAt: number;
}

export interface DatabaseReader {
  getCommands(): CommandEntry[];
  getConversations(): ConversationEntry[];
  getConversationsV2(): ConversationEntryV2[];
  hasV2Table(): boolean;
  close(): void;
}

export function createDatabaseReader(dbPath: string): DatabaseReader {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });

  // Check if conversations_v2 table exists
  const hasV2 = (() => {
    try {
      const result = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='conversations_v2'").get();
      return !!result;
    } catch {
      return false;
    }
  })();

  // Check if history table exists
  const hasHistory = (() => {
    try {
      const result = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='history'").get();
      return !!result;
    } catch {
      return false;
    }
  })();

  const commandsStmt = hasHistory ? db.prepare(`
    SELECT 
      id,
      command,
      shell,
      pid,
      session_id as sessionId,
      cwd,
      start_time as startTime,
      hostname,
      exit_code as exitCode,
      end_time as endTime,
      duration
    FROM history
    ORDER BY start_time DESC
  `) : null;

  const conversationsStmt = db.prepare(`
    SELECT key, value
    FROM conversations
  `);

  const conversationsV2Stmt = hasV2 ? db.prepare(`
    SELECT 
      key,
      conversation_id as conversationId,
      value,
      created_at as createdAt,
      updated_at as updatedAt
    FROM conversations_v2
    ORDER BY updated_at DESC
  `) : null;

  return {
    getCommands(): CommandEntry[] {
      if (!commandsStmt) return [];
      try {
        return commandsStmt.all() as CommandEntry[];
      } catch {
        return [];
      }
    },

    getConversations(): ConversationEntry[] {
      try {
        return conversationsStmt.all() as ConversationEntry[];
      } catch {
        return [];
      }
    },

    getConversationsV2(): ConversationEntryV2[] {
      if (!conversationsV2Stmt) return [];
      try {
        return conversationsV2Stmt.all() as ConversationEntryV2[];
      } catch {
        return [];
      }
    },

    hasV2Table(): boolean {
      return hasV2;
    },

    close(): void {
      db.close();
    },
  };
}

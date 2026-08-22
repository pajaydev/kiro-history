import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createIdeV2Reader, resolveIdeV2WorkspaceDirs } from './ide-v2.js';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'ide-v2-test-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ── Helpers ─────────────────────────────────────────────────────────

function writeIdeSession(
  wsDir: string,
  sessionId: string,
  meta: Record<string, unknown>,
  jsonlLines: string[]
) {
  const sessionDir = join(wsDir, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, 'session.json'), JSON.stringify(meta));
  writeFileSync(join(sessionDir, 'messages.jsonl'), jsonlLines.join('\n'));
}

let entryCounter = 0;

function userEntry(text: string): string {
  return JSON.stringify({
    id: `entry-${++entryCounter}`,
    timestamp: '2026-08-20T10:00:00Z',
    payload: { type: 'user', content: text },
  });
}

function assistantEntry(text: string): string {
  return JSON.stringify({
    id: `entry-${++entryCounter}`,
    timestamp: '2026-08-20T10:00:01Z',
    payload: { type: 'assistant', content: text },
  });
}

function toolCallEntry(toolCallId: string, toolName: string, args: Record<string, unknown>): string {
  return JSON.stringify({
    id: `entry-${++entryCounter}`,
    timestamp: '2026-08-20T10:00:01Z',
    payload: { type: 'tool_call', toolCallId, toolName, args },
  });
}

function toolResultEntry(toolCallId: string): string {
  return JSON.stringify({
    id: `entry-${++entryCounter}`,
    timestamp: '2026-08-20T10:00:02Z',
    payload: { type: 'tool_result', toolCallId, content: 'result data', success: true },
  });
}

function turnStartEntry(): string {
  return JSON.stringify({
    id: `entry-${++entryCounter}`,
    timestamp: '2026-08-20T10:00:00Z',
    payload: { type: 'turn_start', executionId: 'exec-1' },
  });
}

function turnEndEntry(): string {
  return JSON.stringify({
    id: `entry-${++entryCounter}`,
    timestamp: '2026-08-20T10:00:05Z',
    payload: { type: 'turn_end', stopReason: 'end_turn', executionId: 'exec-1' },
  });
}

function usageSummaryEntry(): string {
  return JSON.stringify({
    id: `entry-${++entryCounter}`,
    timestamp: '2026-08-20T10:00:06Z',
    payload: { type: 'usage_summary', inputTokens: 1000, outputTokens: 500 },
  });
}

function baseMeta(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'session-1',
    title: 'Test session',
    createdAt: '2026-08-20T10:00:00Z',
    lastModifiedAt: '2026-08-20T10:05:00Z',
    workspacePaths: ['/home/user/project'],
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('createIdeV2Reader', () => {
  it('returns empty for non-existent workspace dirs', () => {
    const reader = createIdeV2Reader(['/tmp/does-not-exist-xyz']);
    expect(reader.getConversations()).toEqual([]);
  });

  it('returns empty for workspace dir with no session subdirs', () => {
    const wsDir = join(tempDir, 'ws-hash-1');
    mkdirSync(wsDir, { recursive: true });

    const reader = createIdeV2Reader([wsDir]);
    expect(reader.getConversations()).toEqual([]);
  });

  it('parses a basic user + assistant conversation', () => {
    const wsDir = join(tempDir, 'ws-hash-1');
    writeIdeSession(wsDir, 'session-1', baseMeta(), [
      userEntry('Hello'),
      turnStartEntry(),
      assistantEntry('Hi there!'),
      turnEndEntry(),
    ]);

    const reader = createIdeV2Reader([wsDir]);
    const convs = reader.getConversations();

    expect(convs).toHaveLength(1);
    expect(convs[0].conversationId).toBe('session-1');
    expect(convs[0].directoryPath).toBe('/home/user/project');
    expect(convs[0].messages).toHaveLength(2);
    expect(convs[0].messages[0]).toEqual({ role: 'user', content: 'Hello' });
    expect(convs[0].messages[1]).toEqual({ role: 'assistant', content: 'Hi there!' });
  });

  it('extracts tool calls from tool_call payloads', () => {
    const wsDir = join(tempDir, 'ws-hash-1');
    writeIdeSession(wsDir, 'session-1', baseMeta(), [
      userEntry('Read my file'),
      turnStartEntry(),
      assistantEntry('Let me read that.'),
      toolCallEntry('tc-1', 'read_file', { path: '/tmp/test.txt' }),
      turnEndEntry(),
    ]);

    const reader = createIdeV2Reader([wsDir]);
    const convs = reader.getConversations();
    const msg = convs[0].messages[1];

    expect(msg.role).toBe('assistant');
    expect(msg.content).toBe('Let me read that.');
    expect(msg.toolUses).toHaveLength(1);
    expect(msg.toolUses![0]).toEqual({
      id: 'tc-1',
      name: 'read_file',
      args: { path: '/tmp/test.txt' },
    });
  });

  it('groups tool calls within turn_start/turn_end boundaries', () => {
    const wsDir = join(tempDir, 'ws-hash-1');
    writeIdeSession(wsDir, 'session-1', baseMeta(), [
      userEntry('Do multiple things'),
      turnStartEntry(),
      assistantEntry('Working on it.'),
      toolCallEntry('tc-1', 'read_file', { path: '/a.txt' }),
      toolCallEntry('tc-2', 'write_file', { path: '/b.txt', content: 'hello' }),
      turnEndEntry(),
    ]);

    const reader = createIdeV2Reader([wsDir]);
    const convs = reader.getConversations();
    const msg = convs[0].messages[1];

    expect(msg.toolUses).toHaveLength(2);
    expect(msg.toolUses![0].name).toBe('read_file');
    expect(msg.toolUses![1].name).toBe('write_file');
  });

  it('skips tool_result and usage_summary payloads', () => {
    const wsDir = join(tempDir, 'ws-hash-1');
    writeIdeSession(wsDir, 'session-1', baseMeta(), [
      userEntry('Do something'),
      turnStartEntry(),
      assistantEntry('Done.'),
      toolCallEntry('tc-1', 'read_file', { path: '/x.txt' }),
      toolResultEntry('tc-1'),
      turnEndEntry(),
      usageSummaryEntry(),
    ]);

    const reader = createIdeV2Reader([wsDir]);
    const convs = reader.getConversations();

    expect(convs[0].messages).toHaveLength(2);
    expect(convs[0].messages[0].role).toBe('user');
    expect(convs[0].messages[1].role).toBe('assistant');
  });

  it('skips sessions missing messages.jsonl', () => {
    const sessionDir = join(tempDir, 'ws-hash-1', 'session-1');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, 'session.json'), JSON.stringify(baseMeta()));
    // No messages.jsonl

    const reader = createIdeV2Reader([join(tempDir, 'ws-hash-1')]);
    expect(reader.getConversations()).toEqual([]);
  });

  it('skips sessions missing session.json', () => {
    const sessionDir = join(tempDir, 'ws-hash-1', 'session-1');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, 'messages.jsonl'), userEntry('hi'));
    // No session.json

    const reader = createIdeV2Reader([join(tempDir, 'ws-hash-1')]);
    expect(reader.getConversations()).toEqual([]);
  });

  it('skips sessions with empty JSONL', () => {
    const wsDir = join(tempDir, 'ws-hash-1');
    writeIdeSession(wsDir, 'session-1', baseMeta(), []);

    const reader = createIdeV2Reader([wsDir]);
    expect(reader.getConversations()).toEqual([]);
  });

  it('handles malformed JSON in session.json', () => {
    const sessionDir = join(tempDir, 'ws-hash-1', 'session-1');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, 'session.json'), '{not valid json!!');
    writeFileSync(join(sessionDir, 'messages.jsonl'), userEntry('hello'));

    const reader = createIdeV2Reader([join(tempDir, 'ws-hash-1')]);
    expect(reader.getConversations()).toEqual([]);
  });

  it('handles malformed JSONL lines gracefully', () => {
    const wsDir = join(tempDir, 'ws-hash-1');
    writeIdeSession(wsDir, 'session-1', baseMeta(), [
      '{totally broken',
      userEntry('valid prompt'),
      turnStartEntry(),
      assistantEntry('valid response'),
      turnEndEntry(),
    ]);

    const reader = createIdeV2Reader([wsDir]);
    const convs = reader.getConversations();

    expect(convs).toHaveLength(1);
    expect(convs[0].messages).toHaveLength(2);
  });

  it('sorts conversations by recency (most recent first)', () => {
    const wsDir = join(tempDir, 'ws-hash-1');
    writeIdeSession(wsDir, 'old-session', baseMeta({
      id: 'old-session',
      lastModifiedAt: '2026-08-18T10:00:00Z',
    }), [
      userEntry('old'),
      turnStartEntry(),
      assistantEntry('old reply'),
      turnEndEntry(),
    ]);

    writeIdeSession(wsDir, 'new-session', baseMeta({
      id: 'new-session',
      lastModifiedAt: '2026-08-20T10:00:00Z',
    }), [
      userEntry('new'),
      turnStartEntry(),
      assistantEntry('new reply'),
      turnEndEntry(),
    ]);

    const reader = createIdeV2Reader([wsDir]);
    const convs = reader.getConversations();

    expect(convs).toHaveLength(2);
    expect(convs[0].conversationId).toBe('new-session');
    expect(convs[1].conversationId).toBe('old-session');
  });

  it('uses workspacePaths[0] for directoryPath, falls back to rootPaths[0]', () => {
    const wsDir = join(tempDir, 'ws-hash-1');

    // Session with workspacePaths
    writeIdeSession(wsDir, 'session-ws', baseMeta({
      id: 'session-ws',
      workspacePaths: ['/home/user/workspace'],
      rootPaths: ['/home/user/root'],
    }), [
      userEntry('hi'),
      turnStartEntry(),
      assistantEntry('hello'),
      turnEndEntry(),
    ]);

    // Session with only rootPaths
    writeIdeSession(wsDir, 'session-root', baseMeta({
      id: 'session-root',
      workspacePaths: undefined,
      rootPaths: ['/home/user/fallback'],
      lastModifiedAt: '2026-08-19T10:00:00Z',
    }), [
      userEntry('hi'),
      turnStartEntry(),
      assistantEntry('hello'),
      turnEndEntry(),
    ]);

    const reader = createIdeV2Reader([wsDir]);
    const convs = reader.getConversations();

    const wsConv = convs.find(c => c.conversationId === 'session-ws');
    const rootConv = convs.find(c => c.conversationId === 'session-root');

    expect(wsConv!.directoryPath).toBe('/home/user/workspace');
    expect(rootConv!.directoryPath).toBe('/home/user/fallback');
  });

  it('flushes pending assistant content without final turn_end', () => {
    const wsDir = join(tempDir, 'ws-hash-1');
    writeIdeSession(wsDir, 'session-1', baseMeta(), [
      userEntry('Hello'),
      turnStartEntry(),
      assistantEntry('I started answering but session ended abruptly'),
      // No turn_end — simulates incomplete session
    ]);

    const reader = createIdeV2Reader([wsDir]);
    const convs = reader.getConversations();

    expect(convs).toHaveLength(1);
    expect(convs[0].messages).toHaveLength(2);
    expect(convs[0].messages[1].content).toBe('I started answering but session ended abruptly');
  });

  it('reads sessions from multiple workspace directories', () => {
    const wsDir1 = join(tempDir, 'ws-hash-1');
    const wsDir2 = join(tempDir, 'ws-hash-2');

    writeIdeSession(wsDir1, 'session-a', baseMeta({
      id: 'session-a',
      lastModifiedAt: '2026-08-20T10:00:00Z',
    }), [
      userEntry('from workspace 1'),
      turnStartEntry(),
      assistantEntry('reply 1'),
      turnEndEntry(),
    ]);

    writeIdeSession(wsDir2, 'session-b', baseMeta({
      id: 'session-b',
      lastModifiedAt: '2026-08-21T10:00:00Z',
    }), [
      userEntry('from workspace 2'),
      turnStartEntry(),
      assistantEntry('reply 2'),
      turnEndEntry(),
    ]);

    const reader = createIdeV2Reader([wsDir1, wsDir2]);
    const convs = reader.getConversations();

    expect(convs).toHaveLength(2);
    // Most recent first
    expect(convs[0].conversationId).toBe('session-b');
    expect(convs[1].conversationId).toBe('session-a');
  });
});

describe('resolveIdeV2WorkspaceDirs', () => {
  it('returns empty for non-existent base path', () => {
    const dirs = resolveIdeV2WorkspaceDirs('/tmp/does-not-exist-xyz');
    expect(dirs).toEqual([]);
  });

  it('returns empty for empty base path', () => {
    const dirs = resolveIdeV2WorkspaceDirs(tempDir);
    expect(dirs).toEqual([]);
  });

  it('excludes the cli directory', () => {
    mkdirSync(join(tempDir, 'cli'));
    mkdirSync(join(tempDir, 'abc123hash'));

    const dirs = resolveIdeV2WorkspaceDirs(tempDir);

    expect(dirs).toHaveLength(1);
    expect(dirs[0]).toBe(join(tempDir, 'abc123hash'));
  });

  it('returns only directories, not files', () => {
    mkdirSync(join(tempDir, 'workspace-hash-1'));
    writeFileSync(join(tempDir, 'some-file.json'), '{}');

    const dirs = resolveIdeV2WorkspaceDirs(tempDir);

    expect(dirs).toHaveLength(1);
    expect(dirs[0]).toBe(join(tempDir, 'workspace-hash-1'));
  });
});

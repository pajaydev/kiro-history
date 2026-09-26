import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createIdeV1Reader, resolveIdeV1WorkspaceDirs } from './ide-v1.js';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'ide-v1-test-'));
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

function usageSummaryEntry(usage: number = 1.5, requestIds: string[] = ['req-1', 'req-2']): string {
  return JSON.stringify({
    id: `entry-${++entryCounter}`,
    timestamp: '2026-08-20T10:00:06Z',
    payload: {
      type: 'usage_summary',
      promptTurnSummaries: [{ unit: 'credit', unitPlural: 'credits', usage }],
      elapsedTime: 5000,
      status: 'success',
      executionId: 'exec-1',
      requestIds,
    },
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

describe('createIdeV1Reader', () => {
  it('returns empty for non-existent workspace dirs', () => {
    const reader = createIdeV1Reader(['/tmp/does-not-exist-xyz']);
    expect(reader.getConversations()).toEqual([]);
  });

  it('returns empty for workspace dir with no session subdirs', () => {
    const wsDir = join(tempDir, 'ws-hash-1');
    mkdirSync(wsDir, { recursive: true });

    const reader = createIdeV1Reader([wsDir]);
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

    const reader = createIdeV1Reader([wsDir]);
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

    const reader = createIdeV1Reader([wsDir]);
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

    const reader = createIdeV1Reader([wsDir]);
    const convs = reader.getConversations();
    const msg = convs[0].messages[1];

    expect(msg.toolUses).toHaveLength(2);
    expect(msg.toolUses![0].name).toBe('read_file');
    expect(msg.toolUses![1].name).toBe('write_file');
  });

  it('skips tool_result payloads and extracts usage_summary as metadata', () => {
    const wsDir = join(tempDir, 'ws-hash-1');
    writeIdeSession(wsDir, 'session-1', baseMeta({ modelId: 'claude-sonnet-4.6' }), [
      userEntry('Do something'),
      turnStartEntry(),
      assistantEntry('Done.'),
      toolCallEntry('tc-1', 'read_file', { path: '/x.txt' }),
      toolResultEntry('tc-1'),
      usageSummaryEntry(0.25, ['req-1', 'req-2', 'req-3']),
      turnEndEntry(),
    ]);

    const reader = createIdeV1Reader([wsDir]);
    const convs = reader.getConversations();

    expect(convs[0].messages).toHaveLength(2);
    expect(convs[0].messages[0].role).toBe('user');
    expect(convs[0].messages[1].role).toBe('assistant');
    expect(convs[0].messages[1].turnMetadata).toBeDefined();
    expect(convs[0].messages[1].turnMetadata!.creditCost).toBeCloseTo(0.25);
    expect(convs[0].messages[1].turnMetadata!.model).toBe('claude-sonnet-4.6');
    expect(convs[0].messages[1].turnMetadata!.requestCount).toBe(3);
  });

  it('skips sessions missing messages.jsonl', () => {
    const sessionDir = join(tempDir, 'ws-hash-1', 'session-1');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, 'session.json'), JSON.stringify(baseMeta()));
    // No messages.jsonl

    const reader = createIdeV1Reader([join(tempDir, 'ws-hash-1')]);
    expect(reader.getConversations()).toEqual([]);
  });

  it('skips sessions missing session.json', () => {
    const sessionDir = join(tempDir, 'ws-hash-1', 'session-1');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, 'messages.jsonl'), userEntry('hi'));
    // No session.json

    const reader = createIdeV1Reader([join(tempDir, 'ws-hash-1')]);
    expect(reader.getConversations()).toEqual([]);
  });

  it('skips sessions with empty JSONL', () => {
    const wsDir = join(tempDir, 'ws-hash-1');
    writeIdeSession(wsDir, 'session-1', baseMeta(), []);

    const reader = createIdeV1Reader([wsDir]);
    expect(reader.getConversations()).toEqual([]);
  });

  it('handles malformed JSON in session.json', () => {
    const sessionDir = join(tempDir, 'ws-hash-1', 'session-1');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, 'session.json'), '{not valid json!!');
    writeFileSync(join(sessionDir, 'messages.jsonl'), userEntry('hello'));

    const reader = createIdeV1Reader([join(tempDir, 'ws-hash-1')]);
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

    const reader = createIdeV1Reader([wsDir]);
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

    const reader = createIdeV1Reader([wsDir]);
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

    const reader = createIdeV1Reader([wsDir]);
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

    const reader = createIdeV1Reader([wsDir]);
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

    const reader = createIdeV1Reader([wsDir1, wsDir2]);
    const convs = reader.getConversations();

    expect(convs).toHaveLength(2);
    // Most recent first
    expect(convs[0].conversationId).toBe('session-b');
    expect(convs[1].conversationId).toBe('session-a');
  });

  // ── Cost extraction (usage_summary → TurnMetadata) ──────────────

  it('attaches turnMetadata from usage_summary to assistant message', () => {
    const wsDir = join(tempDir, 'ws-hash-1');
    writeIdeSession(wsDir, 'session-1', baseMeta({ modelId: 'auto' }), [
      userEntry('Hello'),
      turnStartEntry(),
      assistantEntry('Hi there!'),
      usageSummaryEntry(1.0119, ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8']),
      turnEndEntry(),
    ]);

    const reader = createIdeV1Reader([wsDir]);
    const convs = reader.getConversations();
    const assistantMsg = convs[0].messages[1];

    expect(assistantMsg.turnMetadata).toBeDefined();
    expect(assistantMsg.turnMetadata!.creditCost).toBeCloseTo(1.0119);
    expect(assistantMsg.turnMetadata!.model).toBe('auto');
    expect(assistantMsg.turnMetadata!.requestCount).toBe(8);
  });

  it('does not attach turnMetadata when usage_summary is absent', () => {
    const wsDir = join(tempDir, 'ws-hash-1');
    writeIdeSession(wsDir, 'session-1', baseMeta({ modelId: 'auto' }), [
      userEntry('Hello'),
      turnStartEntry(),
      assistantEntry('Hi there!'),
      turnEndEntry(),
    ]);

    const reader = createIdeV1Reader([wsDir]);
    const convs = reader.getConversations();
    const assistantMsg = convs[0].messages[1];

    expect(assistantMsg.turnMetadata).toBeUndefined();
  });

  it('uses "unknown" as model when modelId is not in session.json', () => {
    const wsDir = join(tempDir, 'ws-hash-1');
    // baseMeta() does not include modelId by default
    writeIdeSession(wsDir, 'session-1', baseMeta(), [
      userEntry('Hello'),
      turnStartEntry(),
      assistantEntry('Hi!'),
      usageSummaryEntry(0.5, ['r1']),
      turnEndEntry(),
    ]);

    const reader = createIdeV1Reader([wsDir]);
    const convs = reader.getConversations();
    const assistantMsg = convs[0].messages[1];

    expect(assistantMsg.turnMetadata!.model).toBe('unknown');
  });

  it('handles multi-turn sessions with per-turn cost', () => {
    const wsDir = join(tempDir, 'ws-hash-1');
    writeIdeSession(wsDir, 'session-1', baseMeta({ modelId: 'claude-sonnet-4.6' }), [
      userEntry('First question'),
      turnStartEntry(),
      assistantEntry('First answer'),
      usageSummaryEntry(0.10, ['r1', 'r2']),
      turnEndEntry(),
      userEntry('Second question'),
      turnStartEntry(),
      assistantEntry('Second answer'),
      usageSummaryEntry(2.25, ['r3', 'r4', 'r5']),
      turnEndEntry(),
    ]);

    const reader = createIdeV1Reader([wsDir]);
    const convs = reader.getConversations();

    expect(convs[0].messages).toHaveLength(4);

    const turn1 = convs[0].messages[1];
    expect(turn1.turnMetadata!.creditCost).toBeCloseTo(0.10);
    expect(turn1.turnMetadata!.requestCount).toBe(2);
    expect(turn1.turnMetadata!.model).toBe('claude-sonnet-4.6');

    const turn2 = convs[0].messages[3];
    expect(turn2.turnMetadata!.creditCost).toBeCloseTo(2.25);
    expect(turn2.turnMetadata!.requestCount).toBe(3);
    expect(turn2.turnMetadata!.model).toBe('claude-sonnet-4.6');
  });

  it('user messages never receive turnMetadata', () => {
    const wsDir = join(tempDir, 'ws-hash-1');
    writeIdeSession(wsDir, 'session-1', baseMeta({ modelId: 'auto' }), [
      userEntry('Hello'),
      turnStartEntry(),
      assistantEntry('Hi!'),
      usageSummaryEntry(0.5, ['r1']),
      turnEndEntry(),
    ]);

    const reader = createIdeV1Reader([wsDir]);
    const convs = reader.getConversations();
    const userMsg = convs[0].messages[0];

    expect(userMsg.role).toBe('user');
    expect(userMsg.turnMetadata).toBeUndefined();
  });

  it('handles usage_summary with empty promptTurnSummaries', () => {
    const wsDir = join(tempDir, 'ws-hash-1');
    writeIdeSession(wsDir, 'session-1', baseMeta({ modelId: 'auto' }), [
      userEntry('Hello'),
      turnStartEntry(),
      assistantEntry('Hi!'),
      // usage_summary with empty promptTurnSummaries
      JSON.stringify({
        id: `entry-${++entryCounter}`,
        timestamp: '2026-08-20T10:00:06Z',
        payload: {
          type: 'usage_summary',
          promptTurnSummaries: [],
          requestIds: [],
          executionId: 'exec-1',
        },
      }),
      turnEndEntry(),
    ]);

    const reader = createIdeV1Reader([wsDir]);
    const convs = reader.getConversations();
    const assistantMsg = convs[0].messages[1];

    expect(assistantMsg.turnMetadata).toBeDefined();
    expect(assistantMsg.turnMetadata!.creditCost).toBe(0);
    expect(assistantMsg.turnMetadata!.requestCount).toBe(0);
  });

  it('handles usage_summary with multiple promptTurnSummaries (sums them)', () => {
    const wsDir = join(tempDir, 'ws-hash-1');
    writeIdeSession(wsDir, 'session-1', baseMeta({ modelId: 'auto' }), [
      userEntry('Hello'),
      turnStartEntry(),
      assistantEntry('Hi!'),
      // usage_summary with multiple summaries (sub-agents could produce this)
      JSON.stringify({
        id: `entry-${++entryCounter}`,
        timestamp: '2026-08-20T10:00:06Z',
        payload: {
          type: 'usage_summary',
          promptTurnSummaries: [
            { unit: 'credit', usage: 0.5 },
            { unit: 'credit', usage: 0.3 },
          ],
          requestIds: ['r1', 'r2', 'r3', 'r4'],
          executionId: 'exec-1',
        },
      }),
      turnEndEntry(),
    ]);

    const reader = createIdeV1Reader([wsDir]);
    const convs = reader.getConversations();
    const assistantMsg = convs[0].messages[1];

    expect(assistantMsg.turnMetadata!.creditCost).toBeCloseTo(0.8);
    expect(assistantMsg.turnMetadata!.requestCount).toBe(4);
  });
});

describe('resolveIdeV1WorkspaceDirs', () => {
  it('returns empty for non-existent base path', () => {
    const dirs = resolveIdeV1WorkspaceDirs('/tmp/does-not-exist-xyz');
    expect(dirs).toEqual([]);
  });

  it('returns empty for empty base path', () => {
    const dirs = resolveIdeV1WorkspaceDirs(tempDir);
    expect(dirs).toEqual([]);
  });

  it('excludes the cli directory', () => {
    mkdirSync(join(tempDir, 'cli'));
    mkdirSync(join(tempDir, 'abc123hash'));

    const dirs = resolveIdeV1WorkspaceDirs(tempDir);

    expect(dirs).toHaveLength(1);
    expect(dirs[0]).toBe(join(tempDir, 'abc123hash'));
  });

  it('returns only directories, not files', () => {
    mkdirSync(join(tempDir, 'workspace-hash-1'));
    writeFileSync(join(tempDir, 'some-file.json'), '{}');

    const dirs = resolveIdeV1WorkspaceDirs(tempDir);

    expect(dirs).toHaveLength(1);
    expect(dirs[0]).toBe(join(tempDir, 'workspace-hash-1'));
  });
});

describe('createIdeV1Reader refresh (live workspace detection)', () => {
  it('picks up a workspace-hash dir created after the reader exists (base-path mode)', () => {
    // Start with one existing workspace and a session in it.
    const wsA = join(tempDir, 'ws-hash-A');
    writeIdeSession(wsA, 'session-A', baseMeta({ id: 'session-A' }), [
      userEntry('First'),
      turnStartEntry(),
      assistantEntry('Reply A'),
      turnEndEntry(),
    ]);

    // Reader created with base path so refresh() re-scans on each read.
    const initialDirs = resolveIdeV1WorkspaceDirs(tempDir);
    const reader = createIdeV1Reader(initialDirs, tempDir);

    expect(reader.getConversations()).toHaveLength(1);

    // Simulate opening a brand-new IDE project AFTER the reader was created:
    // a new workspace-hash dir with its own session appears.
    const wsB = join(tempDir, 'ws-hash-B');
    writeIdeSession(wsB, 'session-B', baseMeta({ id: 'session-B' }), [
      userEntry('Second'),
      turnStartEntry(),
      assistantEntry('Reply B'),
      turnEndEntry(),
    ]);

    // Without a restart, the new workspace's session is now visible.
    const convs = reader.getConversations();
    expect(convs).toHaveLength(2);
    expect(convs.map(c => c.conversationId).sort()).toEqual(['session-A', 'session-B']);
  });

  it('refresh() is a no-op in fixed-list mode (no base path)', () => {
    const wsA = join(tempDir, 'ws-hash-A');
    writeIdeSession(wsA, 'session-A', baseMeta({ id: 'session-A' }), [
      userEntry('First'),
      turnStartEntry(),
      assistantEntry('Reply A'),
      turnEndEntry(),
    ]);

    // No base path -> fixed list; refresh() must not re-scan.
    const reader = createIdeV1Reader([wsA]);
    expect(reader.getConversations()).toHaveLength(1);

    // A new workspace dir appears, but fixed-list readers must ignore it.
    const wsB = join(tempDir, 'ws-hash-B');
    writeIdeSession(wsB, 'session-B', baseMeta({ id: 'session-B' }), [
      userEntry('Second'),
      turnStartEntry(),
      assistantEntry('Reply B'),
      turnEndEntry(),
    ]);

    expect(reader.getConversations()).toHaveLength(1);
  });

  it('calling refresh() directly re-resolves the workspace list', () => {
    const reader = createIdeV1Reader([], tempDir);
    expect(reader.getConversations()).toEqual([]);

    const wsA = join(tempDir, 'ws-hash-A');
    writeIdeSession(wsA, 'session-A', baseMeta({ id: 'session-A' }), [
      userEntry('Hi'),
      turnStartEntry(),
      assistantEntry('Hello'),
      turnEndEntry(),
    ]);

    reader.refresh();
    expect(reader.getConversations()).toHaveLength(1);
  });

  it('gracefully handles a base path that is removed after creation', () => {
    const wsA = join(tempDir, 'ws-hash-A');
    writeIdeSession(wsA, 'session-A', baseMeta({ id: 'session-A' }), [
      userEntry('Hi'),
      turnStartEntry(),
      assistantEntry('Hello'),
      turnEndEntry(),
    ]);

    const reader = createIdeV1Reader(resolveIdeV1WorkspaceDirs(tempDir), tempDir);
    expect(reader.getConversations()).toHaveLength(1);

    // Base path disappears -> refresh() resolves to empty, no throw.
    rmSync(tempDir, { recursive: true, force: true });
    expect(reader.getConversations()).toEqual([]);
  });

  it('does not treat the cli dir as an IDE workspace on refresh', () => {
    // A cli/ dir appearing under the base must never become an IDE workspace.
    mkdirSync(join(tempDir, 'cli'), { recursive: true });
    const reader = createIdeV1Reader([], tempDir);

    reader.refresh();
    expect(reader.getConversations()).toEqual([]);
  });
});

// Guards the base-path watcher's change-gating invariant (server/cli.ts):
// the watcher only notifies clients when the RESOLVED WORKSPACE SET changes.
// This models that exact set-comparison so a CLI write (under cli/) provably
// leaves the set unchanged — the regression that spammed "IDE v1.0 workspaces
// changed, notifying clients..." on every CLI turn, even with the IDE closed.
describe('base-path watcher: workspace-set change detection', () => {
  // Mirror of the comparison the watcher uses to decide whether to notify.
  function setChanged(prev: string[], next: string[]): boolean {
    const a = new Set(prev);
    const b = new Set(next);
    if (a.size !== b.size) return true;
    return ![...b].every(d => a.has(d));
  }

  it('a write under cli/ does NOT change the workspace set (no notify)', () => {
    mkdirSync(join(tempDir, 'cli'), { recursive: true });
    mkdirSync(join(tempDir, 'ws-hash-A'));

    const before = resolveIdeV1WorkspaceDirs(tempDir);

    // Simulate a CLI turn: files churn inside cli/ (.history/.jsonl/.json).
    writeFileSync(join(tempDir, 'cli', 'sess.history'), 'x');
    writeFileSync(join(tempDir, 'cli', 'sess.jsonl'), '{}');
    writeFileSync(join(tempDir, 'cli', 'sess.json'), '{}');

    const after = resolveIdeV1WorkspaceDirs(tempDir);

    expect(after).toEqual(before);
    expect(setChanged(before, after)).toBe(false);
  });

  it('adding a workspace-hash dir DOES change the set (notify)', () => {
    mkdirSync(join(tempDir, 'ws-hash-A'));
    const before = resolveIdeV1WorkspaceDirs(tempDir);

    mkdirSync(join(tempDir, 'ws-hash-B'));
    const after = resolveIdeV1WorkspaceDirs(tempDir);

    expect(setChanged(before, after)).toBe(true);
  });

  it('removing a workspace-hash dir DOES change the set (notify)', () => {
    mkdirSync(join(tempDir, 'ws-hash-A'));
    mkdirSync(join(tempDir, 'ws-hash-B'));
    const before = resolveIdeV1WorkspaceDirs(tempDir);

    rmSync(join(tempDir, 'ws-hash-B'), { recursive: true, force: true });
    const after = resolveIdeV1WorkspaceDirs(tempDir);

    expect(setChanged(before, after)).toBe(true);
  });

  it('creating the cli/ dir itself does NOT change the set (excluded)', () => {
    mkdirSync(join(tempDir, 'ws-hash-A'));
    const before = resolveIdeV1WorkspaceDirs(tempDir);

    mkdirSync(join(tempDir, 'cli'));
    const after = resolveIdeV1WorkspaceDirs(tempDir);

    expect(setChanged(before, after)).toBe(false);
  });
});

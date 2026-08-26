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

    const reader = createIdeV1Reader([wsDir]);
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
});

// ── Sub-execution tool call tests ───────────────────────────────────

describe('createIdeV1Reader — sub-execution tool calls', () => {
  function writeIdeSessionWithSubExec(
    wsDir: string,
    sessionId: string,
    meta: Record<string, unknown>,
    jsonlLines: string[],
    subExecutions: Record<string, string[]>,
  ) {
    const sessionDir = join(wsDir, sessionId);
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, 'session.json'), JSON.stringify(meta));
    writeFileSync(join(sessionDir, 'messages.jsonl'), jsonlLines.join('\n'));

    if (Object.keys(subExecutions).length > 0) {
      const subDir = join(sessionDir, 'sub-executions');
      mkdirSync(subDir, { recursive: true });
      for (const [subId, lines] of Object.entries(subExecutions)) {
        writeFileSync(join(subDir, `${subId}.jsonl`), lines.join('\n'));
      }
    }
  }

  function subAgentStartEntry(subSessionId: string, parentExecutionId = 'exec-1'): string {
    return JSON.stringify({
      id: `entry-${++entryCounter}`,
      timestamp: '2026-08-20T10:00:03Z',
      payload: {
        type: 'sub_agent_start',
        parentExecutionId,
        subSessionId,
        subAgentName: 'research',
        prompt: 'Research this topic',
      },
    });
  }

  function subAgentCompleteEntry(subSessionId: string, parentExecutionId = 'exec-1'): string {
    return JSON.stringify({
      id: `entry-${++entryCounter}`,
      timestamp: '2026-08-20T10:00:04Z',
      payload: {
        type: 'sub_agent_complete',
        parentExecutionId,
        subSessionId,
        response: 'Research complete.',
      },
    });
  }

  it('extracts tool calls from sub-execution files', () => {
    const wsDir = join(tempDir, 'ws-hash-1');
    const subId = 'sub-exec-abc123';

    writeIdeSessionWithSubExec(wsDir, 'session-1', baseMeta(), [
      userEntry('Research this'),
      turnStartEntry(),
      assistantEntry('Let me research that.'),
      subAgentStartEntry(subId),
      subAgentCompleteEntry(subId),
      assistantEntry('Here are my findings.'),
      turnEndEntry(),
    ], {
      [subId]: [
        toolCallEntry('tc-sub-1', 'web_fetch', { url: 'https://example.com' }),
        toolResultEntry('tc-sub-1'),
        toolCallEntry('tc-sub-2', 'web_fetch', { url: 'https://other.com' }),
        toolResultEntry('tc-sub-2'),
      ],
    });

    const reader = createIdeV1Reader([wsDir]);
    const convs = reader.getConversations();
    const assistantMsg = convs[0].messages[1];

    expect(assistantMsg.toolUses).toBeDefined();
    expect(assistantMsg.toolUses).toHaveLength(2);
    expect(assistantMsg.toolUses![0].name).toBe('web_fetch');
    expect(assistantMsg.toolUses![0].args).toEqual({ url: 'https://example.com' });
    expect(assistantMsg.toolUses![1].name).toBe('web_fetch');
    expect(assistantMsg.toolUses![1].args).toEqual({ url: 'https://other.com' });
  });

  it('combines direct tool calls with sub-execution tool calls', () => {
    const wsDir = join(tempDir, 'ws-hash-1');
    const subId = 'sub-exec-def456';

    writeIdeSessionWithSubExec(wsDir, 'session-1', baseMeta(), [
      userEntry('Do stuff'),
      turnStartEntry(),
      assistantEntry('Working on it.'),
      toolCallEntry('tc-direct-1', 'read_file', { path: '/a.txt' }),
      subAgentStartEntry(subId),
      subAgentCompleteEntry(subId),
      turnEndEntry(),
    ], {
      [subId]: [
        toolCallEntry('tc-sub-1', 'web_fetch', { url: 'https://example.com' }),
        toolResultEntry('tc-sub-1'),
      ],
    });

    const reader = createIdeV1Reader([wsDir]);
    const convs = reader.getConversations();
    const assistantMsg = convs[0].messages[1];

    expect(assistantMsg.toolUses).toHaveLength(2);
    expect(assistantMsg.toolUses![0].name).toBe('read_file');
    expect(assistantMsg.toolUses![1].name).toBe('web_fetch');
  });

  it('skips subagent_response and report_progress tools from sub-executions', () => {
    const wsDir = join(tempDir, 'ws-hash-1');
    const subId = 'sub-exec-ghi789';

    writeIdeSessionWithSubExec(wsDir, 'session-1', baseMeta(), [
      userEntry('Research'),
      turnStartEntry(),
      assistantEntry('Researching.'),
      subAgentStartEntry(subId),
      subAgentCompleteEntry(subId),
      turnEndEntry(),
    ], {
      [subId]: [
        toolCallEntry('tc-sub-1', 'web_fetch', { url: 'https://example.com' }),
        toolResultEntry('tc-sub-1'),
        toolCallEntry('tc-sub-2', 'report_progress', { message: 'halfway' }),
        toolResultEntry('tc-sub-2'),
        toolCallEntry('tc-sub-3', 'web_fetch', { url: 'https://other.com' }),
        toolResultEntry('tc-sub-3'),
        toolCallEntry('tc-sub-4', 'subagent_response', { response: 'done' }),
        toolResultEntry('tc-sub-4'),
      ],
    });

    const reader = createIdeV1Reader([wsDir]);
    const convs = reader.getConversations();
    const assistantMsg = convs[0].messages[1];

    // Only the 2 web_fetch calls, not report_progress or subagent_response
    expect(assistantMsg.toolUses).toHaveLength(2);
    expect(assistantMsg.toolUses![0].name).toBe('web_fetch');
    expect(assistantMsg.toolUses![1].name).toBe('web_fetch');
  });

  it('handles missing sub-execution file gracefully', () => {
    const wsDir = join(tempDir, 'ws-hash-1');

    writeIdeSessionWithSubExec(wsDir, 'session-1', baseMeta(), [
      userEntry('Research'),
      turnStartEntry(),
      assistantEntry('Let me look into that.'),
      subAgentStartEntry('nonexistent-sub-id'),
      subAgentCompleteEntry('nonexistent-sub-id'),
      assistantEntry('Done.'),
      turnEndEntry(),
    ], {});  // No sub-execution files

    const reader = createIdeV1Reader([wsDir]);
    const convs = reader.getConversations();
    const assistantMsg = convs[0].messages[1];

    // Should still parse without error, just no sub-execution tools
    expect(assistantMsg.content).toBe('Done.');
    expect(assistantMsg.toolUses).toBeUndefined();
  });

  it('handles sub_agent_start without subSessionId gracefully', () => {
    const wsDir = join(tempDir, 'ws-hash-1');

    const malformedSubStart = JSON.stringify({
      id: `entry-${++entryCounter}`,
      timestamp: '2026-08-20T10:00:03Z',
      payload: { type: 'sub_agent_start', parentExecutionId: 'exec-1' },
    });

    writeIdeSessionWithSubExec(wsDir, 'session-1', baseMeta(), [
      userEntry('Research'),
      turnStartEntry(),
      assistantEntry('Working.'),
      malformedSubStart,
      assistantEntry('Done.'),
      turnEndEntry(),
    ], {});

    const reader = createIdeV1Reader([wsDir]);
    const convs = reader.getConversations();

    expect(convs).toHaveLength(1);
    expect(convs[0].messages[1].content).toBe('Done.');
  });

  it('handles multiple sub-agents in a single turn', () => {
    const wsDir = join(tempDir, 'ws-hash-1');
    const subId1 = 'sub-exec-first';
    const subId2 = 'sub-exec-second';

    writeIdeSessionWithSubExec(wsDir, 'session-1', baseMeta(), [
      userEntry('Complex task'),
      turnStartEntry(),
      assistantEntry('Dispatching sub-agents.'),
      subAgentStartEntry(subId1),
      subAgentCompleteEntry(subId1),
      subAgentStartEntry(subId2),
      subAgentCompleteEntry(subId2),
      assistantEntry('Both done.'),
      turnEndEntry(),
    ], {
      [subId1]: [
        toolCallEntry('tc-s1-1', 'web_fetch', { url: 'https://a.com' }),
        toolResultEntry('tc-s1-1'),
      ],
      [subId2]: [
        toolCallEntry('tc-s2-1', 'read_file', { path: '/b.txt' }),
        toolResultEntry('tc-s2-1'),
        toolCallEntry('tc-s2-2', 'execute_bash', { command: 'ls' }),
        toolResultEntry('tc-s2-2'),
      ],
    });

    const reader = createIdeV1Reader([wsDir]);
    const convs = reader.getConversations();
    const assistantMsg = convs[0].messages[1];

    expect(assistantMsg.toolUses).toHaveLength(3);
    expect(assistantMsg.toolUses![0].name).toBe('web_fetch');
    expect(assistantMsg.toolUses![1].name).toBe('read_file');
    expect(assistantMsg.toolUses![2].name).toBe('execute_bash');
  });

  it('does not affect turns without sub-agents', () => {
    const wsDir = join(tempDir, 'ws-hash-1');

    writeIdeSessionWithSubExec(wsDir, 'session-1', baseMeta(), [
      userEntry('Simple question'),
      turnStartEntry(),
      assistantEntry('Simple answer.'),
      turnEndEntry(),
    ], {});

    const reader = createIdeV1Reader([wsDir]);
    const convs = reader.getConversations();
    const assistantMsg = convs[0].messages[1];

    expect(assistantMsg.content).toBe('Simple answer.');
    expect(assistantMsg.toolUses).toBeUndefined();
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

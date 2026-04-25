import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createCliV2Reader } from './cli-v2.js';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'cli-v2-test-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function writeSession(id: string, meta: Record<string, unknown>, jsonlLines: string[]) {
  writeFileSync(join(tempDir, `${id}.json`), JSON.stringify(meta));
  writeFileSync(join(tempDir, `${id}.jsonl`), jsonlLines.join('\n'));
}

function promptEntry(text: string): string {
  return JSON.stringify({
    version: 'v1',
    kind: 'Prompt',
    data: { message_id: 'msg-1', content: [{ kind: 'text', data: text }] },
  });
}

function assistantEntry(text: string, toolUses?: { toolUseId: string; name: string; input: Record<string, unknown> }[]): string {
  const content: { kind: string; data: unknown }[] = [];
  if (text) content.push({ kind: 'text', data: text });
  if (toolUses) {
    for (const t of toolUses) content.push({ kind: 'toolUse', data: t });
  }
  return JSON.stringify({
    version: 'v1',
    kind: 'AssistantMessage',
    data: { message_id: 'msg-2', content },
  });
}

function toolResultEntry(): string {
  return JSON.stringify({
    version: 'v1',
    kind: 'ToolResults',
    data: { message_id: 'msg-3', content: [], results: {} },
  });
}

describe('createCliV2Reader', () => {
  it('returns empty array for non-existent directory', () => {
    const reader = createCliV2Reader('/tmp/does-not-exist-xyz');
    expect(reader.getConversations()).toEqual([]);
  });

  it('returns empty array for empty directory', () => {
    const reader = createCliV2Reader(tempDir);
    expect(reader.getConversations()).toEqual([]);
  });

  it('parses a basic conversation with prompt and response', () => {
    writeSession('sess-1', {
      session_id: 'sess-1',
      cwd: '/home/user/project',
      created_at: '2026-04-20T10:00:00Z',
      updated_at: '2026-04-20T10:05:00Z',
      title: 'Test conversation',
    }, [
      promptEntry('Hello world'),
      assistantEntry('Hi there!'),
    ]);

    const reader = createCliV2Reader(tempDir);
    const convs = reader.getConversations();

    expect(convs).toHaveLength(1);
    expect(convs[0].conversationId).toBe('sess-1');
    expect(convs[0].directoryPath).toBe('/home/user/project');
    expect(convs[0].messages).toHaveLength(2);
    expect(convs[0].messages[0]).toEqual({ role: 'user', content: 'Hello world' });
    expect(convs[0].messages[1]).toEqual({ role: 'assistant', content: 'Hi there!' });
  });

  it('parses tool uses in assistant messages', () => {
    writeSession('sess-2', {
      session_id: 'sess-2',
      cwd: '/home/user',
      created_at: '2026-04-20T10:00:00Z',
      updated_at: '2026-04-20T10:05:00Z',
      title: 'Tool use test',
    }, [
      promptEntry('Read my file'),
      assistantEntry('Let me read that.', [
        { toolUseId: 'tool-1', name: 'ReadFile', input: { path: '/tmp/test.txt' } },
      ]),
    ]);

    const reader = createCliV2Reader(tempDir);
    const convs = reader.getConversations();
    const msg = convs[0].messages[1];

    expect(msg.role).toBe('assistant');
    expect(msg.content).toBe('Let me read that.');
    expect(msg.toolUses).toHaveLength(1);
    expect(msg.toolUses![0]).toEqual({
      id: 'tool-1',
      name: 'ReadFile',
      args: { path: '/tmp/test.txt' },
    });
  });

  it('skips ToolResults entries', () => {
    writeSession('sess-3', {
      session_id: 'sess-3',
      cwd: '/home/user',
      created_at: '2026-04-20T10:00:00Z',
      updated_at: '2026-04-20T10:05:00Z',
      title: 'Tool results test',
    }, [
      promptEntry('Do something'),
      assistantEntry('Working on it.'),
      toolResultEntry(),
      assistantEntry('Done!'),
    ]);

    const reader = createCliV2Reader(tempDir);
    const convs = reader.getConversations();

    // The two assistant messages should be separate since there's a ToolResults in between
    // But ToolResults itself shouldn't appear as a message
    const roles = convs[0].messages.map(m => m.role);
    expect(roles).not.toContain('tool');
    expect(convs[0].messages.filter(m => m.role === 'user')).toHaveLength(1);
  });

  it('merges consecutive assistant messages', () => {
    writeSession('sess-4', {
      session_id: 'sess-4',
      cwd: '/home/user',
      created_at: '2026-04-20T10:00:00Z',
      updated_at: '2026-04-20T10:05:00Z',
      title: 'Merge test',
    }, [
      promptEntry('Hello'),
      assistantEntry('Part 1'),
      assistantEntry('Part 2'),
    ]);

    const reader = createCliV2Reader(tempDir);
    const convs = reader.getConversations();

    expect(convs[0].messages).toHaveLength(2);
    expect(convs[0].messages[1].content).toBe('Part 1\n\nPart 2');
  });

  it('skips sessions with no messages in jsonl', () => {
    writeSession('sess-5', {
      session_id: 'sess-5',
      cwd: '/home/user',
      created_at: '2026-04-20T10:00:00Z',
      updated_at: '2026-04-20T10:05:00Z',
      title: 'Empty',
    }, []);

    const reader = createCliV2Reader(tempDir);
    expect(reader.getConversations()).toHaveLength(0);
  });

  it('skips sessions with missing jsonl file', () => {
    // Only write the .json metadata, no .jsonl
    writeFileSync(join(tempDir, 'sess-6.json'), JSON.stringify({
      session_id: 'sess-6',
      cwd: '/home/user',
      created_at: '2026-04-20T10:00:00Z',
      updated_at: '2026-04-20T10:05:00Z',
      title: 'No transcript',
    }));

    const reader = createCliV2Reader(tempDir);
    expect(reader.getConversations()).toHaveLength(0);
  });

  it('sorts conversations by recency (most recent first)', () => {
    writeSession('old', {
      session_id: 'old',
      cwd: '/home/user',
      created_at: '2026-04-18T10:00:00Z',
      updated_at: '2026-04-18T10:05:00Z',
      title: 'Old',
    }, [promptEntry('old'), assistantEntry('old reply')]);

    writeSession('new', {
      session_id: 'new',
      cwd: '/home/user',
      created_at: '2026-04-20T10:00:00Z',
      updated_at: '2026-04-20T10:05:00Z',
      title: 'New',
    }, [promptEntry('new'), assistantEntry('new reply')]);

    const reader = createCliV2Reader(tempDir);
    const convs = reader.getConversations();

    expect(convs).toHaveLength(2);
    expect(convs[0].conversationId).toBe('new');
    expect(convs[1].conversationId).toBe('old');
  });

  it('ignores .lock files', () => {
    writeSession('sess-7', {
      session_id: 'sess-7',
      cwd: '/home/user',
      created_at: '2026-04-20T10:00:00Z',
      updated_at: '2026-04-20T10:05:00Z',
      title: 'With lock',
    }, [promptEntry('hi'), assistantEntry('hello')]);

    // Write a lock file that shouldn't be parsed
    writeFileSync(join(tempDir, 'sess-7.lock'), '12345');

    const reader = createCliV2Reader(tempDir);
    const convs = reader.getConversations();
    expect(convs).toHaveLength(1);
  });

  it('handles malformed json in metadata gracefully', () => {
    writeFileSync(join(tempDir, 'bad.json'), '{not valid json');
    writeFileSync(join(tempDir, 'bad.jsonl'), promptEntry('test'));

    const reader = createCliV2Reader(tempDir);
    expect(reader.getConversations()).toHaveLength(0);
  });

  it('handles malformed jsonl lines gracefully', () => {
    writeSession('sess-8', {
      session_id: 'sess-8',
      cwd: '/home/user',
      created_at: '2026-04-20T10:00:00Z',
      updated_at: '2026-04-20T10:05:00Z',
      title: 'Bad lines',
    }, [
      '{not valid',
      promptEntry('valid prompt'),
      assistantEntry('valid response'),
    ]);

    const reader = createCliV2Reader(tempDir);
    const convs = reader.getConversations();
    expect(convs).toHaveLength(1);
    expect(convs[0].messages).toHaveLength(2);
  });

  it('uses filename as conversationId when session_id is missing', () => {
    writeSession('fallback-id', {
      cwd: '/home/user',
      created_at: '2026-04-20T10:00:00Z',
      updated_at: '2026-04-20T10:05:00Z',
      title: 'No session_id',
    }, [promptEntry('test'), assistantEntry('reply')]);

    const reader = createCliV2Reader(tempDir);
    const convs = reader.getConversations();
    expect(convs[0].conversationId).toBe('fallback-id');
  });
});

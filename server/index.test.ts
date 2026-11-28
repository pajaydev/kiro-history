import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'net';
import { createApp, startServer, parseHostHeader, resolveAllowedHosts, sseClientCount, notifyClients } from './index.js';
import type { ServerOptions } from './index.js';
import { createEmptyDatabaseReader } from './db.js';
import type { DatabaseReader, ConversationEntryV2 } from './db.js';
import type { CliV2Reader } from './cli-v2.js';
import type { ParsedConversation } from './types.js';

function dbReaderWith(rows: ConversationEntryV2[]): DatabaseReader {
  return { ...createEmptyDatabaseReader(), hasV2Table: () => true, getConversationsV2: () => rows };
}

function cliV2ReaderWith(conversations: ParsedConversation[]): CliV2Reader {
  return { getConversations: () => conversations, close: () => {} };
}

const baseOptions: ServerOptions = { reader: createEmptyDatabaseReader(), sourceType: 'cli' };

describe('parseHostHeader', () => {
  it.each([
    ['localhost:3000', 'localhost'],
    ['127.0.0.1', '127.0.0.1'],
    ['[::1]:8080', '::1'],
    ['EVIL.example.com:80', 'evil.example.com'],
    [undefined, undefined],
    ['[::1', undefined],
  ])('%s -> %s', (input, expected) => {
    expect(parseHostHeader(input)).toBe(expected);
  });
});

describe('resolveAllowedHosts', () => {
  it('allows loopback names plus a specific bind host', () => {
    const hosts = resolveAllowedHosts('192.168.1.5');
    expect([...hosts]).toEqual(expect.arrayContaining(['localhost', '127.0.0.1', '::1', '192.168.1.5']));
  });

  it('allows local interface addresses for a wildcard bind', () => {
    expect(resolveAllowedHosts('0.0.0.0').has('127.0.0.1')).toBe(true);
  });
});

describe('Host header check (DNS rebinding)', () => {
  const app = createApp(baseOptions);

  it.each(['localhost:1234', '127.0.0.1:1234', '[::1]:1234'])('allows Host %s', async (host) => {
    const res = await app.request('/api/sources', { headers: { host } });
    expect(res.status).toBe(200);
  });

  it.each(['evil.example.com:1234', 'localhost.evil.com', '127.0.0.1.nip.io'])('rejects Host %s', async (host) => {
    const res = await app.request('/api/conversations', { headers: { host } });
    expect(res.status).toBe(403);
  });

  it('rejects a request with no Host header', async () => {
    const res = await app.fetch(new Request('http://x/api/sources', { headers: { host: '' } }));
    expect(res.status).toBe(403);
  });
});

describe('API routes', () => {
  it('returns a JSON 404 for unknown API routes', async () => {
    const res = await createApp(baseOptions).request('/api/nope', { headers: { host: 'localhost' } });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });

  it('prefers the CLI V2 flat-file copy when an id is also in the DB', async () => {
    const app = createApp({
      ...baseOptions,
      reader: dbReaderWith([{
        key: '/proj', conversationId: 'dup', createdAt: 1, updatedAt: 1,
        value: JSON.stringify({ conversation_id: 'dup', history: [{ user: { content: { Prompt: { prompt: 'db copy' } } } }] }),
      }]),
      cliV2Reader: cliV2ReaderWith([{
        directoryPath: '/proj', conversationId: 'dup', updatedAt: 2, resumeId: 'dup',
        messages: [{ role: 'user', content: 'flat-file copy' }],
      }]),
    });
    const res = await app.request('/api/conversations', { headers: { host: 'localhost' } });
    const body = (await res.json()) as ParsedConversation[];
    expect(body).toHaveLength(1);
    expect(body[0].messages[0].content).toBe('flat-file copy');
  });

  it('merges CLI 3.x sessions into the CLI list, newest first', async () => {
    const app = createApp({
      ...baseOptions,
      cliV2Reader: cliV2ReaderWith([{
        directoryPath: '/old', conversationId: 'v2', updatedAt: 1, resumeId: 'v2',
        messages: [{ role: 'user', content: 'v2 session' }],
      }]),
      cliV3Reader: {
        getConversations: () => [{
          directoryPath: '/new', conversationId: 'sess_v3', updatedAt: 2, resumeId: 'sess_v3',
          messages: [{ role: 'user', content: 'v3 session' }],
        }],
        refresh: () => {},
        close: () => {},
      },
    });
    const body = (await (await app.request('/api/conversations', { headers: { host: 'localhost' } })).json()) as ParsedConversation[];
    expect(body.map(c => c.conversationId)).toEqual(['sess_v3', 'v2']);
  });

  it('sets resumeId for DB V2 conversations', async () => {
    const app = createApp({
      ...baseOptions,
      reader: dbReaderWith([{
        key: '/proj', conversationId: 'abc', createdAt: 1, updatedAt: 1,
        value: JSON.stringify({ conversation_id: 'abc', history: [{ user: { content: { Prompt: { prompt: 'hi' } } } }] }),
      }]),
    });
    const body = (await (await app.request('/api/conversations', { headers: { host: 'localhost' } })).json()) as ParsedConversation[];
    expect(body[0].resumeId).toBe('abc');
  });
});

describe('startServer', () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()!();
  });

  it('rejects with EADDRINUSE when the port is taken', async () => {
    const blocker: Server = createServer();
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', () => r()));
    cleanups.push(() => blocker.close());
    const port = (blocker.address() as { port: number }).port;

    await expect(startServer({ ...baseOptions, port })).rejects.toMatchObject({ code: 'EADDRINUSE' });
  });

  it('removes SSE clients when they disconnect', async () => {
    const { port, close } = await startServer(baseOptions);
    cleanups.push(close);
    const before = sseClientCount();

    const controllers = [1, 2, 3].map(() => new AbortController());
    const responses = await Promise.all(
      controllers.map((ctl) => fetch(`http://127.0.0.1:${port}/api/events`, { signal: ctl.signal }))
    );
    responses.forEach((r) => expect(r.status).toBe(200));
    await waitFor(() => sseClientCount() === before + 3);

    controllers.forEach((ctl) => ctl.abort());
    await waitFor(() => sseClientCount() === before);
    expect(() => notifyClients()).not.toThrow();
  });
});

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 20));
  }
}

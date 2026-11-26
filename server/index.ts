import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { serve } from '@hono/node-server';
import { readFile, stat } from 'fs/promises';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import { networkInterfaces } from 'os';
import type { DatabaseReader } from './db.js';
import type { IdeReader } from './ide.js';
import type { CliV2Reader } from './cli-v2.js';
import type { IdeV1Reader } from './ide-v1.js';
import { parseConversationValue, parseConversationValueSimple } from './parser.js';
import { DEFAULT_HOST } from './constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface ServerOptions {
  reader: DatabaseReader | IdeReader;
  sourceType: 'cli' | 'ide';
  alternateReader?: DatabaseReader | IdeReader;
  alternateSourceType?: 'cli' | 'ide';
  cliV2Reader?: CliV2Reader;
  ideV1Reader?: IdeV1Reader;
  /**
   * Hostnames accepted in the Host header. Requests with any other Host are
   * rejected, which blocks DNS-rebinding attacks from web pages. Defaults to
   * the loopback names.
   */
  allowedHosts?: Iterable<string>;
}

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '::1'];
const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '']);

/** Hostnames a browser may legitimately use to reach a server bound to `bindHost`. */
export function resolveAllowedHosts(bindHost: string): Set<string> {
  const hosts = new Set(LOOPBACK_HOSTS);
  const normalized = bindHost.replace(/^\[|\]$/g, '').toLowerCase();
  if (WILDCARD_HOSTS.has(normalized)) {
    // Bound to every interface: accept each local interface address.
    for (const addrs of Object.values(networkInterfaces())) {
      for (const a of addrs ?? []) hosts.add(a.address.toLowerCase());
    }
  } else {
    hosts.add(normalized);
  }
  return hosts;
}

/** Extracts the hostname (no port, no IPv6 brackets) from a Host header value. */
export function parseHostHeader(host: string | undefined): string | undefined {
  if (!host) return undefined;
  const h = host.trim().toLowerCase();
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    return end === -1 ? undefined : h.slice(1, end);
  }
  const colon = h.indexOf(':');
  return colon === -1 ? h : h.slice(0, colon);
}

// SSE clients waiting for refresh notifications
const sseClients = new Set<(data: string) => void>();

/** Number of connected SSE clients (exposed for tests). */
export function sseClientCount(): number {
  return sseClients.size;
}

export function notifyClients(): void {
  for (const send of sseClients) {
    send('refresh');
  }
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

export function createApp(options: ServerOptions): Hono {
  const app = new Hono();
  const { reader, sourceType, alternateReader, alternateSourceType, cliV2Reader, ideV1Reader } = options;
  const allowedHosts = new Set(options.allowedHosts ?? LOOPBACK_HOSTS);

  // Error handling middleware
  app.onError((err, c) => {
    console.error('Server error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  });

  // Reject requests whose Host header is not this machine. A page on another
  // site can rebind its own domain to 127.0.0.1; its requests then carry that
  // domain in the Host header, so checking it keeps the history private.
  app.use('*', async (c, next) => {
    const hostname = parseHostHeader(c.req.header('host'));
    if (!hostname || !allowedHosts.has(hostname)) {
      return c.text('Forbidden: unrecognized Host header', 403);
    }
    await next();
  });

  // API: Get available sources
  app.get('/api/sources', (c) => {
    const sources = [sourceType];
    if (alternateReader && alternateSourceType) {
      sources.push(alternateSourceType);
    }
    return c.json({ 
      sources,
      default: sourceType 
    });
  });

  // API: Get conversations (parsed)
  app.get('/api/conversations', (c) => {
    try {
      // Check if source parameter is provided
      const requestedSource = c.req.query('source') as 'cli' | 'ide' | undefined;
      
      // Determine which reader to use
      let activeReader = reader;
      if (requestedSource && requestedSource !== sourceType && alternateReader) {
        activeReader = alternateReader;
      }

      // Check if this is a DatabaseReader (has hasV2Table method) or IdeReader
      if ('hasV2Table' in activeReader) {
        const dbReader = activeReader as DatabaseReader;
        let parsed: { directoryPath: string; conversationId: string; messages: ReturnType<typeof parseConversationValueSimple>; updatedAt?: number }[] = [];

        if (dbReader.hasV2Table()) {
          const v2Conversations = dbReader.getConversationsV2();
          parsed = v2Conversations.map((conv) => {
            const allMessages = parseConversationValueSimple(conv.key, conv.value);
            return {
              directoryPath: conv.key,
              conversationId: conv.conversationId,
              messages: allMessages,
              updatedAt: conv.updatedAt,
              resumeId: conv.conversationId,
            };
          }).filter((conv) => conv.messages.length > 0);
        } else {
          // Fallback to V1 table
          const rawConversations = dbReader.getConversations();
          parsed = rawConversations
            .flatMap((conv) => parseConversationValue(conv.key, conv.value));
        }

        // Merge V2 flat file sessions if available. The flat files are the
        // newer format, so they win when both hold the same conversation
        // (same rule as the IDE merge below).
        if (cliV2Reader) {
          const v2FlatConversations = cliV2Reader.getConversations();
          const flatIds = new Set(v2FlatConversations.map(c => c.conversationId));
          parsed = parsed.filter(c => !flatIds.has(c.conversationId));
          parsed.push(...v2FlatConversations);
          // Re-sort by recency after merge
          parsed.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        }

        return c.json(parsed);
      }

      // IdeReader path
      const conversations = activeReader.getConversations();

      // Merge new-format IDE sessions if available
      if (ideV1Reader) {
        const v1Conversations = ideV1Reader.getConversations();
        // New format wins on deduplication — build set of new-format IDs
        const v1Ids = new Set(v1Conversations.map(c => c.conversationId));
        // Keep old-format sessions that aren't duplicated in new format
        const deduplicated = conversations.filter(c => !v1Ids.has(c.conversationId));
        const merged = [...v1Conversations, ...deduplicated];
        merged.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        return c.json(merged);
      }

      return c.json(conversations);
    } catch (error) {
      console.error('Failed to read conversations:', error);
      return c.json({ error: 'Failed to read database' }, 500);
    }
  });

  // API: SSE endpoint for live updates
  app.get('/api/events', (c) => {
    return streamSSE(c, async (stream) => {
      const send = () => {
        stream.writeSSE({ event: 'refresh', data: '{}' }).catch(() => {
          // Client went away mid-write; onAbort below removes it.
        });
      };

      sseClients.add(send);
      // Hono only flags the stream as aborted when the client disconnects, so
      // remove the client here rather than relying on the loop to notice.
      stream.onAbort(() => {
        sseClients.delete(send);
      });

      try {
        // Send initial connection confirmation
        await stream.writeSSE({ event: 'connected', data: '{}' });

        // Keep the connection alive until the client disconnects. The comment
        // line stops idle proxies and browsers from dropping the stream.
        while (!stream.aborted) {
          await stream.sleep(30000);
          if (!stream.aborted) await stream.write(': keep-alive\n\n');
        }
      } finally {
        sseClients.delete(send);
      }
    });
  });

  const uiDistPath = join(__dirname, '..', 'ui', 'dist');

  // Unknown API routes get a JSON 404 instead of the SPA's index.html.
  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

  app.get('/*', async (c) => {
    const urlPath = c.req.path;
    
    // Try to serve the requested file
    const filePath = join(uiDistPath, urlPath === '/' ? 'index.html' : urlPath);
    
    try {
      const fileStat = await stat(filePath);
      if (fileStat.isFile()) {
        const content = await readFile(filePath);
        const ext = extname(filePath);
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        return new Response(content, {
          headers: { 'Content-Type': contentType },
        });
      }
    } catch {
      // File not found, fall through to SPA fallback
    }

    // SPA fallback - serve index.html
    try {
      const indexPath = join(uiDistPath, 'index.html');
      const html = await readFile(indexPath, 'utf-8');
      return c.html(html);
    } catch {
      return c.text('UI not built. Run: npm run build:web', 404);
    }
  });

  return app;
}

export async function startServer(
  options: ServerOptions & { port?: number; hostname?: string }
): Promise<{ port: number; close: () => void }> {
  const hostname = options.hostname || DEFAULT_HOST;
  const app = createApp({
    ...options,
    allowedHosts: options.allowedHosts ?? resolveAllowedHosts(hostname),
  });

  // Rejects on listen errors such as EADDRINUSE instead of crashing the
  // process with an unhandled 'error' event.
  return new Promise((resolve, reject) => {
    const server = serve({
      fetch: app.fetch,
      port: options.port || 0, // Use specified port or let OS assign
      hostname,
    }, (info) => {
      server.off('error', reject);
      resolve({
        port: info.port,
        close: () => server.close(),
      });
    });
    server.once('error', reject);
  });
}

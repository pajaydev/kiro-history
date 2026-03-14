import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { serve } from '@hono/node-server';
import { readFile, stat } from 'fs/promises';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import type { DatabaseReader } from './db.js';
import type { IdeReader } from './ide.js';
import { parseConversationValue, parseConversationValueSimple } from './parser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface ServerOptions {
  reader: DatabaseReader | IdeReader;
  sourceType: 'cli' | 'ide';
  alternateReader?: DatabaseReader | IdeReader;
  alternateSourceType?: 'cli' | 'ide';
}

// SSE clients waiting for refresh notifications
const sseClients = new Set<(data: string) => void>();

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
  const { reader, sourceType, alternateReader, alternateSourceType } = options;

  // Error handling middleware
  app.onError((err, c) => {
    console.error('Server error:', err);
    return c.json({ error: 'Internal server error' }, 500);
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
        if (dbReader.hasV2Table()) {
          const v2Conversations = dbReader.getConversationsV2();
          const parsed = v2Conversations.map((conv) => {
            const allMessages = parseConversationValueSimple(conv.key, conv.value);
            return {
              directoryPath: conv.key,
              conversationId: conv.conversationId,
              messages: allMessages,
              updatedAt: conv.updatedAt,
            };
          }).filter((conv) => conv.messages.length > 0);
          return c.json(parsed);
        }
        
        // Fallback to V1 table
        const rawConversations = dbReader.getConversations();
        const parsed = rawConversations
          .flatMap((conv) => parseConversationValue(conv.key, conv.value));
        return c.json(parsed);
      }

      // IdeReader path
      const conversations = activeReader.getConversations();
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
        stream.writeSSE({ event: 'refresh', data: '{}' });
      };

      sseClients.add(send);

      // Send initial connection confirmation
      await stream.writeSSE({ event: 'connected', data: '{}' });

      // Keep connection alive until client disconnects
      try {
        while (true) {
          await stream.sleep(30000); // Keep-alive every 30s
        }
      } finally {
        sseClients.delete(send);
      }
    });
  });

  const uiDistPath = join(__dirname, '..', 'ui', 'dist');

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
  options: ServerOptions & { port?: number }
): Promise<{ port: number; close: () => void }> {
  const app = createApp(options);

  return new Promise((resolve) => {
    const server = serve({
      fetch: app.fetch,
      port: options.port || 0, // Use specified port or let OS assign
    }, (info) => {
      resolve({
        port: info.port,
        close: () => server.close(),
      });
    });
  });
}

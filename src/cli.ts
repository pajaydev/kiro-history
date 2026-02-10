#!/usr/bin/env node
import { existsSync } from 'fs';
import { homedir, platform } from 'os';
import { join } from 'path';
import { Command } from 'commander';
import { createDatabaseReader } from './db.js';
import { startServer, notifyClients } from './server.js';
import { watchFile } from './watcher.js';
import { openBrowser } from './browser.js';

export function resolveDbPath(userPath?: string): string {
  if (userPath) {
    return userPath;
  }

  const plat = platform();
  
  // Check kiro-cli first (newer), then amazon-q (older)
  if (plat === 'darwin') {
    const kiroCli = join(homedir(), 'Library', 'Application Support', 'kiro-cli', 'data.sqlite3');
    if (existsSync(kiroCli)) return kiroCli;
    return join(homedir(), 'Library', 'Application Support', 'amazon-q', 'data.sqlite3');
  } else if (plat === 'linux') {
    const kiroCli = join(homedir(), '.local', 'share', 'kiro-cli', 'data.sqlite3');
    if (existsSync(kiroCli)) return kiroCli;
    return join(homedir(), '.local', 'share', 'amazon-q', 'data.sqlite3');
  } else {
    // Windows or other platforms
    return join(homedir(), '.local', 'share', 'amazon-q', 'data.sqlite3');
  }
}

export async function main(): Promise<void> {
  const program = new Command();
  
  program
    .name('kiro-history')
    .description('View Kiro CLI command history and chat conversations in your browser')
    .version('0.1.0')
    .argument('[path]', 'Path to the kiro CLI database file')
    .option('-p, --port <number>', 'Port to run the server on (default: auto)')
    .option('--no-open', 'Do not open browser automatically')
    .action(async (userPath?: string, options?: { port?: string; open?: boolean }) => {
      const dbPath = resolveDbPath(userPath);

      // Check if database file exists
      if (!existsSync(dbPath)) {
        console.error(`Error: Database file not found at: ${dbPath}`);
        console.error('Please specify a valid database path as an argument.');
        process.exit(1);
      }

      console.log(`Using database: ${dbPath}`);

      // Initialize database reader
      const reader = createDatabaseReader(dbPath);

      // Start server
      const requestedPort = options?.port ? parseInt(options.port, 10) : 0;
      const { port, close: closeServer } = await startServer({ reader, port: requestedPort });
      const url = `http://localhost:${port}`;
      console.log(`Server running at: ${url}`);

      // Start file watcher
      const watcher = watchFile(dbPath, () => {
        console.log('Database changed, notifying clients...');
        notifyClients();
      });

      // Open browser (unless --no-open)
      if (options?.open !== false) {
        const opened = await openBrowser(url);
        if (!opened) {
          console.log(`Open this URL in your browser: ${url}`);
        }
      } else {
        console.log(`Open this URL in your browser: ${url}`);
      }

      // Setup graceful shutdown handlers
      const cleanup = () => {
        console.log('\nShutting down gracefully...');
        watcher.close();
        reader.close();
        closeServer();
        process.exit(0);
      };

      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);

      // Keep process alive
      await new Promise(() => {});
    });

  program.parse();
}

// Always run main when this file is executed
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

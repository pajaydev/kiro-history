#!/usr/bin/env node
import { existsSync } from 'fs';
import { homedir, platform } from 'os';
import { join } from 'path';
import { Command } from 'commander';
import { createDatabaseReader } from './db.js';
import { createIdeReader } from './ide.js';
import { createCliV2Reader, resolveCliV2Path } from './cli-v2.js';
import { startServer, notifyClients } from './index.js';
import type { ServerOptions } from './index.js';
import { watchFile, watchDirectory } from './watcher.js';
import { openBrowser } from './browser.js';

export type SourceType = 'cli' | 'ide' | 'auto';

export function resolveDbPath(userPath?: string): string {
  if (userPath) {
    return userPath;
  }

  const plat = platform();
 
  // support both Kiro and amazon Q cli
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

export function resolveIdePath(userPath?: string): string {
  if (userPath) {
    return userPath;
  }

  const plat = platform();

  if (plat === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Kiro', 'User', 'globalStorage', 'kiro.kiroagent');
  } else if (plat === 'linux') {
    return join(homedir(), '.config', 'Kiro', 'User', 'globalStorage', 'kiro.kiroagent');
  } else {
    // Windows
    const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
    return join(appData, 'Kiro', 'User', 'globalStorage', 'kiro.kiroagent');
  }
}

export function detectSource(): 'cli' | 'ide' {
  const idePath = resolveIdePath();
  const dbPath = resolveDbPath();

  const hasIde = existsSync(join(idePath, 'workspace-sessions')) || existsSync(join(idePath, 'sessions'));
  const hasCli = existsSync(dbPath);

  if (hasIde && !hasCli) return 'ide';
  if (hasCli && !hasIde) return 'cli';
  // Both exist — prefer CLI as default
  if (hasCli) return 'cli';
  return 'ide';
}

export async function main(): Promise<void> {
  const program = new Command();
  
  program
    .name('kiro-history')
    .description('View Kiro conversation history in your browser (supports both CLI and IDE)')
    .version('0.3.1')
    .argument('[path]', 'Custom path to the database file (CLI) or sessions directory (IDE)')
    .option('-p, --port <number>', 'Port to run the server on (default: auto)')
    .option('-s, --source <type>', 'Source type: cli, ide, or auto (default: auto)', 'auto')
    .option('--no-open', 'Do not open browser automatically')
    .action(async (userPath?: string, options?: { port?: string; open?: boolean; source?: string }) => {
      const sourceOption = (options?.source || 'auto') as SourceType;
      const source = sourceOption === 'auto' ? detectSource() : sourceOption as 'cli' | 'ide';

      let reader: ServerOptions['reader'];
      let alternateReader: ServerOptions['alternateReader'];
      let alternateSourceType: ServerOptions['alternateSourceType'];
      let watchTarget: string;
      let watcherInstance: { close(): void };

      // Try to load both sources if available
      const idePath = resolveIdePath(userPath);
      const dbPath = resolveDbPath(userPath);
      const hasIde = existsSync(join(idePath, 'workspace-sessions')) || existsSync(join(idePath, 'sessions'));
      const hasCli = existsSync(dbPath);

      if (source === 'ide') {
        const wsSessionsDir = join(idePath, 'workspace-sessions');

        if (!existsSync(idePath)) {
          console.error(`Error: Kiro IDE data not found at: ${idePath}`);
          console.error('Make sure Kiro IDE is installed, or specify the path as an argument.');
          process.exit(1);
        }

        console.log(`Using Kiro IDE sessions: ${idePath}`);
        reader = createIdeReader(idePath);
        watchTarget = wsSessionsDir;

        // Load CLI as alternate if available
        if (hasCli) {
          console.log(`Also found CLI database: ${dbPath}`);
          alternateReader = createDatabaseReader(dbPath);
          alternateSourceType = 'cli';
        }

        // Watch the workspace-sessions directory for changes
        watcherInstance = watchDirectory(watchTarget, () => {
          console.log('Sessions changed, notifying clients...');
          notifyClients();
        });
      } else {

        if (!existsSync(dbPath)) {
          console.error(`Error: Database file not found at: ${dbPath}`);
          console.error('Please specify a valid database path as an argument.');
          process.exit(1);
        }

        console.log(`Using database: ${dbPath}`);
        reader = createDatabaseReader(dbPath);
        watchTarget = dbPath;

        // Load IDE as alternate if available
        if (hasIde) {
          console.log(`Also found IDE sessions: ${idePath}`);
          alternateReader = createIdeReader(idePath);
          alternateSourceType = 'ide';
        }

        watcherInstance = watchFile(watchTarget, () => {
          console.log('Database changed, notifying clients...');
          notifyClients();
        });
      }

      // Start server
      const requestedPort = options?.port ? parseInt(options.port, 10) : 0;

      // Create V2 flat file reader for CLI sessions
      const cliV2Path = resolveCliV2Path();
      const cliV2Reader = existsSync(cliV2Path) ? createCliV2Reader(cliV2Path) : undefined;
      let cliV2Watcher: { close(): void } | undefined;
      if (cliV2Reader) {
        console.log(`Also found CLI V2 sessions: ${cliV2Path}`);
        cliV2Watcher = watchDirectory(cliV2Path, () => {
          console.log('CLI V2 sessions changed, notifying clients...');
          notifyClients();
        });
      }

      const { port, close: closeServer } = await startServer({ 
        reader, 
        port: requestedPort,
        sourceType: source,
        alternateReader,
        alternateSourceType,
        cliV2Reader,
      });
      const url = `http://localhost:${port}`;
      console.log(`Server running at: ${url}`);

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
        watcherInstance.close();
        if (cliV2Watcher) cliV2Watcher.close();
        reader.close();
        if (cliV2Reader) cliV2Reader.close();
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

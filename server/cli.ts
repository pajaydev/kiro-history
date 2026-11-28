#!/usr/bin/env node
import { existsSync } from 'fs';
import { homedir, platform } from 'os';
import { join } from 'path';
import { Command, Option, InvalidArgumentError } from 'commander';
import { createDatabaseReader, createEmptyDatabaseReader } from './db.js';
import { createIdeReader } from './ide.js';
import { createCliV2Reader, resolveCliV2Path } from './cli-v2.js';
import { createIdeV1Reader, resolveIdeV1WorkspaceDirs, resolveIdeV1BasePath, countIdeV1Sessions } from './ide-v1.js';
import { watchIdeV1Workspaces } from './ide-v1-watch.js';
import { startServer, notifyClients } from './index.js';
import type { ServerOptions } from './index.js';
import { watchFile, watchDirectory } from './watcher.js';
import { openBrowser } from './browser.js';
import { readPackageVersion } from './version.js';
import { DEFAULT_SOURCE, DEFAULT_HOST } from './constants.js';

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

/** Which conversation stores exist on disk. */
export function findSources(userPath?: string) {
  const idePath = resolveIdePath(userPath);
  const dbPath = resolveDbPath(userPath);
  const hasOldIde = existsSync(join(idePath, 'workspace-sessions')) || existsSync(join(idePath, 'sessions'));
  // Kiro CLI 3.x shares ~/.kiro/sessions/<hash>/ with the IDE; the session
  // index tells which of those sessions are the CLI's.
  const v1Counts = countIdeV1Sessions();
  const hasNewIde = v1Counts.ide > 0;
  const hasCliV3 = v1Counts.cli > 0;
  const hasDb = existsSync(dbPath);
  // Newer kiro-cli versions write flat session files instead of (or as well as) the DB.
  const hasCliV2 = existsSync(resolveCliV2Path());
  return {
    idePath, dbPath, hasOldIde, hasNewIde, hasDb, hasCliV2, hasCliV3,
    hasIde: hasOldIde || hasNewIde,
    hasCli: hasDb || hasCliV2 || hasCliV3,
  };
}

export function detectSource(): 'cli' | 'ide' {
  const { hasIde, hasCli } = findSources();

  if (hasIde && !hasCli) return 'ide';
  if (hasCli && !hasIde) return 'cli';
  // Both exist — prefer CLI as default
  if (hasCli) return 'cli';
  return 'ide';
}

const SOURCE_CHOICES = ['cli', 'ide', 'auto'];

export function parsePort(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new InvalidArgumentError('Port must be a whole number between 0 and 65535.');
  }
  const port = Number(value);
  if (port > 65535) {
    throw new InvalidArgumentError('Port must be a whole number between 0 and 65535.');
  }
  return port;
}

export async function main(): Promise<void> {
  const program = new Command();
  
  program
    .name('kiro-history')
    .description('View Kiro conversation history in your browser (supports both CLI and IDE)')
    .version(readPackageVersion())
    .argument('[path]', 'Custom path to the database file (CLI) or sessions directory (IDE)')
    .option('-p, --port <number>', 'Port to run the server on (default: auto)', parsePort)
    .addOption(
      new Option('-s, --source <type>', 'Source type')
        .choices(SOURCE_CHOICES)
        .default(DEFAULT_SOURCE)
    )
    .option('--host <address>', 'Host address to bind to', DEFAULT_HOST)
    .option('--no-open', 'Do not open browser automatically')
    .action(async (userPath?: string, options?: { port?: number; open?: boolean; source?: string; host?: string }) => {
      const sourceOption = (options?.source || DEFAULT_SOURCE) as SourceType;
      const source = sourceOption === 'auto' ? detectSource() : sourceOption;

      let reader: ServerOptions['reader'];
      let alternateReader: ServerOptions['alternateReader'];
      let alternateSourceType: ServerOptions['alternateSourceType'];
      let watcherInstance: { close(): void } | undefined;

      // Try to load both sources if available
      const { idePath, dbPath, hasOldIde, hasNewIde, hasCliV3, hasIde, hasDb, hasCli } = findSources(userPath);
      // The CLI view merges V2 flat files into whatever the DB holds, so with
      // no DB an empty DB reader still lets the flat-file sessions show.
      const openCliReader = () => (hasDb ? createDatabaseReader(dbPath) : createEmptyDatabaseReader());

      if (source === 'ide') {
        const wsSessionsDir = join(idePath, 'workspace-sessions');

        if (!existsSync(idePath) && !hasNewIde) {
          console.error(`Error: Kiro IDE data not found at: ${idePath} or ${resolveIdeV1BasePath()}`);
          console.error('Make sure Kiro IDE is installed, or specify the path as an argument.');
          process.exit(1);
        }

        if (hasOldIde) console.log(`Using pre v1.0 IDE sessions: ${idePath}`);
        reader = createIdeReader(idePath);

        // Load CLI as alternate if available
        if (hasCli) {
          if (hasDb) console.log(`Also found CLI database: ${dbPath}`);
          alternateReader = openCliReader();
          alternateSourceType = 'cli';
        }

        // Watch the workspace-sessions directory for changes (only if it exists)
        if (existsSync(wsSessionsDir)) {
          watcherInstance = watchDirectory(wsSessionsDir, () => {
            console.log('Sessions changed, notifying clients...');
            notifyClients();
          });
        }
      } else {

        if (!hasCli) {
          console.error(`Error: No Kiro CLI data found at: ${dbPath} or ${resolveCliV2Path()}`);
          console.error('Please specify a valid database path as an argument.');
          process.exit(1);
        }

        if (hasDb) console.log(`Using database: ${dbPath}`);
        reader = openCliReader();

        // Load IDE as alternate if available
        if (hasIde) {
          if (hasOldIde) console.log(`Also found pre v1.0 IDE sessions: ${idePath}`);
          alternateReader = createIdeReader(idePath);
          alternateSourceType = 'ide';
        }

        if (hasDb) {
          watcherInstance = watchFile(dbPath, () => {
            console.log('Database changed, notifying clients...');
            notifyClients();
          });
        }
      }

      // Start server
      const requestedPort = options?.port ?? 0;

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

      // Create new-format IDE reader (sessions in ~/.kiro/sessions/<workspace-hash>/)
      const ideV1BasePath = resolveIdeV1BasePath();
      const ideV1WorkspaceDirs = resolveIdeV1WorkspaceDirs();
      // Pass the base path so the reader can refresh() its workspace list and
      // pick up workspaces created after startup without a restart.
      const ideV1Reader = ideV1WorkspaceDirs.length > 0 ? createIdeV1Reader(ideV1WorkspaceDirs, ideV1BasePath, { kind: 'ide' }) : undefined;
      // Kiro CLI 3.x sessions live in the same directories, so one watcher
      // below covers both readers.
      const cliV3Reader = ideV1WorkspaceDirs.length > 0
        ? createIdeV1Reader(ideV1WorkspaceDirs, ideV1BasePath, { kind: 'cli' })
        : undefined;
      if (hasNewIde) console.log(`Also found v1.0 IDE sessions`);
      if (hasCliV3) console.log(`Also found CLI 3.x sessions`);
      let ideV1Watcher: { close(): void } | undefined;
      if (ideV1WorkspaceDirs.length > 0) {
        ideV1Watcher = watchIdeV1Workspaces({
          basePath: ideV1BasePath,
          basePathExists: existsSync(ideV1BasePath),
          initialWorkspaceDirs: ideV1WorkspaceDirs,
          resolveWorkspaceDirs: resolveIdeV1WorkspaceDirs,
          watchDirectory,
          onSessionsChanged: () => {
            console.log('IDE v1.0 sessions changed, notifying clients...');
            notifyClients();
          },
          onWorkspacesChanged: () => {
            console.log('IDE v1.0 workspaces changed, notifying clients...');
            notifyClients();
          },
        });
      }

      let started: Awaited<ReturnType<typeof startServer>>;
      try {
        started = await startServer({
          reader,
          port: requestedPort,
          hostname: options?.host,
          sourceType: source,
          alternateReader,
          alternateSourceType,
          cliV2Reader,
          ideV1Reader,
          cliV3Reader,
        });
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'EADDRINUSE') {
          console.error(`Error: Port ${requestedPort} is already in use. Pick another with --port, or omit it to use a free port.`);
        } else if (code === 'EADDRNOTAVAIL' || code === 'ENOTFOUND') {
          console.error(`Error: Cannot bind to host ${options?.host}: address not available on this machine.`);
        } else {
          console.error('Error: Failed to start server:', (error as Error).message);
        }
        process.exit(1);
      }
      const { port, close: closeServer } = started;
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
        watcherInstance?.close();
        if (cliV2Watcher) cliV2Watcher.close();
        if (ideV1Watcher) ideV1Watcher.close();
        reader.close();
        if (cliV2Reader) cliV2Reader.close();
        if (ideV1Reader) ideV1Reader.close();
        if (cliV3Reader) cliV3Reader.close();
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

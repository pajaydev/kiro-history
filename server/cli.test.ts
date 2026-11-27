import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawn } from 'child_process';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { createServer } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { DEFAULT_SOURCE, DEFAULT_HOST } from './constants.js';

// Smoke tests: run the real CLI entry point (via tsx, so no build is needed)
// and check what a user sees on the terminal.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CLI_TIMEOUT_MS = 30_000;

function runCli(...args: string[]): string {
  return execFileSync(process.execPath, ['--import', 'tsx', 'server/cli.ts', ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: CLI_TIMEOUT_MS,
  });
}

// Commander wraps long help lines, so rejoin them before counting.
function helpOptionText(optionFlag: string): string {
  const help = runCli('--help').replace(/\n\s{10,}/g, ' ');
  const line = help.split('\n').find((l) => l.includes(optionFlag));
  if (!line) throw new Error(`No help line found for ${optionFlag}`);
  return line;
}

const countDefaults = (text: string): number => (text.match(/default:/g) ?? []).length;

describe('kiro-history CLI', () => {
  it('--version prints the version from package.json', () => {
    const expected = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')).version;
    expect(runCli('--version').trim()).toBe(expected);
  }, CLI_TIMEOUT_MS);

  it('--help shows the --source default exactly once', () => {
    const line = helpOptionText('--source');
    expect(countDefaults(line)).toBe(1);
    expect(line).toContain(`"${DEFAULT_SOURCE}"`);
  }, CLI_TIMEOUT_MS);

  it('--help shows the --host default exactly once', () => {
    const line = helpOptionText('--host');
    expect(countDefaults(line)).toBe(1);
    expect(line).toContain(`"${DEFAULT_HOST}"`);
  }, CLI_TIMEOUT_MS);
});

// Runs the CLI with a throwaway HOME and resolves once it is serving or exits.
function startCli(home: string, ...args: string[]): Promise<{ output: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'server/cli.ts', '--no-open', ...args], {
      cwd: ROOT,
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });
    let output = '';
    const onData = (d: Buffer) => {
      output += d.toString();
      if (output.includes('Server running at:')) {
        child.kill();
        resolve({ output, exitCode: null });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => resolve({ output, exitCode: code }));
  });
}

function writeCliV2Session(home: string): void {
  const dir = join(home, '.kiro', 'sessions', 'cli');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 's1.json'), JSON.stringify({ session_id: 's1', cwd: '/p', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', title: 't' }));
  writeFileSync(join(dir, 's1.jsonl'), JSON.stringify({ kind: 'Prompt', data: { content: [{ kind: 'text', data: 'hi' }] } }));
}

function writeIdeV1Session(home: string): void {
  const dir = join(home, '.kiro', 'sessions', 'wshash', 'sess');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'session.json'), JSON.stringify({ id: 'i1', createdAt: '2026-01-01T00:00:00Z', lastModifiedAt: '2026-01-01T00:00:00Z' }));
  writeFileSync(join(dir, 'messages.jsonl'), JSON.stringify({ id: 'a', timestamp: 't', payload: { type: 'user', content: 'hi' } }));
}

describe('kiro-history CLI startup', () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'kiro-history-home-'));
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it('starts with only CLI V2 flat-file sessions (no database)', async () => {
    writeCliV2Session(home);
    const { output, exitCode } = await startCli(home);
    expect(exitCode).toBeNull();
    expect(output).toContain('Also found CLI V2 sessions');
  }, CLI_TIMEOUT_MS);

  it('starts with only v1.0 IDE sessions', async () => {
    writeIdeV1Session(home);
    const { output, exitCode } = await startCli(home, '-s', 'ide');
    expect(exitCode).toBeNull();
    expect(output).toContain('v1.0 IDE sessions');
  }, CLI_TIMEOUT_MS);

  it('exits with a clear error when no Kiro data exists', async () => {
    const { output, exitCode } = await startCli(home, '-s', 'cli');
    expect(exitCode).toBe(1);
    expect(output).toContain('No Kiro CLI data found');
  }, CLI_TIMEOUT_MS);

  it('reports a port that is already in use without a stack trace', async () => {
    writeCliV2Session(home);
    const blocker = createServer();
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', () => r()));
    const port = (blocker.address() as { port: number }).port;
    try {
      const { output, exitCode } = await startCli(home, '-p', String(port));
      expect(exitCode).toBe(1);
      expect(output).toContain(`Port ${port} is already in use`);
      expect(output).not.toContain('Unhandled');
    } finally {
      blocker.close();
    }
  }, CLI_TIMEOUT_MS);

  it.each([['-p', 'abc'], ['-p', '70000'], ['-p', '-1'], ['-s', 'bogus']])('rejects invalid option %s %s', async (flag, value) => {
    const { output, exitCode } = await startCli(home, `${flag}=${value}`);
    expect(exitCode).not.toBe(0);
    expect(exitCode).not.toBeNull();
    expect(output).toMatch(/error: option/i);
  }, CLI_TIMEOUT_MS);
});

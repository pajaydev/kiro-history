import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
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

const countDefaults = (text: string): number => (text.match(/\(default:/g) ?? []).length;

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

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';
import { readPackageVersion } from './version.js';

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

function writeTempPackageJson(content: string): URL {
  tempDir = mkdtempSync(join(tmpdir(), 'version-test-'));
  const file = join(tempDir, 'package.json');
  writeFileSync(file, content);
  return pathToFileURL(file);
}

describe('readPackageVersion', () => {
  it('returns the version from the real package.json', () => {
    const expected = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')).version;
    expect(readPackageVersion()).toBe(expected);
  });

  it('returns the version from a given package.json', () => {
    expect(readPackageVersion(writeTempPackageJson('{"version":"9.8.7"}'))).toBe('9.8.7');
  });

  it('throws when the version field is missing', () => {
    expect(() => readPackageVersion(writeTempPackageJson('{"name":"x"}'))).toThrow(/version/);
  });

  it('throws when the version field is empty', () => {
    expect(() => readPackageVersion(writeTempPackageJson('{"version":""}'))).toThrow(/version/);
  });
});

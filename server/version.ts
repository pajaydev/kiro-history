import { readFileSync } from 'fs';

// package.json sits one level above both dist/ (built) and server/ (tsx dev),
// and npm always ships it, so this path works for every way the CLI is run.
const PACKAGE_JSON_URL = new URL('../package.json', import.meta.url);

export function readPackageVersion(packageJsonUrl: URL = PACKAGE_JSON_URL): string {
  const pkg = JSON.parse(readFileSync(packageJsonUrl, 'utf-8')) as { version?: unknown };
  if (typeof pkg.version !== 'string' || pkg.version === '') {
    throw new Error(`No "version" field found in ${packageJsonUrl.pathname}`);
  }
  return pkg.version;
}

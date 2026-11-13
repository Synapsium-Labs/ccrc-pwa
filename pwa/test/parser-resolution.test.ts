// D-8288. pwa's typecheck (`tsc --noEmit`, the first half of `npm run build`) compiles the source-parsing suites,
// and they import the repository's one parser module, `server/test/scan/parse.ts`, which imports the pinned parser
// `typescript-api`. That package is installed in `server/node_modules` alone. A lane that builds pwa before it
// installs server (deploy.sh's server lane builds pwa locally and installs server only on the target) would stop on
// TS2307 "Cannot find module 'typescript-api'" before it ships anything.
//
// So pwa's tsconfig resolves `typescript-api` through `paths`: server's pinned copy first, and pwa's own `typescript`
// when server is not installed. This proves both halves with TypeScript's own module resolution over pwa's real
// compiler options, and pins that the fallback is the same parser release as the pin, so the two cannot type the
// suites differently.
//
// KNOWN WIDTH: types only. Running the suites (vitest) still loads `typescript-api` from `server/node_modules`, as
// every lane that runs them already installs server first.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ts } from '../../server/test/scan/parse';

const ROOT = path.join(import.meta.dirname, '..', '..');
const PWA = path.join(ROOT, 'pwa');
const PARSER_MODULE = path.join(ROOT, 'server', 'test', 'scan', 'parse.ts');
const SERVER_MODULES = path.join(ROOT, 'server', 'node_modules') + path.sep;

const pwaOptions = (): ts.CompilerOptions => {
  const file = path.join(PWA, 'tsconfig.json');
  const read = ts.readConfigFile(file, ts.sys.readFile);
  expect(read.error, 'pwa/tsconfig.json reads').toBeUndefined();
  return ts.parseJsonConfigFileContent(read.config, ts.sys, PWA, undefined, file).options;
};

/** pwa's resolution of the parser module's `typescript-api` import, optionally on a checkout with no server install. */
const resolveParser = (serverInstalled: boolean): string | undefined => {
  const hidden = (p: string): boolean => !serverInstalled && path.resolve(p).startsWith(SERVER_MODULES);
  const host: ts.ModuleResolutionHost = {
    fileExists: (p) => !hidden(p) && ts.sys.fileExists(p),
    readFile: (p) => (hidden(p) ? undefined : ts.sys.readFile(p)),
    directoryExists: (p) => !hidden(p + path.sep) && (ts.sys.directoryExists?.(p) ?? true),
    realpath: ts.sys.realpath,
    getCurrentDirectory: () => PWA,
  };
  return ts.resolveModuleName('typescript-api', PARSER_MODULE, pwaOptions(), host).resolvedModule?.resolvedFileName;
};

const lockedVersion = (pkg: string, name: string): string | undefined =>
  (JSON.parse(readFileSync(path.join(ROOT, pkg, 'package-lock.json'), 'utf8')) as {
    packages: Record<string, { version?: string }>;
  }).packages[`node_modules/${name}`]?.version;

describe('pwa typechecks the one parser module without a server install (D-8288)', () => {
  it('resolves typescript-api to server\'s pinned copy when server is installed', () => {
    const resolved = resolveParser(true);
    expect(resolved, 'typescript-api resolves').toBeDefined();
    expect(path.relative(ROOT, resolved!).split(path.sep).slice(0, 3)).toEqual(
      ['server', 'node_modules', 'typescript-api']);
  });

  it('falls back to pwa\'s own typescript when server/node_modules is absent', () => {
    const resolved = resolveParser(false);
    expect(resolved, 'typescript-api resolves with no server install').toBeDefined();
    expect(path.relative(ROOT, resolved!).split(path.sep).slice(0, 3)).toEqual(
      ['pwa', 'node_modules', 'typescript']);
  });

  it('the fallback is the same parser release as the pin', () => {
    const pin = lockedVersion('server', 'typescript-api');
    expect(pin, 'server/package-lock.json locks typescript-api').toBeDefined();
    expect(lockedVersion('pwa', 'typescript')).toBe(pin);
  });
});

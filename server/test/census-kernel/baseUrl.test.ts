// The endpoint gate's census (`census-kernel/baseUrl.ts`; D-7305, the 2026-10-29 consolidation TS/MJS kernel base-url
// plan, Task BU1), held two ways, as `consolidation-census.test.ts` holds its own: against a fixture tree, where every
// shape a query must see or skip is written out, and against the real tree. The REAL rows are CHARACTERIZATION rows,
// not ceilings: each pins the exact sorted list measured on the plan's base, so it reds on any change, up or down. A
// task whose change moves a list re-points that row in the same commit and names it in its Files. The ceilings land in
// `single-definition/roster-bash.test.ts` (BU2 onward).
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { mkTmp } from '../tmpHelpers.js';
import {
  DIFFERENT_QUESTIONS, differentQuestions, gateDefinitions, gateImporters, inlineGates, loopbackSets, verdictTypeDecls,
} from './baseUrl.js';

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });
function tree(files: Record<string, string>): string {
  const root = mkTmp('census-kernel-base-url-');
  roots.push(root);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  }
  return root;
}

const GATE_BODY = "(raw) => {\n  let u;\n  try { u = new URL(raw); } catch { return { ok: false }; }\n"
  + "  if (u.protocol === 'https:') return { ok: true, url: u.href };\n"
  + "  if (u.protocol === 'http:' && LOOPBACK_HOSTS.includes(u.hostname)) return { ok: true, url: u.href };\n"
  + "  return { ok: false };\n}";

describe('gateDefinitions — every const BASE_URL_OK, definitions and declarations apart (D-7305)', () => {
  it('fixture: a definition beside a declaration; a let, a comment and a reference are none', () => {
    const root = tree({
      'shared/base-url.mjs': `export const BASE_URL_OK = ${GATE_BODY};\n`,
      'shared/base-url.d.mts': 'export declare const BASE_URL_OK: (raw: unknown) => unknown;\n',
      'deploy/x.mjs': `const BASE_URL_OK = () => ({ ok: true, url: '' });\nexport { BASE_URL_OK };\n`,
      'server/src/other.ts': "// export const BASE_URL_OK = () => 1;\nlet BASE_URL_OK = 1;\nconst f = BASE_URL_OK;\n",
      // Outside the census roots: not seen.
      'server/test/fake.ts': 'export const BASE_URL_OK = () => 1;\n',
    });
    expect(gateDefinitions(root)).toEqual({
      definitions: ['deploy/x.mjs#BASE_URL_OK', 'shared/base-url.mjs#BASE_URL_OK'],
      declarations: ['shared/base-url.d.mts#BASE_URL_OK'],
    });
  });

  it('real tree: 2 definitions and 1 declaration (characterization)', () => {
    // Re-pointed in the move commit (D-7306): the title names the plan base's count; the one implementation is the
    // `.mjs`, and `shared/base-url.ts` re-exports it.
    expect(gateDefinitions()).toEqual({
      definitions: ['shared/base-url.mjs#BASE_URL_OK'],
      declarations: ['shared/base-url.d.mts#BASE_URL_OK'],
    });
  });
});

describe('loopbackSets — every array literal of exactly the three loopback hosts, in any order (D-7305)', () => {
  it('fixture: the set in two orders is two sites; a two-host array, a fourth element and a repeat are none', () => {
    const root = tree({
      'shared/a.mjs': "export const LOOPBACK_HOSTS = ['127.0.0.1', '[::1]', 'localhost'];\n",
      'shared/b.ts': "const HOSTS: readonly string[] = [\n  'localhost',\n  '127.0.0.1',\n  '[::1]',\n];\n",
      'server/src/c.ts': "export const TWO = ['127.0.0.1', 'localhost'];\n"
        + "export const FOUR = ['127.0.0.1', '[::1]', 'localhost', '0.0.0.0'];\n"
        + "export const REPEAT = ['127.0.0.1', '127.0.0.1', 'localhost'];\n"
        + "export function f(h) { return ['[::1]', 'localhost', '127.0.0.1'].includes(h); }\n",
      'server/test/d.ts': "export const OUT = ['127.0.0.1', '[::1]', 'localhost'];\n",
    });
    expect(loopbackSets(root)).toEqual(['server/src/c.ts#f', 'shared/a.mjs#LOOPBACK_HOSTS', 'shared/b.ts#HOSTS']);
  });

  it('real tree: 3 sets, one of them in another order (characterization)', () => {
    // Re-pointed in the move commit (D-7306): the title names the plan base's count; the `.ts` copy is gone.
    expect(loopbackSets()).toEqual(['shared/base-url.mjs#LOOPBACK_HOSTS', 'shared/models.mjs#LOOPBACK_HOSTS']);
  });
});

describe('verdictTypeDecls — the type aliases of BaseUrlRefusal and BaseUrlVerdict under shared/ (D-7305)', () => {
  it('fixture: a type alias in a .d.mts and in a .ts; an interface and an alias outside shared/ are none', () => {
    const root = tree({
      'shared/base-url.d.mts': "export type BaseUrlRefusal = 'a' | 'b';\nexport type BaseUrlVerdict = { ok: true };\n",
      'shared/base-url.ts': "type BaseUrlRefusal = 'a';\nexport interface BaseUrlVerdict { ok: true }\n",
      'server/src/x.ts': "export type BaseUrlVerdict = { ok: false };\n",
    });
    expect(verdictTypeDecls(root)).toEqual({
      BaseUrlRefusal: ['shared/base-url.d.mts', 'shared/base-url.ts'],
      BaseUrlVerdict: ['shared/base-url.d.mts'],
    });
  });

  it('real tree: each declared twice (characterization)', () => {
    // Re-pointed in the move commit (D-7307): the title names the plan base's count; `shared/base-url.d.mts` now
    // imports both types from the `.ts`.
    expect(verdictTypeDecls()).toEqual({
      BaseUrlRefusal: ['shared/base-url.ts'],
      BaseUrlVerdict: ['shared/base-url.ts'],
    });
  });
});

describe('inlineGates — functions outside the gate that admit http: only on a loopback host (D-7305)', () => {
  it('fixture: an inline gate beside an https-only function; the gate file itself and a commented URL are none', () => {
    const root = tree({
      'shared/base-url.mjs': `const LOOPBACK_HOSTS = ['127.0.0.1', '[::1]', 'localhost'];\nexport const BASE_URL_OK = ${GATE_BODY};\n`,
      'shared/models.mjs': "const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];\n"
        + "export function parseRegistry(raw) {\n  const parsed = new URL(raw);\n"
        + "  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && LOOPBACK_HOSTS.includes(parsed.hostname))) throw new Error('x');\n"
        + "  return raw;\n}\n"
        + "export function httpsOnly(raw) {\n  const u = new URL(raw);\n  if (u.protocol !== 'https:') return null;\n  return u.href;\n}\n",
      'server/src/web.ts': "export function hostOk(raw: string): boolean {\n  // new URL(raw)\n"
        + "  return raw.startsWith('http:') && raw.includes('localhost');\n}\n"
        + "export function literalGate(raw: string): boolean {\n  const u = new URL(raw);\n"
        + "  return u.protocol === 'http:' && u.hostname === '127.0.0.1';\n}\n",
    });
    expect(inlineGates(root)).toEqual({ gates: ['server/src/web.ts#literalGate', 'shared/models.mjs#parseRegistry'], apart: [] });
  });

  it('fixture: a DIFFERENT_QUESTIONS reader with the same shape is reported apart', () => {
    const root = tree({
      'server/src/accounts/gate.ts': "const isLoopbackHost = (h: string): boolean => h === 'localhost';\n"
        + "export function accountOriginClass(origin: string): string {\n  let url: URL;\n  try { url = new URL(origin); } catch { return 'insecure'; }\n"
        + "  if (url.protocol === 'http:' && isLoopbackHost(url.hostname)) return 'loopback';\n  return 'insecure';\n}\n",
    });
    expect(inlineGates(root)).toEqual({ gates: [], apart: ['server/src/accounts/gate.ts#accountOriginClass'] });
  });

  it('real tree: 1 inline gate, with 2 different-question readers apart (characterization)', () => {
    expect(inlineGates()).toEqual({
      gates: ['shared/models.mjs#parseRegistry'],
      apart: ['server/src/accounts/gate.ts#accountOriginClass', 'server/src/auth/webauthn.ts#originProblem'],
    });
  });
});

describe('differentQuestions — the readers that ask a different question, by name (D-7305)', () => {
  it('each entry carries a one-line reason', () => {
    for (const reason of Object.values(DIFFERENT_QUESTIONS)) {
      expect(reason.length).toBeGreaterThan(0);
      expect(reason).not.toContain('\n');
    }
  });

  it('fixture: a reader that is gone, or renamed, leaves the answer', () => {
    const root = tree({
      'server/src/accounts/gate.ts': 'export function accountOriginClass(o: string): string { return o; }\n',
      'server/src/auth/webauthn.ts': 'export function originProblemRenamed(o: string): string { return o; }\n',
    });
    expect(differentQuestions(root)).toEqual(['server/src/accounts/gate.ts#accountOriginClass']);
  });

  it('real tree: all three still exist (characterization; also at its target)', () => {
    expect(differentQuestions()).toEqual([
      'server/src/accounts/gate.ts#accountOriginClass',
      'server/src/auth/webauthn.ts#originProblem',
      'server/src/update/catalogue.ts#safeDownloadUrl',
    ]);
  });
});

describe('gateImporters — every import or re-export declaration of the gate, outside its own files (D-7305)', () => {
  it('fixture: each specifier kind, a file importing one specifier twice, and a gate file edge that is not counted', () => {
    const root = tree({
      'shared/base-url.ts': "export { BASE_URL_OK } from './base-url.mjs';\n",
      'shared/base-url.mjs': 'export const BASE_URL_OK = () => 1;\n',
      'shared/base-url.d.mts': "export type { BaseUrlVerdict } from './base-url.js';\n",
      'shared/roster.ts': "import { BASE_URL_OK } from './base-url.js';\nimport { LOOPBACK_HOSTS } from './base-url.js';\n",
      'deploy/op.mjs': "import { BASE_URL_OK } from '../shared/base-url.mjs';\n",
      'pwa/src/gate.ts': "import { LOOPBACK_HOSTS } from '../../shared/base-url';\n",
      'server/test/types.ts': "export type { BaseUrlVerdict } from '../../shared/base-url.js';\n",
      // Not the gate: a sibling whose name only starts the same, and a comment.
      'server/src/near.ts': "import { x } from '../../shared/base-url-extra.js';\n// import { y } from '../../shared/base-url.js';\n",
      'shared/base-url-extra.ts': 'export const x = 1;\n',
    });
    expect(gateImporters(root)).toEqual([
      { file: 'deploy/op.mjs', specifier: '../shared/base-url.mjs', resolves: 'shared/base-url.mjs' },
      { file: 'pwa/src/gate.ts', specifier: '../../shared/base-url', resolves: 'shared/base-url.ts', vite: 'shared/base-url.mjs' },
      { file: 'server/test/types.ts', specifier: '../../shared/base-url.js', resolves: 'shared/base-url.ts' },
      { file: 'shared/roster.ts', specifier: './base-url.js', resolves: 'shared/base-url.ts' },
      { file: 'shared/roster.ts', specifier: './base-url.js', resolves: 'shared/base-url.ts' },
    ]);
  });

  it('real tree: the ten sites in nine files (characterization)', () => {
    expect(gateImporters()).toEqual([
      { file: 'deploy/account-op.mjs', specifier: '../shared/base-url.mjs', resolves: 'shared/base-url.mjs' },
      { file: 'pwa/src/screens/settings/signInGate.ts', specifier: '../../../../shared/base-url', resolves: 'shared/base-url.ts', vite: 'shared/base-url.mjs' },
      { file: 'pwa/test/settings-screen.test.tsx', specifier: '../../shared/base-url', resolves: 'shared/base-url.ts', vite: 'shared/base-url.mjs' },
      { file: 'server/src/update/catalogue.ts', specifier: '../../../shared/base-url.js', resolves: 'shared/base-url.ts' },
      { file: 'server/test/base-url.test.ts', specifier: '../../shared/base-url.js', resolves: 'shared/base-url.ts' },
      { file: 'server/test/base-url.test.ts', specifier: '../../shared/base-url.mjs', resolves: 'shared/base-url.mjs' },
      { file: 'server/test/fixtures/baseUrlCases.ts', specifier: '../../../shared/base-url.js', resolves: 'shared/base-url.ts' },
      { file: 'server/test/update-catalogue.test.ts', specifier: '../../shared/base-url.js', resolves: 'shared/base-url.ts' },
      { file: 'shared/roster-json.mjs', specifier: './base-url.mjs', resolves: 'shared/base-url.mjs' },
      { file: 'shared/roster.ts', specifier: './base-url.js', resolves: 'shared/base-url.ts' },
    ]);
  });
});

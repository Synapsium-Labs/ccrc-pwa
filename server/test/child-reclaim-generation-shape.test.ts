// Child-reclamation wave 8 (spec §5.5): the grammar of a registry row's generation, `$REG/<id>.generation`, is
// declared ONCE in L0 as `REG_GENERATION_SHAPE` and held equal to ccd's own `_reg_generation_valid`. Bash cannot
// import TS, so two copies exist by construction; this file is the mechanism that keeps them one
// (`auto-continue-armed.test.ts`'s shape). It reads ccd's TEXT only: no ccd runs here, and no HOME is touched.
//
// The declaration is pinned BY NAME, never by its text: `NODE_ID_RE` (shared/agent-protocol.ts) carries the
// identical text for another concept, an update node's id. A text pin would red on it, or invite merging the two.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REG_GENERATION_SHAPE } from '../../shared/api.js';
import { NODE_ID_RE } from '../src/coord/store.js';
import { CCD } from './ccdWsHelpers.js';

const ccrcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** The four roots `single-definition.test.ts` scans, walked as it walks them: `__`-prefixed entries are a parallel
 *  suite's transient mutants, skipped for that file's reason. */
const ROOTS = ['shared', 'server/src', 'pwa/src', 'agent/src'].map((r) => path.join(ccrcRoot, r));
const sources = (dir: string): string[] => readdirSync(dir).flatMap((e) => {
  if (e.startsWith('__')) return [];
  const p = path.join(dir, e);
  if (statSync(p).isDirectory()) return sources(p);
  return /\.tsx?$/.test(p) ? [p] : [];
});
const ALL = ROOTS.flatMap(sources);
const rel = (p: string): string => path.relative(ccrcRoot, p);

/** The ONE `=~` regex inside ccd's `_reg_generation_valid`, as written there. */
const ccdGrammar = (): string => {
  const src = readFileSync(CCD, 'utf8');
  const at = src.indexOf('\n_reg_generation_valid() {');
  if (at < 0) throw new Error('_reg_generation_valid not found in ccd/ccd');
  const end = src.indexOf('\n}\n', at);
  if (end < 0) throw new Error('_reg_generation_valid has no closing brace');
  const found = [...src.slice(at, end).matchAll(/=~ (\S+) \]\]/g)];
  if (found.length !== 1) throw new Error(`expected one =~ in _reg_generation_valid, found ${found.length}`);
  return found[0]![1]!;
};

const BOM = String.fromCharCode(0xfeff);
const UUID = '0b6f8a1e-3c2d-4e5f-8a9b-0c1d2e3f4a5b';

describe('REG_GENERATION_SHAPE is ccd’s generation grammar (spec §5.5)', () => {
  it('its source is _reg_generation_valid’s regex text, verbatim, and it carries no flag', () => {
    expect(REG_GENERATION_SHAPE.source).toBe(ccdGrammar());
    expect(REG_GENERATION_SHAPE.flags, 'an m flag lets $ match before a newline; a g flag makes .test stateful')
      .toBe('');
  });

  it.each<readonly [string, string, boolean]>([
    ['accepts the 36 lowercase characters', UUID, true],
    ['refuses a trailing LF (ccd’s $ refuses it)', `${UUID}\n`, false],
    ['refuses a leading byte-order mark (a trim would strip it)', `${BOM}${UUID}`, false],
    ['refuses a leading space', ` ${UUID}`, false],
    ['refuses a trailing space', `${UUID} `, false],
    ['refuses a trailing NUL', `${UUID}\0`, false],
    ['refuses upper case', UUID.toUpperCase(), false],
    ['refuses 35 characters', UUID.slice(0, 35), false],
    ['refuses 37 characters', `${UUID}0`, false],
    ['refuses a value with no dashes', UUID.replace(/-/g, ''), false],
    ['refuses the empty string', '', false],
  ])('%s', (_label, v, ok) => {
    expect(REG_GENERATION_SHAPE.test(v)).toBe(ok);
  });

  it('a match is exactly 36 characters', () => {
    expect(UUID).toHaveLength(36);
    expect(REG_GENERATION_SHAPE.test(UUID)).toBe(true);
  });
});

describe('REG_GENERATION_SHAPE is declared once, by NAME (spec §5.5)', () => {
  it('the scan found the four source trees', () => {
    for (const r of ROOTS) expect(sources(r).length, rel(r)).toBeGreaterThan(0);
    expect(ALL.map(rel)).toContain('shared/api.ts');
  });

  it('is declared in shared/api.ts and nowhere else', () => {
    const DECL = /^\s*(?:export\s+)?(?:const|let|var)\s+REG_GENERATION_SHAPE\b/m;
    expect(DECL.test('const REG_GENERATION_SHAPE = /x/;'), 'CONTROL: a local copy is a declaration too').toBe(true);
    expect(ALL.filter((f) => DECL.test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['shared/api.ts']);
  });

  it('NODE_ID_RE stays its own concept: its own declaration, never this name', () => {
    // Its one declaration moved beside `NODE_FILES` in `shared/agent-protocol.ts` (accounts plan A8, D-5622), so the
    // agent's `account` op answers `fleetIdentity` in the same grammar; `store.ts` re-exports it.
    const proto = readFileSync(path.join(ccrcRoot, 'shared', 'agent-protocol.ts'), 'utf8');
    const store = readFileSync(path.join(ccrcRoot, 'server', 'src', 'coord', 'store.ts'), 'utf8');
    expect(proto).toMatch(/^export const NODE_ID_RE = \/\^/m);
    expect(store).toMatch(/^export \{ NODE_ID_RE \};$/m);
    for (const f of [proto, store]) expect(f, 'NODE_ID_RE merged into the generation grammar').not.toMatch(/NODE_ID_RE\s*=\s*REG_GENERATION_SHAPE|REG_GENERATION_SHAPE\s*=\s*NODE_ID_RE/);
    expect(store, 'store.ts must not merge NODE_ID_RE into the generation grammar').not.toContain('REG_GENERATION_SHAPE');
    expect(NODE_ID_RE).not.toBe(REG_GENERATION_SHAPE);
  });
});

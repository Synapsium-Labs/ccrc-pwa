/**
 * PR landing in ccrc, stage 1 (D-6785): the vocabulary and its detail grammars (`shared/landing.ts`), the two
 * switches, and `readPrLandingLine`. Every word is derived from one map; every grammar has one writer and one reader,
 * and the reader answers null for anything it does not know.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHECKS_MAIL_MAP, CHECKS_MAIL_TOKEN, CHECKS_MAIL_WORDS, CHECKS_MODES, CHECKS_MODE_MAP, LANDING_CHECKS_STUCK_MS,
  LANDING_KEBABS, LEFT_PHASES, LEFT_PHASE_MAP, REQUIRED_CHECKS_MAP, REQUIRED_CHECKS_PRECEDENCE, REQUIRED_CHECKS_WORDS,
  STUCK_CAUSES, STUCK_CAUSE_MAP, checksEndDetail, checksRowDetail, mergingAtDetail, readChecksRowDetail,
  readMergingAtDetail,
} from '../../shared/landing.js';
import { SWITCHES, readSwitches } from '../../shared/switches.js';
import { isLandingKebab } from '../src/coord/landing.js';
import { readPrLandingLine } from '../src/prstate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const HEAD = 'a'.repeat(40);
const FP = 'abcdef012345';

describe('the words are derived from their maps', () => {
  it('every word is derived from its map', () => {
    expect(REQUIRED_CHECKS_WORDS).toEqual(Object.keys(REQUIRED_CHECKS_MAP));
    expect(CHECKS_MAIL_WORDS).toEqual(Object.keys(CHECKS_MAIL_MAP));
    expect(STUCK_CAUSES).toEqual(Object.keys(STUCK_CAUSE_MAP));
    expect(LEFT_PHASES).toEqual(Object.keys(LEFT_PHASE_MAP));
    expect(CHECKS_MODES).toEqual(Object.keys(CHECKS_MODE_MAP));
    expect([...REQUIRED_CHECKS_WORDS].sort()).toEqual([...REQUIRED_CHECKS_PRECEDENCE].sort());
    for (const sentence of Object.values(REQUIRED_CHECKS_MAP)) expect(sentence.length).toBeGreaterThan(10);
  });
  it('the words, bound and token the plan names are exactly these', () => {
    expect(CHECKS_MAIL_WORDS).toEqual(['green', 'red', 'stuck', 'moved', 'left']);
    expect(STUCK_CAUSES).toEqual(['timeout', 'unmeasured', 'unverifiable', 'disabled']);
    expect(LEFT_PHASES).toEqual(['closed', 'draft', 'unbound', 'merged']);
    expect(CHECKS_MODES).toEqual(['live', 'shadow', 'off']);
    expect([...REQUIRED_CHECKS_WORDS].sort()).toEqual(['green', 'not-reported', 'pending', 'red', 'unmeasured', 'unverifiable']);
    expect(LANDING_CHECKS_STUCK_MS).toBe(45 * 60_000);
    expect(CHECKS_MAIL_TOKEN).toBe('checks-mail-v1');
  });
  it('the kebab guard accepts the hyphenated words and the two markers, and a typo is refused', () => {
    expect([...LANDING_KEBABS].sort()).toEqual(['branch-drift', 'not-reported', 'pr-unreadable']);
    for (const t of ['not-reported', 'pr-unreadable', 'branch-drift', 'landing-disabled', 'landing-checks-live']) {
      expect(isLandingKebab(t), t).toBe(true);
    }
    for (const t of ['not-reportd', 'landing-enabled', 'merging-episode']) expect(isLandingKebab(t), t).toBe(false);
  });
});

describe('merging-at: the transition row', () => {
  it('readMergingAtDetail(mergingAtDetail(h, pr, m)) round-trips', () => {
    for (const mode of CHECKS_MODES) {
      expect(readMergingAtDetail(mergingAtDetail(HEAD, 42, mode))).toEqual({ head: HEAD, pr: 42, mode });
    }
    expect(mergingAtDetail(HEAD, null, 'off')).toBe(`merging-at:${HEAD}:none:off`);
    expect(readMergingAtDetail(mergingAtDetail(HEAD, null, 'off'))).toEqual({ head: HEAD, pr: null, mode: 'off' });
  });
  it('a 39-hex head, an unknown mode, a pr of 0 or 07, and none with live or shadow read null', () => {
    expect(readMergingAtDetail(`merging-at:${'a'.repeat(39)}:42:live`)).toBeNull();
    expect(readMergingAtDetail(`merging-at:${'A'.repeat(40)}:42:live`)).toBeNull();
    expect(readMergingAtDetail(`merging-at:${HEAD}:42:armed`)).toBeNull();
    expect(readMergingAtDetail(`merging-at:${HEAD}:0:live`)).toBeNull();
    expect(readMergingAtDetail(`merging-at:${HEAD}:07:live`)).toBeNull();
    expect(readMergingAtDetail(`merging-at:${HEAD}:none:live`)).toBeNull();
    expect(readMergingAtDetail(`merging-at:${HEAD}:none:shadow`)).toBeNull();
    expect(readMergingAtDetail(`merging-at:${HEAD}:42`)).toBeNull();
    expect(readMergingAtDetail(`merging-at:${HEAD}:42:live:x`)).toBeNull();
    expect(readMergingAtDetail('something else')).toBeNull();
  });
  it('the writer refuses what the reader would', () => {
    expect(() => mergingAtDetail(HEAD, null, 'live')).toThrow();
    expect(() => mergingAtDetail(HEAD, 0, 'live')).toThrow();
    expect(() => mergingAtDetail('abc', 1, 'live')).toThrow();
  });
});

describe('landing:checks: the episode rows', () => {
  it('readChecksRowDetail round-trips every row, live and shadow', () => {
    for (const shadow of [false, true]) {
      const open = checksRowDetail(7, 0, 'open', undefined, shadow);
      expect(open).toBe(`${shadow ? 'landing-shadow' : 'landing'}:checks:7:0:open`);
      expect(readChecksRowDetail(open)).toEqual({ shadow, e: 7, gen: 0, what: 'open', fp: null, reading: null });
      for (const what of ['green', 'red'] as const) {
        expect(readChecksRowDetail(checksRowDetail(7, 3, what, FP, shadow)))
          .toEqual({ shadow, e: 7, gen: 3, what, fp: FP, reading: null });
      }
      for (const reading of ['unread', `pending@${FP}`, `not-reported@${FP}`, `unverifiable@${FP}`, `red@${FP}`]) {
        expect(readChecksRowDetail(checksRowDetail(7, 1, 'stuck', reading, shadow)))
          .toEqual({ shadow, e: 7, gen: 1, what: 'stuck', fp: null, reading });
      }
      for (const word of ['moved', 'left'] as const) {
        expect(readChecksRowDetail(checksEndDetail(7, word, shadow)))
          .toEqual({ shadow, e: 7, gen: null, what: word, fp: null, reading: null });
      }
    }
  });
  it('an unknown word, an e of 0, a gen of -1 or 1.5, a green with no @fp, an open with one, a stuck with no :reading and a stuck:green@fp read null', () => {
    const r = readChecksRowDetail;
    expect(r('landing:checks:7:0:amber@' + FP)).toBeNull();
    expect(r(`landing:checks:0:0:green@${FP}`)).toBeNull();
    expect(r(`landing:checks:07:0:green@${FP}`)).toBeNull();
    expect(r(`landing:checks:7:-1:green@${FP}`)).toBeNull();
    expect(r(`landing:checks:7:1.5:green@${FP}`)).toBeNull();
    expect(r('landing:checks:7:0:green')).toBeNull();
    expect(r(`landing:checks:7:0:green@${'f'.repeat(11)}`)).toBeNull();
    expect(r(`landing:checks:7:0:open@${FP}`)).toBeNull();
    expect(r('landing:checks:7:0:stuck')).toBeNull();
    expect(r(`landing:checks:7:0:stuck:green@${FP}`)).toBeNull();
    expect(r('landing:checks:7:0:stuck:pending')).toBeNull();
    expect(r('landing:checks:7:moved:x')).toBeNull();
    expect(r('landing:checks:7:merged')).toBeNull();
    expect(r('landing:checks:7')).toBeNull();
    expect(r('stall:checks:7:0:open')).toBeNull();
  });
  it('stuck:unread and stuck:pending@fp12 round-trip', () => {
    expect(readChecksRowDetail('landing:checks:9:2:stuck:unread')).toMatchObject({ what: 'stuck', reading: 'unread' });
    expect(readChecksRowDetail(`landing:checks:9:2:stuck:pending@${FP}`)).toMatchObject({ what: 'stuck', reading: `pending@${FP}` });
  });
  it('the writer refuses a row the reader would not read', () => {
    expect(() => checksRowDetail(0, 0, 'open')).toThrow();
    expect(() => checksRowDetail(1, -1, 'open')).toThrow();
    expect(() => checksRowDetail(1, 0, 'green')).toThrow();
    expect(() => checksRowDetail(1, 0, 'open', FP)).toThrow();
    expect(() => checksRowDetail(1, 0, 'stuck')).toThrow();
    expect(() => checksRowDetail(1, 0, 'stuck', 'green@' + FP)).toThrow();
  });
});

describe('the switches', () => {
  it('the two markers are SWITCHES rows with writer hand-only', () => {
    for (const m of ['landing-disabled', 'landing-checks-live'] as const) {
      expect(SWITCHES[m].writer).toBe('hand-only');
      expect(SWITCHES[m].owner).toBe('C4');
      expect(SWITCHES[m].storage).toEqual({ marker: m });
    }
    expect(readSwitches(['landing-checks-live'])).toMatchObject({ 'landing-checks-live': 'set', 'landing-disabled': 'clear' });
    expect(readSwitches(null)).toMatchObject({ 'landing-checks-live': 'unmeasurable', 'landing-disabled': 'unmeasurable' });
  });
  it('no file in the tree writes a landing-* marker', () => {
    const SKIP = new Set(['node_modules', '.git', 'dist', 'coverage']);
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        if (SKIP.has(name)) continue;
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!/\.(ts|mjs)$/.test(name) || full.includes(`${path.sep}test${path.sep}`)) continue;
        const text = readFileSync(full, 'utf8');
        if (/landing-(?:disabled|checks-live)|LANDING_(?:DISABLED|CHECKS_LIVE)_MARKER/.test(text)) hits.push(path.relative(root, full));
      }
    };
    for (const d of ['server/src', 'shared', 'agent/src']) walk(path.join(root, d));
    // The definer and the one L1 reader; a write verb beside the name in either would be a writer.
    expect(hits.sort()).toEqual(['server/src/coord/landing.ts', 'shared/switches.ts']);
    for (const f of hits) {
      expect(readFileSync(path.join(root, f), 'utf8'), f).not.toMatch(/\b(?:writeFile|appendFile|rename|unlink|mkdir|rm)(?:Sync)?\s*\(/);
    }
  });
  it('shared/landing.ts imports nothing', () => {
    const text = readFileSync(path.join(root, 'shared', 'landing.ts'), 'utf8');
    expect(text).not.toMatch(/^\s*import\b/m);
    expect(text).not.toMatch(/\brequire\s*\(|\bimport\s*\(/);
    expect(text).not.toMatch(/node:/);
  });
});

describe('readPrLandingLine, the one reader of pr-landing', () => {
  const good = {
    id: 'ws-a', bound: true, number: 42, state: 'OPEN', isDraft: false, base: 'main', head: HEAD,
    required: [{ name: 'build', appId: 15368, state: 'success', checkId: 9001, runId: 8001 },
      { name: 'lint', appId: null, state: 'pending', checkId: null, runId: null }],
    requiredCut: false, rulesNamed: ['build'], protectionNamed: [], unmeasured: [],
  };
  it('reads a bound line whole', () => {
    expect(readPrLandingLine(good)).toEqual({ ...good, pinnedNames: [] });
  });
  it('an alias with no object and a refusal keep their reasons and are unbound', () => {
    expect(readPrLandingLine({ id: 'ws-a', unmeasured: ['pr-unreadable'] }))
      .toMatchObject({ id: 'ws-a', bound: false, unmeasured: ['pr-unreadable'], required: [] });
    expect(readPrLandingLine({ id: 'ws-a', bound: false })).toMatchObject({ bound: false, unmeasured: [] });
  });
  it('a field it cannot follow reads as unmeasured, never as dropped', () => {
    expect(readPrLandingLine({ ...good, required: 'x' })?.unmeasured).toContain('shape');
    expect(readPrLandingLine({ ...good, required: [{ name: 'a', state: 3 }] })?.unmeasured).toContain('shape');
    expect(readPrLandingLine({ ...good, rulesNamed: [1] })?.unmeasured).toContain('shape');
    expect(readPrLandingLine({ ...good, number: 'x' })?.unmeasured).toContain('shape');
    expect(readPrLandingLine({ ...good, required: [{ name: 'a', state: 'success', checkId: -4 }] })?.unmeasured).toContain('shape');
  });
  it('null for anything with no id', () => {
    for (const v of [null, 3, 'x', [], {}, { id: '' }, { id: 4 }]) expect(readPrLandingLine(v)).toBeNull();
  });
});

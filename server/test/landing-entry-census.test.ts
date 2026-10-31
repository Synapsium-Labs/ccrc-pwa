// Landing order wave 5e: the landing line's entry has ONE writer. Keyed on symbols and call sites (`scan/symbols.ts`),
// never a literal source pin, so the store's growth ceiling is not touched. A later sub-wave that adds a writer of
// `landing_entries` adds it here by name.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { callsIn, inlinedSourceOf, parsedFile, sqlStatementsInFile, symbolOf, REPO_ROOT } from './scan/symbols.js';
import { walkSrc } from './rings/walkSrc.js';

const STORE = 'server/src/coord/store.ts';
const ROUTES = 'server/src/coord/routes.ts';
const WRITER = 'CoordStore.advanceLanding';
const ADVANCE_ACT = 'registerCoordRoutes.advanceAct';
const FILES = walkSrc({ roots: ['server/src'], min: 150 });
const inWriter = (q: { file: string; start: number }) => {
  const s = symbolOf(STORE, WRITER);
  return q.file.endsWith(STORE) && q.start >= s.start && q.start < s.end;
};
const writes = (re: RegExp) => FILES.flatMap((f) => sqlStatementsInFile(f))
  .filter((q) => ['INSERT', 'UPDATE', 'REPLACE'].includes(q.verb) && re.test(q.source));

describe('the landing line has one writer (landing order wave 5e, D-7614)', () => {
  it('pinnedSha has one writer, advanceLanding', () => {
    expect(writes(/\bpinnedSha\b/i).length).toBeGreaterThanOrEqual(2);
    expect(writes(/\bpinnedSha\b/i).filter((q) => !inWriter(q)).map((q) => `${q.file}:${q.text}`)).toEqual([]);
  });

  it('ejections has one writer, advanceLanding', () => {
    expect(writes(/\bejections\b/i).length).toBeGreaterThanOrEqual(1);
    expect(writes(/\bejections\b/i).filter((q) => !inWriter(q)).map((q) => `${q.file}:${q.text}`)).toEqual([]);
  });

  it('every write of landing_entries is advanceLanding\'s (5e; a later sub-wave adds its writer here by name)', () => {
    const all = FILES.flatMap((f) => sqlStatementsInFile(f))
      .filter((q) => q.table === 'landing_entries' && ['INSERT', 'UPDATE', 'REPLACE', 'DELETE'].includes(q.verb));
    expect(all.length).toBeGreaterThanOrEqual(3);
    expect(all.filter((q) => !inWriter(q)).map((q) => `${q.file}:${q.text}`)).toEqual([]);
  });

  it('the merging-at detail is built only inside advanceLanding', () => {
    const calls = FILES.flatMap((f) => parsedFile(f).calls.filter((c) => c.name === 'mergingAtDetail').map((c) => ({ file: f, start: c.start })));
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls.filter((q) => !inWriter(q))).toEqual([]);
  });

  it('advanceAct reaches the store through advanceLanding only', () => {
    const names = callsIn(symbolOf(ROUTES, ADVANCE_ACT)).map((c) => c.name);
    expect(names).toContain('advanceLanding');
    expect(names).not.toContain('advance');
  });

  it('advanceLanding has one caller, advanceAct', () => {
    const act = symbolOf(ROUTES, ADVANCE_ACT);
    const calls = FILES.flatMap((f) => parsedFile(f).calls.filter((c) => c.name === 'advanceLanding').map((c) => ({ file: f, start: c.start })));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.file.endsWith(ROUTES) && calls[0]!.start >= act.start && calls[0]!.start < act.end).toBe(true);
  });

  it('advanceLanding decides the edge before it writes, in one tx', () => {
    const src = inlinedSourceOf(symbolOf(STORE, WRITER));
    const at = (n: string) => { const i = src.indexOf(n); expect(i, n).toBeGreaterThan(-1); return i; };
    expect(at('transitionsFor(')).toBeLessThan(at('this.advanceInner('));
    expect(at('this.advanceInner(')).toBeLessThan(at('INSERT INTO landing_entries'));
    expect(src.split('tx(this.db').length - 1).toBe(1);
  });
});

describe('CLAUDE.md names the landing line among what a lost coord.db loses (D-7620)', () => {
  const flat = (s: string): string => s.replace(/\s+/g, ' ');
  const passage = (name: string, text: string, from: string, to: string): string => {
    const a = text.indexOf(from);
    expect(a, `${name}: the opening anchor is gone`).toBeGreaterThan(-1);
    const b = text.indexOf(to, a + from.length);
    expect(b, `${name}: the closing anchor is gone`).toBeGreaterThan(a);
    return flat(text.slice(a, b));
  };

  it('the coord.db bullet lists the landing line first', () => {
    const bullet = passage('the coord.db bullet', readFileSync(path.join(REPO_ROOT, 'CLAUDE.md'), 'utf8'),
      'what it adds on top', 'is gone without the snapshot');
    expect(bullet).toContain('what it adds on top — the landing line, mail, claims');
  });
});

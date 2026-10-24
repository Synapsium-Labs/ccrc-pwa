// ARCH-30 (#544): the PWA's poll primitive and wire-guard kit have ONE owner each.
//  (1) `isRecord`, `isNum`, `isCount`, `isOneOf` (and the old `isObject`) are defined only in `pwa/src/lib/wire.ts`.
//      Five copies had disagreed on what a count is, and 2^53 + 1 passed the loosest.
//  (2) No `pwa/src/fleet/` file subscribes to `visibilitychange`: a fleet view re-polls through `lib/usePoll.ts`, the
//      one file that holds that subscription for the fleet views.
import { describe, expect, it } from 'vitest';
import { parseFile, parseSource, type ParsedFile } from '../scan/parse.js';
import { REPO, walkSrc } from './walkSrc.js';
import path from 'node:path';

const GUARDS = new Set(['isRecord', 'isObject', 'isNum', 'isCount', 'isOneOf']);
const WIRE = 'pwa/src/lib/wire.ts';
const POLL = 'pwa/src/lib/usePoll.ts';

const guardDefinitions = (p: ParsedFile): string[] => p.symbols.filter((s) => GUARDS.has(s.name)).map((s) => s.name);
const visibilitySubscriptions = (p: ParsedFile): number =>
  p.calls.filter((c) => c.name === 'addEventListener' && c.args[0]?.kind === 'string' && c.args[0].text === 'visibilitychange').length;

const parse = (file: string): ParsedFile => parseFile(path.join(REPO, file));
const files = (): string[] => walkSrc({ roots: ['pwa/src'], min: 200 });

describe('the PWA poll primitive and wire-guard kit have one owner (ARCH-30, #544)', () => {
  it('CONTROL: the predicates see a const arrow, a function declaration and an addEventListener call', () => {
    expect(guardDefinitions(parseSource('const isRecord = (v: unknown): boolean => !!v;'))).toEqual(['isRecord']);
    expect(guardDefinitions(parseSource('function isCount(v: unknown): boolean { return !!v; }'))).toEqual(['isCount']);
    expect(guardDefinitions(parseSource('const isOther = (v: unknown): boolean => !!v;'))).toEqual([]);
    expect(visibilitySubscriptions(parseSource("document.addEventListener('visibilitychange', f);"))).toBe(1);
    expect(visibilitySubscriptions(parseSource("document.addEventListener('click', f);"))).toBe(0);
  });

  it('the guard kit is defined in lib/wire.ts and nowhere else in pwa/src', () => {
    const where: Record<string, string[]> = {};
    for (const f of files()) {
      const defs = guardDefinitions(parse(f));
      if (defs.length > 0) where[f] = defs;
    }
    expect(Object.keys(where)).toEqual([WIRE]);
    expect(where[WIRE]?.sort()).toEqual(['isCount', 'isNum', 'isOneOf', 'isRecord']);
  });

  it('no pwa/src/fleet file subscribes to visibilitychange, and usePoll holds that subscription', () => {
    const fleet = files().filter((f) => f.startsWith('pwa/src/fleet/'));
    expect(fleet.length).toBeGreaterThan(20);
    expect(fleet.filter((f) => visibilitySubscriptions(parse(f)) > 0)).toEqual([]);
    expect(visibilitySubscriptions(parse(POLL))).toBe(1);
  });
});

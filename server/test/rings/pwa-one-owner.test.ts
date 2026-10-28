// ARCH-30 (#544): the PWA's poll primitive and wire-guard kit have ONE owner each.
//  (1) `isRecord`, `isNum`, `isCount`, `isOneOf` (and the old `isObject`) are defined only in `pwa/src/lib/wire.ts`.
//      Five copies had disagreed on what a count is, and 2^53 + 1 passed the loosest.
//  (2) No `pwa/src/fleet/` file subscribes to `visibilitychange`: a fleet view re-polls through `lib/usePoll.ts`, the
//      one file that holds that subscription for the fleet views.
import { describe, expect, it } from 'vitest';
import { parseFile, parseSource, type ParsedFile } from '../scan/parse.js';
import { REPO, walkSrc } from './walkSrc.js';
import { accountsReaders, dialogSheetStates, requestPolls } from '../census-w7/pwa.js';
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

// D-7180 (ARCH-28, #540; W7 C7b): `GET /api/accounts` has one reader, the fleet store (#1720, D-6440), and the two
// hand-written request polls #1720 left (`HotFilesStrip`, `useFleetHealth`, C7m's) may only go. Read through W7's
// census (`census-w7/pwa.ts`), so the sites are the syntax tree's, never a text match.
describe('the PWA reads /api/accounts in one place (D-7180, ARCH-28 #540)', () => {
  it('api.accounts is called only in stores/fleet.ts, once', () => {
    expect(accountsReaders().map((s) => s.file)).toEqual(['pwa/src/stores/fleet.ts']);
  });

  it('the hand-written request polls may only go: at most HotFilesStrip\'s and useFleetHealth\'s', () => {
    const polls = requestPolls();
    expect(polls.length).toBeLessThanOrEqual(2);
    expect(polls.filter((s) => s.file !== 'pwa/src/fleet/HotFilesStrip.tsx' && s.file !== 'pwa/src/fleet/useFleetHealth.ts')).toEqual([]);
  });
});

// ─── C7e (D-7183; ARCH-29 #542): one answer reducer ────────────────────────────────────────────────────────────────
// `DialogSheet`'s answer lifecycle lives in `pwa/src/session/answerLifecycle.ts`: the in-flight trio (answering, tabbing,
// denying), the dismissal trio (dismissedKey, dismissedDialogId, dismissedScreen), the own-words draft and the
// multiSelect set are its state. Three `useState` calls stay in the component, all view state that sends nothing:
// `otherFor` (which Other field is open), `focusNonce` (a focus request) and `raiseMark` (R106's raise rule, decided in
// render). The ceiling may only go down (spec §5.1 rule 3).
const DIALOG_SHEET_VIEW_STATES = ['otherFor', 'focusNonce', 'raiseMark'] as const;

describe('DialogSheet holds only its three view states; the answer lifecycle holds the rest (C7e, D-7183)', () => {
  it('dialogSheetStates() 11 -> 3: otherFor, focusNonce and raiseMark', () => {
    const sites = dialogSheetStates();
    expect(sites.length).toBeLessThanOrEqual(DIALOG_SHEET_VIEW_STATES.length);
    expect(sites.map((s) => DIALOG_SHEET_VIEW_STATES.find((n) => new RegExp(`\\[\\s*${n}\\s*,`).test(s.text)) ?? s.text).sort())
      .toEqual([...DIALOG_SHEET_VIEW_STATES].sort());
  });
});

// ARCH-30 (#544): the PWA's poll primitive and wire-guard kit have ONE owner each.
//  (1) `isRecord`, `isNum`, `isCount`, `isOneOf` (and the old `isObject`) are defined only in `pwa/src/lib/wire.ts`.
//      Five copies had disagreed on what a count is, and 2^53 + 1 passed the loosest.
//  (2) No `pwa/src/fleet/` file subscribes to `visibilitychange`: a fleet view re-polls through `lib/usePoll.ts`, the
//      one file that holds that subscription for the fleet views.
//  (3) ARCH-49: no `status === 'dead'` outside `pwa/src/fleet/presence.ts`, and no `coordPresence` (the block at the end).
import { describe, expect, it } from 'vitest';
import { parseFile, parseSource, type ParsedFile } from '../scan/parse.js';
import { REPO, walkSrc } from './walkSrc.js';
import { DEAD_CHECK_OWNER, accountsReaders, answerPaths, coordPresenceSites, dialogSheetStates, inlineDeadChecks, inlineDeadChecksIn, requestPolls, transcriptCopyRules } from '../census-w7/pwa.js';
import path from 'node:path';
import { fixture, singleReaders, singleReadersIn } from '../census-w7/pwa.js';

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

  // Step 8's other ratchet: one answer path, the reducer's performer (`performAnswer`). `push-sw.js`'s request is its
  // generated region (OA-C17 (a), D-7265), so a hand-written `/ask` fetch beside it, or a sheet writing on its own, reds.
  it('answerPaths() 3 -> 1: only the answer lifecycle', () => {
    expect(answerPaths().map((s) => [s.file, s.kind])).toEqual([['pwa/src/session/answerLifecycle.ts', 'reducer']]);
  });
});

// C7q (D-7212; plan 2026-10-27-consolidation-w7-pwa.md): the transcript copy's reading and a usable question envelope
// have one definition each, in `shared/ask-menu.ts`, read by the PWA's `askSource` and the server's pairing alike. The
// ratchet holds each rule at 1 (`census-w7/pwa.ts#transcriptCopyRules`); a second copy on either side reds it.
describe('the transcript copy and usability rules have one owner (C7q, D-7212)', () => {
  it('transcriptCopyRules(): 1 copy reading and 1 usable-envelope test, both in shared/ask-menu.ts', () => {
    const sites = transcriptCopyRules();
    expect(sites.filter((s) => s.kind === 'copy').map((s) => s.file)).toEqual(['shared/ask-menu.ts']);
    expect(sites.filter((s) => s.kind === 'usable').map((s) => s.file)).toEqual(['shared/ask-menu.ts']);
  });
});

// C7n (D-7192, D-7209; ARCH-75 #810): the fleet reads have one reader each. `GET /api/feed` is the fleet store's
// (`refreshFeed()`, which the Inbox calls on every open, and the connect-time read share it), `GET /api/runs?closed=1`
// is `useColdRuns.ts#loadColdRuns` (the run board's default and the Inbox's), and `GET /api/projects` is
// `useProjectRows.ts#loadProjects` (the fleet screen's plane, New session and Start programme's default). Calls and
// member references count alike (`census-w7/pwa.ts#singleReaders`), so a default parameter `= api.projects` is a
// second reader. The counts may only stay at 1.
describe('the PWA reads the feed, the closed runs and the projects in one place each (C7n, D-7192)', () => {
  it('CONTROL: a default parameter that hands a member on is a reader, as a call is', () => {
    const src = 'export function S({ loadProjects = api.projects }) {}\nexport const f = () => api.feed(100);\n';
    expect(singleReadersIn(fixture(src), 'pwa/src/fixture.tsx').map((s) => s.kind)).toEqual(['projects:reference', 'feed:call']);
  });

  it('singleReaders(): feed 2 -> 1, cold runs 2 -> 1, project loaders 3 -> 1 (calls and member references)', () => {
    const sites = singleReaders();
    expect(sites.map((s) => [s.file, s.symbol, s.kind])).toEqual([
      ['pwa/src/fleet/useProjectRows.ts', 'loadProjects', 'projects:call'],
      ['pwa/src/screens/useColdRuns.ts', 'loadColdRuns', 'runs:call'],
      ['pwa/src/stores/fleet.ts', 'createFleetStore', 'feed:call'],
    ]);
  });
});

// ARCH-49 (#784; W7 Task C7c, D-7181): whether a session is there is read in ONE place, `pwa/src/fleet/presence.ts`
// (`presenceOf`, `coordinatorPresence` and the pane predicate `paneGone`, OA-C15 (a), D-7265). The ratchet counts the
// census-w7 queries: a `status` compared with `'dead'` outside that file (16 on W7's base), and `coordPresence`, the
// client-side coordinator ladder C7c deleted (1 definition and 3 calls on the base). May only shrink.
describe('the PWA reads a session\'s presence through fleet/presence.ts (ARCH-49, #784)', () => {
  it('CONTROL: an inline dead check counts outside the owner and not inside it', () => {
    const text = "export const gone = (s: S): boolean => s.status === 'dead';";
    expect(inlineDeadChecksIn(parseSource(text, 'pwa/src/fleet/other.ts'), 'pwa/src/fleet/other.ts')).toHaveLength(1);
    expect(inlineDeadChecksIn(parseSource(text, DEAD_CHECK_OWNER), DEAD_CHECK_OWNER)).toEqual([]);
  });

  it('no status === \'dead\' outside fleet/presence.ts', () => {
    expect(inlineDeadChecks().map((s) => s.file)).toEqual([]);
  });

  it('coordPresence is gone: no definition and no call in pwa/src', () => {
    expect(coordPresenceSites()).toEqual([]);
  });
});

// C7f (D-7184; ARCH-58 #793, the PWA half): the envelope pairing has one owner, the server (`server/src/pane/askPairing.ts`,
// attached to the frames by `sessionws.ts#paired`). The PWA reads the frames' `pairing` (`stores/session.ts`, read by
// `askLive.ts#pairingFor`) and defines none of the client pairing's nine names. Read through W7's census
// (`census-w7/pwa.ts#clientPairingDefinitions`, whose FIXTURE row reds a definition), imported in the block so the file's
// header imports stay as other tasks append to them. May only stay at 0.
describe('the envelope pairing has one owner, the server (C7f, D-7184)', () => {
  it('clientPairingDefinitions() 9 -> 0: no PWA source defines a client pairing name', async () => {
    const { clientPairingDefinitions } = await import('../census-w7/pwa.js');
    expect(clientPairingDefinitions().map((s) => `${s.file}#${s.symbol}`)).toEqual([]);
  });

  it('the server\'s port defines the pairing the PWA gave up, in pane/askPairing.ts', async () => {
    const { CLIENT_PAIRING_NAMES } = await import('../census-w7/pwa.js');
    const port = parse('server/src/pane/askPairing.ts');
    const names = new Set([...port.symbols.map((s) => s.name), ...port.bindings.map((b) => b.name)]);
    const ported = CLIENT_PAIRING_NAMES.filter((n) => n !== 'prefixMatches' && n !== 'norm');
    expect(ported.filter((n) => !names.has(n))).toEqual([]);
    expect(names.has('framePairing')).toBe(true);
  });
});

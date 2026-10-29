// ARCH-30 (#544): the PWA's poll primitive and wire-guard kit have ONE owner each.
//  (1) `isRecord`, `isNum`, `isCount`, `isOneOf` (and the old `isObject`) are defined only in `pwa/src/lib/wire.ts`.
//      Five copies had disagreed on what a count is, and 2^53 + 1 passed the loosest.
//  (2) No `pwa/src` file but the page clock, `lib/pageClock.ts`, subscribes to `visibilitychange` or `online` (D-7191,
//      W7 C7m): a view, hook or store that acts on the page turning visible or hidden, or coming back online, goes
//      through the clock (a fleet view through `lib/usePoll.ts`, which re-imports it).
//  (3) ARCH-49: no `status === 'dead'` outside `pwa/src/fleet/presence.ts`, and no `coordPresence` (the block at the end).
import { describe, expect, it } from 'vitest';
import { parseFile, parseSource, type ParsedFile } from '../scan/parse.js';
import { REPO, walkSrc } from './walkSrc.js';
import { DEAD_CHECK_OWNER, accountsReaders, answerPaths, coordPresenceSites, dialogSheetStates, inlineDeadChecks, inlineDeadChecksIn, requestPolls, transcriptCopyRules } from '../census-w7/pwa.js';
import path from 'node:path';
import { fixture, singleReaders, singleReadersIn } from '../census-w7/pwa.js';

const GUARDS = new Set(['isRecord', 'isObject', 'isNum', 'isCount', 'isOneOf']);
const WIRE = 'pwa/src/lib/wire.ts';
const POLL = 'pwa/src/lib/pageClock.ts';

const guardDefinitions = (p: ParsedFile): string[] => p.symbols.filter((s) => GUARDS.has(s.name)).map((s) => s.name);
const visibilitySubscriptions = (p: ParsedFile): number =>
  p.calls.filter((c) => c.name === 'addEventListener' && c.args[0]?.kind === 'string' && c.args[0].text === 'visibilitychange').length;
const PAGE_CLOCK_EVENTS = new Set(['visibilitychange', 'online']);
const pageClockSubscriptions = (p: ParsedFile): number =>
  p.calls.filter((c) => c.name === 'addEventListener' && c.args[0]?.kind === 'string' && PAGE_CLOCK_EVENTS.has(c.args[0].text)).length;

const parse = (file: string): ParsedFile => parseFile(path.join(REPO, file));
const files = (): string[] => walkSrc({ roots: ['pwa/src'], min: 200 });

describe('the PWA poll primitive and wire-guard kit have one owner (ARCH-30, #544)', () => {
  it('CONTROL: the predicates see a const arrow, a function declaration and an addEventListener call', () => {
    expect(guardDefinitions(parseSource('const isRecord = (v: unknown): boolean => !!v;'))).toEqual(['isRecord']);
    expect(guardDefinitions(parseSource('function isCount(v: unknown): boolean { return !!v; }'))).toEqual(['isCount']);
    expect(guardDefinitions(parseSource('const isOther = (v: unknown): boolean => !!v;'))).toEqual([]);
    expect(visibilitySubscriptions(parseSource("document.addEventListener('visibilitychange', f);"))).toBe(1);
    expect(visibilitySubscriptions(parseSource("document.addEventListener('click', f);"))).toBe(0);
    expect(pageClockSubscriptions(parseSource("window.addEventListener('online', f); document.addEventListener('visibilitychange', g);"))).toBe(2);
    expect(pageClockSubscriptions(parseSource("window.addEventListener('pagehide', f);"))).toBe(0);
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

  it('no pwa/src file but lib/pageClock.ts subscribes to visibilitychange or online', () => {
    const all = files();
    expect(all.filter((f) => f.startsWith('pwa/src/fleet/')).length).toBeGreaterThan(20);
    const where: Record<string, number> = {};
    for (const f of all) {
      const n = pageClockSubscriptions(parse(f));
      if (n > 0) where[f] = n;
    }
    expect(where).toEqual({ [POLL]: 2 });
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

// ─── C7m (D-7191; ARCH-75 #810): one page clock, and no hand-written request poll ─────────────────────────────────
// Read through W7's census (`census-w7/pwa.ts#pageClockSubscriptions` and `#requestPolls`), so the sites are the
// syntax tree's: `visibilitychange` 10 → 1 and `online` 2 → 1, both in `lib/pageClock.ts`; hand-written request polls
// 2 → 0 (`HotFilesStrip` and `useFleetHealth` poll through `usePoll`). Each may only go down (spec §5.1 rule 3).
describe('the PWA has one page clock and no hand-written request poll (C7m, D-7191)', () => {
  it('pageClockSubscriptions(): one visibilitychange and one online subscription, both in lib/pageClock.ts', async () => {
    const { pageClockSubscriptions: clockSites } = await import('../census-w7/pwa.js');
    expect(clockSites().map((s) => [s.file, s.kind])).toEqual([
      ['pwa/src/lib/pageClock.ts', 'visibilitychange'],
      ['pwa/src/lib/pageClock.ts', 'online'],
    ]);
  });

  it('requestPolls(): no hand-written request poll is left in pwa/src', () => {
    expect(requestPolls()).toEqual([]);
  });
});

// ─── C7i (D-7187; ARCH-64 #799, the PWA half; OA-C16 (a), D-7265) ─────────────────────────────────────────────────
// The PWA makes one pane-text decision of its own, `showsPrompt`, and it is LEGITIMATELY DIFFERENT: it renders the PTY
// the drawer shows (the wrapped view offers the grid when no prompt glyph shows), it decides nothing sent, and the
// server has no fact for it. The compaction fold is the server's flag (`foldsAway` reads `ChatEvent`'s `compaction`,
// `COMPACTION_RE` is gone). Claude Code's prompt glyph has one spelling, `shared/pane-glyph.ts`, which the drawer's view
// and the server's dialog parser import. Read through W7's census (`census-w7/pwa.ts#paneTextDecisions`,
// `#promptGlyphSpellings`, whose FIXTURE rows red a definition or a spelling), imported in the block so the file's
// header imports stay as other tasks append to them. Each may only go down (spec §5.1 rule 3).
describe('the PWA folds on the server\'s compaction flag, and the prompt glyph has one spelling (C7i, D-7187)', () => {
  const GLYPH = 'shared/pane-glyph.ts';

  it('paneTextDecisions() 2 -> 1: only showsPrompt, named, in session/drawerView.ts', async () => {
    const { paneTextDecisions } = await import('../census-w7/pwa.js');
    expect(paneTextDecisions().map((s) => `${s.file}#${s.symbol}`)).toEqual(['pwa/src/session/drawerView.ts#showsPrompt']);
  });

  it('promptGlyphSpellings() 2 -> 1: the glyph is spelled once, in shared/pane-glyph.ts', async () => {
    const { promptGlyphSpellings } = await import('../census-w7/pwa.js');
    expect(promptGlyphSpellings().map((s) => s.file)).toEqual([GLYPH]);
  });

  it('the drawer\'s view and the dialog parser both import PROMPT_GLYPH from shared/pane-glyph.ts', () => {
    for (const file of ['pwa/src/session/drawerView.ts', 'server/src/pane/dialog.ts']) {
      const from = parse(file).imports
        .filter((i) => i.kind === 'import' && !i.typeOnly && i.names.includes('PROMPT_GLYPH'))
        .map((i) => path.posix.normalize(path.posix.join(path.posix.dirname(file), i.specifier)).replace(/\.js$/, '.ts').replace(/^(?!.*\.ts$)(.*)$/, '$1.ts'));
      expect(from, file).toEqual([GLYPH]);
    }
  });
});

// ─── C7d (D-7182, D-7205, D-7207, D-7214; ARCH-61 #796, the PWA half; spec K10) ──────────────────────────────────
// The PWA reads which run is a session's from the wire (`FleetSession.run`, `.openRun`, through `sessionRunOf`): no
// `pwa/src` file compares a run's `sessionId` or `claimedBy` with a session id, or keys a session map on one, outside
// the named readers in `fleet/runWords.ts` (`workerOf`, `coordinatorOf`, `claimedRunsOf`, `boundOpenRun`, and `runCard`,
// the card lookup). Inside them the by-id lookups are named and counted: `workerOf`'s one (its closed-run arm, D-7205),
// `runCard`'s two (D-7205) and `coordinatorOf`'s one (D-7207). `childRunsSeen` stays a named reader of the `.child` mark
// (D-7214). The guess (`runForSession`, `runBelongsTo`) is gone, and the palette's order is the fleet tree's. Read
// through W7's census (`census-w7/pwa.ts#runMatchers`, whose FIXTURE rows red a matcher and a named lookup), imported in
// the block so the file's header imports stay as other tasks append to them. Each count may only go down.
describe('the PWA reads the run binding from the wire (C7d, D-7182)', () => {
  const site = (s: { file: string; symbol: string }): string => `${s.file}#${s.symbol}`;

  it('runMatchers(): 0 inline comparisons, 0 map lookups and 0 runForSession calls outside the named readers', async () => {
    const { runMatchers } = await import('../census-w7/pwa.js');
    const inline = runMatchers().filter((s) => s.kind === 'comparison' || s.kind === 'lookup' || s.kind === 'runForSession');
    expect(inline.map((s) => `${site(s)} ${s.text}`)).toEqual([]);
  });

  it('the named by-id lookups: 4, workerOf\'s closed-run arm and runCard\'s two (D-7205), coordinatorOf\'s one (D-7207); may only shrink', async () => {
    const { runMatchers } = await import('../census-w7/pwa.js');
    const named = runMatchers().filter((s) => s.kind === 'named').map(site);
    expect(named.length).toBeLessThanOrEqual(4);
    expect(named.sort()).toEqual([
      'pwa/src/fleet/runWords.ts#coordinatorOf', 'pwa/src/fleet/runWords.ts#runCard', 'pwa/src/fleet/runWords.ts#runCard',
      'pwa/src/fleet/runWords.ts#workerOf',
    ]);
  });

  it('childRunsSeen: 1 call, a named reader of the .child mark (D-7214), in useColdRuns; may only shrink', async () => {
    const { runMatchers } = await import('../census-w7/pwa.js');
    const calls = runMatchers().filter((s) => s.kind === 'childRunsSeen').map(site);
    expect(calls.length).toBeLessThanOrEqual(1);
    expect(calls).toEqual(['pwa/src/screens/useColdRuns.ts#useColdRuns']);
  });

  it('runForSession and runBelongsTo: 0 definitions in pwa/src', () => {
    const defs = files().flatMap((f) => parse(f).symbols.filter((s) => ['runForSession', 'runBelongsTo'].includes(s.name.split('.').pop()!)).map((s) => `${f}#${s.name}`));
    expect(defs).toEqual([]);
  });

  it('fleetOrder calls fleetTree, and composes no order of its own (no groupFleet or nestFleet call)', async () => {
    const { enclosingSymbol } = await import('../census-w7/pwa.js');
    const p = parse('pwa/src/command/commands.ts');
    const inOrder = p.calls.filter((c) => enclosingSymbol(p, c.start).split('.')[0] === 'fleetOrder').map((c) => c.name);
    expect(inOrder).toContain('fleetTree');
    expect(inOrder.filter((n) => n === 'groupFleet' || n === 'nestFleet')).toEqual([]);
  });

  it('CONTROL: the census reports an inline matcher, a named lookup and a runForSession call where it sees one', async () => {
    const { fixture, runMatchersIn } = await import('../census-w7/pwa.js');
    const kinds = (text: string, file: string): string[] => runMatchersIn(fixture(text, file), file).map((s) => s.kind);
    expect(kinds('export const f = (r: R, s: S) => r.claimedBy === s.id;', 'pwa/src/command/sessionEntries.ts')).toEqual(['comparison']);
    expect(kinds('export function workerOf(run: R, m: M) { return m.get(run.sessionId); }', 'pwa/src/fleet/runWords.ts')).toEqual(['named']);
    expect(kinds('export const g = (runs: R[], s: S) => runForSession(runs, s);', 'pwa/src/fleet/x.ts')).toEqual(['runForSession']);
  });
});

// C7j (D-7188, OA-C14 (a), D-7265): one bucket order, `shared/api.ts#BUCKET_RANK` (and `BUCKET_ORDER`, computed from
// it), which every surface that orders buckets reads: `sortFleet.ts#RANK`, `BucketBar` and `statusGroups.ts`'s status
// table. Read through W7's census (`census-w7/pwa.ts#bucketOrders`, whose FIXTURE row reds a numeric rank and an
// `order:` table), imported in the block.
describe('the buckets read in one order, shared/api.ts#BUCKET_RANK (C7j, D-7188)', () => {
  it('bucketOrders(): 1 (from 2), BUCKET_RANK in shared/api.ts; may only shrink', async () => {
    const { bucketOrders } = await import('../census-w7/pwa.js');
    const sites = bucketOrders().map((s) => `${s.file}#${s.symbol}`);
    expect(sites.length).toBeLessThanOrEqual(1);
    expect(sites).toEqual(['shared/api.ts#BUCKET_RANK']);
  });
});

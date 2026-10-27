// Each PWA dead-check site's verdict over the liveness truth table, beside the server's presence (D-7179; Task C7a
// Step 4; plan docs/superpowers/plans/2026-10-27-consolidation-w7-pwa.md, items 2 and 20; ARCH-49). Written green on
// the old code, before C7c moves any site: the table is the input OA-C15 is ruled on.
//
// THE ROWS are `presenceTable.ts#tableRows`: every row the server can produce (pane live × the live lifecycles, pane
// gone and pane unknown × the not-live lifecycles, each × hibernation stamp × substrate fault, as `assembleFleet` sends
// them), the four registry facts the frame never lists (the session is simply not in it), and the skew row (pane gone,
// lifecycle absent, which only a server older than ARCH-48 sends, with no `presence` either: it reads `unknown`, spec
// §5.1 rule 1c, so it is never a `differs` row to be ruled). The server's `presence` for each row is the table's
// ladder, which `server/test/w7-presence-parity.test.ts` holds equal to `readSession` and to `assembleFleet`.
//
// THE SITES are the 16 `inlineDeadChecks()` sites (census-w7) and the 3 `coordPresenceSites()` callers, each read
// through its own code: a pure site by calling it, a rendered one by rendering it and reading the door or word that
// its check decides. Each site's verdict is a short word, and beside it the verdict the site WOULD give reading the
// server's presence: by default the same site over the row's twin whose `status` is `'dead'` exactly when the presence
// is `dead` (the literal move, `status === 'dead'` read as `presence === 'dead'`); `hibernatedSince` over
// `presence === 'asleep'`; and the coordinator readers over `coordPresence`'s four words read from the presence
// (`asleep` is its `hibernated`, an absent presence `unknown`). A row is SAME when the two agree and DIFFERS when not.
//
// THE SNAPSHOT-REVIVED ROWS (item 20): each server row through `lib/offline.ts#saveFleetSnapshot` and
// `loadFleetSnapshot` (so through `reviveFleetSession`), each site's verdict on the revived row equal to its verdict on
// the live row. Green on the base, where the sites read the revived `status`; after C7c it stays green only because
// its Step 2c keeps `presence`. The pre-deploy snapshot row (a revived row with no `presence` key) is printed apart.
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { createElement } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import type { AccountUsage, FleetSession, Presence, RunSummary } from '../../shared/api';
import { fleetSession } from './fleetFixture';
import { TEST_ROSTER } from './rosterFixture';
import { tableRows, type TableRow } from './presenceTable';
import { ArchiveAllConfirm } from '../src/fleet/ArchiveAllPlane';
import { SessionActionsSheet } from '../src/fleet/SessionActionsSheet';
import { coordPresence, type CoordPresence } from '../src/fleet/coordWords';
import { groupFleet } from '../src/fleet/groupFleet';
import { hibernatedSince } from '../src/fleet/hibernated';
import { sessionFacts } from '../src/fleet/sessionFacts';
import { spawnChip } from '../src/fleet/spawnWords';
import { liveIdsIn, liveMainCheckoutIn, startedSessionFor } from '../src/fleet/startProgramPolicy';
import { orphanNote } from '../src/fleet/orphanWords';
import { RunRow } from '../src/screens/RunRow';
import { AccountsScreen } from '../src/screens/AccountsScreen';
import { useFleetStore } from '../src/stores/fleet';
import { api } from '../src/lib/api';
import { loadFleetSnapshot, saveFleetSnapshot } from '../src/lib/offline';

const ID = 'session-a';
const NOW = 1_784_600_000_000;

/** The row's fleet session, with a site's own fields over it (the parts its check reads beside the dead check). */
const sessionOf = (r: TableRow, over: Partial<FleetSession> = {}): FleetSession => fleetSession({
  id: ID, project: 'project-a', workdir: '/w/project-a', ...r.session!, ...(r.presence === undefined ? {} : { presence: r.presence }), ...over,
});

/** The twin: the same row with `status` reading the presence (`'dead'` exactly when the server's presence is `dead`). */
const twin = (s: FleetSession): FleetSession => ({ ...s, status: s.presence === 'dead' ? 'dead' : s.status === 'dead' ? 'idle' : s.status });

const COORD_WORD: Record<Presence, CoordPresence> = { alive: 'alive', asleep: 'hibernated', dead: 'dead', unknown: 'unknown' };
const coordWordOf = (p: Presence | undefined): CoordPresence => (p === undefined ? 'unknown' : COORD_WORD[p]);

const RUN = (over: Partial<RunSummary> = {}): RunSummary => ({
  id: 7, program: 'program-a', programTitle: 'Program A', wave: 1, waveOf: 2, project: 'project-a', homeProject: null,
  sessionId: 'worker-a', workspace: 'worker-a', branch: 'ws/worker-a', state: 'working', kind: 'work', reviews: null,
  claimedBy: ID, resumed: false, clearedAt: null, openedAt: 1, dispatchStartedAt: null, dispatchedAt: 1, closedAt: null,
  handoffCommit: null, items: { done: 0, total: 1 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null, briefQueued: true, clearError: null, coordKickoffPendingSince: null },
  childReclaim: null, reviewCap: null, ...over,
});
const WORKER = (): FleetSession => fleetSession({ id: 'worker-a', project: 'project-a', workspace: 'worker-a', workdir: '/w/worker-a' });

const has = (text: string): boolean => document.body.textContent?.includes(text) ?? false;

/** One site: how to build its row's session, its verdict there, and (when not the twin) its presence reading. */
interface Site {
  readonly name: string;
  readonly build: (r: TableRow) => FleetSession;
  readonly verdict: (s: FleetSession) => string | Promise<string>;
  readonly fromPresence?: (s: FleetSession, p: Presence | undefined) => string | Promise<string>;
  /** A coordinator reader has a verdict on a row the frame does not list (its coordinator is simply not there). */
  readonly unlisted?: (r: TableRow) => string;
  /** Fields `reviveFleetSession` writes as null by design (a tick's measurement, never persisted): the revived row is
   *  compared with the live row as the snapshot can carry it. */
  readonly snapshotNulls?: readonly (keyof FleetSession)[];
}

const sheetFetch = (): void => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(
    String(url).includes('/api/accounts') ? JSON.stringify({ accounts: [], projected: null, roster: TEST_ROSTER }) : '{}',
    { status: 200, headers: { 'content-type': 'application/json' } },
  )));
};

/** Render the actions sheet over `s` and read which of its six dead-checked lines show. */
const sheet = (s: FleetSession, text: string): string => {
  sheetFetch();
  render(createElement(SessionActionsSheet, { session: s, open: true, onClose: () => {}, onReap: () => {} }));
  const shown = has(text);
  cleanup();
  vi.unstubAllGlobals();
  return shown ? 'shown' : 'hidden';
};
const SHEET_A: Partial<FleetSession> = { workspace: null, limits: { five: 90, seven: null }, spawnState: 'narrow', paneCols: null, wrapper: 'lane-b', home: 'lane-a' };
const SHEET_B: Partial<FleetSession> = { ...SHEET_A, paneCols: 220 };

const SITES: readonly Site[] = [
  { name: 'ArchiveAllPlane.tsx#ArchiveAllConfirm (live panes counted)',
    build: (r) => sessionOf(r, { workspace: 'ws-a', releasedFrom: { runId: 1, program: 'program-a', programTitle: null, claimedBy: 'coord-a', closedAt: 1, child: false } }),
    verdict: (s) => {
      render(createElement(ArchiveAllConfirm, { project: 'project-a', sessions: [s], onClose: () => {}, onConfirm: () => {} }));
      const live = has('1 of them still has a live pane') ? 'live' : has('0 of them still have a live pane') ? 'not-live' : 'none';
      cleanup();
      return live;
    } },
  { name: 'SessionActionsSheet.tsx (critical limit line)', build: (r) => sessionOf(r, SHEET_A), verdict: (s) => sheet(s, 'limit near — this session will move to another account') },
  { name: 'SessionActionsSheet.tsx (narrow spawn note, pane live)', build: (r) => sessionOf(r, SHEET_A), verdict: (s) => sheet(s, 'keeps auto-swap and auto-compact off') },
  { name: 'SessionActionsSheet.tsx (narrow spawn widened note)', build: (r) => sessionOf(r, SHEET_B), verdict: (s) => sheet(s, 'The pane has since been widened'), snapshotNulls: ['paneCols'] },
  { name: 'SessionActionsSheet.tsx (narrow spawn, pane gone note)', build: (r) => sessionOf(r, SHEET_A), verdict: (s) => sheet(s, 'and that pane is gone') },
  { name: 'SessionActionsSheet.tsx (Forget session door)', build: (r) => sessionOf(r, SHEET_A), verdict: (s) => sheet(s, 'Forget session…') },
  { name: 'SessionActionsSheet.tsx (moved-account note)', build: (r) => sessionOf(r, SHEET_A), verdict: (s) => sheet(s, 'moved when its account filled up') },
  { name: 'coordWords.ts#coordPresence', build: (r) => sessionOf(r),
    verdict: (s) => coordPresence(s.id, s, true), fromPresence: (_s, p) => coordWordOf(p), unlisted: () => coordPresence(ID, null, true) },
  { name: 'groupFleet.ts#groupFleet (stranded count)', build: (r) => sessionOf(r, { workspace: 'ws-a', stranded: { at: 1, reason: 'no account' } }),
    verdict: (s) => String(groupFleet([s], ['project-a'])[0]?.stranded ?? 'no-group') },
  { name: 'hibernated.ts#hibernatedSince', build: (r) => sessionOf(r),
    verdict: (s) => String(hibernatedSince(s)), fromPresence: (s, p) => String(p === 'asleep' ? s.hibernatedAt : null) },
  { name: 'fleet/sessionFacts.ts#sessionFacts (dead)', build: (r) => sessionOf(r), verdict: (s) => String(sessionFacts({ session: s, now: NOW }).dead) },
  { name: 'spawnWords.ts#silentAboutSpawn (through spawnChip)', build: (r) => sessionOf(r, { started: false }), verdict: (s) => spawnChip(s)?.word ?? 'silent' },
  { name: 'startProgramPolicy.ts#liveMainCheckoutIn', build: (r) => sessionOf(r, { workspace: null }), verdict: (s) => (liveMainCheckoutIn([s], 'project-a') === null ? 'none' : 'found') },
  { name: 'startProgramPolicy.ts#startedSessionFor', build: (r) => sessionOf(r, { workspace: null }), verdict: (s) => (startedSessionFor([s], s.wrapper, 'project-a', new Set()) === null ? 'none' : 'found') },
  { name: 'startProgramPolicy.ts#liveIdsIn', build: (r) => sessionOf(r), verdict: (s) => (liveIdsIn([s]).has(ID) ? 'live' : 'not-live') },
  { name: 'AccountsScreen.tsx#AccountsScreen (sessions on this account)', build: (r) => sessionOf(r, { workspace: 'ws-a', wrapper: 'claude', home: 'claude', name: 'session-a' }),
    verdict: async (s) => {
      const acct: AccountUsage = { wrapper: 'claude', five: 0, seven: 0, ts: Math.floor(Date.now() / 1000) - 60, fiveResetAt: null, sevenResetAt: null, fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false };
      const spy = vi.spyOn(api, 'accounts').mockResolvedValue({ accounts: [acct], projected: null, roster: TEST_ROSTER });
      act(() => useFleetStore.setState({ sessions: [s] }));
      render(createElement(AccountsScreen));
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      const listed = document.querySelector('.accounts-session') !== null ? 'listed' : 'not-listed';
      cleanup();
      spy.mockRestore();
      act(() => useFleetStore.setState({ sessions: [] }));
      return listed;
    } },
  // The three coordPresence callers: the row is the COORDINATOR; the worker is a live row it claims.
  { name: 'orphanWords.ts#orphanNote (coordPresence caller)', build: (r) => sessionOf(r),
    verdict: (s) => orphanNote({ kind: 'session', depth: 0, session: WORKER() }, [RUN()], 'project-a', [], (id) => (id === s.id ? s : null), true)?.presence ?? 'no-note',
    fromPresence: (_s, p) => coordWordOf(p),
    unlisted: () => orphanNote({ kind: 'session', depth: 0, session: WORKER() }, [RUN()], 'project-a', [], () => null, true)?.presence ?? 'no-note' },
  { name: 'RunRow.tsx (coordPresence caller: the Resume door)', build: (r) => sessionOf(r),
    verdict: (s) => resumeDoor(s, coordPresence(s.id, s, true)),
    fromPresence: (_s, p) => (coordWordOf(p) === 'dead' ? 'resume' : 'none'),
    unlisted: () => resumeDoor(null, 'n/a') },
  // SessionScreen's call is `coordPresence(parentId, lookup(parentId), fleetFrameSeen)` (census-w7 holds its text), and
  // its header reads the answer through `sessionFacts`' `orphan`: the caller is read through that one fact.
  { name: 'SessionScreen.tsx#SessionScreen (coordPresence caller: the header orphan fact)', build: (r) => sessionOf(r),
    verdict: (s) => String(sessionFacts({ session: WORKER(), now: NOW, coordinator: coordPresence(s.id, s, true) }).orphan),
    fromPresence: (_s, p) => String(sessionFacts({ session: WORKER(), now: NOW, coordinator: coordWordOf(p) }).orphan),
    unlisted: () => String(sessionFacts({ session: WORKER(), now: NOW, coordinator: coordPresence(ID, null, true) }).orphan) },
];

/** RunRow's Resume door for a run this row claims; `n/a` asks the row with no coordinator in the frame. */
function resumeDoor(coord: FleetSession | null, _word: string): string {
  render(createElement('ul', null, createElement(RunRow, {
    run: RUN(), nowMs: NOW, session: WORKER(), coordSession: coord, frameSeen: true, programHasOpenRun: true,
    onAbandon: () => {}, onResume: () => {}, loadSpend: async () => ({ measured: false }) as never,
  })));
  const shown = document.querySelector('.run-resume') !== null ? 'resume' : 'none';
  cleanup();
  return shown;
}

interface Cell { readonly row: TableRow; readonly verdict: string; readonly presenceReading: string }
const results = new Map<string, Cell[]>();

beforeAll(async () => {
  for (const site of SITES) {
    const cells: Cell[] = [];
    for (const row of tableRows()) {
      if (row.session === null) {
        const v = site.unlisted === undefined ? '-' : site.unlisted(row);
        const p = site.unlisted === undefined ? '-' : site.fromPresence === undefined ? '-' : await site.fromPresence(fleetSession(), row.presence);
        cells.push({ row, verdict: v, presenceReading: p });
        continue;
      }
      const s = site.build(row);
      const verdict = await site.verdict(s);
      const presenceReading = site.fromPresence === undefined ? await site.verdict(twin(s)) : await site.fromPresence(s, row.presence);
      cells.push({ row, verdict, presenceReading });
    }
    results.set(site.name, cells);
  }
}, 120_000);

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
afterAll(() => {
  // The table OA-C15 is ruled on, printed in its groups: the server-producible rows, the unlisted registry facts, the skew row.
  for (const [name, cells] of results) {
    const differs = cells.filter((c) => c.verdict !== c.presenceReading);
    console.log(`w7-presence-table ${name}: ${cells.length - differs.length} same, ${differs.length} differs`);
    for (const group of ['server', 'unlisted', 'skew'] as const) {
      for (const c of differs.filter((d) => d.row.group === group)) {
        console.log(`  [${group}] differs  ${c.row.name}: site ${c.verdict}, presence ${String(c.row.presence)} -> ${c.presenceReading}`);
      }
    }
  }
});

type Pin<T> = Record<string, { server: T; unlisted: T; skew: T }>;
// The pins, written from the old code's run (C7a). A SAME site's vector stays byte-identical through C7c Step 4; a
// DIFFERS row changes only in C7c Step 6, under OA-C15's ruling, with its before/after in that PR body.
const VERDICTS: Pin<string> = {
  'ArchiveAllPlane.tsx#ArchiveAllConfirm (live panes counted)': {
    server: 'live live live live live live live live live live live live live live live live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live',
    unlisted: '- - - -', skew: 'not-live',
  },
  'SessionActionsSheet.tsx (critical limit line)': {
    server: 'shown shown shown shown shown shown shown shown shown shown shown shown shown shown shown shown hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden',
    unlisted: '- - - -', skew: 'hidden',
  },
  'SessionActionsSheet.tsx (narrow spawn note, pane live)': {
    server: 'shown shown shown shown shown shown shown shown shown shown shown shown shown shown shown shown hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden',
    unlisted: '- - - -', skew: 'hidden',
  },
  'SessionActionsSheet.tsx (narrow spawn widened note)': {
    server: 'shown shown shown shown shown shown shown shown shown shown shown shown shown shown shown shown hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden',
    unlisted: '- - - -', skew: 'hidden',
  },
  'SessionActionsSheet.tsx (narrow spawn, pane gone note)': {
    server: 'hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden shown shown hidden hidden shown shown hidden hidden shown shown hidden hidden shown shown hidden hidden shown shown hidden hidden shown shown hidden hidden shown shown hidden hidden shown shown hidden hidden shown shown hidden hidden shown shown hidden hidden',
    unlisted: '- - - -', skew: 'shown',
  },
  'SessionActionsSheet.tsx (Forget session door)': {
    server: 'hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden shown shown hidden hidden shown shown hidden hidden shown shown hidden hidden shown shown hidden hidden shown shown hidden hidden shown shown hidden hidden shown shown hidden hidden shown shown hidden hidden shown shown hidden hidden shown shown hidden hidden',
    unlisted: '- - - -', skew: 'shown',
  },
  'SessionActionsSheet.tsx (moved-account note)': {
    server: 'shown shown shown shown shown shown shown shown shown shown shown shown shown shown shown shown hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden hidden',
    unlisted: '- - - -', skew: 'hidden',
  },
  'coordWords.ts#coordPresence': {
    server: 'alive unknown alive unknown alive unknown alive unknown alive unknown alive unknown unknown unknown unknown unknown dead unknown hibernated unknown alive unknown hibernated unknown dead unknown hibernated unknown dead unknown hibernated unknown unknown unknown unknown unknown dead unknown hibernated unknown alive unknown hibernated unknown dead unknown hibernated unknown dead unknown hibernated unknown unknown unknown unknown unknown',
    unlisted: 'unknown unknown unknown unknown', skew: 'unknown',
  },
  'groupFleet.ts#groupFleet (stranded count)': {
    server: '1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0',
    unlisted: '- - - -', skew: '0',
  },
  'hibernated.ts#hibernatedSince': {
    server: 'null null null null null null null null null null null null null null null null null null 1784500000000 1784500000000 null null 1784500000000 1784500000000 null null 1784500000000 1784500000000 null null 1784500000000 1784500000000 null null 1784500000000 1784500000000 null null 1784500000000 1784500000000 null null 1784500000000 1784500000000 null null 1784500000000 1784500000000 null null 1784500000000 1784500000000 null null 1784500000000 1784500000000',
    unlisted: '- - - -', skew: 'null',
  },
  'fleet/sessionFacts.ts#sessionFacts (dead)': {
    server: 'false false false false false false false false false false false false false false false false true true true true true true true true true true true true true true true true true true true true true true true true true true true true true true true true true true true true true true true true',
    unlisted: '- - - -', skew: 'true',
  },
  'spawnWords.ts#silentAboutSpawn (through spawnChip)': {
    server: 'unstarted unstarted unstarted unstarted unstarted unstarted unstarted unstarted unstarted unstarted unstarted unstarted unstarted unstarted unstarted unstarted silent silent silent silent silent silent silent silent silent silent silent silent silent silent silent silent silent silent silent silent silent silent silent silent silent silent silent silent silent silent silent silent silent silent silent silent silent silent silent silent',
    unlisted: '- - - -', skew: 'silent',
  },
  'startProgramPolicy.ts#liveMainCheckoutIn': {
    server: 'found found found found found found found found found found found found found found found found none none none none none none none none none none none none none none none none none none none none none none none none none none none none none none none none none none none none none none none none',
    unlisted: '- - - -', skew: 'none',
  },
  'startProgramPolicy.ts#startedSessionFor': {
    server: 'found found found found found found found found found found found found found found found found none none none none none none none none none none none none none none none none none none none none none none none none none none none none none none none none none none none none none none none none',
    unlisted: '- - - -', skew: 'none',
  },
  'startProgramPolicy.ts#liveIdsIn': {
    server: 'live live live live live live live live live live live live live live live live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live not-live',
    unlisted: '- - - -', skew: 'not-live',
  },
  'AccountsScreen.tsx#AccountsScreen (sessions on this account)': {
    server: 'listed listed listed listed listed listed listed listed listed listed listed listed listed listed listed listed not-listed not-listed not-listed not-listed not-listed not-listed not-listed not-listed not-listed not-listed not-listed not-listed not-listed not-listed not-listed not-listed not-listed not-listed not-listed not-listed not-listed not-listed not-listed not-listed not-listed not-listed not-listed not-listed not-listed not-listed not-listed not-listed not-listed not-listed not-listed not-listed not-listed not-listed not-listed not-listed',
    unlisted: '- - - -', skew: 'not-listed',
  },
  'orphanWords.ts#orphanNote (coordPresence caller)': {
    server: 'alive unknown alive unknown alive unknown alive unknown alive unknown alive unknown unknown unknown unknown unknown dead unknown hibernated unknown alive unknown hibernated unknown dead unknown hibernated unknown dead unknown hibernated unknown unknown unknown unknown unknown dead unknown hibernated unknown alive unknown hibernated unknown dead unknown hibernated unknown dead unknown hibernated unknown unknown unknown unknown unknown',
    unlisted: 'unknown unknown unknown unknown', skew: 'unknown',
  },
  'RunRow.tsx (coordPresence caller: the Resume door)': {
    server: 'none none none none none none none none none none none none none none none none resume none none none none none none none resume none none none resume none none none none none none none resume none none none none none none none resume none none none resume none none none none none none none',
    unlisted: 'none none none none', skew: 'none',
  },
  'SessionScreen.tsx#SessionScreen (coordPresence caller: the header orphan fact)': {
    server: 'null null null null null null null null null null null null null null null null gone null hibernated null null null hibernated null gone null hibernated null gone null hibernated null null null null null gone null hibernated null null null hibernated null gone null hibernated null gone null hibernated null null null null null',
    unlisted: 'null null null null', skew: 'null',
  },
};

const DIFFERS: Pin<string[]> = {
  'ArchiveAllPlane.tsx#ArchiveAllConfirm (live panes counted)': {
    server: [
      'pane gone · stopped · hibernated',
      'pane gone · stopped · hibernated · substrate fault',
      'pane gone · restarting',
      'pane gone · restarting · substrate fault',
      'pane gone · restarting · hibernated',
      'pane gone · restarting · hibernated · substrate fault',
      'pane gone · unmeasurable',
      'pane gone · unmeasurable · substrate fault',
      'pane gone · unmeasurable · hibernated',
      'pane gone · unmeasurable · hibernated · substrate fault',
      'pane unknown · stopped',
      'pane unknown · stopped · substrate fault',
      'pane unknown · stopped · hibernated',
      'pane unknown · stopped · hibernated · substrate fault',
      'pane unknown · restarting',
      'pane unknown · restarting · substrate fault',
      'pane unknown · restarting · hibernated',
      'pane unknown · restarting · hibernated · substrate fault',
      'pane unknown · orphan',
      'pane unknown · orphan · substrate fault',
      'pane unknown · orphan · hibernated',
      'pane unknown · orphan · hibernated · substrate fault',
      'pane unknown · never-started',
      'pane unknown · never-started · substrate fault',
      'pane unknown · never-started · hibernated',
      'pane unknown · never-started · hibernated · substrate fault',
      'pane unknown · unmeasurable',
      'pane unknown · unmeasurable · substrate fault',
      'pane unknown · unmeasurable · hibernated',
      'pane unknown · unmeasurable · hibernated · substrate fault',
    ],
    unlisted: [],
    skew: ['skew · pane gone · lifecycle absent (a server older than ARCH-48)'],
  },
  'SessionActionsSheet.tsx (critical limit line)': {
    server: [
      'pane gone · stopped · hibernated',
      'pane gone · stopped · hibernated · substrate fault',
      'pane gone · restarting',
      'pane gone · restarting · substrate fault',
      'pane gone · restarting · hibernated',
      'pane gone · restarting · hibernated · substrate fault',
      'pane gone · unmeasurable',
      'pane gone · unmeasurable · substrate fault',
      'pane gone · unmeasurable · hibernated',
      'pane gone · unmeasurable · hibernated · substrate fault',
      'pane unknown · stopped',
      'pane unknown · stopped · substrate fault',
      'pane unknown · stopped · hibernated',
      'pane unknown · stopped · hibernated · substrate fault',
      'pane unknown · restarting',
      'pane unknown · restarting · substrate fault',
      'pane unknown · restarting · hibernated',
      'pane unknown · restarting · hibernated · substrate fault',
      'pane unknown · orphan',
      'pane unknown · orphan · substrate fault',
      'pane unknown · orphan · hibernated',
      'pane unknown · orphan · hibernated · substrate fault',
      'pane unknown · never-started',
      'pane unknown · never-started · substrate fault',
      'pane unknown · never-started · hibernated',
      'pane unknown · never-started · hibernated · substrate fault',
      'pane unknown · unmeasurable',
      'pane unknown · unmeasurable · substrate fault',
      'pane unknown · unmeasurable · hibernated',
      'pane unknown · unmeasurable · hibernated · substrate fault',
    ],
    unlisted: [],
    skew: ['skew · pane gone · lifecycle absent (a server older than ARCH-48)'],
  },
  'SessionActionsSheet.tsx (narrow spawn note, pane live)': {
    server: [
      'pane gone · stopped · hibernated',
      'pane gone · stopped · hibernated · substrate fault',
      'pane gone · restarting',
      'pane gone · restarting · substrate fault',
      'pane gone · restarting · hibernated',
      'pane gone · restarting · hibernated · substrate fault',
      'pane gone · unmeasurable',
      'pane gone · unmeasurable · substrate fault',
      'pane gone · unmeasurable · hibernated',
      'pane gone · unmeasurable · hibernated · substrate fault',
      'pane unknown · stopped',
      'pane unknown · stopped · substrate fault',
      'pane unknown · stopped · hibernated',
      'pane unknown · stopped · hibernated · substrate fault',
      'pane unknown · restarting',
      'pane unknown · restarting · substrate fault',
      'pane unknown · restarting · hibernated',
      'pane unknown · restarting · hibernated · substrate fault',
      'pane unknown · orphan',
      'pane unknown · orphan · substrate fault',
      'pane unknown · orphan · hibernated',
      'pane unknown · orphan · hibernated · substrate fault',
      'pane unknown · never-started',
      'pane unknown · never-started · substrate fault',
      'pane unknown · never-started · hibernated',
      'pane unknown · never-started · hibernated · substrate fault',
      'pane unknown · unmeasurable',
      'pane unknown · unmeasurable · substrate fault',
      'pane unknown · unmeasurable · hibernated',
      'pane unknown · unmeasurable · hibernated · substrate fault',
    ],
    unlisted: [],
    skew: ['skew · pane gone · lifecycle absent (a server older than ARCH-48)'],
  },
  'SessionActionsSheet.tsx (narrow spawn widened note)': {
    server: [
      'pane gone · stopped · hibernated',
      'pane gone · stopped · hibernated · substrate fault',
      'pane gone · restarting',
      'pane gone · restarting · substrate fault',
      'pane gone · restarting · hibernated',
      'pane gone · restarting · hibernated · substrate fault',
      'pane gone · unmeasurable',
      'pane gone · unmeasurable · substrate fault',
      'pane gone · unmeasurable · hibernated',
      'pane gone · unmeasurable · hibernated · substrate fault',
      'pane unknown · stopped',
      'pane unknown · stopped · substrate fault',
      'pane unknown · stopped · hibernated',
      'pane unknown · stopped · hibernated · substrate fault',
      'pane unknown · restarting',
      'pane unknown · restarting · substrate fault',
      'pane unknown · restarting · hibernated',
      'pane unknown · restarting · hibernated · substrate fault',
      'pane unknown · orphan',
      'pane unknown · orphan · substrate fault',
      'pane unknown · orphan · hibernated',
      'pane unknown · orphan · hibernated · substrate fault',
      'pane unknown · never-started',
      'pane unknown · never-started · substrate fault',
      'pane unknown · never-started · hibernated',
      'pane unknown · never-started · hibernated · substrate fault',
      'pane unknown · unmeasurable',
      'pane unknown · unmeasurable · substrate fault',
      'pane unknown · unmeasurable · hibernated',
      'pane unknown · unmeasurable · hibernated · substrate fault',
    ],
    unlisted: [],
    skew: ['skew · pane gone · lifecycle absent (a server older than ARCH-48)'],
  },
  'SessionActionsSheet.tsx (narrow spawn, pane gone note)': {
    server: [
      'pane gone · restarting',
      'pane gone · restarting · substrate fault',
      'pane gone · unmeasurable',
      'pane gone · unmeasurable · substrate fault',
      'pane unknown · stopped',
      'pane unknown · stopped · substrate fault',
      'pane unknown · restarting',
      'pane unknown · restarting · substrate fault',
      'pane unknown · orphan',
      'pane unknown · orphan · substrate fault',
      'pane unknown · never-started',
      'pane unknown · never-started · substrate fault',
      'pane unknown · unmeasurable',
      'pane unknown · unmeasurable · substrate fault',
    ],
    unlisted: [],
    skew: ['skew · pane gone · lifecycle absent (a server older than ARCH-48)'],
  },
  'SessionActionsSheet.tsx (Forget session door)': {
    server: [
      'pane gone · restarting',
      'pane gone · restarting · substrate fault',
      'pane gone · unmeasurable',
      'pane gone · unmeasurable · substrate fault',
      'pane unknown · stopped',
      'pane unknown · stopped · substrate fault',
      'pane unknown · restarting',
      'pane unknown · restarting · substrate fault',
      'pane unknown · orphan',
      'pane unknown · orphan · substrate fault',
      'pane unknown · never-started',
      'pane unknown · never-started · substrate fault',
      'pane unknown · unmeasurable',
      'pane unknown · unmeasurable · substrate fault',
    ],
    unlisted: [],
    skew: ['skew · pane gone · lifecycle absent (a server older than ARCH-48)'],
  },
  'SessionActionsSheet.tsx (moved-account note)': {
    server: [
      'pane gone · stopped · hibernated',
      'pane gone · stopped · hibernated · substrate fault',
      'pane gone · restarting',
      'pane gone · restarting · substrate fault',
      'pane gone · restarting · hibernated',
      'pane gone · restarting · hibernated · substrate fault',
      'pane gone · unmeasurable',
      'pane gone · unmeasurable · substrate fault',
      'pane gone · unmeasurable · hibernated',
      'pane gone · unmeasurable · hibernated · substrate fault',
      'pane unknown · stopped',
      'pane unknown · stopped · substrate fault',
      'pane unknown · stopped · hibernated',
      'pane unknown · stopped · hibernated · substrate fault',
      'pane unknown · restarting',
      'pane unknown · restarting · substrate fault',
      'pane unknown · restarting · hibernated',
      'pane unknown · restarting · hibernated · substrate fault',
      'pane unknown · orphan',
      'pane unknown · orphan · substrate fault',
      'pane unknown · orphan · hibernated',
      'pane unknown · orphan · hibernated · substrate fault',
      'pane unknown · never-started',
      'pane unknown · never-started · substrate fault',
      'pane unknown · never-started · hibernated',
      'pane unknown · never-started · hibernated · substrate fault',
      'pane unknown · unmeasurable',
      'pane unknown · unmeasurable · substrate fault',
      'pane unknown · unmeasurable · hibernated',
      'pane unknown · unmeasurable · hibernated · substrate fault',
    ],
    unlisted: [],
    skew: ['skew · pane gone · lifecycle absent (a server older than ARCH-48)'],
  },
  'coordWords.ts#coordPresence': {
    server: [
      'pane live · running · substrate fault',
      'pane live · running · hibernated · substrate fault',
      'pane live · unsupervised · substrate fault',
      'pane live · unsupervised · hibernated · substrate fault',
      'pane live · unclaimed · substrate fault',
      'pane live · unclaimed · hibernated · substrate fault',
      'pane live · unmeasurable',
      'pane live · unmeasurable · substrate fault',
      'pane live · unmeasurable · hibernated',
      'pane live · unmeasurable · hibernated · substrate fault',
      'pane gone · stopped · substrate fault',
      'pane gone · stopped · hibernated · substrate fault',
      'pane gone · restarting · substrate fault',
      'pane gone · restarting · hibernated',
      'pane gone · restarting · hibernated · substrate fault',
      'pane gone · orphan · substrate fault',
      'pane gone · orphan · hibernated',
      'pane gone · orphan · hibernated · substrate fault',
      'pane gone · never-started · substrate fault',
      'pane gone · never-started · hibernated',
      'pane gone · never-started · hibernated · substrate fault',
      'pane unknown · stopped',
      'pane unknown · stopped · hibernated',
      'pane unknown · restarting',
      'pane unknown · restarting · hibernated',
      'pane unknown · orphan',
      'pane unknown · orphan · hibernated',
      'pane unknown · never-started',
      'pane unknown · never-started · hibernated',
    ],
    unlisted: ['row absent'],
    skew: [],
  },
  'groupFleet.ts#groupFleet (stranded count)': {
    server: [
      'pane gone · stopped · hibernated',
      'pane gone · stopped · hibernated · substrate fault',
      'pane gone · restarting',
      'pane gone · restarting · substrate fault',
      'pane gone · restarting · hibernated',
      'pane gone · restarting · hibernated · substrate fault',
      'pane gone · unmeasurable',
      'pane gone · unmeasurable · substrate fault',
      'pane gone · unmeasurable · hibernated',
      'pane gone · unmeasurable · hibernated · substrate fault',
      'pane unknown · stopped',
      'pane unknown · stopped · substrate fault',
      'pane unknown · stopped · hibernated',
      'pane unknown · stopped · hibernated · substrate fault',
      'pane unknown · restarting',
      'pane unknown · restarting · substrate fault',
      'pane unknown · restarting · hibernated',
      'pane unknown · restarting · hibernated · substrate fault',
      'pane unknown · orphan',
      'pane unknown · orphan · substrate fault',
      'pane unknown · orphan · hibernated',
      'pane unknown · orphan · hibernated · substrate fault',
      'pane unknown · never-started',
      'pane unknown · never-started · substrate fault',
      'pane unknown · never-started · hibernated',
      'pane unknown · never-started · hibernated · substrate fault',
      'pane unknown · unmeasurable',
      'pane unknown · unmeasurable · substrate fault',
      'pane unknown · unmeasurable · hibernated',
      'pane unknown · unmeasurable · hibernated · substrate fault',
    ],
    unlisted: [],
    skew: ['skew · pane gone · lifecycle absent (a server older than ARCH-48)'],
  },
  'hibernated.ts#hibernatedSince': {
    server: [
      'pane gone · restarting · hibernated',
      'pane gone · restarting · hibernated · substrate fault',
      'pane gone · orphan · hibernated',
      'pane gone · orphan · hibernated · substrate fault',
      'pane gone · never-started · hibernated',
      'pane gone · never-started · hibernated · substrate fault',
      'pane gone · unmeasurable · hibernated',
      'pane gone · unmeasurable · hibernated · substrate fault',
      'pane unknown · stopped · hibernated',
      'pane unknown · stopped · hibernated · substrate fault',
      'pane unknown · restarting · hibernated',
      'pane unknown · restarting · hibernated · substrate fault',
      'pane unknown · orphan · hibernated',
      'pane unknown · orphan · hibernated · substrate fault',
      'pane unknown · never-started · hibernated',
      'pane unknown · never-started · hibernated · substrate fault',
      'pane unknown · unmeasurable · hibernated',
      'pane unknown · unmeasurable · hibernated · substrate fault',
    ],
    unlisted: [],
    skew: [],
  },
  'fleet/sessionFacts.ts#sessionFacts (dead)': {
    server: [
      'pane gone · stopped · hibernated',
      'pane gone · stopped · hibernated · substrate fault',
      'pane gone · restarting',
      'pane gone · restarting · substrate fault',
      'pane gone · restarting · hibernated',
      'pane gone · restarting · hibernated · substrate fault',
      'pane gone · unmeasurable',
      'pane gone · unmeasurable · substrate fault',
      'pane gone · unmeasurable · hibernated',
      'pane gone · unmeasurable · hibernated · substrate fault',
      'pane unknown · stopped',
      'pane unknown · stopped · substrate fault',
      'pane unknown · stopped · hibernated',
      'pane unknown · stopped · hibernated · substrate fault',
      'pane unknown · restarting',
      'pane unknown · restarting · substrate fault',
      'pane unknown · restarting · hibernated',
      'pane unknown · restarting · hibernated · substrate fault',
      'pane unknown · orphan',
      'pane unknown · orphan · substrate fault',
      'pane unknown · orphan · hibernated',
      'pane unknown · orphan · hibernated · substrate fault',
      'pane unknown · never-started',
      'pane unknown · never-started · substrate fault',
      'pane unknown · never-started · hibernated',
      'pane unknown · never-started · hibernated · substrate fault',
      'pane unknown · unmeasurable',
      'pane unknown · unmeasurable · substrate fault',
      'pane unknown · unmeasurable · hibernated',
      'pane unknown · unmeasurable · hibernated · substrate fault',
    ],
    unlisted: [],
    skew: ['skew · pane gone · lifecycle absent (a server older than ARCH-48)'],
  },
  'spawnWords.ts#silentAboutSpawn (through spawnChip)': {
    server: [
      'pane gone · stopped · hibernated',
      'pane gone · stopped · hibernated · substrate fault',
      'pane gone · restarting',
      'pane gone · restarting · substrate fault',
      'pane gone · restarting · hibernated',
      'pane gone · restarting · hibernated · substrate fault',
      'pane gone · unmeasurable',
      'pane gone · unmeasurable · substrate fault',
      'pane gone · unmeasurable · hibernated',
      'pane gone · unmeasurable · hibernated · substrate fault',
      'pane unknown · stopped',
      'pane unknown · stopped · substrate fault',
      'pane unknown · stopped · hibernated',
      'pane unknown · stopped · hibernated · substrate fault',
      'pane unknown · restarting',
      'pane unknown · restarting · substrate fault',
      'pane unknown · restarting · hibernated',
      'pane unknown · restarting · hibernated · substrate fault',
      'pane unknown · orphan',
      'pane unknown · orphan · substrate fault',
      'pane unknown · orphan · hibernated',
      'pane unknown · orphan · hibernated · substrate fault',
      'pane unknown · never-started',
      'pane unknown · never-started · substrate fault',
      'pane unknown · never-started · hibernated',
      'pane unknown · never-started · hibernated · substrate fault',
      'pane unknown · unmeasurable',
      'pane unknown · unmeasurable · substrate fault',
      'pane unknown · unmeasurable · hibernated',
      'pane unknown · unmeasurable · hibernated · substrate fault',
    ],
    unlisted: [],
    skew: ['skew · pane gone · lifecycle absent (a server older than ARCH-48)'],
  },
  'startProgramPolicy.ts#liveMainCheckoutIn': {
    server: [
      'pane gone · stopped · hibernated',
      'pane gone · stopped · hibernated · substrate fault',
      'pane gone · restarting',
      'pane gone · restarting · substrate fault',
      'pane gone · restarting · hibernated',
      'pane gone · restarting · hibernated · substrate fault',
      'pane gone · unmeasurable',
      'pane gone · unmeasurable · substrate fault',
      'pane gone · unmeasurable · hibernated',
      'pane gone · unmeasurable · hibernated · substrate fault',
      'pane unknown · stopped',
      'pane unknown · stopped · substrate fault',
      'pane unknown · stopped · hibernated',
      'pane unknown · stopped · hibernated · substrate fault',
      'pane unknown · restarting',
      'pane unknown · restarting · substrate fault',
      'pane unknown · restarting · hibernated',
      'pane unknown · restarting · hibernated · substrate fault',
      'pane unknown · orphan',
      'pane unknown · orphan · substrate fault',
      'pane unknown · orphan · hibernated',
      'pane unknown · orphan · hibernated · substrate fault',
      'pane unknown · never-started',
      'pane unknown · never-started · substrate fault',
      'pane unknown · never-started · hibernated',
      'pane unknown · never-started · hibernated · substrate fault',
      'pane unknown · unmeasurable',
      'pane unknown · unmeasurable · substrate fault',
      'pane unknown · unmeasurable · hibernated',
      'pane unknown · unmeasurable · hibernated · substrate fault',
    ],
    unlisted: [],
    skew: ['skew · pane gone · lifecycle absent (a server older than ARCH-48)'],
  },
  'startProgramPolicy.ts#startedSessionFor': {
    server: [
      'pane gone · stopped · hibernated',
      'pane gone · stopped · hibernated · substrate fault',
      'pane gone · restarting',
      'pane gone · restarting · substrate fault',
      'pane gone · restarting · hibernated',
      'pane gone · restarting · hibernated · substrate fault',
      'pane gone · unmeasurable',
      'pane gone · unmeasurable · substrate fault',
      'pane gone · unmeasurable · hibernated',
      'pane gone · unmeasurable · hibernated · substrate fault',
      'pane unknown · stopped',
      'pane unknown · stopped · substrate fault',
      'pane unknown · stopped · hibernated',
      'pane unknown · stopped · hibernated · substrate fault',
      'pane unknown · restarting',
      'pane unknown · restarting · substrate fault',
      'pane unknown · restarting · hibernated',
      'pane unknown · restarting · hibernated · substrate fault',
      'pane unknown · orphan',
      'pane unknown · orphan · substrate fault',
      'pane unknown · orphan · hibernated',
      'pane unknown · orphan · hibernated · substrate fault',
      'pane unknown · never-started',
      'pane unknown · never-started · substrate fault',
      'pane unknown · never-started · hibernated',
      'pane unknown · never-started · hibernated · substrate fault',
      'pane unknown · unmeasurable',
      'pane unknown · unmeasurable · substrate fault',
      'pane unknown · unmeasurable · hibernated',
      'pane unknown · unmeasurable · hibernated · substrate fault',
    ],
    unlisted: [],
    skew: ['skew · pane gone · lifecycle absent (a server older than ARCH-48)'],
  },
  'startProgramPolicy.ts#liveIdsIn': {
    server: [
      'pane gone · stopped · hibernated',
      'pane gone · stopped · hibernated · substrate fault',
      'pane gone · restarting',
      'pane gone · restarting · substrate fault',
      'pane gone · restarting · hibernated',
      'pane gone · restarting · hibernated · substrate fault',
      'pane gone · unmeasurable',
      'pane gone · unmeasurable · substrate fault',
      'pane gone · unmeasurable · hibernated',
      'pane gone · unmeasurable · hibernated · substrate fault',
      'pane unknown · stopped',
      'pane unknown · stopped · substrate fault',
      'pane unknown · stopped · hibernated',
      'pane unknown · stopped · hibernated · substrate fault',
      'pane unknown · restarting',
      'pane unknown · restarting · substrate fault',
      'pane unknown · restarting · hibernated',
      'pane unknown · restarting · hibernated · substrate fault',
      'pane unknown · orphan',
      'pane unknown · orphan · substrate fault',
      'pane unknown · orphan · hibernated',
      'pane unknown · orphan · hibernated · substrate fault',
      'pane unknown · never-started',
      'pane unknown · never-started · substrate fault',
      'pane unknown · never-started · hibernated',
      'pane unknown · never-started · hibernated · substrate fault',
      'pane unknown · unmeasurable',
      'pane unknown · unmeasurable · substrate fault',
      'pane unknown · unmeasurable · hibernated',
      'pane unknown · unmeasurable · hibernated · substrate fault',
    ],
    unlisted: [],
    skew: ['skew · pane gone · lifecycle absent (a server older than ARCH-48)'],
  },
  'AccountsScreen.tsx#AccountsScreen (sessions on this account)': {
    server: [
      'pane gone · stopped · hibernated',
      'pane gone · stopped · hibernated · substrate fault',
      'pane gone · restarting',
      'pane gone · restarting · substrate fault',
      'pane gone · restarting · hibernated',
      'pane gone · restarting · hibernated · substrate fault',
      'pane gone · unmeasurable',
      'pane gone · unmeasurable · substrate fault',
      'pane gone · unmeasurable · hibernated',
      'pane gone · unmeasurable · hibernated · substrate fault',
      'pane unknown · stopped',
      'pane unknown · stopped · substrate fault',
      'pane unknown · stopped · hibernated',
      'pane unknown · stopped · hibernated · substrate fault',
      'pane unknown · restarting',
      'pane unknown · restarting · substrate fault',
      'pane unknown · restarting · hibernated',
      'pane unknown · restarting · hibernated · substrate fault',
      'pane unknown · orphan',
      'pane unknown · orphan · substrate fault',
      'pane unknown · orphan · hibernated',
      'pane unknown · orphan · hibernated · substrate fault',
      'pane unknown · never-started',
      'pane unknown · never-started · substrate fault',
      'pane unknown · never-started · hibernated',
      'pane unknown · never-started · hibernated · substrate fault',
      'pane unknown · unmeasurable',
      'pane unknown · unmeasurable · substrate fault',
      'pane unknown · unmeasurable · hibernated',
      'pane unknown · unmeasurable · hibernated · substrate fault',
    ],
    unlisted: [],
    skew: ['skew · pane gone · lifecycle absent (a server older than ARCH-48)'],
  },
  'orphanWords.ts#orphanNote (coordPresence caller)': {
    server: [
      'pane live · running · substrate fault',
      'pane live · running · hibernated · substrate fault',
      'pane live · unsupervised · substrate fault',
      'pane live · unsupervised · hibernated · substrate fault',
      'pane live · unclaimed · substrate fault',
      'pane live · unclaimed · hibernated · substrate fault',
      'pane live · unmeasurable',
      'pane live · unmeasurable · substrate fault',
      'pane live · unmeasurable · hibernated',
      'pane live · unmeasurable · hibernated · substrate fault',
      'pane gone · stopped · substrate fault',
      'pane gone · stopped · hibernated · substrate fault',
      'pane gone · restarting · substrate fault',
      'pane gone · restarting · hibernated',
      'pane gone · restarting · hibernated · substrate fault',
      'pane gone · orphan · substrate fault',
      'pane gone · orphan · hibernated',
      'pane gone · orphan · hibernated · substrate fault',
      'pane gone · never-started · substrate fault',
      'pane gone · never-started · hibernated',
      'pane gone · never-started · hibernated · substrate fault',
      'pane unknown · stopped',
      'pane unknown · stopped · hibernated',
      'pane unknown · restarting',
      'pane unknown · restarting · hibernated',
      'pane unknown · orphan',
      'pane unknown · orphan · hibernated',
      'pane unknown · never-started',
      'pane unknown · never-started · hibernated',
    ],
    unlisted: ['row absent'],
    skew: [],
  },
  'RunRow.tsx (coordPresence caller: the Resume door)': {
    server: [
      'pane gone · stopped · substrate fault',
      'pane gone · orphan · substrate fault',
      'pane gone · orphan · hibernated',
      'pane gone · orphan · hibernated · substrate fault',
      'pane gone · never-started · substrate fault',
      'pane gone · never-started · hibernated',
      'pane gone · never-started · hibernated · substrate fault',
      'pane unknown · stopped',
      'pane unknown · orphan',
      'pane unknown · never-started',
    ],
    unlisted: ['row absent'],
    skew: [],
  },
  'SessionScreen.tsx#SessionScreen (coordPresence caller: the header orphan fact)': {
    server: [
      'pane gone · stopped · substrate fault',
      'pane gone · stopped · hibernated · substrate fault',
      'pane gone · restarting · hibernated',
      'pane gone · orphan · substrate fault',
      'pane gone · orphan · hibernated',
      'pane gone · orphan · hibernated · substrate fault',
      'pane gone · never-started · substrate fault',
      'pane gone · never-started · hibernated',
      'pane gone · never-started · hibernated · substrate fault',
      'pane unknown · stopped',
      'pane unknown · stopped · hibernated',
      'pane unknown · restarting · hibernated',
      'pane unknown · orphan',
      'pane unknown · orphan · hibernated',
      'pane unknown · never-started',
      'pane unknown · never-started · hibernated',
    ],
    unlisted: ['row absent'],
    skew: [],
  },
};

/** A site's verdicts over the rows of one group, in table order, joined: the pin is the whole vector. */
const vector = (name: string, group: TableRow['group']): string => results.get(name)!.filter((c) => c.row.group === group).map((c) => c.verdict).join(' ');
/** The rows of one group where a site differs from its presence reading, by name. */
const differs = (name: string, group: TableRow['group']): string[] => results.get(name)!.filter((c) => c.row.group === group && c.verdict !== c.presenceReading).map((c) => c.row.name);

describe('the table itself', () => {
  it('has 56 server-producible rows, 4 unlisted registry facts and one skew row, and 19 sites', () => {
    const rows = tableRows();
    expect([rows.filter((r) => r.group === 'server').length, rows.filter((r) => r.group === 'unlisted').length, rows.filter((r) => r.group === 'skew').length]).toEqual([56, 4, 1]);
    expect(SITES.length).toBe(19);
  });
});

describe('each site\'s verdict, row by row, on the old code (C7a pins; C7c Step 4 keeps every SAME site\'s vector byte-identical)', () => {
  // The vectors are in `tableRows()` order: pane live (running, unsupervised, unclaimed, unmeasurable), then pane gone
  // and pane unknown (stopped, restarting, orphan, never-started, unmeasurable), each lifecycle × (no stamp, no fault),
  // (fault), (stamp), (stamp, fault).
  for (const site of SITES) {
    it(site.name, () => {
      expect({ server: vector(site.name, 'server'), unlisted: vector(site.name, 'unlisted'), skew: vector(site.name, 'skew') }).toEqual(VERDICTS[site.name]);
    });
  }
});

describe('the differs rows (the input OA-C15 is ruled on), per site and group', () => {
  for (const site of SITES) {
    it(site.name, () => {
      expect({ server: differs(site.name, 'server'), unlisted: differs(site.name, 'unlisted'), skew: differs(site.name, 'skew') }).toEqual(DIFFERS[site.name]);
    });
  }
});

describe('the skew row reads unknown and is never a differs row to be ruled', () => {
  it('its presence is absent (no key), so it reads unknown', () => {
    const skew = tableRows().find((r) => r.group === 'skew')!;
    expect(skew.presence).toBeUndefined();
    expect('presence' in sessionOf(skew)).toBe(false);
  });
});

describe('the snapshot-revived rows (item 20): each site reads a revived row as it reads the live one', () => {
  afterEach(() => { try { window.localStorage.clear(); } catch { /* storage may be absent */ } });
  for (const site of SITES) {
    it(site.name, async () => {
      for (const row of tableRows().filter((r) => r.group === 'server')) {
        const live = site.build(row);
        saveFleetSnapshot([live]);
        const revived = loadFleetSnapshot()?.sessions.find((x) => x.id === ID);
        expect(revived, `${row.name}: the snapshot revives the row`).toBeDefined();
        const carried = { ...live, ...Object.fromEntries((site.snapshotNulls ?? []).map((k) => [k, null])) } as FleetSession;
        expect(await site.verdict(revived!), `${site.name} · ${row.name}`).toBe(await site.verdict(carried));
      }
    });
  }

  it('the pre-deploy snapshot row (no presence key) is printed apart as a skew row', async () => {
    const row = tableRows().find((r) => r.group === 'server' && r.facts.pane === 'gone' && r.facts.lifecycle === 'orphan' && !r.substrate && r.facts.hibernatedAt === null)!;
    const line: string[] = [];
    for (const site of SITES) {
      const { presence: _drop, ...noKey } = site.build(row);
      saveFleetSnapshot([noKey as FleetSession]);
      const revived = loadFleetSnapshot()!.sessions.find((x) => x.id === ID)!;
      expect('presence' in revived, site.name).toBe(false);
      line.push(`${site.name}: ${await site.verdict(revived)}`);
    }
    console.log(`w7-presence-table pre-deploy snapshot row (${row.name}, no presence key):\n${line.map((l) => `  ${l}`).join('\n')}`);
  });
});

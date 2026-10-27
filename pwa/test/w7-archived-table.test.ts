// Each "archived" check's verdict over `sessionBucket`'s rows (D-7179; Task C7a Step 4; plan
// docs/superpowers/plans/2026-10-27-consolidation-w7-pwa.md, item 10; ARCH-75). Written green on the old code, before
// C7j moves any site: the table is the input OA-C15 is ruled on.
//
// THE 8 SITES are `archivedChecks()` (census-w7), each read through its own code: the two actions-sheet doors (Hold,
// Clean up workspace), the Accounts screen's "sessions on this account", `archivedSummary`'s count and the Archive
// screen's list, the PR sheet's merged-and-archived branch, and the session header's bucket and archived chip.
// THE ROWS are a live and a dead row × archived or not × no PR, an open PR, a merged one, each bucketed by
// `shared/api.ts#sessionBucket` as the server buckets it. `archivedAt !== null` and `bucket === 'archived'` differ on
// TWO classes, both among the rows: (i) an archived row whose pane is live (no archived bucket at all), and (ii) an
// archived dead row whose PR merged, which `sessionBucket` files `cleanup`.
// Each site's verdict sits beside two readings by bucket: BARE (the site with its `archivedAt` check read as
// `bucket === 'archived'`) and BOTH (read as `bucket === 'archived' || bucket === 'cleanup'`, which equals
// `archivedAt !== null && status === 'dead'`, so it leaves only class (i)). A row is SAME or DIFFERS under each.
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { createElement } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { sessionBucket, UNCHECKED_PR, type FleetSession, type PrPhase, type PrState } from '../../shared/api';
import { fleetSession } from './fleetFixture';
import { TEST_ROSTER } from './rosterFixture';
import { seedAccountsAnswer } from './accountsAnswer';
import { SessionActionsSheet } from '../src/fleet/SessionActionsSheet';
import { AccountsScreen } from '../src/screens/AccountsScreen';
import { ArchiveScreen, archivedSummary } from '../src/screens/ArchiveScreen';
import { PrSheet } from '../src/session/PrSheet';
import { sessionHeaderView } from '../src/session/sessionHeaderView';
import { createFleetStore, useFleetStore } from '../src/stores/fleet';

const ID = 'session-a';
const NOW = 1_784_600_000_000;
const ARCHIVED_AT = 1_784_500_000; // seconds, as the wire carries it

const prOf = (phase: PrPhase): PrState => ({ ...UNCHECKED_PR, phase, number: 12, mergedAt: phase === 'merged' ? 1_784_550_000_000 : null });

interface Row { readonly name: string; readonly session: FleetSession }

/** The rows: status × archived × PR, each bucketed by the server's own ladder. */
function rows(): Row[] {
  const out: Row[] = [];
  for (const status of ['idle', 'dead'] as const) {
    for (const archived of [false, true]) {
      for (const pr of [null, 'open', 'merged'] as const) {
        const base = {
          status, statusUpdatedAt: NOW - 60_000, dialogPending: false, hookState: null, background: null,
          archivedAt: archived ? ARCHIVED_AT : null, pr: pr === null ? null : prOf(pr),
        } as const;
        const { bucket, bucketSince } = sessionBucket(base, null);
        out.push({
          name: `${status === 'dead' ? 'pane gone' : 'pane live'} · ${archived ? 'archived' : 'not archived'} · ${pr === null ? 'no PR' : `PR ${pr}`} -> ${bucket}`,
          session: fleetSession({
            id: ID, project: 'project-a', workspace: 'ws-a', workdir: '/w/ws-a', wrapper: 'claude', home: 'claude', name: 'session-a',
            ...base, bucket, bucketSince, lifecycle: status === 'dead' ? 'stopped' : 'running',
          }),
        });
      }
    }
  }
  return out;
}

const has = (text: string): boolean => document.body.textContent?.includes(text) ?? false;
const stubFetch = (): void => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(
    String(url).includes('/api/accounts') ? JSON.stringify({ accounts: [], projected: null, roster: TEST_ROSTER }) : '{}',
    { status: 200, headers: { 'content-type': 'application/json' } },
  )));
};
const sheet = (s: FleetSession, text: string): string => {
  stubFetch();
  render(createElement(SessionActionsSheet, { session: s, open: true, onClose: () => {}, onReap: () => {} }));
  const shown = has(text) ? 'shown' : 'hidden';
  cleanup();
  vi.unstubAllGlobals();
  return shown;
};

interface Site { readonly name: string; readonly verdict: (s: FleetSession) => string | Promise<string> }

const SITES: readonly Site[] = [
  { name: 'SessionActionsSheet.tsx (Hold door: archivedAt === null)', verdict: (s) => sheet(s, 'Hold') },
  { name: 'SessionActionsSheet.tsx (Clean up workspace door: archivedAt !== null)', verdict: (s) => sheet(s, 'Clean up workspace…') },
  { name: 'AccountsScreen.tsx#AccountsScreen (sessions on this account)', verdict: async (s) => {
    const undo = seedAccountsAnswer();
    act(() => useFleetStore.setState({ sessions: [s] }));
    render(createElement(AccountsScreen));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const listed = document.querySelector('.accounts-session') !== null ? 'listed' : 'not-listed';
    cleanup();
    undo();
    act(() => useFleetStore.setState({ sessions: [] }));
    return listed;
  } },
  { name: 'ArchiveScreen.tsx#archivedSummary (count)', verdict: (s) => String(archivedSummary([s]).count) },
  { name: 'ArchiveScreen.tsx#ArchiveScreen (listed)', verdict: (s) => {
    render(createElement(ArchiveScreen, { sessions: [s], onOpen: () => {} }));
    const listed = has('ws-a') ? 'listed' : 'not-listed';
    cleanup();
    return listed;
  } },
  { name: 'PrSheet.tsx#PrSheet (merged branch: archived note or not)', verdict: (s) => {
    if (s.pr?.phase !== 'merged') return '-';
    stubFetch();
    render(createElement(PrSheet, { session: s, open: true, onClose: () => {}, onReap: () => {}, fleet: createFleetStore() }));
    const v = has('Archived — session stopped; nothing deleted') ? 'archived-note' : 'unarchived-note';
    cleanup();
    vi.unstubAllGlobals();
    return v;
  } },
  // The stream says `dead` (the case `headerBucket`'s archived exemption is about); the verdict is the status chip's bucket.
  { name: 'sessionHeaderView.ts#headerBucket (the header status bucket, stream dead)', verdict: (s) => {
    const chip = sessionHeaderView({ session: s, status: 'dead', statusUpdatedAt: null, fallback: 'session-a', now: NOW, finePointer: false } as never).chips.find((c) => c.kind === 'status');
    return chip === undefined || chip.kind !== 'status' ? 'no-status' : chip.bucket;
  } },
  { name: 'sessionHeaderView.ts#sessionHeaderView (archived chip)', verdict: (s) => {
    const chip = sessionHeaderView({ session: s, status: null, statusUpdatedAt: null, fallback: 'session-a', now: NOW, finePointer: false } as never).chips.find((c) => c.kind === 'archived');
    return chip === undefined ? 'no-chip' : 'chip';
  } },
];

/** The row read by bucket: its `archivedAt` kept only when the bucket says archived (BARE) or archived or cleanup (BOTH). */
const bare = (s: FleetSession): FleetSession => ({ ...s, archivedAt: s.bucket === 'archived' ? s.archivedAt : null });
const both = (s: FleetSession): FleetSession => ({ ...s, archivedAt: s.bucket === 'archived' || s.bucket === 'cleanup' ? s.archivedAt : null });

interface Cell { readonly row: Row; readonly verdict: string; readonly bare: string; readonly both: string }
const results = new Map<string, Cell[]>();

beforeAll(async () => {
  for (const site of SITES) {
    const cells: Cell[] = [];
    for (const row of rows()) cells.push({ row, verdict: await site.verdict(row.session), bare: await site.verdict(bare(row.session)), both: await site.verdict(both(row.session)) });
    results.set(site.name, cells);
    const d = (k: 'bare' | 'both') => cells.filter((c) => c.verdict !== c[k]);
    console.log(`w7-archived-table ${site.name}: BARE ${d('bare').length} differs, BOTH ${d('both').length} differs\n`
      + cells.map((c) => `  ${c.row.name}: ${c.verdict}${c.verdict === c.bare ? '' : ` | bare differs (${c.bare})`}${c.verdict === c.both ? '' : ` | both differs (${c.both})`}`).join('\n'));
  }
}, 60_000);

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('the rows', () => {
  it('cover both differing classes: an archived row with a live pane, and an archived dead row whose PR merged (cleanup)', () => {
    const r = rows();
    expect(r.map((x) => x.session.bucket)).toEqual([
      'idle', 'idle', 'idle', 'idle', 'idle', 'idle',
      'dead', 'dead', 'dead', 'archived', 'archived', 'cleanup',
    ]);
    expect(r.filter((x) => x.session.archivedAt !== null && x.session.bucket !== 'archived').map((x) => x.name)).toEqual([
      'pane live · archived · no PR -> idle', 'pane live · archived · PR open -> idle', 'pane live · archived · PR merged -> idle',
      'pane gone · archived · PR merged -> cleanup',
    ]);
  });
});

// One verdict per row, in `rows()` order: pane live (not archived: no PR, open, merged; archived: the same), then pane
// gone in the same order. Each site's BARE and BOTH readings are pinned beside it; C7j Step 5's behaviour rows are the
// cells where a reading differs.
const PINS: Record<string, { verdict: string; bare: string; both: string }> = {
  'SessionActionsSheet.tsx (Hold door: archivedAt === null)': {
    verdict: 'shown shown shown hidden hidden hidden shown shown shown hidden hidden hidden',
    bare: 'shown shown shown shown shown shown shown shown shown hidden hidden shown',
    both: 'shown shown shown shown shown shown shown shown shown hidden hidden hidden',
  },
  'SessionActionsSheet.tsx (Clean up workspace door: archivedAt !== null)': {
    verdict: 'hidden hidden hidden shown shown shown hidden hidden hidden shown shown shown',
    bare: 'hidden hidden hidden hidden hidden hidden hidden hidden hidden shown shown hidden',
    both: 'hidden hidden hidden hidden hidden hidden hidden hidden hidden shown shown shown',
  },
  'AccountsScreen.tsx#AccountsScreen (sessions on this account)': {
    verdict: 'listed listed listed not-listed not-listed not-listed not-listed not-listed not-listed not-listed not-listed not-listed',
    bare: 'listed listed listed listed listed listed not-listed not-listed not-listed not-listed not-listed not-listed',
    both: 'listed listed listed listed listed listed not-listed not-listed not-listed not-listed not-listed not-listed',
  },
  'ArchiveScreen.tsx#archivedSummary (count)': {
    verdict: '0 0 0 1 1 1 0 0 0 1 1 1',
    bare: '0 0 0 0 0 0 0 0 0 1 1 0',
    both: '0 0 0 0 0 0 0 0 0 1 1 1',
  },
  'ArchiveScreen.tsx#ArchiveScreen (listed)': {
    verdict: 'not-listed not-listed not-listed listed listed listed not-listed not-listed not-listed listed listed listed',
    bare: 'not-listed not-listed not-listed not-listed not-listed not-listed not-listed not-listed not-listed listed listed not-listed',
    both: 'not-listed not-listed not-listed not-listed not-listed not-listed not-listed not-listed not-listed listed listed listed',
  },
  'PrSheet.tsx#PrSheet (merged branch: archived note or not)': {
    verdict: '- - unarchived-note - - archived-note - - unarchived-note - - archived-note',
    bare: '- - unarchived-note - - unarchived-note - - unarchived-note - - unarchived-note',
    both: '- - unarchived-note - - unarchived-note - - unarchived-note - - archived-note',
  },
  'sessionHeaderView.ts#headerBucket (the header status bucket, stream dead)': {
    verdict: 'dead dead dead idle idle idle dead dead dead archived archived cleanup',
    bare: 'dead dead dead dead dead dead dead dead dead archived archived dead',
    both: 'dead dead dead dead dead dead dead dead dead archived archived cleanup',
  },
  'sessionHeaderView.ts#sessionHeaderView (archived chip)': {
    verdict: 'no-chip no-chip no-chip chip chip chip no-chip no-chip no-chip chip chip chip',
    bare: 'no-chip no-chip no-chip no-chip no-chip no-chip no-chip no-chip no-chip chip chip no-chip',
    both: 'no-chip no-chip no-chip no-chip no-chip no-chip no-chip no-chip no-chip chip chip chip',
  },
};

describe('each archived site over the bucket rows (C7a pins: the verdict, and its BARE and BOTH readings)', () => {
  for (const site of SITES) {
    it(site.name, () => {
      const cells = results.get(site.name)!;
      const got = { verdict: cells.map((c) => c.verdict).join(' '), bare: cells.map((c) => c.bare).join(' '), both: cells.map((c) => c.both).join(' ') };
      expect(got).toEqual(PINS[site.name]);
    });
  }
});

// Under a bare `bucket === 'archived'`, this row would leave the Archive screen's lists and lose the Clean up door
// (item 10): the BARE pins above show it; C7j reads both buckets or rules the row under OA-C15.
describe('the cleanup rows: an archived-and-merged row is archived to every site today', () => {
  it('the archived dead merged row (cleanup): every site reads it archived (no Hold, not on the account, counted, listed, the archived note and chip)', () => {
    const cleanupRow = rows().findIndex((r) => r.session.bucket === 'cleanup');
    expect(SITES.map((s) => results.get(s.name)![cleanupRow]!.verdict)).toEqual([
      'hidden', 'shown', 'not-listed', '1', 'listed', 'archived-note', 'cleanup', 'chip',
    ]);
  });
});

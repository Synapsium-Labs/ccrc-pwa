// The ⋯ menu's items and the predicates they read, held exactly (D-7573, ARCH-05). `sessionMenu` is the one reader of
// every item's gate: Move, Archive and a main checkout's Restore refuse under a standing substrate fault (the swap and
// destructive path), and `isPutAway` / `restoreReachesEnsure` choose Archive against Restore and whether Restore is
// gated. This pin was green against the definitions in their old files (`SessionFlows.tsx`, `PrKeycap.tsx`,
// `ArchiveSheet.tsx`); each move commit changes one of its import lines and nothing else, so every row below is the
// same answer before and after the move.
import { describe, expect, it } from 'vitest';
import { UNCHECKED_PR, type FleetSession, type PrPhase, type PrState } from '../../shared/api';
import { hasPrCap, prDoorWord } from '../src/session/PrKeycap';
import { isPutAway, restoreReachesEnsure } from '../src/fleet/ArchiveSheet';
import { sessionMenu } from '../src/session/SessionFlows';
import { fleetSession } from './fleetFixture';

const FAULT = { at: 1, text: 'tmux socket gone' };
const FAULT_TITLE = 'tmux unreachable — tmux socket gone';
const DOCS_DEMO = { href: '/docs/demo', branch: null };
const DOCS_ON_MAIN = '/docs/demo?ref=main';

const pr = (phase: PrPhase, number: number | null = null): PrState => ({ ...UNCHECKED_PR, phase, number });
const workspace = (over: Partial<FleetSession> = {}): FleetSession =>
  fleetSession({ id: 'demo-ws-a', workspace: 'ws-a', ...over });
/** A main checkout put away: no workspace, no pane, a stop stamp, not asleep (`inArchivedFold`'s second clause). */
const stoppedMain = (over: Partial<FleetSession> = {}): FleetSession =>
  fleetSession({ status: 'dead', bucket: 'dead', lifecycle: 'stopped', stoppedBy: { at: 5, surface: 'pwa' }, ...over });

const HEAD = [
  { id: 'session-model', label: 'Change model', enabled: true },
  { id: 'session-effort', label: 'Change effort', enabled: true },
  { id: 'open-history', label: 'History', enabled: true },
];
const DOCS = { id: 'session-docs', label: 'Docs', enabled: true, docs: DOCS_DEMO };
const TERMINAL = { id: 'open-terminal', label: 'Terminal', enabled: true };
const SWAP = { id: 'session-swap', label: 'Move to another account', enabled: true, title: undefined };
const SWAP_FAULTED = { id: 'session-swap', label: 'Move to another account', enabled: false, title: FAULT_TITLE };
const ARCHIVE = { id: 'session-archive', label: 'Archive', enabled: true, title: undefined, danger: true };
const ARCHIVE_FAULTED = { id: 'session-archive', label: 'Archive', enabled: false, title: FAULT_TITLE, danger: true };

describe('sessionMenu: the exact entry list, in its order', () => {
  it('null (a deep link before its first frame): no Docs, no PR, Archive offered disabled', () => {
    expect(sessionMenu(null)).toEqual([
      ...HEAD, TERMINAL, SWAP,
      { id: 'session-archive', label: 'Archive', enabled: false, title: undefined, danger: true },
    ]);
  });

  it('a live main checkout: Docs, no PR door, Move and Archive enabled', () => {
    expect(sessionMenu(fleetSession())).toEqual([...HEAD, DOCS, TERMINAL, SWAP, ARCHIVE]);
  });

  it.each([
    ['no pr read yet (null)', null, 'Check PR'],
    ['none', pr('none'), 'Open PR'],
    ['unchecked', pr('unchecked'), 'Check PR'],
    ['unknown', pr('unknown'), 'Retry PR'],
    ['a number', pr('open', 42), '#42'],
  ] as const)('a workspace whose pr is %s: the PR door carries the cap\'s word', (_name, state, word) => {
    expect(sessionMenu(workspace({ pr: state }))).toEqual([
      ...HEAD, DOCS, TERMINAL, { id: 'session-pr', label: word, enabled: true }, SWAP, ARCHIVE,
    ]);
  });

  it('an archived workspace (the Archived fold): Restore in Archive\'s place, ungated', () => {
    const s = workspace({ archivedAt: 9 });
    expect(s.bucket).toBe('archived');
    expect(sessionMenu(s)).toEqual([
      ...HEAD, DOCS, TERMINAL, { id: 'session-pr', label: 'Check PR', enabled: true }, SWAP,
      { id: 'session-restore', label: 'Restore', enabled: true, title: undefined },
    ]);
  });

  it('an archived workspace under a fault: Move refuses, Restore (ws-restore) stays enabled with no title', () => {
    expect(sessionMenu(workspace({ archivedAt: 9, substrate: FAULT }))).toEqual([
      ...HEAD, DOCS, TERMINAL, { id: 'session-pr', label: 'Check PR', enabled: true }, SWAP_FAULTED,
      { id: 'session-restore', label: 'Restore', enabled: true, title: undefined },
    ]);
  });

  it('a workspace in the cleanup bucket (archived, merged): Restore', () => {
    const s = workspace({ archivedAt: 9, pr: pr('merged', 7) });
    expect(s.bucket).toBe('cleanup');
    expect(sessionMenu(s)).toEqual([
      ...HEAD, DOCS, TERMINAL, { id: 'session-pr', label: '#7', enabled: true }, SWAP,
      { id: 'session-restore', label: 'Restore', enabled: true, title: undefined },
    ]);
  });

  it('a put-away main checkout with no fault: Restore enabled, no title', () => {
    expect(sessionMenu(stoppedMain())).toEqual([
      ...HEAD, DOCS, TERMINAL, SWAP,
      { id: 'session-restore', label: 'Restore', enabled: true, title: undefined },
    ]);
  });

  it('a put-away main checkout under a fault: Restore (POST /ensure) refuses with the fault\'s words', () => {
    expect(sessionMenu(stoppedMain({ substrate: FAULT }))).toEqual([
      ...HEAD, DOCS, TERMINAL, SWAP_FAULTED,
      { id: 'session-restore', label: 'Restore', enabled: false, title: FAULT_TITLE },
    ]);
  });

  it('a live session under a fault: Move and Archive refuse, both with the fault\'s words', () => {
    expect(sessionMenu(fleetSession({ substrate: FAULT }))).toEqual([...HEAD, DOCS, TERMINAL, SWAP_FAULTED, ARCHIVE_FAULTED]);
  });

  it('a live workspace under a fault: the PR door stays enabled, Move and Archive refuse', () => {
    expect(sessionMenu(workspace({ substrate: FAULT, pr: pr('open', 3) }))).toEqual([
      ...HEAD, DOCS, TERMINAL, { id: 'session-pr', label: '#3', enabled: true }, SWAP_FAULTED, ARCHIVE_FAULTED,
    ]);
  });

  it('a session on a branch: the Docs item names the branch and goes there', () => {
    const [docs] = sessionMenu(fleetSession({ branch: 'main' })).filter((e) => e.id === 'session-docs');
    expect(docs).toEqual({
      id: 'session-docs', label: 'Docs', enabled: true, docs: { href: DOCS_ON_MAIN, branch: 'main' },
    });
  });

  it('a project that fails the docs grammar: no Docs item, nothing else moves', () => {
    expect(sessionMenu(fleetSession({ project: '.hidden' }))).toEqual([...HEAD, TERMINAL, SWAP, ARCHIVE]);
  });
});

describe('hasPrCap: a workspace has a PR cap, a main checkout has none', () => {
  it.each([
    ['null', null, false],
    ['a main checkout', { workspace: null }, false],
    ['a workspace', { workspace: 'ws-a' }, true],
    ['a workspace named the empty string', { workspace: '' }, true],
  ] as const)('%s', (_name, s, want) => {
    expect(hasPrCap(s)).toBe(want);
  });
});

describe('prDoorWord: the number once known, otherwise what a tap does', () => {
  it.each([
    ['unchecked', 'Check PR'], ['none', 'Open PR'], ['unknown', 'Retry PR'],
    ['no-commits', 'PR'], ['open', 'PR'], ['draft', 'PR'], ['merged', 'PR'], ['closed', 'PR'],
  ] as const)('phase %s with no number: %s', (phase, word) => {
    expect(prDoorWord(pr(phase))).toBe(word);
  });

  it.each(['unchecked', 'none', 'unknown', 'open', 'merged'] as const)('phase %s with a number: the number wins', (phase) => {
    expect(prDoorWord(pr(phase, 12))).toBe('#12');
  });
});

describe('isPutAway and restoreReachesEnsure', () => {
  it.each([
    ['a live main checkout', fleetSession(), false, true],
    ['a live workspace', workspace(), false, false],
    ['an archived workspace', workspace({ archivedAt: 9 }), true, false],
    ['a cleanup workspace', workspace({ archivedAt: 9, pr: pr('merged', 7) }), true, false],
    ['a stopped main checkout', stoppedMain(), true, true],
    ['a hibernated main checkout (asleep, not put away)', stoppedMain({ hibernatedAt: 5 }), false, true],
    ['a stopped workspace that is not archived', workspace({ status: 'dead', bucket: 'dead', stoppedBy: { at: 5, surface: 'pwa' } }), false, false],
  ] as const)('%s: put away %s, Restore reaches /ensure %s', (_name, s, putAway, ensure) => {
    expect(isPutAway(s)).toBe(putAway);
    expect(restoreReachesEnsure(s)).toBe(ensure);
  });

  it('restoreReachesEnsure reads the workspace alone', () => {
    expect(restoreReachesEnsure({ workspace: null })).toBe(true);
    expect(restoreReachesEnsure({ workspace: 'ws-a' })).toBe(false);
  });
});

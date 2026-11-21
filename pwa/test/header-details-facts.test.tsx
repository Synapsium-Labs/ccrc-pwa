// Desktop polish C51, review 2963 F3 to F6: the session header's details row is decided in code. When it has nothing to show
// the header draws no row and no Details door (a door that opens nothing goes), for a worker as for a coordinator, in both
// skins; the row's own facts, the meta row's cells and the worktrees each bring it back; and `headerMetaHasCells`, the one
// reading of the meta row's cells, agrees with what `SessionMeta` draws for each cell alone.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { FleetSession } from '../../shared/api';
import { fleetSession } from './fleetFixture';
import { SessionMeta } from '../src/fleet/SessionMeta';
import { SessionDetails } from '../src/session/SessionDetails';
import { SessionHeaderHost, type HeaderHostProps } from './sessionHost';
import { detailsEndWithWorktrees, detailsHaveFacts } from '../src/session/sessionHeaderView';
import { headerMetaHasCells, sessionFacts, type SessionFactSet } from '../src/fleet/sessionFacts';
import { setSkin } from '../src/lib/skin';
import { NOW } from './rollupFixture';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const base = (over: Partial<FleetSession> = {}): FleetSession => fleetSession({
  id: 'lane-a-project-a-still-pond', wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workspace: 'still-pond', name: 'still-pond',
  role: 'child', status: 'idle', bucket: 'idle', branch: 'ws/still-pond', statusUpdatedAt: NOW - 120_000, ...over,
});
const factsOf = (over: Partial<SessionFactSet> = {}, session: FleetSession = base()): SessionFactSet => ({ ...sessionFacts({ session, now: NOW }), ...over });

const WORKTREE = {
  lease: { leaseId: 'lease-1', project: 'project-a', adminRecord: '/w/project-a/lease-1' },
  viaLabel: null, attachLabel: null,
} as unknown as SessionFactSet['worktrees'][number];

/** One cell of the header's meta row at a time, each as a field of the facts (or the session) that `SessionMeta` reads. */
const CELLS: ReadonlyArray<{ name: string; facts: () => SessionFactSet }> = [
  { name: 'a hold', facts: () => factsOf({}, base({ held: 'wave-brief pending' })) },
  { name: 'a child marker', facts: () => factsOf({}, base({ child: { kind: 'child', runId: 7 } })) },
  { name: 'the last spawn', facts: () => factsOf({ spawn: { word: 'login', data: 'login' } as SessionFactSet['spawn'] }) },
  { name: 'the ask-state chip', facts: () => factsOf({ askState: { state: 'held', label: 'held', title: 'held' } }) },
  { name: 'a cleanup fact', facts: () => factsOf({ cleanup: ['merged #12'] }) },
  { name: 'the task tally', facts: () => factsOf({ tasks: { done: 1, total: 3 } }) },
  { name: 'the graph counter', facts: () => factsOf({ graph: { reads: 2, gated: null } }) },
  { name: 'the current build', facts: () => factsOf({ build: { kind: 'current', build: '2.1.300' } as SessionFactSet['build'] }) },
  { name: 'a subagent', facts: () => factsOf({ subagents: [{ name: 'a', startedAt: NOW - 1000 }] as SessionFactSet['subagents'] }) },
  { name: 'a delegated entry', facts: () => factsOf({ delegated: { text: '1 delegated', title: 't', note: 'n', rows: [] } as unknown as SessionFactSet['delegated'] }) },
  { name: 'a marker (needs you)', facts: () => factsOf({ needsYou: true }) },
];

const drawn = (f: SessionFactSet): boolean => {
  const { container } = render(<SessionMeta facts={f} mode="header" onOpenRun={null} />);
  const n = container.querySelector('.sess-meta')?.childElementCount ?? 0;
  cleanup();
  return n > 0;
};

describe('headerMetaHasCells agrees with what SessionMeta draws', () => {
  it('a session with nothing to say draws no cell, and the predicate says so', () => {
    const f = factsOf();
    expect(drawn(f)).toBe(false);
    expect(headerMetaHasCells(f)).toBe(false);
  });

  for (const { name, facts } of CELLS) {
    it(`${name}: drawn, and the predicate says so`, () => {
      const f = facts();
      expect(drawn(f), `${name} draws a cell`).toBe(true);
      expect(headerMetaHasCells(f), `${name} counts`).toBe(true);
    });
  }

  it('the spawn chip and the restart marker are drawn by the header itself, so a restart alone is no cell', () => {
    const f = factsOf({ restart: { text: 'restarted', title: 't', cause: 'x' } as unknown as SessionFactSet['restart'] });
    expect(drawn(f)).toBe(false);
    expect(headerMetaHasCells(f)).toBe(false);
  });
});

const headerProps = (over: Partial<HeaderHostProps>): HeaderHostProps => ({
  session: null, status: 'idle', statusUpdatedAt: null,
  onInterrupt: vi.fn(), onOpenTerminal: vi.fn(), onBack: vi.fn(), onChangeModel: vi.fn(), onChangeEffort: vi.fn(),
  onMoveAccount: vi.fn(), onArchive: vi.fn(), onRestore: vi.fn(), onOpenHistory: vi.fn(), onReapWorkspace: vi.fn(),
  ...over,
});
const phone = (): void => {
  vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({
    matches: false, media: q, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }) as unknown as MediaQueryList);
};

describe('the header draws no details row and no Details door when it has nothing to show', () => {
  for (const skin of ['refined', 'instrument'] as const) {
    for (const [who, session] of [
      ['a worker', base()],
      ['a coordinator', base({ role: 'coordinator', workspace: null, name: null, id: 'lane-a-project-a' })],
    ] as const) {
      it(`${skin}, on a phone: ${who} with no facts has neither`, () => {
        phone();
        act(() => setSkin(skin));
        const f = sessionFacts({ session, now: NOW });
        expect(detailsHaveFacts(f, null), 'the decision').toBe(false);
        render(<SessionHeaderHost {...headerProps({ session, status: session.status, facts: f })} />);
        expect(document.querySelector('.chat-facts'), 'no details row').toBeNull();
        expect(screen.queryByRole('button', { name: /details/i }), 'no Details door').toBeNull();
      });
    }

    it(`${skin}, on a phone: a session whose details are worktrees only keeps the row and its door, and loses both with the last worktree`, () => {
      phone();
      act(() => setSkin(skin));
      const session = base();
      const withTree = factsOf({ worktrees: [WORKTREE] }, session);
      expect(detailsHaveFacts(withTree, null), 'the worktree is a fact').toBe(true);
      expect(detailsEndWithWorktrees(withTree, null), 'with nothing else, the row ends with its last worktree').toBe(true);
      expect(detailsEndWithWorktrees(factsOf({ worktrees: [WORKTREE], tasks: { done: 1, total: 2 } }, session), null), 'another fact keeps the row').toBe(false);
      const { rerender } = render(<SessionHeaderHost {...headerProps({ session, status: session.status, facts: withTree })} />);
      expect(screen.getByRole('button', { name: /details/i })).toBeInTheDocument();
      rerender(<SessionHeaderHost {...headerProps({ session, status: session.status, facts: factsOf({ worktrees: [] }, session) })} />);
      expect(document.querySelector('.chat-facts')).toBeNull();
      expect(screen.queryByRole('button', { name: /details/i })).toBeNull();
    });
  }

  it('each of the row\'s own facts brings the row back (a PR here)', () => {
    const session = base({ pr: { phase: 'open', number: 9, url: null, title: null, checks: 'pass', checkNames: null, ahead: 1, reason: null, checkedAt: 1, mergedAt: null, retryAt: null } as FleetSession['pr'] });
    expect(detailsHaveFacts(factsOf({}, session), null)).toBe(true);
  });

  it('on a desk the row is drawn for its facts and absent without them', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({
      matches: q.includes('min-width: 900px'), media: q, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
    }) as unknown as MediaQueryList);
    const { container, rerender } = render(<SessionDetails facts={factsOf()} coordination={null} />);
    expect(container.querySelector('.chat-facts')).toBeNull();
    rerender(<SessionDetails facts={factsOf({ tasks: { done: 1, total: 2 } })} coordination={null} />);
    expect(container.querySelector('.chat-facts')).not.toBeNull();
  });
});

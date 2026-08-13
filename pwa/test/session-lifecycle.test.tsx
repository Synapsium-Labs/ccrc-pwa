// Task 12 — the PWA half of D3 and D4 (spec §4.4, §5.2). Three surfaces:
// the fleet row says WHICH KIND of dead it is without moving buckets (M10),
// the orphan row's control names the verb that revives it, and a chat whose
// transcript came from somewhere else says so instead of claiming there is
// nothing to show. The last one is the incident's own surface: 70MB of
// intact history rendered as "No messages yet" on 2026-08-11.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { ChatEvent, FleetSession, RosterWire, SessionLifecycle, SessionStreamMsg } from '../../shared/api';
import { BUCKET_ORDER, RANK, sortFleet } from '../src/fleet/sortFleet';
import { lifecycleQualifier } from '../src/fleet/lifecycleWords';
import { SessionLine } from '../src/fleet/SessionLine';
import { SessionActionsSheet } from '../src/fleet/SessionActionsSheet';
import { SessionScreen } from '../src/screens/SessionScreen';
import { createSessionStore, type SessionStore } from '../src/stores/session';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';
import { TEST_ROSTER } from './rosterFixture';

// SessionScreen renders ChatList, and Virtuoso needs a real viewport jsdom
// does not have — the same stand-in chat.test.tsx installs, for the reason
// its own comment gives.
vi.mock('react-virtuoso', async () => {
  const React = await import('react');
  return {
    Virtuoso: (props: {
      totalCount: number;
      itemContent: (i: number) => ReactNode;
      computeItemKey?: (i: number) => string | number;
    }) =>
      React.createElement(
        'div',
        { 'data-testid': 'virtuoso' },
        Array.from({ length: props.totalCount }, (_, i) =>
          React.createElement('div', { key: props.computeItemKey?.(i) ?? i }, props.itemContent(i)),
        ),
      ),
  };
});

// vitest runs without globals, so RTL's auto-cleanup never registers itself.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// — fixtures —

const MIN = 60_000;
const TS = '2026-08-11T21:32:00.000Z';

const s = (over: Partial<FleetSession> = {}): FleetSession => ({
  id: 'demo-quiet-mesa', wrapper: 'claude', home: 'claude', project: 'demo',
  workdir: '/w/demo/quiet-mesa', workspace: 'quiet-mesa', name: null,
  status: 'idle', statusUpdatedAt: null, limits: null, dialogPending: false,
  version: null, model: null, effort: null, ultracode: false, branch: null,
  tasks: null, pr: null, archivedAt: null, archivedBytes: null, held: null,
  hookState: null, askSummary: null, subagents: null,
  bucket: 'idle', bucketSince: null, unmeasured: [],
  lifecycle: null, stoppedBy: null, swapBlocked: null, ...over,
});

const line = (session: FleetSession): void => {
  render(<SessionLine session={session} onOpen={() => {}} onActions={() => {}} />);
};

const makeStore = (id = 'claude:OpenClawHetzner'): SessionStore =>
  createSessionStore(id, {
    makeSocket: () =>
      ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket,
    api: { prompt: vi.fn().mockResolvedValue(undefined) },
  });

/** A fleet store carrying a real roster, so `accountLabel` resolves the
 *  jargon-free name — the stranded-history banner is the one surface this
 *  file needs a wrapper id to come back as something a human reads rather
 *  than the raw account id. Never `.connect()`ed: SessionScreen only drives
 *  the SESSION store's socket lifecycle (its own `useEffect` never touches
 *  `fleet`), so this store needs no `makeSocket` to stay inert. */
const makeFleet = (roster: readonly RosterWire[] = TEST_ROSTER): FleetStore => {
  const store = createFleetStore();
  act(() => { store.setState({ roster }); });
  return store;
};

type Backlog = Extract<SessionStreamMsg, { type: 'backlog' }>;

/** Drives the REAL wire→reducer→store→screen path rather than setState-ing
 *  the answer in, so a reducer that drops the new fields fails here. */
const applyBacklog = (store: SessionStore, msg: Backlog): void => {
  act(() => {
    store.getState().apply(msg);
  });
};

const someEvent: ChatEvent = { kind: 'user', uuid: 'e1', ts: TS, text: 'the history that was never lost' };

// — the qualifier itself —

describe('lifecycleQualifier', () => {
  // Kills a mutant that reads Date.now() inside the function: the row's
  // "2d ago" would then be untestable and the pure table would not be pure.
  it('reads the stop stamp against the clock it is handed, not a hidden Date.now()', () => {
    const now = 1_800_000_000_000;
    expect(lifecycleQualifier({ lifecycle: 'stopped', stoppedBy: { at: now - 90 * MIN, surface: 'agent' } }, now))
      .toBe('stopped by agent, 1h ago');
  });

  // Kills `stoppedBy!.surface` — a stop whose stamp was half-read still has a
  // word, and the row must not throw to say it.
  it('a stop with no stamp still says stopped', () => {
    expect(lifecycleQualifier({ lifecycle: 'stopped', stoppedBy: null }, 0)).toBe('stopped');
  });
});

// — the row —

describe('the row says which kind of dead it is', () => {
  // Kills a mutant that prints the raw epoch, or drops the surface: this is
  // the 21:39:53 agent-surface stop, finally legible on the row it killed.
  it('a stopped row names the surface and how long ago', () => {
    const at = Date.now() - 2 * 24 * 60 * MIN;
    line(s({ status: 'dead', bucket: 'dead', lifecycle: 'stopped', stoppedBy: { at, surface: 'pwa' } }));
    expect(screen.getByText('stopped by pwa, 2d ago')).toBeInTheDocument();
  });

  // Kills a mutant that renders 'stopped' for orphan too — the whole point of
  // the field is that these are different facts with different remedies.
  it('an orphan row says nothing is watching it', () => {
    line(s({ status: 'dead', bucket: 'dead', lifecycle: 'orphan' }));
    expect(screen.getByText('orphan — nothing is watching it')).toBeInTheDocument();
  });

  // Kills `dead && qualifier !== null` — 'running unsupervised' describes a
  // LIVE pane with no supervisor (what a pre-fix `ccd start` minted), and a
  // dead-only gate would make the one state D2 exists for invisible.
  it('a LIVE unsupervised row says so — the qualifier is not gated on dead', () => {
    line(s({ status: 'idle', bucket: 'idle', lifecycle: 'unsupervised' }));
    expect(screen.getByText('running unsupervised')).toBeInTheDocument();
  });

  // Kills a table that gives `running` a word: a healthy row has nothing to
  // qualify, and a chip on every row is a chip nobody reads.
  it('a healthy running row says nothing', () => {
    line(s({ lifecycle: 'running' }));
    expect(screen.queryByText(/unsupervised|nothing is watching|stopped by/)).not.toBeInTheDocument();
  });

  // Spec §4.3's hard rule, on the render surface: an unreadable registry must
  // never print `orphan`. Kills a mutant folding unmeasurable into orphan.
  it('an unmeasurable lifecycle says the field is unreadable — never orphan', () => {
    line(s({ status: 'dead', bucket: 'dead', lifecycle: 'unmeasurable' }));
    expect(screen.getByText('lifecycle unreadable')).toBeInTheDocument();
    expect(screen.queryByText(/orphan/)).not.toBeInTheDocument();
  });

  // M10's own hazard pointed the other way: a NEWER server minting a token
  // this build has never heard of. Kills `QUALIFIER[lc]!` and any throwing
  // default — same lesson runWords.ts's `runState` records.
  it('a lifecycle this build has never heard of renders no qualifier and does not throw', () => {
    line(s({ status: 'dead', bucket: 'dead', lifecycle: 'quantum' as SessionLifecycle }));
    expect(screen.getByText('exited')).toBeInTheDocument();
  });

  // The live `fleet` frame is CAST, not revived (`stores/fleet.ts`'s
  // asFleetMsg), so a row from a server that predates this field genuinely
  // lacks the keys at runtime even though the type says otherwise — exactly
  // the TypeError `unmeasuredFields`' docstring records. Kills a direct
  // `session.stoppedBy.surface` read and a dropped `?? null`.
  it('a row from a server that predates the field renders no qualifier', () => {
    const older = s({ status: 'dead', bucket: 'dead' }) as unknown as Record<string, unknown>;
    delete older['lifecycle'];
    delete older['stoppedBy'];
    delete older['swapBlocked'];
    line(older as unknown as FleetSession);
    expect(screen.getByText('exited')).toBeInTheDocument();
  });

  // M10, stated as a pin. Kills adding `orphan` (or any lifecycle word) to
  // RANK, and kills a WORD table that switches on lifecycle.
  it('the qualifier changes NO bucket: dead+orphan sorts and reads exactly like dead', () => {
    expect(Object.keys(RANK).sort()).toEqual(
      ['archived', 'attention', 'cleanup', 'dead', 'done', 'idle', 'working']);
    expect(BUCKET_ORDER).toHaveLength(7);
    expect(BUCKET_ORDER.at(-1)).toBe('dead');

    const orphan = s({ id: 'a', status: 'dead', bucket: 'dead', lifecycle: 'orphan', statusUpdatedAt: 2 });
    const plain = s({ id: 'b', status: 'dead', bucket: 'dead', lifecycle: null, statusUpdatedAt: 1 });
    const live = s({ id: 'c', status: 'idle', bucket: 'idle', statusUpdatedAt: 3 });
    expect(sortFleet([orphan, plain, live]).map((x) => x.id)).toEqual(['c', 'a', 'b']);

    line(orphan);
    expect(screen.getByText('exited')).toBeInTheDocument();
  });

  // §2.4: the refusal's DURABLE channel is a registry field, not the notice
  // (M9 — a notice raised with no socket open is gone). Kills rendering it as
  // a toast, and kills a cell that clears itself on the next fleet tick.
  it('a blocked swap states its reason on the row, and keeps stating it', () => {
    const reason = 'no transcript found for uuid b7001948';
    const blocked = s({ swapBlocked: { at: Date.now() - 5 * MIN, reason } });
    const { rerender } = render(<SessionLine session={blocked} onOpen={() => {}} onActions={() => {}} />);
    expect(document.querySelector('.sess-swapblocked')?.getAttribute('title')).toBe(reason);
    expect(screen.getByText(`swap blocked — ${reason}`)).toBeInTheDocument();
    rerender(<SessionLine session={blocked} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText(`swap blocked — ${reason}`)).toBeInTheDocument();
  });

  it('says nothing about swaps when none was refused', () => {
    line(s());
    expect(document.querySelector('.sess-swapblocked')).toBeNull();
  });
});

// — the revive control —

describe("the orphan row's control names what revives it", () => {
  // §4.4: no new argv, no new grant, no new caps line — the button that
  // already exists becomes the revive button because §3.1 made `ensure`
  // restore supervision. Kills a mutant that mints a new route or a new verb.
  it('names ccd start <id> and posts to the existing ensure route', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<SessionActionsSheet session={s({ status: 'dead', bucket: 'dead', lifecycle: 'orphan' })}
                                open onClose={() => {}} onReap={() => {}} />);
    expect(screen.getByText(/ccd start demo-quiet-mesa/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Restart session'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/api/sessions/demo-quiet-mesa/ensure');
  });

  // Kills a note rendered unconditionally: a healthy session is not orphaned
  // and telling its operator "nothing is watching this" would be a lie.
  it('a session nobody orphaned gets no revive note', () => {
    render(<SessionActionsSheet session={s({ lifecycle: 'running' })}
                                open onClose={() => {}} onReap={() => {}} />);
    expect(screen.queryByText(/ccd start/)).not.toBeInTheDocument();
  });
});

// — the chat —

describe('a chat that had to look elsewhere says so', () => {
  // Rung 6 (§5.1): the file is real and it renders, but never silently —
  // M2 measured 17 of 23 rows carrying residue under 1-4 OTHER accounts.
  // Kills a resolver answer whose `foreignAccount` is dropped on the way to
  // the UI. Field names are the wire's real ones (`shared/api.ts:1759-1770`)
  // — `foreignAccount`/`searchComplete`, not the brief's `account`/`complete`.
  it('a transcript found under ANOTHER account is bannered by name', () => {
    const store = makeStore();
    const fleet = makeFleet();
    render(<SessionScreen id="claude:OpenClawHetzner" store={store} fleet={fleet} />);
    applyBacklog(store, {
      type: 'backlog', uuid: 'b7001948', offset: 120, missing: false,
      file: '/home/rc/.claude/projects/-data-projects-x/b7001948.jsonl',
      foreignAccount: 'claude', searchComplete: true, events: [someEvent],
    });
    expect(screen.getByText(/Stranded history — read from team·max/)).toBeInTheDocument();
    expect(screen.queryByText('No messages yet')).not.toBeInTheDocument();
  });

  it('a transcript found on this session own account raises no banner', () => {
    const store = makeStore();
    const fleet = makeFleet();
    render(<SessionScreen id="claude:OpenClawHetzner" store={store} fleet={fleet} />);
    applyBacklog(store, {
      type: 'backlog', uuid: 'u1', offset: 10, missing: false,
      file: '/home/rc/.claude/projects/x/u1.jsonl',
      foreignAccount: null, searchComplete: true, events: [someEvent],
    });
    expect(screen.queryByText(/Stranded history/)).not.toBeInTheDocument();
  });

  // §5.2's whole point, and rule (b): an UNMEASURED absence is not a measured
  // one. Kills one sentence serving both failures.
  it("an unfinished search says the fleet host is unreadable — a DIFFERENT sentence from 'no messages'", () => {
    const store = makeStore();
    const fleet = makeFleet();
    render(<SessionScreen id="claude:OpenClawHetzner" store={store} fleet={fleet} />);
    applyBacklog(store, {
      type: 'backlog', uuid: 'u1', offset: 0, missing: true,
      file: '/home/rc/.claude/projects/x/u1.jsonl', searchComplete: false, events: [],
    });
    expect(screen.getByText("Can't read the fleet host right now")).toBeInTheDocument();
    expect(screen.queryByText("Can't find this session's transcript")).not.toBeInTheDocument();
    expect(screen.queryByText('No messages yet')).not.toBeInTheDocument();
  });

  // The other half of the same pair. Kills a mutant that always prints the
  // host-unreadable sentence, and one that always suppresses the empty state.
  it('a COMPLETE search that found nothing keeps today sentence and today empty state', () => {
    const store = makeStore();
    const fleet = makeFleet();
    render(<SessionScreen id="claude:OpenClawHetzner" store={store} fleet={fleet} />);
    applyBacklog(store, {
      type: 'backlog', uuid: 'u1', offset: 0, missing: true,
      file: '/home/rc/.claude/projects/x/u1.jsonl', searchComplete: true, events: [],
    });
    expect(screen.getByText("Can't find this session's transcript")).toBeInTheDocument();
    expect(screen.queryByText("Can't read the fleet host right now")).not.toBeInTheDocument();
    expect(screen.getByText('No messages yet')).toBeInTheDocument();
  });

  // Kills `searchComplete: msg.searchComplete ?? false`, which would make every
  // session on every pre-field server report the fleet host unreadable.
  it('an older server that sends neither field is a COMPLETE search', () => {
    const store = makeStore();
    const fleet = makeFleet();
    render(<SessionScreen id="claude:OpenClawHetzner" store={store} fleet={fleet} />);
    applyBacklog(store, {
      type: 'backlog', uuid: 'u1', offset: 0, missing: true,
      file: '/home/rc/.claude/projects/x/u1.jsonl', events: [],
    } as Backlog);
    expect(screen.getByText("Can't find this session's transcript")).toBeInTheDocument();
    expect(screen.queryByText("Can't read the fleet host right now")).not.toBeInTheDocument();
  });

  // The unarrived-roster case (DISPATCH-CONTEXT's task-12 addendum): a
  // `/s/:id` deep link that never mounted FleetScreen's own accounts poller
  // has `roster: []` (`stores/fleet.ts`'s own default, deliberately, for
  // exactly this window). `accountLabel` degrades to the raw wrapper id
  // rather than a blank cell or a throw — the same fallback SessionLine and
  // SessionActionsSheet already lean on. Kills a banner that goes blank (or
  // omits itself) before the roster has arrived, and any implementation that
  // reads a roster entry unguarded.
  it('a stranded banner names the raw account id before the roster has arrived', () => {
    const store = makeStore();
    const fleet = createFleetStore(); // roster: [] — nothing seeded, nothing polled
    render(<SessionScreen id="claude:OpenClawHetzner" store={store} fleet={fleet} />);
    applyBacklog(store, {
      type: 'backlog', uuid: 'b7001948', offset: 120, missing: false,
      file: '/home/rc/.claude/projects/-data-projects-x/b7001948.jsonl',
      foreignAccount: 'claude', searchComplete: true, events: [someEvent],
    });
    expect(screen.getByText(/Stranded history — read from claude,/)).toBeInTheDocument();
  });
});

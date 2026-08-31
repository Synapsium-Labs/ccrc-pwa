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
  workdir: '/w/demo/quiet-mesa', workspace: 'quiet-mesa', name: null, title: null,
  status: 'idle', statusUpdatedAt: null, limits: null, dialogPending: false,
  version: null, model: null, effort: null, ultracode: false, branch: null,
  tasks: null, pr: null, archivedAt: null, archivedBytes: null, held: null,
  hookState: null, askSummary: null, subagents: null,
  bucket: 'idle', bucketSince: null, unmeasured: [], statusUnmeasured: false,
  lifecycle: null, stoppedBy: null, swapBlocked: null, substrate: null, started: true, spawnState: null, ...over,
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

  // Fix round 1 (task 14 follow-up, Row 78): distinct from the test above.
  // That one passes an EXPLICIT `stoppedBy: null`; this one deletes the key
  // entirely, which is what a server that predates the field actually sends
  // for a row whose OWN `lifecycle` field the caller DOES already have (the
  // pre-existing "row from a server that predates the field" test at the
  // component level deletes `lifecycle` too, so it returns at the function's
  // FIRST guard and never reaches this branch at all — a mutant here
  // survived that test undetected). `session.stoppedBy` is `undefined`, not
  // `null`, when the key is genuinely absent; `by === null` must still be
  // false-safe rather than reaching `by!.surface` on `undefined`. Kills
  // `const by = session.stoppedBy;` (dropped `?? null`) with a REAL
  // `TypeError: Cannot read properties of undefined`, not just a wrong
  // string.
  it('a stopped lifecycle with a genuinely MISSING stoppedBy key (not explicit null) still says stopped, and does not throw', () => {
    const noStamp = { lifecycle: 'stopped' as const } as { lifecycle: 'stopped'; stoppedBy?: never };
    expect(() => lifecycleQualifier(noStamp, 0)).not.toThrow();
    expect(lifecycleQualifier(noStamp, 0)).toBe('stopped');
  });

  // Final review, Minor 5. The guard above tolerates a missing OBJECT; it did
  // not tolerate missing KEYS, and the live `fleet` frame is CAST, not revived
  // (`stores/fleet.ts`'s `asFleetMsg`), with ccd and the server independently
  // versioned either side of it. Measured against cast frames at HEAD:
  // `{surface:'pwa'}` rendered "stopped by pwa, NaNd ago" and `{at:…}`
  // rendered "stopped by undefined, <1m ago". Neither threw — the
  // screen-blanking hazard really is closed — but a row that says NaNd is a
  // row nobody can act on, and "stopped by undefined" invents a surface.
  //
  // The rule: say only what the frame actually carries. Four shapes, four
  // sentences, and each half degrades independently — a fix that collapses a
  // half-read stamp to bare 'stopped' throws away the half that WAS read.
  const half = (by: unknown): string | null =>
    lifecycleQualifier(
      { lifecycle: 'stopped', stoppedBy: by } as unknown as { lifecycle: 'stopped' },
      3 * 60 * MIN,
    );

  it('a stop stamp with no `at` names the surface and stops there — never NaNd', () => {
    expect(half({ surface: 'pwa' })).toBe('stopped by pwa');
    expect(half({ surface: 'pwa', at: 'yesterday' })).toBe('stopped by pwa');
    expect(half({ surface: 'pwa', at: Number.NaN })).toBe('stopped by pwa');
  });

  it('a stop stamp with no surface gives the age and stops there — never "by undefined"', () => {
    expect(half({ at: 1 * 60 * MIN })).toBe('stopped, 2h ago');
    expect(half({ at: 1 * 60 * MIN, surface: '' })).toBe('stopped, 2h ago');
    expect(half({ at: 1 * 60 * MIN, surface: 7 })).toBe('stopped, 2h ago');
  });

  it('a stop stamp carrying neither is just stopped', () => {
    expect(half({})).toBe('stopped');
    expect(half('stopped-by-a-string')).toBe('stopped');
  });

  // The whole-field case still works, so the degrade above cannot have been
  // bought by weakening the ordinary answer.
  it('a whole stamp still reads as it always did', () => {
    expect(half({ at: 2 * 60 * MIN, surface: 'ccd' })).toBe('stopped by ccd, 1h ago');
  });
});

// — the row —

describe('the row says which kind of dead it is', () => {
  // Kills a mutant that prints the raw epoch, or drops the surface: this is
  // the 21:39:53 agent-surface stop, finally legible on the row it killed.
  // The `title` assertion is the cell's ONLY tooltip on a phone, where the
  // ellipsis is real — pinned the same way `.sess-swapblocked`'s already is
  // below (review round 1, Minor: deleting `.sess-lifecycle`'s `title` had
  // no test to catch it).
  it('a stopped row names the surface and how long ago', () => {
    const at = Date.now() - 2 * 24 * 60 * MIN;
    line(s({ status: 'dead', bucket: 'dead', lifecycle: 'stopped', stoppedBy: { at, surface: 'pwa' } }));
    expect(screen.getByText('stopped by pwa, 2d ago')).toBeInTheDocument();
    expect(document.querySelector('.sess-lifecycle')?.getAttribute('title')).toBe('stopped by pwa, 2d ago');
  });

  // Kills a mutant that renders 'stopped' for orphan too — the whole point of
  // the field is that these are different facts with different remedies.
  it('an orphan row says nothing is watching it', () => {
    line(s({ status: 'dead', bucket: 'dead', lifecycle: 'orphan' }));
    expect(screen.getByText('orphan — nothing is watching it')).toBeInTheDocument();
  });

  it('an unclaimed row names the OPPOSITE repair from an orphan', () => {
    // orphan: nothing is bringing this back — the repair is a PROCESS.
    // unclaimed: a process is running that no registry row claims — the repair is
    // a CLAIM. A single sentence for both would send the operator to the wrong verb.
    line(s({ lifecycle: 'unclaimed' }));
    const cell = document.querySelector('.sess-lifecycle');
    expect(cell).not.toBeNull();
    expect(cell?.getAttribute('data-lifecycle')).toBe('unclaimed');
    expect(cell?.textContent).toBe('unclaimed — a live pane with no claim');
    expect(cell?.textContent).not.toContain('nothing is watching');
  });

  it('does NOT inherit running\'s deliberate null — the chip renders for unclaimed', () => {
    expect(lifecycleQualifier({ lifecycle: 'unclaimed' })).not.toBeNull();
    expect(lifecycleQualifier({ lifecycle: 'running' })).toBeNull();
  });

  // Kills `dead && qualifier !== null` — 'running unsupervised' describes a
  // LIVE pane with no supervisor (what a pre-fix `ccd start` minted), and a
  // dead-only gate would make the one state D2 exists for invisible.
  it('a LIVE unsupervised row says so — the qualifier is not gated on dead', () => {
    line(s({ status: 'idle', bucket: 'idle', lifecycle: 'unsupervised' }));
    expect(screen.getByText('running unsupervised')).toBeInTheDocument();
  });

  // Kills a table that gives `running` a word: a healthy row has nothing to
  // qualify, and a chip on every row is a chip nobody reads. The regex names
  // `running` explicitly (review round 1, Important 2) — without it,
  // `QUALIFIER.running = 'running'` renders a real qualifier chip and this
  // assertion still passes, because none of the OTHER words match either.
  it('a healthy running row says nothing', () => {
    line(s({ lifecycle: 'running' }));
    expect(screen.queryByText(/running|unsupervised|nothing is watching|stopped by/)).not.toBeInTheDocument();
  });

  // Spec §4.3's hard rule, on the render surface: an unreadable registry must
  // never print `orphan`. Kills a mutant folding unmeasurable into orphan.
  it('an unmeasurable lifecycle says the field is unreadable — never orphan', () => {
    line(s({ status: 'dead', bucket: 'dead', lifecycle: 'unmeasurable' }));
    expect(screen.getByText('lifecycle unreadable')).toBeInTheDocument();
    expect(screen.queryByText(/orphan/)).not.toBeInTheDocument();
  });

  // `unmeasurable` is the classifier's FIRST rung (spec §4.3), so it outranks
  // directly observed facts: a live pane with a fresh heartbeat plus a
  // leftover unreadable stop stamp classifies `unmeasurable` while ccd would
  // answer a live word for the same session. Every fixture above pairs
  // `unmeasurable` with `dead` — this is the ALIVE one (review round 1,
  // Important 3): without it, `qualifier !== null && !(session.lifecycle ===
  // 'unmeasurable' && session.status !== 'dead')` silences exactly the row
  // this rung exists to keep visible, and the suite stays green.
  it('a LIVE unmeasurable row still says the field is unreadable', () => {
    line(s({ status: 'idle', bucket: 'idle', lifecycle: 'unmeasurable' }));
    expect(screen.getByText('lifecycle unreadable')).toBeInTheDocument();
  });

  // M10's own hazard pointed the other way: a NEWER server minting a token
  // this build has never heard of. Kills `QUALIFIER[lc]!` and any throwing
  // default — same lesson runWords.ts's `runState` records.
  //
  // Fix round 1 (task 14 follow-up, Row 77): the ORIGINAL version of this
  // test asserted only `screen.getByText('exited')` — the bucket's own state
  // word, present regardless of the qualifier — so it never actually checked
  // "renders no qualifier" despite the title's claim. `QUALIFIER[lc]!`
  // returns `undefined` rather than throwing on a plain-object miss, so the
  // "does not throw" half was ALSO never in danger from that mutant — this
  // survived undetected under the old assertion. The `.sess-lifecycle` cell
  // only renders at all when `qualifier !== null` (SessionLine.tsx), so its
  // outright ABSENCE from the DOM is the precise, positive proof that an
  // unmapped token degrades to nothing rather than to a stray `undefined`
  // cell.
  it('a lifecycle this build has never heard of renders no qualifier and does not throw', () => {
    line(s({ status: 'dead', bucket: 'dead', lifecycle: 'quantum' as SessionLifecycle }));
    expect(screen.getByText('exited')).toBeInTheDocument();
    expect(document.querySelector('.sess-lifecycle')).toBeNull();
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

  // Final review, Minor 5, same shape one cell over: measured at HEAD, a
  // `swapBlocked` carrying only `at` rendered "swap blocked — undefined". The
  // marker's PRESENCE is the durable fact §2.4 is about and must survive a
  // reason this row could not read; the word `undefined` beside it is not a
  // reason, it is a bug rendered as one.
  it('a refusal with no readable reason still says a swap was blocked, without inventing one', () => {
    const noReason = { at: Date.now() - 5 * MIN } as unknown as FleetSession['swapBlocked'];
    line(s({ swapBlocked: noReason }));
    const cell = document.querySelector('.sess-swapblocked');
    expect(cell?.textContent).toBe('swap blocked');
    expect(cell?.getAttribute('title')).toBe('swap blocked');
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
  });

  it('an empty reason string is no reason at all', () => {
    line(s({ swapBlocked: { at: Date.now() - 5 * MIN, reason: '' } }));
    expect(document.querySelector('.sess-swapblocked')?.textContent).toBe('swap blocked');
  });

  // Final review, Minor 4 — the pin behind a comment that used to claim the
  // opposite. `server/src/fleet.ts` computes `lifecycle` for EVERY row,
  // archived ones included, and justified it with "the renderer does not show
  // the qualifier there". Measured: it does. `.sess-lifecycle` is gated on
  // `qualifier !== null` and on nothing else — no bucket appears in that
  // condition, deliberately (M10: a renderer that branches on a bucket token
  // is a renderer an unknown token can break). So an archived row prints
  // `stopped by ccd, 12d ago` beside its state word, and a `cleanup` row —
  // which sits in the LIVE list — prints it too, where it is genuinely
  // useful: stopped by ccd and stopped by an agent are different facts about
  // a workspace queued for reaping. This pins the behaviour the comment now
  // describes, so the two cannot drift apart again in either direction.
  it('an archived row DOES show its qualifier — the renderer knows no buckets', () => {
    line(s({ status: 'dead', bucket: 'archived', archivedAt: 1_700_000_000,
             lifecycle: 'stopped', stoppedBy: { at: Date.now() - 12 * 24 * 60 * MIN, surface: 'ccd' } }));
    expect(screen.getByText('stopped by ccd, 12d ago')).toBeInTheDocument();
  });

  it('a cleanup row shows it too, in the live list where it is worth reading', () => {
    line(s({ status: 'dead', bucket: 'cleanup',
             lifecycle: 'stopped', stoppedBy: { at: Date.now() - 3 * 24 * 60 * MIN, surface: 'ccd' } }));
    expect(screen.getByText('stopped by ccd, 3d ago')).toBeInTheDocument();
  });
});

// — the revive control —

describe("the row that can be revived says so, and names what revives it", () => {
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

  // Final review, Important 2 — the state D2 exists for, which had the note
  // gated away from it. `unsupervised` is a LIVE pane with no supervisor, and
  // on deploy day it is every pane a pre-fix `ccd start` minted. The ccd lane
  // measured the contract that makes the affordance real: `ensure` on a
  // live-but-unsupervised session emits `reset-failed` + `enable --now` (ccd's
  // `_resupervise_live`) and the row afterwards reads `running`; on an
  // already-supervised live session it stays the cheap no-op it always was.
  // Before that fix the button answered success and changed nothing, which is
  // this branch's own defect species — so the note ships only now.
  it('a LIVE unsupervised row is offered the same revive control', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<SessionActionsSheet session={s({ status: 'idle', bucket: 'idle', lifecycle: 'unsupervised' })}
                                open onClose={() => {}} onReap={() => {}} />);
    expect(screen.getByText(/ccd start demo-quiet-mesa/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Restart session'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/api/sessions/demo-quiet-mesa/ensure');
  });

  // The wording has to be true of THIS state, not borrowed from the orphan's.
  // An `unsupervised` pane is running: its conversation is intact, nothing is
  // restarted, and `enable --now` adopts the pane rather than spawning beside
  // it (ccd's `_resupervise_live`, measured). Telling that operator "nothing
  // is watching this session" — the orphan's sentence, written for a pane
  // that is GONE — would read as "your session is dead" over a live one, and
  // "Restart session" beside it as "this will restart my work". Kills a fix
  // that widens the gate and reuses the orphan copy.
  it('says the pane is running and nothing supervises it — never the orphan sentence', () => {
    render(<SessionActionsSheet session={s({ status: 'idle', bucket: 'idle', lifecycle: 'unsupervised' })}
                                open onClose={() => {}} onReap={() => {}} />);
    expect(screen.getByText(/running, but nothing is supervising it/)).toBeInTheDocument();
    expect(screen.getByText(/adopts the running pane/)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing is watching this session/)).not.toBeInTheDocument();
  });

  // And the orphan keeps its own, for the opposite reason: that pane IS gone.
  // Both directions, so neither sentence can be deleted in favour of one
  // shared wording that is false of one of the two states.
  it('an orphan keeps the sentence written for a pane that is gone', () => {
    render(<SessionActionsSheet session={s({ status: 'dead', bucket: 'dead', lifecycle: 'orphan' })}
                                open onClose={() => {}} onReap={() => {}} />);
    expect(screen.getByText(/Nothing is watching this session/)).toBeInTheDocument();
    expect(screen.queryByText(/running, but nothing is supervising it/)).not.toBeInTheDocument();
  });

  // Kills a note rendered unconditionally: a healthy session is not orphaned
  // and telling its operator "nothing is watching this" would be a lie. It is
  // also the row `_resupervise_live` deliberately refuses to touch — a
  // `systemctl --user enable --now` per click on a healthy fleet — so a note
  // here would advertise a call the fleet host answers with nothing.
  it('a session nobody orphaned gets no revive note', () => {
    render(<SessionActionsSheet session={s({ lifecycle: 'running' })}
                                open onClose={() => {}} onReap={() => {}} />);
    expect(screen.queryByText(/ccd start/)).not.toBeInTheDocument();
    expect(screen.queryByText(/nothing is supervising/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Nothing is watching/)).not.toBeInTheDocument();
  });

  // The two tests above only ever use `orphan` and `running`, so
  // `session.lifecycle === 'orphan'` and `session.lifecycle !== 'running'`
  // read identically to both of them (review round 1, Minor). A deliberately
  // STOPPED session — the fact this whole branch exists to keep distinct
  // from `orphan` — is the row that tells the two guards apart: under the
  // wrong one, a stopped session is told "Nothing is watching this session"
  // and offered `ccd start`, exactly the conflation D2/D3 exist to end.
  it('a stopped session (not orphaned) gets no revive note either', () => {
    render(<SessionActionsSheet
      session={s({ status: 'dead', bucket: 'dead', lifecycle: 'stopped', stoppedBy: { at: Date.now(), surface: 'pwa' } })}
      open onClose={() => {}} onReap={() => {}} />);
    expect(screen.queryByText(/ccd start/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Nothing is watching/)).not.toBeInTheDocument();
  });
});

// — the chat —

describe('a chat that had to look elsewhere says so', () => {
  // Rung 6 (§5.1): the file is real and it renders, but never silently —
  // M2 measured 17 of 23 rows carrying residue under 1-4 OTHER accounts.
  // Kills a resolver answer whose `foreignAccount` is dropped on the way to
  // the UI. Field names are the wire's real ones (`shared/api.ts:1759-1770`)
  // — `foreignAccount`/`searchComplete`, not the brief's `account`/`complete`.
  //
  // `foreignAccount: 'claude2'`, deliberately NOT `'claude'`: this session's
  // id is `claude:OpenClawHetzner`, so its OWN wrapper is `claude` — a
  // foreign account of `'claude'` cannot distinguish "read from the OTHER
  // account" from "read from the banner's own account" and would pass just
  // as well under `accountLabel(roster, wrapper)` as under the correct
  // `accountLabel(roster, strandedAccount)` (review round 1, Important 1).
  it('a transcript found under ANOTHER account is bannered by name', () => {
    const store = makeStore();
    const fleet = makeFleet();
    render(<SessionScreen id="claude:OpenClawHetzner" store={store} fleet={fleet} />);
    applyBacklog(store, {
      type: 'backlog', uuid: 'b7001948', offset: 120, missing: false,
      file: '/home/rc/.claude/projects/-data-projects-x/b7001948.jsonl',
      foreignAccount: 'claude2', searchComplete: true, events: [someEvent],
    });
    expect(screen.getByText(/Stranded history — read from team·alt/)).toBeInTheDocument();
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

  // The re-point path (an earlier task on this branch) makes a SECOND
  // `backlog` frame for the same session routine, not exotic — an open
  // stream that follows the transcript when the answer changes. No test
  // applied two frames to one store before this (review round 1, Minor):
  // `msg.foreignAccount ?? s.strandedAccount` carries the PREVIOUS banner
  // forward on a later frame that omits the field, and it survived because
  // every fixture here applied exactly one frame.
  it('a later backlog frame with no foreignAccount clears a stranded banner', () => {
    const store = makeStore();
    const fleet = makeFleet();
    render(<SessionScreen id="claude:OpenClawHetzner" store={store} fleet={fleet} />);
    applyBacklog(store, {
      type: 'backlog', uuid: 'b7001948', offset: 120, missing: false,
      file: '/home/rc/.claude/projects/-data-projects-x/b7001948.jsonl',
      foreignAccount: 'claude2', searchComplete: true, events: [someEvent],
    });
    expect(screen.getByText(/Stranded history/)).toBeInTheDocument();

    applyBacklog(store, {
      type: 'backlog', uuid: 'b7001948', offset: 130, missing: false,
      file: '/home/rc/.claude/projects/x/b7001948.jsonl',
      searchComplete: true, events: [someEvent],
    } as Backlog);
    expect(screen.queryByText(/Stranded history/)).not.toBeInTheDocument();
  });

  // Final review, Minor 6, at the surface the operator actually reads. A
  // `rotated` (clear/compact/swap onto a fresh uuid) used to leave the
  // stranded banner standing, naming a foreign account for a transcript this
  // client no longer reads. The server normally follows `rotated` with a
  // backlog on the very next statement, so it is usually a one-frame window
  // — but that send can fail and the socket can die between the two frames,
  // and this banner is the one surface whose whole job is to be believed.
  // Driven through the real reducer, one frame at a time, with NO backlog
  // behind the rotation: exactly the window.
  it('a rotation takes the stranded banner with it', () => {
    const store = makeStore();
    const fleet = makeFleet();
    render(<SessionScreen id="claude:OpenClawHetzner" store={store} fleet={fleet} />);
    applyBacklog(store, {
      type: 'backlog', uuid: 'b7001948', offset: 120, missing: false,
      file: '/home/rc/.claude/projects/-data-projects-x/b7001948.jsonl',
      foreignAccount: 'claude2', searchComplete: true, events: [someEvent],
    });
    expect(screen.getByText(/Stranded history — read from team·alt/)).toBeInTheDocument();

    act(() => { store.getState().apply({ type: 'rotated', uuid: 'fresh-uuid' }); });
    expect(screen.queryByText(/Stranded history/)).not.toBeInTheDocument();
    expect(screen.getByText('Session context reset')).toBeInTheDocument();
  });

  // The same rotation, the other stale statement: the can't-find banner and
  // its path. `missingFile` outliving a rotation names a file belonging to
  // the previous uuid, under a divider that says the context was just reset.
  it('a rotation takes the missing-transcript banner with it', () => {
    const store = makeStore();
    const fleet = makeFleet();
    render(<SessionScreen id="claude:OpenClawHetzner" store={store} fleet={fleet} />);
    applyBacklog(store, {
      type: 'backlog', uuid: 'b7001948', offset: 0, missing: true,
      file: '/home/rc/.claude/projects/x/b7001948.jsonl', searchComplete: false, events: [],
    });
    expect(screen.getByText("Can't read the fleet host right now")).toBeInTheDocument();

    act(() => { store.getState().apply({ type: 'rotated', uuid: 'fresh-uuid' }); });
    expect(screen.queryByText("Can't read the fleet host right now")).not.toBeInTheDocument();
    expect(screen.queryByText("Can't find this session's transcript")).not.toBeInTheDocument();
  });

  // Final review, Minor 5, third instance of the same shape. `foreignAccount`
  // is read through `?? null` and the banner is gated on `!== null`, so an
  // EMPTY string is a foreign account as far as that gate is concerned and
  // `accountLabel(roster, '')` falls back to the raw '' — measured at HEAD as
  // "Stranded history — read from , not this session's own account."
  //
  // The banner is NOT suppressed for it. §5.2's rule is that stranded history
  // is never rendered silently; a server saying "this came from somewhere
  // else" but failing to say where is still a disclosure the operator needs,
  // and dropping the banner would trade a cosmetic defect for the exact
  // silence D4 is about. It degrades to an unnamed account instead.
  it('a foreign account with no name still raises the banner, unnamed rather than blank', () => {
    const store = makeStore();
    const fleet = makeFleet();
    render(<SessionScreen id="claude:OpenClawHetzner" store={store} fleet={fleet} />);
    applyBacklog(store, {
      type: 'backlog', uuid: 'b7001948', offset: 120, missing: false,
      file: '/home/rc/.claude/projects/-data-projects-x/b7001948.jsonl',
      foreignAccount: '', searchComplete: true, events: [someEvent],
    });
    expect(screen.getByText(/Stranded history — read from another account,/)).toBeInTheDocument();
    expect(screen.queryByText(/read from ,/)).not.toBeInTheDocument();
    // And the OTHER half of the same expression. The fallback is
    // `accountLabel(...).trim() || 'another account'`, and only the `||` was
    // pinned above: an empty string is falsy with or without the `.trim()`, so
    // deleting the trim left the test green while a WHITESPACE-ONLY account —
    // just as reachable across a cast frame from an independently versioned
    // server, and just as unnamed — rendered "read from    , not this
    // session's own account." Same frame, same degradation.
    applyBacklog(store, {
      type: 'backlog', uuid: 'b7001948', offset: 240, missing: false,
      file: '/home/rc/.claude/projects/-data-projects-x/b7001948.jsonl',
      foreignAccount: '   ', searchComplete: true, events: [someEvent],
    });
    expect(screen.getByText(/Stranded history — read from another account,/)).toBeInTheDocument();
  });
});

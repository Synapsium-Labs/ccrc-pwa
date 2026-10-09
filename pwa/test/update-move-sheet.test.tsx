// UpdateMoveSheet — the ONE confirm sheet every move control opens
// (centralised-update design 2026-09-20 §13 "W4 adds"; programme wave 5 Task 8).
// Rendered directly, over plans built by the real planMove, with the two client
// methods spied (never a real fetch). What it names, what one confirm sends,
// how a refusal is said (in the sheet, which stays open), the AbandonSheet
// busy/error/generation idiom, and the source facts that keep every move control on
// this one sheet.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { MoveRequestAnswer, MoveSkip, MoveSkipWhy, NodeWire, UpdatesView } from '../../shared/api';
import type { BuildInfo } from '../../shared/buildinfo';
import { ApiError, api, apiErrorText, moveSkipText, updateErrorText } from '../src/lib/api';
import { navigate } from '../src/lib/router';
import { useFleetStore } from '../src/stores/fleet';
import { ToastHost } from '@ccrc/ui';
import { planMove, rollbackHowText, type MoveIntent, type PlannedMove } from '../src/fleet/movePlan';
import {
  MOVE_NOTHING_REQUESTED_TEXT, MOVE_REST_TEXT, MOVE_UNREADABLE_TEXT, MoveSendError, UpdateMoveSheet, sendMove,
} from '../src/fleet/UpdateMoveSheet';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  navigate('/');
  act(() => useFleetStore.setState({ sessions: [], conn: 'connecting', notices: [], blocked: false }));
});

const T0 = Date.UTC(2026, 8, 23, 12, 0, 0);
const FLEET_ID = '12121212-1212-4212-8212-121212121212';
const SERVER_ID = '34343434-3434-4434-8434-343434343434';
const LIST = 'Nodes this moves, in order';
const stamp = (version: string | undefined): BuildInfo => ({
  sha: 'f'.repeat(40), ref: 'main', builtAt: '2026-09-23T12:00:00Z', dirty: false,
  ...(version === undefined ? {} : { version }),
});
const node = (over: Partial<NodeWire> = {}): NodeWire => ({
  nodeId: FLEET_ID, role: 'fleet', label: 'fleet', os: 'linux',
  current: stamp('v0.0.9'), stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['verify', 'node-id', 'floor'], agentOps: ['update'], highestVersion: 'v0.0.9', previousVersion: 'v0.0.8',
  measuredAt: T0, reachable: true, unreachableSince: null,
  channel: 'stable', desiredTag: 'v0.0.10', resolveDetail: null,
  request: null, report: null,
  update: { state: 'idle', target: null, startedAt: null, detail: null },
  ...over,
});
const server = (over: Partial<NodeWire> = {}): NodeWire =>
  node({ nodeId: SERVER_ID, role: 'server', label: 'server', agentOps: null, ...over });
const view = (nodes: NodeWire[]): UpdatesView => ({
  catalogue: { lastOkAt: T0, lastError: null }, releases: [], nodes, intent: [],
});
/** Plans come from the real planner, wire order server-first, so every order assertion is the planner's. */
const plan = (intent: MoveIntent, nodes: NodeWire[] = [server(), node()]): PlannedMove => planMove(view(nodes), intent);
const UP: MoveIntent = { scope: 'fleet', direction: 'update', tag: 'v0.0.10' };
const DOWN: MoveIntent = { scope: 'fleet', direction: 'rollback', to: 'v0.0.8' };
const ok = (requested: string[]): MoveRequestAnswer => ({ ok: true, requested, skipped: [] });
/** The answer `requestAll` (server/src/update/routes.ts) gives `{all: true}` for rows in dispatch order (fleet
 *  first), each with what its OWN check would do. Its two cross-row rules, and only those, are derived here, so a
 *  fixture cannot spell an answer the server never produces: a row that is itself `halted` is skipped so before
 *  anything else; else a NON-fleet row (rank != 0 — server-role AND role-null) is skipped `waiting-for-fleet`
 *  once any fleet row was skipped `busy` or `halted` in this call (D-3408), and never otherwise. */
type RowDoes = 'requested' | Exclude<MoveSkipWhy, 'waiting-for-fleet'>;
const requestAllAnswer = (rows: ReadonlyArray<{ nodeId: string; fleet: boolean; does: RowDoes }>): MoveRequestAnswer => {
  const requested: string[] = [];
  const skipped: MoveSkip[] = [];
  let fleetSelfSkipped = false;
  for (const r of rows) {
    if (r.does === 'halted') skipped.push({ nodeId: r.nodeId, why: 'halted' });
    else if (!r.fleet && fleetSelfSkipped) skipped.push({ nodeId: r.nodeId, why: 'waiting-for-fleet' });
    else if (r.does === 'requested') requested.push(r.nodeId);
    else skipped.push({ nodeId: r.nodeId, why: r.does });
    if (r.fleet && (r.does === 'halted' || r.does === 'busy')) fleetSelfSkipped = true;
  }
  return { ok: true, requested, skipped };
};
const refusal = (error: string): ApiError => new ApiError(409, { ok: false, error });

/** Mount the sheet (and the one toast subscriber) over a plan; onClose/onDone are spies, so the sheet stays mounted. */
const mount = (p: PlannedMove | null) => {
  const onClose = vi.fn();
  const onDone = vi.fn();
  render(<><ToastHost /><UpdateMoveSheet open={p !== null} plan={p} onClose={onClose} onDone={onDone} /></>);
  return { onClose, onDone };
};
const lines = (): (string | null)[] =>
  within(screen.getByRole('list', { name: LIST })).getAllByRole('listitem').map((li) => li.textContent);

/** Switches the sheet's plan mid-flight, the way a screen reopens it on another control. */
function Harness({ first, second, onDone }: { first: PlannedMove; second: PlannedMove; onDone: () => void }): ReactNode {
  const [p, setP] = useState<PlannedMove | null>(first);
  return (
    <>
      <button type="button" onClick={() => setP(second)}>switch plan</button>
      <UpdateMoveSheet open={p !== null} plan={p} onClose={() => setP(null)} onDone={onDone} />
    </>
  );
}

/** Wired the way a real screen wires this sheet: `onClose` actually dismisses (plan -> null), unlike `mount`'s
 *  spy. So the scrim/Esc/swipe path — which `Sheet`'s `onOpenChange`/overlay call directly, bypassing the
 *  disabled Cancel button — genuinely bumps the sheet's own generation, the way review IMPORTANT 1 measures. */
function DismissHarness({ first, onDone }: { first: PlannedMove; onDone: () => void }): ReactNode {
  const [p, setP] = useState<PlannedMove | null>(first);
  return <UpdateMoveSheet open={p !== null} plan={p} onClose={() => setP(null)} onDone={onDone} />;
}

/** A screen that can dismiss the sheet and reopen a move control (another plan) while an answer is still in flight. */
function ReopenHarness({ first, again, onDone }: { first: PlannedMove; again: PlannedMove; onDone: () => void }): ReactNode {
  const [p, setP] = useState<PlannedMove | null>(first);
  return (
    <>
      <button type="button" onClick={() => setP(again)}>reopen</button>
      <UpdateMoveSheet open={p !== null} plan={p} onClose={() => setP(null)} onDone={onDone} />
    </>
  );
}

describe('UpdateMoveSheet — what it names', () => {
  it('names the nodes it moves in dispatch order — fleet then server whatever the wire order — under the headline, which is also its confirm', () => {
    mount(plan(UP));
    expect(lines()).toEqual(['1. fleet (fleet) v0.0.9 → v0.0.10', '2. server (server) v0.0.9 → v0.0.10']);
    expect(screen.getByRole('button', { name: 'Update v0.0.10' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).not.toBeDisabled();
  });

  it('an empty plan says so and offers no confirm — nothing to send', () => {
    mount(plan(UP, [node({ current: stamp('v0.0.10') })]));
    // moveEmptyText, spelled out: the node is AT the tag, and the sentence says only what was measured.
    expect(screen.getByText('Nothing to move — v0.0.10 takes no managed node forward.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: LIST })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Update v0.0.10' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('renders nothing while closed, or with no plan', () => {
    const closed = render(<UpdateMoveSheet open={false} plan={plan(UP)} onClose={() => {}} onDone={() => {}} />);
    expect(closed.container).toBeEmptyDOMElement();
    expect(document.querySelector('.update-move-sheet')).toBeNull();
    cleanup();
    render(<UpdateMoveSheet open plan={null} onClose={() => {}} onDone={() => {}} />);
    expect(document.querySelector('.update-move-sheet')).toBeNull();
  });

  it('the node list carries an explicit role="list" — list-style:none drops the implicit one in Safari/VoiceOver (review MINOR 5)', () => {
    mount(plan(UP));
    expect(screen.getByRole('list', { name: LIST })).toHaveAttribute('role', 'list');
  });

  it('renders a label carrying markup as literal text', () => {
    const LABEL = '<b>fleet</b><img src=x onerror=alert(1)>';
    mount(plan(UP, [node({ label: LABEL })]));
    const list = screen.getByRole('list', { name: LIST });
    expect(list.querySelector('b, img')).toBeNull();
    expect(lines()).toEqual([`1. ${LABEL} (fleet) v0.0.9 → v0.0.10`]);
  });

  it('a rollback plan — fleet or node — says how a rollback happens; an update plan does not (wave 8 item F3)', () => {
    mount(plan(DOWN));
    expect(screen.getByText(rollbackHowText('v0.0.8'))).toHaveClass('qc-consequence');
    cleanup();
    mount(plan({ scope: 'node', direction: 'rollback', nodeId: FLEET_ID, to: 'v0.0.8' }));
    expect(screen.getByText(rollbackHowText('v0.0.8'))).toHaveClass('qc-consequence');
    cleanup();
    mount(plan(UP));
    expect(screen.queryByText(rollbackHowText('v0.0.10'))).toBeNull();
  });

  it('an empty rollback plan says nothing to move and not how a rollback happens (wave 8 item F3)', () => {
    mount(plan(DOWN, [node({ current: stamp('v0.0.8') })]));
    expect(screen.queryByText(rollbackHowText('v0.0.8'))).toBeNull();
  });
});

describe('UpdateMoveSheet — what one confirm sends', () => {
  it('a fleet update sends ONE apply {all: true, tag}, then calls onDone and closes', async () => {
    const apply = vi.spyOn(api, 'applyUpdate').mockResolvedValue(ok([FLEET_ID, SERVER_ID]));
    const rollback = vi.spyOn(api, 'rollbackUpdate');
    const { onClose, onDone } = mount(plan(UP));
    expect(apply).not.toHaveBeenCalled();   // opening is not confirming
    fireEvent.click(screen.getByRole('button', { name: 'Update v0.0.10' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(apply.mock.calls).toEqual([[{ all: true, tag: 'v0.0.10' }]]);
    expect(rollback).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.toast'), 'nothing was skipped, so nothing is said').toBeNull();
  });

  it('a 202 that skipped a node the sheet NAMED says so IN the sheet, by label and sentence, and stays open with nothing left to send (spec §12)', async () => {
    // The server skipped the fleet node for a reason the plan cannot preview (no `detach` word), and a
    // node the sheet never listed for one the plan already agreed with (it is at the tag).
    const ELSEWHERE = '56565656-5656-4656-8656-565656565656';
    vi.spyOn(api, 'applyUpdate').mockResolvedValue({
      ok: true, requested: [SERVER_ID],
      skipped: [{ nodeId: FLEET_ID, why: 'no-detach-cap' }, { nodeId: ELSEWHERE, why: 'not-newer' }],
    });
    const { onClose, onDone } = mount(plan(UP));
    fireEvent.click(screen.getByRole('button', { name: 'Update v0.0.10' }));
    const said = await screen.findByRole('alert');
    // Exact text: the unlisted node's skip is not in it; the node that WAS requested is named after it.
    expect(said.textContent).toBe(`Not requested — fleet: ${moveSkipText('no-detach-cap')} Requested: server.`);
    expect(onDone).toHaveBeenCalledTimes(1);   // a request was written — re-poll
    expect(onClose).not.toHaveBeenCalled();    // never a close that reads as "both moved"
    expect(screen.queryByRole('button', { name: 'Update v0.0.10' })).toBeNull();   // the reply is final: nothing to re-send
    expect(screen.getByRole('button', { name: 'Close' })).not.toBeDisabled();
    // One table: the skip's sentence is the one a single-node 409 of the same word renders.
    expect(moveSkipText('no-detach-cap')).toBe(updateErrorText(refusal('no-detach-cap')));
  });

  // `busy` skips a node whose OWN lease is busy, and a fleet-role row's busy (or halted) skip is what holds every
  // other row `waiting-for-fleet` (D-3408) — so a busy skip beside a REQUESTED node is the server's, and the
  // waiting-for-fleet skip never comes with the fleet node requested. Both answers come from `requestAllAnswer`.
  it('a 202 that skipped a NAMED node for busy renders that word\'s own sentence (review MINOR 6)', async () => {
    vi.spyOn(api, 'applyUpdate').mockResolvedValue(requestAllAnswer([
      { nodeId: FLEET_ID, fleet: true, does: 'requested' }, { nodeId: SERVER_ID, fleet: false, does: 'busy' },
    ]));
    const { onClose, onDone } = mount(plan(UP));
    fireEvent.click(screen.getByRole('button', { name: 'Update v0.0.10' }));
    const said = await screen.findByRole('alert');
    expect(said.textContent).toBe(`Not requested — server: ${moveSkipText('busy')} Requested: fleet.`);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  // The role-null node is rank 2 (`dispatchRank`), held exactly like the server-role one (rank 1): `requestAll`
  // skips EVERY rank!=0 row `waiting-for-fleet`, and nothing was requested — so no onDone.
  it.each(['busy', 'halted'] as const)(
    'a 202 whose fleet node is skipped %s holds every non-fleet node waiting-for-fleet — server-role and role-null alike — and requests nothing (D-3408)', async (fleetWhy) => {
      const UNKNOWN_ID = '78787878-7878-4878-8878-787878787878';
      vi.spyOn(api, 'applyUpdate').mockResolvedValue(requestAllAnswer([
        { nodeId: FLEET_ID, fleet: true, does: fleetWhy }, { nodeId: SERVER_ID, fleet: false, does: 'requested' },
        { nodeId: UNKNOWN_ID, fleet: false, does: 'requested' },
      ]));
      const { onClose, onDone } = mount(plan(UP, [server(), node(), node({ nodeId: UNKNOWN_ID, role: null, label: 'unknown' })]));
      fireEvent.click(screen.getByRole('button', { name: 'Update v0.0.10' }));
      const said = await screen.findByRole('alert');
      const held = moveSkipText('waiting-for-fleet');
      expect(said.textContent).toBe(`Not requested — fleet: ${moveSkipText(fleetWhy)} server: ${held} unknown: ${held}`);
      expect(onDone, 'nothing was written').not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    },
  );

  it('requestAllAnswer derives only what requestAll can produce: a fleet busy/halted skip is the one thing that makes waiting-for-fleet', () => {
    const rows = (fleet: 'requested' | 'busy' | 'halted' | 'no-detach-cap'): MoveRequestAnswer => requestAllAnswer([
      { nodeId: FLEET_ID, fleet: true, does: fleet }, { nodeId: SERVER_ID, fleet: false, does: 'requested' },
    ]);
    expect(rows('requested')).toEqual({ ok: true, requested: [FLEET_ID, SERVER_ID], skipped: [] });
    expect(rows('no-detach-cap'), 'a capability word does not block the row\'s peers').toEqual({
      ok: true, requested: [SERVER_ID], skipped: [{ nodeId: FLEET_ID, why: 'no-detach-cap' }],
    });
    for (const why of ['busy', 'halted'] as const) {
      expect(rows(why)).toEqual({
        ok: true, requested: [], skipped: [{ nodeId: FLEET_ID, why }, { nodeId: SERVER_ID, why: 'waiting-for-fleet' }],
      });
    }
    // A row that is ITSELF halting is `halted` before the waiting check, and the server's own halt blocks no one.
    expect(requestAllAnswer([
      { nodeId: FLEET_ID, fleet: true, does: 'busy' }, { nodeId: SERVER_ID, fleet: false, does: 'halted' },
    ]).skipped).toEqual([{ nodeId: FLEET_ID, why: 'busy' }, { nodeId: SERVER_ID, why: 'halted' }]);
  });

  it('the waiting-for-fleet sentence promises nothing: it says nothing was requested and to tap again (D-3408 writes no request)', () => {
    const s = moveSkipText('waiting-for-fleet');
    expect(s).toMatch(/^Nothing was requested for that node/);
    expect(s).toContain('Tap again');
    expect(s).not.toMatch(/\bit moves\b/);
  });

  it('a 202 that requested NOTHING — Install on a yanked or unlisted row, every node skipped unknown-tag — stays open and re-polls nothing', async () => {
    const s = moveSkipText('unknown-tag');
    vi.spyOn(api, 'applyUpdate').mockResolvedValue({
      ok: true, requested: [],
      skipped: [{ nodeId: FLEET_ID, why: 'unknown-tag' }, { nodeId: SERVER_ID, why: 'unknown-tag' }],
    });
    const { onClose, onDone } = mount(plan(UP));
    fireEvent.click(screen.getByRole('button', { name: 'Update v0.0.10' }));
    const said = await screen.findByRole('alert');
    expect(said.textContent).toBe(`Not requested — fleet: ${s} server: ${s}`);
    expect(onDone).not.toHaveBeenCalled();   // nothing was written
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a readable 202 that requested nothing and skipped no node the sheet listed says so, and stays open', async () => {
    vi.spyOn(api, 'applyUpdate').mockResolvedValue({ ok: true, requested: [], skipped: [] });
    const { onClose, onDone } = mount(plan(UP));
    fireEvent.click(screen.getByRole('button', { name: 'Update v0.0.10' }));
    const said = await screen.findByRole('alert');
    expect(said.textContent).toBe(MOVE_NOTHING_REQUESTED_TEXT);
    expect(onDone).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a 2xx that parses to null is read as unreadable, not indexed — the confirm button is not left live for a second send (review MINOR 3)', async () => {
    vi.spyOn(api, 'applyUpdate').mockResolvedValue(null as unknown as MoveRequestAnswer);
    const { onClose, onDone } = mount(plan(UP));
    fireEvent.click(screen.getByRole('button', { name: 'Update v0.0.10' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(MOVE_UNREADABLE_TEXT, { selector: '.toast' })).toBeInTheDocument();
  });

  it('a `skipped` element that is not an object is read as unreadable too, never indexed (review MINOR 3)', async () => {
    vi.spyOn(api, 'applyUpdate').mockResolvedValue({
      ok: true, requested: [], skipped: [null as unknown as { nodeId: string; why: 'busy' }],
    });
    const { onClose, onDone } = mount(plan(UP));
    fireEvent.click(screen.getByRole('button', { name: 'Update v0.0.10' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(MOVE_UNREADABLE_TEXT, { selector: '.toast' })).toBeInTheDocument();
  });

  it('a node the server requested that this plan never previewed is named — a stale {all: true} view (review MINOR 4)', async () => {
    const EXTRA = '78787878-7878-4878-8878-787878787878';
    vi.spyOn(api, 'applyUpdate').mockResolvedValue({ ok: true, requested: [FLEET_ID, SERVER_ID, EXTRA], skipped: [] });
    const { onClose, onDone } = mount(plan(UP));
    fireEvent.click(screen.getByRole('button', { name: 'Update v0.0.10' }));
    const said = await screen.findByRole('alert');
    expect(said.textContent).toBe(`Also requested — not previewed here: ${EXTRA}. Requested: fleet, server, ${EXTRA}.`);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onClose, 'a reply naming more than this sheet previewed is never a clean close').not.toHaveBeenCalled();
  });

  it('a skip of a node the sheet never listed is the plan agreeing with the server — it closes and says nothing', async () => {
    vi.spyOn(api, 'applyUpdate').mockResolvedValue({
      ok: true, requested: [FLEET_ID], skipped: [{ nodeId: SERVER_ID, why: 'not-newer' }],
    });
    const { onClose, onDone } = mount(plan(UP, [server({ current: stamp('v0.0.10') }), node()]));
    expect(lines()).toEqual(['1. fleet (fleet) v0.0.9 → v0.0.10']);
    fireEvent.click(screen.getByRole('button', { name: 'Update v0.0.10' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.querySelector('.toast')).toBeNull();
  });

  it('a fleet rollback posts one rollback {nodeId, to} per node, fleet first, and closes after the last', async () => {
    const rollback = vi.spyOn(api, 'rollbackUpdate')
      .mockResolvedValueOnce(ok([FLEET_ID]))
      .mockResolvedValueOnce(ok([SERVER_ID]));
    const apply = vi.spyOn(api, 'applyUpdate');
    const { onClose } = mount(plan(DOWN));
    fireEvent.click(screen.getByRole('button', { name: 'Roll back to v0.0.8' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(rollback.mock.calls).toEqual([[{ nodeId: FLEET_ID, to: 'v0.0.8' }], [{ nodeId: SERVER_ID, to: 'v0.0.8' }]]);
    expect(apply).not.toHaveBeenCalled();
  });

  it('while sending, both buttons are disabled and a second tap sends nothing', async () => {
    const pending = Promise.withResolvers<MoveRequestAnswer | 'unreadable'>();
    const apply = vi.spyOn(api, 'applyUpdate').mockReturnValue(pending.promise);
    const { onClose } = mount(plan(UP));
    fireEvent.click(screen.getByRole('button', { name: 'Update v0.0.10' }));
    const busy = screen.getByRole('button', { name: 'Sending…' });
    expect(busy).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    fireEvent.click(busy);
    expect(apply).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(ok([FLEET_ID, SERVER_ID])); await pending.promise; });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});

describe('UpdateMoveSheet — a refusal is said in the sheet, which stays open', () => {
  it('a refusal on the first node leaves the second unsent', async () => {
    const err = refusal('no-rollback-cap');
    const rollback = vi.spyOn(api, 'rollbackUpdate').mockResolvedValue(ok([SERVER_ID])).mockRejectedValueOnce(err);
    const { onClose, onDone } = mount(plan(DOWN));
    fireEvent.click(screen.getByRole('button', { name: 'Roll back to v0.0.8' }));
    const said = await screen.findByRole('alert');
    expect(said.textContent).toBe(updateErrorText(err));
    expect(rollback.mock.calls).toEqual([[{ nodeId: FLEET_ID, to: 'v0.0.8' }]]);
    expect(onClose).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();   // nothing was requested, so nothing to re-poll
    expect(screen.getByRole('button', { name: 'Roll back to v0.0.8' })).not.toBeDisabled();
  });

  it('a refusal on the second names the node already requested, and re-polls so the inventory shows it', async () => {
    const err = refusal('busy');
    vi.spyOn(api, 'rollbackUpdate').mockResolvedValueOnce(ok([FLEET_ID])).mockRejectedValueOnce(err);
    const { onClose, onDone } = mount(plan(DOWN));
    fireEvent.click(screen.getByRole('button', { name: 'Roll back to v0.0.8' }));
    const said = await screen.findByRole('alert');
    expect(said.textContent).toBe(`${updateErrorText(err)} Already requested: fleet. ${MOVE_REST_TEXT}`);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('after a part-way rollback the sheet offers no second send — the node already requested is never re-sent into its own 409 busy', async () => {
    const err = refusal('no-rollback-cap');
    const rollback = vi.spyOn(api, 'rollbackUpdate').mockResolvedValueOnce(ok([FLEET_ID])).mockRejectedValueOnce(err);
    const { onClose } = mount(plan(DOWN));
    fireEvent.click(screen.getByRole('button', { name: 'Roll back to v0.0.8' }));
    const said = await screen.findByRole('alert');
    expect(said.textContent).toBe(`${updateErrorText(err)} Already requested: fleet. ${MOVE_REST_TEXT}`);
    expect(screen.queryByRole('button', { name: 'Roll back to v0.0.8' })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(rollback.mock.calls).toEqual([[{ nodeId: FLEET_ID, to: 'v0.0.8' }], [{ nodeId: SERVER_ID, to: 'v0.0.8' }]]);
  });

  it("a single-node 409 not-newer renders the update table's own sentence, never the generic floor", async () => {
    const err = refusal('not-newer');
    vi.spyOn(api, 'applyUpdate').mockRejectedValue(err);
    const { onClose } = mount(plan({ scope: 'node', direction: 'update', nodeId: SERVER_ID, tag: 'v0.0.10' }));
    fireEvent.click(screen.getByRole('button', { name: 'Update v0.0.10' }));
    const said = await screen.findByRole('alert');
    expect(said.textContent).toBe(updateErrorText(err));
    expect(updateErrorText(err)).not.toBe(apiErrorText(err));   // Task 6 gave the word a sentence (D-3302's table)
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a single-node 409 halted names the halting node by its inventory label — a node the plan does not move', async () => {
    // Task 6's singleNodeMove answers `detail: gate.haltedBy.join(', ')` — node ids, not labels.
    const err = new ApiError(409, { ok: false, error: 'halted', detail: SERVER_ID });
    vi.spyOn(api, 'applyUpdate').mockRejectedValue(err);
    const { onClose } = mount(plan({ scope: 'node', direction: 'update', nodeId: FLEET_ID, tag: 'v0.0.10' }));
    fireEvent.click(screen.getByRole('button', { name: 'Update v0.0.10' }));
    const said = await screen.findByRole('alert');
    expect(said.textContent).toBe(`${updateErrorText(err)} Blocked by: server.`);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Update v0.0.10' })).not.toBeDisabled();   // nothing was requested
  });

  it('a 2xx whose body could not be read still closes — the request may stand — and says the answer was unread', async () => {
    vi.spyOn(api, 'applyUpdate').mockResolvedValue('unreadable');
    const { onClose, onDone } = mount(plan(UP));
    fireEvent.click(screen.getByRole('button', { name: 'Update v0.0.10' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(MOVE_UNREADABLE_TEXT, { selector: '.toast' })).toBeInTheDocument();
  });

  it('a late answer for a plan the sheet no longer shows is dropped from the SCREEN but still re-polls — a request was written (the AbandonSheet generation idiom, review F5)', async () => {
    const pending = Promise.withResolvers<MoveRequestAnswer | 'unreadable'>();
    vi.spyOn(api, 'applyUpdate').mockReturnValueOnce(pending.promise);
    const onDone = vi.fn();
    render(<Harness first={plan(UP)} second={plan({ scope: 'node', direction: 'rollback', nodeId: FLEET_ID, to: 'v0.0.8' })} onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Update v0.0.10' }));
    fireEvent.click(screen.getByText('switch plan'));
    // A macrotask, not one microtask: sendMove's own await and its `.then` must
    // both have run, or "not called" would pass before the late answer arrived.
    await act(async () => { pending.resolve(ok([FLEET_ID, SERVER_ID])); await new Promise((r) => setTimeout(r, 0)); });
    expect(onDone, 'the request was written — the caller re-polls even though the sheet shows something else').toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert'), 'the stale answer renders nothing').toBeNull();
    expect(screen.getByRole('button', { name: 'Roll back to v0.0.8' })).not.toBeDisabled();
  });

  it('dismissing a single-node Install, reopening a move control, then the answer landing still re-polls once (review F5: a plan switch IS dismiss then reopen)', async () => {
    const answer = Promise.withResolvers<MoveRequestAnswer | 'unreadable'>();
    vi.spyOn(api, 'applyUpdate').mockReturnValueOnce(answer.promise);
    const onDone = vi.fn();
    render(<ReopenHarness first={plan({ scope: 'node', direction: 'update', nodeId: FLEET_ID, tag: 'v0.0.10' })} again={plan(DOWN)} onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Update v0.0.10' }));
    fireEvent.click(screen.getByTestId('sheet-overlay'));
    fireEvent.click(screen.getByText('reopen'));
    expect(screen.getByRole('button', { name: 'Roll back to v0.0.8' })).toBeInTheDocument();   // shown again, over another plan
    await act(async () => { answer.resolve(ok([FLEET_ID])); await new Promise((r) => setTimeout(r, 0)); });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('sendMove rejects with a MoveSendError carrying the refusal and the nodes already requested', async () => {
    const err = refusal('halted');
    vi.spyOn(api, 'rollbackUpdate').mockResolvedValueOnce(ok([FLEET_ID])).mockRejectedValueOnce(err);
    const failed = await sendMove(plan(DOWN)).catch((e: unknown) => e);
    expect(failed).toBeInstanceOf(MoveSendError);
    expect((failed as MoveSendError).err).toBe(err);
    expect((failed as MoveSendError).requested).toEqual([FLEET_ID]);
  });

  it('dismissing mid-sequence (scrim/Esc/swipe, never gated by the disabled Cancel) stops the rest, and the reload still fires for what already went out (review IMPORTANT 1)', async () => {
    const first = Promise.withResolvers<MoveRequestAnswer | 'unreadable'>();
    const rollback = vi.spyOn(api, 'rollbackUpdate').mockReturnValueOnce(first.promise);
    const onDone = vi.fn();
    render(<DismissHarness first={plan(DOWN)} onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Roll back to v0.0.8' }));
    expect(rollback).toHaveBeenCalledTimes(1);
    // The scrim — Sheet wires it straight to onClose, unlike the busy-disabled Cancel button.
    fireEvent.click(screen.getByTestId('sheet-overlay'));
    await act(async () => { first.resolve(ok([FLEET_ID])); await new Promise((r) => setTimeout(r, 0)); });
    expect(rollback, 'the second node is never sent once the sheet is gone').toHaveBeenCalledTimes(1);
    expect(onDone, 'the first node was requested for real — the caller still needs to re-poll').toHaveBeenCalledTimes(1);
  });

  // review F5: a SINGLE-node move has nothing "mid-sequence" to stop, but its POST is written all the same, so a
  // dismiss before the answer lands must re-poll exactly as the multi-node one does (answers.length === planned === 1).
  it.each([
    ['Install', 'applyUpdate', { scope: 'node', direction: 'update', nodeId: FLEET_ID, tag: 'v0.0.10' }, 'Update v0.0.10'],
    ['Roll back', 'rollbackUpdate', { scope: 'node', direction: 'rollback', nodeId: FLEET_ID, to: 'v0.0.8' }, 'Roll back to v0.0.8'],
  ] as const)(
    'dismissing a single-node %s before its answer lands still re-polls — the request was written (review F5)', async (_name, method, intent, button) => {
      const answer = Promise.withResolvers<MoveRequestAnswer | 'unreadable'>();
      const call = vi.spyOn(api, method).mockReturnValueOnce(answer.promise);
      const onDone = vi.fn();
      render(<DismissHarness first={plan(intent)} onDone={onDone} />);
      fireEvent.click(screen.getByRole('button', { name: button }));
      expect(call).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByTestId('sheet-overlay'));
      await act(async () => { answer.resolve(ok([FLEET_ID])); await new Promise((r) => setTimeout(r, 0)); });
      expect(onDone, 'answers.length === planned === 1, and something WAS sent').toHaveBeenCalledTimes(1);
    },
  );
});

describe('one sheet for every move (D-3389)', () => {
  const src = (...p: string[]): string => readFileSync(path.join(import.meta.dirname, '..', 'src', ...p), 'utf8');

  it('UpdateBanner and SettingsScreen import no QuickConfirm — both open UpdateMoveSheet', () => {
    for (const [file, text] of [
      ['UpdateBanner.tsx', src('fleet', 'UpdateBanner.tsx')],
      ['SettingsScreen.tsx', src('screens', 'SettingsScreen.tsx')],
    ] as const) {
      expect(text, file).not.toMatch(/components\/QuickConfirm/);
      expect(text, file).toMatch(/from '(\.\/|\.\.\/fleet\/)UpdateMoveSheet'/);
    }
  });

  it('the sheet puts wire text into the DOM only as text children', () => {
    expect(src('fleet', 'UpdateMoveSheet.tsx')).not.toMatch(/dangerouslySetInnerHTML/);
  });
});

// Programme wave 14, R15(b) (D-4269): a `halted` skip is about the whole fleet, so it is said even for a node the plan
// never named. The shape: the server row FAILED on the tag this move names (it runs it already, so the plan does not
// list it), and the fleet node is requested — the request then waits behind that halt until the ack. Before this
// wave the sheet closed on that 202 as if the fleet had started moving.
describe('UpdateMoveSheet — a halted skip of a node the plan never named (R15(b))', () => {
  it('is said in the sheet, beside what was requested, and the sheet stays open', async () => {
    vi.spyOn(api, 'applyUpdate').mockResolvedValue(requestAllAnswer([
      { nodeId: FLEET_ID, fleet: true, does: 'requested' }, { nodeId: SERVER_ID, fleet: false, does: 'halted' },
    ]));
    const halting = server({ current: stamp('v0.0.10'), update: { state: 'failed', target: 'v0.0.10', startedAt: T0, detail: 'gate: unit not up' } });
    const { onClose, onDone } = mount(plan(UP, [halting, node()]));
    expect(lines(), 'the plan names only the fleet node').toEqual(['1. fleet (fleet) v0.0.9 → v0.0.10']);
    fireEvent.click(screen.getByRole('button', { name: 'Update v0.0.10' }));
    const said = await screen.findByRole('alert');
    expect(said.textContent).toBe(`Not requested — server: ${moveSkipText('halted')} Requested: fleet.`);
    expect(onDone, 'a request was written — re-poll').toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('every other word a node the plan never named was skipped with stays unsaid (the plan agreeing with the server)', async () => {
    vi.spyOn(api, 'applyUpdate').mockResolvedValue({
      ok: true, requested: [FLEET_ID], skipped: [{ nodeId: SERVER_ID, why: 'busy' }],
    });
    const { onClose } = mount(plan(UP, [server({ current: stamp('v0.0.10') }), node()]));
    fireEvent.click(screen.getByRole('button', { name: 'Update v0.0.10' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

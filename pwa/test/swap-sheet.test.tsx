// Wave 3 §3.4, the half that ships. The `prefer` exec grant is DEFERRED —
// `EXEC_COMMANDS` stays `['tmux','ccd']` and `ccd prefer` stays unreachable
// from the server — so a swap made here is genuinely temporary: `ccd swap`
// writes `.wrapper` and never `.home`, and `_auto_swap_check` returns the
// session home the moment home has room (measured live in swap.log, both
// directions, ~15 minutes). This suite pins the sheet SAYING SO. A control
// that quietly undoes itself is worse than one that admits it will.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { FleetSession } from '../../shared/api';
import { SwapSheet } from '../src/fleet/SwapSheet';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';
import { TEST_ROSTER } from './rosterFixture';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

// `fleetSession` and `storeWith` are MODULE-PRIVATE in
// `pwa/test/lifecycle-ui.test.tsx` — not exported, so they cannot be
// imported. Reproduced here in the same shape.
//
// THE LABELS BELOW ARE READ OFF `TEST_ROSTER`, not off the plan, which named a
// different pair: the fixture resolves `claude` -> "team·max", `claude2` ->
// "alt·max" and `claude-corp` -> "team·shared". `home` is an ACCOUNT ID (it is
// `r.home ?? idHomeWrapper(...)` in `server/src/fleet.ts`), which is the whole
// reason it can be turned into a label at all.
const fakeSocket = () => ({ close: () => {}, send: () => {} }) as never;

const fleetSession = (patch: Partial<FleetSession> = {}): FleetSession => ({
  id: 'claude:OpenClawHetzner', wrapper: 'claude', home: 'claude',
  project: 'OpenClawHetzner', workdir: '/root/projects/OpenClawHetzner',
  workspace: null, name: null, status: 'idle', statusUpdatedAt: Date.now() - 120_000,
  limits: { five: 62, seven: 71 },
  dialogPending: false, model: null, effort: null, ultracode: false, branch: null,
  tasks: null, pr: null, archivedAt: null, archivedBytes: null,
  hookState: null, askSummary: null, subagents: null, held: null,
  bucket: 'idle', bucketSince: null, unmeasured: [],
  lifecycle: null, stoppedBy: null, swapBlocked: null, started: true, spawnState: null,
  version: null,
  ...patch,
});

const storeWith = (sessions: FleetSession[]): FleetStore => {
  const store = createFleetStore({ makeSocket: fakeSocket });
  act(() => { store.setState({ conn: 'open', sessions, roster: TEST_ROSTER }); });
  return store;
};

describe('SwapSheet says the move is temporary and names the home account', () => {
  it('names the home account the session will return to', () => {
    const s = fleetSession({ wrapper: 'claude2', home: 'claude' });
    render(<SwapSheet session={s} open onClose={vi.fn()} fleet={storeWith([s])} />);
    // The account it is on NOW and the account it goes BACK to are different
    // facts and the sheet must show both — before this task it showed only
    // the first, and the reader had no way to know the second existed.
    // Queried through the copy's own sentence rather than by the bare label:
    // "team·max" is also the text of the `claude` TARGET ROW on this fixture,
    // so a bare `getByText(/team·max/)` would match two elements and pass for
    // the wrong reason.
    const copy = screen.getByText(/Its home account is/i);
    expect(copy.textContent).toContain('alt·max');   // where it is now
    expect(copy.textContent).toContain('team·max');    // home
    expect(copy.textContent).toMatch(/temporary|returns/i);
  });

  it('says it in the CONSEQUENCE too, where the tap actually happens', async () => {
    // The sheet copy is read once; the QuickConfirm consequence is read at the
    // moment of commitment. `QuickConfirm` runs `onConfirm(); onClose();`
    // unconditionally, so this sentence is the last thing shown before an
    // irreversible-looking action that is in fact reversed for you.
    const s = fleetSession({ wrapper: 'claude', home: 'claude' });
    render(<SwapSheet session={s} open onClose={vi.fn()} fleet={storeWith([s])} />);
    fireEvent.click(await screen.findByRole('button', { name: /team·shared/ }));
    expect(await screen.findByText(/back to team·max/i)).toBeInTheDocument();
  });

  it('names the HOME account in the copy, not the account being moved away from', () => {
    // The mutant this kills: writing the return sentence off `session.wrapper`
    // instead of `session.home`. On a session that has already been relocated
    // those differ, and the sentence would name the account it is leaving as
    // the one it returns to — precisely backwards, in the case that matters.
    const s = fleetSession({ wrapper: 'claude2', home: 'claude-corp' });
    render(<SwapSheet session={s} open onClose={vi.fn()} fleet={storeWith([s])} />);
    expect(screen.getByText(/home account is team·shared/i)).toBeInTheDocument();
  });

  // `SessionScreen` renders this sheet for a session that is NOT in the live
  // fleet snapshot, from a synthetic `{ id, wrapper, project }` row. The plan
  // for this task said both callers pass a whole `FleetSession` and that the
  // widening was free; the build says otherwise, and the state it exposed is
  // the interesting one: nobody measured this session's home account.
  describe('and when the home account was never measured', () => {
    it('still says the move is temporary, and names no account for the return', () => {
      const s = { id: 'demo', wrapper: 'claude', project: 'demo', home: null };
      render(<SwapSheet session={s} open onClose={vi.fn()} fleet={storeWith([])} />);
      const copy = screen.getByText(/home account is not known/i);
      expect(copy.textContent).toMatch(/temporary/i);
      // The mutant this kills: defaulting `home` to `wrapper`, which would
      // print the account being moved AWAY from as the one it returns to, in
      // the exact state where nothing was measured. Naming the current account
      // is fine and expected ("runs on team·max now") — it is the RETURN
      // clause that must name nothing.
      expect(copy.textContent).not.toMatch(/home account is team·max/i);
      expect(copy.textContent).not.toMatch(/returns the session to team·max/i);
    });

    it('carries the same admission into the consequence', async () => {
      const s = { id: 'demo', wrapper: 'claude', project: 'demo', home: null };
      render(<SwapSheet session={s} open onClose={vi.fn()} fleet={storeWith([])} />);
      fireEvent.click(await screen.findByRole('button', { name: /team·shared/ }));
      const c = await screen.findByText(/back to its home account/i);
      expect(c.textContent).toMatch(/temporary/i);
    });
  });

  it('still lists every pickable target — honesty is not a restriction', () => {
    const s = fleetSession({ wrapper: 'claude', home: 'claude' });
    render(<SwapSheet session={s} open onClose={vi.fn()} fleet={storeWith([s])} />);
    for (const label of ['alt·max', 'team·shared', 'gpt']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeInTheDocument();
    }
  });
});

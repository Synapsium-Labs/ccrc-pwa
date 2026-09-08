// Wave 3 §3.4, the half that ships. The `prefer` exec grant is DEFERRED —
// `EXEC_COMMANDS` stays `['tmux','ccd']` and `ccd prefer` stays unreachable
// from the server — so a swap made here is genuinely temporary: `ccd swap`
// writes `.wrapper` and never `.home`, and `_auto_swap_check` returns the
// session home the moment home has room (measured live in swap.log, both
// directions, ~15 minutes). This suite pins the sheet SAYING SO. A control
// that quietly undoes itself is worse than one that admits it will.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AccountUsage, FleetSession } from '../../shared/api';
import { api } from '../src/lib/api';
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
// "team·alt" and `claude-corp` -> "team·b". `home` is an ACCOUNT ID (it is
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
  hookState: null, askSummary: null, subagents: null, graphQueries: null, graphGateDenials: null, held: null,
  bucket: 'idle', bucketSince: null, unmeasured: [], statusUnmeasured: false,
  lifecycle: null, stoppedBy: null, swapBlocked: null, substrate: null, started: true, spawnState: null,
  version: null,
  ...patch,
});

const storeWith = (sessions: FleetSession[], roster = TEST_ROSTER): FleetStore => {
  const store = createFleetStore({ makeSocket: fakeSocket });
  act(() => { store.setState({ conn: 'open', sessions, roster }); });
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
    expect(copy.textContent).toContain('team·alt');   // where it is now
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
    fireEvent.click(await screen.findByRole('button', { name: /team·b/ }));
    expect(await screen.findByText(/back to team·max/i)).toBeInTheDocument();
  });

  it('names the HOME account in the copy, not the account being moved away from', () => {
    // The mutant this kills: writing the return sentence off `session.wrapper`
    // instead of `session.home`. On a session that has already been relocated
    // those differ, and the sentence would name the account it is leaving as
    // the one it returns to — precisely backwards, in the case that matters.
    const s = fleetSession({ wrapper: 'claude2', home: 'claude-corp' });
    render(<SwapSheet session={s} open onClose={vi.fn()} fleet={storeWith([s])} />);
    expect(screen.getByText(/home account is team·b/i)).toBeInTheDocument();
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
      fireEvent.click(await screen.findByRole('button', { name: /team·b/ }));
      const c = await screen.findByText(/back to its home account/i);
      expect(c.textContent).toMatch(/temporary/i);
    });
  });

  it('still lists every pickable target — honesty is not a restriction', () => {
    const s = fleetSession({ wrapper: 'claude', home: 'claude' });
    render(<SwapSheet session={s} open onClose={vi.fn()} fleet={storeWith([s])} />);
    for (const label of ['team·alt', 'team·b', 'gpt']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  // The one entry that is NOT a pickable target, and the distinction the test
  // above must not swallow: `gpt` is `homeAble: false` and still offered,
  // because an opt-in account is somewhere a session can be SENT on purpose —
  // that is what this sheet is for. A `hidden` entry is different in kind: the
  // roster says it names the Claude Code binary and is not an account at all,
  // so offering it would invite a move onto a lane that holds no login of the
  // operator's.
  it('never offers a hidden entry as a target, while still offering the opt-in account', () => {
    const roster = [...TEST_ROSTER.map((a) => (a.id === 'claude-corp' ? { ...a, hidden: true } : a))];
    const s = fleetSession({ wrapper: 'claude', home: 'claude' });
    render(<SwapSheet session={s} open onClose={vi.fn()} fleet={storeWith([s], roster)} />);
    expect(screen.queryByRole('button', { name: /team·b/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /gpt/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /team·alt/ })).toBeInTheDocument();
  });
});

// REVIEW FINDING, WAVE 3: the two halves of this wave contradicted each other.
// §3.4 (above) had the sheet promise, unconditionally, that ccrc returns the
// session home "as soon as {home} has room again". §3.3 — EARLIER IN THE SAME
// WAVE, `ccd`'s `_auto_swap_check` — made the AFFINITY arm return early on
// `[[ -e "$REG/$id.hold" ]]`, so for a HELD session nothing brings it home
// until the hold clears. §3.4's whole point was that the sheet should stop
// lying about what a swap does; it started lying a new way instead.
//
// The deciding fact is HOLD-FILE PRESENCE, and the sheet can see exactly that:
// `FleetSession.held` is the `.hold` file's reason string, null when unheld,
// and the server's read is fail-shut (a present-but-unreadable file reads as
// held, carrying `HOLD_UNREADABLE`). Same fact, one measurement, no second
// source of truth.
//
// The RESCUE arm is untouched by §3.3 and deliberately so — a hard-blocked
// held session is still evacuated. None of the copy below claims otherwise:
// it is about the RETURN, which is the only thing the sheet ever promised.
describe('SwapSheet does not promise a held session an automatic return', () => {
  const HOLD = 'program:build8 wave:3/4 run:21';

  it('a HELD session is told the return waits for the hold', () => {
    const s = fleetSession({ wrapper: 'claude2', home: 'claude', held: HOLD });
    render(<SwapSheet session={s} open onClose={vi.fn()} fleet={storeWith([s])} />);
    const copy = screen.getByText(/Its home account is/i);
    // The promise §3.3 falsified. Not a loose /temporary/ match: the sentence
    // that is false for a held session is the TIMING one.
    expect(copy.textContent).not.toMatch(/returns the session to team·max as soon as/i);
    // And it names the hold, verbatim — the reason string IS the display
    // everywhere else in this build (shared/api.ts on `held`), so a reader who
    // wants to know why can read it here too.
    expect(copy.textContent).toContain(HOLD);
    expect(copy.textContent).toMatch(/until the hold is released/i);
  });

  it('an UNHELD session still gets the promise — the fix narrows, it does not blanket', () => {
    // The other direction, pinned so "just hedge everything" cannot pass. A
    // session with no hold IS returned home on the next affinity tick, and
    // saying so is the whole value §3.4 shipped.
    //
    // BOTH negatives are load-bearing, and the second one was added after the
    // mutation run: hedging every session (treating `held` as unmeasured
    // always) leaves the promise sentence intact INSIDE the hedge, so the
    // positive match below passed a mutant that had made the copy useless.
    // The hedge's own words are what separate the two.
    const s = fleetSession({ wrapper: 'claude2', home: 'claude', held: null });
    render(<SwapSheet session={s} open onClose={vi.fn()} fleet={storeWith([s])} />);
    const copy = screen.getByText(/Its home account is/i);
    expect(copy.textContent).toMatch(/returns the session to team·max as soon as team·max has room/i);
    expect(copy.textContent).not.toMatch(/until the hold is released/i);
    expect(copy.textContent).not.toMatch(/a program hold defers/i);
    expect(copy.textContent).not.toMatch(/was not measured from here/i);
  });

  it('says it in the CONSEQUENCE too, where the tap actually happens', async () => {
    const s = fleetSession({ wrapper: 'claude2', home: 'claude', held: HOLD });
    render(<SwapSheet session={s} open onClose={vi.fn()} fleet={storeWith([s])} />);
    fireEvent.click(await screen.findByRole('button', { name: /team·b/ }));
    // A bare /held/i matches the sheet copy too — it is still mounted under
    // the confirm — so query the phrase only the consequence uses.
    const c = await screen.findByText(/does not move a held session back/i);
    expect(c.textContent).toContain(HOLD);
    // The unheld consequence's exact promise, which must NOT be here.
    expect(c.textContent).not.toMatch(/moves it back to team·max once/i);
  });

  // The third state, and it is the one `SessionScreen` actually produces:
  // `live ?? { id, wrapper, project, home: null }` — no live fleet row, so
  // NOBODY MEASURED the hold. `held: null` would mean "measured, unheld" and
  // would earn the promise; absence means nothing was measured and must not.
  describe('and when nobody measured whether it is held', () => {
    it('hedges rather than promising or refusing', () => {
      const s = { id: 'demo', wrapper: 'claude', project: 'demo', home: 'claude' };
      render(<SwapSheet session={s} open onClose={vi.fn()} fleet={storeWith([])} />);
      const copy = screen.getByText(/Its home account is/i);
      expect(copy.textContent).toMatch(/a program hold defers/i);
      expect(copy.textContent).toMatch(/was not measured from here/i);
      // Not laundered into either measured answer.
      expect(copy.textContent).not.toMatch(/until the hold is released/i);
    });

    it('carries the same hedge into the consequence', async () => {
      const s = { id: 'demo', wrapper: 'claude', project: 'demo', home: 'claude' };
      render(<SwapSheet session={s} open onClose={vi.fn()} fleet={storeWith([])} />);
      fireEvent.click(await screen.findByRole('button', { name: /team·b/ }));
      const c = await screen.findByText(/moves it back to team·max once/i);
      expect(c.textContent).toMatch(/but a program hold defers that/i);
      expect(c.textContent).toMatch(/was not measured from here/i);
    });
  });
});

// ————————————————————————————————————————————————————————————————————————
// PROVENANCE. This sheet is the last reader on the branch that scored a
// telemetry number without asking where it came from.
//
// An account whose rate-limit window has merely ENDED reports `{five: 0}` —
// `server/src/limits.ts` writes that 0 the moment a `resetAt` lapses or a
// sample outlives its own window — and sets `fiveRolledOver`. The 0 is
// INFERRED FROM A TIMESTAMP; nothing observed it. Scored as a measurement it
// is the best number on the fleet, so the account wins `leastLoaded` and wears
// "suggested"; nothing runs on an account nothing is moved to, so no real
// number ever replaces the inferred one and it wins FOREVER. ccd
// (`_limit_score`) and `server/src/limits.ts` (`measured()`) each closed this
// on their own side; this is the third copy of the same decision, and the one
// a human reads while rescuing a wedged session by hand.
//
// NO WIRE CHANGE WAS NEEDED. `GET /api/accounts` already ships the whole
// `AccountUsage` row — both rollover flags, `disabled` and `authDead` — and
// this sheet was already polling it on open and every 20s after, then throwing
// everything away except `a.disabled === true`.
const acct = (over: Partial<AccountUsage>): AccountUsage => ({
  wrapper: 'claude', five: 0, seven: 0, ts: null,
  fiveResetAt: null, sevenResetAt: null,
  fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false, ...over,
});

const stubAccounts = (accounts: AccountUsage[]): void => {
  vi.spyOn(api, 'accounts').mockResolvedValue({
    accounts, projected: null, roster: [],
  });
};

/** The sheet, opened on `claude` (team·max), against a fleet store the test
 *  chooses — so a case can put the frame and the poll in deliberate conflict. */
const renderSwap = (sessions: FleetSession[] = []): void => {
  render(
    <SwapSheet
      session={{ id: 'demo', wrapper: 'claude', project: 'demo', home: 'claude' }}
      open
      onClose={vi.fn()}
      fleet={storeWith(sessions)}
    />,
  );
};

describe('SwapSheet does not rank an account on an inferred zero', () => {
  it('never suggests an account whose 5h window merely rolled over', async () => {
    stubAccounts([
      // The magnet: 0% with the flag set. Nothing measured this.
      acct({ wrapper: 'claude2', five: 0, seven: 0, fiveRolledOver: true }),
      // Honestly reporting, and much fuller — it must still win.
      acct({ wrapper: 'claude-corp', five: 62, seven: 71 }),
    ]);
    renderSwap();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /team·b/ })).toHaveTextContent('suggested'));
    expect(screen.getByRole('button', { name: /team·alt/ })).not.toHaveTextContent('suggested');
  });

  it('never suggests one whose 7d window rolled over either — one elapsed half is enough', async () => {
    // The score is a MAXIMUM, so the ended half bounds the truth only from
    // below: `{five: 4, seven: <ended>}` could really be at 99.
    stubAccounts([
      acct({ wrapper: 'claude2', five: 4, seven: 0, sevenRolledOver: true }),
      acct({ wrapper: 'claude-corp', five: 62, seven: 71 }),
    ]);
    renderSwap();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /team·b/ })).toHaveTextContent('suggested'));
    expect(screen.getByRole('button', { name: /team·alt/ })).not.toHaveTextContent('suggested');
  });

  it('still suggests an account MEASURED empty — the fix narrows, it does not refuse every zero', async () => {
    // The other direction, and it is what separates this from "distrust 0".
    // A measured 0 is the best possible target and saying so is the whole
    // point of the tag; only the INFERRED zero is disqualified.
    stubAccounts([
      acct({ wrapper: 'claude2', five: 0, seven: 0 }),
      acct({ wrapper: 'claude-corp', five: 62, seven: 71 }),
    ]);
    renderSwap();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /team·alt/ })).toHaveTextContent('suggested'));
    // …and it renders as the measurement it is, not as a reset.
    expect(screen.getByRole('button', { name: /team·alt/ })).toHaveTextContent('0%');
    expect(screen.getByRole('button', { name: /team·alt/ })).not.toHaveTextContent('reset');
  });

  it('suggests NOBODY when every candidate is unscoreable — no suggestion beats a wrong one', async () => {
    stubAccounts([
      acct({ wrapper: 'claude2', five: 0, seven: 0, fiveRolledOver: true, sevenRolledOver: true }),
      acct({ wrapper: 'claude-corp', five: 0, seven: 30, fiveRolledOver: true }),
      acct({ wrapper: 'gpt', five: null, seven: 12 }),
    ]);
    renderSwap();
    // Wait for the poll before asserting an ABSENCE: every row says "limits
    // unknown" until it lands, so this would otherwise pass against the
    // pre-poll state and measure nothing.
    await waitFor(() => expect(screen.getAllByText('reset')).toHaveLength(3));
    expect(screen.queryByText('suggested')).not.toBeInTheDocument();
    // Not scoring is not hiding: every target is still listed and tappable.
    for (const label of ['team·alt', 'team·b', 'gpt', 'team·d']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  it('renders a rolled-over window as "reset", never as a confident 0%', async () => {
    // `AccountsScreen`'s `Bar` already owns this vocabulary — "reset" (an
    // inferred zero) ≠ "0%" (measured) ≠ "—" (nobody measured) — and this is
    // the same fact on a second surface, so it says the same word rather than
    // inventing a second visual language for it.
    // `44`, not a round `40`: "40%" CONTAINS "0%", so the negative assertion
    // below would fire on the honest half and this test would pass for the
    // wrong reason (measured, first run).
    stubAccounts([acct({ wrapper: 'claude2', five: 0, seven: 44, fiveRolledOver: true })]);
    renderSwap();
    const row = await screen.findByRole('button', { name: /team·alt/ });
    await waitFor(() => expect(row).toHaveTextContent('reset'));
    expect(row).not.toHaveTextContent('0%');
    // The measured half is untouched — the flags are per-window.
    expect(row).toHaveTextContent('44%');
    // AND THE TRACK IS LEFT EMPTY on the rolled half — exactly one fill in
    // this row, the honest one. A bar drawn beside the word "reset" would
    // contradict it in the same row, and the width would be a number nobody
    // took: `limits.ts` happens to zero the value when it sets the flag, so a
    // fill would be invisible TODAY, which is precisely why only a DOM count
    // can hold the rule.
    expect(row.querySelectorAll('.limit-fill')).toHaveLength(1);
  });
});

describe('SwapSheet does not offer a lane that cannot take work', () => {
  it('never offers an account the health probe measured AUTH-DEAD', async () => {
    // Swapping there produces a session that cannot authenticate. `disabled`
    // (the operator's kill-switch) and `authDead` (the probe's measurement)
    // are different facts the server deliberately keeps apart, but they answer
    // this sheet's one question the same way.
    stubAccounts([
      acct({ wrapper: 'claude2', authDead: true, five: 3, seven: 4 }),
      acct({ wrapper: 'claude-corp', five: 62, seven: 71 }),
    ]);
    renderSwap();
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /team·alt/ })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: /team·b/ })).toBeInTheDocument();
  });

  it('never SUGGESTS one either — an excluded lane cannot be the recommendation', async () => {
    // The exclusion has to happen before the ranking, not after it: an
    // auth-dead account at 3/4 is the emptiest number on this fleet.
    stubAccounts([
      acct({ wrapper: 'claude2', authDead: true, five: 3, seven: 4 }),
      acct({ wrapper: 'claude-corp', five: 62, seven: 71 }),
    ]);
    renderSwap();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /team·b/ })).toHaveTextContent('suggested'));
    expect(screen.queryByText('team·alt')).not.toBeInTheDocument();
  });

  it('an OLDER server that omits authDead condemns nothing — absence is not a verdict', async () => {
    // `authDead` is ADDITIVE on the wire (no `FLEET_PROTO` bump), so a server
    // built before it simply omits the key. `=== true`, never truthiness: an
    // omitted field must leave every account rendering exactly as it does
    // today, offered AND rankable.
    const older: Record<string, unknown> = { ...acct({ wrapper: 'claude2', five: 8, seven: 22 }) };
    delete older.authDead;
    stubAccounts([
      older as unknown as AccountUsage,
      acct({ wrapper: 'claude-corp', five: 62, seven: 71 }),
    ]);
    renderSwap();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /team·alt/ })).toHaveTextContent('suggested'));
    expect(screen.getByRole('button', { name: /team·alt/ })).toBeInTheDocument();
  });
});

describe('SwapSheet reads one source for one account', () => {
  // THE SEAM THIS CLOSES. The gauges used to come off the live fleet frame
  // (`FleetSession.limits`, `{five, seven}` and no provenance) while
  // eligibility came off `GET /api/accounts` — two sources describing one
  // account, so the sheet could draw a confident bar on the very row it had
  // just refused to score. `server/src/fleet.ts` builds that frame field from
  // `readLimits(...)[wrapper]` and this route builds these rows from the same
  // call, so the frame is a strictly LOSSY copy of the poll: same numbers,
  // minus the flags, minus every account with no live session on it. The poll
  // wins, and these pin that it is the ONLY reader.
  it('ignores the frame\'s number when the poll says that window merely reset', async () => {
    const live = fleetSession({ id: 'claude2:a', wrapper: 'claude2', limits: { five: 1, seven: 1 } });
    stubAccounts([
      acct({ wrapper: 'claude2', five: 0, seven: 0, fiveRolledOver: true }),
      acct({ wrapper: 'claude-corp', five: 62, seven: 71 }),
    ]);
    renderSwap([live]);
    const row = await screen.findByRole('button', { name: /team·alt/ });
    await waitFor(() => expect(row).toHaveTextContent('reset'));
    // The frame's 1% is nowhere on the row, and it did not win the ranking.
    expect(row).not.toHaveTextContent('1%');
    expect(row).not.toHaveTextContent('suggested');
    expect(screen.getByRole('button', { name: /team·b/ })).toHaveTextContent('suggested');
  });

  it('says "limits unknown" for an account the poll has no row for, frame or no frame', async () => {
    // `readLimits` builds a row per `~/.cc-limits/*.json` plus any markered
    // lane and nothing else, so an account telemetry has never mentioned has
    // no row — and the frame's copy of a number the poll never carried is not
    // a second opinion this sheet is entitled to.
    const live = fleetSession({ id: 'claude-dev0:a', wrapper: 'claude-dev0', limits: { five: 5, seven: 5 } });
    stubAccounts([acct({ wrapper: 'claude-corp', five: 62, seven: 71 })]);
    renderSwap([live]);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /team·b/ })).toHaveTextContent('71%'));
    const row = screen.getByRole('button', { name: /team·d/ });
    expect(row).toHaveTextContent('limits unknown');
    expect(row).not.toHaveTextContent('5%');
    expect(row).not.toHaveTextContent('suggested');
  });
});

// Move-to-another-account sheet — plus the shared account-picker row that
// NewSessionSheet reuses. Target rows exclude the session's current account and
// every lane an OPERATOR has switched off; a lane the health PROBE measured
// auth-dead is still offered, marked in AccountsScreen's own words, and never
// suggested (the ruling is quoted in full on `disabledWrappers`). Each row
// carries the account chip and its limit gauges from `GET /api/accounts` (or
// honestly says "limits unknown"), and the least-loaded target — least loaded
// by MEASURED numbers only — wears a mono "suggested" tag. An empty list SAYS
// why it is empty rather than rendering a silent nothing. Tapping a target
// opens a QuickConfirm whose consequence sentence does the explaining;
// confirming posts api.swap — the restart itself then plays out over the fleet
// stream.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { FleetSession } from '../../../shared/api';
import { QuickConfirm, Sheet, toast } from '@ccrc/ui';
import { accountLabel, accountPool } from '../lib/accounts';
import { api, failedTo } from '../lib/api';
import { projectPoolOf, splitByPool } from '../lib/pools';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import { useAccountUsage } from './useProjectedHome';
import { AccountRow } from './AccountRow';
import { OtherPoolsDisclosure } from './chips';
import {
  disabledWrappers, factsFor, leastLoaded, pickableWrappers, pickerEmptiness,
} from './accountPicker';
import './fleet.css';

export interface SwapSheetProps {
  /** `home` is required here because §3.4's honest label cannot be written
   *  without it: a swap made from this sheet is TEMPORARY — `ccd swap` writes
   *  `.wrapper` and never `.home`, and `_auto_swap_check` returns the session
   *  to `home` the moment home has room (measured live, both directions,
   *  ~15 minutes) — so the sheet has to be able to NAME the account it goes
   *  back to.
   *
   *  `string | null`, deliberately WIDER than `FleetSession['home']`, and the
   *  plan for this task was wrong about needing it: it said both callers pass
   *  a whole `FleetSession`, but `SessionScreen` passes `live ?? { id,
   *  wrapper, project }` — a synthetic row for a session that is not in the
   *  live fleet snapshot at all. There, the home account is UNMEASURED. `null`
   *  says exactly that and nothing else; defaulting it to `wrapper` would make
   *  the sheet name the account the session is being moved AWAY from as the
   *  one it returns to, in the one state where nobody checked. The field stays
   *  REQUIRED so a new caller has to answer the question rather than omit it —
   *  absence and "unknown" are not the same fact.
   *
   *  `held` is what decides whether the return above can be PROMISED at all,
   *  and it is the same fact ccd itself keys off. Wave 3 §3.3 gave
   *  `_auto_swap_check`'s AFFINITY arm — the return-home / rate-ceiling path —
   *  an early `[[ -e "$REG/$id.hold" ]] && return 0`, so a held session is not
   *  brought home by anything until the hold clears. `FleetSession.held` is
   *  that file's reason string (null when unheld) measured FAIL-SHUT by
   *  `server/src/registry.ts` — a present-but-unreadable `.hold` reads as held,
   *  carrying `HOLD_UNREADABLE` — so `held !== null` here and `-e` there are
   *  one measurement, not two sources of truth. (§3.3 left the RESCUE arm
   *  alone: a hard-blocked held session is still evacuated. No copy below
   *  claims otherwise — every sentence is about the RETURN.)
   *
   *  THREE states, in three distinct values, because a caller handles each
   *  differently (no overloaded null at a seam):
   *    - a reason string — HELD. The automatic return is deferred; do not
   *      promise it, and show the reason, which is the display everywhere.
   *    - `null`          — MEASURED AND UNHELD. The promise is true; make it.
   *    - ABSENT          — nobody measured. `SessionScreen`'s synthetic row
   *      (`live ?? { id, wrapper, project, home: null }`) has no live fleet
   *      entry to read a hold off at all. Optional rather than required, and
   *      that is the one place this file's "make the caller answer" rule bends
   *      on purpose: absence is a real answer here, it is the HEDGED one, and
   *      a caller who forgets fails toward saying less than it knows rather
   *      than more. Read through the single `session.held === undefined` test
   *      below and nowhere else. */
  session: Pick<FleetSession, 'id' | 'wrapper' | 'project'>
    & { home: string | null }
    & Partial<Pick<FleetSession, 'held'>>;
  open: boolean;
  onClose: () => void;
  /** Injectable for tests; defaults to the app-wide fleet store. */
  fleet?: FleetStore;
}

export function SwapSheet({
  session,
  open,
  onClose,
  fleet = useFleetStore,
}: SwapSheetProps): ReactNode {
  const sessions = fleet((s) => s.sessions);
  const roster = fleet((s) => s.roster);
  const pools = fleet((s) => s.pools);
  // The target awaiting its consequence confirm (null = still browsing).
  const [target, setTarget] = useState<string | null>(null);
  // A disclosure belongs to this session's target list, just as the selected
  // target does. It must not stay open after the sheet changes session.
  const [showOther, setShowOther] = useState(false);

  // ADJUDICATED, cross-lane seam round. The ui-tsx lane listed this as a stale
  // target left behind by a CONFIRMED move — `move()` calls the sheet's
  // `onClose` and never clears `target`. Measured: that path is already clean.
  // `QuickConfirm`'s own confirm button runs `onConfirm(); onClose();`
  // (QuickConfirm.tsx:33-34) and this component's `onClose` for it IS
  // `setTarget(null)`, so confirm, cancel and scrim all clear it. The proposed
  // one-liner would have been dead code.
  //
  // The CLASS is real by a different trigger, and it is reachable: the
  // QuickConfirm is a SIBLING of the outer `Sheet`, not a child, so it does not
  // go away when the sheet does. `SessionActionsSheet`'s reset-on-close effect
  // (its `if (open) return; setSwapOpen(false)` — named rather than cited by
  // line, because the last line number here went stale the moment holds added
  // four `useState` hooks above it) sets `swapOpen = false` whenever the
  // actions sheet is dismissed, and FleetScreen keeps both components MOUNTED
  // across that close (its findings 2 and 3). So: open session A's actions ->
  // Swap -> pick team·alt -> dismiss the actions sheet. `open` goes false, the
  // sheet closes, and "Move to team·alt?" is left on screen with nothing under
  // it. Tap session B and the confirm is still there — and `move()` closes over
  // the CURRENT `session`, so confirming a dialog raised for A now swaps B.
  //
  // Same class as the reap sheet's `setShowAll(null)`: per-target state on a
  // sheet reused across targets. Same answer, and the same shape
  // `SessionActionsSheet`'s own comment cites as the pattern — except keyed on
  // `session.id` as well as `open`, because "this state belongs to this target"
  // is the actual invariant and closing is only the way it usually ends.
  useEffect(() => { setTarget(null); setShowOther(false); }, [open, session.id]);

  // ONE SOURCE FOR EVERY ACCOUNT-LEVEL FACT THIS SHEET SHOWS OR RANKS ON, and
  // it is the poll, not the fleet frame. The frame's `FleetSession.limits` used
  // to feed the gauges while the poll fed eligibility, and that is two sources
  // describing one account: the frame carries `{five, seven}` with no
  // provenance, so it would have gone on drawing a confident `0%` on the very
  // row the poll had just refused to score. `useAccountUsage`'s docstring
  // carries the measurement that settles which one wins — both are the same
  // server-side `readLimits` map, and the frame is the lossy copy.
  //
  // `sessions` is still read, for a different fact: `pickableWrappers` unions
  // in wrapper IDS reported by live sessions that this build's roster has no
  // entry for. That is membership, not measurement.
  const accounts = useAccountUsage(open);
  // TWO lists, because an empty picker has to be able to say WHICH emptiness it
  // is. `others` is every lane this build knows of except the one the session
  // is already on; `wrappers` is that minus the lanes an operator switched off.
  // A lane the probe condemned is in BOTH — it is offered, marked and unranked.
  const switchedOff = disabledWrappers(accounts);
  const others = pickableWrappers(roster, sessions).filter((w) => w !== session.wrapper);
  const wrappers = others.filter((w) => !switchedOff.includes(w));
  const emptiness = pickerEmptiness(others, wrappers);
  // No pools frame is a distinct condition from a measured untagged project.
  // `splitByPool` answers that absence permissively: all candidates remain
  // eligible and the sheet explains that it cannot vouch for the pool.
  const projectPool = projectPoolOf(pools, session.project);
  const split = splitByPool(roster, wrappers, projectPool);
  // Suggest only an eligible destination. Recommending a row hidden behind the
  // disclosure would turn a deliberate crossing into a default action.
  const suggested = leastLoaded(accounts, split.eligible);
  const projectPoolName = projectPool !== null && projectPool.state === 'tagged'
    ? projectPool.name
    : null;
  // The two causes, worded for THIS picker. `null` renders the rows instead.
  const emptyNote =
    emptiness === null
      ? null
      : emptiness === 'none-known'
        ? 'No other account to move this session to yet.'
        : 'Every other account is switched off on the fleet host — turn one back on from Accounts.';

  const move = (wrapper: string): void => {
    // The flag belongs to the selected row, not to the sheet generally. A
    // normal target retains the exact two-argument call used before pools.
    const cross = split.crossing.includes(wrapper);
    void (async () => {
      try {
        await (cross
          ? api.swap(session.id, wrapper, { crossPool: true })
          : api.swap(session.id, wrapper));
        toast(`Moving ${session.project} to ${accountLabel(roster, wrapper)}…`);
      } catch (err) {
        toast(failedTo('move', err), 'error');
      }
    })();
    onClose();
  };

  const targetLabel = target === null ? '' : accountLabel(roster, target);
  const targetPool = target === null ? null : accountPool(roster, target);
  const crossingClause =
    target !== null && split.crossing.includes(target) && targetPool !== null && projectPoolName !== null
      ? `This crosses pools on purpose: ${targetLabel} is in pool ${targetPool} and ${session.project} `
        + `is in pool ${projectPoolName}. ccrc records the crossing, and leaves the session alone until `
        + 'the project is retagged or it moves again. '
      : '';
  // Read off `session.home`, never off `session.wrapper`: on a session that has
  // already been relocated those differ, and that is exactly the case where the
  // return sentence matters. `null` = nobody measured it (see the prop's
  // docstring); the copy then states the SAME temporariness without naming an
  // account it does not know.
  const homeLabel = session.home === null ? null : accountLabel(roster, session.home);
  // THE SINGLE READER of `held` (see the prop's docstring). `undefined` is
  // "nobody measured", `null` is "measured, unheld", a string is the hold's
  // reason — three conditions this component answers three different ways, so
  // they are never compared with `??` or truthiness anywhere below.
  const held = session.held;
  // Where it goes back to, and what has to have room, in the two home states.
  // Pulled out so the hold branches read as one sentence each instead of four.
  const backTo = homeLabel ?? 'its home account';
  const whenRoom = homeLabel ?? 'that account';
  const homeClause = homeLabel === null
    ? 'Its home account is not known from here'
    : `Its home account is ${homeLabel}`;
  // The promise §3.4 shipped, kept WORD FOR WORD for the state it is true in —
  // an unheld session really is returned on the next affinity tick, and that
  // is the whole value of the control admitting it is temporary.
  const returnPromise = homeLabel === null
    ? 'a move is temporary either way: ccrc returns the session to its home account as soon as ' +
      'that account has room again'
    : `a move from here is temporary: ccrc returns the session to ${homeLabel} as soon as ` +
      `${homeLabel} has room again`;
  const sheetCopy =
    held === undefined
      ? `${homeClause}, and a move from here is normally temporary — ccrc returns the session to ` +
        `${backTo} as soon as ${whenRoom} has room again — but a program hold defers that ` +
        'automatic return, and whether one stands was not measured from here.'
      : held !== null
        ? `${homeClause}, but this session is held — ${held} — and ccrc does not return a held ` +
          'session on its own: it stays on the account you pick until the hold is released' +
          `${homeLabel === null ? '' : `, and only then goes back to ${homeLabel}`}.`
        : `${homeClause} — ${returnPromise}.`;

  return (
    <>
      <Sheet open={open} onClose={onClose} eyebrow="move session" title="Move to another account">
        <p className="sheet-copy">
          {session.project} runs on {accountLabel(roster, session.wrapper)} now.{' '}
          {sheetCopy}{' '}
          Pick where it should live meanwhile.
        </p>
        <div className="acct-list">
          {emptyNote === null ? (
            split.eligible.map((w) => (
              <AccountRow
                key={w}
                wrapper={w}
                facts={factsFor(accounts, w)}
                suggested={w === suggested}
                onPick={setTarget}
                roster={roster}
              />
            ))
          ) : (
            <p className="acct-none">{emptyNote}</p>
          )}
        </div>
        {split.unknown ? (
          <p className="pool-note">
            This project's pool is not known from here, so pool matching does not hide otherwise available accounts.
          </p>
        ) : split.crossing.length > 0 ? (
          <>
            <OtherPoolsDisclosure
              count={split.crossing.length}
              shown={showOther}
              onToggle={() => setShowOther((shown) => !shown)}
            />
            {showOther && (
              <div className="acct-list">
                {split.crossing.map((w) => (
                  <AccountRow
                    key={w}
                    wrapper={w}
                    facts={factsFor(accounts, w)}
                    onPick={setTarget}
                    roster={roster}
                    poolChip={accountPool(roster, w)}
                  />
                ))}
              </div>
            )}
          </>
        ) : null}
      </Sheet>
      <QuickConfirm
        open={target !== null}
        onClose={() => setTarget(null)}
        title={`Move to ${targetLabel}?`}
        consequence={crossingClause + `The session restarts under ${targetLabel}. Anyone attached is briefly ` +
          'disconnected. ' +
          // Same three-way split as the sheet copy, and it has to be here too:
          // this is the sentence read at the moment of commitment, and it is
          // where the old unconditional promise did the most damage — a
          // coordinator moving a held worker was told it would come back.
          (held === undefined
            ? `This is normally temporary — ccrc moves it back to ${backTo} once ${whenRoom} ` +
              'has room — but a program hold defers that, and whether one stands was not ' +
              'measured from here.'
            : held !== null
              ? `This session is held — ${held} — and ccrc does not move a held session back on ` +
                `its own: it stays under ${targetLabel} until the hold is released.`
              : `This is temporary — ccrc moves it back to ${backTo} once ${whenRoom} has room.`)}
        confirmLabel="Move"
        onConfirm={() => {
          if (target !== null) move(target);
        }}
      />
    </>
  );
}

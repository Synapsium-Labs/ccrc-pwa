// Move-to-another-account sheet — plus the shared account-picker row that
// NewSessionSheet reuses. Target rows exclude the session's current account;
// each carries the account chip and its live limit gauges from the fleet
// store (or honestly says "limits unknown"), and the least-loaded target
// wears a mono "suggested" tag. Tapping a target opens a QuickConfirm whose
// consequence sentence does the explaining; confirming posts api.swap — the
// restart itself then plays out over the fleet stream.
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { FleetSession, RosterWire } from '../../../shared/api';
import { limitBand } from '../components/LimitBar';
import { QuickConfirm } from '../components/QuickConfirm';
import { Sheet } from '../components/Sheet';
import { toast } from '../components/Toast';
import { accountHue, accountLabel, rosterWrapperIds } from '../lib/accounts';
import { api, apiErrorText } from '../lib/api';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import { useDisabledWrappers } from './useProjectedHome';
import './fleet.css';

export type AccountLimits = { five: number | null; seven: number | null } | null;

/** The accounts a session may be moved to. `disabled` names lanes ccd's
 *  kill-switch has switched off — they are excluded, because offering a swap
 *  target that cannot take work is worse than offering none. */
export function pickableWrappers(
  roster: readonly RosterWire[],
  sessions: FleetSession[],
  disabled: readonly string[] = [],
): string[] {
  // `string[]`, not the roster's own id type: a live session can report a
  // wrapper the roster doesn't have an entry for at all (a build running an
  // older/newer roster than the fleet host), and this list must still offer
  // it as a swap target rather than reject it at the type level.
  const all: string[] = rosterWrapperIds(roster);
  for (const s of sessions) {
    if (!all.includes(s.wrapper)) all.push(s.wrapper);
  }
  return all.filter((w) => !disabled.includes(w));
}

/** An account's live limits, read off any fleet session on that wrapper —
 *  limits are per-account, so the first session that knows them speaks for
 *  all. Null when no live session carries them. */
export function limitsFor(sessions: FleetSession[], wrapper: string): AccountLimits {
  for (const s of sessions) {
    if (s.wrapper === wrapper && s.limits !== null) return s.limits;
  }
  return null;
}

/** Load score for "suggested" ranking — the tighter of the two windows, or
 *  null when there is no such thing.
 *
 *  Fix round 3, verifier P7 (eleventh measurement forgery, adjudicated REAL).
 *  This was `Math.max(l.five ?? 0, l.seven ?? 0)`, and `five`/`seven` are
 *  `number | null` where null means THE WINDOW WAS NOT READ
 *  (shared/api.ts). Both nulls is a producible state, not a hypothetical:
 *  `readLimits` writes `{five: null, seven: null, …}` for any account whose
 *  limits file is missing or unparseable (server/src/limits.ts), and
 *  `server/src/fleet.ts` hands that straight to the session as a non-null
 *  `limits` object. The row therefore rendered "5h — · 7d —" and wore the
 *  "suggested" tag at the same time, beating a genuinely-measured account at
 *  5%: an account nobody could read was recommended precisely BECAUSE nobody
 *  could read it.
 *
 *  One known window is not enough either. The score is a MAXIMUM, so with the
 *  other window unread the true score is only bounded below — `{five: 3,
 *  seven: null}` scored 3 and won the ranking while its 7-day window could
 *  have been at 99. A recommendation built on that is a guess about the number
 *  that would have decided it.
 *
 *  Not scoring is not a refusal to help: an account with no score is simply
 *  not ranked, its gauges still say `—`, and it remains tappable. What is gone
 *  is ccrc telling the reader it is the emptiest pool. */
const load = (l: AccountLimits): number | null =>
  l === null || l.five === null || l.seven === null ? null : Math.max(l.five, l.seven);

/** The least-loaded wrapper among those whose BOTH limit windows were actually
 *  read; null if none was. */
export function leastLoaded(sessions: FleetSession[], wrappers: string[]): string | null {
  let best: string | null = null;
  let bestLoad = Infinity;
  for (const w of wrappers) {
    const score = load(limitsFor(sessions, w));
    if (score !== null && score < bestLoad) {
      bestLoad = score;
      best = w;
    }
  }
  return best;
}

/** One thin gauge row — mono label · track · tabular percentage. Spans only,
 *  so the row stays valid inside the AccountRow button. */
function Gauge({ label, value }: { label: string; value: number | null }): ReactNode {
  const pct = value === null ? null : Math.min(100, Math.max(0, value));
  return (
    <span className="acct-gauge">
      <span>{label}</span>
      <span className="limit-track">
        {pct !== null && (
          <span
            className={`limit-fill limit-fill--${limitBand(pct)}`}
            style={{ width: `${pct}%` }}
          />
        )}
      </span>
      <span className="acct-gauge-pct">{pct === null ? '—' : `${Math.round(pct)}%`}</span>
    </span>
  );
}

/** A tappable account row: chip (label + hue), live limit gauges, chevron.
 *  Shared by SwapSheet (targets) and NewSessionSheet (step 1). */
export function AccountRow({
  wrapper,
  limits,
  suggested = false,
  onPick,
  roster,
}: {
  wrapper: string;
  limits: AccountLimits;
  suggested?: boolean;
  onPick: (wrapper: string) => void;
  roster: readonly RosterWire[];
}): ReactNode {
  // A direct hue lookup, not a re-parse of `accountColorVar`'s returned
  // token NAME: the string-inspection this replaced
  // (`colorVar.startsWith('--acct-')`) worked only by coincidence — it was
  // really asking "does this wrapper have a real hue", and `accountHue`
  // answers that directly, `undefined` for a wrapper the roster does not
  // have. The `--bg-raised` fallback is unchanged: a wrapper outside the
  // roster (a live session reporting an id this roster build does not know)
  // still gets a neutral chip, never an invented tint.
  const hue = accountHue(roster, wrapper);
  const colorVar = hue === undefined ? '--ink-tertiary' : `--acct-${hue}`;
  const chipStyle: CSSProperties = {
    color: `var(${colorVar})`,
    background: hue === undefined ? 'var(--bg-raised)' : `var(${colorVar}-tint)`,
  };
  return (
    <button type="button" className="acct-row" onClick={() => onPick(wrapper)}>
      <span className="chip" style={chipStyle}>
        <i aria-hidden="true" />
        {accountLabel(roster, wrapper)}
      </span>
      {suggested && <span className="acct-suggested">suggested</span>}
      <span className="acct-gauges">
        {limits === null ? (
          <span className="acct-unknown">limits unknown</span>
        ) : (
          <>
            <Gauge label="5h" value={limits.five} />
            <Gauge label="7d" value={limits.seven} />
          </>
        )}
      </span>
      <span className="acct-chev" aria-hidden="true">
        ›
      </span>
    </button>
  );
}

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
  // The target awaiting its consequence confirm (null = still browsing).
  const [target, setTarget] = useState<string | null>(null);

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
  // Swap -> pick alt·max -> dismiss the actions sheet. `open` goes false, the
  // sheet closes, and "Move to alt·max?" is left on screen with nothing under
  // it. Tap session B and the confirm is still there — and `move()` closes over
  // the CURRENT `session`, so confirming a dialog raised for A now swaps B.
  //
  // Same class as the reap sheet's `setShowAll(null)`: per-target state on a
  // sheet reused across targets. Same answer, and the same shape
  // `SessionActionsSheet`'s own comment cites as the pattern — except keyed on
  // `session.id` as well as `open`, because "this state belongs to this target"
  // is the actual invariant and closing is only the way it usually ends.
  useEffect(() => { setTarget(null); }, [open, session.id]);

  const disabledWrappers = useDisabledWrappers(open);
  const wrappers = pickableWrappers(roster, sessions, disabledWrappers).filter((w) => w !== session.wrapper);
  const suggested = leastLoaded(sessions, wrappers);

  const move = (wrapper: string): void => {
    void (async () => {
      try {
        await api.swap(session.id, wrapper);
        toast(`Moving ${session.project} to ${accountLabel(roster, wrapper)}…`);
      } catch (err) {
        toast(`Couldn't move — ${apiErrorText(err)}`, 'error');
      }
    })();
    onClose();
  };

  const targetLabel = target === null ? '' : accountLabel(roster, target);
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
          {wrappers.map((w) => (
            <AccountRow
              key={w}
              wrapper={w}
              limits={limitsFor(sessions, w)}
              suggested={w === suggested}
              onPick={setTarget}
              roster={roster}
            />
          ))}
        </div>
      </Sheet>
      <QuickConfirm
        open={target !== null}
        onClose={() => setTarget(null)}
        title={`Move to ${targetLabel}?`}
        consequence={`The session restarts under ${targetLabel}. Anyone attached is briefly ` +
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

// Move-to-another-account sheet — plus the shared account-picker row that
// NewSessionSheet reuses. Target rows exclude the session's current account
// and every lane that cannot take work (kill-switched, or a credential the
// health probe measured dead); each carries the account chip and its limit
// gauges from `GET /api/accounts` (or honestly says "limits unknown"), and the
// least-loaded target — least loaded by MEASURED numbers only — wears a mono
// "suggested" tag. Tapping a target opens a QuickConfirm whose
// consequence sentence does the explaining; confirming posts api.swap — the
// restart itself then plays out over the fleet stream.
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { AccountUsage, FleetSession, RosterWire } from '../../../shared/api';
import { limitBand } from '../components/LimitBar';
import { QuickConfirm } from '../components/QuickConfirm';
import { Sheet } from '../components/Sheet';
import { toast } from '../components/Toast';
import { accountHue, accountLabel, rosterWrapperIds } from '../lib/accounts';
import { api, apiErrorText } from '../lib/api';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import { useAccountUsage } from './useProjectedHome';
import './fleet.css';

/** One account's row as `GET /api/accounts` carries it, or `null` when there is
 *  no row for that account — the poll has not landed, or telemetry has never
 *  mentioned this account at all (`readLimits` builds a row per
 *  `~/.cc-limits/*.json`, plus any markered lane, and nothing else).
 *
 *  THE WHOLE ROW, not the `{five, seven}` pair this used to be. The pair came
 *  off the live fleet frame (`FleetSession.limits`) and carried no provenance,
 *  so a window that had merely ROLLED OVER — a rate-limit window whose reset
 *  time elapsed, whose `0` is inferred from a timestamp and was never observed
 *  — was indistinguishable from an account something had measured empty. It
 *  therefore scored 0, won `leastLoaded`, and wore the "suggested" tag on a
 *  fleet where nothing had run on it in days. `AccountUsage` answers that with
 *  `fiveRolledOver`/`sevenRolledOver`, and this sheet was already fetching it.
 *  (`server/src/limits.ts`'s `measured()` and ccd's `_limit_score` are the same
 *  decision on the same fact, one layer down.) */
export type AccountFacts = AccountUsage | null;

/** The accounts a session may be moved to. `unusable` names lanes that cannot
 *  take work — they are excluded, because offering a swap target that cannot
 *  take work is worse than offering none. */
export function pickableWrappers(
  roster: readonly RosterWire[],
  sessions: FleetSession[],
  unusable: readonly string[] = [],
): string[] {
  // `string[]`, not the roster's own id type: a live session can report a
  // wrapper the roster doesn't have an entry for at all (a build running an
  // older/newer roster than the fleet host), and this list must still offer
  // it as a swap target rather than reject it at the type level.
  const all: string[] = rosterWrapperIds(roster);
  for (const s of sessions) {
    if (!all.includes(s.wrapper)) all.push(s.wrapper);
  }
  return all.filter((w) => !unusable.includes(w));
}

/** The lanes that cannot take work, from the accounts poll's own rows.
 *
 *  TWO facts, ONE affordance — `AccountsScreen` already says this in the same
 *  words and renders them through one `data-disabled` attribute: `disabled` is
 *  the operator's kill-switch (`~/.cc-sessions/<w>-disabled`, touched by hand),
 *  `authDead` is the health probe's durable verdict (`<w>-authdead`, a
 *  credential that did not authenticate). The server keeps them apart for good
 *  reason — intent cannot be wrong, a measurement can — but here they answer
 *  the same question, "can a session be moved onto this lane and run?", and the
 *  answer is no either way. Swapping onto an auth-dead account produces a
 *  session that cannot authenticate, which is a worse outcome than the swap
 *  simply not being offered.
 *
 *  `=== true` ON BOTH, never truthiness. `authDead` is ADDITIVE on the wire
 *  (`shared/api.ts`, on `RosterWire.hidden`'s terms, no `FLEET_PROTO` bump): a
 *  server built before it OMITS it, and ABSENCE MEANS NOT CONDEMNED, so an
 *  older payload must keep offering every account exactly as it does today.
 *  `disabled` is spelled the same way it always was.
 *
 *  `null` rows — nothing landed, or the poll failed — exclude NOTHING, which is
 *  `useAccountUsage`'s own stated failure posture: an account offered that
 *  turns out to be unusable is recoverable (ccd refuses the swap), while one
 *  hidden because telemetry hiccuped looks like it does not exist. */
export function unusableWrappers(rows: readonly AccountUsage[] | null): string[] {
  return (rows ?? [])
    .filter((a) => a.disabled === true || a.authDead === true)
    .map((a) => a.wrapper);
}

/** One account's row out of the poll, or `null` when the poll has none for it.
 *  Account-level facts are per-ACCOUNT, so a single row speaks for every
 *  session on that lane — which is what the old `limitsFor(sessions, wrapper)`
 *  was really saying when it took the first live session's copy of them. */
export function factsFor(rows: readonly AccountUsage[] | null, wrapper: string): AccountFacts {
  return (rows ?? []).find((a) => a.wrapper === wrapper) ?? null;
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
 *  AN INFERRED ZERO IS UNKNOWN TOO, and it is the same magnet reaching through
 *  a seam this function could not see. A rolled-over window carries a REAL `0`
 *  — `server/src/limits.ts` writes it the moment a `resetAt` lapses or a sample
 *  outlives its own window — but that 0 was DERIVED FROM A TIMESTAMP, never
 *  observed. Read as a measurement it is the best score on the fleet, so the
 *  account wins every placement; nothing runs on an account nothing was moved
 *  to, so nothing ever replaces the inferred number, and the account nobody has
 *  touched in days stays "suggested" forever. Unlike the two above, this one
 *  fires on a perfectly healthy fleet, every time a window turns over.
 *
 *  ONE rolled window is enough, for the same reason one null window is: the
 *  score is a maximum, and the elapsed half bounds the truth only from below.
 *
 *  THIS IS `server/src/limits.ts`'s `measured()`, TERM FOR TERM — the same
 *  disjuncts in the same order over the same fields, and ccd's `_limit_score`
 *  is the third copy of the same decision in bash. Deliberately not a second
 *  spelling of one rule: the swap picker learned the null half first and
 *  placement learned the inferred zero first, and they are the same lesson.
 *  The one difference is punctuation, not meaning — `=== true` rather than
 *  `measured()`'s bare truthiness, because this side reads the flags off the
 *  WIRE, where a field can simply be absent, while `limits.ts` reads a value it
 *  built itself. On every value `AccountUsage`'s declared `boolean` can carry,
 *  the two forms decide identically.
 *
 *  Not scoring is not a refusal to help: an account with no score is simply
 *  not ranked, its gauges still say `—` (or `reset`, which is the rolled-over
 *  window saying so out loud), and it remains tappable. What is gone is ccrc
 *  telling the reader it is the emptiest pool. */
const load = (l: AccountFacts): number | null =>
  l === null || l.five === null || l.seven === null
  || l.fiveRolledOver === true || l.sevenRolledOver === true
    ? null
    : Math.max(l.five, l.seven);

/** The least-loaded wrapper among those whose BOTH limit windows were actually
 *  MEASURED — read, and not inferred from an elapsed window; null if none was.
 *  `null` is the honest answer when every candidate is unscoreable: no target
 *  wears the tag, rather than one wearing it off a number nobody took. */
export function leastLoaded(
  rows: readonly AccountUsage[] | null,
  wrappers: string[],
): string | null {
  let best: string | null = null;
  let bestLoad = Infinity;
  for (const w of wrappers) {
    const score = load(factsFor(rows, w));
    if (score !== null && score < bestLoad) {
      bestLoad = score;
      best = w;
    }
  }
  return best;
}

/** One thin gauge row — mono label · track · tabular percentage. Spans only,
 *  so the row stays valid inside the AccountRow button.
 *
 *  THE THREE-WAY IS `AccountsScreen`'s `Bar`, WORD FOR WORD: "reset" (an
 *  inferred zero) ≠ a measured "0%" ≠ "—" (nobody measured it). That screen
 *  already owns the vocabulary for exactly this state and this is the same fact
 *  on a second surface, so it says the same word rather than inventing a second
 *  visual language for it. The track is left EMPTY for a rolled-over window,
 *  which is what `Bar` renders too — its fill is `width: 0%` there, because the
 *  0 it would draw is the inferred one. A confident bar and the word "reset"
 *  would contradict each other in the same row. */
function Gauge({ label, value, rolledOver }: {
  label: string; value: number | null; rolledOver: boolean;
}): ReactNode {
  const pct = rolledOver || value === null ? null : Math.min(100, Math.max(0, value));
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
      <span className="acct-gauge-pct">
        {rolledOver ? 'reset' : pct === null ? '—' : `${Math.round(pct)}%`}
      </span>
    </span>
  );
}

/** A tappable account row: chip (label + hue), limit gauges, chevron.
 *  Shared by SwapSheet (targets) and NewSessionSheet (step 1) — ONE row
 *  component, so both pickers say the same thing about the same account, and
 *  both are fed from the same source (`useAccountUsage`) for the same reason. */
export function AccountRow({
  wrapper,
  facts,
  suggested = false,
  onPick,
  roster,
}: {
  wrapper: string;
  facts: AccountFacts;
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
        {facts === null ? (
          <span className="acct-unknown">limits unknown</span>
        ) : (
          <>
            <Gauge label="5h" value={facts.five} rolledOver={facts.fiveRolledOver === true} />
            <Gauge label="7d" value={facts.seven} rolledOver={facts.sevenRolledOver === true} />
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
  useEffect(() => { setTarget(null); }, [open, session.id]);

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
  const wrappers = pickableWrappers(roster, sessions, unusableWrappers(accounts))
    .filter((w) => w !== session.wrapper);
  const suggested = leastLoaded(accounts, wrappers);

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
              facts={factsFor(accounts, w)}
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

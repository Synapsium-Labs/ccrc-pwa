// The account PICKER's policy — who may be offered, who is switched off, who
// is condemned, and which measured lane is the emptiest.
//
// WHY IT IS ITS OWN FILE. `NewSessionSheet` was importing five names out of
// `SwapSheet.tsx` — a sheet reaching into another sheet for the rules both
// obey. The rules are neither sheet's: they are the picker's, and both
// pickers are built from them. Nothing here renders, so the file is `.ts`.
//
// EVERY ARGUMENT CAME WITH ITS RULE, the health-probe ruling on
// `disabledWrappers` above all: a measurement may change what is SUGGESTED
// and never what is OFFERED.
import type { AccountUsage, FleetSession, RosterWire } from '../../../shared/api';
import { rosterWrapperIds } from '../lib/accounts';

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

/** Every account a picker could offer, before anything is taken away:
 *  the roster's own ids plus any wrapper a live session reports that this
 *  build's roster has no entry for.
 *
 *  `excluded` is what may not be offered AT ALL, and the only thing either
 *  picker passes here is `disabledWrappers` — the operator's kill switch.
 *  A health-probe verdict deliberately does NOT come through this parameter;
 *  see `disabledWrappers` for the ruling that keeps it out. */
export function pickableWrappers(
  roster: readonly RosterWire[],
  sessions: FleetSession[],
  excluded: readonly string[] = [],
): string[] {
  // `string[]`, not the roster's own id type: a live session can report a
  // wrapper the roster doesn't have an entry for at all (a build running an
  // older/newer roster than the fleet host), and this list must still offer
  // it as a swap target rather than reject it at the type level.
  const all: string[] = rosterWrapperIds(roster);
  for (const s of sessions) {
    if (!all.includes(s.wrapper)) all.push(s.wrapper);
  }
  return all.filter((w) => !excluded.includes(w));
}

/** The lanes an OPERATOR has switched off — the ONE fact that costs a lane its
 *  place in either picker. (D-1978.)
 *
 *  ONE OF THE TWO CONDEMNED STATES, NOT BOTH, and the split is the whole point.
 *  This function used to fold `authDead` in beside `disabled` "because they
 *  answer the same question". They do not, and `_authdead`'s own header in
 *  ccd/ccd rules on it at the marker's definition:
 *
 *      NOT `-disabled`. That name is OPERATOR intent … This one is a
 *      MEASUREMENT, which can be wrong — so it never joins `_account_ok`, and
 *      its two consumers rank-last (`_swap_target`) and skip-scoring
 *      (`_ws_least_loaded`) instead. A rescue must always have a destination.
 *
 *  So a probe verdict may cost PREFERENCE and must never cost ELIGIBILITY:
 *    - `disabled` (`~/.cc-sessions/<w>-disabled`, touched by a human) is INTENT.
 *      It cannot be wrong, and a lane carrying it is not offered at all.
 *    - `authDead` (`<w>-authdead`, written by `ccd-account-health`) is a
 *      MEASUREMENT. The lane stays PICKABLE, is MARKED with AccountsScreen's own
 *      words, and can never be SUGGESTED — `condemned` below is that one
 *      predicate, and `load`/`AccountRow` are its two consumers, exactly the
 *      shape `_ws_least_loaded` and `projectHome` (server/src/limits.ts) already
 *      hold. All four implementations of this decision now agree; this file was
 *      the one that inverted it, and an all-condemned fleet answered the human
 *      rescuing a wedged session with an EMPTY picker.
 *
 *  WHAT ACTUALLY HAPPENS ON A TAP (D-1979), stated because the sentence this
 *  replaces got it backwards: NOTHING refuses the swap. `cmd_swap` gates on
 *  `_is_valid_wrapper`, a registry entry, target≠current, an executable wrapper
 *  and a transcript match — it reads neither marker, and says so in its own
 *  header ("Manual swaps may target ANY valid wrapper; the pool policy only
 *  constrains auto-swaps"), and `POST /api/sessions/:id/swap` adds no check of
 *  its own. That is deliberate and it is the ruling working: a manual,
 *  human-directed rescue is exactly the case a probe verdict must not veto. The
 *  list below is therefore the WHOLE gate for `disabled`, and for `authDead` it
 *  is deliberately not a gate at all — only a mark.
 *
 *  `=== true`, never truthiness, on both flags. `authDead` is ADDITIVE on the
 *  wire (`shared/api.ts`, on `RosterWire.hidden`'s terms, no `FLEET_PROTO`
 *  bump): a server built before it OMITS it, and ABSENCE MEANS NOT CONDEMNED.
 *
 *  `null` rows — nothing landed, or the poll failed — exclude NOTHING, which is
 *  `useAccountUsage`'s own stated failure posture, and the residual risk is now
 *  named rather than argued away: during a poll gap a switched-off lane IS
 *  offered and a tap on it WILL move the session there (see above — nothing
 *  refuses it), and the operator learns it from the session failing to come
 *  back rather than from a refusal. That is still the better half of the trade,
 *  because hiding every account whenever telemetry hiccups makes a healthy
 *  fleet look like it does not exist, and the swap it would have prevented is
 *  undone by another swap. */
export function disabledWrappers(rows: readonly AccountUsage[] | null): string[] {
  return (rows ?? [])
    .filter((a) => a.disabled === true)
    .map((a) => a.wrapper);
}

/** The health probe's durable verdict on ONE account, read off the poll's own
 *  row: `~/.cc-sessions/<w>-authdead` stands for it.
 *
 *  ONE PREDICATE, TWO CONSUMERS, which is `projectHome`'s own phrase for the
 *  identical shape on the server (`server/src/limits.ts`: "`_ws_least_loaded`
 *  reads `_authdead` once per candidate and spends the answer twice"). Here the
 *  two consumers are `load` — a condemned lane is not scored, so it can never
 *  wear "suggested" — and `AccountRow`, which marks the row. What NEITHER does
 *  is remove it: eligibility is not this fact's to spend.
 *
 *  Not scoring it is not the same as waiting for its telemetry to age out, and
 *  that window is the reachable half: nothing runs on a condemned lane, so it
 *  cannot refresh its own statusline, but its LAST sample stays fresh for hours
 *  — and a lane that stopped working at 3% is the emptiest number on the fleet
 *  for that whole window. It would win the tag on the strength of having died.
 *
 *  `=== true` through an optional chain: `null` facts (no row for this account
 *  at all) are NOT a verdict, and neither is an older server's omitted field. */
export function condemned(facts: AccountFacts): boolean {
  return facts?.authDead === true;
}

/** Why a picker has nothing to offer — a distinct token per cause, because the
 *  two are not the same sentence and `null` (there IS something to offer) is
 *  not either. (D-1980.) The component words them; this decides which fact
 *  is true.
 *
 *  It exists because both pickers used to render `wrappers.map(...)` into a
 *  bare `<div className="acct-list">` with no zero branch, so "every lane is
 *  switched off" and "the roster has not arrived" both came out as an empty box
 *  under the words "Pick where it should live meanwhile". `AccountsStrip`
 *  already refuses that in the same file tree — three named placeholders rather
 *  than one silence — and this is that rule on the pickers. */
export type PickerEmptiness = 'none-known' | 'all-switched-off' | null;

export function pickerEmptiness(
  candidates: readonly string[],
  offered: readonly string[],
): PickerEmptiness {
  if (offered.length > 0) return null;
  return candidates.length === 0 ? 'none-known' : 'all-switched-off';
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
 *  AND A CONDEMNED LANE IS NOT SCORED AT ALL — the fourth disjunct, and the
 *  only one that is not about the number. `projectHome` spells it as a separate
 *  `.filter(notCondemned)` BEFORE `measured()` rather than a disjunct inside it,
 *  which is the same composite by a different arrangement; the disjunct is what
 *  this side can do without a filter step, and `condemned` is the shared
 *  predicate either way. Its own docstring carries the reason the flag cannot
 *  be left to telemetry staleness.
 *
 *  Not scoring is not a refusal to help: an account with no score is simply
 *  not ranked, its gauges still say `—` (or `reset`, which is the rolled-over
 *  window saying so out loud), and it remains tappable. What is gone is ccrc
 *  telling the reader it is the emptiest pool. That is the WHOLE cost a
 *  measurement is allowed to charge — preference, never eligibility. */
const load = (l: AccountFacts): number | null => {
  if (condemned(l) || l === null) return null;
  // A WINDOW THE PLAN DOES NOT HAVE IS NOT AN UNMEASURED WINDOW. `measured()`
  // and ccd's `_limit_score` carry the same clause; an absent marker falls
  // through to the pair rule on all three sides.
  if (l.fiveWindowMinutes === 0) {
    return l.seven === null || l.sevenRolledOver === true ? null : l.seven;
  }
  return l.five === null || l.seven === null
      || l.fiveRolledOver === true || l.sevenRolledOver === true
    ? null
    : Math.max(l.five, l.seven);
};

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

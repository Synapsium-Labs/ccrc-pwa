// Wrapper → jargon-free account label + hue projections over the RUNTIME
// roster. The ONLY place the wrapper names are translated for humans (plan:
// "Move to another account", never "swap wrapper"). Colour is always a HUE
// NAME (`Hue`, shared/roster.ts) — components turn that into a token custom
// property via `` `--acct-${hue}` `` and resolve it with var(...), so both
// themes flow through tokens.css.
//
// Stage 2a, Task 7. Task 6 deleted `shared/api.ts`'s compile-time `ACCOUNTS`
// literal; the roster is runtime data now (`~/.ccrc/accounts.json`, parsed by
// `shared/roster.ts`), and the server ships it to this app on
// `GET /api/accounts` as `AccountsResponse.roster` (`RosterWire[]`). This
// module is the ONE place that wire array is turned into a label/hue lookup —
// every function below is a pure projection over whatever roster the caller
// hands it, so they stay synchronous and safe to call during render.
//
// The roster itself lives in the fleet store (`stores/fleet.ts`'s `roster`
// field, polled from `GET /api/accounts` and connected app-wide) or, for the
// three screens that already run their own `/api/accounts` poll
// (AccountsStrip, AccountsScreen, useProjectedHome's siblings), the same
// response's `roster` field read locally. Nothing here fetches anything.
//
// `PRODUCTION_ROSTER`, the hand-typed transitional copy of the five
// production accounts Task 6 left behind for exactly this task to delete, is
// gone. An unknown wrapper (roster not yet arrived, or a wrapper the roster
// genuinely does not have) still degrades honestly: the raw wrapper name as
// the label, `--ink-tertiary` as the colour — never a hidden account, never a
// guessed hue.
import type { RosterWire } from '../../../shared/api';
import { POOL_NAME_RE, type Hue } from '../../../shared/roster';
import type { AccountPoolWire } from '../../../shared/poolrule';

/** This account's roster entry, or `undefined` for a wrapper the roster does
 *  not (yet) have — an unarrived poll, or a genuinely unrostered wrapper (a
 *  live session's `wrapper`/`home` is never type-narrowed to the roster; see
 *  `shared/api.ts`'s `Wrapper` docstring). The one lookup every function below
 *  goes through, so "known to this roster" is answered in exactly one place. */
function entryFor(roster: readonly RosterWire[], wrapper: string): RosterWire | undefined {
  return roster.find((a) => a.id === wrapper);
}

/** Human label for an account, e.g. 'claude2' → 'team·alt'. Unknown wrappers
 *  fall back to the raw name — never hide an account the server reports,
 *  including in the window before the roster has arrived at all. */
export function accountLabel(roster: readonly RosterWire[], wrapper: string): string {
  return entryFor(roster, wrapper)?.label ?? wrapper;
}

/** This account's hue, or `undefined` for a wrapper the roster does not have
 *  an entry for. `undefined`, never a guessed `Hue` — the caller decides the
 *  neutral fallback (every call site today: `--ink-tertiary`, never a status
 *  hue, so it can't be misread as state). */
export function accountHue(roster: readonly RosterWire[], wrapper: string): Hue | undefined {
  return entryFor(roster, wrapper)?.hue;
}

/** Ruling T9-R1 (2026-09-18, mid-Task-9): the PWA CANNOT fold the
 *  central/declared/untagged precedence itself — the central `pool_edges`
 *  rows live only in `~/.ccrc/coord.db`, and nothing puts them on this wire.
 *  A client-side fold (this file's first cut at `accountPoolState`, which
 *  took an `edges` map that no caller could ever actually populate) would
 *  silently resolve to "declared, always" while the server enforces a
 *  central tag it never told this app about — precisely the
 *  `NewSessionSheet.tsx:186-188` hazard the ruling measured already live.
 *
 *  So the SERVER folds the precedence, and this app only reads the answer.
 *  Task 7's fix round (T7-R2, landed while this task was mid-flight) added
 *  `RosterWire.resolvedPool?: AccountPoolWire` to `shared/api.ts` — the
 *  `{ state, pools, origin }` shape `shared/poolrule.ts` declares, precedence
 *  already folded server-side by `resolvedAccountPool` (`server/src/poolrule.ts`).
 *  This reads that field directly off the real, now-shipped type; no local
 *  widening is needed. */

/** A `tagged` answer whose every name actually parses as `POOL_NAME_RE`, or
 *  `untagged` (on the SAME `origin`) when even one does not.
 *
 *  Review round 1, I3: the docstring below used to claim the malformed-value
 *  courtesy was "preserved verbatim under the richer wire" while the code
 *  only ever applied it to the DECLARED arm — a `resolvedPool` carrying an
 *  off-grammar name (this client's own fetch is a cast; nothing between the
 *  wire and this function re-validates a union's string payload) returned
 *  early, untested, before `POOL_NAME_RE` was ever consulted. The distrust
 *  this client owes an unvalidated string does not depend on which carrier
 *  supplied it, so both arms of `accountPoolState` now route a `tagged`
 *  candidate through here before trusting it. */
function grammarChecked(state: AccountPoolWire): AccountPoolWire {
  if (state.state !== 'tagged') return state;
  return state.pools.every((p) => POOL_NAME_RE.test(p))
    ? state
    : { state: 'untagged', origin: state.origin };
}

/** This account's pool, as the FULL wire the rule understands — `tagged`
 *  (with which pools and WHICH CARRIER decided) or `untagged` (also carrying
 *  its carrier, so a reader can tell "nobody has tagged this yet" from
 *  "the central edge was just cleared and the roster default took over").
 *
 *  THE ONLY READER of `RosterWire.pool`/`resolvedPool` in this app (spec
 *  §5.3, §5.9). It does NOT fold the central/declared PRECEDENCE (see T9-R1
 *  above) — when the server's `resolvedPool` is present, its `state` and
 *  `origin` are taken VERBATIM, whatever the server measured; this function
 *  never second-guesses WHICH carrier decided or recomputes an ordering the
 *  server already applied. When `resolvedPool` is absent (a server built
 *  before Task 7's fix round), this falls back to the declared-only read
 *  `accountPool` has always made, `origin: 'declared'` because that is the
 *  only carrier this path can possibly be reading.
 *
 *  What it DOES still check, on both arms: a `tagged` name must parse as
 *  `POOL_NAME_RE`, or the answer folds to `untagged` on the same origin
 *  (`grammarChecked` above) — the canonical server parser refuses an
 *  off-grammar value before it is ever written to `accounts.json`, and
 *  neither `declaredAccountPool` nor `resolvedAccountPool`
 *  (`shared/poolrule.ts`, `server/src/poolrule.ts`) re-validates the
 *  grammar of a string they are handed, so a malformed value can still
 *  arrive on EITHER field despite trusted canonical output never carrying
 *  one. `poolRule`'s permissive forecast is for an absent account tag, not
 *  a tag this client cannot validate.
 *
 *  Every pool question the PWA asks — the swap split, the new-session split,
 *  the option list in `PoolSheet`, the off-pool marker on a row, the
 *  account-pool chip — must come from here (directly, or through
 *  `accountPool` below) so no surface can invent a precedence answer the
 *  server did not actually measure. */
export function accountPoolState(roster: readonly RosterWire[], wrapper: string): AccountPoolWire {
  const resolved = entryFor(roster, wrapper)?.resolvedPool;
  if (resolved !== undefined) return grammarChecked(resolved);
  const p = entryFor(roster, wrapper)?.pool;
  return grammarChecked(
    typeof p === 'string'
      ? { state: 'tagged', pools: [p], origin: 'declared' }
      : { state: 'untagged', origin: 'declared' },
  );
}

/** This account's POOL NAME, or `null` for an untagged account, an account
 *  this roster does not have, or a server built before pools existed (the key
 *  is simply absent on that wire, and absence-permits means untagged) — FOUR
 *  reasons, and this function names only two of them.
 *
 *  OVERLOADED, DISCLOSED RATHER THAN FIXED HERE (item 6, I4, wave-1 fix
 *  round A): `null` also covers an `unreadable`, `malformed` or `stale`
 *  account — `accountPoolState`'s other three states — collapsing "nobody
 *  tagged this" with "nobody could tell" into one permissive answer. Latent
 *  only because `resolvedAccountPool` (`server/src/poolrule.ts`) cannot yet
 *  produce those three states for a real fleet; real the day it does. Every
 *  ELIGIBILITY decision (anything that feeds `poolSide`/`splitByPool`,
 *  `lib/pools.ts`) now reads `accountPoolState` directly instead of this
 *  function, specifically so that fold cannot reach a placement choice — see
 *  `poolSide`'s own docstring. What is still EXPOSED to this narrowed value:
 *  every caller that only ever wanted a NAME to display and never a
 *  decision to make — `NewSessionSheet`/`SwapSheet`'s `poolChip` text,
 *  `SessionLine`'s account-pool label, `poolOptions`' distinct-name list —
 *  each of which already renders nothing for a bare `null`, so the display
 *  degrades honestly even though the REASON is not shown.
 *
 *  A one-line derivation over `accountPoolState` above, kept for exactly
 *  those callers, which have no use for `origin` either. `accountPoolState`
 *  stays the ONE place `RosterWire.pool`/`resolvedPool` is read; this never
 *  re-reads either on its own. */
export function accountPool(roster: readonly RosterWire[], wrapper: string): string | null {
  const state = accountPoolState(roster, wrapper);
  return state.state === 'tagged' ? state.pools[0] : null;
}

/** Token custom-property name for the account's chip colour, e.g. 'claude' →
 *  '--acct-cyan' (tint is `${colorVar}-tint`). Unknown wrappers get neutral
 *  meta-gray ink — never a status hue. A thin wrapper over `accountHue` for
 *  the common case (paint with whatever this account's colour is, known or
 *  not); a caller that must tell "real hue" apart from "fallback" — the
 *  bug this task's SessionScreen/SwapSheet fixes turned on exactly that
 *  distinction — reads `accountHue` directly instead of re-parsing this
 *  string. */
export function accountColorVar(roster: readonly RosterWire[], wrapper: string): string {
  const hue = accountHue(roster, wrapper);
  return hue === undefined ? '--ink-tertiary' : `--acct-${hue}`;
}

/** "team·max, team·alt and team·b" — the shared punctuation for every
 *  account-label list this app renders.
 *
 *  Exported, though it names no account fact of its own, because
 *  `poolLabelList` (`lib/pools.ts`, which cannot live here without an import
 *  cycle — it needs `poolSide`, which needs `accountPool`) renders the SAME
 *  sentence over a filtered set. Two copies of "comma, comma and last" is two
 *  places for one sentence's punctuation to drift, on two surfaces the
 *  operator reads side by side. */
export function joinLabels(labels: readonly string[]): string {
  return labels.length <= 1 ? labels.join('') : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}

/** "team·max, team·alt and team·b" — the HOME_ABLE accounts by their
 *  human labels, joined for the one-line "nothing can take a new workspace"
 *  message (AccountsScreen's projection line, ProjectCard's addLabel).
 *
 *  A `homeAble: false` account (e.g. `gpt` — an overflow lane the auto-swapper
 *  may rotate a session onto as a last resort, but never a landing spot ccd's
 *  `_ws_least_loaded` chooses on its own) is never consulted for
 *  this fact, even though it renders as an account row on the very same
 *  accounts screen. That is exactly why a "nothing is placeable" message
 *  must name these accounts individually rather than claim "all accounts":
 *  an enabled gpt sitting in the same list would make that claim false on
 *  its face. Same discipline ccd's own placement refusal already uses
 *  (ccd/ccd's `cmd_ws_add`: `claude:disabled claude2:disabled
 *  claude-corp:disabled`, never "all accounts"). Its pool-aware sibling is
 *  `poolLabelList` (lib/pools.ts), which answers the same question for a
 *  TAGGED project. */
export function homeAbleLabelList(roster: readonly RosterWire[]): string {
  return joinLabels(roster.filter((a) => a.homeAble).map((a) => a.label));
}

/** The roster's ids, in declaration order — the base list `AccountsScreen`'s
 *  `rowOrder` and `SwapSheet`'s `pickableWrappers` each union in any extra
 *  wrapper a live session reports that the roster itself does not carry, so a
 *  session running on a wrapper the roster dropped (or has not caught up to
 *  yet) still gets a row rather than vanishing. */
export function rosterWrapperIds(roster: readonly RosterWire[]): string[] {
  // THE SINGLE READER of `hidden` (shared/api.ts says so), and both of this
  // function's callers want exactly this list: the accounts screen's rows and
  // the swap sheet's targets are both "the accounts this box has", and a
  // roster entry the operator declared plumbing is not one.
  //
  // `!== true`, never `!a.hidden`-by-truthiness on a possibly-absent field: a
  // server built before `hidden` existed omits it, and absence must mean "an
  // account" so an older payload renders unchanged.
  //
  // This does NOT touch `accountLabel`/`accountHue` below, on purpose. A
  // session can be RUNNING on a plumbing lane (ccd swap, or a row that
  // predates the declaration), and that row still has to render its account's
  // name and colour. Not listing a lane and not being able to name it are
  // different things.
  return roster.filter((a) => a.hidden !== true).map((a) => a.id);
}

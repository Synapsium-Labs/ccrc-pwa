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
import type { Hue } from '../../../shared/roster';

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

/** "team·max, team·alt and team·b" — the HOME_ABLE accounts by their
 *  human labels, joined for the one-line "nothing can take a new workspace"
 *  message (AccountsScreen's projection line, ProjectCard's addLabel).
 *
 *  A `homeAble: false` account (e.g. `gpt`, opt-in-only — never a landing
 *  spot ccd's `_ws_least_loaded` chooses on its own) is never consulted for
 *  this fact, even though it renders as an account row on the very same
 *  accounts screen. That is exactly why a "nothing is placeable" message
 *  must name these accounts individually rather than claim "all accounts":
 *  an enabled gpt sitting in the same list would make that claim false on
 *  its face. Same discipline ccd's own placement refusal already uses
 *  (ccd/ccd's `cmd_ws_add`: `claude:disabled claude2:disabled
 *  claude-corp:disabled`, never "all accounts"). */
export function homeAbleLabelList(roster: readonly RosterWire[]): string {
  const labels = roster.filter((a) => a.homeAble).map((a) => a.label);
  return labels.length <= 1 ? labels.join('') : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}

/** The roster's ids, in declaration order — the base list `AccountsScreen`'s
 *  `rowOrder` and `SwapSheet`'s `pickableWrappers` each union in any extra
 *  wrapper a live session reports that the roster itself does not carry, so a
 *  session running on a wrapper the roster dropped (or has not caught up to
 *  yet) still gets a row rather than vanishing. */
export function rosterWrapperIds(roster: readonly RosterWire[]): string[] {
  return roster.map((a) => a.id);
}

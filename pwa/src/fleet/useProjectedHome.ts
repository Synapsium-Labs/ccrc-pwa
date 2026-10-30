// Where a new workspace would land, for the `+` to say before the tap.
//
// The PROJECTION is the server's: `limits.ts projectHome`, itself a mirror of
// ccd's `_ws_least_loaded`, which is the rule that actually assigns `home` at
// ws-add time. This hook only carries the answer. Recomputing it here would
// make a THIRD implementation of one rule, and the spec is explicit about what
// happens then: "Two implementations of one rule drift; that is what they do."
//
// It reads the fleet store's `projected`, which the store's one `/api/accounts` poll writes (C8, D-6440). It used to
// run a poll of its own on the same 20 s cadence; the store is connected app-wide whichever route is mounted, so the
// answer is already there and a second GET only fetched it again.
import type { AccountUsage, ProjectedHome } from '../../../shared/api';
import { useFleetStore, type FleetStore } from '../stores/fleet';

/**
 * `active` defaults to `true`: `FleetCards` calls `useProjectedHome(true,
 * chrome.store)` and hands the answer to each `ProjectCard` as a prop;
 * `ProjectCard` itself never calls this hook. It exists for the sheets
 * (`StartProgramSheet`, Task 13, review fix round 1, Minor 2;
 * `AddWorkspaceSheet`), which — like `useAccountUsage`'s own two callers just
 * below — are mounted UNCONDITIONALLY at screen level and use `open` only to
 * toggle the inner `Sheet`'s visibility. A closed sheet answers what it always
 * answered while inactive, and opening one refreshes nothing: it reads the
 * store's last answer, at most 20 s old (`useAccountUsage`'s docstring argues
 * that staleness).
 *
 * `store` defaults to the app-wide fleet store, the idiom `RunsScreen` uses,
 * so a caller holding another store (`FleetCards`, from its chrome) reads that.
 */
export function useProjectedHome(active: boolean = true, store: FleetStore = useFleetStore): ProjectedHome | null | undefined {
  // `undefined`: no answer yet — the first poll hasn't landed, or every poll
  // so far has failed. `null`: an answer HAS landed, and it is the server's
  // own "nothing is placeable" (every home-able lane disabled). These are
  // different facts with different honest copy downstream (`FleetCards`
  // passes this value to `ProjectCard`, which renders the copy) — the store
  // keeps them apart (its `projected` docstring), and a failed or malformed
  // poll leaves the last good answer standing rather than forcing either.
  const projected = store((s) => s.projected);
  // Inactive is not the server's `null` ("nothing is placeable") — it is "no
  // answer has been asked for". `useAccountUsage`'s inactive default is its
  // OWN "no row for any account" value (`null`, which its readers already
  // treat as absence-permits); this hook's is `undefined`, because `null`
  // here is a positive claim this hook has no standing to make while it
  // isn't even asking.
  return active ? projected : undefined;
}

/** Every account row `GET /api/accounts` carries, kept WHOLE: the fleet store's
 *  `usage`, which the store's one poll writes (C8, D-6440).
 *
 *  This was `useDisabledWrappers`, and the rename is the whole point: it made
 *  exactly this request, on exactly this cadence, and then threw all of it away
 *  except `a.disabled === true`. The pickers it fed read their NUMBERS off a
 *  second source — the live fleet frame's `FleetSession.limits` — which carries
 *  `{five, seven}` and NO provenance, so a rolled-over window (a rate-limit
 *  window whose reset merely elapsed) arrived there as a confident `0` and won
 *  every "suggested" ranking forever. The row this hook was already holding
 *  says `fiveRolledOver`/`sevenRolledOver` about that very number.
 *
 *  ONE SOURCE PER FACT, and this is it for account NUMBERS AND ELIGIBILITY.
 *  The measurement that decides it: both sources are the same server-side map.
 *  `server/src/fleet.ts` sets a session's `limits` from `readLimits(...)[wrapper]`
 *  and `GET /api/accounts` builds these rows from the same call — so the frame
 *  is a strictly LOSSY projection of this payload, dropping both rollover flags,
 *  `disabled`, `authDead` and every account with no live session on it. There is
 *  nothing the frame can tell a picker that this cannot, except sooner: the
 *  frame is live-pushed and the store polls this every 20s. That is the real and only
 *  cost, and it is small against what it buys — telemetry is a byproduct of a
 *  session rendering its statusline, so the underlying numbers move on the order
 *  of minutes and an idle account stops reporting for hours. Twenty seconds of
 *  staleness is inside that noise; a number whose provenance is unrecoverable
 *  is not.
 *
 *  `active` is the caller's own `open` prop. Both callers (SwapSheet,
 *  NewSessionSheet) mount their picker UNCONDITIONALLY and use `open` only to
 *  toggle the inner vaul `Sheet`'s visibility — the component, and its hooks,
 *  keep running underneath — so a closed picker answers `null` and opening it
 *  refreshes nothing: it reads the store's last answer. It once ran its own
 *  poller, and `active` kept a session screen from polling `/api/accounts`
 *  forever; the store's poll now runs whichever screen is mounted, so the
 *  gate keeps only the inactive answer.
 *
 *  `null` IS NOT AN EMPTY FLEET. It means no row for any account is available:
 *  nothing has landed yet, or `active` is false. (A failed poll, or an answer
 *  whose `accounts` was not an array, keeps the last good rows instead, below,
 *  so it reaches `null` only before any good answer.) Those are one fact to every reader below — nothing is scoreable and
 *  nothing is excluded — which is why they may share one value; the moment a
 *  caller wants to handle them differently this must grow the distinction back,
 *  not overload this null further.
 *
 *  A FAILED OR MALFORMED POLL LEAVES THE LAST GOOD ANSWER STANDING (the
 *  store writes nothing then), for `useDisabledWrappers`'s original reason, with its false half
 *  removed: dropping an account because telemetry hiccuped makes a healthy lane
 *  look like it does not exist, and that is the worse half of the trade. The
 *  reason it was paired with — "showing an account that turns out to be
 *  unusable is recoverable, ccd refuses the swap" — was simply not true (D-1979).
 *  `cmd_swap` reads NEITHER marker (its own header: "Manual swaps may target
 *  ANY valid wrapper; the pool policy only constrains auto-swaps") and
 *  `POST /api/sessions/:id/swap` adds no check, so a swap onto a lane this hook
 *  was too stale to report as switched off simply happens. It is recoverable in
 *  the only sense that survives measurement — another swap undoes it, and the
 *  session's failure to come back is what tells the operator — not because
 *  anything downstream refuses. `disabledWrappers` (SwapSheet.tsx) carries the
 *  full argument and the ruling that governs the other marker. */
export function useAccountUsage(active: boolean, store: FleetStore = useFleetStore): readonly AccountUsage[] | null {
  const usage = store((s) => s.usage);
  return active ? usage : null;
}

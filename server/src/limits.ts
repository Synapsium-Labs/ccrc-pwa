import path from 'node:path';
import type { CcrcConfig } from './config.js';
import type { FleetIO } from './io.js';
import type { ProjectedHome } from '../../shared/api.js';
import { inRoster, type Roster } from '../../shared/roster.js';

export interface AccountLimits {
  five: number | null; seven: number | null; ts: number | null;
  fiveResetAt: number | null; sevenResetAt: number | null;
  /** The window ended and nothing has measured the new one yet, so the 0 above
   *  is INFERRED rather than observed. Distinct from a measured 0 (something ran
   *  on the account and it really is empty).
   *
   *  TWO writers reach this state and both set the flag: a `resetAt` that has
   *  lapsed (fact, straight from the API) and a sample older than its own window
   *  (inference). The flag names the PROVENANCE of the number, not which rule
   *  derived it — the age path used to write the 0 and leave this false, which
   *  told both UIs an unmeasured account had been measured empty.
   *
   *  `measured()` reads this: an inferred 0 is not a score. */
  fiveRolledOver: boolean; sevenRolledOver: boolean;
  /** ccd's per-lane kill-switch (`~/.cc-sessions/<wrapper>-disabled`) is
   *  present, so this account cannot take work. A FLAG rather than omitting
   *  the account: the server knows the difference between "no telemetry" and
   *  "switched off", and collapsing them loses it. */
  disabled: boolean;
  /** The account-health probe's durable verdict
   *  (`~/.cc-sessions/<wrapper>-authdead`, `"<epoch> <reason>"`) is standing:
   *  something measured this credential and it did not authenticate. A POSITIVE
   *  FLAG for `disabled`'s exact reason — "no telemetry" and "measured dead" are
   *  different facts, and collapsing them loses the one a person acts on.
   *
   *  NOT the same fact as `disabled` and never folded into it: that marker is
   *  operator INTENT, which cannot be wrong; this is a MEASUREMENT, which can
   *  be. That difference is why `projectHome` spends it on SCORING only, and why
   *  ccd's `_account_ok` never sees it at all. */
  authDead: boolean;
}

const FIVE_WINDOW = 18000;      // ccd: a five reading older than its own 5h window has rolled over
const SEVEN_WINDOW = 604800;

const numOrNull = (v: unknown): number | null => (typeof v === 'number' ? v : null);

/** Mirrors ccd's `_authdead` (ccd:1079) marker-CONTENT gate exactly:
 *  `"<epoch> <reason>"`, verdict iff the first whitespace-delimited field is
 *  all digits. FAIL-OPEN on anything else, same as bash — an empty or
 *  malformed marker is NOT a verdict.
 *
 *  `_ah_mark`'s atomic mktemp+rename means the PROBE itself can only ever
 *  leave this file absent or complete, but the probe is not the only actor
 *  near this file family: the operator is one of its three clearing owners
 *  and touches it by hand, and a partial restore, a backup tool, or a person
 *  testing the UI can all leave a present-but-malformed marker. Trusting the
 *  FILENAME alone here would make the server MORE CREDULOUS than bash —
 *  `touch $REG/<w>-authdead` would condemn the account here while
 *  `_account_ok`'s own reader still calls it healthy — and an adapter may not
 *  narrow OR WIDEN a distinction it received. */
const authDeadMarkerOk = (raw: string): boolean => {
  const trimmed = raw.replace(/\n+$/, '');
  const sp = trimmed.indexOf(' ');
  const first = sp === -1 ? trimmed : trimmed.slice(0, sp);
  return /^[0-9]+$/.test(first);
};

/** An account's pressure, or `null` when NOTHING has measured it — the
 *  distinction the whole placement rule turns on (see `projectHome`). Absent
 *  row, `five === null` and `seven === null` are one answer: unknown. A
 *  half-measured row counts as unknown too, and that is not a hypothetical
 *  shape — `~/.cc-limits/gpt.json` really is `{"five": null, "seven": 0}`,
 *  because gpt has no 5h window at all.
 *
 *  Term for term the same rule `pwa/src/fleet/SwapSheet.tsx`'s `load` already
 *  applies to the SWAP recommendation, and for the same reason its docstring
 *  gives: "an account nobody could read was recommended precisely BECAUSE
 *  nobody could read it". One known window is not enough either — the score is
 *  a MAXIMUM, so `{five: 3, seven: null}` bounds the truth only from below and
 *  could really be 99. The swap picker learned this first; placement is the
 *  other half of the same lesson.
 *
 *  AN INFERRED ZERO IS UNKNOWN, and that is the third site of the same magnet.
 *  A rolled-over row carries a REAL `0` on the wire — the accounts screen
 *  renders it as "reset" — but that 0 was derived from a timestamp, never
 *  observed. Read as a measurement it was the best score on the fleet, so
 *  placement went there; nothing runs on an account nothing was placed on, so
 *  nothing ever replaced it. Unlike the two magnets above, this one fires on a
 *  perfectly healthy fleet, every time a window turns over.
 *
 *  ONE rolled window is enough, for the same reason one null window is: the
 *  score is a maximum, and the elapsed half bounds the truth only from below.
 *  Both flags are consulted, and either one alone answers null.
 *
 *  ccd's mirror says this by saying nothing — `_limit_field` prints "" for a
 *  window that has ended, and `_limit_score` (the ranking reader) answers ""
 *  unless BOTH halves are measured, which its two callers `_ws_least_loaded`
 *  and `_swap_target` already read as unmeasured. That `||` is term for term
 *  this function's own rule and landed with it: a score is a MAXIMUM, so one
 *  known half bounds the truth only from below. `_avail` deliberately does NOT
 *  go through `_limit_score` — eligibility needs only that lower bound, so it
 *  reads `_limit_field` itself and refuses on a known half at the ceiling,
 *  which is what lets rank be strict without stripping the gpt lane of its
 *  only exclusion. Two languages, one fact, half-rolled rows included;
 *  `projected-home.test.ts` runs both over the same bytes and
 *  `half-rolled-window` is the case that says so. */
const measured = (l: AccountLimits | undefined): number | null =>
  !l || l.five === null || l.seven === null || l.fiveRolledOver || l.sevenRolledOver
    ? null
    : Math.max(l.five, l.seven);

/**
 * The account a new workspace would land on, and its pressure score.
 *
 * A mirror of ccd's `_ws_least_loaded` (ccd:2451), which is the authority
 * — it runs at `ws-add` time and writes `home`. This only PREDICTS it, so the
 * `+` can name the account and its headroom before the tap rather than leave a
 * workspace to present as a stalled session on an exhausted account.
 *
 * The rule, term for term: iterate the roster's home-able accounts in
 * declaration order, score each as `max(five, seven)`, keep the lowest, ties to
 * the EARLIER account (`<`, not `<=`, mirroring bash's strictly-less-than —
 * `ccd-workspaces.test.ts` and `projected-home.test.ts` both pin it).
 *
 * UNKNOWN IS NOT ZERO, and that is this function's one real defect fixed
 * (Stage 2a, Task 6). It used to score `max(five ?? 0, seven ?? 0)`, so an
 * account no telemetry had ever mentioned scored 0 and beat every measured
 * account on the box: against the live tree, `{claude: 5, claude2: 6,
 * 'claude-corp': 7}` projected onto `claude-dev0` at score 0 — the emptiest
 * account was simply the one nobody could see. Latent only because dev0
 * reports honestly and gpt is held out by `homeAble`. An unmeasured account now
 * ranks BELOW every measured one instead of above them.
 *
 * Three accounts are excluded from scoring for two different reasons, and
 * conflating them is what produced the bug:
 *   - `telemetry: 'none'` (`shared/roster.ts`) — this account will NEVER report,
 *     so its permanent unknown must not be read as permanent emptiness.
 *   - `disabled` — ccd's per-lane kill switch, since `_account_ok` (ccd:252)
 *     gates `_ws_least_loaded` on exactly that marker.
 *   - `authDead` — the health probe measured this credential dead, so its
 *     telemetry describes a lane nothing can run on. It leaves SCORING and it
 *     is DEPRIORITISED in the fallback; unlike the two above it, it never
 *     leaves `live`, because a measurement can be wrong and ccd's own placement
 *     rule keeps a condemned lane eligible for the same reason.
 *
 * UNKNOWN IS ALSO NOT UNPLACEABLE. On a fresh install nothing has reported yet,
 * so if excluding unmeasured accounts could empty the field, this would return
 * `null` and the PWA would announce that no account can take a workspace — on
 * the exact first-run path this whole stage exists to make work. The fallback
 * is therefore explicit: when NOTHING is measured, the first home-able account
 * in roster order THAT THE HEALTH PROBE HAS NOT CONDEMNED, at score 0 — which
 * is what ccd does with an empty `~/.cc-limits` too.
 *
 * AND THE FALLBACK HAS TWO TIERS, for the reason the scored set has none: a
 * condemned lane must not be PREFERRED, but it must stay ELIGIBLE, because the
 * verdict is a measurement and a measurement can be wrong. One tier cannot say
 * both — preferring the first candidate outright places work on a lane already
 * measured dead while a healthy one sits behind it (the shipped defect, D-1954),
 * and filtering condemned lanes out of the fallback altogether answers `null` on
 * an all-condemned fleet, which would wedge every `ws-add` on one bad probe run.
 * So: first the healthy unmeasured lanes, and only if EVERY home-able lane is
 * condemned, the first condemned one. `null` stays reserved for the case a
 * human declared — every home-able lane disabled — exactly as ccd's `""` does.
 *
 * Note what is deliberately NOT here: `_ws_least_loaded` applies no `_avail` /
 * SWAP_CEILING filter, so it returns the minimum even when every account is
 * pinned. Mirroring that faithfully is the point — a projection of 99 is
 * precisely the warning the user needs, and inventing "none available" here
 * would describe an outcome ccd never produces.
 *
 * The honest delta against the bash: the server has no filesystem authority
 * over `~/.local/bin`, so it cannot see a missing wrapper the way
 * `_account_ok`'s `-x` check does — a projection can still name an account
 * whose binary is gone. ccd's refusal at ws-add is the authority; this is a
 * best-effort forecast of it. `null` iff every home-able lane is disabled,
 * mirroring `_ws_least_loaded`'s empty-stdout "" for the same case — nothing is
 * placeable, and inventing a target would lie.
 *
 * Kept honest against the bash by shared fixtures: test/fixtures/leastLoaded.ts.
 */
export function projectHome(roster: Roster, limits: Record<string, AccountLimits>): ProjectedHome | null {
  const live = roster.homeAble.filter((a) => limits[a.id]?.disabled !== true);
  if (live.length === 0) return null;
  const scorable = live.filter((a) => a.telemetry !== 'none');
  // ONE PREDICATE, TWO CONSUMERS, AND THAT IS THE MIRROR. `_ws_least_loaded`
  // reads `_authdead` once per candidate and spends the answer twice: a
  // condemned lane never enters the scored comparison, and it lands in the
  // second fallback tier rather than the first. Both sides therefore drop a
  // condemned lane from `scored` and from the PREFERRED fallback, and neither
  // drops it from `live` — `projected-home.test.ts` drives the two over one
  // seeded HOME precisely to catch a side that changes its mind about either.
  //
  // ABSENCE PERMITS: `!== true`, so an older `readLimits` (or an older agent
  // payload) that omits the field reads as NOT condemned, never as condemned.
  const notCondemned = (a: { id: string }): boolean => limits[a.id]?.authDead !== true;
  const scored = scorable
    .filter(notCondemned)
    .map((a) => ({ wrapper: a.id, score: measured(limits[a.id]) }))
    .filter((s): s is { wrapper: string; score: number } => s.score !== null);
  // THE FALLBACK CHAIN IS THE TWO TIERS, WIDENING, and every link is load-bearing:
  // the healthy lanes that can report, then the healthy lanes that never will
  // (a roster whose every home-able account opts out of telemetry still has to
  // place work somewhere), then the condemned ones on the same two terms. `live`
  // is provably non-empty above, so the final `live[0]!` always exists.
  if (scored.length === 0) {
    const base = scorable.find(notCondemned) ?? live.find(notCondemned)
              ?? scorable[0] ?? live[0]!;
    return { wrapper: base.id, score: 0 };
  }
  return scored.reduce((best, cand) => (cand.score < best.score ? cand : best));
}

export async function readLimits(
  io: FleetIO,
  cfg: CcrcConfig,
  now = Math.floor(Date.now() / 1000),
): Promise<Record<string, AccountLimits>> {
  const names = (await io.readdir(cfg.limitsDir)) ?? [];
  // One readdir, not one stat per account: the registry dir is already being
  // read on every fleet poll and this rides the same trip.
  const regNames = (await io.readdir(cfg.registryDir)) ?? [];
  const disabledLanes = new Set(
    regNames.filter((n) => n.endsWith('-disabled')).map((n) => n.slice(0, -'-disabled'.length)),
  );
  // The same `readdir`, a second suffix — but the FILENAME is only a
  // candidate list, never the verdict: `authDeadMarkerOk` re-reads exactly the
  // names that already matched (normally zero on a healthy fleet), never one
  // read per account on the box.
  const authDeadCandidates = regNames.filter((n) => n.endsWith('-authdead'))
    .map((n) => n.slice(0, -'-authdead'.length));
  const authDeadLanes = new Set(
    (await Promise.all(authDeadCandidates.map(async (wrapper) => {
      const content = await io.readFile(path.join(cfg.registryDir, `${wrapper}-authdead`));
      return content !== null && authDeadMarkerOk(content) ? wrapper : null;
    }))).filter((w): w is string => w !== null),
  );
  const out: Record<string, AccountLimits> = {};
  for (const n of names.filter((n) => n.endsWith('.json') && !n.startsWith('.'))) {
    const wrapper = n.slice(0, -'.json'.length);
    try {
      const content = await io.readFile(path.join(cfg.limitsDir, n));
      if (content === null) throw new Error('missing');
      const raw = JSON.parse(content) as Record<string, unknown>;
      const ts = numOrNull(raw.ts);
      const fiveResetAt = numOrNull(raw.fiveResetAt);
      const sevenResetAt = numOrNull(raw.sevenResetAt);
      let five = numOrNull(raw.five);
      let seven = numOrNull(raw.seven);

      // A reading whose own window has already reset does not describe the
      // current window — it describes one that ended. The reset timestamps come
      // straight from the API (statusline-command.sh:163-166), so this is fact,
      // not the inference the age rules below make. Telemetry is written only
      // when a session renders its statusline, so an idle account's sample can
      // outlive its window by days: claude sat at seven=98 for 14h after its 7d
      // window reset, excluding it from the whole fleet.
      //
      // `let`, not `const`: the age fallback below is the SECOND writer of the
      // same conclusion, and it used to write the inferred 0 while leaving these
      // false. The flag's contract is "the 0 above is inferred rather than
      // observed" — not "a resetAt lapsed" — so a path that inferred a 0 and
      // left the flag false was asserting a measurement it had not made.
      let fiveRolledOver = five !== null && fiveResetAt !== null && now >= fiveResetAt;
      let sevenRolledOver = seven !== null && sevenResetAt !== null && now >= sevenResetAt;
      if (fiveRolledOver) five = 0;
      if (sevenRolledOver) seven = 0;

      // Fallback for a file with no reset fields (the gpt 429 exclusion, and
      // anything written before those fields existed): a sample older than its
      // own window has certainly rolled over.
      //
      // The `!fiveRolledOver` guards STAY. They say the FACT wins over the
      // INFERENCE — the resetAt rule has already reached this conclusion and the
      // age rule may not re-derive it. They produce the same value either way
      // today, which is exactly why deleting them would be invisible.
      if (ts !== null) {
        if (!fiveRolledOver && five !== null && now - ts > FIVE_WINDOW) { five = 0; fiveRolledOver = true; }
        if (!sevenRolledOver && seven !== null && now - ts > SEVEN_WINDOW) { seven = 0; sevenRolledOver = true; }
      }

      out[wrapper] = { five, seven, ts, fiveResetAt, sevenResetAt, fiveRolledOver, sevenRolledOver,
                       disabled: disabledLanes.has(wrapper), authDead: authDeadLanes.has(wrapper) };
    } catch {
      out[wrapper] = { five: null, seven: null, ts: null, fiveResetAt: null,
                       sevenResetAt: null, fiveRolledOver: false, sevenRolledOver: false,
                       disabled: disabledLanes.has(wrapper), authDead: authDeadLanes.has(wrapper) };
    }
  }
  // A lane can be markered off before it ever writes telemetry (fresh
  // `touch <w>-disabled`, or a session simply never having run there yet) — the
  // loop above only visits `.cc-limits/*.json`, so that lane would otherwise be
  // ABSENT from `out` rather than present-and-disabled. Absent is indistinguishable
  // from "unknown", which scores 0 and makes the account nobody can place a
  // session on look like the emptiest one — the exact self-reinforcing hole
  // `disabled` exists to close. The registry readdir already named every
  // markered lane, so surface each one that telemetry didn't — but only a
  // wrapper the ROSTER has: the registry dir also holds `-disabled` markers
  // that name no account at all (`autocompact-disabled`, a fleet-wide
  // proactive-/compact kill switch, ccd:41), and this loop is the only place
  // that would otherwise turn one of those into a fabricated "autocompact" row
  // on GET /api/accounts, which the accounts screen renders like any other
  // disabled lane. `inRoster` (shared/roster.ts) is the membership test that
  // used to be `isKnownWrapper`, a module-scope const built from
  // `ACCOUNT_ORDER` at import time — a shape runtime roster data cannot have,
  // since at import time there is no roster yet. `accounts-route.test.ts` pins
  // the phantom row's absence.
  //
  // …the same for a lane the PROBE condemned before anything ran on it. Absent
  // is indistinguishable from unknown, which scores as the emptiest account on
  // the fleet — the exact self-reinforcing hole `disabled` exists to close, and
  // an auth-dead lane falls into it identically. `inRoster` is doing the same
  // job for both: the registry also holds dotless markers that name no account.
  for (const wrapper of new Set([...disabledLanes, ...authDeadLanes])) {
    if (wrapper in out) continue;
    if (!inRoster(cfg.roster, wrapper)) continue;
    out[wrapper] = { five: null, seven: null, ts: null, fiveResetAt: null,
                     sevenResetAt: null, fiveRolledOver: false, sevenRolledOver: false,
                     disabled: disabledLanes.has(wrapper), authDead: authDeadLanes.has(wrapper) };
  }
  return out;
}

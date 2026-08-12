import path from 'node:path';
import type { CcrcConfig } from './config.js';
import type { FleetIO } from './io.js';
import type { ProjectedHome } from '../../shared/api.js';
import { inRoster, type Roster } from '../../shared/roster.js';

export interface AccountLimits {
  five: number | null; seven: number | null; ts: number | null;
  fiveResetAt: number | null; sevenResetAt: number | null;
  /** The window ended and nothing has measured the new one yet, so the 0 above
   *  is inferred from the reset timestamp rather than observed. Distinct from a
   *  measured 0 (something ran on the account and it really is empty). */
  fiveRolledOver: boolean; sevenRolledOver: boolean;
  /** ccd's per-lane kill-switch (`~/.cc-sessions/<wrapper>-disabled`) is
   *  present, so this account cannot take work. A FLAG rather than omitting
   *  the account: the server knows the difference between "no telemetry" and
   *  "switched off", and collapsing them loses it. */
  disabled: boolean;
}

const FIVE_WINDOW = 18000;      // ccd: a five reading older than its own 5h window has rolled over
const SEVEN_WINDOW = 604800;

const numOrNull = (v: unknown): number | null => (typeof v === 'number' ? v : null);

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
 *  other half of the same lesson. */
const measured = (l: AccountLimits | undefined): number | null =>
  !l || l.five === null || l.seven === null ? null : Math.max(l.five, l.seven);

/**
 * The account a new workspace would land on, and its pressure score.
 *
 * A mirror of ccd's `_ws_least_loaded` (ccd:1001-1012), which is the authority
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
 * Two accounts are excluded from scoring for two different reasons, and
 * conflating them is what produced the bug:
 *   - `telemetry: 'none'` (`shared/roster.ts`) — this account will NEVER report,
 *     so its permanent unknown must not be read as permanent emptiness.
 *   - `disabled` — ccd's per-lane kill switch, since `_account_ok` (ccd:57)
 *     gates `_ws_least_loaded` on exactly that marker.
 *
 * UNKNOWN IS ALSO NOT UNPLACEABLE. On a fresh install nothing has reported yet,
 * so if excluding unmeasured accounts could empty the field, this would return
 * `null` and the PWA would announce that no account can take a workspace — on
 * the exact first-run path this whole stage exists to make work. The fallback
 * is therefore explicit: when NOTHING is measured, the first home-able account
 * in roster order, at score 0 — which is what ccd does with an empty
 * `~/.cc-limits` too.
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
  const scored = scorable
    .map((a) => ({ wrapper: a.id, score: measured(limits[a.id]) }))
    .filter((s): s is { wrapper: string; score: number } => s.score !== null);
  // `scorable[0] ?? live[0]!`: a roster whose every home-able account opts out
  // of telemetry still has to place work somewhere, and `live` is provably
  // non-empty two lines up.
  if (scored.length === 0) return { wrapper: (scorable[0] ?? live[0]!).id, score: 0 };
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
      const fiveRolledOver = five !== null && fiveResetAt !== null && now >= fiveResetAt;
      const sevenRolledOver = seven !== null && sevenResetAt !== null && now >= sevenResetAt;
      if (fiveRolledOver) five = 0;
      if (sevenRolledOver) seven = 0;

      // Fallback for a file with no reset fields (the gpt 429 exclusion, and
      // anything written before those fields existed): a sample older than its
      // own window has certainly rolled over.
      if (ts !== null) {
        if (!fiveRolledOver && five !== null && now - ts > FIVE_WINDOW) five = 0;
        if (!sevenRolledOver && seven !== null && now - ts > SEVEN_WINDOW) seven = 0;
      }

      out[wrapper] = { five, seven, ts, fiveResetAt, sevenResetAt, fiveRolledOver, sevenRolledOver,
                       disabled: disabledLanes.has(wrapper) };
    } catch {
      out[wrapper] = { five: null, seven: null, ts: null, fiveResetAt: null,
                       sevenResetAt: null, fiveRolledOver: false, sevenRolledOver: false,
                       disabled: disabledLanes.has(wrapper) };
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
  // proactive-/compact kill switch, ccd:22), and this loop is the only place
  // that would otherwise turn one of those into a fabricated "autocompact" row
  // on GET /api/accounts, which the accounts screen renders like any other
  // disabled lane. `inRoster` (shared/roster.ts) is the membership test that
  // used to be `isKnownWrapper`, a module-scope const built from
  // `ACCOUNT_ORDER` at import time — a shape runtime roster data cannot have,
  // since at import time there is no roster yet. `accounts-route.test.ts` pins
  // the phantom row's absence.
  for (const wrapper of disabledLanes) {
    if (wrapper in out) continue;
    if (!inRoster(cfg.roster, wrapper)) continue;
    out[wrapper] = { five: null, seven: null, ts: null, fiveResetAt: null,
                     sevenResetAt: null, fiveRolledOver: false, sevenRolledOver: false,
                     disabled: true };
  }
  return out;
}

import path from 'node:path';
import type { CcrcConfig } from './config.js';
import type { FleetIO } from './io.js';
import { HOME_ABLE_WRAPPERS, type ProjectedHome } from '../../shared/api.js';

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

/** Every wrapper this server will ever fabricate an account row for — mirrors
 *  ccd's `_is_valid_wrapper` (`VALID_WRAPPERS` + `gpt`, ccd:14,99). The
 *  registry dir holds `<name>-disabled` markers that are NOT accounts at all
 *  (`autocompact-disabled` is a fleet-wide proactive-/compact kill switch,
 *  ccd:22) — bounding the backfill below to this set is what stops one of
 *  those from turning into a phantom "autocompact" row on GET /api/accounts. */
const KNOWN_WRAPPERS: readonly string[] = [...HOME_ABLE_WRAPPERS, 'gpt'];

/**
 * The account a new workspace would land on, and its pressure score.
 *
 * A mirror of ccd's `_ws_least_loaded` (ccd:132-140), which is the authority —
 * it runs at `ws-add` time and writes `home`. This only PREDICTS it, so the
 * `+` can name the account and its headroom before the tap rather than leave a
 * workspace to present as a stalled session on an exhausted account.
 *
 * The rule, term for term: iterate the home-able wrappers in order, score each
 * as `max(five, seven)` with unknown counting as 0, keep the lowest, ties to
 * the earlier wrapper (bash compares strictly less-than).
 *
 * Note what is deliberately NOT here: `_ws_least_loaded` applies no `_avail` /
 * SWAP_CEILING filter, so it returns the minimum even when every account is
 * pinned. Mirroring that faithfully is the point — a projection of 99 is
 * precisely the warning the user needs, and inventing "none available" here
 * would describe an outcome ccd never produces.
 *
 * What IS filtered: `disabled`, since `_account_ok` (ccd:57) now gates
 * `_ws_least_loaded` on exactly that marker. The honest delta: the server has
 * no filesystem authority over `~/.local/bin`, so it cannot see a missing
 * wrapper the way `_account_ok`'s `-x` check does — a projection can still
 * name an account whose binary is gone. ccd's refusal at ws-add is the
 * authority; this is a best-effort forecast of it. `null` iff every home-able
 * lane is disabled, mirroring `_ws_least_loaded`'s empty-stdout "" for the
 * same case — nothing is placeable, and inventing a target would lie.
 *
 * Kept honest against the bash by shared fixtures: test/fixtures/leastLoaded.ts.
 */
export function projectHome(limits: Record<string, AccountLimits>): ProjectedHome | null {
  const scored = HOME_ABLE_WRAPPERS
    .filter((wrapper) => limits[wrapper]?.disabled !== true)
    .map((wrapper) => ({
      wrapper: wrapper as string,
      score: Math.max(limits[wrapper]?.five ?? 0, limits[wrapper]?.seven ?? 0),
    }));
  if (scored.length === 0) return null;
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
  // KNOWN wrapper: the registry dir also holds `-disabled` markers that name
  // no account at all (`autocompact-disabled`), and this loop is the only
  // place that would otherwise turn one of those into a fabricated row.
  for (const wrapper of disabledLanes) {
    if (wrapper in out) continue;
    if (!KNOWN_WRAPPERS.includes(wrapper)) continue;
    out[wrapper] = { five: null, seven: null, ts: null, fiveResetAt: null,
                     sevenResetAt: null, fiveRolledOver: false, sevenRolledOver: false,
                     disabled: true };
  }
  return out;
}

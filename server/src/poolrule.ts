import { poolRule, declaredAccountPool } from '../../shared/poolrule.js';
import type { AccountPoolWire, ProjectPoolVerdict, SessionPoolSide } from '../../shared/poolrule.js';
import type { ProjectPlacement, ProjectPoolWire, RouteField } from '../../shared/api.js';
import type { AccountDef, Roster } from '../../shared/roster.js';
import { ACCOUNT_ID_RE, POOL_NAME_RE } from '../../shared/roster.js';
import { POOL_ANSWER_CROSSINGS, POOL_ANSWER_KEYS, POOL_ANSWER_POOL_SIDES, POOL_ANSWER_VERDICTS, parsePoolSet } from '../../shared/poolset.js';
import type { PoolAnswer } from '../../shared/poolset.js';

/**
 * THE SERVER'S MIRROR of the pool rule (spec §5.6), ring L1: pure decisions,
 * type-only imports plus the ONE value import of L0's `poolRule` — which is
 * the point of the file. The rule is spelled once per LANGUAGE, not once per
 * module: `shared/poolrule.ts` holds the TypeScript spelling and this module
 * consumes it. The wave-4 PWA renderer has not landed yet; when it does, it can
 * consume the same L0 rule instead of minting another spelling (D-2480).
 *
 * What this module adds that L0 cannot: a ROSTER. L0 takes an account's pool;
 * the server takes a wrapper NAME and has to look it up, and the lookup can
 * miss. `pools.test.ts` purity-scans this file (no clock, no `node:`, no
 * `reply`, no store, no `FleetIO`) the way `coord-caps-policy.test.ts` scans
 * `caps.ts`.
 *
 * The server REFUSES and FORECASTS; it never places (spec §5.1). Every verdict
 * below is a pre-check the box will re-take for itself.
 */

/**
 * L0's project-side verdict plus the one answer only a roster-holder can give.
 *
 * `account-not-in-roster` is an `ok` member on purpose: `ccd`'s
 * `_is_valid_wrapper` is the authority on what a wrapper is, and the PWA
 * already offers live wrappers this box's `accounts.json` does not name (spec
 * §5.6). Refusing an account we merely cannot see would 409 a swap the fleet
 * would have carried out — the server inventing a policy instead of mirroring
 * one.
 */
export type RosterVerdict = ProjectPoolVerdict | { ok: true; why: 'account-not-in-roster' };

/** Build the wire shape for a CENTRAL edge — the one place `{ state: 'tagged',
 *  origin: 'central' }` is spelled, shared by every reader of `pool_edges`
 *  below so they cannot disagree about what a central row means. `pools` is
 *  asserted non-empty by every caller before this runs (T5-R2's tuple type
 *  makes an empty array a compile error at the point of construction, so the
 *  cast here is not smuggling one past the type). */
function centralAccountPool(pools: readonly string[]): AccountPoolWire {
  return { state: 'tagged', pools: pools as readonly [string, ...string[]], origin: 'central' };
}

/**
 * The pool this ACCOUNT is in, RESOLVED — central beats declared beats
 * untagged (design §5.6, T7-R2, D-3076). Distinct question
 * from {@link poolVerdict}:
 * this names a pool, `poolVerdict` names a VERDICT against one project's tag.
 * `GET /api/accounts`'s wire uses this so the PWA can render (and reason
 * about crossings from) the same precedence the server enforces, rather than
 * re-deriving it from the declared `RosterWire.pool` field alone — the defect
 * T7-R2 found live in `NewSessionSheet.tsx` before this field existed.
 *
 * `GET /api/pools/epoch` (ruling T7-R4) is the SECOND caller, and the reason
 * `account` is `AccountDef | undefined` rather than required: that document
 * carries every id with a CENTRAL edge, which can name a wrapper this box's
 * roster does not have (spec §3.3, O4) — there is no `AccountDef` to pass for
 * one of those. `id` is a separate parameter, not read off `account.id`, for
 * exactly that case; when `account` is present its `.id` must equal `id`, but
 * nothing here asserts that — the caller owns pairing them correctly.
 */
export function resolvedAccountPool(
  id: string, account: AccountDef | undefined, edges: ReadonlyMap<string, readonly string[]>,
): AccountPoolWire {
  const central = edges.get(id);
  if (central !== undefined && central.length > 0) return centralAccountPool(central);
  return declaredAccountPool(account?.pool ?? null);
}

/**
 * May `wrapper` serve a project whose tag reads `pool`?
 *
 * EVERY ANSWER COMES OUT OF `poolRule`, including the not-in-roster one: the
 * miss is handled by asking the rule with `declaredAccountPool(null)` — an
 * untagged account, adapted — and then RELABELLING only its `ok` arm. That is
 * what keeps the precedence intact —
 * an `unreadable`/`malformed` tag is undecidable for everyone, roster member
 * or not, so it must still answer `pool-undecidable` here (spec §5.2's "nobody
 * decides"). A `null` account pool can never produce `pool-mismatch`, so the
 * relabel provably cannot swallow a refusal.
 *
 * `edges` is REQUIRED, not optional (T5-R4, account-pool-membership wave 1
 * task 7). An optional parameter would let a caller that HAS the central
 * `pool_edges` rows silently fall back to the declared roster tag by simply
 * forgetting to pass them — a fail-open that compiles clean. Making it
 * required turns every call site into a compile error that forces its author
 * to answer "do I have the central edges here?" A caller that genuinely has
 * none passes `new Map()` and says why in a comment at the call site.
 *
 * NOT WRITTEN AS `poolRule(resolvedAccountPool(wrapper, account, edges), pool)`
 * — precedence is spelled TWICE across this file (see `GET /api/pools/epoch`'s
 * own correction, `server.ts`, review round 4 P2), kept equal by test
 * coverage rather than by construction. THE REASON THIS DOCSTRING GAVE FOR
 * THAT (review round 4, P3 — the old reason, struck): it said
 * `resolvedAccountPool` "requires an already-known `AccountDef`", which
 * stopped being true the round `resolvedAccountPool` widened to `account:
 * AccountDef | undefined`. The obstruction is gone — `resolvedAccountPool
 * (wrapper, roster.byId.get(wrapper), edges)` would now answer the SAME wire
 * value this function's own central branch computes inline, including for a
 * wrapper the roster does not have (both fall through to
 * `declaredAccountPool(null)`, i.e. untagged). Unifying the two is now a
 * CHOICE, not a forced duplication — left as one for the task that owns this
 * file's next behavioural change, not decided in a prose-only round.
 */
export function poolVerdict(
  roster: Roster, wrapper: string, pool: ProjectPoolWire,
  edges: ReadonlyMap<string, readonly string[]>,
): RosterVerdict {
  // PRECEDENCE, in the one place that can enforce it: projected beats
  // declared beats untagged (design §5.6). A central edge is authoritative —
  // it came from `pool_edges`, which is the only writer — so it is consulted
  // before the roster's retained default, and the roster is not read at all
  // when one exists.
  const central = edges.get(wrapper);
  if (central !== undefined && central.length > 0) {
    return poolRule(centralAccountPool(central), pool);
  }
  const account = roster.byId.get(wrapper);
  if (account !== undefined) return poolRule(declaredAccountPool(account.pool), pool);
  const v = poolRule(declaredAccountPool(null), pool);
  return v.ok ? { ok: true, why: 'account-not-in-roster' } : v;
}

/**
 * The home-able accounts that may serve a project with this tag, in roster
 * declaration order — `_ws_least_loaded`'s candidate set, pool-filtered.
 *
 * EMPTY for an undecidable tag, and that is not the same fact as "every lane
 * is disabled": callers must ask {@link poolUndecidable} first if they need to
 * tell the two apart (`projectPlacement` in `limits.ts` does).
 *
 * `edges` is REQUIRED (T7-R1, account-pool-membership wave 1,
 * D-3075), on `poolVerdict`'s exact reasoning: an
 * optional parameter lets a caller that HAS central edges silently fall back
 * to declared-only by forgetting to pass them, which is the fail-open T5-R4
 * was written to close at every call site, not only `refusePool`'s.
 *
 * WIRED THROUGH FOR REAL (ruling T7-R3, reversing T7-R1's deferral): this
 * function's ONE call site, `projectHome` (`limits.ts`), now passes a live
 * `edges` from its own caller — `server.ts`'s `GET /api/projects` and `GET
 * /api/accounts` both read `deps.coord?.accountPoolEdges() ?? new Map()` —
 * so the RANKING forecast (`ProjectRow.placement`, `AccountsResponse.projected`)
 * and the REFUSAL pre-check (`refusePool`) now agree: an account centrally
 * tagged into a different pool than its declared default can no longer be
 * forecast eligible for a project `POST /api/sessions` would then refuse.
 * `test/projected-home.test.ts`'s fixture-driven parity harness against
 * `_ws_least_loaded` is the one caller that still passes `NO_EDGES`
 * deliberately. NOT because bash's positional is declared-only — it is not:
 * `_ws_least_loaded` reads the CENTRAL projection (`_pool_ok` ->
 * `_acct_pool_state` -> `$REG/pool-epoch`), via a file that harness plants
 * itself. The reason is spec §5.7: this server's own forecast, wired with
 * real edges, reads coord.db DIRECTLY and never consults a projection file
 * — so there is no shipped central carrier on the TypeScript side for that
 * harness to feed, only a declared one. That harness's cases agree with
 * bash because the SAME fixture data is written into both sides' carriers,
 * not because either side reads the other's.
 */
export function poolEligible(
  roster: Roster, pool: SessionPoolSide, edges: ReadonlyMap<string, readonly string[]>,
): AccountDef[] {
  return roster.homeAble.filter((a) => poolRule(resolvedAccountPool(a.id, a, edges), pool).ok);
}

/**
 * Are we in the state where NOBODY decides — `unreadable` or `malformed`?
 *
 * DERIVED FROM THE RULE, not from a second list of state tokens: an untagged
 * account is the most permissive input there is, so
 * `poolRule(declaredAccountPool(null), pool)` refuses exactly when the tag
 * itself is undecidable. A hand-written
 * `state === 'unreadable' || state === 'malformed'` here would be the second
 * copy that drifts the day a fifth state is added.
 */
export function poolUndecidable(pool: SessionPoolSide): boolean {
  // The verdict's REASON decides, not `!ok` (Overlord W1 designation A, review F8). For a project side the two are one
  // fact: an untagged account never mismatches, so its only refusal is `pool-undecidable`. For a set without
  // `+untagged` the same untagged account DOES mismatch, and that is a decided "no", never an undecidable one.
  const v = poolRule(declaredAccountPool(null), pool);
  return !v.ok && v.reason === 'pool-undecidable';
}

/**
 * Does ANY rostered account carry this pool name?
 *
 * EVERY account, not just the home-able ones — `ccd`'s own stderr warning
 * walks `CCRC_ACCOUNTS` (spec §5.4.2), and a pool whose only member is the
 * non-home-able lane is a real pool. Drives the tag route's
 * `warning: 'unknown-pool'`, which is a WARNING and not a refusal because this
 * box's roster copy can lag the fleet's (spec §3.3, O4).
 */
export function poolRostered(roster: Roster, name: string): boolean {
  return roster.accounts.some((a) => a.pool === name);
}

/** Re-exported so a reader who looks for the placement type beside the rule
 *  finds it. DECLARED in `shared/api.ts`, because the PWA renders it. */
export type { ProjectPlacement };

/** What one `ccd pool-answer` call answered, read `ran` first (the pool-set plan's Task 6, review 2085 F16). */
export type PoolAnswerRead =
  | { readonly kind: 'answer'; readonly answer: PoolAnswer }
  | { readonly kind: 'not-run' }
  | { readonly kind: 'refused'; readonly code: number }
  | { readonly kind: 'unparsed'; readonly why: string };

/** The `pool-state` words each side can print: `_project_pool_state`'s, `_acct_pool_state`'s and `_pool_ok_set`'s. */
const POOL_ANSWER_STATES: Readonly<Record<PoolAnswer['poolSide'], readonly string[]>> = {
  project: ['untagged', 'unreadable', 'malformed'],
  account: ['untagged', 'unreadable', 'stale', 'malformed'],
  set: ['unreadable', 'malformed', 'unrecognised'],
};
/** The `side` words that carry no name: `_session_pool_side`'s project words and its two bad-set words. */
const POOL_ANSWER_BARE_SIDES: readonly string[] = ['untagged', 'unreadable', 'malformed', 'set-unreadable', 'set-malformed'];

const isWordOf = <T extends string>(words: readonly T[], w: string): w is T => (words as readonly string[]).includes(w);
const namedPool = (w: string): boolean => w.startsWith('named:') && POOL_NAME_RE.test(w.slice('named:'.length));

/**
 * The runner's result for one `ccd pool-answer --session <id>` call (`CCD_ARGV.poolAnswer`), read `ran` FIRST: `ran:
 * false` (an older agent's `forbidden`, a spawn failure) is a read that did not happen, never rc 1's "no such session";
 * `ran: true` with a non-zero code is ccd's refusal; only code 0 with ONE line that parses is an answer. The line is
 * exact: the head word, then the six keys of `POOL_ANSWER_KEYS` once each in that order, each value a word of its
 * vocabulary. An unknown key, a missing or repeated key, a word outside its vocabulary, a second line or an empty line
 * is `unparsed`. Pure: no clock, no I/O.
 */
export function parsePoolAnswer(r: { readonly ran: boolean; readonly code: number; readonly stdout: string }): PoolAnswerRead {
  if (!r.ran) return { kind: 'not-run' };
  if (r.code !== 0) return { kind: 'refused', code: r.code };
  const line = r.stdout.endsWith('\n') ? r.stdout.slice(0, -1) : r.stdout;
  if (line.includes('\n')) return { kind: 'unparsed', why: 'more than one line' };
  const tokens = line.split(' ');
  if (tokens[0] !== 'pool-answer') return { kind: 'unparsed', why: 'not a pool-answer line' };
  if (tokens.length !== POOL_ANSWER_KEYS.length + 1) return { kind: 'unparsed', why: `${tokens.length - 1} keys, not ${POOL_ANSWER_KEYS.length}` };
  const v: Record<string, string> = {};
  for (let i = 0; i < POOL_ANSWER_KEYS.length; i++) {
    const key = POOL_ANSWER_KEYS[i]!;
    const t = tokens[i + 1]!;
    if (!t.startsWith(`${key}=`)) return { kind: 'unparsed', why: `token ${i + 1} is not ${key}=` };
    v[key] = t.slice(key.length + 1);
  }
  const side = v['side']!, verdict = v['verdict']!, poolSide = v['pool-side']!, poolState = v['pool-state']!;
  const crossing = v['crossing']!, account = v['account']!;
  if (!(POOL_ANSWER_BARE_SIDES.includes(side) || namedPool(side)
        || (side.startsWith('set:') && parsePoolSet(side.slice('set:'.length)).ok))) {
    return { kind: 'unparsed', why: 'side' };
  }
  if (!isWordOf(POOL_ANSWER_VERDICTS, verdict)) return { kind: 'unparsed', why: 'verdict' };
  if (!isWordOf(POOL_ANSWER_POOL_SIDES, poolSide)) return { kind: 'unparsed', why: 'pool-side' };
  if (!(isWordOf(POOL_ANSWER_STATES[poolSide], poolState) || (poolSide === 'account' && namedPool(poolState)))) {
    return { kind: 'unparsed', why: 'pool-state' };
  }
  if (!isWordOf(POOL_ANSWER_CROSSINGS, crossing)) return { kind: 'unparsed', why: 'crossing' };
  if (!ACCOUNT_ID_RE.test(account)) return { kind: 'unparsed', why: 'account' };
  return { kind: 'answer', answer: { side, verdict, poolSide, poolState, crossing, account } };
}

/** One row of the capability floor as the server reads it: a route field whose standing on a session needs the placing
 *  box's ccd to advertise `word`. The twin of `ccd/ccrc#CAP_FLOOR_ROWS`' `fact|word` columns (the remedy is the box's). */
export interface CapFloorRow { readonly fact: RouteField; readonly word: string }
/** One session's route facts as a registry read measured them (`SessionRecord.route`): the fields it carries, read, and
 *  those whose entry was listed but could not be read. */
export interface CapFloorSession { readonly id: string; readonly fields: readonly string[]; readonly unreadable: readonly string[] }
/** One row the placing box has lost: its word and fact, every session carrying the fact (sorted), and the unreadable ones. */
export interface CapFloorLoss { readonly word: string; readonly fact: string; readonly sessions: readonly string[]; readonly unreadable: readonly string[] }
export type PoolSetLoss = { readonly raise: false } | { readonly raise: true; readonly lost: readonly CapFloorLoss[]; readonly dedupeKey: string };

/**
 * Whether a box that places sessions has lost a capability while a session on it carries the fact that needs it (the
 * pool-set plan's Task 10; §11.5, open question 15), for EVERY row of the floor (`rows`, the coordinator's table ruling).
 * `caps` is what the box's `ccd caps` last answered (`null` = unmeasured, which raises nothing). An unreadable entry
 * counts: a set the box cannot read is the fail-open the floor exists for (N11 b). The key names the build (`build`, the
 * measured stamp sha, or `unmeasured`) and each lost word's sessions, so one loss pushes once and a new build or a new
 * set pushes again. Pure: no clock, no I/O.
 */
export function poolSetLoss(rows: readonly CapFloorRow[], caps: readonly string[] | null,
  sessions: readonly CapFloorSession[], build: string | null): PoolSetLoss {
  if (caps === null) return { raise: false };
  const lost: CapFloorLoss[] = [];
  for (const row of rows) {
    if (caps.includes(row.word)) continue;
    const unreadable = sessions.filter((s) => s.unreadable.includes(row.fact)).map((s) => s.id).sort();
    const carrying = sessions.filter((s) => s.fields.includes(row.fact) || s.unreadable.includes(row.fact)).map((s) => s.id).sort();
    if (carrying.length > 0) lost.push({ word: row.word, fact: row.fact, sessions: carrying, unreadable });
  }
  if (lost.length === 0) return { raise: false };
  const key = lost.map((l) => `${l.word}=${l.sessions.join(',')}`).join(';');
  return { raise: true, lost, dedupeKey: `pool-set-lost:${build ?? 'unmeasured'}:${key}` };
}

/** The loss EPISODE's keys (fix round 1, F2, slug `loss-episode-in-the-key`): a loss that clears and recurs is a new loss,
 *  even on the same build with the same sessions. Episode `n`'s clear is archived under `poolSetClearKey(n)`, so the
 *  current episode is the first `n` without one (probed at most `LOSS_EPISODE_PROBE_MAX` deep, the feed's retention: a
 *  clear past it was pruned). An episode's FIRST push is keyed by the episode alone, which marks it open across a restart;
 *  a later loss within it (a new build or a new set) by its facts, the `poolSetLoss` key, and the episode. */
export const LOSS_EPISODE_PROBE_MAX = 2000;
export const poolSetClearKey = (episode: number): string => `pool-set-cleared:e${episode}`;
export const poolSetLossKey = (episode: number, facts: string | null): string =>
  facts === null ? `pool-set-lost:e${episode}` : `${facts}:e${episode}`;

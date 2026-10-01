import path from 'node:path';
import type { FleetIO } from './io.js';
import {
  TURN_MARK_STATES, turnMarkGraceUntil, turnMarkStale, type TurnMark, type TurnMarkRead, type TurnMarkState,
} from './coord/stall.js';

/**
 * THE TURN MARKER'S READER (worker stall watch, wave 2, spec §5.1). L3. It reads `$REG/<id>.turn.json` through
 * `FleetIO`, which in remote mode is the agent's existing `read` op (the agent's read allowlist already admits
 * `~/.cc-sessions`), so no agent change. It answers `TurnMarkRead`, the port its consumers declared in
 * `coord/stall.ts` (L1), and judges with the two helpers declared beside it.
 *
 * ONE UNION, NO FOLDED ARM. Each reason is a different act for a consumer (§5.1, "How consumers branch"):
 * - `absent`: a proven ENOENT. An older fleet build, or a session with no main event yet. The wave-1 path.
 * - `unmeasured`: the read itself failed (EACCES, a dropped agent round trip, a timeout). Never delivers on `busy`,
 *   and the stall lane holds.
 * - `malformed`: read, and not a line the hook writes. Over 4 KiB, not JSON, not a record, a wrong `v`, an unknown
 *   state word, or any of the fifteen fields missing or out of its bound. The hook clips and fits every value before
 *   it writes (kinds fitted whole-alias-first under 200 bytes, at most 8 ids, `err` cleaned to `[a-z_]`), so these
 *   bounds are the writer's own, and anything else is refused, never trimmed. Every epoch must be an integer in
 *   [0, 8.64e15] (marker-epochs-bounded), so no consumer's `toISOString` can throw on one.
 * - `foreign`: the line names another Claude Code session than the registry row's uuid. A null OR EMPTY uuid is an
 *   unregistered row and reads `foreign` too (empty-uuid-is-foreign): `registry.ts` initialises `uuid` to the empty
 *   string, and an empty `sessionId` must never match it.
 * - `stale`: older than the live process. `at`, and `restartAt` when set, both before the live file's `startedAt`
 *   (`turnMarkStale`), or a live file with no numeric `startedAt` at all (stale-when-live-has-no-startedat). A caller
 *   with no live read passes `live === null` and judges staleness itself, in L1, with the same helper.
 * There is no freshness window: the marker changes only on main events, so a days-old `done` is still true.
 *
 * The ok arm carries every field, the three comma-joined lists split (an empty list is `[]`, never `['']`), and
 * `graceUntil` (`turnMarkGraceUntil`): the mail gate imports nothing, so the grace a restart opens reaches it here.
 */

/** The marker's own cap. The hook's line is bounded by construction, far under it, so a file past it was not written
 *  by that hook and is never parsed. Checked in UTF-8 bytes BEFORE `JSON.parse`, as `hookstate.ts` checks its own. */
const TURN_MARK_MAX_BYTES = 4096;
/** The kinds lists: whole `[a-z_-]` aliases, comma-joined, at most 200 bytes (the hook's whole-alias fit). */
const TURN_MARK_KINDS_RE = /^([a-z_-]+(,[a-z_-]+)*)?$/;
const TURN_MARK_KINDS_MAX_BYTES = 200;
/** The id lists: at most 8 ids of `[A-Za-z0-9_-]{1,64}`, comma-joined. */
const TURN_MARK_IDS_RE = /^([A-Za-z0-9_-]{1,64}(,[A-Za-z0-9_-]{1,64}){0,7})?$/;
/** A StopFailure's error token, cleaned by the hook to `[a-z_]` and cut at 64 bytes. */
const TURN_MARK_ERR_RE = /^[a-z_]{0,64}$/;
/** The largest epoch a JS `Date` holds. */
const TURN_MARK_EPOCH_MAX = 8.64e15;

const ABSENT: TurnMarkRead = { ok: false, reason: 'absent' };
const UNMEASURED: TurnMarkRead = { ok: false, reason: 'unmeasured' };
const MALFORMED: TurnMarkRead = { ok: false, reason: 'malformed' };
const FOREIGN: TurnMarkRead = { ok: false, reason: 'foreign' };
const STALE: TurnMarkRead = { ok: false, reason: 'stale' };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isState = (v: unknown): v is TurnMarkState =>
  typeof v === 'string' && (TURN_MARK_STATES as readonly string[]).includes(v);
const isEpoch = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= TURN_MARK_EPOCH_MAX;
const isEpochOrNull = (v: unknown): v is number | null => v === null || isEpoch(v);
const isBg = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= -1;
const isLostBg = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isKinds = (v: unknown): v is string =>
  typeof v === 'string' && Buffer.byteLength(v, 'utf8') <= TURN_MARK_KINDS_MAX_BYTES && TURN_MARK_KINDS_RE.test(v);
const isIds = (v: unknown): v is string => typeof v === 'string' && TURN_MARK_IDS_RE.test(v);
const isErr = (v: unknown): v is string | null => v === null || (typeof v === 'string' && TURN_MARK_ERR_RE.test(v));
const splitList = (v: string): string[] => (v === '' ? [] : v.split(','));

/** `<registryDir>/<id>.turn.json` → `TurnMarkRead`. The ladder's first failure wins; see the module docstring. */
export async function readTurnMarkMeasured(io: FleetIO, registryDir: string, id: string, currentUuid: string | null,
  live: { readonly startedAt: number | null } | null): Promise<TurnMarkRead> {
  const read = await io.readFileMeasured(path.join(registryDir, `${id}.turn.json`));
  if (!read.ok) return read.reason === 'absent' ? ABSENT : UNMEASURED;
  if (Buffer.byteLength(read.content, 'utf8') > TURN_MARK_MAX_BYTES) return MALFORMED;
  let raw: unknown;
  try {
    raw = JSON.parse(read.content);
  } catch {
    return MALFORMED;
  }
  if (!isRecord(raw)) return MALFORMED;
  const state = raw['state'];
  if (raw['v'] !== 1 || !isState(state)) return MALFORMED;
  const sessionId = raw['sessionId'], event = raw['event'];
  const at = raw['at'], turnAt = raw['turnAt'], stopAt = raw['stopAt'], restartAt = raw['restartAt'];
  const bg = raw['bg'], bgKinds = raw['bgKinds'], bgIds = raw['bgIds'], err = raw['err'];
  const lostBg = raw['lostBg'], lostKinds = raw['lostKinds'], lostIds = raw['lostIds'];
  if (typeof sessionId !== 'string' || typeof event !== 'string') return MALFORMED;
  if (!isEpoch(at) || !isEpochOrNull(turnAt) || !isEpochOrNull(stopAt) || !isEpochOrNull(restartAt)) return MALFORMED;
  if (!isBg(bg) || !isLostBg(lostBg)) return MALFORMED;
  if (!isKinds(bgKinds) || !isKinds(lostKinds) || !isIds(bgIds) || !isIds(lostIds) || !isErr(err)) return MALFORMED;
  if (currentUuid === null || currentUuid === '' || sessionId !== currentUuid) return FOREIGN;
  const mark: Omit<TurnMark, 'graceUntil'> = {
    sessionId, state, event, at, turnAt, stopAt, bg, bgKinds: splitList(bgKinds), bgIds: splitList(bgIds), err,
    restartAt, lostBg, lostKinds: splitList(lostKinds), lostIds: splitList(lostIds),
  };
  if (live !== null && (live.startedAt === null || turnMarkStale(mark, live.startedAt))) return STALE;
  return { ok: true, ...mark, graceUntil: turnMarkGraceUntil(mark) };
}

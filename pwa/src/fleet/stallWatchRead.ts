// The Stall watch section's pure readers (ARCH-30, #544), out of `useStallWatchView`'s hook file so they import without
// React: the wire guard for `GET /api/coord/stall-watch`'s answer (`asStallWatchView`) and the guard for a 409
// `confirm-required` body (`asStallConfirm`). The guard kit is `lib/wire.ts`'s.
import {
  STALL_HELD_TEXT, STALL_LEVELS, STALL_NOTICE_TEXT, STALL_STAGES, STALL_STORED_STATES, isStallLevelChoice,
  type StallConfirmRequired, type StallLevel, type StallNextStep, type StallNoticeCount, type StallWatchEffective,
  type StallWatchStages, type StallWatchView, type StallWriteEffect,
} from '../../../shared/api';
import { isCount, isNum, isOneOf, isRecord } from '../lib/wire';


/** Every key of `StallWatchStages`, spelled as a Record so a stage added to the type and not here is a compile error. */
const STAGE_FLAGS = Object.keys({
  runs: true, checks: true, alerts: true, busyDelivery: true, busyGate: true, wave2: true,
} satisfies Record<keyof StallWatchStages, true>);
/** Every key of `StallHeld`, derived from L0's held lines, which are typed `Record<keyof StallHeld, string>`. */
const HELD_FLAGS = Object.keys(STALL_HELD_TEXT);
const NOTICE_ROWS = Object.keys(STALL_NOTICE_TEXT) as Array<StallNoticeCount['row']>;
const LEVEL_READINGS: ReadonlyArray<StallLevel | 'custom'> = [...STALL_LEVELS, 'custom'];
const SOURCES = ['chosen', 'files', 'held'] as const;
/** Far past the shipped list (23 steps) and far short of a list the select could not render. A quiet range that would
 *  list more is not a readable answer: the section's select iterates it. */
const QUIET_STEPS_MAX = 1_000;

const isFlags = (v: unknown, keys: readonly string[]): boolean =>
  isRecord(v) && keys.every((k) => typeof v[k] === 'boolean');

const isChosen = (v: unknown): v is StallWatchView['chosen'] =>
  isRecord(v)
  && (v.level === 'unreadable' || isStallLevelChoice(v.level))
  && (v.quietMs === 'default' || v.quietMs === 'unreadable' || isNum(v.quietMs))
  && (v.updatedAt === null || isNum(v.updatedAt))
  && isOneOf(STALL_STORED_STATES, v.stored);

const isQuiet = (v: unknown): v is StallWatchView['quiet'] => {
  if (!isRecord(v)) return false;
  const { effectiveMs, builtInMs, minMs, maxMs, stepMs, source } = v;
  return isNum(effectiveMs) && isNum(builtInMs) && isNum(minMs) && isNum(maxMs) && isNum(stepMs)
    && stepMs > 0 && minMs <= maxMs && (maxMs - minMs) / stepMs <= QUIET_STEPS_MAX
    && (source === 'chosen' || source === 'default');
};

const isFallback = (v: unknown): v is NonNullable<StallWatchView['fallback']> =>
  isRecord(v) && isNum(v.at) && typeof v.reason === 'string';

const isNextStep = (v: unknown): v is StallNextStep =>
  isRecord(v) && (v.kind === 'none' || v.kind === 'top'
    || (v.kind === 'step' && isOneOf(STALL_LEVELS, v.level)
      && Array.isArray(v.waitsOn) && v.waitsOn.every((s) => isOneOf(STALL_STAGES, s))));

const isNoticeCount = (v: unknown): v is StallNoticeCount =>
  isRecord(v) && isOneOf(NOTICE_ROWS, v.row) && isCount(v.sent) && isCount(v.shadow);

/** `effective`, or null when it cannot be read. A malformed `next` or `filesExceed` is DROPPED, read as not stated
 *  exactly as a missing one is (§12), and counted for the one warning; everything else must be whole. The drop is
 *  departure `malformed-optional-block-is-dropped` (D-4042): spec §13 names only a malformed `counts` element as
 *  dropped. */
function readEffective(v: unknown): { value: StallWatchEffective; dropped: number } | null {
  if (!isRecord(v)) return null;
  if (v.measured === false) return { value: v as unknown as StallWatchEffective, dropped: 0 };
  if (v.measured !== true) return null;
  if (!isOneOf(LEVEL_READINGS, v.level) || !isOneOf(LEVEL_READINGS, v.files) || !isOneOf(SOURCES, v.source)) return null;
  if (!isFlags(v.stages, STAGE_FLAGS) || !isFlags(v.held, HELD_FLAGS)) return null;
  const badNext = v.next !== undefined && !isNextStep(v.next);
  const badExceed = v.filesExceed !== undefined && typeof v.filesExceed !== 'boolean';
  if (!badNext && !badExceed) return { value: v as unknown as StallWatchEffective, dropped: 0 };
  const kept: Record<string, unknown> = { ...v };
  if (badNext) delete kept.next;
  if (badExceed) delete kept.filesExceed;
  return { value: kept as unknown as StallWatchEffective, dropped: Number(badNext) + Number(badExceed) };
}

/** `notices`, or null when it cannot be read. A malformed `counts` element is dropped and counted. */
function readNotices(v: unknown): { value: StallWatchView['notices']; dropped: number } | null {
  if (!isRecord(v)) return null;
  if (v.ok === false) return { value: { ok: false }, dropped: 0 };
  if (v.ok !== true || !isNum(v.since) || !isNum(v.windowMs) || !Array.isArray(v.counts)) return null;
  const counts = v.counts.filter(isNoticeCount);
  const dropped = v.counts.length - counts.length;
  return dropped === 0
    ? { value: v as unknown as StallWatchView['notices'], dropped }
    : { value: { ok: true, since: v.since, windowMs: v.windowMs, counts }, dropped };
}

/**
 * The wire guard: null unless the answer is a `StallWatchView` the section can render without throwing. A malformed
 * answer (a proxy's HTML, a stub `{}`, a level this build does not know) is a FAILURE the hook reports, never a level
 * it renders: an unknown level read as "Off" is the misreading §12's "unknown is never off" exists to refuse.
 *
 * Absence permits (§12): a missing `next` or `filesExceed` is not stated, and a missing `fallback` reads as none
 * stated. A present but malformed `next`, `filesExceed` or `counts` element is dropped, with exactly ONE
 * `console.warn` for the answer, as `asUpdatesView` does. A present but malformed `fallback` refuses the answer
 * instead: reading it as `null` would claim the choice applies when the server said it does not.
 *
 * A well-formed answer comes back as the same object; only a dropped part or a missing `fallback` rebuilds it.
 */
export function asStallWatchView(raw: unknown): StallWatchView | null {
  if (!isRecord(raw)) return null;
  const { chosen, quiet, fallback } = raw;
  if (!isChosen(chosen) || !isQuiet(quiet)) return null;
  if (fallback !== undefined && fallback !== null && !isFallback(fallback)) return null;
  const effective = readEffective(raw.effective);
  const notices = readNotices(raw.notices);
  if (effective === null || notices === null) return null;
  const dropped = effective.dropped + notices.dropped;
  if (dropped === 0 && fallback !== undefined) return raw as unknown as StallWatchView;
  if (dropped > 0) {
    console.warn(`ccrc: /api/coord/stall-watch dropped ${dropped} malformed part(s) it could not read — the rest still rendered.`);
  }
  return { chosen, effective: effective.value, quiet, notices: notices.value, fallback: fallback ?? null };
}

const isStageList = (v: unknown): boolean => Array.isArray(v) && v.every((s) => isOneOf(STALL_STAGES, s));

const isWriteEffect = (v: unknown): v is StallWriteEffect => {
  if (!isRecord(v)) return false;
  if (v.measured === false) return true;
  const { quietMs } = v;
  return v.measured === true && isStageList(v.turnsOn) && isStageList(v.turnsOff)
    && typeof v.leavesWave2 === 'boolean' && typeof v.heldByBox === 'boolean'
    && typeof v.quietLowered === 'boolean' && typeof v.filesExceed === 'boolean'
    && isFlags(v.before, STAGE_FLAGS) && isFlags(v.after, STAGE_FLAGS)
    && isRecord(quietMs) && isNum(quietMs.before) && isNum(quietMs.after)
    && typeof v.mailOff === 'boolean';
};

/** The 409 body's guard: `error: 'confirm-required'`, a string `effectKey`, and an effect readable WHOLE. Nothing is
 *  dropped here: a sheet built from part of an effect would understate what the write does. Anything else is not a
 *  confirm: `stallWriteRefusal` reads it as a refusal on a known code and as unconfirmed otherwise. */
export function asStallConfirm(raw: unknown): StallConfirmRequired | null {
  if (!isRecord(raw) || raw.error !== 'confirm-required' || typeof raw.effectKey !== 'string') return null;
  return isWriteEffect(raw.effect) ? (raw as unknown as StallConfirmRequired) : null;
}

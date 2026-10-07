// The Stall watch section's own read of `GET /api/coord/stall-watch` (stall watch settings, design 2026-10-05 §13), and
// the three pure readers its writes need: the wire guard for the answer, the guard for a 409 `confirm-required` body,
// and the reading of a write's rejection.
//
// The hook is `useUpdatesView`'s shape: the newest issued request is authoritative, a failed poll keeps the last GOOD
// view and reports the failure beside it, the page becoming visible re-polls, and `pollMs <= 0` is the injected mode.
// It adds `settle(view)`, which installs a write's reply and moves the request generation on, so a poll issued before
// the write that lands after it cannot put the old choice back. That is why `issued` lives in a ref shared by `load`
// and `settle` rather than in the effect, as `useUpdatesView`'s does. It has no `refresh()`: the server decides the
// confirm at the write (departure `server-decides-the-confirm` (D-4033)), so nothing here needs a fresh read to decide on.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  STALL_HELD_TEXT, STALL_LEVELS, STALL_NOTICE_TEXT, STALL_STAGES, STALL_STORED_STATES, isStallLevelChoice,
  type StallConfirmRequired, type StallLevel, type StallNextStep, type StallNoticeCount, type StallWatchEffective,
  type StallWatchStages, type StallWatchView, type StallWriteEffect,
} from '../../../shared/api';
import { ApiError, api, apiErrorText } from '../lib/api';

/** The read's cadence: the stall sweep's own (60 s), so a faster read would fetch the same answer again. */
export const STALL_WATCH_POLL_MS = 60_000;

/** Why the latest poll produced no view. `not-configured` is a server with no stall-watch settings to offer (a box with
 *  no coordination database, or an older build without the route), which the section renders INSTEAD of any view that
 *  landed; `failed` is a read that did not land, rendered beside the last good view. */
export type StallWatchFailure = 'not-configured' | 'failed';

export interface StallWatchPoll {
  /** The LAST GOOD answer: a later failure never clears it. */
  view: StallWatchView | null;
  /** The latest poll's failure; null after a good answer or a settle. */
  failure: StallWatchFailure | null;
  /** One poll now, fire-and-forget, under the same newest-issued guard. A no-op in the injected mode. */
  reload: () => void;
  /** Install a write's reply (already through `asStallWatchView`) and drop every poll issued before it. */
  settle: (view: StallWatchView) => void;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isCount = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
/** Membership by `includes`, never `in` or a map lookup: `'toString' in` any object literal is true. */
const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (list as readonly string[]).includes(v);

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
  isObject(v) && keys.every((k) => typeof v[k] === 'boolean');

const isChosen = (v: unknown): v is StallWatchView['chosen'] =>
  isObject(v)
  && (v.level === 'unreadable' || isStallLevelChoice(v.level))
  && (v.quietMs === 'default' || v.quietMs === 'unreadable' || isNum(v.quietMs))
  && (v.updatedAt === null || isNum(v.updatedAt))
  && isOneOf(STALL_STORED_STATES, v.stored);

const isQuiet = (v: unknown): v is StallWatchView['quiet'] => {
  if (!isObject(v)) return false;
  const { effectiveMs, builtInMs, minMs, maxMs, stepMs, source } = v;
  return isNum(effectiveMs) && isNum(builtInMs) && isNum(minMs) && isNum(maxMs) && isNum(stepMs)
    && stepMs > 0 && minMs <= maxMs && (maxMs - minMs) / stepMs <= QUIET_STEPS_MAX
    && (source === 'chosen' || source === 'default');
};

const isFallback = (v: unknown): v is NonNullable<StallWatchView['fallback']> =>
  isObject(v) && isNum(v.at) && typeof v.reason === 'string';

const isNextStep = (v: unknown): v is StallNextStep =>
  isObject(v) && (v.kind === 'none' || v.kind === 'top'
    || (v.kind === 'step' && isOneOf(STALL_LEVELS, v.level)
      && Array.isArray(v.waitsOn) && v.waitsOn.every((s) => isOneOf(STALL_STAGES, s))));

const isNoticeCount = (v: unknown): v is StallNoticeCount =>
  isObject(v) && isOneOf(NOTICE_ROWS, v.row) && isCount(v.sent) && isCount(v.shadow);

/** `effective`, or null when it cannot be read. A malformed `next` or `filesExceed` is DROPPED, read as not stated
 *  exactly as a missing one is (§12), and counted for the one warning; everything else must be whole. */
function readEffective(v: unknown): { value: StallWatchEffective; dropped: number } | null {
  if (!isObject(v)) return null;
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
  if (!isObject(v)) return null;
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
  if (!isObject(raw)) return null;
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
  if (!isObject(v)) return false;
  if (v.measured === false) return true;
  const { quietMs } = v;
  return v.measured === true && isStageList(v.turnsOn) && isStageList(v.turnsOff)
    && typeof v.leavesWave2 === 'boolean' && typeof v.heldByBox === 'boolean'
    && typeof v.quietLowered === 'boolean' && typeof v.filesExceed === 'boolean'
    && isFlags(v.before, STAGE_FLAGS) && isFlags(v.after, STAGE_FLAGS)
    && isObject(quietMs) && isNum(quietMs.before) && isNum(quietMs.after)
    && typeof v.mailOff === 'boolean';
};

/** The 409 body's guard: `error: 'confirm-required'`, a string `effectKey`, and an effect readable WHOLE. Nothing is
 *  dropped here: a sheet built from part of an effect would understate what the write does. Anything else is an
 *  ordinary refusal (`stallWriteRefusal`). */
export function asStallConfirm(raw: unknown): StallConfirmRequired | null {
  if (!isObject(raw) || raw.error !== 'confirm-required' || typeof raw.effectKey !== 'string') return null;
  return isWriteEffect(raw.effect) ? (raw as unknown as StallConfirmRequired) : null;
}

/** A write's rejection, read: the confirm the sheet shows, a refusal whose `detail` fills `STALL_CONFIRM_TEXT.refused`,
 *  or an answer that never arrived, which may have stored the write and so is never called a refusal. */
export type StallWriteRefusal =
  | { kind: 'confirm'; confirm: StallConfirmRequired }
  | { kind: 'refused'; detail: string }
  | { kind: 'unconfirmed' };

/** A string with something in it, trimmed; anything else is null. */
const nonBlank = (v: unknown): string | null => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : null);

/**
 * A confirm needs BOTH the 409 status and a body `asStallConfirm` reads, as not-configured needs both its status and
 * its code. Every other `ApiError` is a refusal: the server answered, so nothing was written. Its detail is the first
 * non-blank of the server's own `detail` (a 400 naming an unknown key), the body's `message` (Fastify's 500 carries the
 * cause the route threw there, such as a stored row that cannot be read), and the error's own text through
 * `apiErrorText` (a `confirm-required` body that does not read, a non-JSON body), so the refusal line never renders
 * with an empty slot.
 *
 * A rejection that is not an `ApiError` is a network failure, and the POST may have left before it: the write may
 * have landed. It is `unconfirmed`, never a refusal, so the section never says "Nothing was changed" about it.
 */
export function stallWriteRefusal(err: unknown): StallWriteRefusal {
  if (!(err instanceof ApiError)) return { kind: 'unconfirmed' };
  const confirm = err.status === 409 ? asStallConfirm(err.body) : null;
  if (confirm !== null) return { kind: 'confirm', confirm };
  const body = isObject(err.body) ? err.body : {};
  return { kind: 'refused', detail: nonBlank(body.detail) ?? nonBlank(body.message) ?? apiErrorText(err) };
}

/** The two answers that mean "not available on this server", each status with its own code: 501 `not-configured` (no
 *  coordination database) and 404 `not-found` (the server's `/api/*` not-found answer, an older build that lacks the
 *  route; departure `older-server-404-reads-not-configured` (D-4035)). A 404 or 501 carrying any other body is a read
 *  that failed: folding it in would overload one value with two conditions the section renders differently. */
const NOT_CONFIGURED_ANSWERS: ReadonlyArray<readonly [number, string]> = [[501, 'not-configured'], [404, 'not-found']];

const failureOf = (err: unknown): StallWatchFailure =>
  err instanceof ApiError && isObject(err.body)
    && NOT_CONFIGURED_ANSWERS.some(([status, code]) => err.status === status && (err.body as { error?: unknown }).error === code)
    ? 'not-configured'
    : 'failed';

/**
 * `GET /api/coord/stall-watch` every `pollMs` and whenever the page becomes visible. The newest ISSUED request is
 * authoritative: an older in-flight answer, good or bad, never overwrites a newer request's, nor a settled write's.
 * State is set functionally, so a failure keeps whatever view the previous commit held. `pollMs <= 0` is the injected
 * mode: no request, no interval, no listener; `settle` still installs.
 */
export function useStallWatchView(pollMs: number = STALL_WATCH_POLL_MS): StallWatchPoll {
  const [state, setState] = useState<{ view: StallWatchView | null; failure: StallWatchFailure | null }>(
    { view: null, failure: null });
  const issued = useRef(0);
  const loadRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (pollMs <= 0) return undefined;   // an injected consumer never polls
    let live = true;
    const load = (): void => {
      const mine = ++issued.current;
      void api.stallWatch().then(
        (raw) => {
          if (!live || mine !== issued.current) return;
          const view = asStallWatchView(raw);
          setState((prev) => (view === null ? { view: prev.view, failure: 'failed' } : { view, failure: null }));
        },
        (err: unknown) => {
          if (!live || mine !== issued.current) return;
          const failure = failureOf(err);
          setState((prev) => ({ view: prev.view, failure }));
        },
      );
    };
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') load();
    };
    loadRef.current = load;
    load();
    const t = setInterval(load, pollMs);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      loadRef.current = () => {};
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [pollMs]);

  const reload = useCallback(() => { loadRef.current(); }, []);
  const settle = useCallback((view: StallWatchView) => {
    issued.current += 1;   // every poll issued before this write now lands stale
    setState({ view, failure: null });
  }, []);
  return { view: state.view, failure: state.failure, reload, settle };
}

// The Temp root collector section's own read of `GET /api/coord/collect-lane` (path-identity spec 2026-10-12 §5.6,
// §5.7), and the three pure readers its writes need: the wire guard for the view, the guard for a 409 confirm body,
// and the reading of a write's rejection.
//
// The hook has `useStallWatchView`'s shape:
// - the newest issued request is authoritative;
// - the page becoming visible re-polls;
// - `pollMs <= 0` is the injected mode;
// - `settle(view)` installs a write's reply and moves the request generation on, so a poll issued before the write
//   that lands after it cannot put the old choice back.
// It differs in one rule, on purpose. Some answers from the SERVER drop the view that landed before:
// - this switch is not available here: 404 `not-found` or 501 `not-configured`, decided by the shared
//   `settingsReadFailure`;
// - its state cannot be measured: a 503 `state-unmeasurable` from the GET, where there is no row to read.
// So a Live radio from before a rollback, or from before a lost row, never stays on screen. A read that did not land,
// or an answer this guard cannot read whole, keeps the last good view beside its failure.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isCollectLaneRefusal,
  type CollectArmedBy, type CollectLaneConfirmRequired, type CollectLaneRefusal, type CollectLaneView,
} from '../../../shared/api';
import { ApiError, api, apiErrorText } from '../lib/api';
import { settingsReadFailure, type SettingsReadFailure } from '../lib/notAvailable';

/** The read's cadence, the stall section's: 60 s. */
export const COLLECT_LANE_POLL_MS = 60_000;

/** Why the latest poll produced no view: the shared helper's two words, plus the one answer this route alone gives
 *  (a 503 `state-unmeasurable` from the GET: the switch's row is absent, spec §5.6), with the server's bounded detail. */
export type CollectLaneReadFailure =
  | { kind: SettingsReadFailure }
  | { kind: 'state-unmeasurable'; detail: string };

export interface CollectLanePoll {
  /** The LAST GOOD answer. A failed read keeps it; a not-available or unmeasurable answer drops it. */
  view: CollectLaneView | null;
  /** The latest poll's failure; null after a good answer or a settle. */
  failure: CollectLaneReadFailure | null;
  /** One poll now, fire-and-forget, under the same newest-issued guard. A no-op in the injected mode. */
  reload: () => void;
  /** Install a write's reply (already through `asCollectLaneView`) and drop every poll issued before it. */
  settle: (view: CollectLaneView) => void;
}

type View = CollectLaneView;
type KnownNode = Extract<View['node'], { state: 'known' }>;
type OtherNode = Exclude<View['node'], { state: 'known' }>;
type Facts = CollectLaneConfirmRequired['facts'];

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isCount = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const isNonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isTextOrNull = (v: unknown): boolean => v === null || typeof v === 'string';
/** Membership by `includes`, never `in` or a map lookup: `'toString' in` any object literal is true. */
const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (list as readonly string[]).includes(v);
/** A union's members, spelled as a total Record, so a member added to L0 and not here is a compile error. */
const keysOf = <K extends string>(table: Record<K, true>): readonly K[] => Object.keys(table) as K[];

const STORED_FAULTS = keysOf<Exclude<View['stored'], { read: 'row' }>['read']>({ malformed: true, unreadable: true });
const JOURNAL_FAULTS = keysOf<Exclude<View['journal'], { read: 'ok' }>['read']>(
  { missing: true, malformed: true, unreadable: true, 'not-regular': true });
const MISMATCH_SIDES = keysOf<Extract<View['control'], { state: 'mismatch' }>['journal']>({ ahead: true, behind: true });
const EFFECTIVE_STATES = keysOf<View['effective']['state']>({
  live: true, shadowed: true, paused: true, 'safety-stopped': true, 'not-running': true, 'unknown-fleet': true,
});
const ARMED_BY = keysOf<CollectArmedBy>({ settings: true, 'legacy-marker': true, both: true, neither: true });
const MARKER_LISTINGS = keysOf<View['marker']['listing']>({ stands: true, absent: true, unmeasured: true });
const MARKER_LATCHES = keysOf<View['marker']['latch']>({ set: true, unset: true, unmeasured: true });
const KNOWN_STORED = keysOf<KnownNode['stored']>({ none: true, this: true, other: true, unread: true });
const OTHER_NODE_STATES = keysOf<OtherNode['state']>({ unmeasured: true, collision: true });
const OTHER_STORED = keysOf<OtherNode['stored']>({ none: true, set: true, unread: true });
const CONFIRM_ERRORS = keysOf<CollectLaneConfirmRequired['error']>({ 'confirm-required': true, 'confirm-stale': true });
const CONFIRM_MARKERS = keysOf<Facts['marker']>({ stands: true, absent: true });
const REPAIRS = keysOf<NonNullable<Facts['repair']>>({ 'journal-ahead': true, 'journal-behind': true });
/** The key a re-POST sends back: 8 lowercase hex (spec §5.6). */
const CONFIRM_KEY = /^[0-9a-f]{8}$/;
/** The one GET refusal this hook reads as its own kind, typed by L0's refusal union so a rename there is a compile
 *  error here. */
const UNMEASURABLE: CollectLaneRefusal = 'state-unmeasurable';

const isCounts = (v: unknown): boolean =>
  isObject(v) && isCount(v.wouldCollect) && isCount(v.held) && isCount(v.boxLines);
const isCaps = (v: unknown): boolean =>
  isObject(v) && typeof v.collect === 'boolean' && typeof v.reclaimPause === 'boolean';

/** The stored row as read. `choice` is the RAW token and any string reads (spec §5.2: a future token is readable and
 *  arms nothing). There is no `absent` arm: the route answers 503 for an absent row, so a view carrying one is refused. */
const isStored = (v: unknown): boolean => {
  if (!isObject(v)) return false;
  if (v.read !== 'row') return isOneOf(STORED_FAULTS, v.read);
  const { choice, fleetNodeId, markerRetiredAt, generation, updatedAt } = v;
  return typeof choice === 'string'
    && (fleetNodeId === null || isNonEmpty(fleetNodeId))
    && (markerRetiredAt === null || (isCount(markerRetiredAt) && markerRetiredAt > 0))
    && isCount(generation) && isCount(updatedAt);
};
const isJournal = (v: unknown): boolean =>
  isObject(v) && (v.read === 'ok' ? isCount(v.max) : isOneOf(JOURNAL_FAULTS, v.read));
const isControl = (v: unknown): boolean =>
  isObject(v) && (
    v.state === 'coherent' ? typeof v.bootstrap === 'boolean'
      : v.state === 'mismatch' ? isOneOf(MISMATCH_SIDES, v.journal)
        : v.state === 'unmeasurable');
/** `armedBy` is `neither` exactly when the state is not `live` (spec §5.5). A view that says otherwise names a source
 *  for a lane it does not call live, or no source for one it does, and is refused rather than shown. */
const isEffective = (v: unknown): boolean =>
  isObject(v) && isOneOf(EFFECTIVE_STATES, v.state) && isOneOf(ARMED_BY, v.armedBy)
  && (v.state === 'live') === (v.armedBy !== 'neither');
const isMarker = (v: unknown): boolean =>
  isObject(v) && isOneOf(MARKER_LISTINGS, v.listing) && isOneOf(MARKER_LATCHES, v.latch);
const isNode = (v: unknown): boolean => {
  if (!isObject(v)) return false;
  if (v.state === 'known') return isNonEmpty(v.nodeId) && isNum(v.measuredAt) && isOneOf(KNOWN_STORED, v.stored);
  return isOneOf(OTHER_NODE_STATES, v.state) && isOneOf(OTHER_STORED, v.stored);
};

/**
 * The wire guard (spec §5.6). It returns null unless the section can render ALL of the view. Nothing is dropped and
 * nothing is defaulted, for two reasons:
 * - a section built from part of a safety view would understate a stop;
 * - an unknown word read as a known one is the fold the spec forbids ("it never folds malformed, unreadable and absent
 *   into one value").
 * A well-formed answer comes back as the same object.
 */
export function asCollectLaneView(raw: unknown): CollectLaneView | null {
  if (!isObject(raw)) return null;
  const whole = isStored(raw.stored) && isJournal(raw.journal) && isControl(raw.control)
    && isEffective(raw.effective) && isMarker(raw.marker) && isNode(raw.node) && isCaps(raw.caps)
    && (raw.attention === null || isCounts(raw.attention))
    && isTextOrNull(raw.remedy) && isTextOrNull(raw.notice);
  return whole ? (raw as unknown as CollectLaneView) : null;
}

/** The 409 body's guard (spec §5.6). It accepts `confirm-required` or `confirm-stale`, with an 8-lowercase-hex key and
 *  the sheet's facts readable WHOLE. A sheet built from part of the facts would ask the operator to confirm less than
 *  the server measured. Anything else is not a confirm: `collectLanePostRefusal` reads it as a refusal when it carries
 *  a known code, and as unconfirmed when it does not. */
export function asCollectLaneConfirm(raw: unknown): CollectLaneConfirmRequired | null {
  if (!isObject(raw) || raw.ok !== false || !isOneOf(CONFIRM_ERRORS, raw.error)) return null;
  if (typeof raw.confirmKey !== 'string' || !CONFIRM_KEY.test(raw.confirmKey)) return null;
  const facts = raw.facts;
  if (!isObject(facts)) return null;
  const node = facts.node;
  const whole = isObject(node) && isNonEmpty(node.nodeId) && isNum(node.measuredAt)
    && isCaps(facts.caps) && typeof facts.paused === 'boolean' && isOneOf(CONFIRM_MARKERS, facts.marker)
    && (facts.repair === null || isOneOf(REPAIRS, facts.repair))
    && (facts.attention === null || isCounts(facts.attention));
  return whole ? (raw as unknown as CollectLaneConfirmRequired) : null;
}

/** A write's rejection, read. It is one of three:
 *  - the confirm the sheet shows;
 *  - a refusal: the server's own answer, carrying L0's code (the section's words table keys on it) and a detail that is
 *    never blank;
 *  - an answer that never arrived, or one that carries no code this build knows. Either may have stored the write, so
 *    it is never called a refusal. Its detail is the answer's when there was one, and null when none arrived. */
export type CollectLanePostRefusal =
  | { kind: 'confirm'; confirm: CollectLaneConfirmRequired }
  | { kind: 'refused'; code: CollectLaneRefusal; detail: string }
  | { kind: 'unconfirmed'; detail: string | null };

/** A string with something in it, trimmed; anything else is null. */
const nonBlank = (v: unknown): string | null => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : null);

/** The detail, from the first source that is not blank:
 *  1. the server's own `detail`;
 *  2. Fastify's `message`;
 *  3. the error's own text;
 *  4. the HTTP status.
 *  So a line that shows it never renders an empty slot. */
const detailOf = (err: ApiError): string => {
  const body: Record<string, unknown> = isObject(err.body) ? err.body : {};
  return nonBlank(body.detail) ?? nonBlank(body.message) ?? nonBlank(apiErrorText(err)) ?? `HTTP ${err.status}`;
};

/** A confirm needs BOTH the 409 status and a body `asCollectLaneConfirm` reads whole. An `ApiError` whose body's
 *  `error` is a known refusal code is the server's own answer, so it is `refused`: every known code but `write-failed`
 *  proves nothing was written, and `write-failed` keeps its own line, which says the server could not prove the choice
 *  was stored. Every other `ApiError` is `unconfirmed`, with its detail: a gateway's 502 or 504 can follow a POST that
 *  reached the server, and an unexpected 500 can follow a store that committed, so its answer proves nothing about the
 *  write. A rejection that is not an `ApiError` is a network failure, and the POST may have left before it, so it is
 *  `unconfirmed` with no detail. */
export function collectLanePostRefusal(err: unknown): CollectLanePostRefusal {
  if (!(err instanceof ApiError)) return { kind: 'unconfirmed', detail: null };
  const confirm = err.status === 409 ? asCollectLaneConfirm(err.body) : null;
  if (confirm !== null) return { kind: 'confirm', confirm };
  const body: Record<string, unknown> = isObject(err.body) ? err.body : {};
  if (isCollectLaneRefusal(body.error)) return { kind: 'refused', code: body.error, detail: detailOf(err) };
  return { kind: 'unconfirmed', detail: detailOf(err) };
}

/** A read's rejection. The shared helper decides 404/501 first. This route's 503 `state-unmeasurable` is then its own
 *  kind, carrying the server's bounded detail. Everything else is `failed`. */
const readFailureOf = (err: unknown): CollectLaneReadFailure => {
  if (settingsReadFailure(err) === 'not-configured') return { kind: 'not-configured' };
  if (err instanceof ApiError && err.status === 503) {
    const body: Record<string, unknown> = isObject(err.body) ? err.body : {};
    if (body.error === UNMEASURABLE) return { kind: 'state-unmeasurable', detail: detailOf(err) };
  }
  return { kind: 'failed' };
};

/**
 * `GET /api/coord/collect-lane` every `pollMs` and whenever the page becomes visible. The newest ISSUED request is
 * authoritative: an older in-flight answer, good or bad, never overwrites a newer request's answer, nor a settled
 * write's. `pollMs <= 0` is the injected mode: no request, no interval, no listener; `settle` still installs.
 */
export function useCollectLaneView(pollMs: number = COLLECT_LANE_POLL_MS): CollectLanePoll {
  const [state, setState] = useState<{ view: CollectLaneView | null; failure: CollectLaneReadFailure | null }>(
    { view: null, failure: null });
  const issued = useRef(0);
  const loadRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (pollMs <= 0) return undefined;   // an injected consumer never polls
    let live = true;
    const load = (): void => {
      const mine = ++issued.current;
      void api.collectLane().then(
        (raw) => {
          if (!live || mine !== issued.current) return;
          const view = asCollectLaneView(raw);
          setState((prev) => (view === null ? { view: prev.view, failure: { kind: 'failed' } } : { view, failure: null }));
        },
        (err: unknown) => {
          if (!live || mine !== issued.current) return;
          const failure = readFailureOf(err);
          // The server saying the switch is not here, or cannot be measured, drops the landed view; a read that did
          // not land keeps it.
          setState((prev) => ({ view: failure.kind === 'failed' ? prev.view : null, failure }));
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
  const settle = useCallback((view: CollectLaneView) => {
    issued.current += 1;   // every poll issued before this write now lands stale
    setState({ view, failure: null });
  }, []);
  return { view: state.view, failure: state.failure, reload, settle };
}

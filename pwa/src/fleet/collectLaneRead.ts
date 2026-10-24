// The Temp root collector section's pure readers (ARCH-30, #544), out of `useCollectLaneView`'s hook file so they
// import without React: the wire guard for `GET /api/coord/collect-lane`'s view (`asCollectLaneView`) and the guard
// for a 409 confirm body (`asCollectLaneConfirm`). The guard kit is `lib/wire.ts`'s.
import type {
  CollectArmedBy, CollectLaneConfirmRequired, CollectLaneView,
} from '../../../shared/api';
import { isCount, isNum, isOneOf, isRecord } from '../lib/wire';

type View = CollectLaneView;
type KnownNode = Extract<View['node'], { state: 'known' }>;
type OtherNode = Exclude<View['node'], { state: 'known' }>;
type Facts = CollectLaneConfirmRequired['facts'];

const isNonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isTextOrNull = (v: unknown): boolean => v === null || typeof v === 'string';
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
const isCounts = (v: unknown): boolean =>
  isRecord(v) && isCount(v.wouldCollect) && isCount(v.held) && isCount(v.boxLines);
const isCaps = (v: unknown): boolean =>
  isRecord(v) && typeof v.collect === 'boolean' && typeof v.reclaimPause === 'boolean';

/** The stored row as read. `choice` is the RAW token and any string reads (spec §5.2: a future token is readable and
 *  arms nothing). There is no `absent` arm: the route answers 503 for an absent row, so a view carrying one is refused. */
const isStored = (v: unknown): boolean => {
  if (!isRecord(v)) return false;
  if (v.read !== 'row') return isOneOf(STORED_FAULTS, v.read);
  const { choice, fleetNodeId, markerRetiredAt, generation, updatedAt } = v;
  return typeof choice === 'string'
    && (fleetNodeId === null || isNonEmpty(fleetNodeId))
    && (markerRetiredAt === null || (isCount(markerRetiredAt) && markerRetiredAt > 0))
    && isCount(generation) && isCount(updatedAt);
};
const isJournal = (v: unknown): boolean =>
  isRecord(v) && (v.read === 'ok' ? isCount(v.max) : isOneOf(JOURNAL_FAULTS, v.read));
const isControl = (v: unknown): boolean =>
  isRecord(v) && (
    v.state === 'coherent' ? typeof v.bootstrap === 'boolean'
      : v.state === 'mismatch' ? isOneOf(MISMATCH_SIDES, v.journal)
        : v.state === 'unmeasurable');
/** `armedBy` is `neither` exactly when the state is not `live` (spec §5.5). A view that says otherwise names a source
 *  for a lane it does not call live, or no source for one it does, and is refused rather than shown. */
const isEffective = (v: unknown): boolean =>
  isRecord(v) && isOneOf(EFFECTIVE_STATES, v.state) && isOneOf(ARMED_BY, v.armedBy)
  && (v.state === 'live') === (v.armedBy !== 'neither');
const isMarker = (v: unknown): boolean =>
  isRecord(v) && isOneOf(MARKER_LISTINGS, v.listing) && isOneOf(MARKER_LATCHES, v.latch);
const isNode = (v: unknown): boolean => {
  if (!isRecord(v)) return false;
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
  if (!isRecord(raw)) return null;
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
  if (!isRecord(raw) || raw.ok !== false || !isOneOf(CONFIRM_ERRORS, raw.error)) return null;
  if (typeof raw.confirmKey !== 'string' || !CONFIRM_KEY.test(raw.confirmKey)) return null;
  const facts = raw.facts;
  if (!isRecord(facts)) return null;
  const node = facts.node;
  const whole = isRecord(node) && isNonEmpty(node.nodeId) && isNum(node.measuredAt)
    && isCaps(facts.caps) && typeof facts.paused === 'boolean' && isOneOf(CONFIRM_MARKERS, facts.marker)
    && (facts.repair === null || isOneOf(REPAIRS, facts.repair))
    && (facts.attention === null || isCounts(facts.attention));
  return whole ? (raw as unknown as CollectLaneConfirmRequired) : null;
}

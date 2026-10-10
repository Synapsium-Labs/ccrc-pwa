import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { isClaimCode } from '../../../shared/agent-protocol.js';
import type { ClaimRefusal } from '../../../shared/box-token.js';
import { matchDigestSlots } from '../coord/token.js';
import { NODE_ID_RE } from '../coord/store.js';
import {
  BURNED_CODES_KEPT, CLAIM_ALERT_EVERY_MS, MAX_PENDING, claimVerdict, codeExpiresAt, keepBurned,
  type ClaimDoorState, type ClaimMatch,
} from './policy.js';
import { mintClaimCode } from './files.js';

/** What one claim step answers the route. A 200 carries the value, served from
 *  memory (the holder's pending slot via `valueOf`), never from the pending file. `nodeId` is the presenting node, which
 *  passed NODE_ID_RE and (a 200 being a bound match) is the node the code was bound to: the route's lines name it (F11). */
export type ClaimStep =
  | { status: 200; generation: string; value: string; nodeId: string }
  | { status: 400 | 403 | 404 | 410 | 429; error: ClaimRefusal; generation: string | null };

/** `; <label> node <id>` for an id that passed NODE_ID_RE, else nothing: a log line never carries a string that failed the shape. */
const nodeClause = (label: string, id: string | null): string => (id === null ? '' : `; ${label} node ${id}`);

const sha256 = (s: string): Buffer => createHash('sha256').update(s, 'utf8').digest();

/** The fixed number of slots every claim compares: the live codes, then the burned ones. */
const SLOT_COUNT = MAX_PENDING + BURNED_CODES_KEPT;

/**
 * THE CLAIM DOOR'S STATE AND ITS ONE STEP (box-token lifecycle spec 4.6), an L3
 * adapter: it holds sha256 digests of the codes it issued (never a code, never
 * on disk, so a restart voids them all), a short list of burned digests, and the
 * door-wide miss bucket. Every decision is `claimVerdict`'s (L1); this class
 * shapes the input, compares in constant time, applies the answer, and warns.
 *
 * {@link claimNow} is ONE SYNCHRONOUS STEP with no await: the shape check, the
 * digest, a compare over a FIXED `MAX_PENDING + BURNED_CODES_KEPT` slots (empty
 * ones are per-door random dummies, so the compare count does not say how many
 * codes are live), the verdict, the burn and the next state all happen before
 * the route's first await. That is what gives two claims in one tick exactly
 * one 200.
 */
export class ClaimDoor {
  private state: ClaimDoorState = { live: [], burned: [], misses: { windowStart: 0, count: 0 } };
  private readonly dummies: readonly Buffer[] = Array.from({ length: SLOT_COUNT }, () => randomBytes(32));
  private readonly valueOf: (generation: string) => string | null;
  private readonly warn: (line: string) => void;
  /** CONTRACT ADDITION (marked): injectable so a test can count compares. */
  private readonly compare: (a: Buffer, b: Buffer) => boolean;
  private lastMissWarnAt: number | null = null;
  private lastReplayWarnAt: number | null = null;
  /** Generations the driver must discard (an expired or misbound code burned
   *  them), and how many replays of a burned code were seen. The driver drains
   *  the two lists; a replay discards nothing. */
  readonly alerts: { expired: string[]; wrongNode: string[]; replays: number } = { expired: [], wrongNode: [], replays: 0 };

  constructor(opts: { valueOf: (generation: string) => string | null; warn: (line: string) => void;
    compare?: (a: Buffer, b: Buffer) => boolean }) {
    this.valueOf = opts.valueOf;
    this.warn = opts.warn;
    this.compare = opts.compare ?? timingSafeEqual;
  }

  /** Mints a code for `generation`, bound to the measured fleet `nodeId`, and keeps
   *  only its sha256. A re-issue for the same generation replaces its live code;
   *  more than `MAX_PENDING` live codes is a programming error and throws. */
  issue(generation: string, nodeId: string, now: number): string {
    const live = this.state.live.filter((s) => s.generation !== generation);
    if (live.length >= MAX_PENDING) throw new RangeError(`ClaimDoor: at most ${MAX_PENDING} live codes`);
    const code = mintClaimCode();
    this.state = { ...this.state, live: [...live,
      { digest: sha256(code).toString('hex'), generation, nodeId, expiresAt: codeExpiresAt(now) }] };
    return code;
  }

  /** Drops `generation`'s live code, if any (the driver discarded the generation). */
  revoke(generation: string): void {
    this.state = { ...this.state, live: this.state.live.filter((s) => s.generation !== generation) };
  }

  claimNow(body: unknown, now: number): ClaimStep {
    const b = (typeof body === 'object' && body !== null ? body : {}) as { code?: unknown; nodeId?: unknown };
    const wellShaped = isClaimCode(b.code) && typeof b.nodeId === 'string' && NODE_ID_RE.test(b.nodeId);
    // Burned digests age out by time alone, which is not a secret (D-4405: A6's keepBurned, never a copy).
    const burned = keepBurned(this.state.burned, now);
    this.state = { ...this.state, burned };
    let match: ClaimMatch = { kind: 'malformed' };
    if (wellShaped) {
      const slots = [
        ...Array.from({ length: MAX_PENDING }, (_, i) => this.slotDigest(this.state.live[i]?.digest, i)),
        ...Array.from({ length: BURNED_CODES_KEPT }, (_, i) => this.slotDigest(burned[i]?.digest, MAX_PENDING + i)),
      ];
      const i = matchDigestSlots(sha256(b.code as string), slots, this.compare);
      match = i < 0 ? { kind: 'none' }
        : i < MAX_PENDING ? { kind: 'live', index: i }
          : { kind: 'burned', index: i - MAX_PENDING };
    }
    // The presented id is printable only once it passed NODE_ID_RE (`wellShaped`); the bound id is read before the
    // verdict burns the slot, and is re-checked here too: a log line never carries a string that failed the shape (F10).
    const presented = wellShaped ? (b.nodeId as string) : null;
    const boundRaw = match.kind === 'live' ? this.state.live[match.index]?.nodeId : undefined;
    const bound = boundRaw !== undefined && NODE_ID_RE.test(boundRaw) ? boundRaw : null;
    const { reply, next, alert } = claimVerdict(this.state, match, presented ?? '', now);
    this.state = next;
    if (alert !== null) this.report(alert, now, { presented, bound });
    if (reply.status !== 200) return { status: reply.status, error: reply.error, generation: reply.generation };
    const value = this.valueOf(reply.generation);
    if (value === null) {
      // The code was live but its generation is gone from the holder: the code is
      // burned, nothing is handed out, and the driver is told to discard it.
      this.alerts.expired.push(reply.generation);
      // Spec 7.1 (F11): the outcome's word and its node ids, both NODE_ID_RE-checked above; never the code.
      this.warn(`ccrc-server: box token: claim door no-claim: a live claim code named generation ${reply.generation}, ` +
        `which the server no longer holds; nothing was handed out${nodeClause('bound to', bound)}${nodeClause('presented by', presented)}`);
      return { status: 404, error: 'no-claim', generation: reply.generation };
    }
    return { status: 200, generation: reply.generation, value, nodeId: presented as string };
  }

  private slotDigest(hex: string | undefined, i: number): Buffer {
    return hex === undefined ? this.dummies[i]! : Buffer.from(hex, 'hex');
  }

  private report(alert: NonNullable<ReturnType<typeof claimVerdict>['alert']>, now: number,
    nodes: { presented: string | null; bound: string | null }): void {
    if (alert.kind === 'misses') {
      if (this.lastMissWarnAt !== null && now - this.lastMissWarnAt < CLAIM_ALERT_EVERY_MS) return;
      this.lastMissWarnAt = now;
      this.warn(`ccrc-server: box token: the claim door refused ${alert.count} miss(es) in the current minute ` +
        '(no live code matched; misses never burn a code)');
      return;
    }
    // Spec 7.1: a claim-door outcome is logged with its word and its node id. The ids are NODE_ID_RE-shaped by now
    // (`claimNow` passes null for one that is not), and the line never carries a code or a digest.
    const who = nodeClause;
    if (alert.kind === 'replay') {
      this.alerts.replays++;
      if (this.lastReplayWarnAt !== null && now - this.lastReplayWarnAt < CLAIM_ALERT_EVERY_MS) return;
      this.lastReplayWarnAt = now;
      this.warn(`ccrc-server: box token: claim door code-used: a used claim code for generation ${alert.generation} was ` +
        `presented again${nodes.presented === null ? '' : ` by node ${nodes.presented}`} (${this.alerts.replays} replay(s) since boot); refused, nothing discarded`);
      return;
    }
    const expired = alert.kind === 'expired';
    (expired ? this.alerts.expired : this.alerts.wrongNode).push(alert.generation);
    this.warn(`ccrc-server: box token: claim door ${expired ? 'code-expired' : 'wrong-node'}: a claim code for generation ` +
      `${alert.generation} was presented ${expired ? 'after its TTL' : 'from a node it was not bound to'}` +
      `${who('bound to', nodes.bound)}${who('presented by', nodes.presented)}; it was burned and the generation will be discarded`);
  }
}

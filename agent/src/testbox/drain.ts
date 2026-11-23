// D-8907 (spec docs/superpowers/specs/2026-11-22-test-box-managed-node-design.md §2.5 "The drain"). L1, pure and
// clock-free: the drain's decisions. Every time is given by the caller, in ms since the epoch; the request is read by
// the caller (`drainer.ts`, L4, through `boxFs.ts`) and handed here as it was read.
//
// THE REQUEST IS A LEASE. While a request stands with its deadline ahead, the service starts no waiting run, lets the
// runs in progress end, writes its queue to disk and answers; it stays up, and only the updater stops it. When the
// request is withdrawn or its deadline passes, the service takes runs again by itself. So an updater killed in
// mid-drain leaves a box that takes runs again within the deadline.
//
// THREE READS, THREE MEANINGS, never folded:
//   - absent: the request is withdrawn. The lease ends now.
//   - a request: the lease stands while its deadline is ahead. A request naming another act continues the drain under
//     that act (its own deadline, its own answer).
//   - unreadable, or not a request: no information. It never starts a lease, and it never ends one early: a lease the
//     service already holds stands until its own deadline, which bounds it either way.
//
// THE CEILING. A lease stands at most `DRAIN_LEASE_MAX_MS` from when the service first saw its act, whatever deadline
// the request names, so a request with a deadline years ahead closes the box for an hour, not for good. An act whose
// lease ended by time is spent: the same request, still on disk, never closes the box again. A withdrawal clears it.
import type { DrainAnswer, DrainRequest, SmallRead } from './boxFiles.js';
import { parseDrainRequest } from './boxFiles.js';

/** The longest a lease stands from when its act was first seen: the longest act (spec §2.9, the server's 60 minutes). */
export const DRAIN_LEASE_MAX_MS = 60 * 60_000;

/** The drain request as it was read. */
export type RequestRead =
  | { readonly t: 'absent' }
  | { readonly t: 'request'; readonly request: DrainRequest }
  | { readonly t: 'unreadable'; readonly why: string }
  | { readonly t: 'malformed'; readonly why: string };

/** The request file's read to the request's: a text that does not parse is `malformed`, never `absent`. */
export function requestRead(r: SmallRead): RequestRead {
  if (r.t !== 'text') return r;
  const p = parseDrainRequest(r.text);
  return p.ok ? { t: 'request', request: p.request } : { t: 'malformed', why: p.why };
}

/** A lease the service holds: whose act, since when the service has seen it, and the deadline its request names. */
export interface Lease { readonly actId: string; readonly since: number; readonly deadlineMs: number }

export interface DrainState {
  readonly lease: Lease | null;
  /** The act whose lease ended by time; its request, still on disk, starts no lease again. */
  readonly spent: string | null;
}

/** No request stands: the service takes runs. */
export const OPEN_DRAIN: DrainState = { lease: null, spent: null };

/** When a lease ends by time: its request's deadline, or the ceiling, whichever is first. */
export const leaseEnd = (l: Lease): number => Math.min(l.deadlineMs, l.since + DRAIN_LEASE_MAX_MS);

/** Why a lease the service held is over: its request was withdrawn, or its time passed. */
export type LeaseEnded = 'withdrawn' | 'expired';

export interface LeaseStep { readonly state: DrainState; readonly ended: LeaseEnded | null }

/** The act a lease that ended by time leaves spent: its own, when the ceiling ended it with its deadline still ahead
 *  (that request, still on disk, would otherwise stand again); none when its own deadline ended it. */
const spentBy = (l: Lease, now: number): string | null => (now < l.deadlineMs ? l.actId : null);

/** One reading of the request, at `now`: the lease the service holds after it, and whether one it held ended. */
export function leaseStep(s: DrainState, read: RequestRead, now: number): LeaseStep {
  const held = s.lease;
  const over = (why: LeaseEnded, spent: string | null): LeaseStep => ({ state: { lease: null, spent }, ended: held === null ? null : why });
  if (read.t === 'absent') return over('withdrawn', null);
  if (read.t === 'request') {
    const { actId, deadlineMs } = read.request;
    if (actId === s.spent) return over('expired', s.spent);
    const lease: Lease = { actId, since: held !== null && held.actId === actId ? held.since : now, deadlineMs };
    return now < leaseEnd(lease) ? { state: { lease, spent: null }, ended: null } : over('expired', spentBy(lease, now));
  }
  // No information: the lease held stands until its own end, and none starts.
  if (held === null) return { state: s, ended: null };
  return now < leaseEnd(held) ? { state: s, ended: null } : over('expired', spentBy(held, now));
}

/** Whether a waiting run may start: not while a lease stands. */
export const drainOpen = (s: DrainState): boolean => s.lease === null;

/** What the service answers while a lease stands. `idle` only when nothing is in progress AND the queue is on disk
 *  (`onDisk`, the handed-over runs counted there; `null` when the hand-over could not be written). */
export function drainAnswer(lease: Lease, quiet: boolean, running: number, onDisk: number | null): DrainAnswer {
  return quiet && onDisk !== null ? { act: lease.actId, state: 'idle', queued: onDisk } : { act: lease.actId, state: 'draining', running };
}

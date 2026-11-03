/**
 * THE ONE RATE SERVICE for Linear calls (D-7670, R4; spec §6.7, #1444): the one place that decides whether a Linear
 * call may start. Built ONCE, by the composition root (`index.ts`), with the wall clock, and handed in `Deps` to every
 * caller: today the legacy Check again and Connect (`routes.ts`) and the title lookups (`resolve.ts`, all three of its
 * callers); the proxy routes, the Settings routes and the background refresher as they land. Nothing else holds a
 * bucket, and no caller builds a second instance (`linear-rate.test.ts`'s census, `single-definition/linear-rate.ts`).
 *
 * L1: pure token-bucket transitions over an injected clock. It imports one type and no value, never calls Linear,
 * keeps no timer, and holds no key: its state is call counts in memory, keyed by slot id (the legacy slot under its
 * own fixed key) and by attributed session id.
 *
 * THE UNIT IS A LINEAR CALL, not a route. A caller takes its worst case (one call, or two for a route that resolves
 * first) from every bucket before its first call (`take`), and reports after (`settle`), which gives back what it did
 * not spend and, on Linear's own `rate-limited` answer, closes the slot until the wait that answer carried: every
 * call to that slot, ccrc's own included, is then refused locally, so nothing presses on Linear while it refuses.
 *
 * Complexity is bounded per query only (every fixed document is held under `maxQueryComplexity` by its recorded
 * fixture); there is no local complexity budget and the remaining-quota headers are not read (spec §6.7, §6.9).
 */
import type { LinearSlotRef } from './store.js';

/**
 * Linear's quota for a caller authenticated with an API key, from Linear's rate-limiting page (measured 2026-10-31,
 * spec §1.2a). PER USER: every request that Linear user makes, through any key and outside ccrc too, shares it.
 */
export const LINEAR_QUOTA = { requestsPerHour: 2_500, complexityPerHour: 3_000_000, maxQueryComplexity: 10_000 } as const;

/** Who may start a call, each its own bucket in each slot. `proxy`: the session proxy routes. `request`: the calls a
 *  cookie-gated request starts (the title lookups and the legacy Check again), which a local caller reaches with no
 *  token while the sign-in gate is unarmed. `floor`: ccrc's background refreshes and the account-gated key acts. */
export const LINEAR_RATE_LANES = ['proxy', 'request', 'floor'] as const;
export type LinearRateLane = (typeof LINEAR_RATE_LANES)[number];

/** A slot's calls an hour: 2,000 of the user's 2,500, so 500 are left to the user's own use of Linear. */
export const LINEAR_SLOT_CALLS_PER_HOUR = 2_000;

/** The slot's 2,000 as three lanes that NEVER BORROW from each other: no amount of proxy traffic takes the titles or
 *  the Check again away, and no amount of tokenless traffic to the cookie routes takes the proxy's lane or the floor. */
export const LINEAR_LANE_CALLS_PER_HOUR: Readonly<Record<LinearRateLane, number>> = { proxy: 1_700, request: 100, floor: 200 };

/** After a restart each lane starts at this share of its size (425, 25 and 50), so a crash loop cannot spend an
 *  hour's quota in a minute. */
export const LINEAR_RESTART_SHARE = 0.25;

/** Per attributed session, across every slot: fairness between sessions, not a wall (a box-token holder can present
 *  a neighbour's id; the wall is the slot's proxy lane). 7.5% of a slot an hour. */
export const LINEAR_SESSION_BUDGET = { callsPerHour: 150, callsPerMinute: 20, writesPerHour: 50 } as const;

/** What a caller asks before a call. */
export interface LinearRateAsk {
  lane: LinearRateLane;
  slot: LinearSlotRef;
  /** The worst case: the most Linear calls the caller may make before it settles (one, or two with a resolve). */
  calls: number;
  /** The attributed session a proxy call is made for, and whether it writes. Absent for ccrc's own calls. */
  session?: { id: string; write: boolean };
}

/** Why a take was refused: the slot is closed after Linear's own refusal (`linear`), the lane is spent
 *  (`workspace`), or the session is (`session`): `rate-limited`'s three details (spec §6.8). */
export type LinearRateRefusal = 'linear' | 'workspace' | 'session';

/** A granted take, to settle once. Opaque to callers. */
export interface LinearRateGrant { readonly lane: LinearRateLane; readonly calls: number }

export type LinearRateTake =
  | { ok: true; grant: LinearRateGrant }
  | { ok: false; detail: LinearRateRefusal; retryAfterS: number };

/** What a caller reports: the calls it made, and the wait of a `rate-limited` answer (null for any other). */
export interface LinearRateOutcome { spent: number; closeForS: number | null }

/** The outcome of one call that was made: one spent, and a `rate-limited` answer closes the slot for its wait. */
export const oneCallOutcome = (r: { ok: boolean; reason?: string; retryAfterS?: number }): LinearRateOutcome => ({
  spent: 1, closeForS: !r.ok && r.reason === 'rate-limited' && r.retryAfterS !== undefined ? r.retryAfterS : null,
});

// ── the pure transitions ──

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

/** A bucket's level at a moment. Its size refills evenly over its window. */
interface Bucket { level: number; at: number }
interface Size { size: number; windowMs: number }

const refilled = (b: Bucket, s: Size, now: number): Bucket => (now <= b.at ? b
  : { level: Math.min(s.size, b.level + ((now - b.at) * s.size) / s.windowMs), at: now });

/** Whole seconds until `n` is in the bucket; at least one, since a refusal always names a wait. */
const secondsUntil = (b: Bucket, s: Size, n: number): number =>
  Math.max(1, Math.ceil((((n - b.level) * s.windowMs) / s.size) / 1000));

const giveBack = (b: Bucket, s: Size, n: number, now: number): Bucket => {
  const r = refilled(b, s, now);
  return { level: Math.min(s.size, r.level + n), at: r.at };
};

const laneSize = (lane: LinearRateLane): Size => ({ size: LINEAR_LANE_CALLS_PER_HOUR[lane], windowMs: HOUR_MS });
const SESSION_HOUR: Size = { size: LINEAR_SESSION_BUDGET.callsPerHour, windowMs: HOUR_MS };
const SESSION_MINUTE: Size = { size: LINEAR_SESSION_BUDGET.callsPerMinute, windowMs: MINUTE_MS };
const SESSION_WRITES: Size = { size: LINEAR_SESSION_BUDGET.writesPerHour, windowMs: HOUR_MS };

/** The legacy slot's own fixed key: a file slot's id is a UUID, so the two never meet. */
const slotKey = (slot: LinearSlotRef): string => (slot.source === 'legacy' ? 'legacy' : `file:${slot.id}`);

interface SessionBuckets { hour: Bucket; minute: Bucket; writes: Bucket }
interface OpenGrant extends LinearRateGrant { slot: string; session: string | null; write: boolean }

/** Session entries are dropped once full again (a full bucket is what a new one is), when there are more than this. */
const SESSION_PRUNE_AT = 256;

export class LinearRateService {
  private readonly lanes = new Map<string, Bucket>();
  private readonly closedUntil = new Map<string, number>();
  private readonly sessions = new Map<string, SessionBuckets>();
  private readonly open = new WeakSet<LinearRateGrant>();
  /** When this process's service was built: every lane of every slot starts at a quarter FROM HERE (a restart), and
   *  refills from here, whenever it is first asked. */
  private readonly bornAt: number;

  constructor(private readonly now: () => number) {
    this.bornAt = now();
  }

  /** Asks for `ask.calls` calls from the slot's lane and, for a session, from its buckets: all of them or none. */
  take(ask: LinearRateAsk): LinearRateTake {
    const now = this.now();
    const slot = slotKey(ask.slot);
    const until = this.closedUntil.get(slot);
    if (until !== undefined) {
      if (until > now) return { ok: false, detail: 'linear', retryAfterS: Math.max(1, Math.ceil((until - now) / 1000)) };
      this.closedUntil.delete(slot);
    }

    const calls = Math.max(1, Math.ceil(ask.calls));
    const laneKey = `${slot}\u0000${ask.lane}`;
    const size = laneSize(ask.lane);
    const lane = refilled(this.lanes.get(laneKey) ?? { level: size.size * LINEAR_RESTART_SHARE, at: Math.min(this.bornAt, now) }, size, now);
    this.lanes.set(laneKey, lane);
    if (lane.level < calls) return { ok: false, detail: 'workspace', retryAfterS: secondsUntil(lane, size, calls) };

    let session: SessionBuckets | null = null;
    if (ask.session !== undefined) {
      this.prune(now);
      const was = this.sessions.get(ask.session.id);
      session = was === undefined
        ? { hour: { level: SESSION_HOUR.size, at: now }, minute: { level: SESSION_MINUTE.size, at: now }, writes: { level: SESSION_WRITES.size, at: now } }
        : { hour: refilled(was.hour, SESSION_HOUR, now), minute: refilled(was.minute, SESSION_MINUTE, now), writes: refilled(was.writes, SESSION_WRITES, now) };
      this.sessions.set(ask.session.id, session);
      const waits = [
        session.hour.level < calls ? secondsUntil(session.hour, SESSION_HOUR, calls) : 0,
        session.minute.level < calls ? secondsUntil(session.minute, SESSION_MINUTE, calls) : 0,
        ask.session.write && session.writes.level < 1 ? secondsUntil(session.writes, SESSION_WRITES, 1) : 0,
      ];
      const wait = Math.max(...waits);
      if (wait > 0) return { ok: false, detail: 'session', retryAfterS: wait };
    }

    this.lanes.set(laneKey, { level: lane.level - calls, at: lane.at });
    if (session !== null && ask.session !== undefined) {
      this.sessions.set(ask.session.id, {
        hour: { level: session.hour.level - calls, at: session.hour.at },
        minute: { level: session.minute.level - calls, at: session.minute.at },
        writes: ask.session.write ? { level: session.writes.level - 1, at: session.writes.at } : session.writes,
      });
    }
    const grant: OpenGrant = { lane: ask.lane, calls, slot, session: ask.session?.id ?? null, write: ask.session?.write ?? false };
    this.open.add(grant);
    return { ok: true, grant };
  }

  /** Reports a granted take, once: gives back the calls it did not spend, and closes the slot on `closeForS`. */
  settle(grant: LinearRateGrant, outcome: LinearRateOutcome): void {
    if (!this.open.has(grant)) return;
    this.open.delete(grant);
    const g = grant as OpenGrant;
    const now = this.now();
    const spent = Math.min(g.calls, Math.max(0, Math.ceil(outcome.spent)));
    const back = g.calls - spent;
    if (back > 0) {
      const laneKey = `${g.slot}\u0000${g.lane}`;
      const lane = this.lanes.get(laneKey);
      if (lane !== undefined) this.lanes.set(laneKey, giveBack(lane, laneSize(g.lane), back, now));
      const s = g.session === null ? undefined : this.sessions.get(g.session);
      if (s !== undefined && g.session !== null) {
        this.sessions.set(g.session, {
          hour: giveBack(s.hour, SESSION_HOUR, back, now),
          minute: giveBack(s.minute, SESSION_MINUTE, back, now),
          // A write that was never sent is no write.
          writes: g.write && spent === 0 ? giveBack(s.writes, SESSION_WRITES, 1, now) : s.writes,
        });
      }
    }
    const close = outcome.closeForS;
    if (close !== null && Number.isFinite(close) && close > 0) {
      const until = now + Math.ceil(close) * 1000;
      this.closedUntil.set(g.slot, Math.max(this.closedUntil.get(g.slot) ?? 0, until));
    }
  }

  /** Forgets sessions whose buckets are full again: one is then exactly what a new entry would be. */
  private prune(now: number): void {
    if (this.sessions.size <= SESSION_PRUNE_AT) return;
    for (const [id, s] of this.sessions) {
      if (refilled(s.hour, SESSION_HOUR, now).level >= SESSION_HOUR.size
        && refilled(s.minute, SESSION_MINUTE, now).level >= SESSION_MINUTE.size
        && refilled(s.writes, SESSION_WRITES, now).level >= SESSION_WRITES.size) this.sessions.delete(id);
    }
  }
}

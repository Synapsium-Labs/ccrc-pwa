/**
 * THE ONE BACKGROUND REFRESHER of what each Linear slot knows (#1444, D-7668; spec 2026-10-31 §4.1, §4.3, §6.7), and the
 * key check through the one rate service that it and the legacy Check again share.
 *
 * L3 ADAPTER: it reads a slot's key from its file before each page, calls Linear through `client.ts`, and records what it
 * learned through `store.ts`, under the one lock, by the digest rule. Built ONCE, by the composition root (`index.ts`),
 * and handed in `Deps`.
 *
 * NEVER INSIDE A REQUEST. Routing (`route.ts`) never calls Linear: a team or issue prefix that matches no slot is
 * answered at once, and, as a side effect, `miss` queues a refresh of every slot whose teams are more than five minutes
 * old. The queue runs one slot at a time, each slot at most once in five minutes whatever the number of misses, after
 * the caller's own turn has ended, so a miss costs the call that made it nothing and cannot spend its deadline (§6.6).
 * Its calls are charged to the slot's `floor` in the rate service (§6.7), never to a session or a request.
 *
 * NO KEY IS HELD. The queue holds slot references and times; each page of each refresh reads the key from its file
 * (`readLinearSlotKey`), so a key removed or replaced mid-refresh stops it at its next page, and it records nothing.
 */
import { checkLinearKey, type FetchLike, type LinearKeyCheck } from './client.js';
import type { LinearRateGrant, LinearRateLane, LinearRateRefusal, LinearRateService } from './rate.js';
import {
  readLinearSlotKey, recordLinearSlotCheck, writeLegacyTeams, type LinearSlotRef, type LinearStoreRead,
} from './store.js';
import { checkOutcomeOf } from './view.js';

/** A key check's answer through the rate service: refused before any call, or checked. */
export type LinearSlotCheck =
  | { kind: 'refused'; detail: LinearRateRefusal; retryAfterS: number }
  | { kind: 'checked'; check: LinearKeyCheck };

export interface LinearSlotCheckOpts {
  ccrcDir: string;
  slot: LinearSlotRef;
  /** Whose call this is (spec §6.7): `request` for the legacy Check again, `floor` for the background refresher and
   *  the account-gated key acts. */
  lane: LinearRateLane;
  rate: LinearRateService;
  fetch?: FetchLike;
  timeoutMs?: number;
}

/**
 * The §4.1 key check of one slot's STORED key: one call taken from the slot's lane before the first page, one more
 * before the second (and only if Linear says there is one), each settled with what it spent, so a refusal of the
 * second page costs the first nothing and Linear's own rate limit closes the slot for the wait it gave. The key is
 * read from its file before each page (`readLinearSlotKey`); nothing here holds it.
 */
export async function checkLinearSlot(o: LinearSlotCheckOpts): Promise<LinearSlotCheck> {
  const first = o.rate.take({ lane: o.lane, slot: o.slot, calls: 1 });
  if (!first.ok) return { kind: 'refused', detail: first.detail, retryAfterS: first.retryAfterS };
  let second: LinearRateGrant | null = null;
  const check = await checkLinearKey(() => readLinearSlotKey(o.ccrcDir, o.slot), {
    fetch: o.fetch, timeoutMs: o.timeoutMs,
    mayAskMore: () => {
      const t = o.rate.take({ lane: o.lane, slot: o.slot, calls: 1 });
      if (t.ok) second = t.grant;
      return t.ok;
    },
  });
  const closeForS = !check.ok && check.reason === 'rate-limited' ? check.retryAfterS : null;
  o.rate.settle(first.grant, { spent: check.pagesSent >= 1 ? 1 : 0, closeForS: check.pagesSent === 1 ? closeForS : null });
  const late: LinearRateGrant | null = second;
  if (late !== null) o.rate.settle(late, { spent: check.pagesSent >= 2 ? 1 : 0, closeForS: check.pagesSent === 2 ? closeForS : null });
  return { kind: 'checked', check };
}

/** A slot's teams are refreshed when older than this, and no slot is refreshed twice inside it (spec §4.3). */
export const LINEAR_TEAMS_REFRESH_MS = 5 * 60_000;
/** The wait a `refreshing` miss tells the caller to retry after (spec §4.3: `Retry-After: 10`). */
export const LINEAR_MISS_RETRY_AFTER_S = 10;

/** What a routing miss tells the caller (spec §4.3): `refreshing` when a refresh that could cure it is queued or
 *  running (retry after `LINEAR_MISS_RETRY_AFTER_S`), `unknown` when every slot was refreshed inside the window. */
export type LinearMissDetail = 'refreshing' | 'unknown';

export interface LinearRefresherOpts {
  /** The config's ccrc dir (`cfg.ccrcDir`), where the slots live. */
  ccrcDir: string;
  /** The ONE rate service (spec §6.7): every page of every refresh is taken from the slot's floor first. */
  rate: LinearRateService;
  /** Test seams: the network, the deadline and the clock. Absent in production. */
  fetch?: FetchLike;
  timeoutMs?: number;
  now?: () => number;
}

type Listed = Extract<LinearStoreRead, { kind: 'listed' }>;

/** The legacy slot's own fixed key; a file slot's id is a UUID, so the two never meet. */
const slotKeyOf = (ref: LinearSlotRef): string => (ref.source === 'legacy' ? 'legacy' : `file:${ref.id}`);

export class LinearRefresher {
  private readonly queued = new Map<string, LinearSlotRef>();
  /** When each slot's last refresh (or Check again) started: the five-minute window is counted from here. */
  private readonly lastRun = new Map<string, number>();
  private running: string | null = null;
  /** True from the first enqueue until the queue is found empty, in the same turn as that finding, so a slot queued at
   *  any moment is either seen by the running pump or starts a new one. */
  private active = false;
  private pumped: Promise<void> = Promise.resolve();
  private readonly now: () => number;

  constructor(private readonly opts: LinearRefresherOpts) {
    this.now = opts.now ?? Date.now;
  }

  /**
   * A routing miss on `store` (the read the router routed against). Queues every slot whose teams are stale and whose
   * window is open, and answers at once, before any of them runs: never a promise, never a Linear call. The slots that
   * can cure a miss are every file slot and the legacy slot once learned and not superseded (a superseded one is never
   * routed, so refreshing it cures nothing).
   */
  miss(store: Listed): LinearMissDetail {
    const at = this.now();
    let refreshing = false;
    for (const { ref, teamsAt } of this.candidates(store)) {
      const key = slotKeyOf(ref);
      if (this.queued.has(key) || this.running === key) { refreshing = true; continue; }
      const stale = teamsAt === null || at - teamsAt > LINEAR_TEAMS_REFRESH_MS;
      const last = this.lastRun.get(key);
      if (stale && (last === undefined || at - last >= LINEAR_TEAMS_REFRESH_MS)) {
        this.enqueue(ref);
        refreshing = true;
      }
    }
    return refreshing ? 'refreshing' : 'unknown';
  }

  /** A check of `ref`'s key that ran outside the queue (the legacy Check again) counts as its refresh: the window
   *  starts again from now, so a miss straight after it does not ask Linear the same question. */
  checked(ref: LinearSlotRef): void {
    this.lastRun.set(slotKeyOf(ref), this.now());
  }

  /** Resolves once the queue is empty. For tests and an orderly shutdown; nothing in a request waits on it. */
  async idle(): Promise<void> {
    for (let p = this.pumped; ; p = this.pumped) {
      await p;
      if (p === this.pumped && !this.active) return;
    }
  }

  private candidates(store: Listed): Array<{ ref: LinearSlotRef; teamsAt: number | null }> {
    const out = store.slots.map((s) => {
      const current = s.key.kind === 'key' && s.record.kind === 'details' && s.record.details.keyDigest === s.key.digest
        ? s.record.details : null;
      return { ref: { source: 'file', id: s.id } as LinearSlotRef, teamsAt: current?.teamsAt ?? null };
    });
    const legacy = store.legacy;
    if (legacy !== null && legacy.workspace !== null && !legacy.superseded) {
      out.push({ ref: { source: 'legacy' }, teamsAt: legacy.workspace.teamsAt });
    }
    return out;
  }

  private enqueue(ref: LinearSlotRef): void {
    this.queued.set(slotKeyOf(ref), ref);
    if (this.active) return;
    this.active = true;
    this.pumped = this.pump();
  }

  /** One slot at a time, until the queue is empty. Starts after the caller's turn: the first await is before any work. */
  private async pump(): Promise<void> {
    await Promise.resolve();
    for (;;) {
      const next = this.queued.entries().next();
      if (next.done === true) { this.active = false; return; }
      const [key, ref] = next.value;
      this.queued.delete(key);
      this.running = key;
      this.lastRun.set(key, this.now());
      try {
        await this.refresh(ref);
      } catch {
        // Fixed words only: the error can carry a path, and nothing of a key or a digest is ever in a line.
        console.warn('ccrc-server: linear: a background refresh of a workspace failed');
      } finally {
        this.running = null;
      }
    }
  }

  /** The §4.1 check of one slot on its floor, recorded under the lock by the digest rule. The legacy slot's refresh
   *  writes only `legacy-teams.json`, never the pair; a file slot's records its outcome, and what an `ok` check learned
   *  of THIS workspace (an answer naming another workspace is no answer for this slot). */
  private async refresh(ref: LinearSlotRef): Promise<void> {
    const { ccrcDir } = this.opts;
    const checked = await checkLinearSlot({
      ccrcDir, slot: ref, lane: 'floor', rate: this.opts.rate, fetch: this.opts.fetch, timeoutMs: this.opts.timeoutMs,
    });
    if (checked.kind === 'refused') return;
    const v = checked.check;
    if (!v.ok && v.reason === 'key-changed') return;
    const at = this.now();
    if (ref.source === 'legacy') {
      const ws = v.ok ? v.workspace : null;
      if (ws !== null) {
        await writeLegacyTeams(ccrcDir, v.keyDigest, { workspaceId: ws.id, name: ws.name, urlKey: ws.urlKey, teams: ws.teams, teamsAt: at });
      }
      return;
    }
    if (!v.ok) {
      await recordLinearSlotCheck(ccrcDir, ref.id, v.keyDigest, checkOutcomeOf(v.reason), null, at);
      return;
    }
    const ws = v.workspace;
    if (ws !== null && ws.id !== ref.id) return;
    const learned = ws === null ? null : { name: ws.name, urlKey: ws.urlKey, user: v.user, teams: ws.teams, teamsAt: at };
    await recordLinearSlotCheck(ccrcDir, ref.id, v.keyDigest, 'ok', learned, at);
  }
}

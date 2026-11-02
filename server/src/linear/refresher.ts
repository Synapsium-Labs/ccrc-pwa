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
 * THE DIRECTORY TOO (spec §4.4, R5). The same queue fills each slot's directory of states, labels, projects and
 * active users (`directory.ts`), which it alone constructs and writes: a name the directory lacks for the request's key
 * queues it through `nameMiss`, and an add, a replace or a Check again through `queueDirectory`, 250 entries a page up
 * to 4 pages a collection, each page charged to the slot's `floor`. A miss queues nothing when a run was attempted for
 * that key inside ten minutes, counted from when the run started, whether it filled the directory, failed or was
 * refused: so the misses of an unfillable directory make at most one run in ten minutes, and session traffic cannot
 * spend the floor that the teams refresh and the operator's key acts share. No request ever fills it.
 *
 * NO KEY IS HELD. The queue holds slot references and times; each page of each refresh reads the key from its file
 * (`readLinearSlotKey`), so a key removed or replaced mid-refresh stops it at its next page, and it records nothing.
 */
import { valueDigestHex } from '../token/files.js';
import { callLinear, checkLinearKey, type FetchLike, type LinearKeyCheck } from './client.js';
import { LinearDirectory, type LinearDirectoryRead } from './directory.js';
import {
  LINEAR_DIRECTORY_COLLECTIONS, LINEAR_DIRECTORY_DOCUMENTS, LINEAR_DIRECTORY_MAX_PAGES, readLinearDirectoryPage,
  type LinearDirectoryEntries,
} from './ops.js';
import { oneCallOutcome, type LinearRateGrant, type LinearRateLane, type LinearRateRefusal, type LinearRateService } from './rate.js';
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
/** A slot's directory is refreshed at most once inside this window, whatever the number of name misses (spec §4.4). */
export const LINEAR_DIRECTORY_REFRESH_MS = 10 * 60_000;
/** The wait a `refreshing` miss tells the caller to retry after (spec §4.3, §4.4: `Retry-After: 10`). */
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

/** What the queue runs for a slot: its teams (the §4.1 check) or its directory (§4.4). */
type JobKind = 'teams' | 'directory';
interface Job { kind: JobKind; ref: LinearSlotRef }
const jobKeyOf = (kind: JobKind, ref: LinearSlotRef): string => `${kind}|${slotKeyOf(ref)}`;

export class LinearRefresher {
  private readonly queued = new Map<string, Job>();
  /** When each teams job's last run (or a slot's Check again) started: its five-minute window is counted from here.
   *  A directory's window is `attempted`'s, keyed by the key's digest, never this. */
  private readonly lastRun = new Map<string, number>();
  /** Each slot's last directory run: the digest of the key it read first and when it started, whatever it then filled.
   *  A name miss's ten-minute window is counted from here (spec §4.4). It holds a digest, never a key. */
  private readonly attempted = new Map<string, { keyDigest: string; at: number }>();
  /** The one directory (spec §4.4): this refresher is its only writer. */
  private readonly names = new LinearDirectory();
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
      const key = jobKeyOf('teams', ref);
      if (this.queued.has(key) || this.running === key) { refreshing = true; continue; }
      const stale = teamsAt === null || at - teamsAt > LINEAR_TEAMS_REFRESH_MS;
      const last = this.lastRun.get(key);
      if (stale && (last === undefined || at - last >= LINEAR_TEAMS_REFRESH_MS)) {
        this.enqueue({ kind: 'teams', ref });
        refreshing = true;
      }
    }
    return refreshing ? 'refreshing' : 'unknown';
  }

  /** A check of `ref`'s key that ran outside the queue (the legacy Check again) counts as its refresh: the window
   *  starts again from now, so a miss straight after it does not ask Linear the same question. */
  checked(ref: LinearSlotRef): void {
    this.lastRun.set(jobKeyOf('teams', ref), this.now());
  }

  /** The directory a request reads names from (spec §4.4): read-only to everyone but this refresher. */
  get directory(): LinearDirectoryRead {
    return this.names;
  }

  /**
   * A name the slot's directory does not hold for `keyDigest`, the digest of the key the request read (or a directory
   * not yet filled for it), spec §4.4. Answers at once, before anything runs: never a promise, never a Linear call.
   * `refreshing` (retry after `LINEAR_MISS_RETRY_AFTER_S`) when the slot's directory refresh is queued or running, or
   * when this miss queues one. `unknown`, queueing nothing, when a run was attempted for this digest inside the
   * ten-minute window (counted from when it started), or the directory was filled for it inside the window: at most
   * one run in ten minutes, whatever the number of misses, and a run that failed or was refused counts (an unfillable
   * directory would otherwise queue a run on every retry and spend the slot's floor). A replaced key has a new digest,
   * with no run attempted for it, so its miss queues at once; `queueDirectory` is the explicit way past the window.
   */
  nameMiss(ref: LinearSlotRef, keyDigest: string): LinearMissDetail {
    const key = jobKeyOf('directory', ref);
    if (this.queued.has(key) || this.running === key) return 'refreshing';
    const at = this.now();
    const tried = this.attempted.get(slotKeyOf(ref));
    if (tried !== undefined && tried.keyDigest === keyDigest && at - tried.at < LINEAR_DIRECTORY_REFRESH_MS) return 'unknown';
    const filledAt = this.names.filledAt(ref, keyDigest);
    if (filledAt !== null && at - filledAt < LINEAR_DIRECTORY_REFRESH_MS) return 'unknown';
    this.enqueue({ kind: 'directory', ref });
    return 'refreshing';
  }

  /**
   * An add, a replace or a Check again of `ref`'s key (spec §4.4): queues the slot's directory refresh past the
   * ten-minute window, once while one is queued. A refresh already running is not enough (it may be reading the key
   * that was just replaced, and it stops at its next page, recording nothing), so the one queued here runs after it.
   */
  queueDirectory(ref: LinearSlotRef): void {
    if (this.queued.has(jobKeyOf('directory', ref))) return;
    this.enqueue({ kind: 'directory', ref });
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

  private enqueue(job: Job): void {
    this.queued.set(jobKeyOf(job.kind, job.ref), job);
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
      const [key, job] = next.value;
      this.queued.delete(key);
      this.running = key;
      if (job.kind === 'teams') this.lastRun.set(key, this.now());
      try {
        if (job.kind === 'teams') await this.refresh(job.ref);
        else await this.refreshDirectory(job.ref);
      } catch {
        // Fixed words only: the error can carry a path, and nothing of a key or a digest is ever in a line.
        console.warn(job.kind === 'teams'
          ? 'ccrc-server: linear: a background refresh of a workspace failed'
          : 'ccrc-server: linear: a background refresh of a workspace directory failed');
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

  /**
   * One slot's directory (spec §4.4): each of the four collections, 250 entries a page up to 4 pages, each page taken
   * from the slot's floor and settled with what it spent. The key is read from its file before each page, and a key
   * gone or changed stops the refresh, recording nothing. Kept only whole: a page refused, failed or out of its grammar
   * leaves the directory as it was. Past the fourth page a collection is cut (a known limit; the remedy is the id).
   */
  private async refreshDirectory(ref: LinearSlotRef): Promise<void> {
    const { ccrcDir, rate } = this.opts;
    const entries: {
      viewerId: string | null;
      states: LinearDirectoryEntries['states'][number][];
      labels: LinearDirectoryEntries['labels'][number][];
      projects: LinearDirectoryEntries['projects'][number][];
      users: LinearDirectoryEntries['users'][number][];
    } = { viewerId: null, states: [], labels: [], projects: [], users: [] };
    let digest: string | null = null;
    const startedAt = this.now();
    for (const kind of LINEAR_DIRECTORY_COLLECTIONS) {
      let after: string | null = null;
      for (let page = 0; page < LINEAR_DIRECTORY_MAX_PAGES; page += 1) {
        const k = await readLinearSlotKey(ccrcDir, ref);
        if (k.kind !== 'key') return;
        const d = valueDigestHex(k.key);
        if (digest === null) {
          digest = d;
          // The attempt counts from the run's start, before the floor is asked: a refused run counts too.
          this.attempted.set(slotKeyOf(ref), { keyDigest: d, at: startedAt });
        } else if (d !== digest) return;
        const t = rate.take({ lane: 'floor', slot: ref, calls: 1 });
        if (!t.ok) return;
        const call = await callLinear(k.key, LINEAR_DIRECTORY_DOCUMENTS[kind], { after }, { fetch: this.opts.fetch, timeoutMs: this.opts.timeoutMs });
        rate.settle(t.grant, oneCallOutcome(call));
        if (!call.ok) return;
        const p = readLinearDirectoryPage(kind, call.body);
        if (!p.ok) return;
        entries.states.push(...p.states);
        entries.labels.push(...p.labels);
        entries.projects.push(...p.projects);
        entries.users.push(...p.users);
        if (kind === 'users' && entries.viewerId === null) entries.viewerId = p.viewerId;
        if (p.next === null) break;
        after = p.next;
      }
    }
    if (digest !== null) this.names.put(ref, digest, entries, this.now());
  }
}

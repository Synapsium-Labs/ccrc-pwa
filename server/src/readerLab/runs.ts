// The reader lab door's state (native Docs reader, the reader lab plan of 2026-11-03, Task 2; the reader lab design,
// section 4; the rich-docs spec's rows M10.2, M10.5, M10.6, M10.7). Ring L1: pure. No I/O, no timer, no fastify: the
// clock is an argument, and the nonce is minted by the route (`routes.ts`) and handed in. It holds at most
// READER_LAB_RUNS_MAX open runs, in process memory only, each for READER_LAB_RUN_TTL_MS from its opening, each counting
// at most READER_LAB_RUN_HITS_MAX requests. A call that looks drops the expired runs first; a restart forgets every run.
// A run answers only its owner, an opaque digest of the opening session that the route computes: another owner's read
// and close answer exactly as an unknown nonce's do. Counting asks no owner: a frame's request carries no session.
// What it keeps of a request is classes (`LabObservation`), never a value: no header text, no body, no address.
import {
  LAB_ORIGIN_CLASSES, LAB_PROBE_NAMES, LAB_RUN_CAPS_MS, LAB_SITE_CLASSES, isLabNonce, isLabProbeName,
  type LabOriginClass, type LabProbeName, type LabProbeTally, type LabRunView, type LabSiteClass,
} from '../../../shared/readerLab.js';

/** What a run's life adds to the lab run's own caps: the requests, the parses and a slow phone's own work. */
export const READER_LAB_RUN_SLACK_MS = 300_000;
/** How long a run stays open after it opened, derived from the lab run's own caps (`LAB_RUN_CAPS_MS`, every wait at its
 *  cap, about fifteen minutes) plus the slack: about twenty minutes. A run on a working phone takes about two. */
export const READER_LAB_RUN_TTL_MS = LAB_RUN_CAPS_MS + READER_LAB_RUN_SLACK_MS;
/** Runs open at once; opening one more evicts the oldest. */
export const READER_LAB_RUNS_MAX = 4;
/** Requests counted per run, every name included; a lab run sends about 150. Past it the run is saturated. */
export const READER_LAB_RUN_HITS_MAX = 1024;

/** What the door keeps of one request that names an open run. */
export interface LabObservation {
  /** The session cookie was present by name with a non-empty value; its value is never read past that test. */
  readonly cookie: boolean;
  /** A WebSocket upgrade. */
  readonly upgrade: boolean;
  readonly site: LabSiteClass;
  readonly origin: LabOriginClass;
}

/** What one count did. The probe's answer never depends on it; the tests read it. */
export type LabCountOutcome = 'counted' | 'ignored-name' | 'no-run' | 'saturated';

/** The four `Sec-Fetch-Site` values browsers send: the site classes but `absent` and `other`. */
const SENT_SITES: ReadonlySet<string> = new Set(LAB_SITE_CLASSES.filter((c) => c !== 'absent' && c !== 'other'));

/** `Sec-Fetch-Site` as a class. */
export function labSiteClass(header: unknown): LabSiteClass {
  if (header === undefined || header === '') return 'absent';
  if (typeof header !== 'string' || !SENT_SITES.has(header)) return 'other';
  return header as LabSiteClass;
}

/** `Origin` as a class: the opaque origin's literal `null`, `absent`, or `present` (its text is not kept). */
export function labOriginClass(header: unknown): LabOriginClass {
  if (header === undefined || header === '') return 'absent';
  return header === 'null' ? 'null' : 'present';
}

interface Tally {
  hits: number;
  cookie: number;
  upgrade: number;
  readonly site: Record<LabSiteClass, number>;
  readonly origin: Record<LabOriginClass, number>;
}

const zeros = <K extends string>(keys: readonly K[]): Record<K, number> =>
  Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
const emptyTally = (): Tally => ({ hits: 0, cookie: 0, upgrade: 0, site: zeros(LAB_SITE_CLASSES), origin: zeros(LAB_ORIGIN_CLASSES) });

interface Run {
  /** The opening session's digest, as the route computed it; never the session. */
  readonly owner: string;
  readonly openedAt: number;
  readonly expiresAt: number;
  counted: number;
  ignored: number;
  readonly tallies: Map<LabProbeName, Tally>;
}

export interface ReaderLabRuns {
  /** Opens a run under `nonce`, which the route minted, for `owner`, the opening session's digest. Throws a TypeError on
   *  a nonce of another shape: a defect, never a request's input. With READER_LAB_RUNS_MAX open, the oldest is evicted
   *  first, whoever opened it. */
  open(nonce: string, owner: string, now: number): void;
  /** Counts one request that names `nonce` and `name`. */
  count(nonce: string, name: string, o: LabObservation, now: number): LabCountOutcome;
  /** The run's counts, a fresh copy naming every probe; or null. Null has one meaning: no open run of `owner` carries
   *  that nonce (never opened, opened by another owner, closed, expired, evicted, or forgotten by a restart), so another
   *  owner's run reads exactly as an unknown nonce does. */
  read(nonce: string, owner: string, now: number): LabRunView | null;
  /** Closes the run; false when no run of `owner` was open under that nonce. */
  close(nonce: string, owner: string): boolean;
  /** How many runs are open at `now`. */
  openCount(now: number): number;
}

export function createReaderLabRuns(): ReaderLabRuns {
  const runs = new Map<string, Run>();
  const sweep = (now: number): void => {
    for (const [k, r] of runs) if (r.expiresAt <= now) runs.delete(k);
  };
  return {
    open(nonce, owner, now) {
      if (!isLabNonce(nonce)) throw new TypeError('reader lab: a run nonce is 22 base64url characters');
      sweep(now);
      while (runs.size >= READER_LAB_RUNS_MAX) {
        const oldest = runs.keys().next();
        if (oldest.done === true) break;
        runs.delete(oldest.value);
      }
      runs.set(nonce, { owner, openedAt: now, expiresAt: now + READER_LAB_RUN_TTL_MS, counted: 0, ignored: 0, tallies: new Map() });
    },
    count(nonce, name, o, now) {
      if (!isLabNonce(nonce)) return 'no-run';
      sweep(now);
      const run = runs.get(nonce);
      if (run === undefined) return 'no-run';
      if (run.counted >= READER_LAB_RUN_HITS_MAX) return 'saturated';
      run.counted += 1;
      if (!isLabProbeName(name)) {
        run.ignored += 1;
        return 'ignored-name';
      }
      let t = run.tallies.get(name);
      if (t === undefined) {
        t = emptyTally();
        run.tallies.set(name, t);
      }
      t.hits += 1;
      if (o.cookie) t.cookie += 1;
      if (o.upgrade) t.upgrade += 1;
      t.site[o.site] += 1;
      t.origin[o.origin] += 1;
      return 'counted';
    },
    read(nonce, owner, now) {
      if (!isLabNonce(nonce)) return null;
      sweep(now);
      const run = runs.get(nonce);
      if (run === undefined || run.owner !== owner) return null;
      const probes = Object.fromEntries(LAB_PROBE_NAMES.map((n): [LabProbeName, LabProbeTally] => {
        const t = run.tallies.get(n) ?? emptyTally();
        return [n, { hits: t.hits, cookie: t.cookie, upgrade: t.upgrade, site: { ...t.site }, origin: { ...t.origin } }];
      })) as Record<LabProbeName, LabProbeTally>;
      return {
        openedAt: run.openedAt, expiresAt: run.expiresAt, counted: run.counted, ignored: run.ignored,
        saturated: run.counted >= READER_LAB_RUN_HITS_MAX, probes,
      };
    },
    close(nonce, owner) {
      const run = runs.get(nonce);
      return run !== undefined && run.owner === owner && runs.delete(nonce);
    },
    openCount(now) {
      sweep(now);
      return runs.size;
    },
  };
}

// The server's two ways of getting one host reading, behind one port.
//
// WHICH BOX: the one the SESSIONS run on, always — the agent's box in remote
// mode, this box in local mode. That is the box whose CPU a wedged build eats
// and whose memory an OOM takes, so it is the only one the widget asks about.
// Nothing here can report on a second box, and that is deliberate rather than
// pending: a reading that might be about either box is worse than no reading.
//
// The ALGORITHM is not here — `shared/hoststat.ts` owns it, and both adapters
// below just give it a reader (local) or carry its answer across the wire
// (remote), so the two modes cannot produce different numbers from the same
// /proc text.
import {
  createHostSampler,
  hostStatFailed,
  type HostStat,
  type HostStatFailure,
} from '../../shared/hoststat.js';
import type { FleetIO } from './io.js';
import type { FleetClient } from './remote/client.js';

/** The port, declared by its consumer (`GET /api/host`): one question, one
 *  answer, never a throw — every failure is already a named `why` inside the
 *  reading. A route that has to try/catch a metrics call ends up inventing its
 *  own vocabulary for the catch arm, which is the second copy this avoids. */
export interface HostStatPort {
  read(): Promise<HostStat>;
}

/** How long a `hostStat` frame may take before the reading is reported as
 *  `timeout`. Deliberately well under the client's default 15s: this sits in
 *  front of a 6s PWA poll, and a widget that waits fifteen seconds to say
 *  nothing is worse than one that says `timeout` in four. */
export const HOST_REQUEST_TIMEOUT_MS = 4_000;

/** The route's cache window. Just under the PWA's poll so a lone client still
 *  gets a fresh reading every poll, while twenty clients on twenty phones still
 *  cost the fleet box one sample. */
export const HOST_CACHE_MS = 5_000;

/** Local mode: read this box's own `/proc` through the same `FleetIO` every
 *  other read goes through, so `absent`/`unreadable` mean here exactly what
 *  they mean everywhere else (`readFileMeasured`'s own vocabulary — the
 *  measured read exists precisely so this adapter does not have to fold the
 *  two into one null). */
export function localHostStat(io: FleetIO, procRoot?: string): HostStatPort {
  const sample = createHostSampler(
    {
      read: (p) => io.readFileMeasured(p),
      now: () => Date.now(),
      sleep: (ms) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }),
    },
    procRoot === undefined ? {} : { procRoot },
  );
  return { read: sample };
}

/** Shape-check an answer that came from ANOTHER BOX. Same posture as
 *  `FleetClient.caps()`: a frame from a version-skewed or buggy peer is data,
 *  not a promise, and a malformed one must degrade to a named failure rather
 *  than reach the PWA as a half-built reading. */
function isHostStat(v: unknown): v is HostStat {
  if (typeof v !== 'object' || v === null) return false;
  const { at, cpu, mem } = v as { at?: unknown; cpu?: unknown; mem?: unknown };
  if (typeof at !== 'number') return false;
  return isHalf(cpu, ['total', 'windowMs']) && isHalf(mem, ['totalKb', 'usedKb', 'cacheKb']);
}

function isHalf(v: unknown, numbers: readonly string[]): boolean {
  if (typeof v !== 'object' || v === null) return false;
  const half = v as Record<string, unknown>;
  if (half.ok === false) return typeof half.why === 'string';
  if (half.ok !== true) return false;
  return numbers.every((k) => typeof half[k] === 'number');
}

/** Why a request that never reached `/proc` produced nothing. Each arm is a
 *  different sentence and a different fix, so none of them may collapse into
 *  another: `bad-request` is what an agent's `validateReq` answers for an op it
 *  has never heard of, which is the AGENT-FIRST deploy lag and nothing else. */
function whyFrom(err: unknown): HostStatFailure {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg === 'timeout') return 'timeout';
  if (msg === 'bad-request' || msg === 'not-implemented') return 'unsupported';
  // 'disconnected', 'aborted' and anything the transport invents: the link,
  // not the box, is what failed.
  return 'offline';
}

/**
 * Remote mode: ask the fleet box for the reading it computed itself.
 *
 * `at` is RESTAMPED with this server's clock. The agent's stamp is honest about
 * the agent's clock, and the PWA compares `at` against its own clock to decide
 * "stale" — across two boxes whose clocks drift by a minute, that comparison is
 * what would lie, not the reading.
 */
export function remoteHostStat(client: FleetClient, timeoutMs = HOST_REQUEST_TIMEOUT_MS): HostStatPort {
  return {
    async read(): Promise<HostStat> {
      try {
        const res = await client.request({ t: 'req', op: 'hostStat' }, timeoutMs);
        const stat = (res as { stat?: unknown }).stat;
        if (!isHostStat(stat)) return hostStatFailed('unparsable', Date.now());
        return { ...stat, at: Date.now() };
      } catch (err) {
        return hostStatFailed(whyFrom(err), Date.now());
      }
    },
  };
}

/**
 * One reading per `ttlMs`, and one IN FLIGHT at a time.
 *
 * Both halves matter and for different reasons: the TTL bounds how often a
 * quiet fleet box is sampled at all, and the single-flight share is what keeps
 * ten clients polling at the same second from becoming ten agent round trips —
 * a cache alone would not, since they all miss it together.
 *
 * A failed reading is cached exactly like a good one: an offline agent
 * answering `offline` ten times a second is the same wasted work, and the
 * widget wants the failure to be as steady as the number it replaces.
 */
export function cachedHostStat(port: HostStatPort, ttlMs = HOST_CACHE_MS): HostStatPort {
  let at = 0;
  let last: HostStat | null = null;
  let inFlight: Promise<HostStat> | null = null;
  return {
    async read(): Promise<HostStat> {
      const now = Date.now();
      if (last !== null && now - at < ttlMs) return last;
      if (inFlight !== null) return inFlight;
      const run = port.read().then(
        (stat) => { last = stat; at = Date.now(); inFlight = null; return stat; },
        (err: unknown) => {
          // The port contract says never throw; a port that breaks it must not
          // wedge `inFlight` forever, and the reason it gives is the honest one
          // for "we asked and got nothing back".
          inFlight = null;
          const stat = hostStatFailed(whyFrom(err), Date.now());
          last = stat;
          at = Date.now();
          return stat;
        },
      );
      inFlight = run;
      return run;
    },
  };
}

import type { FleetSession } from '../../../shared/api';

const KEY = 'ccrc:seen:v1';

export type Acks = Record<string, number>;

/** The buckets that WANT a human. `working` and `idle` are never badged:
 *  nothing is being asked of you, and a badge that fires for ordinary progress
 *  is a badge you learn to ignore. */
const BADGED: ReadonlySet<FleetSession['bucket']> = new Set(['attention', 'done', 'cleanup']);

/**
 * Per-DEVICE, not per-fleet. ccrc has no user accounts and the server has no
 * notion of a viewer, so "seen" is a property of the person holding the phone —
 * storing it server-side would let the desktop mark the phone's badge read.
 */
export function loadAcks(): Acks {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown;
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Acks = {};
    for (const [k, v] of Object.entries(raw)) if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    return out;
  } catch {
    return {};
  }
}

function save(acks: Acks): Acks {
  try { localStorage.setItem(KEY, JSON.stringify(acks)); } catch { /* private mode / quota */ }
  return acks;
}

/** THE comparison. Every surface — bucket header counts, row badge, the bell —
 *  calls this one function; a second implementation is the drift it exists to
 *  end. */
export function isUnseen(s: FleetSession, acks: Acks): boolean {
  if (!BADGED.has(s.bucket)) return false;
  if (s.bucketSince === null) return false;
  return s.bucketSince > (acks[s.id] ?? 0);
}

export function ack(id: string, at: number): Acks {
  const acks = loadAcks();
  acks[id] = at;
  return save(acks);
}

export function ackAll(sessions: readonly FleetSession[], at: number): Acks {
  const acks = loadAcks();
  for (const s of sessions) acks[s.id] = at;
  return save(acks);
}

export function prune(live: ReadonlySet<string>): Acks {
  const acks = loadAcks();
  let changed = false;
  for (const id of Object.keys(acks)) if (!live.has(id)) { delete acks[id]; changed = true; }
  return changed ? save(acks) : acks;
}

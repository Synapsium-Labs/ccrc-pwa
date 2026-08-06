// The client half of the notification watermark. See `server/src/notifylog.ts`
// for the other half and the reasoning both sides share.
import type { CatchUp } from '../../../shared/api';

const KEY = 'ccrc:notify:v1';

export interface Mark {
  epoch: string;
  seq: number;
}

/**
 * Read this device's `{epoch, seq}` — ONE JSON value, for the same torn-write
 * reason the server writes one: a seq is meaningless without the lifetime of
 * the counter that produced it. Stored as two keys, a write interrupted between
 * them would leave a pair that looks valid and is not, and the client would
 * silently believe it had already seen notifications it never received.
 *
 * `null` means "no trustworthy mark" — a fresh install, a cleared store, or a
 * value that failed validation. Every one of those is answered the same way:
 * ask for a resync.
 */
export function loadMark(): Mark | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (raw === null || typeof raw !== 'object') return null;
    const { epoch, seq } = raw as { epoch?: unknown; seq?: unknown };
    if (typeof epoch !== 'string' || epoch === '') return null;
    if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) return null;
    return { epoch, seq };
  } catch {
    return null;
  }
}

export function saveMark(mark: Mark): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(mark));
  } catch {
    /* private mode / quota — the next catch-up resyncs, which is correct */
  }
}

/**
 * Fold a catch-up response into the stored mark and report what the client
 * should do with the events.
 *
 * `resync` is the server saying "I cannot prove you saw everything" — the epoch
 * moved, the client's seq predates what is still retained, or the client's seq
 * is somehow ahead of the server's. The answer is always the same and is the
 * conservative one: adopt the server's pair, and surface NOTHING
 * retroactively. A fabricated badge is worse than a missed one, and the fleet
 * snapshot arriving on the same connection already shows every session that
 * currently wants the operator — which is the only claim about the present that
 * anything here can honestly make.
 *
 * THE ADVANCE IS ONE-WAY AND HAPPENS HERE, at the moment of receipt. The mark
 * is durable (localStorage); the returned events are not — they go into
 * volatile store state and die with the tab. So the same events can never be
 * asked for again, and a caller that stores them without rendering them has
 * silently dropped them. Deliberate: a mark advanced only once something
 * confirmed it had DISPLAYED the events would need a second durable value and
 * an acknowledgement path, and nothing renders them yet to acknowledge
 * anything. Whoever renders them first should read this paragraph before
 * deciding it can defer them.
 */
export function applyCatchUp(r: CatchUp): CatchUp['events'] {
  saveMark({ epoch: r.epoch, seq: r.seq });
  return r.resync ? [] : r.events;
}

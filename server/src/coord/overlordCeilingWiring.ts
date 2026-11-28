// Gate step 10's two producers, built once in the composition root (Overlord W2, act rows A, Task A6's count reader; act
// catalogue A's question 3). Ring L4, context C5: it fills the runner's `actCount` and `ceilingLatch` ports
// (`overlordGateRun.ts`, declared by the runner, their consumer) from the ONE existing producer of each fact, and decides
// nothing: the counts are the act store's (`overlordActsStore.ts#actCountReader`), the standing latches the ladder store's read,
// and the raise the ladder's one writer (`overlordLadderRead.ts#raiseLatch`). Whether a latch is due is `ceilingLatchDue`'s (L1),
// asked by the runner.
//
// THE LOG. A refused raise warns one line in the server's form, as before; a raise that THROWS warns one line too, then
// rethrows, so the runner's swallow (`attempt`, by design: a latch is a brake, never the refusal) stays the one thing that
// decides what a throw does to the call.
import type { DatabaseSync } from 'node:sqlite';
import { actCountReader } from './overlordActsStore.js';
import { ACT_CEILING_LATCH } from './overlordActCeiling.js';
import { NOT_WIRED_ACT_COUNT, type ActCountReader, type CeilingLatchPorts } from './overlordGateRun.js';
import type { LadderRowsRead, LadderWrite } from './overlordLadderStore.js';
import type { SessionCaller } from '../auth/callerIdentity.js';

/** Step 10's count: the act store's reader over the open database, or the stated default where no store is open. */
export function actCountPort(coord: { readonly db: DatabaseSync } | undefined): ActCountReader {
  return coord === undefined ? NOT_WIRED_ACT_COUNT : actCountReader(coord.db);
}

export interface CeilingLatchWiring {
  /** The ladder store's rows (`CoordStore.ladderRows`), or `undefined` where no store is open. */
  readonly rows: () => LadderRowsRead | undefined;
  /** The ladder's one writer, bound to its journal, clock and entropy; `undefined` where no store is open. */
  readonly raise: ((detail: string, actor: SessionCaller['actor']) => LadderWrite) | undefined;
  readonly warn: (line: string) => void;
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The ceiling-hit latch's two ports: whether one stands (`unmeasured` when the rows cannot be read), and its raise. */
export function ceilingLatchPorts(w: CeilingLatchWiring): CeilingLatchPorts {
  return {
    standing: () => {
      const r = w.rows();
      return r === undefined || r.kind === 'unmeasured' ? 'unmeasured' : r.standing.some((l) => l.cause === ACT_CEILING_LATCH);
    },
    raise: (detail, actor) => {
      if (w.raise === undefined) return;
      let r: LadderWrite;
      try { r = w.raise(detail, actor); } catch (e) {
        w.warn(`ccrc-server: act-ceiling-hit latch raise threw: ${errText(e)}`);
        throw e;
      }
      if (!r.ok) w.warn(`ccrc-server: act-ceiling-hit latch not raised: ${'error' in r ? r.error : r.reason}`);
    },
  };
}

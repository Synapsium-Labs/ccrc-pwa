// L4 delivery, context C3 (Session Conversation): the console's prompt route's two hand-offs (Overlord spec §3.3.9 C50,
// §3.3.11 "Before the message record exists"; W1a, the hand-offs piece, plan `w1a-renewal-handoffs.md` Tasks 2 and 3). It
// reads the store and writes the mark; what the rows mean is decided in L1 (`promptRenewing`, `markProgrammesOf`), so the
// route in `server.ts` only asks and acts.
import type { CoordStore } from '../coord/store.js';
import type { GenerationState } from '../../../shared/continuity.js';
import { markProgrammesOf } from './operatorMark.js';
import { sessionLiveGeneration } from './continuityStore.js';

/** The store members the hand-offs read and write, declared by this consumer. */
export type PromptHandoffsCoord = Pick<CoordStore, 'liveGenerations' | 'bindingsOf' | 'putOperatorMark'>;

/** The session's live generation's `state` (never `shadowState`: ruling R1), or null when it has none. A read that fails is
 *  null too: the route then types as it did before this piece, the only behaviour it had, rather than refusing every prompt
 *  while a table cannot be read. */
export function liveStateOf(coord: PromptHandoffsCoord, sessionId: string): GenerationState | null {
  const gens = coord.liveGenerations();
  if (!gens.ok) return null;
  return sessionLiveGeneration(gens.rows, sessionId)?.state ?? null;
}

/** After a prompt was typed: the mark of every programme the session coordinates or serves moves to `now` (the route owns
 *  `at`; the generations lane owns its `quiet`). A session with no programme writes none, and one whose runs could not be read
 *  writes none and says so: a mark is never written from a guess. */
export function markOperatorPrompt(coord: PromptHandoffsCoord, sessionId: string, now: number, log: (line: string) => void): number {
  let programmes: readonly string[] | 'unmeasured';
  try {
    const b = coord.bindingsOf(sessionId);
    programmes = markProgrammesOf(b.claimant(), b.worker());
  } catch { programmes = 'unmeasured'; }
  if (programmes === 'unmeasured') {
    log(`ccrc-server: prompt ${sessionId}: its runs could not be read, so no operator-at-programme mark was written`);
    return 0;
  }
  let wrote = 0;
  for (const p of programmes) {
    if (coord.putOperatorMark(p, now).ok) wrote += 1;
    else log(`ccrc-server: prompt ${sessionId}: the operator-at-programme mark of ${p} could not be written`);
  }
  return wrote;
}

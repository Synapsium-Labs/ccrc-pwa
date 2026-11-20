// Where a programme is on its flow (Flows wave 3a, plan `2026-11-20-flows-w3a.md`). Ring: L1, context Coordination (C5):
// pure. Protocol blocks are observations (spec §5): each stands for a fact the run machine already reports, so a position
// is derived from the programme's newest work run and whether a review run is open, on every read, and stored nowhere.
// The blocks before `open-wave` and the instruction blocks between protocol steps are not observable until the outcome
// door (wave 3b); this answers "no block" with the reason rather than guessing.
import type { RunState } from '../../../shared/api.js';
import type { FlowDoc, FlowParse, FlowPosition, ProtocolStep } from '../../../shared/flows.js';

export interface ProgrammeRunFacts {
  /** `programs.state`. */
  programmeState: string;
  /** The programme's newest work run, or null for none yet. */
  work: { id: number; state: RunState; wave: number; waveOf: number } | null;
  /** Whether a review run of this programme is open. */
  reviewOpen: boolean;
}

const stepBlock = (doc: FlowDoc, step: ProtocolStep): string | null =>
  doc.blocks.find((b) => b.kind === 'protocol' && b.step === step)?.id ?? null;

/** The block the `dispatch` step's `dispatched` edge leads to; the dispatch block itself when that edge is missing. */
function building(doc: FlowDoc): string | null {
  const dispatch = stepBlock(doc, 'dispatch');
  const edge = doc.edges.find((e) => e.from === dispatch && e.outcome === 'dispatched');
  return edge && doc.blocks.some((b) => b.id === edge.to) ? edge.to : dispatch;
}

export function flowPositionOf(doc: FlowParse | null, facts: ProgrammeRunFacts): FlowPosition {
  if (doc === null) return { blockId: null, why: 'the pinned version cannot be read' };
  if (!doc.ok) return { blockId: null, why: `the pinned version cannot be read: ${doc.reason}` };
  const d = doc.doc;
  if (facts.programmeState === 'done' || facts.programmeState === 'abandoned') {
    return { blockId: stepBlock(d, 'end'), why: `the programme is ${facts.programmeState}` };
  }
  const w = facts.work;
  if (w === null) return { blockId: null, why: 'before the first wave' };
  const why = `run ${w.id} ${w.state === 'failed' ? 'failed' : `is ${w.state}`} (wave ${w.wave} of ${w.waveOf})`;
  if (facts.reviewOpen) return { blockId: stepBlock(d, 'review'), why: `${why}; its review run is open` };
  switch (w.state) {
    case 'planned': return { blockId: stepBlock(d, 'open-wave'), why };
    case 'dispatched': case 'working': case 'unknown': return { blockId: building(d), why };
    case 'awaiting-review': return { blockId: stepBlock(d, 'review'), why };
    case 'merging': case 'closing': return { blockId: stepBlock(d, 'close-wave'), why };
    case 'done': return { blockId: stepBlock(d, w.wave >= w.waveOf ? 'end' : 'close-wave'), why };
    case 'failed': return { blockId: null, why };
  }
}

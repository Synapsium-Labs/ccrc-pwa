// The Flows editor's edits and reads (flows design 2026-11-19 §9). Ring L1: pure, no store, no DOM. Every edit takes a
// document and answers a new one; the screen keeps the draft and saves it. None decides what is publishable: that is
// `shared/flows.ts#validateFlow`, which the screen runs on every edit.
import { BLOCK_KINDS, PROTOCOL, type BlockKind, type FlowBlock, type FlowDoc, type FlowEdge, type FlowRole } from '../../../shared/flows';

/** The words a block's kind is shown with. */
export const KIND_WORD: Readonly<Record<BlockKind, string>> = {
  instruction: 'Instruction', skill: 'Skill', gate: 'Gate', protocol: 'Protocol',
};
/** The kinds the operator may give a block; a protocol block is ccrc's and is never made or unmade here. */
export const EDITABLE_KINDS: readonly BlockKind[] = BLOCK_KINDS.filter((k) => k !== 'protocol');

/** The blocks in the order a reader walks them: breadth first from the start, outcomes in their order, then anything
 *  nothing reaches (so an unreachable block is still listed, where its problem can be read). */
export function outlineOrder(doc: FlowDoc): FlowBlock[] {
  const byId = new Map(doc.blocks.map((b) => [b.id, b]));
  const seen = new Set<string>();
  const out: FlowBlock[] = [];
  const queue = [doc.start];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const b = byId.get(id);
    if (b === undefined || seen.has(id)) continue;
    seen.add(id);
    out.push(b);
    for (const o of b.outcomes) {
      const e = doc.edges.find((x) => x.from === id && x.outcome === o);
      if (e !== undefined) queue.push(e.to);
    }
  }
  for (const b of doc.blocks) if (!seen.has(b.id)) out.push(b);
  return out;
}

/** Where `block`'s `outcome` leads, or undefined. */
export const targetOf = (doc: FlowDoc, block: string, outcome: string): string | undefined =>
  doc.edges.find((e) => e.from === block && e.outcome === outcome)?.to;

/** A fresh id: the title's words, made unique with a number. */
export function freshId(doc: FlowDoc, title: string): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'step';
  const taken = new Set(doc.blocks.map((b) => b.id));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** Changes one block's fields. A protocol block keeps everything but its place. */
export function setBlock(doc: FlowDoc, id: string, patch: Partial<Pick<FlowBlock, 'title' | 'role' | 'prompt' | 'skill' | 'gate' | 'kind'>>): FlowDoc {
  return {
    ...doc,
    blocks: doc.blocks.map((b) => {
      if (b.id !== id || b.kind === 'protocol') return b;
      const next: FlowBlock = { ...b, ...patch };
      if (next.kind !== 'gate') delete next.gate;
      if (next.kind === 'gate' && next.gate === undefined) next.gate = { kind: 'approval' };
      if (next.kind === 'gate' && next.gate?.kind === 'approval') next.role = 'operator';
      if (next.kind !== 'skill') delete next.skill;
      for (const k of ['prompt', 'skill'] as const) if (next[k] === '') delete next[k];
      return next;
    }),
  };
}

/** Points `block`'s `outcome` at `to`. */
export function setTarget(doc: FlowDoc, block: string, outcome: string, to: string): FlowDoc {
  const edges = doc.edges.filter((e) => !(e.from === block && e.outcome === outcome));
  return { ...doc, edges: [...edges, { from: block, outcome, to }] };
}

/** Adds an outcome to a non-protocol block, leading nowhere until the operator points it. */
export function addOutcome(doc: FlowDoc, block: string, outcome: string): FlowDoc {
  return {
    ...doc,
    blocks: doc.blocks.map((b) => (b.id === block && b.kind !== 'protocol' && !b.outcomes.includes(outcome)
      ? { ...b, outcomes: [...b.outcomes, outcome] } : b)),
  };
}

/** Removes an outcome of a non-protocol block, and its arrow. */
export function removeOutcome(doc: FlowDoc, block: string, outcome: string): FlowDoc {
  const b = doc.blocks.find((x) => x.id === block);
  if (b === undefined || b.kind === 'protocol') return doc;
  return {
    ...doc,
    blocks: doc.blocks.map((x) => (x.id === block ? { ...x, outcomes: x.outcomes.filter((o) => o !== outcome) } : x)),
    edges: doc.edges.filter((e) => !(e.from === block && e.outcome === outcome)),
  };
}

/** Adds an instruction step on `after`'s first outcome: the new step takes that arrow, and answers `done` to where it
 *  led. It sits below `after` on the canvas. An `end` block, with no outcome, takes nothing after it. */
export function addStepAfter(doc: FlowDoc, after: string, role: FlowRole = 'worker'): { doc: FlowDoc; id: string } | null {
  const a = doc.blocks.find((b) => b.id === after);
  const outcome = a?.outcomes[0];
  if (a === undefined || outcome === undefined) return null;
  const id = freshId(doc, 'New step');
  const to = targetOf(doc, after, outcome);
  const block: FlowBlock = { id, kind: 'instruction', title: 'New step', role, outcomes: ['done'], at: { x: a.at.x, y: a.at.y + 120 } };
  const edges: FlowEdge[] = doc.edges.filter((e) => !(e.from === after && e.outcome === outcome));
  edges.push({ from: after, outcome, to: id });
  if (to !== undefined) edges.push({ from: id, outcome: 'done', to });
  return { doc: { ...doc, blocks: [...doc.blocks, block], edges }, id };
}

/** Removes a non-protocol step: every arrow into it goes where its first outcome led. Never the start, never a protocol
 *  block (rule 3 needs every protocol step). */
export function removeStep(doc: FlowDoc, id: string): FlowDoc {
  const b = doc.blocks.find((x) => x.id === id);
  if (b === undefined || b.kind === 'protocol' || doc.start === id) return doc;
  const first = b.outcomes[0];
  const onward = first === undefined ? undefined : targetOf(doc, id, first);
  const edges = doc.edges
    .filter((e) => e.from !== id)
    .flatMap((e) => (e.to !== id ? [e] : onward !== undefined && onward !== id ? [{ ...e, to: onward }] : []));
  return { ...doc, blocks: doc.blocks.filter((x) => x.id !== id), edges };
}

/** A protocol block's description, for the inspector's locked note. */
export const protocolNote = (b: FlowBlock): string =>
  b.step === undefined ? '' : `ccrc's own step: ${PROTOCOL[b.step].title.toLowerCase()}. It can be moved, never edited or removed.`;

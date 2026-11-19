// Flows (spec 2026-11-19, flows design §4): the vocabulary of a flow document, the shape check a read
// runs, and the rules a publish runs.
//
// Ring: L0/L1, context Coordination (C5). The server (store, routes) and the PWA (the Flows screen) both read
// this file, so it is pure: its one import is a sibling's type, never `node:*`.
//
// TWO CHECKS, TWO MOMENTS. `parseFlowDoc` checks SHAPE and runs on every read: a stored document it
// cannot read is `unreadable`, never absent. `validateFlow` checks POLICY and runs at publish only, so a
// later tightening of the rules never turns a version published under the old ones unreadable (§7).

import type { FleetRole } from './fleetRoles.js';

/** What a block is. A `protocol` block is ccrc's fleet protocol: placed, never edited (§4 rule 4). */
export type BlockKind = 'instruction' | 'skill' | 'gate' | 'protocol';
const BLOCK_KIND_MAP: Record<BlockKind, true> = { instruction: true, skill: true, gate: true, protocol: true };
export const BLOCK_KINDS = Object.keys(BLOCK_KIND_MAP) as readonly BlockKind[];

/** Whose block it is: one of the fleet's three programme roles (`FleetRole`, the one role vocabulary), or the
 *  operator, who is no fleet session and answers only gates. */
export type FlowRole = Extract<FleetRole, 'coordinator' | 'worker' | 'reviewer'> | 'operator';
const FLOW_ROLE_MAP: Record<FlowRole, true> = { coordinator: true, worker: true, reviewer: true, operator: true };
export const FLOW_ROLES = Object.keys(FLOW_ROLE_MAP) as readonly FlowRole[];

/** The closed gate catalogue (§5). `attested` is a session's word with evidence: the server never runs
 *  a command on the fleet, so "a command passes" can only be attested, never measured. */
export type GateKind = 'approval' | 'pr-state' | 'attested';
const GATE_KIND_MAP: Record<GateKind, true> = { approval: true, 'pr-state': true, attested: true };
export const GATE_KINDS = Object.keys(GATE_KIND_MAP) as readonly GateKind[];

export type GatePrState = 'open' | 'merged';
const GATE_PR_STATE_MAP: Record<GatePrState, true> = { open: true, merged: true };
export const GATE_PR_STATES = Object.keys(GATE_PR_STATE_MAP) as readonly GatePrState[];

/** The wave skeleton (§4's table). `rank` is the step's phase; `outcomes` are exactly the answers the
 *  run machine's fact can give, so wave 3 maps names and never invents them. */
export type ProtocolStep = 'open-wave' | 'dispatch' | 'verify' | 'review' | 'close-wave' | 'end';
export const PROTOCOL: Record<ProtocolStep, { rank: number; outcomes: readonly string[]; title: string }> = {
  'open-wave': { rank: 1, outcomes: ['opened'], title: 'Open the wave' },
  dispatch: { rank: 2, outcomes: ['dispatched'], title: 'Dispatch the wave' },
  'verify': { rank: 3, outcomes: ['verified'], title: 'Wave done, re-measured' },
  review: { rank: 4, outcomes: ['clean', 'findings'], title: 'Review run' },
  'close-wave': { rank: 5, outcomes: ['next-wave', 'last'], title: 'Close the wave' },
  end: { rank: 6, outcomes: [], title: 'Programme ends' },
};
export const PROTOCOL_STEPS = Object.keys(PROTOCOL) as readonly ProtocolStep[];
/** Use THIS, never `PROTOCOL_STEPS.includes(x as ProtocolStep)`. */
export function isProtocolStep(v: unknown): v is ProtocolStep {
  return typeof v === 'string' && (PROTOCOL_STEPS as readonly string[]).includes(v);
}

/** The only `{{var}}` names a prompt may use (§4 rule 6). */
export type FlowVar = 'plan.path' | 'wave.tasks' | 'run.id' | 'programme.slug' | 'review.report';
const FLOW_VAR_MAP: Record<FlowVar, true> = {
  'plan.path': true, 'wave.tasks': true, 'run.id': true, 'programme.slug': true, 'review.report': true,
};
export const FLOW_VARS = Object.keys(FLOW_VAR_MAP) as readonly FlowVar[];

export const FLOW_SCHEMA = 1;
/** `fileBytes`: a shared flow file's cap, checked on its UTF-8 bytes before it is parsed (§14.1); 60 prompts at their cap fit,
 *  and it stays under the server's 1 MiB request body. */
export const FLOW_LIMITS = { blocks: 60, prompt: 4000, title: 80, outcome: 40, fileBytes: 786432 } as const;
const ID_RE = /^[a-z0-9-]{1,40}$/;
const OUTCOME_RE = /^[a-z0-9-]{1,40}$/;
const VAR_RE = /\{\{\s*([^}]*?)\s*\}\}/g;

export interface FlowBlock {
  id: string;
  kind: BlockKind;
  title: string;
  role: FlowRole;
  prompt?: string;
  skill?: string;
  gate?: { kind: GateKind; prState?: GatePrState };
  step?: ProtocolStep;
  outcomes: string[];
  at: { x: number; y: number };
}
export interface FlowEdge { from: string; outcome: string; to: string }
export interface FlowDoc { schema: 1; title: string; start: string; blocks: FlowBlock[]; edges: FlowEdge[] }

/** The shape check. Every field is read once here; a caller never re-checks a parsed doc's shape. */
export type FlowParse = { ok: true; doc: FlowDoc } | { ok: false; reason: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Membership by `includes`, never `in`: `'toString' in` any object literal is true. */
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function parseBlock(v: unknown, i: number): FlowBlock | string {
  if (!isObj(v)) return `block ${i} is not an object`;
  const { id, kind, title, role, prompt, skill, gate, step, outcomes, at } = v;
  if (!isStr(id)) return `block ${i} has no id`;
  if (!oneOf(BLOCK_KINDS, kind)) return `block ${id} has an unknown kind`;
  if (!isStr(title)) return `block ${id} has no title`;
  if (!oneOf(FLOW_ROLES, role)) return `block ${id} has an unknown role`;
  if (prompt !== undefined && !isStr(prompt)) return `block ${id}'s prompt is not text`;
  if (skill !== undefined && !isStr(skill)) return `block ${id}'s skill is not text`;
  if (step !== undefined && !isProtocolStep(step)) return `block ${id} has an unknown protocol step`;
  if (!Array.isArray(outcomes) || !outcomes.every(isStr)) return `block ${id}'s outcomes are not a list of names`;
  if (!isObj(at) || !isNum(at.x) || !isNum(at.y)) return `block ${id} has no position`;
  let g: FlowBlock['gate'];
  if (gate !== undefined) {
    if (!isObj(gate) || !oneOf(GATE_KINDS, gate.kind)) return `block ${id} has an unknown gate`;
    if (gate.prState !== undefined && !oneOf(GATE_PR_STATES, gate.prState)) {
      return `block ${id} has an unknown PR state`;
    }
    g = { kind: gate.kind, ...(gate.prState !== undefined ? { prState: gate.prState } : {}) };
  }
  return {
    id, kind, title, role,
    ...(prompt !== undefined ? { prompt } : {}),
    ...(skill !== undefined ? { skill } : {}),
    ...(g !== undefined ? { gate: g } : {}),
    ...(step !== undefined ? { step } : {}),
    outcomes: [...outcomes], at: { x: at.x, y: at.y },
  };
}

export function parseFlowDoc(v: unknown): FlowParse {
  if (!isObj(v)) return { ok: false, reason: 'not an object' };
  if (v.schema !== FLOW_SCHEMA) return { ok: false, reason: `unknown schema ${String(v.schema)}` };
  if (!isStr(v.title) || !isStr(v.start)) return { ok: false, reason: 'no title or start' };
  if (!Array.isArray(v.blocks) || !Array.isArray(v.edges)) return { ok: false, reason: 'no blocks or edges' };
  const blocks: FlowBlock[] = [];
  for (const [i, raw] of v.blocks.entries()) {
    const b = parseBlock(raw, i);
    if (typeof b === 'string') return { ok: false, reason: b };
    blocks.push(b);
  }
  const edges: FlowEdge[] = [];
  for (const [i, e] of v.edges.entries()) {
    if (!isObj(e) || !isStr(e.from) || !isStr(e.outcome) || !isStr(e.to)) return { ok: false, reason: `edge ${i} is malformed` };
    edges.push({ from: e.from, outcome: e.outcome, to: e.to });
  }
  return { ok: true, doc: { schema: FLOW_SCHEMA, title: v.title, start: v.start, blocks, edges } };
}

/** The one serialisation a stored document has: the parser's field order, so two equal documents are equal text
 *  (publish compares the stored draft with the document it validated). A doc the parser refuses keeps its own text. */
export function canonicalFlowJson(doc: FlowDoc): string {
  const p = parseFlowDoc(JSON.parse(JSON.stringify(doc)));
  return JSON.stringify(p.ok ? p.doc : doc);
}

/** A shared flow file (§14.1): one published version, canonical, with where it came from. Only a published version is
 *  exported, so only a document that passed the validator leaves. `exportedFrom` is set aside on import. */
export function flowExportJson(doc: FlowDoc, version: number): string {
  return JSON.stringify({ ...JSON.parse(canonicalFlowJson(doc)), exportedFrom: { title: doc.title, version } }, null, 2);
}

/** A shared flow file's text, read as untrusted input (§14.1): the byte cap first, then JSON, then the shape check every
 *  read runs. Its rules are the caller's to check, with `validateFlow`, as for any draft. */
export function readFlowFile(text: string): FlowParse {
  if (new TextEncoder().encode(text).length > FLOW_LIMITS.fileBytes) return { ok: false, reason: `the file is over ${FLOW_LIMITS.fileBytes} bytes` };
  let v: unknown;
  try { v = JSON.parse(text); } catch { return { ok: false, reason: 'the file is not JSON' }; }
  return parseFlowDoc(v);
}

/** One broken rule, with what it names so the editor can point at it. */
export interface FlowProblem { rule: number; message: string; block?: string; edge?: FlowEdge }

/** The phase of every block (§4): a protocol block's is its rank; any other's is the lowest phase among
 *  the blocks with an edge into it, 0 for `start`. A block nothing reaches has none. */
export function flowPhases(doc: FlowDoc): Map<string, number> {
  const byId = new Map(doc.blocks.map((b) => [b.id, b]));
  const phase = new Map<string, number>();
  for (const b of doc.blocks) if (b.kind === 'protocol' && b.step) phase.set(b.id, PROTOCOL[b.step].rank);
  const startBlock = byId.get(doc.start);
  if (startBlock && !phase.has(startBlock.id)) phase.set(startBlock.id, 0);
  // A fixpoint over at most `blocks` rounds: phases only fall, and there are seven of them.
  for (let round = 0, changed = true; changed && round <= doc.blocks.length; round++) {
    changed = false;
    for (const e of doc.edges) {
      const from = phase.get(e.from);
      const to = byId.get(e.to);
      if (from === undefined || !to || to.kind === 'protocol') continue;
      const cur = phase.get(to.id);
      if (cur === undefined || from < cur) { phase.set(to.id, from); changed = true; }
    }
  }
  return phase;
}

/** The block a dispatch's brief comes from (wave 2): for a work run, the block the `dispatch` step's `dispatched`
 *  edge leads to, when it carries a prompt (an instruction or a skill). A review is the protocol's own step, so it
 *  composes nothing. */
export function briefBlockFor(doc: FlowDoc, kind: 'work' | 'review'): FlowBlock | null {
  if (kind !== 'work') return null;
  const dispatch = doc.blocks.find((b) => b.kind === 'protocol' && b.step === 'dispatch');
  const edge = dispatch && doc.edges.find((e) => e.from === dispatch.id && e.outcome === 'dispatched');
  const to = edge && doc.blocks.find((b) => b.id === edge.to);
  return to && (to.kind === 'instruction' || to.kind === 'skill') ? to : null;
}

/** A block's prompt with its variables filled. A variable with no value stays as written and is listed in
 *  `missing`, never blanked, so a shadow comparison shows what the server could not fill. */
export function renderFlowPrompt(block: FlowBlock, vars: Partial<Record<FlowVar, string>>): { text: string; missing: FlowVar[] } {
  const missing = new Set<FlowVar>();
  const body = (block.prompt ?? '').replace(VAR_RE, (whole, name: string) => {
    if (!oneOf(FLOW_VARS, name)) return whole;
    const v = vars[name];
    if (v === undefined) { missing.add(name); return whole; }
    return v;
  });
  const text = block.kind === 'skill' ? `Run the ${block.skill ?? ''} skill.${body ? `\n\n${body}` : ''}` : body;
  return { text, missing: [...missing] };
}

function reachable(doc: FlowDoc): Set<string> {
  const seen = new Set<string>();
  const stack = [doc.start];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of doc.edges) if (e.from === id) stack.push(e.to);
  }
  return seen;
}

/** The publish rules (§4). An empty list is a publishable flow. */
export function validateFlow(doc: FlowDoc): FlowProblem[] {
  const out: FlowProblem[] = [];
  const add = (rule: number, message: string, at: { block?: string; edge?: FlowEdge } = {}): void => {
    out.push({ rule, message, ...at });
  };
  const byId = new Map<string, FlowBlock>();
  for (const b of doc.blocks) {
    if (!ID_RE.test(b.id)) add(1, `"${b.id}" is not a block id (a-z, 0-9 and -, up to 40)`, { block: b.id });
    if (byId.has(b.id)) add(1, `two blocks share the id "${b.id}"`, { block: b.id });
    byId.set(b.id, b);
  }

  // Rule 7: sizes.
  if (doc.blocks.length > FLOW_LIMITS.blocks) add(7, `a flow holds at most ${FLOW_LIMITS.blocks} blocks`);
  if (doc.title.trim() === '' || doc.title.length > FLOW_LIMITS.title) add(7, `the flow's title needs 1 to ${FLOW_LIMITS.title} characters`);
  for (const b of doc.blocks) {
    if (b.title.trim() === '' || b.title.length > FLOW_LIMITS.title) add(7, `a block's title needs 1 to ${FLOW_LIMITS.title} characters`, { block: b.id });
    if ((b.prompt ?? '').length > FLOW_LIMITS.prompt) add(7, `a prompt holds at most ${FLOW_LIMITS.prompt} characters`, { block: b.id });
  }

  // Rule 1: a start, and every block reachable from it.
  const startBlock = byId.get(doc.start);
  if (!startBlock) add(1, `the start "${doc.start}" is not a block`);
  else {
    if (startBlock.kind === 'protocol' && startBlock.step !== 'open-wave') {
      add(1, `a flow starts before its first wave or at "${PROTOCOL['open-wave'].title}"`, { block: startBlock.id });
    }
    const seen = reachable(doc);
    for (const b of doc.blocks) if (!seen.has(b.id)) add(1, `nothing leads to "${b.title}"`, { block: b.id });
  }

  // Rules 4, 5 and 6: what each kind may carry.
  for (const b of doc.blocks) {
    const names = new Set<string>();
    for (const o of b.outcomes) {
      if (!OUTCOME_RE.test(o)) add(2, `"${o}" is not an outcome name`, { block: b.id });
      if (names.has(o)) add(2, `"${b.title}" names the outcome "${o}" twice`, { block: b.id });
      names.add(o);
    }
    if (b.kind === 'protocol') {
      if (!b.step) { add(4, `"${b.title}" is a protocol block with no step`, { block: b.id }); continue; }
      if (b.prompt !== undefined || b.skill !== undefined || b.gate !== undefined) {
        add(4, `the protocol block "${b.title}" carries a prompt, skill or gate`, { block: b.id });
      }
      const want = PROTOCOL[b.step].outcomes;
      if (b.outcomes.length !== want.length || want.some((o) => !names.has(o))) {
        add(4, `"${b.title}" must answer exactly: ${want.join(', ') || 'nothing'}`, { block: b.id });
      }
      continue;
    }
    if (b.step !== undefined) add(4, `only a protocol block names a protocol step`, { block: b.id });
    if (b.outcomes.length === 0) add(2, `"${b.title}" has no outcome, so the flow stops there`, { block: b.id });
    if (b.kind === 'gate') {
      if (!b.gate) add(5, `the gate "${b.title}" names no check`, { block: b.id });
      else {
        if (b.gate.kind === 'pr-state' && !b.gate.prState) add(5, `the PR gate "${b.title}" names no PR state`, { block: b.id });
        if (b.gate.kind === 'approval' && b.role !== 'operator') add(5, `an approval gate is the operator's`, { block: b.id });
      }
    } else if (b.gate !== undefined) add(5, `only a gate block names a check`, { block: b.id });
    if (b.kind === 'skill' && !(b.skill ?? '').trim()) add(5, `the skill block "${b.title}" names no skill`, { block: b.id });
    for (const m of (b.prompt ?? '').matchAll(VAR_RE)) {
      if (!oneOf(FLOW_VARS, m[1])) add(6, `{{${m[1]}}} is not a flow variable (${FLOW_VARS.join(', ')})`, { block: b.id });
    }
  }

  // Rule 2: edges join real blocks on real outcomes, one edge per outcome, every outcome led somewhere.
  const taken = new Set<string>();
  for (const e of doc.edges) {
    const from = byId.get(e.from);
    if (!from || !byId.has(e.to)) { add(2, `an arrow joins a block that does not exist`, { edge: e }); continue; }
    if (!from.outcomes.includes(e.outcome)) { add(2, `"${from.title}" has no outcome "${e.outcome}"`, { edge: e }); continue; }
    const key = `${e.from}\u0000${e.outcome}`;
    if (taken.has(key)) add(2, `"${from.title}" leads "${e.outcome}" to two places`, { edge: e });
    taken.add(key);
  }
  for (const b of doc.blocks) {
    for (const o of b.outcomes) {
      if (!taken.has(`${b.id}\u0000${o}`)) add(2, `"${b.title}"'s outcome "${o}" leads nowhere`, { block: b.id });
    }
  }

  // Rule 3: the wave skeleton, present once each, and every edge forward, a step or rework.
  for (const step of PROTOCOL_STEPS) {
    const n = doc.blocks.filter((b) => b.kind === 'protocol' && b.step === step).length;
    if (n !== 1) add(3, n === 0 ? `the flow has no "${PROTOCOL[step].title}" block` : `the flow has ${n} "${PROTOCOL[step].title}" blocks`);
  }
  const phase = flowPhases(doc);
  for (const e of doc.edges) {
    const to = byId.get(e.to);
    const pf = phase.get(e.from);
    const pt = phase.get(e.to);
    if (!to || pf === undefined || pt === undefined) continue;
    if (to.kind === 'protocol' && to.step) {
      const rank = PROTOCOL[to.step].rank;
      const ok = to.step === 'open-wave' ? pf === 0 || pf === 5 : to.step === 'end' ? pf === 5 : pf === rank - 1;
      if (!ok) add(3, `"${PROTOCOL[to.step].title}" can't be reached from there: the wave's steps run in order`, { edge: e });
      continue;
    }
    if (pf === pt) continue;
    if (pt === 2 && (pf === 3 || pf === 4)) continue; // rework: the fix round, which must pass verify again
    add(3, `this arrow jumps between parts of the wave; only a fix round may go back, to the build`, { edge: e });
  }
  return out;
}

/** The smallest publishable flow: the wave skeleton alone, laid out in one row. */
export function skeletonFlowDoc(title: string): FlowDoc {
  const ids: Record<ProtocolStep, string> = {
    'open-wave': 'open-wave', dispatch: 'dispatch', 'verify': 'verify', review: 'review', 'close-wave': 'close-wave', end: 'end',
  };
  const blocks: FlowBlock[] = PROTOCOL_STEPS.map((step, i) => ({
    id: ids[step], kind: 'protocol', title: PROTOCOL[step].title, role: step === 'review' ? 'reviewer' : 'coordinator',
    step, outcomes: [...PROTOCOL[step].outcomes], at: { x: 24 + i * 220, y: 96 },
  }));
  const edges: FlowEdge[] = [
    { from: 'open-wave', outcome: 'opened', to: 'dispatch' },
    { from: 'dispatch', outcome: 'dispatched', to: 'verify' },
    { from: 'verify', outcome: 'verified', to: 'review' },
    { from: 'review', outcome: 'clean', to: 'close-wave' },
    { from: 'review', outcome: 'findings', to: 'close-wave' },
    { from: 'close-wave', outcome: 'next-wave', to: 'open-wave' },
    { from: 'close-wave', outcome: 'last', to: 'end' },
  ];
  return { schema: FLOW_SCHEMA, title, start: 'open-wave', blocks, edges };
}

/** The wire (spec §8). A flow's list row, its versions, and the two answers the Flows screen reads. */
export interface FlowSource { template: string; version: number }
/** `pinnedBy` (wave 2): how many programmes pin this flow; absent from an older server reads as 0. */
export interface FlowSummary { id: number; title: string; source: FlowSource | null; updatedAt: number; latestVersion: number | null; pinnedBy?: number }
export interface FlowVersionRow { version: number; publishedAt: number }
export interface FlowTemplateView { id: string; version: number; title: string; note: string; doc: FlowDoc }
/** `defaultFlowId` (wave 2): the flow new programmes pin; absent from an older server reads as null. */
export interface FlowsListAnswer { flows: FlowSummary[]; templates: FlowTemplateView[]; defaultFlowId?: number | null }
/** One flow. `draft` keeps the read's distinction: an unreadable draft carries its reason and no problems. */
export interface FlowAnswer {
  flow: FlowSummary;
  draft: FlowParse;
  problems: FlowProblem[];
  versions: FlowVersionRow[];
  /** Wave 2: whether new programmes pin this flow; absent from an older server reads as false. */
  isDefault?: boolean;
}

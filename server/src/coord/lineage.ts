/**
 * Landing order, wave 4 (plan docs/superpowers/plans/2026-10-27-landing-order-wave4-lineage-acceptance.md, Task 1):
 * the DECISION whether a stale `branchTip` claim is accepted because the live tip is only the claim plus clean base
 * merges, and the PARSERS of the two files wave 3b's radar writes under `$REG/landing/<project>/` (`enabled`, and
 * one `<id>.lineage` per qualifying registry row). Pure policy: it imports types only, reads no file and no clock
 * (`nowMs` is an argument), so every case is a table row.
 *
 * Fail closed. Every unreadable, malformed, foreign, stale, inconsistent, non-qualifying or unknown fact answers
 * `today` (the caller's own refusal) or `unmeasured` (re-send after the radar's next tick), and never `accept`. The
 * one `accept` row is a claim that is some chain entry's first parent in a lineage whose own tip IS the live tip.
 * `$REG` is writable by every fleet session, so acceptance through these files is attribution-grade, like
 * `handoffCommit` itself: this file proves the files agree with themselves and with the live tip, no more.
 */
import type { ReadFailure } from '../../../shared/agent-protocol.js';

/** The `enabled` marker is trusted for four timer intervals (D-7104): a radar that stopped ticking cannot keep
 *  acceptance alive. */
export const LAND_PROBE_ENABLED_FRESH_S = 1200;
/** A lineage doc is trusted for eight timer intervals (D-7268): a project the tick budget never reaches keeps its
 *  old file, so the doc's own `at` is read. */
export const LINEAGE_FRESH_S = 2400;
/** A lineage file larger than this is unreadable. Wave 3b writes at most eight chain entries, far below it. */
export const LINEAGE_MAX_BYTES = 16384;
/** The longest chain wave 3b's walk writes (`CCD_LAND_PROBE_LINEAGE_STEPS`, default and maximum). */
export const LINEAGE_MAX_CHAIN = 8;
/** A clock that reads this far ahead of `nowMs` is not a clock to trust. */
const FUTURE_SKEW_S = 60;

const SHA = /^[0-9a-f]{40}$/;

/** Wave 3b's words for why the walk stopped. */
export const LINEAGE_STOPS = [
  'not-a-merge', 'second-parent-not-on-base', 'conflict', 'tree-differs', 'unmeasured', 'limit',
] as const;
export type LineageStop = (typeof LINEAGE_STOPS)[number];

export interface LineageEntry { merge: string; p1: string; p2: string }

/** A lineage doc that passed every check of `parseLineage`. A `null` `base` or `stop` in the file is `undefined`
 *  here (D-7269); `tip` stays `null` only in an `unmeasured` doc whose radar could not read the local tip. */
export interface LineageDoc {
  tip: string | null;
  base?: string;
  state: 'measured' | 'unmeasured';
  chain: LineageEntry[];
  stop?: LineageStop;
  branch?: string;
}

export type LineageRead =
  | { ok: true; doc: LineageDoc }
  | { ok: false; reason: ReadFailure | 'stale' };

/** `absent` and `unreadable` are the io's own `ReadFailure` words, kept apart (a file never narrows to one). */
export type MarkerRead = 'trusted' | 'stale' | ReadFailure;
export type PauseRead = 'running' | 'paused' | 'unknown';

const isSha = (v: unknown): v is string => typeof v === 'string' && SHA.test(v);
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function parseObject(content: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(content);
    return isRecord(v) ? v : null;
  } catch {
    return null;
  }
}

/** Whether a doc's `at` is within `freshS` of `nowMs`, and not more than a minute ahead of it. */
function freshAt(at: unknown, freshS: number, nowMs: number): boolean {
  if (typeof at !== 'string') return false;
  const t = Date.parse(at);
  if (Number.isNaN(t)) return false;
  const ageMs = nowMs - t;
  return ageMs <= freshS * 1000 && ageMs >= -FUTURE_SKEW_S * 1000;
}

/** One `<id>.lineage` file's bytes, read against the row it must describe. */
export function parseLineage(
  content: string, expect: { project: string; id: string; branch: string }, nowMs: number,
): LineageRead {
  const bad = { ok: false, reason: 'unreadable' } as const;
  if (Buffer.byteLength(content, 'utf8') > LINEAGE_MAX_BYTES) return bad;
  const o = parseObject(content);
  if (o === null || o.v !== 1) return bad;
  if (o.project !== expect.project || o.id !== expect.id) return bad;
  if (o.state !== 'measured' && o.state !== 'unmeasured') return bad;
  const state = o.state;
  const measured = state === 'measured';

  // A `null` reads as absent (D-7269). A `tip` is a sha, or `null` in an unmeasured doc only.
  const tip = o.tip;
  if (tip === null ? measured : !isSha(tip)) return bad;
  const base = o.base ?? undefined;
  if (base !== undefined && !isSha(base)) return bad;
  const stop = o.stop ?? undefined;
  if (stop !== undefined && !(LINEAGE_STOPS as readonly unknown[]).includes(stop)) return bad;
  if (measured && (base === undefined || stop === undefined)) return bad;

  const branch = o.branch;
  if (branch !== undefined && branch !== expect.branch) return bad;

  const rawChain = o.chain;
  if (!Array.isArray(rawChain) || rawChain.length > LINEAGE_MAX_CHAIN) return bad;
  const chain: LineageEntry[] = [];
  for (const e of rawChain as unknown[]) {
    if (!isRecord(e) || !isSha(e.merge) || !isSha(e.p1) || !isSha(e.p2)) return bad;
    chain.push({ merge: e.merge, p1: e.p1, p2: e.p2 });
  }
  if (chain.length > 0 && chain[0]!.merge !== tip) return bad;
  for (let i = 0; i + 1 < chain.length; i++) if (chain[i]!.p1 !== chain[i + 1]!.merge) return bad;

  if (!freshAt(o.at, LINEAGE_FRESH_S, nowMs)) return { ok: false, reason: 'stale' };
  const doc: LineageDoc = { tip: tip as string | null, state, chain };
  if (base !== undefined) doc.base = base;
  if (stop !== undefined) doc.stop = stop as LineageStop;
  if (branch !== undefined) doc.branch = branch;
  return { ok: true, doc };
}

/** The `enabled` marker's bytes. `absent` is the reader's to say (no file); a file that is here is one of the rest. */
export function parseEnabled(content: string, project: string, nowMs: number): MarkerRead {
  const o = parseObject(content);
  if (o === null || o.v !== 1 || o.project !== project) return 'unreadable';
  return freshAt(o.at, LAND_PROBE_ENABLED_FRESH_S, nowMs) ? 'trusted' : 'stale';
}

export interface LineageInput {
  /** The tip the worker claimed. */
  claim: string;
  /** The tip the registry's branch reads now. */
  live: string;
  marker: MarkerRead;
  globalPause: PauseRead;
  projectPause: PauseRead;
  /** The probe's qualifying row (D-7105), the caller's `lineageQualifies`: a registry record, a `ws/` branch, the run's
   *  project. `false` means the radar never measures this row, so no file will come. */
  qualifies: boolean;
  lineage: LineageRead;
}

/** The probe's own predicate (D-7105), restated once, here in L1: a registry record naming this run's project, on a
 *  `ws/` branch. `recordProject` is the project the registry record resolves to, `null` when it names none. A row
 *  that fails it is one the radar never measures, so the caller gets today's refusal and never waits for a file. */
export function lineageQualifies(recordProject: string | null, runProject: string, branch: string): boolean {
  return recordProject !== null && recordProject === runProject && branch.startsWith('ws/');
}

/** `today` is the caller's existing refusal, its detail extended by ` (<detail>)` when one is given; `unmeasured`
 *  is `lineage-unmeasured` with its detail; `accept` binds the live tip. */
export type LineageDecision =
  | { answer: 'today'; detail?: string }
  | { answer: 'unmeasured'; detail: string }
  | { answer: 'accept' };

/** Spec §5.4's table, in its order. The first row that applies answers. */
export function decideLineage(i: LineageInput): LineageDecision {
  if (i.marker === 'absent') return { answer: 'today' };
  if (i.marker === 'unreadable') return { answer: 'today', detail: 'landing-marker-unreadable' };
  if (i.marker === 'stale') return { answer: 'today', detail: 'landing-marker-stale' };
  if (i.globalPause !== 'running' || i.projectPause !== 'running') return { answer: 'today' };
  if (!i.qualifies) return { answer: 'today', detail: 'lineage-not-expected' };
  const l = i.lineage;
  if (!l.ok) {
    if (l.reason === 'absent') return { answer: 'unmeasured', detail: 'not-yet-measured' };
    if (l.reason === 'unreadable') return { answer: 'unmeasured', detail: 'lineage-unreadable' };
    return { answer: 'unmeasured', detail: 'lineage-stale' };
  }
  // A fixed word: the doc's own `why` never reaches a mail (D-7269).
  if (l.doc.tip === null) return { answer: 'unmeasured', detail: 'tip-unmeasured' };
  if (l.doc.tip !== i.live) return { answer: 'unmeasured', detail: 'older-than-the-live-tip' };
  if (l.doc.chain.some((e) => e.p1 === i.claim)) return { answer: 'accept' };
  if (l.doc.state === 'unmeasured') return { answer: 'unmeasured', detail: 'partly-measured' };
  return { answer: 'today' };
}

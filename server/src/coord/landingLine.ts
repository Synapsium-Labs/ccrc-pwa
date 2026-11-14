// L1, context C4 (landing order wave 5e). PURE: no clock, no fs, no store, no I/O; its one value import is the L0
// vocabulary in `shared/landingLine.ts` (D-7613). Three deciders, all folds over values:
//
// - `landingOrder` decides the landing line's order and its head from a project's entries and the project's two flags
//   (D-7621). The L4 read route reads the project row (`CoordStore.readLanding`) and hands the values in; this file
//   never sees a project name. `afterIds` name ENTRY IDS (`LandingEntry.id`), never PR numbers (D-7613). An after edge
//   outranks the `fixesMain` jump (D-7622): a fix-main entry that waits on another entry is not taken before it, so the
//   jump only reorders entries nothing holds back. A `fixesMain` entry is held by `main-red` too (D-7623): inert in 5e,
//   since `mainRedHold` has no writer until 5i, and a question for 5i. AMENDMENT A (D-8625, wave 5i) settles that
//   question: `mainRedHold` alone no longer pauses the dependency-eligible fixesMain head `landingOrder` already selected
//   (an ordinary head, an operator pause and a recovery hold still do), and the walk below is untouched.
// - `landingBindingOf` and `mainRedNext` (wave 5i) decide, from values, the binding head and the main-red flag's next
//   value over one measured control bundle. Nothing is persisted here; the flag's one writer is `applyLandingControl`.
// - `landingEjectionAsk` decides the second-ejection notice (D-7624). The entry's `ejections` count only ever rises and
//   `CoordStore.advanceLanding` is its one writer, so exactly one write per entry produces 2: that write is the
//   once-only raise. A third ejection raises nothing, and the advance is never refused.
// - `landingViewOf` decides which entries the read lists (landing order wave 5h): the ones still in the line, or one
//   PR's entry in any state. The order is always computed over every entry, so the answer's `order` does not move.
import {
  LANDING_ENTRY_TERMINAL, LANDING_PAUSE_BY, LANDING_PAUSE_BYS,
  type LandingBinding, type LandingBindingReason, type LandingEntry, type LandingLineFlags, type LandingOrder, type LandingRecovery,
} from '../../../shared/landingLine.js';
import { RADAR_PROBE_FRESH_S, freshWithin } from '../../../shared/api.js';   // L0: the one freshness rule
import type { LandingControlRead } from './radar.js';                       // type-only: no ring edge
import type { LandingMutationFacts } from './landingWrites.js';             // type-only

/** First-green: `fixesMain` entries first, then the earlier pin, then the lower PR number. */
const byKey = (a: LandingEntry, b: LandingEntry): number =>
  Number(b.fixesMain) - Number(a.fixesMain) || a.pinnedAt - b.pinnedAt || a.pr - b.pr;

/** `recovery` (wave 5f) holds the line while any authority subject is unresolved: no head, but `order` and both flags
 *  are untouched, and a real pause keeps its `by`. Omitted recovery is today's behaviour exactly. */
export function landingOrder(entries: readonly LandingEntry[], flags: LandingLineFlags, recovery?: LandingRecovery): LandingOrder {
  const line = entries.filter((x) => x.state === 'pinned').sort(byKey);
  // An edge holds its entry behind a target that is still outstanding. An `unknown` target is outstanding because this
  // build cannot read whether it landed, so an edge to it fails closed.
  const outstanding = new Set(entries.filter((x) => x.state === 'pinned' || x.state === 'ejected' || x.state === 'unknown').map((x) => x.id));
  const taken = new Set<number>();
  const order: LandingEntry[] = [];
  const rest = new Set(line);
  for (;;) {
    const next = line.find((x) => rest.has(x) && x.afterIds.every((t) => !outstanding.has(t) || taken.has(t)));
    if (next === undefined) break;
    rest.delete(next);
    taken.add(next.id);
    order.push(next);
  }
  const head = order[0] ?? null;
  // What waits on an ejected or unknown target, or on a cycle (a self-edge included), goes last in key order.
  for (const x of line) if (rest.has(x)) order.push(x);
  // Amendment A (D-8625): main-red alone does not pause the head the walk already selected when it has `fixesMain`. The
  // walk and its after edges are unchanged, so a fixesMain entry behind an outstanding target is not the head and stays
  // paused; an operator pause suppresses the head whatever the entry is.
  const redExempt = !flags.operatorPaused && head?.fixesMain === true;
  const by = LANDING_PAUSE_BYS.filter((k) => flags[LANDING_PAUSE_BY[k]] && !(k === 'main-red' && redExempt));
  const held = recovery?.hold ? { reason: recovery.hold.reason, subjectIds: [...recovery.hold.subjectIds] } : undefined;
  if (by.length > 0) return held ? { paused: true, by, order, held } : { paused: true, by, order };
  if (held) return { paused: false, order, head: null, held };
  return { paused: false, order, head };
}

/** The landing read's view of one project's entries: `order` over every entry (as before), `entries` the ones not
 *  terminal when `pr` is null, else that PR's entry in any state, or none. `entriesScope` says which. */
export function landingViewOf(entries: readonly LandingEntry[], flags: LandingLineFlags, recovery: LandingRecovery, pr: number | null):
  { entries: LandingEntry[]; order: LandingOrder; entriesScope: 'open' | 'pr' } {
  const order = landingOrder(entries, flags, recovery);
  return pr === null
    ? { entries: entries.filter((e) => !LANDING_ENTRY_TERMINAL[e.state]), order, entriesScope: 'open' }
    : { entries: entries.filter((e) => e.pr === pr), order, entriesScope: 'pr' };
}

/** The ejection count at which the operator is told, once (D-7624). */
export const LANDING_EJECTION_ASK_AT = 2;

export type LandingEjectionAsk = { due: false } | { due: true; title: string; body: string; tag: string };

export function landingEjectionAsk(entry: LandingEntry): LandingEjectionAsk {
  if (entry.state !== 'ejected' || entry.ejections !== LANDING_EJECTION_ASK_AT) return { due: false };
  const at = `${entry.project} #${entry.pr}`;
  const who = entry.runId === null ? `${at} (no run)` : `run ${entry.runId}, ${at}`;
  const base = entry.baseSha === null ? 'unrecorded' : entry.baseSha.slice(0, 12);
  const tail = 'The line holds nothing back; you decide whether it lands again, is fixed by hand or is withdrawn.';
  // A bare retreat names neither a kind nor a base: say so plainly rather than "unrecorded against base unrecorded".
  const what = entry.baseSha === null && entry.ejectionKind === null
    ? 'returned from merging to working a second time; no ejection kind or base was recorded. '
    : `ejected from the landing line a second time (${entry.ejectionKind ?? 'unrecorded'} against base ${base}). `;
  return {
    due: true,
    tag: `landing-ejected-${entry.project}-${entry.pr}`,
    title: `Landing: ${at} ejected twice`,
    body: `${who}: ${what}${tail}`,
  };
}

const CLEAR: LandingLineFlags = { operatorPaused: false, mainRedHold: false };
const fresh = (at: string, nowMs: number): boolean => freshWithin(at, RADAR_PROBE_FRESH_S, nowMs);

/** The main-red flag's next value from one control bundle (wave 5i). Only a measurement that is positive, fresh at
 *  `nowMs`, of `project` and coherent (marker readable, probe and health successful, `health.sha` the probe's full base
 *  sha) moves it: green clears, red sets, and a pending or unmeasured health keeps. Everything else keeps the previous
 *  value, whichever it was: absent, stale, oversize, unreadable, late, foreign or mismatched input is no evidence. A `set`
 *  is returned only for an actual change, with the health document's own sha and stamp. */
export function mainRedNext(previous: boolean, control: LandingControlRead, nowMs: number, project: string):
  { kind: 'keep'; value: boolean } | { kind: 'set'; value: boolean; sha: string; at: string } {
  const keep = { kind: 'keep', value: previous } as const;
  const { lander, probe, health } = control;
  if (!lander.ok || !probe.ok || !health.ok) return keep;
  if (lander.doc.project !== project || probe.doc.project !== project || health.doc.project !== project) return keep;
  if (!fresh(lander.doc.at, nowMs) || !fresh(probe.doc.at, nowMs) || !fresh(health.doc.at, nowMs)) return keep;
  if (health.doc.sha === null || health.doc.sha !== probe.doc.baseSha) return keep;
  if (health.doc.state === 'unmeasured') return keep;
  const value = health.doc.state === 'red';
  return value === previous ? keep : { kind: 'set', value, sha: health.doc.sha, at: health.doc.at };
}

/** The binding head of one project (wave 5i), from current database facts and one control bundle. Never stored.
 *  `undefined` control is unmeasured, never inert: only a PROVEN marker absence is inert. Precedence: marker, operator
 *  pause, recovery, unreadable open projection, selected head, probe and health availability and freshness (rechecked
 *  here against `nowMs`), equal base, the exact selected PR and pinned sha, clean base composition, health policy.
 *  The selected head is the one `landingOrder` picks with no flag set, so a main-red or a failed gate holds on that entry
 *  and never searches a later one. `mainRedHold` is a fact and not a gate here: the same fresh evidence that sets it
 *  decides the health policy, and only the selected fixesMain head is ready under red (Amendment A, D-8625). */
export function landingBindingOf(facts: LandingMutationFacts, control: LandingControlRead | undefined, nowMs: number): LandingBinding {
  const selected = landingOrder(facts.entries, CLEAR);
  const head = selected.paused ? null : selected.head;
  const entryId = head?.id ?? null;
  const held = (reason: LandingBindingReason): LandingBinding => ({ mode: 'held', reason, entryId });
  if (control === undefined) return held('opt-in-unknown');
  const { lander, probe, health } = control;
  if (!lander.ok) return lander.reason === 'absent' ? { mode: 'inert' } : held('opt-in-unknown');
  if (lander.doc.project !== facts.project || !fresh(lander.doc.at, nowMs)) return held('opt-in-unknown');
  if (facts.flags.operatorPaused) return held('paused');
  if (facts.recovery.hold !== null) return held('recovery');
  const open = facts.entries.filter((x) => !LANDING_ENTRY_TERMINAL[x.state]);
  const readable = (id: number): boolean =>
    facts.projections.find((p) => p.id === id)?.value.kind === 'readable'
    && facts.dependencies.find((d) => d.id === id)?.value.kind === 'readable';
  if (open.some((x) => !readable(x.id))) return held('projection-unreadable');
  if (head === null) return held('empty-or-blocked');
  if (!probe.ok || probe.doc.project !== facts.project || !fresh(probe.doc.at, nowMs) || probe.doc.headsCut) return held('probe-unmeasured');
  if (!health.ok || health.doc.project !== facts.project || !fresh(health.doc.at, nowMs)
    || health.doc.state === 'unmeasured' || health.doc.sha === null) return held('health-unmeasured');
  if (health.doc.sha !== probe.doc.baseSha) return held('base-mismatch');
  const named = probe.doc.heads.filter((h) => h.pr === head.pr);
  const probed = named.length === 1 ? named[0]! : null;
  if (probed === null || probed.head !== head.pinnedSha) return held('head-mismatch');
  if (probed.base.state !== 'clean') return held('composition-not-clean');
  if (health.doc.state === 'red' && !head.fixesMain) return held('main-red');
  return {
    mode: 'ready', entryId: head.id, pr: head.pr, pinnedSha: head.pinnedSha, baseSha: probe.doc.baseSha,
    landerAt: lander.doc.at, probeAt: probe.doc.at, healthAt: health.doc.at, fixesMain: head.fixesMain,
  };
}

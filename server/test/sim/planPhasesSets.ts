// The phase deciders' mutant sets (programme work map WM0, D-8715): `phaseNumbers`, `diffPhases` and `phaseRefVerdict` in
// `server/src/coord/planPolicy.ts`, each run against every case of `../planPhasesCases.ts` loaded over the mutated copy.
// Registered in mutation-floors.test.ts's MUTANT_SETS, with a floor each in mutation-floors.json. The brief's red checks:
// each bad-carry arm removed (BC-1 to BC-5), the unknown-ref checks (UR-*), the droppedWhy requirement (DW-1) and review
// 2268 F12's refusals (F12-1 and F12-2 for the remove of a carry's two ends, F12-3 for a put that reorders a carry), and
// review 2375's rows F5 to F10 and F14 (F7's bound sits in the put's parse; its mutants ride this set under the
// `#diffPhases` key, which names more than that function: disclosed, kept as ruled, review 2382 L2-F2), and review 2382's
// L1-F1 and L2-F1 (a dropped or dropping phase's held and new references).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHASE_CASES, type PlanPolicyModule } from '../planPhasesCases.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const POLICY_TS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/coord/planPolicy.ts');
export const PHASE_NUMBERS_KEY = 'server/src/coord/planPolicy.ts#phaseNumbers';
export const DIFF_PHASES_KEY = 'server/src/coord/planPolicy.ts#diffPhases';
export const PHASE_REF_VERDICT_KEY = 'server/src/coord/planPolicy.ts#phaseRefVerdict';

const suite = (m: PlanPolicyModule): Record<string, SuiteCase> =>
  Object.fromEntries(PHASE_CASES.map((c) => [c.name, () => c.run(m)]));
const set = (mutants: MutantSet<PlanPolicyModule>['mutants']): MutantSet<PlanPolicyModule> => ({ modulePath: POLICY_TS, mutants, suite });

export const PHASE_NUMBERS_SET = set([
  { id: 'N-1', old: 'for (const p of phases) if (!p.dropped) out.set(p.key, out.size + 1);', new: 'for (const p of phases) out.set(p.key, out.size + 1);' },
  { id: 'N-2', old: 'for (const p of phases) if (!p.dropped) out.set(p.key, out.size + 1);', new: 'for (const p of phases) if (!p.dropped) out.set(p.key, out.size);' },
]);

export const DIFF_PHASES_SET = set([
  // The droppedWhy requirement: a stored phase left out of the put vanishes silently.
  { id: 'DW-1', old: "if (p.droppedWhy === null && !putKeys.has(p.key)) return refuse('dropped-needs-reason',", new: "if (false) return refuse('dropped-needs-reason'," },
  { id: 'DW-2', old: "if (was === undefined) return refuse('plan-bad-body', `phase ${p.key} is new and cannot carry droppedWhy`);", new: 'if (was === undefined) continue;' },
  // The unknown-ref check of a put's new reference, and the two liveness rules it reads.
  { id: 'UR-4', old: "if (!(r.kind === 'epic' ? epicLive(r.key) : ticketLive(r.key))) {", new: 'if (false) {' },
  { id: 'UR-5', old: "return e !== undefined && e.droppedWhy === undefined && storedEpic.get(key)?.state !== 'dropped';", new: "return e !== undefined && storedEpic.get(key)?.state !== 'dropped';" },
  { id: 'UR-6', old: "return e !== undefined && e.droppedWhy === undefined && storedEpic.get(key)?.state !== 'dropped';", new: 'return e !== undefined && e.droppedWhy === undefined;' },
  { id: 'UR-7', old: "if (f !== undefined) return f.ticket.state !== 'dropped' && !(f.ticket.state === 'open' && !epicLive(f.epic.key));", new: "if (f !== undefined) return f.ticket.state !== 'dropped';" },
  { id: 'UR-8', old: "if (f !== undefined) return f.ticket.state !== 'dropped' && !(f.ticket.state === 'open' && !epicLive(f.epic.key));", new: 'if (f !== undefined) return !(f.ticket.state === \'open\' && !epicLive(f.epic.key));' },
  // D18: a reference the phase already holds is never re-judged (one stored before its object dropped is kept).
  { id: 'K-1', old: 'if (was !== undefined && id !== undefined && was.refs.some((x) => x.kind === r.kind && x.refId === id)) continue;', new: '' },
  // Review 2375 F5: a put never revives a dropped phase (its title, position and new references are ignored).
  { id: 'F5-1', old: '    if (was !== undefined && was.droppedWhy !== null) continue;\n    if (was === undefined) {', new: '    if (was === undefined) {' },
  // Review 2375 F6: a ticket the put adds is referable only in an epic the put keeps live.
  { id: 'F6-1', old: 'return put.epics.some((e) => epicLive(e.key) && (e.tickets', new: 'return put.epics.some((e) => (e.tickets' },
  // Review 2375 F7: the put's bound of 200 references a phase (D-8715's refsPerPhase), in the put's own parse.
  { id: 'F7-1', old: 'if (p.refs.length > PLAN_BOUNDS.refsPerPhase) return tooLarge(', new: 'if (false) return tooLarge(' },
  { id: 'F7-1b', old: 'if (p.refs.length > PLAN_BOUNDS.refsPerPhase)', new: 'if (p.refs.length >= PLAN_BOUNDS.refsPerPhase)' },
  // Review 2375 F9: a new reference is judged on a phase the put drops, and on a dropped phase, before the rest is ignored.
  { id: 'F9-1', old: '      const adds = newRefs(p, was);\n      if (!adds.ok) return adds;\n      if (was.droppedWhy === null) changes', new: '      if (was.droppedWhy === null) changes' },
  { id: 'F9-2', old: '    const adds = newRefs(p, was);\n    if (!adds.ok) return adds;\n    if (was !== undefined && was.droppedWhy !== null) continue;', new: '    if (was !== undefined && was.droppedWhy !== null) continue;\n    const adds = newRefs(p, was);\n    if (!adds.ok) return adds;' },
  // Review 2382 L1-F1: a reference a dropped or dropping phase already holds is skipped there too, never re-judged.
  { id: 'L1-F1', old: '      const adds = newRefs(p, was);\n      if (!adds.ok) return adds;\n      if (was.droppedWhy === null) changes', new: '      const adds = newRefs(p, undefined);\n      if (!adds.ok) return adds;\n      if (was.droppedWhy === null) changes' },
  { id: 'L1-F1b', old: '    const adds = newRefs(p, was);\n    if (!adds.ok) return adds;\n    if (was !== undefined && was.droppedWhy !== null) continue;', new: '    const adds = newRefs(p, was !== undefined && was.droppedWhy !== null ? undefined : was);\n    if (!adds.ok) return adds;\n    if (was !== undefined && was.droppedWhy !== null) continue;' },
  // Review 2382 L2-F1: a phase the put drops stores none of the put's valid new references.
  { id: 'L2-F1', old: '      if (was.droppedWhy === null) changes.phases.drop.push({ id: was.id, why: p.droppedWhy });\n      continue;', new: '      if (was.droppedWhy === null) changes.phases.drop.push({ id: was.id, why: p.droppedWhy });\n      for (const r of adds.refs) changes.refs.push({ phaseKey: p.key, kind: r.kind, key: r.key });\n      continue;' },
  // F12: a put that orders a carry's target at or before its source.
  { id: 'F12-3', old: 'if (from !== undefined && to !== undefined && to <= from) {', new: 'if (false) {' },
  { id: 'F12-3b', old: 'if (from !== undefined && to !== undefined && to <= from) {', new: 'if (from !== undefined && to !== undefined && to < from - 1) {' },
]);

export const PHASE_REF_VERDICT_SET = set([
  // Each bad-carry arm removed, one at a time.
  { id: 'BC-1', old: "if (from.droppedWhy !== null) return refuse('bad-carry', `phase ${from.key} was dropped`);", new: '' },
  { id: 'BC-2', old: "if (to.droppedWhy !== null) return refuse('bad-carry', `phase ${to.key} was dropped`);", new: '' },
  { id: 'BC-3', old: "if (!(numbers.get(to.key)! > numbers.get(from.key)!)) return refuse('bad-carry',", new: "if (false) return refuse('bad-carry'," },
  { id: 'BC-3b', old: 'if (!(numbers.get(to.key)! > numbers.get(from.key)!))', new: 'if (!(numbers.get(to.key)! >= numbers.get(from.key)!))' },
  { id: 'BC-4', old: "if (t.state === 'done') return refuse('bad-carry', `ticket ${t.key} is done`);", new: '' },
  { id: 'BC-5', old: "if (!held || carriedOut || t.state === 'dropped') return refuse('bad-carry',", new: "if (false) return refuse('bad-carry'," },
  { id: 'BC-5b', old: "if (!held || carriedOut || t.state === 'dropped')", new: "if (!held || t.state === 'dropped')" },
  { id: 'BC-5c', old: "if (!held || carriedOut || t.state === 'dropped')", new: 'if (!held || carriedOut)' },
  { id: 'BC-5d', old: 'const carriedOut = tref !== undefined && live(tref.carriedTo);', new: 'const carriedOut = tref !== undefined && tref.carriedTo !== null;' },
  // Review 2375 F8: a whole-epic reference holds that epic's tickets only.
  { id: 'F8-1', old: "from.refs.some((r) => r.kind === 'epic' && r.refId === t.epicId)", new: "from.refs.some((r) => r.kind === 'epic')" },
  // The unknown-ref checks of add and remove.
  { id: 'UR-1', old: "if (obj.state === 'dropped') return refuse('unknown-ref',", new: "if (false) return refuse('unknown-ref'," },
  { id: 'UR-2', old: 'if (phase === undefined || phase.droppedWhy !== null) {', new: 'if (phase === undefined) {' },
  { id: 'UR-3', old: "if (held === undefined) return refuse('unknown-ref',", new: "if (held === undefined) return { ok: true, write: { kind: 'none' } }; if (false) return refuse('unknown-ref'," },
  // F12's remove rule: either end of a recorded carry.
  { id: 'F12-1', old: "if (held.kind === 'ticket' && live(held.carriedTo)) {", new: 'if (false) {' },
  { id: 'F12-1b', old: "if (held.kind === 'ticket' && live(held.carriedTo)) {", new: "if (held.kind === 'ticket' && held.carriedTo !== null) {" },
  // Review 2375 F10: a carry from a dropped source stands, so its target end is still refused.
  { id: 'F10-1', old: 'phases.some((p) => p.id !== phase.id &&', new: 'phases.some((p) => p.id !== phase.id && p.droppedWhy === null &&' },
  // Review 2375 F14: removing a stored reference to an object dropped since is allowed.
  { id: 'F14-1', old: "  if (held === undefined) return refuse('unknown-ref', `phase ${phase.key} holds no reference", new: "  if (obj.state === 'dropped') return refuse('unknown-ref', 'dropped');\n  if (held === undefined) return refuse('unknown-ref', `phase ${phase.key} holds no reference" },
  { id: 'F12-2', old: "if (held.kind === 'ticket' && phases.some((p) => p.id !== phase.id &&", new: 'if (false && phases.some((p) => p.id !== phase.id &&' },
]);

export const PLAN_PHASES_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [PHASE_NUMBERS_KEY]: PHASE_NUMBERS_SET as MutantSet<never>,
  [DIFF_PHASES_KEY]: DIFF_PHASES_SET as MutantSet<never>,
  [PHASE_REF_VERDICT_KEY]: PHASE_REF_VERDICT_SET as MutantSet<never>,
};

// The programme work map WM2's mutant sets (D-8779): `workMapOf`, `doneEvidenceVerdict` and `verdictsReadOf` in
// `server/src/coord/workMap.ts`, each run against every case of `../workMapCases.ts` loaded over the mutated copy. Registered in
// mutation-floors.test.ts's MUTANT_SETS, with a floor each in mutation-floors.json. The brief's red checks: every row of the
// spec's Table 6 (T6-*) and Table 6a (T6a-*) deleted or reordered, and the view's other rules (V-*), the evidence rule's
// read side (EV-*) and the verdicts reader's "not read" (VR-*).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORK_MAP_CASES, type WorkMapModule } from '../workMapCases.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const WORK_MAP_TS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/coord/workMap.ts');
export const WORK_MAP_KEY = 'server/src/coord/workMap.ts#workMapOf';
export const DONE_EVIDENCE_KEY = 'server/src/coord/workMap.ts#doneEvidenceVerdict';
export const VERDICTS_READ_KEY = 'server/src/coord/workMap.ts#verdictsReadOf';

const suite = (m: WorkMapModule): Record<string, SuiteCase> =>
  Object.fromEntries(WORK_MAP_CASES.map((c) => [c.name, () => c.run(m)]));
const set = (mutants: MutantSet<WorkMapModule>['mutants']): MutantSet<WorkMapModule> => ({ modulePath: WORK_MAP_TS, mutants, suite });

export const WORK_MAP_SET = set([
  // Table 6: each row deleted, then the orders the review rulings fix.
  { id: 'T6-1', old: "    if (t.state === 'dropped') return { status: 'dropped', reason: null, itemIds: [] };", new: '' },
  { id: 'T6-2', old: "    if (closedWhy !== undefined) return { status: 'closed', reason: closedWhy, itemIds: [] };", new: '' },
  { id: 'T6-3', old: "    if (verdict !== null && verdict.holds) return { status: 'done', reason: null, itemIds: [] };", new: '' },
  { id: 'T6-4', old: "    if (verdict !== null && !verdict.holds) return { status: 'done-unverified', reason: verdict.reason, itemIds: [] };", new: '' },
  { id: 'T6-4b', old: ": (input.plan.done.get(t.key)?.evidence ?? null) === null ? { holds: false, reason: 'no evidence stored' }", new: ": (input.plan.done.get(t.key)?.evidence ?? null) === null ? { holds: true }" },
  { id: 'T6-5', old: "    if (ended) return { status: 'left-open', reason: null, itemIds: [] };", new: '' },
  // Review 2382 L3-F1: an ended plan reads row 5 before row 4.
  { id: 'T6-5b', old: "    if (ended) return { status: 'left-open', reason: null, itemIds: [] };", new: "    if (ended && verdict === null) return { status: 'left-open', reason: null, itemIds: [] };" },
  { id: 'T6-6', old: "    if (itemIds.length > 0) return { status: 'waiting-on-you', reason: null, itemIds };", new: '' },
  { id: 'T6-6b', old: "const itemIds = [...itemsOfRun(t.runId), ...(cpItem === undefined ? [] : [cpItem])];", new: 'const itemIds = [...itemsOfRun(t.runId)];' },
  { id: 'T6-6c', old: "cp !== undefined && cp.kind === 'operator-act' ?", new: 'cp !== undefined ?' },
  { id: 'T6-6d', old: "input.checkpointItems.get(`${epic.key}/${cp.key}`)", new: 'input.checkpointItems.get(`e1/${cp.key}`) ?? input.checkpointItems.get(`e2/${cp.key}`)' },
  { id: 'T6-7', old: "  if (verdict !== null && verdict.stuck) return 'stuck';", new: '' },
  { id: 'T6-8', old: "  if (verdict !== null && state === 'planned' && verdict.blockedBy !== null) return 'blocked';", new: '' },
  { id: 'T6-8b', old: "  if (verdict !== null && state === 'planned' && verdict.blockedBy !== null) return 'blocked';", new: "  if (verdict !== null && verdict.blockedBy !== null) return 'blocked';" },
  { id: 'T6-9', old: "  if (state === 'dispatched' || state === 'working') return 'working';", new: '' },
  { id: 'T6-9b', old: "  if (state === 'dispatched' || state === 'working') return 'working';", new: "  if (state === 'working') return 'working';" },
  { id: 'T6-10', old: "  if (state === 'unknown') return 'state-unknown';", new: '' },
  { id: 'T6-11', old: "  if (state === 'awaiting-review') return 'in-review';", new: '' },
  { id: 'T6-12', old: "  if (state === 'merging' || state === 'closing') return 'merging';", new: '' },
  { id: 'T6-12b', old: "  if (state === 'merging' || state === 'closing') return 'merging';", new: "  if (state === 'merging') return 'merging';" },
  { id: 'T6-13', old: "  if (state === 'planned') return 'queued';", new: '' },
  { id: 'T6-14b', old: "      const s = run === undefined ? 'state-unknown' : runStatus(", new: '      const s = run === undefined ? null : runStatus(' },
  { id: 'T6-14', old: "    return { status: 'not-started', reason: null, itemIds: [] };", new: "    return { status: 'queued', reason: null, itemIds: [] };" },
  // The status's group (D3).
  { id: 'T6-G', old: "'done-unverified': 'held', 'left-open': 'left-open',", new: "'done-unverified': 'done', 'left-open': 'left-open'," },
  // Rows 7 and 8 need the reader: "not read" is carried on the view, never folded.
  { id: 'V-1', old: "  const verdicts: WorkMapView['verdicts'] = input.verdicts === 'not-read' ? 'not-read' : 'read';", new: "  const verdicts: WorkMapView['verdicts'] = 'read';" },
  { id: 'V-2', old: '  const workRuns = input.runs.filter((r) => r.kind === \'work\');', new: '  const workRuns = input.runs;' },
  { id: 'V-3', old: "    if (tickets.some((x) => x.t.key === auto)) folded.set(auto, t.key);", new: '' },
  { id: 'V-4', old: "    const lastFailed = status === 'not-started'", new: '    const lastFailed = false' },
  { id: 'V-5', old: "(m === null || r.id > m ? r.id : m)", new: '(m === null ? r.id : m)' },

  // Table 6a: each reading deleted, and its order.
  { id: 'T6a-1', old: '    const keys = order.filter((k) => set.has(k) && shown(k));', new: '    const keys = order.filter((k) => set.has(k));' },
  { id: 'T6a-2', old: "      if (item.status === 'closed') { pc.closed += 1; continue; }", new: '' },
  { id: 'T6a-3', old: '      if (out !== null) { carried += 1; times.push(out.at); continue; }', new: '' },
  { id: 'T6a-3b', old: '    if (r === undefined || r.carriedTo === null || !numbers.has(r.carriedTo)) return null;', new: '    if (r === undefined || r.carriedTo === null) return null;' },
  { id: 'T6a-4', old: "      if (item.group === 'done') { ownDone += 1; times.push(item.doneAt); }", new: '' },
  { id: 'T6a-5', old: '      own += 1;', new: "      if (item.group !== 'left-open') own += 1;" },
  { id: 'T6a-6', old: '      pc[item.group] += 1;', new: '' },
  // The phase's finish (F14) and its time.
  { id: 'F-1', old: '    const empty = own === 0 && carried === 0;', new: '    const empty = own === 0;' },
  { id: 'F-2', old: '    const empty = own === 0 && carried === 0;', new: '    const empty = false;' },
  { id: 'F-3', old: "      : times.some((x) => x === null) ? { at: 'unknown' } : { at: Math.max(...(times as number[])) };", new: '      : { at: Math.max(...(times as number[])) };' },
  { id: 'F-4', old: '{ at: Math.max(...(times as number[])) }', new: '{ at: Math.min(...(times as number[])) }' },
  // Carries read both ways (F14; review 2375 F10).
  { id: 'C-1', old: '        carriedFrom: declared.filter((src) => src.key !== p.key && src.refs.some((x) =>', new: '        carriedFrom: live.filter((src) => src.key !== p.key && src.refs.some((x) =>' },
  { id: 'C-2', old: "x.kind === 'ticket' && canonical(x.key) === t.key && x.carriedTo === p.key)).map(", new: "x.kind === 'ticket' && canonical(x.key) === t.key && x.carriedTo !== null)).map(" },
  { id: 'C-3', old: "        carriedTo: out === null ? null : { key: out.to, number: numbers.get(out.to)! },", new: '        carriedTo: null,' },
  // A whole-epic reference (D15) and the referenced set.
  { id: 'R-1', old: '      else for (const k of ticketsOfEpic.get(r.key) ?? []) out.add(canonical(k));', new: '' },
  { id: 'R-2', old: "    const phases: WorkItemView['phases'] = status === 'dropped' ? [] : live.filter(", new: "    const phases: WorkItemView['phases'] = live.filter(" },
  { id: 'R-3', old: '  const notInPhase = live.length === 0 ? [] : order.filter((k) => shown(k) && !inAPhase.has(k));', new: '  const notInPhase = order.filter((k) => shown(k) && !inAPhase.has(k));' },
  { id: 'R-4', old: '  const notInPhase = live.length === 0 ? [] : order.filter((k) => shown(k) && !inAPhase.has(k));', new: '  const notInPhase = live.length === 0 ? [] : order.filter((k) => !inAPhase.has(k));' },
  // The strip (F3, F23) and the four plan states (§5.1, D19).
  { id: 'S-1', old: '    if (dropped && keys.length === 0) return [];', new: '    if (dropped) return [];' },
  { id: 'S-2', old: '    if (dropped && keys.length === 0) return [];', new: '' },
  { id: 'S-3', old: '      total: keys.filter((k) => COUNTED.has(byKey.get(k)!.group)).length,', new: '      total: keys.length,' },
  { id: 'S-4', old: "    const cps = e.checkpoints.filter((c) => c.state !== 'dropped');", new: '    const cps = e.checkpoints;' },
  { id: 'S-5', old: "  const source: WorkMapView['source'] = ended ? 'ended' : anyTicket ? 'plan'", new: "  const source: WorkMapView['source'] = anyTicket ? 'plan'" },
  { id: 'S-6', old: ": anyTicket ? 'plan' : plan.declared ? 'declared-empty' : 'runs';", new: ": anyTicket ? 'plan' : 'runs';" },
  { id: 'S-7', old: "  const anyTicket = items.some((i) => i.status !== 'dropped');", new: '  const anyTicket = items.length > 0;' },
  // The no-plan fallback and the runs before the plan (D9, D12).
  { id: 'N-1', old: "    const rows: WorkItemView[] = [...workRuns].sort((a, b) => b.id - a.id)", new: '    const rows: WorkItemView[] = [...workRuns].sort((a, b) => a.id - b.id)' },
  { id: 'N-2', old: "      const status: WorkStatus = r.state === 'done' ? 'done' : r.state === 'failed' ? 'failed'", new: "      const status: WorkStatus = r.state === 'done' ? 'done' : r.state === 'failed' ? 'done'" },
  { id: 'N-3', old: ' || r.runTitle === r.programTitle ? null : r.runTitle;', new: ' ? null : r.runTitle;' },
  { id: 'N-4', old: "        : itemIds.length > 0 ? 'waiting-on-you' : (runStatus(r.state, verdictOf(r.id)) ?? 'state-unknown');", new: "        : (runStatus(r.state, verdictOf(r.id)) ?? 'state-unknown');" },
  { id: 'N-5', old: "        : itemIds.length > 0 ? 'waiting-on-you' : (runStatus(r.state, verdictOf(r.id)) ?? 'state-unknown');", new: "        : itemIds.length > 0 ? 'waiting-on-you' : (runStatus(r.state, null) ?? 'state-unknown');" },
  { id: 'N-6', old: '  const before = workRuns.filter((r) => r.ticketKey === null).length;', new: '  const before = workRuns.length;' },
]);

export const DONE_EVIDENCE_SET = set([
  { id: 'EV-1', old: "  if (ev === 'malformed') return { holds: false, reason: 'the stored evidence cannot be read' };", new: "  if (ev === 'malformed') return { holds: true };" },
  { id: 'EV-2', old: "    if (r === null) return { holds: false, reason: `run ${ev.runId} is not recorded` };", new: '    if (r === null) return { holds: true };' },
  { id: 'EV-3', old: "    if (r.program !== f.program || r.kind !== 'work') return", new: "    if (r.kind !== 'work') return" },
  { id: 'EV-4', old: "    if (r.program !== f.program || r.kind !== 'work') return", new: '    if (r.program !== f.program) return' },
  { id: 'EV-5', old: "    if (r.state !== 'done') return { holds: false, reason: `run ${ev.runId} is ${r.state}, not done` };", new: '' },
  { id: 'EV-6', old: '    if (r.ticketKey !== null && r.ticketKey !== f.ticketKey && !isAutoTicketKey(r.ticketKey)) {', new: '    if (false) {' },
  { id: 'EV-7', old: '    if (r.ticketKey !== null && r.ticketKey !== f.ticketKey && !isAutoTicketKey(r.ticketKey)) {', new: '    if (r.ticketKey !== null && r.ticketKey !== f.ticketKey) {' },
  { id: 'EV-8', old: '    if (r.ticketKey !== null && r.ticketKey !== f.ticketKey && !isAutoTicketKey(r.ticketKey)) {', new: '    if (r.ticketKey !== null && !isAutoTicketKey(r.ticketKey)) {' },
  { id: 'EV-9', old: "  if (l === null || l.kind === 'no-entry') return", new: '  if (l === null) return' },
  { id: 'EV-10', old: "  if (l.kind === 'unreadable') return { holds: false, reason: `the landing line could not be read (${l.detail})` };", new: '' },
  { id: 'EV-11', old: "  if (l.kind === 'unlanded') return { holds: false, reason: `pull request ${ev.pr} is ${l.state}, not landed` };", new: '' },
]);

export const VERDICTS_READ_SET = set([
  { id: 'VR-1', old: "  if (all === undefined || all.size === 0) return 'not-read';", new: "  if (all === undefined) return 'not-read';" },
  { id: 'VR-2', old: '{ stuck: v.stuck !== null, blockedBy: v.blockedBy }', new: '{ stuck: v.stuck !== undefined, blockedBy: v.blockedBy }' },
  { id: 'VR-3', old: '{ stuck: v.stuck !== null, blockedBy: v.blockedBy }', new: '{ stuck: v.stuck !== null, blockedBy: null }' },
]);

export const WORK_MAP_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [WORK_MAP_KEY]: WORK_MAP_SET as MutantSet<never>,
  [DONE_EVIDENCE_KEY]: DONE_EVIDENCE_SET as MutantSet<never>,
  [VERDICTS_READ_KEY]: VERDICTS_READ_SET as MutantSet<never>,
};

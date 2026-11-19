// Programme work map WM2 (D-8779; spec 2026-11-16 §3.1, §4, §5.1 and §7): the work map's one decider, `workMapOf`, and the read
// side of the evidence rule, `doneEvidenceVerdict` (`server/src/coord/workMap.ts`). The cases are written once in
// `workMapCases.ts` and run here against the real module; `sim/workMapSets.ts` runs them against each mutant.
import { describe, it, expect } from 'vitest';
import * as workMap from '../src/coord/workMap.js';
import { WORK_GROUPS, WORK_STATUSES } from '../../shared/plan.js';
import { EVIDENCE_CASES, PHASE_CASES, STATUS_CASES, VERDICTS_CASES, VIEW_CASES } from './workMapCases.js';

describe('Table 6: a ticket\'s status', () => {
  for (const c of STATUS_CASES) it(c.name, () => c.run(workMap));
});
describe('Table 6a: how a phase reads its tickets', () => {
  for (const c of PHASE_CASES) it(c.name, () => c.run(workMap));
});
describe('the strip, the four plan states and the no-plan fallback', () => {
  for (const c of VIEW_CASES) it(c.name, () => c.run(workMap));
});
describe('the read side of the evidence rule', () => {
  for (const c of EVIDENCE_CASES) it(c.name, () => c.run(workMap));
});
describe('the run verdicts reader, read', () => {
  for (const c of VERDICTS_CASES) it(c.name, () => c.run(workMap));
});

describe('the vocabulary', () => {
  it('every status has one group, and every group is some status\'s', () => {
    expect(Object.keys(workMap.WORK_STATUS_GROUP).sort()).toEqual([...WORK_STATUSES].sort());
    expect([...new Set(Object.values(workMap.WORK_STATUS_GROUP))].sort()).toEqual([...WORK_GROUPS].sort());
  });
  it('the fifteen statuses are Table 6\'s fourteen rows in order, then failed (D3)', () => {
    expect(WORK_STATUSES).toEqual(['dropped', 'closed', 'done', 'done-unverified', 'left-open', 'waiting-on-you', 'stuck', 'blocked',
      'working', 'state-unknown', 'in-review', 'merging', 'queued', 'not-started', 'failed']);
    expect(WORK_GROUPS).toHaveLength(9);
  });
});

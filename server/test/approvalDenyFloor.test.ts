// The stale deny digest's deciders (Overlord approvals PR 0, plan 2026-11-18-overlord-approvals.md Task 0.4): every case
// of `approvalDenyFloorCases.ts`, run against the shipped module. The mutation floors run the same cases over mutants.
import { describe, it } from 'vitest';
import * as mod from '../src/coord/approvalDenyFloor.js';
import { APPROVAL_DENY_FLOOR_CASES } from './approvalDenyFloorCases.js';

describe('denyStandingOf and approvalAllowRefusal', () => {
  for (const c of APPROVAL_DENY_FLOOR_CASES) it(c.name, () => c.run(mod));
});

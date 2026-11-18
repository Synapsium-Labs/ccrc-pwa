// The stale deny digest's mutant sets (Overlord approvals PR 0, plan 2026-11-18-overlord-approvals.md Tasks 0.2 to 0.4;
// the floors rule is D-8217): `denyStandingOf` and `approvalClassFloor`, each run against every case of
// `../approvalDenyFloorCases.ts` loaded over the mutated copy of server/src/coord/approvalDenyFloor.ts. Registered in
// mutation-floors.test.ts's MUTANT_SETS, with a floor in mutation-floors.json.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPROVAL_DENY_FLOOR_CASES, type ApprovalDenyFloorModule } from '../approvalDenyFloorCases.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const MODULE_TS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/coord/approvalDenyFloor.ts');

const suite = (mod: ApprovalDenyFloorModule): Record<string, SuiteCase> =>
  Object.fromEntries(APPROVAL_DENY_FLOOR_CASES.map((c) => [c.name, () => c.run(mod)]));

export const DENY_STANDING_SET: MutantSet<ApprovalDenyFloorModule> = {
  modulePath: MODULE_TS,
  mutants: [
    { id: 'DS-2 no shape check on the managed digest', old: 'if (managed === null || !DIGEST.test(managed)) return', new: 'if (managed === null) return' },
    { id: 'DS-3 an unreadable managed file reads the history', old: 'if (managed === null || !DIGEST.test(managed)) return \'none\';', new: 'if (managed !== null && !DIGEST.test(managed)) return \'none\';' },
    { id: 'DS-4 current is never current', old: 'if (child === managed) return \'current\';', new: '' },
    { id: 'DS-5 a history digest is current', old: 'm[1] === child) return \'history\';', new: 'm[1] === child) return \'current\';' },
    { id: 'DS-6 any digest is in the history', old: 'if (m !== null && m[1] === child) return \'history\';', new: 'if (m !== null) return \'history\';' },
    { id: 'DS-7 the bound is never applied', old: '.filter((l) => l !== \'\').slice(-CHILD_DENY_DIGESTS_MAX)', new: '.filter((l) => l !== \'\')' },
    { id: 'DS-8 blank lines count against the bound', old: '.filter((l) => l !== \'\').slice(-CHILD_DENY_DIGESTS_MAX)', new: '.slice(-CHILD_DENY_DIGESTS_MAX)' },
    { id: 'DS-9 the bound is one short', old: '.slice(-CHILD_DENY_DIGESTS_MAX)', new: '.slice(-(CHILD_DENY_DIGESTS_MAX - 1))' },
    { id: 'DS-10 the bound is 33', old: 'export const CHILD_DENY_DIGESTS_MAX = 32;', new: 'export const CHILD_DENY_DIGESTS_MAX = 33;' },
    { id: 'DS-11 the line is not anchored at its start', old: 'const HISTORY_LINE = /^([0-9a-f]{64}) [0-9]{1,16}$/;', new: 'const HISTORY_LINE = /([0-9a-f]{64}) [0-9]{1,16}$/;' },
    { id: 'DS-12 the line is not anchored at its end', old: 'const HISTORY_LINE = /^([0-9a-f]{64}) [0-9]{1,16}$/;', new: 'const HISTORY_LINE = /^([0-9a-f]{64}) [0-9]{1,16}/;' },
    { id: 'DS-13 the time is optional', old: 'const HISTORY_LINE = /^([0-9a-f]{64}) [0-9]{1,16}$/;', new: 'const HISTORY_LINE = /^([0-9a-f]{64})( [0-9]{1,16})?$/;' },
    { id: 'DS-14 any whitespace separates', old: 'const HISTORY_LINE = /^([0-9a-f]{64}) [0-9]{1,16}$/;', new: 'const HISTORY_LINE = /^([0-9a-f]{64})\\s+[0-9]{1,16}$/;' },
    { id: 'DS-15 the time takes any token', old: 'const HISTORY_LINE = /^([0-9a-f]{64}) [0-9]{1,16}$/;', new: 'const HISTORY_LINE = /^([0-9a-f]{64}) \\S{1,16}$/;' },
    { id: 'DS-16 a digest takes upper case', old: 'const DIGEST = /^[0-9a-f]{64}$/;', new: 'const DIGEST = /^[0-9a-fA-F]{64}$/;' },
    { id: 'DS-17 no history is history', old: 'if (history === null) return \'none\';', new: 'if (history === null) return \'history\';' },
    { id: 'DS-18 the history file name', old: 'export const CHILD_DENY_DIGESTS_FILE = \'child-deny.digests\';', new: 'export const CHILD_DENY_DIGESTS_FILE = \'child-deny.digest\';' },
  ],
  suite,
};

export const ALLOW_REFUSAL_SET: MutantSet<ApprovalDenyFloorModule> = {
  modulePath: MODULE_TS,
  mutants: [
    { id: 'AR-1 the allow ignores deny currency', old: ' || !denyCurrent) return \'guard-escalate\';', new: ') return \'guard-escalate\';' },
    { id: 'AR-2 the allow ignores the row class', old: 'if (rowClass !== \'ordinary\' || again', new: 'if (again' },
    { id: 'AR-3 the allow ignores the class again', old: ' || again !== \'ordinary\' || !denyCurrent', new: ' || !denyCurrent' },
    { id: 'AR-4 forbidden on the row not seen', old: 'if (rowClass === \'forbidden\' || again === \'forbidden\')', new: 'if (again === \'forbidden\')' },
    { id: 'AR-5 forbidden again not seen', old: 'if (rowClass === \'forbidden\' || again === \'forbidden\')', new: 'if (rowClass === \'forbidden\')' },
    { id: 'AR-6 currency inverted', old: ' || !denyCurrent) return \'guard-escalate\';', new: ' || denyCurrent) return \'guard-escalate\';' },
    { id: 'AR-7 a stale row is forbidden', old: 'if (rowClass === \'forbidden\' || again === \'forbidden\') return', new: 'if (rowClass === \'forbidden\' || again === \'forbidden\' || !denyCurrent) return' },
    { id: 'AR-8 forbidden answered as escalate', old: '=== \'forbidden\') return \'guard-forbidden\';', new: '=== \'forbidden\') return \'guard-escalate\';' },
  ],
  suite,
};

export const APPROVAL_DENY_FLOOR_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'server/src/coord/approvalDenyFloor.ts#denyStandingOf': DENY_STANDING_SET as MutantSet<never>,
  'server/src/coord/approvalDenyFloor.ts#approvalAllowRefusal': ALLOW_REFUSAL_SET as MutantSet<never>,
};

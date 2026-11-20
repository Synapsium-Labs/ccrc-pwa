// The programme work map WM6's mutant set (D-8780): `epicForOpen` in `server/src/coord/planPolicy.ts`, the epic a run opens
// into, run against every case of `../planEpicForOpenCases.ts` loaded over the mutated copy. Registered in
// mutation-floors.test.ts's MUTANT_SETS, with a floor in mutation-floors.json. The review's reversals are EO-7 (the wave's
// epic chosen before the named ticket's, review 2791 F2) and EO-3 (the named ticket's epic read without its state gate, F5).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EPIC_FOR_OPEN_CASES, type PlanPolicyModule } from '../planEpicForOpenCases.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const POLICY_TS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/coord/planPolicy.ts');
export const EPIC_FOR_OPEN_KEY = 'server/src/coord/planPolicy.ts#epicForOpen';

const suite = (m: PlanPolicyModule): Record<string, SuiteCase> =>
  Object.fromEntries(EPIC_FOR_OPEN_CASES.map((c) => [c.name, () => c.run(m)]));

const WAVELESS = '  const waveless = epics.filter((e) => epicAdmitsRun(e.state) && !listsWaves(e));';
const OWN = '  const own = ticketEpic === null ? undefined : waveless.find((e) => e.id === ticketEpic);';
const CHOOSE = '  if (own !== undefined) return { epicId: own.id };\n  const listed = epicForWave(epics, wave);\n  if (listed !== null) return { epicId: listed };';
const REFUSE = "  return { refused: !named && waveless.length > 0 ? 'ticket-required' : 'wave-epic-mismatch' };";

export const EPIC_FOR_OPEN_SET: MutantSet<PlanPolicyModule> = {
  modulePath: POLICY_TS,
  suite,
  mutants: [
    // The count of epics that list no waves: the lists-waves condition, then the live condition (a dropped epic counts).
    { id: 'EO-1', old: WAVELESS, new: '  const waveless = epics.filter((e) => epicAdmitsRun(e.state));' },
    { id: 'EO-2', old: WAVELESS, new: '  const waveless = epics.filter((e) => !listsWaves(e));' },
    // The named ticket's epic: the state gate (F5), the lists-waves condition, its identity, and the ticket ignored.
    { id: 'EO-3', old: OWN, new: '  const own = ticketEpic === null ? undefined : epics.find((e) => e.id === ticketEpic && !listsWaves(e));' },
    { id: 'EO-4', old: OWN, new: '  const own = ticketEpic === null ? undefined : epics.find((e) => e.id === ticketEpic && epicAdmitsRun(e.state));' },
    { id: 'EO-5', old: OWN, new: '  const own = ticketEpic === null ? undefined : waveless[0];' },
    { id: 'EO-6', old: OWN, new: '  const own: (typeof waveless)[number] | undefined = undefined;' },
    // The order of the choice (F2) and each arm of it.
    { id: 'EO-7', old: CHOOSE, new: '  const listed = epicForWave(epics, wave);\n  if (listed !== null) return { epicId: listed };\n  if (own !== undefined) return { epicId: own.id };' },
    { id: 'EO-8', old: CHOOSE, new: '  if (own !== undefined) return { epicId: own.id };' },
    { id: 'EO-9', old: CHOOSE, new: '  const listed = epicForWave(epics, wave);\n  if (listed !== null) return { epicId: listed };' },
    // The refusal word: the named flag, the live waveless epic, and each word always.
    { id: 'EO-10', old: REFUSE, new: "  return { refused: waveless.length > 0 ? 'ticket-required' : 'wave-epic-mismatch' };" },
    { id: 'EO-11', old: REFUSE, new: "  return { refused: !named ? 'ticket-required' : 'wave-epic-mismatch' };" },
    { id: 'EO-12', old: REFUSE, new: "  return { refused: 'wave-epic-mismatch' };" },
    { id: 'EO-13', old: REFUSE, new: "  return { refused: 'ticket-required' };" },
  ],
};

export const PLAN_EPIC_WAVES_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [EPIC_FOR_OPEN_KEY]: EPIC_FOR_OPEN_SET as MutantSet<never>,
};

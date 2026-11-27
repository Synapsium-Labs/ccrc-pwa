// The request record's deciders (Overlord W2 request record plan, Task A2). The cases live in `requestCases.ts`, shared with the
// mutation floors (`sim/requestSets.ts`), and run here against the real module.
import { describe, it } from 'vitest';
import * as requests from '../src/coord/overlordRequests.js';
import {
  answeredSinceNeedsYouCases, citationVerdictCases, closeUnownedVerdictCases, followUpAfterMoveCases, nextRequestIdCases,
  nextRequestStateCases, openMoveVerdictCases, parentClockAfterChildMoveCases,
} from './requestCases.js';

const SUITES = {
  'nextRequestState (Table 5: the guards in their order, then the fields and the reason)': nextRequestStateCases,
  'openMoveVerdict (the insert\'s own row)': openMoveVerdictCases,
  'followUpAfterMove (RQ6: the clock a move leaves)': followUpAfterMoveCases,
  'parentClockAfterChildMove (F2: the parent\'s clock when its last open child ends)': parentClockAfterChildMoveCases,
  'answeredSinceNeedsYou (the operator\'s answer since the last entry into needs-you)': answeredSinceNeedsYouCases,
  'closeUnownedVerdict (RQ12)': closeUnownedVerdictCases,
  'citationVerdict (Table 6)': citationVerdictCases,
  'nextRequestId (RQ10)': nextRequestIdCases,
} as const;

for (const [title, cases] of Object.entries(SUITES)) {
  describe(title, () => {
    for (const [name, run] of Object.entries(cases(requests))) it(name, run);
  });
}

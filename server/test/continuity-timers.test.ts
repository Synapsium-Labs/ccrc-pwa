import { describe, it } from 'vitest';
import * as timers from '../src/continuity/timers.js';
import {
  packTimerMailCases, timerBodyCases, timerCancelCases, timerCleanupCases, timerPreviewCases, timerSetCases,
} from './sim/timerSets.js';

// The timers' deciders (Overlord W1a, the timers piece, Task 2; spec §3.3.12, C62 to C65). The cases live in
// `sim/timerSets.ts`, written once: this suite runs them against the real module, and `sim/mutation-floors.test.ts` runs
// them against each named mutant.
const SUITES = {
  timerBodyVerdict: timerBodyCases,
  timerSetVerdict: timerSetCases,
  timerCancelVerdict: timerCancelCases,
  timerCleanupVerdict: timerCleanupCases,
  timerPreview: timerPreviewCases,
  packTimerMail: packTimerMailCases,
} as const;

for (const [name, cases] of Object.entries(SUITES)) {
  describe(name, () => {
    for (const [title, run] of Object.entries(cases(timers))) it(title, run);
  });
}

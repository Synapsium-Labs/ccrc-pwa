// The L0 trigger table (Overlord spec §9.7; W1a's stall arms, W1's refusal words): one row per stall arm and per
// Overlord refusal word, one persisted signature form, one reader. The reader's cases are written once in
// `sim/vocabularySets.ts`, so the mutant set `TRIGGER_PARSE_SET` runs the same cases against each mutant.
import { describe, it } from 'vitest';
import * as triggers from '../../shared/practice-triggers.js';
import { triggerParseCases } from './sim/vocabularySets.js';

describe('the trigger table (Overlord spec §9.7, W1a and W1)', () => {
  for (const [name, run] of Object.entries(triggerParseCases(triggers))) it(name, run);
});

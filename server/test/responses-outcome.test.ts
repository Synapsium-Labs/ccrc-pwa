// The response record's seal (Overlord W1, the response record, Task 5: plan
// docs/superpowers/plans/2026-11-14-overlord-w1/w1-responses.md; spec §4.3 Table 4.3b, I18). `responseOutcome`,
// `responseWindowEnd` and `responseSealDue`'s cases live in `sim/responsesSets.ts`, so this suite and the mutation floors
// run the same ones. The vocabulary PR B adds is pinned here too.
import { describe, expect, it } from 'vitest';
import * as responses from '../src/responses.js';
import { responseOutcomeCases, responseSealDueCases, responseWindowEndCases } from './sim/responsesSets.js';
import {
  ACTED_HOWS, PUSH_WINDOW_MS, RESPONSE_OUTCOMES, RESPONSE_RETENTION_DEFAULT_DAYS, RESPONSE_RETENTION_MAX_DAYS,
  RESPONSE_RETENTION_MIN_DAYS, SEAL_DEFER_MS, UNMEASURED_WHYS, WAITING_WINDOW_MS,
} from '../../shared/responses.js';

describe('the outcomes vocabulary (PR B)', () => {
  it('each derived list names exactly the members of its union, in Table 4.3b\'s order', () => {
    expect(RESPONSE_OUTCOMES).toEqual(['acted', 'settled-elsewhere', 'not-actionable', 'unmeasured', 'opened', 'not-opened']);
    expect(ACTED_HOWS).toEqual(['tick', 'answer', 'dismiss', 'act', 'decline', 'correct', 'reply', 'push-action']);
    expect(UNMEASURED_WHYS).toEqual(['no-verdict', 'reader', 'ask-ended', 'receipts']);
  });
  it('the windows and the retention bounds are the plan\'s, and the minimum covers the longest seal path', () => {
    expect([PUSH_WINDOW_MS, WAITING_WINDOW_MS, SEAL_DEFER_MS]).toEqual([86_400_000, 604_800_000, 86_400_000]);
    expect([RESPONSE_RETENTION_DEFAULT_DAYS, RESPONSE_RETENTION_MIN_DAYS, RESPONSE_RETENTION_MAX_DAYS]).toEqual([180, 14, 3_650]);
    expect(RESPONSE_RETENTION_MIN_DAYS * 86_400_000).toBeGreaterThan(WAITING_WINDOW_MS + SEAL_DEFER_MS);
  });
});

describe('responseOutcome', () => {
  for (const [title, run] of Object.entries(responseOutcomeCases(responses))) it(title, run);
});
describe('responseWindowEnd', () => {
  for (const [title, run] of Object.entries(responseWindowEndCases(responses))) it(title, run);
});
describe('responseSealDue', () => {
  for (const [title, run] of Object.entries(responseSealDueCases(responses))) it(title, run);
});

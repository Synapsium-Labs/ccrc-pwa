// The push outbox's L1 deciders (Overlord W1, the push outbox, Task 2: plan
// docs/superpowers/plans/2026-11-14-overlord-w1/w1-push-outbox.md). The cases live in `sim/pushOutboxSets.ts`, so this
// suite and the mutation floors run the same ones.
import { describe, it } from 'vitest';
import * as pushOutbox from '../src/pushOutbox.js';
import {
  asSendVerdictCases, noticePayloadCases, noticeTitleCases, outboxBootVerdictCases, outboxNextStateCases,
  outboxRetryAtCases, pushDueCases,
} from './sim/pushOutboxSets.js';

const SUITES = {
  noticeTitle: noticeTitleCases, noticePayload: noticePayloadCases, asSendVerdict: asSendVerdictCases,
  pushDue: pushDueCases, outboxNextState: outboxNextStateCases, outboxRetryAt: outboxRetryAtCases,
  outboxBootVerdict: outboxBootVerdictCases,
};

for (const [name, cases] of Object.entries(SUITES)) {
  describe(name, () => {
    for (const [title, run] of Object.entries(cases(pushOutbox))) it(title, run);
  });
}

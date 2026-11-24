// The inbox's deciders (Overlord W1, inbox piece, Task 1; `server/src/coord/overlordInbox.ts`, L1). The cases live in
// `./sim/overlordInboxSets.ts`, where `sim/mutation-floors.test.ts` runs them against every mutant too; here they run
// against the real module, beside the recognizer the coordination kebab census takes.
import { describe, expect, it } from 'vitest';
import * as inbox from '../src/coord/overlordInbox.js';
import {
  GATE_WORD_LIST, acknowledgeVerdictCases, composeInboxCases, inboxOrderCases, inboxProbeSourceCases, inboxProbeSourceOfCases, inboxWakeVerdictCases, readCeilingVerdictCases, rowNudgeOfCases,
} from './sim/overlordInboxSets.js';

describe('composeInbox: the one order, a probe round alone, an unmeasured source fails the whole', () => {
  for (const [name, run] of Object.entries(composeInboxCases(inbox))) it(name, run);
});
describe('inboxProbeSource: the open round, read only while the generation is active, never its text', () => {
  for (const [name, run] of Object.entries(inboxProbeSourceCases(inbox))) it(name, run);
});
describe('inboxProbeSourceOf: the reader is called only for an active generation, and its rows are used', () => {
  for (const [name, run] of Object.entries(inboxProbeSourceOfCases(inbox))) it(name, run);
});
describe('inboxOrder: band rank, then each band\'s own key', () => {
  for (const [name, run] of Object.entries(inboxOrderCases(inbox))) it(name, run);
});
describe('rowNudgeOf: the nudge a row has besides the wake', () => {
  for (const [name, run] of Object.entries(rowNudgeOfCases(inbox))) it(name, run);
});
describe('readCeilingVerdict: a ceiling over a rolling hour', () => {
  for (const [name, run] of Object.entries(readCeilingVerdictCases(inbox))) it(name, run);
});
describe('acknowledgeVerdict: settle, already or absent', () => {
  for (const [name, run] of Object.entries(acknowledgeVerdictCases(inbox))) it(name, run);
});
describe('inboxWakeVerdict: the holds in their order, then the rows with no nudge of their own', () => {
  for (const [name, run] of Object.entries(inboxWakeVerdictCases(inbox))) it(name, run);
  it('the gate words the cases walk are the gate\'s own fourteen', () => { expect(GATE_WORD_LIST).toHaveLength(14); });
});

describe('isOverlordInboxKebab: the words this piece spells, and no others', () => {
  it('admits the wake\'s own holds, the row kinds, the nudges, the behind kinds and the wake subject', () => {
    for (const w of [
      'not-designated', 'mail-disabled', 'mail-disabled-unmeasured', 'rows-unmeasured', 'nothing-new',
      'probe-round', 'operator-message', 'message-nudge', 'renewal-feed', 'spot-probe-notice', 'probe-first', 'inbox-wake', 'read-rows',
    ]) expect(inbox.isOverlordInboxKebab(w), w).toBe(true);
  });
  it('refuses a word it does not spell, a gate word and a prototype name', () => {
    for (const w of ['', 'a-b', 'not-the-overlord', 'stale-generation', 'read-ceiling', 'constructor', 'toString', 'inbox', 'probe']) {
      expect(inbox.isOverlordInboxKebab(w), w).toBe(false);
    }
  });
});

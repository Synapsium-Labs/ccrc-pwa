// The act row's deciders' mutant sets (Overlord W2, act rows A, Tasks A2 and A3). The cases are `actCases.ts`, shared with
// `overlord-acts.test.ts`; `mutation-floors.test.ts` runs each set against its textual mutants (D-8217's every-run floors).
// One mutant is left out on purpose: dropping `actSettleVerdict`'s `isActState` checks is equivalent, because a word outside
// `ACT_STATES` names no row of `ACT_TRANSITIONS` either; the checks are there to narrow the stored text's type.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MutantSet, SuiteCase } from './mutate.js';
import {
  actNaturalKeyCases, actSettleVerdictCases, actWriteVerdictCases, countReadableCases, nextActIdCases, writeCountGroupsCases,
  type ActsModule, type CeilingModule,
} from '../actCases.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MODULE = path.join(ROOT, 'server/src/coord/overlordActs.ts');
const KEY = 'server/src/coord/overlordActs.ts';
type M = ActsModule;

const set = (cases: (m: M) => Record<string, SuiteCase>, mutants: MutantSet<M>['mutants']): MutantSet<M> =>
  ({ modulePath: MODULE, mutants, suite: cases });

const KEY_SET = set(actNaturalKeyCases, [
  { id: 'K1 the kind dropped from the key', old: 'JSON.stringify([act, target.kind, target.id, target.revision])', new: 'JSON.stringify([target.kind, target.id, target.revision])' },
  { id: 'K2 the revision dropped from the key', old: 'JSON.stringify([act, target.kind, target.id, target.revision])', new: 'JSON.stringify([act, target.kind, target.id])' },
  { id: 'K3 the target kind dropped from the key', old: 'JSON.stringify([act, target.kind, target.id, target.revision])', new: 'JSON.stringify([act, target.id, target.revision])' },
  { id: 'K4 a start keyed with its kind', old: "JSON.stringify(['start', target.requestId])", new: "JSON.stringify([act, 'start', target.requestId])" },
  { id: 'K5 a start keyed as a request row', old: "JSON.stringify(['start', target.requestId])", new: "JSON.stringify([act, 'request', target.requestId, 0])" },
  { id: 'K6 a bad start request accepted', old: '    if (!isCount(target.requestId)) return null;\n', new: '' },
  { id: 'K7 a target kind outside the list accepted', old: "!(ACT_TARGET_KINDS as readonly string[]).includes(target.kind) || ", new: '' },
  { id: 'K8 a bad id accepted', old: ' || !isCount(target.id) ||', new: ' ||' },
  { id: 'K9 a bad revision accepted', old: ' || !isCount(target.revision)) return null;', new: ') return null;' },
  { id: 'K10 a negative count accepted', old: 'Number.isSafeInteger(n) && n >= 0', new: 'Number.isSafeInteger(n)' },
  { id: 'K11 a fraction accepted', old: "typeof n === 'number' && Number.isSafeInteger(n) && n >= 0", new: "typeof n === 'number' && !Number.isNaN(n) && n >= 0" },
  { id: 'K12 the parts not kept', old: 'kind: target.kind, id: target.id, revision: target.revision };', new: 'kind: target.kind, id: 0, revision: 0 };' },
]);

const ID_SET = set(nextActIdCases, [
  { id: 'I1 the lower of the two', old: 'Math.max(storeHighest', new: 'Math.min(storeHighest' },
  { id: 'I2 the highest itself', old: 'journalHighest ?? 0) + 1;', new: 'journalHighest ?? 0) + 0;' },
  { id: 'I3 the store only', old: 'Math.max(storeHighest ?? 0, journalHighest ?? 0)', new: '(storeHighest ?? 0)' },
  { id: 'I4 the journal only', old: 'Math.max(storeHighest ?? 0, journalHighest ?? 0)', new: '(journalHighest ?? 0)' },
  { id: 'I5 a null store is one', old: 'storeHighest ?? 0', new: 'storeHighest ?? 1' },
  { id: 'I6 a null journal is one', old: 'journalHighest ?? 0', new: 'journalHighest ?? 1' },
]);

const TX = "  if (!f.inTransaction) return { ok: false, error: 'not-in-transaction', detail: 'an act is written only inside the transaction that holds its row' };\n";
const STATE = "  if (!isActState(f.state) || !actMoveAllowed(null, f.state, 'door')) return { ok: false, error: 'bad-row', detail: `state ${f.state}` };\n";
const TARGET = "  if (f.natural === null) return { ok: false, error: 'bad-row', detail: 'target' };\n";
const FAULT = "  if (f.fault !== null) return { ok: false, error: 'bad-row', detail: f.fault };\n";
const OP_U = "  if (isUnmeasured(f.opKeyHolder)) return { ok: false, error: 'unmeasured', detail: `operation key: ${f.opKeyHolder.unmeasured}` };\n";
const OP_H = "  if (f.opKeyHolder !== null) return { ok: false, error: 'op-key-taken', detail: `act ${f.opKeyHolder.id}`, holder: f.opKeyHolder };\n";
const NK_U = "  if (isUnmeasured(f.naturalKeyHolder)) return { ok: false, error: 'unmeasured', detail: `natural key: ${f.naturalKeyHolder.unmeasured}` };\n";
const NK_H = "  if (f.naturalKeyHolder !== null) return { ok: false, error: 'natural-key-taken', detail: `act ${f.naturalKeyHolder.id}`, holder: f.naturalKeyHolder };\n";

const WRITE_SET = set(actWriteVerdictCases, [
  { id: 'W1 the transaction not read', old: TX, new: '' },
  { id: 'W2 the state not read', old: STATE, new: '' },
  { id: 'W3 a state the door does not enter accepted', old: " || !actMoveAllowed(null, f.state, 'door')", new: '' },
  { id: 'W4 the target not read', old: TARGET, new: '' },
  { id: 'W5 the fault not read', old: FAULT, new: '' },
  { id: 'W6 an unread operation key passes', old: OP_U, new: '' },
  { id: 'W7 the operation key\'s holder not read', old: OP_H, new: '' },
  { id: 'W8 the natural key before the operation key', old: OP_U + OP_H + NK_U + NK_H, new: NK_U + NK_H + OP_U + OP_H },
  { id: 'W9 an unread natural key passes', old: NK_U, new: '' },
  { id: 'W10 the natural key\'s holder not read', old: NK_H, new: '' },
  { id: 'W11 the ceiling not read', old: '  if (!f.ceiling.pass) {', new: '  if (false) {' },
  { id: 'W12 an unavailable count passes', old: ": { ok: false, error: 'unmeasured', detail: `count ${f.ceiling.group}: ${f.ceiling.why}` };", new: ': { ok: true };' },
  { id: 'W13 the ceiling before the keys', old: OP_U + OP_H + NK_U + NK_H + '  if (!f.ceiling.pass) {',
    new: "  if (!f.ceiling.pass && f.ceiling.word === 'act-ceiling') return { ok: false, error: 'act-ceiling', detail: '', group: f.ceiling.group };\n" + OP_U + OP_H + NK_U + NK_H + '  if (!f.ceiling.pass) {' },
  { id: 'W14 the shape after the keys', old: TARGET + FAULT + OP_U + OP_H, new: OP_U + OP_H + TARGET + FAULT },
]);

const S_TX = "  if (!f.inTransaction) return { ok: false, error: 'not-in-transaction', detail: 'an act is settled only inside the transaction that holds its row' };\n";
const SETTLE_SET = set(actSettleVerdictCases, [
  { id: 'S1 the transaction not read', old: S_TX, new: '' },
  { id: 'S2 an absent row is a bad move', old: "error: 'not-found', detail: 'no row'", new: "error: 'bad-row', detail: 'no row'" },
  { id: 'S3 the mover not read', old: '!actMoveAllowed(f.stored, f.to, f.by)', new: "!(actMoveAllowed(f.stored, f.to, 'lane') || actMoveAllowed(f.stored, f.to, 'door'))" },
  { id: 'S4 the table not read', old: ' || !actMoveAllowed(f.stored, f.to, f.by)) {', new: ') {' },
  { id: 'S5 from read as pending always', old: "? { ok: true, from: f.stored }", new: "? { ok: true, from: 'pending' }" },
]);

const GROUPS_SET = set(writeCountGroupsCases, [
  { id: 'G1 a group counts every kind', old: "return c.kind === 'counted' && c.group === group;", new: "return c.kind === 'counted';" },
  { id: 'G2 the effect\'s group not read', old: "effect: theirs !== undefined && theirs.kind === 'counted' ? theirs.group : null", new: 'effect: null' },
  { id: 'G3 the act\'s group not read', old: "act: own.kind === 'counted' ? own.group : null", new: 'act: null' },
  { id: 'G4 the effect read as the act', old: "const theirs = effect === null ? undefined : actRow(effect)?.ceiling;", new: 'const theirs = own;' },
]);

const CEILING_KEY = 'server/src/coord/overlordActCeiling.ts';
const GUARD_LINE = "    if (!countReadable(n.count)) return { pass: false, word: 'unavailable', group: n.group, why: UNREADABLE_COUNT, latch: null };\n";
const COUNT_GUARD_SET: MutantSet<CeilingModule> = {
  modulePath: path.join(ROOT, CEILING_KEY), suite: countReadableCases,
  mutants: [
    { id: 'C1 a negative count reads', old: 'Number.isSafeInteger(n) && n >= 0', new: 'Number.isSafeInteger(n)' },
    { id: 'C2 a fraction reads', old: 'Number.isSafeInteger(n) && n >= 0', new: '!Number.isNaN(n) && n >= 0' },
    { id: 'C3 the programme count not read', old: 'return isCount(c.all) && (c.programme === null || isCount(c.programme));', new: 'return isCount(c.all);' },
    { id: 'C4 the count in all not read', old: 'return isCount(c.all) && (c.programme === null || isCount(c.programme));', new: 'return c.programme === null || isCount(c.programme);' },
    { id: 'C5 the step never asks the guard', old: GUARD_LINE, new: '' },
    { id: 'C6 an unreadable count passes', old: GUARD_LINE, new: '    if (!countReadable(n.count)) return { pass: true };\n' },
  ],
};

/** One entry per decider, keyed `<path>#<function>`; `mutation-floors.test.ts` spreads it into `MUTANT_SETS`. */
export const ACT_ROWS_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [`${KEY}#actNaturalKey`]: KEY_SET as MutantSet<never>,
  [`${KEY}#nextActId`]: ID_SET as MutantSet<never>,
  [`${KEY}#actWriteVerdict`]: WRITE_SET as MutantSet<never>,
  [`${KEY}#actSettleVerdict`]: SETTLE_SET as MutantSet<never>,
  [`${KEY}#writeCountGroups`]: GROUPS_SET as MutantSet<never>,
  [`${CEILING_KEY}#countReadable`]: COUNT_GUARD_SET as MutantSet<never>,
};

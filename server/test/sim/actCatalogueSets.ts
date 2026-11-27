// The act catalogue's deciders' oracles and mutant sets (Overlord W2, the act catalogue, plan
// `docs/superpowers/plans/2026-11-16-overlord-w2/w2-act-catalogue.md` §8, F13). The cases are written ONCE here, as suite cases
// over a module: `overlord-act-catalogue.test.ts` and `overlord-act-ceiling.test.ts` run them against the real modules, and
// `mutation-floors.test.ts` runs them against each textual mutant. Every expected value is written out, never read from the
// table the case judges.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CATALOGUE_TS = path.join(ROOT, 'shared/overlord.ts');

export type CatalogueModule = typeof import('../../../shared/overlord.js');
type Row = ReturnType<CatalogueModule['actRow']> & object;

/** A synthetic row, for a lookup a case hands the decider. */
const synthetic = (over: Partial<Row>): Row => ({
  what: 'synthetic', actor: 'overlord', classes: [], answer: false, carrier: false, mayCarry: [], reversibility: 'reversible',
  covers: [], verbClass: 'operate', compensator: null, leastStrength: 'attributed', rungs: { chat: 'allow', advise: 'allow', full: 'allow' },
  ...over,
}) as Row;

// ---------------------------------------------------------------------------------------------------------------- actRow

export function actRowCases(m: CatalogueModule): Record<string, SuiteCase> {
  return {
    'a known kind answers its row': () => {
      expect(m.actRow('relay')).toBe(m.OVERLORD_ACT_KINDS.relay);
      expect(m.actRow('link-team')?.compensator).toBe('operator-relink');
    },
    'a kind the build lacks answers null, inherited names included': () => {
      for (const k of ['', 'set-timer', 'Relay', 'constructor', 'toString', '__proto__', 'hasOwnProperty']) expect(m.actRow(k), k).toBeNull();
    },
    'every listed kind answers a row, and isOverlordActKind agrees with the lookup': () => {
      for (const k of m.OVERLORD_ACT_KIND_LIST) { expect(m.actRow(k), k).not.toBeNull(); expect(m.isOverlordActKind(k)).toBe(true); }
      for (const bad of ['constructor', 'x', null, 1, {}]) expect(m.isOverlordActKind(bad)).toBe(false);
    },
  };
}

// ------------------------------------------------------------------------------------------------------ effectiveClasses

export function effectiveClassesCases(m: CatalogueModule): Record<string, SuiteCase> {
  return {
    'a carrier takes its effect\'s classes, marked effect, and adds none of its own': () => {
      expect(m.effectiveClasses('answer-item', 'secret-or-access')).toEqual([{ member: 'O4', from: 'effect' }]);
      expect(m.effectiveClasses('answer-ask', 'account-management')).toEqual([{ member: 'O1', from: 'effect' }, { member: 'O4', from: 'effect' }]);
      expect(m.effectiveClasses('answer-item', 'close-request')).toEqual([]);
    },
    'a carrier with a class of its own in a synthetic table still reads only the effect\'s': () => {
      const table: Record<string, Row> = { c: synthetic({ carrier: true, answer: true, classes: ['O6'] }), e: synthetic({ classes: ['O2'] }) };
      const lookup = (k: string) => table[k] ?? null;
      expect(m.effectiveClasses('c', 'e', lookup)).toEqual([{ member: 'O2', from: 'effect' }]);
      expect(m.effectiveClasses('c', null, lookup)).toEqual([]);
    },
    'a relay carrying widen-scope gives O3 from the effect': () => {
      expect(m.effectiveClasses('relay', 'widen-scope')).toEqual([{ member: 'O3', from: 'effect' }]);
      expect(m.effectiveClasses('relay', null)).toEqual([]);
    },
    'an act\'s own classes are marked act, and an effect\'s follow them': () => {
      expect(m.effectiveClasses('start-programme', null)).toEqual([{ member: 'O3', from: 'act' }]);
      expect(m.effectiveClasses('account-management', 'spend')).toEqual([{ member: 'O1', from: 'act' }, { member: 'O4', from: 'act' }, { member: 'O2', from: 'effect' }]);
    },
    'an unknown effect adds unknown, and an unknown act is unknown': () => {
      expect(m.effectiveClasses('relay', 'set-timer')).toEqual([{ member: 'unknown', from: 'effect' }]);
      expect(m.effectiveClasses('answer-item', 'no-such')).toEqual([{ member: 'unknown', from: 'effect' }]);
      expect(m.effectiveClasses('no-such', null)).toEqual([{ member: 'unknown', from: 'act' }]);
      expect(m.effectiveClasses('no-such', 'spend')).toEqual([{ member: 'unknown', from: 'act' }, { member: 'O2', from: 'effect' }]);
    },
    'null adds nothing, and class none is empty': () => {
      expect(m.effectiveClasses('read', null)).toEqual([]);
      expect(m.effectiveClasses('link-team', null)).toEqual([]);
    },
  };
}

// --------------------------------------------------------------------------------------------------------- mutant sets

const KEY = 'shared/overlord.ts';
const set = (cases: (m: CatalogueModule) => Record<string, SuiteCase>, mutants: MutantSet<CatalogueModule>['mutants']): MutantSet<CatalogueModule> =>
  ({ modulePath: CATALOGUE_TS, mutants, suite: cases });

const ACT_ROW_SET = set(actRowCases, [
  { id: 'R1 every string is a kind', old: '(isOverlordActKind(kind) ? OVERLORD_ACT_KIND_MAP[kind] : null)', new: '(OVERLORD_ACT_KIND_MAP[kind as OverlordActKind] ?? null)' },
  { id: 'R2 the lookup answers no row', old: '(isOverlordActKind(kind) ? OVERLORD_ACT_KIND_MAP[kind] : null)', new: '(isOverlordActKind(kind) ? null : null)' },
  { id: 'R3 the kind check reads inherited names', old: "return typeof v === 'string' && Object.prototype.hasOwnProperty.call(OVERLORD_ACT_KIND_MAP, v);", new: "return typeof v === 'string' && v in OVERLORD_ACT_KIND_MAP;" },
]);

const EFFECTIVE_CLASSES_SET = set(effectiveClassesCases, [
  { id: 'C1 a carrier reads its own classes', old: ': a.carrier ? [] : a.classes.map(', new: ': a.classes.map(' },
  { id: 'C2 an unknown effect adds nothing', old: "if (e === null) return [...out, { member: 'unknown', from: 'effect' }];", new: 'if (e === null) return out;' },
  { id: 'C3 an unknown act is class none', old: "a === null ? [{ member: 'unknown', from: 'act' }]", new: 'a === null ? []' },
  { id: 'C4 the effect is marked act', old: "e.classes.map((member) => ({ member, from: 'effect' as const }))", new: "e.classes.map((member) => ({ member, from: 'act' as const }))" },
  { id: 'C5 the effect\'s classes are dropped', old: "return [...out, ...e.classes.map((member) => ({ member, from: 'effect' as const }))];", new: 'return out;' },
  { id: 'C6 the act\'s classes are dropped when an effect is carried', old: "return [...out, ...e.classes.map(", new: "return [...e.classes.map(" },
]);

export const ACT_CATALOGUE_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [`${KEY}#actRow`]: ACT_ROW_SET as MutantSet<never>,
  [`${KEY}#effectiveClasses`]: EFFECTIVE_CLASSES_SET as MutantSet<never>,
};

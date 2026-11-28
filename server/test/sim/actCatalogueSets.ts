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
  covers: [], verbClass: 'operate', compensator: null, ceiling: { kind: 'never' }, leastStrength: 'attributed',
  rungs: { chat: 'allow', advise: 'allow', full: 'allow' },
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

// ------------------------------------------------------------------------------------------------------- actCeilingStep

export type CeilingModule = typeof import('../../src/coord/overlordActCeiling.js');
type Counts = Parameters<CeilingModule['actCeilingStep']>[2];
type Count = Counts['act'];

/** Table 5 written out (question 19 as proposed): each group's kinds, per programme and in all. */
export const TABLE_5: Readonly<Record<string, { kinds: readonly string[]; perProgramme: number | null; all: number }>> = {
  relay: { kinds: ['relay', 'nudge-owner'], perProgramme: 6, all: 30 },
  request: { kinds: ['close-request', 'drop-request', 'escalate-request'], perProgramme: 6, all: 30 },
  brief: { kinds: ['attach-brief'], perProgramme: 6, all: 30 },
  'operator-reach': { kinds: ['raise-item', 'escalate', 'return-over-asked', 'object'], perProgramme: 3, all: 10 },
  proposal: { kinds: ['propose-grant', 'propose-command', 'propose-retire', 'propose-practice'], perProgramme: 1, all: 6 },
  answer: { kinds: ['answer-item', 'answer-ask'], perProgramme: 6, all: 30 },
  'o3-effect': { kinds: ['approve-spec', 'approve-dod', 'widen-scope'], perProgramme: 1, all: 3 },
  fact: { kinds: ['state-a-fact'], perProgramme: 3, all: 10 },
  start: { kinds: ['start-programme'], perProgramme: 1, all: 2 },
  rekick: { kinds: ['rekick-coordinator'], perProgramme: 1, all: 3 },
  'own-record': { kinds: ['open-request', 'model-write', 'seal-prediction'], perProgramme: null, all: 60 },
};
/** Table 6 and the ruled fourth kind: the kinds whose bound an owner holds. */
export const HELD_BY: readonly string[] = ['read', 'write-note', 'acknowledge', 'renew', 'link-team'];
const groupOfKind = (k: string): string | null => Object.entries(TABLE_5).find(([, g]) => g.kinds.includes(k))?.[0] ?? null;

/** §5's rule, written from the plan's text and not from the decider: the needed counts (the act's group if counted, the
 *  effect's if asked and counted), any not asked or unmeasured is unavailable, then each needed group in all, then for the
 *  programme. Answers the word, the group and the scope, or pass. Where the plan and the coordinator part, it follows the
 *  coordinator's item 8 (call 1874): a needed count not asked refuses, never passes, so the act's count not asked refuses
 *  where the plan's question 10 had the door's call leave it unasked; the door asks both counts instead. */
function ceilingOracle(act: string, effect: string | null, c: Counts): string {
  const needed: [string, Count][] = [];
  const a = groupOfKind(act);
  if (a !== null) needed.push([a, c.act]);
  const e = effect === null || c.effect === 'not-asked' ? null : groupOfKind(effect);
  if (e !== null) needed.push([e, c.effect]);
  for (const [g, n] of needed) if (n === 'not-asked' || n.kind === 'unmeasured') return `unavailable:${g}`;
  for (const [g, n] of needed) {
    const t = TABLE_5[g]!;
    const k = n as Extract<Count, { kind: 'counted' }>;
    if (k.all >= t.all) return `act-ceiling:${g}:all`;
    if (t.perProgramme !== null && k.programme !== null && k.programme >= t.perProgramme) return `act-ceiling:${g}:programme`;
  }
  return 'pass';
}
const said = (v: ReturnType<CeilingModule['actCeilingStep']>): string =>
  (v.pass ? 'pass' : v.word === 'unavailable' ? `unavailable:${v.group}` : `act-ceiling:${v.group}:${v.scope}`);

/** Counts at, under and over each limit for a group, with and without a programme target, and the two arms that refuse. */
function countsFor(group: string | null): Count[] {
  const t = group === null ? { perProgramme: 1, all: 2 } : TABLE_5[group]!;
  const pp = t.perProgramme ?? 5;
  const out: Count[] = ['not-asked', { kind: 'unmeasured', why: 'not-wired' }];
  for (const all of [0, t.all - 1, t.all, t.all + 1]) for (const programme of [null, 0, pp - 1, pp, pp + 1]) {
    out.push({ kind: 'counted', programme: programme === null ? null : Math.min(programme, all), all });
  }
  return out;
}

export function actCeilingStepCases(m: CeilingModule, kinds: readonly string[]): Record<string, SuiteCase> {
  return {
    'every kind against every count of its group, with no effect, agrees with the oracle written from §5': () => {
      for (const act of kinds) for (const count of countsFor(groupOfKind(act))) {
        const counts = { act: count, effect: 'not-asked' as const };
        expect(said(m.actCeilingStep(act as never, null, counts)), `${act} ${JSON.stringify(count)}`).toBe(ceilingOracle(act, null, counts));
      }
    },
    'a held-by or never kind passes and reads no count, whatever the count holds': () => {
      for (const act of [...HELD_BY, 'accept-limit', 'deploy', 'live-box-act', 'spend']) for (const count of countsFor(null)) {
        expect(m.actCeilingStep(act as never, null, { act: count, effect: 'not-asked' }), act).toEqual({ pass: true });
      }
    },
    'a carrier refuses on its effect\'s count, and the effect is checked after the act': () => {
      const under = { kind: 'counted', programme: 0, all: 0 } as const;
      for (const [effect, group] of [['widen-scope', 'o3-effect'], ['start-programme', 'start'], ['close-request', 'request']] as const) {
        const t = TABLE_5[group]!;
        const over = { kind: 'counted', programme: 0, all: t.all } as const;
        expect(said(m.actCeilingStep('answer-item', effect, { act: under, effect: over })), effect).toBe(`act-ceiling:${group}:all`);
        expect(said(m.actCeilingStep('answer-item', effect, { act: under, effect: { kind: 'unmeasured', why: 'u' } })), effect).toBe(`unavailable:${group}`);
        expect(said(m.actCeilingStep('answer-item', effect, { act: { kind: 'counted', programme: 0, all: 30 }, effect: over })), effect).toBe('act-ceiling:answer:all');
        expect(m.actCeilingStep('answer-item', effect, { act: under, effect: 'not-asked' }), effect).toEqual({ pass: true });
      }
      // a relay carrying a widening counts in both groups (question 10)
      expect(said(m.actCeilingStep('relay', 'widen-scope', { act: { kind: 'counted', programme: 0, all: 0 }, effect: { kind: 'counted', programme: 1, all: 1 } }))).toBe('act-ceiling:o3-effect:programme');
    },
    'an unmeasured count refuses before any ceiling is read, its own or the effect\'s': () => {
      const over = { kind: 'counted', programme: 0, all: 99 } as const;
      expect(said(m.actCeilingStep('relay', 'widen-scope', { act: over, effect: { kind: 'unmeasured', why: 'u' } }))).toBe('unavailable:o3-effect');
      expect(said(m.actCeilingStep('relay', 'widen-scope', { act: 'not-asked', effect: over }))).toBe('unavailable:relay');
      expect(said(m.actCeilingStep('relay', 'widen-scope', { act: { kind: 'unmeasured', why: 'u' }, effect: over }))).toBe('unavailable:relay');
    },
    'the two calls the contract names: step 10 asks the act\'s count only, the door that gathers the effect\'s verdict asks both': () => {
      // call 1874: step 10's early call passes the act's count and the effect's as not asked; PR B's door passes both read.
      const under = { kind: 'counted', programme: 0, all: 0 } as const;
      expect(m.actCeilingStep('answer-item', 'approve-spec', { act: under, effect: 'not-asked' })).toEqual({ pass: true });
      expect(m.actCeilingStep('answer-item', 'approve-spec', { act: under, effect: under })).toEqual({ pass: true });
      expect(m.actCeilingStep('answer-item', 'approve-spec', { act: under, effect: { kind: 'counted', programme: 0, all: 3 } }))
        .toEqual({ pass: false, word: 'act-ceiling', group: 'o3-effect', scope: 'all', limit: 3, latch: 'act-ceiling-hit' });
      expect(m.actCeilingStep('answer-item', 'approve-spec', { act: under, effect: { kind: 'counted', programme: 1, all: 1 } }))
        .toEqual({ pass: false, word: 'act-ceiling', group: 'o3-effect', scope: 'programme', limit: 1, latch: 'act-ceiling-hit' });
    },
    'an effect the build lacks, or one whose ceiling is not counted, adds no check': () => {
      const under = { kind: 'counted', programme: 0, all: 0 } as const;
      for (const effect of ['no-such', 'read', 'deploy', 'link-team']) {
        expect(m.actCeilingStep('answer-ask', effect, { act: under, effect: { kind: 'unmeasured', why: 'u' } }), effect).toEqual({ pass: true });
      }
    },
    'an act-ceiling verdict names act-ceiling-hit and its limit, and an unavailable one names no latch': () => {
      expect(m.actCeilingStep('relay', null, { act: { kind: 'counted', programme: null, all: 30 }, effect: 'not-asked' }))
        .toEqual({ pass: false, word: 'act-ceiling', group: 'relay', scope: 'all', limit: 30, latch: 'act-ceiling-hit' });
      expect(m.actCeilingStep('escalate-request', null, { act: { kind: 'counted', programme: 6, all: 6 }, effect: 'not-asked' }))
        .toEqual({ pass: false, word: 'act-ceiling', group: 'request', scope: 'programme', limit: 6, latch: 'act-ceiling-hit' });
      expect(m.actCeilingStep('relay', null, { act: { kind: 'unmeasured', why: 'not-wired' }, effect: 'not-asked' }))
        .toEqual({ pass: false, word: 'unavailable', group: 'relay', why: 'not-wired', latch: null });
      expect(m.actCeilingStep('relay', null, { act: 'not-asked', effect: 'not-asked' }))
        .toEqual({ pass: false, word: 'unavailable', group: 'relay', why: "the act's count was not asked", latch: null });
    },
    'a group with no per-programme ceiling counts in all only, and a null programme count is no target': () => {
      expect(m.actCeilingStep('open-request', null, { act: { kind: 'counted', programme: 1000, all: 59 }, effect: 'not-asked' })).toEqual({ pass: true });
      expect(said(m.actCeilingStep('open-request', null, { act: { kind: 'counted', programme: 0, all: 60 }, effect: 'not-asked' }))).toBe('act-ceiling:own-record:all');
      expect(m.actCeilingStep('start-programme', null, { act: { kind: 'counted', programme: null, all: 1 }, effect: 'not-asked' })).toEqual({ pass: true });
      expect(said(m.actCeilingStep('start-programme', null, { act: { kind: 'counted', programme: 1, all: 1 }, effect: 'not-asked' }))).toBe('act-ceiling:start:programme');
    },
  };
}

export function ceilingLatchDueCases(m: CeilingModule): Record<string, SuiteCase> {
  return {
    'the cause is raised when none stands, or when standing could not be read': () => {
      expect(m.ceilingLatchDue('act-ceiling-hit', false)).toBe(true);
      expect(m.ceilingLatchDue('act-ceiling-hit', 'unmeasured')).toBe(true);
    },
    'unless one stands': () => { expect(m.ceilingLatchDue('act-ceiling-hit', true)).toBe(false); },
    'a refusal that names no cause raises nothing, whatever stands': () => {
      for (const s of [true, false, 'unmeasured'] as const) {
        expect(m.ceilingLatchDue(null, s)).toBe(false);
        expect(m.ceilingLatchDue(undefined, s)).toBe(false);
        expect(m.ceilingLatchDue('other-cause' as never, s)).toBe(false);
      }
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

const CEILING_TS = path.join(ROOT, 'server/src/coord/overlordActCeiling.ts');
const CEILING_KEY = 'server/src/coord/overlordActCeiling.ts';
const ALL_KINDS = [...Object.values(TABLE_5).flatMap((g) => g.kinds), ...HELD_BY, 'accept-limit', 'deploy', 'spend'];
const CEILING_SET: MutantSet<CeilingModule> = {
  modulePath: CEILING_TS, suite: (m) => actCeilingStepCases(m, ALL_KINDS),
  mutants: [
    // The plan's Step 5 hand mutations, and the rest of §5's rule.
    { id: 'A1 > in the all check', old: 'if (count.all >= ceiling.all)', new: 'if (count.all > ceiling.all)' },
    { id: 'A2 > in the programme check', old: 'count.programme >= ceiling.perProgramme', new: 'count.programme > ceiling.perProgramme' },
    { id: 'A3 unmeasured read as zero', old: "    if (n.count.kind === 'unmeasured') return { pass: false, word: 'unavailable', group: n.group, why: n.count.why, latch: null };\n", new: "    if (n.count.kind === 'unmeasured') { counted.push({ group: n.group, count: { kind: 'counted', programme: 0, all: 0 } }); continue; }\n" },
    { id: 'A4 the effect\'s count skipped', old: "if (theirs !== undefined && theirs.kind === 'counted') needed.push(", new: 'if (false) needed.push(' },
    { id: 'A5 not-asked passes', old: "if (counts.act === 'not-asked') return { pass: false, word: 'unavailable', group: own.group, why: \"the act's count was not asked\", latch: null };", new: "if (counts.act === 'not-asked') return { pass: true };" },
    { id: 'A6 the act\'s count skipped', old: '    needed.push({ group: own.group, count: counts.act });\n', new: '' },
    { id: 'A7 a held-by kind is counted', old: 'const own = OVERLORD_ACT_KINDS[act].ceiling;', new: "const own0 = OVERLORD_ACT_KINDS[act].ceiling; const own = (own0.kind === 'held-by' ? { kind: 'counted', group: 'relay' } : own0) as typeof own0;" },
    { id: 'A8 a null programme refuses', old: 'count.programme !== null && count.programme >=', new: 'count.programme === null || count.programme >=' },
    { id: 'A9 no per-programme ceiling reads as zero', old: 'ceiling.perProgramme !== null && count.programme', new: 'count.programme' },
    { id: 'A10 the programme scope reported as all', old: "scope: 'programme', limit: ceiling.perProgramme", new: "scope: 'all', limit: ceiling.perProgramme" },
    { id: 'A11 the latch dropped', old: "scope: 'all', limit: ceiling.all, latch: ACT_CEILING_LATCH", new: "scope: 'all', limit: ceiling.all, latch: null" },
    { id: 'A12 the programme limit is the all limit', old: "limit: ceiling.perProgramme, latch", new: 'limit: ceiling.all, latch' },
    { id: 'A13 ceilings read before every count is measured', old: '  for (const n of needed) {\n    if (n.count', new: '  for (const n of needed) {\n    const r = n.count.kind === \'counted\' ? overGroup(n.group, n.count) : null;\n    if (r !== null) return r;\n    if (n.count' },
    // A not-asked effect is dropped before it is needed (call 1874), so asking it reads nothing; the mutant that bites is one
    // that refuses it.
    { id: 'A14 an effect not asked refuses', old: "  if (effect !== null && counts.effect !== 'not-asked') {\n", new: "  if (effect !== null && counts.effect === 'not-asked' && actRow(effect)?.ceiling.kind === 'counted') return { pass: false, word: 'unavailable', group: 'answer', why: 'not asked', latch: null };\n  if (effect !== null && counts.effect !== 'not-asked') {\n" },
  ],
};
const LATCH_DUE_SET: MutantSet<CeilingModule> = {
  modulePath: CEILING_TS, suite: ceilingLatchDueCases,
  mutants: [
    { id: 'L1 raised when one stands', old: "latch === ACT_CEILING_LATCH && standing !== true", new: 'latch === ACT_CEILING_LATCH' },
    { id: 'L2 raised on a refusal naming no cause', old: "latch === ACT_CEILING_LATCH && standing !== true", new: 'standing !== true' },
    { id: 'L3 an unmeasured standing does not raise', old: "standing !== true;", new: 'standing === false;' },
  ],
};

export const ACT_CATALOGUE_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [`${KEY}#actRow`]: ACT_ROW_SET as MutantSet<never>,
  [`${KEY}#effectiveClasses`]: EFFECTIVE_CLASSES_SET as MutantSet<never>,
  [`${CEILING_KEY}#actCeilingStep`]: CEILING_SET as MutantSet<never>,
  [`${CEILING_KEY}#ceilingLatchDue`]: LATCH_DUE_SET as MutantSet<never>,
};

// The ladder's deciders' oracles and mutant sets (Overlord W1 ladder, plan `w1-ladder.md` Task 1). The cases are written
// ONCE here, as suite cases over a module: `overlord-ladder.test.ts` runs them against the real module, and
// `mutation-floors.test.ts` runs them against each textual mutant (D-8217's every-run floors).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import {
  LADDER_CAUSE_MAP, RUNGS, rungRank, type ConditionReading, type LadderCauseRow, type Rung,
} from '../../../shared/overlord-ladder.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const LADDER_TS = path.join(ROOT, 'server/src/coord/overlordLadder.ts');

export type LadderModule = typeof import('../../src/coord/overlordLadder.js');
type Facts = Parameters<LadderModule['effectiveRung']>[0];
type Current = Parameters<LadderModule['rungMoveVerdict']>[0];

// ------------------------------------------------------------------------------------------------------------ fixtures

const ROUTE = 'overlord-route-v1';
const ANSWER = 'overlord-answer-v1';
const row = (kind: 'latch' | 'condition', effect: LadderCauseRow['effect']): LadderCauseRow =>
  ({ kind, effect, notice: 'none', spec: 'synthetic' });

/** One row per effect shape and cap. Latches are the cap rows; `condition-cap` is a condition with a fixed cap. */
const SYNTHETIC: Readonly<Record<string, LadderCauseRow>> = {
  'latch-off': row('latch', { kind: 'cap', cap: 'off' }),
  'latch-chat': row('latch', { kind: 'cap', cap: 'chat' }),
  'latch-a': row('latch', { kind: 'cap', cap: 'advise' }),
  'latch-full': row('latch', { kind: 'cap', cap: 'full' }),
  'condition-cap': row('condition', { kind: 'cap', cap: 'advise' }),
  'condition-a': row('condition', { kind: 'one-under-operator', floor: 'chat' }),
  'condition-b': row('condition', { kind: 'read-by', reader: 'launch-profile-unmet' }),
  'condition-words': row('condition', { kind: 'server-words' }),
};
const LATCHES: readonly { cause: string; cap: Rung }[] = [
  { cause: 'latch-off', cap: 'off' }, { cause: 'latch-chat', cap: 'chat' },
  { cause: 'latch-a', cap: 'advise' }, { cause: 'latch-full', cap: 'full' },
];
const CONDITION_CAUSES = ['condition-cap', 'condition-a', 'condition-b', 'condition-words'] as const;
const READINGS: readonly ConditionReading[] = ['standing', 'lifted', 'unmeasured'];

const facts = (over: Partial<Facts> = {}): Facts => ({
  operatorRung: { kind: 'set', rung: 'full' }, latches: [], conditions: [], causeTable: SYNTHETIC,
  serverCaps: [ROUTE, ANSWER], ...over,
});
const setRung = (rung: Rung): Facts['operatorRung'] => ({ kind: 'set', rung });
const cond = (cause: string, reading: ConditionReading) => ({ cause, reading });

// ------------------------------------------------------------------------------------------------------- effectiveRung

/** The W0 model's rule, written again from the rank arithmetic and not from the decider: the lowest of the operator's
 *  rung and every cap that applies. */
function oracle(f: Facts): Rung {
  const op = f.operatorRung.kind === 'set' ? rungRank(f.operatorRung.rung) : rungRank('chat');
  const held = RUNGS.filter((r) => { const need = r === 'advise' ? ROUTE : r === 'full' ? ANSWER : null; return need === null || f.serverCaps.includes(need); });
  const highest = Math.max(...held.map(rungRank));
  const caps: number[] = [op];
  for (const l of f.latches) caps.push(rungRank(l.cap));
  for (const c of f.conditions) {
    if (c.reading === 'lifted') continue;
    const r = f.causeTable[c.cause]!;
    if (r.effect.kind === 'cap') caps.push(rungRank(r.effect.cap));
    else if (r.effect.kind === 'one-under-operator') caps.push(Math.max(rungRank(r.effect.floor), op - 1));
    else if (r.effect.kind === 'server-words') caps.push(highest);
  }
  return RUNGS[Math.min(...caps)]!;
}

/** Every facts value of the synthetic table: each operator rung and the default, each subset of the four latches,
 *  each condition absent or in each of three readings, several server word sets. */
function* allFacts(): Generator<Facts> {
  const operators: Facts['operatorRung'][] = [...RUNGS.map(setRung), { kind: 'default' }];
  const wordSets: string[][] = [[], [ROUTE], [ANSWER], [ROUTE, ANSWER]];
  for (const operatorRung of operators) {
    for (let mask = 0; mask < 1 << LATCHES.length; mask++) {
      const latches = LATCHES.filter((_, i) => (mask & (1 << i)) !== 0);
      const states = READINGS.length + 1;
      for (let c = 0; c < states ** CONDITION_CAUSES.length; c++) {
        const conditions: { cause: string; reading: ConditionReading }[] = [];
        let rest = c;
        for (const cause of CONDITION_CAUSES) {
          const s = rest % states; rest = Math.floor(rest / states);
          if (s > 0) conditions.push(cond(cause, READINGS[s - 1]!));
        }
        for (const serverCaps of wordSets) yield facts({ operatorRung, latches, conditions, serverCaps });
      }
    }
  }
}

/** The narrower facts one input away from `f`: a lower operator rung, a latch added, a condition's reading made
 *  `standing` or `unmeasured` (or the condition added), a server word removed. */
function* narrowings(f: Facts): Generator<Facts> {
  const op = f.operatorRung.kind === 'set' ? f.operatorRung.rung : 'chat';
  for (const r of RUNGS) if (rungRank(r) < rungRank(op)) yield { ...f, operatorRung: setRung(r) };
  for (const l of LATCHES) if (!f.latches.some((x) => x.cause === l.cause)) yield { ...f, latches: [...f.latches, l] };
  for (const cause of CONDITION_CAUSES) {
    const at = f.conditions.find((c) => c.cause === cause);
    for (const reading of ['standing', 'unmeasured'] as const) {
      if (at?.reading === reading) continue;
      if (at !== undefined && at.reading !== 'lifted') continue;
      yield { ...f, conditions: [...f.conditions.filter((c) => c.cause !== cause), cond(cause, reading)] };
    }
  }
  for (const w of f.serverCaps) yield { ...f, serverCaps: f.serverCaps.filter((x) => x !== w) };
}

export function effectiveRungCases(m: LadderModule): Record<string, SuiteCase> {
  const eff = (over: Partial<Facts>) => m.effectiveRung(facts(over));
  return {
    'the default reads chat, reports it as the operator rung, and binds nothing': () => {
      expect(eff({ operatorRung: { kind: 'default' } })).toEqual({ rung: 'chat', operatorRung: 'chat', binding: [], readBy: [] });
    },
    'a set rung with no cause reads as itself, at every rung': () => {
      for (const r of RUNGS) expect(eff({ operatorRung: setRung(r) })).toEqual({ rung: r, operatorRung: r, binding: [], readBy: [] });
    },
    'a latch caps at its stored cap, and is bound when its cap is at or below the result': () => {
      const r = eff({ latches: [{ cause: 'latch-a', cap: 'advise' }] });
      expect(r.rung).toBe('advise');
      expect(r.binding).toEqual([{ cause: 'latch-a', kind: 'latch', cap: 'advise', reading: 'standing', known: true }]);
    },
    'operatorRung reports the operator\'s own rung even when a cap holds the result lower': () => {
      const r = eff({ latches: [{ cause: 'latch-chat', cap: 'chat' }] });
      expect([r.rung, r.operatorRung]).toEqual(['chat', 'full']);
    },
    'a latch above the operator rung caps nothing and is not bound': () => {
      const r = eff({ operatorRung: setRung('chat'), latches: [{ cause: 'latch-a', cap: 'advise' }] });
      expect(r).toEqual({ rung: 'chat', operatorRung: 'chat', binding: [], readBy: [] });
    },
    'a latch whose cap equals the operator rung is bound (at or below, not strictly below)': () => {
      const r = eff({ operatorRung: setRung('advise'), latches: [{ cause: 'latch-a', cap: 'advise' }] });
      expect(r.rung).toBe('advise');
      expect(r.binding.map((b) => b.cause)).toEqual(['latch-a']);
    },
    'a latch caps by its STORED cap, never the table\'s': () => {
      const r = eff({ latches: [{ cause: 'latch-a', cap: 'chat' }] });
      expect(r.rung).toBe('chat');
      expect(r.binding[0]).toMatchObject({ cause: 'latch-a', cap: 'chat', known: true });
    },
    'an unknown latch caps with known false': () => {
      const r = eff({ latches: [{ cause: 'latch-z', cap: 'chat' }] });
      expect(r.rung).toBe('chat');
      expect(r.binding).toEqual([{ cause: 'latch-z', kind: 'latch', cap: 'chat', reading: 'standing', known: false }]);
    },
    'a latch whose cause the table holds as a condition is not known': () => {
      const r = eff({ latches: [{ cause: 'condition-a', cap: 'chat' }] });
      expect(r.rung).toBe('chat');
      expect(r.binding[0]).toMatchObject({ cause: 'condition-a', known: false });
    },
    'a cause named like an Object.prototype member is unknown, not found on the prototype': () => {
      const r = eff({ latches: [{ cause: 'constructor', cap: 'off' }] });
      expect(r.rung).toBe('off');
      expect(r.binding[0]).toMatchObject({ cause: 'constructor', known: false });
      const c = eff({ conditions: [cond('toString', 'standing')] });
      expect(c.rung).toBe('off');
      expect(c.binding[0]).toMatchObject({ cause: 'toString', kind: 'condition', cap: 'off', known: false });
    },
    'a condition the cause table lacks applies cap off and is bound with known false (amendment 3)': () => {
      for (const reading of ['standing', 'unmeasured'] as const) {
        const r = eff({ conditions: [cond('condition-z', reading)] });
        expect(r.rung).toBe('off');
        expect(r.binding).toEqual([{ cause: 'condition-z', kind: 'condition', cap: 'off', reading, known: false }]);
      }
      expect(eff({ conditions: [cond('condition-z', 'lifted')] }).rung).toBe('full');
    },
    'a condition the table holds as a latch is unknown too, and fails closed': () => {
      const r = eff({ conditions: [cond('latch-a', 'standing')] });
      expect(r.rung).toBe('off');
      expect(r.binding[0]).toMatchObject({ cause: 'latch-a', kind: 'condition', known: false });
    },
    'a fixed-cap condition caps when standing or unmeasured and does nothing when lifted': () => {
      expect(eff({ conditions: [cond('condition-cap', 'standing')] }).rung).toBe('advise');
      expect(eff({ conditions: [cond('condition-cap', 'unmeasured')] }).rung).toBe('advise');
      expect(eff({ conditions: [cond('condition-cap', 'lifted')] })).toEqual({ rung: 'full', operatorRung: 'full', binding: [], readBy: [] });
    },
    'an unmeasured condition is bound as unmeasured, never as standing': () => {
      expect(eff({ conditions: [cond('condition-cap', 'unmeasured')] }).binding)
        .toEqual([{ cause: 'condition-cap', kind: 'condition', cap: 'advise', reading: 'unmeasured', known: true }]);
      expect(eff({ conditions: [cond('condition-cap', 'standing')] }).binding[0]!.reading).toBe('standing');
    },
    'one-under-operator caps one rung under the operator, never under its floor': () => {
      const at = (r: Rung, reading: ConditionReading = 'standing') => eff({ operatorRung: setRung(r), conditions: [cond('condition-a', reading)] }).rung;
      expect(at('full')).toBe('advise');
      expect(at('advise')).toBe('chat');
      expect(at('chat')).toBe('chat');
      expect(at('off')).toBe('off');
      expect(at('full', 'unmeasured')).toBe('advise');
      expect(at('full', 'lifted')).toBe('full');
    },
    'one-under-operator at the default reads chat, and is bound only when its cap is at or below the result': () => {
      const full = eff({ conditions: [cond('condition-a', 'standing')] });
      expect(full.binding).toEqual([{ cause: 'condition-a', kind: 'condition', cap: 'advise', reading: 'standing', known: true }]);
      const chat = eff({ operatorRung: setRung('chat'), conditions: [cond('condition-a', 'standing')] });
      expect(chat.binding.map((b) => b.cause)).toEqual(['condition-a']);
      expect(eff({ operatorRung: setRung('off'), conditions: [cond('condition-a', 'standing')] }).binding).toEqual([]);
    },
    'a read-by condition caps nothing and is listed in readBy, never in binding': () => {
      const r = eff({ conditions: [cond('condition-b', 'standing')] });
      expect(r).toEqual({ rung: 'full', operatorRung: 'full', binding: [],
        readBy: [{ cause: 'condition-b', reader: 'launch-profile-unmet', reading: 'standing' }] });
      expect(eff({ conditions: [cond('condition-b', 'unmeasured')] }).readBy[0]!.reading).toBe('unmeasured');
      expect(eff({ conditions: [cond('condition-b', 'lifted')] }).readBy).toEqual([]);
    },
    'binding lists exactly the causes at or below the result': () => {
      const r = eff({
        latches: [{ cause: 'latch-a', cap: 'advise' }, { cause: 'latch-chat', cap: 'chat' }],
        conditions: [cond('condition-cap', 'standing'), cond('condition-a', 'lifted')],
      });
      expect(r.rung).toBe('chat');
      expect(r.binding.map((b) => b.cause)).toEqual(['latch-chat']);
      const s = eff({ latches: [{ cause: 'latch-a', cap: 'advise' }, { cause: 'latch-full', cap: 'full' }], conditions: [cond('condition-cap', 'standing')] });
      expect(s.rung).toBe('advise');
      expect(s.binding.map((b) => b.cause)).toEqual(['latch-a', 'condition-cap']);
    },
    'the production table: a degraded generation caps chat, and a lifted one does nothing': () => {
      const f = facts({ causeTable: LADDER_CAUSE_MAP, conditions: [cond('generation-degraded', 'standing')] });
      expect(m.effectiveRung(f)).toMatchObject({ rung: 'chat', binding: [{ cause: 'generation-degraded', known: true }] });
      expect(m.effectiveRung({ ...f, conditions: [cond('generation-degraded', 'lifted')] }).rung).toBe('full');
    },
    'rung-word-missing: an operator advise over a server without the route word reads chat, naming the cause (amendment 2)': () => {
      const noWord = { operatorRung: setRung('advise'), serverCaps: [] as string[], causeTable: LADDER_CAUSE_MAP };
      const reading = m.rungWordReading({ kind: 'rung', rung: 'advise' }, noWord.serverCaps);
      expect(reading).toBe('standing');
      const r = m.effectiveRung(facts({ ...noWord, conditions: [cond('rung-word-missing', reading)] }));
      expect(r.rung).toBe('chat');
      expect(r.binding).toEqual([{ cause: 'rung-word-missing', kind: 'condition', cap: 'chat', reading: 'standing', known: true }]);
      const held = { ...noWord, serverCaps: [ROUTE] };
      const lifted = m.rungWordReading({ kind: 'rung', rung: 'advise' }, held.serverCaps);
      expect(lifted).toBe('lifted');
      expect(m.effectiveRung(facts({ ...held, conditions: [cond('rung-word-missing', lifted)] })).rung).toBe('advise');
    },
    'a server-words condition caps at the highest held rung, standing or unmeasured': () => {
      const at = (serverCaps: string[], reading: ConditionReading) =>
        eff({ serverCaps, conditions: [cond('condition-words', reading)] }).rung;
      expect(at([], 'standing')).toBe('chat');
      expect(at([], 'unmeasured')).toBe('chat');
      expect(at([ROUTE], 'standing')).toBe('advise');
      expect(at([ROUTE, ANSWER], 'standing')).toBe('full');
      expect(at([ANSWER], 'standing')).toBe('full');
      expect(at([], 'lifted')).toBe('full');
    },
    'the lowest of every cap wins, not the highest and not the first': () => {
      const r = eff({ latches: [{ cause: 'latch-full', cap: 'full' }, { cause: 'latch-chat', cap: 'chat' }, { cause: 'latch-a', cap: 'advise' }] });
      expect(r.rung).toBe('chat');
      expect(eff({ latches: [{ cause: 'latch-a', cap: 'advise' }, { cause: 'latch-chat', cap: 'chat' }] }).rung).toBe('chat');
    },
    'the operator rung is part of the minimum': () => {
      expect(eff({ operatorRung: setRung('off'), latches: [{ cause: 'latch-full', cap: 'full' }] }).rung).toBe('off');
    },
    'PROPERTY: the result is the oracle\'s lowest cap, and narrowing any one input never raises it': () => {
      const rank = (r: Rung): number => rungRank(r);
      let n = 0;
      for (const f of allFacts()) {
        const got = m.effectiveRung(f);
        n++;
        if (got.rung !== oracle(f)) throw new Error(`oracle ${oracle(f)} != ${got.rung} for ${JSON.stringify(f)}`);
        if (rank(got.rung) > rank(got.operatorRung)) throw new Error(`above the operator rung: ${JSON.stringify(f)}`);
        for (const g of narrowings(f)) {
          const after = m.effectiveRung(g).rung;
          if (rank(after) > rank(got.rung)) throw new Error(`narrowing raised ${got.rung} to ${after}: ${JSON.stringify(f)} -> ${JSON.stringify(g)}`);
        }
      }
      expect(n).toBe(5 * 16 * 4 ** CONDITION_CAUSES.length * 4);
    },
    'PROPERTY: unmeasured reads exactly as standing, and the default reads as chat': () => {
      const asUnmeasured = (b: { reading: string; kind: string }): object => ({ ...b, reading: b.kind === 'latch' ? 'standing' : 'unmeasured' });
      for (const f of allFacts()) {
        const swap = (to: ConditionReading): Facts => ({ ...f, conditions: f.conditions.map((c) => (c.reading === 'lifted' ? c : { ...c, reading: to })) });
        const std = m.effectiveRung(swap('standing'));
        expect(m.effectiveRung(swap('unmeasured'))).toEqual({ ...std, binding: std.binding.map(asUnmeasured),
          readBy: std.readBy.map((r) => ({ ...r, reading: 'unmeasured' })) });
        if (f.operatorRung.kind === 'default') expect(m.effectiveRung(f).rung).toBe(m.effectiveRung({ ...f, operatorRung: setRung('chat') }).rung);
      }
    },
  };
}

// ----------------------------------------------------------------------------------------------------- rungWordReading

export function rungWordReadingCases(m: LadderModule): Record<string, SuiteCase> {
  const rd = (rung: Rung, caps: string[]) => m.rungWordReading({ kind: 'rung', rung }, caps);
  return {
    'an unreadable rung reads unmeasured, whatever the server holds': () => {
      expect(m.rungWordReading({ kind: 'unreadable' }, [])).toBe('unmeasured');
      expect(m.rungWordReading({ kind: 'unreadable' }, [ROUTE, ANSWER])).toBe('unmeasured');
    },
    'off and chat need no word: lifted over any server': () => {
      for (const r of ['off', 'chat'] as const) { expect(rd(r, [])).toBe('lifted'); expect(rd(r, [ROUTE])).toBe('lifted'); }
    },
    'advise needs the route word': () => {
      expect(rd('advise', [])).toBe('standing');
      expect(rd('advise', [ANSWER, 'continuity-v1'])).toBe('lifted');
      expect(rd('advise', [ROUTE])).toBe('lifted');
      expect(rd('advise', [ROUTE, ANSWER])).toBe('lifted');
    },
    'full needs the answer word: the route word alone is not enough': () => {
      expect(rd('full', [])).toBe('standing');
      expect(rd('full', [ROUTE])).toBe('standing');
      expect(rd('full', [ANSWER])).toBe('lifted');
      expect(rd('full', [ROUTE, ANSWER])).toBe('lifted');
    },
    'the default reads the default rung, chat': () => {
      expect(m.rungWordReading({ kind: 'default' }, [])).toBe('lifted');
    },
    'it reads by rank against the highest held rung: a higher rung\'s word alone lifts a lower rung that lacks its own': () => {
      // The server holds `full`'s word and not `advise`'s: its highest held rung is `full`, so an operator `advise` is
      // not above it (the brief's rule; the rung door is what refuses a raise whose own word is missing).
      expect(rd('advise', [ANSWER])).toBe('lifted');
    },
  };
}

export function highestHeldRungCases(m: LadderModule): Record<string, SuiteCase> {
  return {
    'it is the highest rung whose word is null or held': () => {
      expect(m.highestHeldRung([])).toBe('chat');
      expect(m.highestHeldRung(['continuity-v1'])).toBe('chat');
      expect(m.highestHeldRung([ROUTE])).toBe('advise');
      expect(m.highestHeldRung([ANSWER])).toBe('full');
      expect(m.highestHeldRung([ROUTE, ANSWER])).toBe('full');
    },
  };
}

// ------------------------------------------------------------------------------------------------------ rungMoveVerdict

export function rungMoveVerdictCases(m: LadderModule): Record<string, SuiteCase> {
  const set = (to: Rung) => ({ kind: 'set', to }) as const;
  const cur = (rung: Rung): Current => ({ kind: 'rung', rung });
  const none: string[] = [];
  const both = [ROUTE, ANSWER];
  return {
    'the target equals the current rung: same': () => {
      for (const r of RUNGS) expect(m.rungMoveVerdict(cur(r), set(r), none)).toEqual({ kind: 'same', rung: r });
    },
    'the default reads as chat: setting chat is same, setting off is a lowering from chat': () => {
      expect(m.rungMoveVerdict({ kind: 'default' }, set('chat'), none)).toEqual({ kind: 'same', rung: 'chat' });
      expect(m.rungMoveVerdict({ kind: 'default' }, set('off'), none)).toEqual({ kind: 'lower', from: 'chat', to: 'off' });
      expect(m.rungMoveVerdict({ kind: 'default' }, set('advise'), both)).toEqual({ kind: 'raise', from: 'chat', to: 'advise' });
      expect(m.rungMoveVerdict({ kind: 'default' }, set('advise'), none)).toEqual({ kind: 'refuse', word: 'capability-missing', needs: ROUTE });
    },
    'a lowering is never refused, whatever the server holds': () => {
      for (const from of RUNGS) for (const to of RUNGS) {
        if (rungRank(to) >= rungRank(from)) continue;
        for (const caps of [none, [ROUTE], [ANSWER], both]) {
          expect(m.rungMoveVerdict(cur(from), set(to), caps)).toEqual({ kind: 'lower', from, to });
        }
      }
    },
    'a raise needs the target\'s word: refused naming it, or a raise': () => {
      expect(m.rungMoveVerdict(cur('chat'), set('advise'), none)).toEqual({ kind: 'refuse', word: 'capability-missing', needs: ROUTE });
      expect(m.rungMoveVerdict(cur('chat'), set('advise'), [ROUTE])).toEqual({ kind: 'raise', from: 'chat', to: 'advise' });
      expect(m.rungMoveVerdict(cur('chat'), set('full'), [ROUTE])).toEqual({ kind: 'refuse', word: 'capability-missing', needs: ANSWER });
      expect(m.rungMoveVerdict(cur('advise'), set('full'), [ROUTE, ANSWER])).toEqual({ kind: 'raise', from: 'advise', to: 'full' });
      expect(m.rungMoveVerdict(cur('off'), set('chat'), none)).toEqual({ kind: 'raise', from: 'off', to: 'chat' });
      expect(m.rungMoveVerdict(cur('off'), set('full'), [ANSWER])).toEqual({ kind: 'raise', from: 'off', to: 'full' });
    },
    'pause targets the lower of the current rung and chat': () => {
      expect(m.rungMoveVerdict(cur('full'), { kind: 'pause' }, both)).toEqual({ kind: 'lower', from: 'full', to: 'chat' });
      expect(m.rungMoveVerdict(cur('advise'), { kind: 'pause' }, none)).toEqual({ kind: 'lower', from: 'advise', to: 'chat' });
      expect(m.rungMoveVerdict(cur('chat'), { kind: 'pause' }, none)).toEqual({ kind: 'same', rung: 'chat' });
      expect(m.rungMoveVerdict({ kind: 'default' }, { kind: 'pause' }, none)).toEqual({ kind: 'same', rung: 'chat' });
    },
    'pause from off is same, never a raise': () => {
      for (const caps of [none, both]) expect(m.rungMoveVerdict(cur('off'), { kind: 'pause' }, caps)).toEqual({ kind: 'same', rung: 'off' });
    },
    'over an unreadable rung, off and pause both lower to off from full, and any other target refuses unavailable': () => {
      const u: Current = { kind: 'unreadable' };
      expect(m.rungMoveVerdict(u, set('off'), none)).toEqual({ kind: 'lower', from: 'full', to: 'off' });
      expect(m.rungMoveVerdict(u, { kind: 'pause' }, none)).toEqual({ kind: 'lower', from: 'full', to: 'off' });
      for (const to of ['chat', 'advise', 'full'] as const) {
        expect(m.rungMoveVerdict(u, set(to), both)).toEqual({ kind: 'refuse', word: 'unavailable', why: 'rung-unreadable' });
      }
    },
  };
}

// ------------------------------------------------------------------------------------------------------------ offStep

export function offStepCases(m: LadderModule): Record<string, SuiteCase> {
  return {
    'it refuses overlord-off only at off, and only for an other door': () => {
      expect(m.offStep('off', 'other')).toEqual({ pass: false, word: 'overlord-off' });
      expect(m.offStep('off', 'card-probe-note')).toEqual({ pass: true });
      for (const r of ['chat', 'advise', 'full'] as const) for (const d of ['other', 'card-probe-note'] as const) {
        expect(m.offStep(r, d)).toEqual({ pass: true });
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------------------- rungStep

export function rungStepCases(m: LadderModule): Record<string, SuiteCase> {
  const refuse = (needs: Rung) => ({ pass: false, word: 'rung-below', needs });
  return {
    'every W1 act is allowed at chat, advise and full, by any door': () => {
      for (const act of ['read', 'write-note', 'acknowledge'] as const) for (const r of ['chat', 'advise', 'full'] as const) {
        for (const d of ['other', 'card-probe-note'] as const) expect(m.rungStep(r, d, act)).toEqual({ pass: true });
      }
    },
    'at off, card, probe and note pass and any other door refuses rung-below naming chat': () => {
      for (const act of ['read', 'write-note', 'acknowledge'] as const) {
        expect(m.rungStep('off', 'card-probe-note', act)).toEqual({ pass: true });
        expect(m.rungStep('off', 'other', act)).toEqual(refuse('chat'));
      }
    },
    'a refused cell names the lowest rung whose cell allows': () => {
      const cells = { read: { chat: 'refuse', advise: 'refuse', full: 'allow' }, 'write-note': { chat: 'refuse', advise: 'allow', full: 'allow' },
        acknowledge: { chat: 'allow', advise: 'refuse', full: 'allow' } } as const;
      expect(m.rungStep('chat', 'other', 'read', cells)).toEqual(refuse('full'));
      expect(m.rungStep('advise', 'other', 'read', cells)).toEqual(refuse('full'));
      expect(m.rungStep('full', 'other', 'read', cells)).toEqual({ pass: true });
      expect(m.rungStep('chat', 'other', 'write-note', cells)).toEqual(refuse('advise'));
      expect(m.rungStep('advise', 'other', 'write-note', cells)).toEqual({ pass: true });
      expect(m.rungStep('advise', 'other', 'acknowledge', cells)).toEqual(refuse('chat'));
      expect(m.rungStep('chat', 'card-probe-note', 'read', cells)).toEqual(refuse('full'));
      expect(m.rungStep('off', 'card-probe-note', 'read', cells)).toEqual({ pass: true });
    },
    'a cell no rung allows names full, the highest, and still refuses': () => {
      const cells = { read: { chat: 'refuse', advise: 'refuse', full: 'refuse' } } as never;
      expect(m.rungStep('full', 'other', 'read', cells)).toEqual(refuse('full'));
    },
  };
}

// ----------------------------------------------------------------------------------------------------- narrowingState

export function narrowingStateCases(m: LadderModule): Record<string, SuiteCase> {
  return {
    'a null record is taking effect, not journalled, whatever the witness says': () => {
      for (const held of ['held', 'not-yet', 'unmeasured'] as const) {
        expect(m.narrowingState(null, held)).toEqual({ state: 'taking-effect', why: 'not-journalled' });
      }
    },
    'held is done': () => { expect(m.narrowingState(7, 'held')).toEqual({ state: 'done' }); },
    'not-yet is taking effect, no witness yet': () => {
      expect(m.narrowingState(7, 'not-yet')).toEqual({ state: 'taking-effect', why: 'no-witness-yet' });
    },
    'unmeasured is taking effect, witness unmeasured': () => {
      expect(m.narrowingState(7, 'unmeasured')).toEqual({ state: 'taking-effect', why: 'witness-unmeasured' });
    },
    'a record sequence of 0 is a record, not an absent one': () => {
      expect(m.narrowingState(0, 'held')).toEqual({ state: 'done' });
    },
  };
}

export function degradedReadingCases(m: LadderModule): Record<string, SuiteCase> {
  const designated = { kind: 'designated', sessionId: 'lane-a', term: 1, row: null } as unknown as Parameters<LadderModule['degradedReading']>[0];
  return {
    'unmeasured designation stays unmeasured': () => expect(m.degradedReading({ kind: 'unmeasured', why: 'x' }, 'no-generation')).toBe('unmeasured'),
    'no designation lifts even an unmeasured generation': () => expect(m.degradedReading({ kind: 'not-designated', row: null }, 'unmeasured')).toBe('lifted'),
    'unmeasured generation remains unmeasured': () => expect(m.degradedReading(designated, 'unmeasured')).toBe('unmeasured'),
    'no generation lifts': () => expect(m.degradedReading(designated, 'no-generation')).toBe('lifted'),
    'degraded stands': () => expect(m.degradedReading(designated, { state: 'degraded' })).toBe('standing'),
    'active lifts': () => expect(m.degradedReading(designated, { state: 'active' })).toBe('lifted'),
  };
}

// -------------------------------------------------------------------------------------------------------- mutant sets

const KEY = 'server/src/coord/overlordLadder.ts';
const set = (cases: (m: LadderModule) => Record<string, SuiteCase>, mutants: MutantSet<LadderModule>['mutants']): MutantSet<LadderModule> =>
  ({ modulePath: LADDER_TS, mutants, suite: cases });

const EFFECTIVE_SET = set(effectiveRungCases, [
  // The plan's Step 4 hand mutations: the highest cap instead of the lowest; an unmeasured condition read as lifted.
  { id: 'E1 the highest cap wins', old: 'caps.reduce((acc, b) => lowest(acc, b.cap), operator)', new: 'caps.reduce((acc, b) => (rungRank(b.cap) > rungRank(acc) ? b.cap : acc), operator)' },
  { id: 'E2 unmeasured read as lifted', old: "if (c.reading === 'lifted') continue;", new: "if (c.reading !== 'standing') continue;" },
  { id: 'E3 a lifted condition applies', old: "    if (c.reading === 'lifted') continue;\n", new: '' },
  { id: 'E4 the default reads off', old: "f.operatorRung.kind === 'set' ? f.operatorRung.rung : LADDER_DEFAULT_RUNG;", new: "f.operatorRung.kind === 'set' ? f.operatorRung.rung : 'off';" },
  { id: 'E5 the operator rung is not in the minimum', old: 'caps.reduce((acc, b) => lowest(acc, b.cap), operator)', new: "caps.reduce((acc, b) => lowest(acc, b.cap), 'full' as Rung)" },
  { id: 'E6 binding is strictly below', old: 'rungRank(b.cap) <= rungRank(rung))', new: 'rungRank(b.cap) < rungRank(rung))' },
  { id: 'E7 binding lists everything', old: 'caps.filter((b) => rungRank(b.cap) <= rungRank(rung))', new: 'caps' },
  { id: 'E8 one-under has no floor', old: 'rungOfRank(Math.max(rungRank(e.floor), rungRank(operator) - 1))', new: 'rungOfRank(rungRank(operator) - 1)' },
  { id: 'E9 one-under is its floor only', old: 'rungOfRank(Math.max(rungRank(e.floor), rungRank(operator) - 1))', new: 'rungOfRank(rungRank(e.floor))' },
  { id: 'E10 one-under is the operator rung', old: 'rungRank(operator) - 1))', new: 'rungRank(operator)))' },
  { id: 'E12 a latch caps by the table, not its stored cap', old: 'cap: l.cap, reading', new: "cap: (rowOf(f.causeTable, l.cause)?.effect as { cap?: Rung } | undefined)?.cap ?? l.cap, reading" },
  { id: 'E13 an unknown condition caps full', old: "kind: 'condition', cap: 'off', reading: c.reading, known: false", new: "kind: 'condition', cap: 'full', reading: c.reading, known: false" },
  { id: 'E14 a latch row is read as a condition', old: "if (row === undefined || row.kind !== 'condition') {", new: 'if (row === undefined) {' },
  { id: 'E15 a read-by row caps', old: "if (e.kind === 'read-by') {", new: 'if (false) {' },
  { id: 'E16 a read-by row is not listed', old: '      readBy.push({ cause: c.cause, reader: e.reader, reading: c.reading });\n', new: '' },
  { id: 'E17 server-words ignores the server', old: "e.kind === 'server-words' ? highestHeldRung(f.serverCaps)", new: "e.kind === 'server-words' ? 'full'" },
  { id: 'E18 server-words caps chat', old: "e.kind === 'server-words' ? highestHeldRung(f.serverCaps)", new: "e.kind === 'server-words' ? 'chat'" },
  { id: 'E19 a fixed cap caps chat', old: "const cap: Rung = e.kind === 'cap' ? e.cap", new: "const cap: Rung = e.kind === 'cap' ? 'chat'" },
  { id: 'E20 operatorRung reports the result', old: 'return { rung, operatorRung: operator,', new: 'return { rung, operatorRung: rung,' },
  { id: 'E21 an unmeasured condition reads standing', old: "caps.push({ cause: c.cause, kind: 'condition', cap, reading: c.reading, known: true });", new: "caps.push({ cause: c.cause, kind: 'condition', cap, reading: 'standing', known: true });" },
]);

const HIGHEST_SET = set(highestHeldRungCases, [
  { id: 'H1 the lowest held rung', old: 'rungRank(r) > rungRank(best)', new: 'rungRank(r) < rungRank(best)' },
  { id: 'H4 the start is full', old: "let best: Rung = 'off';", new: "let best: Rung = 'full';" },
]);

const WORD_READING_SET = set(rungWordReadingCases, [
  { id: 'W1 unreadable reads lifted', old: "if (operatorRung.kind === 'unreadable') return 'unmeasured';", new: "if (operatorRung.kind === 'unreadable') return 'lifted';" },
  { id: 'W2 the default reads full', old: "operatorRung.kind === 'rung' ? operatorRung.rung : LADDER_DEFAULT_RUNG;", new: "operatorRung.kind === 'rung' ? operatorRung.rung : 'full';" },
  { id: 'W3 equal rank stands', old: 'rungRank(rung) > rungRank(highestHeldRung(serverCaps))', new: 'rungRank(rung) >= rungRank(highestHeldRung(serverCaps))' },
  { id: 'W4 the operator rung\'s own word, not rank', old: "rungRank(rung) > rungRank(highestHeldRung(serverCaps)) ? 'standing' : 'lifted'", new: "rungNeeds(rung) !== null && !serverCaps.includes(rungNeeds(rung)!) ? 'standing' : 'lifted'" },
  { id: 'W5 standing and lifted swapped', old: "rungRank(rung) > rungRank(highestHeldRung(serverCaps)) ? 'standing' : 'lifted'", new: "rungRank(rung) > rungRank(highestHeldRung(serverCaps)) ? 'lifted' : 'standing'" },
  { id: 'W6 the highest held rung is full', old: 'rungRank(highestHeldRung(serverCaps))', new: "rungRank('full')" },
  { id: 'W7 the operator rung read as the default always', old: "const rung = operatorRung.kind === 'rung' ? operatorRung.rung : LADDER_DEFAULT_RUNG;", new: 'const rung = LADDER_DEFAULT_RUNG;' },
]);

const MOVE_SET = set(rungMoveVerdictCases, [
  // The plan's Step 4 hand mutation: Pause targets chat from off.
  { id: 'V1 same is not answered', old: "  if (to === from) return { kind: 'same', rung: from };\n", new: '' },
  { id: 'V2 pause targets chat', old: "ask.kind === 'pause' ? lowest(from, 'chat') : ask.to", new: "ask.kind === 'pause' ? 'chat' : ask.to" },
  { id: 'V3 a raise is read as a lowering', old: 'if (rungRank(to) < rungRank(from)) return', new: 'if (rungRank(to) > rungRank(from)) return' },
  { id: 'V4 the word check is inverted', old: 'needs !== null && !rungAvailable(to, serverCaps)', new: 'needs !== null && rungAvailable(to, serverCaps)' },
  { id: 'V5 a null word is refused', old: 'needs !== null && !rungAvailable(to, serverCaps)', new: 'needs === null || !rungAvailable(to, serverCaps)' },
  { id: 'V6 unreadable: off alone lowers', old: "ask.kind === 'pause' || ask.to === 'off'", new: "ask.kind !== 'pause' && ask.to === 'off'" },
  { id: 'V7 unreadable: pause alone lowers', old: "ask.kind === 'pause' || ask.to === 'off'", new: "ask.kind === 'pause'" },
  { id: 'V8 unreadable lowers from chat', old: "{ kind: 'lower', from: 'full', to: 'off' }", new: "{ kind: 'lower', from: 'chat', to: 'off' }" },
  { id: 'V9 the default reads off', old: "const from: Rung = current.kind === 'rung' ? current.rung : LADDER_DEFAULT_RUNG;", new: "const from: Rung = current.kind === 'rung' ? current.rung : 'off';" },
  { id: 'V10 a lowering swaps its ends', old: "return { kind: 'lower', from, to };", new: "return { kind: 'lower', from: to, to: from };" },
  { id: 'V11 a raise is never refused', old: "if (needs !== null && !rungAvailable(to, serverCaps)) return", new: "if (false) return" },
  { id: 'V12 unreadable refuses every target', old: "return ask.kind === 'pause' || ask.to === 'off'\n      ? { kind: 'lower', from: 'full', to: 'off' }\n      : ", new: 'return ' },
]);

const OFF_SET = set(offStepCases, [
  // The plan's Step 4 hand mutation: read `effective` instead of the operator's rung is a facts-side mistake; the decider
  // mutants are the door class and the rung test.
  { id: 'O1 every door is refused at off', old: "operatorRung === 'off' && door === 'other'", new: "operatorRung === 'off'" },
  { id: 'O2 other is refused at every rung', old: "operatorRung === 'off' && door === 'other'", new: "door === 'other'" },
  { id: 'O3 either condition refuses', old: "operatorRung === 'off' && door === 'other'", new: "operatorRung === 'off' || door === 'other'" },
  { id: 'O4 chat is refused too', old: "operatorRung === 'off' && door === 'other'", new: "rungRank(operatorRung) <= 1 && door === 'other'" },
  { id: 'O5 the word', old: "{ pass: false, word: 'overlord-off' } : { pass: true }", new: "{ pass: true } : { pass: false, word: 'overlord-off' }" },
]);

const RUNG_STEP_SET = set(rungStepCases, [
  { id: 'S1 card, probe and note are refused at off', old: "  if (effective === 'off' && door === 'card-probe-note') return { pass: true };\n", new: '' },
  { id: 'S2 every door passes at off', old: "effective === 'off' && door === 'card-probe-note'", new: "effective === 'off'" },
  { id: 'S3 the cell is inverted', old: "effective !== 'off' && cell[effective] === 'allow'", new: "effective !== 'off' && cell[effective] !== 'allow'" },
  { id: 'S4 the named rung is the highest allowing', old: "RUNGS.find((r) => r !== 'off'", new: "[...RUNGS].reverse().find((r) => r !== 'off'" },
  { id: 'S5 a cell no rung allows names chat', old: "?? 'full';", new: "?? 'chat';" },
  { id: 'S6 the cell is read at the next rung', old: "cell[effective] === 'allow') return", new: "cell[effective === 'chat' ? 'advise' : effective] === 'allow') return" },
  { id: 'S7 a cell no rung allows passes', old: "const needs = RUNGS.find(", new: "if (!RUNGS.some((r) => r !== 'off' && cell[r] === 'allow')) return { pass: true };\n  const needs = RUNGS.find(" },
]);

const NARROWING_SET = set(narrowingStateCases, [
  { id: 'N1 a record of 0 is absent', old: 'recordSequence === null', new: '!recordSequence' },
  { id: 'N2 held is taking effect', old: "if (held === 'held') return { state: 'done' };", new: "if (held !== 'held') return { state: 'done' };" },
  { id: 'N3 the two witness words swapped', old: "held === 'not-yet' ? 'no-witness-yet' : 'witness-unmeasured'", new: "held === 'not-yet' ? 'witness-unmeasured' : 'no-witness-yet'" },
  { id: 'N4 a null record is judged by the witness', old: "  if (recordSequence === null) return { state: 'taking-effect', why: 'not-journalled' };\n", new: '' },
  { id: 'N5 the not-journalled word', old: "why: 'not-journalled'", new: "why: 'no-witness-yet'" },
]);

const LATCH_KNOWN_SET = set(effectiveRungCases, [
  { id: 'K1 any table row makes a latch known', old: "rowOf(table, cause)?.kind === 'latch'", new: 'rowOf(table, cause) !== undefined' },
  { id: 'K2 every latch is known', old: "rowOf(table, cause)?.kind === 'latch'", new: 'true' },
  { id: 'K3 no latch is known', old: "rowOf(table, cause)?.kind === 'latch'", new: 'false' },
]);
const RUNG_AVAILABLE_SET = set(highestHeldRungCases, [
  { id: 'A1 a null word is not held', old: 'needs === null || serverCaps.includes(needs)', new: 'needs !== null && serverCaps.includes(needs)' },
  { id: 'A2 every word is held', old: 'needs === null || serverCaps.includes(needs)', new: 'true' },
  { id: 'A3 held means absent', old: 'needs === null || serverCaps.includes(needs)', new: 'needs === null || !serverCaps.includes(needs)' },
]);

const DEGRADED_SET = set(degradedReadingCases, [
  { id: 'D1 designation unreadable lifts', old: "if (designation.kind === 'unmeasured') return 'unmeasured';", new: "if (designation.kind === 'unmeasured') return 'lifted';" },
  { id: 'D2 no designation stands', old: "if (designation.kind === 'not-designated') return 'lifted';", new: "if (designation.kind === 'not-designated') return 'standing';" },
  { id: 'D3 live unreadable lifts', old: "if (live === 'unmeasured') return 'unmeasured';", new: "if (live === 'unmeasured') return 'lifted';" },
  { id: 'D4 no generation stands', old: "if (live === 'no-generation') return 'lifted';", new: "if (live === 'no-generation') return 'standing';" },
  { id: 'D5 degraded lifts', old: "live.state === 'degraded' ? 'standing' : 'lifted'", new: "live.state === 'degraded' ? 'lifted' : 'standing'" },
]);

export const LADDER_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [`${KEY}#degradedReading`]: DEGRADED_SET as MutantSet<never>,
  [`${KEY}#latchKnown`]: LATCH_KNOWN_SET as MutantSet<never>,
  [`${KEY}#rungAvailable`]: RUNG_AVAILABLE_SET as MutantSet<never>,
  [`${KEY}#effectiveRung`]: EFFECTIVE_SET as MutantSet<never>,
  [`${KEY}#highestHeldRung`]: HIGHEST_SET as MutantSet<never>,
  [`${KEY}#rungWordReading`]: WORD_READING_SET as MutantSet<never>,
  [`${KEY}#rungMoveVerdict`]: MOVE_SET as MutantSet<never>,
  [`${KEY}#offStep`]: OFF_SET as MutantSet<never>,
  [`${KEY}#rungStep`]: RUNG_STEP_SET as MutantSet<never>,
  [`${KEY}#narrowingState`]: NARROWING_SET as MutantSet<never>,
};

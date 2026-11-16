// Overlord W2, the decision-model catalogue (plan docs/superpowers/plans/2026-11-16-overlord-w2/w2-decision-model.md,
// Task 1): W2's seven rows of `DECISION_QUESTIONS` hold to Table 1 and to the rules of H6 that a row's own fields can state.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DECISION_OUTCOMES, DECISION_QUESTIONS, DECISION_ROW_DEFAULT, DECISION_ROW_IDS, DECISION_ROW_MODES, decisionMarkOf,
  isDecisionRowMode,
  type DecisionCheck, type DecisionQuestionRow, type DecisionRowId,
} from '../../shared/decisionModel.js';

/** Canonical JSON: keys sorted at every depth, arrays kept in order. */
const canonical = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
};
/** The revision of a row: 16 hex of the SHA-256 of its canonical JSON, `revision` left out. */
export const revisionOf = (row: DecisionQuestionRow): string => {
  const { revision: _revision, ...rest } = row;
  return createHash('sha256').update(canonical(rest)).digest('hex').slice(0, 16);
};

const ROWS = DECISION_ROW_IDS.map((id) => DECISION_QUESTIONS[id]);
const quotedOf = (r: DecisionQuestionRow): string[] => r.fields.filter((f) => f.kind === 'quoted').map((f) => f.name);
/** Table 1's private-state rule: a field that is a `message` ref carries the operator's words. */
const carriesOperatorWords = (r: DecisionQuestionRow): boolean => r.fields.some((f) => f.refKind === 'message');
/** Question 16: an attacker's answer leads to the row disarmed or narrower. */
const attackerSafe = (r: DecisionQuestionRow): boolean => r.direction === 'advice'
  ? r.attackerWants === 'no' || r.attackerWants === 'an-option'
  : r.attackerWants === 'yes' && !/widen/i.test(r.instructions);

describe('DECISION_QUESTIONS: W2 seven rows (Table 3.7b, plan Table 1)', () => {
  it('names W2 seven rows, in catalogue order, and DECISION_ROW_IDS is its keys', () => {
    expect(DECISION_ROW_IDS).toEqual(['programme.pick', 'programme.any', 'scope.widens', 'relay.method', 'readback.omits',
      'readback.adds', 'goals.conflict']);
    expect(DECISION_ROW_IDS).toEqual(Object.keys(DECISION_QUESTIONS));
    for (const r of ROWS) expect(r.id).toBe(DECISION_ROW_IDS[ROWS.indexOf(r)]);
    for (const r of ROWS) expect(r.wave).toBe('W2');
  });

  it.each(ROWS.map((r) => [r.id, r] as const))('%s: its revision is the hash of its canonical JSON', (_id, r) => {
    expect(r.revision).toMatch(/^[0-9a-f]{16}$/);
    expect(r.revision).toBe(revisionOf(r));
  });

  it('CONTROL: one character changed in any row instructions moves its revision', () => {
    for (const r of ROWS) {
      expect(revisionOf({ ...r, instructions: `${r.instructions.slice(0, -1)}!` }), r.id).not.toBe(r.revision);
    }
  });

  it('every askedWith names catalogue rows and includes the row; rows asked together list each other in one order', () => {
    for (const r of ROWS) {
      expect(r.askedWith, r.id).toContain(r.id);
      for (const o of r.askedWith) {
        expect(DECISION_ROW_IDS, `${r.id} asks with ${o}`).toContain(o);
        expect(DECISION_QUESTIONS[o].askedWith, `${r.id} and ${o}`).toEqual(r.askedWith);
        // Rows asked together share one state, so they have one field list.
        expect(DECISION_QUESTIONS[o].fields, `${r.id} and ${o}`).toEqual(r.fields);
      }
    }
    expect(DECISION_QUESTIONS['programme.pick'].askedWith).toEqual(['programme.pick', 'programme.any']);
  });

  it('privateState is true exactly when a field carries the operator words', () => {
    for (const r of ROWS) expect(r.privateState, r.id).toBe(carriesOperatorWords(r));
    expect(ROWS.filter((r) => r.privateState).map((r) => r.id)).toEqual(['scope.widens', 'readback.omits', 'readback.adds']);
  });

  it('CONTROL: a flipped privateState flag fails the rule', () => {
    for (const r of ROWS) expect(carriesOperatorWords(r) === !r.privateState, r.id).toBe(false);
  });

  it('attackerFields is exactly the row quoted fields, both ways', () => {
    for (const r of ROWS) expect([...r.attackerFields].sort(), r.id).toEqual(quotedOf(r).sort());
    expect(DECISION_QUESTIONS['programme.pick'].attackerFields).toContain('request');
  });

  it('attackerWants is safe (question 16): advice wants no or an option; a gate wants yes and never asks "widen"', () => {
    for (const r of ROWS) expect(attackerSafe(r), r.id).toBe(true);
    expect(DECISION_QUESTIONS['scope.widens'].instructions).toBe("Do the cited words ask for this change to the programme's scope?");
  });

  it('CONTROL: the safety rule refuses an advice row wanting yes, and a gate asking whether it widens', () => {
    const adv = DECISION_QUESTIONS['relay.method'];
    const gate = DECISION_QUESTIONS['scope.widens'];
    expect(attackerSafe({ ...adv, attackerWants: 'yes' })).toBe(false);
    expect(attackerSafe({ ...gate, attackerWants: 'no' })).toBe(false);
    expect(attackerSafe({ ...gate, instructions: 'Does this change widen the scope?' })).toBe(false);
  });

  it('a gate costs a false yes at 0.05; an advice row a false mark at 0.1', () => {
    for (const r of ROWS) {
      if (r.direction === 'gate') expect([r.costlyError, r.target], r.id).toEqual(['false-yes', 0.05]);
      else expect([r.costlyError, r.target], r.id).toEqual(['false-mark', 0.1]);
    }
    expect(ROWS.filter((r) => r.direction === 'gate').map((r) => r.id)).toEqual(['scope.widens']);
  });

  it('a yes-or-no row has criteria and a choice row has none; both-order yes-or-no rows swap two fields', () => {
    for (const r of ROWS) {
      expect(r.criteria === null, r.id).toBe(r.type === 'choice');
      if (r.type === 'yes-no' && r.orders === 'both') {
        expect(r.fields.length, r.id).toBeGreaterThanOrEqual(2);
        expect(r.fields[0]!.kind === 'fact' || r.fields[1]!.kind === 'fact', r.id).toBe(false);
      }
    }
    expect(ROWS.filter((r) => r.orders === 'both').map((r) => r.id))
      .toEqual(['programme.pick', 'readback.omits', 'readback.adds', 'goals.conflict']);
  });

  it('the three switch positions are derived from one map, and the guard refuses anything else', () => {
    expect(DECISION_ROW_MODES).toEqual(['off', 'shadow', 'armed']);
    for (const m of DECISION_ROW_MODES) expect(isDecisionRowMode(m), m).toBe(true);
    for (const v of ['held', 'Off', '', null, 1]) expect(isDecisionRowMode(v), String(v)).toBe(false);
  });

  it('every row ships off', () => {
    expect(DECISION_ROW_DEFAULT).toEqual({ mode: 'off', ceiling: 600, armedLine: null, held: false });
    expect(Object.isFrozen(DECISION_ROW_DEFAULT)).toBe(true);
  });
});

describe('decisionMarkOf: a session sees a band, never a number (H6)', () => {
  const answered: DecisionCheck = {
    row: 'relay.method', outcome: 'answered', revision: 'r', modelId: 'model-a', hostKind: 'local', lineGen: 0, recordId: 1,
    verdict: 'yes', p: 0.8, band: 'very-likely', ms: 5, attempts: 1, reused: false, egress: 'not-hosted',
  };
  const others: DecisionCheck[] = DECISION_OUTCOMES.filter((o) => o !== 'answered')
    .map((outcome) => ({ row: 'relay.method' as DecisionRowId, outcome: outcome as Exclude<typeof outcome, 'answered'>, why: null, ms: 3, attempts: 2 }));
  const numericKeys = (v: unknown, at = ''): string[] => typeof v === 'number' ? [at]
    : typeof v === 'object' && v !== null ? Object.entries(v).flatMap(([k, x]) => numericKeys(x, `${at}.${k}`)) : [];

  it.each([answered, ...others].map((c) => [c.outcome, c] as const))('%s: no numeric field', (_o, c) => {
    expect(numericKeys(decisionMarkOf(c))).toEqual([]);
  });

  it('keeps the band, the verdict and the outcome', () => {
    expect(decisionMarkOf(answered)).toEqual({ row: 'relay.method', band: 'very-likely', verdict: 'yes', outcome: 'answered' });
    expect(decisionMarkOf(others[0]!)).toEqual({ row: 'relay.method', band: null, verdict: null, outcome: others[0]!.outcome });
  });
});

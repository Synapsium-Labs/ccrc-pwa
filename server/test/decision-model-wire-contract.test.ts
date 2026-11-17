// The decision model's wire, held against the vendor's published reference (Overlord W2, decision model B; the coordinator's
// ruling on review 2324 F7, `decision-wire-not-re-read`). PR A's codec and fixture spoke question 2's shape as the plan recorded
// it, with no read of the reference at build time. B's builder read it (2026-11-17; the sources are named in
// `docs/superpowers/plans/2026-11-16-overlord-w2/w2-decision-model-pr-b.md`) and found every name PR A uses as published: a
// request is `{ model, state, questions }`, each question `{ type, instructions, criteria }`, `type` `noul` (criteria `{ true,
// false }`, optional) or `choice` (criteria, 1 to 255 option keys); an answer is `{ model, answers }` keyed by the request's
// question names, a `noul` answer `{ type: 'noul', noul: <p(yes)> }` with no `confidence`, a `choice` answer
// `{ type: 'choice', choice, confidence, probabilities }`. The published answers also carry keys the codec never reads (`id`,
// `provider`, `usage`), which the reader must tolerate. The arm door refuses `shadow` for a row until this suite exists: it
// lands in the same pull request as the doors, so a wrong field name reds a suite here instead of spending a row's ceiling.
//
// The fixture `contract-answer.json` is a real answer's SHAPE, every value neutral: its keys are placeholders this suite maps
// to the opaque ids the encoder drew, so the reader is fed exactly the published key layout.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { encodeDecisionRequest, readDecisionAnswers, type DecisionFields, type DecisionQuestionKey } from '../src/coord/decisionModel.js';
import type { DecisionRowId } from '../../shared/decisionModel.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONTRACT = readFileSync(path.join(HERE, 'fixtures/decision-model/contract-answer.json'), 'utf8');
const MODEL = 'model-a-1.0.0';
const OPAQUE = Array.from({ length: 16 }, (_, i) => `x${(0xa0 + i).toString(16).padStart(8, '0')}`);
const ROUTING: Map<DecisionRowId, DecisionFields> = new Map([
  ['programme.pick', { request: 'add a door', candidates: ['programme-a', 'programme-b'], goals: ['goals a', 'goals b'] }],
  ['programme.any', { request: 'add a door', candidates: ['programme-a', 'programme-b'], goals: ['goals a', 'goals b'] }],
]);

/** The routing pair's request, and the contract answer with its placeholders replaced by the request's own ids. */
function routed(): { body: Record<string, unknown>; keys: ReadonlyMap<string, DecisionQuestionKey>; answer: unknown } {
  const enc = encodeDecisionRequest(['programme.pick', 'programme.any'], ROUTING, MODEL, OPAQUE);
  if ('refused' in enc) throw new Error(`refused: ${enc.refused}`);
  const pick = [...enc.keys].filter(([, k]) => k.row === 'programme.pick');
  const any = [...enc.keys].find(([, k]) => k.row === 'programme.any')!;
  const a = pick.find(([, k]) => k.order === 'a')!;
  const b = pick.find(([, k]) => k.order === 'b')!;
  const opts = [...a[1].options.keys()];
  const map: Record<string, string> = { KEY_CHOICE_A: a[0], KEY_CHOICE_B: b[0], KEY_NOUL: any[0], OPT_1: opts[0]!, OPT_2: opts[1]!, NONE: a[1].none! };
  const text = CONTRACT.replace(/"(KEY_CHOICE_A|KEY_CHOICE_B|KEY_NOUL|OPT_1|OPT_2|NONE)"/g, (_, k: string) => JSON.stringify(map[k]));
  return { body: enc.body as unknown as Record<string, unknown>, keys: enc.keys, answer: JSON.parse(text) };
}

describe('the request speaks the published shape', () => {
  it('top level: exactly model, state and questions', () => {
    expect(Object.keys(routed().body).sort()).toEqual(['model', 'questions', 'state']);
  });

  it('each question: type, instructions and criteria only; type noul or choice; noul criteria {true, false}; choice criteria 1 to 255 option keys', () => {
    const { body } = routed();
    const questions = body['questions'] as Record<string, Record<string, unknown>>;
    expect(Object.keys(questions)).toHaveLength(3);
    for (const q of Object.values(questions)) {
      expect(Object.keys(q).sort()).toEqual(['criteria', 'instructions', 'type']);
      expect(['noul', 'choice']).toContain(q['type']);
      expect(typeof q['instructions']).toBe('string');
      const c = q['criteria'] as Record<string, unknown>;
      if (q['type'] === 'noul') expect(Object.keys(c).sort()).toEqual(['false', 'true']);
      else {
        expect(Object.keys(c).length).toBeGreaterThanOrEqual(1);
        expect(Object.keys(c).length).toBeLessThanOrEqual(255);
        for (const v of Object.values(c)) expect(typeof v).toBe('string');
      }
    }
  });
});

describe('the published answer reads', () => {
  it('a real answer\'s shape, its extra keys (id, provider, usage) included, reads to the verdicts it states', () => {
    const { keys, answer } = routed();
    const read = readDecisionAnswers(keys, MODEL, answer);
    if ('malformed' in read) throw new Error(`malformed: ${read.malformed}`);
    expect(read.get('programme.pick')).toEqual({ verdict: { option: 'programme-b' }, p: 0.77, band: 'very-likely' });
    expect(read.get('programme.any')).toEqual({ verdict: 'yes', p: 0.93, band: 'very-likely' });
  });

  it('a noul answer carries its probability under `noul`: the same answer with the field named otherwise is malformed', () => {
    const { keys, answer } = routed();
    for (const name of ['probability', 'p', 'value', 'confidence']) {
      const a = structuredClone(answer) as { answers: Record<string, Record<string, unknown>> };
      const k = [...keys].find(([, q]) => q.row === 'programme.any')![0];
      a.answers[k] = { type: 'noul', [name]: 0.93 };
      expect(readDecisionAnswers(keys, MODEL, a), name).toEqual({ malformed: 'probability' });
    }
  });

  it('the answers sit under `answers` and the resolved model under `model`: either renamed is malformed', () => {
    const { keys, answer } = routed();
    const { answers, ...rest } = answer as Record<string, unknown>;
    expect(readDecisionAnswers(keys, MODEL, { ...rest, results: answers })).toEqual({ malformed: 'answers' });
    const { model: _m, ...noModel } = answer as Record<string, unknown>;
    expect(readDecisionAnswers(keys, MODEL, { ...noModel, model_id: MODEL })).toEqual({ malformed: 'model' });
  });

  it('a choice answer\'s option is under `choice` and its probability under `probabilities` (or `confidence`)', () => {
    const { keys, answer } = routed();
    const k = [...keys].find(([, q]) => q.row === 'programme.pick' && q.order === 'a')!;
    const a = structuredClone(answer) as { answers: Record<string, Record<string, unknown>> };
    const { choice, ...noChoice } = a.answers[k[0]]!;
    a.answers[k[0]] = { ...noChoice, selected: choice };
    expect(readDecisionAnswers(keys, MODEL, a)).toEqual({ malformed: 'option' });
    const b = structuredClone(answer) as { answers: Record<string, Record<string, unknown>> };
    const { probabilities: _p, confidence: _c, ...bare } = b.answers[k[0]]!;
    b.answers[k[0]] = bare;
    expect(readDecisionAnswers(keys, MODEL, b)).toEqual({ malformed: 'probability' });
  });
});

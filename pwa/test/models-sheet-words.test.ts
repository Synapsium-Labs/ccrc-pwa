// The Models sheet's words and its two readers (model-class-advance wave R4): the POST's 200, and a refused POST's body as
// a typed failure. Neutral lane and model ids only: this repository is public.
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/lib/apiError';
import {
  advanceStateWords, asLaneModelsActAnswer, modelsActFailure, pendingWords, VERB_CODE_WORDS,
} from '../src/accounts/modelsSheetWords';

const READ = { kind: 'read', classes: {
  haiku: { model: 'model-6-alpha', label: 'Alpha 6', efforts: null }, sonnet: { model: null, label: null, efforts: null },
  opus: { model: 'model-6.1-gamma', label: 'Gamma 6.1', efforts: ['high'] }, fable: { model: null, label: null, efforts: null },
} };
const OK = { ok: true, lane: 'lane-a', action: 'hold', class: 'opus', changed: true, partial: false, models: READ };

describe('asLaneModelsActAnswer', () => {
  it('reads the 200 whole, its models through the one reader', () => {
    const a = asLaneModelsActAnswer(OK);
    expect(a).toMatchObject({ lane: 'lane-a', action: 'hold', class: 'opus', changed: true, partial: false });
    expect(a?.models.kind).toBe('read');
    expect(asLaneModelsActAnswer({ ...OK, action: 'revert', changed: null, partial: true })).toMatchObject({ changed: null, partial: true });
  });
  it('anything off the grammar reads null, and the sheet then re-reads rather than guess', () => {
    for (const bad of [null, 'ok', {}, { ...OK, ok: false }, { ...OK, lane: 3 }, { ...OK, action: 'show' }, { ...OK, class: 'wizard' },
      { ...OK, changed: 'yes' }, { ...OK, changed: undefined }, { ...OK, partial: 1 }, { ...OK, models: null }, { ...OK, models: { kind: 'later' } }]) {
      expect(asLaneModelsActAnswer(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

const refused = (status: number, body: unknown): ApiError => new ApiError(status, body);

describe('modelsActFailure: what a refused act says, and whether it may have happened', () => {
  it('a refusal that proves nothing ran says "nothing was changed", per error word', () => {
    const cases: [ApiError, RegExp][] = [
      [refused(404, { ok: false, error: 'not-found' }), /no lane named lane-a/i],
      [refused(400, { ok: false, error: 'bad-request', why: 'bad-body' }), /malformed/i],
      [refused(400, { ok: false, error: 'bad-request', why: 'bad-lane' }), /lane/i],
      [refused(400, { ok: false, error: 'bad-request', why: 'bad-action' }), /action/i],
      [refused(400, { ok: false, error: 'bad-request', why: 'bad-class' }), /class/i],
      [refused(501, { ok: false, error: 'unsupported' }), /predates|cannot run/i],
      [refused(503, { ok: false, error: 'unavailable', cause: 'not-started' }), /did not start/i],
      [refused(409, { ok: false, error: 'busy', cause: 'agent-busy' }), /another/i],
      [refused(401, { ok: false, error: 'unauthenticated' }), /signed out|sign in/i],
      [refused(403, { ok: false, error: 'foreign-origin' }), /not allowed|refused/i],
    ];
    for (const [err, re] of cases) {
      const f = modelsActFailure(err, 'lane-a', 'opus');
      expect(f.outcome, JSON.stringify(err.body)).toBe('none');
      expect(f.text, JSON.stringify(err.body)).toMatch(re);
      expect(f.text, JSON.stringify(err.body)).toMatch(/nothing was changed/i);
    }
  });

  it('outcome-unknown, by each cause, says the act MAY have happened and is never success or failure', () => {
    for (const cause of ['timeout', 'too-large', 'lost', 'unreadable']) {
      const f = modelsActFailure(refused(502, { ok: false, error: 'outcome-unknown', cause }), 'lane-a', 'opus');
      expect(f.outcome, cause).toBe('unknown');
      expect(f.text, cause).toMatch(/may have/i);
      expect(f.text, cause).not.toMatch(/nothing was changed/i);
    }
    // an unknown cause is still unknown, said the same way
    expect(modelsActFailure(refused(502, { ok: false, error: 'outcome-unknown', cause: 'later' }), 'lane-a', 'opus').outcome).toBe('unknown');
  });

  it('a 5xx with no word of ours, and no answer at all, may have landed: unknown', () => {
    expect(modelsActFailure(refused(500, { ok: false, error: 'internal' }), 'lane-a', 'opus').outcome).toBe('unknown');
    expect(modelsActFailure(refused(502, 'bad gateway'), 'lane-a', 'opus').outcome).toBe('unknown');
    expect(modelsActFailure(new TypeError('Failed to fetch'), 'lane-a', 'opus').outcome).toBe('unknown');
  });

  it('a lane-act-refused names the verb\'s own refusal in words, one sentence per known word', () => {
    expect(Object.keys(VERB_CODE_WORDS).sort()).toEqual([
      'lock-busy', 'lock-unwritable', 'no-previous', 'no-registry', 'no-such-account', 'previous-not-in-catalogue',
      'previous-taken', 'registry-invalid', 'unroutable-lane',
    ].sort());
    for (const verbCode of Object.keys(VERB_CODE_WORDS)) {
      const f = modelsActFailure(refused(409, { ok: false, error: 'lane-act-refused', verbCode }), 'lane-a', 'opus');
      expect(f.outcome, verbCode).toBe('none');
      expect(f.text, verbCode).toBe(`${VERB_CODE_WORDS[verbCode]!} Nothing was changed.`);
    }
    // two different words never share a sentence
    expect(new Set(Object.values(VERB_CODE_WORDS)).size).toBe(Object.keys(VERB_CODE_WORDS).length);
  });

  it('an unknown verb word still says it refused, and names the word; a non-word is never printed', () => {
    const f = modelsActFailure(refused(409, { ok: false, error: 'lane-act-refused', verbCode: 'future-reason' }), 'lane-a', 'opus');
    expect(f.text).toContain('future-reason');
    expect(f.outcome).toBe('none');
    const g = modelsActFailure(refused(409, { ok: false, error: 'lane-act-refused', verbCode: '/home/x; rm -rf' }), 'lane-a', 'opus');
    expect(g.text).not.toContain('/home/x');
    expect(g.outcome).toBe('none');
    const h = modelsActFailure(refused(409, { ok: false, error: 'lane-act-refused' }), 'lane-a', 'opus');
    expect(h.outcome).toBe('none');
  });

  it('a 4xx with a word this build does not know is a refusal that names the word, not a success', () => {
    const f = modelsActFailure(refused(422, { ok: false, error: 'later-word' }), 'lane-a', 'opus');
    expect(f.outcome).toBe('none');
    expect(f.text).toContain('later-word');
  });
});

describe('the lane advance and pending words', () => {
  it('says each of the five states, and the absent-advance case apart from `unreported`', () => {
    const says = (a: Parameters<typeof advanceStateWords>[0]): string => advanceStateWords(a).text;
    const w = new Set([
      says(undefined),
      says({ state: 'ok', detail: null, pending: null, classes: null }),
      says({ state: 'absent', detail: null, pending: null, classes: null }),
      says({ state: 'unreadable', detail: 'bad bytes', pending: null, classes: null }),
      says({ state: 'invalid', detail: 'odd field', pending: null, classes: null }),
      says({ state: 'unreported', detail: null, pending: null, classes: null }),
    ]);
    expect(w.size).toBe(6);
    expect(says({ state: 'unreadable', detail: 'bad bytes', pending: null, classes: null })).toContain('bad bytes');
    expect(says({ state: 'invalid', detail: 'odd field', pending: null, classes: null })).toContain('odd field');
    expect(says(undefined)).toMatch(/not (known|read)/i);
  });
  it('a pending intent is said with its class, its target and its time', () => {
    const t = pendingWords({ how: 'hand', class: 'opus', from: 'model-6-gamma', to: 'model-6.1-gamma', emptied: [], at: '2026-11-18T08:00:00Z' });
    expect(t).toContain('opus');
    expect(t).toContain('model-6.1-gamma');
    expect(pendingWords({ how: 'hand', class: 'opus', from: 'm', to: null, emptied: [], at: '2026-11-18T08:00:00Z' })).toMatch(/empt/i);
  });
});

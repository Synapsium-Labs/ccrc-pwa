// The Models sheet's words and its two readers (model-class-advance wave R4): the POST's 200, and a refused POST's body as
// a typed failure. Neutral lane and model ids only: this repository is public.
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/lib/apiError';
import {
  advanceStateWords, asLaneModelsActAnswer, classActs, modelsActFailure, MODELS_READ_FAILED, MODELS_READ_UNREADABLE, pendingWords,
  revertConsequence, revertStillOffered, VERB_CODE_WORDS,
} from '../src/accounts/modelsSheetWords';
import { laneReadFailureOf } from '../src/lib/models';

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
  it('a refusal in which the verb NEVER RAN says "nothing was changed", per error word (F1 b)', () => {
    const cases: [ApiError, RegExp][] = [
      [refused(404, { ok: false, error: 'not-found' }), /no lane named lane-a/i],
      [refused(400, { ok: false, error: 'bad-request', why: 'bad-body' }), /malformed/i],
      [refused(400, { ok: false, error: 'bad-request', why: 'bad-lane' }), /lane/i],
      [refused(400, { ok: false, error: 'bad-request', why: 'bad-action' }), /action/i],
      [refused(400, { ok: false, error: 'bad-request', why: 'bad-class' }), /class/i],
      [refused(501, { ok: false, error: 'unsupported' }), /predates|cannot run/i],
      [refused(503, { ok: false, error: 'unavailable', cause: 'not-started' }), /did not start/i],
      [refused(409, { ok: false, error: 'busy', cause: 'agent-busy' }), /busy with another models request/i],
      [refused(401, { ok: false, error: 'unauthenticated' }), /signed out|sign in/i],
      [refused(403, { ok: false, error: 'foreign-origin' }), /not allowed|refused/i],
      [refused(401, 'Unauthorized'), /signed out|sign in/i],
      [refused(403, 'Forbidden'), /not allowed|refused/i],
    ];
    for (const [err, re] of cases) {
      const f = modelsActFailure(err, 'lane-a', 'opus');
      expect(f.outcome, JSON.stringify(err.body)).toBe('none');
      expect(f.text, JSON.stringify(err.body)).toMatch(re);
      expect(f.text, JSON.stringify(err.body)).toMatch(/nothing was changed/i);
    }
  });

  it('busy does not claim another models CHANGE: the one gate is shared with reads, so it may be the sheet\'s own read', () => {
    const f = modelsActFailure(refused(409, { ok: false, error: 'busy', cause: 'agent-busy' }), 'lane-a', 'opus');
    expect(f.text).not.toMatch(/models change/i);
    expect(f.text).toMatch(/own read|may be/i);
    expect(f.text).toMatch(/try again/i);
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

  // The codes deploy/models-op.mjs (holdOp, revertOp, advanceForWrite, writeJsonFile, materialise, the loaders their gates read
  // and the prelude every op runs) and the lane-lock layer in ccd/ccrc print on the hold, release and revert path: a hand-kept
  // list. server/test/models-verb-codes.test.ts is the scan that keeps it whole.
  const REACHABLE = [
    'no-previous', 'previous-not-in-catalogue', 'previous-taken', 'lock-busy', 'lock-unwritable', 'no-registry', 'registry-invalid',
    'unroutable-lane', 'no-such-account', 'anthropic-lane', 'registry-unwritable', 'advance-unwritable', 'settings-unwritable',
    'materialise-failed', 'advance-file-unreadable', 'advance-file-invalid', 'advance-invalid', 'registry-unreadable',
    'catalogue-unreadable', 'catalogue-invalid', 'roster-absent', 'roster-unreadable', 'roster-invalid', 'bad-account-id',
    'install-incomplete', 'budget-deferred', 'no-answer', 'unknown-class',
  ];

  it('every code on the hold, release and revert path that this list names has a sentence of its own (F9), and no two share one', () => {
    for (const code of REACHABLE) expect(Object.hasOwn(VERB_CODE_WORDS, code), code).toBe(true);
    expect(new Set(Object.values(VERB_CODE_WORDS)).size).toBe(Object.keys(VERB_CODE_WORDS).length);
  });

  it('a lane-act-refused says the verb\'s own words and claims NOTHING about what was written (F1 c): the lane is read again', () => {
    for (const verbCode of Object.keys(VERB_CODE_WORDS)) {
      const f = modelsActFailure(refused(409, { ok: false, error: 'lane-act-refused', verbCode }), 'lane-a', 'opus');
      expect(f.outcome, verbCode).toBe('refused');
      expect(f.text, verbCode).toBe(VERB_CODE_WORDS[verbCode]);
      expect(f.text, verbCode).not.toMatch(/nothing was (changed|written)/i);
    }
  });

  it('unroutable-lane is true for a revert whose hold had already landed: it says the model was not moved and a hold may stand', () => {
    expect(VERB_CODE_WORDS['unroutable-lane']).toMatch(/hold may already/i);
    expect(VERB_CODE_WORDS['unroutable-lane']).not.toMatch(/the move was refused/i);
  });

  it('an unknown verb word still says it refused, and names the word; a non-word is never printed', () => {
    const f = modelsActFailure(refused(409, { ok: false, error: 'lane-act-refused', verbCode: 'future-reason' }), 'lane-a', 'opus');
    expect(f.text).toContain('future-reason');
    expect(f.outcome).toBe('refused');
    expect(f.text).not.toMatch(/nothing was changed/i);
    const g = modelsActFailure(refused(409, { ok: false, error: 'lane-act-refused', verbCode: '/home/x; rm -rf' }), 'lane-a', 'opus');
    expect(g.text).not.toContain('/home/x');
    expect(g.outcome).toBe('refused');
    const h = modelsActFailure(refused(409, { ok: false, error: 'lane-act-refused' }), 'lane-a', 'opus');
    expect(h.outcome).toBe('refused');
    expect(h.text).not.toMatch(/nothing was changed/i);
  });

  it('a 4xx with a word this build does not know is a refusal that names the word, not a success', () => {
    const f = modelsActFailure(refused(422, { ok: false, error: 'later-word' }), 'lane-a', 'opus');
    expect(f.outcome).toBe('refused'); // a word of a later build: nothing here proves the verb never ran
    expect(f.text).toContain('later-word');
    expect(f.text).not.toMatch(/nothing was changed/i);
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
  it('a detail that already ends in a period is not given a second one (F20); an absent detail says no reason', () => {
    expect(advanceStateWords({ state: 'unreadable', detail: '/x/advance.json could not be read: EACCES.', pending: null, classes: null }).text)
      .toBe('The advance record cannot be read: /x/advance.json could not be read: EACCES.');
    expect(advanceStateWords({ state: 'invalid', detail: 'odd field', pending: null, classes: null }).text)
      .toBe('The advance record is not one this build reads: odd field.');
    expect(advanceStateWords({ state: 'invalid', detail: null, pending: null, classes: null }).text)
      .toBe('The advance record is not one this build reads.');
    for (const state of ['unreadable', 'invalid'] as const) {
      expect(advanceStateWords({ state, detail: 'x.', pending: null, classes: null }).text).not.toContain('..');
    }
  });
  it('a pending intent is said with its class, its target and its time', () => {
    const t = pendingWords({ how: 'hand', class: 'opus', from: 'model-6-gamma', to: 'model-6.1-gamma', emptied: [], at: '2026-11-18T08:00:00Z' });
    expect(t).toContain('opus');
    expect(t).toContain('model-6.1-gamma');
    expect(pendingWords({ how: 'hand', class: 'opus', from: 'm', to: null, emptied: [], at: '2026-11-18T08:00:00Z' })).toMatch(/empt/i);
  });
});

// ── which acts a class offers (F13): ONE pure function the sheet and the confirm both ask ──
describe('classActs and revertStillOffered', () => {
  const adv = (over: Record<string, unknown> = {}): never => ({ family: null, hold: null, previous: null, revertable: false, lastMove: null, ...over }) as never;
  const ok = (opus: unknown): never => ({ state: 'ok', detail: null, pending: null, classes: { haiku: adv(), sonnet: adv(), opus, fable: adv() } }) as never;
  const readOf = (advance: unknown): never => ({ kind: 'read', classes: {}, ...(advance === undefined ? {} : { advance }) }) as never;

  it('Hold where nothing is held, Release where something is, Revert only where the class is revertable', () => {
    expect(classActs(ok(adv()), 'opus')).toMatchObject({ hold: 'hold', held: false, revert: false });
    expect(classActs(ok(adv({ hold: { at: 'x', by: 'hand' } })), 'opus')).toMatchObject({ hold: 'release', held: true, revert: false });
    expect(classActs(ok(adv({ revertable: true, previous: { model: null, effort: null } })), 'opus')).toMatchObject({ hold: 'hold', revert: true });
  });
  it('an absent record offers Hold only; no hold is guessed where the record is unreadable, invalid, unreported or not read', () => {
    expect(classActs({ state: 'absent', detail: null, pending: null, classes: null }, 'opus')).toMatchObject({ hold: 'hold', held: false, revert: false });
    for (const state of ['unreadable', 'invalid', 'unreported'] as const) {
      expect(classActs({ state, detail: null, pending: null, classes: null }, 'opus'), state).toMatchObject({ hold: null, revert: false });
    }
    expect(classActs(undefined, 'opus')).toMatchObject({ hold: null, revert: false });
  });
  it('a revert is still offered only while the CURRENT read says the class is revertable', () => {
    expect(revertStillOffered(readOf(ok(adv({ revertable: true, previous: { model: 'm', effort: null } }))), 'opus')).toBe(true);
    expect(revertStillOffered(readOf(ok(adv({ revertable: false }))), 'opus')).toBe(false);
    expect(revertStillOffered(readOf(undefined), 'opus')).toBe(false);
    expect(revertStillOffered({ kind: 'absent' }, 'opus')).toBe(false);
    expect(revertStillOffered(null, 'opus')).toBe(false);
  });
  it('the revert consequence names the model on record; it takes a previous that exists, so it never says an empty class for a missing one', () => {
    expect(revertConsequence('lane-a', 'opus', 'm-now', { model: 'm-before', effort: null })[0]).toContain('Put back m-before');
    expect(revertConsequence('lane-a', 'opus', 'm-now', { model: null, effort: null })[0]).toContain('Put back an empty class');
  });
});

// ── a failed read of the lane, in words (F12) ──
describe('a failed read of the lane', () => {
  it('is classed by what happened: signed out, a foreign origin, refused, out of the roster, no answer, or unreadable (F9)', () => {
    expect(laneReadFailureOf(new ApiError(401, { error: 'unauthenticated' }))).toBe('signed-out');
    // A 403 is never "signed out": signing in cannot cure it.
    expect(laneReadFailureOf(new ApiError(403, { ok: false, error: 'foreign-origin' }))).toBe('foreign-origin');
    expect(laneReadFailureOf(new ApiError(403, 'no'))).toBe('refused');
    expect(laneReadFailureOf(new TypeError('Failed to fetch'))).toBe('no-answer');
    expect(laneReadFailureOf(new ApiError(503, { error: 'unavailable' }))).toBe('no-answer');
    // The route's own 404 word: the lane has left the roster. A 404 without it (a server with no such route) is unreadable.
    expect(laneReadFailureOf(new ApiError(404, { error: 'not-found' }))).toBe('not-in-roster');
    expect(laneReadFailureOf(new ApiError(404, { error: 'Not Found', statusCode: 404 }))).toBe('unreadable');
  });
  it('each class has words of its own, and the unreadable-files sentence no longer promises class names it did not draw', () => {
    expect(new Set(Object.values(MODELS_READ_FAILED)).size).toBe(6);
    expect(MODELS_READ_FAILED['signed-out']).toMatch(/sign/i);
    expect(MODELS_READ_FAILED['foreign-origin']).toMatch(/address/i);
    expect(MODELS_READ_FAILED['foreign-origin']).not.toMatch(/sign/i);
    expect(MODELS_READ_FAILED.refused).not.toMatch(/sign/i);
    expect(MODELS_READ_FAILED['not-in-roster']).toMatch(/no longer in the fleet's roster/);
    expect(MODELS_READ_FAILED['no-answer']).toMatch(/no answer|offline/i);
    expect(MODELS_READ_FAILED.unreadable).toMatch(/cannot read/i);
    expect(MODELS_READ_UNREADABLE).not.toMatch(/class names only/i);
  });
});

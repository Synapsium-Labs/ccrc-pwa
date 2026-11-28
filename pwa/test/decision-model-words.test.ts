// Settings › Overlord's decision model, its words and pure readers (Overlord W2 Settings, plan `w2-settings.md` Task 1):
// `decisionModelWords.ts` (L1) and the decision model's sentences in `lib/refusalWords.ts`. Neutral names only: the repository is
// public, and no fixture carries a key.
import { describe, expect, it } from 'vitest';
import {
  DECISION_HELD_CAUSES, DECISION_HOST_KINDS, DECISION_QUESTIONS, DECISION_ROW_MODES, readDecisionModelView, type DecisionRowSide, type DecisionRowView,
} from '../../shared/decisionModel';
import { DECISION_MODEL_REFUSALS } from '../../shared/refusal';
import { ApiError, DECISION_MODEL_REFUSAL_TEXT, OVERLORD_SETTINGS_REFUSAL_TEXT as ST, overlordSettingsRefusalText } from '../src/lib/api';
import {
  DECISION_HELD_TEXT, DECISION_HOST_KIND_LABELS, DECISION_MODE_LABELS, DECISION_WORDS as W, ceilingOf, decisionRowLine, decisionViewOf,
  decisionViewDetail, keyAnswerWords, keyRemoveWords, rowAnswerOf, rowAnswerWords, withRowAnswer,
} from '../src/overlord/decisionModelWords';

const SIDE: DecisionRowSide = { mode: 'shadow', ceiling: 600, armedLine: null, held: false };
const row = (over: Partial<DecisionRowView> = {}): DecisionRowView => ({
  id: 'programme.pick', side: SIDE, heldWhy: null, direction: 'advice', privateState: false,
  today: { serve: 3, maintenance: 1, reserved: 0, total: 4 }, line: null, offered: null, ...over,
});
const LINE = { id: 7, line: 0.85, admitted: true, labelled: 120, errors: 0, bound: null, canaryAsked: 20, canaryExpected: 20, canaryCrossed: 0 };
const VIEW = {
  rows: [{ ...row(), line: LINE }], fleetToday: 4, fleetCap: 3000,
  host: { kind: 'local', endpoint: 'http://127.0.0.1:8080/v1/ask', origin: 'http://127.0.0.1:8080', modelId: 'model-a' },
  key: { setAt: 1_700_000_000_000, masked: true },
};
const refused = (status: number, error: string, extra: Record<string, unknown> = {}): ApiError => new ApiError(status, { ok: false, error, ...extra });

describe('the read goes through decision model B\'s one reader, whole or not at all', () => {
  it('a whole view is read', () => {
    expect(decisionViewOf(VIEW)?.rows[0]?.line?.id).toBe(7);
  });
  it.each<[string, unknown]>([
    ['a row with a string line id', { ...VIEW, rows: [{ ...row(), line: { ...LINE, id: '7' } }] }],
    ['a side without armedLine', { ...VIEW, rows: [{ ...row(), side: { mode: 'off', ceiling: 600, held: false } }] }],
    ['a host without endpoint', { ...VIEW, host: { kind: 'local', origin: 'http://127.0.0.1:8080', modelId: 'model-a' } }],
    ['a row the catalogue does not hold', { ...VIEW, rows: [{ ...row(), id: 'zz.unknown' }] }],
    ['a mode outside the three', { ...VIEW, rows: [{ ...row(), side: { ...SIDE, mode: 'half' } }] }],
    ['an unreadable answer', 'unreadable'],
  ])('%s is no view (never a partial one)', (_n, body) => {
    expect(decisionViewOf(body)).toBeNull();
  });
});

describe('a row is drawn from the read (SQ3)', () => {
  it('its question is the catalogue\'s own text, and an advice row says so', () => {
    const l = decisionRowLine(row());
    expect(l.question).toBe(DECISION_QUESTIONS['programme.pick'].instructions);
    expect(l.direction).toBe(W.advice);
    expect(decisionRowLine(row({ direction: 'gate' })).direction).toBe(W.gate);
  });
  it('a held row says why, by its cause, and a row that is not held says nothing of it', () => {
    expect(decisionRowLine(row({ side: { ...SIDE, held: true }, heldWhy: 'line-key' })).held)
      .toBe(`Held: ${DECISION_HELD_TEXT['line-key']}. Resume to turn it on again.`);
    expect(decisionRowLine(row({ side: { ...SIDE, held: true }, heldWhy: null })).held).toBe('Held: the server did not say why. Resume to turn it on again.');
    expect(decisionRowLine(row({ heldWhy: 'drift' })).held).toBeNull();
  });
  it('a private-state row says it carries your words', () => {
    expect(decisionRowLine(row({ privateState: true })).privateState).toBe(W.privateState);
    expect(decisionRowLine(row()).privateState).toBeNull();
  });
  it('the line: none yet, admitted, or not admitted, with the canary as asked of expected and crossed', () => {
    expect(decisionRowLine(row()).line).toBe('No admitted line yet.');
    expect(decisionRowLine(row({ line: LINE })).line).toBe('Line 85% admitted, from 120 labelled answers; canary asked 20 of 20, crossed 0.');
    expect(decisionRowLine(row({ line: { ...LINE, admitted: false, labelled: 9, errors: 2, canaryAsked: 3 } })).line)
      .toBe('Not admitted yet, 9 labelled answers (2 errors); canary asked 3 of 20, crossed 0.');
  });
  it('today\'s calls are of the row\'s own ceiling, as read', () => {
    expect(decisionRowLine(row()).today).toBe('Today: 4 of 600 calls.');
    expect(decisionRowLine(row({ side: { ...SIDE, ceiling: 50 }, today: { serve: 1, maintenance: 0, reserved: 2, total: 3 } })).today)
      .toBe('Today: 3 of 50 calls (2 in flight).');
  });
  it('an armed gate names its line, and an offered line carries its id for Approve', () => {
    const armed = row({ direction: 'gate', side: { ...SIDE, mode: 'armed', armedLine: { id: 5, line: 0.8 } }, offered: { id: 7, line: 0.85 } });
    const l = decisionRowLine(armed);
    expect(l.armedOn).toBe('Armed on line 80% (#5).');
    expect(l.offered).toEqual({ text: 'A new line is offered: 85% (#7).', id: 7 });
    expect(decisionRowLine(row()).armedOn).toBeNull();
    expect(decisionRowLine(row()).offered).toBeNull();
  });
});

describe('a door\'s answer (SQ4)', () => {
  it('the side the door installed is read; an off the journal refused is "held, not off" with its cause', () => {
    expect(rowAnswerOf({ ok: true, row: 'programme.pick', side: SIDE, heldWhy: null })).toEqual({ side: SIDE, offRefused: false, cause: null, heldWhy: null });
    expect(rowAnswerWords({ ok: true, row: 'programme.pick', side: SIDE, heldWhy: null })).toEqual([W.saved]);
    const held = { ok: true, row: 'scope.widens', side: { ...SIDE, mode: 'armed', held: true }, state: 'held', offRefused: true, cause: 'journal incoherent' };
    expect(rowAnswerWords(held)).toEqual(['Held, not off: the authority journal could not record the change (journal incoherent). Nothing is asked while it is held.']);
  });
  it('the answer\'s heldWhy is a cause of the shared list, null, or undefined when absent or not a known cause', () => {
    for (const c of DECISION_HELD_CAUSES) expect(rowAnswerOf({ ok: true, row: 'programme.pick', side: SIDE, heldWhy: c })?.heldWhy, c).toBe(c);
    expect(rowAnswerOf({ ok: true, row: 'programme.pick', side: SIDE, heldWhy: null })?.heldWhy).toBeNull();
    expect(rowAnswerOf({ ok: true, row: 'programme.pick', side: SIDE })?.heldWhy).toBeUndefined();
    expect(rowAnswerOf({ ok: true, row: 'programme.pick', side: SIDE, heldWhy: 'zz-unknown' })?.heldWhy).toBeUndefined();
    expect(rowAnswerOf({ ok: true, row: 'programme.pick', side: SIDE, heldWhy: 7 })?.heldWhy).toBeUndefined();
  });
  it('an answer it cannot read says nothing, never a refusal', () => {
    expect(rowAnswerOf('unreadable')).toBeNull();
    expect(rowAnswerWords('unreadable')).toEqual([]);
    expect(rowAnswerWords({ ok: true, side: { mode: 'off' } })).toEqual([]);
  });
  it('the key\'s save and removal name the rows they held', () => {
    expect(keyAnswerWords({ ok: true, held: [] })).toEqual([W.saved]);
    expect(keyAnswerWords({ ok: true, held: ['scope.widens'] })).toEqual([W.saved, 'Held: scope.widens.']);
    expect(keyRemoveWords({ ok: true, held: ['scope.widens', 'relay.method'] })).toEqual([W.keyRemoved, 'Held: scope.widens, relay.method.']);
    expect(keyAnswerWords('unreadable')).toEqual([]);
  });
});

describe('an answer is installed in the view (A5)', () => {
  const OTHER = row({ id: 'programme.any', side: { ...SIDE, mode: 'off' } });
  const VIEW2 = decisionViewOf({ ...VIEW, rows: [row({ heldWhy: 'drift', side: { ...SIDE, held: true } }), OTHER] })!;
  const NEW_SIDE: DecisionRowSide = { mode: 'armed', ceiling: 900, armedLine: { id: 3, line: 0.9 }, held: false };

  it('replaces that row\'s side and its heldWhy when the answer carries one, and nothing else', () => {
    const before = JSON.stringify(VIEW2);
    const a = rowAnswerOf({ ok: true, row: 'programme.pick', side: NEW_SIDE, heldWhy: null })!;
    const next = withRowAnswer(VIEW2, 'programme.pick', a);
    expect(next.rows[0]!.side).toEqual(NEW_SIDE);
    expect(next.rows[0]!.heldWhy).toBeNull();
    expect(next.rows[1]).toEqual(VIEW2.rows[1]);
    expect(next.rows[0]!.id).toBe('programme.pick');
    expect(next.rows[0]!.today).toEqual(VIEW2.rows[0]!.today);
    expect(next.fleetToday).toBe(VIEW2.fleetToday);
    expect(next.fleetCap).toBe(VIEW2.fleetCap);
    expect(next.host).toEqual(VIEW2.host);
    expect(next.key).toEqual(VIEW2.key);
    expect(JSON.stringify(VIEW2), 'the view it was given is unchanged').toBe(before);
    const held = withRowAnswer(VIEW2, 'programme.pick', rowAnswerOf({ ok: true, row: 'programme.pick', side: NEW_SIDE, heldWhy: 'canary' })!);
    expect(held.rows[0]!.heldWhy).toBe('canary');
  });
  it('keeps the row\'s heldWhy when the answer carries none', () => {
    const a = rowAnswerOf({ ok: true, row: 'programme.pick', side: NEW_SIDE })!;
    expect(a.heldWhy).toBeUndefined();
    const next = withRowAnswer(VIEW2, 'programme.pick', a);
    expect(next.rows[0]!.side).toEqual(NEW_SIDE);
    expect(next.rows[0]!.heldWhy).toBe('drift');
  });
});

describe('a view the shared reader refuses names its fault (F4)', () => {
  it('decisionViewDetail is the shared reader\'s detail for a refused body, and null for one it reads', () => {
    const bad = { ...VIEW, rows: [{ ...row(), id: 'zz.unknown' }] };
    const r = readDecisionModelView(bad);
    expect(r.ok).toBe(false);
    expect(decisionViewDetail(bad)).toBe((r as { ok: false; detail: string }).detail);
    expect(typeof decisionViewDetail(bad)).toBe('string');
    expect(decisionViewDetail('unreadable')).toBe((readDecisionModelView('unreadable') as { ok: false; detail: string }).detail);
    expect(decisionViewDetail(VIEW)).toBeNull();
  });
  it('the words: the host-only final, the lost key, Reload and the unreadable sentence with its detail', () => {
    for (const s of [W.stepUpFinalHost, W.keyGone, W.reload]) expect(typeof s === 'string' && s.length > 0).toBe(true);
    expect(W.stepUpFinalHost).not.toBe(W.stepUpFinal);
    expect(W.unreadable('a fault')).toContain('a fault');
  });
});

describe('the ceiling field sends a whole number, and the bounds are the door\'s', () => {
  it.each<[string, number | null]>([['600', 600], [' 50 ', 50], ['10', 10], ['99999', 99999], ['', null], ['6.5', null], ['-1', null], ['1e3', null], ['abc', null]])(
    '%j reads %j', (text, n) => { expect(ceilingOf(text)).toBe(n); },
  );
});

describe('every word has its sentence (the brief\'s ruling 5)', () => {
  it('the decision model\'s refusals: one sentence per word of the shared list, both ways', () => {
    expect(Object.keys(DECISION_MODEL_REFUSAL_TEXT).sort()).toEqual(Object.keys(DECISION_MODEL_REFUSALS).sort());
    expect(Object.keys(DECISION_MODEL_REFUSALS)).toHaveLength(11);
    for (const word of Object.keys(DECISION_MODEL_REFUSALS)) {
      expect(overlordSettingsRefusalText(refused(409, word), 'decision-row', true), word).not.toMatch(/^Refused:/);
      expect(overlordSettingsRefusalText(refused(409, word), 'decision-key', true), word).not.toMatch(/^Refused:/);
    }
  });
  it('the held causes: one sentence per cause of the closed list, both ways', () => {
    expect(Object.keys(DECISION_HELD_TEXT).sort()).toEqual([...DECISION_HELD_CAUSES].sort());
  });
  it('the modes and the host kinds: one label each', () => {
    expect(Object.keys(DECISION_MODE_LABELS)).toEqual([...DECISION_ROW_MODES]);
    expect(Object.keys(DECISION_HOST_KIND_LABELS).sort()).toEqual([...DECISION_HOST_KINDS].sort());
  });
  it('the doors\' other words: each act\'s own sentence, with the door\'s detail where it names the fault', () => {
    expect(overlordSettingsRefusalText(refused(403, 'auth-off'), 'decision-row', true)).toBe(ST['decision-auth-off']);
    expect(overlordSettingsRefusalText(refused(403, 'auth-off'), 'decision-key-remove', true)).toBe(ST['decision-auth-off']);
    expect(overlordSettingsRefusalText(refused(400, 'bad-request', { detail: 'the key is at most 4096 visible characters' }), 'decision-key', true))
      .toBe(`${ST['key-bad-request']} (the key is at most 4096 visible characters)`);
    expect(overlordSettingsRefusalText(refused(400, 'bad-endpoint', { detail: 'the endpoint carries userinfo' }), 'decision-key', true))
      .toBe(`${DECISION_MODEL_REFUSAL_TEXT['bad-endpoint']} (the endpoint carries userinfo)`);
    expect(overlordSettingsRefusalText(refused(503, 'authority-rolled-back', { detail: 'incoherent' }), 'decision-row', true))
      .toBe(`${ST['journal-refused']} (incoherent)`);
    expect(overlordSettingsRefusalText(refused(503, 'slot-busy'), 'decision-key', true)).toBe(ST['slot-busy']);
    expect(overlordSettingsRefusalText(refused(409, 'row-changed'), 'decision-row', true)).toBe('This row changed since you read it. Look again, then try again.');
    expect(overlordSettingsRefusalText(refused(409, 'a-newer-word'), 'decision-row', true)).toBe('Refused: a-newer-word');
  });
});

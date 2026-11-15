// Overlord W1, answer marks (plan w1-delegation-marks.md Task 1, Step 4; the floors rule is D-8217's): the cases over
// `itemMarkable`, `markViewOf` (with `itemMarksView`, its one composition) and `parseAnswerMarkWrite`, written once here as
// suite cases over a module. `answer-marks.test.ts` runs them against the real modules, and `mutation-floors.test.ts` runs
// them against each named mutant. The expected words are written out, never read from the code the cases judge.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DECIDER_TS = path.join(ROOT, 'server/src/coord/answerMarks.ts');
const VOCAB_TS = path.join(ROOT, 'shared/answerMarks.ts');

export type AnswerMarkDeciders = typeof import('../../src/coord/answerMarks.js');
export type AnswerMarkVocab = typeof import('../../../shared/answerMarks.js');

export const ITEM_MARKABLE_KEY = 'server/src/coord/answerMarks.ts#itemMarkable';
export const MARK_VIEW_KEY = 'server/src/coord/answerMarks.ts#markViewOf';
export const PARSE_WRITE_KEY = 'shared/answerMarks.ts#parseAnswerMarkWrite';

export const NOW = 1_790_000_000_000;
export const MIN = 60_000;
export const HOUR = 60 * MIN;
/** The Recently cleared window, written out (48 hours, `shared/ledgers.ts#CLEARED_WINDOW_MS`), so a mutant of the window
 *  cannot move the expectation with it. */
export const WINDOW = 48 * HOUR;

type Row = { kind: string; state: string; raisedAt: number; heldUntil: number | null; closedAt: number | null };
const row = (o: Partial<Row>): Row => ({
  kind: o.kind ?? 'decide', state: o.state ?? 'open', raisedAt: o.raisedAt ?? NOW - 10 * HOUR,
  heldUntil: o.heldUntil === undefined ? null : o.heldUntil, closedAt: o.closedAt === undefined ? null : o.closedAt,
});
const word = (v: { markable: boolean; reason?: string }): string => (v.markable ? 'markable' : (v.reason as string));

// ---------- itemMarkable ----------

export function itemMarkableCases(m: Pick<AnswerMarkDeciders, 'itemMarkable'>): Record<string, SuiteCase> {
  const at = (o: Partial<Row>, now = NOW): string => word(m.itemMarkable(row(o), now));
  return {
    'a shown decide or value item that is open or checking is markable': () => {
      for (const kind of ['decide', 'value']) for (const state of ['open', 'checking']) expect(at({ kind, state })).toBe('markable');
    },
    'a do item and a secret item carry no box whatever their state': () => {
      for (const kind of ['do', 'secret']) {
        for (const state of ['open', 'checking', 'done', 'withdrawn', 'dismissed']) {
          expect(at({ kind, state, closedAt: state === 'open' || state === 'checking' ? null : NOW - HOUR })).toBe('no-box');
        }
      }
    },
    'a kind this build does not know carries no box, before any other reason': () => {
      expect(at({ kind: 'approval' })).toBe('no-box');
      expect(at({ kind: 'toString' })).toBe('no-box');
      expect(at({ kind: 'approval', heldUntil: NOW + HOUR })).toBe('no-box');
    },
    'no-box comes before not-shown': () => {
      expect(at({ kind: 'do', heldUntil: NOW + HOUR })).toBe('no-box');
    },
    'a held item is not shown until heldUntil, and is at it': () => {
      expect(at({ heldUntil: NOW + 1 })).toBe('not-shown');
      expect(at({ heldUntil: NOW })).toBe('markable');
      expect(at({ heldUntil: NOW - HOUR })).toBe('markable');
    },
    'an item raised after now is not shown': () => {
      expect(at({ raisedAt: NOW + 1 })).toBe('not-shown');
      expect(at({ raisedAt: NOW })).toBe('markable');
    },
    'an item settled inside its hold was never shown, whatever its state': () => {
      expect(at({ state: 'done', heldUntil: NOW - HOUR, closedAt: NOW - 2 * HOUR })).toBe('not-shown');
      expect(at({ state: 'withdrawn', heldUntil: NOW - HOUR, closedAt: NOW - 2 * HOUR })).toBe('not-shown');
    },
    'not-shown comes before past-window and not-listed': () => {
      expect(at({ state: 'done', heldUntil: NOW - WINDOW - 2 * HOUR, closedAt: NOW - WINDOW - 3 * HOUR })).toBe('not-shown');
    },
    'a done item closed at or after its hold is markable inside the window': () => {
      expect(at({ state: 'done', heldUntil: NOW - 2 * HOUR, closedAt: NOW - 2 * HOUR })).toBe('markable');
      expect(at({ state: 'done', closedAt: NOW - HOUR })).toBe('markable');
    },
    'the window: closed exactly at now - 48h is markable, one millisecond before it is past-window': () => {
      expect(at({ state: 'done', raisedAt: NOW - WINDOW - HOUR, closedAt: NOW - WINDOW })).toBe('markable');
      expect(at({ state: 'done', raisedAt: NOW - WINDOW - HOUR, closedAt: NOW - WINDOW - 1 })).toBe('past-window');
    },
    'a done item with no closing time is past the window, never markable': () => {
      expect(at({ state: 'done', closedAt: null })).toBe('past-window');
    },
    'withdrawn, dismissed and a state this build does not know are not listed, inside the window or not': () => {
      for (const state of ['withdrawn', 'dismissed', 'archived', '']) {
        expect(at({ state, closedAt: NOW - HOUR })).toBe('not-listed');
        expect(at({ state, closedAt: NOW - WINDOW - HOUR })).toBe('not-listed');
      }
    },
  };
}

// ---------- markViewOf and itemMarksView ----------

export function markViewCases(m: Pick<AnswerMarkDeciders, 'markViewOf' | 'itemMarksView'>): Record<string, SuiteCase> {
  return {
    'no record is never': () => { expect(m.markViewOf(null)).toEqual({ state: 'never' }); },
    'a record of value 1 is marked, with its time, and a signed-in actor reads signedIn': () => {
      expect(m.markViewOf({ value: 1, at: NOW - MIN, actor: 'op-a' })).toEqual({ state: 'marked', at: NOW - MIN, signedIn: true });
    },
    'a record of value 0 is withdrawn, never never': () => {
      expect(m.markViewOf({ value: 0, at: NOW - 2 * MIN, actor: 'op-a' })).toEqual({ state: 'withdrawn', at: NOW - 2 * MIN, signedIn: true });
    },
    'a flag-off actor reads signedIn false, ticked or not': () => {
      expect(m.markViewOf({ value: 1, at: NOW, actor: 'flag-off' })).toEqual({ state: 'marked', at: NOW, signedIn: false });
      expect(m.markViewOf({ value: 0, at: NOW, actor: 'flag-off' })).toEqual({ state: 'withdrawn', at: NOW, signedIn: false });
    },
    'a failed read is unmeasured, with its detail or the default one': () => {
      expect(m.markViewOf('unmeasured', 'disk I/O error')).toEqual({ state: 'unmeasured', detail: 'disk I/O error' });
      expect(m.markViewOf('unmeasured')).toEqual({ state: 'unmeasured', detail: 'the mark could not be read' });
    },
    'itemMarksView: a markable item carries both marks, each from its own record': () => {
      expect(m.itemMarksView(row({}), NOW, { ok: true, couldAnswer: { value: 1, at: NOW - MIN, actor: 'op-a' }, unsure: null })).toEqual({
        couldAnswer: { state: 'marked', at: NOW - MIN, signedIn: true }, unsure: { state: 'never' },
      });
      expect(m.itemMarksView(row({}), NOW, { ok: true, couldAnswer: null, unsure: { value: 1, at: NOW, actor: 'flag-off' } })).toEqual({
        couldAnswer: { state: 'never' }, unsure: { state: 'marked', at: NOW, signedIn: false },
      });
    },
    'itemMarksView: an item that carries no box carries no field, even when its read failed': () => {
      expect(m.itemMarksView(row({ kind: 'do' }), NOW, { ok: true, couldAnswer: null, unsure: null })).toBeUndefined();
      expect(m.itemMarksView(row({ state: 'dismissed', closedAt: NOW - HOUR }), NOW, { ok: false, detail: 'x' })).toBeUndefined();
    },
    'itemMarksView: a failed read gives a markable item both marks unmeasured, with the detail': () => {
      expect(m.itemMarksView(row({}), NOW, { ok: false, detail: 'database is locked' })).toEqual({
        couldAnswer: { state: 'unmeasured', detail: 'database is locked' }, unsure: { state: 'unmeasured', detail: 'database is locked' },
      });
    },
  };
}

// ---------- parseAnswerMarkWrite ----------

export function parseWriteCases(m: Pick<AnswerMarkVocab, 'parseAnswerMarkWrite'>): Record<string, SuiteCase> {
  const ok = (body: unknown): unknown => { const r = m.parseAnswerMarkWrite(body); return r.ok ? r.write : 'refused'; };
  const good = { kind: 'item', id: 3, mark: 'unsure', value: true };
  return {
    'accepts an item mark, ticked or unticked, each mark': () => {
      expect(ok(good)).toEqual({ kind: 'item', id: 3, mark: 'unsure', value: true });
      expect(ok({ ...good, mark: 'could-answer', value: false })).toEqual({ kind: 'item', id: 3, mark: 'could-answer', value: false });
    },
    'accepts kind ask (the door refuses it until PR B)': () => {
      expect(ok({ ...good, kind: 'ask', id: 1 })).toEqual({ kind: 'ask', id: 1, mark: 'unsure', value: true });
    },
    'refuses a body that is not an object': () => {
      for (const b of [null, undefined, 'item', 3, [good], true]) expect(ok(b)).toBe('refused');
    },
    'refuses a missing key': () => {
      for (const k of ['kind', 'id', 'mark', 'value']) {
        const b: Record<string, unknown> = { ...good }; delete b[k];
        expect(ok(b)).toBe('refused');
      }
    },
    'refuses an extra key': () => {
      expect(ok({ ...good, why: 'routine' })).toBe('refused');
      expect(ok({ ...good, actor: 'op-a' })).toBe('refused');
    },
    'refuses a kind or a mark outside the vocabulary': () => {
      for (const kind of ['approval', 'Item', '', 'toString']) expect(ok({ ...good, kind })).toBe('refused');
      for (const mark of ['sure', 'couldAnswer', '', 'hasOwnProperty']) expect(ok({ ...good, mark })).toBe('refused');
    },
    'refuses an id that is not a positive safe integer': () => {
      for (const id of [0, -1, 1.5, '3', Number.MAX_SAFE_INTEGER + 1, Number.NaN, null]) expect(ok({ ...good, id })).toBe('refused');
      expect(ok({ ...good, id: 1 })).not.toBe('refused');
    },
    'refuses a value that is not a boolean': () => {
      for (const value of [1, 0, 'true', null]) expect(ok({ ...good, value })).toBe('refused');
    },
    'a refusal carries a detail in words': () => {
      const r = m.parseAnswerMarkWrite({ ...good, mark: 'sure' });
      expect(r.ok).toBe(false);
      expect(r.ok ? '' : r.detail).toMatch(/mark is one of could-answer, unsure/);
    },
  };
}

// ---------- the sets ----------

export const ITEM_MARKABLE_SET: MutantSet<AnswerMarkDeciders> = {
  modulePath: DECIDER_TS,
  suite: itemMarkableCases,
  mutants: [
    // The plan's red checks: ignore heldUntil; accept a do item; `>` for `>=` at the window's edge.
    { id: 'AM-ITEM-1', old: 'if (shownAt === null || shownAt > now) return', new: 'if (false) return' },
    { id: 'AM-ITEM-2', old: 'do: false, secret: false', new: 'do: true, secret: false' },
    { id: 'AM-ITEM-3', old: 'row.closedAt >= now - CLEARED_WINDOW_MS', new: 'row.closedAt > now - CLEARED_WINDOW_MS' },
    { id: 'AM-ITEM-4', old: 'do: false, secret: false', new: 'do: false, secret: true' },
    { id: 'AM-ITEM-5', old: 'shownAt === null || shownAt > now', new: 'shownAt === null' },
    { id: 'AM-ITEM-6', old: 'shownAt === null || shownAt > now', new: 'shownAt > now' },
    { id: 'AM-ITEM-7', old: "if (row.state === 'done') {", new: "if (row.state !== 'withdrawn') {" },
    { id: 'AM-ITEM-8', old: 'row.closedAt !== null && row.closedAt >= now', new: 'row.closedAt === null || row.closedAt >= now' },
    { id: 'AM-ITEM-9', old: '? { markable: true } : { markable: false, reason: \'past-window\' }', new: '? { markable: true } : { markable: false, reason: \'not-listed\' }' },
    { id: 'AM-ITEM-10', old: 'if ((OPEN_ITEM_STATES as readonly string[]).includes(row.state)) return { markable: true };', new: "if (row.state === 'open') return { markable: true };" },
    { id: 'AM-ITEM-11', old: "return { markable: false, reason: 'not-listed' };\n}", new: "return { markable: true };\n}" },
    { id: 'AM-ITEM-12', old: 'BOXED_KINDS[row.kind as ItemKind] !== true', new: 'BOXED_KINDS[row.kind as ItemKind] === false' },
  ],
};

export const MARK_VIEW_SET: MutantSet<AnswerMarkDeciders> = {
  modulePath: DECIDER_TS,
  suite: markViewCases,
  mutants: [
    // The plan's red check: read a flag-off actor as signed in.
    { id: 'AM-VIEW-1', old: 'signedIn: newest.actor !== DARK_MARK_ACTOR', new: 'signedIn: true' },
    { id: 'AM-VIEW-2', old: "state: newest.value === 1 ? 'marked' : 'withdrawn'", new: "state: newest.value === 0 ? 'withdrawn' : 'withdrawn'" },
    { id: 'AM-VIEW-3', old: "if (newest === null) return { state: 'never' };", new: "if (newest === null) return { state: 'withdrawn', at: 0, signedIn: false };" },
    { id: 'AM-VIEW-4', old: 'at: newest.at,', new: 'at: 0,' },
    { id: 'AM-VIEW-5', old: "if (newest === 'unmeasured') return { state: 'unmeasured', detail };", new: "if (newest === 'unmeasured') return { state: 'never' };" },
    { id: 'AM-VIEW-6', old: "detail = 'the mark could not be read'", new: "detail = ''" },
    { id: 'AM-VIEW-7', old: 'if (!itemMarkable(row, now).markable) return undefined;', new: '' },
    { id: 'AM-VIEW-8', old: "if (!read.ok) return { couldAnswer: markViewOf('unmeasured', read.detail), unsure: markViewOf('unmeasured', read.detail) };", new: "if (!read.ok) return undefined;" },
    { id: 'AM-VIEW-9', old: 'unsure: markViewOf(read.unsure) }', new: 'unsure: markViewOf(read.couldAnswer) }' },
    { id: 'AM-VIEW-10', old: "markViewOf('unmeasured', read.detail) };", new: "markViewOf('unmeasured') };" },
  ],
};

export const PARSE_WRITE_SET: MutantSet<AnswerMarkVocab> = {
  modulePath: VOCAB_TS,
  suite: parseWriteCases,
  mutants: [
    { id: 'AM-PARSE-1', old: "if (keys.some((k) => !Object.prototype.hasOwnProperty.call(WRITE_KEYS, k))) return bad('the body carries only kind, id, mark and value');", new: '' },
    { id: 'AM-PARSE-2', old: '!Number.isSafeInteger(id) || id < 1', new: '!Number.isSafeInteger(id) || id < 0' },
    { id: 'AM-PARSE-3', old: '!Number.isSafeInteger(id) || id < 1', new: 'id < 1' },
    { id: 'AM-PARSE-4', old: "if (typeof value !== 'boolean') return bad('value is true or false');", new: '' },
    { id: 'AM-PARSE-5', old: "if (!isAnswerMarkKind(kind)) return bad(`kind is one of ${ANSWER_MARK_KINDS.join(', ')}`);", new: '' },
    { id: 'AM-PARSE-6', old: "if (!isAnswerMarkName(mark)) return bad(`mark is one of ${ANSWER_MARK_NAMES.join(', ')}`);", new: '' },
    { id: 'AM-PARSE-9', old: "typeof v === 'string' && Object.prototype.hasOwnProperty.call(ANSWER_MARK_NAME_MAP, v)", new: "typeof v === 'string' && v in ANSWER_MARK_NAME_MAP" },
    { id: 'AM-PARSE-10', old: 'return { ok: true, write: { kind, id, mark, value } };', new: 'return { ok: true, write: { kind, id, mark, value: true } };' },
  ],
};

export const ANSWER_MARK_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [ITEM_MARKABLE_KEY]: ITEM_MARKABLE_SET as MutantSet<never>,
  [MARK_VIEW_KEY]: MARK_VIEW_SET as MutantSet<never>,
  [PARSE_WRITE_KEY]: PARSE_WRITE_SET as MutantSet<never>,
};

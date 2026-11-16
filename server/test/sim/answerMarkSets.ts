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
export const ASK_MARKABLE_KEY = 'server/src/coord/answerMarks.ts#askMarkable';

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
    'a record of value 1 is marked, with its id and time, and a signed-in actor reads signedIn': () => {
      expect(m.markViewOf({ id: 4, value: 1, at: NOW - MIN, actor: 'op-a' })).toEqual({ state: 'marked', id: 4, at: NOW - MIN, signedIn: true });
    },
    'a record of value 0 is withdrawn, never never': () => {
      expect(m.markViewOf({ id: 5, value: 0, at: NOW - 2 * MIN, actor: 'op-a' })).toEqual({ state: 'withdrawn', id: 5, at: NOW - 2 * MIN, signedIn: true });
    },
    'a flag-off actor reads signedIn false, ticked or not': () => {
      expect(m.markViewOf({ id: 6, value: 1, at: NOW, actor: 'flag-off' })).toEqual({ state: 'marked', id: 6, at: NOW, signedIn: false });
      expect(m.markViewOf({ id: 7, value: 0, at: NOW, actor: 'flag-off' })).toEqual({ state: 'withdrawn', id: 7, at: NOW, signedIn: false });
    },
    'a failed read is unmeasured, with its detail or the default one': () => {
      expect(m.markViewOf('unmeasured', 'disk I/O error')).toEqual({ state: 'unmeasured', detail: 'disk I/O error' });
      expect(m.markViewOf('unmeasured')).toEqual({ state: 'unmeasured', detail: 'the mark could not be read' });
    },
    'itemMarksView: a markable item carries both marks, each from its own record': () => {
      expect(m.itemMarksView(row({}), NOW, { ok: true, couldAnswer: { id: 8, value: 1, at: NOW - MIN, actor: 'op-a' }, unsure: null })).toEqual({
        couldAnswer: { state: 'marked', id: 8, at: NOW - MIN, signedIn: true }, unsure: { state: 'never' },
      });
      expect(m.itemMarksView(row({}), NOW, { ok: true, couldAnswer: null, unsure: { id: 9, value: 1, at: NOW, actor: 'flag-off' } })).toEqual({
        couldAnswer: { state: 'never' }, unsure: { state: 'marked', id: 9, at: NOW, signedIn: false },
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
    'accepts kind ask': () => {
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

// ---------- askMarkable, askLiveOf and askListsView (PR B, plan Task 5) ----------

type AskRow = { state: string; answeredBy: string | null; answeredAt: number | null; releasedAt: number | null; reachedOperatorAt: number | null };
const askRow = (o: Partial<AskRow>): AskRow => ({
  state: o.state ?? 'released', answeredBy: o.answeredBy === undefined ? null : o.answeredBy,
  answeredAt: o.answeredAt === undefined ? null : o.answeredAt, releasedAt: o.releasedAt === undefined ? NOW - HOUR : o.releasedAt,
  reachedOperatorAt: o.reachedOperatorAt === undefined ? null : o.reachedOperatorAt,
});
type Live = boolean | 'unmeasured';
const LIVES: readonly Live[] = [true, false, 'unmeasured'];
const REACHED = { reachedOperatorAt: NOW - 3 * WINDOW };

export function askMarkableCases(m: Pick<AnswerMarkDeciders, 'askMarkable' | 'askLiveOf' | 'askListsView'>): Record<string, SuiteCase> {
  const at = (o: Partial<AskRow>, live: Live = false, now = NOW): string => word(m.askMarkable(askRow(o), live, now));
  return {
    'a released or declined ask inside the window is markable, live or not, stamped or not': () => {
      for (const state of ['released', 'declined']) for (const live of LIVES) {
        expect(at({ state }, live)).toBe('markable');
        expect(at({ state, ...REACHED }, live)).toBe('markable');
      }
    },
    'a released or declined ask past the window is markable only while live; unmeasured counts as not live': () => {
      for (const state of ['released', 'declined']) {
        expect(at({ state, releasedAt: NOW - WINDOW - HOUR }, true)).toBe('markable');
        expect(at({ state, releasedAt: NOW - WINDOW - HOUR }, false)).toBe('past-window');
        expect(at({ state, releasedAt: NOW - WINDOW - HOUR }, 'unmeasured')).toBe('past-window');
      }
    },
    'the window: released exactly at now - 48h is markable, one millisecond before it is past-window': () => {
      expect(at({ releasedAt: NOW - WINDOW })).toBe('markable');
      expect(at({ releasedAt: NOW - WINDOW - 1 })).toBe('past-window');
      expect(at({ state: 'declined', releasedAt: NOW - WINDOW - 1 })).toBe('past-window');
    },
    'a released ask with no release time is markable only while live': () => {
      expect(at({ releasedAt: null }, false)).toBe('past-window');
      expect(at({ releasedAt: null }, true)).toBe('markable');
    },
    'an ask the operator answered is markable inside the window of its answer, live or not, stamped or not, and past it is not': () => {
      for (const live of LIVES) for (const reach of [{}, REACHED]) {
        expect(at({ state: 'answered', answeredBy: 'operator', answeredAt: NOW - HOUR, releasedAt: NOW - 3 * WINDOW, ...reach }, live)).toBe('markable');
        expect(at({ state: 'answered', answeredBy: 'operator', answeredAt: NOW - WINDOW - HOUR, releasedAt: NOW - HOUR, ...reach }, live)).toBe('past-window');
      }
      expect(at({ state: 'answered', answeredBy: 'operator', answeredAt: NOW - WINDOW })).toBe('markable');
      expect(at({ state: 'answered', answeredBy: 'operator', answeredAt: NOW - WINDOW - 1 })).toBe('past-window');
      expect(at({ state: 'answered', answeredBy: 'operator', answeredAt: null })).toBe('past-window');
    },
    'an ask its parent answered is the operator\'s only when it reached them, then inside the window of the answer, live or not': () => {
      for (const live of LIVES) {
        expect(at({ state: 'answered', answeredBy: 'lane-a-parent', answeredAt: NOW - HOUR }, live)).toBe('not-shown');
        expect(at({ state: 'answered', answeredBy: null, answeredAt: NOW - HOUR }, live)).toBe('not-shown');
        expect(at({ state: 'answered', answeredBy: 'lane-a-parent', answeredAt: NOW - HOUR, releasedAt: NOW - 3 * WINDOW, ...REACHED }, live)).toBe('markable');
        expect(at({ state: 'answered', answeredBy: 'lane-a-parent', answeredAt: NOW - WINDOW - HOUR, releasedAt: NOW - HOUR, ...REACHED }, live)).toBe('past-window');
      }
    },
    'a held ask is not shown, live or not': () => {
      for (const live of LIVES) expect(at({ state: 'held', releasedAt: null }, live)).toBe('not-shown');
    },
    'an answering ask that reached the operator is a released one: inside the window, or past it while live; one that never reached them is not shown': () => {
      for (const live of LIVES) {
        expect(at({ state: 'answering', ...REACHED }, live)).toBe('markable');
        expect(at({ state: 'answering', releasedAt: null }, live)).toBe('not-shown');
        expect(at({ state: 'answering' }, live)).toBe('not-shown');
      }
      expect(at({ state: 'answering', releasedAt: NOW - WINDOW - HOUR, ...REACHED }, true)).toBe('markable');
      expect(at({ state: 'answering', releasedAt: NOW - WINDOW - HOUR, ...REACHED }, false)).toBe('past-window');
      expect(at({ state: 'answering', releasedAt: NOW - WINDOW - HOUR, ...REACHED }, 'unmeasured')).toBe('past-window');
    },
    'a stale ask that reached the operator is markable inside the window of the time it went stale, never by live; one that never reached them is not shown': () => {
      for (const live of LIVES) {
        expect(at({ state: 'stale', releasedAt: NOW - HOUR, ...REACHED }, live)).toBe('markable');
        expect(at({ state: 'stale', releasedAt: NOW - WINDOW - HOUR, ...REACHED }, live)).toBe('past-window');
        expect(at({ state: 'stale', releasedAt: NOW - HOUR }, live)).toBe('not-shown');
      }
    },
    'unknown and a state this build does not know are not listed, live or not, stamped or not': () => {
      for (const state of ['unknown', 'archived', '']) for (const live of LIVES) {
        expect(at({ state }, live)).toBe('not-listed');
        expect(at({ state, ...REACHED }, live)).toBe('not-listed');
      }
    },
    'askLiveOf: the ask\'s own key is live, another key or none is not, and unmeasured stays unmeasured': () => {
      expect(m.askLiveOf({ kind: 'read', key: 'k1' }, 'k1')).toBe(true);
      expect(m.askLiveOf({ kind: 'read', key: 'k2' }, 'k1')).toBe(false);
      expect(m.askLiveOf({ kind: 'read', key: null }, 'k1')).toBe(false);
      expect(m.askLiveOf({ kind: 'unmeasured' }, 'k1')).toBe('unmeasured');
    },
    'askListsView: the live rows are asks, every other a cleared row, each with its own marks': () => {
      const rows = [{ id: 1, live: true }, { id: 2, live: false }, { id: 3, live: 'unmeasured' as const }];
      const v = m.askListsView(rows, (id) => ({ ok: true, couldAnswer: id === 2 ? { id: 9, value: 1, at: NOW, actor: 'op-a' } : null, unsure: null }));
      expect(v.asks.map((r) => r.id)).toEqual([1]);
      expect(v.asksCleared.map((r) => r.id)).toEqual([2, 3]);
      expect(v.asks[0]!.answerMarks).toEqual({ couldAnswer: { state: 'never' }, unsure: { state: 'never' } });
      expect(v.asksCleared[0]!.answerMarks).toEqual({ couldAnswer: { state: 'marked', id: 9, at: NOW, signedIn: true }, unsure: { state: 'never' } });
    },
    'askListsView: a failed mark read gives each row both marks unmeasured and drops none': () => {
      const v = m.askListsView([{ id: 1, live: true }, { id: 2, live: false }], () => ({ ok: false, detail: 'disk I/O error' }));
      const gone = { state: 'unmeasured', detail: 'disk I/O error' };
      expect([...v.asks, ...v.asksCleared].map((r) => r.answerMarks)).toEqual([{ couldAnswer: gone, unsure: gone }, { couldAnswer: gone, unsure: gone }]);
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
    { id: 'AM-VIEW-11', old: 'id: newest.id,', new: 'id: 0,' },
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

export const ASK_MARKABLE_SET: MutantSet<AnswerMarkDeciders> = {
  modulePath: DECIDER_TS,
  suite: askMarkableCases,
  mutants: [
    // The plan's red checks: read live by child alone, without the ask's key; drop the window for an ask that is not live;
    // accept the parent's answer as the operator's. Review 2217 F1's: ignore the reach stamp, either way.
    { id: 'AM-ASK-1', old: "read.kind === 'unmeasured' ? 'unmeasured' : read.key === askKey", new: "read.kind === 'unmeasured' ? 'unmeasured' : read.key !== null" },
    { id: 'AM-ASK-2', old: '(liveCounts && live === true) || inWindow(at)', new: 'true' },
    { id: 'AM-ASK-3', old: 'reached || row.answeredBy === ASK_OPERATOR_PRINCIPAL', new: 'true' },
    { id: 'AM-ASK-4', old: '(liveCounts && live === true)', new: '(liveCounts && live !== false)' },
    { id: 'AM-ASK-5', old: '(liveCounts && live === true) || inWindow(at)', new: 'inWindow(at)' },
    { id: 'AM-ASK-6', old: 'at !== null && at >= now - CLEARED_WINDOW_MS', new: 'at !== null && at > now - CLEARED_WINDOW_MS' },
    { id: 'AM-ASK-7', old: "case 'released': case 'declined':", new: "case 'released':" },
    { id: 'AM-ASK-8', old: 'shown(row.answeredAt, false)', new: 'shown(row.releasedAt, false)' },
    { id: 'AM-ASK-9', old: "case 'held': return askRefused('not-shown');", new: '' },
    { id: 'AM-ASK-10', old: "default: return askRefused('not-listed');", new: 'default: return ASK_MARKABLE;' },
    { id: 'AM-ASK-11', old: "ASK_MARKABLE : askRefused('past-window')", new: "ASK_MARKABLE : askRefused('not-listed')" },
    { id: 'AM-ASK-12', old: "read.kind === 'unmeasured' ? 'unmeasured' :", new: "read.kind === 'unmeasured' ? false :" },
    { id: 'AM-ASK-13', old: 'asks: marked.filter((r) => r.live === true)', new: 'asks: marked.filter((r) => r.live !== false)' },
    { id: 'AM-ASK-14', old: 'asksCleared: marked.filter((r) => r.live !== true)', new: 'asksCleared: marked.filter((r) => r.live === false)' },
    { id: 'AM-ASK-15', old: 'const reached = row.reachedOperatorAt !== null;', new: 'const reached = true;' },
    { id: 'AM-ASK-16', old: 'const reached = row.reachedOperatorAt !== null;', new: 'const reached = false;' },
    { id: 'AM-ASK-17', old: "case 'answering': return reached ? shown(row.releasedAt, true)", new: "case 'answering': return reached ? shown(row.releasedAt, false)" },
    { id: 'AM-ASK-18', old: "case 'stale': return reached ? shown(row.releasedAt, false)", new: "case 'stale': return reached ? shown(row.releasedAt, true)" },
    { id: 'AM-ASK-19', old: "case 'answering': return reached ?", new: "case 'answering': return true ?" },
    { id: 'AM-ASK-20', old: "case 'stale': return reached ?", new: "case 'stale': return true ?" },
    { id: 'AM-ASK-21', old: 'reached || row.answeredBy === ASK_OPERATOR_PRINCIPAL', new: 'reached' },
  ],
};

export const ANSWER_MARK_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [ITEM_MARKABLE_KEY]: ITEM_MARKABLE_SET as MutantSet<never>,
  [MARK_VIEW_KEY]: MARK_VIEW_SET as MutantSet<never>,
  [PARSE_WRITE_KEY]: PARSE_WRITE_SET as MutantSet<never>,
  [ASK_MARKABLE_KEY]: ASK_MARKABLE_SET as MutantSet<never>,
};

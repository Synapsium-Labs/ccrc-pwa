// The card's mutant sets (Overlord W1a card plan, PR A; the floors rule is D-8217's): `trimCard`, and each renderer's
// never-empty rule (C51), each run against suite cases that load the mutated copy of server/src/continuity/card.ts.
// Registered in mutation-floors.test.ts's MUTANT_SETS, with a floor each in mutation-floors.json.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { CardFacts, CardSection, Fact } from '../../../shared/continuity-card.js';
import type * as CardModule from '../../src/continuity/card.js';
import type { MutantSet, SuiteCase } from './mutate.js';

type Card = typeof CardModule;
const CARD_TS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/continuity/card.ts');
export const CARD_TRIM_KEY = 'server/src/continuity/card.ts#trimCard';
export const CARD_NEVER_EMPTY_KEY = 'server/src/continuity/card.ts#renderCard';

const AT = Date.UTC(2026, 10, 13, 12, 0, 0);
const read = <T>(value: T): Fact<T> => ({ kind: 'read', value });
const unmeasured = (what: string): Fact<never> => ({ kind: 'unmeasured', what });
const empty = (over: Partial<CardFacts> = {}): CardFacts => ({
  sessionId: 'lane-a-project-a', role: 'coordinator', roleWhy: 'fixture', at: AT,
  runs: read([]), ledger: read([]), claims: read([]), intent: read(false), itemsRaised: read([]),
  mailOutstanding: read([]), notes: read([]), checkpoint: read(null),
  history: read({ verb: 'ccrc history describe', node: null }), ...over,
});
const RUN = { id: 11, programme: 'prog-a', wave: 1, waveOf: 2, state: 'working', planPath: null, kind: 'work' };
const MAIL = { deliveryId: 7, fromId: 'coordinator', at: AT, subject: 's' };
const sec = (key: string, rank: number, keep: boolean, size: number): CardSection => ({ key, rank, keep, text: `${key}:${'x'.repeat(size)}` });
const join = (s: readonly CardSection[]): string => s.map((x) => x.text).join('\n');

export const CARD_TRIM_SET: MutantSet<Card> = {
  modulePath: CARD_TS,
  mutants: [
    { id: 'T1', old: '.filter((i) => !s[i]!.keep)', new: '.filter(() => true)' },
    { id: 'T2', old: 's[a]!.rank - s[b]!.rank || b - a', new: 's[b]!.rank - s[a]!.rank || b - a' },
    { id: 'T3', old: 's[a]!.rank - s[b]!.rank || b - a', new: 's[a]!.rank - s[b]!.rank || a - b' },
    { id: 'T4', old: 'if (cardTokens(textNow()) <= budgetTokens) break;', new: 'if (cardTokens(textNow()) < budgetTokens) break;' },
    { id: 'T5', old: 'if (cardTokens(textNow()) <= budgetTokens) break;', new: '' },
    { id: 'T6', old: 'if (dropped.size > 0) lines.push(', new: 'if (dropped.size > 1) lines.push(' },
    { id: 'T7', old: 'if (tokens > budgetTokens) {', new: 'if (tokens > budgetTokens * 2) {' },
    { id: 'T8', old: 'return { text, leftOut: dropped.size };', new: 'return { text, leftOut: order.length };' },
  ],
  suite(m): Record<string, SuiteCase> {
    return {
      'a text at exactly the budget drops nothing': () => {
        const s = [sec('k', 0, true, 40), sec('a', 1, false, 40)];
        expect(m.trimCard(s, m.cardTokens(join(s)))).toEqual({ text: join(s), leftOut: 0 });
      },
      'keeps every keep section and drops the lowest rank first': () => {
        const s = [sec('role', 0, true, 50), sec('low', 1, false, 400), sec('high', 3, false, 40), sec('hist', 0, true, 50)];
        const r = m.trimCard(s, 100);
        expect(r.leftOut).toBe(1);
        expect(r.text).toContain('role:');
        expect(r.text).toContain('hist:');
        expect(r.text).toContain('high:');
        expect(r.text).toContain('Left out 1 part(s) of this card to fit its budget of 100 tokens: low.');
        expect(r.text).not.toMatch(/always keeps/);
      },
      'a tie drops the later section': () => {
        const r = m.trimCard([sec('k', 0, true, 10), sec('first', 5, false, 300), sec('second', 5, false, 300)], 150);
        expect([r.leftOut, r.text.includes('first:'), r.text.includes('second:')]).toEqual([1, true, false]);
      },
      'kept sections over the budget say so': () => {
        const r = m.trimCard([sec('a', 0, true, 600), sec('b', 1, false, 10)], 150);
        expect(r.leftOut).toBe(1);
        expect(r.text).toMatch(/\nThe parts this card always keeps come to \d+ tokens, over its budget of 150; none of them was cut\.$/);
      },
    };
  },
};

export const CARD_NEVER_EMPTY_SET: MutantSet<Card> = {
  modulePath: CARD_TS,
  mutants: [
    { id: 'R1', old: "const silent = facts.every((k) => f[k].kind === 'read' && !holds(f, k));", new: 'const silent = false;' },
    { id: 'R2', old: "const silent = facts.every((k) => f[k].kind === 'read' && !holds(f, k));", new: 'const silent = facts.every((k) => !holds(f, k));' },
    { id: 'R3', old: "if (typeof v === 'boolean') return v;", new: "if (typeof v === 'boolean') return false;" },
    { id: 'R4', old: 'return Array.isArray(v) ? v.length > 0 : true;', new: 'return Array.isArray(v) ? v.length >= 0 : true;' },
    { id: 'R5', old: 'if (v === null) return false;', new: 'if (v === null) return true;' },
    { id: 'R6', old: "worker: ['runs', 'claims', 'mailOutstanding'],", new: "worker: ['runs', 'claims'],"},
    { id: 'R7', old: "reviewer: ['runs', 'claims', 'mailOutstanding'],", new: "reviewer: ['claims', 'mailOutstanding'],"},
    { id: 'R8', old: "plain: ['claims', 'intent', 'itemsRaised', 'mailOutstanding'],", new: "plain: ['claims', 'intent', 'itemsRaised', 'mailOutstanding', 'runs'],"},
    { id: 'R9', old: "'mailOutstanding', 'notes', 'checkpoint'],", new: "'mailOutstanding', 'checkpoint'],"},
    { id: 'R10', old: 'const body = [...nothingSections(role, f), ...bodyOf(role, f)];', new: 'const body = [...bodyOf(role, f)];' },
  ],
  suite(m): Record<string, SuiteCase> {
    const has = (role: Parameters<Card['renderCard']>[0], f: CardFacts): boolean =>
      m.renderCard(role, f).some((x) => x.text === m.CARD_NOTHING_LINE);
    return {
      'every role with nothing renders the line': () => {
        for (const role of ['coordinator', 'worker', 'reviewer', 'plain'] as const) expect(has(role, empty()), role).toBe(true);
      },
      'an unmeasured fact among empty ones is named, not folded into nothing': () => {
        expect(has('coordinator', empty({ claims: unmeasured('the claims') }))).toBe(false);
      },
      'intent alone is content': () => { expect(has('plain', empty({ intent: read(true) }))).toBe(false); },
      'a checkpoint of null is no content': () => { expect(has('coordinator', empty({ checkpoint: read(null) }))).toBe(true); },
      'a worker with only mail has content': () => { expect(has('worker', empty({ mailOutstanding: read([MAIL]) }))).toBe(false); },
      'a reviewer with only its run has content': () => { expect(has('reviewer', empty({ runs: read([RUN]) }))).toBe(false); },
      'plain does not read the runs': () => { expect(has('plain', empty({ runs: unmeasured('the runs') }))).toBe(true); },
      'a coordinator with only a note has content': () => {
        expect(has('coordinator', empty({ notes: read([{ id: 1, at: AT, text: 'n' }]) }))).toBe(false);
      },
    };
  },
};

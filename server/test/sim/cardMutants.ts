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
export const CARD_ONE_LINE_KEY = 'server/src/continuity/card.ts#oneLine';
export const CARD_BLOCK_KEY = 'server/src/continuity/card.ts#block';

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
    { id: 'T4', old: 'if (cardTokens(untrimmed) <= budgetTokens) return', new: 'if (cardTokens(untrimmed) < budgetTokens) return' },
    { id: 'T5', old: 'if (keptTokens > budgetTokens) {', new: 'if (keptTokens > budgetTokens * 2) {' },
    { id: 'T6', old: 'come to ${keptTokens} tokens', new: 'come to ${cardTokens(withLine(named))} tokens' },
    { id: 'T7', old: '  return { text: untrimmed, leftOut: 0 };\n}', new: '  return { text: counted, leftOut: dropped.size };\n}' },
    { id: 'T8', old: ' || utf8Bytes(counted) <= utf8Bytes(untrimmed)) return', new: ') return' },
    { id: 'T9', old: 'if (cardTokens(fitted) <= budgetTokens) return', new: 'if (false) return' },
  ],
  suite(m): Record<string, SuiteCase> {
    return {
      'a text at exactly the budget drops nothing': () => {
        const s = [sec('k', 0, true, 40), sec('a', 1, false, 400)];
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
      'kept sections over the budget say so, with their own size': () => {
        const s = [sec('a', 0, true, 600), sec('b', 1, false, 10)];
        const r = m.trimCard(s, 150);
        expect(r.leftOut).toBe(1);
        expect(r.text).toMatch(new RegExp(`\\nThe parts this card always keeps come to ${m.cardTokens(s[0]!.text)} tokens, over its budget of 150; none of them was cut\\.$`));
      },
      'kept parts that fit return the untrimmed text when the left-out line would make it longer': () => {
        const s = [sec('a', 0, true, 290), sec('b', 1, false, 3)];
        expect(m.trimCard(s, 93)).toEqual({ text: join(s), leftOut: 0 });
      },
      'the left-out count alone, over budget but shorter than the untrimmed text': () => {
        const s = [sec('a', 0, true, 290), { key: 'k'.repeat(120), rank: 1, keep: false, text: 'x'.repeat(200) }];
        expect(m.trimCard(s, 93)).toEqual({ text: `${s[0]!.text}\nLeft out 1 part(s) of this card to fit its budget.`, leftOut: 1 });
      },
    };
  },
};

/** A hostile field: every line break and format character a field could carry, each followed by a forged row. */
const H = 'x\nFORGED a\r\nFORGED b\u2028FORGED c\u2029FORGED d\u202eFORGED e';
/** The card's lines outside every fenced block. */
function bareLines(text: string): string[] {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of text.split('\n')) {
    if (fence === null && /^`{3,}$/.test(line)) fence = line;
    else if (fence !== null && line === fence) fence = null;
    else if (fence === null) out.push(line);
  }
  return out;
}
const forged = (text: string): boolean => bareLines(text).some((l) => /^FORGED|[\r\u2028\u2029\u202e]/.test(l));
const card = (m: Card, f: CardFacts): string => join(m.renderCard('coordinator', f));

export const CARD_ONE_LINE_SET: MutantSet<Card> = {
  modulePath: CARD_TS,
  mutants: [
    { id: 'O1', old: '/[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]/gu', new: '/(?!)/gu' },
    { id: 'O2', old: '/[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]/gu', new: '/[\\p{Cc}]/gu' },
    { id: 'O3', old: 'chars.length > max ?', new: 'false ?' },
    { id: 'O4', old: "c.paths.map((x) => oneLine(x)).join(', ')", new: "c.paths.join(', ')" },
    { id: 'O5', old: "oneLine(r.planPath)", new: 'r.planPath' },
    { id: 'O6', old: "from ${oneLine(m.fromId)}", new: 'from ${m.fromId}' },
  ],
  suite(m): Record<string, SuiteCase> {
    return {
      'a hostile claim path stays on its line': () => {
        expect(forged(card(m, empty({ claims: read([{ id: 1, paths: [H], runId: null }]) })))).toBe(false);
      },
      'a hostile plan path stays on its line': () => {
        expect(forged(card(m, empty({ runs: read([{ ...RUN, planPath: H }]) })))).toBe(false);
      },
      'a hostile sender stays on its line': () => {
        expect(forged(card(m, empty({ mailOutstanding: read([{ ...MAIL, fromId: H }]) })))).toBe(false);
      },
      'oneLine cuts a long field at its cap': () => { expect(m.oneLine('z'.repeat(250))).toBe(`${'z'.repeat(200)}…`); },
    };
  },
};

export const CARD_BLOCK_SET: MutantSet<Card> = {
  modulePath: CARD_TS,
  mutants: [
    { id: 'M1', old: "${block(n.text, SHORT_CAP_BYTES, `on note ${n.id}'s row`)}", new: '${n.text}' },
    { id: 'M2', old: "${block(cp.text, CHECKPOINT_CAP_BYTES, 'on the checkpoint row')}", new: '${cp.text}' },
    { id: 'M3', old: "block(it.text, SHORT_CAP_BYTES, `on item ${it.id}'s row`)", new: 'it.text' },
    { id: 'M4', old: "block(p.decisions.map((d) => `${iso(d.at)}: ${d.text}`).join('\\n'), SHORT_CAP_BYTES, where)", new: "p.decisions.map((d) => `${iso(d.at)}: ${d.text}`).join('\\n')" },
    { id: 'M5', old: "block(ratified.join('\\n'), SHORT_CAP_BYTES, where)", new: "ratified.join('\\n')" },
    { id: 'M6', old: "block(unratified.join('\\n'), SHORT_CAP_BYTES, where)", new: "unratified.join('\\n')" },
  ],
  suite(m): Record<string, SuiteCase> {
    const ledger = (over: Partial<CardFacts['ledger'] extends Fact<infer T> ? T extends readonly (infer P)[] ? P : never : never>) =>
      empty({ ledger: read([{ slug: 'prog-a', goals: [], openItems: [], decisions: [], ...over }]) });
    return {
      'a note is fenced': () => { expect(forged(card(m, empty({ notes: read([{ id: 8, at: AT, text: H }]) })))).toBe(false); },
      'a checkpoint is fenced': () => { expect(forged(card(m, empty({ checkpoint: read({ at: AT, text: H }) })))).toBe(false); },
      'an item text is fenced': () => {
        expect(forged(card(m, empty({ itemsRaised: read([{ id: 6, programme: 'prog-a', kind: 'decide', state: 'open', neededBy: 'soon', at: AT, text: H, everTicked: false }]) })))).toBe(false);
      },
      'a decision is fenced': () => { expect(forged(card(m, ledger({ decisions: [{ at: AT, text: H }] })))).toBe(false); },
      'a ratified goal is fenced': () => { expect(forged(card(m, ledger({ goals: [{ text: H, ratified: true }] })))).toBe(false); },
      'an unratified goal is fenced': () => { expect(forged(card(m, ledger({ goals: [{ text: H, ratified: false }] })))).toBe(false); },
      'a mail subject is fenced': () => { expect(forged(card(m, empty({ mailOutstanding: read([{ ...MAIL, subject: H }]) })))).toBe(false); },
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

// PR B (plan `w1a-card.md` Task 3): `cardRoleOf`, the card's role, its reason and the renderer that draws it. Its suite
// writes each answer out rather than reading it off the code: the renderer per role, the wider card for an undecided
// reading, and the reason naming the fact that could not be measured.
export const CARD_ROLE_KEY = 'server/src/continuity/card.ts#cardRoleOf';
type RoleFactsArg = Parameters<Card['cardRoleOf']>[0];
const facts = (over: Partial<RoleFactsArg>): RoleFactsArg => ({
  designation: 'none', auditBody: false, replayBody: false, child: { kind: 'none' }, childRunKind: 'unmeasured',
  claimsOpenRun: 'no', declaredIntent: 'no', ...over,
});
export const CARD_ROLE_SET: MutantSet<Card> = {
  modulePath: CARD_TS,
  mutants: [
    { id: 'R1 undecided coordinator-or-plain drawn plain', old: "could not be read: coordinator or plain`, renderer: 'coordinator' }", new: "could not be read: coordinator or plain`, renderer: 'plain' }" },
    { id: 'R2 undecided worker-or-reviewer drawn as reviewer', old: "return { role: 'undecided', roleWhy: why, renderer: 'worker' };", new: "return { role: 'undecided', roleWhy: why, renderer: 'reviewer' };" },
    { id: 'R3 every role drawn plain', old: 'renderer: FLEET_ROLES[role].cardRenderer }', new: "renderer: 'plain' }" },
    { id: 'R4 the intent never named as unread', old: "f.declaredIntent === 'unmeasured' ? 'its declared coordinator intent' : null", new: 'null' },
    { id: 'R5 the coordinator reason inverted', old: "f.claimsOpenRun === 'yes' ? 'it claims an open run'", new: "f.claimsOpenRun === 'no' ? 'it claims an open run'" },
    { id: 'R6 the child mark read as the run kind', old: "const why = f.child.kind === 'child'", new: "const why = f.child.kind !== 'child'" },
  ],
  suite(m): Record<string, SuiteCase> {
    return {
      'each decided role is drawn by its FLEET_ROLES renderer': () => {
        expect(m.cardRoleOf(facts({ claimsOpenRun: 'yes' }))).toEqual({ role: 'coordinator', roleWhy: 'it claims an open run', renderer: 'coordinator' });
        expect(m.cardRoleOf(facts({ declaredIntent: 'yes' }))).toEqual({ role: 'coordinator', roleWhy: 'it declared coordinator intent', renderer: 'coordinator' });
        expect(m.cardRoleOf(facts({}))).toMatchObject({ role: 'plain', renderer: 'plain' });
        expect(m.cardRoleOf(facts({ child: { kind: 'child', runId: 3 }, childRunKind: 'work' }))).toEqual({ role: 'worker', roleWhy: 'a child of run 3, a work run', renderer: 'worker' });
        expect(m.cardRoleOf(facts({ child: { kind: 'child', runId: 3 }, childRunKind: 'review' }))).toMatchObject({ role: 'reviewer', renderer: 'reviewer' });
        expect(m.cardRoleOf(facts({ designation: 'live' }))).toMatchObject({ role: 'overlord', renderer: 'overlord' });
        expect(m.cardRoleOf(facts({ auditBody: true }))).toMatchObject({ role: 'auditor', renderer: 'plain' });
      },
      'an undecided reading is drawn by the wider card and names what could not be read': () => {
        expect(m.cardRoleOf(facts({ claimsOpenRun: 'unmeasured', declaredIntent: 'unmeasured' }))).toEqual({ role: 'undecided',
          roleWhy: 'its runs and its declared coordinator intent could not be read: coordinator or plain', renderer: 'coordinator' });
        expect(m.cardRoleOf(facts({ declaredIntent: 'unmeasured' })).roleWhy).toBe('its declared coordinator intent could not be read: coordinator or plain');
        expect(m.cardRoleOf(facts({ child: { kind: 'unreadable' } }))).toEqual({ role: 'undecided',
          roleWhy: 'its child marker could not be read: worker or reviewer', renderer: 'worker' });
        expect(m.cardRoleOf(facts({ child: { kind: 'child', runId: 4 } })).roleWhy).toBe('a child of run 4, whose kind could not be read: worker or reviewer');
      },
    };
  },
};

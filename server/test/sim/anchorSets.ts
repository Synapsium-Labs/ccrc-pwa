// The anchor's mutant set (Overlord W1a, the anchor piece, plan `w1a-anchor.md` Task 1; the floors rule is D-8217's):
// `renderAnchor`, run against suite cases that load the mutated copy of server/src/continuity/anchor.ts. Registered in
// mutation-floors.test.ts's MUTANT_SETS, with a floor in mutation-floors.json. The plan's four mutants come first (A1 to
// A4); the rest hold the null rule, the ceiling's arithmetic and the role line's cut.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { AnchorGeneration, CardFacts, CardRun, Fact } from '../../../shared/continuity-card.js';
import { utf8Bytes } from '../../../shared/utf8.js';
import type * as AnchorModule from '../../src/continuity/anchor.js';
import type { MutantSet, SuiteCase } from './mutate.js';

type Anchor = typeof AnchorModule;
const ANCHOR_TS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/continuity/anchor.ts');
export const ANCHOR_RENDER_KEY = 'server/src/continuity/anchor.ts#renderAnchor';

const AT = Date.UTC(2026, 10, 14, 12, 0, 0);
const read = <T>(value: T): Fact<T> => ({ kind: 'read', value });
const unmeasured = (what: string): Fact<never> => ({ kind: 'unmeasured', what });
const HASH = 'abcdef0123456789'.repeat(4);
const facts = (over: Partial<CardFacts> = {}): CardFacts => ({
  sessionId: 'lane-a-project-a', role: 'coordinator', roleWhy: 'fixture', at: AT,
  runs: read([]), ledger: read([]), claims: read([]), intent: read(false), itemsRaised: read([]),
  mailOutstanding: read([]), mailMore: false, notes: read([]), timers: read([]), checkpoint: read(null),
  history: read({ verb: 'ccrc history describe', node: null }), ...over,
});
const run = (id: number, programme: string): CardRun => ({ id, programme, wave: 1, waveOf: 2, state: 'working', planPath: null, kind: 'work' });
const gen = (g: AnchorGeneration) => ({ cardHash: HASH, generation: g });
const LIVE = gen({ kind: 'live', term: 2, n: 5, starting: false });
const CANARY = 'term 2 · generation 5 (this start not yet reported)';

export const ANCHOR_RENDER_SET: MutantSet<Anchor> = {
  modulePath: ANCHOR_TS,
  mutants: [
    // A1, the plan's: the canaries clipped before the role line (the role line takes the canaries' room).
    { id: 'A1', old: 'const room = ANCHOR_CEILING.start - utf8Bytes(head) - utf8Bytes(fixed) - 1;', new: 'const room = ANCHOR_CEILING.start - utf8Bytes(head) - 1;' },
    // A2, the plan's: the instruction dropped.
    { id: 'A2', old: "form === 'start' ? [canaryLine(a, form), countsLine(f), ANCHOR_INSTRUCTION] :", new: "form === 'start' ? [canaryLine(a, form), countsLine(f)] :" },
    // A3, the plan's: the prompt form past 600.
    { id: 'A3', old: "if (form === 'prompt') return `${ANCHOR_PREFIX} ${fixed}`;", new: '' },
    // A4, the plan's: `n` read for a start not yet minted.
    { id: 'A4', old: '(g.starting ? `${g.n + 1} starting` : String(g.n))', new: 'String(g.n)' },
    { id: 'A5', old: "const term = g.kind === 'live' ? String(g.term) : g.kind === 'none' ? 'none' : ANCHOR_UNMEASURED;", new: "const term = g.kind === 'live' ? String(g.term) : 'none';" },
    { id: 'A6', old: "fact.kind === 'unmeasured' ? `${what} ${ANCHOR_UNMEASURED}` : `${fact.value.length} ${what}`", new: "fact.kind === 'unmeasured' ? `0 ${what}` : `${fact.value.length} ${what}`" },
    { id: 'A7', old: "if (f.ledger.kind === 'unmeasured' || f.itemsRaised.kind === 'unmeasured')", new: "if (f.ledger.kind === 'unmeasured')" },
    { id: 'A8', old: 'const role = fitBytes(mask(roleLine(f)), room);', new: 'const role = fitBytes(roleLine(f), room);' },
    { id: 'A9', old: 'if (used + b > room) break;', new: 'if (used > room) break;' },
    { id: 'A10', old: "if (f.role === 'undecided') return `role: undecided (${oneLine(f.roleWhy)})`;", new: "if (f.role === 'undecided') return 'role: undecided';" },
    // Fix round 1, F2: the start form read as if its start were reported, with the card hash it cannot vouch for.
    { id: 'A11', old: "  if (form === 'start') return `term ${term} · generation ${gen} ${ANCHOR_START_NOT_REPORTED}`;\n", new: '' },
    // Door process A2, Task 6: the delta form, its canaries, its counts and its one line.
    { id: 'D1', old: "[`${DELTA_PREFIX} ${canaryLine(a, 'prompt')}`, ...counts(f)]", new: "[`${DELTA_PREFIX} ${canaryLine(a, 'start')}`, ...counts(f)]" },
    { id: 'D2', old: "[`${DELTA_PREFIX} ${canaryLine(a, 'prompt')}`, ...counts(f)]", new: "[`${DELTA_PREFIX} ${canaryLine(a, 'prompt')}`]" },
    { id: 'D3', old: "  if (form === 'delta') return fitBytes(", new: "  if (form === ('none' as string)) return fitBytes(" },
    { id: 'D4', old: "[`${DELTA_PREFIX} ${canaryLine(a, 'prompt')}`, ...counts(f)]", new: "[...counts(f), `${DELTA_PREFIX} ${canaryLine(a, 'prompt')}`]" },
  ],
  suite(m): Record<string, SuiteCase> {
    return {
      'the four parts, in order': () => {
        expect(m.renderAnchor(facts({ runs: read([run(1, 'prog-a')]) }), LIVE, 'start').split('\n'))
          .toEqual([`${m.ANCHOR_PREFIX} role: coordinator of prog-a`, CANARY, 'counts: 1 runs · 0 open items and asks · 0 outstanding mail · 0 notes', m.ANCHOR_INSTRUCTION]);
      },
      'a long role line is cut first, under the ceiling, the canaries whole': () => {
        const many = Array.from({ length: 20 }, (_, i) => run(i + 1, `prog-${i}-${'a'.repeat(150)}`));
        const t = m.renderAnchor(facts({ runs: read(many) }), LIVE, 'start');
        expect(utf8Bytes(t)).toBeLessThanOrEqual(1500);
        expect(t.split('\n').slice(1)).toEqual([CANARY, 'counts: 20 runs · 0 open items and asks · 0 outstanding mail · 0 notes', m.ANCHOR_INSTRUCTION]);
      },
      'four-byte text stays under the ceiling, cut on a code point': () => {
        const t = m.renderAnchor(facts({ runs: read([run(1, '\u{1F600}'.repeat(900))]) }), LIVE, 'start');
        expect(utf8Bytes(t)).toBeLessThanOrEqual(1500);
        expect(Buffer.from(t, 'utf8').toString('utf8')).toBe(t);
      },
      'the prompt form stays under 600, whatever the role line': () => {
        const many = Array.from({ length: 8 }, (_, i) => run(i + 1, `prog-${i}-${'a'.repeat(150)}`));
        const t = m.renderAnchor(facts({ runs: read(many) }), LIVE, 'prompt');
        expect(utf8Bytes(t)).toBeLessThanOrEqual(600);
        expect(t).not.toContain('role:');
      },
      'the start form names the generation before it, and no card hash; the prompt form keeps the hash': () => {
        const t = m.renderAnchor(facts(), LIVE, 'start');
        expect(t.split('\n')[1]).toBe(CANARY);
        expect(t).not.toContain(HASH.slice(0, 12));
        expect(m.renderAnchor(facts(), LIVE, 'prompt')).toContain(`term 2 · generation 5 · card ${HASH.slice(0, 12)}`);
      },
      'an unminted start reads n+1 starting': () => {
        expect(m.renderAnchor(facts(), gen({ kind: 'live', term: 2, n: 5, starting: true }), 'prompt')).toContain('generation 6 starting');
      },
      'unread facts render as unmeasured': () => {
        const f = facts({ role: 'undecided', roleWhy: 'its runs could not be read', runs: unmeasured('r'), itemsRaised: unmeasured('i'), notes: unmeasured('n') });
        const t = m.renderAnchor(f, gen({ kind: 'unmeasured', what: 'g' }), 'start');
        expect(t).toContain('role: undecided (its runs could not be read)');
        expect(t).toContain('term unmeasured · generation unmeasured (this start not yet reported)');
        expect(t).toContain('counts: runs unmeasured · open items and asks unmeasured · 0 outstanding mail · notes unmeasured');
      },
      'the delta is one line, canaries first, then the counts, under 300 bytes': () => {
        const t = m.renderAnchor(facts({ runs: read([run(1, 'prog-a')]) }), LIVE, 'delta');
        expect(t).toBe(`${m.DELTA_PREFIX} term 2 · generation 5 · card ${HASH.slice(0, 12)} · 1 runs · 0 open items and asks · 0 outstanding mail · 0 notes`);
        expect(utf8Bytes(t)).toBeLessThanOrEqual(300);
      },
      'the delta carries no role line and no instruction, and says unmeasured for unread facts': () => {
        const f = facts({ role: 'undecided', roleWhy: 'x', runs: unmeasured('r'), notes: unmeasured('n') });
        const t = m.renderAnchor(f, gen({ kind: 'unmeasured', what: 'g' }), 'delta');
        expect(t.split('\n')).toHaveLength(1);
        expect(t).not.toContain('role:');
        expect(t).not.toContain(m.ANCHOR_INSTRUCTION);
        expect(t).toContain('term unmeasured · generation unmeasured · card');
        expect(t).toContain('runs unmeasured');
      },
      'the role line is masked before it is fitted': () => {
        const t = m.renderAnchor(facts({ runs: read([run(1, 'prog-key')]) }), LIVE, 'start', (s) => s.replace('prog-key', '[masked]'));
        expect(t).toContain('role: coordinator of [masked]');
        expect(t).not.toContain('prog-key');
      },
    };
  },
};

export const ANCHOR_GENERATION_KEY = 'server/src/continuity/anchor.ts#anchorGeneration';
export const ANCHOR_ANSWER_KEY = 'server/src/continuity/anchor.ts#anchorAnswer';
const GEN = { term: 2, n: 5, startId: 40, startReportedAt: 1_000 };

export const ANCHOR_GENERATION_SET: MutantSet<Anchor> = {
  modulePath: ANCHOR_TS,
  mutants: [
    { id: 'G1', old: 'starting: s !== null && s.id !== g.startId && s.reportedAt >= g.startReportedAt', new: 'starting: s !== null && s.id !== g.startId' },
    { id: 'G2', old: 'starting: s !== null && s.id !== g.startId && s.reportedAt >= g.startReportedAt', new: 'starting: s !== null && s.id !== g.startId && s.reportedAt > g.startReportedAt' },
    { id: 'G3', old: 'starting: s !== null && s.id !== g.startId && s.reportedAt >= g.startReportedAt', new: 'starting: s !== null && s.reportedAt >= g.startReportedAt' },
    { id: 'G4', old: "if (newest.kind === 'unmeasured') return { kind: 'unmeasured', what: newest.what };", new: '' },
    { id: 'G5', old: "if (live.value === null) return { kind: 'none' };", new: "if (live.value === null) return { kind: 'unmeasured', what: 'none' };" },
  ],
  suite(m): Record<string, SuiteCase> {
    const g = (s: Fact<{ id: number; reportedAt: number } | null>) => m.anchorGeneration(read(GEN), s);
    return {
      'its own start is n': () => { expect(g(read({ id: 40, reportedAt: 1_000 }))).toEqual({ kind: 'live', term: 2, n: 5, starting: false }); },
      'a newer start is n+1 starting, at the same time too': () => {
        expect(g(read({ id: 41, reportedAt: 1_000 }))).toEqual({ kind: 'live', term: 2, n: 5, starting: true });
      },
      'an older start is n': () => { expect(g(read({ id: 41, reportedAt: 999 }))).toEqual({ kind: 'live', term: 2, n: 5, starting: false }); },
      'unread starts are unmeasured': () => { expect(g(unmeasured('s'))).toEqual({ kind: 'unmeasured', what: 's' }); },
      'no generation is none': () => { expect(m.anchorGeneration(read(null), read(null))).toEqual({ kind: 'none' }); },
    };
  },
};

export const ANCHOR_ANSWER_SET: MutantSet<Anchor> = {
  modulePath: ANCHOR_TS,
  mutants: [
    // The plan's Task 2 mutation: the text served in shadow.
    { id: 'S1', old: "  if (!live) return { ok: true, part: 'anchor', form: served.form, dark: true };\n", new: '' },
    { id: 'S2', old: "return served.form === 'fork' ? { ok: true, part: 'anchor', form: 'fork', live: true }", new: "return served.form === 'fork' ? { ok: true, part: 'anchor', form: 'fork', dark: true }" },
    // Fix round 1, F1: an answer without its proof (the part), and one naming another form than it served.
    { id: 'S3', old: "  if (!live) return { ok: true, part: 'anchor', form: served.form, dark: true };", new: "  if (!live) return { ok: true, form: served.form, dark: true } as never;" },
    { id: 'S4', old: "    : { ok: true, part: 'anchor', form: served.form, hash: served.hash, text: served.text };", new: "    : { ok: true, part: 'anchor', form: 'start', hash: served.hash, text: served.text };" },
  ],
  suite(m): Record<string, SuiteCase> {
    return {
      'shadow is dark with no text, naming its part and form': () => {
        expect(m.anchorAnswer(false, { form: 'start', hash: HASH, text: 't' })).toEqual({ ok: true, part: 'anchor', form: 'start', dark: true });
      },
      'a live fork is live': () => { expect(m.anchorAnswer(true, { form: 'fork' })).toEqual({ ok: true, part: 'anchor', form: 'fork', live: true }); },
      'live serves the text, naming its part and form': () => {
        expect(m.anchorAnswer(true, { form: 'prompt', hash: HASH, text: 't' })).toEqual({ ok: true, part: 'anchor', form: 'prompt', hash: HASH, text: 't' });
      },
    };
  },
};

export const ANCHOR_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [ANCHOR_RENDER_KEY]: ANCHOR_RENDER_SET as MutantSet<never>,
  [ANCHOR_GENERATION_KEY]: ANCHOR_GENERATION_SET as MutantSet<never>,
  [ANCHOR_ANSWER_KEY]: ANCHOR_ANSWER_SET as MutantSet<never>,
};

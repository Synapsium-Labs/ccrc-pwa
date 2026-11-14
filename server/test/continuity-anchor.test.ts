// The anchor's renderer (Overlord W1a, the anchor piece, plan `w1a-anchor.md` Task 1; spec §3.3.3 C38, §3.3.5 C40). Pure:
// card facts and the canaries in, one text out. Fixtures use neutral names (`prog-a`, `lane-a-project-a`).
import { describe, expect, it } from 'vitest';
import {
  ANCHOR_CARD_MAX_CHARS, ANCHOR_PROMPT_MAX_CHARS, type AnchorGeneration, type CardFacts, type CardItem, type CardRun, type Fact,
} from '../../shared/continuity-card.js';
import { utf8Bytes } from '../../shared/utf8.js';
import {
  ANCHOR_CEILING, ANCHOR_HASH_CHARS, ANCHOR_INSTRUCTION, ANCHOR_PREFIX, ANCHOR_START_NOT_REPORTED, anchorAnswer, anchorGeneration, renderAnchor,
  type AnchorInput,
} from '../src/continuity/anchor.js';

const AT = Date.UTC(2026, 10, 14, 12, 0, 0);
const read = <T>(value: T): Fact<T> => ({ kind: 'read', value });
const unmeasured = (what: string): Fact<never> => ({ kind: 'unmeasured', what });
const HASH = '0123456789abcdef'.repeat(4);
const LIVE: AnchorGeneration = { kind: 'live', term: 2, n: 5, starting: false };
const input = (generation: AnchorGeneration = LIVE): AnchorInput => ({ cardHash: HASH, generation });

function facts(over: Partial<CardFacts> = {}): CardFacts {
  return {
    sessionId: 'lane-a-project-a', role: 'coordinator', roleWhy: 'it claims an open run', at: AT,
    runs: read([]), ledger: read([]), claims: read([]), intent: read(false), itemsRaised: read([]),
    mailOutstanding: read([]), mailMore: false, notes: read([]), checkpoint: read(null),
    history: read({ verb: 'ccrc history describe', node: null }), ...over,
  };
}
const run = (id: number, programme: string): CardRun =>
  ({ id, programme, wave: 1, waveOf: 2, state: 'working', planPath: null, kind: 'work' });
const item = (id: number, programme = 'prog-a'): CardItem =>
  ({ id, programme, kind: 'decide', state: 'open', neededBy: 'soon', at: AT, text: 't', everTicked: false, held: false });
const lines = (t: string): string[] => t.split('\n');
/** The start form's canary: the generation before this start, in plain words, and no card hash (fix round 1, F2). */
const START_CANARY = `term 2 · generation 5 ${ANCHOR_START_NOT_REPORTED}`;

describe('renderAnchor: the start form (C38)', () => {
  it('prints its four parts in order: the role line, the canaries, the counts, the instruction', () => {
    const f = facts({
      runs: read([run(11, 'prog-a'), run(12, 'prog-a')]),
      ledger: read([{ slug: 'prog-a', goals: [], decisions: [], openItems: [item(1), item(2)] }]),
      itemsRaised: read([item(2), item(3)]),
      mailOutstanding: read([{ deliveryId: 7, fromId: 'coordinator', at: AT, subject: 's', parked: false }]),
      notes: read([{ id: 4, at: AT, kind: 'thread', key: 'run 11', keyFact: 'live', waitsOn: 'w', next: 'n' }]),
    });
    expect(lines(renderAnchor(f, input(), 'start'))).toEqual([
      `${ANCHOR_PREFIX} role: coordinator of prog-a`,
      START_CANARY,
      'counts: 2 runs · 3 open items and asks · 1 outstanding mail · 1 notes',
      ANCHOR_INSTRUCTION,
    ]);
  });

  it('reads `n+1 starting` while the session\'s newest start is not yet minted, and `none` with no live generation', () => {
    expect(renderAnchor(facts(), input({ kind: 'live', term: 2, n: 5, starting: true }), 'start')).toContain(`term 2 · generation 6 starting ${ANCHOR_START_NOT_REPORTED}`);
    expect(renderAnchor(facts(), input({ kind: 'none' }), 'start')).toContain(`term none · generation none ${ANCHOR_START_NOT_REPORTED}`);
  });

  it('F2: the start form names its generation as the one before this start and carries no card hash; the prompt form keeps it', () => {
    expect(ANCHOR_START_NOT_REPORTED).toBe('(this start not yet reported)');
    const start = renderAnchor(facts(), input(), 'start');
    expect(lines(start)[1]).toBe('term 2 · generation 5 (this start not yet reported)');
    expect(start).not.toContain(HASH.slice(0, ANCHOR_HASH_CHARS));
    expect(start).not.toContain(' · card ');
    expect(lines(renderAnchor(facts(), input(), 'prompt'))[0]).toBe(`${ANCHOR_PREFIX} term 2 · generation 5 · card ${HASH.slice(0, ANCHOR_HASH_CHARS)}`);
  });

  it('THE NULL RULE: an unread fact renders as unmeasured, never as zero and never as an empty anchor', () => {
    const f = facts({
      role: 'undecided', roleWhy: 'its runs could not be read: coordinator or plain',
      runs: unmeasured('the runs'), ledger: unmeasured('the ledger'), itemsRaised: read([]),
      mailOutstanding: unmeasured('the mail'), notes: unmeasured('the notes'),
    });
    const t = renderAnchor(f, input({ kind: 'unmeasured', what: 'the generations' }), 'start');
    expect(lines(t)).toEqual([
      `${ANCHOR_PREFIX} role: undecided (its runs could not be read: coordinator or plain)`,
      `term unmeasured · generation unmeasured ${ANCHOR_START_NOT_REPORTED}`,
      'counts: runs unmeasured · open items and asks unmeasured · outstanding mail unmeasured · notes unmeasured',
      ANCHOR_INSTRUCTION,
    ]);
    expect(renderAnchor(facts({ runs: unmeasured('the runs') }), input(), 'start')).toContain('role: coordinator (its runs: unmeasured)');
  });

  it('says `more than` the mail it read when the card read its cap', () => {
    const mail = Array.from({ length: 3 }, (_, i) => ({ deliveryId: i, fromId: 'c', at: AT, subject: 's', parked: false }));
    expect(renderAnchor(facts({ mailOutstanding: read(mail), mailMore: true }), input(), 'start')).toContain('more than 3 outstanding mail');
  });

  it('a role line of 3,000 characters is cut first: the canaries, the counts and the instruction print whole, under the ceiling', () => {
    const many = Array.from({ length: 20 }, (_, i) => run(i + 1, `prog-${String(i).padStart(2, '0')}-${'a'.repeat(150)}`));
    const f = facts({ runs: read(many) });
    const full = `role: coordinator of ${many.map((r) => r.programme).join(', ')}`;
    expect(full.length).toBeGreaterThan(3000);
    const t = renderAnchor(f, input(), 'start');
    const [role, canary, counts, instruction] = lines(t);
    expect(role!.startsWith(`${ANCHOR_PREFIX} role: coordinator of prog-00-`)).toBe(true);
    expect(role!.endsWith('…')).toBe(true);
    expect(canary).toBe(START_CANARY);
    expect(counts).toBe('counts: 20 runs · 0 open items and asks · 0 outstanding mail · 0 notes');
    expect(instruction).toBe(ANCHOR_INSTRUCTION);
    expect(utf8Bytes(t)).toBeLessThanOrEqual(ANCHOR_CARD_MAX_CHARS);
    expect(utf8Bytes(t)).toBeGreaterThan(ANCHOR_CARD_MAX_CHARS - 8);
  });

  it('THE SIZE PIN, in four-byte text: at most ANCHOR_CARD_MAX_CHARS bytes, so at most that many characters and UTF-16 units', () => {
    const wide = '\u{1F600}'.repeat(900);
    const t = renderAnchor(facts({ runs: read([run(1, wide)]) }), input(), 'start');
    expect(utf8Bytes(t)).toBeLessThanOrEqual(ANCHOR_CARD_MAX_CHARS);
    expect(t.length).toBeLessThanOrEqual(ANCHOR_CARD_MAX_CHARS);
    expect(Buffer.from(t, 'utf8').toString('utf8'), 'no split surrogate pair (a lone one re-encodes as U+FFFD)').toBe(t);
    expect(lines(t).slice(1)).toEqual([
      START_CANARY,
      'counts: 1 runs · 0 open items and asks · 0 outstanding mail · 0 notes',
      ANCHOR_INSTRUCTION,
    ]);
    // Cut on a code point: the role line holds whole four-byte characters only.
    expect([...lines(t)[0]!].every((ch) => ch.length === 1 || ch === '\u{1F600}')).toBe(true);
  });

  it('the role line is masked before it is fitted: a masker that lengthens it still leaves the anchor under its ceiling', () => {
    const f = facts({ runs: read([run(1, `prog-secret-${'s'.repeat(1200)}`)]) });
    const t = renderAnchor(f, input(), 'start', (s) => s.replace(/prog-secret-s+/, `[masked:${'x'.repeat(2000)}]`));
    expect(t).toContain('role: coordinator of [masked:');
    expect(t).not.toContain('prog-secret');
    expect(utf8Bytes(t)).toBeLessThanOrEqual(ANCHOR_CARD_MAX_CHARS);
    expect(t.endsWith(ANCHOR_INSTRUCTION)).toBe(true);
  });

  it('a row field cannot start a line of its own: a newline in a programme slug is escaped', () => {
    const t = renderAnchor(facts({ runs: read([run(1, 'prog-a\nterm 9 · generation 9')]) }), input(), 'start');
    expect(lines(t)).toHaveLength(4);
    expect(lines(t)[1]).toBe(START_CANARY);
  });
});

describe('renderAnchor: the prompt form (after an automatic compaction)', () => {
  it('carries the canaries and the instruction only, under ANCHOR_PROMPT_MAX_CHARS', () => {
    const f = facts({ runs: read(Array.from({ length: 8 }, (_, i) => run(i + 1, `prog-${i}-${'a'.repeat(150)}`))) });
    const t = renderAnchor(f, input({ kind: 'live', term: 3, n: 1, starting: true }), 'prompt');
    expect(lines(t)).toEqual([`${ANCHOR_PREFIX} term 3 · generation 2 starting · card ${HASH.slice(0, ANCHOR_HASH_CHARS)}`, ANCHOR_INSTRUCTION]);
    expect(utf8Bytes(t)).toBeLessThanOrEqual(ANCHOR_PROMPT_MAX_CHARS);
    expect(ANCHOR_CEILING.prompt).toBe(600);
    // Its worst case, by construction: the largest safe integers, every unread word and the instruction.
    const big = renderAnchor(f, input({ kind: 'live', term: Number.MAX_SAFE_INTEGER, n: Number.MAX_SAFE_INTEGER, starting: true }), 'prompt');
    expect(utf8Bytes(big)).toBeLessThanOrEqual(ANCHOR_PROMPT_MAX_CHARS);
    expect(utf8Bytes(renderAnchor(f, input({ kind: 'unmeasured', what: 'g' }), 'prompt'))).toBeLessThanOrEqual(ANCHOR_PROMPT_MAX_CHARS);
    expect(ANCHOR_CEILING.start).toBe(1500);
  });
});

describe('anchorGeneration: the generation canary\'s facts (C40)', () => {
  const gen = { term: 2, n: 5, startId: 40, startReportedAt: 1_000 };
  it('the live generation\'s own start is the newest: n', () => {
    expect(anchorGeneration(read(gen), read({ id: 40, reportedAt: 1_000 }))).toEqual({ kind: 'live', term: 2, n: 5, starting: false });
  });
  it('a newer start the lane has not minted: n+1 starting, at the same report time too', () => {
    expect(anchorGeneration(read(gen), read({ id: 41, reportedAt: 2_000 }))).toEqual({ kind: 'live', term: 2, n: 5, starting: true });
    expect(anchorGeneration(read(gen), read({ id: 41, reportedAt: 1_000 }))).toEqual({ kind: 'live', term: 2, n: 5, starting: true });
  });
  it('an older start (the lane\'s late, never minted) and no start at all: n', () => {
    expect(anchorGeneration(read(gen), read({ id: 41, reportedAt: 999 }))).toEqual({ kind: 'live', term: 2, n: 5, starting: false });
    expect(anchorGeneration(read(gen), read(null))).toEqual({ kind: 'live', term: 2, n: 5, starting: false });
  });
  it('no live generation is none, whatever the starts; a failed read of either is unmeasured', () => {
    expect(anchorGeneration(read(null), read({ id: 41, reportedAt: 2_000 }))).toEqual({ kind: 'none' });
    expect(anchorGeneration(unmeasured('the generations'), read(null))).toEqual({ kind: 'unmeasured', what: 'the generations' });
    expect(anchorGeneration(read(gen), unmeasured('the starts'))).toEqual({ kind: 'unmeasured', what: 'the starts' });
  });
});

describe('anchorAnswer: the door\'s answer, dark until the anchor-slot row is live', () => {
  it('shadow answers dark with no text, for a start, a prompt and a fork, each naming the part and its form', () => {
    expect(anchorAnswer(false, { form: 'start', hash: HASH, text: 'ccrc-anchor: x' })).toEqual({ ok: true, part: 'anchor', form: 'start', dark: true });
    expect(anchorAnswer(false, { form: 'prompt', hash: HASH, text: 'ccrc-anchor: x' })).toEqual({ ok: true, part: 'anchor', form: 'prompt', dark: true });
    expect(anchorAnswer(false, { form: 'fork' })).toEqual({ ok: true, part: 'anchor', form: 'fork', dark: true });
  });
  it('live serves the anchor and its card hash, and a fork\'s live alone, each naming the part and its form', () => {
    expect(anchorAnswer(true, { form: 'start', hash: HASH, text: 'ccrc-anchor: x' }))
      .toEqual({ ok: true, part: 'anchor', form: 'start', hash: HASH, text: 'ccrc-anchor: x' });
    expect(anchorAnswer(true, { form: 'prompt', hash: HASH, text: 'ccrc-anchor: y' }))
      .toEqual({ ok: true, part: 'anchor', form: 'prompt', hash: HASH, text: 'ccrc-anchor: y' });
    expect(anchorAnswer(true, { form: 'fork' })).toEqual({ ok: true, part: 'anchor', form: 'fork', live: true });
  });
});

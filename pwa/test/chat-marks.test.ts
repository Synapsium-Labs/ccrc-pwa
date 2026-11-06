// The chat recogniser table (chat reading at a desk, Task M, D-8060; spec 2026-11-06 sections 3.3 and 4.1). One row
// per case, each named: what `markRuns` finds in a text, what it leaves as text, where a status word is a label, and
// how a bold lead-in is read. Recognising only: which address a mark resolves to (and whether a small id the console
// does not hold stays text) is Task L's `chat-refs.test.ts`.
import { describe, expect, it } from 'vitest';
import {
  ACTION_LEADS, MARK_ATTR, STATUS_LINKERS, STATUS_SUBJECTS, STATUS_WORDS, isMarkKind, leadKind, leadingStatus, markRuns,
  statusTone, wholeMark, type Mark, type MarkRun,
} from '../src/lib/chatMarks';

const marksOf = (text: string): Mark[] =>
  markRuns(text).flatMap((r) => (r.kind === 'mark' ? [r.mark] : []));
const statusesOf = (text: string): { text: string; tone: string }[] =>
  markRuns(text).flatMap((r) => (r.kind === 'status' ? [{ text: r.text, tone: r.tone }] : []));

describe('names the grammar recognises (positives)', () => {
  it.each<[string, string, Mark]>([
    ['#651', '#651', { kind: 'pr', id: '651', text: '#651' }],
    ['(#651)', 'see (#651) here', { kind: 'pr', id: '651', text: '#651' }],
    ['run 1527', 'run 1527', { kind: 'run', id: '1527', text: 'run 1527' }],
    ['Run 1527', 'Run 1527 is the one', { kind: 'run', id: '1527', text: 'Run 1527' }],
    ['review 1544 (kind run)', 'review 1544', { kind: 'run', id: '1544', text: 'review 1544' }],
    ['item 34', 'item 34', { kind: 'item', id: '34', text: 'item 34' }],
    [
      'a document path',
      'docs/superpowers/specs/2026-11-06-chat-reading-design.md',
      {
        kind: 'doc', id: 'docs/superpowers/specs/2026-11-06-chat-reading-design.md',
        text: 'docs/superpowers/specs/2026-11-06-chat-reading-design.md',
      },
    ],
    ['docs/conventions/x.md. (trailing full stop outside)', 'see docs/conventions/x.md.', { kind: 'doc', id: 'docs/conventions/x.md', text: 'docs/conventions/x.md' }],
    ['4c677d328', 'at 4c677d328 now', { kind: 'commit', id: '4c677d328', text: '4c677d328' }],
    ['@4c677d328', 'main@4c677d328', { kind: 'commit', id: '4c677d328', text: '4c677d328' }],
    [
      'a 40-character SHA',
      '6954765b6a1f09e1e4413ff1df15795c16d33a38',
      { kind: 'commit', id: '6954765b6a1f09e1e4413ff1df15795c16d33a38', text: '6954765b6a1f09e1e4413ff1df15795c16d33a38' },
    ],
  ])('%s', (_name, text, mark) => {
    expect(marksOf(text)).toEqual([mark]);
  });
});

describe('ordinary words the grammar leaves as text (negatives)', () => {
  it.each<[string, string]>([
    ['C#1', 'in C#1 there is'],
    ['#1234567', 'issue #1234567'],
    ['running 15', 'running 15 jobs'],
    ['item3', 'item3 of them'],
    ['deadbeef', 'a deadbeef value'],
    ['1234567', 'call 1234567'],
    ['ABCDEF1', 'code ABCDEF1'],
    ['a SHA inside a 41-hex run', '6954765b6a1f09e1e4413ff1df15795c16d33a38f'],
    ['x/docs/a.md', 'x/docs/a.md'],
    ['docs/a/../b.md', 'docs/a/../b.md'],
    ['docs/a.mdx', 'docs/a.mdx'],
    // Fix round 1 (review 1574). F-A: a letter outside the BMP bounds a name like any other letter.
    ['an astral letter before (𠀀#1)', '𠀀#1'],
    ['an astral letter after (#1𝐀)', '#1𝐀'],
    // F-D: a commit is not preceded by `.`, `/` or `-`.
    ['feat-4c677d328', 'branch feat-4c677d328'],
    ['v1.2.4c677d328', 'tag v1.2.4c677d328'],
    ['a/4c677d328', 'path a/4c677d328'],
    // F-E: a document path does not run on into `/` or `-`.
    ['docs/a.md/x', 'docs/a.md/x'],
    ['docs/a.md-bak', 'docs/a.md-bak'],
    // Ruling 4 (G2): a commit is not followed by `-`, nor by `.` and a word character; a document path not by `.` and
    // a word character.
    ["a UUID's head (4c677d32-…)", '4c677d32-e29b-41d4-a716-446655440000'],
    ['a UUID (550e8400-…)', '550e8400-e29b-41d4-a716-446655440000'],
    ['abc1234.ts', 'edit abc1234.ts'],
    ['docs/plan.md.bak', 'docs/plan.md.bak'],
    // Ruling 4 (G3): a colour is no PR. Fix round 2 (review 1575 F2): nor is it `#` and a commit.
    ['#a3f (a 3-digit colour)', 'colour #a3f'],
    ['#1a2b3c (a 6-digit colour)', 'colour #1a2b3c'],
    ['color: #ff00aa;', 'color: #ff00aa;'],
    ['#ff00aa80 (an 8-digit colour)', 'colour #ff00aa80'],
    ['#abc1234', 'see #abc1234'],
    // Fix round 2 (review 1575 F4): `_` and a combining mark are word characters, and S3 reads a whole word.
    ['snake_4c677d328', 'name snake_4c677d328'],
    ['a combining mark before a hex run', 'cafe\u0301abc1234'],
  ])('%s', (_name, text) => {
    expect(marksOf(text)).toEqual([]);
  });

  // Ruling 4: a commit at a sentence's end is still one, and a digits-only `#333` or `#000000` is still a PR mark
  // (L's repository rule decides whether it links).
  it.each<[string, string, Mark]>([
    ['at abc1234. (sentence end)', 'at abc1234.', { kind: 'commit', id: 'abc1234', text: 'abc1234' }],
    ['#333', 'see #333', { kind: 'pr', id: '333', text: '#333' }],
    ['#000000', 'see #000000', { kind: 'pr', id: '000000', text: '#000000' }],
    ['docs/a.md. (sentence end)', 'read docs/a.md.', { kind: 'doc', id: 'docs/a.md', text: 'docs/a.md' }],
    // Fix round 2 (review 1575 F2): only `#` is refused before a commit; `@` and `(` still stand before one.
    ['@4c677d3', 'main@4c677d3', { kind: 'commit', id: '4c677d3', text: '4c677d3' }],
    ['(4c677d3)', 'fixed (4c677d3)', { kind: 'commit', id: '4c677d3', text: '4c677d3' }],
    // Fix round 2 (review 1575 F1): there is no exponent rule. A real short SHA of digits, one `e` and digits is a
    // commit; the price is that `1e10000` reads as one too, and only Task L's repository rule can tell them apart.
    ['1e23456 (a real SHA shape)', 'at 1e23456', { kind: 'commit', id: '1e23456', text: '1e23456' }],
    ['0e99365', 'at 0e99365', { kind: 'commit', id: '0e99365', text: '0e99365' }],
    ['651e805', 'at 651e805', { kind: 'commit', id: '651e805', text: '651e805' }],
    ['1e10000 (the price)', 'about 1e10000', { kind: 'commit', id: '1e10000', text: '1e10000' }],
  ])('%s is still a name', (_name, text, mark) => {
    expect(marksOf(text)).toEqual([mark]);
  });

  // The small-id rule is Task L's: the recogniser marks it, and `chat-refs.test.ts` holds that it stays text.
  it('run 2 times is a mark, kind run, id 2 (L decides that a small unknown id stays text)', () => {
    expect(marksOf('run 2 times')).toEqual([{ kind: 'run', id: '2', text: 'run 2' }]);
  });
});

describe('status words in a label position (S3: after a name or a subject)', () => {
  it.each<[string, string, { text: string; tone: string }]>([
    ['#651 merged', '#651 merged', { text: 'merged', tone: 'merged' }],
    ['CI green', 'CI green', { text: 'green', tone: 'ok' }],
    ['run 1527 is blocked', 'run 1527 is blocked', { text: 'blocked', tone: 'wait' }],
    ['checks now failed', 'checks now failed', { text: 'failed', tone: 'fail' }],
  ])('%s is a status run', (_name, text, status) => {
    expect(statusesOf(text)).toEqual([status]);
  });

  it.each<[string, string]>([
    ['CI green_light (a whole word only)', 'CI green_light'],
    ['the value passed', 'the value passed to the parser'],
    ['a red herring', 'a red herring'],
    ['CI is now green (two linkers)', 'CI is now green'],
  ])('%s is not', (_name, text) => {
    expect(statusesOf(text)).toEqual([]);
  });

  it('a status run carries the word only: the linker stays in the text run before it', () => {
    expect(markRuns('run 1527 is blocked')).toEqual<MarkRun[]>([
      { kind: 'mark', mark: { kind: 'run', id: '1527', text: 'run 1527' } },
      { kind: 'text', text: ' is ' },
      { kind: 'status', text: 'blocked', tone: 'wait' },
    ]);
  });
});

describe('markRuns keeps the text', () => {
  const INPUTS: readonly string[] = [
    '', 'plain', '#651', 'see (#651) here', 'Run 1527 is the one', 'run 1527 is blocked', 'CI is now green',
    'checks now failed, then #652 merged and item 34 waits on docs/conventions/x.md. at @4c677d328',
    '6954765b6a1f09e1e4413ff1df15795c16d33a38f', 'café1234abc', 'a\nrun\t9 and #1\n',
  ];
  it.each(INPUTS)('%j round-trips exactly, with no two text runs adjacent', (text) => {
    const runs = markRuns(text);
    expect(runs.map((r) => (r.kind === 'mark' ? r.mark.text : r.text)).join('')).toBe(text);
    for (let i = 1; i < runs.length; i += 1) expect(runs[i - 1]!.kind === 'text' && runs[i]!.kind === 'text').toBe(false);
  });

  it('a letter of any script is a word character: a hex run straight after one is no commit', () => {
    expect(marksOf('café1234abc')).toEqual([]);
  });
});

describe('wholeMark (R13)', () => {
  it("'run 1527' is a mark", () => {
    expect(wholeMark('run 1527')).toEqual({ kind: 'run', id: '1527', text: 'run 1527' });
  });
  it("'see run 1527' is null", () => {
    expect(wholeMark('see run 1527')).toBeNull();
  });
  it("'run 1527 merged' is null: a status after the name is more than the name", () => {
    expect(wholeMark('run 1527 merged')).toBeNull();
  });
});

describe('leadKind', () => {
  it.each<[string, 'action' | 'info' | null]>([
    ['What to do (either one):', 'action'],
    ['Your call.', 'action'],
    ['Actions:', 'info'],
    ["Why I can't do it.", 'info'],
    ['Note', null],
    ['  decision needed  ', 'action'],
    ['To do', 'action'],
    ['Actionable', null],
  ])('%j is %s', (text, kind) => {
    expect(leadKind(text)).toBe(kind);
  });
});

describe('leadingStatus (S1) and statusTone', () => {
  it("'Failed, exit 1' leads with fail", () => {
    expect(leadingStatus('Failed, exit 1')).toEqual({ word: 'Failed', tone: 'fail' });
  });
  it("'Failure' is null: a whole word only", () => {
    expect(leadingStatus('Failure')).toBeNull();
  });
  it("'Failed_2' is null: `_` is a word character (review 1575 F4)", () => {
    expect(leadingStatus('Failed_2')).toBeNull();
  });
  it('every listed word has its tone, case-insensitive, and nothing else has one', () => {
    for (const [tone, words] of Object.entries(STATUS_WORDS)) {
      for (const w of words) {
        expect(statusTone(w)).toBe(tone);
        expect(statusTone(w.toUpperCase())).toBe(tone);
      }
    }
    expect(statusTone('failure')).toBeNull();
    expect(statusTone('')).toBeNull();
  });
});

describe('the table itself', () => {
  it('lists the subjects, linkers and action lead-ins the spec names', () => {
    expect(STATUS_SUBJECTS).toEqual(['ci', 'checks', 'tests', 'suite', 'build', 'review']);
    expect(STATUS_LINKERS).toEqual(['is', 'was', 'now']);
    expect(ACTION_LEADS).toEqual(['what to do', 'to do', 'your call', 'decision needed', 'what i need from you', 'action']);
  });
  it('names the attributes', () => {
    expect(MARK_ATTR).toEqual({
      kind: 'data-mark-kind', id: 'data-mark-id', status: 'data-status', lead: 'data-lead', afterLead: 'data-after-lead',
    });
  });
  it('isMarkKind accepts the five kinds and nothing else', () => {
    for (const k of ['pr', 'run', 'item', 'doc', 'commit']) expect(isMarkKind(k)).toBe(true);
    for (const k of ['', 'mail', 'PR', 'toString']) expect(isMarkKind(k)).toBe(false);
  });
});

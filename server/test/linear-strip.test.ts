// The unprintable set and its two strips (#1444, the Linear central key, spec section 6.5; row 4's strip rows that
// need no operation table). One L0 home, `shared/unprintable.ts`, which the account audit and the Linear modules
// import instead of copying it:
//   - `stripLine`, the full set, for every one-line string (a name, a title, an identifier, a URL key, a team key): a
//     removed character becomes a space, runs of white space collapse, and the ends are trimmed, as the account audit's
//     actor label always was;
//   - `stripMultiline`, for the two markdown fields only: `\r\n`, then a lone `\r`, become `\n`, and the set less `\n`
//     and `\t` is removed to nothing, with nothing collapsed, so a description keeps its line structure byte for byte.
import { describe, it, expect } from 'vitest';
import { LINEAR_NAME_MAX_CHARS, UNPRINTABLE, cleanName, stripLine, stripMultiline } from '../../shared/unprintable.js';

/** One of each class the set names: C0, DEL, C1 (the 8-bit CSI and NEL among them), the combining grapheme joiner,
 *  the line and paragraph separators, U+2060 to U+206F, and \p{Cf} (soft hyphen, Arabic letter mark, zero-width
 *  space and joiners, bidi marks, embeddings, overrides and isolates, the BOM, the interlinear annotation marks, the
 *  tag block). */
const IN_SET = [
  '\u0000', '\u0007', '\t', '\n', '\r', '\u001b', '\u001f', '\u007f', '\u0085', '\u009b', '\u009f', '\u034f',
  '\u2028', '\u2029', '\u2060', '\u2066', '\u2069', '\u206f', '\u00ad', '\u061c', '\u180e', '\u200b', '\u200c',
  '\u200d', '\u200e', '\u200f', '\u202a', '\u202e', '\ufeff', '\ufff9', '\ufffb', '\u{e0001}', '\u{e0041}', '\u{e007f}',
];
const NOT_IN_SET = [' ', 'a', 'Z', '0', '-', '_', '#', '`', '\u00a0', '\u00e9', '\u4e2d', '\u{1f600}', '\u2014', '\u2192'];

const hex = (c: string): string => c.codePointAt(0)!.toString(16);

describe('the unprintable set', () => {
  it('holds every class it names, each character alone', () => {
    expect(IN_SET.filter((c) => c.replace(UNPRINTABLE, '') !== '').map(hex)).toEqual([]);
  });
  it('holds nothing printable', () => {
    expect(NOT_IN_SET.filter((c) => c.replace(UNPRINTABLE, '') !== c)).toEqual([]);
  });
  it('is a global, unicode pattern, so a replace reaches every run and every astral character', () => {
    expect(UNPRINTABLE.flags).toContain('g');
    expect(UNPRINTABLE.flags).toContain('u');
  });
});

describe('stripLine: one-line text', () => {
  const ROWS: [input: string, output: string][] = [
    ['Fix the login flow', 'Fix the login flow'],
    ['Fix the\nlogin\r\nflow', 'Fix the login flow'],
    ['a\u202eb', 'a b'],
    ['a\u200bb\u200dc', 'a b c'],
    ['\u2066x\u2069', 'x'],
    ['a\u0007\u001b[31mb', 'a [31mb'],
    ['a\u0085b\u009bc', 'a b c'],
    ['a\u2028b\u2029c', 'a b c'],
    ['  two  spaces\there ', 'two spaces here'],
    ['\u00e9\u{1f600} ok', '\u00e9\u{1f600} ok'],
    ['a\u{e0041}b', 'a b'],
    ['\u202e\u200f\u009b', ''],
    ['', ''],
  ];
  for (const [input, output] of ROWS) it(JSON.stringify(input), () => { expect(stripLine(input)).toBe(output); });
  it('is idempotent', () => {
    for (const [input] of ROWS) expect(stripLine(stripLine(input))).toBe(stripLine(input));
  });
});

describe('stripMultiline: a markdown field keeps its lines', () => {
  const DESCRIPTION = [
    '## Steps',
    '',
    '1. Open the card',
    '2. Press **Check again**',
    '   - a nested item',
    '',
    '```ts',
    'function f() {',
    '\treturn 1;',
    '}',
    '```',
    '',
    '',
    '\tindented with a tab',
    '    indented with spaces',
    '> a quote',
    '',
  ].join('\n');

  it('keeps a fenced code block, tab indentation, a list and blank lines byte for byte', () => {
    expect(stripMultiline(DESCRIPTION)).toBe(DESCRIPTION);
  });
  it('turns \\r\\n, then a lone \\r, into \\n', () => {
    expect(stripMultiline('a\r\nb\rc\n\r\nd')).toBe('a\nb\nc\n\nd');
    expect(stripMultiline(DESCRIPTION.split('\n').join('\r\n'))).toBe(DESCRIPTION);
  });
  it('removes U+202E, U+200B, U+2028 and a lone C0 control such as U+0007, to nothing', () => {
    expect(stripMultiline('a\u202eb')).toBe('ab');
    expect(stripMultiline('a\u200bb')).toBe('ab');
    expect(stripMultiline('a\u2028b')).toBe('ab');
    expect(stripMultiline('a\u0007b')).toBe('ab');
  });
  it('removes every other character of the set but \\n and \\t, and collapses nothing', () => {
    const removed = IN_SET.filter((c) => c !== '\n' && c !== '\t' && c !== '\r');
    expect(removed.filter((c) => stripMultiline(`x${c}y`) !== 'xy').map(hex)).toEqual([]);
    expect(stripMultiline('a  \t\t b\n\n\n')).toBe('a  \t\t b\n\n\n');
    expect(stripMultiline(`\t- item\u2029\n\n`)).toBe('\t- item\n\n');
  });
  it('is idempotent', () => {
    for (const s of [DESCRIPTION, 'a\r\nb\u202e', 'x\u0007\ty']) expect(stripMultiline(stripMultiline(s))).toBe(stripMultiline(s));
  });
});

describe('cleanName: a name from Linear passes stripLine, then the bound (spec section 6.5)', () => {
  const ROWS: [raw: unknown, cleaned: string | null][] = [
    ['team-a', 'team-a'],
    ['  team  a ', 'team a'],
    ['a\u202eb', 'a b'],
    ['a\u200bb\u2066c\u2069', 'a b c'],
    ['line one\nline two', 'line one line two'],
    ['\u202e\u200b\u0007', null],
    ['', null],
    [42, null],
    [null, null],
    ['x'.repeat(200), 'x'.repeat(LINEAR_NAME_MAX_CHARS)],
    [`${'x'.repeat(LINEAR_NAME_MAX_CHARS - 1)} yy`, `${'x'.repeat(LINEAR_NAME_MAX_CHARS - 1)}`],
  ];
  for (const [raw, cleaned] of ROWS) it(JSON.stringify(raw), () => { expect(cleanName(raw)).toBe(cleaned); });
  it('the bound is 80 code points', () => { expect(LINEAR_NAME_MAX_CHARS).toBe(80); });
});

// log-line-redact-corpus.test.ts — the one corpus both bash log-line redactors are held to (W5 Task C5i; ARCH-67,
// D-7078; the act ruled under D-7289). Each row of `fixtures/redact/log-line.json` is run through:
//   * `ccrc`: ccd/ccrc's `_upd_redact "$input"`, the call every ccd/ccrc and `ccrc doctor` caller makes;
//   * `bareHost`: ccd/ccrc's `_upd_redact "$input" bare-host`, the mode only ccd-update-sync's `say` passes (D-7289);
//   * `updateSync`: ccd/ccd-update-sync's own `say "$input"`, with every function `say` calls, its stderr line read
//     and its `ccd-update-sync: ` prefix and trailing newline cut. So the column holds whatever `say` applies, and
//     the file needs no edit when `say` switches redactor.
// Each value is what the tree printed when the row was added (characterization), and a later commit may move a value
// only where it names the move.
//
// Every call goes through ONE fixed driver: the definitions are written to a temporary file and the input to
// another, and bash runs `bash --noprofile --norc -s -- <defs> <input>` with a fixed stdin script whose last line is
// one of the literal calls in `SCRIPTS`. No path and no environment value ever reaches a script's text. The input
// travels in a file because an argv string cannot carry an invalid UTF-8 byte; stdout and stderr are compared as bytes.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ccdFunctionDefinition } from '../../shared/hook-helpers.mjs';
import { mkTmp } from './tmpHelpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f: string): string => readFileSync(join(REPO, f), 'utf8');

interface Row {
  readonly rule: string;
  readonly input?: string; readonly inputHex?: string;
  readonly home: string;
  readonly locale: 'C' | 'utf8';
  readonly ccrc?: string; readonly ccrcHex?: string;
  readonly bareHost?: string; readonly bareHostHex?: string;
  readonly updateSync?: string; readonly updateSyncHex?: string;
}
const ROWS: readonly Row[] = (JSON.parse(read('server/test/fixtures/redact/log-line.json')) as { rows: Row[] }).rows;

/** The columns, each a fixed stdin script (its definitions file is `$1`, its input file `$2`) and the stream it reads. */
const SCRIPTS = {
  ccrc: { script: '. "$1"\ninput="$(cat -- "$2")"\n_upd_redact "$input"\n', stream: 'stdout' },
  bareHost: { script: '. "$1"\ninput="$(cat -- "$2")"\n_upd_redact "$input" bare-host\n', stream: 'stdout' },
  updateSync: { script: '. "$1"\ninput="$(cat -- "$2")"\nsay "$input"\n', stream: 'stderr' },
} as const;
type Column = keyof typeof SCRIPTS;
const COLUMNS: readonly Column[] = ['ccrc', 'bareHost', 'updateSync'];

const work = mkTmp('log-line-corpus-');

/** The UTF-8 locale this host's bash runs under: the first of `C.UTF-8` and `en_US.UTF-8` in which `é` is one
 *  character (the probe `ccrc-update-phases.test.ts` uses), else `C.UTF-8`. */
const UTF8 = ['C.UTF-8', 'en_US.UTF-8'].find((loc) => spawnSync('bash', ['--noprofile', '--norc', '-s'], {
  input: 'x=$\'\\xc3\\xa9\'; printf \'%s\' "${#x}"\n', encoding: 'utf8',
  env: ghContainedEnv(work, { LC_ALL: loc, PATH: process.env['PATH'] ?? '' }),
}).stdout === '1') ?? 'C.UTF-8';

/** `say`'s definition and every function of ccd-update-sync it calls (transitively), callees first. Throws when the
 *  file defines any function more than once: bash runs a name's LAST definition, `ccdFunctionDefinition` returns its
 *  FIRST, so the column would test a definition the script never runs. */
function sayDefinitions(sync: string): string | null {
  const fns = [...sync.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)\(\) \{/gm)].map((m) => m[1]!);
  for (const n of new Set(fns)) {
    const k = fns.filter((f) => f === n).length;
    if (k > 1) throw new Error(`ccd/ccd-update-sync defines ${n} ${k} times; bash runs the last, the corpus would copy the first`);
  }
  const want = ['say'];
  const defs: string[] = [];
  for (let i = 0; i < want.length; i++) {
    const d = ccdFunctionDefinition(sync, want[i]!);
    if (d === null) return null;
    defs.push(d);
    for (const n of fns) if (!want.includes(n) && new RegExp(`(?<![A-Za-z0-9_])${n}(?![A-Za-z0-9_(])`).test(d)) want.push(n);
  }
  return `${defs.reverse().join('\n')}\n`;
}

const definitions = (): Record<Column, string> => {
  const upd = ccdFunctionDefinition(read('ccd/ccrc'), '_upd_redact');
  const say = sayDefinitions(read('ccd/ccd-update-sync'));
  expect(upd, 'ccd/ccrc has no _upd_redact').not.toBeNull();
  expect(say, 'ccd/ccd-update-sync has no say, or a function say calls is not defined').not.toBeNull();
  const files = { upd: join(work, 'upd-defs.sh'), say: join(work, 'say-defs.sh') };
  writeFileSync(files.upd, `${upd!}\n`);
  writeFileSync(files.say, say!);
  return { ccrc: files.upd, bareHost: files.upd, updateSync: files.say };
};

const PREFIX = Buffer.from('ccd-update-sync: ');
let seq = 0;
/** One call through the fixed driver: the column's output, as bytes. */
function run(defs: Record<Column, string>, col: Column, input: Buffer, home: string, locale: 'C' | 'utf8'): Buffer {
  const inputFile = join(work, `input-${seq++}`);
  writeFileSync(inputFile, input);
  const p = spawnSync('bash', ['--noprofile', '--norc', '-s', '--', defs[col], inputFile], {
    input: SCRIPTS[col].script,
    env: ghContainedEnv(work, { HOME: home, LC_ALL: locale === 'utf8' ? UTF8 : 'C', PATH: process.env['PATH'] ?? '' }),
  });
  expect(p.status, p.stderr.toString()).toBe(0);
  if (SCRIPTS[col].stream === 'stdout') return p.stdout;
  const line = p.stderr;
  // CONTROL: `say` prints one prefixed line; a line without the prefix, or with no newline, reds here.
  expect(line.subarray(0, PREFIX.length).toString(), 'say\'s line lacks its prefix').toBe(PREFIX.toString());
  expect(line[line.length - 1], 'say\'s line lacks its newline').toBe(0x0a);
  return line.subarray(PREFIX.length, line.length - 1);
}

const inputOf = (r: Row): Buffer => (r.inputHex !== undefined ? Buffer.from(r.inputHex, 'hex') : Buffer.from(r.input!, 'utf8'));
const want = (r: Row, col: Column): Buffer => {
  const hex = r[`${col}Hex` as const];
  const text = r[col];
  expect(hex ?? text, `row has no ${col} value`).toBeDefined();
  return hex !== undefined ? Buffer.from(hex, 'hex') : Buffer.from(text!, 'utf8');
};
const shown = (b: Buffer): { text: string; hex: string } => ({ text: b.toString('utf8'), hex: b.toString('hex') });

describe('the log-line redaction corpus (D-7078)', () => {
  it('CONTROL: the corpus is whole, every row distinct, and both definitions are found', () => {
    expect(ROWS.length).toBeGreaterThan(70);
    const keys = ROWS.map((r) => JSON.stringify([r.input ?? r.inputHex, r.home, r.locale]));
    expect(new Set(keys).size).toBe(keys.length);
    for (const r of ROWS) for (const c of COLUMNS) want(r, c);
    const defs = definitions();
    expect(shown(run(defs, 'updateSync', Buffer.from('plain words'), '/home/u', 'C')).text).toBe('plain words');
  });

  it.each(ROWS.map((r, i) => [i, r.rule, r.locale, r.input ?? `<hex ${r.inputHex}>`, r] as const))(
    'row %i (%s, %s): %s', (_i, _rule, _loc, _shown, r) => {
      const defs = definitions();
      for (const c of COLUMNS) {
        expect(shown(run(defs, c, inputOf(r), r.home, r.locale)), c).toEqual(shown(want(r, c)));
      }
    });

  // MUTANT: bash runs a function's LAST definition, and `ccdFunctionDefinition` returns the FIRST. A second, hand-written
  // `_upd_redact` below `say` is what bash would run, so the column must refuse the file rather than copy the generated one.
  it('MUTANT: a second hand-written _upd_redact below say reds the updateSync column', () => {
    const sync = read('ccd/ccd-update-sync');
    const sayLine = /^say\(\) \{[^\n]*\n/m.exec(sync);
    expect(sayLine, 'ccd-update-sync defines say on one line').not.toBeNull();
    const at = sayLine!.index + sayLine![0].length;
    const mutant = `${sync.slice(0, at)}_upd_redact() { printf '%s' "$1"; }\n${sync.slice(at)}`;
    expect(() => sayDefinitions(sync)).not.toThrow();
    expect(() => sayDefinitions(mutant)).toThrow('ccd/ccd-update-sync defines _upd_redact 2 times');
  });
});

/** The number of shell words after `_upd_redact` at `from` in `code`, up to the end of its command (an unquoted `)`,
 *  `;`, `&`, `|` or the line's end). Quotes, `$(…)`, `${…}` and backslashes are followed, so a word holding spaces or
 *  parentheses is one word. */
function updRedactArgCount(code: string, from: number): number {
  let i = from;
  const skipNested = (open: string, close: string): void => {
    let depth = 1;
    i += 1;
    while (i < code.length && depth > 0) {
      const c = code[i]!;
      if (c === '\\') { i += 2; continue; }
      if (c === "'" && open === '(') { i = code.indexOf("'", i + 1); if (i < 0) i = code.length; i += 1; continue; }
      if (c === '"') { skipDouble(); continue; }
      if (c === '$' && (code[i + 1] === '(' || code[i + 1] === '{')) { i += 1; skipNested(code[i]!, code[i] === '(' ? ')' : '}'); continue; }
      if (c === open) depth += 1;
      else if (c === close) depth -= 1;
      i += 1;
    }
  };
  const skipDouble = (): void => {
    i += 1;
    while (i < code.length && code[i] !== '"') {
      const c = code[i]!;
      if (c === '\\') { i += 2; continue; }
      if (c === '$' && (code[i + 1] === '(' || code[i + 1] === '{')) { i += 1; skipNested(code[i]!, code[i] === '(' ? ')' : '}'); continue; }
      if (c === '`') { const e = code.indexOf('`', i + 1); i = e < 0 ? code.length : e + 1; continue; }
      i += 1;
    }
    i += 1;
  };
  let words = 0;
  for (;;) {
    while (i < code.length && (code[i] === ' ' || code[i] === '\t')) i += 1;
    if (i >= code.length || ');&|\n'.includes(code[i]!)) return words;
    words += 1;
    while (i < code.length && !' \t);&|\n'.includes(code[i]!)) {
      const c = code[i]!;
      if (c === '\\') i += 2;
      else if (c === "'") { const e = code.indexOf("'", i + 1); i = e < 0 ? code.length : e + 1; }
      else if (c === '"') skipDouble();
      else if (c === '$' && (code[i + 1] === '(' || code[i + 1] === '{')) { i += 1; skipNested(code[i]!, code[i] === '(' ? ')' : '}'); }
      else i += 1;
    }
  }
}

/** Every `_upd_redact` call in `src` (comment lines and trailing comments cut; its definition line skipped): the line,
 *  the enclosing column-0 function (or null), the words it passes, and whether one of them is `bare-host`. */
function updRedactCalls(src: string): Array<{ line: number; fn: string | null; args: number; bareHost: boolean; text: string }> {
  const out: Array<{ line: number; fn: string | null; args: number; bareHost: boolean; text: string }> = [];
  let fn: string | null = null;
  src.split('\n').forEach((raw, k) => {
    const def = /^([A-Za-z_][A-Za-z0-9_]*)\(\) \{/.exec(raw);
    if (def) fn = def[1]!;
    else if (raw.startsWith('}')) { fn = null; return; }
    if (/^\s*#/.test(raw)) return;
    const code = raw.replace(/\s#(?:\s.*)?$/, '');
    for (const m of code.matchAll(/(?<![A-Za-z0-9_])_upd_redact(?![A-Za-z0-9_])/g)) {
      const after = m.index! + m[0].length;
      if (/^\s*\(\s*\)/.test(code.slice(after))) continue;
      const args = updRedactArgCount(code, after);
      out.push({ line: k + 1, fn: def ? def[1]! : fn, args, bareHost: /(?:^|\s)["']?bare-host["']?(?=\s|\)|$)/.test(code.slice(after)), text: raw.trim() });
    }
    if (def && raw.trimEnd().endsWith('}') && !raw.trimEnd().endsWith('{')) fn = null;
  });
  return out;
}

describe('the bare-host mode\'s scope (D-7289)', () => {
  it('the word counter reads one argument through quotes, $(…) and ${…}, and two when two are passed', () => {
    const n = (code: string): number => updRedactArgCount(code, code.indexOf('_upd_redact') + '_upd_redact'.length);
    expect(n('x="$(_upd_redact "$m")"')).toBe(1);
    expect(n('w="$(_upd_redact "${A:-the (probe) gave; no reason}")"')).toBe(1);
    expect(n('"$(_upd_redact "the box\'s ccrc.env sets ${s:-$n}${u:+; x:$u}")"')).toBe(1);
    expect(n('$(_upd_redact "$(printf \'%s\' "a b")")')).toBe(1);
    expect(n('$(_upd_redact "$1" bare-host)')).toBe(2);
    expect(n('$(_upd_redact $x bare-host)')).toBe(2);
    expect(n('_upd_redact "$a" "$b"; echo')).toBe(2);
    expect(n('$(_upd_redact)')).toBe(0);
  });

  // The call counts are pinned exactly, as measured on this tree: a call the reader stops seeing (a new spelling, a moved
  // line it misreads) reds here, not only a call that passes a second word. A commit that adds or removes a call moves
  // its file's count in the same diff.
  const CALLS = { 'ccd/ccrc': 18, 'ccd/ccrc-doctor-checks': 3 } as const;
  it('every _upd_redact call in ccd/ccrc and ccd/ccrc-doctor-checks passes exactly one argument, and their counts are pinned', () => {
    for (const [f, count] of Object.entries(CALLS)) {
      const calls = updRedactCalls(read(f));
      expect(calls.length, `${f}'s _upd_redact calls`).toBe(count);
      for (const c of calls) expect({ f, line: c.line, args: c.args, bareHost: c.bareHost }, c.text).toEqual({ f, line: c.line, args: 1, bareHost: false });
    }
  });

  it('any call in ccd/ccd-update-sync that passes bare-host lies in say', () => {
    for (const c of updRedactCalls(read('ccd/ccd-update-sync'))) {
      if (c.bareHost || c.args > 1) expect(c.fn, c.text).toBe('say');
    }
  });
});

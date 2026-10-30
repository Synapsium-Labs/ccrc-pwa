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
// R8 (D-7564). Scheme-less userinfo that no '/' follows used to print whole in every column: ended instead by ':port',
// ':', a quote, a tab, a CR, a second '@', or led by an '@' (`server user:secret@host:8443 refused`,
// `@user:secret@host`, …). Those eight rows were labelled `known-limit` and held that unmasked output; D-7564 moved them
// to their masked output under rule `R8`, beside one row per new terminator. Two rules close the gap, in both modes: a
// token's userinfo that holds a ':' (`user:pass@`) goes whatever follows it, and any userinfo goes before a host that
// ends in `:digits` and then whitespace, `)`, `]`, `,`, `;`, `:`, `|`, a quote, `<`, `>` or the text's end. The same
// move took `u:hunter2@h.invalid:9)`'s `ccrc` column from whole to masked (rule R6's row). The `prose` rows beside them
// hold what must stay whole: an email address, a time such as `10:30`, a URL or a host with a port and no userinfo.
// One `blast` row records the cost: `mailto:a@example.com` reads as `user:pass@host` and loses its `mailto:a@`.
//
// D-7564's second round closed four more shapes under R8: a port followed by '.', '!' or '}' and then whitespace or the
// text's end (`reach tok@host:8443.`; a version's `x@h:1.2` stays), a bracketed IPv6 host (`tok@[::1]:8443`), a
// leading '@' before a token-only userinfo (`@tok@host:8443 refused`) and a percent-encoded ':' (`user%3Asecret@host`).
// A ':' userinfo after `KEY=` or `--flag=` keeps that prefix (`CCRC_X=host`, `--proxy=host:8080`). More `blast` rows
// record what is still over-masked (`npm:pkg@1.2.3`, `WARNING:root:bob@example.com`, `stash@{0}:3`,
// `claude-session@x.service:12`). KNOWN LIMITS: the rows labelled `known-limit`, each with a `note`, hold lines whose
// secret still prints whole, on purpose: a userinfo inside a query string or a path, and a raw '#', '?' or '/' inside a
// password. The file's own `note` says the same. The `bound` row is a line of about 85 KB, written as `inputRuns`
// (runs of text, each repeated `times` times): a text over 4096 bytes keeps only a head cut back to its last
// whitespace, so a line of thousands of credentials returns in milliseconds, not seconds.
//
// D-7564's third round closed three more shapes, each a row in every column: a port followed by a run of '.', '!' or
// '}' and then any other terminator (`connecting to tok@host:8443... retrying`, `dial tok@host:8443.) retrying`,
// `tok@host:8443}.`; `x@h:1.2`, `v pkg@h:1.2.3 ok` and `see a@b:3.x` stay whole in plain mode), a backtick around the
// token (`` reach `tok@host:8443` ``, which keeps its backticks), and a leading '@' before a userinfo whose host a '/'
// ends, or (bare-host) the text's end: `@tok@host/x refused` reads `host/x refused`.
//
// D-7564's fourth round closed two more under R8: a scheme URL whose userinfo starts with '@' (`https://@tok@host/x`,
// `https://@tok@host`, `https://@@tok@host/x` read `https://host/x` and `https://host`), and a bracketed host that holds
// an IPv6 zone id or is an IPvFuture literal (`tok@[fe80::1%25en0]:80 refused`, `tok@[v1.fe80::1]:80 refused`). Two
// `blast` rows record the bracket's cost: `log@[core:io]:2 ok` reads `[core:io]:2 ok` since the bracket widened, and
// `ref@[main]:2 ok` read `[main]:2 ok` before it (a bracket with no ':' is an ordinary host). The round recorded four
// more known limits, each printed whole in every column: a token-only userinfo before a host that no port and no path
// follows, while more text follows it (`--proxy=tok@host refused`, `--proxy tok@host refused`; prose's `user@host` has
// the same shape), and a port followed by a non-ASCII punctuation mark (`tok@host:8443… x`, `tok@host:8443” x`). A
// second `bound` row holds a head dense with masks (about 4000 bytes of `u:secret@h:1`, a `/home/u/x` after every
// third), so the 3 s limit is measured where every loop does the most work.
//
// D-7564's fifth round turned rule 2's port terminator from a list of what may follow a port into what may not: a port
// ends at any character but a letter, a digit, '.', '!', '}', '_', '~' or '-' (read byte by byte under LC_ALL=C), or at
// a run of '.', '!' or '}' that such a character or the text's end follows. So a port followed by a non-ASCII mark or
// space (`tok@host:8443… x`, `proxy tok@host:8443<U+00A0>x`, an invalid byte), by '(', '&', '\' or '=', or by an
// escaped JSON quote or a literal `\n` (`"msg":"proxy tok@host:8443\" refused"`, `connect to tok@host:8443\nretry`)
// masks in every column: the two non-ASCII known-limit rows are R8 rows now, beside one row per new shape. What is left
// is a port followed by a letter, '-', '_' or '~', characters a host name holds, so the text after the ':' is arguably
// no port (`tok@host:8443-x retrying`, `tok@host:8443a x`): five `known-limit` rows, printed whole in every column. No
// `blast` or `prose` row moved; `v pkg@h:1.2.3 ok`, `x@h:1.2` and `build@10:30` stay whole in plain mode.
//
// D-7564's sixth and last round: a scheme's '/' may follow a '\', as JSON escapes it, so `https:\/\/u:secret@host\/x`,
// `https:\/\/tok@host` and `"url":"https:\/\/u:secret@host"` mask in every column (three R8 rows; the slashes stay as
// written). Four more `known-limit` rows, printed whole in every column: a port followed by a run of '.', '!' or '}' and
// then a letter (`tok@host:8443.x retrying`, `tok@host:8443!x retrying`, `tok@host:8443}x retrying`), and a host of
// digits only before its port (`tok@2130706433:80 x`), which reads as a time's `build@10:30`.
//
// Every call goes through ONE fixed driver: the definitions are written to a temporary file and the input to
// another, and bash runs `bash --noprofile --norc -s -- <defs> <input>` with a fixed stdin script whose last line is
// one of the literal calls in `SCRIPTS`. No path and no environment value ever reaches a script's text. The input
// travels in a file because an argv string cannot carry an invalid UTF-8 byte; stdout and stderr are compared as bytes.
// The driver cannot test two kinds of text: one that ends in a newline (`input="$(cat -- "$2")"` strips every trailing
// newline before the call) and one that contains a NUL (a bash variable cannot hold that byte). No row holds either.
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
  readonly note?: string;
  readonly input?: string; readonly inputHex?: string;
  readonly inputRuns?: ReadonlyArray<{ readonly text: string; readonly times: number }>;
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

const inputOf = (r: Row): Buffer => {
  if (r.inputRuns !== undefined) return Buffer.from(r.inputRuns.map((x) => x.text.repeat(x.times)).join(''), 'utf8');
  return r.inputHex !== undefined ? Buffer.from(r.inputHex, 'hex') : Buffer.from(r.input!, 'utf8');
};
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
    const keys = ROWS.map((r) => JSON.stringify([r.input ?? r.inputHex ?? r.inputRuns, r.home, r.locale]));
    for (const r of ROWS) expect([r.input, r.inputHex, r.inputRuns].filter((v) => v !== undefined).length, JSON.stringify(r).slice(0, 80)).toBe(1);
    expect(new Set(keys).size).toBe(keys.length);
    for (const r of ROWS) for (const c of COLUMNS) want(r, c);
    const defs = definitions();
    expect(shown(run(defs, 'updateSync', Buffer.from('plain words'), '/home/u', 'C')).text).toBe('plain words');
  });

  // D-7564: the eight shapes once recorded as `known-limit` are R8 rows now, and in every column their output no longer
  // carries the secret. The known limits left are exactly the seventeen lines below, each with a note, each printed whole.
  it('CONTROL: the eight former known-limit shapes are R8 rows whose every column drops the secret, and only the seventeen recorded known limits are left', () => {
    const former = [
      'server user:secret@host:8443 refused', 'user:secret@host: refused', "user:secret@host' failed",
      'user:secret@host" failed', 'user:secret@host\tfailed', 'user:secret@host\rfailed', 'user:secret@@host/x',
      '@user:secret@host',
    ];
    for (const input of former) {
      const r = ROWS.find((x) => x.input === input && x.locale === 'C');
      expect(r?.rule, input).toBe('R8');
      for (const c of COLUMNS) expect(want(r!, c).toString('utf8'), `${input} (${c})`).not.toContain('secret');
    }
    const limits = [
      'https://h/x?proxy=user:secret@host', 'GET /p?u=user:secret@host:8443', 'dir/user:secret@host',
      'user:pa#ss@host refused', 'user:pa?ss@host refused', 'user:pa/ss@host refused',
      '--proxy=tok@host refused', '--proxy tok@host refused', 'tok@host:8443-x retrying', 'tok@host:8443- x',
      'tok@host:8443a x', 'tok@host:8443_x y', 'tok@host:8443~ x', 'tok@host:8443.x retrying',
      'tok@host:8443!x retrying', 'tok@host:8443}x retrying', 'tok@2130706433:80 x',
    ];
    expect(ROWS.filter((r) => r.rule === 'known-limit').map((r) => r.input)).toEqual(limits);
    for (const r of ROWS.filter((x) => x.rule === 'known-limit')) {
      expect(r.note, r.input).toMatch(/^known limit: /);
      for (const c of COLUMNS) expect(want(r, c).toString('utf8'), `${r.input} (${c})`).toBe(r.input);
    }
    expect(ROWS.filter((r) => r.note !== undefined && r.rule !== 'known-limit')).toEqual([]);
    for (const r of ROWS.filter((x) => x.rule === 'R8')) {
      for (const c of COLUMNS) expect(want(r, c).toString('utf8'), `${r.input} (${c})`).not.toMatch(/secret|\bp@|tok@/);
    }
  });

  const title = (r: Row): string => r.input ?? (r.inputHex !== undefined ? `<hex ${r.inputHex}>`
    : `<runs ${r.inputRuns!.map((x) => `${JSON.stringify(x.text)}x${x.times}`).join(' + ')}>`);
  it.each(ROWS.map((r, i) => [i, r.rule, r.locale, title(r), r] as const))(
    'row %i (%s, %s): %s', (_i, _rule, _loc, _shown, r) => {
      const defs = definitions();
      for (const c of COLUMNS) {
        expect(shown(run(defs, c, inputOf(r), r.home, r.locale)), c).toEqual(shown(want(r, c)));
      }
    });

  // D-7564, the bound: each loop rescans the whole text once per credential it masks, so the first `bound` row's line
  // (about 85 KB, 4000 credentials and homes past one long token) took seconds a call. Capped at 4096 bytes it returns at
  // once, in every column, with no secret and no more than 4096 bytes. The second row's kept head is dense with masks
  // (about 4000 bytes of `u:secret@h:1` and `/home/u/x`), a dense row, so a slow runner's legs measure it against the
  // same limit.
  it('BOUND: both bound rows return within 3 s in each column, with no secret and at most 4096 bytes', () => {
    const bounds = ROWS.filter((x) => x.rule === 'bound');
    expect(bounds.length, 'the corpus has two bound rows').toBe(2);
    const defs = definitions();
    for (const r of bounds) {
      expect(r.inputRuns, 'a bound row is written as inputRuns').toBeDefined();
      expect(inputOf(r).length).toBeGreaterThan(80_000);
      for (const c of COLUMNS) {
        const t0 = performance.now();
        const out = run(defs, c, inputOf(r), r.home, r.locale);
        const ms = performance.now() - t0;
        expect(ms, `${c} took ${Math.round(ms)} ms`).toBeLessThan(3000);
        expect(out.toString('utf8'), c).not.toContain('secret');
        expect(out.length, c).toBeLessThanOrEqual(4096);
      }
    }
    // The dense row is dense: its kept head masks at least 200 credentials and 50 homes in every column.
    const dense = bounds.map((r) => COLUMNS.map((c) => want(r, c).toString('utf8')))
      .find((cols) => cols.every((o) => o.split('h:1').length - 1 >= 200 && o.split('~/x').length - 1 >= 50));
    expect(dense, 'a bound row whose head is dense with masks').toBeDefined();
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

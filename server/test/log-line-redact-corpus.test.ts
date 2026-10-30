// log-line-redact-corpus.test.ts — the one corpus both bash log-line redactors are held to (W5 Task C5i; ARCH-67,
// D-7078; the act ruled under D-7289). Each row of `fixtures/redact/log-line.json` is run through:
//   * `ccrc`: ccd/ccrc's `_upd_redact "$input"`, the call every ccd/ccrc and `ccrc doctor` caller makes;
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
  readonly updateSync?: string; readonly updateSyncHex?: string;
}
const ROWS: readonly Row[] = (JSON.parse(read('server/test/fixtures/redact/log-line.json')) as { rows: Row[] }).rows;

/** The columns, each a fixed stdin script (its definitions file is `$1`, its input file `$2`) and the stream it reads. */
const SCRIPTS = {
  ccrc: { script: '. "$1"\ninput="$(cat -- "$2")"\n_upd_redact "$input"\n', stream: 'stdout' },
  updateSync: { script: '. "$1"\ninput="$(cat -- "$2")"\nsay "$input"\n', stream: 'stderr' },
} as const;
type Column = keyof typeof SCRIPTS;
const COLUMNS: readonly Column[] = ['ccrc', 'updateSync'];

const work = mkTmp('log-line-corpus-');

/** The UTF-8 locale this host's bash runs under: the first of `C.UTF-8` and `en_US.UTF-8` in which `é` is one
 *  character (the probe `ccrc-update-phases.test.ts` uses), else `C.UTF-8`. */
const UTF8 = ['C.UTF-8', 'en_US.UTF-8'].find((loc) => spawnSync('bash', ['--noprofile', '--norc', '-s'], {
  input: 'x=$\'\\xc3\\xa9\'; printf \'%s\' "${#x}"\n', encoding: 'utf8',
  env: ghContainedEnv(work, { LC_ALL: loc, PATH: process.env['PATH'] ?? '' }),
}).stdout === '1') ?? 'C.UTF-8';

/** `say`'s definition and every function of ccd-update-sync it calls (transitively), callees first. */
function sayDefinitions(sync: string): string | null {
  const fns = [...sync.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)\(\) \{/gm)].map((m) => m[1]!);
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
  return { ccrc: files.upd, updateSync: files.say };
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
});

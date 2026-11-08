import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { definitionsIn } from '../src/coord/ledger.js';
// Every scan of ccd's text reads it through `ccdSource`, so a region moved into a library stays under this census.
import { CCD, ccdSource } from './ccdWsHelpers.js';

/**
 * The Python that reads Claude Code transcripts inside ccd, named and counted (D-8070).
 *
 * ccd's transcript reader is `ccd/lib/transcript.jq` (ARCH-65), and the operator ruled on 2026-11-06 that the Python
 * readers still standing stay as recorded exceptions rather than move to it. Until now nothing counted them, so a new
 * one could join with nobody deciding that it should. Reopen the ruling only on a real fault, or if Python leaves ccd.
 *
 * WHAT IS MEASURED. A site is either a function of ccd that runs a Python interpreter and speaks transcript grammar, or
 * a Python program under `ccd/` that names a transcript, by a file name or a word only transcripts hold. A function
 * counts as a whole, bash lines included, because a reader can take its file in the bash half and hold no grammar in the
 * Python half. The scan is textual: it finds a reader by the words on its lines, so a row is a recorded judgment, and
 * `no-read` is a site that matches the words only. A program is held to the narrower words because the codex bridge
 * under `ccd/` speaks `message` and `tool_use` too, so a program that uses only those goes unseen.
 *
 * WHAT IS NOT MEASURED. The line between a reader and a writer is checked on function rows only. Both program rows
 * already write files of their own, so the same check could not tell a new transcript writer among them; their rows say
 * in words what they do.
 *
 * The interpreter match is textual as well. It does not see a relative script (`python3 lib/x.py`), a quoted "python3",
 * a redirect before the script (`python3 2>/dev/null <<PY`), or an interpreter held in a variable or run by a helper
 * such as `_pr_py`. `ccd/lib/ccrc-settings.sh` is not one of `CCD_LIBS`, so `ccdSource` leaves its functions out. Code
 * outside a function is not a site of its own: it counts toward the function above it, or is dropped before the first.
 *
 * WHEN THIS GOES RED ON A NEW READER, there are two ways out:
 *   1. Read through `ccd/lib/transcript.jq` instead, which needs no row.
 *   2. The escape: add a row below whose `d` is a D-number defined in `docs/superpowers/plans/`, with a `why` a reader
 *      can argue with. A false match takes the same route with `kind: 'no-read'`. One row, no other edit.
 *
 * WHEN A READER'S PORT LANDS, nothing here has to change for the port to pass: `leaving` lets the row match nothing
 * and the count falls by one, and the cases that pin this run on a fixture, so they do not need the live tree to still
 * hold the reader. Delete the row in that pull request all the same, because a row left behind would let Python back
 * into that function unseen. The banner reader's row went that way (#2367).
 */

type Kind =
  | 'reader'    // parses transcript records and rewrites none of them
  | 'writer'    // rewrites a transcript in place
  | 'no-read';  // matches the words and parses no transcript record

interface Row {
  readonly name: string;      // a ccd function, or a program's path under ccd/
  readonly kind: Kind;
  readonly d: string;
  readonly why: string;
  readonly leaving?: true;    // the one state that may match nothing
}

const ROWS: readonly Row[] = [
  { name: '_operator_choice_read', kind: 'reader', d: 'D-8070',
    why: 'keeps the operator\'s model and effort choice across a swap and reads back what a session runs' },
  { name: 'ccd-usage-sweep.py', kind: 'reader', d: 'D-8070',
    why: 'sums usage from assistant rows, a standalone sweep that stays in Python' },
  { name: 'lib/carry-dedupe.py', kind: 'reader', d: 'D-8070',
    why: 'parses each row of a carried copy for its uuid, to prove the copy adds nothing to the keeper; it rewrites no record, but it deletes a carried copy once proved and swaps identical sidecar files for hard links to the keeper\'s' },
  { name: '_sanitize_anthropic', kind: 'writer', d: 'D-8070',
    why: 'fills empty assistant text blocks in a carried transcript; the writer stays whatever happens to the readers' },
  { name: '_carry_py', kind: 'no-read', d: 'D-8070',
    why: 'picks transcripts by their file name and copies bytes; it parses no record' },
  { name: 'cmd_carry_dedupe', kind: 'no-read', d: 'D-8070',
    why: 'hands `lib/carry-dedupe.py` its arguments, and that program has its own row' },
  { name: '_ws_archive_manifest', kind: 'no-read', d: 'D-8070',
    why: 'records the transcript\'s path; its Python reads the PR ledger' },
];

const FUNCTION_HEAD = /^([A-Za-z_][\w-]*)\(\) *\{/;
/** The interpreter word, then what starts a run: a flag, a path, a quote, a variable, a heredoc or other stdin, or a line continuation. */
const PYTHON_RUN = /(?:^|[\s|(&;=`])(?:[^\s'"]*\/)?python[\d.]*(?:\s*<|\s+(?:-|\/|"|'|\$|~|\\\n))/m;
const TRANSCRIPT_GRAMMAR = /\.jsonl|transcript|isApiErrorMessage|<command-|["'](?:assistant|user|message)["']|\b(?:stop_reason|sessionId|parentUuid|tool_use|tool_result)\b/i;
const PROGRAM_NAMES_TRANSCRIPT = /\.jsonl|transcript|isApiErrorMessage|parentUuid/i;
const WRITES_FILE = /os\.(?:replace|rename)\(|shutil\.move\(|\.write_(?:text|bytes)\(|open\([^\n]*,\s*["'](?:[wa]|r\+|rb\+)/;

const code = (text: string): string => text.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');

/** A function runs from its head to the next head: a `}` in column 0 can be a Python dict inside a heredoc. */
function functionsOf(text: string): Map<string, string> {
  const out = new Map<string, string>();
  let name = '';
  let lines: string[] = [];
  const close = (): void => { if (name) out.set(name, code(lines.join('\n'))); };
  for (const line of text.split('\n')) {
    const head = FUNCTION_HEAD.exec(line);
    if (head) { close(); name = head[1]!; lines = []; }
    lines.push(line);
  }
  close();
  return out;
}

interface Site {
  readonly name: string;
  readonly writes?: boolean;  // a function's measure; a program has none, see WHAT IS NOT MEASURED
}

function measure(ccd: string, programs: ReadonlyMap<string, string>): Site[] {
  const sites: Site[] = [];
  for (const [name, body] of functionsOf(ccd)) {
    if (PYTHON_RUN.test(body) && TRANSCRIPT_GRAMMAR.test(body)) sites.push({ name, writes: WRITES_FILE.test(body) });
  }
  for (const [name, text] of programs) if (PROGRAM_NAMES_TRANSCRIPT.test(code(text))) sites.push({ name });
  return sites;
}

interface Verdict { readonly readers: string[]; readonly writers: string[]; readonly problems: string[] }

function judge(sites: readonly Site[], rows: readonly Row[], defined: ReadonlySet<string>): Verdict {
  const problems: string[] = [];
  const named = new Map(rows.map((r) => [r.name, r]));
  if (named.size !== rows.length) problems.push('a name has two rows');
  for (const r of rows) {
    if (!defined.has(r.d)) problems.push(`${r.name}: ${r.d} is not defined in docs/superpowers/plans/`);
    if (!r.why.trim()) problems.push(`${r.name}: the row gives no why`);
  }
  const found = new Map(sites.map((s) => [s.name, s]));
  for (const s of sites) {
    const row = named.get(s.name);
    if (!row) {
      problems.push(`${s.name} reads transcripts in Python and no row allows it: read through ccd/lib/transcript.jq, or add a row with a defined D-number`);
    } else if (s.writes === true && row.kind === 'reader') {
      problems.push(`${s.name} writes a file now, and its row says reader: a new transcript writer needs its own decision`);
    } else if (s.writes === false && row.kind === 'writer') {
      problems.push(`${s.name} no longer writes, and its row says writer`);
    }
  }
  for (const r of rows) {
    if (!found.has(r.name) && !r.leaving) problems.push(`${r.name} has a row and is no longer found: the ruling keeps it, so reopen that or delete the row`);
  }
  const ofKind = (kind: Kind): string[] => rows.filter((r) => r.kind === kind && found.has(r.name)).map((r) => r.name);
  return { readers: ofKind('reader'), writers: ofKind('writer'), problems };
}

const CCD_DIR = path.dirname(CCD);

function pythonPrograms(): Map<string, string> {
  const out = new Map<string, string>();
  for (const name of fs.readdirSync(CCD_DIR, { recursive: true, encoding: 'utf8' })) {
    const file = path.join(CCD_DIR, name);
    if (!fs.statSync(file).isFile()) continue;
    if (name.endsWith('.py')) { out.set(name, fs.readFileSync(file, 'utf8')); continue; }
    const fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(64);
    const size = fs.readSync(fd, head, 0, 64, 0);
    fs.closeSync(fd);
    if (/^#!.*python/.test(head.toString('latin1', 0, size).split('\n')[0]!)) out.set(name, fs.readFileSync(file, 'utf8'));
  }
  return out;
}

function definedNumbers(): Set<string> {
  const plans = path.resolve(CCD_DIR, '..', 'docs', 'superpowers', 'plans');
  const files = fs.readdirSync(plans, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.md'))
    .map((f) => ({ path: f, text: fs.readFileSync(path.join(plans, f), 'utf8') }));
  return new Set(definitionsIn(files).map((d) => `D-${d.n}`));
}

const tree = ccdSource();
const programs = pythonPrograms();
const defined = definedNumbers();
const judgeText = (ccd: string, rows: readonly Row[] = ROWS, py: ReadonlyMap<string, string> = programs): Verdict =>
  judge(measure(ccd, py), rows, defined);

/** The tree with one function's body replaced, its neighbours untouched. */
function withFunction(name: string, body: string): string {
  const lines = tree.split('\n');
  const from = lines.findIndex((l) => l.startsWith(`${name}() {`));
  if (from < 0) throw new Error(`${name} is not in ccd`);
  const rest = lines.slice(from + 1).findIndex((l) => FUNCTION_HEAD.test(l));
  return [...lines.slice(0, from), `${name}() {`, body, '}', '', ...lines.slice(from + 1 + rest)].join('\n');
}

const JQ_BODY = '  tail -n 5 -- "$1" | jq -L "$TRANSCRIPT_JQ_LIB" -rRs \'include "transcript"; last_turn_ts\'';

/** A ccd and a table of their own: the leaving row's cases must hold before, during and after the real port. */
const LEAVING = '_fixture_banner';
const PY_BODY = '  tail -n 5 -- "$1" | python3 -c \'import json,sys; print(json.loads(sys.stdin.read())["message"])\'';
const fixtureFn = (name: string, body: string): string => `${name}() {\n${body}\n}\n`;
const fixtureCcd = (...rest: readonly string[]): string => [fixtureFn('_fixture_stays', PY_BODY), ...rest].join('\n');
const FIXTURE_ROWS: readonly Row[] = [
  { name: '_fixture_stays', kind: 'reader', d: 'D-8070', why: 'a fixture' },
  { name: LEAVING, kind: 'reader', d: 'D-8070', why: 'a fixture', leaving: true },
];
const judgeFixture = (ccd: string, rows: readonly Row[] = FIXTURE_ROWS): Verdict => judge(measure(ccd, new Map()), rows, defined);

describe('the Python transcript readers in ccd (D-8070)', () => {
  it('finds exactly the rows, so the tree stands as the ruling recorded it', () => {
    const v = judgeText(tree);
    expect(v.problems).toEqual([]);
    expect(v.readers).toEqual(expect.arrayContaining(['_operator_choice_read', 'ccd-usage-sweep.py', 'lib/carry-dedupe.py']));
    expect(v.writers).toEqual(['_sanitize_anthropic']);
  });

  it('reds on a new reader, in ccd or as a new program', () => {
    const fn = `${tree}\n_new_reader() {\n  tail -n 5 "$(_transcript_path "$1")" | python3 -c 'print(1)'\n}\n`;
    expect(judgeText(fn).problems.join('\n')).toMatch(/^_new_reader reads transcripts in Python and no row allows it/);
    const grammarOnly = `${tree}\n_new_reader() {\n  python3 -c 'import json,sys; print(json.loads(sys.argv[1])["message"])' "$1"\n}\n`;
    expect(judgeText(grammarOnly).problems.join('\n')).toMatch(/^_new_reader reads/);
    const py = new Map(programs).set('lib/new-reader.py', 'import glob\nprint(glob.glob("*.jsonl"))\n');
    expect(judgeText(tree, ROWS, py).problems.join('\n')).toMatch(/^lib\/new-reader\.py reads/);
    const wordsOnly = new Map(programs).set('lib/new-reader.py', 'import json,sys\nprint(json.loads(sys.argv[1])["parentUuid"])\n');
    expect(judgeText(tree, ROWS, wordsOnly).problems.join('\n')).toMatch(/^lib\/new-reader\.py reads/);
  });

  it.each([
    ['a quoted heredoc', `python3 <<'PY'\nprint(json.loads(l)["message"])\nPY`],
    ['a bare heredoc', 'python3 <<PY\nprint(1)\nPY'],
    ['a heredoc with no space', `python3<<'PY'\nprint(1)\nPY`],
    ['a here-string', 'python3 <<< "$code"'],
    ['a process substitution', 'python3 <(printf "%s" "$code")'],
    ['a script under home', 'python3 ~/x.py'],
    ['a line continuation', `python3 \\\n    -c 'print(1)'`],
    ['backticks', "x=`python3 -c 'print(1)'`"],
  ])('reds on a new reader run through %s', (_form, run) => {
    const fn = `${tree}\n_limit_rows_new() {\n  F="$(_transcript_path "$1")" ${run}\n}\n`;
    expect(judgeText(fn).problems.join('\n')).toMatch(/^_limit_rows_new reads/);
  });

  it.each([
    ['a relative script', 'python3 lib/x.py'],
    ['a quoted interpreter', `"python3" -c 'print(1)'`],
    ['a redirect before the script', `python3 2>/dev/null <<'PY'\nprint(1)\nPY`],
    ['an interpreter in a variable', `"$py" -c 'print(1)'`],
  ])('does not see %s, which the pull request lists as a limit', (_form, run) => {
    const fn = `${tree}\n_limit_rows_new() {\n  F="$(_transcript_path "$1")" ${run}\n}\n`;
    expect(judgeText(fn).problems).toEqual([]);
  });

  it('reads a function to its next head, past a column-0 brace in a heredoc', () => {
    const fn = `${tree}\n_new_reader() {\n  python3 - <<'PY'\nd = {\n}\nprint(d["message"])\nPY\n}\n`;
    expect(judgeText(fn).problems.join('\n')).toMatch(/^_new_reader reads/);
  });

  it('leaves alone Python that speaks no transcript grammar, and a comment that only mentions a reader', () => {
    const fn = `${tree}\n_not_a_reader() {\n  python3 -c 'print(1)'\n  # python3 -c reads the transcript\n}\n`;
    expect(judgeText(fn).problems).toEqual([]);
  });

  it('drops a leaving reader cleanly: its port needs no edit to the rows, and the count falls by one', () => {
    expect(judgeFixture(fixtureCcd(fixtureFn(LEAVING, PY_BODY)))).toEqual({ readers: ['_fixture_stays', LEAVING], writers: [], problems: [] });
    const dropped = { readers: ['_fixture_stays'], writers: [], problems: [] };
    const ported = fixtureCcd(fixtureFn(LEAVING, JQ_BODY));
    expect(judgeFixture(ported)).toEqual(dropped);
    expect(judgeFixture(fixtureCcd())).toEqual(dropped);
    expect(judgeFixture(fixtureCcd(fixtureFn('_fixture_renamed', JQ_BODY)))).toEqual(dropped);
    expect(judgeFixture(ported, FIXTURE_ROWS.filter((r) => r.name !== LEAVING))).toEqual(dropped);
  });

  it('holds the banner row as the leaving one for as long as that reader stands', () => {
    const banner = '_transcript_limit_banner';
    if (!measure(tree, programs).some((s) => s.name === banner)) return;
    expect(ROWS.filter((r) => r.leaving).map((r) => r.name)).toEqual([banner]);
  });

  it('counts a port that moves the Python under another name as a new reader', () => {
    const moved = fixtureCcd(fixtureFn(LEAVING, JQ_BODY), fixtureFn('_limit_rows', PY_BODY));
    expect(judgeFixture(moved).problems.join('\n')).toMatch(/^_limit_rows reads/);
  });

  it.each(['_operator_choice_read', '_sanitize_anthropic'])('reds when %s goes, because the ruling keeps it', (name) => {
    expect(judgeText(withFunction(name, JQ_BODY)).problems.join('\n')).toContain(`${name} has a row and is no longer found`);
  });

  it('holds the line between a reader and a writer', () => {
    const readerWrites = withFunction('_operator_choice_read', `  python3 -c 'import os; os.replace("$1.tmp", "$1")' # transcript`);
    expect(judgeText(readerWrites).problems.join('\n')).toContain('_operator_choice_read writes a file now');
    const writerReads = withFunction('_sanitize_anthropic', `  python3 -c 'print(1)' < "$1" # transcript`);
    expect(judgeText(writerReads).problems.join('\n')).toContain('_sanitize_anthropic no longer writes');
  });

  it.each([
    ['open(p, "r+")'], ['open(p, "rb+")'], ['Path(p).write_text(s)'], ['Path(p).write_bytes(b)'], ['shutil.move(a, b)'],
  ])('counts %s as writing a file', (write) => {
    const readerWrites = withFunction('_operator_choice_read', `  python3 -c '${write}' # transcript`);
    expect(judgeText(readerWrites).problems.join('\n')).toContain('_operator_choice_read writes a file now');
  });

  it('holds that line on function rows only: a program row that writes passes, so its why has to say so', () => {
    const py = new Map(programs).set('lib/carry-dedupe.py', 'import os\nos.replace("a.jsonl.tmp", "a.jsonl")\n');
    expect(judgeText(tree, ROWS, py).problems).toEqual([]);
  });

  describe('the escape', () => {
    const fn = `${tree}\n_new_reader() {\n  tail -n 5 "$(_transcript_path "$1")" | python3 -c 'print(1)'\n}\n`;
    const row = (over: Partial<Row> = {}): Row => ({ name: '_new_reader', kind: 'reader', d: 'D-8070', why: 'a fixture', ...over });

    it('lets one row with a defined D-number and a why allow a new reader', () => {
      const v = judgeText(fn, [...ROWS, row()]);
      expect(v.problems).toEqual([]);
      expect(v.readers).toContain('_new_reader');
    });

    it('takes a false match by the same route, without counting it', () => {
      const v = judgeText(fn, [...ROWS, row({ kind: 'no-read' })]);
      expect(v.problems).toEqual([]);
      expect(v.readers).not.toContain('_new_reader');
    });

    it('refuses a row with no recorded decision', () => {
      expect(judgeText(fn, [...ROWS, row({ d: 'D-0' })]).problems).toEqual(['_new_reader: D-0 is not defined in docs/superpowers/plans/']);
      expect(judgeText(fn, [...ROWS, row({ why: ' ' })]).problems).toEqual(['_new_reader: the row gives no why']);
    });

    it('refuses a second row for one name', () => {
      expect(judgeText(tree, [...ROWS, ROWS[0]!]).problems).toEqual(['a name has two rows']);
    });
  });
});

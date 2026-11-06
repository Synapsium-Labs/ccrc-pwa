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
 * a Python program under `ccd/` that names a transcript. A function counts as a whole, bash lines included, because a
 * reader can take its file in the bash half and hold no grammar in the Python half. The scan is textual: it finds a
 * reader by the words on its lines, so a row is a recorded judgment, and `no-read` is a site that matches the words only.
 *
 * WHEN THIS GOES RED ON A NEW READER, there are two ways out:
 *   1. Read through `ccd/lib/transcript.jq` instead, which needs no row.
 *   2. The escape: add a row below whose `d` is a D-number defined in `docs/superpowers/plans/`, with a `why` a reader
 *      can argue with. A false match takes the same route with `kind: 'no-read'`. One row, no other edit.
 *
 * WHEN THE BANNER READER'S PORT LANDS, nothing here has to change for the port to pass: `leaving` lets the row match
 * nothing and the count falls by one. Delete the row in that pull request all the same, because a row left behind
 * would let Python back into that function unseen.
 */

type Kind =
  | 'reader'    // parses transcript records and writes none of them
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
  { name: '_transcript_limit_banner', kind: 'reader', d: 'D-8070', leaving: true,
    why: 'dates the newest real row as a limit or auth banner; the one reader here with a port to come' },
  { name: 'ccd-usage-sweep.py', kind: 'reader', d: 'D-8070',
    why: 'sums usage from assistant rows, a standalone sweep that stays in Python' },
  { name: 'lib/carry-dedupe.py', kind: 'reader', d: 'D-8070',
    why: 'parses each row of a carried copy for its uuid, to prove the copy adds nothing to the keeper' },
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
const PYTHON_RUN = /(?:^|[\s|(&;=])(?:[^\s'"]*\/)?python[\d.]*\s+(?:-|\/|"|'|\$)/m;
const TRANSCRIPT_GRAMMAR = /\.jsonl|transcript|isApiErrorMessage|<command-|["'](?:assistant|user|message)["']|\b(?:stop_reason|sessionId|parentUuid|tool_use|tool_result)\b/i;
const PROGRAM_NAMES_TRANSCRIPT = /\.jsonl|transcript/i;
const WRITES_FILE = /os\.(?:replace|rename)\(|open\([^\n]*,\s*["'][wa]/;

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

interface Site { readonly name: string; readonly writes?: boolean }

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
  });

  it('reads a function to its next head, past a column-0 brace in a heredoc', () => {
    const fn = `${tree}\n_new_reader() {\n  python3 - <<'PY'\nd = {\n}\nprint(d["message"])\nPY\n}\n`;
    expect(judgeText(fn).problems.join('\n')).toMatch(/^_new_reader reads/);
  });

  it('leaves alone Python that speaks no transcript grammar, and a comment that only mentions a reader', () => {
    const fn = `${tree}\n_not_a_reader() {\n  python3 -c 'print(1)'\n  # python3 -c reads the transcript\n}\n`;
    expect(judgeText(fn).problems).toEqual([]);
  });

  it('drops the banner reader cleanly: its port needs no edit here, and the count falls by one', () => {
    const before = judgeText(tree);
    expect(before.readers).toContain('_transcript_limit_banner');
    const ported = judgeText(withFunction('_transcript_limit_banner', JQ_BODY));
    expect(ported.problems).toEqual([]);
    expect(ported.readers).toEqual(before.readers.filter((r) => r !== '_transcript_limit_banner'));
    const rowDeleted = judgeText(withFunction('_transcript_limit_banner', JQ_BODY), ROWS.filter((r) => r.name !== '_transcript_limit_banner'));
    expect(rowDeleted).toEqual(ported);
  });

  it('counts a banner port that moves the Python under another name as a new reader', () => {
    const moved = `${withFunction('_transcript_limit_banner', JQ_BODY)}\n_limit_rows() {\n  python3 -c 'print(1)' < "$(_transcript_path "$1")"\n}\n`;
    expect(judgeText(moved).problems.join('\n')).toMatch(/^_limit_rows reads/);
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

// ccd's docs verbs: the bash fronts, the python floor probe and the helper's envelope (spec 2026-10-01 section 2
// (a) Shape, Verbs and Caps; (b) the exit contract, Envelope and One redactor; rows 5, 6 (= M7.8), 45 (ccd half)
// and 62 (helper half)). Every ccd run goes through the real dispatcher in a fixture HOME (`runCcdDocs`); every
// envelope case imports the SHIPPED helper out of ccd/ccd (`unitJson`). No project exists in these HOMEs, so no
// case here reaches a repository. APPEND ONLY: Tasks 7, 8 and 11 add blocks below, each importing under names of
// its own.
import { describe, it, expect, afterAll } from 'vitest';
import path from 'node:path';
import { makeCcdHarness } from './ccdWsHelpers.js';
import { parseOneLine, plantPython3, runCcdDocs } from './ccdDocsHelpers.js';
import { docsProbeCommand, unitJson } from './docsHelperPy.js';
import { redactDocsText } from '../../shared/docs.js';

/** One well-shaped argv per verb shape (spec section 2 (a) Verbs). The values are placeholders. */
const DOCS_T6_SHA = '0123456789abcdef'.repeat(3).slice(0, 40);
const DOCS_T6_FP = '0123456789abcdef'.repeat(4);
const DOCS_T6_SHOW_COMMITTED = ['docs-show', '--project', 'demo', '--commit', DOCS_T6_SHA, '--ref', 'refs/heads/main',
  '--section', 'specs', '--path', 'a.md', '--max-bytes', '2097152'];
const DOCS_T6_SHOW_DRAFT = ['docs-show', '--project', 'demo', '--draft-branch', 'ws/a', '--head', DOCS_T6_SHA,
  '--section', 'specs', '--path', 'a.md', '--fingerprint', DOCS_T6_FP, '--max-bytes', '2097152'];
const DOCS_T6_WELL_SHAPED: readonly (readonly [string, readonly string[]])[] = [
  ['docs-index --all', ['docs-index', '--all']],
  ['docs-tree --project', ['docs-tree', '--project', 'demo']],
  ['docs-tree --project --ref', ['docs-tree', '--project', 'demo', '--ref', 'main']],
  ['docs-show, committed (12 tokens)', DOCS_T6_SHOW_COMMITTED],
  ['docs-show, draft (14 tokens)', DOCS_T6_SHOW_DRAFT],
  ['docs-fetch --project', ['docs-fetch', '--project', 'demo']],
  ['docs-fetch --project --branch', ['docs-fetch', '--project', 'demo', '--branch', 'main']],
];

describe('docs fronts: the exact shape is checked before anything runs (row 5)', () => {
  const h = makeCcdHarness('ccd-docs-');
  afterAll(() => h.cleanup());
  /** `argv` with its last token (always N) replaced. */
  const withN = (argv: readonly string[], n: string): string[] => [...argv.slice(0, -1), n];
  /** `argv` without `flag` and the value after it. */
  const without = (argv: readonly string[], flag: string): string[] => {
    const i = argv.indexOf(flag);
    return [...argv.slice(0, i), ...argv.slice(i + 2)];
  };
  /** `argv` with the flag/value pairs at `i` and `j` exchanged. */
  const swapPairs = (argv: readonly string[], i: number, j: number): string[] => {
    const out = [...argv];
    [out[i], out[i + 1], out[j], out[j + 1]] = [argv[j]!, argv[j + 1]!, argv[i]!, argv[i + 1]!];
    return out;
  };

  it.each([
    ['docs-index with no token', ['docs-index']],
    ['docs-index --all twice', ['docs-index', '--all', '--all']],
    ['docs-index --all with a value after it', ['docs-index', '--all', 'demo']],
    ['docs-index --al', ['docs-index', '--al']],
    ['docs-tree with no token', ['docs-tree']],
    ['docs-tree --project with no value', ['docs-tree', '--project']],
    ['docs-tree with --ref first', ['docs-tree', '--ref', 'main', '--project', 'demo']],
    ['docs-tree --ref with no value', ['docs-tree', '--project', 'demo', '--ref']],
    ['docs-tree with fetch\'s --branch', ['docs-tree', '--project', 'demo', '--branch', 'main']],
    ['docs-tree with an extra token', ['docs-tree', '--project', 'demo', '--ref', 'main', 'x']],
    ['docs-show missing --ref', without(DOCS_T6_SHOW_COMMITTED, '--ref')],
    ['docs-show missing --max-bytes', without(DOCS_T6_SHOW_COMMITTED, '--max-bytes')],
    ['docs-show with --commit and --ref swapped', swapPairs(DOCS_T6_SHOW_COMMITTED, 3, 5)],
    ['docs-show with --section and --path swapped', swapPairs(DOCS_T6_SHOW_COMMITTED, 7, 9)],
    ['docs-show with --head in a committed shape', ['docs-show', '--project', 'demo', '--commit', DOCS_T6_SHA,
      '--head', DOCS_T6_SHA, '--section', 'specs', '--path', 'a.md', '--max-bytes', '1']],
    ['docs-show with an extra token', [...DOCS_T6_SHOW_COMMITTED, 'x']],
    ['docs-show draft missing --fingerprint', without(DOCS_T6_SHOW_DRAFT, '--fingerprint')],
    ['docs-show draft missing --max-bytes', without(DOCS_T6_SHOW_DRAFT, '--max-bytes')],
    ['docs-show draft with --fingerprint after --max-bytes', swapPairs(DOCS_T6_SHOW_DRAFT, 11, 13)],
    ['docs-show --max-bytes 0', withN(DOCS_T6_SHOW_COMMITTED, '0')],
    ['docs-show --max-bytes 012', withN(DOCS_T6_SHOW_COMMITTED, '012')],
    ['docs-show --max-bytes of 9 digits', withN(DOCS_T6_SHOW_COMMITTED, '123456789')],
    ['docs-show --max-bytes -1', withN(DOCS_T6_SHOW_COMMITTED, '-1')],
    ['docs-show --max-bytes 1e3', withN(DOCS_T6_SHOW_COMMITTED, '1e3')],
    ['docs-show --max-bytes with a trailing newline', withN(DOCS_T6_SHOW_COMMITTED, '12\n')],
    ['docs-show --max-bytes in Arabic-Indic digits', withN(DOCS_T6_SHOW_COMMITTED, '\u{0661}\u{0662}')],
    ['docs-show draft --max-bytes 012', withN(DOCS_T6_SHOW_DRAFT, '012')],
    ['docs-show draft --max-bytes of 9 digits', withN(DOCS_T6_SHOW_DRAFT, '123456789')],
    ['docs-fetch with no token', ['docs-fetch']],
    ['docs-fetch --project with no value', ['docs-fetch', '--project']],
    ['docs-fetch with --branch first', ['docs-fetch', '--branch', 'main', '--project', 'demo']],
    ['docs-fetch --branch with no value', ['docs-fetch', '--project', 'demo', '--branch']],
    ['docs-fetch with tree\'s --ref', ['docs-fetch', '--project', 'demo', '--ref', 'main']],
    ['docs-fetch with an extra token', ['docs-fetch', '--project', 'demo', '--branch', 'main', 'x']],
  ])('%s: rc 1, an EMPTY stdout, and the verb\'s usage line on stderr', (_label, args) => {
    const r = runCcdDocs(h, args);
    expect(r.code, r.stderr).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain(`usage: ccd ${args[0]} `);
  });

  it.each([
    ['--max-bytes 1, the smallest N', withN(DOCS_T6_SHOW_COMMITTED, '1')],
    ['--max-bytes 99999999, the largest N', withN(DOCS_T6_SHOW_COMMITTED, '99999999')],
    ['a draft --max-bytes 1', withN(DOCS_T6_SHOW_DRAFT, '1')],
  ])('CONTROL: %s passes the front and answers one line', (_label, args) => {
    const r = runCcdDocs(h, args);
    expect(r.code, r.stderr).toBe(0);
    expect(parseOneLine(r)).toMatchObject({ v: 1, verb: 'docs-show' });
  });
});

describe('docs fronts: the python floor probe (row 6, M7.8)', () => {
  const FIXED = (verb: string, why: string): string =>
    `{"v":1,"verb":"${verb}","ok":false,"elapsedMs":0,"failure":"helper-unavailable","detail":"${why}"}\n`;

  it('the probe is the floor\'s one definition, spelled exactly as spec section 2 (a) gives it', () => {
    expect(docsProbeCommand()).toBe("python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 3)'");
  });

  it.each(DOCS_T6_WELL_SHAPED.map(([label, args]) => [label, args] as const))(
    '%s with no runnable python3 (exit 127) answers rc 0 and exactly the python-missing line', (_label, args) => {
      const h = makeCcdHarness('ccd-docs-');
      try {
        plantPython3(h.home, 'missing');
        const r = runCcdDocs(h, args);
        expect(r.code, r.stderr).toBe(0);
        expect(r.stdout).toBe(FIXED(args[0]!, 'python-missing'));
        expect(parseOneLine(r)['verb']).toBe(args[0]);
      } finally { h.cleanup(); }
    });

  it.each(DOCS_T6_WELL_SHAPED.map(([label, args]) => [label, args] as const))(
    '%s with a python3 whose probe exits 3 answers rc 0 and exactly the python-too-old line', (_label, args) => {
      const h = makeCcdHarness('ccd-docs-');
      try {
        plantPython3(h.home, 'too-old');
        const r = runCcdDocs(h, args);
        expect(r.code, r.stderr).toBe(0);
        expect(r.stdout).toBe(FIXED(args[0]!, 'python-too-old'));
      } finally { h.cleanup(); }
    });

  it('CONTROL: the too-old stub runs every other python3 call for real', () => {
    const h = makeCcdHarness('ccd-docs-');
    try {
      plantPython3(h.home, 'too-old');
      expect(h.sh("python3 -c 'import sys; sys.stdout.write(str(6 * 7))'")).toBe('42');
    } finally { h.cleanup(); }
  });

  it('the shape check runs BEFORE the probe: a malformed argv with no python3 is still a usage error', () => {
    const h = makeCcdHarness('ccd-docs-');
    try {
      plantPython3(h.home, 'missing');
      const r = runCcdDocs(h, ['docs-tree', '--ref', 'main', '--project', 'demo']);
      expect(r.code).toBe(1);
      expect(r.stdout).toBe('');
      expect(r.stderr).toContain('usage: ccd docs-tree ');
    } finally { h.cleanup(); }
  });

  it.each(DOCS_T6_WELL_SHAPED.map(([label, args]) => [label, args] as const))(
    '%s whose helper raises answers rc 0, one line, helper-failed, with the last traceback line redacted', (_label, args) => {
      const h = makeCcdHarness('ccd-docs-');
      try {
        plantPython3(h.home, 'raises');
        const r = runCcdDocs(h, args);
        expect(r.code, r.stderr).toBe(0);
        expect(parseOneLine(r)).toEqual({
          v: 1, verb: args[0], ok: false, elapsedMs: 0, failure: 'helper-failed',
          detail: 'RuntimeError: planted https://***@example.invalid/x',
        });
        expect(r.stdout).not.toContain('tok');
      } finally { h.cleanup(); }
    });
});

describe('docs verbs: advertised, dispatched, and every well-shaped call is one JSON line (rows 6, 45)', () => {
  const h = makeCcdHarness('ccd-docs-');
  afterAll(() => h.cleanup());

  it('ccd caps lists the four verbs and the docs-v1 token', () => {
    const caps = h.sh('cmd_caps').split('\n');
    for (const t of ['docs-index', 'docs-tree', 'docs-show', 'docs-fetch', 'docs-v1']) expect(caps, t).toContain(t);
  });

  it('the dispatcher\'s usage line names the four verbs', () => {
    const r = runCcdDocs(h, ['docs-nope']);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('|pr-state|docs-index|docs-tree|docs-show|docs-fetch|version}');
  });

  it.each(DOCS_T6_WELL_SHAPED.map(([label, args]) => [label, args] as const))(
    '%s answers rc 0 and exactly one parseable line carrying v:1 and its verb', (_label, args) => {
      const r = runCcdDocs(h, args);
      expect(r.code, r.stderr).toBe(0);
      const o = parseOneLine(r);
      expect(o['v']).toBe(1);
      expect(o['verb']).toBe(args[0]);
      expect(typeof o['ok']).toBe('boolean');
      expect(typeof o['elapsedMs']).toBe('number');
      if (o['ok'] === false) expect(typeof o['failure']).toBe('string');
    });
});

describe('the helper envelope: run() and main() (spec section 2 (b); row 62, helper half)', () => {
  const h = makeCcdHarness('ccd-docs-');
  afterAll(() => h.cleanup());
  const ROOTS = [path.join(h.home, 'projects'), path.join(h.home, 'worktrees'), path.join(h.home, '.cc-sessions')];
  /** Shared by the units below. `H.Ctx` and `H.read_args` (Task 7's grammar) are stood in for, so each unit
   *  measures run()'s envelope alone, at this task and after the grammar lands. `ask(verb, body)` swaps
   *  `H.VERBS[verb]` for `body`, runs run(), and reports the raw bytes and the parsed line with its key order. */
  const PRE = [
    'import json',
    'H.Ctx = lambda *a: a',
    'H.read_args = lambda verb, rest: rest',
    `ROOTS = ${JSON.stringify(ROOTS)}`,
    '',
    '',
    'def ask(verb, body, rest=()):',
    '    H.VERBS[verb] = body',
    '    raw = H.run([verb] + ROOTS + list(rest))',
    "    text = raw.decode('utf-8')",
    "    obj = json.loads(text) if text else None",
    "    return {'raw': text, 'newlines': text.count('\\n'), 'obj': obj, 'keys': list(obj) if obj else []}",
    '',
    '',
    'def raiser(exc):',
    '    def body(ctx, a):',
    '        raise exc',
    '    return body',
    '',
    '',
  ].join('\n');
  type Ask = { raw: string; newlines: number; obj: Record<string, unknown> | null; keys: string[] };
  const bytes = (s: unknown): number => Buffer.byteLength(String(s), 'utf8');
  // Token bodies are built at run time, so this public file never carries a contiguous token-shaped literal.
  const BODY24 = 'A1b2'.repeat(6);
  const SHAPES: readonly (readonly [string, string])[] = [
    ['URL userinfo', 'fatal: unable to access https://u:tok@example.invalid/x.git/'],
    ['an access_token query value', 'GET /x?access_token=abc&x=1'],
    ['a gho_ token', `remote: gho_${BODY24} rejected`],
    ['an Authorization line', 'remote: hint\nAuthorization: Basic xyz'],
  ];

  it('a raising verb answers rc 0 helper-failed: the last traceback line, redacted, one line, envelope first', () => {
    const got = unitJson<Ask>(h.home, `${PRE}
out(ask('docs-index', raiser(RuntimeError('https://u:tok@example.invalid/x'))))`);
    expect(got.newlines).toBe(1);
    expect(got.raw.endsWith('\n')).toBe(true);
    expect(got.keys).toEqual(['v', 'verb', 'ok', 'elapsedMs', 'failure', 'detail']);
    expect(got.obj).toMatchObject({ v: 1, verb: 'docs-index', ok: false, failure: 'helper-failed',
      detail: 'RuntimeError: https://***@example.invalid/x' });
    expect(got.raw).not.toContain('tok');
  });

  it('helper-failed\'s detail is redacted BEFORE it is cut to 512 B, and cut on a code point boundary', () => {
    const got = unitJson<{ straddle: Ask; multibyte: Ask }>(h.home, `${PRE}
straddle = 'x' * 450 + ' https://user:' + 's' * 100 + '@example.invalid/ ' + 'y' * 600
out({'straddle': ask('docs-tree', raiser(RuntimeError(straddle))),
     'multibyte': ask('docs-tree', raiser(RuntimeError('x' + '\\u00e9' * 600)))})`);
    const d = String(got.straddle.obj!['detail']);
    expect(bytes(d)).toBe(512);
    expect(d).toContain('https://***@example.invalid/ yyy');
    expect(d).not.toContain('user:');
    expect(got.multibyte.obj!['detail']).toBe(`RuntimeError: x${'\u{00e9}'.repeat(248)}`);
  });

  it('a Fail with no context is exactly the envelope plus its word', () => {
    const got = unitJson<Ask>(h.home, `${PRE}
out(ask('docs-tree', raiser(H.Fail('unknown-project'))))`);
    expect(got.raw).toMatch(/^\{"v":1,"verb":"docs-tree","ok":false,"elapsedMs":\d+,"failure":"unknown-project"\}\n$/);
  });

  it('fail() raises a Fail carrying .word and .ctx; run() writes the context after the word, in its own order', () => {
    const got = unitJson<{ word: string; ctx: Record<string, unknown>; line: Ask }>(h.home, `${PRE}
try:
    H.fail('git-failed', step='ls-tree', rc=128)
except H.Fail as e:
    caught = {'word': e.word, 'ctx': e.ctx}


def body(ctx, a):
    H.fail('git-failed', step='ls-tree', rc=128, stderrHead='fatal: x', detail=None)


out(dict(caught, line=ask('docs-tree', body)))`);
    expect(got.word).toBe('git-failed');
    expect(got.ctx).toEqual({ step: 'ls-tree', rc: 128 });
    expect(got.line.keys).toEqual(['v', 'verb', 'ok', 'elapsedMs', 'failure', 'step', 'rc', 'stderrHead']);
    expect(got.line.obj).toMatchObject({ failure: 'git-failed', step: 'ls-tree', rc: 128, stderrHead: 'fatal: x' });
  });

  it.each(SHAPES.map(([label, s]) => [label, s] as const))(
    'row 62: %s is redacted in detail, in stderrHead and in helper-failed\'s detail, as shared/docs.ts redacts it', (_label, s) => {
      const got = unitJson<{ classified: Ask; failed: Ask }>(h.home, `${PRE}
S = ${JSON.stringify(s)}


def classified(ctx, a):
    H.fail('git-failed', step='fetch', stderrHead=S, detail=S)


out({'classified': ask('docs-fetch', classified), 'failed': ask('docs-fetch', raiser(RuntimeError(S)))})`);
      expect(redactDocsText(s)).not.toBe(s);   // CONTROL: the shape is one the redactor changes
      expect(got.classified.obj!['detail']).toBe(redactDocsText(s));
      expect(got.classified.obj!['stderrHead']).toBe(redactDocsText(s));
      expect(got.failed.obj!['detail']).toBe(redactDocsText(`RuntimeError: ${s}`));
    });

  it('a Fail\'s detail is cut to 2 KiB; a word outside FAILURES or a context key run() owns is helper-failed', () => {
    const got = unitJson<{ long: Ask; server: Ask; owned: Ask }>(h.home, `${PRE}
def long(ctx, a):
    H.fail('git-failed', detail='z' * 5000)


def server(ctx, a):
    H.fail('caps-unknown')


def owned(ctx, a):
    H.fail('git-failed', verb='docs-show')


out({'long': ask('docs-tree', long), 'server': ask('docs-tree', server), 'owned': ask('docs-tree', owned)})`);
    expect(got.long.obj!['detail']).toBe('z'.repeat(2048));
    expect(got.server.obj).toMatchObject({ failure: 'helper-failed' });
    expect(String(got.server.obj!['detail'])).toMatch(/^ValueError: .*caps-unknown/);
    expect(got.owned.obj).toMatchObject({ verb: 'docs-tree', failure: 'helper-failed' });
    expect(String(got.owned.obj!['detail'])).toMatch(/^ValueError: .*verb/);
  });

  it('an ok answer is the envelope, then the body\'s own keys; a body\'s copy of an envelope key is ignored', () => {
    const got = unitJson<Ask>(h.home, `${PRE}
out(ask('docs-fetch', lambda ctx, a: {'v': 9, 'ok': False, 'elapsedMs': -1, 'project': 'demo', 'branch': 'caf\\u00e9'}))`);
    expect(got.keys).toEqual(['v', 'verb', 'ok', 'elapsedMs', 'project', 'branch']);
    expect(got.obj).toMatchObject({ v: 1, verb: 'docs-fetch', ok: true, project: 'demo', branch: 'caf\u{00e9}' });
    expect(got.obj!['elapsedMs']).toBeGreaterThanOrEqual(0);
    // Strict UTF-8 on the wire, written with ensure_ascii=False: the code point itself, never a \\u escape.
    expect(got.raw).toContain('caf\u{00e9}');
    expect(got.raw).not.toContain('\\u00e9');
  });

  it('every ok docs-tree and docs-index answer goes out through guard_listing(obj, line), docs-show through '
    + 'guard_show(line), docs-fetch and every failure through neither', () => {
    const got = unitJson<Record<string, unknown>>(h.home, `${PRE}
seen = []


def listing(obj, line):
    seen.append(('listing', obj['verb'], line == H.line_of(obj), line.endswith(b'\\n')))
    return b'{"guarded":"listing"}'


def show(line):
    seen.append(('show', json.loads(line.decode('utf-8'))['verb'], True, line.endswith(b'\\n')))
    return b'{"guarded":"show"}'


H.guard_listing = listing
H.guard_show = show
answers = {
    'tree': ask('docs-tree', lambda ctx, a: {'entries': []})['raw'],
    'index': ask('docs-index', lambda ctx, a: {'projects': []})['raw'],
    'show': ask('docs-show', lambda ctx, a: {'source': 'committed'})['raw'],
    'fetch': ask('docs-fetch', lambda ctx, a: {'moved': 'unchanged'})['raw'],
    'failure': ask('docs-tree', raiser(H.Fail('unknown-project')))['raw'],
}
out({'answers': answers, 'seen': [list(s) for s in seen]})`);
    expect(got['seen']).toEqual([
      ['listing', 'docs-tree', true, false], ['listing', 'docs-index', true, false], ['show', 'docs-show', true, false],
    ]);
    const answers = got['answers'] as Record<string, string>;
    expect(answers['tree']).toBe('{"guarded":"listing"}\n');
    expect(answers['index']).toBe('{"guarded":"listing"}\n');
    expect(answers['show']).toBe('{"guarded":"show"}\n');
    expect(answers['fetch']).toMatch(/^\{"v":1,"verb":"docs-fetch","ok":true,"elapsedMs":\d+,"moved":"unchanged"\}\n$/);
    expect(answers['failure']).toMatch(/"failure":"unknown-project"\}\n$/);
  });

  it('run() answers b\'\' for an argv naming no docs verb, and helper-failed for one missing its three roots', () => {
    const got = unitJson<{ nope: string; empty: string; short: Ask }>(h.home, `${PRE}
out({'nope': H.run(['docs-nope'] + ROOTS).decode(), 'empty': H.run([]).decode(),
     'short': json.loads(H.run(['docs-index', '--all']).decode())})`);
    expect(got.nope).toBe('');
    expect(got.empty).toBe('');
    expect(got.short).toMatchObject({ verb: 'docs-index', failure: 'helper-failed' });
    expect(String((got.short as unknown as Record<string, unknown>)['detail'])).toMatch(/^RuntimeError: docs argv contract: /);
  });

  it('main() writes once: rc 0 and exactly one line for a docs verb, rc 2 and nothing for anything else', () => {
    const got = unitJson<{ verb: [number, string]; nope: [number, string] }>(h.home, `${PRE}
import subprocess
import sys


def main_of(argv):
    p = subprocess.run([sys.executable, H.__file__] + argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return [p.returncode, p.stdout.decode('utf-8')]


out({'verb': main_of(['docs-fetch'] + ROOTS + ['--project', 'demo']), 'nope': main_of(['docs-nope'] + ROOTS)})`);
    expect(got.verb[0]).toBe(0);
    expect(got.verb[1].endsWith('\n')).toBe(true);
    expect(got.verb[1].indexOf('\n')).toBe(got.verb[1].length - 1);
    expect(JSON.parse(got.verb[1])).toMatchObject({ v: 1, verb: 'docs-fetch' });
    expect(got.nope).toEqual([2, '']);
  });

  it('line_of is compact strict UTF-8 with no newline; framed_len is the length once the line is a JSON string', () => {
    const got = unitJson<{ line: string; framed: number; framedAscii: number; verbs: string[] }>(h.home, `${PRE}
line = H.line_of({'a': 'caf\\u00e9', 'q': '"'})
out({'line': line.decode('utf-8'), 'framed': H.framed_len(line), 'framedAscii': H.framed_len(b'{"a":"x"}'),
     'verbs': sorted(H.VERBS)})`);
    expect(got.line).toBe('{"a":"caf\u{00e9}","q":"\\""}');
    // The agent's own measure of the same line: JSON.stringify of it, in UTF-8 bytes.
    expect(got.framed).toBe(bytes(JSON.stringify(got.line)));
    expect(got.framedAscii).toBe(9 + 2 + 4);
    expect(got.verbs).toEqual(['docs-fetch', 'docs-index', 'docs-show', 'docs-tree']);
  });
});

// ---- Task 7: argv grammar end to end (spec 2026-10-01 section 2 (j) rows 1, 4, 58 and 63) ----
// Every refusal is decided by `read_args` before discovery and before any git call. Until Task 8 nothing in the
// helper calls git at all, so the zero-call assertions below hold trivially today; they are what keeps every later
// task's git runner behind the grammar. The recorder's own CONTROL proves it sees a python-spawned git, so an empty
// `calls()` is a measurement, not a blind spot. Every import is aliased: this block sits below the file's own
// imports and binds no name they, or a later task's block, may bind.
import fsArgv from 'node:fs';
import pathArgv from 'node:path';
import { makeCcdHarness as harnessForArgv } from './ccdWsHelpers.js';
import {
  parseOneLine as oneLineOfArgv, plantGitRecorder as recorderForArgv, runCcdDocs as runArgv,
  runCcdDocsShell as shellForArgv,
} from './ccdDocsHelpers.js';
import { unitJson as unitForArgv } from './docsHelperPy.js';

describe('the PATH git recorder sees the git a python helper spawns (CONTROL for every zero-call row)', () => {
  const h = harnessForArgv('ccd-docs-');

  it('records argv byte-exact and the GIT_*/LC_ALL environment, then runs the real git', () => {
    const rec = recorderForArgv(h.home);
    const r = unitForArgv<{ rc: number; out: string }>(h.home, `
import os, subprocess
p = subprocess.run(['git', '-c', 'docs.probe=a b\\nc', '--version'], stdout=subprocess.PIPE,
                   env=dict(os.environ, LC_ALL='C', GIT_NO_LAZY_FETCH='1'))
out({'rc': p.returncode, 'out': p.stdout.decode()})
`);
    expect(r.rc).toBe(0);
    expect(r.out).toMatch(/^git version /);
    const calls = rec.calls();
    expect(calls.map((c) => c.argv)).toEqual([['-c', 'docs.probe=a b\nc', '--version']]);
    expect(calls[0]!.env).toMatchObject({ LC_ALL: 'C', GIT_NO_LAZY_FETCH: '1' });
    rec.reset();
    expect(rec.calls()).toEqual([]);
  });

  it('failWhen refuses a matching call with rc 128 after recording it; sleepWhen delays one', () => {
    const rec = recorderForArgv(h.home, { failWhen: ['merge-base'], sleepWhen: ['--version'], sleepS: 1 });
    const r = unitForArgv<{ failRc: number; failErr: string; slowRc: number; slowMs: number }>(h.home, `
import subprocess, time
f = subprocess.run(['git', 'merge-base', '--is-ancestor', 'a', 'b'], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
t = time.monotonic()
s = subprocess.run(['git', '--version'], stdout=subprocess.PIPE)
out({'failRc': f.returncode, 'failErr': f.stderr.decode(), 'slowRc': s.returncode,
     'slowMs': (time.monotonic() - t) * 1000})
`);
    expect(r.failRc).toBe(128);
    expect(r.failErr).toContain('git recorder: planted failure');
    expect(r.slowRc).toBe(0);
    expect(r.slowMs).toBeGreaterThanOrEqual(900);
    expect(rec.calls().map((c) => c.argv)).toEqual([['merge-base', '--is-ancestor', 'a', 'b'], ['--version']]);
  });
});

describe('docs argv grammar through the dispatcher: refused before any git call (rows 1, 4, 58, 63)', () => {
  const h = harnessForArgv('ccd-docs-');
  const main = h.makeRepo('demo');
  /** A cwd inside a repository's docs tree (row 4): the answer must not depend on where ccd was started. */
  const docsCwd = pathArgv.join(main, 'docs', 'superpowers');
  fsArgv.mkdirSync(docsCwd, { recursive: true });
  const rec = recorderForArgv(h.home);
  const C40 = '0123456789abcdef'.repeat(3).slice(0, 40);
  const F64 = '0123456789abcdef'.repeat(4);

  type ShowValues = Partial<Record<'project' | 'commit' | 'ref' | 'branch' | 'head' | 'section' | 'path' | 'fp', string>>;
  const committed = (o: ShowValues = {}): string[] => [
    'docs-show', '--project', o.project ?? 'demo', '--commit', o.commit ?? C40, '--ref', o.ref ?? 'refs/heads/main',
    '--section', o.section ?? 'specs', '--path', o.path ?? 'README.md', '--max-bytes', '2097152',
  ];
  const draft = (o: ShowValues = {}): string[] => [
    'docs-show', '--project', o.project ?? 'demo', '--draft-branch', o.branch ?? 'ws/a', '--head', o.head ?? C40,
    '--section', o.section ?? 'specs', '--path', o.path ?? 'README.md', '--fingerprint', o.fp ?? F64,
    '--max-bytes', '2097152',
  ];

  /** The answer without its clock, for comparing two runs of one argv. */
  const timeless = (o: Record<string, unknown>): Record<string, unknown> => {
    const { elapsedMs: _elapsed, ...rest } = o;
    return rest;
  };

  /** One run: rc 0, exactly one JSON line, the envelope naming `word`, and ZERO git calls in the recorder. */
  const refused = (args: string[], word: string, cwd?: string): Record<string, unknown> => {
    rec.reset();
    const r = runArgv(h, args, undefined, cwd);
    expect(r.code, r.stderr).toBe(0);
    const o = oneLineOfArgv(r);
    expect(o).toMatchObject({ v: 1, verb: args[0], ok: false, failure: word });
    expect(typeof o['elapsedMs']).toBe('number');
    expect(rec.calls()).toEqual([]);
    return o;
  };

  it.each(['-x', 'main~1', 'main:docs', 'a..b', 'x.lock/y', 'HEAD', 'refs/tags/v', '\u{00e9}', '@{-1}'])(
    'row 1: docs-tree --ref %j answers bad-ref', (ref) => {
      refused(['docs-tree', '--project', 'demo', '--ref', ref], 'bad-ref');
    });

  it.each(['..', '.git', 'a/b', '-x', 'a'.repeat(101), '-h', '--help'])(
    'rows 1 and 58: docs-tree --project %j answers bad-project', (project) => {
      refused(['docs-tree', '--project', project], 'bad-project');
    });

  it.each([
    ['docs-tree', ['docs-tree', '--project', '--help', '--ref', 'main']],
    ['docs-show (committed)', committed({ project: '--help' })],
    ['docs-show (draft)', draft({ project: '-h' })],
    ['docs-fetch', ['docs-fetch', '--project', '--help']],
    ['docs-fetch --branch', ['docs-fetch', '--project', '-h', '--branch', 'main']],
  ])('row 58: a flag-shaped project in %s is a VALUE, refused as bad-project', (_label, args) => {
    refused(args, 'bad-project');
  });

  it.each([
    ['--commit of 39 hex', committed({ commit: C40.slice(1) }), 'bad-commit'],
    ['--commit in upper case', committed({ commit: C40.toUpperCase() }), 'bad-commit'],
    ['a bare --ref (show takes the served, qualified ref only)', committed({ ref: 'main' }), 'bad-ref'],
    ['--ref refs/remotes/upstream/main', committed({ ref: 'refs/remotes/upstream/main' }), 'bad-ref'],
    ['--section programs', committed({ section: 'programs' }), 'bad-section'],
    ['a qualified --draft-branch (bare only)', draft({ branch: 'refs/heads/ws/a' }), 'bad-ref'],
    ['--head of 39 hex', draft({ head: C40.slice(1) }), 'bad-commit'],
    ['--fingerprint in upper case', draft({ fp: F64.toUpperCase() }), 'bad-fingerprint'],
    ['--fingerprint of 40 hex', draft({ fp: C40 }), 'bad-fingerprint'],
    ['a qualified --branch on fetch (bare only)', ['docs-fetch', '--project', 'demo', '--branch', 'refs/heads/main'], 'bad-ref'],
    ['--branch a..b on fetch', ['docs-fetch', '--project', 'demo', '--branch', 'a..b'], 'bad-ref'],
  ])('row 58: %s answers its word', (_label, args, word) => {
    refused(args, word);
  });

  it.each([
    ['project before commit', committed({ project: '-x', commit: 'abc' }), 'bad-project'],
    ['commit before ref', committed({ commit: 'abc', ref: 'main' }), 'bad-commit'],
    ['ref before section', committed({ ref: 'main', section: 'programs' }), 'bad-ref'],
    ['section before path', committed({ section: 'programs', path: 'a//b' }), 'bad-section'],
    ['draft branch before head', draft({ branch: 'a..b', head: 'abc' }), 'bad-ref'],
    ['path before fingerprint', draft({ path: './a', fp: 'abc' }), 'bad-path'],
    ['project before ref on tree', ['docs-tree', '--project', '..', '--ref', 'a..b'], 'bad-project'],
    ['project before branch on fetch', ['docs-fetch', '--project', '..', '--branch', 'a..b'], 'bad-project'],
  ])('the first refusal in argv order wins: %s', (_label, args, word) => {
    refused(args, word);
  });

  it.each([
    ['../../README.md'], ['a//b'], ['./a'], ['a/'], ['/a'],
    ['a\u{0085}b.md'], ['a\u{202e}b.md'],
  ])('row 4: --path %j answers bad-path, and identically from a docs/superpowers cwd', (p) => {
    const here = refused(committed({ path: p }), 'bad-path');
    const there = refused(committed({ path: p }), 'bad-path', docsCwd);
    expect(timeless(there)).toEqual(timeless(here));
    refused(draft({ path: p }), 'bad-path');
  });

  it('row 4: a --path that is not UTF-8, built inside the contained shell, answers bad-path from either cwd', () => {
    const script = `exec bash "$0" docs-show --project demo --commit ${C40} --ref refs/heads/main --section specs `
      + `--path "$(printf '\\377.md')" --max-bytes 2097152`;
    const answers = [h.home, docsCwd].map((cwd) => {
      rec.reset();
      const r = shellForArgv(h, script, cwd);
      expect(r.code, r.stderr).toBe(0);
      const o = oneLineOfArgv(r);
      expect(o).toMatchObject({ v: 1, verb: 'docs-show', ok: false, failure: 'bad-path' });
      expect(rec.calls()).toEqual([]);
      return timeless(o);
    });
    expect(answers[1]).toEqual(answers[0]);
  });

  it.each([
    ['U+200B, a zero-width twin of a real name', 'READ\u{200b}ME.md'],
    ['U+2028', 'a\u{2028}b.md'],
    ['U+E000', '\u{e000}.md'],
    ['U+0378, unassigned in every Unicode version', '\u{0378}.md'],
    ['U+FE0F, a variation selector', 'a\u{fe0f}.md'],
  ])('row 63: a path holding %s answers bad-path', (_label, p) => {
    refused(committed({ path: p }), 'bad-path');
    refused(draft({ path: p }), 'bad-path');
  });

  it.each([
    ['docs-tree with no --ref', ['docs-tree', '--project', 'demo']],
    ['docs-tree with a bare --ref', ['docs-tree', '--project', 'demo', '--ref', 'ws/a']],
    ['docs-tree with a qualified --ref', ['docs-tree', '--project', 'demo', '--ref', 'refs/remotes/origin/main']],
    ['docs-show committed', committed()],
    ['docs-show draft', draft({ path: 'caf\u{00e9}/\u{6587}.md' })],
    ['docs-show with --path --commit, a VALUE (row 58)', committed({ path: '--commit' })],
    ['docs-show with --path -x, a VALUE (row 58)', committed({ path: '-x' })],
    ['docs-fetch with no --branch', ['docs-fetch', '--project', 'demo']],
    ['docs-fetch with --branch', ['docs-fetch', '--project', 'example-project', '--branch', 'ws/a']],
  ])('CONTROL: well-formed argv passes the grammar: %s answers no bad-* word', (_label, args) => {
    const r = runArgv(h, args);
    expect(r.code, r.stderr).toBe(0);
    const o = oneLineOfArgv(r);
    expect(o).toMatchObject({ v: 1, verb: args[0] });
    expect(String(o['failure'] ?? '')).not.toMatch(/^bad-/);
  });
});

describe('read_args: the fixed-index reader the verbs consume (units)', () => {
  const h = harnessForArgv('ccd-docs-');
  const C40 = '0123456789abcdef'.repeat(3).slice(0, 40);
  const F64 = '0123456789abcdef'.repeat(4);
  type Read = { args: string; fields: Record<string, unknown> } | { refused: string } | { raised: string; msg: string };
  /** `H.read_args` over each case in ONE unit run: a tuple by its class and fields, a refusal by its Fail's
   *  word, any other exception by its class and message. */
  const readAll = (cases: readonly (readonly [string, readonly string[]])[]): Read[] => unitForArgv<Read[]>(h.home, `
import json
def probe(verb, rest):
    try:
        a = H.read_args(verb, rest)
    except H.Fail as e:
        return {'refused': e.word}
    except Exception as e:
        return {'raised': type(e).__name__, 'msg': str(e)}
    return {'args': type(a).__name__, 'fields': dict(a._asdict())}
out([probe(v, r) for v, r in json.loads(${JSON.stringify(JSON.stringify(cases))})])
`);
  const committed = ['--project', 'demo', '--commit', C40, '--ref', 'refs/heads/main', '--section', 'specs',
    '--path', 'caf\u{00e9}/a.md', '--max-bytes', '2097152'];
  const draft = ['--project', 'demo', '--draft-branch', 'ws/a', '--head', C40, '--section', 'plans', '--path', 'b.md',
    '--fingerprint', F64, '--max-bytes', '1'];

  it('the tuples later tasks consume carry exactly these fields, in this order', () => {
    const fields = unitForArgv<Record<string, string[]>>(h.home, `
out({n: list(getattr(H, n)._fields) for n in ['Ctx', 'IndexArgs', 'TreeArgs', 'ShowCommittedArgs', 'ShowDraftArgs', 'FetchArgs']})
`);
    expect(fields).toEqual({
      Ctx: ['verb', 'root', 'worktrees', 'reg', 't0'],
      IndexArgs: [],
      TreeArgs: ['project', 'ref'],
      ShowCommittedArgs: ['project', 'commit', 'ref', 'section', 'path', 'max_bytes'],
      ShowDraftArgs: ['project', 'branch', 'head', 'section', 'path', 'fp', 'max_bytes'],
      FetchArgs: ['project', 'branch'],
    });
  });

  it('reads each well-formed shape into its tuple; --max-bytes becomes an int, an absent option None', () => {
    expect(readAll([
      ['docs-index', ['--all']],
      ['docs-tree', ['--project', 'demo']],
      ['docs-tree', ['--project', 'demo', '--ref', 'refs/remotes/origin/ws/a']],
      ['docs-show', committed],
      ['docs-show', draft],
      ['docs-fetch', ['--project', 'demo']],
      ['docs-fetch', ['--project', 'demo', '--branch', 'ws/a']],
    ])).toEqual([
      { args: 'IndexArgs', fields: {} },
      { args: 'TreeArgs', fields: { project: 'demo', ref: null } },
      { args: 'TreeArgs', fields: { project: 'demo', ref: 'refs/remotes/origin/ws/a' } },
      { args: 'ShowCommittedArgs', fields: { project: 'demo', commit: C40, ref: 'refs/heads/main', section: 'specs',
        path: 'caf\u{00e9}/a.md', max_bytes: 2097152 } },
      { args: 'ShowDraftArgs', fields: { project: 'demo', branch: 'ws/a', head: C40, section: 'plans', path: 'b.md',
        fp: F64, max_bytes: 1 } },
      { args: 'FetchArgs', fields: { project: 'demo', branch: null } },
      { args: 'FetchArgs', fields: { project: 'demo', branch: 'ws/a' } },
    ]);
  });

  it('a value that fails its grammar raises its bad-* Fail; a broken SHAPE is a contract break, never a bad-* word', () => {
    const swap = (rest: readonly string[], i: number, v: string): string[] => rest.map((t, j) => (j === i ? v : t));
    const got = readAll([
      ['docs-tree', ['--project', '-h']],
      ['docs-show', swap(draft, 9, 'a//b')],
      ['docs-fetch', ['--project', 'demo', '--branch', 'HEAD']],
      ['docs-index', []],
      ['docs-index', ['--all', '--all']],
      ['docs-tree', ['--ref', 'main', '--project', 'demo']],
      ['docs-tree', ['--project', 'demo', '--ref']],
      ['docs-show', swap(committed, 11, '012')],
      ['docs-show', swap(committed, 11, '0')],
      ['docs-show', swap(draft, 13, '123456789')],
      ['docs-show', draft.slice(0, 12)],
      ['docs-show', swap(committed, 4, '--section')],
      ['docs-fetch', ['--project', 'demo', '--ref', 'main']],
      ['docs-nope', ['--all']],
    ]);
    expect(got.slice(0, 3)).toEqual([{ refused: 'bad-project' }, { refused: 'bad-path' }, { refused: 'bad-ref' }]);
    for (const [i, r] of got.slice(3).entries()) {
      expect(r, `case ${i + 3}`).toMatchObject({ raised: 'RuntimeError' });
      expect((r as { msg: string }).msg, `case ${i + 3}`).toMatch(/^docs argv contract: /);
    }
  });
});

// ---- Task 8: the hardened git runner and discovery (spec 2026-10-01 section 2 (a), (h)) ----
// Budgets and the hardened runner; section 2 (h) steps 1-6; rows 7, 8, 9, 10, 11 (env half), 57 (discovery
// half) and 62 (stderrHead); R15. Every case imports the SHIPPED helper out of ccd/ccd's heredoc (`unitJson`)
// inside a fixture HOME, and every git it reaches is real unless a case swaps `H.SYS` on purpose. The four verb
// bodies are later tasks' (each replaces its own stub), so the dispatcher half is pinned through `H.run` with
// the docs-tree entry of `H.VERBS` swapped for "discover, then stop": the exact line a verb that calls
// `discover` first answers for every shape discovery refuses.
//
// This block imports under names of its own: an appended block cannot assume the file head's import list, and
// binding one name twice is a SyntaxError.
import * as rdVitest from 'vitest';
import * as rdFs from 'node:fs';
import * as rdPath from 'node:path';
import * as rdCp from 'node:child_process';
import * as rdCrypto from 'node:crypto';
import * as rdWs from './ccdWsHelpers.js';
import * as rdDocs from './ccdDocsHelpers.js';
import * as rdPy from './docsHelperPy.js';

/** A python unit body, dedented so it can follow the unit PRELUDE at column 0. */
const rdUnit = (src: string): string => {
  const lines = src.split('\n');
  while (lines.length > 0 && lines[0]!.trim() === '') lines.shift();
  const pad = Math.min(...lines.filter((l) => l.trim() !== '').map((l) => l.length - l.trimStart().length));
  return lines.map((l) => l.slice(pad)).join('\n');
};
/** A python string literal (ASCII paths and words only, which is all these units use). */
const rdQ = (s: string): string => JSON.stringify(s);
const rdReal = (p: string): string => rdFs.realpathSync(p);
/** process.env with every GIT_* key removed, so a control's plain git is git's own default. */
const rdPlainEnv = (home: string): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))), HOME: home,
});
const rdPlainGit = (home: string, args: string[], extra: NodeJS.ProcessEnv = {}) =>
  rdCp.spawnSync('git', args, { encoding: 'utf8', env: { ...rdPlainEnv(home), ...extra } });
const rdPacks = (repo: string): number =>
  rdFs.readdirSync(rdPath.join(repo, '.git', 'objects', 'pack')).filter((f) => f.endsWith('.pack')).length;
/** The six keys the read runner's env carries, and nothing else under GIT_* or LC_ALL. */
const RD_SIX = ['GIT_CEILING_DIRECTORIES', 'GIT_NO_LAZY_FETCH', 'GIT_NO_REPLACE_OBJECTS', 'GIT_PAGER',
  'GIT_TERMINAL_PROMPT', 'LC_ALL'];

type RdShape = { repo?: Record<string, unknown>; word?: string | null; ctx?: Record<string, unknown> };
/** The python every discovery unit opens with: the context a verb hands `discover`, one helper deadline, and
 *  `shape(p)`, which turns either outcome into data: a Repo's fields, or the failure word with its context. */
const rdCtx = (home: string): string => rdUnit(String.raw`
  ctx = H.Ctx('docs-tree', ${rdQ(rdPath.join(home, 'projects'))}, ${rdQ(rdPath.join(home, 'worktrees'))},
              ${rdQ(rdPath.join(home, '.cc-sessions'))}, H.SYS.monotonic())
  dl = H.Deadline(H.HELPER_DEADLINE_S['docs-tree'])
  def shape(p):
      try:
          return {'repo': dict(H.discover(ctx, p, dl)._asdict())}
      except H.Fail as e:
          return {'word': e.word, 'ctx': e.ctx}
`);
const rdShapes = (home: string, projects: readonly string[], env?: NodeJS.ProcessEnv): RdShape[] =>
  rdPy.unitJson<RdShape[]>(home, `${rdCtx(home)}\nout([shape(p) for p in ${JSON.stringify(projects)}])\n`,
    env === undefined ? undefined : { env });

/** Alive means signalable and not a zombie awaiting its reaper. */
const rdAlive = (pid: number): boolean => {
  try { process.kill(pid, 0); } catch { return false; }
  const st = rdCp.spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim();
  return st !== '' && !st.startsWith('Z');
};
const rdSleepMs = (ms: number): void => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
/** Waits up to 4 s for `pid` to be gone, then reports whether it still is. */
const rdGoneWithin4s = (pid: number): boolean => {
  const until = Date.now() + 4000;
  while (rdAlive(pid) && Date.now() < until) rdSleepMs(100);
  return !rdAlive(pid);
};
/** A stand-in `git` in a directory of its own, which one unit puts first on its PATH. */
const rdFakeGit = (home: string, name: string, script: string): string => {
  const dir = rdPath.join(home, `fake-${name}`);
  rdFs.mkdirSync(dir, { recursive: true });
  rdFs.writeFileSync(rdPath.join(dir, 'git'), `#!/bin/sh\n${script}`, { mode: 0o755 });
  return dir;
};
/** A python block that calls `call` (an expression), and binds `hard` to the failure it raised as data. */
const rdHard = (call: string): string => rdUnit(String.raw`
  try:
      ${call}
      hard = {'word': None}
  except H.Fail as e:
      hard = {'word': e.word, 'ctx': e.ctx}
`);

rdVitest.describe('docs runner: the hardened git runner (spec section 2 (a))', () => {
  let h: rdWs.CcdHarness;
  let rec: ReturnType<typeof rdDocs.plantGitRecorder>;
  let demo = '';
  rdVitest.beforeAll(() => {
    h = rdWs.makeCcdHarness('ccd-docs-');
    demo = rdDocs.docsRepo(h, 'demo');
    rec = rdDocs.plantGitRecorder(h.home);
  });
  rdVitest.afterAll(() => h.cleanup());
  /** `docs_git` in demo with a fresh 12 s deadline; `more` is extra keyword arguments. */
  const call = (args: string, more = ''): string =>
    `H.docs_git(${rdQ(demo)}, ${args}, call_s=5, dl=H.Deadline(12), ceiling=H.ceiling_of(${rdQ(demo)})${more})`;

  rdVitest.it('pins the four budget literals, each on one line, where the budget test will read them', () => {
    const src = rdPy.docsHelperSource();
    rdVitest.expect(rdPy.pyLiteral(src, 'HELPER_DEADLINE_S'))
      .toBe("{'docs-index':12,'docs-tree':12,'docs-show':7,'docs-fetch':45}");
    rdVitest.expect(rdPy.pyLiteral(src, 'CALL_S'))
      .toBe("{'ref':5,'list':8,'count':2,'show':5,'onref':2,'fetch':40,'index':5}");
    rdVitest.expect(rdPy.pyLiteral(src, 'KILL_GRACE_S')).toBe('2');
    rdVitest.expect(rdPy.pyLiteral(src, 'GIT_STDOUT_CAP')).toBe('16777216');
  });

  rdVitest.it('read_env deletes every GIT_* key and sets exactly six; fetch_env keeps only the transport keys', () => {
    const got = rdPy.unitJson<{ read: Record<string, string>; fetch: Record<string, string>; kept: unknown[] }>(
      h.home, rdUnit(String.raw`
        import os
        os.environ.update({
            'GIT_DIR': '/decoy/.git', 'GIT_WORK_TREE': '/decoy', 'GIT_CONFIG_PARAMETERS': "'core.worktree'='/decoy'",
            'GIT_CONFIG_COUNT': '1', 'GIT_CONFIG_KEY_0': 'core.worktree', 'GIT_CONFIG_VALUE_0': '/decoy',
            'GIT_EXEC_PATH': '/decoy', 'GIT_TEST_ASSUME_DIFFERENT_OWNER': '1', 'GIT_NO_LAZY_FETCH': '0',
            'GIT_SSH_COMMAND': 'ssh -o BatchMode=yes', 'GIT_ASKPASS': '/bin/false', 'LC_ALL': 'C.UTF-8',
            'DOCS_UNIT_KEEP': 'kept'})
        pick = lambda e: dict((k, v) for k, v in e.items() if k.startswith('GIT_') or k == 'LC_ALL')
        r, f = H.read_env('/x'), H.fetch_env('/x')
        out({'read': pick(r), 'fetch': pick(f), 'kept': [r.get('DOCS_UNIT_KEEP'), f.get('DOCS_UNIT_KEEP')]})
      `));
    const six = {
      GIT_NO_LAZY_FETCH: '1', GIT_NO_REPLACE_OBJECTS: '1', GIT_CEILING_DIRECTORIES: '/x',
      GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', LC_ALL: 'C',
    };
    rdVitest.expect(got.read).toEqual(six);
    rdVitest.expect(got.fetch).toEqual({ ...six, GIT_SSH_COMMAND: 'ssh -o BatchMode=yes', GIT_ASKPASS: '/bin/false' });
    rdVitest.expect(got.kept).toEqual(['kept', 'kept']);
  });

  rdVitest.it('builds the exact argv prefix, read and fetch, with a caller\'s -c pairs between it and -C', () => {
    const got = rdPy.unitJson<string[][]>(h.home, rdUnit(String.raw`
      out([H.git_argv('/r', ['rev-parse', '--git-dir']),
           H.git_argv('/r', ['-c', 'filter.probe.clean=', 'status']),
           H.git_argv('/r', ['-c', 'gc.auto=0', 'fetch', '--quiet'], True)])
    `));
    const read = ['git', '--no-pager', '--no-optional-locks', '-c', 'core.fsmonitor=false',
      '-c', 'core.hooksPath=/dev/null'];
    rdVitest.expect(got).toEqual([
      [...read, '-C', '/r', 'rev-parse', '--git-dir'],
      [...read, '-c', 'filter.probe.clean=', '-C', '/r', 'status'],
      // Section 2 (g) step 6's own order: hooksPath first, and no --no-optional-locks.
      ['git', '--no-pager', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false',
        '-c', 'gc.auto=0', '-C', '/r', 'fetch', '--quiet'],
    ]);
    // And that argv is what a real call puts on the wire, read off the PATH recorder.
    rec.reset();
    rdVitest.expect(rdPy.unitJson<number>(h.home, `out(${call("['rev-parse', '--git-dir']")}.rc)\n`)).toBe(0);
    const calls = rec.calls();
    rdVitest.expect(calls).toHaveLength(1);
    rdVitest.expect(calls[0]!.argv.join(' ').endsWith(
      `--no-pager --no-optional-locks -c core.fsmonitor=false -c core.hooksPath=/dev/null -C ${demo} rev-parse --git-dir`,
    )).toBe(true);
  });

  rdVitest.it('refuses everything off the allowlist before anything spawns', () => {
    rec.reset();
    const got = rdPy.unitJson<[string, string][]>(h.home, rdUnit(String.raw`
      cases = [['show', 'HEAD'], ['log'], ['diff'], ['archive', 'HEAD'], ['cat-file', '-p', 'HEAD'],
               ['fetch', 'origin'], ['config', 'core.bare', 'true'], ['config', '--get-all', 'x'],
               ['worktree', 'add', 'x'], ['cat-file', 'blob', 'HEAD:README.md'], ['ls-tree', 'HEAD:docs'],
               ['cat-file', '--batch-check', '--textconv'], ['status', '--filters'],
               ['-c', 'core.hooksPath=/tmp/h', 'status'], ['-c', 'CORE.FSMONITOR=x', 'status'],
               ['-C', '/tmp', 'status'], [], ['rev-parse', '--git-dir']]
      seen = []
      for a in cases:
          try:
              H.docs_git(${rdQ(demo)}, a, call_s=5, dl=H.Deadline(12),
                         ceiling=H.ceiling_of(${rdQ(demo)}), soft=True)
              seen.append([' '.join(a), 'ran'])
          except H.GitRefused:
              seen.append([' '.join(a), 'refused'])
      out(seen)
    `));
    // The last row is the CONTROL: an allowlisted call runs, so the refusals above are the allowlist's, not
    // those of a runner that refuses everything.
    rdVitest.expect(got).toHaveLength(18);
    rdVitest.expect(got.filter(([, v]) => v === 'ran').map(([a]) => a)).toEqual(['rev-parse --git-dir']);
    rdVitest.expect(rec.calls()).toHaveLength(1);
  });

  rdVitest.it('killpg: an expired call stops its whole process group, grandchild included', () => {
    const fake = rdFakeGit(h.home, 'sleeper', 'sleep 30 &\necho $! > "$HOME/grandchild.pid"\nwait\n');
    const got = rdPy.unitJson<{ timedOut: boolean; overflow: boolean; tookS: number }>(h.home, rdUnit(String.raw`
      import os
      os.environ['PATH'] = ${rdQ(fake)} + ':' + os.environ['PATH']
      t = H.SYS.monotonic()
      r = H.docs_git(${rdQ(demo)}, ['rev-parse', '--git-dir'], call_s=1, dl=H.Deadline(12),
                     ceiling=H.ceiling_of(${rdQ(demo)}), soft=True)
      out({'timedOut': r.timed_out, 'overflow': r.overflow, 'tookS': H.SYS.monotonic() - t})
    `), { timeoutMs: 30_000 });
    rdVitest.expect(got).toMatchObject({ timedOut: true, overflow: false });
    rdVitest.expect(got.tookS).toBeLessThan(4);
    const pid = Number(rdFs.readFileSync(rdPath.join(h.home, 'grandchild.pid'), 'utf8').trim());
    rdVitest.expect(pid).toBeGreaterThan(1);
    rdVitest.expect(rdGoneWithin4s(pid), `grandchild ${pid} outlived its group`).toBe(true);
  }, 30_000);

  rdVitest.it('a group that ignores SIGTERM gets SIGKILL once the 2 s grace has passed, and no sooner', () => {
    // `trap '' TERM` is inherited by the background sleep, so SIGTERM stops neither; only the group SIGKILL
    // KILL_GRACE_S later does. Without it the unit would wait out the whole sleep.
    const fake = rdFakeGit(h.home, 'stubborn',
      "trap '' TERM\nsleep 30 &\necho $! > \"$HOME/stubborn.pid\"\nwait\n");
    const got = rdPy.unitJson<{ timedOut: boolean; tookS: number }>(h.home, rdUnit(String.raw`
      import os
      os.environ['PATH'] = ${rdQ(fake)} + ':' + os.environ['PATH']
      t = H.SYS.monotonic()
      r = H.docs_git(${rdQ(demo)}, ['rev-parse', '--git-dir'], call_s=1, dl=H.Deadline(12),
                     ceiling=H.ceiling_of(${rdQ(demo)}), soft=True)
      out({'timedOut': r.timed_out, 'tookS': H.SYS.monotonic() - t})
    `), { timeoutMs: 30_000 });
    rdVitest.expect(got.timedOut).toBe(true);
    // 1 s of call, then the whole grace: SIGTERM first, SIGKILL 2 s later, never at once.
    rdVitest.expect(got.tookS).toBeGreaterThanOrEqual(2.5);
    rdVitest.expect(got.tookS).toBeLessThan(10);
    const pid = Number(rdFs.readFileSync(rdPath.join(h.home, 'stubborn.pid'), 'utf8').trim());
    rdVitest.expect(rdGoneWithin4s(pid), `grandchild ${pid} survived the group SIGKILL`).toBe(true);
  }, 30_000);

  rdVitest.it('a hard (non-soft) expiry answers git-timeout naming the step', () => {
    const fake = rdFakeGit(h.home, 'hang', 'exec sleep 30\n');
    const got = rdPy.unitJson<RdShape>(h.home, rdUnit(String.raw`
      import os
      os.environ['PATH'] = ${rdQ(fake)} + ':' + os.environ['PATH']
    `) + rdHard(`H.docs_git(${rdQ(demo)}, ['rev-parse', '--git-dir'], call_s=1, dl=H.Deadline(12), `
      + `ceiling=H.ceiling_of(${rdQ(demo)}))`) + 'out(hard)\n', { timeoutMs: 30_000 });
    rdVitest.expect(got).toEqual({ word: 'git-timeout', ctx: { step: 'rev-parse' } });
  }, 30_000);

  rdVitest.it('a spent helper deadline spawns nothing: soft, it reads as timed out; hard, it is git-timeout', () => {
    rec.reset();
    const got = rdPy.unitJson<{ soft: unknown[]; hard: RdShape }>(h.home, rdUnit(String.raw`
      r = H.docs_git(${rdQ(demo)}, ['rev-parse', '--git-dir'], call_s=5, dl=H.Deadline(0),
                     ceiling=H.ceiling_of(${rdQ(demo)}), soft=True)
    `) + rdHard(`H.docs_git(${rdQ(demo)}, ['rev-parse', '--git-dir'], call_s=5, dl=H.Deadline(0), `
      + `ceiling=H.ceiling_of(${rdQ(demo)}))`) + "out({'soft': [r.rc, r.timed_out, r.overflow], 'hard': hard})\n");
    rdVitest.expect(got).toEqual({ soft: [null, true, false], hard: { word: 'git-timeout', ctx: { step: 'rev-parse' } } });
    rdVitest.expect(rec.calls()).toEqual([]);
  });

  rdVitest.it('stdout past stdout_cap is overflow; a hard call answers too-many-entries', () => {
    const fake = rdFakeGit(h.home, 'flood', 'dd if=/dev/zero bs=8192 count=1 2>/dev/null\n');
    const got = rdPy.unitJson<{ soft: unknown[]; hard: RdShape }>(h.home, rdUnit(String.raw`
      import os
      os.environ['PATH'] = ${rdQ(fake)} + ':' + os.environ['PATH']
      r = ${call("['rev-parse']", ', soft=True, stdout_cap=1024')}
    `) + rdHard(call("['rev-parse']", ', stdout_cap=1024'))
      + "out({'soft': [r.overflow, r.timed_out, len(r.out)], 'hard': hard})\n");
    rdVitest.expect(got).toEqual({ soft: [true, false, 1024], hard: { word: 'too-many-entries', ctx: { bytes: 1024 } } });
  });

  rdVitest.it('stdin reaches git: cat-file --batch-check answers the line it was fed', () => {
    const head = h.git(demo, 'rev-parse', 'HEAD');
    const got = rdPy.unitJson<[number, string]>(h.home,
      `r = ${call("['cat-file', '--batch-check']", `, stdin=(${rdQ(head)} + '\\n').encode()`)}\n`
      + 'out([r.rc, r.out.decode()])\n');
    rdVitest.expect(got[0]).toBe(0);
    rdVitest.expect(got[1]).toMatch(new RegExp(`^${head} commit [0-9]+\\n$`));
  });
});

rdVitest.describe('docs discovery: every repository shape of spec section 2 (h), on real git', () => {
  let h: rdWs.CcdHarness;
  let rec: ReturnType<typeof rdDocs.plantGitRecorder>;
  let P = '';
  let demo = '';
  let decoy = '';
  let oldBlob = '';
  rdVitest.beforeAll(() => {
    h = rdWs.makeCcdHarness('ccd-docs-');
    P = rdPath.join(h.home, 'projects');
    demo = rdDocs.docsRepo(h, 'demo', { 'docs/superpowers/specs/a.md': '# A\n' });
    rdDocs.commitDocs(h, demo, { 'docs/superpowers/specs/a.md': '# A, second\n' }, 'docs: second');
    h.git(demo, 'push', '-q', 'origin', 'main');
    // A blob no longer at HEAD: a blob:none clone holds every HEAD blob after its checkout, and none older.
    oldBlob = h.git(demo, 'rev-parse', 'HEAD~1:docs/superpowers/specs/a.md');
    rdFs.mkdirSync(rdPath.join(P, 'nongit'));
    rdFs.writeFileSync(rdPath.join(P, 'afile'), 'not a directory\n');
    h.git(h.home, 'init', '-q', '--bare', rdPath.join(P, 'bare', '.git'));
    // A repository whose worktree git places somewhere else.
    h.git(h.home, 'init', '-q', '-b', 'main', rdPath.join(P, 'tw'));
    rdFs.mkdirSync(rdPath.join(h.home, 'elsewhere'));
    h.git(rdPath.join(P, 'tw'), 'config', 'core.worktree', rdPath.join(h.home, 'elsewhere'));
    h.git(demo, 'worktree', 'add', '-q', '-b', 'ws/a', rdPath.join(P, 'wt'));
    h.git(demo, 'worktree', 'add', '-q', '--detach', rdPath.join(P, 'wd'));
    h.makeRepo('a');
    rdFs.mkdirSync(rdPath.join(P, 'b'));
    rdFs.symlinkSync(rdPath.join(P, 'a', '.git'), rdPath.join(P, 'b', '.git'));
    rdFs.mkdirSync(rdPath.join(P, 'c'));
    rdFs.writeFileSync(rdPath.join(P, 'c', '.git'), `gitdir: ${rdPath.join(P, 'a', '.git')}\n`);
    // A --separate-git-dir main checkout whose git dir no project under the root owns.
    rdFs.mkdirSync(rdPath.join(h.home, 'seps'));
    h.git(h.home, 'init', '-q', '-b', 'main', `--separate-git-dir=${rdPath.join(h.home, 'seps', 'sep.git')}`,
      rdPath.join(P, 'sep'));
    rdFs.writeFileSync(rdPath.join(P, 'sep', 'README.md'), 'hi\n');
    h.git(rdPath.join(P, 'sep'), 'add', 'README.md');
    h.git(rdPath.join(P, 'sep'), 'commit', '-q', '-m', 'init');
    // A repository outside the root that a SYMLINKED entry (z) names: not an owner discovery could open.
    const outside = rdPath.join(h.home, 'outside');
    h.git(h.home, 'init', '-q', '-b', 'main', outside);
    rdFs.writeFileSync(rdPath.join(outside, 'README.md'), 'hi\n');
    h.git(outside, 'add', 'README.md');
    h.git(outside, 'commit', '-q', '-m', 'init');
    rdFs.symlinkSync(outside, rdPath.join(P, 'z'));
    rdFs.mkdirSync(rdPath.join(P, 'y'));
    rdFs.symlinkSync(rdPath.join(outside, '.git'), rdPath.join(P, 'y', '.git'));
    const origin = rdPath.join(h.home, 'origins', 'demo.git');
    h.git(origin, 'config', 'uploadpack.allowFilter', 'true');
    h.git(h.home, 'clone', '-q', '--filter=blob:none', `file://${origin}`, rdPath.join(P, 'part'));
    h.makeGhRepo('gh', 'example-org/example-repo');
    decoy = rdPath.join(h.home, 'decoy');
    h.git(h.home, 'init', '-q', '-b', 'main', decoy);
    rec = rdDocs.plantGitRecorder(h.home);
  }, 60_000);
  rdVitest.afterAll(() => h.cleanup());

  rdVitest.it('unknown-project names ccd\'s root: an absent name, a file, and a symlink to a repository', () => {
    rdVitest.expect(rdShapes(h.home, ['nope', 'afile', 'z'])).toEqual([
      { word: 'unknown-project', ctx: { root: P } },
      { word: 'unknown-project', ctx: { root: P } },
      { word: 'unknown-project', ctx: { root: P } },
    ]);
  });

  rdVitest.it('a directory with no .git is not-a-git-repo, and no git runs at all', () => {
    rec.reset();
    rdVitest.expect(rdShapes(h.home, ['nongit'])).toEqual([{ word: 'not-a-git-repo', ctx: {} }]);
    rdVitest.expect(rec.calls()).toEqual([]);
  });

  rdVitest.it('a bare repository is not-a-git-repo {detail:bare}, though rev-parse exits 128 at --show-toplevel', () => {
    // CONTROL: the measured shape the option order exists for. git prints is-bare, then fails.
    const plain = rdPlainGit(h.home, ['-C', rdPath.join(P, 'bare'), 'rev-parse', '--is-bare-repository', '--show-toplevel']);
    rdVitest.expect([plain.status, plain.stdout]).toEqual([128, 'true\n']);
    rdVitest.expect(rdShapes(h.home, ['bare'])).toEqual([{ word: 'not-a-git-repo', ctx: { detail: 'bare' } }]);
  });

  rdVitest.it('row 7, toplevel half: a worktree git places elsewhere is not-a-git-repo {detail:toplevel-mismatch}', () => {
    // CONTROL: plain git would serve this project from the other directory.
    const plain = rdPlainGit(h.home, ['-C', rdPath.join(P, 'tw'), 'rev-parse', '--show-toplevel']);
    rdVitest.expect(plain.stdout.trim()).toBe(rdReal(rdPath.join(h.home, 'elsewhere')));
    rdVitest.expect(rdShapes(h.home, ['tw'])).toEqual([{ word: 'not-a-git-repo', ctx: { detail: 'toplevel-mismatch' } }]);
  });

  rdVitest.it('row 8: a .git-file worktree under projects/ is linked-worktree {owner, branch}; detached is branch null', () => {
    rdVitest.expect(rdShapes(h.home, ['wt', 'wd'])).toEqual([
      { word: 'linked-worktree', ctx: { owner: 'demo', branch: 'ws/a' } },
      { word: 'linked-worktree', ctx: { owner: 'demo', branch: null } },
    ]);
  });

  rdVitest.it('row 57: b/.git as a symlink to a/.git, and c/.git as a gitdir: file, are shared-repo {owner:a}', () => {
    // CONTROL: plain git reads a's object store under b's and c's names.
    for (const p of ['b', 'c']) {
      const plain = rdPlainGit(h.home, ['-C', rdPath.join(P, p), 'rev-parse', '--absolute-git-dir', '--show-toplevel']);
      rdVitest.expect(plain.stdout.trim().split('\n')).toEqual([rdReal(rdPath.join(P, 'a', '.git')), rdReal(rdPath.join(P, p))]);
    }
    rdVitest.expect(rdShapes(h.home, ['b', 'c'])).toEqual([
      { word: 'shared-repo', ctx: { owner: 'a', branch: 'main' } },
      { word: 'shared-repo', ctx: { owner: 'a', branch: 'main' } },
    ]);
  });

  rdVitest.it('row 57: a --separate-git-dir main checkout with no owner under the root is accepted', () => {
    const [s] = rdShapes(h.home, ['sep']);
    rdVitest.expect(s!.repo).toMatchObject({
      project: 'sep', git_dir: rdReal(rdPath.join(h.home, 'seps', 'sep.git')),
      common_dir: rdReal(rdPath.join(h.home, 'seps', 'sep.git')), toplevel: rdReal(rdPath.join(P, 'sep')), bare: false,
    });
  });

  rdVitest.it('row 57: an owner is a project discovery could open, so a symlinked entry is never one', () => {
    // CONTROL: by real path alone, z/.git IS y's git dir; only the "Q is a real directory" rule turns it away.
    rdVitest.expect(rdReal(rdPath.join(P, 'z', '.git'))).toBe(rdReal(rdPath.join(P, 'y', '.git')));
    const [s] = rdShapes(h.home, ['y']);
    rdVitest.expect(s!.word).toBeUndefined();
    rdVitest.expect(s!.repo).toMatchObject({ project: 'y', git_dir: rdReal(rdPath.join(h.home, 'outside', '.git')) });
  });

  rdVitest.it('a plain project discovers to the Repo every later read starts from', () => {
    const common = rdReal(rdPath.join(demo, '.git'));
    rdVitest.expect(rdShapes(h.home, ['demo'])).toEqual([{ repo: {
      project: 'demo', path: rdPath.join(P, 'demo'), git_dir: common, common_dir: common, toplevel: rdReal(demo),
      bare: false, shallow: false, object_format: 'sha1',
      key: rdCrypto.createHash('sha256').update(common).digest('hex').slice(0, 32),
    } }]);
  });

  rdVitest.it('row 9: a blob:none partial clone is partial-clone, and discovery fetches nothing', () => {
    const part = rdPath.join(P, 'part');
    const before = rdPacks(part);
    rdVitest.expect(rdShapes(h.home, ['part'])).toEqual([{ word: 'partial-clone', ctx: {} }]);
    rdVitest.expect(rdPacks(part)).toBe(before);
  });

  rdVitest.it('row 10: every call carries GIT_NO_LAZY_FETCH=1, and exactly the six read keys', () => {
    rec.reset();
    rdShapes(h.home, ['demo', 'tw', 'bare', 'wt', 'wd', 'b', 'c', 'sep', 'y', 'part', 'gh']);
    const calls = rec.calls();
    rdVitest.expect(calls.length).toBeGreaterThanOrEqual(11);
    for (const c of calls) {
      rdVitest.expect(Object.keys(c.env).sort(), c.argv.join(' ')).toEqual(RD_SIX);
      rdVitest.expect(c.env['GIT_NO_LAZY_FETCH']).toBe('1');
      rdVitest.expect(c.env['GIT_CEILING_DIRECTORIES']).toBe(rdReal(P));
    }
  });

  rdVitest.it('row 11, env half: GIT_DIR and GIT_CONFIG_PARAMETERS in the helper\'s env change nothing', () => {
    const hostile = { GIT_DIR: rdPath.join(decoy, '.git'), GIT_CONFIG_PARAMETERS: `'core.worktree'='${decoy}'` };
    // CONTROL: the same env sends plain git to the decoy.
    const plain = rdPlainGit(h.home, ['-C', demo, 'rev-parse', '--absolute-git-dir'], hostile);
    rdVitest.expect(plain.stdout.trim()).toBe(rdReal(rdPath.join(decoy, '.git')));
    rec.reset();
    const [s] = rdShapes(h.home, ['demo'], hostile);
    rdVitest.expect(s!.repo).toMatchObject({ git_dir: rdReal(rdPath.join(demo, '.git')), toplevel: rdReal(demo) });
    const calls = rec.calls();
    rdVitest.expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      rdVitest.expect(c.env).not.toHaveProperty('GIT_DIR');
      rdVitest.expect(c.env).not.toHaveProperty('GIT_CONFIG_PARAMETERS');
    }
  });

  rdVitest.it('R15 + row 62: dubious ownership (canned) is repo-unreadable, its stderrHead redacted', () => {
    const got = rdPy.unitJson<RdShape>(h.home, `${rdCtx(h.home)}\n${rdUnit(String.raw`
      CANNED = (b"fatal: detected dubious ownership in repository at 'https://u:tok@example.invalid/x'\n"
                b"hint: ?access_token=sekrit-one&x=1\n"
                b"hint: token gho_" + b"A" * 30 + b"\n"
                b"Authorization: Bearer sekrit-two\n")
      class Canned(H.Sys):
          def spawn(self, argv, env, cwd, timeout_s, stdout_cap, stdin=None):
              if 'rev-parse' in argv:
                  return H.Spawned(128, b'', CANNED, False, False)
              return H.Sys.spawn(self, argv, env, cwd, timeout_s, stdout_cap, stdin)
      H.SYS = Canned()
      out(shape('demo'))
    `)}`);
    rdVitest.expect(got.word).toBe('repo-unreadable');
    const head = String(got.ctx!['stderrHead']);
    rdVitest.expect(head).toContain('detected dubious ownership');
    rdVitest.expect(head).toContain('://***@');
    rdVitest.expect(head).not.toMatch(/tok@|sekrit|A{20}|Bearer/);
  });

  rdVitest.it('row 62: stderr_head redacts BEFORE it cuts to 512 bytes (a cut token would slip the pattern)', () => {
    const got = rdPy.unitJson<{ head: string; long: number; cutFirst: string }>(h.home, rdUnit(String.raw`
      raw = b'x' * 500 + b' gho_' + b'A' * 30
      out({'head': H.stderr_head(raw), 'long': len(H.stderr_head(b'y' * 2000).encode()),
           'cutFirst': H.redact(raw[:512].decode())})
    `));
    rdVitest.expect(got.head.startsWith(`${'x'.repeat(500)} gho_`)).toBe(true);
    rdVitest.expect(got.head).not.toContain('A');
    rdVitest.expect(got.long).toBe(512);
    // CONTROL: the other order leaks the token's head, which is why the order is pinned.
    rdVitest.expect(got.cutFirst).toContain('AAAAAAA');
  });

  rdVitest.it('origin_url reads remote.origin.url through the runner; github_of names only a GitHub origin', () => {
    const got = rdPy.unitJson<unknown[]>(h.home, `${rdCtx(h.home)}\n${rdUnit(String.raw`
      rows = []
      for p in ['gh', 'demo', 'sep']:
          u = H.origin_url(H.discover(ctx, p, dl), dl)
          rows.append([p, u, H.github_of(u)])
      out(rows)
    `)}`);
    rdVitest.expect(got).toEqual([
      ['gh', 'https://github.com/example-org/example-repo', { state: 'named', slug: 'example-org/example-repo' }],
      ['demo', rdPath.join(h.home, 'origins', 'demo.git'), { state: 'none' }],
      ['sep', null, { state: 'none' }],
    ]);
  });

  // LAST in this describe: its control lazily fetches the old blob into part/.
  rdVitest.it('row 10: a missing object read through docs_git fetches nothing; plain git fetches it', () => {
    const part = rdPath.join(P, 'part');
    const before = rdPacks(part);
    const got = rdPy.unitJson<[number | null, string]>(h.home, rdUnit(String.raw`
      r = H.docs_git(${rdQ(part)}, ['cat-file', '--batch-check'], call_s=5, dl=H.Deadline(12),
                     ceiling=H.ceiling_of(${rdQ(part)}), stdin=(${rdQ(oldBlob)} + '\n').encode(), soft=True)
      out([r.rc, r.out.decode()])
    `));
    // The two answers git gives a lazy fetch it may not make, and nothing else: git 2.43 exits 128 with an empty
    // stdout; git 2.55 (CI's runner image) prints `<oid> missing` with rc 0. The helper's show path reads both:
    // show_object_type's `words == [oid, 'missing']` is None, and its rc != 0 raises git-failed; read_committed's
    // `cat-file blob` re-asks batch-check on rc 128. What decides this row is the pack count below, either way.
    rdVitest.expect([[128, ''], [0, `${oldBlob} missing\n`]]).toContainEqual(got);
    rdVitest.expect(rdPacks(part)).toBe(before);
    // CONTROL: without GIT_NO_LAZY_FETCH the same read reaches origin and writes a pack.
    const plain = rdCp.spawnSync('git', ['-C', part, 'cat-file', '--batch-check'],
      { encoding: 'utf8', input: `${oldBlob}\n`, env: rdPlainEnv(h.home) });
    rdVitest.expect(plain.stdout).toMatch(new RegExp(`^${oldBlob} blob [0-9]+\\n$`));
    rdVitest.expect(rdPacks(part)).toBe(before + 1);
  });
});

rdVitest.describe('docs discovery: row 7, a projects root that is itself a git repository', () => {
  let h: rdWs.CcdHarness;
  let rec: ReturnType<typeof rdDocs.plantGitRecorder>;
  let P = '';
  rdVitest.beforeAll(() => {
    h = rdWs.makeCcdHarness('ccd-docs-');
    P = rdPath.join(h.home, 'projects');
    h.git(h.home, 'init', '-q', '-b', 'main', P);
    rdFs.mkdirSync(rdPath.join(P, 'nongit'));
    // A .git that is not a repository: git skips it and walks UP, unless the ceiling stops it.
    rdFs.mkdirSync(rdPath.join(P, 'hollow', '.git'), { recursive: true });
    rec = rdDocs.plantGitRecorder(h.home);
  });
  rdVitest.afterAll(() => h.cleanup());

  rdVitest.it('projects/nongit is not-a-git-repo with zero git calls, where plain git answers the root', () => {
    const plain = rdPlainGit(h.home, ['-C', rdPath.join(P, 'nongit'), 'rev-parse', '--show-toplevel']);
    rdVitest.expect(plain.stdout.trim()).toBe(rdReal(P));
    rec.reset();
    rdVitest.expect(rdShapes(h.home, ['nongit'])).toEqual([{ word: 'not-a-git-repo', ctx: {} }]);
    rdVitest.expect(rec.calls()).toEqual([]);
  });

  rdVitest.it('projects/hollow is repo-unreadable: the ceiling stops git walking up into the root', () => {
    // CONTROL, both halves: plain git serves the ROOT's repository as hollow; the same call under the ceiling
    // the runner sets finds nothing.
    const plain = rdPlainGit(h.home, ['-C', rdPath.join(P, 'hollow'), 'rev-parse', '--show-toplevel']);
    rdVitest.expect(plain.stdout.trim()).toBe(rdReal(P));
    const ceiled = rdPlainGit(h.home, ['-C', rdPath.join(P, 'hollow'), 'rev-parse', '--show-toplevel'],
      { GIT_CEILING_DIRECTORIES: rdReal(P) });
    rdVitest.expect(ceiled.status).toBe(128);
    const [s] = rdShapes(h.home, ['hollow']);
    rdVitest.expect(s!.word).toBe('repo-unreadable');
    rdVitest.expect(String(s!.ctx!['stderrHead'])).toContain('not a git repository');
  });
});

rdVitest.describe('docs discovery through run(): the line a verb that discovers first answers', () => {
  let h: rdWs.CcdHarness;
  let rec: ReturnType<typeof rdDocs.plantGitRecorder>;
  let P = '';
  rdVitest.beforeAll(() => {
    h = rdWs.makeCcdHarness('ccd-docs-');
    P = rdPath.join(h.home, 'projects');
    const demo = rdDocs.docsRepo(h, 'demo');
    rdFs.mkdirSync(rdPath.join(P, 'nongit'));
    h.git(h.home, 'init', '-q', '--bare', rdPath.join(P, 'bare', '.git'));
    h.git(demo, 'worktree', 'add', '-q', '-b', 'ws/a', rdPath.join(P, 'wt'));
    h.makeRepo('a');
    rdFs.mkdirSync(rdPath.join(P, 'b'));
    rdFs.symlinkSync(rdPath.join(P, 'a', '.git'), rdPath.join(P, 'b', '.git'));
    const origin = rdPath.join(h.home, 'origins', 'demo.git');
    h.git(origin, 'config', 'uploadpack.allowFilter', 'true');
    h.git(h.home, 'clone', '-q', '--filter=blob:none', `file://${origin}`, rdPath.join(P, 'part'));
    rec = rdDocs.plantGitRecorder(h.home);
  }, 60_000);
  rdVitest.afterAll(() => h.cleanup());

  /** `H.run` over a docs-tree argv per project, as `main()` would answer it, with the docs-tree entry of
   *  `H.VERBS` swapped for "discover, then stop". `setup` runs first (python, column 0). Each line comes back
   *  parsed, its `elapsedMs` checked to be a number and then dropped. */
  const lines = (projects: readonly string[], setup = ''): Record<string, unknown>[] => {
    const got = rdPy.unitJson<Record<string, unknown>[]>(h.home, `${setup}\n${rdUnit(String.raw`
      import json
      def tree_after_discovery(ctx, a):
          H.discover(ctx, a.project, H.Deadline(H.HELPER_DEADLINE_S[ctx.verb]))
          raise NotImplementedError('discovery-passed')
      H.VERBS['docs-tree'] = tree_after_discovery
      rows = []
      for p in ${JSON.stringify(projects)}:
          line = H.run(['docs-tree', ${rdQ(P)}, ${rdQ(rdPath.join(h.home, 'worktrees'))},
                        ${rdQ(rdPath.join(h.home, '.cc-sessions'))}, '--project', p])
          rows.append(json.loads(line.decode('utf-8')))
      out(rows)
    `)}`);
    return got.map((o) => {
      rdVitest.expect(typeof o['elapsedMs']).toBe('number');
      const { elapsedMs: _e, ...rest } = o;
      return rest;
    });
  };
  const head = { v: 1, verb: 'docs-tree', ok: false };

  rdVitest.it('each refused shape is its own word on the wire, its context spread beside it', () => {
    rdVitest.expect(lines(['nope', 'bare', 'wt', 'b', 'part'])).toEqual([
      { ...head, failure: 'unknown-project', root: P },
      { ...head, failure: 'not-a-git-repo', detail: 'bare' },
      { ...head, failure: 'linked-worktree', owner: 'demo', branch: 'ws/a' },
      { ...head, failure: 'shared-repo', owner: 'a', branch: 'main' },
      { ...head, failure: 'partial-clone' },
    ]);
  });

  rdVitest.it('a directory with no .git answers not-a-git-repo before any git call', () => {
    rec.reset();
    rdVitest.expect(lines(['nongit'])).toEqual([{ ...head, failure: 'not-a-git-repo' }]);
    rdVitest.expect(rec.calls()).toEqual([]);
  });

  rdVitest.it('a project discovery accepts runs on to the verb body, here a stop that answers helper-failed', () => {
    rec.reset();
    const [o] = lines(['demo']);
    rdVitest.expect(o).toMatchObject({ ...head, failure: 'helper-failed' });
    rdVitest.expect(String(o!['detail'])).toContain('discovery-passed');
    rdVitest.expect(rec.calls().length).toBeGreaterThanOrEqual(2);
  });

  rdVitest.it('row 62 on the wire: a canned dubious-ownership stderr reaches the line redacted', () => {
    const [o] = lines(['demo'], rdUnit(String.raw`
      class Canned(H.Sys):
          def spawn(self, argv, env, cwd, timeout_s, stdout_cap, stdin=None):
              return H.Spawned(128, b'', b"fatal: detected dubious ownership at 'https://u:tok@example.invalid/x'\n", False, False)
      H.SYS = Canned()
    `));
    rdVitest.expect(o).toMatchObject({ ...head, failure: 'repo-unreadable' });
    rdVitest.expect(String(o!['stderrHead'])).toContain('dubious ownership');
    rdVitest.expect(String(o!['stderrHead'])).not.toContain('tok@');
  });
});

// ---- Task 8 fix round 1 (review finding F1, CV1; ruling G8): one case per guard Task 8 added ----
// Each case swaps `H.SYS` for a subclass (the R15 canned case's way), or puts a PATH git stub first, so a branch
// no real fixture reaches is reached on purpose. Each is measured red with its guard deleted, in a scratch copy;
// Task 19's table carries the rows as R8-1..R8-8.
rdVitest.describe('docs discovery and runner: the fail-closed guards no fixture reaches (R8-1..R8-8)', () => {
  let h: rdWs.CcdHarness;
  let demo = '';
  rdVitest.beforeAll(() => {
    h = rdWs.makeCcdHarness('ccd-docs-');
    demo = rdDocs.docsRepo(h, 'demo');
    h.git(demo, 'worktree', 'add', '-q', '-b', 'ws/a', rdPath.join(h.home, 'projects', 'wt'));
  });
  rdVitest.afterAll(() => h.cleanup());

  rdVitest.it('R8-1: find_owner\'s listdir failing is repo-unreadable naming listdir, never "no owner"', () => {
    const got = rdPy.unitJson<RdShape>(h.home, `${rdCtx(h.home)}\n${rdUnit(String.raw`
      import errno
      class NoList(H.Sys):
          def listdir(self, path):
              raise OSError(errno.EACCES, 'Permission denied')
      H.SYS = NoList()
      out(shape('wt'))
    `)}`);
    rdVitest.expect(got.word).toBe('repo-unreadable');
    rdVitest.expect(String(got.ctx!['stderrHead'])).toContain('listdir');
  });

  rdVitest.it('R8-2 and R8-3: discover\'s lstat of P, and of P/.git, failing past ENOENT/ENOTDIR is repo-unreadable', () => {
    const got = rdPy.unitJson<RdShape[]>(h.home, `${rdCtx(h.home)}\n${rdUnit(String.raw`
      import errno
      rows = []
      for bad in [ctx.root + '/demo', ctx.root + '/demo/.git']:
          class NoLstat(H.Sys):
              def lstat(self, path, dir_fd=None, bad=bad):
                  if path == bad:
                      raise OSError(errno.EACCES, 'Permission denied')
                  return H.Sys.lstat(self, path, dir_fd)
          H.SYS = NoLstat()
          rows.append(shape('demo'))
      out(rows)
    `)}`);
    for (const s of got) {
      rdVitest.expect(s.word).toBe('repo-unreadable');
      rdVitest.expect(String(s.ctx!['stderrHead'])).toContain('lstat');
    }
  });

  rdVitest.it('R8-4: rev-parse at rc 0 with the wrong shape is git-failed {step: rev-parse, rc: 0}', () => {
    const got = rdPy.unitJson<RdShape>(h.home, `${rdCtx(h.home)}\n${rdUnit(String.raw`
      class Short(H.Sys):
          def spawn(self, argv, env, cwd, timeout_s, stdout_cap, stdin=None):
              if 'rev-parse' in argv:
                  return H.Spawned(0, b'/a/.git\n/a/.git\nfalse\nfalse\nsha1\n', b'', False, False)
              return H.Sys.spawn(self, argv, env, cwd, timeout_s, stdout_cap, stdin)
      H.SYS = Short()
      out(shape('demo'))
    `)}`);
    rdVitest.expect(got.word).toBe('git-failed');
    rdVitest.expect(got.ctx).toMatchObject({ step: 'rev-parse', rc: 0 });
  });

  rdVitest.it('R8-5: the partial-clone probe at rc 3 (not 0, not 1) is repo-unreadable', () => {
    const got = rdPy.unitJson<RdShape>(h.home, `${rdCtx(h.home)}\n${rdUnit(String.raw`
      class Probe3(H.Sys):
          def spawn(self, argv, env, cwd, timeout_s, stdout_cap, stdin=None):
              if '--get-regexp' in argv:
                  return H.Spawned(3, b'', b'error: cannot read config', False, False)
              return H.Sys.spawn(self, argv, env, cwd, timeout_s, stdout_cap, stdin)
      H.SYS = Probe3()
      out(shape('demo'))
    `)}`);
    rdVitest.expect(got.word).toBe('repo-unreadable');
    rdVitest.expect(String(got.ctx!['stderrHead'])).toContain('cannot read config');
  });

  rdVitest.it('R8-6: a linked worktree whose symbolic-ref prints a non-UTF-8 branch answers branch null', () => {
    const got = rdPy.unitJson<RdShape[]>(h.home, `${rdCtx(h.home)}\n${rdUnit(String.raw`
      rows = [shape('wt')]
      class BadRef(H.Sys):
          def spawn(self, argv, env, cwd, timeout_s, stdout_cap, stdin=None):
              if 'symbolic-ref' in argv:
                  return H.Spawned(0, b'refs/heads/\xff\n', b'', False, False)
              return H.Sys.spawn(self, argv, env, cwd, timeout_s, stdout_cap, stdin)
      H.SYS = BadRef()
      rows.append(shape('wt'))
      out(rows)
    `)}`);
    // CONTROL: the real symbolic-ref names the branch, so the null below is the guard's doing.
    rdVitest.expect(got[0]).toEqual({ word: 'linked-worktree', ctx: { owner: 'demo', branch: 'ws/a' } });
    rdVitest.expect(got[1]).toEqual({ word: 'linked-worktree', ctx: { owner: 'demo', branch: null } });
  });

  rdVitest.it('R8-7: origin_url at rc 3 (not 0, not 1) is git-failed {step: config}', () => {
    const got = rdPy.unitJson<RdShape>(h.home, `${rdCtx(h.home)}\n${rdUnit(String.raw`
      repo = H.discover(ctx, 'demo', dl)
      class Cfg3(H.Sys):
          def spawn(self, argv, env, cwd, timeout_s, stdout_cap, stdin=None):
              if '--get' in argv:
                  return H.Spawned(3, b'', b'error: bad config', False, False)
              return H.Sys.spawn(self, argv, env, cwd, timeout_s, stdout_cap, stdin)
      H.SYS = Cfg3()
      try:
          H.origin_url(repo, dl)
          out({'word': None})
      except H.Fail as e:
          out({'word': e.word, 'ctx': e.ctx})
    `)}`);
    rdVitest.expect(got.word).toBe('git-failed');
    rdVitest.expect(got.ctx).toMatchObject({ step: 'config', rc: 3 });
  });

  rdVitest.it('R8-8 (CV1): a hard fetch expiry is fetch-timeout with no step; the same call, soft, returns timed out', () => {
    const fake = rdFakeGit(h.home, 'hangfetch', 'exec sleep 30\n');
    const got = rdPy.unitJson<{ hard: RdShape; soft: unknown[] }>(h.home, rdUnit(String.raw`
      import os
      os.environ['PATH'] = ${rdQ(fake)} + ':' + os.environ['PATH']
      r = H.docs_git(${rdQ(demo)}, ['fetch', '--quiet'], call_s=1, dl=H.Deadline(12),
                     ceiling=H.ceiling_of(${rdQ(demo)}), fetch=True, soft=True)
    `) + rdHard(`H.docs_git(${rdQ(demo)}, ['fetch', '--quiet'], call_s=1, dl=H.Deadline(12), `
      + `ceiling=H.ceiling_of(${rdQ(demo)}), fetch=True)`) + "out({'soft': [r.timed_out], 'hard': hard})\n",
      { timeoutMs: 60_000 });
    rdVitest.expect(got.soft).toEqual([true]);
    rdVitest.expect(got.hard).toEqual({ word: 'fetch-timeout', ctx: {} });
  }, 60_000);
});

// ---------------------------------------------------------------------------------------------------------------
// Task 11: docs-index and its stamps (spec 2026-10-01 §2 (h) "docs-index (Q3)", §2 (g) step 4, §3.11, §7.2
// "Fixtures"; §2 rows 16 (index), 43 (reader half), 57 (duplicates), 58 (unlisted); M6.8 (index)).
//
// Every import in this block is a NAMESPACE import (or an aliased type) with a `t11` prefix: the block is appended
// below the blocks of earlier tasks, and a named import here could redeclare a binding one of them already
// imports. Each describe builds its own fixture HOME in a hook, so a describe that `-t` filters out creates none.
import * as t11v from 'vitest';
import * as t11fs from 'node:fs';
import * as t11path from 'node:path';
import * as t11crypto from 'node:crypto';
import * as t11cp from 'node:child_process';
import * as t11ws from './ccdWsHelpers.js';
import * as t11dh from './ccdDocsHelpers.js';
import * as t11py from './docsHelperPy.js';
import * as t11fx from './docsIndexFixtures.js';
import type { DocsFetchFailure as T11FetchFailure } from '../../shared/docs.js';

type T11Row = Record<string, unknown> & { project: string; state: string };

/** The real verb, through the dispatcher, contained (`runCcdDocs`); rc 0 and exactly one line are asserted. */
const t11index = (h: t11ws.CcdHarness): Record<string, unknown> => {
  const r = t11dh.runCcdDocs(h, ['docs-index', '--all']);
  t11v.expect(r.code, r.stderr).toBe(0);
  return t11dh.parseOneLine(r);
};
const t11rows = (o: Record<string, unknown>): T11Row[] => {
  t11v.expect(Array.isArray(o['projects']), `not an index answer: ${JSON.stringify(o)}`).toBe(true);
  return o['projects'] as T11Row[];
};
const t11row = (o: Record<string, unknown>, project: string): T11Row => {
  const hits = t11rows(o).filter((r) => r.project === project);
  t11v.expect(hits, `exactly one row for ${project}`).toHaveLength(1);
  return hits[0]!;
};
/** A POSIX single-quoted shell word. */
const t11shq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
/** Python lines binding `ctx` to ccd's three roots in the unit's HOME, as `run` builds it for docs-index. */
const T11_CTX = [
  'import os',
  "home = os.environ['HOME']",
  "ctx = H.Ctx('docs-index', os.path.join(home, 'projects'), os.path.join(home, 'worktrees'), os.path.join(home, '.cc-sessions'), 0)",
];
/** What discovery itself answers for `projects/<p>`: its Fail's word, owner and branch, or word null for a Repo. */
const t11discover = (h: t11ws.CcdHarness, p: string): { word: string | null; owner?: unknown; branch?: unknown } =>
  t11py.unitJson(h.home, [
    ...T11_CTX,
    'try:',
    `    H.discover(ctx, ${JSON.stringify(p)}, H.Deadline(12))`,
    "    out({'word': None})",
    'except H.Fail as f:',
    "    out({'word': f.word, 'owner': f.ctx.get('owner'), 'branch': f.ctx.get('branch')})",
  ].join('\n'));
/** What docs-tree's own listing (`list_committed`, at the default chain's commit) counts per section: its count
 *  where the section is present, and null where it is absent or not a directory. */
const t11treeCounts = (h: t11ws.CcdHarness, p: string): Record<string, number | null> =>
  t11py.unitJson(h.home, [
    ...T11_CTX,
    'dl = H.Deadline(12)',
    `repo = H.discover(ctx, ${JSON.stringify(p)}, dl)`,
    'commit = H.default_chain(repo, dl)[1]',
    "out(dict((s['slug'], s['count'] if s['state'] == 'present' else None) for s in H.list_committed(repo, commit, dl)[0]))",
  ].join('\n'));

t11v.describe('T11: docs stamps - stamp_path, read_stamp, stamp_ages (spec §2 (g) step 4; row 43 reader half)', () => {
  let h: t11ws.CcdHarness;
  let dir = '';
  t11v.beforeAll(() => {
    h = t11ws.makeCcdHarness('ccd-docs-');
    dir = t11path.join(h.home, 'stamps');
    t11fs.mkdirSync(dir, { recursive: true });
  });
  t11v.afterAll(() => h.cleanup());
  const SHA = 'a'.repeat(40);
  const GOOD = { v: 1, branch: 'main', attemptMs: 4000, lastOutcome: 'ok', okMs: 1000, okCommit: SHA };
  const plant = (name: string, body: string | Buffer): string => {
    const p = t11path.join(dir, name);
    t11fs.writeFileSync(p, body);
    return p;
  };
  const read = (p: string): unknown => t11py.unitJson<unknown>(h.home, `out(H.read_stamp(${JSON.stringify(p)}))`);

  t11v.it('stamp_path is $REG/docs/fetch/<repo key>/<sha256(branch)[:32]>.json', () => {
    const key = '0123456789abcdef'.repeat(2);
    const leaf = t11crypto.createHash('sha256').update('ws/a').digest('hex').slice(0, 32);
    t11v.expect(t11py.unitJson<string>(h.home, `out(H.stamp_path('/r', '${key}', 'ws/a'))`))
      .toBe(t11path.join('/r', 'docs', 'fetch', key, `${leaf}.json`));
  });

  t11v.it('reads a well-formed stamp back as the object it holds (CONTROL for every None below)', () => {
    t11v.expect(read(plant('good.json', JSON.stringify(GOOD)))).toEqual(GOOD);
  });

  t11v.it.each([
    ['v:2', JSON.stringify({ ...GOOD, v: 2 })],
    ['v:true (a bool is not the integer 1)', JSON.stringify({ ...GOOD, v: true })],
    ['a missing branch', JSON.stringify({ ...GOOD, branch: undefined })],
    ['a string attemptMs', JSON.stringify({ ...GOOD, attemptMs: '4000' })],
    ['a negative attemptMs', JSON.stringify({ ...GOOD, attemptMs: -1 })],
    ['okMs:true', JSON.stringify({ ...GOOD, okMs: true })],
    ['a word no fetch attempt records (fetch-too-soon)', JSON.stringify({ ...GOOD, lastOutcome: 'fetch-too-soon' })],
    ['an unhashable lastOutcome, which must not raise', JSON.stringify({ ...GOOD, lastOutcome: [] })],
    ['a short okCommit', JSON.stringify({ ...GOOD, okCommit: 'abc1234' })],
    ['an array', JSON.stringify([GOOD])],
    ['truncated JSON', '{"v":1'],
    ['bytes that are not UTF-8', Buffer.from([0xff, 0xfe, 0x7b])],
    ['nesting deep enough to exhaust an older python recursion limit', `${'['.repeat(2048)}${']'.repeat(2048)}`],
    ['a path where nothing exists', null],
  ] as const)('answers None for %s', (label, body) => {
    const p = t11path.join(dir, `case-${label.replace(/[^A-Za-z0-9]+/g, '-')}.json`);
    if (body !== null) t11fs.writeFileSync(p, body);
    t11v.expect(read(p)).toBeNull();
  });

  /** read_stamp(p) under a Sys that records every open, after `setup` (python lines) has run. */
  const readRecordingOpens = (p: string, setup: string[]): { stamp: unknown; opened: string[] } =>
    t11py.unitJson<{ stamp: unknown; opened: string[] }>(h.home, [
      'import os',
      ...setup,
      'opened = []',
      'class RecordsOpens(type(H.SYS)):',
      '    def open(self, path, flags, *args, **kwargs):',
      '        opened.append(path)',
      '        return super().open(path, flags, *args, **kwargs)',
      'H.SYS = RecordsOpens()',
      `out({'stamp': H.read_stamp(${JSON.stringify(p)}), 'opened': opened})`,
    ].join('\n'), { timeoutMs: 5000 });

  t11v.it('reads a stamp of exactly 4096 bytes and refuses one of 4097 by its lstat size, before any open', () => {
    const body = JSON.stringify(GOOD);
    const atCap = plant('at-cap.json', body.padEnd(4096, ' '));
    const overCap = plant('over-cap.json', body.padEnd(4097, ' '));
    t11v.expect(readRecordingOpens(atCap, [])).toEqual({ stamp: GOOD, opened: [atCap] });
    t11v.expect(readRecordingOpens(overCap, [])).toEqual({ stamp: null, opened: [] });
  });

  t11v.it('a FIFO at the path is None, refused by lstat before any open', () => {
    const p = t11path.join(dir, 'fifo.json');
    t11v.expect(readRecordingOpens(p, [`os.mkfifo(${JSON.stringify(p)})`])).toEqual({ stamp: null, opened: [] });
  });

  t11v.it('a symlink to a well-formed stamp is None, refused by lstat before any open; the target reads (CONTROL)', () => {
    const target = plant('target.json', JSON.stringify(GOOD));
    const link = t11path.join(dir, 'link.json');
    t11fs.symlinkSync(target, link);
    t11v.expect(readRecordingOpens(link, [])).toEqual({ stamp: null, opened: [] });
    t11v.expect(readRecordingOpens(target, [])).toEqual({ stamp: GOOD, opened: [target] });
  });

  // The swaps a fixture cannot time: a Sys whose lstat reports a small regular file for EVERY path, so the open
  // and the descriptor's own fstat are the only guards left standing.
  const liesRegular = (small: string): string[] => [
    'class LiesRegular(type(H.SYS)):',
    '    def lstat(self, path, *args, **kwargs):',
    `        return os.stat(${JSON.stringify(small)})`,
    'H.SYS = LiesRegular()',
  ];

  t11v.it('a FIFO swapped in after lstat is opened non-blocking and answers None without waiting for a writer', () => {
    // Without O_NONBLOCK the open waits for a writer forever; the unit's own 5 s bound turns that into a red.
    const small = plant('small.json', JSON.stringify(GOOD));
    const p = t11path.join(dir, 'swapped-fifo.json');
    t11v.expect(t11py.unitJson<unknown>(h.home, ['import os', `os.mkfifo(${JSON.stringify(p)})`, ...liesRegular(small),
      `out(H.read_stamp(${JSON.stringify(p)}))`].join('\n'), { timeoutMs: 5000 })).toBeNull();
  });

  t11v.it('a stamp that grew past 4096 bytes after lstat is refused by the read bound, not truncated into a parse', () => {
    // The first 4097 bytes of this file are a complete, well-formed stamp followed by blanks, so a reader that
    // parsed whatever its bounded read returned, instead of refusing the 4097th byte, would answer the stamp.
    const small = plant('small3.json', JSON.stringify(GOOD));
    const p = plant('grown.json', JSON.stringify(GOOD).padEnd(5000, ' '));
    t11v.expect(t11py.unitJson<unknown>(h.home, ['import os', ...liesRegular(small),
      `out(H.read_stamp(${JSON.stringify(p)}))`].join('\n'), { timeoutMs: 5000 })).toBeNull();
  });

  t11v.it('a symlink swapped in after lstat is never followed (O_NOFOLLOW), though its target is a good stamp', () => {
    const small = plant('small2.json', JSON.stringify(GOOD));
    const target = plant('swap-target.json', JSON.stringify(GOOD));
    const p = t11path.join(dir, 'swapped-link.json');
    t11fs.symlinkSync(target, p);
    t11v.expect(t11py.unitJson<unknown>(h.home, ['import os', ...liesRegular(small),
      `out(H.read_stamp(${JSON.stringify(p)}))`].join('\n'), { timeoutMs: 5000 })).toBeNull();
  });

  t11v.it('a descriptor that fstat says is not a regular file is refused, though its bytes are a good stamp', () => {
    // The open's own fstat is the last word on what was opened; a Sys whose fstat reports a FIFO for the
    // descriptor stands in for any swap the lstat could not see.
    const p = plant('fstat-fifo.json', JSON.stringify(GOOD));
    t11v.expect(t11py.unitJson<unknown>(h.home, [
      'import os, stat',
      'class FstatSaysFifo(type(H.SYS)):',
      '    def fstat(self, fd):',
      '        st = os.fstat(fd)',
      '        return os.stat_result((stat.S_IFIFO | 0o600,) + tuple(st)[1:])',
      'H.SYS = FstatSaysFifo()',
      `out(H.read_stamp(${JSON.stringify(p)}))`,
    ].join('\n'), { timeoutMs: 5000 })).toBeNull();
  });

  t11v.it('a decoder that runs out of recursion answers None, never a raise that would end the whole answer', () => {
    // Deterministic on every python: before 3.12 the C decoder raises this near depth 1000, which 4096 bytes
    // of brackets reach; 3.12 does not, so the bracket case above alone cannot go red there.
    const p = plant('recursion.json', JSON.stringify(GOOD));
    t11v.expect(t11py.unitJson<unknown>(h.home, [
      'class DeepDecoder(object):',
      '    @staticmethod',
      '    def loads(s):',
      "        raise RecursionError('maximum recursion depth exceeded while decoding a JSON array')",
      'H.json = DeepDecoder',
      `out(H.read_stamp(${JSON.stringify(p)}))`,
    ].join('\n'))).toBeNull();
  });

  t11v.it('stamp_ages: ages on the fleet clock, a null okAgeMs before any success, never a negative age', () => {
    const none = { ...GOOD, okMs: null, okCommit: null, lastOutcome: 'fetch-timeout' };
    const py = (o: unknown): string => `json.loads(${JSON.stringify(JSON.stringify(o))})`;
    t11v.expect(t11py.unitJson<unknown>(h.home,
      `import json\nout([H.stamp_ages(${py(GOOD)}, 10000), H.stamp_ages(${py(none)}, 10000), H.stamp_ages(${py(GOOD)}, 2000), H.stamp_ages(${py(GOOD)}, 500)])`))
      .toEqual([
        { okAgeMs: 9000, attemptAgeMs: 6000, lastOutcome: 'ok', okCommit: SHA },
        { okAgeMs: null, attemptAgeMs: 6000, lastOutcome: 'fetch-timeout', okCommit: null },
        { okAgeMs: 1000, attemptAgeMs: 0, lastOutcome: 'ok', okCommit: SHA },
        // The clock stepped back past okMs too: okAgeMs is the only age docs-index puts on the wire (R11-3).
        { okAgeMs: 0, attemptAgeMs: 0, lastOutcome: 'ok', okCommit: SHA },
      ]);
  });

  // F3 (b): an I/O error on a stamp that is well-formed on disk is "no stamp", never a raise that ends the whole
  // index (R11-4). CONTROL: the same stamp through the unswapped Sys reads back.
  t11v.it.each(['read', 'fstat'] as const)('an OSError(EIO) from %s on a well-formed stamp answers None, never a raise', (call) => {
    const p = plant(`eio-${call}.json`, JSON.stringify(GOOD));
    t11v.expect(read(p)).toEqual(GOOD);
    t11v.expect(t11py.unitJson<unknown>(h.home, [
      'import errno',
      'class Eio(type(H.SYS)):',
      `    def ${call}(self, *a):`,
      "        raise OSError(errno.EIO, 'Input/output error')",
      'H.SYS = Eio()',
      `out(H.read_stamp(${JSON.stringify(p)}))`,
    ].join('\n'))).toBeNull();
  });

  t11v.it("STAMP_OUTCOMES is 'ok' plus exactly the DocsFetchFailure words, each one a ccd failure word", () => {
    // A Record over the L0 type: a word added to or dropped from DocsFetchFailure is a compile error here
    // until this list follows it, and the python set is then compared with the list.
    const FETCH_WORDS: Record<T11FetchFailure, true> = {
      'fetch-timeout': true, 'remote-branch-absent': true, 'fetch-rejected-objects': true, 'fetch-auth-failed': true,
      'ref-locked': true, 'fetch-transport': true, 'fetch-failed': true,
    };
    const got = t11py.unitJson<{ outcomes: string[]; outside: string[] }>(h.home,
      "out({'outcomes': sorted(H.STAMP_OUTCOMES), 'outside': sorted(w for w in H.STAMP_OUTCOMES if w != 'ok' and w not in H.FAILURES)})");
    t11v.expect(got.outcomes).toEqual(['ok', ...Object.keys(FETCH_WORDS)].sort());
    t11v.expect(got.outside).toEqual([]);
  });
});

t11v.describe('T11: docs-index guard - M6.8, the listing bound is on FRAMED bytes', () => {
  let h: t11ws.CcdHarness;
  t11v.beforeAll(() => { h = t11ws.makeCcdHarness('ccd-docs-'); });
  t11v.afterAll(() => h.cleanup());

  t11v.it('an index whose raw line fits 1 MiB but whose framed line does not answers too-many-entries', () => {
    const got = t11py.unitJson<{ raw: number; framed: number; guarded: Record<string, unknown>; smallPasses: boolean }>(h.home, [
      'import json',
      'def index_of(n):',
      `    rows = [{'project': '"' * 1000, 'state': 'ready', 'github': {'state': 'none'}} for _ in range(n)]`,
      "    return {'v': 1, 'verb': 'docs-index', 'ok': True, 'elapsedMs': 1, 'unlisted': 0, 'duplicates': [], 'projects': rows}",
      'big = index_of(400)',
      'line = H.line_of(big)',
      'small = index_of(10)',
      'sline = H.line_of(small)',
      "out({'raw': len(line), 'framed': H.framed_len(line), 'guarded': json.loads(H.guard_listing(big, line).decode('utf-8')), 'smallPasses': H.guard_listing(small, sline) == sline})",
    ].join('\n'));
    // CONTROL: the raw line alone would have been admitted, and 400 rows are far from the entry cap.
    t11v.expect(got.raw).toBeLessThan(1048576);
    t11v.expect(got.framed).toBeGreaterThan(1048576);
    t11v.expect(got.guarded).toMatchObject({ v: 1, verb: 'docs-index', ok: false, failure: 'too-many-entries', count: 400 });
    t11v.expect(got.guarded['bytes']).toBeGreaterThan(1048576);
    // CONTROL: the guard passes an index that fits, unchanged.
    t11v.expect(got.smallPasses).toBe(true);
  });
});

t11v.describe('T11: docs-index fixtures - the canned lines are what the real verb emits (spec §7.2)', () => {
  let h: t11ws.CcdHarness;
  t11v.beforeEach(() => { h = t11ws.makeCcdHarness('ccd-docs-'); });
  t11v.afterEach(() => h.cleanup());

  t11v.it.each(['ready', 'unreadable'] as const)('normalise(docs-index on plantIndexHome(h, %s)) deep-equals its canned object', (which) => {
    t11fx.plantIndexHome(h, which);
    t11v.expect(t11fx.normaliseDocsIndex(t11index(h)))
      .toEqual(which === 'ready' ? t11fx.DOCS_INDEX_READY : t11fx.DOCS_INDEX_UNREADABLE);
  });

  t11v.it('DOCS_HELPER_UNAVAILABLE_MISSING_LINE is byte for byte what the real front prints with python3 missing', () => {
    t11dh.plantPython3(h.home, 'missing');
    const r = t11dh.runCcdDocs(h, ['docs-index', '--all']);
    t11v.expect(r.code).toBe(0);
    t11v.expect(r.stdout).toBe(`${t11fx.DOCS_HELPER_UNAVAILABLE_MISSING_LINE}\n`);
  });

  t11v.it("indexStampPath is the helper's own stamp_path over discovery's repoKey", () => {
    h.makeRepo('demo');
    t11v.expect(t11py.unitJson<string>(h.home, [
      ...T11_CTX,
      "repo = H.discover(ctx, 'demo', H.Deadline(12))",
      "out(H.stamp_path(ctx.reg, repo.key, 'ws/a'))",
    ].join('\n'))).toBe(t11fx.indexStampPath(h, 'demo', 'ws/a'));
  });

  t11v.it('normaliseDocsIndex zeroes exactly elapsedMs, repoKeys, 40- and 64-hex strings and numeric ages', () => {
    const k = 'f'.repeat(32);
    t11v.expect(t11fx.normaliseDocsIndex({
      v: 1, elapsedMs: 7, unlisted: 3, duplicates: [{ repoKey: k, projects: ['a', 'b'] }],
      projects: [
        { project: 'demo', repoKey: k, default: { name: 'main', via: 'default:origin-head', commit: 'e'.repeat(64) },
          fetch: { okAgeMs: 812, lastOutcome: 'ok' } },
        { project: 'x', note: 'a'.repeat(39), fetch: { okAgeMs: null, lastOutcome: 'fetch-timeout' } },
      ],
    })).toEqual({
      v: 1, elapsedMs: 0, unlisted: 3, duplicates: [{ repoKey: '0'.repeat(32), projects: ['a', 'b'] }],
      projects: [
        { project: 'demo', repoKey: '0'.repeat(32), default: { name: 'main', via: 'default:origin-head', commit: '0'.repeat(40) },
          fetch: { okAgeMs: 0, lastOutcome: 'ok' } },
        { project: 'x', note: 'a'.repeat(39), fetch: { okAgeMs: null, lastOutcome: 'fetch-timeout' } },
      ],
    });
  });

  t11v.it('docsIndexStubScript prints its line verbatim with shell builtins only, and refuses a line it cannot quote', () => {
    const line = JSON.stringify(t11fx.DOCS_INDEX_READY);
    const p = t11path.join(h.home, 'ccd-stub');
    t11fs.writeFileSync(p, t11fx.docsIndexStubScript(line), { mode: 0o755 });
    // An empty PATH: printf must be the shell's own builtin.
    t11v.expect(t11cp.execFileSync('/bin/sh', [p, 'docs-index', '--all'], { encoding: 'utf8', env: { PATH: '' } }))
      .toBe(`${line}\n`);
    t11v.expect(() => t11fx.docsIndexStubScript("it's")).toThrow();
    t11v.expect(() => t11fx.docsIndexStubScript('two\nlines')).toThrow();
  });
});

t11v.describe('T11: docs-index, one HOME of every repository shape (spec §2 (h); rows 16 and 57)', () => {
  let h: t11ws.CcdHarness;
  let ans: Record<string, unknown> = {};
  let indexCalls: t11dh.RecordedGitCall[] = [];
  let demoCommit = '';
  let aCommit = '';

  t11v.beforeAll(() => {
    h = t11ws.makeCcdHarness('ccd-docs-');
    const at = (name: string): string => t11path.join(h.home, 'projects', name);
    const demo = h.makeGhRepo('demo', 'example-org/example-repo');
    demoCommit = t11dh.commitDocs(h, demo, { ...t11fx.INDEX_READY_DOCS });
    h.git(demo, 'push', '-q', 'origin', 'main');
    // a: specs holds ONLY a name the listing refuses (17 components deep), so it counts 0, not null; plans holds
    // one listable name; and conventions is committed as a SYMLINK, so nothing is under it at the commit.
    const a = h.makeRepo('a');
    for (const rel of [`docs/superpowers/specs/${'d/'.repeat(16)}deep.md`, 'docs/superpowers/plans/ok.md']) {
      t11fs.mkdirSync(t11path.dirname(t11path.join(a, rel)), { recursive: true });
      t11fs.writeFileSync(t11path.join(a, rel), '# a\n');
    }
    t11fs.symlinkSync('../README.md', t11path.join(a, 'docs', 'conventions'));
    h.git(a, 'add', '-A');
    h.git(a, 'commit', '-q', '-m', 'docs');
    h.git(a, 'push', '-q', 'origin', 'main');
    aCommit = h.git(a, 'rev-parse', 'HEAD');
    // b's .git is a symlink to a's: the shape discovery names shared-repo (spec MM9, row 57).
    t11fs.mkdirSync(at('b'));
    t11fs.symlinkSync(t11path.join(a, '.git'), t11path.join(at('b'), '.git'));
    const broken = h.makeRepo('broken');
    t11fs.writeFileSync(t11path.join(broken, '.git', 'HEAD'), 'not a ref\n');
    h.git(demo, 'worktree', 'add', '-q', '-b', 'ws/a', at('wt'));
    const origin = t11path.join(h.home, 'origins', 'demo.git');
    h.git(origin, 'config', 'uploadpack.allowFilter', 'true');
    h.git(h.home, 'clone', '-q', '--filter=blob:none', `file://${origin}`, at('pc'));
    h.git(h.home, 'init', '-q', '-b', 'trunk', at('nodef'));
    t11fs.writeFileSync(t11path.join(at('nodef'), 'README.md'), 'hi\n');
    h.git(at('nodef'), 'add', 'README.md');
    h.git(at('nodef'), 'commit', '-q', '-m', 'init');
    t11fs.mkdirSync(t11path.join(at('nongit'), 'docs', 'superpowers', 'specs'), { recursive: true });
    t11fs.mkdirSync(t11path.join(at('nongit'), 'docs', 'conventions'), { recursive: true });
    t11fs.writeFileSync(t11path.join(at('nongit'), 'docs', 'product-design'), 'a file, not a section\n');
    const rec = t11dh.plantGitRecorder(h.home);
    rec.reset();
    ans = t11index(h);
    indexCalls = rec.calls();
  });
  t11v.afterAll(() => h.cleanup());

  t11v.it('lists every directory, in name order, each with its own state', () => {
    t11v.expect(t11rows(ans).map((r) => [r.project, r.state])).toEqual([
      ['a', 'ready'], ['b', 'shared-repo'], ['broken', 'repo-unreadable'], ['demo', 'ready'],
      ['nodef', 'no-default-branch'], ['nongit', 'not-a-git-repo'], ['pc', 'partial-clone'], ['wt', 'linked-worktree'],
    ]);
    t11v.expect(ans['unlisted']).toBe(0);
  });

  t11v.it('a ready row carries its default branch, commit and section counts, and no other row does', () => {
    t11v.expect(t11row(ans, 'demo')['default']).toEqual({ name: 'main', via: 'default:origin-head', commit: demoCommit });
    t11v.expect(t11row(ans, 'demo')['sections']).toEqual({ specs: 2, plans: 1, 'product-design': null, conventions: null });
    t11v.expect(t11row(ans, 'a')['default']).toEqual({ name: 'main', via: 'default:origin-head', commit: aCommit });
    t11v.expect(t11row(ans, 'a')['sections']).toEqual({ specs: 0, plans: 1, 'product-design': null, conventions: null });
    for (const r of t11rows(ans).filter((x) => x.state !== 'ready')) {
      t11v.expect(r, r.project).not.toHaveProperty('default');
      t11v.expect(r, r.project).not.toHaveProperty('sections');
    }
    // No stamp exists anywhere in this HOME, so no row may claim a fetch.
    for (const r of t11rows(ans)) t11v.expect(r, r.project).not.toHaveProperty('fetch');
  });

  t11v.it("each section count is the count docs-tree's own listing gives, null where the listing has no directory", () => {
    for (const p of ['a', 'demo']) t11v.expect(t11row(ans, p)['sections'], p).toEqual(t11treeCounts(h, p));
  });

  t11v.it('github is named for the GitHub-shaped origin and none for every other row (spec §3.11)', () => {
    for (const r of t11rows(ans)) {
      t11v.expect(r['github'], r.project)
        .toEqual(r.project === 'demo' ? { state: 'named', slug: 'example-org/example-repo' } : { state: 'none' });
    }
  });

  t11v.it('a non-git directory reports the sections it holds as directories, and nothing else', () => {
    const r = t11row(ans, 'nongit');
    t11v.expect(r['sectionsOnDisk']).toEqual(['specs', 'conventions']);   // product-design is a FILE there
    t11v.expect(r).not.toHaveProperty('repoKey');
  });

  t11v.it("a linked worktree and a shared repo carry exactly discovery's owner and branch, and the owner's repoKey", () => {
    for (const [p, owner, branch] of [['wt', 'demo', 'ws/a'], ['b', 'a', 'main']] as const) {
      const row = t11row(ans, p);
      t11v.expect(t11discover(h, p), p).toEqual({ word: row.state, owner, branch });
      t11v.expect(row['owner'], p).toBe(owner);
      t11v.expect(row['branch'], p).toBe(branch);
      t11v.expect(row['repoKey'], p).toBe(t11row(ans, owner)['repoKey']);
    }
  });

  t11v.it('duplicates lists every repoKey two or more rows hold (row 57)', () => {
    const key = (p: string): unknown => t11row(ans, p)['repoKey'];
    t11v.expect(ans['duplicates']).toEqual([
      { repoKey: key('a'), projects: ['a', 'b'] },
      { repoKey: key('demo'), projects: ['demo', 'wt'] },
    ]);
    // CONTROL: the keys are real and distinct, so the pairing above is not two rows sharing a constant.
    t11v.expect(key('a')).toMatch(/^[0-9a-f]{32}$/);
    t11v.expect(new Set([key('a'), key('demo'), key('nodef')]).size).toBe(3);
    for (const p of ['broken', 'nongit', 'pc']) t11v.expect(t11row(ans, p), p).not.toHaveProperty('repoKey');
  });

  t11v.it('row 16 (index): the walk never fetches, never mutates, never enumerates worktrees and never runs status', () => {
    const sub = (argv: string[]): string[] => { const i = argv.indexOf('-C'); return i >= 0 ? argv.slice(i + 2) : argv; };
    const subs = indexCalls.map((c) => sub(c.argv));
    // CONTROL: the recorder saw the walk itself: discovery, the origin url, the default chain and the counts.
    t11v.expect(subs.map((s) => s[0])).toEqual(
      t11v.expect.arrayContaining(['rev-parse', 'config', 'symbolic-ref', 'for-each-ref', 'ls-tree']));
    const FORBIDDEN = new Set(['fetch', 'remote', 'gc', 'maintenance', 'update-ref', 'checkout', 'show', 'diff', 'archive',
      'worktree', 'status']);
    t11v.expect(subs.filter((s) => FORBIDDEN.has(s[0] ?? ''))).toEqual([]);
    t11v.expect(indexCalls.filter((c) => c.argv.some((x) => x === '--textconv' || x === '--filters'))).toEqual([]);
    // Every call went through the hardened read runner, never a bare git.
    for (const c of indexCalls) t11v.expect(c.env['GIT_NO_LAZY_FETCH'], c.argv.join(' ')).toBe('1');
  });
});

t11v.describe('T11: docs-index, per-row failures and the per-call bound', () => {
  let h: t11ws.CcdHarness;
  t11v.beforeEach(() => { h = t11ws.makeCcdHarness('ccd-docs-'); });
  t11v.afterEach(() => h.cleanup());

  t11v.it('a git failure in one project makes that row repo-unreadable and leaves the others ready', () => {
    t11dh.docsRepo(h, 'demo');
    t11dh.docsRepo(h, 'zz');
    // CONTROL: both rows are ready before the planted failure.
    t11v.expect(t11rows(t11index(h)).map((r) => r.state)).toEqual(['ready', 'ready']);
    t11dh.plantGitRecorder(h.home, { failWhen: ['/projects/zz ls-tree'] });
    const o = t11index(h);
    t11v.expect(o['ok']).toBe(true);
    t11v.expect(t11row(o, 'demo').state).toBe('ready');
    const zz = t11row(o, 'zz');
    t11v.expect(zz.state).toBe('repo-unreadable');
    t11v.expect(zz['repoKey']).toMatch(/^[0-9a-f]{32}$/);
    t11v.expect(zz).not.toHaveProperty('sections');
  });

  t11v.it('every git call the walk makes is bounded by the 5 s index budget', () => {
    t11dh.docsRepo(h, 'demo');
    const got = t11py.unitJson<{ calls: [string, number][]; ok: boolean }>(h.home, [
      ...T11_CTX,
      'import json',
      'calls = []',
      'class RecordsBounds(type(H.SYS)):',
      '    def spawn(self, argv, env, cwd, timeout_s, stdout_cap, stdin=None):',
      "        calls.append([argv[argv.index('-C') + 2], timeout_s])",
      '        return super().spawn(argv, env, cwd, timeout_s, stdout_cap, stdin)',
      'H.SYS = RecordsBounds()',
      "a = json.loads(H.run(['docs-index', ctx.root, ctx.worktrees, ctx.reg, '--all']).decode('utf-8'))",
      "out({'calls': calls, 'ok': a['ok']})",
    ].join('\n'));
    t11v.expect(got.ok).toBe(true);
    // CONTROL: the walk spawned git, the section count's ls-tree included.
    t11v.expect(got.calls.map((c) => c[0])).toEqual(t11v.expect.arrayContaining(['rev-parse', 'for-each-ref', 'ls-tree']));
    for (const [sub, bound] of got.calls) {
      t11v.expect(bound, sub).toBeGreaterThan(0);
      t11v.expect(bound, sub).toBeLessThanOrEqual(5);
    }
  });

  t11v.it('only a classified Fail is a row: any other exception is the whole answer, helper-failed', () => {
    const got = t11py.unitJson<Record<string, unknown>[]>(h.home, [
      ...T11_CTX,
      'import json',
      "os.makedirs(os.path.join(home, 'projects', 'demo'))",
      'def partial(ctx, project, dl):',
      "    raise H.fail('partial-clone')",
      'def boom(ctx, project, dl):',
      "    raise RuntimeError('a defect, not a state')",
      'answers = []',
      'for d in (partial, boom):',
      '    H.discover = d',
      "    answers.append(json.loads(H.run(['docs-index', ctx.root, ctx.worktrees, ctx.reg, '--all']).decode('utf-8')))",
      'out(answers)',
    ].join('\n'));
    // CONTROL: a Fail from discovery is that row's state, in an ok answer.
    t11v.expect(got[0]).toMatchObject({ ok: true, projects: [{ project: 'demo', state: 'partial-clone' }] });
    t11v.expect(got[1]).toMatchObject({ ok: false, failure: 'helper-failed' });
    t11v.expect(String(got[1]!['detail'])).toMatch(/RuntimeError: a defect, not a state/);
  });
});

t11v.describe('T11: docs-index, row 58 - what the walk never lists', () => {
  let h: t11ws.CcdHarness;
  t11v.beforeEach(() => {
    h = t11ws.makeCcdHarness('ccd-docs-');
    h.makeRepo('demo');
  });
  t11v.afterEach(() => h.cleanup());

  t11v.it('a dash-leading and a 101-character directory are counted in unlisted and never listed; a dot entry is neither', () => {
    for (const n of ['-dash', 'x'.repeat(101), '.hidden']) t11fs.mkdirSync(t11path.join(h.home, 'projects', n));
    const o = t11index(h);
    t11v.expect(t11rows(o).map((r) => r.project)).toEqual(['demo']);   // CONTROL: the walk lists a real project
    t11v.expect(o['unlisted']).toBe(2);
  });

  t11v.it.skipIf(process.platform === 'darwin')('a non-UTF-8 directory name is counted and never listed (APFS refuses to create one)', () => {
    h.sh(`mkdir -- "$HOME/projects/$(printf '\\377')"`);
    const o = t11index(h);
    t11v.expect(t11rows(o).map((r) => r.project)).toEqual(['demo']);
    t11v.expect(o['unlisted']).toBe(1);
  });

  t11v.it('a regular file and a symlink to a project are not directories by lstat: counted, never listed', () => {
    const root = t11path.join(h.home, 'projects');
    t11fs.writeFileSync(t11path.join(root, 'notes.txt'), 'not a project\n');
    t11fs.symlinkSync(t11path.join(root, 'demo'), t11path.join(root, 'link'));
    const o = t11index(h);
    t11v.expect(t11rows(o).map((r) => r.project)).toEqual(['demo']);
    t11v.expect(o['unlisted']).toBe(2);
  });
});

t11v.describe("T11: docs-index, row 43 reader half - only the default branch's own stamp is read", () => {
  let h: t11ws.CcdHarness;
  let stampAt = '';
  let good = '';
  t11v.beforeAll(() => {
    h = t11ws.makeCcdHarness('ccd-docs-');
    t11fx.plantIndexHome(h, 'ready');
    stampAt = t11fx.indexStampPath(h, 'demo', 'main');
    good = t11fs.readFileSync(stampAt, 'utf8');
  });
  t11v.afterAll(() => h.cleanup());
  const demo = (): T11Row => t11row(t11index(h), 'demo');

  t11v.it('CONTROL: the stamp plantIndexHome wrote is read, with its age on the fleet clock', () => {
    const f = demo()['fetch'] as { okAgeMs: number; lastOutcome: string };
    t11v.expect(f.lastOutcome).toBe('ok');
    t11v.expect(f.okAgeMs).toBeGreaterThanOrEqual(5000);
    t11v.expect(f.okAgeMs).toBeLessThan(120000);
  });

  t11v.it("after a failed attempt the row reports the failure's word and the last SUCCESS's age, not the attempt's", () => {
    // What docs-fetch writes when an attempt fails: the attempt's own time and word, okMs and okCommit carried over.
    const now = Date.now();
    const failed = { ...(JSON.parse(good) as Record<string, unknown>), attemptMs: now - 5000, lastOutcome: 'fetch-timeout', okMs: now - 65000 };
    t11fs.writeFileSync(stampAt, JSON.stringify(failed));
    const f = demo()['fetch'] as { okAgeMs: number; lastOutcome: string };
    t11v.expect(f.lastOutcome).toBe('fetch-timeout');
    t11v.expect(f.okAgeMs).toBeGreaterThanOrEqual(65000);
    t11v.expect(f.okAgeMs).toBeLessThan(180000);
  });

  t11v.it('a FIFO at the stamp path gives a ready row with no fetch field, answered within 5 s', () => {
    t11fs.rmSync(stampAt);
    h.sh(`mkfifo -- ${t11shq(stampAt)}`);
    // runCcdDocsShell carries a 120 s spawn bound, so a reader that blocked on the FIFO is a red, not a hung suite.
    const t0 = Date.now();
    const r = t11dh.runCcdDocsShell(h, 'exec bash "$0" docs-index --all');
    const took = Date.now() - t0;
    const row = t11row(t11dh.parseOneLine(r), 'demo');
    t11v.expect(took).toBeLessThan(5000);
    t11v.expect(row.state).toBe('ready');
    t11v.expect(row).not.toHaveProperty('fetch');
  });

  t11v.it('a symlink at the stamp path, to a well-formed stamp, gives no fetch field', () => {
    t11fs.rmSync(stampAt, { force: true });
    const target = `${stampAt}.target`;
    t11fs.writeFileSync(target, good);
    t11fs.symlinkSync(target, stampAt);
    t11v.expect(demo()).not.toHaveProperty('fetch');
  });

  t11v.it("a stamp naming another branch, or one kept only for another branch, is not the default branch's", () => {
    t11fs.rmSync(stampAt, { force: true });
    const other = { ...(JSON.parse(good) as Record<string, unknown>), branch: 'ws/a' };
    t11fs.writeFileSync(stampAt, JSON.stringify(other));
    t11v.expect(demo()).not.toHaveProperty('fetch');
    t11fs.rmSync(stampAt);
    t11fx.writeIndexStamp(h, 'demo', 'ws/a', other);
    t11v.expect(demo()).not.toHaveProperty('fetch');
    // CONTROL: the good stamp back in place is read again.
    t11fs.writeFileSync(stampAt, good);
    t11v.expect(demo()).toHaveProperty('fetch');
  });
});

t11v.describe('T11: docs-index, the projects root itself (decided: absent or not a directory is an empty index)', () => {
  const EMPTY = { v: 1, verb: 'docs-index', ok: true, elapsedMs: 0, unlisted: 0, duplicates: [], projects: [] };
  let h: t11ws.CcdHarness;
  t11v.beforeEach(() => { h = t11ws.makeCcdHarness('ccd-docs-'); });
  t11v.afterEach(() => h.cleanup());

  t11v.it('an absent root answers ok with no projects, which is what a fresh box has', () => {
    h.makeRepo('demo');
    t11v.expect(t11rows(t11index(h)).map((r) => r.project)).toEqual(['demo']);   // CONTROL: the root is read
    t11fs.rmSync(t11path.join(h.home, 'projects'), { recursive: true, force: true });
    t11v.expect(t11fx.normaliseDocsIndex(t11index(h))).toEqual(EMPTY);
  });

  t11v.it('a regular file where the root should be answers the same empty index', () => {
    t11fs.writeFileSync(t11path.join(h.home, 'projects'), 'not a directory\n');
    t11v.expect(t11fx.normaliseDocsIndex(t11index(h))).toEqual(EMPTY);
  });

  // F3 (c): stat answers ENOTDIR for a symlink whose target runs through a file; that is "no root" too (R11-5).
  t11v.it('a root that is a symlink through a regular file answers the same empty index, not helper-failed', () => {
    const file = t11path.join(h.home, 'afile');
    t11fs.writeFileSync(file, 'not a directory\n');
    t11fs.rmSync(t11path.join(h.home, 'projects'), { recursive: true, force: true });
    t11fs.symlinkSync(t11path.join(file, 'x'), t11path.join(h.home, 'projects'));
    t11v.expect(t11fx.normaliseDocsIndex(t11index(h))).toEqual(EMPTY);
  });

  t11v.it.skipIf(process.getuid?.() === 0)('a root that exists but cannot be listed is helper-failed, never an empty index', () => {
    const root = t11path.join(h.home, 'projects');
    h.makeRepo('demo');
    t11fs.chmodSync(root, 0o000);
    try {
      const o = t11index(h);
      t11v.expect(o['ok']).toBe(false);
      t11v.expect(o['failure']).toBe('helper-failed');
      t11v.expect(String(o['detail'])).toMatch(/PermissionError/);
    } finally {
      t11fs.chmodSync(root, 0o755);
    }
  });
});

// Fix round 1, F2: decision 3's second half. A linked worktree whose main checkout lives OUTSIDE the root has
// no owner in the root, so its row carries owner null and no repoKey (R11-1).
t11v.describe('T11: docs-index, a linked worktree whose main checkout is outside the root (decision 3)', () => {
  let h: t11ws.CcdHarness;
  t11v.beforeEach(() => { h = t11ws.makeCcdHarness('ccd-docs-'); });
  t11v.afterEach(() => h.cleanup());

  t11v.it('is linked-worktree with owner null, its branch, no repoKey, in an ok answer', () => {
    h.makeRepo('demo');   // CONTROL: an ordinary project beside it
    const outside = t11path.join(h.home, 'elsewhere', 'x');
    t11fs.mkdirSync(outside, { recursive: true });
    h.git(outside, 'init', '-q', '-b', 'main');
    t11fs.writeFileSync(t11path.join(outside, 'README.md'), 'hi\n');
    h.git(outside, 'add', 'README.md');
    h.git(outside, 'commit', '-q', '-m', 'init');
    h.git(outside, 'worktree', 'add', '-q', '-b', 'ws/b', t11path.join(h.home, 'projects', 'wt2'));
    const o = t11index(h);
    t11v.expect(o['ok']).toBe(true);
    const row = t11row(o, 'wt2');
    t11v.expect(row.state).toBe('linked-worktree');
    t11v.expect(row['owner']).toBeNull();
    t11v.expect(row['branch']).toBe('ws/b');
    t11v.expect(row).not.toHaveProperty('repoKey');
    t11v.expect(t11discover(h, 'wt2')).toEqual({ word: 'linked-worktree', owner: null, branch: 'ws/b' });
    t11v.expect(t11row(o, 'demo').state).toBe('ready');
  });
});

// Fix round 1, F1: a spent helper deadline ends the walk. What the walk did not reach is counted in `unwalked`;
// it is never a row and never repo-unreadable, which would say a healthy repository is corrupt (R11-2).
t11v.describe('T11: docs-index, the 12 s helper deadline (F1)', () => {
  let h: t11ws.CcdHarness;
  t11v.beforeEach(() => {
    h = t11ws.makeCcdHarness('ccd-docs-');
    for (const n of ['a', 'b', 'c']) t11dh.docsRepo(h, n);
  });
  t11v.afterEach(() => h.cleanup());
  const run = [
    "a = json.loads(H.run(['docs-index', ctx.root, ctx.worktrees, ctx.reg, '--all']).decode('utf-8'))",
  ];
  const COUNTS = [
    'spawns = []',
    'class Counts(type(H.SYS)):',
    '    def spawn(self, argv, env, cwd, timeout_s, stdout_cap, stdin=None):',
    "        spawns.append(argv[argv.index('-C') + 2])",
    '        return super().spawn(argv, env, cwd, timeout_s, stdout_cap, stdin)',
    'H.SYS = Counts()',
  ];

  t11v.it('a deadline already spent answers ok, lists no row, counts the three repositories unwalked, and spawns no git', () => {
    const got = t11py.unitJson<{ a: Record<string, unknown>; spawns: string[] }>(h.home, [
      ...T11_CTX, 'import json', "H.HELPER_DEADLINE_S['docs-index'] = 0", ...COUNTS, ...run,
      "out({'a': a, 'spawns': spawns})",
    ].join('\n'));
    t11v.expect(got.a).toMatchObject({ ok: true, unlisted: 0, duplicates: [], projects: [], unwalked: 3 });
    t11v.expect(got.spawns).toEqual([]);
  });

  t11v.it('a directory that is not a repository is unwalked too once the deadline is spent: no git call decides it, yet it is no row', () => {
    t11fs.mkdirSync(t11path.join(h.home, 'projects', 'plain'));
    const got = t11py.unitJson<{ a: Record<string, unknown>; spawns: string[] }>(h.home, [
      ...T11_CTX, 'import json', "H.HELPER_DEADLINE_S['docs-index'] = 0", ...COUNTS, ...run,
      "out({'a': a, 'spawns': spawns})",
    ].join('\n'));
    t11v.expect(got.a).toMatchObject({ ok: true, projects: [], unwalked: 4 });
    // CONTROL: under the real deadline the same directory is a not-a-git-repo row.
    t11v.expect(t11row(t11index(h), 'plain').state).toBe('not-a-git-repo');
  });

  t11v.it('CONTROL: the same three repositories under the real deadline are three ready rows and carry no unwalked key', () => {
    const got = t11py.unitJson<{ a: Record<string, unknown>; spawns: string[] }>(h.home, [
      ...T11_CTX, 'import json', ...COUNTS, ...run, "out({'a': a, 'spawns': spawns})",
    ].join('\n'));
    t11v.expect(got.a['ok']).toBe(true);
    t11v.expect(t11rows(got.a).map((r) => [r.project, r.state])).toEqual([['a', 'ready'], ['b', 'ready'], ['c', 'ready']]);
    t11v.expect(got.a).not.toHaveProperty('unwalked');
    t11v.expect(got.spawns.length).toBeGreaterThan(0);
  });

  // The deadline runs out INSIDE a project's own git call (the clock jumps past it as that call times out): that
  // project and everything after it are unwalked. `trip` is the first subcommand whose spawn times out; with
  // `jump` false the same timeout leaves the deadline unspent, so it is that one project's own state.
  const timeoutAt = (trip: string, jump: boolean): Record<string, unknown> => t11py.unitJson<Record<string, unknown>>(h.home, [
    ...T11_CTX, 'import json',
    'state = {"tripped": False, "skew": 0.0}',
    'class Hangs(type(H.SYS)):',
    '    def monotonic(self):',
    "        return super().monotonic() + state['skew']",
    '    def spawn(self, argv, env, cwd, timeout_s, stdout_cap, stdin=None):',
    "        if not state['tripped'] and argv[argv.index('-C') + 2] == " + JSON.stringify(trip) + ':',
    "            state['tripped'] = True",
    `            state['skew'] = ${jump ? '1000.0' : '0.0'}`,
    '            return H.Spawned(None, b"", b"", True, False)',
    '        return super().spawn(argv, env, cwd, timeout_s, stdout_cap, stdin)',
    'H.SYS = Hangs()',
    ...run,
    'out(a)',
  ].join('\n'));

  t11v.it.each(['rev-parse', 'ls-tree'])('a deadline spent during the first project\'s %s call counts it and the rest unwalked', (trip) => {
    const o = timeoutAt(trip, true);
    t11v.expect(o).toMatchObject({ ok: true, projects: [], unwalked: 3 });
  });

  t11v.it.each(['rev-parse', 'ls-tree'])('CONTROL: one hung %s call with the deadline unspent is that project\'s repo-unreadable, the rest ready', (trip) => {
    const o = timeoutAt(trip, false);
    t11v.expect(o['ok']).toBe(true);
    t11v.expect(t11rows(o).map((r) => [r.project, r.state])).toEqual([['a', 'repo-unreadable'], ['b', 'ready'], ['c', 'ready']]);
    t11v.expect(o).not.toHaveProperty('unwalked');
  });
});

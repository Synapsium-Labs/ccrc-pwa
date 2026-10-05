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

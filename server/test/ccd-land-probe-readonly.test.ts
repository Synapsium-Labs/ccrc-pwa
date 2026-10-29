// ccd-land-probe is read-only BY CODE (landing-order wave 3b, spec section 7): the literal source pins, and the
// validate-only self-test of git_ro's refusals. The behaviour is in ccd-land-probe.test.ts.
//
// WHAT THE PINS HOLD. The pins read ccd/ccd-land-probe's whole text, in two ways. An AST CENSUS of the embedded
// program (R5b, `python3 -I` with the `ast` module) holds the imports to a pinned list, module names and aliases both,
// wherever a statement stands (after a `;` or a `:`, inside a function), so any other module is red; and it holds the
// dynamic builtins out (`__import__`, `eval`, `exec`, `compile`, `getattr`, `setattr`, `vars`, `globals`, `locals`,
// as bare names, and a `__dict__` attribute). The spawn names are held by their LITERAL SPELLINGS (`subprocess.Popen`
// once, `os.system`, `pty.spawn` and the rest of the banned list, an aliased import, a bare module handed to another
// name). They are not a proof that no process can be started. The census also pins every node that names
// OPTION_FORMS, exactly (review 1143 F4): the target of its one module-level assignment, and git_check's two reads (a
// subscript's value and an `in` comparator). Every node kind that can name it is counted (a Name in any context, an
// argument, an import alias, a def, class or except name, a global or nonlocal, a keyword, an attribute, a match
// capture, a type parameter), so a rebinding, a store, a delete, a method call, a copy or an alias (`x = OPTION_FORMS`)
// is a fourth entry, and a read respelled in git_check changes the entries. The KNOWN LIMIT is what names nothing:
// a lookup through an object's own method with the name as a string, which the banned list does not refuse (for
// example `type(m).__getattribute__(m, 'OPTION_FORMS')` on the module `sys.modules` holds; `getattr`, `globals`,
// `vars` and `__dict__` are refused), a name built from pieces, and code in another file. The behaviour that matters
// is held by the self-test below, which runs git_check's verdicts, and by the behaviour suite.
//
// WHERE THE PLANTING EVIDENCE IS. This file plants nothing. A pin is a request until a planted violation turns it red,
// and that evidence is the mutation rows (one planted violation each, measured one at a time on the final files, the
// file restored from a saved copy) that the wave's controller re-measures; they are not in this file.
import { describe, it, expect, afterEach } from 'vitest';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, ghPoisonAt, type CcdHarness } from './ccdWsHelpers.js';
import { makeLandFixture, until, PROBE } from './ccdLandProbeFixture.js';
import { mkTmp } from './tmpHelpers.js';

const src = fs.readFileSync(PROBE, 'utf8');
const MARK = "<<'PY'";
/** The bash head: everything before the heredoc that carries the program. */
const head = src.slice(0, src.indexOf(MARK));
const headCode = head.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
/** The embedded program: the text between the heredoc's opener and its closing `PY` line. */
const program = src.slice(src.indexOf(MARK) + MARK.length + 1, src.lastIndexOf('\nPY'));

/** What the AST census reads from a program's text: its imports as [module, name, alias] (a plain `import m` has no
 *  name; a from-import's module carries its leading dots), each bare name from the banned list, and each attribute
 *  named `__dict__`. Run with `python3 -I` over the program on stdin, so it parses the real syntax tree: a statement
 *  after a `;` or a `:`, or inside a function, is seen as the statement it is. */
const CENSUS = `
import ast, json, sys
BANNED = ('__import__', 'eval', 'exec', 'compile', 'getattr', 'setattr', 'vars', 'globals', 'locals', '__builtins__')
tree = ast.parse(sys.stdin.read())
imports, names, attrs, forms = [], [], [], []
parent = {}
for p in ast.walk(tree):
    for c in ast.iter_child_nodes(p):
        parent[c] = p
TABLE = 'OPTION_FORMS'
def scope(n):
    # The enclosing defs, outermost first: '<module>' at module level, 'git_check' inside that function.
    out, p = [], parent.get(n)
    while p is not None:
        if isinstance(p, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            out.append(p.name)
        elif isinstance(p, ast.Lambda):
            out.append('<lambda>')
        p = parent.get(p)
    return '.'.join(reversed(out)) or '<module>'
def name_role(n):
    # A Name naming the table, by its context and its parent: the three shapes the probe holds, or the parent's kind.
    p, ctx = parent.get(n), type(n.ctx).__name__
    if isinstance(p, ast.Assign) and any(t is n for t in p.targets):
        return '%s target of a %d-target Assign' % (ctx, len(p.targets))
    if isinstance(p, ast.Subscript) and p.value is n:
        return '%s value of a %s Subscript' % (ctx, type(p.ctx).__name__)
    if isinstance(p, ast.Compare) and any(c is n for c in p.comparators):
        i = [k for k, c in enumerate(p.comparators) if c is n][0]
        return '%s comparator of %s' % (ctx, type(p.ops[i]).__name__)
    return '%s in %s' % (ctx, type(p).__name__)
MATCH = tuple(getattr(ast, k) for k in ('MatchAs', 'MatchStar') if hasattr(ast, k))
TYPEPARAMS = tuple(getattr(ast, k) for k in ('TypeVar', 'ParamSpec', 'TypeVarTuple') if hasattr(ast, k))
for n in ast.walk(tree):
    # Every node that can name OPTION_FORMS (review 1143 F4), whatever it does with it.
    role = None
    if isinstance(n, ast.Name) and n.id == TABLE:
        role = 'Name ' + name_role(n)
    elif isinstance(n, ast.arg) and n.arg == TABLE:
        role = 'arg'
    elif isinstance(n, ast.alias) and (n.asname == TABLE or TABLE in n.name.split('.')):
        role = 'alias'
    elif isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and n.name == TABLE:
        role = type(n).__name__ + ' name'
    elif isinstance(n, ast.ExceptHandler) and n.name == TABLE:
        role = 'ExceptHandler name'
    elif isinstance(n, (ast.Global, ast.Nonlocal)) and TABLE in n.names:
        role = type(n).__name__
    elif isinstance(n, ast.keyword) and n.arg == TABLE:
        role = 'keyword'
    elif isinstance(n, ast.Attribute) and n.attr == TABLE:
        role = 'Attribute'
    elif MATCH and isinstance(n, MATCH) and n.name == TABLE:
        role = type(n).__name__ + ' name'
    elif hasattr(ast, 'MatchMapping') and isinstance(n, ast.MatchMapping) and n.rest == TABLE:
        role = 'MatchMapping rest'
    elif TYPEPARAMS and isinstance(n, TYPEPARAMS) and n.name == TABLE:
        role = type(n).__name__ + ' name'
    if role is not None:
        forms.append(role + ' at ' + scope(n))
    if isinstance(n, ast.Import):
        imports += [[a.name, None, a.asname] for a in n.names]
    elif isinstance(n, ast.ImportFrom):
        imports += [['.' * n.level + (n.module or ''), a.name, a.asname] for a in n.names]
    elif isinstance(n, ast.Name) and n.id in BANNED:
        names.append(n.id)
    elif isinstance(n, ast.Attribute) and n.attr in ('__dict__', '__import__', '__builtins__'):
        attrs.append(n.attr)
print(json.dumps({'imports': sorted(imports, key=repr), 'names': sorted(names), 'attrs': sorted(attrs), 'forms': sorted(forms)}))
`;
function census(text: string): { imports: Array<[string, string | null, string | null]>; names: string[]; attrs: string[]; forms: string[] } {
  return JSON.parse(execFileSync('python3', ['-I', '-c', CENSUS], { input: text, encoding: 'utf8' }));
}

/** The dict literal `OPTION_FORMS = { ('where', 'sub'): ('form', ...), ... }`, read from the source text whatever its line
 *  breaks: each key and each tuple, as `where sub` -> forms. A line of the literal that is not an entry is an error. */
function optionForms(): Record<string, string[]> {
  const m = /^OPTION_FORMS = \{([\s\S]*?)^\}$/m.exec(src);
  if (!m) throw new Error('no literal dict OPTION_FORMS');
  const body = m[1]!.split('\n').map((l) => l.replace(/#.*$/, '')).join('\n');
  const entry = /\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,?\s*\)\s*:\s*\(([^)]*)\)\s*,/g;
  const out: Record<string, string[]> = {};
  for (const e of body.matchAll(entry)) {
    const key = `${e[1]} ${e[2]}`;
    if (key in out) throw new Error(`OPTION_FORMS repeats ${key}`);
    out[key] = [...e[3]!.matchAll(/'([^']*)'/g)].map((x) => x[1]!);
  }
  if (body.replace(entry, '').trim() !== '') throw new Error('OPTION_FORMS holds text that is not an entry');
  return out;
}

/** R8's holder scan: the files of `files` (paths under `root`) whose bytes match `re`, and each one it could not read.
 *  It fails closed (review 1143 A3): a file that cannot be lstat'd or read is named in `unread`, never counted as "not a
 *  holder". The one exception is ENOENT: a tracked file deleted from the work tree is a proven absence and holds nothing.
 *  A file that is not a regular one (a tracked symlink) is not read, so it holds nothing either. */
function holdersIn(root: string, files: string[], re: RegExp): { holders: string[]; unread: string[] } {
  const holders: string[] = [];
  const unread: string[] = [];
  for (const f of files) {
    const p = path.join(root, f);
    try {
      if (fs.lstatSync(p).isFile() && re.test(fs.readFileSync(p, 'latin1'))) holders.push(f);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') unread.push(`${f}: ${code ?? 'error'}`);
    }
  }
  return { holders, unread };
}

/** The quoted strings of a tuple literal `NAME = ( ... )`, read from the source text. */
function tuple(name: string): string[] {
  const m = new RegExp(`^${name} = \\(([^)]*)\\)$`, 'm').exec(src);
  if (!m) throw new Error(`no literal tuple ${name}`);
  return [...m[1]!.matchAll(/'([^']*)'/g)].map((x) => x[1]!);
}

describe('ccd-land-probe: the literal source pins', () => {
  it('R1 never says push', () => {
    expect(src).not.toMatch(/\bpush\b/i);
  });

  it('R2 never names a PR merge', () => {
    expect(src).not.toMatch(/\bpr\b[\s'",]*\bmerge\b/i);
  });

  it('R3 gh has exactly two call sites, the two read forms, and none in the bash head\'s code', () => {
    expect(src.match(/\[GH,/g) ?? []).toHaveLength(2);
    expect(src.match(/\[GH, 'api', '--method', 'GET', path\]/g) ?? []).toHaveLength(1);
    expect(src.match(/\[GH, 'pr', 'list', '--repo', slug, [^\]]*\]/g) ?? []).toHaveLength(1);
    // The one allowed extension of the GET form, and no other use of the flag.
    expect(src.match(/--paginate/g) ?? []).toHaveLength(1);
    expect(src).toContain("argv = argv + ['--paginate']");
    expect(headCode).not.toMatch(/(^|[\s;|&(])gh\s/m);
  });

  it('R4 no method or field flag but GET', () => {
    for (const re of [/['"]--method['"],\s*['"](?!GET['"])/, /--method=(?!GET\b)/i, /['"]-X/, /['"]--(raw-)?field/, /['"]--input/, /['"]-[fF]['"]/]) {
      expect(src, String(re)).not.toMatch(re);
    }
  });

  it('R5 git has one call site, its prefix and its allowlists are the plan\'s', () => {
    expect(src.match(/\[['"]git['"]/g) ?? []).toHaveLength(1);
    const fn = /^def git_ro\([\s\S]*?\n\n\n/m.exec(src);
    expect(fn, 'git_ro is findable').not.toBeNull();
    expect(fn![0]).toContain("['git']");
    expect(tuple('GIT_PREFIX')).toEqual(['--no-pager', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false']);
    expect(tuple('PROJECT_LOCKS')).toEqual(['--no-optional-locks']);
    expect(tuple('FETCH_PREFIX')).toEqual(['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'transfer.unpackLimit=1', '-c', 'fetch.writeCommitGraph=false']);
    expect(tuple('FETCH_KEEP')).toEqual(['GIT_SSH', 'GIT_SSH_COMMAND', 'GIT_ASKPASS', 'GIT_SSL_CAINFO', 'GIT_SSL_CAPATH']);
    expect(tuple('PROJECT_ALLOW')).toEqual(['rev-parse', 'rev-list', 'for-each-ref', 'cat-file', 'merge-base', 'count-objects', 'ls-remote', 'config']);
    expect(tuple('SCRATCH_ALLOW')).toEqual(['init', 'fetch', 'merge-tree', 'merge-base', 'rev-parse', 'rev-list', 'cat-file']);
    expect(tuple('OPTION_PREFIXES')).toEqual(['-c', '--config-env', '-C', '--git-dir', '--work-tree', '--exec', '--upload-pack', '--receive-pack', '-u']);
    expect(tuple('PINNED_KEYS')).toEqual(['core.hooksPath', 'core.fsmonitor']);
    // The option forms each row admits (review 1125 F2, N5): every key and every tuple, whatever the literal's line breaks.
    expect(src.match(/^OPTION_FORMS = \{/gm) ?? [], 'one literal').toHaveLength(1);
    expect(optionForms()).toEqual({
      'project rev-parse': ['--verify', '-q'],
      'project rev-list': [],
      'project for-each-ref': [],
      'project cat-file': [],
      'project merge-base': [],
      'project count-objects': ['-v'],
      'project ls-remote': ['--get-url'],
      'project config': ['--get'],
      'scratch init': ['-q', '--bare'],
      'scratch fetch': ['--no-tags', '--no-write-fetch-head', '--no-recurse-submodules', '--'],
      'scratch merge-tree': ['--write-tree', '--name-only', '--no-messages'],
      'scratch merge-base': ['--is-ancestor'],
      'scratch rev-parse': ['--verify', '-q'],
      'scratch rev-list': ['--parents', '-n'],
      'scratch cat-file': [],
    });
  });

  it('R5b every child process is spawned in one place: one Popen, three callers of run_child, the imports a pinned list, no dynamic builtin, and the spawn names by their literal spellings', () => {
    // The AST census (review 1125 F4, F5): the program's imports are exactly this list, module names and aliases both and
    // wherever a statement stands, so no other module (asyncio, multiprocessing, pty, ctypes, importlib, ...) and no
    // alias is admitted; none of the dynamic builtins appears as a bare name; no `__dict__` attribute.
    const mods = ['errno', 'json', 'os', 're', 'shutil', 'signal', 'stat', 'subprocess', 'sys', 'tempfile', 'time'];
    const want = [...mods.map((m) => [m, null, null]), ['collections', 'namedtuple', null]];
    const seen = census(program);
    expect([...seen.imports].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))).toEqual(
      [...want].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
    expect(seen.names, 'a dynamic builtin as a bare name').toEqual([]);
    expect(seen.attrs, 'a __dict__, __import__ or __builtins__ attribute').toEqual([]);
    // Every node that names OPTION_FORMS, exactly (review 1140 A2, review 1143 F4): its one module-level binding, and
    // git_check's subscript read and `in` test. R5 pins its literal, and this holds that nothing else touches it.
    expect(seen.forms, 'a node that names OPTION_FORMS').toEqual([
      'Name Load comparator of In at git_check',
      'Name Load value of a Load Subscript at git_check',
      'Name Store target of a 1-target Assign at <module>',
    ]);
    // The pin above sees the ['git' spelling; this one closes a respelled third call site, for git and gh alike.
    expect(src.match(/\bsubprocess\.Popen\b/g) ?? [], 'subprocess.Popen').toHaveLength(1);
    // The def, git_ro, gh_get and gh_pr_list: a fifth is a new way to start a child, and is reviewed as one.
    expect(src.match(/\brun_child\(/g) ?? [], 'run_child( sites').toHaveLength(4);
    expect(src).toMatch(/^def run_child\(/m);
    for (const fn of ['git_ro', 'gh_get', 'gh_pr_list']) {
      const body = new RegExp(`^def ${fn}\\([\\s\\S]*?\\n\\n\\n`, 'm').exec(src);
      expect(body?.[0], `${fn} is findable`).toBeDefined();
      expect(body![0].match(/\brun_child\(/g) ?? [], `${fn} calls run_child once`).toHaveLength(1);
    }
    expect(src).not.toMatch(/\bsubprocess\.(run|call|check_output|check_call|getoutput|getstatusoutput)\b/);
    expect(src).not.toMatch(/\bos\.(system|popen|exec\w*|spawn\w*|posix_spawn\w*|fork\w*|forkpty)\b/);
    expect(src).not.toMatch(/\bpty\.(spawn|fork)\b/);
    // The respellings of the above: an aliased import, a from-import (at a line's start or after a semicolon), and a
    // bare module handed to another name, which would run the banned names under a spelling the patterns miss. The
    // census above is what closes an import anywhere; these stay for the spawn names a pinned module could still reach.
    expect(src, 'import ... as').not.toMatch(/^\s*import\s[^\n]*\b(subprocess|os)(\.\w+)*\s+as\b/m);
    expect(src, 'from ... import').not.toMatch(/\bfrom\s+(subprocess|os)(\.\w+)*\s+import\b/);
    expect(src, 'a bare module assigned').not.toMatch(/=\s*(subprocess|os)\b(?!\.)/);
    expect(src, 'a bare module passed or listed').not.toMatch(/[,(\[]\s*(subprocess|os)\s*[,)\]]/);
  });

  it('R6 never names update-branch', () => {
    expect(src).not.toMatch(/update[-_]branch|updatePullRequestBranch/i);
  });

  it('R7 run_child tests the recorded signal and records the child inside the spawn mask (review 1125 items 1 and 2)', () => {
    // The order is the guard: a test before the block lets a child fork after a signal, and a record after the unblock
    // lets the handler run with no child to kill (the review's X2). Neither has a timing a case can rely on alone.
    const body = /^def run_child\([\s\S]*?\n\n\n/m.exec(src)?.[0] ?? '';
    const at = (needle: string): number => {
      expect(body.split(needle).length - 1, needle).toBe(1);
      return body.indexOf(needle);
    };
    const order = ['signal.pthread_sigmask(signal.SIG_BLOCK, SIGNALS)', 'if SIGNALLED is not None:', 'subprocess.Popen(',
      'CHILD = proc', 'finally:', 'signal.pthread_sigmask(signal.SIG_SETMASK, held)'].map(at);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('R8 the self-signal hook is test-only: read once, sent once, and set by nothing in the tree', () => {
    expect(src.match(/os\.environ\.get\('CCD_LAND_PROBE_SELFSIGNAL'\)/g) ?? []).toHaveLength(1);
    expect(src.match(/\bos\.kill\(/g) ?? [], 'the one os.kill, in selfsignal').toHaveLength(1);
    expect(/^def selfsignal\([\s\S]*?\n\n\n/m.exec(src)?.[0] ?? '').toContain('os.kill(os.getpid(), signal.SIGTERM)');
    expect(headCode).not.toContain('SELFSIGNAL');
    // No unit, installer or other script anywhere in the repository names either test-only variable: every TRACKED
    // file is read (review 1140 A3), and the only holders are the probe, the tests and the wave's notes. The plan
    // names the self-test knob as its D-4334, so it may hold CCD_LAND_PROBE_SELFTEST, never the self-signal one.
    // This needs a git checkout (`git ls-files`), which every suite runner here is; an untracked file is out of its
    // scope by design (review 1143 A4). A tracked file it cannot read is a failure that names it (A3, `holdersIn`).
    const root = path.resolve(path.dirname(PROBE), '..');
    const tracked = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\0').filter(Boolean);
    expect(tracked.length, 'the tracked files').toBeGreaterThan(100);
    const allowed = (f: string): boolean => f === 'ccd/ccd-land-probe' || f.startsWith('server/test/')
      || f === 'docs/superpowers/plans/2026-10-27-landing-order-wave3b-conflict-radar/wave3b-notes.md';
    const signal = holdersIn(root, tracked, /CCD_LAND_PROBE_SELFSIGNAL/);
    const selftest = holdersIn(root, tracked, /CCD_LAND_PROBE_SELFTEST/);
    expect([...signal.unread, ...selftest.unread], 'a tracked file the scan could not read').toEqual([]);
    expect(signal.holders).toContain('ccd/ccd-land-probe');
    expect(signal.holders.filter((f) => !allowed(f)), 'a holder of CCD_LAND_PROBE_SELFSIGNAL').toEqual([]);
    // The probe itself holds the self-test knob (fix round 3's departure 2, the pin restored by review 1143).
    expect(selftest.holders).toContain('ccd/ccd-land-probe');
    expect(selftest.holders.filter((f) => !allowed(f) && f !== 'docs/superpowers/plans/2026-10-27-landing-order-wave3b-conflict-radar.md'),
      'a holder of CCD_LAND_PROBE_SELFTEST').toEqual([]);
  });

  it.skipIf(process.getuid?.() === 0)('R8b the holder scan fails closed: a file it cannot read is named, and only a file deleted from the work tree holds nothing (review 1143 A3)', () => {
    const dir = mkTmp('land-probe-r8-');
    const locked = path.join(dir, 'locked');
    fs.writeFileSync(path.join(dir, 'held'), 'CCD_LAND_PROBE_SELFSIGNAL\n');
    fs.writeFileSync(locked, 'CCD_LAND_PROBE_SELFSIGNAL\n');
    fs.chmodSync(locked, 0o000);
    try {
      const got = holdersIn(dir, ['held', 'locked', 'gone'], /CCD_LAND_PROBE_SELFSIGNAL/);
      expect(got.holders).toEqual(['held']);
      expect(got.unread, 'the file at mode 000').toEqual(['locked: EACCES']);
    } finally {
      fs.chmodSync(locked, 0o644);
    }
  });

  it('R9 every child the measuring code starts is followed by checkpoint(): only the closing rewrite and store_counts\' own body are exempt (fix round 2 scoped review I1)', () => {
    // A signal kills the child in flight; without the checkpoint right after it, its rc -9 would be read and written as
    // a measurement. Each site assigns the child's answer on one line, so a bare call or a returned one is a new form.
    // A checkpoint is a no-op under CLOSING, so in the before-first-write fallback it cannot stop a killed read: there
    // it is qualifying's rule (only rc 0 and rc 1 decide a row) that keeps a killed read from deciding the row (review
    // 1140 F1, held by the behaviour cases, not by this text pin).
    const lines = program.split('\n');
    const CALL = /\b(git_ro|gh_get|gh_pr_list|store_counts)\(/;
    let fn = '';
    const sites: string[] = [];
    lines.forEach((l, i) => {
      const d = /^def (\w+)\(/.exec(l);
      if (d) { fn = d[1]!; return; }
      if (!CALL.test(l) || /^\s*(#|def )/.test(l)) return;
      sites.push(fn);
      const indent = /^\s*/.exec(l)![0];
      const what = `${fn}: ${l.trim()}`;
      expect(l, what).toMatch(new RegExp(`^${indent}[\\w\\[\\]', ]+ = (git_ro|gh_get|gh_pr_list|store_counts)\\(`));
      if (fn === 'finish_probe' || fn === 'store_counts') return;   // the closing path, and the body checked at its call
      let next = lines[i + 1] ?? '';
      if (fn === 'qualifying') {
        // The call sits in a try whose except refuses and continues; the checkpoint is the first line after the try.
        const outer = indent.slice(4);
        next = lines.slice(i + 1).find((x) => x.startsWith(outer) && !x.startsWith(indent) && !/^\s*except\b/.test(x)) ?? '';
        expect(next.startsWith(`${outer}checkpoint()`), what).toBe(true);
        return;
      }
      expect(next.startsWith(`${indent}checkpoint()`), what).toBe(true);
    });
    expect(sites.sort()).toEqual(['fetch_into_scratch', 'fetch_into_scratch', 'fetch_into_scratch', 'fetch_into_scratch',
      'finish_probe', 'merge_answer', 'open_heads', 'probe_project', 'probe_project', 'qualifying', 'read_checks',
      'store_counts', 'walk_lineage', 'walk_lineage', 'walk_lineage']);
  });
});

const OUTPUT = '--output=/project/.git/config';

describe('ccd-land-probe: the git_ro self-test', () => {
  let h: CcdHarness | undefined;
  afterEach(() => {
    if (!h) return;
    const poison = ghPoisonAt(h.home);
    h.cleanup();
    h = undefined;
    expect(poison).toEqual([]);
  });

  it('S1 allows the plan\'s calls and refuses the rest, each by its own rule', () => {
    h = makeCcdHarness('land-probe-ro');
    const fx = makeLandFixture(h);
    // Every call the program makes, recorded by a git wrapper over a full run (rows, heads, a pair), is allowed.
    fx.addHead(1, { 'README.md': 'one\n' }, { branch: 'ws/alpha' });
    fx.addHead(2, { 'README.md': 'two\n' }, { branch: 'ws/beta' });
    fx.addRow('lane-a-proj-a-alpha', 'ws/alpha');
    fx.addRow('lane-a-proj-a-beta', 'ws/beta');
    fx.mergeBase('ws/alpha');   // a real merge, so the lineage walk makes every call it can
    fx.conf(fx.project, 'lineage=on\n');
    const log = path.join(h.home, 'git-argv.log');
    fx.wrapGit(`printf '%s\\t' "$@" >> '${log}'; printf '\\n' >> '${log}'`);
    expect(fx.run().status).toBe(0);
    expect(fx.readJson('probe').state).toBe('measured');
    const prefix = tuple('GIT_PREFIX');
    const fetchPrefix = tuple('FETCH_PREFIX');
    const calls: Array<[string, string[]]> = [];
    for (const line of fs.readFileSync(log, 'utf8').split('\n').filter(Boolean)) {
      let argv = line.split('\t').slice(0, -1);
      expect(argv.slice(0, prefix.length)).toEqual(prefix);
      argv = argv.slice(prefix.length);
      let where = 'scratch';
      if (argv[0] === '--no-optional-locks') { where = 'project'; argv = argv.slice(1); }
      expect(argv[0]).toBe('-C');
      argv = argv.slice(2);
      if (argv.slice(0, fetchPrefix.length).join('\t') === fetchPrefix.join('\t')) argv = argv.slice(fetchPrefix.length);
      if (argv[0] === 'init') argv = argv.slice(0, -1).concat('/scratch');
      calls.push([where, argv]);
    }
    const subs = new Set(calls.map(([w, a]) => `${w} ${a[0]}`));
    for (const want of ['project config', 'project count-objects', 'project ls-remote', 'project rev-parse', 'scratch init', 'scratch fetch', 'scratch rev-parse', 'scratch merge-tree', 'scratch rev-list', 'scratch merge-base']) {
      expect(subs, want).toContain(want);
    }
    const mine = fx.selftest(calls);
    expect(mine.status).toBe(0);
    expect(mine.stdout.split('\n').filter(Boolean)).toEqual(calls.map(() => 'allowed'));

    const refusals: Array<[string, string[], string]> = [
      ['project', ['fetch', 'x'], 'refused subcommand fetch'],
      ['project', ['init'], 'refused subcommand init'],
      ['project', ['-c', 'x=y', 'rev-parse'], 'refused subcommand -c'],
      ['project', ['config', 'remote.origin.url', 'x'], 'refused form config'],
      ['scratch', ['init', '-q', '--bare', '/elsewhere'], 'refused form init'],
      ['scratch', ['merge-tree', '-c', 'x=y', 'a', 'b'], 'refused option -c'],
      ['project', ['rev-parse', '-cfoo'], 'refused option -c'],
      ['scratch', ['fetch', '--upload-pack=x', 'u'], 'refused option --upload-pack'],
      ['scratch', ['fetch', '-u', 'x', 'u'], 'refused option -u'],
      ['project', ['rev-parse', '--git-dir=/tmp'], 'refused option --git-dir'],
      ['project', ['for-each-ref', '--format=%(refname)', '-C', '/'], 'refused option -C'],
      ['scratch', ['merge-tree', 'core.hooksPath', 'b'], 'refused key core.hooksPath'],
      // Layer 1 is an allowlist of forms (fix round 1, F2 and A9): a file-writing option, an abbreviation of a long
      // option and a filter-running cat-file option are each refused, on the project row and the scratch row alike.
      ['project', ['rev-list', OUTPUT, 'HEAD'], 'refused option --output'],
      ['scratch', ['rev-list', OUTPUT, 'HEAD'], 'refused option --output'],
      ['scratch', ['fetch', '--upload-pa=x', 'u'], 'refused option --upload-pa'],
      ['project', ['cat-file', '--textconv', 'HEAD:x'], 'refused option --textconv'],
      ['scratch', ['cat-file', '--textconv', 'HEAD:x'], 'refused option --textconv'],
      ['project', ['cat-file', '--filters', 'HEAD:x'], 'refused option --filters'],
      ['scratch', ['cat-file', '--filters', 'HEAD:x'], 'refused option --filters'],
      // One abbreviation of each long prefix the plan names (the short ones, -c -C -u, have none; their attached
      // forms are above and in the prefix rule).
      ['project', ['rev-parse', '--config-e=x=y'], 'refused option --config-e'],
      ['project', ['rev-parse', '--git-d=/x'], 'refused option --git-d'],
      ['project', ['rev-parse', '--work-t=/x'], 'refused option --work-t'],
      ['project', ['rev-parse', '--exe=x'], 'refused option --exe'],
      ['scratch', ['fetch', '--upload-pa=x', 'u'], 'refused option --upload-pa'],
      ['scratch', ['fetch', '--receive-p=x', 'u'], 'refused option --receive-p'],
      // An abbreviation of, or a value glued to, an option that IS allowed; an allowed option on the wrong row; a lone
      // dash; and a `--` where only the fetch has one.
      ['project', ['rev-parse', '--verif', 'x'], 'refused option --verif'],
      ['scratch', ['rev-list', '--paren', '-n', '1', 'x'], 'refused option --paren'],
      ['scratch', ['rev-list', '--parents=x', 'x'], 'refused option --parents'],
      ['project', ['rev-list', '--parents', 'x'], 'refused option --parents'],
      ['scratch', ['merge-tree', '--stdin', 'a', 'b'], 'refused option --stdin'],
      ['project', ['rev-parse', '-'], 'refused option -'],
      ['project', ['rev-parse', '--', 'x'], 'refused option --'],
    ];
    const out = fx.selftest(refusals.map(([w, a]) => [w, a]));
    expect(out.stdout.split('\n').filter(Boolean)).toEqual(refusals.map((r) => r[2]));
    // The refusals above are each one only that rule catches: a case the rule before it would answer is a different line.
    expect(fx.selftest([['scratch', ['init', '-q', '--bare', '/scratch']]]).stdout.trim()).toBe('allowed');
    // After the fetch's `--` git reads operands only, and the door refuses every element that starts with `-` there
    // (review 1125 item 6): a dash-led URL or refspec, and a second `--`, each answering `option <opt>`.
    const fetchHead = ['fetch', '--no-tags', '--no-write-fetch-head', '--no-recurse-submodules', '--'];
    expect(fx.selftest([
      ['scratch', [...fetchHead, '-odd-url', '+refs/heads/x:refs/probe/base']],
      ['scratch', [...fetchHead, 'u', '-odd=x']],
      ['scratch', [...fetchHead, 'u', '--']],
      ['scratch', [...fetchHead, 'u', '+refs/heads/x:refs/probe/base']],
    ]).stdout.split('\n').filter(Boolean)).toEqual(['refused option -odd-url', 'refused option -odd', 'refused option --', 'allowed']);
    // An option form is checked wherever its element stands (review 1125 item 7): an allowlisted one after an operand is
    // allowed, an unlisted one there is refused.
    expect(fx.selftest([
      ['project', ['rev-parse', 'x', '--verify']],
      ['scratch', ['merge-tree', 'a', 'b', '--write-tree']],
      ['project', ['rev-parse', 'x', '--output=y']],
      ['scratch', ['rev-list', 'x', '--output=y']],
    ]).stdout.split('\n').filter(Boolean)).toEqual(['allowed', 'allowed', 'refused option --output', 'refused option --output']);
    expect(fx.selftest([['project', ['config', '--get', 'remote.origin.url']], ['project', ['ls-remote', '--get-url', 'origin']]]).stdout.split('\n').filter(Boolean)).toEqual(['allowed', 'allowed']);
  });

  it('S1 reads no pause, takes no lock, and creates no file', async () => {
    h = makeCcdHarness('land-probe-ro');
    const fx = makeLandFixture(h);
    fx.pause('global');
    const home = h.home;
    const lock = path.join(home, '.ccrc', 'land-probe.lock');
    // The lock is HELD while the self-test prints every verdict: a self-test that took it (flock -n) would exit 0
    // without printing, and one that read the pause marker would stop at "paused".
    fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    const holder = spawn('flock', ['--no-fork', lock, 'sleep', '30'], { stdio: 'ignore' });
    try {
      const held = (): boolean => {
        try { execFileSync('flock', ['-n', lock, 'true']); return false; } catch { return true; }
      };
      expect(await until(held, 5000), 'the test never took the lock').toBe(true);
      const snap = (): string => [fx.tmp, fx.reg, path.join(home, '.ccrc')].map((d) => fs.readdirSync(d).sort().join(',')).join('|');
      const before = snap();
      const r = fx.selftest([['project', ['rev-parse', 'HEAD']], ['project', ['push']]]);
      expect(r.status).toBe(0);
      expect(r.stdout.split('\n').filter(Boolean)).toEqual(['allowed', 'refused subcommand push']);
      expect(held(), 'the lock is still the holder\'s').toBe(true);
      expect(snap()).toBe(before);
    } finally {
      holder.kill('SIGKILL');
    }
  });
});

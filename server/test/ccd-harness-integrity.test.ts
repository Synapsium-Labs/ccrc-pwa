/**
 * D-6051 (plan docs/superpowers/plans/2026-10-19-consolidation-w0-pins.md, Task C0k; ARCH-23 (#527)). The ccd test
 * harness says what it measures.
 *
 * 1. `stubFn` (`ccdStub.ts`) refuses to stub a function the sourced ccd does not define: exit 97, before the override.
 * 2. Every `_x() {` inside a test's string text names a function some shipped shell script defines (or the roster
 *    generator emits), or a test-local helper allow-listed below for the file that defines it. A stub of a function
 *    that no longer exists is a new, unused function, and the test around it measures nothing: `_dispatch_compact`
 *    and `_ws_idle_ok` were two, and this scanner is what found them.
 * 3. Every python heredoc in a shipped shell script (`pythonHeredocs`, whose opener defines the count) parses and
 *    compiles under the host's real python3, and the count is pinned.
 *
 * Every ccd row runs in a fixture HOME (`makeCcdHarness`). Nothing here edits a shipped file.
 *
 * KNOWN WIDTH (the scanner): a name counts as shipped when ANY shipped shell script defines it, not only the script
 * the test sources; a stub written through `stubFn` or built across a `${…}` is not seen (stubFn guards itself); a
 * definition is read by text (`name()` at a line start, optionally after `function`), so a name defined only through
 * `eval` is not shipped.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stringPieces } from './scan/parse.js';
import { STUB_SEAM_GONE, stubFn } from './ccdStub.js';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { pythonHeredocs } from './docsHelperPy.js';
import { REAL_PYTHON3 } from './ccdDocsHelpers.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEST_DIR = path.join(REPO, 'server', 'test');

// ── the shipped shell scripts ────────────────────────────────────────────────

const SHEBANG = /^#!.*\b(?:bash|sh)\b/;

/** Every shell script the repository ships: under `ccd/` and `deploy/`, plus the root `install.sh`. A file is shell
 *  by a `.sh` name or a bash/sh shebang. Repository-relative paths, sorted. */
function shippedShellScripts(): string[] {
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
    if (!e.isFile()) return [];
    if (e.name.endsWith('.sh')) return [p];
    const head = fs.readFileSync(p).subarray(0, 200).toString('utf8').split('\n')[0] ?? '';
    return SHEBANG.test(head) ? [p] : [];
  });
  return [...walk(path.join(REPO, 'ccd')), ...walk(path.join(REPO, 'deploy')), path.join(REPO, 'install.sh')]
    .map((p) => path.relative(REPO, p)).sort();
}

/** The roster generator: it writes `~/.ccrc/accounts.sh`, whose `_ccrc_*` functions ccd sources at start. */
const ROSTER_EMITTER = 'shared/generate.mjs';

const DEF = /^[ \t]*(?:function[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*\(\)/gm;

/** Every function name a shipped shell script defines, or the roster generator emits. */
function shippedFunctions(): Set<string> {
  const out = new Set<string>();
  for (const rel of [...shippedShellScripts(), ROSTER_EMITTER]) {
    for (const m of fs.readFileSync(path.join(REPO, rel), 'utf8').matchAll(DEF)) out.add(m[1]!);
  }
  return out;
}

// ── the stub scanner ─────────────────────────────────────────────────────────

/** A shell function definition `_x() {` in string text: the name starts with `_` and stands at a word start. */
const OVERRIDE = /(?:^|[\s;{(&|])(_[A-Za-z0-9_]+)[ \t]*\(\)[ \t]*\{/g;

interface Override { file: string; line: number; name: string }

/** Every `_x() {` in the string pieces of one TypeScript source. */
function overridesIn(text: string, file: string): Override[] {
  return stringPieces(text, file).flatMap((p) => [...p.text.matchAll(OVERRIDE)].map((m) => ({
    file, line: p.line + (p.text.slice(0, m.index).match(/\n/g) ?? []).length, name: m[1]!,
  })));
}

/** Every `.ts` file under `server/test` (fixtures included), repository-relative, sorted. */
function testSources(): string[] {
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
    return e.isFile() && /\.tsx?$/.test(e.name) ? [p] : [];
  });
  return walk(TEST_DIR).map((p) => path.relative(TEST_DIR, p)).sort();
}

/**
 * Test-local helpers: functions a test defines for its own use (a fixture body a scanner reads, a probe it calls, a
 * fake check a doctor runs), never a stub of a shipped function. Keyed by the file under `server/test` that defines
 * them. Exact both ways: an entry whose file no longer defines it, or that a shipped script now defines, is stale.
 */
const TEST_LOCAL_HELPERS: Readonly<Record<string, readonly string[]>> = {
  // This suite's own CONTROL plants these three in strings.
  'ccd-harness-integrity.test.ts': ['_method', '_nope', '_tmpl'],
  'ccd-collect-race-forge.test.ts': ['_race_swap'],
  'ccd-die-containment.test.ts': ['_c', '_f', '_g', '_leaf', '_middle', '_top', '_v'],
  'ccd-leaf-root-newline.test.ts': ['_fp', '_fpp'],
  'ccd-lifecycle-emit.test.ts': ['_lc_obs_probe'],
  'ccd-limit-banner.test.ts': ['_leaky'],
  'ccd-orphan-audit.test.ts': ['_fpp'],
  'ccd-path-users-esrch.test.ts': ['_fpp'],
  'ccd-path-users-many.test.ts': ['_fpp'],
  'ccd-path-users.test.ts': ['_fpp'],
  // Each retire-verdict cell's own driver: `__cell` takes the lock and seeds a verb's locals, `__inner` is the body it
  // runs under `_ws_reclaim_contained`.
  'ccd-retire-verdicts.test.ts': ['__cell', '__inner'],
  'ccd-route-apply.test.ts': ['_tmux_recording'],
  'ccd-route-tick.test.ts': ['_advance'],
  'ccd-tick-diet-clock-seam.test.ts': ['_advance'],
  'ccd-tick-diet-equivalence-static.test.ts': ['_diet_raw', '_diet_v', '_doc', '_frob_to', '_has_it', '_lc_like', '_user'],
  'ccd-tick-diet-seams.test.ts': ['__memo_scope'],
  'ccd-ws-collect-loose.test.ts': ['_fpp'],
  'ccd-ws-expire-ladder.test.ts': ['_fp'],
  'ccd-ws-orphan-verb.test.ts': ['_fpp'],
  // The tick diet's runner and row builders, which the two per-locale files share.
  'ccdTickDietRunner.ts': ['__diet_caller', '__diet_side', '__hm2', '__lfc', '__lfx', '__lj6', '__rg4', '__rt', '__rt_snap',
    '__seq'],
  // The cadence census's fixture tree: each job function plants one plist shape a query must see or must skip.
  'census-w8/cadence.test.ts': ['_ccd_job', '_elsewhere', '_job_accepted', '_job_assigned_in_another_function',
    '_job_calendar', '_job_foreign', '_job_inline', '_job_literal', '_job_unassigned_local'],
  'ccrc-doctor-codex.test.ts': ['_check_failed', '_check_warned', '_fix_failed', '_fix_warned'],
  'ccrc-doctor-fleet.test.ts': ['_check_alpha', '_check_beta', '_check_boom', '_check_dual', '_check_gamma', '_check_liar',
    '_check_mute', '_check_nothing', '_check_omega', '_check_sneak', '_check_weird'],
  'ccrc-models.test.ts': ['_fk_cfg', '_fk_log', '_fk_probe', '_fk_rc', '_fk_ret'],
  // The redactor census's fixture function: a python table in a bash heredoc, which the scanner must name.
  'census-w5/redactors.test.ts': ['_fx_py'],
  'collectFixture.ts': ['_t'],
  'pool-name-parity.test.ts': ['_doctor_omits'],
  'pools-existence-pairing.test.ts': ['_fixture_latest', '_fixture_message', '_fixture_mixed', '_fixture_reader',
    '_fixture_unrelated'],
  'session-hook.test.ts': ['_ct_read_real', '_evil_sweep', '_fx_helper', '_hook_compact_rollback_set'],
};

/** The overrides that name neither a shipped function nor an allow-listed helper of their own file. */
function unresolved(all: readonly Override[], shipped: ReadonlySet<string>): Override[] {
  return all.filter((o) => !shipped.has(o.name) && !(TEST_LOCAL_HELPERS[o.file] ?? []).includes(o.name));
}

describe('stubFn refuses a seam that is gone (D-6051)', () => {
  let h: CcdHarness;
  beforeEach(() => { h = makeCcdHarness('ccrc-ccd-stubfn-'); });
  afterEach(() => { h.cleanup(); });

  /** `h.sh`, which throws on a non-zero exit, reporting the exit code and both streams instead. */
  const run = (snippet: string): { code: number; out: string; err: string } => {
    try { return { code: 0, out: h.sh(snippet), err: '' }; } catch (e) {
      const x = e as { status?: number; stdout?: string | Buffer; stderr?: string | Buffer };
      return { code: x.status ?? -1, out: String(x.stdout ?? '').trim(), err: String(x.stderr ?? '') };
    }
  };

  it('a stub of a function ccd defines replaces it', () => {
    const r = run(`${stubFn('_ws_status', 'echo stubbed')} _ws_status any-id`);
    expect(r.code).toBe(0);
    expect(r.out).toBe('stubbed');
  });

  it('a stub of a name ccd does not define exits 97 before the override, and says which', () => {
    const r = run(`${stubFn('_nope', 'echo reached')} _nope; echo after`);
    expect(r.code).toBe(STUB_SEAM_GONE);
    expect(r.out, 'nothing after the guard runs').toBe('');
    expect(r.err).toContain('ccd defines no function _nope');
  });

  it('refuses a name bash cannot define, and an empty body', () => {
    expect(() => stubFn('_x; rm', ':')).toThrow(/not a bash function name/);
    expect(() => stubFn('_x', ' ; ')).toThrow(/empty body/);
  });
});

describe('every `_x() {` a test writes names a shipped function or a listed test-local helper (D-6051)', () => {
  it('the scanner reads string text only, and finds a planted `_nope() {` (CONTROL)', () => {
    const src = [
      'class C { _method() { return 1; } }',
      'const a = \'_ws_status() { echo idle; }; _nope() { :; };\';',
      'const b = `x; _tmpl() { ${1} }`;',
    ].join('\n');
    const found = overridesIn(src, 'planted.test.ts').map((o) => `${o.name}@${o.line}`);
    expect(found).toEqual(['_ws_status@2', '_nope@2', '_tmpl@3']);
    expect(unresolved(overridesIn(src, 'planted.test.ts'), new Set(['_ws_status'])).map((o) => o.name))
      .toEqual(['_nope', '_tmpl']);
  });

  it('the shipped set is read, not assumed (CONTROL)', () => {
    const scripts = shippedShellScripts();
    expect(scripts).toContain('ccd/ccd');
    expect(scripts).toContain('ccd/ccrc');
    expect(scripts).toContain('deploy/deploy.sh');
    const fns = shippedFunctions();
    for (const n of ['_auto_compact_check', '_ws_status', '_ws_archive_manifest', '_ccrc_pool']) expect(fns).toContain(n);
    expect(fns.size).toBeGreaterThan(1000);
  });

  it('no override names a function nothing ships', () => {
    const shipped = shippedFunctions();
    const all = testSources().flatMap((f) => overridesIn(fs.readFileSync(path.join(TEST_DIR, f), 'utf8'), f));
    expect(all.length, 'too few overrides read: the scanner has gone stale').toBeGreaterThan(1000);
    expect(unresolved(all, shipped).map((o) => `${o.file}:${o.line} ${o.name}`),
      'a stub of a function no shipped script defines measures nothing: re-point it at the function that does the '
      + 'work, or, if it is a helper the test defines for itself, list it in TEST_LOCAL_HELPERS under its file')
      .toEqual([]);
  });

  it('every TEST_LOCAL_HELPERS entry is still defined in its file, and is not a shipped function', () => {
    const shipped = shippedFunctions();
    const stale = Object.entries(TEST_LOCAL_HELPERS).flatMap(([file, names]) => {
      const p = path.join(TEST_DIR, file);
      const here = fs.existsSync(p) ? new Set(overridesIn(fs.readFileSync(p, 'utf8'), file).map((o) => o.name)) : new Set();
      return names.filter((n) => !here.has(n) || shipped.has(n)).map((n) => `${file} ${n}`);
    });
    expect(stale).toEqual([]);
  });
});

describe('every python heredoc a shipped shell script holds parses and compiles (D-6051)', () => {
  /** The count `pythonHeredocs` finds over the shipped shell scripts, measured on this tree: eight in ccd/ccd, two in
   *  ccd-graph-sweep, one in ccgpt-runtime, three in ccrc-models-probe. */
  const PINNED_COUNT = 14;

  const all = (): { where: string; tag: string; body: string }[] => shippedShellScripts().flatMap((rel) =>
    pythonHeredocs(fs.readFileSync(path.join(REPO, rel), 'utf8')).map((d) => ({ where: `${rel}:${d.line}`, ...d })));

  it(`finds exactly ${PINNED_COUNT}, the docs helper among them`, () => {
    const found = all();
    expect(found.map((d) => d.where), 'a new or removed python heredoc moves this count; update it with the change')
      .toHaveLength(PINNED_COUNT);
    expect(found.filter((d) => d.tag === 'DOCS_PY')).toHaveLength(1);
  });

  it('each one is valid python: ast.parse, then compile', () => {
    const prog = [
      'import ast, json, sys',
      'out = []',
      'for d in json.load(sys.stdin):',
      '    try:',
      '        ast.parse(d["body"], filename=d["where"])',
      '        compile(d["body"], d["where"], "exec")',
      '    except SyntaxError as e:',
      '        out.append("%s: %s (line %s)" % (d["where"], e.msg, e.lineno))',
      'print(json.dumps(out))',
    ].join('\n');
    const found = all();
    // A contained spawn like every other ccd-adjacent one: a temp HOME and no inherited environment beyond PATH.
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ccrc-heredoc-parse-'));
    let r;
    try {
      r = spawnSync(REAL_PYTHON3, ['-I', '-c', prog], {
        input: JSON.stringify(found), encoding: 'utf8', timeout: 60_000,
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home },
      });
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout) as string[]).toEqual([]);
  });

  it('an opener whose terminator never comes throws rather than reading to the end (CONTROL)', () => {
    expect(() => pythonHeredocs("x() {\n  python3 - <<'PY'\nprint(1)\n}\n")).toThrow(/never closes/);
    expect(pythonHeredocs("# python3 - <<'PY' in a comment\necho\n")).toEqual([]);
    expect(pythonHeredocs("python3 - <<'PY'\nprint(1)\nPY\n")).toEqual([{ line: 1, tag: 'PY', body: 'print(1)\n' }]);
  });
});

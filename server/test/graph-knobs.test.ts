// D-7348 (graph revision 2, task GR2; spec §5): the graph sweep's settings are ccrc settings. They join the one
// `CCRC_SETTINGS=(…)` list in ccd/ccrc, `_graph_knobs [file]` reads each through ccrc's one reader `_ccrc_knob` and
// prints `KEY<US>default<US>value<US>from` through `_test_knob_say`, and ccd/graph-resolve's `_gr_knobs` validates
// them, the split `_test_knobs` and ccd/ccrc-test already use: a value that is not its key's shape keeps the default
// and is reported in GK_WARN with the key, the value and where it came from, so a typo never removes a bound.
//
// Spec §11's N13 settings rows: a key set in the fixture ccrc.env is what `_gr_knobs` returns; an environment value
// wins in the sweep's mode and is ignored in `file` mode (the doctor's); a bad value of every key keeps its default
// and names its source; the defaults table equals spec §5.4 row by row. Plus the threshold-literal scanner of the
// plan's global constraints: no numeric literal compared against a graph quantity in ccd/ccd-graph-sweep,
// ccd/graph-build or ccd/graph-resolve outside the defaults table (which lives in ccd/ccrc's `_graph_knobs`, not
// scanned). On this base the sweep still carries its own literals; they are the KNOWN set, which GR4 empties.
//
// Every run sources the real ccd/ccrc and ccd/graph-resolve in a fixture HOME through one fixed driver script; the
// paths and the mode are its arguments, never spliced into the script.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';

removeTmpFixturesEachTest();

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CCRC = path.join(REPO, 'ccd', 'ccrc');
const RESOLVE = path.join(REPO, 'ccd', 'graph-resolve');
const SPEC = 'docs/superpowers/specs/2026-10-28-graphify-shared-graphs-design.md';
const read = (rel: string): string => readFileSync(path.join(REPO, rel), 'utf8');

/** The one driver: $1 ccd/ccrc, $2 ccd/graph-resolve, $3 `raw` (print `_graph_knobs`' lines) or the mode for
 *  `_gr_knobs` (empty: the sweep's, `file`: the doctor's). Prints `GK<TAB>key<TAB>value` and `WARN<TAB>line`. */
const DRIVER = `. "$1" || exit 90
if [ "$3" = raw ]; then _graph_knobs; exit $?; fi
. "$2" || exit 91
_gr_knobs \${3:+"$3"} || exit 92
for k in "\${!GK[@]}"; do printf 'GK\\t%s\\t%s\\n' "$k" "\${GK[$k]}"; done
for w in "\${GK_WARN[@]}"; do printf 'WARN\\t%s\\n' "$w"; done
`;

interface Box { home: string; env: NodeJS.ProcessEnv }
/** A fixture box: `settings` is its ~/.ccrc/ccrc.env, one `KEY=value` line each (quoted when it holds a space); `extra` is the process environment. */
function box(settings: Record<string, string> = {}, extra: NodeJS.ProcessEnv = {}): Box {
  const home = mkTmp('graph-knobs-');
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  if (Object.keys(settings).length > 0)
    // A value with a space is double-quoted, as an operator must write it (a bare one is a command on macOS's bash reading).
    writeFileSync(path.join(home, '.ccrc', 'ccrc.env'), Object.entries(settings).map(([k, v]) => `${k}=${v.includes(' ') ? `"${v}"` : v}\n`).join(''));
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('CCRC_')) env[k] = v;
  Object.assign(env, { HOME: home }, extra);
  return { home, env };
}

interface Knobs { gk: Record<string, string>; warn: string[]; status: number | null; stderr: string }
function gr(b: Box, mode: '' | 'file' = ''): Knobs {
  const r = spawnSync('bash', ['-c', DRIVER, 'graph-knobs-driver', CCRC, RESOLVE, mode], { env: b.env, encoding: 'utf8', cwd: b.home, timeout: 60000 });
  const gk: Record<string, string> = {};
  const warn: string[] = [];
  for (const l of (r.stdout ?? '').split('\n')) {
    const f = l.split('\t');
    if (f[0] === 'GK') gk[f[1]] = f.slice(2).join('\t');
    else if (f[0] === 'WARN') warn.push(f.slice(1).join('\t'));
  }
  return { gk, warn, status: r.status, stderr: r.stderr ?? '' };
}
/** `_graph_knobs`' own lines, split on the unit separator. */
function raw(b: Box): string[][] {
  const r = spawnSync('bash', ['-c', DRIVER, 'graph-knobs-driver', CCRC, RESOLVE, 'raw'], { env: b.env, encoding: 'utf8', cwd: b.home, timeout: 60000 });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout.split('\n').filter((l) => l !== '').map((l) => l.split('\x1f'));
}

/** Spec §5.4's table, in its order: key and default as the spec writes them (`empty` is the empty string). */
function specTable(): { key: string; def: string }[] {
  const text = read(SPEC);
  const start = text.indexOf('### 5.4 Keys');
  const end = text.indexOf('\nRetired:', start);
  expect(start, 'spec §5.4 is there').toBeGreaterThan(0);
  const out: { key: string; def: string }[] = [];
  for (const m of text.slice(start, end).matchAll(/^\| `(CCRC_GRAPH_[A-Z0-9_]+)` \| ([^|]*) \|/gm)) {
    const d = m[2].trim().replace(/^`(.*)`$/, '$1');
    out.push({ key: m[1], def: d === 'empty' ? '' : d });
  }
  return out;
}
const SPEC_KEYS = specTable().map((r) => r.key);
const specDefault = (home: string, key: string): string =>
  specTable().find((r) => r.key === key)!.def.replace('$HOME', home);

/** A value of each key that is not its shape, and one that is (a boundary where the shape has one). */
const BAD: Record<string, string> = {
  CCRC_GRAPH_STORE: 'relative/graphs',
  CCRC_GRAPH_SOURCE_REF: 'origin/../main',
  CCRC_GRAPH_REPOS_EXCLUDE: 'project-a',
  CCRC_GRAPH_REFRESH_SECS: '0',
  CCRC_GRAPH_FETCH_SECS: '-1',
  CCRC_GRAPH_FULL_REBUILD_SECS: '1d',
  CCRC_GRAPH_INCREMENTAL_MAX_FILES: 'many',
  CCRC_GRAPH_FULL_FAIL_MAX: '0',
  CCRC_GRAPH_FAIL_BACKOFF_SECS: '6h',
  CCRC_GRAPH_BUDGET: '0',
  CCRC_GRAPH_BUILD_TIMEOUT: '10m',
  CCRC_GRAPH_SLOT_WAIT_SECS: '0',
  CCRC_GRAPH_BUILD_NICE: '20',
  CCRC_GRAPH_MAX_WORKERS: '100',
  CCRC_GRAPH_MAX_SHRINK_PCT: '101',
  CCRC_GRAPH_KEEP_BUILDS: '0',
  CCRC_GRAPH_BUILD_GRACE_SECS: '1.5',
  CCRC_GRAPH_MIGRATE_BUDGET: '-3',
  CCRC_GRAPH_HOOKSTATE_FRESH_SECS: '0',
  CCRC_GRAPH_GATE_MAX_DIFF_PCT: '25%',
  CCRC_GRAPH_GATE_MAX_DENIALS: 'three',
  CCRC_GRAPH_CARD_DIFF_LIST_MAX: '020',
};
const GOOD: Record<string, string> = {
  CCRC_GRAPH_STORE: '/srv/graphs',
  CCRC_GRAPH_SOURCE_REF: 'origin/main',
  CCRC_GRAPH_REPOS_EXCLUDE: 'project-a-0123abcd lane-a-89abcdef',
  CCRC_GRAPH_REFRESH_SECS: '1',
  CCRC_GRAPH_FETCH_SECS: '0',
  CCRC_GRAPH_FULL_REBUILD_SECS: '43200',
  CCRC_GRAPH_INCREMENTAL_MAX_FILES: '0',
  CCRC_GRAPH_FULL_FAIL_MAX: '1',
  CCRC_GRAPH_FAIL_BACKOFF_SECS: '3600',
  CCRC_GRAPH_BUDGET: '1',
  CCRC_GRAPH_BUILD_TIMEOUT: '1200',
  CCRC_GRAPH_SLOT_WAIT_SECS: '1',
  CCRC_GRAPH_BUILD_NICE: '19',
  CCRC_GRAPH_MAX_WORKERS: '99',
  CCRC_GRAPH_MAX_SHRINK_PCT: '100',
  CCRC_GRAPH_KEEP_BUILDS: '1',
  CCRC_GRAPH_BUILD_GRACE_SECS: '60',
  CCRC_GRAPH_MIGRATE_BUDGET: '0',
  CCRC_GRAPH_HOOKSTATE_FRESH_SECS: '1',
  CCRC_GRAPH_GATE_MAX_DIFF_PCT: '0',
  CCRC_GRAPH_GATE_MAX_DENIALS: '0',
  CCRC_GRAPH_CARD_DIFF_LIST_MAX: '0',
};

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The GK_WARN line of the plan's contract: `<KEY>: '<value>' from <source> is not <shape>; using <default>`. */
const warnRe = (key: string, value: string, source: string, def: string): RegExp =>
  new RegExp('^' + escapeRe(`${key}: '${value}' from ${source} is not `) + '.+' + escapeRe(`; using ${def === '' ? "''" : def}`) + '$');

// ── the threshold-literal scanner ─────────────────────────────────────────
// A numeric literal compared against a quantity, in a code line (a line whose first non-blank is `#` is a comment;
// a trailing ` # …` is dropped): an expansion's default or fallback in any spelling (`:=N`, `=N`, `:-N`, `-N`, N bare
// or quoted; in a comparison or outside one, so a default cannot come back as `"${GK[KEY]:-200}"`), a `[ … -lt|-le|-gt|-ge|-eq|-ne N ]` test with N on either
// side, or a `<`, `<=`, `>`, `>=`, `==`, `!=` against N inside `(( … ))`, found by a balanced-paren match so a
// `$(…)` or `$((…))` operand does not hide it. Not a threshold: 0 and 1 (emptiness, presence, a first item), and an
// exit status (`$?`, `$rc`, a name ending in `rc`, or its fallback) compared with a code such as timeout's 124.
const SCANNED = ['ccd/ccd-graph-sweep', 'ccd/graph-build', 'ccd/graph-resolve'] as const;
const isStatus = (operand: string): boolean => /^"?\$\{?(\?|[A-Za-z_]*rc)(:-[0-9]+)?\}?"?$/.test(operand);
const isThreshold = (n: string): boolean => /^\d+$/.test(n) && Number(n) > 1;
/** The index of the `)` that balances the `(` at `i` (the line's end when it never closes). */
function closeOf(l: string, i: number): number {
  let depth = 0;
  for (let j = i; j < l.length; j++) {
    if (l[j] === '(') depth++;
    else if (l[j] === ')' && --depth === 0) return j;
  }
  return l.length;
}
/** The bodies of the outermost `(( … ))` groups on a line, each to its balanced close, with every command
 *  substitution `$( … )` in them blanked to `_`: its `2>/dev/null` is a redirection, not a comparison. */
function arithBodies(l: string): string[] {
  const out: string[] = [];
  for (let i = l.indexOf('(('); i >= 0; i = l.indexOf('((', i)) {
    const j = closeOf(l, i);
    let body = l.slice(i + 2, j - 1);
    for (let k = body.search(/\$\((?!\()/); k >= 0; k = body.search(/\$\((?!\()/))
      body = body.slice(0, k) + '_' + body.slice(closeOf(body, k + 1) + 1);
    out.push(body);
    i = j + 1;
  }
  return out;
}
function thresholdLiterals(text: string): string[] {
  const out: string[] = [];
  for (const raw0 of text.split('\n')) {
    if (/^\s*#/.test(raw0)) continue;
    const l = raw0.replace(/\s#\s.*$/, '');
    let hit = false;
    // every default spelling an expansion has: `:-N`, `-N`, `:=N`, `=N`, with N bare or in matching quotes
    for (const m of l.matchAll(/\$\{([^{}]*?):?[-=](["']?)(\d+)\2\}/g)) if (!isStatus('$' + m[1]) && isThreshold(m[3])) hit = true;
    for (const m of l.matchAll(/(\S+)\s+-(?:lt|le|gt|ge|eq|ne)\s+(\S+)/g)) {
      const a = m[1].replace(/^"|"$/g, '');
      const b = m[2].replace(/^"|"$/g, '');
      if (isStatus(m[1]) || isStatus(m[2])) continue;
      if (isThreshold(a) || isThreshold(b)) hit = true;
    }
    for (const body of arithBodies(l))
      for (const c of body.matchAll(/(\S+)\s*(?:<=|>=|==|!=|<|>)\s*(\S+)/g)) {
        if (isStatus(c[1]) || isStatus(c[2])) continue;
        if (isThreshold(c[1]) || isThreshold(c[2])) hit = true;
      }
    if (hit) out.push(l.trim());
  }
  return out;
}
/** Today's literals in the sweep: its five `:=` defaults at the top, the hookstate freshness default above
 *  `_gs_busy`, and the breach list's five-name cut. GR4 moves the defaults to `_graph_knobs` and takes this to []. */
const KNOWN: Record<(typeof SCANNED)[number], string[]> = {
  'ccd/ccd-graph-sweep': [
    ': "${CCRC_GRAPH_BUILD_TIMEOUT:=600}"',
    ': "${CCRC_GRAPH_BUDGET:=8}"',
    ': "${CCRC_GRAPH_MAX_WORKERS:=4}"',
    ': "${CCRC_GRAPH_STALE_ESCAPE_COMMITS:=20}"',
    ': "${CCRC_GRAPH_STALE_ESCAPE_SECS:=21600}"',
    ': "${CCRC_GRAPH_HOOKSTATE_FRESH_SECS:=1800}"',
    '[ "${breach_n:-0}" -gt 5 ] && more="(+$((breach_n - 5)) more)"',
  ],
  'ccd/graph-build': [],
  'ccd/graph-resolve': [],
};

describe('graph settings: _graph_knobs reads them through _ccrc_knob, _gr_knobs validates them (D-7348, spec §5)', () => {
  it('CCRC_SETTINGS holds the 22 graph keys of spec §5.4, in its order, and _graph_knobs prints one line per key in that order', () => {
    expect(SPEC_KEYS).toHaveLength(22);
    const m = /^CCRC_SETTINGS=\(([^)]*)\)$/m.exec(read('ccd/ccrc'));
    const settings = m ? m[1].split(' ').filter((w) => w !== '') : [];
    expect(settings.filter((s) => s.startsWith('CCRC_GRAPH_')), 'the graph keys of CCRC_SETTINGS').toEqual(SPEC_KEYS);
    expect(settings, 'counted exit: CCRC_SETTINGS 21 -> 43 (wave 29 added four)').toHaveLength(43);
    expect(raw(box()).map((f) => f[0])).toEqual(SPEC_KEYS);
  });

  it('the defaults table equals spec §5.4 row by row', () => {
    const b = box();
    const rows = raw(b);
    expect(rows.map((f) => [f[0], f[1]])).toEqual(specTable().map((r) => [r.key, r.def.replace('$HOME', b.home)]));
    // No ccrc.env, no environment: every value is its default, from `default`.
    expect(rows.map((f) => [f[0], f[2], f[3]])).toEqual(rows.map((f) => [f[0], f[1], 'default']));
  });

  it('the three kept keys keep the defaults the sweep reads today', () => {
    const sweep = read('ccd/ccd-graph-sweep');
    const today = (k: string): string => new RegExp(': "\\$\\{' + k + ':=(\\d+)\\}"').exec(sweep)?.[1] ?? '(absent)';
    const b = box();
    for (const k of ['CCRC_GRAPH_BUILD_TIMEOUT', 'CCRC_GRAPH_MAX_WORKERS', 'CCRC_GRAPH_HOOKSTATE_FRESH_SECS'])
      expect(specDefault(b.home, k), k).toBe(today(k));
    // Counted exit: the graph keys read by `: "${…:=…}"` lines stay at 6 until GR4 takes them to 0.
    expect(sweep.split('\n').filter((l) => /^\s*: "\$\{CCRC_GRAPH_[A-Z0-9_]+:=/.test(l))).toHaveLength(6);
  });

  it('a key in the fixture ccrc.env is what _gr_knobs returns, in both modes, with no warning', () => {
    const b = box(GOOD);
    for (const mode of ['', 'file'] as const) {
      const k = gr(b, mode);
      expect(k.status, k.stderr).toBe(0);
      expect(k.warn, `mode ${mode || 'sweep'}`).toEqual([]);
      expect(k.gk, `mode ${mode || 'sweep'}`).toEqual(GOOD);
    }
  });

  it('with no ccrc.env every key is its spec default and nothing is warned', () => {
    const b = box();
    const k = gr(b);
    expect(k.status, k.stderr).toBe(0);
    expect(k.warn).toEqual([]);
    expect(k.gk).toEqual(Object.fromEntries(SPEC_KEYS.map((key) => [key, specDefault(b.home, key)])));
  });

  it('an environment value wins in the sweep\'s mode and is ignored in file mode', () => {
    const b = box({ CCRC_GRAPH_BUDGET: '7', CCRC_GRAPH_STORE: '/srv/file-store' }, { CCRC_GRAPH_BUDGET: '5', CCRC_GRAPH_STORE: '/srv/env-store', CCRC_GRAPH_KEEP_BUILDS: '3' });
    const sweep = gr(b, '');
    expect(sweep.status, sweep.stderr).toBe(0);
    expect([sweep.gk['CCRC_GRAPH_BUDGET'], sweep.gk['CCRC_GRAPH_STORE'], sweep.gk['CCRC_GRAPH_KEEP_BUILDS']]).toEqual(['5', '/srv/env-store', '3']);
    const file = gr(b, 'file');
    expect(file.status, file.stderr).toBe(0);
    expect([file.gk['CCRC_GRAPH_BUDGET'], file.gk['CCRC_GRAPH_STORE'], file.gk['CCRC_GRAPH_KEEP_BUILDS']]).toEqual(['7', '/srv/file-store', '2']);
    expect([...sweep.warn, ...file.warn]).toEqual([]);
  });

  it('the bad-value table covers every key, and every good value is good', () => {
    expect(Object.keys(BAD).sort()).toEqual([...SPEC_KEYS].sort());
    expect(Object.keys(GOOD).sort()).toEqual([...SPEC_KEYS].sort());
  });

  it.each(['environment', 'file'] as const)('a bad value of every key, set in the %s, keeps its default and is named in GK_WARN with its source', (where) => {
    const b = where === 'environment' ? box({}, BAD) : box(BAD);
    const source = where === 'environment' ? 'the environment' : '~/.ccrc/ccrc.env';
    const k = gr(b);
    expect(k.status, k.stderr).toBe(0);
    expect(k.gk).toEqual(Object.fromEntries(SPEC_KEYS.map((key) => [key, specDefault(b.home, key)])));
    expect(k.warn, 'one warning per key').toHaveLength(SPEC_KEYS.length);
    for (const key of SPEC_KEYS) {
      const re = warnRe(key, BAD[key], source, specDefault(b.home, key));
      expect(k.warn.filter((w) => re.test(w)), `${key}: ${re}`).toHaveLength(1);
    }
  });

  it('a ccrc.env that cannot be read keeps every default and says why, once per key', () => {
    const b = box();
    mkdirSync(path.join(b.home, '.ccrc', 'ccrc.env'));
    const k = gr(b, 'file');
    expect(k.status, k.stderr).toBe(0);
    expect(k.gk).toEqual(Object.fromEntries(SPEC_KEYS.map((key) => [key, specDefault(b.home, key)])));
    expect(k.warn).toHaveLength(SPEC_KEYS.length);
    for (const w of k.warn) expect(w).toMatch(/^CCRC_GRAPH_[A-Z0-9_]+ cannot be measured: ~\/\.ccrc\/ccrc\.env is there but cannot be read; using .*$/);
  });

  it('ccd/graph-resolve refuses to be run rather than sourced', () => {
    const r = spawnSync('bash', [RESOLVE], { env: box().env, encoding: 'utf8', timeout: 30000 });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/source/);
    expect(read('ccd/graph-resolve').split('\n')[0]).toBe('#!/usr/bin/env bash');
  });

  it('deploy/ccrc.env.example lists every graph key commented out at its default under a "graph sweep" heading', () => {
    const lines = read('deploy/ccrc.env.example').split('\n');
    const head = lines.findIndex((l) => /^#.*\bgraph sweep\b/i.test(l));
    expect(head, 'a "graph sweep" heading').toBeGreaterThanOrEqual(0);
    // ccrc.env expands nothing (systemd's EnvironmentFile= model), so the store's line is the empty value, which reads
    // the default; every other line spells its default.
    const b = box();
    const found = lines.slice(head).filter((l) => /^# CCRC_GRAPH_[A-Z0-9_]+=/.test(l));
    expect(found).toEqual(SPEC_KEYS.map((key) => `# ${key}=${key === 'CCRC_GRAPH_STORE' ? '' : specDefault(b.home, key)}`));
  });

  it('the threshold-literal scanner: no numeric literal compared against a graph quantity outside the defaults table, but the known set', () => {
    const scanned = SCANNED.filter((f) => existsSync(path.join(REPO, f)));
    expect(scanned, 'the sweep and the resolver are scanned').toEqual(expect.arrayContaining(['ccd/ccd-graph-sweep', 'ccd/graph-resolve']));
    for (const f of scanned) expect(thresholdLiterals(read(f)), f).toEqual(KNOWN[f]);
  });

  it('the scanner itself: it sees a literal threshold, an expansion\'s fallback default (with or without the colon, quoted or bare) and a nested-paren arithmetic test, and passes presence tests, exit statuses and a setting', () => {
    expect(thresholdLiterals([
      '[ "$changed" -gt 200 ] && full=1',
      'if (( share > 25 )); then arm=0; fi',
      '[ 3 -le "$denials" ]',
      ': "${CCRC_GRAPH_X:=900}"',
      '# [ "$n" -gt 200 ] is a comment',
      '[ "${#rows[@]}" -gt 0 ] && echo rows',
      '[ "$rc" -eq 124 ] && timed_out=1',
      '[ "$changed" -gt "${GK[CCRC_GRAPH_INCREMENTAL_MAX_FILES]}" ] && full=1',
      // a default brought back as an expansion's fallback, in a comparison or outside one
      '[ "$n" -gt "${CCRC_GRAPH_BUDGET:-4}" ] && wait=1',
      '[ "$changed" -gt "${GK[CCRC_GRAPH_INCREMENTAL_MAX_FILES]:-200}" ] && full=1',
      '[[ $n -ge ${CCRC_GRAPH_X:=4} ]] && wait=1',
      'local budget=${CCRC_GRAPH_BUDGET:-8}',
      // the same fallback with no colon, or with the fallback quoted
      '[ "$n" -gt "${CCRC_GRAPH_BUDGET-4}" ] && wait=1',
      'local b=${CCRC_GRAPH_BUDGET=8}',
      '[ "$n" -gt "${CCRC_GRAPH_BUDGET:-"4"}" ] && wait=1',
      "[ \"$n\" -gt \"${CCRC_GRAPH_BUDGET:-'4'}\" ] && wait=1",
      // a comparison inside `(( … ))` whose operands hold a command substitution or an arithmetic expansion
      '(( $(date +%s) - t0 >= 600 )) && timed_out=1',
      'if (( $((now - t0)) > 21600 )); then stale=1; fi',
      // not thresholds: an exit status's fallback, a 0 fallback, nested parens with no comparison
      '[ "${rc:-124}" -ne 0 ] && failed=1',
      '[ "${rc-124}" -ne 0 ] && failed=1',
      '--argjson d "${4:-0}"',
      'dur=$(( $(date +%s%3N) - t0 ))',
      'age=$(( now - $(stat -c %Y "$f" 2>/dev/null || echo "$now") ))',
    ].join('\n'))).toEqual([
      '[ "$changed" -gt 200 ] && full=1',
      'if (( share > 25 )); then arm=0; fi',
      '[ 3 -le "$denials" ]',
      ': "${CCRC_GRAPH_X:=900}"',
      '[ "$n" -gt "${CCRC_GRAPH_BUDGET:-4}" ] && wait=1',
      '[ "$changed" -gt "${GK[CCRC_GRAPH_INCREMENTAL_MAX_FILES]:-200}" ] && full=1',
      '[[ $n -ge ${CCRC_GRAPH_X:=4} ]] && wait=1',
      'local budget=${CCRC_GRAPH_BUDGET:-8}',
      '[ "$n" -gt "${CCRC_GRAPH_BUDGET-4}" ] && wait=1',
      'local b=${CCRC_GRAPH_BUDGET=8}',
      '[ "$n" -gt "${CCRC_GRAPH_BUDGET:-"4"}" ] && wait=1',
      "[ \"$n\" -gt \"${CCRC_GRAPH_BUDGET:-'4'}\" ] && wait=1",
      '(( $(date +%s) - t0 >= 600 )) && timed_out=1',
      'if (( $((now - t0)) > 21600 )); then stale=1; fi',
    ]);
  });
});

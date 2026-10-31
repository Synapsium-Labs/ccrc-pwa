// D-7403 (test box plan, Task TB1; spec §4), D-7451, D-7456, D-7501: the test box's settings are ccrc settings. They
// join the one `CCRC_SETTINGS=(…)` list in ccd/ccrc; ccd/testbox-knobs reads each through ccrc's one reader
// `_ccrc_knob` in `file` mode, checks it against its key's shape (`_tb_shape`) and prints
// `KEY<US>default<US>value<US>from` per key (`_testbox_knobs host|box`), the lines agent/src/testbox/config.ts parses;
// `ccrc test --testbox-knobs host|box` is the one way every other reader reaches them.
//
// The rows: a key in the fixture ccrc.env is what host mode returns and a key in the fixture box file is what box mode
// returns; box mode reads neither the caller's ~/.ccrc/ccrc.env nor the environment, and host mode never reads the box
// file (D-7451); the owner seam, runnable as a non-root user (D-7456); the refusals of the box file (a fixture root of
// `/` or a relative one, group- or other-writable, a symlink), each with its reason and every default; the two
// censuses (TB_FIXTURE_OWNER_UID read on one line, TB_BOX_ENV_FILE assigned on one line); the two mutations; a bad
// value of every key keeps its default and is named with its source; the defaults table equals spec §4 row by row
// (CCRC_CHROME excluded: a name the browser tests own, not a setting) plus the D-7420, D-7421, D-7426 and D-7501 rows;
// the service's keys are all printed; the threshold-literal scanner of the plan's global constraints.
//
// Every run sources the real ccd/ccrc and ccd/testbox-knobs (or a mutated copy of the latter) in a fixture HOME through
// one fixed driver script; paths, the operation and its argument are the driver's arguments, never spliced into it.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, chownSync, existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';

removeTmpFixturesEachTest();

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CCRC = path.join(REPO, 'ccd', 'ccrc');
const KNOBS = path.join(REPO, 'ccd', 'testbox-knobs');
const WRAPPER = path.join(REPO, 'ccd', 'ccrc-test');
const SPEC = 'docs/superpowers/specs/2026-10-28-test-box-design.md';
/** A tracked file's text, or '' when it is not there (so a missing file reds its rows, not the whole collection). */
const read = (rel: string): string => (existsSync(path.join(REPO, rel)) ? readFileSync(path.join(REPO, rel), 'utf8') : '');
const UID = process.getuid?.() ?? 0;
const US = '\x1f';

/** The one driver, a fixed script that gets ccd/ccrc, ccd/testbox-knobs (or a copy), the operation and its argument
 *  as arguments (the file's header says each). */
const DRIVER = path.join(REPO, 'server', 'test', 'fixtures', 'testbox-knobs-driver.sh');

// ── the defaults table ───────────────────────────────────────────────────
/** Spec §4's two tables, in order: each key and its default as the printer spells it. A cell's backticked values joined
 *  by a space are the default (`unset` and "the distribution's own", with none, are the empty string); CCRC_CHROME
 *  is the browser tests' own name, never a setting. */
function specTable(which: 'fleet host' | 'test box'): { key: string; def: string }[] {
  const text = read(SPEC);
  const start = text.indexOf(`| key (${which}) | default | meaning |`);
  expect(start, `spec §4's ${which} table is there`).toBeGreaterThan(0);
  const end = text.indexOf('\n\n', start);
  const out: { key: string; def: string }[] = [];
  for (const m of text.slice(start, end < 0 ? undefined : end).matchAll(/^\| `(CCRC_[A-Z0-9_]+)` \| ([^|]*) \|/gm)) {
    if (m[1] === 'CCRC_CHROME') continue;
    out.push({ key: m[1]!, def: [...m[2]!.matchAll(/`([^`]*)`/g)].map((b) => b[1]).join(' ') });
  }
  return out;
}
/** The rows the spec's tables do not hold, each from the ruling that adds it. */
const HOST_ADDED = [{ key: 'CCRC_TESTBOX_TIMES', def: '~/.ccrc/testbox-times.json' }];   // D-7421
const BOX_ADDED = [
  { key: 'CCRC_TESTBOX_SESSION_RUNS', def: '1' },                                         // D-7420
  { key: 'CCRC_TESTBOX_SERVICE_USER', def: 'ccrc-tb-svc' },                               // D-7426
  { key: 'CCRC_TESTBOX_LISTEN', def: '' },                                                // D-7501: no default
  { key: 'CCRC_TESTBOX_SERVICE_TOKEN_FILE', def: '~/.ccrc/testbox-service.token' },      // D-7501
  { key: 'CCRC_TESTBOX_UNIT_MAX', def: '1h' },                                            // D-7501
];
const HOST_TABLE = [...specTable('fleet host'), ...HOST_ADDED];
const BOX_TABLE = [...specTable('test box'), ...BOX_ADDED];
const HOST_KEYS = HOST_TABLE.map((r) => r.key);
const BOX_KEYS = BOX_TABLE.map((r) => r.key);
const DEF: Record<string, string> = Object.fromEntries([...HOST_TABLE, ...BOX_TABLE].map((r) => [r.key, r.def]));

/** A value of each key that is its shape and is not its default, and one that is not its shape. */
const GOOD: Record<string, string> = {
  CCRC_TESTBOX_URL: 'https://testbox.invalid:7790', CCRC_TESTBOX_TOKEN_FILE: '/srv/fx/testbox.token',
  CCRC_TESTBOX_GIT_URL_BASE: 'ssh://ccrc-tb-push@testbox.invalid/', CCRC_TESTBOX_GIT_KEY: '/srv/fx/push.key',
  CCRC_TESTBOX_UNTRACKED_FILE_MAX: '8M', CCRC_TESTBOX_SNAPSHOT_MAX: '1G', CCRC_TESTBOX_STATUS_DEADLINE: '5s',
  CCRC_TESTBOX_RECONNECT_DEADLINE: '2m', CCRC_TESTBOX_LOST_RUN: 'fail', CCRC_TESTBOX_QUEUE_LIMIT: '99',
  CCRC_TESTBOX_QUEUE_WAIT: '1h', CCRC_TESTBOX_BUDGET: '30m', CCRC_TESTBOX_DENY_GLOBS: '*.pem secret.*',
  CCRC_TESTBOX_POLL: '1m', CCRC_TESTBOX_FALLBACK_INSTALL: 'refuse', CCRC_TESTBOX_TIMES: '/srv/fx/times.json',
  CCRC_TESTBOX_RUNS: '4', CCRC_TESTBOX_WORKERS: '3', CCRC_TESTBOX_RUN_TMPDIR: '/tmp/q', CCRC_TESTBOX_RUN_MEMORY_MAX: '6G',
  CCRC_TESTBOX_RUN_SWAP_MAX: '512M', CCRC_TESTBOX_RUN_CPU_QUOTA: '400%', CCRC_TESTBOX_ROOT: '/srv/testbox',
  CCRC_TESTBOX_REPOS: '/srv/testbox-repos.d', CCRC_TESTBOX_FETCH_EVERY: '10m', CCRC_TESTBOX_RETENTION: '2d',
  CCRC_TESTBOX_PRISTINE_KEEP: '14d', CCRC_TESTBOX_PRISTINE_RETRY: '1m 5m', CCRC_TESTBOX_REPORT_MAX: '32M',
  CCRC_TESTBOX_TOOLS_DIR: '/opt/fx/tools', CCRC_TESTBOX_OS_MIRROR: 'https://mirror.testbox.invalid/debian',
  CCRC_TESTBOX_EGRESS_ALLOW: 'github.com testbox.invalid', CCRC_TESTBOX_PUSH_USER: 'tb-push',
  CCRC_TESTBOX_ENV_FORWARD: 'CCRC_HISTORY_BASE', CCRC_TESTBOX_RUN_USER_PREFIX: 'tb-run-',
  CCRC_TESTBOX_REGISTRY_PROXY: '127.0.0.3:4874', CCRC_TESTBOX_REGISTRY_UPSTREAM: 'https://registry.testbox.invalid',
  CCRC_TESTBOX_TMPFS: 'on', CCRC_TESTBOX_LOG_TAIL: '80', CCRC_TESTBOX_SESSION_RUNS: '2', CCRC_TESTBOX_SERVICE_USER: 'tb-svc',
  CCRC_TESTBOX_LISTEN: '192.0.2.10:7790', CCRC_TESTBOX_SERVICE_TOKEN_FILE: '/etc/ccrc-testbox/service.token',
  CCRC_TESTBOX_UNIT_MAX: '2h',
};
/** A second good value of each key, for the files and the environment box mode must not read. */
const OTHER: Record<string, string> = Object.fromEntries(Object.entries(GOOD).map(([k, v]) => [k, otherOf(k, v)]));
function otherOf(k: string, v: string): string {
  if (/^[0-9]+$/.test(v)) return v === '7' ? '8' : '7';
  if (/^[0-9]+[smhd]$/.test(v)) return '9m';
  if (/^[0-9]+[KMG]$/.test(v)) return '9M';
  if (/%$/.test(v)) return '900%';
  if (/:[0-9]+$/.test(v) && !v.includes('/')) return '192.0.2.99:7799';
  if (/^[a-z]+:\/\//.test(v)) return 'https://other.testbox.invalid';
  if (v.startsWith('/')) return '/srv/other/path';
  const words: Record<string, string> = {
    CCRC_TESTBOX_LOST_RUN: 'local', CCRC_TESTBOX_FALLBACK_INSTALL: 'install', CCRC_TESTBOX_TMPFS: 'off',
    CCRC_TESTBOX_DENY_GLOBS: '*.other', CCRC_TESTBOX_PRISTINE_RETRY: '9m', CCRC_TESTBOX_EGRESS_ALLOW: 'other.testbox.invalid',
    CCRC_TESTBOX_ENV_FORWARD: 'CCRC_LEDGER_BASE', CCRC_TESTBOX_PUSH_USER: 'other-push', CCRC_TESTBOX_RUN_USER_PREFIX: 'other-',
    CCRC_TESTBOX_SERVICE_USER: 'other-svc',
  };
  return words[k] ?? `unhandled-${k}`;
}
const BAD: Record<string, string> = {
  CCRC_TESTBOX_URL: 'testbox.invalid', CCRC_TESTBOX_TOKEN_FILE: 'relative/token', CCRC_TESTBOX_GIT_URL_BASE: 'not a url',
  CCRC_TESTBOX_GIT_KEY: '/srv/../key', CCRC_TESTBOX_UNTRACKED_FILE_MAX: '5MB', CCRC_TESTBOX_SNAPSHOT_MAX: '0M',
  CCRC_TESTBOX_STATUS_DEADLINE: '3', CCRC_TESTBOX_RECONNECT_DEADLINE: '060s', CCRC_TESTBOX_LOST_RUN: 'retry',
  CCRC_TESTBOX_QUEUE_LIMIT: '100', CCRC_TESTBOX_QUEUE_WAIT: '10 m', CCRC_TESTBOX_BUDGET: '-15m',
  CCRC_TESTBOX_DENY_GLOBS: '   ', CCRC_TESTBOX_POLL: '30sec', CCRC_TESTBOX_FALLBACK_INSTALL: 'yes',
  CCRC_TESTBOX_TIMES: '~user/times.json',
  CCRC_TESTBOX_RUNS: '0', CCRC_TESTBOX_WORKERS: 'three', CCRC_TESTBOX_RUN_TMPDIR: 'tmp/r', CCRC_TESTBOX_RUN_MEMORY_MAX: '4GB',
  CCRC_TESTBOX_RUN_SWAP_MAX: '1T', CCRC_TESTBOX_RUN_CPU_QUOTA: '200', CCRC_TESTBOX_ROOT: '/srv/./testbox',
  CCRC_TESTBOX_REPOS: 'repos.d', CCRC_TESTBOX_FETCH_EVERY: '5', CCRC_TESTBOX_RETENTION: '1w', CCRC_TESTBOX_PRISTINE_KEEP: '0d',
  CCRC_TESTBOX_PRISTINE_RETRY: '2m soon', CCRC_TESTBOX_REPORT_MAX: '16', CCRC_TESTBOX_TOOLS_DIR: '~tools',
  CCRC_TESTBOX_OS_MIRROR: 'mirror.invalid', CCRC_TESTBOX_EGRESS_ALLOW: 'github.com bad_host!', CCRC_TESTBOX_PUSH_USER: 'Push',
  CCRC_TESTBOX_ENV_FORWARD: 'lower_case', CCRC_TESTBOX_RUN_USER_PREFIX: 'TB-', CCRC_TESTBOX_REGISTRY_PROXY: '127.0.0.2',
  CCRC_TESTBOX_REGISTRY_UPSTREAM: 'registry.npmjs.org', CCRC_TESTBOX_TMPFS: 'yes', CCRC_TESTBOX_LOG_TAIL: '100',
  CCRC_TESTBOX_SESSION_RUNS: '0', CCRC_TESTBOX_SERVICE_USER: '1svc', CCRC_TESTBOX_LISTEN: '192.0.2.10:70000',
  CCRC_TESTBOX_SERVICE_TOKEN_FILE: 'service.token', CCRC_TESTBOX_UNIT_MAX: '1hour',
};
const pick = (src: Record<string, string>, keys: readonly string[]): Record<string, string> =>
  Object.fromEntries(keys.map((k) => [k, src[k]!]));

// ── fixtures ─────────────────────────────────────────────────────────────
/** One `KEY=value` line each, double-quoted when the value holds anything outside a plain word, as an operator writes it. */
const envText = (vals: Record<string, string>): string =>
  Object.entries(vals).map(([k, v]) => `${k}=${/^[A-Za-z0-9_./:@%+,=-]*$/.test(v) ? v : `"${v}"`}\n`).join('');

interface Box { home: string; root: string; boxFile: string; env: NodeJS.ProcessEnv }
interface BoxOpts { host?: Record<string, string>; box?: Record<string, string> | null; extra?: NodeJS.ProcessEnv; owner?: 'me' | 'unset' | 'other'; root?: string }
/** A fixture: `host` is the caller's ~/.ccrc/ccrc.env, `box` the fixture box file under the fixture root (mode 0640,
 *  owned by the test user, named as the expected owner by `owner: 'me'`, the default), `extra` the environment. */
function fixture(o: BoxOpts = {}): Box {
  const home = mkTmp('testbox-knobs-home-');
  const root = mkTmp('testbox-knobs-root-');
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  mkdirSync(path.join(root, 'etc', 'ccrc-testbox'), { recursive: true });
  const boxFile = path.join(root, 'etc', 'ccrc-testbox', 'ccrc.env');
  if (o.host) writeFileSync(path.join(home, '.ccrc', 'ccrc.env'), envText(o.host));
  if (o.box !== null) { writeFileSync(boxFile, envText(o.box ?? {})); chmodSync(boxFile, 0o640); }
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('CCRC_') && !k.startsWith('TB_')) env[k] = v;
  Object.assign(env, { HOME: home, TB_FIXTURE_ROOT: o.root ?? root });
  const owner = o.owner ?? 'me';
  if (owner === 'me') env['TB_FIXTURE_OWNER_UID'] = String(UID);
  if (owner === 'other') env['TB_FIXTURE_OWNER_UID'] = String(UID + 1);
  Object.assign(env, o.extra ?? {});
  return { home, root, boxFile, env };
}

interface Out { status: number | null; stdout: string; stderr: string }
const drive = (b: Box, op: string, arg = '', knobs = KNOBS): Out => {
  const r = spawnSync('bash', [DRIVER, CCRC, knobs, op, arg], { env: b.env, encoding: 'utf8', cwd: b.home, timeout: 60000 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};
interface Knobs { lines: string[][]; value: Record<string, string>; warn: string[]; status: number | null; stderr: string }
const parse = (r: Out): Knobs => {
  const lines = r.stdout.split('\n').filter((l) => l !== '').map((l) => l.split(US));
  return { lines, value: Object.fromEntries(lines.map((f) => [f[0]!, f[2]!])), warn: r.stderr.split('\n').filter((l) => l !== ''), status: r.status, stderr: r.stderr };
};
const knobs = (b: Box, mode: 'host' | 'box', file = KNOBS): Knobs => parse(drive(b, 'knobs', mode, file));
const defaultsOf = (keys: readonly string[]): Record<string, string> => Object.fromEntries(keys.map((k) => [k, DEF[k]!]));

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const shown = (v: string): string => (v === '' ? "''" : v);
/** `ccd/ccrc-test#_tload`'s wording for a value that is not its shape (D-7419), naming the file the mode read. */
const badRe = (k: string, v: string, src: string): RegExp =>
  new RegExp('^' + escapeRe(`ccrc test: WARN: ${k}=${v} (from the ${src}) is not `) + '.+' + escapeRe(`; using its default ${shown(DEF[k]!)}`) + '$');
const envRe = (k: string, v: string, src: string, inUse: string): RegExp =>
  new RegExp('^' + escapeRe(`ccrc test: WARN: ${k}=${v} in the environment is ignored: it holds for the whole box, so only ${src} sets it (in use: ${shown(inUse)})`) + '$');
const REFUSED = /^ccrc test: WARN: the test box's settings file is refused: (.+); every test box setting uses its default$/;

/** A copy of ccd/testbox-knobs with `from` replaced by `to` (each must occur once), for the mutation rows. */
function mutant(from: string, to: string): string {
  const text = read('ccd/testbox-knobs');
  expect(text.split(from).length - 1, `the mutation's anchor occurs once: ${from}`).toBe(1);
  const dir = mkTmp('testbox-knobs-mutant-');
  const f = path.join(dir, 'testbox-knobs');
  writeFileSync(f, text.replace(from, to));
  return f;
}

// ── the censuses ─────────────────────────────────────────────────────────
const CENSUS_ROOTS = ['ccd', 'deploy', 'agent/src'];
function censusFiles(): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    for (const e of readdirSync(path.join(REPO, rel), { withFileTypes: true })) {
      const r = `${rel}/${e.name}`;
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      if (e.isDirectory()) walk(r);
      else if (e.isFile()) out.push(r);
    }
  };
  for (const r of CENSUS_ROOTS) if (existsSync(path.join(REPO, r))) walk(r);
  return out.sort();
}
/** The code lines (a line whose first non-blank is `#` or `//` is a comment) of the census that `re` matches. */
function censusLines(re: RegExp): string[] {
  const out: string[] = [];
  for (const f of censusFiles())
    for (const l of read(f).split('\n')) if (!/^\s*(#|\/\/)/.test(l) && re.test(l)) out.push(`${f}: ${l.trim()}`);
  return out;
}

// ── the threshold-literal scanner (plan §Global constraints) ─────────────
// A numeric literal above 1 compared against a test box quantity, in a code line: TypeScript's `<`, `<=`, `>`, `>=`,
// `==`, `===`, `!=`, `!==` (an arrow's `=>` is not one) and bash's `-lt|-le|-gt|-ge|-eq|-ne`, `(( … ))` comparisons and
// an expansion's fallback default. A test box quantity is an operand naming one of the numeric test box keys: the key
// itself, `TBK[…]`, or an identifier holding the key's name without its prefix (CCRC_TESTBOX_LOG_TAIL is `logTail`,
// `log_tail`, `LOG_TAIL`). 0 and 1 are not thresholds (emptiness, presence, a first item). The defaults table, in
// ccd/testbox-knobs, is the one place a test box quantity is spelled, and is not scanned.
const NUMERIC_CLASSES = /^(count|duration|durations|size|percent)$/;
const SHAPE_CLASS = (() => {
  const out: Record<string, string> = {};
  const body = /^_tb_shape_class\(\) \{[\s\S]*?\n\}$/m.exec(read('ccd/testbox-knobs'))?.[0] ?? '';
  for (const m of body.matchAll(/^[ \t]+([A-Z0-9_|]+)\) echo ([a-z]+) ;;$/gm))
    for (const k of m[1]!.split('|')) if (k.startsWith('CCRC_TESTBOX_')) out[k] = m[2]!;
  return out;
})();
const QUANTITY_WORDS: string[] = Object.entries(SHAPE_CLASS).filter(([, c]) => NUMERIC_CLASSES.test(c))
  .map(([k]) => k.replace(/^CCRC_TESTBOX_/, '').replace(/_/g, '').toLowerCase());
/** An operand names a quantity when it names a test box key, or when its last name, lower-cased without underscores, is
 *  a quantity word with at most a unit after it (`unitMaxMs`, `reportMaxBytes`, `$queue_limit`). */
const QUANTITY_UNITS = ['', 'ms', 's', 'secs', 'bytes'];
const namesQuantity = (operand: string): boolean => {
  if (/CCRC_TESTBOX_|TBK\[/.test(operand)) return true;
  const last = (operand.replace(/[$"{}]/g, '').split('.').pop() ?? '').toLowerCase().replace(/_/g, '');
  return QUANTITY_WORDS.some((w) => QUANTITY_UNITS.some((u) => last === w + u));
};
const isThreshold = (n: string): boolean => /^\d[\d_]*$/.test(n) && Number(n.replace(/_/g, '')) > 1;
function thresholdLiterals(text: string, lang: 'ts' | 'sh'): string[] {
  const out: string[] = [];
  let inBlock = false;
  for (const raw of text.split('\n')) {
    let l = raw;
    if (lang === 'ts') {
      if (inBlock) { if (l.includes('*/')) { inBlock = false; l = l.slice(l.indexOf('*/') + 2); } else continue; }
      if (/^\s*\/\*/.test(l) && !l.includes('*/')) { inBlock = true; continue; }
      if (/^\s*(\/\/|\*)/.test(l)) continue;
      l = l.replace(/\s\/\/\s.*$/, '').replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''");
    } else {
      if (/^\s*#/.test(l)) continue;
      l = l.replace(/\s#\s.*$/, '');
    }
    let hit = false;
    const pairs: [string, string][] = [];
    const OPERAND = String.raw`([A-Za-z_$][\w$.]*(?:\[[^\]]*\])?(?:\.[\w$]+)*|"?\$\{?[A-Za-z_][\w]*(?:\[[^\]]*\])?\}?"?|\d[\d_]*)`;
    const ops = lang === 'ts' ? String.raw`(?:===|!==|==|!=|<=|>=|(?<![=\-])>|<)` : String.raw`(?:-lt|-le|-gt|-ge|-eq|-ne|<=|>=|==|!=|<|>)`;
    for (const m of l.matchAll(new RegExp(OPERAND + String.raw`\s*` + ops + String.raw`\s*` + OPERAND, 'g'))) pairs.push([m[1]!, m[2]!]);
    for (const [a, b] of pairs) {
      const sa = a.replace(/^"|"$/g, '');
      const sb = b.replace(/^"|"$/g, '');
      if ((isThreshold(sa) && namesQuantity(sb)) || (isThreshold(sb) && namesQuantity(sa))) hit = true;
    }
    if (lang === 'sh') for (const m of l.matchAll(/\$\{([^{}]*?):?[-=](["']?)(\d+)\2\}/g)) if (namesQuantity(m[1]!) && isThreshold(m[3]!)) hit = true;
    if (hit) out.push(l.trim());
  }
  return out;
}
/** The scanned code: the test box's TypeScript, ccd/testbox-snap (TB3) and ccd/ccrc-test, whose remote arm TB8 adds. */
const SCANNED_SH = ['ccd/testbox-snap', 'ccd/ccrc-test'];
const scannedTs = (): string[] => {
  const dir = path.join(REPO, 'agent', 'src', 'testbox');
  return existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.ts')).map((n) => `agent/src/testbox/${n}`).sort() : [];
};

// ── the rows ─────────────────────────────────────────────────────────────
describe('TB1: the test box settings, through ccrc\'s one reader (D-7403; spec §4)', () => {
  it('counted exit: CCRC_SETTINGS 43 -> 87, its test box keys are the host table then the box table, and each mode prints its table in order', () => {
    expect(HOST_KEYS, 'spec §4\'s 15 host keys plus D-7421\'s').toHaveLength(16);
    expect(BOX_KEYS, 'spec §4\'s 23 box keys plus D-7420\'s, D-7426\'s and D-7501\'s three').toHaveLength(28);
    const m = /^CCRC_SETTINGS=\(([^)]*)\)$/m.exec(read('ccd/ccrc'));
    const settings = m ? m[1]!.split(' ').filter((w) => w !== '') : [];
    expect(settings.filter((s) => s.startsWith('CCRC_TESTBOX_'))).toEqual([...HOST_KEYS, ...BOX_KEYS]);
    expect(settings, 'counted exit: CCRC_SETTINGS 43 -> 87 (TB1 adds 16 host and 28 box keys)').toHaveLength(87);
    const b = fixture();
    expect(knobs(b, 'host').lines.map((f) => f[0])).toEqual(HOST_KEYS);
    expect(knobs(b, 'box').lines.map((f) => f[0])).toEqual(BOX_KEYS);
  });

  it('the defaults table equals spec §4 row by row (CCRC_CHROME excluded) plus the D-7420, D-7421, D-7426 and D-7501 rows', () => {
    const b = fixture({ box: null });
    for (const [mode, table] of [['host', HOST_TABLE], ['box', BOX_TABLE]] as const) {
      const k = knobs(b, mode);
      expect(k.status, k.stderr).toBe(0);
      expect(k.lines.map((f) => [f[0], f[1]]), mode).toEqual(table.map((r) => [r.key, r.def]));
      expect(k.lines.map((f) => [f[0], f[2], f[3]]), `${mode}: no file, so every value is its default`).toEqual(table.map((r) => [r.key, r.def, 'default']));
      expect(k.lines.every((f) => f.length === 4), 'four fields a line').toBe(true);
    }
    expect(knobs(b, 'host').warn, 'host with no ccrc.env warns nothing').toEqual([]);
    const box = knobs(b, 'box').warn;
    expect(box, 'box with no box file says so once').toHaveLength(1);
    expect(box[0]).toMatch(REFUSED);
    expect(box[0]).toContain(`${b.boxFile} is not there`);
  });

  it('host mode: a key in the fixture ccrc.env is what it returns, from the file, with no warning', () => {
    const k = knobs(fixture({ host: pick(GOOD, HOST_KEYS) }), 'host');
    expect(k.status, k.stderr).toBe(0);
    expect(k.warn).toEqual([]);
    expect(k.value).toEqual(pick(GOOD, HOST_KEYS));
    expect(k.lines.every((f) => f[3] === 'file')).toBe(true);
  });

  it('box mode: a key in the fixture box file is what it returns, for every box key, whatever the caller\'s ~/.ccrc/ccrc.env and environment say (D-7451)', () => {
    const b = fixture({ box: pick(GOOD, BOX_KEYS), host: pick(OTHER, BOX_KEYS), extra: pick(OTHER, BOX_KEYS) });
    const k = knobs(b, 'box');
    expect(k.status, k.stderr).toBe(0);
    expect(k.value).toEqual(pick(GOOD, BOX_KEYS));
    expect(k.lines.every((f) => f[3] === 'file')).toBe(true);
    // The environment is ignored, and each differing value says so, naming the box file.
    expect(k.warn).toHaveLength(BOX_KEYS.length);
    for (const key of BOX_KEYS) expect(k.warn.filter((w) => envRe(key, OTHER[key]!, b.boxFile, GOOD[key]!).test(w)), key).toHaveLength(1);
  });

  it('box mode with no box file reads every default, never the caller\'s ~/.ccrc/ccrc.env', () => {
    const k = knobs(fixture({ box: null, host: pick(OTHER, BOX_KEYS) }), 'box');
    expect(k.value).toEqual(defaultsOf(BOX_KEYS));
  });

  it('host mode never reads the box file, and ignores the environment for every host key with a warning naming ~/.ccrc/ccrc.env', () => {
    const b = fixture({ host: pick(GOOD, HOST_KEYS), box: { ...pick(OTHER, HOST_KEYS), ...pick(OTHER, BOX_KEYS) }, extra: pick(OTHER, HOST_KEYS) });
    const k = knobs(b, 'host');
    expect(k.status, k.stderr).toBe(0);
    expect(k.value).toEqual(pick(GOOD, HOST_KEYS));
    expect(k.warn).toHaveLength(HOST_KEYS.length);
    for (const key of HOST_KEYS) expect(k.warn.filter((w) => envRe(key, OTHER[key]!, '~/.ccrc/ccrc.env', GOOD[key]!).test(w)), key).toHaveLength(1);
    expect(k.stderr).not.toContain(b.boxFile);
  });

  it('_tb_box_env_file prints the box file: /etc/ccrc-testbox/ccrc.env under the fixture root, and the real path with none', () => {
    const b = fixture();
    expect(drive(b, 'envfile').stdout).toBe(`${b.root}/etc/ccrc-testbox/ccrc.env\n`);
    expect(drive({ ...b, env: { ...b.env, TB_FIXTURE_ROOT: '' } }, 'envfile').stdout).toBe('/etc/ccrc-testbox/ccrc.env\n');
  });
});

describe('TB1: the owner seam (D-7456), runnable as a non-root user', () => {
  it('a fixture box file owned by the test user is read with TB_FIXTURE_OWNER_UID=$(id -u)', () => {
    const b = fixture({ box: { CCRC_TESTBOX_RUNS: '4' } });
    expect(drive(b, 'fileok', b.boxFile).stdout).toBe('ok\n');
    expect(knobs(b, 'box').value['CCRC_TESTBOX_RUNS']).toBe('4');
  });

  it('refused as not owned by root with TB_FIXTURE_OWNER_UID unset (as root: a file owned by 65534), with every default', () => {
    const b = fixture({ box: { CCRC_TESTBOX_RUNS: '4' }, owner: 'unset' });
    if (UID === 0) chownSync(b.boxFile, 65534, 65534);
    const owned = UID === 0 ? 65534 : UID;
    expect(drive(b, 'fileok', b.boxFile).stdout).toBe(`refused\t${b.boxFile} is owned by uid ${owned}, not uid 0\n`);
    const k = knobs(b, 'box');
    expect(k.value).toEqual(defaultsOf(BOX_KEYS));
    expect(k.warn[0]).toMatch(REFUSED);
    expect(k.warn[0]).toContain(`is owned by uid ${owned}, not uid 0`);
  });

  it('refused as owned by another user with TB_FIXTURE_OWNER_UID set to the test user\'s uid plus one', () => {
    const b = fixture({ box: { CCRC_TESTBOX_RUNS: '4' }, owner: 'other' });
    expect(drive(b, 'fileok', b.boxFile).stdout).toBe(`refused\t${b.boxFile} is owned by uid ${UID}, not uid ${UID + 1}\n`);
    expect(knobs(b, 'box').value).toEqual(defaultsOf(BOX_KEYS));
  });

  it('_tb_box_owner_uid prints 0 with TB_FIXTURE_OWNER_UID set and TB_FIXTURE_ROOT empty, the override under a fixture root, and 0 for a non-digit override', () => {
    const b = fixture();
    expect(drive({ ...b, env: { ...b.env, TB_FIXTURE_ROOT: '', TB_FIXTURE_OWNER_UID: '4242' } }, 'owner').stdout).toBe('0\n');
    expect(drive({ ...b, env: { ...b.env, TB_FIXTURE_OWNER_UID: '4242' } }, 'owner').stdout).toBe('4242\n');
    expect(drive({ ...b, env: { ...b.env, TB_FIXTURE_OWNER_UID: '42x' } }, 'owner').stdout).toBe('0\n');
    expect(drive({ ...b, env: { ...b.env, TB_FIXTURE_OWNER_UID: '' } }, 'owner').stdout).toBe('0\n');
  });

  it.each([['/', 'TB_FIXTURE_ROOT=/ is the root directory or not a plain absolute path'], ['//', 'TB_FIXTURE_ROOT=// is the root directory or not a plain absolute path'],
    ['relative/root', 'TB_FIXTURE_ROOT=relative/root is not an absolute path']])('a TB_FIXTURE_ROOT of %s is refused, with every default', (root, why) => {
    const b = fixture({ box: { CCRC_TESTBOX_RUNS: '4' } });
    const env = { ...b.env, TB_FIXTURE_ROOT: root };
    expect(drive({ ...b, env }, 'fileok', b.boxFile).stdout).toBe(`refused\t${why}\n`);
    const k = knobs({ ...b, env }, 'box');
    expect(k.value).toEqual(defaultsOf(BOX_KEYS));
    expect(k.warn[0]).toBe(`ccrc test: WARN: the test box's settings file is refused: ${why}; every test box setting uses its default`);
  });

  it.each([[0o660, 'group'], [0o642, 'other'], [0o666, 'both']])('a box file of mode %o (writable by %s) is refused with its reason and every default', (mode) => {
    const b = fixture({ box: pick(GOOD, BOX_KEYS) });
    chmodSync(b.boxFile, mode);
    const m = (mode & 0o777).toString(8);
    expect(drive(b, 'fileok', b.boxFile).stdout).toBe(`refused\t${b.boxFile} is writable by group or other (mode ${m})\n`);
    const k = knobs(b, 'box');
    expect(k.value).toEqual(defaultsOf(BOX_KEYS));
    expect(k.lines.every((f) => f[3] === 'default')).toBe(true);
    expect(k.warn).toEqual([`ccrc test: WARN: the test box's settings file is refused: ${b.boxFile} is writable by group or other (mode ${m}); every test box setting uses its default`]);
  });

  it('a box file that is a symlink to a regular file elsewhere is refused with its reason and every default; a directory is not a regular file', () => {
    const b = fixture({ box: null });
    const elsewhere = path.join(mkTmp('testbox-knobs-elsewhere-'), 'ccrc.env');
    writeFileSync(elsewhere, envText(pick(GOOD, BOX_KEYS)));
    chmodSync(elsewhere, 0o640);
    symlinkSync(elsewhere, b.boxFile);
    expect(drive(b, 'fileok', b.boxFile).stdout).toBe(`refused\t${b.boxFile} is a symlink\n`);
    const k = knobs(b, 'box');
    expect(k.value).toEqual(defaultsOf(BOX_KEYS));
    expect(k.warn).toEqual([`ccrc test: WARN: the test box's settings file is refused: ${b.boxFile} is a symlink; every test box setting uses its default`]);
    const d = fixture({ box: null });
    mkdirSync(d.boxFile);
    expect(drive(d, 'fileok', d.boxFile).stdout).toBe(`refused\t${d.boxFile} is not a regular file\n`);
  });

  it('mutation: an _tb_box_owner_uid that honours the override with TB_FIXTURE_ROOT empty reds the root-empty row', () => {
    const f = mutant('if [ -n "${TB_FIXTURE_ROOT:-}" ] && [[ "${TB_FIXTURE_OWNER_UID:-}"', 'if [[ "${TB_FIXTURE_OWNER_UID:-}"');
    const b = fixture();
    const env = { ...b.env, TB_FIXTURE_ROOT: '', TB_FIXTURE_OWNER_UID: '4242' };
    expect(drive({ ...b, env }, 'owner', '', f).stdout, 'the mutant names the override as the real file\'s owner').toBe('4242\n');
    expect(drive({ ...b, env }, 'owner').stdout, 'the real one does not').toBe('0\n');
  });

  it('mutation: an _tb_box_file_ok without the owner comparison reds the another-user row', () => {
    const f = mutant('  if [ "$uid" != "$want" ]; then TB_BOX_WHY="$p is owned by uid $uid, not uid $want"; return 1; fi\n', '');
    const b = fixture({ box: { CCRC_TESTBOX_RUNS: '4' }, owner: 'other' });
    expect(drive(b, 'fileok', b.boxFile, f).stdout, 'the mutant reads a file another user owns').toBe('ok\n');
    expect(knobs(b, 'box', f).value['CCRC_TESTBOX_RUNS']).toBe('4');
    expect(drive(b, 'fileok', b.boxFile).stdout).toMatch(/^refused\t/);
  });

  it('census: TB_FIXTURE_OWNER_UID is read on exactly one line of ccd/, deploy/ and agent/src', () => {
    const hits = censusLines(/\$\{?TB_FIXTURE_OWNER_UID\b/);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatch(/^ccd\/testbox-knobs: if \[ -n "\$\{TB_FIXTURE_ROOT:-\}" \] && /);
  });

  it('census: TB_BOX_ENV_FILE is assigned on exactly one line of ccd/, deploy/ and agent/src, the fixture-root constant', () => {
    expect(censusLines(/\bTB_BOX_ENV_FILE=/)).toEqual(['ccd/testbox-knobs: TB_BOX_ENV_FILE="${TB_FIXTURE_ROOT:-}/etc/ccrc-testbox/ccrc.env"']);
  });

  it('census: box mode and the tools unit\'s release base (D-7457) bind BOX_ENV_FILE on one line each, and no line of ccd/testbox-knobs names a home ccrc.env for the box', () => {
    const code = read('ccd/testbox-knobs').split('\n').filter((l) => !/^\s*#/.test(l));
    expect(code.filter((l) => /\bBOX_ENV_FILE=/.test(l)).map((l) => l.trim())).toEqual([
      'BOX_ENV_FILE="$f" _tb_box_table ;;',
      'if ! BOX_ENV_FILE="$TB_BOX_ENV_FILE" _upd_release_base file >/dev/null 2>&1; then',
    ]);
    expect(code.filter((l) => /\.ccrc\/ccrc\.env/.test(l))).toEqual([]);
  });
});

describe('TB1: every value is validated (D-7419)', () => {
  it('the bad and good tables cover every key, and every good value is its shape and not its default', () => {
    const all = [...HOST_KEYS, ...BOX_KEYS].sort();
    expect(Object.keys(BAD).sort()).toEqual(all);
    expect(Object.keys(GOOD).sort()).toEqual(all);
    for (const k of all) { expect(GOOD[k], k).not.toBe(DEF[k]); expect(OTHER[k], k).not.toMatch(/^unhandled-/); expect(OTHER[k], k).not.toBe(GOOD[k]); }
  });

  it.each(['host', 'box'] as const)('%s mode: a bad value of every key keeps its default and is named with its source', (mode) => {
    const keys = mode === 'host' ? HOST_KEYS : BOX_KEYS;
    const b = mode === 'host' ? fixture({ host: pick(BAD, keys) }) : fixture({ box: pick(BAD, keys) });
    const src = mode === 'host' ? '~/.ccrc/ccrc.env' : b.boxFile;
    const k = knobs(b, mode);
    expect(k.status, k.stderr).toBe(0);
    expect(k.value).toEqual(defaultsOf(keys));
    expect(k.warn, 'one warning per key').toHaveLength(keys.length);
    for (const key of keys) expect(k.warn.filter((w) => badRe(key, BAD[key]!, src).test(w)), `${key}: ${badRe(key, BAD[key]!, src)}`).toHaveLength(1);
  });

  it('host mode: a ccrc.env that cannot be read keeps every default and says why, once per key', () => {
    const b = fixture();
    mkdirSync(path.join(b.home, '.ccrc', 'ccrc.env'));
    const k = knobs(b, 'host');
    expect(k.status, k.stderr).toBe(0);
    expect(k.value).toEqual(defaultsOf(HOST_KEYS));
    expect(k.warn).toHaveLength(HOST_KEYS.length);
    for (const w of k.warn) expect(w).toMatch(/^ccrc test: WARN: CCRC_TESTBOX_[A-Z_]+ cannot be measured: ~\/\.ccrc\/ccrc\.env is there but cannot be read; using its default .*$/);
  });
});

describe('TB1: the readers the lines are for (D-7430, D-7501)', () => {
  it('ccrc test --testbox-knobs host|box prints _testbox_knobs\' lines, and refuses any other argument as a usage error', () => {
    const b = fixture({ host: pick(GOOD, HOST_KEYS), box: pick(GOOD, BOX_KEYS) });
    for (const mode of ['host', 'box'] as const) {
      const r = spawnSync('bash', [WRAPPER, '--testbox-knobs', mode], { env: b.env, encoding: 'utf8', cwd: b.home, timeout: 60000 });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout, mode).toBe(drive(b, 'knobs', mode).stdout);
      expect(r.stderr, mode).toBe('');
    }
    for (const args of [['--testbox-knobs'], ['--testbox-knobs', 'both'], ['--testbox-knobs', 'box', 'extra']]) {
      const r = spawnSync('bash', [WRAPPER, ...args], { env: b.env, encoding: 'utf8', cwd: b.home, timeout: 60000 });
      expect(r.status, args.join(' ')).toBe(2);
      expect(r.stderr.split('\n')[0]).toBe('ccrc test: --testbox-knobs takes host or box');
      expect(r.stdout).toBe('');
    }
  });

  it('ccd/testbox-knobs refuses to be run rather than sourced', () => {
    const r = spawnSync('bash', [KNOBS], { env: fixture().env, encoding: 'utf8', timeout: 30000 });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/source it, never run it/);
    expect(read('ccd/testbox-knobs').split('\n')[0]).toBe('#!/usr/bin/env bash');
  });

  it('every key agent/src/testbox/config.ts\'s SERVICE_KNOBS names is printed by _testbox_knobs box, in lines its parser takes', () => {
    const m = /export const SERVICE_KNOBS = \[([\s\S]*?)\] as const;/.exec(read('agent/src/testbox/config.ts'));
    expect(m, 'SERVICE_KNOBS is there').not.toBeNull();
    const service = [...m![1]!.matchAll(/'(CCRC_TESTBOX_[A-Z0-9_]+)'/g)].map((x) => x[1]!);
    expect(service.length).toBeGreaterThan(0);
    const k = knobs(fixture({ box: pick(GOOD, BOX_KEYS) }), 'box');
    const printed = k.lines.map((f) => f[0]);
    expect(service.filter((s) => !printed.includes(s)), 'service keys the printer does not print').toEqual([]);
    // config.ts#parseKnobLines: exactly four fields, a key of capitals, digits and underscores, no key twice.
    for (const f of k.lines) { expect(f).toHaveLength(4); expect(f[0]).toMatch(/^[A-Z][A-Z0-9_]*$/); }
    expect(new Set(printed).size).toBe(printed.length);
  });
});

describe('TB1: the example files (D-7451)', () => {
  const lines = read('deploy/ccrc.env.example').split('\n');
  const tb = read('deploy/testbox/ccrc.env.example');
  const commented = (k: string): string => `# ${k}=${/^[A-Za-z0-9_./:@%+,=-]*$/.test(DEF[k]!) ? DEF[k] : `"${DEF[k]}"`}`;

  it('deploy/ccrc.env.example lists every host key commented out at its default under "test box (fleet host)", and says where the box\'s keys live', () => {
    const head = lines.findIndex((l) => /^#.*\btest box \(fleet host\)/.test(l));
    expect(head, 'a "test box (fleet host)" heading').toBeGreaterThanOrEqual(0);
    expect(lines.slice(head).filter((l) => /^# CCRC_TESTBOX_[A-Z0-9_]+=/.test(l))).toEqual(HOST_KEYS.map(commented));
    expect(lines.filter((l) => /^#.*\/etc\/ccrc-testbox\/ccrc\.env/.test(l)), 'one comment line names the box\'s file').toHaveLength(1);
    expect(lines.filter((l) => BOX_KEYS.some((k) => l.startsWith(`# ${k}=`) || l.startsWith(`${k}=`))), 'no box key is offered to the fleet host').toEqual([]);
  });

  it('deploy/testbox/ccrc.env.example lists CCRC_RELEASE_BASE_URL and every box key commented out at its default, and its header names the path, owner, group and mode', () => {
    const keyLines = tb.split('\n').filter((l) => /^# CCRC_[A-Z0-9_]+=/.test(l));
    expect(keyLines).toEqual(['# CCRC_RELEASE_BASE_URL=', ...BOX_KEYS.map(commented)]);
    const header = tb.slice(0, tb.indexOf('\n#\n# The .../releases root'));
    expect(header).toContain('/etc/ccrc-testbox/ccrc.env');
    expect(header).toMatch(/Owner root, group the service user's/);
    expect(header).toContain('mode 0640');
  });
});

describe('TB1: the threshold-literal scanner (plan §Global constraints)', () => {
  it('no numeric literal is compared against a test box quantity in the test box\'s code on main, outside the defaults table', () => {
    const ts = scannedTs();
    expect(ts, 'TB4\'s service code is scanned').toEqual(expect.arrayContaining(['agent/src/testbox/config.ts', 'agent/src/testbox/service.ts']));
    for (const f of ts) expect(thresholdLiterals(read(f), 'ts'), f).toEqual([]);
    const sh = SCANNED_SH.filter((f) => existsSync(path.join(REPO, f)));
    expect(sh, 'the wrapper is scanned').toContain('ccd/ccrc-test');
    for (const f of sh) expect(thresholdLiterals(read(f), 'sh'), f).toEqual([]);
  });

  it('the scanner itself: it sees a literal against a test box quantity in either language, and passes the rest', () => {
    expect(QUANTITY_WORDS, 'the numeric keys name the quantities').toEqual(expect.arrayContaining(['workers', 'logtail', 'unitmax', 'queuelimit', 'runs']));
    expect(thresholdLiterals([
      'if (cfg.workers > 3) refuse();',
      'const ok = 40 <= this.config.logTail;',
      'if (unitMaxMs >= 3_600_000) stop();',
      '// if (cfg.workers > 3) is a comment',
      'if (f.length !== 4) throw new Error(x);',
      'if (port < 1 || port > 65535) refuse();',
      'if (r.status !== 0) fail();',
      'const f = (x: number) => 2;',
      "const s = 'workers > 3';",
      'if (this.runs.size >= cfg.runs) wait();',
    ].join('\n'), 'ts')).toEqual([
      'if (cfg.workers > 3) refuse();',
      'const ok = 40 <= this.config.logTail;',
      'if (unitMaxMs >= 3_600_000) stop();',
    ]);
    expect(thresholdLiterals([
      '[ "${TBK[CCRC_TESTBOX_QUEUE_LIMIT]}" -gt 20 ] && full=1',
      '[ "$queue_limit" -ge 20 ] && full=1',
      'local w=${CCRC_TESTBOX_WORKERS:-2}',
      '# [ "$workers" -gt 3 ] is a comment',
      '[ "$rc" -eq 124 ] && timed_out=1',
      '[ "${TBK[CCRC_TESTBOX_RUNS]}" -gt 0 ] && echo some',
      '[ "$n" -gt "${TBK[CCRC_TESTBOX_RUNS]}" ] && wait=1',
    ].join('\n'), 'sh')).toEqual([
      '[ "${TBK[CCRC_TESTBOX_QUEUE_LIMIT]}" -gt 20 ] && full=1',
      '[ "$queue_limit" -ge 20 ] && full=1',
      'local w=${CCRC_TESTBOX_WORKERS:-2}',
    ]);
  });
});


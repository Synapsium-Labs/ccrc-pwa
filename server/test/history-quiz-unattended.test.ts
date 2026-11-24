// deploy/history-quiz-unattended.mjs: the weekly replay quiz run by a timer (Overlord W1a; the note
// docs/superpowers/programs/overlord/quiz-unattended.md, section 1). Listed in ci.yml's node-floor leg, as the sibling
// history-quiz tests are.
//
// ISOLATION: every case runs on a mkTmp fixture HOME. The single-arm driver and the record verb are FAKE scripts written
// into the fixture: each logs its argv and environment to a file under the fixture HOME and prints the lines the real
// ones print, as a plan file says. The runner takes them through its `deps`; nothing here runs the real driver, `ccd`,
// `ccrc` or anything against the live HOME or the live history store, and no fixture names a real account, host or path.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, linkSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as unMod from '../../deploy/history-quiz-unattended.mjs';
import * as qsMod from '../../deploy/history-quiz-single.mjs';
import * as drvMod from '../../deploy/history-replay.mjs';
import * as qpMod from '../../deploy/history-quiz-pilot.mjs';
import { quizWeek } from '../src/continuity/quiz.js';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';

type R = Record<string, any>;
const U = unMod as unknown as R;
const QS = qsMod as unknown as R;
const D = drvMod as unknown as R;
const QP = qpMod as unknown as R;

removeTmpFixturesEachTest();

// The runner sets umask 077 in the test's own process (a fork): restore it after every case.
let umaskBefore = 0;
beforeEach(() => { umaskBefore = process.umask(); });
afterEach(() => { process.umask(umaskBefore); });

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 21, 12, 0, 0);
const WEEK = U.weekKeyOf(NOW) as string;
const NEXT_NOW = NOW + 7 * DAY;
const NEXT_WEEK = U.weekKeyOf(NEXT_NOW) as string;
const STORE = '00000000-0000-4000-8000-0000000005a1';
const GEN1 = '0189abcd-0000-4000-8000-000000000001';
/** The marker the fake driver prints: one store line and two frozen families (one with a generation, one legacy). */
const MARKER = `store ${STORE}\nfam-one ${GEN1}\nfam-two -\n`;
const SUPERSET = `${MARKER}fam-three -\n`;
const INCOMPLETE = `store ${STORE}\nfam-one ${GEN1}\n`;
const OTHER_STORE = `store 00000000-0000-4000-8000-0000000005a2\nfam-one ${GEN1}\nfam-two -\n`;
const hex = (s: string | Buffer): string => createHash('sha256').update(s).digest('hex');

/** The fake driver: logs {tool, argv, env, execArgv}; a plan file `plan.json` gives, per key (`<sub>@<account>`,
 *  `<sub>@<out's last segment>`, `<sub>`), a queue of answers consumed in order ({exit, stderr, stdout, sha, mkdir});
 *  past the queues every step succeeds: stderr `sha256 hex(sub:out)`, a made --out holding the driver's single-arm marker. */
const FAKE_DRIVER = `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const home = process.env.HOME;
const argv = process.argv.slice(2);
const sub = argv[0];
const flag = (n) => { const i = argv.indexOf('--' + n); return i < 0 ? null : argv[i + 1]; };
fs.appendFileSync(path.join(home, 'log.jsonl'), JSON.stringify({ tool: 'driver', argv, env: process.env, execArgv: process.execArgv }) + '\\n');
const rd = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(home, f), 'utf8')); } catch { return d; } };
const plan = rd('plan.json', {});
const counters = rd('counters.json', {});
const out = flag('out');
const keys = [sub + '@' + flag('account'), sub + '@' + (out === null ? '' : path.basename(out)), sub];
let step = null;
for (const k of keys) {
  const q = plan[k];
  if (Array.isArray(q) && (counters[k] ?? 0) < q.length) { step = q[counters[k] ?? 0]; counters[k] = (counters[k] ?? 0) + 1; break; }
}
fs.writeFileSync(path.join(home, 'counters.json'), JSON.stringify(counters));
step = step ?? {};
// a driver still at work when a stop arrives (fix round 2, F2): it says it started, survives the runner's SIGTERM as the real
// one's admission does (its stop handler changes no exit code), and then answers the step as planned
if (step.hold === true) {
  process.on('SIGTERM', () => { fs.writeFileSync(path.join(home, 'term.seen'), ''); });
  fs.writeFileSync(path.join(home, 'held'), '');
  const until = Date.now() + 20000;
  while (!fs.existsSync(path.join(home, 'term.seen')) && Date.now() < until) await new Promise((r) => setTimeout(r, 20));
}
const made = () => {
  if (out === null) return;
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  const m = path.join(out, '.ccrc-history-quiz-single');
  if (!fs.existsSync(m)) fs.writeFileSync(m, '');
};
if (step.mkdir === true) made();
// the week's account record (run 3538), as the real arms writes it before its first spawn, through the real composer; a
// step that stands for a refusal before the real one's --out exists says noRecord
if (sub === 'arms' && flag('account') !== null && step.noRecord !== true) {
  made();
  const rec = path.join(out, 'quiz', 'week-account.json');
  if (!fs.existsSync(rec)) {
    const qs = await import(${JSON.stringify(pathToFileURL(fileURLToPath(new URL('../../deploy/history-quiz-single.mjs', import.meta.url))).href)});
    fs.mkdirSync(path.dirname(rec), { recursive: true });
    fs.writeFileSync(rec, qs.weekAccountText(flag('setup-sha256'), flag('account')));
  }
}
// files the step writes as the real driver would (its release pin), then a stand-in for a hard kill after the driver's write:
// the quiz root turns read-only, so the runner's save after the act fails
for (const [f, text] of step.writes ?? []) fs.writeFileSync(f, text);
if (step.chmodRoot === true) fs.chmodSync(path.join(home, '.ccrc', 'quiz'), 0o500);
if (step.exit !== undefined && step.exit !== 0) { process.stderr.write(step.stderr ?? ''); process.exitCode = step.exit; }
else {
  made();
  const stdout = step.stdout ?? (sub === 'marker' ? plan.markerText : '');
  process.stdout.write(stdout);
  const sha = step.sha ?? crypto.createHash('sha256').update(sub === 'marker' ? stdout : sub + ':' + (out ?? '')).digest('hex');
  if (step.noSha !== true) process.stderr.write((step.stderr ?? '') + 'sha256 ' + sha + '\\n');
}
`;
/** The fake record verb: logs {tool, argv, env}; `plan.verb` is a queue of {exit, stdout, stderr}; by default it confirms. */
const FAKE_VERB = `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const home = process.env.HOME;
const argv = process.argv.slice(2);
fs.appendFileSync(path.join(home, 'log.jsonl'), JSON.stringify({ tool: 'verb', argv, env: process.env }) + '\\n');
const rd = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(home, f), 'utf8')); } catch { return d; } };
const plan = rd('plan.json', {});
const counters = rd('counters.json', {});
const q = plan.verb ?? [];
const i = counters.verb ?? 0;
counters.verb = i + 1;
fs.writeFileSync(path.join(home, 'counters.json'), JSON.stringify(counters));
const step = q[i] ?? {};
const sha = argv[argv.indexOf('--sha') + 1];
if (step.exit !== undefined && step.exit !== 0) { process.stderr.write(step.stderr ?? ''); process.exitCode = step.exit; }
else process.stdout.write(step.stdout ?? ('confirmed run 7, report sha ' + sha.slice(0, 12) + (plan.baseline === true ? ' (the baseline)' : '') + '\\n'));
`;

/** The fake status client: logs {tool, argv, stdin, env}; `plan.client` is a queue of {exit, stdout}; by default it answers {"ok":true}. */
const FAKE_CLIENT = `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const home = process.env.HOME;
const stdin = fs.readFileSync(0, 'utf8');
fs.appendFileSync(path.join(home, 'log.jsonl'), JSON.stringify({ tool: 'client', argv: process.argv.slice(2), stdin, env: process.env }) + '\\n');
const rd = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(home, f), 'utf8')); } catch { return d; } };
const plan = rd('plan.json', {});
const counters = rd('counters.json', {});
const i = counters.client ?? 0;
counters.client = i + 1;
fs.writeFileSync(path.join(home, 'counters.json'), JSON.stringify(counters));
const step = (plan.client ?? [])[i] ?? {};
if (step.exit !== undefined && step.exit !== 0) process.exitCode = step.exit;
process.stdout.write(step.stdout ?? '{"ok":true}\\n');
`;
const acct = (id: string, extra: R = {}): R => ({ id, exec: { kind: 'upstream' }, telemetry: 'anthropic', ...extra });
/** Stage B, B0: the gate's code shas every fixture key carries, unless a case says otherwise. */
const FIX_CODE: Record<string, string> = { 'deploy/history-gate.mjs': 'a'.repeat(64), 'deploy/history-replay.mjs': 'b'.repeat(64) };
/** Stage B fix round 1, F1: the quiz's pilot files' shas and the skill's sha every fixture key carries, unless a case says otherwise. */
const FIX_PILOT: Record<string, string> = { 'deploy/history-quiz-single.mjs': 'd'.repeat(64), 'ccd/history/sweep.mjs': 'e'.repeat(64) };
const FIX_SKILL = '9'.repeat(64);
/** A pilot key: the build's --version line, the gate's code shas, the pilot files' shas and the skill's sha. */
const KEY = (build: string, code: Record<string, string> = FIX_CODE, pilot: Record<string, string> = FIX_PILOT, skill: string = FIX_SKILL): R =>
  ({ claude_code: build, code_shas: code, pilot_shas: pilot, skill_sha256: skill });
/** The box's stand-in for the runner's key measure (the real one spawns the week's launcher): the build in `fixture-build`, the
 *  code shas in `fixture-code`, the pilot files' in `fixture-pilot` (both JSON) and the skill's sha in `fixture-skill`, each when
 *  present; with no `fixture-build`, the key is unmeasured. */
const fixtureKey = (home: string) => async (): Promise<R> => {
  if (!existsSync(join(home, 'fixture-build'))) return { state: 'unmeasured', why: 'fixture: no build' };
  const opt = (f: string): string | null => (existsSync(join(home, f)) ? readFileSync(join(home, f), 'utf8') : null);
  const code = opt('fixture-code');
  const pilot = opt('fixture-pilot');
  return { state: 'value', key: KEY(opt('fixture-build')!, code === null ? FIX_CODE : JSON.parse(code) as Record<string, string>,
    pilot === null ? FIX_PILOT : JSON.parse(pilot) as Record<string, string>, opt('fixture-skill') ?? FIX_SKILL) };
};

interface Box {
  home: string; root: string; history: string; driver: string; verb: string; client: string;
  setLimits(id: string, v: R | null): void;
  plan(p: R): void;
  calls(tool?: string): R[];
  state(): R | null;
  tick(o?: { now?: number; env?: R; deps?: R }): Promise<{ code: number; err: string }>;
}
function mkBox(o: { accounts?: R[] | null; history?: boolean; limits?: Record<string, R | null>; agentEnv?: boolean } = {}): Box {
  const home = mkTmp('quiz-unattended-');
  const fake = join(home, 'fake');
  mkdirSync(fake, { recursive: true });
  const driver = join(fake, 'driver.mjs');
  const verb = join(fake, 'verb.mjs');
  const client = join(fake, 'client.mjs');
  writeFileSync(driver, FAKE_DRIVER);
  writeFileSync(verb, FAKE_VERB);
  writeFileSync(client, FAKE_CLIENT);
  chmodSync(client, 0o755);
  chmodSync(driver, 0o755);
  chmodSync(verb, 0o755);
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  // the spend guard's second probe: an empty regular file stands in for the credential file (never any real content)
  if (o.agentEnv !== false) writeFileSync(join(home, '.ccrc', 'agent.env'), '');
  const accounts = o.accounts === undefined ? [acct('acct-a', { hidden: true }), acct('acct-b'), acct('acct-c', { exec: { kind: 'generated' }, telemetry: 'none' })] : o.accounts;
  const limits: Record<string, R | null> = { ...o.limits };
  if (accounts !== null) writeFileSync(join(home, '.ccrc', 'accounts.json'), JSON.stringify({ accounts }));
  const history = join(home, '.ccrc', 'history');
  if (o.history !== false) mkdirSync(history, { recursive: true });
  const root = join(home, '.ccrc', 'quiz');
  const box: Box = {
    home, root, history, driver, verb, client,
    setLimits(id, v) { limits[id] = v; },
    plan(p) { writeFileSync(join(home, 'plan.json'), JSON.stringify({ markerText: MARKER, ...p })); },
    calls(tool) {
      const f = join(home, 'log.jsonl');
      if (!existsSync(f)) return [];
      const all = readFileSync(f, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as R);
      return tool === undefined ? all.filter((c) => c.tool !== 'client') : all.filter((c) => c.tool === tool);
    },
    state() { const f = join(root, 'unattended.json'); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null; },
    async tick(t = {}) {
      let err = '';
      // the limits rows the driver's own reading finds, dated a minute before this tick (a null row is no file)
      const nowS = Math.floor((t.now ?? NOW) / 1000);
      mkdirSync(join(home, '.cc-limits'), { recursive: true });
      for (const a of accounts ?? []) {
        const v = limits[a.id] === undefined ? { five: 10, seven: 10 } : limits[a.id];
        const f = join(home, '.cc-limits', `${a.id as string}.json`);
        if (v === null) { try { unlinkSync(f); } catch { /* absent */ } } else {
          writeFileSync(f, JSON.stringify({ ...v, ts: nowS - 60, fiveResetAt: nowS + 3600, sevenResetAt: nowS + 86400 }));
        }
      }
      const env: R = { HOME: home, LANG: 'fixture.UTF-8', PATH: `${process.execPath.replace(/\/[^/]*$/, '')}:${process.env.PATH ?? ''}`, ...t.env };
      for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
      const code = await U.main(env, { driver, verb, client, now: () => t.now ?? NOW, err: (s: string) => { err += s; }, pilotKey: fixtureKey(home), ...t.deps }) as number;
      return { code, err };
    },
  };
  if (!existsSync(join(home, 'plan.json'))) box.plan({});
  return box;
}
const SETUP_FLAGS = (out: string, account: string): string[] => ['setup', '--out', out, '--account', account, '--budget', '5000000',
  '--settings-mode', 'restricted', '--writer-model', 'claude-opus-5-5', '--judge-model', 'claude-opus-5-5', '--arm-model', 'claude-opus-5-5'];
const REFUSE = (word: string, detail = 'fixture detail'): R => ({ exit: 2, stderr: `ccrc history-quiz-single: ${word}: ${detail}\n` });
const subs = (b: Box): string[] => b.calls('driver').map((c) => c.argv[0] as string);
/** Every file under a directory, relative, sorted (directories carry a trailing slash). */
function tree(dir: string, rel = ''): string[] {
  const names: string[] = [];
  for (const n of readdirSync(join(dir, rel)).sort()) {
    const r = rel === '' ? n : `${rel}/${n}`;
    const st = lstatSync(join(dir, r));
    if (st.isDirectory()) { names.push(`${r}/`); names.push(...tree(dir, r)); } else names.push(r);
  }
  return names;
}

describe('the refusals come first', () => {
  for (const [name, env, word] of [
    ['CLAUDECODE set', { CLAUDECODE: '1' }, 'in-session'],
    ['CLAUDECODE set but empty', { CLAUDECODE: '' }, 'in-session'],
    ['TMUX_PANE set', { TMUX_PANE: '%3' }, 'in-pane'],
    ['TMUX_PANE set but empty', { TMUX_PANE: '' }, 'in-pane'],
  ] as Array<[string, R, string]>) {
    it(`${name}: ${word}, exit 2, nothing read or written`, async () => {
      const b = mkBox();
      const r = await b.tick({ env });
      expect(r.code).toBe(2);
      expect(r.err).toBe(`ccrc quiz-unattended: ${word}: ${r.err.split(`${word}: `)[1]}`);
      expect(r.err.startsWith(`ccrc quiz-unattended: ${word}: `)).toBe(true);
      expect(existsSync(b.root)).toBe(false);
      expect(b.calls()).toEqual([]);
      expect(existsSync(join(b.history, 'headless-on'))).toBe(false);
    });
  }
  it('the session word wins when both are set, and an unusable HOME refuses before anything is made', async () => {
    const b = mkBox();
    expect((await b.tick({ env: { CLAUDECODE: '1', TMUX_PANE: '%1' } })).err).toContain(': in-session: ');
    // the refusals come before even HOME is looked at
    expect((await b.tick({ env: { CLAUDECODE: '1', HOME: undefined } })).err).toContain(': in-session: ');
    expect((await b.tick({ env: { TMUX_PANE: '%1', HOME: undefined } })).err).toContain(': in-pane: ');
    const r = await b.tick({ env: { HOME: 'relative/home' } });
    expect(r.code).toBe(2);
    expect(r.err).toContain(': home-unset: ');
    expect(existsSync(b.root)).toBe(false);
  });
  it('sets umask 077 and makes the quiz root 0700', async () => {
    const b = mkBox();
    process.umask(0o022);
    await b.tick();
    expect(process.umask()).toBe(0o077);
    expect(statSync(b.root).mode & 0o777).toBe(0o700);
    expect(statSync(join(b.root, 'unattended.json')).mode & 0o777).toBe(0o600);
  });
});

describe('a first run from nothing to confirmed', () => {
  it('runs setup, source, freeze, marker, headless, arms, judge, report and record, with the runbook\'s flags', async () => {
    const b = mkBox();
    // acct-a is hidden (never tried); acct-b is refused by the driver; acct-c is admitted.
    b.plan({ 'setup@acct-b': [REFUSE('account-refused', 'acct-b is not admitted')] });
    const r = await b.tick();
    expect(r.code).toBe(0);
    const S = join(b.root, 'setup.1');
    const W = join(b.root, 'weeks', WEEK);
    const shaSetup = hex(`setup:${S}`);
    const shaSourced = hex(`source:${S}`);
    const shaFrozen = hex(`freeze:${S}`);
    const shaMarker = hex(MARKER);
    const shaArms = hex(`arms:${W}`);
    const shaJudged = hex(`judge:${W}`);
    const shaReport = hex(`report:${W}`);
    const base = ['--out', W, '--setup', join(S, 'setup.json'), '--setup-sha256', shaSetup, '--frozen', join(S, 'quiz', 'frozen.json'), '--frozen-sha256', shaFrozen];
    const armsSummary = ['--arms-summary', join(W, 'quiz', 'arms-summary.json'), '--arms-summary-sha256', shaArms];
    expect(b.calls('driver').map((c) => c.argv)).toEqual([
      SETUP_FLAGS(S, 'acct-b'),
      SETUP_FLAGS(S, 'acct-c'),
      ['source', '--out', S, '--setup', join(S, 'setup.json'), '--setup-sha256', shaSetup],
      ['freeze', '--out', S, '--setup', join(S, 'setup.json'), '--setup-sha256', shaSetup, '--sourced', join(S, 'quiz', 'sourced.json'), '--sourced-sha256', shaSourced],
      ['marker', '--frozen', join(S, 'quiz', 'frozen.json'), '--frozen-sha256', shaFrozen],
      ['marker', '--frozen', join(S, 'quiz', 'frozen.json'), '--frozen-sha256', shaFrozen],
      ['arms', ...base, '--account', 'acct-c'],
      ['judge', ...base, ...armsSummary, '--account', 'acct-c'],
      ['report', ...base, ...armsSummary, '--judged', join(W, 'quiz', 'judged.json'), '--judged-sha256', shaJudged],
    ]);
    expect(b.calls('driver').every((c) => c.execArgv.includes('--no-warnings'))).toBe(true);
    expect(b.calls('verb').map((c) => c.argv)).toEqual([['quiz-record', '--report', join(W, 'single-report.json'), '--sha', shaReport, '--confirm']]);
    const st = b.state() as R;
    expect(st.kind).toBe('ccrc-quiz-unattended-state');
    expect(st.v).toBe(1);
    expect(st.setup).toEqual({ out: S, account: 'acct-c', setup_sha256: shaSetup, sourced_sha256: shaSourced, frozen_sha256: shaFrozen,
      marker_sha256: shaMarker, headless: 'written' });
    expect(st.weeks).toEqual({ [WEEK]: { out: W, state: 'confirmed', arms_sha256: shaArms, judged_sha256: shaJudged, report_sha256: shaReport,
      run_id: 7, baseline: false, word: null } });
    expect(st.last).toEqual({ at_ms: NOW, week: WEEK, act: 'done', outcome: 'ok', word: null, detail: null, posted: true });
    // the headless marker: the exact bytes, 0600
    const h = join(b.history, 'headless-on');
    expect(readFileSync(h, 'utf8')).toBe(MARKER);
    expect(statSync(h).mode & 0o777).toBe(0o600);
    // the lock is gone
    expect(existsSync(join(b.root, 'unattended.lock'))).toBe(false);
  });

  it('records the baseline when the verb says the run became it', async () => {
    const b = mkBox();
    b.plan({ baseline: true });
    await b.tick();
    expect((b.state() as R).weeks[WEEK]).toMatchObject({ state: 'confirmed', run_id: 7, baseline: true });
  });

  it('writes nothing outside the quiz root but the one headless-on file', async () => {
    const b = mkBox();
    const before = tree(join(b.home, '.ccrc'));
    await b.tick();
    const added = tree(join(b.home, '.ccrc')).filter((p) => !before.includes(p));
    expect(added.filter((p) => !p.startsWith('quiz/') && p !== 'quiz/')).toEqual(['history/headless-on']);
  });

  it('a confirmed week does nothing on the next tick, and setup never re-runs', async () => {
    const b = mkBox();
    await b.tick();
    const n = b.calls().length;
    const again = await b.tick({ now: NOW + 3600_000 });
    expect(again.code).toBe(0);
    expect(b.calls().length).toBe(n);
    expect((b.state() as R).last).toEqual({ at_ms: NOW + 3600_000, week: WEEK, act: 'done', outcome: 'ok', word: null, detail: null, posted: true });
    // the next week starts with arms: no second setup, source, freeze or marker
    await b.tick({ now: NEXT_NOW });
    expect(subs(b).filter((s) => ['setup', 'source', 'freeze'].includes(s))).toEqual(['setup', 'source', 'freeze']);
    expect(subs(b).filter((s) => s === 'marker').length).toBe(2);
    expect(subs(b).filter((s) => s === 'arms').length).toBe(2);
    expect(b.calls('driver').at(-1)?.argv.slice(0, 2)).toEqual(['report', '--out']);
    expect(Object.keys((b.state() as R).weeks).sort()).toEqual([WEEK, NEXT_WEEK].sort());
  });

  it('the children get HOME, LANG and PATH only, never CLAUDECODE or TMUX_PANE or any other name', async () => {
    const b = mkBox();
    await b.tick({ env: { ANTHROPIC_API_KEY: 'k', CCRC_SOMETHING: 'x', TMUX: 'sock', CLAUDE_CONFIG_DIR: '/c' } });
    const calls = b.calls();
    expect(calls.length).toBeGreaterThan(8);
    for (const c of calls) {
      expect(Object.keys(c.env).sort()).toEqual(['HOME', 'LANG', 'PATH']);
      expect(c.env.HOME).toBe(b.home);
      expect(c.env.LANG).toBe('fixture.UTF-8');
    }
  });
});

describe('the account pick', () => {
  it('skips a hidden account and one the driver refuses, in roster order', async () => {
    const b = mkBox({ accounts: [acct('acct-a', { hidden: true }), acct('acct-b'), acct('acct-c'), acct('acct-d')] });
    b.plan({ 'setup@acct-b': [REFUSE('account-refused')] });
    await b.tick();
    expect(b.calls('driver').filter((c) => c.argv[0] === 'setup').map((c) => c.argv[c.argv.indexOf('--account') + 1])).toEqual(['acct-b', 'acct-c']);
    expect((b.state() as R).setup.account).toBe('acct-c');
  });
  it('no admitted account: refused no-account-admitted, nothing else runs', async () => {
    const b = mkBox({ accounts: [acct('acct-a', { hidden: true }), acct('acct-b')] });
    b.plan({ 'setup@acct-b': [REFUSE('account-refused')] });
    const r = await b.tick();
    expect(r.code).toBe(0);
    expect(subs(b)).toEqual(['setup']);
    const st = b.state() as R;
    expect(st.setup).toBe(null);
    expect(st.last).toMatchObject({ week: null, act: 'setup', outcome: 'refused', word: 'no-account-admitted' });
  });
  it('an unreadable roster or one with only hidden accounts is no-account-admitted too, with no spawn', async () => {
    for (const accounts of [null, [acct('acct-a', { hidden: true })], []] as Array<R[] | null>) {
      const b = mkBox({ accounts });
      await b.tick();
      expect(b.calls()).toEqual([]);
      expect((b.state() as R).last).toMatchObject({ act: 'setup', outcome: 'refused', word: 'no-account-admitted' });
    }
  });
  it('any other refusal stops on its word and the next account is not tried', async () => {
    const b = mkBox();
    b.plan({ 'setup@acct-b': [REFUSE('input-invalid', 'fixture')] });
    await b.tick();
    expect(subs(b)).toEqual(['setup']);
    expect((b.state() as R).last).toMatchObject({ act: 'setup', outcome: 'refused', word: 'input-invalid' });
  });
  it('a stopped setup leaves a directory, so the retry takes the next setup.<n>', async () => {
    const b = mkBox();
    b.plan({ 'setup@acct-b': [{ ...REFUSE('limits-threshold'), mkdir: true }] });
    const r1 = await b.tick();
    expect(r1.code).toBe(0);
    expect((b.state() as R).last).toMatchObject({ act: 'setup', outcome: 'waiting', word: 'limits-threshold' });
    expect(existsSync(join(b.root, 'setup.1'))).toBe(true);
    await b.tick({ now: NOW + 6 * 3600_000 });
    const setups = b.calls('driver').filter((c) => c.argv[0] === 'setup').map((c) => c.argv[2]);
    expect(setups).toEqual([join(b.root, 'setup.1'), join(b.root, 'setup.2')]);
    expect((b.state() as R).setup.out).toBe(join(b.root, 'setup.2'));
  });
});

describe('the account: eligibility, room and the weekly re-check', () => {
  const triedOf = (b: Box): string[] => b.calls('driver').filter((c) => c.argv[0] === 'setup').map((c) => c.argv[c.argv.indexOf('--account') + 1] as string);
  it('only roster accounts that are not hidden, upstream or generated, and not an openrouter or codex telemetry, are candidates', async () => {
    const b = mkBox({ accounts: [
      acct('acct-h', { hidden: true }),
      acct('acct-or', { telemetry: 'openrouter' }),
      acct('acct-cx', { telemetry: 'codex' }),
      acct('acct-kc', { exec: { kind: 'codex' } }),
      acct('acct-ke', { exec: { kind: 'external' } }),
      { id: 'acct-none', telemetry: 'anthropic' },
      acct('acct-ok-up'),
      acct('acct-ok-gen', { exec: { kind: 'generated' }, telemetry: 'none' }),
    ] });
    b.plan({ 'setup@acct-ok-up': [REFUSE('account-refused')] });
    await b.tick();
    expect(triedOf(b)).toEqual(['acct-ok-up', 'acct-ok-gen']);
    expect((b.state() as R).setup.account).toBe('acct-ok-gen');
  });
  it('eligibleAccountsOf is pure over the roster list', () => {
    const list = [acct('a', { hidden: true }), acct('b', { telemetry: 'codex' }), acct('c'), acct('d', { exec: { kind: 'generated' }, telemetry: 'none' }), acct('e', { exec: { kind: 'external' } })];
    expect(U.eligibleAccountsOf(list)).toEqual(['c', 'd']);
    expect(U.eligibleAccountsOf([null, 3, {}, { id: '', exec: { kind: 'upstream' } }])).toEqual([]);
  });
  it('tries the one with the lowest seven first, ties in roster order, then the next on account-refused', async () => {
    const b = mkBox({ accounts: [acct('acct-b'), acct('acct-c'), acct('acct-d'), acct('acct-e')],
      limits: { 'acct-b': { five: 10, seven: 60 }, 'acct-c': { five: 10, seven: 20 }, 'acct-d': { five: 10, seven: 40 }, 'acct-e': { five: 10, seven: 20 } } });
    b.plan({ 'setup@acct-c': [REFUSE('account-refused')], 'setup@acct-e': [REFUSE('account-refused')] });
    await b.tick();
    expect(triedOf(b)).toEqual(['acct-c', 'acct-e', 'acct-d']);
    expect((b.state() as R).setup.account).toBe('acct-d');
  });
  it('a candidate without room (over the threshold, or no readable row) is not tried', async () => {
    const b = mkBox({ accounts: [acct('acct-b'), acct('acct-c'), acct('acct-d')],
      limits: { 'acct-b': { five: 10, seven: 80 }, 'acct-c': null, 'acct-d': { five: 10, seven: 50 } } });
    await b.tick();
    expect(triedOf(b)).toEqual(['acct-d']);
  });
  it('no candidate with room: waiting no-room, no setup call, the detail by position, and it never latches', async () => {
    const b = mkBox({ accounts: [acct('acct-b'), acct('acct-c')], limits: { 'acct-b': { five: 10, seven: 80 }, 'acct-c': null } });
    const r = await b.tick();
    expect(r.code).toBe(0);
    expect(b.calls('driver')).toEqual([]);
    const st = b.state() as R;
    expect(st.setup_refused).toBe(null);
    expect(st.last).toMatchObject({ week: null, act: 'setup', outcome: 'waiting', word: 'no-room', detail: '1: limits-threshold, 2: limits-stale' });
    expect(JSON.stringify(st.last)).not.toContain('acct-');
    // retried at the next tick, in the same week, and goes on once one has room
    await b.tick({ now: NOW + 3600_000 });
    expect((b.state() as R).last).toMatchObject({ outcome: 'waiting', word: 'no-room' });
    b.setLimits('acct-c', { five: 5, seven: 5 });
    await b.tick({ now: NOW + 2 * 3600_000 });
    expect((b.state() as R).setup.account).toBe('acct-c');
    expect((b.state() as R).weeks[WEEK].state).toBe('confirmed');
  });
  it('an empty candidate list (nothing eligible) is no-account-admitted, which does latch', async () => {
    const b = mkBox({ accounts: [acct('acct-or', { telemetry: 'openrouter' })] });
    await b.tick();
    expect(b.calls('driver')).toEqual([]);
    expect((b.state() as R).last).toMatchObject({ act: 'setup', outcome: 'refused', word: 'no-account-admitted' });
    expect((b.state() as R).setup_refused).toMatchObject({ word: 'no-account-admitted', week: WEEK });
  });
  const stopAt = async (act: string): Promise<{ b: Box; account: string }> => {
    const b = mkBox();
    b.plan({ [act]: [REFUSE('interrupted')] });
    await b.tick();
    expect((b.state() as R).last).toMatchObject({ act, outcome: 'waiting', word: 'interrupted' });
    return { b, account: (b.state() as R).setup.account as string };
  };
  for (const act of ['arms', 'judge']) {
    it(`before ${act}: no room for the week's account waits (no-room), spawns nothing, the week stays running and on its account`, async () => {
      const { b, account } = await stopAt(act);
      const n = b.calls().length;
      b.setLimits(account, { five: 10, seven: 90 });
      const r = await b.tick({ now: NOW + 3600_000 });
      expect(r.code).toBe(0);
      expect(b.calls().length).toBe(n);
      const st = b.state() as R;
      expect(st.weeks[WEEK].state).toBe('running');
      expect(st.last).toMatchObject({ week: WEEK, act, outcome: 'waiting', word: 'no-room' });
      expect(JSON.stringify(st.last)).not.toContain('acct-');
      b.setLimits(account, null);   // no readable row: no room either
      await b.tick({ now: NOW + 2 * 3600_000 });
      expect(b.calls().length).toBe(n);
      b.setLimits(account, { five: 10, seven: 10 });
      await b.tick({ now: NOW + 3 * 3600_000 });
      expect((b.state() as R).weeks[WEEK].state).toBe('confirmed');
    });
  }
  it('report and record are not re-checked: the spend is done', async () => {
    const { b, account } = await stopAt('report');
    b.setLimits(account, { five: 95, seven: 95 });
    await b.tick({ now: NOW + 3600_000 });
    expect((b.state() as R).weeks[WEEK].state).toBe('confirmed');
  });
  it('a week still running when a new ISO week starts is closed failed week-ended, and the new week starts fresh', async () => {
    const { b } = await stopAt('arms');
    await b.tick({ now: NEXT_NOW });
    const st = b.state() as R;
    expect(st.weeks[WEEK]).toMatchObject({ state: 'failed', word: 'week-ended' });
    expect(st.weeks[NEXT_WEEK].state).toBe('confirmed');
    expect(b.calls('driver').filter((c) => c.argv[0] === 'arms').map((c) => c.argv[2])).toEqual([join(b.root, 'weeks', WEEK), join(b.root, 'weeks', NEXT_WEEK)]);
  });
  it('a running week of the current ISO week is not closed', async () => {
    const { b } = await stopAt('arms');
    await b.tick({ now: NOW + 3600_000 });
    expect((b.state() as R).weeks[WEEK].state).toBe('confirmed');
  });
});

describe('the status post', () => {
  const client = (b: Box): R[] => b.calls('client');
  it('posts the tick\'s `last` through the client, body and env as agreed, and records posted: true', async () => {
    const b = mkBox();
    await b.tick();
    const c = client(b);
    expect(c.length).toBe(1);
    expect(c[0].argv).toEqual(['quiz', 'status', '--json', '-']);
    const body = JSON.parse(c[0].stdin);
    expect(body).toMatchObject({ week: WEEK, act: 'done', outcome: 'ok', word: null, detail: null, at: NOW, account: 'acct-b' });
    expect(Object.keys(body)).toEqual(['week', 'act', 'outcome', 'word', 'detail', 'at', 'account', 'by']);
    // the trace the record and confirm calls carry, and the server's own one-line bound on it (quizRoutes' isTrace)
    expect(body.by).toMatch(/^quiz-unattended [A-Za-z0-9._-]+ unknown 2026-11-21T12:00:00Z$/);
    expect(body.by.length).toBeLessThanOrEqual(200);
    expect(Object.keys(c[0].env).sort()).toEqual(['HOME', 'LANG', 'PATH']);
    expect((b.state() as R).last.posted).toBe(true);
  });
  it('posts at the end of every tick that wrote `last`: waiting, refused (latched too) and failed', async () => {
    const b = mkBox();
    b.plan({ source: [REFUSE('input-invalid', 'fixture')] });
    await b.tick();
    await b.tick({ now: NOW + 3600_000 });   // latched
    const bodies = client(b).map((c) => JSON.parse(c.stdin as string) as R);
    expect(bodies.map((x) => [x.act, x.outcome, x.word, x.account])).toEqual([['source', 'refused', 'input-invalid', 'acct-b'], ['source', 'refused', 'input-invalid', 'acct-b']]);
    expect(bodies.map((x) => x.at)).toEqual([NOW, NOW + 3600_000]);
    const b2 = mkBox();
    b2.plan({ arms: [{ exit: 1, stderr: 'ccrc history-quiz-single: internal error: boom\n' }] });
    const r = await b2.tick();
    expect(r.code).toBe(1);
    expect(client(b2).map((c) => JSON.parse(c.stdin as string).outcome)).toEqual(['failed']);
    const b3 = mkBox({ accounts: [acct('acct-b')], limits: { 'acct-b': { five: 10, seven: 90 } } });
    await b3.tick();
    expect(client(b3).map((c) => { const x = JSON.parse(c.stdin as string) as R; return [x.outcome, x.word, x.account]; })).toEqual([['waiting', 'no-room', null]]);
  });
  it('posts nothing for the in-session and in-pane refusals, a locked tick or an unreadable state file', async () => {
    const b = mkBox();
    await b.tick({ env: { CLAUDECODE: '1' } });
    await b.tick({ env: { TMUX_PANE: '%1' } });
    mkdirSync(b.root, { recursive: true });
    writeFileSync(join(b.root, 'unattended.lock'), `${process.pid}\n`);
    await b.tick();
    unlinkSync(join(b.root, 'unattended.lock'));
    writeFileSync(join(b.root, 'unattended.json'), '{ not json');
    await b.tick();
    expect(client(b)).toEqual([]);
  });
  it('cuts the detail to 200 characters in the body, and keeps the state\'s own', async () => {
    const b = mkBox();
    b.plan({ arms: [REFUSE('input-invalid', 'x'.repeat(250))] });
    await b.tick();
    const body = JSON.parse(client(b).at(-1)?.stdin as string) as R;
    expect(body.detail).toBe('x'.repeat(200));
    expect(((b.state() as R).last.detail as string).length).toBe(250);
  });
  for (const [name, plan, deps] of [
    ['the client exits non-zero', { client: [{ exit: 3, stdout: '' }] }, {}],
    ['the client answers ok:false', { client: [{ stdout: '{"ok":false}\n' }] }, {}],
    ['the client prints no JSON', { client: [{ stdout: 'nope' }] }, {}],
  ] as Array<[string, R, R]>) {
    it(`a failed post never fails the tick: ${name} records posted: false`, async () => {
      const b = mkBox();
      b.plan(plan);
      const r = await b.tick({ deps });
      expect(r.code).toBe(0);
      const st = b.state() as R;
      expect(st.last).toMatchObject({ act: 'done', outcome: 'ok', posted: false });
      expect(st.weeks[WEEK].state).toBe('confirmed');
    });
  }
  it('a client that cannot be started (an executable with a missing interpreter) records posted: false', async () => {
    const b = mkBox();
    const bad = join(b.home, 'fake', 'bad-client');
    writeFileSync(bad, '#!/nonexistent/interpreter\n');
    chmodSync(bad, 0o755);
    const r = await b.tick({ deps: { client: bad } });
    expect(r.code).toBe(0);
    expect((b.state() as R).last).toMatchObject({ act: 'done', outcome: 'ok', posted: false });
  });
  it('a failed post after an internal failure keeps the exit code 1', async () => {
    const b = mkBox();
    b.plan({ arms: [{ exit: 1, stderr: 'x\n' }], client: [{ exit: 3 }] });
    const r = await b.tick();
    expect(r.code).toBe(1);
    expect((b.state() as R).last).toMatchObject({ outcome: 'failed', posted: false });
  });
});

describe('the headless marker is written once, atomically, and never edited', () => {
  const journalOf = (b: Box): string[] => {
    const f = join(b.root, 'journal.log');
    return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter((l) => l !== '') : [];
  };
  // a link that did not happen: the intent line stands, a note names the failure, and no line claims `written`
  const notOurs = (b: Box, code: string): boolean => {
    const j = journalOf(b);
    return j.length === 2 && j[0].includes('headless-on writing store') && j[1].includes(`headless-on not written (${code})`) && !j.some((l) => / written store/.test(l));
  };
  it('absent: written atomically (the exact bytes, 0600, no temp left), journalled once', async () => {
    const b = mkBox();
    await b.tick();
    const h = join(b.history, 'headless-on');
    expect(readFileSync(h, 'utf8')).toBe(MARKER);
    expect(statSync(h).mode & 0o777).toBe(0o600);
    expect((b.state() as R).setup.headless).toBe('written');
    expect(tree(b.root).filter((p) => p.includes('headless-on'))).toEqual([]);
    const j = journalOf(b);
    expect(j).toEqual([`${new Date(NOW).toISOString()} headless-on writing store ${STORE} families fam-one/${GEN1} fam-two/-`]);
    expect(statSync(join(b.root, 'journal.log')).mode & 0o777).toBe(0o600);
    // later ticks and weeks write and journal nothing more
    await b.tick({ now: NEXT_NOW });
    expect(journalOf(b).length).toBe(1);
  });
  it('exact: kept, headless `present`, the file untouched and nothing journalled', async () => {
    const b = mkBox();
    const h = join(b.history, 'headless-on');
    writeFileSync(h, MARKER);
    chmodSync(h, 0o644);
    const old = new Date(Date.UTC(2020, 0, 1));
    utimesSync(h, old, old);
    const ino = statSync(h).ino;
    await b.tick();
    expect((b.state() as R).setup.headless).toBe('present');
    expect(statSync(h).ino).toBe(ino);
    expect(statSync(h).mtimeMs).toBe(old.getTime());
    expect(statSync(h).mode & 0o777).toBe(0o644);
    expect(journalOf(b)).toEqual([]);
    expect((b.state() as R).weeks[WEEK].state).toBe('confirmed');
  });
  it('a superset (extra families, comments) is kept as it is', async () => {
    const b = mkBox();
    const h = join(b.history, 'headless-on');
    const text = `# the operator's own list\n${SUPERSET}`;
    writeFileSync(h, text);
    await b.tick();
    expect((b.state() as R).setup.headless).toBe('present');
    expect(readFileSync(h, 'utf8')).toBe(text);
    expect(journalOf(b)).toEqual([]);
  });
  for (const [name, text, word] of [
    ['missing a family', INCOMPLETE, 'headless-on-incomplete'],
    ['naming another store', OTHER_STORE, 'headless-on-incomplete'],
    ['a generation that differs', `store ${STORE}\nfam-one 0189abcd-0000-4000-8000-000000000002\nfam-two -\n`, 'headless-on-incomplete'],
    ['unparseable', 'the operator\'s own list\n', 'headless-on-unreadable'],
    ['with a store line twice', `${MARKER}store ${STORE}\n`, 'headless-on-unreadable'],
    ['over the grammar\'s size bound', `${MARKER}${'# x\n'.repeat(30000)}`, 'headless-on-unreadable'],
  ] as Array<[string, string, string]>) {
    it(`${name}: refused ${word}, the file byte-identical, nothing journalled, retried once a week`, async () => {
      const b = mkBox();
      const h = join(b.history, 'headless-on');
      writeFileSync(h, text);
      const r = await b.tick();
      expect(r.code).toBe(0);
      expect(readFileSync(h, 'utf8')).toBe(text);
      expect(journalOf(b)).toEqual([]);
      expect(subs(b).filter((s) => ['arms', 'judge', 'report'].includes(s))).toEqual([]);
      expect(b.calls('verb')).toEqual([]);
      const st = b.state() as R;
      expect(st.setup.headless).toBe(null);
      expect(st.last).toMatchObject({ week: null, act: 'headless', outcome: 'refused', word });
      await b.tick({ now: NOW + 6 * 3600_000 });
      expect(subs(b).filter((s) => s === 'marker').length).toBe(2);   // latched: the second tick ran nothing
      expect(readFileSync(h, 'utf8')).toBe(text);
      // once the operator completes it, the next week's attempt goes on and keeps it as it is
      writeFileSync(h, SUPERSET);
      await b.tick({ now: NEXT_NOW });
      expect((b.state() as R).weeks[NEXT_WEEK].state).toBe('confirmed');
      expect(readFileSync(h, 'utf8')).toBe(SUPERSET);
    });
  }
  it('a symlink or a directory in its place is unreadable, left as it is', async () => {
    for (const kind of ['symlink', 'dir']) {
      const b = mkBox();
      const h = join(b.history, 'headless-on');
      const real = join(b.home, 'elsewhere');
      writeFileSync(real, MARKER);
      if (kind === 'symlink') symlinkSync(real, h); else mkdirSync(h);
      await b.tick();
      expect((b.state() as R).last).toMatchObject({ act: 'headless', outcome: 'refused', word: 'headless-on-unreadable' });
      expect(lstatSync(h).isSymbolicLink()).toBe(kind === 'symlink');
      expect(lstatSync(h).isDirectory()).toBe(kind === 'dir');
      expect(readFileSync(real, 'utf8')).toBe(MARKER);
      expect(journalOf(b)).toEqual([]);
    }
  });
  it('the link never clobbers: a different file that appears between the probe and the link is judged and kept', async () => {
    const b = mkBox();
    const h = join(b.history, 'headless-on');
    await b.tick({ deps: { beforeHeadlessWrite: () => writeFileSync(h, INCOMPLETE) } });
    expect(readFileSync(h, 'utf8')).toBe(INCOMPLETE);
    expect((b.state() as R).last).toMatchObject({ act: 'headless', outcome: 'refused', word: 'headless-on-incomplete' });
    expect(notOurs(b, 'EEXIST')).toBe(true);
    expect(tree(b.root).filter((p) => p.includes('headless-on'))).toEqual([]);
  });
  it('a racer that wrote the complete marker is judged `present` (EEXIST), not journalled as ours', async () => {
    const b = mkBox();
    const h = join(b.history, 'headless-on');
    await b.tick({ deps: { beforeHeadlessWrite: () => writeFileSync(h, SUPERSET) } });
    expect(readFileSync(h, 'utf8')).toBe(SUPERSET);
    expect((b.state() as R).setup.headless).toBe('present');
    expect(notOurs(b, 'EEXIST')).toBe(true);
  });
  it('the journal line is written BEFORE the link, and the link sees the complete bytes', async () => {
    const b = mkBox();
    let seen: string[] = [];
    let tmpBytes = '';
    await b.tick({ deps: { link: (a: string, t: string) => {
      seen = journalOf(b);
      tmpBytes = readFileSync(a, 'utf8');
      linkSync(a, t);
    } } });
    expect(seen.length).toBe(1);
    expect(seen[0]).toContain('headless-on writing store');
    expect(tmpBytes).toBe(MARKER);
    expect(readFileSync(join(b.history, 'headless-on'), 'utf8')).toBe(MARKER);
    expect(journalOf(b).length).toBe(1);
  });
  it('an unexpected link failure leaves the intent journalled with a not-written note', async () => {
    const b = mkBox();
    await b.tick({ deps: { link: () => { throw Object.assign(new Error('io'), { code: 'EIO' }); } } });
    expect(existsSync(join(b.history, 'headless-on'))).toBe(false);
    expect(notOurs(b, 'EIO')).toBe(true);
  });
  it('a link across devices is refused headless-on-cross-device, with no temp left and nothing written', async () => {
    const b = mkBox();
    await b.tick({ deps: { link: () => { throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' }); } } });
    expect((b.state() as R).last).toMatchObject({ act: 'headless', outcome: 'refused', word: 'headless-on-cross-device' });
    expect(existsSync(join(b.history, 'headless-on'))).toBe(false);
    expect(tree(b.root).filter((p) => p.includes('headless-on'))).toEqual([]);
    expect(notOurs(b, 'EXDEV')).toBe(true);
  });
  it('the history store absent: refused history-store-absent and the runner makes no ~/.ccrc/history', async () => {
    const b = mkBox({ history: false });
    await b.tick();
    expect(existsSync(b.history)).toBe(false);
    expect((b.state() as R).last).toMatchObject({ act: 'headless', outcome: 'refused', word: 'history-store-absent' });
  });
  it('a marker whose bytes do not hash to the printed sha is refused marker-sha-mismatch', async () => {
    const b = mkBox();
    b.plan({ marker: [{ stdout: 'abc\n', sha: 'f'.repeat(64) }] });
    await b.tick();
    const st = b.state() as R;
    expect(st.last).toMatchObject({ act: 'marker', outcome: 'refused', word: 'marker-sha-mismatch' });
    expect(st.setup.marker_sha256).toBe(null);
    expect(existsSync(join(b.history, 'headless-on'))).toBe(false);
  });
  it('a marker that changed between its two runs is not written', async () => {
    const b = mkBox();
    b.plan({ marker: [{}, { stdout: 'other\n' }] });
    await b.tick();
    expect((b.state() as R).last).toMatchObject({ act: 'headless', outcome: 'refused', word: 'marker-sha-mismatch' });
    expect(existsSync(join(b.history, 'headless-on'))).toBe(false);
  });
  it('a marker the history lib cannot parse is refused marker-unparseable, and nothing is written', async () => {
    const b = mkBox();
    b.plan({ markerText: 'not a marker\n' });
    await b.tick();
    expect((b.state() as R).last).toMatchObject({ act: 'headless', outcome: 'refused', word: 'marker-unparseable' });
    expect(existsSync(join(b.history, 'headless-on'))).toBe(false);
  });
});

describe('stops, failed weeks and resuming', () => {
  it('a limits stop leaves the week running and the next tick resumes the same directory', async () => {
    const b = mkBox();
    b.plan({ [`arms@${WEEK}`]: [{ ...REFUSE('limits-threshold', 'five 71 seven 5'), mkdir: true }] });
    const r1 = await b.tick();
    expect(r1.code).toBe(0);
    let st = b.state() as R;
    expect(st.weeks[WEEK]).toMatchObject({ state: 'running', arms_sha256: null, word: null });
    expect(st.last).toEqual({ at_ms: NOW, week: WEEK, act: 'arms', outcome: 'waiting', word: 'limits-threshold', detail: 'five 71 seven 5', posted: true });
    const t2 = NOW + 6 * 3600_000;
    await b.tick({ now: t2 });
    const arms = b.calls('driver').filter((c) => c.argv[0] === 'arms').map((c) => c.argv[2]);
    expect(arms).toEqual([join(b.root, 'weeks', WEEK), join(b.root, 'weeks', WEEK)]);
    st = b.state() as R;
    expect(st.weeks[WEEK].state).toBe('confirmed');
    expect(st.last).toMatchObject({ act: 'done', outcome: 'ok' });
  });
  it('every resumable word waits: it is `interrupted` and the limits words of the driver, and no more', () => {
    const limits = (D.DRIVER_REASONS as string[]).filter((w) => w.startsWith('limits-'));
    expect([...U.RESUMABLE_WORDS].sort()).toEqual(['interrupted', ...limits].sort());
    expect(Object.isFrozen(U.RESUMABLE_WORDS)).toBe(true);
  });
  for (const word of ['interrupted', 'limits-threshold', 'limits-stale']) {
    it(`${word} at judge leaves the week running with its arms sha`, async () => {
      const b = mkBox();
      b.plan({ judge: [REFUSE(word)] });
      await b.tick();
      const w = (b.state() as R).weeks[WEEK];
      expect(w.state).toBe('running');
      expect(w.arms_sha256).toBe(hex(`arms:${join(b.root, 'weeks', WEEK)}`));
      expect(w.judged_sha256).toBe(null);
      expect((b.state() as R).last).toMatchObject({ act: 'judge', outcome: 'waiting', word });
      await b.tick({ now: NOW + 3600_000 });
      expect(subs(b).filter((s) => s === 'arms').length).toBe(1);
      expect(subs(b).filter((s) => s === 'judge').length).toBe(2);
    });
  }
  it('release-moved closes the week failed: no second arms that week, and the next week starts fresh', async () => {
    const b = mkBox();
    b.plan({ [`arms@${WEEK}`]: [REFUSE('release-moved', 'arms and judge ran on different releases')] });
    const r1 = await b.tick();
    expect(r1.code).toBe(0);
    let st = b.state() as R;
    expect(st.weeks[WEEK]).toMatchObject({ state: 'failed', word: 'release-moved', arms_sha256: null });
    expect(st.last).toMatchObject({ week: WEEK, act: 'arms', outcome: 'refused', word: 'release-moved' });
    const n = b.calls().length;
    const r2 = await b.tick({ now: NOW + 6 * 3600_000 });
    expect(r2.code).toBe(0);
    expect(b.calls().length).toBe(n);
    st = b.state() as R;
    expect(st.last).toMatchObject({ week: WEEK, act: 'done', outcome: 'refused', word: 'release-moved' });
    // the next week: a fresh directory, and the failed week stays in the state file
    await b.tick({ now: NEXT_NOW });
    st = b.state() as R;
    expect(st.weeks[NEXT_WEEK]).toMatchObject({ state: 'confirmed', out: join(b.root, 'weeks', NEXT_WEEK) });
    expect(st.weeks[WEEK].state).toBe('failed');
    expect(b.calls('driver').filter((c) => c.argv[0] === 'arms').map((c) => c.argv[2])).toEqual([join(b.root, 'weeks', WEEK), join(b.root, 'weeks', NEXT_WEEK)]);
  });
  for (const word of ['pilot-failed', 'out-refused', 'budget-exhausted', 'input-invalid', 'family-unlisted']) {
    it(`${word} closes the week failed (one week, one --budget)`, async () => {
      const b = mkBox();
      b.plan({ arms: [REFUSE(word)] });
      await b.tick();
      expect((b.state() as R).weeks[WEEK]).toMatchObject({ state: 'failed', word });
      await b.tick({ now: NOW + 3600_000 });
      expect(subs(b).filter((s) => s === 'arms').length).toBe(1);
    });
  }
  it('a driver defect (exit 1, or exit 0 with no sha line) is `failed`, exit 1, and the week is retried', async () => {
    const b = mkBox();
    b.plan({ arms: [{ exit: 1, stderr: 'ccrc history-quiz-single: internal error: boom\n' }, { noSha: true }] });
    const r1 = await b.tick();
    expect(r1.code).toBe(1);
    expect((b.state() as R).last).toMatchObject({ act: 'arms', outcome: 'failed', word: 'driver-failed' });
    expect((b.state() as R).weeks[WEEK].state).toBe('running');
    const r2 = await b.tick({ now: NOW + 3600_000 });
    expect(r2.code).toBe(1);
    expect((b.state() as R).last).toMatchObject({ act: 'arms', outcome: 'failed', word: 'no-sha-line' });
    const r3 = await b.tick({ now: NOW + 7200_000 });
    expect(r3.code).toBe(0);
    expect((b.state() as R).weeks[WEEK].state).toBe('confirmed');
  });
  it('a missing driver is `failed` spawn-failed', async () => {
    const b = mkBox();
    const r = await b.tick({ deps: { driver: join(b.home, 'fake', 'nope.mjs'), node: join(b.home, 'fake', 'no-node') } });
    expect(r.code).toBe(1);
    expect((b.state() as R).last).toMatchObject({ outcome: 'failed', word: 'spawn-failed' });
  });
});

describe('a setup-phase refusal latches for the ISO week', () => {
  const PHASES: Array<[string, string]> = [['setup', 'setup'], ['source', 'source'], ['freeze', 'freeze'], ['marker', 'marker']];
  for (const [act, sub] of PHASES) {
    it(`a deterministic ${act} refusal: one driver call this week, the next one next week`, async () => {
      const b = mkBox();
      b.plan({ [sub]: [REFUSE('input-invalid', 'fixture refusal'), REFUSE('input-invalid', 'fixture refusal again')] });
      const n = (): number => subs(b).filter((x) => x === sub).length;
      const r1 = await b.tick();
      expect(r1.code).toBe(0);
      expect(n()).toBe(1);
      let st = b.state() as R;
      expect(st.setup_refused).toEqual({ word: 'input-invalid', detail: 'fixture refusal', week: WEEK });
      expect(st.last).toEqual({ at_ms: NOW, week: null, act, outcome: 'refused', word: 'input-invalid', detail: 'fixture refusal', posted: true });
      // later ticks of the same week spawn nothing and keep naming the word
      const calls = b.calls().length;
      for (let i = 1; i <= 3; i += 1) {
        const r = await b.tick({ now: NOW + i * 6 * 3600_000 });
        expect(r.code).toBe(0);
        expect((b.state() as R).last).toEqual({ at_ms: NOW + i * 6 * 3600_000, week: null, act, outcome: 'refused', word: 'input-invalid', detail: 'fixture refusal', posted: true });
      }
      expect(b.calls().length).toBe(calls);
      // the next week tries once more, and is latched again under that week
      await b.tick({ now: NEXT_NOW });
      expect(n()).toBe(2);
      st = b.state() as R;
      expect(st.setup_refused).toEqual({ word: 'input-invalid', detail: 'fixture refusal again', week: NEXT_WEEK });
      await b.tick({ now: NEXT_NOW + 6 * 3600_000 });
      expect(n()).toBe(2);
      // and the week after, the refusal gone, it goes on to a confirmed week and the latch clears
      const third = NEXT_NOW + 7 * DAY;
      await b.tick({ now: third });
      st = b.state() as R;
      expect(st.setup_refused).toBe(null);
      expect(st.weeks[U.weekKeyOf(third)].state).toBe('confirmed');
    });
  }
  it('a resumable word does not latch: the next tick retries the same phase', async () => {
    for (const word of ['interrupted', 'limits-threshold', 'limits-stale']) {
      const b = mkBox();
      b.plan({ source: [REFUSE(word)] });
      await b.tick();
      expect((b.state() as R).setup_refused).toBe(null);
      expect((b.state() as R).last).toMatchObject({ act: 'source', outcome: 'waiting', word });
      await b.tick({ now: NOW + 3600_000 });
      expect(subs(b).filter((s) => s === 'source').length).toBe(2);
      expect((b.state() as R).weeks[WEEK].state).toBe('confirmed');
    }
  });
  it('an internal failure does not latch either (it is retried, as before)', async () => {
    const b = mkBox();
    b.plan({ source: [{ exit: 1, stderr: 'ccrc history-quiz-single: internal error: boom\n' }] });
    const r = await b.tick();
    expect(r.code).toBe(1);
    expect((b.state() as R).setup_refused).toBe(null);
    await b.tick({ now: NOW + 3600_000 });
    expect(subs(b).filter((s) => s === 'source').length).toBe(2);
  });
  it('no-account-admitted latches too, and a state file without the field still loads', async () => {
    const b = mkBox({ accounts: [acct('acct-b')] });
    b.plan({ 'setup@acct-b': [REFUSE('account-refused'), REFUSE('account-refused')] });
    await b.tick();
    await b.tick({ now: NOW + 3600_000 });
    expect(subs(b)).toEqual(['setup']);
    expect((b.state() as R).setup_refused).toMatchObject({ word: 'no-account-admitted', week: WEEK });
    // an older state file with no setup_refused key is accepted
    const st = b.state() as R;
    delete st.setup_refused;
    writeFileSync(join(b.root, 'unattended.json'), JSON.stringify(st));
    const r = await b.tick({ now: NOW + 7200_000 });
    expect(r.err).not.toContain('state-unreadable');
    expect(subs(b).filter((s) => s === 'setup').length).toBe(2);
  });
  it('a week act is never latched here: a failed week keeps its own row', async () => {
    const b = mkBox();
    b.plan({ arms: [REFUSE('release-moved')] });
    await b.tick();
    expect((b.state() as R).setup_refused).toBe(null);
  });
});

describe('recording', () => {
  it('a failed record keeps the week running and is retried without re-running the arms', async () => {
    const b = mkBox();
    b.plan({ verb: [{ exit: 2, stderr: 'quiz-record: refused: in-session (a session never records a quiz run)\n' },
      { exit: 1, stderr: 'quiz-record: no answer from the server (ccrc-api exited 3); nothing is known to be recorded\n' },
      { exit: 1, stderr: 'report-invalid: the report is not a single-arm report\n' }] });
    const words: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const r = await b.tick({ now: NOW + i * 3600_000 });
      expect(r.code).toBe(0);
      const st = b.state() as R;
      expect(st.weeks[WEEK]).toMatchObject({ state: 'running', run_id: null });
      expect(st.last).toMatchObject({ act: 'record', outcome: 'refused' });
      words.push(st.last.word);
    }
    expect(words).toEqual(['in-session', 'record-failed', 'report-invalid']);
    expect(subs(b).filter((s) => ['arms', 'judge', 'report'].includes(s))).toEqual(['arms', 'judge', 'report']);
    await b.tick({ now: NOW + 4 * 3600_000 });
    expect((b.state() as R).weeks[WEEK]).toMatchObject({ state: 'confirmed', run_id: 7 });
    expect(b.calls('verb').length).toBe(4);
  });
  it('exit 0 without the confirmed line, or confirming another sha, is refused and not confirmed', async () => {
    const b = mkBox();
    b.plan({ verb: [{ stdout: 'recorded run 7, report sha abc, pending\n' }, { stdout: 'confirmed run 7, report sha 000000000000\n' }] });
    await b.tick();
    expect((b.state() as R).last).toMatchObject({ act: 'record', outcome: 'refused', word: 'record-unconfirmed' });
    await b.tick({ now: NOW + 3600_000 });
    expect((b.state() as R).last).toMatchObject({ act: 'record', outcome: 'refused', word: 'record-sha-mismatch' });
    expect((b.state() as R).weeks[WEEK].state).toBe('running');
  });
});

describe('the state file and the lock', () => {
  it('an unreadable state file is left byte-identical and nothing runs', async () => {
    for (const text of ['{ not json', JSON.stringify({ kind: 'something-else', v: 1, setup: null, weeks: {}, last: null }),
      JSON.stringify({ kind: 'ccrc-quiz-unattended-state', v: 2, setup: null, weeks: {}, last: null }), '[]']) {
      const b = mkBox();
      mkdirSync(b.root, { recursive: true });
      writeFileSync(join(b.root, 'unattended.json'), text);
      const r = await b.tick();
      expect(r.code).toBe(0);
      expect(r.err).toContain('state-unreadable');
      expect(readFileSync(join(b.root, 'unattended.json'), 'utf8')).toBe(text);
      expect(b.calls()).toEqual([]);
      expect(tree(b.root)).toEqual(['unattended.json']);
    }
  });
  it('a live lock makes the tick do nothing (exit 0, the state untouched)', async () => {
    const b = mkBox();
    mkdirSync(b.root, { recursive: true });
    writeFileSync(join(b.root, 'unattended.lock'), `${process.pid}\n`);
    const r = await b.tick();
    expect(r.code).toBe(0);
    expect(r.err).toContain('locked');
    expect(b.calls()).toEqual([]);
    expect(b.state()).toBe(null);
    expect(readFileSync(join(b.root, 'unattended.lock'), 'utf8')).toBe(`${process.pid}\n`);
  });
  it('a lock whose pid is dead (or that holds no pid) is stale and taken over, then released', async () => {
    const dead = spawnSync(process.execPath, ['-e', '0']).pid as number;
    for (const content of [`${dead}\n`, '', 'garbage']) {
      const b = mkBox();
      mkdirSync(b.root, { recursive: true });
      writeFileSync(join(b.root, 'unattended.lock'), content);
      await b.tick();
      expect((b.state() as R).last).toMatchObject({ act: 'done', outcome: 'ok' });
      expect(existsSync(join(b.root, 'unattended.lock'))).toBe(false);
    }
  });
  it('the lock is released after a stop too', async () => {
    const b = mkBox();
    b.plan({ arms: [REFUSE('limits-threshold')] });
    await b.tick();
    expect(existsSync(join(b.root, 'unattended.lock'))).toBe(false);
  });
  it('the state is written whole and leaves no temp file behind', async () => {
    const b = mkBox();
    await b.tick();
    expect(tree(b.root).filter((p) => p.includes('.tmp'))).toEqual([]);
    expect(Object.keys(b.state() as R).sort()).toEqual(['kind', 'last', 'setup', 'setup_refused', 'v', 'weeks']);
  });
});

describe('prune', () => {
  it('keeps the newest four weeks, removes older ones holding the driver\'s marker, leaves one without it and the setup', async () => {
    const b = mkBox();
    await b.tick({ now: NOW - 14 * DAY });   // a first week, so the setup exists
    const weeks = join(b.root, 'weeks');
    const keys = ['2026-W01', '2026-W02', '2026-W03', '2026-W04', '2026-W05', '2026-W06'];
    for (const k of keys) {
      mkdirSync(join(weeks, k), { recursive: true });
      writeFileSync(join(weeks, k, 'single-report.json'), '{}');
      if (k !== '2026-W03') writeFileSync(join(weeks, k, QS.OUT_MARKER as string), '');
    }
    mkdirSync(join(weeks, 'notes'));
    await b.tick({ now: NOW });
    // newest four of {W01..W06, the first week, this week}: this week, the first week, W06, W05; W04 goes (marker), W03 stays (none)
    expect(readdirSync(weeks).sort()).toEqual(['2026-W03', '2026-W05', '2026-W06', 'notes', U.weekKeyOf(NOW - 14 * DAY), WEEK].sort());
    expect(existsSync(join(weeks, '2026-W03', 'single-report.json'))).toBe(true);
    expect(existsSync(join(b.root, 'setup.1', QS.OUT_MARKER as string))).toBe(true);
  });
  it('drops the state rows of the weeks it no longer keeps', async () => {
    const b = mkBox();
    for (let i = 0; i < 6; i += 1) await b.tick({ now: NOW + i * 7 * DAY });
    const st = b.state() as R;
    const keys = Object.keys(st.weeks).sort();
    expect(keys.length).toBe(4);
    expect(keys.at(-1)).toBe(U.weekKeyOf(NOW + 5 * 7 * DAY));
    expect(readdirSync(join(b.root, 'weeks')).sort()).toEqual(keys);
  });
  it('pruneSplitOf keeps the newest four of the keys and the current one', () => {
    const r = U.pruneSplitOf(['2026-W01', '2026-W05', '2025-W52', '2026-W03', '2026-W04', 'junk', '2026-W7'], '2026-W06');
    expect(r.keep).toEqual(['2026-W03', '2026-W04', '2026-W05', '2026-W06']);
    expect(r.drop).toEqual(['2025-W52', '2026-W01']);
  });
});

describe('pure: nextActOf, weekKeyOf and the line readers', () => {
  const full = { out: '/o', account: 'a', setup_sha256: 'a', sourced_sha256: 'b', frozen_sha256: 'c', marker_sha256: 'd', headless: 'written' };
  const wk = (o: R): R => ({ out: '/w', state: 'running', arms_sha256: null, judged_sha256: null, report_sha256: null, run_id: null, baseline: false, word: null, ...o });
  const cases: Array<[string, R, string]> = [
    ['no setup', { setup: null, weeks: {} }, 'setup'],
    ['setup, no sourced', { setup: { ...full, sourced_sha256: null, frozen_sha256: null, marker_sha256: null, headless: null }, weeks: {} }, 'source'],
    ['sourced, no frozen', { setup: { ...full, frozen_sha256: null, marker_sha256: null, headless: null }, weeks: {} }, 'freeze'],
    ['frozen, no marker', { setup: { ...full, marker_sha256: null, headless: null }, weeks: {} }, 'marker'],
    ['marker, no headless', { setup: { ...full, headless: null }, weeks: {} }, 'headless'],
    ['setup complete (written), week absent', { setup: full, weeks: {} }, 'arms'],
    ['setup complete (present), week absent', { setup: { ...full, headless: 'present' }, weeks: {} }, 'arms'],
    ['another week only', { setup: full, weeks: { '2026-W01': wk({ state: 'confirmed' }) } }, 'arms'],
    ['running, nothing done', { setup: full, weeks: { W: wk({}) } }, 'arms'],
    ['arms done', { setup: full, weeks: { W: wk({ arms_sha256: 'x' }) } }, 'judge'],
    ['judge done', { setup: full, weeks: { W: wk({ arms_sha256: 'x', judged_sha256: 'y' }) } }, 'report'],
    ['report done', { setup: full, weeks: { W: wk({ arms_sha256: 'x', judged_sha256: 'y', report_sha256: 'z' }) } }, 'record'],
    ['confirmed', { setup: full, weeks: { W: wk({ state: 'confirmed', arms_sha256: 'x', judged_sha256: 'y', report_sha256: 'z', run_id: 3 }) } }, 'done'],
    ['failed early', { setup: full, weeks: { W: wk({ state: 'failed', word: 'release-moved' }) } }, 'done'],
    ['failed late', { setup: full, weeks: { W: wk({ state: 'failed', arms_sha256: 'x', judged_sha256: 'y', word: 'x' }) } }, 'done'],
  ];
  for (const [name, state, want] of cases) it(`nextActOf: ${name} -> ${want}`, () => { expect(U.nextActOf(state, 'W')).toBe(want); });
  it('nextActOf never reads the clock or the disk: it is a pure function of its two arguments', () => {
    const s = { setup: full, weeks: { W: wk({ arms_sha256: 'x' }) } };
    const copy = JSON.stringify(s);
    expect(U.nextActOf(s, 'W')).toBe(U.nextActOf(s, 'W'));
    expect(JSON.stringify(s)).toBe(copy);
  });
  it('weekKeyOf equals quizWeek(now).key over 3000 dates, year boundaries and the edges of each day included', () => {
    const edges = [Date.UTC(2020, 11, 31), Date.UTC(2021, 0, 1), Date.UTC(2021, 0, 3), Date.UTC(2021, 0, 4), Date.UTC(2024, 11, 29), Date.UTC(2024, 11, 30),
      Date.UTC(2026, 0, 1), Date.UTC(2026, 11, 31), Date.UTC(2027, 0, 1), Date.UTC(2027, 0, 3), Date.UTC(2027, 0, 4)];
    let n = 0;
    const check = (ms: number): void => { expect(U.weekKeyOf(ms), new Date(ms).toISOString()).toBe(quizWeek(ms).key); n += 1; };
    for (let d = 0; d < 3000; d += 1) {
      const day = Date.UTC(2017, 0, 1) + d * DAY;
      check(day);
      check(day + 12 * 3600_000 + (d % 7) * 977);
      check(day + DAY - 1);
    }
    for (const e of edges) { check(e - 1); check(e); check(e + 1); }
    expect(n).toBeGreaterThan(9000);
    expect(U.weekKeyOf(Date.UTC(2021, 0, 3, 23, 59, 59, 999))).toBe('2020-W53');
    expect(U.weekKeyOf(Date.UTC(2021, 0, 4))).toBe('2021-W01');
  });
  it('stepLinesOf reads the last sha line and the last refusal line, and not the driver\'s other shapes', () => {
    const a = 'x\nsha256 ' + 'a'.repeat(64) + '\nsha256 ' + 'b'.repeat(64) + '\n';
    expect(U.stepLinesOf(a)).toEqual({ sha: 'b'.repeat(64), refusal: null });
    const r = 'ccrc history-quiz-single: arms stop limits-threshold: 3 question(s) not run; nothing is retried\nccrc history-quiz-single: limits-threshold: five 71\n';
    expect(U.stepLinesOf(r)).toEqual({ sha: null, refusal: { word: 'limits-threshold', detail: 'five 71' } });
    expect(U.stepLinesOf('ccrc history-quiz-single: internal error: boom\n').refusal).toBe(null);
    expect(U.stepLinesOf('sha256 ' + 'A'.repeat(64)).sha).toBe(null);
  });
  it('recordWordOf takes the token before the colon of the last line, else record-failed', () => {
    expect(U.recordWordOf('a\nreport-invalid: x\n').word).toBe('report-invalid');
    expect(U.recordWordOf('quiz-record: refused: in-session (nope)\n').word).toBe('in-session');
    expect(U.recordWordOf('quiz-record: no answer from the server (ccrc-api exited 3)\n').word).toBe('record-failed');
    expect(U.recordWordOf('').word).toBe('record-failed');
  });
  it('exports the setup constants, the models named once', () => {
    expect([U.BUDGET, U.SETTINGS_MODE, U.WRITER_MODEL, U.JUDGE_MODEL, U.ARM_MODEL]).toEqual([5000000, 'restricted', 'claude-opus-5-5', 'claude-opus-5-5', 'claude-opus-5-5']);
    expect(U.KEEP_WEEKS).toBe(4);
  });
});

describe('the spend guard: the runner proves it can record before it spends anything (F3)', () => {
  const credPath = (b: Box): string => join(b.home, '.ccrc', 'agent.env');
  it('no credential file (a box of the `both` role): nothing is spent, the waiting word is recorded and posted', async () => {
    const b = mkBox({ agentEnv: false });
    const r = await b.tick();
    expect(r.code).toBe(0);
    expect(b.calls('driver')).toEqual([]);
    expect(b.calls('verb')).toEqual([]);
    const st = b.state() as R;
    expect(st.last).toMatchObject({ act: 'setup', outcome: 'waiting', word: 'record-path-missing' });
    expect(st.last.detail).toContain('credential file');
    expect(st.setup).toBeNull();
    expect(st.setup_refused ?? null).toBeNull();   // a waiting word never latches
    const posted = b.calls('client');
    expect(posted.length).toBe(1);
    expect(JSON.parse(posted[0].stdin)).toMatchObject({ outcome: 'waiting', word: 'record-path-missing' });
    // it comes back by itself once the file stands
    writeFileSync(credPath(b), '');
    await b.tick();
    expect((b.state() as R).weeks[WEEK].state).toBe('confirmed');
  });
  it('a credential path that is not a regular file (a directory, a link) counts as missing', async () => {
    const b = mkBox({ agentEnv: false });
    mkdirSync(credPath(b));
    await b.tick();
    expect(b.calls('driver')).toEqual([]);
    expect((b.state() as R).last).toMatchObject({ outcome: 'waiting', word: 'record-path-missing' });
  });
  it('the credential file is checked by stat only: an unreadable one still passes the guard', async () => {
    const b = mkBox();
    chmodSync(credPath(b), 0o000);
    await b.tick();
    expect((b.state() as R).weeks[WEEK].state).toBe('confirmed');
  });
  for (const [name, mk] of [
    ['missing', (b: Box) => join(b.home, 'fake', 'no-such-client')],
    ['not executable', (b: Box) => { const f = join(b.home, 'fake', 'plain'); writeFileSync(f, '#!/bin/sh\n'); chmodSync(f, 0o644); return f; }],
    ['a directory', (b: Box) => { const f = join(b.home, 'fake', 'dir'); mkdirSync(f); return f; }],
  ] as Array<[string, (b: Box) => string]>) {
    it(`a status client that is ${name}: nothing is spent and the tick waits record-path-missing, naming the client`, async () => {
      const b = mkBox();
      const r = await b.tick({ deps: { client: mk(b) } });
      expect(r.code).toBe(0);
      expect(b.calls()).toEqual([]);
      const st = b.state() as R;
      expect(st.last).toMatchObject({ outcome: 'waiting', word: 'record-path-missing' });
      expect(st.last.detail).toContain('status client');
    });
  }
  it('it also stops before a week\'s arms: a credential file that vanishes mid-way spends nothing more and the week stays running', async () => {
    const b = mkBox();
    b.plan({ arms: [REFUSE('interrupted')] });
    await b.tick();
    expect((b.state() as R).last).toMatchObject({ act: 'arms', word: 'interrupted' });
    const n = b.calls().length;
    unlinkSync(credPath(b));
    await b.tick({ now: NOW + 3600_000 });
    expect(b.calls().length).toBe(n);
    const st = b.state() as R;
    expect(st.last).toMatchObject({ act: 'arms', outcome: 'waiting', word: 'record-path-missing' });
    expect(st.weeks[WEEK].state).toBe('running');
  });
});

describe('the operator\'s per-account lane kill switch (F5)', () => {
  const disable = (b: Box, id: string): void => { mkdirSync(join(b.home, '.cc-sessions'), { recursive: true }); writeFileSync(join(b.home, '.cc-sessions', `${id}-disabled`), ''); };
  it('a disabled account is never picked at setup', async () => {
    const b = mkBox();
    disable(b, 'acct-b');
    await b.tick();
    expect(b.calls('driver').filter((c) => c.argv[0] === 'setup').map((c) => c.argv[c.argv.indexOf('--account') + 1])).toEqual(['acct-c']);
    expect((b.state() as R).setup.account).toBe('acct-c');
  });
  it('every candidate disabled: no-account-admitted, with no spawn', async () => {
    const b = mkBox();
    disable(b, 'acct-b');
    disable(b, 'acct-c');
    await b.tick();
    expect(b.calls('driver')).toEqual([]);
    expect((b.state() as R).last).toMatchObject({ outcome: 'refused', word: 'no-account-admitted' });
  });
  it('the marker is read as ccd reads it: only a regular file counts (a directory of that name is no switch)', async () => {
    const b = mkBox();
    mkdirSync(join(b.home, '.cc-sessions', 'acct-b-disabled'), { recursive: true });
    await b.tick();
    expect((b.state() as R).setup.account).toBe('acct-b');
  });
  for (const act of ['arms', 'judge']) {
    it(`before ${act}: the week's account switched off waits account-disabled (not no-room), spawns nothing, and resumes when it is back on`, async () => {
      const b = mkBox();
      b.plan({ [act]: [REFUSE('interrupted')] });
      await b.tick();
      const account = (b.state() as R).setup.account as string;
      const n = b.calls().length;
      disable(b, account);
      await b.tick({ now: NOW + 3600_000 });
      expect(b.calls().length).toBe(n);
      const st = b.state() as R;
      expect(st.last).toMatchObject({ week: WEEK, act, outcome: 'waiting', word: 'account-disabled' });
      expect(st.weeks[WEEK].state).toBe('running');
      unlinkSync(join(b.home, '.cc-sessions', `${account}-disabled`));
      await b.tick({ now: NOW + 2 * 3600_000 });
      expect((b.state() as R).weeks[WEEK].state).toBe('confirmed');
    });
  }
  it('eligibleAccountsOf takes the switch as a predicate and defaults to none', () => {
    const roster = [acct('acct-x'), acct('acct-y')];
    expect(U.eligibleAccountsOf(roster)).toEqual(['acct-x', 'acct-y']);
    expect(U.eligibleAccountsOf(roster, (id: string) => id === 'acct-x')).toEqual(['acct-y']);
  });
});

describe('--state-verdict: the runner\'s own reading of its state file, for doctor (F8)', () => {
  const RUNNER = fileURLToPath(new URL('../../deploy/history-quiz-unattended.mjs', import.meta.url));
  const verdict = (home: string, extra: R = {}): { out: string; code: number | null; err: string } => {
    const r = spawnSync(process.execPath, ['--no-warnings', RUNNER, '--state-verdict'], { env: { HOME: home, PATH: process.env.PATH ?? '', ...extra }, encoding: 'utf8' });
    return { out: r.stdout, code: r.status, err: r.stderr };
  };
  const put = (b: Box, text: string): string => { mkdirSync(b.root, { recursive: true }); const f = join(b.root, 'unattended.json'); writeFileSync(f, text); return f; };
  it('absent, then ok after a tick: one line each, exit 0, and it writes nothing', async () => {
    const b = mkBox();
    expect(verdict(b.home)).toEqual({ out: 'absent\n', code: 0, err: '' });
    expect(existsSync(b.root)).toBe(false);
    await b.tick();
    const before = tree(b.root);
    const bytes = readFileSync(join(b.root, 'unattended.json'), 'utf8');
    expect(verdict(b.home)).toEqual({ out: 'ok\n', code: 0, err: '' });
    expect(tree(b.root)).toEqual(before);
    expect(readFileSync(join(b.root, 'unattended.json'), 'utf8')).toBe(bytes);
    expect(existsSync(join(b.root, 'unattended.lock'))).toBe(false);
  });
  for (const [name, text, want] of [
    ['a torn file', '{ "kind": "ccrc-quiz', 'malformed not JSON'],
    ['not JSON', 'nope', 'malformed not JSON'],
    ['another kind', JSON.stringify({ kind: 'something-else', v: 1, setup: null, weeks: {}, last: null }), 'malformed not a ccrc-quiz-unattended-state v1 file'],
    ['an unknown version', JSON.stringify({ kind: 'ccrc-quiz-unattended-state', v: 2, setup: null, weeks: {}, last: null }), 'malformed not a ccrc-quiz-unattended-state v1 file'],
    ['an array', '[]', 'malformed not a ccrc-quiz-unattended-state v1 file'],
  ] as Array<[string, string, string]>) {
    it(`${name}: ${want}`, () => {
      const b = mkBox();
      const f = put(b, text);
      expect(verdict(b.home)).toEqual({ out: `${want}\n`, code: 0, err: '' });
      expect(readFileSync(f, 'utf8')).toBe(text);
    });
  }
  it.skipIf(process.getuid?.() === 0)('an unreadable file: `unreadable EACCES`', () => {
    const b = mkBox();
    const f = put(b, JSON.stringify(U.freshState()));
    chmodSync(f, 0o000);
    expect(verdict(b.home)).toEqual({ out: 'unreadable EACCES\n', code: 0, err: '' });
    chmodSync(f, 0o600);
  });
  it('it is the same reading the tick uses: whatever the verdict calls ok, the tick loads, and a malformed one it refuses', async () => {
    const b = mkBox();
    put(b, JSON.stringify({ kind: 'ccrc-quiz-unattended-state', v: 2, setup: null, weeks: {}, last: null }));
    expect(verdict(b.home).out).toBe('malformed not a ccrc-quiz-unattended-state v1 file\n');
    expect((await b.tick()).err).toContain('state-unreadable');
    expect(U.stateVerdictOf(join(b.root, 'unattended.json'))).toBe('malformed not a ccrc-quiz-unattended-state v1 file');
  });
  it('it runs where a tick refuses: with CLAUDECODE and TMUX_PANE set', () => {
    const b = mkBox();
    expect(verdict(b.home, { CLAUDECODE: '1', TMUX_PANE: '%1' })).toEqual({ out: 'absent\n', code: 0, err: '' });
  });
});

// ── quiz-pilot-checks ruling 5: a week closed on the pilot word is piloted again on a newer release, at most three a week ──
describe('repilotOf: the pure decision, as a table (keyed by stage B\'s B0)', () => {
  const failed = { state: 'failed', word: 'pilot-failed' };
  const k = (b: string, code?: Record<string, string>, pilot?: Record<string, string>, skill?: string): R => ({ state: 'value', key: KEY(b, code, pilot, skill) });
  const at = (b: string, code?: Record<string, string>): R => ({ release: 'v1', key: KEY(b, code) });
  const OTHER_CODE = { ...FIX_CODE, 'deploy/history-replay.mjs': 'c'.repeat(64) };
  const rows: Array<[string, R, unknown, unknown, R]> = [
    ['a new build after one failed pilot', failed, [at('b1')], k('b2'), { repilot: true, pilot: 2 }],
    ['a new build after two failed pilots: the third', failed, [at('b1'), at('b2')], k('b3'), { repilot: true, pilot: 3 }],
    ['three failed pilots: no fourth', failed, [at('b1'), at('b2'), at('b3')], k('b4'), { repilot: false, why: 'pilots-spent' }],
    ['the same key: no second pilot on it', failed, [at('b1')], k('b1'), { repilot: false, why: 'key-unchanged' }],
    ['back to an earlier failed key', failed, [at('b1'), at('b2')], k('b1'), { repilot: false, why: 'key-unchanged' }],
    ['the same build, the gate\'s code changed: a new key', failed, [at('b1')], k('b1', OTHER_CODE), { repilot: true, pilot: 2 }],
    // fix round 1, F1: each new part of the key, changed alone, is a new key
    ['the same build and gate code, a pilot file changed: a new key', failed, [at('b1')], k('b1', FIX_CODE, { ...FIX_PILOT, 'ccd/history/sweep.mjs': 'f'.repeat(64) }), { repilot: true, pilot: 2 }],
    ['the same build, gate code and pilot files, the skill changed: a new key', failed, [at('b1')], k('b1', FIX_CODE, FIX_PILOT, '8'.repeat(64)), { repilot: true, pilot: 2 }],
    // fix round 2, F1 (reversing fix round 1's reading): only an entry with no key field is older; a key field in any other form
    // than all four parts is unmeasured, and the week stays closed
    ['an entry whose key has two of the parts is unmeasured, never older', failed, [{ release: 'v1', key: { claude_code: 'b1', code_shas: FIX_CODE } }], k('b2'), { repilot: false, why: 'failed-key-unmeasured' }],
    ['an entry whose key is an empty object is unmeasured', failed, [{ release: 'v1', key: {} }], k('b2'), { repilot: false, why: 'failed-key-unmeasured' }],
    ['an entry whose key is the build alone is unmeasured', failed, [{ release: 'v1', key: { claude_code: 'b1' } }], k('b2'), { repilot: false, why: 'failed-key-unmeasured' }],
    ['an entry whose key is the gate\'s code alone is unmeasured', failed, [{ release: 'v1', key: { code_shas: FIX_CODE } }], k('b2'), { repilot: false, why: 'failed-key-unmeasured' }],
    ['an entry whose key is the pilot files alone is unmeasured', failed, [{ release: 'v1', key: { pilot_shas: FIX_PILOT } }], k('b2'), { repilot: false, why: 'failed-key-unmeasured' }],
    ['an entry whose key is the skill alone is unmeasured', failed, [{ release: 'v1', key: { skill_sha256: FIX_SKILL } }], k('b2'), { repilot: false, why: 'failed-key-unmeasured' }],
    ['an entry whose key is no object is unmeasured', failed, [{ release: 'v1', key: 'b1' }], k('b2'), { repilot: false, why: 'failed-key-unmeasured' }],
    ['three entries, two with a key in another form: the cap answers before any key is read', failed, [{ release: 'v1', key: { claude_code: 'b1' } }, { release: 'v1', key: {} }, at('b3')], k('b4'), { repilot: false, why: 'pilots-spent' }],
    ['another release on the same key is the same key (B0: the release is no longer the key)', failed, [{ release: 'v1.0.1', key: KEY('b1') }], k('b1'), { repilot: false, why: 'key-unchanged' }],
    ['an entry written before B0 (a release, no key) counts and matches no key', failed, [{ release: 'v1.0.1' }], k('b1'), { repilot: true, pilot: 2 }],
    ['two entries written before B0 and a keyed one: the cap counts them all', failed, [{ release: 'v1.0.1' }, { release: 'v1.0.2' }, at('b1')], k('b2'), { repilot: false, why: 'pilots-spent' }],
    ['an older entry whose release could not be read is unmeasured', failed, [{ release: null }], k('b2'), { repilot: false, why: 'failed-key-unmeasured' }],
    ['an entry whose key could not be read', failed, [{ release: 'v1', key: null }], k('b2'), { repilot: false, why: 'failed-key-unmeasured' }],
    ['an entry whose key is damaged', failed, [{ release: 'v1', key: { claude_code: 'b1' } }], k('b2'), { repilot: false, why: 'failed-key-unmeasured' }],
    ['an entry whose key has a part in a wrong form', failed, [{ release: 'v1', key: { ...KEY('b1'), code_shas: { f: 'not-hex' } } }], k('b2'), { repilot: false, why: 'failed-key-unmeasured' }],
    ['an entry whose key has a field that is no part', failed, [{ release: 'v1', key: { ...KEY('b1'), extra: 1 } }], k('b2'), { repilot: false, why: 'failed-key-unmeasured' }],
    ['no row', null as unknown as R, [], k('b2'), { repilot: false, why: 'no-week' }],
    ['a running week', { state: 'running', word: null }, [at('b1')], k('b2'), { repilot: false, why: 'not-failed' }],
    ['a confirmed week', { state: 'confirmed', word: null }, [at('b1')], k('b2'), { repilot: false, why: 'not-failed' }],
    ['closed on another word', { state: 'failed', word: 'out-refused' }, [at('b1')], k('b2'), { repilot: false, why: 'not-the-pilot' }],
    ['closed week-ended', { state: 'failed', word: 'week-ended' }, [at('b1')], k('b2'), { repilot: false, why: 'not-the-pilot' }],
    ['no failed pilot recorded', failed, [], k('b2'), { repilot: false, why: 'pilots-unreadable' }],
    ['pilots not a list', failed, at('b1'), k('b2'), { repilot: false, why: 'pilots-unreadable' }],
    ['a pilot entry that is no object', failed, ['b1'], k('b2'), { repilot: false, why: 'pilots-unreadable' }],
    ['the key now unmeasured', failed, [at('b1')], { state: 'unmeasured', why: 'fixture' }, { repilot: false, why: 'key-unmeasured' }],
    ['the key now no answer at all', failed, [at('b1')], null, { repilot: false, why: 'key-unmeasured' }],
    ['the key now damaged', failed, [at('b1')], { state: 'value', key: { claude_code: '', code_shas: FIX_CODE } }, { repilot: false, why: 'key-unmeasured' }],
  ];
  for (const [name, week, pilots, key, want] of rows) {
    it(name, () => { expect(U.repilotOf({ week, pilots, key })).toEqual(want); });
  }
  it('every reason word is a STAY_CLOSED word, and the cap is three', () => {
    expect(U.PILOTS_MAX).toBe(3);
    for (const [, week, pilots, key] of rows) {
      const d = U.repilotOf({ week, pilots, key }) as R;
      if (d.repilot === false) expect(U.STAY_CLOSED, d.why as string).toContain(d.why);
    }
  });
  it('the pilots are judged before the key now: a week that cannot be piloted again whatever the key never needs one', () => {
    expect(U.repilotOf({ week: failed, pilots: [at('b1'), at('b2'), at('b3')], key: null })).toEqual({ repilot: false, why: 'pilots-spent' });
    expect(U.repilotOf({ week: failed, pilots: [{ release: null }], key: null })).toEqual({ repilot: false, why: 'failed-key-unmeasured' });
    expect(U.repilotOf({ week: failed, pilots: [at('b1')], key: null }), 'CONTROL: only then is the key the question').toEqual({ repilot: false, why: 'key-unmeasured' });
  });
});

describe('the runner acts on repilotOf: it reopens the week and runs arms --repilot in the same directory', () => {
  // Stage B, B0: the cases below were written for ruling 5's release key. Each "release" step now moves the release AND the
  // build with it (a new release that brings a new build), so every case keeps pinning what it pinned; the cases after this
  // block move the two apart.
  const BUILD = (tag: string): string => `${tag} (Claude Code)`;
  const setRelease = (b: Box, tag: string): void => {
    writeFileSync(join(b.home, '.ccrc', 'build.json'), JSON.stringify({ sha: 'fixture', version: tag }));
    writeFileSync(join(b.home, 'fixture-build'), BUILD(tag));
  };
  /** The driver's release pin, composed by the single-arm module's own releasePinText (so the runner's reader is held to the
   *  module's bytes, fix round 1 F3), written into a week's directory as that module does before its pilot. */
  const pinText = (tag: string, round: number): string => QS.releasePinText('f'.repeat(64), tag, round, KEY(BUILD(tag))) as string;
  const pin = (b: Box, tag: string, text?: string): void => {
    const dir = join(b.root, 'weeks', WEEK, 'quiz');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'arms-release.json'), text ?? pinText(tag, 0));
  };
  const armsCalls = (b: Box): R[] => b.calls('driver').filter((c) => c.argv[0] === 'arms');
  const HOUR = 3600_000;
  /** A box whose first pilot fails on release `tag` (the driver pins it, then refuses pilot-failed). */
  async function failedOn(tag: string, more: R[] = []): Promise<Box> {
    const b = mkBox();
    b.plan({ arms: [REFUSE('pilot-failed', 'step0b restricted: failed plugins; unmeasured -'), ...more] });
    setRelease(b, tag);
    pin(b, tag);   // the fake driver writes no pin: this stands for the one the real driver writes before its pilot runs
    await b.tick();
    return b;
  }

  it('the first failure records one failed pilot; on the same release the week stays closed and nothing spawns', async () => {
    const b = mkBox();
    b.plan({ arms: [REFUSE('pilot-failed')] });
    setRelease(b, 'v1.0.1');
    pin(b, 'v1.0.1');
    await b.tick();
    expect((b.state() as R).weeks[WEEK]).toMatchObject({ state: 'failed', word: 'pilot-failed', pilots: [{ release: 'v1.0.1' }] });
    await b.tick({ now: NOW + HOUR });
    expect(armsCalls(b).length).toBe(1);
    expect((b.state() as R).last).toMatchObject({ act: 'done', outcome: 'refused', word: 'pilot-failed' });
  });

  it('a newer release reopens it: arms --repilot on the same directory, and a pass carries the week to confirmed', async () => {
    const b = await failedOn('v1.0.1');
    setRelease(b, 'v1.0.2');
    await b.tick({ now: NOW + HOUR });
    const arms = armsCalls(b);
    expect(arms.length).toBe(2);
    expect(arms[0]!.argv).not.toContain('--repilot');
    expect(arms[1]!.argv).toContain('--repilot');
    // fix round 2 (review 3528, F2): the exact argument list: the first pilot's, then the bare flag and nothing after it
    expect(arms[1]!.argv, 'the re-pilot passes the bare flag, never a value').toEqual([...arms[0]!.argv, '--repilot']);
    expect(arms[1]!.argv[arms[1]!.argv.indexOf('--out') + 1], 'the same week directory, so the same ledger and --budget').toBe(join(b.root, 'weeks', WEEK));
    const w = (b.state() as R).weeks[WEEK];
    expect(w).toMatchObject({ state: 'confirmed', pilots: [{ release: 'v1.0.1' }, { release: 'v1.0.2', at_ms: NOW + HOUR }] });
    expect(w.repilot, 'the permission was for one act').toBeUndefined();
    expect(subs(b).filter((s) => s === 'judge').length).toBe(1);
    expect(readFileSync(join(b.root, 'journal.log'), 'utf8')).toMatch(/week \S+ piloted again: pilot 2 of 3, release v1\.0\.2, after v1\.0\.1; build v1\.0\.2 \(Claude Code\)/);
    expect(w.pilots[1].key, 'B0: the row records the key it was decided on').toEqual(KEY(BUILD('v1.0.2')));
  });

  it('at most three pilots in a week: a fourth release opens no fourth pilot', async () => {
    const b = await failedOn('v1.0.1', [REFUSE('pilot-failed'), REFUSE('pilot-failed')]);
    for (const [i, t] of ['v1.0.2', 'v1.0.3'].entries()) {
      setRelease(b, t);
      pin(b, t);   // arms --repilot re-pins the week to the release it measures, then its pilot fails
      await b.tick({ now: NOW + (i + 1) * HOUR });
    }
    expect(armsCalls(b).length).toBe(3);
    expect((b.state() as R).weeks[WEEK].pilots.map((p: R) => p.release)).toEqual(['v1.0.1', 'v1.0.2', 'v1.0.3']);
    setRelease(b, 'v1.0.4');
    await b.tick({ now: NOW + 4 * HOUR });
    expect(armsCalls(b).length, 'no fourth pilot').toBe(3);
    expect((b.state() as R).weeks[WEEK]).toMatchObject({ state: 'failed', word: 'pilot-failed' });
  });

  it('a second pilot is never run on a release that already failed this week', async () => {
    const b = await failedOn('v1.0.1', [REFUSE('pilot-failed')]);
    setRelease(b, 'v1.0.2');
    pin(b, 'v1.0.2');
    await b.tick({ now: NOW + HOUR });
    expect((b.state() as R).weeks[WEEK].pilots.map((p: R) => p.release)).toEqual(['v1.0.1', 'v1.0.2']);
    setRelease(b, 'v1.0.1');   // rolled back to the first failed release
    await b.tick({ now: NOW + 2 * HOUR });
    expect(armsCalls(b).length).toBe(2);
  });

  it('a week closed on any other word stays closed on a newer release', async () => {
    const b = mkBox();
    b.plan({ arms: [REFUSE('out-refused')] });
    setRelease(b, 'v1.0.1');
    pin(b, 'v1.0.1');
    await b.tick();
    setRelease(b, 'v1.0.2');
    await b.tick({ now: NOW + HOUR });
    expect(armsCalls(b).length).toBe(1);
    expect((b.state() as R).weeks[WEEK].pilots, 'no pilot is recorded for another word').toBeUndefined();
  });

  it('a row closed on the pilot word before ruling 5 (no pilots recorded) is read as one failed pilot on its pin', async () => {
    const b = await failedOn('v1.0.1');
    const st = b.state() as R;
    delete st.weeks[WEEK].pilots;
    writeFileSync(join(b.root, 'unattended.json'), JSON.stringify(st));
    setRelease(b, 'v1.0.1');
    await b.tick({ now: NOW + HOUR });
    expect(armsCalls(b).length, 'same release as its pin: closed').toBe(1);
    setRelease(b, 'v1.0.2');
    await b.tick({ now: NOW + 2 * HOUR });
    expect(armsCalls(b).length).toBe(2);
    expect((b.state() as R).weeks[WEEK]).toMatchObject({ state: 'confirmed', pilots: [{ release: 'v1.0.1', at_ms: null }, { release: 'v1.0.2' }] });
  });

  it('an unreadable pin keeps the week closed: an unmeasured key never re-spends', async () => {
    const b = mkBox();
    b.plan({ arms: [REFUSE('pilot-failed')] });
    setRelease(b, 'v1.0.1');
    await b.tick();
    // B0: was [{ release: null, at_ms: NOW }]; the entry now names the key it could not read
    expect((b.state() as R).weeks[WEEK].pilots).toEqual([{ release: null, key: null, at_ms: NOW }]);
    setRelease(b, 'v1.0.2');
    await b.tick({ now: NOW + HOUR });
    expect(armsCalls(b).length).toBe(1);
  });

  // fix round 1, F1: the pilot is counted before the spawn, so a kill after the driver's write cannot hide it.
  /** One tick whose driver writes its evidence and then the runner dies before its save after the act (the quiz root turns
   *  read-only, so that save fails). The quiz root is given back and the stale lock removed, as a restart would find them. */
  async function killedTick(b: Box, now: number): Promise<void> {
    const r = await b.tick({ now });
    expect(r.code, 'fixture: the save after the act failed').toBe(1);
    // review 3533, F6: exit 1 alone is also a driver failure's; these two tell the kill apart (the root really turned
    // read-only, and no row the failed save would have written landed)
    expect(statSync(b.root).mode & 0o777, 'fixture: the stub turned the quiz root read-only').toBe(0o500);
    chmodSync(b.root, 0o700);
    expect((b.state() as R).last?.word, 'fixture: the save after the act never landed').not.toBe('driver-failed');
    try { unlinkSync(join(b.root, 'unattended.lock')); } catch { /* released */ }
  }
  for (const legacy of [false, true]) {
    it.skipIf(process.getuid?.() === 0)(`a kill between the driver's write and the save: no second pilot on that release, and the count is right (${legacy ? 'a row closed before this change' : 'a new-style row'})`, async () => {
      const b = await failedOn('v1.0.1');
      const rePin = [join(b.root, 'weeks', WEEK, 'quiz', 'arms-release.json'), pinText('v1.0.2', 1)];
      // the queue's first answer was the first pilot's (already given); then the killed re-pilot, then the driver's own refusal
      b.plan({ arms: [REFUSE('pilot-failed'), { ...REFUSE('pilot-failed'), chmodRoot: true, writes: [rePin] }, REFUSE('pilot-failed')] });
      if (legacy) {
        const st = b.state() as R;
        delete st.weeks[WEEK].pilots;
        writeFileSync(join(b.root, 'unattended.json'), JSON.stringify(st));
      }
      setRelease(b, 'v1.0.2');
      await killedTick(b, NOW + HOUR);   // the stub driver re-pins the week to v1.0.2, as the real one does, then the runner dies
      expect(JSON.parse(readFileSync(rePin[0]!, 'utf8')).ccrc_release, 'fixture: the pin moved during the act').toBe('v1.0.2');
      const onDisk = (b.state() as R).weeks[WEEK];
      expect(onDisk, 'saved before the spawn: the pilot on v1.0.2 is counted, the permission already gone')
        .toMatchObject({ state: 'running', pilots: [{ release: 'v1.0.1' }, { release: 'v1.0.2' }] });
      expect(onDisk.repilot).toBeUndefined();
      // the next tick on the same release: the arms run without --repilot, so the driver's failed result closes the week
      await b.tick({ now: NOW + 2 * HOUR, deps: { isAlive: () => false } });
      const arms = armsCalls(b);
      expect(arms.length).toBe(3);
      expect(arms[2]!.argv, 'no second pilot on v1.0.2').not.toContain('--repilot');
      expect((b.state() as R).weeks[WEEK]).toMatchObject({ state: 'failed', word: 'pilot-failed', pilots: [{ release: 'v1.0.1' }, { release: 'v1.0.2' }] });
      await b.tick({ now: NOW + 3 * HOUR });
      expect(armsCalls(b).length, 'and it stays closed on v1.0.2').toBe(3);
      setRelease(b, 'v1.0.3');
      await b.tick({ now: NOW + 4 * HOUR });
      expect(armsCalls(b)[3]!.argv, 'a newer release is the third pilot').toContain('--repilot');
      expect((b.state() as R).weeks[WEEK].pilots.map((p: R) => p.release)).toEqual(['v1.0.1', 'v1.0.2', 'v1.0.3']);
    });
  }

  // fix round 2 (review 3528, F1, a known limit): the two windows after the permission's save, pinned as they stand today. The
  // stub driver answers each later act as the real single-arm module does at that point; the pin on disk says which point.
  const pinOnDisk = (b: Box): R => JSON.parse(readFileSync(join(b.root, 'weeks', WEEK, 'quiz', 'arms-release.json'), 'utf8')) as R;
  // review 3533, F4: the second variant is a driver FAILURE (an exit that is not a refusal); a refusal that is not resumable is
  // the case after this loop, and closes the week on its own word at once.
  for (const how of ['a kill', 'a driver failure']) {
    it.skipIf(how === 'a kill' && process.getuid?.() === 0)(`${how} after the permission's save, before the driver moved the pin: the week closes release-moved with the counted pilot unrun, and no later release reopens it`, async () => {
      const b = await failedOn('v1.0.1');
      const dies = how === 'a kill' ? { exit: 1, stderr: 'killed\n', chmodRoot: true } : { exit: 1, stderr: 'ccrc history-quiz-single: internal error: fixture\n' };
      // the real driver, with the pin still on v1.0.1 and v1.0.2 installed, refuses release-moved before step 0b (pinArmsRelease)
      b.plan({ arms: [REFUSE('pilot-failed'), dies, REFUSE('release-moved', 'this week\'s arms ran on v1.0.1, this node now runs v1.0.2')] });
      setRelease(b, 'v1.0.2');
      if (how === 'a kill') await killedTick(b, NOW + HOUR);
      else expect((await b.tick({ now: NOW + HOUR })).code, 'fixture: driver-failed').toBe(1);
      const saved = (b.state() as R).weeks[WEEK];
      expect(saved).toMatchObject({ state: 'running', pilots: [{ release: 'v1.0.1' }, { release: 'v1.0.2' }] });
      expect(saved.repilot, 'the permission left the row before the spawn').toBeUndefined();
      expect(pinOnDisk(b).ccrc_release, 'the driver never moved the pin').toBe('v1.0.1');
      await b.tick({ now: NOW + 2 * HOUR, deps: { isAlive: () => false } });
      const arms = armsCalls(b);
      expect(arms.map((c) => c.argv.includes('--repilot'))).toEqual([false, true, false]);
      expect((b.state() as R).weeks[WEEK]).toMatchObject({ state: 'failed', word: 'release-moved', pilots: [{ release: 'v1.0.1' }, { release: 'v1.0.2' }] });
      setRelease(b, 'v1.0.3');
      await b.tick({ now: NOW + 3 * HOUR });
      expect(armsCalls(b).length, 'a week closed release-moved is not reopened').toBe(3);
    });
  }

  it('a refusal that is not resumable after the permission\'s save closes the week at once on its own word, the counted pilot unrun', async () => {
    const b = await failedOn('v1.0.1');
    b.plan({ arms: [REFUSE('pilot-failed'), REFUSE('version-unmeasured', 'fixture: --version failed')] });
    setRelease(b, 'v1.0.2');
    const r = await b.tick({ now: NOW + HOUR });
    expect(r.code, 'a refusal is no failure').toBe(0);
    const w = (b.state() as R).weeks[WEEK];
    expect(w).toMatchObject({ state: 'failed', word: 'version-unmeasured', pilots: [{ release: 'v1.0.1' }, { release: 'v1.0.2' }] });
    expect(w.repilot, 'the permission is not given back after a refusal that is not resumable').toBeUndefined();
    expect(pinOnDisk(b).ccrc_release, 'the driver never moved the pin').toBe('v1.0.1');
    expect(armsCalls(b).map((c) => c.argv.includes('--repilot'))).toEqual([false, true]);
    setRelease(b, 'v1.0.3');
    await b.tick({ now: NOW + 2 * HOUR });
    expect(armsCalls(b).length, 'a week closed on another word than the pilot\'s stays closed').toBe(2);
  });

  it.skipIf(process.getuid?.() === 0)('a kill after the driver wrote the new pin, before its result: the week closes pilot-failed, and a later release is refused with the round\'s own word', async () => {
    const b = await failedOn('v1.0.1');
    const pinPath = join(b.root, 'weeks', WEEK, 'quiz', 'arms-release.json');
    b.plan({ arms: [
      REFUSE('pilot-failed'),
      { exit: 1, stderr: 'killed\n', chmodRoot: true, writes: [[pinPath, pinText('v1.0.2', 1)]] },
      // the real driver on v1.0.2 without --repilot: the pin matches, the round 0 result failed, so pilot-failed
      REFUSE('pilot-failed'),
      // the real driver on v1.0.3 with --repilot: round 1 is under way on v1.0.2, so repilot-release-moved
      REFUSE('repilot-release-moved', 'step 0b round 1 is under way on v1.0.2, this node now runs v1.0.3: one pilot never spans two releases'),
    ] });
    setRelease(b, 'v1.0.2');
    await killedTick(b, NOW + HOUR);
    expect(pinOnDisk(b)).toMatchObject({ ccrc_release: 'v1.0.2', round: 1 });
    await b.tick({ now: NOW + 2 * HOUR, deps: { isAlive: () => false } });
    expect((b.state() as R).weeks[WEEK]).toMatchObject({ state: 'failed', word: 'pilot-failed', pilots: [{ release: 'v1.0.1' }, { release: 'v1.0.2' }] });
    setRelease(b, 'v1.0.3');
    await b.tick({ now: NOW + 3 * HOUR });
    expect(armsCalls(b).map((c) => c.argv.includes('--repilot'))).toEqual([false, true, false, true]);
    expect((b.state() as R).weeks[WEEK]).toMatchObject({ state: 'failed', word: 'repilot-release-moved',
      pilots: [{ release: 'v1.0.1' }, { release: 'v1.0.2' }, { release: 'v1.0.3' }] });
    setRelease(b, 'v1.0.4');
    await b.tick({ now: NOW + 4 * HOUR });
    expect(armsCalls(b).length, 'nothing reopens it').toBe(4);
  });

  // fix round 1, F2: the permission is for one pilot on one release; a resumable stop gives it back for that release only.
  it('a re-pilot that stopped resumably is resumed on its own release with --repilot', async () => {
    const b = await failedOn('v1.0.1', [REFUSE('interrupted')]);
    setRelease(b, 'v1.0.2');
    await b.tick({ now: NOW + HOUR });
    expect((b.state() as R).weeks[WEEK]).toMatchObject({ state: 'running', repilot: { release: 'v1.0.2' } });
    await b.tick({ now: NOW + 2 * HOUR });
    expect(armsCalls(b).map((c) => c.argv.includes('--repilot'))).toEqual([false, true, true]);
    expect((b.state() as R).weeks[WEEK]).toMatchObject({ state: 'confirmed', pilots: [{ release: 'v1.0.1' }, { release: 'v1.0.2' }] });
  });

  for (const [why, tag] of [['forward to a newer release', 'v1.0.3'], ['back to the release that already failed', 'v1.0.1']] as Array<[string, string]>) {
    it(`a re-pilot that stopped resumably, then the release moved ${why}: never continued on the flag, nothing counted`, async () => {
      const b = await failedOn('v1.0.1', [REFUSE('interrupted'), REFUSE('release-moved')]);
      setRelease(b, 'v1.0.2');
      await b.tick({ now: NOW + HOUR });
      setRelease(b, tag);
      await b.tick({ now: NOW + 2 * HOUR });
      const arms = armsCalls(b);
      expect(arms.length).toBe(3);
      expect(arms[2]!.argv, 'the permission named v1.0.2, so it is not passed').not.toContain('--repilot');
      const w = (b.state() as R).weeks[WEEK];
      expect(w).toMatchObject({ state: 'failed', word: 'release-moved', pilots: [{ release: 'v1.0.1' }, { release: 'v1.0.2' }] });
      expect(w.repilot).toBeUndefined();
      await b.tick({ now: NOW + 3 * HOUR });
      expect(armsCalls(b).length, 'a week closed on another word stays closed').toBe(3);
    });
  }

  it('repilotPermitOf: the permission passes only on its own measured key (B0; was: its own release)', () => {
    const k = (b: string): R => ({ state: 'value', key: KEY(b) });
    expect(U.repilotPermitOf({ release: 'v1', key: KEY('b1') }, k('b1'))).toBe(true);
    expect(U.repilotPermitOf({ release: 'v1', key: KEY('b1') }, k('b2'))).toBe(false);
    expect(U.repilotPermitOf({ release: 'v2', key: KEY('b1') }, k('b1')), 'the release is no longer the key').toBe(true);
    expect(U.repilotPermitOf({ release: 'v1', key: KEY('b1') }, { state: 'unmeasured', why: 'x' })).toBe(false);
    expect(U.repilotPermitOf(undefined, k('b1'))).toBe(false);
    expect(U.repilotPermitOf(true, k('b1')), 'the round-1 boolean form').toBe(false);
    expect(U.repilotPermitOf({ release: 'v1' }, k('b1')), 'a permission written before B0 names no key: dropped').toBe(false);
    expect(U.repilotPermitOf({ release: 'v1', key: { claude_code: 'b1' } }, k('b1')), 'a damaged key').toBe(false);
  });

  // fix round 1, A2: only a row with no pilot list at all is an older row.
  // [] is back among them (review 3533, F7): read as an older row, an empty list would re-pilot; the others are none a list.
  for (const damaged of [{}, null, 'x', 5, true, { release: 'v1.0.1' }, []]) {
    it(`a pilot-failed row whose pilot list is damaged (${JSON.stringify(damaged)}) stays closed on a newer release`, async () => {
      const b = await failedOn('v1.0.1');
      const st = b.state() as R;
      st.weeks[WEEK].pilots = damaged;
      writeFileSync(join(b.root, 'unattended.json'), JSON.stringify(st));
      setRelease(b, 'v1.0.2');
      await b.tick({ now: NOW + HOUR });
      expect(armsCalls(b).length).toBe(1);
      expect((b.state() as R).weeks[WEEK]).toMatchObject({ state: 'failed', word: 'pilot-failed' });
    });
  }

  // fix round 1, A3: the pin reader takes only the module's own pin.
  for (const [why, text] of [
    ['another kind', JSON.stringify({ kind: 'not-the-pin', v: 1, setup_sha256: 'f'.repeat(64), ccrc_release: 'v1.0.1', round: 0 })],
    ['another version', JSON.stringify({ kind: QS.RELEASE_PIN_KIND, v: 2, setup_sha256: 'f'.repeat(64), ccrc_release: 'v1.0.1', round: 0 })],
    ['a release that is no string', JSON.stringify({ kind: QS.RELEASE_PIN_KIND, v: 1, setup_sha256: 'f'.repeat(64), ccrc_release: 101, round: 0 })],
    ['an empty release', JSON.stringify({ kind: QS.RELEASE_PIN_KIND, v: 1, setup_sha256: 'f'.repeat(64), ccrc_release: '', round: 0 })],
    ['no JSON', '{'],
  ] as Array<[string, string]>) {
    it(`a pin with ${why} is read as no release: the first pilot is counted unmeasured and the week stays closed`, async () => {
      const b = mkBox();
      b.plan({ arms: [REFUSE('pilot-failed')] });
      setRelease(b, 'v1.0.1');
      pin(b, 'v1.0.1', text);
      await b.tick();
      expect((b.state() as R).weeks[WEEK].pilots).toEqual([{ release: null, key: null, at_ms: NOW }]);   // B0: was { release: null, at_ms }
      setRelease(b, 'v1.0.2');
      await b.tick({ now: NOW + HOUR });
      expect(armsCalls(b).length).toBe(1);
    });
  }

  it('only the current ISO week is piloted again; a past week stays as it was', async () => {
    const b = await failedOn('v1.0.1');
    setRelease(b, 'v1.0.2');
    await b.tick({ now: NEXT_NOW });
    expect((b.state() as R).weeks[WEEK]).toMatchObject({ state: 'failed', word: 'pilot-failed' });
    expect(armsCalls(b).map((c) => c.argv[c.argv.indexOf('--out') + 1])).toEqual([join(b.root, 'weeks', WEEK), join(b.root, 'weeks', NEXT_WEEK)]);
  });

  // ── stage B, B0: the key decides, never the release alone ──
  const setBuildOnly = (b: Box, build: string): void => writeFileSync(join(b.home, 'fixture-build'), build);
  const setReleaseOnly = (b: Box, tag: string): void => writeFileSync(join(b.home, '.ccrc', 'build.json'), JSON.stringify({ sha: 'fixture', version: tag }));

  it('B0: an unrelated release on the same build and code pilots nothing again, however many releases land', async () => {
    const b = await failedOn('v1.0.1');
    for (const [i, t] of ['v1.0.2', 'v1.0.3', 'v1.0.4'].entries()) {
      setReleaseOnly(b, t);
      await b.tick({ now: NOW + (i + 1) * HOUR });
    }
    expect(armsCalls(b).length, 'no second pilot on the key that already failed').toBe(1);
    expect((b.state() as R).weeks[WEEK]).toMatchObject({ state: 'failed', word: 'pilot-failed', pilots: [{ release: 'v1.0.1', key: KEY(BUILD('v1.0.1')) }] });
    expect((b.state() as R).weeks[WEEK].pilots.length).toBe(1);
  });

  it('B0: a new build on the same release is piloted again; the row and the permission name the new key', async () => {
    const b = await failedOn('v1.0.1', [REFUSE('interrupted')]);
    setBuildOnly(b, '9.9.9 (Claude Code)');
    await b.tick({ now: NOW + HOUR });
    const arms = armsCalls(b);
    expect(arms.map((c) => c.argv.includes('--repilot'))).toEqual([false, true]);
    const w = (b.state() as R).weeks[WEEK];
    expect(w.pilots).toEqual([{ release: 'v1.0.1', key: KEY(BUILD('v1.0.1')), at_ms: NOW }, { release: 'v1.0.1', key: KEY('9.9.9 (Claude Code)'), at_ms: NOW + HOUR }]);
    expect(w.repilot, 'given back after the resumable stop, naming its key').toEqual({ release: 'v1.0.1', key: KEY('9.9.9 (Claude Code)') });
  });

  it('B0: the gate\'s code moved on the same build is a new key: piloted again', async () => {
    const b = await failedOn('v1.0.1');
    writeFileSync(join(b.home, 'fixture-code'), JSON.stringify({ ...FIX_CODE, 'deploy/history-replay.mjs': 'c'.repeat(64) }));
    await b.tick({ now: NOW + HOUR });
    expect(armsCalls(b).map((c) => c.argv.includes('--repilot'))).toEqual([false, true]);
  });

  // fix round 1, F1: a pilot file or the skill moved alone, on the same build and gate code, is a new key
  for (const [what, file, text] of [
    ['a pilot file', 'fixture-pilot', JSON.stringify({ ...FIX_PILOT, 'ccd/history/sweep.mjs': 'f'.repeat(64) })],
    ['the skill', 'fixture-skill', '8'.repeat(64)],
  ] as Array<[string, string, string]>) {
    it(`B0, fix round 1: ${what} moved on the same build and gate code is a new key: piloted again, the row naming it`, async () => {
      const b = await failedOn('v1.0.1');
      writeFileSync(join(b.home, file), text);
      await b.tick({ now: NOW + HOUR });
      expect(armsCalls(b).map((c) => c.argv.includes('--repilot'))).toEqual([false, true]);
      const pilots = (b.state() as R).weeks[WEEK].pilots as R[];
      expect(pilots.length).toBe(2);
      expect(U.pilotEntryKeyOf(pilots[1]!), 'the second pilot is counted against the moved key').toEqual({ state: 'key', key: (await fixtureKey(b.home)()).key });
    });
  }

  // fix round 2, A1: the real measure's two new unmeasured arms, each journalled with its own reason
  for (const [what, root, why] of [
    ['pilot files it cannot read', () => mkTmp('quiz-key-empty-'), () => `pilot code ${(QP.PILOT_CODE_FILES as string[])[0]} absent`],
    ['a skill it cannot read', pilotOnlyRoot, () => `skill ${QP.HISTORY_SKILL_SOURCE as string}/SKILL.md is absent`],
  ] as Array<[string, () => string, () => string]>) {
    it(`B0, fix round 2: ${what} keeps the week closed, spawns nothing, and the journal names that reason`, async () => {
      const b = await failedOn('v1.0.1');
      const kh = keyHome({ launcher: false });
      const r = root();
      await b.tick({ now: NOW + HOUR, deps: { pilotKey: async () => U.measuredPilotKeyOf({ home: kh.home, out: kh.out, account: 'up-a', lang: undefined, root: r }) } });
      expect(armsCalls(b).length).toBe(1);
      expect(readFileSync(join(b.root, 'journal.log'), 'utf8')).toContain(`not piloted again: the pilot key is unmeasured (${why()})`);
    });
  }

  it('B0: a key that cannot be measured keeps the week closed, spawns nothing, and the journal says why', async () => {
    const b = await failedOn('v1.0.1');
    unlinkSync(join(b.home, 'fixture-build'));
    setReleaseOnly(b, 'v1.0.2');
    await b.tick({ now: NOW + HOUR });
    expect(armsCalls(b).length).toBe(1);
    expect((b.state() as R).weeks[WEEK]).toMatchObject({ state: 'failed', word: 'pilot-failed' });
    expect(readFileSync(join(b.root, 'journal.log'), 'utf8')).toMatch(/not piloted again: the pilot key is unmeasured \(fixture: no build\)/);
  });

  it('B0: a week whose pilots are spent never measures a key', async () => {
    const b = await failedOn('v1.0.1');
    const st = b.state() as R;
    st.weeks[WEEK].pilots = [{ release: 'v1.0.0' }, { release: 'v1.0.1' }, { release: 'v1.0.1', key: KEY(BUILD('v1.0.1')) }];
    writeFileSync(join(b.root, 'unattended.json'), JSON.stringify(st));
    let asked = 0;
    await b.tick({ now: NOW + HOUR, deps: { pilotKey: async () => { asked += 1; return { state: 'value', key: KEY('9.9.9 (Claude Code)') }; } } });
    expect(asked).toBe(0);
    expect(armsCalls(b).length).toBe(1);
  });

  it('B0: entries written before B0 (a release, no key) count toward the cap and match no key', async () => {
    const b = await failedOn('v1.0.1', [REFUSE('pilot-failed')]);
    const st = b.state() as R;
    st.weeks[WEEK].pilots = [{ release: 'v1.0.1', at_ms: NOW }];   // as ruling 5's runner wrote it
    writeFileSync(join(b.root, 'unattended.json'), JSON.stringify(st));
    await b.tick({ now: NOW + HOUR });
    expect(armsCalls(b).map((c) => c.argv.includes('--repilot')), 'the older entry matches no key: one more pilot').toEqual([false, true]);
    expect((b.state() as R).weeks[WEEK].pilots).toEqual([{ release: 'v1.0.1', at_ms: NOW }, { release: 'v1.0.1', key: KEY(BUILD('v1.0.1')), at_ms: NOW + HOUR }]);
    await b.tick({ now: NOW + 2 * HOUR });
    expect(armsCalls(b).length, 'never twice on one key').toBe(2);
  });

  it('B0: a pin written before B0 (a release, no key) labels the first pilot as an older entry: it counts, and matches no key', async () => {
    const b = mkBox();
    b.plan({ arms: [REFUSE('pilot-failed')] });
    setRelease(b, 'v1.0.1');
    pin(b, 'v1.0.1', `${JSON.stringify({ kind: QS.RELEASE_PIN_KIND, v: 1, setup_sha256: 'f'.repeat(64), ccrc_release: 'v1.0.1', round: 0 })}\n`);
    await b.tick();
    expect((b.state() as R).weeks[WEEK].pilots).toEqual([{ release: 'v1.0.1', at_ms: NOW }]);
    await b.tick({ now: NOW + HOUR });
    expect(armsCalls(b).map((c) => c.argv.includes('--repilot')), 'the same build pilots once more: the older entry names no key').toEqual([false, true]);
  });

  it('B0, fix round 2: a pin whose key has only some of the parts is unmeasured, not older: the week stays closed and spawns nothing', async () => {
    const b = mkBox();
    b.plan({ arms: [REFUSE('pilot-failed')] });
    setRelease(b, 'v1.0.1');
    const partial = { claude_code: BUILD('v1.0.1'), code_shas: FIX_CODE };
    pin(b, 'v1.0.1', `${JSON.stringify({ kind: QS.RELEASE_PIN_KIND, v: 1, setup_sha256: 'f'.repeat(64), ccrc_release: 'v1.0.1', round: 0, key: partial })}\n`);
    await b.tick();
    expect((b.state() as R).weeks[WEEK].pilots).toEqual([{ release: 'v1.0.1', key: null, at_ms: NOW }]);
    await b.tick({ now: NOW + HOUR });
    expect(armsCalls(b).map((c) => c.argv.includes('--repilot')), 'no second pilot: the first pilot\'s key is unmeasured').toEqual([false]);
    expect((b.state() as R).weeks[WEEK]).toMatchObject({ state: 'failed', word: 'pilot-failed' });
  });

  it('B0: a re-pilot that stopped resumably is continued after a release moved on the same key', async () => {
    const b = await failedOn('v1.0.1', [REFUSE('interrupted')]);
    setBuildOnly(b, '9.9.9 (Claude Code)');
    await b.tick({ now: NOW + HOUR });
    setReleaseOnly(b, 'v1.0.2');
    await b.tick({ now: NOW + 2 * HOUR });
    expect(armsCalls(b).map((c) => c.argv.includes('--repilot')), 'the permission names the key, which has not moved').toEqual([false, true, true]);
  });
});

// ── stage B, B0: the runner's real key measure, through the driver's own readers on a fixture HOME ──
/** A fixture HOME with one upstream account whose launcher prints `version` for --version (or exits `code`). */
function keyHome(o: { version?: string; code?: number; launcher?: boolean } = {}): { home: string; out: string } {
  const home = mkTmp('quiz-key-');
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  writeFileSync(join(home, '.ccrc', 'accounts.json'), JSON.stringify({ version: 1, accounts: [{ id: 'up-a', label: 'up-a', configDirSuffix: '.claude',
    exec: { kind: 'upstream' }, homeAble: true, telemetry: 'anthropic' }] }));
  mkdirSync(join(home, '.local', 'bin'), { recursive: true });
  if (o.launcher !== false) {
    writeFileSync(join(home, '.local', 'bin', 'up-a'), `#!/bin/sh\nprintf '%s\\n' ${JSON.stringify(o.version ?? '2.9.1 (Claude Code)')}\nexit ${o.code ?? 0}\n`, { mode: 0o700 });
  }
  const out = join(home, 'week');
  mkdirSync(out, { recursive: true, mode: 0o700 });
  return { home, out };
}

/** A fixture tree holding the pilot files (copied from the repository) and no skill. */
function pilotOnlyRoot(): string {
  const root = mkTmp('quiz-key-root-');
  for (const f of QP.PILOT_CODE_FILES as string[]) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    copyFileSync(join(D.TREE_ROOT as string, f), join(root, f));
  }
  return root;
}
describe('measuredPilotKeyOf: the pilot key as the driver measures it (stage B, B0)', () => {

  it('the key is the launcher\'s --version line, the gate\'s code shas, the pilot files\' shas and the skill\'s sha, exactly as measured', async () => {
    const { home, out } = keyHome();
    const got = await U.measuredPilotKeyOf({ home, out, account: 'up-a', lang: undefined }) as R;
    expect(got).toEqual({ state: 'value', key: { claude_code: '2.9.1 (Claude Code)', code_shas: (D.codeShas() as R).files,
      pilot_shas: (QP.pilotShasOf() as R).files, skill_sha256: (QP.skillSourceOf(D.TREE_ROOT) as R).sha256 } });
    expect(Object.keys(got.key.pilot_shas).sort(), 'every pilot file, each hashed').toEqual([...QP.PILOT_CODE_FILES as string[]].sort());
  });

  it('fix round 2, A1: pilot files it cannot read, and then a skill it cannot read, are each unmeasured with their own reason, before any spawn', async () => {
    const { home, out } = keyHome({ launcher: false });
    expect(await U.measuredPilotKeyOf({ home, out, account: 'up-a', lang: undefined, root: mkTmp('quiz-key-empty-') }))
      .toEqual({ state: 'unmeasured', why: `pilot code ${(QP.PILOT_CODE_FILES as string[])[0]} absent` });
    expect(await U.measuredPilotKeyOf({ home, out, account: 'up-a', lang: undefined, root: pilotOnlyRoot() }))
      .toEqual({ state: 'unmeasured', why: `skill ${QP.HISTORY_SKILL_SOURCE as string}/SKILL.md is absent` });
  });

  it('an account the roster does not admit, a launcher that fails and one that is missing are unmeasured, never a throw', async () => {
    const a = keyHome();
    expect(await U.measuredPilotKeyOf({ home: a.home, out: a.out, account: 'nobody', lang: undefined })).toMatchObject({ state: 'unmeasured', why: 'account account-refused' });
    const f = keyHome({ code: 3 });
    expect(await U.measuredPilotKeyOf({ home: f.home, out: f.out, account: 'up-a', lang: undefined })).toMatchObject({ state: 'unmeasured', why: expect.stringMatching(/^version failed/) });
    const m = keyHome({ launcher: false });
    expect(await U.measuredPilotKeyOf({ home: m.home, out: m.out, account: 'up-a', lang: undefined })).toMatchObject({ state: 'unmeasured' });
  });

  it('a tick with no stand-in measures through the driver\'s own roster reader: a roster it cannot admit keeps the week closed', async () => {
    const b = mkBox();
    const pinPath = join(b.root, 'weeks', WEEK, 'quiz', 'arms-release.json');
    b.plan({ arms: [{ ...REFUSE('pilot-failed'), writes: [[pinPath, QS.releasePinText('f'.repeat(64), 'v1.0.1', 0, KEY('b1')) as string]] }] });
    await b.tick();
    expect((b.state() as R).weeks[WEEK]).toMatchObject({ state: 'failed', word: 'pilot-failed', pilots: [{ release: 'v1.0.1', key: KEY('b1') }] });
    // the box's fixture roster is not one the driver's roster reader admits, so the real measure answers unmeasured
    await b.tick({ now: NOW + 3600_000, deps: { pilotKey: undefined } });
    expect(b.calls('driver').filter((c) => c.argv[0] === 'arms').length).toBe(1);
    expect(readFileSync(join(b.root, 'journal.log'), 'utf8')).toMatch(/not piloted again: the pilot key is unmeasured \(account roster-invalid\)/);
  });
});

// ── run 3538: the week's account (the coordinator's rulings 2, 3 and 5 of 2026-11-23) ───────────────────────────────────
describe('weekAccountChoiceOf: the pure choice of a week\'s account, as a table', () => {
  const rec = (id: string, o: R = {}): R => ({ id, disabled: false, room: true, ...o });
  const cand = (id: string, seven: number | null, word = 'limits-stale'): R => (seven === null ? { id, room: false, word } : { id, room: true, seven });
  const rows: Array<[string, R, R]> = [
    ['a recorded week stays on its account, though another has a lower weekly figure',
      { recorded: rec('lane-b'), previous: 'lane-c', candidates: [cand('lane-c', 1)] }, { account: 'lane-b', why: 'recorded' }],
    ['a recorded week whose account has no room waits, never moves',
      { recorded: rec('lane-b', { room: false, word: 'limits-stale', detail: 'old 3601000' }), previous: 'lane-c', candidates: [cand('lane-c', 1)] },
      { wait: 'no-room', detail: 'the week\'s account: limits-stale old 3601000' }],
    ['a recorded week whose account is switched off waits account-disabled, room or not',
      { recorded: rec('lane-b', { disabled: true }), previous: 'lane-b', candidates: [cand('lane-c', 1)] },
      { wait: 'account-disabled', detail: 'the week\'s account is switched off by the operator\'s lane kill switch' }],
    ['an unspawned week keeps the previous account when it has room, though another is lower',
      { recorded: null, previous: 'lane-b', candidates: [cand('lane-c', 1), cand('lane-b', 40)] }, { account: 'lane-b', why: 'previous' }],
    ['an unspawned week does not keep a previous account without room: the lowest with room',
      { recorded: null, previous: 'lane-b', candidates: [cand('lane-b', null), cand('lane-c', 30), cand('lane-d', 20)] }, { account: 'lane-d', why: 'lowest' }],
    ['ties go in roster order',
      { recorded: null, previous: 'lane-x', candidates: [cand('lane-c', 20), cand('lane-d', 20)] }, { account: 'lane-c', why: 'lowest' }],
    ['a previous account that is no candidate (switched off, or no longer eligible) is not kept',
      { recorded: null, previous: 'lane-b', candidates: [cand('lane-c', 30)] }, { account: 'lane-c', why: 'lowest' }],
    ['no candidate with room: no-room, each candidate\'s word by position, no account named',
      { recorded: null, previous: 'lane-b', candidates: [cand('lane-b', null, 'limits-stale'), cand('lane-c', null, 'limits-threshold')] },
      { wait: 'no-room', detail: '1: limits-stale, 2: limits-threshold' }],
    ['no candidate at all: no-room',
      { recorded: null, previous: 'lane-b', candidates: [] }, { wait: 'no-room', detail: 'the roster names no eligible account' }],
    // fix round 1 (review 3545 F1): admission's refusals this tick, walked past in the same order, as setup does
    ['a refused previous account is walked past to the lowest with room',
      { recorded: null, previous: 'lane-b', candidates: [cand('lane-b', 40), cand('lane-c', 30), cand('lane-d', 20)], refused: { 'lane-b': 'secrets-absent' } },
      { account: 'lane-d', why: 'lowest' }],
    ['a refused lowest is walked past to the next lowest',
      { recorded: null, previous: 'lane-x', candidates: [cand('lane-c', 30), cand('lane-d', 20)], refused: { 'lane-d': 'secrets-absent' } },
      { account: 'lane-c', why: 'lowest' }],
    ['every candidate with room refused: no-room, each candidate named by position, a refused one by its refusal',
      { recorded: null, previous: 'lane-c', candidates: [cand('lane-b', null), cand('lane-c', 30), cand('lane-d', 20)],
        refused: { 'lane-c': 'secrets-absent', 'lane-d': 'upstream-config-dir' } },
      { wait: 'no-room', detail: '1: limits-stale, 2: account-refused secrets-absent, 3: account-refused upstream-config-dir' }],
    ['a recorded week stays on its account whatever was refused (its own refusal closes it on its word)',
      { recorded: rec('lane-b'), previous: 'lane-b', candidates: [], refused: { 'lane-b': 'secrets-absent' } }, { account: 'lane-b', why: 'recorded' }],
  ];
  it.each(rows)('%s', (_name, input, want) => {
    expect(U.weekAccountChoiceOf(input)).toEqual(want);
  });
  it('over every row, its answer for an unspawned week is never an account without room, a refused one, or a non-candidate', () => {
    for (const [, input] of rows) {
      const got = U.weekAccountChoiceOf(input) as R;
      if (got.account === undefined || input.recorded !== null) continue;
      const c = (input.candidates as R[]).find((x) => x.id === got.account);
      expect(c?.room, JSON.stringify(input)).toBe(true);
      expect(Object.keys((input.refused ?? {}) as R), JSON.stringify(input)).not.toContain(got.account);
    }
  });
});

describe('the runner runs each week on the week\'s account (run 3538)', () => {
  const W = (b: Box, key = WEEK): string => join(b.root, 'weeks', key);
  const recordOf = (b: Box, key = WEEK): R | null => {
    const f = join(W(b, key), 'quiz', 'week-account.json');
    return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) as R : null;
  };
  const accountArg = (c: R): string | null => { const i = (c.argv as string[]).indexOf('--account'); return i < 0 ? null : c.argv[i + 1] as string; };
  const spends = (b: Box): R[] => b.calls('driver').filter((c) => c.argv[0] === 'arms' || c.argv[0] === 'judge');

  it('the field case: the setup\'s account went idle (no fresh row), so a new week runs on another account with room', async () => {
    const b = mkBox();
    await b.tick();
    expect((b.state() as R).setup.account, 'CONTROL: setup took acct-b (a tie, roster order)').toBe('acct-b');
    expect(recordOf(b)?.account, 'the first week recorded the setup\'s account').toBe('acct-b');
    b.setLimits('acct-b', null);   // no row a status line refreshed: no room
    await b.tick({ now: NEXT_NOW });
    const next = spends(b).filter((c) => (c.argv as string[]).includes(W(b, NEXT_WEEK)));
    expect(next.map((c) => [c.argv[0], accountArg(c)])).toEqual([['arms', 'acct-c'], ['judge', 'acct-c']]);
    expect((b.state() as R).weeks[NEXT_WEEK].state).toBe('confirmed');
    expect(recordOf(b, NEXT_WEEK)?.account).toBe('acct-c');
    expect((b.state() as R).setup.account, 'the setup is never re-made').toBe('acct-b');
    expect(subs(b).filter((s) => s === 'setup').length).toBe(1);
  });

  it('a new week keeps last week\'s account while it has room, though another has a lower weekly figure', async () => {
    const b = mkBox();
    b.setLimits('acct-b', null);
    await b.tick();   // setup on acct-c, the only one with room; week one on acct-c
    expect((b.state() as R).setup.account).toBe('acct-c');
    b.setLimits('acct-b', { five: 10, seven: 1 });
    b.setLimits('acct-c', { five: 10, seven: 40 });
    await b.tick({ now: NEXT_NOW });
    expect(spends(b).slice(-2).map(accountArg)).toEqual(['acct-c', 'acct-c']);
  });

  it('a week that has spawned stays on its account and waits, though another has room', async () => {
    const b = mkBox();
    b.plan({ arms: [REFUSE('interrupted')] });
    await b.tick();
    expect(recordOf(b)?.account).toBe('acct-b');
    const n = b.calls().length;
    b.setLimits('acct-b', { five: 10, seven: 95 });
    await b.tick({ now: NOW + 3600_000 });
    expect(b.calls().length, 'nothing spawned on acct-c').toBe(n);
    expect((b.state() as R).last).toMatchObject({ act: 'arms', outcome: 'waiting', word: 'no-room' });
  });

  it('the kill switch: a switched-off previous account is not kept, and every candidate off is no-room with no spawn', async () => {
    const b = mkBox();
    await b.tick();
    mkdirSync(join(b.home, '.cc-sessions'), { recursive: true });
    writeFileSync(join(b.home, '.cc-sessions', 'acct-b-disabled'), '');
    await b.tick({ now: NEXT_NOW });
    expect(spends(b).slice(-2).map(accountArg), 'acct-b has room but is switched off').toEqual(['acct-c', 'acct-c']);
    writeFileSync(join(b.home, '.cc-sessions', 'acct-c-disabled'), '');
    const n = b.calls().length;
    const third = NEXT_NOW + 7 * DAY;
    await b.tick({ now: third });
    expect(b.calls().length).toBe(n);
    expect((b.state() as R).last).toMatchObject({ week: U.weekKeyOf(third), act: 'arms', outcome: 'waiting', word: 'no-room', detail: 'the roster names no eligible account' });
  });

  it('a week an older build ran (its release pin, no record) reads as the setup\'s account', async () => {
    const b = mkBox();
    b.plan({ arms: [{ ...REFUSE('interrupted'), noRecord: true, mkdir: true }] });
    await b.tick();
    mkdirSync(join(W(b), 'quiz'), { recursive: true });
    writeFileSync(join(W(b), 'quiz', 'arms-release.json'), QS.releasePinText((b.state() as R).setup.setup_sha256, 'v1.0.1', 0, KEY('b1')) as string);
    b.setLimits('acct-b', { five: 10, seven: 50 });
    b.setLimits('acct-c', { five: 10, seven: 1 });
    await b.tick({ now: NOW + 3600_000 });
    expect(spends(b).slice(-2).map(accountArg)).toEqual(['acct-b', 'acct-b']);
  });

  it('an unreadable record refuses week-account-unreadable, spends nothing, and the week stays running', async () => {
    const b = mkBox();
    b.plan({ arms: [REFUSE('interrupted')] });
    await b.tick();
    writeFileSync(join(W(b), 'quiz', 'week-account.json'), '{"kind":"not this"}\n');
    const n = b.calls().length;
    await b.tick({ now: NOW + 3600_000 });
    expect(b.calls().length).toBe(n);
    const st = b.state() as R;
    expect(st.last).toMatchObject({ act: 'arms', outcome: 'refused', word: 'week-account-unreadable' });
    expect(st.weeks[WEEK].state).toBe('running');
    expect(U.OWN_WORDS).toContain('week-account-unreadable');
  });

  it('the status posts the week\'s account when its folder records one, else the setup\'s', async () => {
    const b = mkBox();
    await b.tick();
    const body = (): R => JSON.parse(b.calls('client').at(-1)!.stdin as string) as R;
    expect(body().account).toBe('acct-b');
    b.setLimits('acct-b', null);
    await b.tick({ now: NEXT_NOW });
    expect(body().account, 'the new week ran on acct-c').toBe('acct-c');
  });

  // fix round 1 (review 3545 F1): an unspawned week whose pick admission refuses tries the next, as setup does
  const three = (): Box => mkBox({ accounts: [acct('acct-b'), acct('acct-c'), acct('acct-d')],
    limits: { 'acct-b': { five: 10, seven: 10 }, 'acct-c': { five: 10, seven: 20 }, 'acct-d': { five: 10, seven: 30 } } });
  const refusedAtAdmission = (detail: string): R => ({ ...REFUSE('account-refused', detail), noRecord: true });

  it('an unspawned week\'s pick refused at admission: the next in the choice\'s order runs the week and is its record', async () => {
    const b = three();
    b.plan({ 'arms@acct-b': [refusedAtAdmission('secrets-absent')] });
    await b.tick();
    expect((b.state() as R).setup.account, 'CONTROL: the setup took the lowest, acct-b').toBe('acct-b');
    expect(spends(b).map((c) => [c.argv[0], accountArg(c)])).toEqual([['arms', 'acct-b'], ['arms', 'acct-c'], ['judge', 'acct-c']]);
    expect(recordOf(b)?.account).toBe('acct-c');
    expect((b.state() as R).weeks[WEEK]).toMatchObject({ state: 'confirmed' });
    expect(subs(b).filter((s) => s === 'setup').length, 'the setup is never re-made').toBe(1);
  });

  it('every candidate refused at admission: the week waits no-room naming each, stays running, and the next tick tries again', async () => {
    const b = three();
    b.plan({ 'arms@acct-b': [refusedAtAdmission('secrets-absent')], 'arms@acct-c': [refusedAtAdmission('provider-other')],
      'arms@acct-d': [refusedAtAdmission('upstream-config-dir')] });
    await b.tick();
    const st = b.state() as R;
    expect(st.last).toMatchObject({ act: 'arms', outcome: 'waiting', word: 'no-room',
      detail: '1: account-refused secrets-absent, 2: account-refused provider-other, 3: account-refused upstream-config-dir' });
    expect(st.weeks[WEEK]).toMatchObject({ state: 'running' });
    expect(recordOf(b)).toBeNull();
    expect(spends(b).map(accountArg)).toEqual(['acct-b', 'acct-c', 'acct-d']);
    await b.tick({ now: NOW + 3600_000 });
    expect(spends(b).slice(3).map((c) => [c.argv[0], accountArg(c)])).toEqual([['arms', 'acct-b'], ['judge', 'acct-b']]);
    expect((b.state() as R).weeks[WEEK]).toMatchObject({ state: 'confirmed' });
  });

  it('a recorded week whose account is later refused closes on its word, as before: nothing is tried on another', async () => {
    const b = three();
    b.plan({ arms: [REFUSE('interrupted'), REFUSE('account-refused', 'secrets-absent')] });
    await b.tick();
    expect(recordOf(b)?.account).toBe('acct-b');
    await b.tick({ now: NOW + 3600_000 });
    expect(spends(b).map(accountArg)).toEqual(['acct-b', 'acct-b']);
    expect((b.state() as R).weeks[WEEK]).toMatchObject({ state: 'failed', word: 'account-refused' });
  });

  // Today's arms never answers account-refused once it has recorded the account (every emitter is admission, before --out),
  // so the fake stands for a driver that would: the runner's own re-read of the record is the guard this case pins.
  it('an account-refused that comes when the week\'s folder already records the account closes the week, never falls through', async () => {
    const b = three();
    b.plan({ 'arms@acct-b': [REFUSE('account-refused', 'fixture detail')] });   // the fake records the account, then refuses
    await b.tick();
    expect(spends(b).map(accountArg)).toEqual(['acct-b']);
    expect(recordOf(b)?.account).toBe('acct-b');
    expect((b.state() as R).weeks[WEEK]).toMatchObject({ state: 'failed', word: 'account-refused' });
  });

  // fix round 2 (review 3549 F2): the walk stops when the runner has been told to stop
  it('a stop arriving while the first candidate\'s driver refuses at admission: no second spawn, the week still running, interrupted', async () => {
    const b = three();
    b.plan({ 'arms@acct-b': [{ ...refusedAtAdmission('secrets-absent'), hold: true }] });
    // the runner's own stop handler, called directly: no signal is sent to this test process
    const before = new Set(process.listeners('SIGTERM'));
    const ticking = b.tick();
    const deadline = Date.now() + 30_000;
    while (!existsSync(join(b.home, 'held')) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    expect(existsSync(join(b.home, 'held')), 'fixture: the first candidate\'s driver started').toBe(true);
    const added = process.listeners('SIGTERM').filter((l) => !before.has(l));
    expect(added, 'fixture: the runner listens for SIGTERM').toHaveLength(1);
    (added[0] as (s: string) => void)('SIGTERM');
    await ticking;
    expect(existsSync(join(b.home, 'term.seen')), 'fixture: the stop reached the refusing driver').toBe(true);
    expect(spends(b).map(accountArg), 'no second candidate spawned').toEqual(['acct-b']);
    const st = b.state() as R;
    expect(st.weeks[WEEK]).toMatchObject({ state: 'running' });
    expect(st.last).toMatchObject({ act: 'arms', outcome: 'waiting', word: 'interrupted' });
    expect(recordOf(b)).toBeNull();
  }, 60_000);

  it('ruling 1 on the runner\'s own reading: an account whose row is marked with no five-hour window has room on its weekly figure', async () => {
    const b = mkBox();
    b.setLimits('acct-b', { five: null, seven: 10, fiveWindowMinutes: 0 });
    b.setLimits('acct-c', { five: null, seven: 10 });   // no marker: five-null, still no room
    await b.tick();
    expect((b.state() as R).setup.account).toBe('acct-b');
    expect(spends(b).map(accountArg)).toEqual(['acct-b', 'acct-b']);
  });
});

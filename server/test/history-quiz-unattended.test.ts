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
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as unMod from '../../deploy/history-quiz-unattended.mjs';
import * as qsMod from '../../deploy/history-quiz-single.mjs';
import * as drvMod from '../../deploy/history-replay.mjs';
import { quizWeek } from '../src/continuity/quiz.js';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';

type R = Record<string, any>;
const U = unMod as unknown as R;
const QS = qsMod as unknown as R;
const D = drvMod as unknown as R;

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
const made = () => {
  if (out === null) return;
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  const m = path.join(out, '.ccrc-history-quiz-single');
  if (!fs.existsSync(m)) fs.writeFileSync(m, '');
};
if (step.mkdir === true) made();
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
      const code = await U.main(env, { driver, verb, client, now: () => t.now ?? NOW, err: (s: string) => { err += s; }, ...t.deps }) as number;
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
      ['arms', ...base],
      ['judge', ...base, ...armsSummary],
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
    it(`before ${act}: no room for the setup's account waits (no-room), spawns nothing, the week stays running`, async () => {
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
    it(`before ${act}: the setup's account switched off waits account-disabled (not no-room), spawns nothing, and resumes when it is back on`, async () => {
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
describe('repilotOf: the pure decision, as a table', () => {
  const failed = { state: 'failed', word: 'pilot-failed' };
  const tag = (t: string): R => ({ state: 'value', tag: t });
  const rows: Array<[string, R, unknown, R, R]> = [
    ['a newer release after one failed pilot', failed, [{ release: 'v1.0.1' }], tag('v1.0.2'), { repilot: true, pilot: 2 }],
    ['a newer release after two failed pilots: the third', failed, [{ release: 'v1.0.1' }, { release: 'v1.0.2' }], tag('v1.0.3'), { repilot: true, pilot: 3 }],
    ['three failed pilots: no fourth', failed, [{ release: 'v1.0.1' }, { release: 'v1.0.2' }, { release: 'v1.0.3' }], tag('v1.0.4'), { repilot: false, why: 'pilots-spent' }],
    ['the same release: no second pilot on it', failed, [{ release: 'v1.0.1' }], tag('v1.0.1'), { repilot: false, why: 'release-unchanged' }],
    ['back to an earlier failed release', failed, [{ release: 'v1.0.1' }, { release: 'v1.0.2' }], tag('v1.0.1'), { repilot: false, why: 'release-unchanged' }],
    ['no row', null as unknown as R, [], tag('v1.0.2'), { repilot: false, why: 'no-week' }],
    ['a running week', { state: 'running', word: null }, [{ release: 'v1.0.1' }], tag('v1.0.2'), { repilot: false, why: 'not-failed' }],
    ['a confirmed week', { state: 'confirmed', word: null }, [{ release: 'v1.0.1' }], tag('v1.0.2'), { repilot: false, why: 'not-failed' }],
    ['closed on another word', { state: 'failed', word: 'out-refused' }, [{ release: 'v1.0.1' }], tag('v1.0.2'), { repilot: false, why: 'not-the-pilot' }],
    ['closed week-ended', { state: 'failed', word: 'week-ended' }, [{ release: 'v1.0.1' }], tag('v1.0.2'), { repilot: false, why: 'not-the-pilot' }],
    ['no failed pilot recorded', failed, [], tag('v1.0.2'), { repilot: false, why: 'pilots-unreadable' }],
    ['pilots not a list', failed, { release: 'v1.0.1' }, tag('v1.0.2'), { repilot: false, why: 'pilots-unreadable' }],
    ['a pilot entry that is no object', failed, ['v1.0.1'], tag('v1.0.2'), { repilot: false, why: 'pilots-unreadable' }],
    ['the release now absent', failed, [{ release: 'v1.0.1' }], { state: 'absent' }, { repilot: false, why: 'release-unmeasured' }],
    ['the release now untagged', failed, [{ release: 'v1.0.1' }], { state: 'untagged' }, { repilot: false, why: 'release-unmeasured' }],
    ['the release now unreadable', failed, [{ release: 'v1.0.1' }], { state: 'unreadable', code: 'EACCES' }, { repilot: false, why: 'release-unmeasured' }],
    ['a failed pilot whose release could not be read', failed, [{ release: null }], tag('v1.0.2'), { repilot: false, why: 'failed-release-unmeasured' }],
  ];
  for (const [name, week, pilots, release, want] of rows) {
    it(name, () => { expect(U.repilotOf({ week, pilots, release })).toEqual(want); });
  }
  it('every reason word is a STAY_CLOSED word, and the cap is three', () => {
    expect(U.PILOTS_MAX).toBe(3);
    for (const [, week, pilots, release] of rows) {
      const d = U.repilotOf({ week, pilots, release }) as R;
      if (d.repilot === false) expect(U.STAY_CLOSED, d.why as string).toContain(d.why);
    }
  });
});

describe('the runner acts on repilotOf: it reopens the week and runs arms --repilot in the same directory', () => {
  const setRelease = (b: Box, tag: string): void => writeFileSync(join(b.home, '.ccrc', 'build.json'), JSON.stringify({ sha: 'fixture', version: tag }));
  /** The driver's release pin, composed by the single-arm module's own releasePinText (so the runner's reader is held to the
   *  module's bytes, fix round 1 F3), written into a week's directory as that module does before its pilot. */
  const pin = (b: Box, tag: string, text?: string): void => {
    const dir = join(b.root, 'weeks', WEEK, 'quiz');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'arms-release.json'), text ?? (QS.releasePinText('f'.repeat(64), tag, 0) as string));
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
    expect(arms[1]!.argv[arms[1]!.argv.indexOf('--out') + 1], 'the same week directory, so the same ledger and --budget').toBe(join(b.root, 'weeks', WEEK));
    const w = (b.state() as R).weeks[WEEK];
    expect(w).toMatchObject({ state: 'confirmed', pilots: [{ release: 'v1.0.1' }, { release: 'v1.0.2', at_ms: NOW + HOUR }] });
    expect(w.repilot, 'the permission was for one act').toBeUndefined();
    expect(subs(b).filter((s) => s === 'judge').length).toBe(1);
    expect(readFileSync(join(b.root, 'journal.log'), 'utf8')).toMatch(/week \S+ piloted again: pilot 2 of 3, release v1\.0\.2, after v1\.0\.1/);
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

  it('an unreadable pin keeps the week closed: an unmeasured release never re-spends', async () => {
    const b = mkBox();
    b.plan({ arms: [REFUSE('pilot-failed')] });
    setRelease(b, 'v1.0.1');
    await b.tick();
    expect((b.state() as R).weeks[WEEK].pilots).toEqual([{ release: null, at_ms: NOW }]);
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
    chmodSync(b.root, 0o700);
    try { unlinkSync(join(b.root, 'unattended.lock')); } catch { /* released */ }
  }
  for (const legacy of [false, true]) {
    it.skipIf(process.getuid?.() === 0)(`a kill between the driver's write and the save: no second pilot on that release, and the count is right (${legacy ? 'a row closed before this change' : 'a new-style row'})`, async () => {
      const b = await failedOn('v1.0.1');
      const rePin = [join(b.root, 'weeks', WEEK, 'quiz', 'arms-release.json'), QS.releasePinText('f'.repeat(64), 'v1.0.2', 1) as string];
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

  it('repilotPermitOf: the permission passes only on its own measured release', () => {
    const tag = (t: string): R => ({ state: 'value', tag: t });
    expect(U.repilotPermitOf({ release: 'v1' }, tag('v1'))).toBe(true);
    expect(U.repilotPermitOf({ release: 'v1' }, tag('v2'))).toBe(false);
    expect(U.repilotPermitOf({ release: 'v1' }, { state: 'absent' })).toBe(false);
    expect(U.repilotPermitOf(undefined, tag('v1'))).toBe(false);
    expect(U.repilotPermitOf(true, tag('v1')), 'the round-1 boolean form').toBe(false);
    expect(U.repilotPermitOf({ release: 7 }, tag('7'))).toBe(false);
  });

  // fix round 1, A2: only a row with no pilot list at all is an older row.
  for (const damaged of [{}, null, 'x', 5, [], [null]]) {
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
      expect((b.state() as R).weeks[WEEK].pilots).toEqual([{ release: null, at_ms: NOW }]);
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
});

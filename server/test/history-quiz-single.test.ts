// deploy/history-quiz-single.mjs: the replay quiz's single-arm mode (Overlord W1a; plan 2026-11-17-overlord-quiz-record.md,
// Tasks 3 to 6). Listed in ci.yml's node-floor leg, as every history-*.test.ts is.
//
// ISOLATION: every case runs on a mkTmp fixture HOME: a roster with one upstream account whose launcher is a recording
// stub, a limits row, a release stamp and a createStore store. The store's reads that need real transcripts (the re-check
// and the payloads) are stood in through each handler's deps, as the driver's own tests stand them in. Child processes are
// spawned with an argv array on process.execPath and historyHelpers' scrubbedEnv. Nothing reads the live HOME, no case
// runs a writing form of `ccrc history`, and no fixture names a real account, host or path.
import { describe, expect, it, vi } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as qsMod from '../../deploy/history-quiz-single.mjs';
import * as drvMod from '../../deploy/history-replay.mjs';
import * as gateMod from '../../deploy/history-gate.mjs';
import * as libMod from '../../ccd/history/lib.mjs';
import { createStore } from '../../ccd/history/store.mjs';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';
import { REPO, scrubbedEnv } from './historyHelpers.js';

type R = Record<string, any>;
const QS = qsMod as unknown as R;
const D = drvMod as unknown as R;
const G = gateMod as unknown as R;
const L = libMod as unknown as R;

removeTmpFixturesEachTest();

const SCRIPT = join(REPO, 'deploy', 'history-quiz-single.mjs');
const STORE = '00000000-0000-4000-8000-0000000005a1';
const OPUS = 'claude-opus-9-1';
const ARM_MODEL = 'claude-arm-9-1';
const STAMP = 'v9.9.8';
const LANG = 'fixture.UTF-8';
const CARD = 'fixture card line for the single-arm quiz';
const STUB_DIR = 'stub-qs';
const STUB_LOG = 'stub-log.jsonl';
const STUB_VERSION = 'stub-version';
const SEED = L.sha256Hex('quiz-single fixture seed') as string;
const TREATMENT = D.TREATMENT_ARM as string;
const CONTROL = D.CONTROL_ARM as string;
const gen = (n: number): string => `0189abcd-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** The recording stub: logs every run (argv, the recall arm, stdin); `--version` prints STUB_VERSION's first line. A
 *  print-mode run is keyed by sha256(settings mode, a newline, its stdin) and prints `<STUB_DIR>/<key>.jsonl` (else
 *  `<STUB_DIR>/default.jsonl`, else nothing), exits `<key>.exit` (else 0), and with `<key>.sleep` writes its pid to `<key>.pid` and sleeps. */
const STUB = `#!/usr/bin/env node
(async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const crypto = await import('node:crypto');
  const home = path.resolve(path.dirname(process.argv[1]), '..', '..');
  const at = (f) => path.join(home, f);
  const opt = (f) => { try { return fs.readFileSync(at(f), 'utf8'); } catch { return null; } };
  const argv = process.argv.slice(2);
  if (argv[0] === '--version') { process.stdout.write(opt(${JSON.stringify(STUB_VERSION)}) ?? ''); return; }
  const stdin = fs.readFileSync(0, 'utf8');
  const mode = argv.includes('--restricted') ? 'restricted' : 'fallback';
  const key = crypto.createHash('sha256').update(mode + '\\n' + stdin).digest('hex');
  const dir = ${JSON.stringify(STUB_DIR)};
  fs.appendFileSync(at(${JSON.stringify(STUB_LOG)}), JSON.stringify({ argv, arm: process.env.CCRC_RECALL_ARM ?? null, stdin, key }) + '\\n');
  const sleep = opt(dir + '/' + key + '.sleep');
  if (sleep !== null) {
    fs.writeFileSync(at(dir + '/' + key + '.pid'), String(process.pid));
    await new Promise((r) => setTimeout(r, Number(sleep)));
  }
  process.stdout.write(opt(dir + '/' + key + '.jsonl') ?? opt(dir + '/default.jsonl') ?? '');
  process.exitCode = Number(opt(dir + '/' + key + '.exit') ?? '0');
})();
`;

/** A stream-json: init (tools, no MCP server, no plugin, the ccrc-history skill unless `skills` says otherwise), one tool
 *  pair per call, `main` more main-thread messages and `sub` subagent ones, and a result with `text` and `subtype` whose
 *  usage sums to 65 (none when `result` is false). */
function stream(o: { text?: string; skills?: string[]; calls?: Array<{ command?: string; name?: string; denied?: boolean; parent?: string | null }>;
  main?: number; sub?: number; subtype?: string; result?: boolean; session?: string } = {}): string {
  const ev: R[] = [{ type: 'system', subtype: 'init', session_id: o.session ?? 'fixture-qs-session', model: ARM_MODEL, tools: ['Bash', 'Agent'],
    mcp_servers: [], plugins: [], skills: o.skills ?? ['ccrc-history'], slash_commands: [] }];
  const usage = { input_tokens: 1, output_tokens: 1 };
  const denials: R[] = [];
  (o.calls ?? []).forEach((c, i) => {
    const id = `toolu_qs_${i}`;
    const name = c.name ?? 'Bash';
    const input = name === 'Bash' ? { command: c.command ?? '' } : { prompt: 'fixture subagent task' };
    ev.push({ type: 'assistant', parent_tool_use_id: c.parent ?? null, message: { id: `msg-qs-${i}`, usage, content: [{ type: 'tool_use', id, name, input }] } });
    ev.push({ type: 'user', parent_tool_use_id: c.parent ?? null, message: { content: [{ type: 'tool_result', tool_use_id: id,
      content: c.denied === true ? 'permission denied' : 'ok', is_error: c.denied === true }] } });
    if (c.denied === true) denials.push({ tool_name: name, tool_use_id: id, tool_input: input });
  });
  for (let i = 0; i < (o.main ?? 0); i += 1) ev.push({ type: 'assistant', parent_tool_use_id: null, message: { id: `msg-qs-main-${i}`, usage, content: [{ type: 'text', text: 'DONE' }] } });
  for (let i = 0; i < (o.sub ?? 0); i += 1) ev.push({ type: 'assistant', parent_tool_use_id: 'toolu_qs_agent', message: { id: `msg-qs-sub-${i}`, usage, content: [{ type: 'text', text: 'sub' }] } });
  if (o.result !== false) {
    const subtype = o.subtype ?? 'success';
    ev.push({ type: 'result', subtype, is_error: subtype !== 'success', num_turns: (o.main ?? 0) + (o.calls ?? []).length, result: o.text ?? 'DONE',
      permission_denials: denials, usage: { input_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 30, output_tokens: 5 } });
  }
  return ev.map((e) => JSON.stringify(e)).join('\n') + '\n';
}
const keyOf = (mode: string, stdin: string): string => L.sha256Hex(`${mode}\n${stdin}`) as string;
/** Stage B, B0: the pilot key an act on this checkout measures with the stub's build: its --version line and the gate's code shas. */
const QK = (build = '2.9.1 (Claude Code)'): R => ({ claude_code: build, code_shas: (D.codeShas() as R).files });
function put(home: string, mode: string, stdin: string, ext: string, text: string): void {
  mkdirSync(join(home, STUB_DIR), { recursive: true });
  writeFileSync(join(home, STUB_DIR, `${keyOf(mode, stdin)}${ext}`), text);
}
/** Every step 0b run's passing stream for `mode` (W2-D57, W2-D58): the box run at the turn bound, each taught spelling made,
 *  each denial denied, the Agent call with its subagent's Bash call. `over` replaces one by its probe name. */
function plantStep0b(home: string, mode: string, over: Record<string, string> = {}): void {
  put(home, mode, D.TURN_PROBE_PROMPT as string, '.jsonl', over['turn-bound'] ?? stream({ main: 12, sub: 2, subtype: D.MAX_TURNS_STOP_SUBTYPE as string, session: 'fixture-qs-turn' }));
  for (const p of D.step0bProbesOf(home, D.STEP0B_SYNTHETIC_TRANSCRIPT) as R[]) {
    const session = `fixture-qs-${p.probe as string}`;
    const pass = p.expect === 'admitted' ? stream({ session, calls: [{ command: p.command }] })
      : p.expect === 'denied' ? stream({ session, calls: [{ command: p.command, denied: true }] })
        : stream({ session, calls: [{ name: 'Agent' }, { command: p.command, parent: 'toolu_qs_0' }] });
    put(home, mode, D.step0bStdinOf(CARD, p) as string, '.jsonl', over[p.probe as string] ?? pass);
  }
}
/** The treatment payload the stand-in reads answer for a question, which is its arm run's stdin. */
const payloadOf = (qid: string): string => `${CARD}\n\nfixture payload ${qid}\n`;
/** The store reads stood in (the driver's tests' shapes): every question re-checks clean, and its payloads carry CARD. */
const FAKE: R = {
  recheck: async (_rs: unknown, es: R[]): Promise<Map<string, R>> => new Map(es.map((e) => [e.qid as string, { ok: true, boundaryEntryId: 0, cut: { qid: e.qid } }])),
  payloads: (_rs: unknown, _id: number, _q: string, cut: R): R => ({ state: 'payloads', plain: `fixture payload ${cut.qid as string}\n`,
    carded: payloadOf(cut.qid as string), card: { state: 'card', line: CARD } }),
};

/** A fixture node: up-a (upstream) with the stub, the stub's version, a fresh limits row at 10%, a tagged release stamp,
 *  and a store of id STORE. */
function node(): string {
  const home = mkTmp('ccrc-qs-home-');
  mkdirSync(join(home, '.ccrc'), { recursive: true, mode: 0o700 });
  writeFileSync(join(home, '.ccrc', 'accounts.json'), `${JSON.stringify({ version: 1, accounts: [{ id: 'up-a', label: 'up-a', configDirSuffix: '.claude',
    exec: { kind: 'upstream' }, homeAble: true, telemetry: 'anthropic' }] }, null, 2)}\n`);
  mkdirSync(join(home, '.local', 'bin'), { recursive: true });
  writeFileSync(join(home, '.local', 'bin', 'up-a'), STUB, { mode: 0o700 });
  writeFileSync(join(home, STUB_VERSION), '2.9.1 (Claude Code)\n');
  mkdirSync(join(home, '.cc-limits'), { recursive: true });
  const nowS = Math.floor(Date.now() / 1000);
  writeFileSync(join(home, '.cc-limits', 'up-a.json'), JSON.stringify({ five: 10, seven: 10, ts: nowS - 60, fiveResetAt: nowS + 3600, sevenResetAt: nowS + 86400 }));
  writeFileSync(join(home, '.ccrc', 'build.json'), JSON.stringify({ sha: 'fixture', ref: 'main', builtAt: '2026-11-17T00:00:00Z', dirty: false, version: STAMP }));
  createStore(home, { storeId: STORE });
  return home;
}
const setRelease = (home: string, tag: string): void => writeFileSync(join(home, '.ccrc', 'build.json'),
  JSON.stringify({ sha: 'fixture', ref: 'main', builtAt: '2026-11-17T00:00:00Z', dirty: false, version: tag }));
const freshOut = (name = 'out'): string => join(mkTmp('ccrc-qs-out-'), name);
const json = (p: string): R => JSON.parse(readFileSync(p, 'utf8')) as R;
const shaOfFile = (p: string): string => L.sha256Hex(readFileSync(p)) as string;
const runs = (home: string): R[] => (existsSync(join(home, STUB_LOG)) ? readFileSync(join(home, STUB_LOG), 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as R) : []);
/** The arm runs of the frozen questions (their stdin is a question payload), as against step 0b's probe runs. */
const questionRuns = (home: string): R[] => runs(home).filter((r) => typeof r.stdin === 'string' && r.stdin.startsWith(`${CARD}\n\nfixture payload `));

type Ref = { store_id: string; ccrc_id: string; generation: string };
const FAM_A: Ref = { store_id: STORE, ccrc_id: 'quiz-a', generation: gen(410) };
const FAM_B: Ref = { store_id: STORE, ccrc_id: 'quiz-b', generation: gen(420) };
/** One frozen entry on `f` (W2-D73's eleven fields, its qid by the driver's qidOf): a sha fact of 7 hex digits. */
function entry(f: Ref, n: number): R {
  const fact = (0xbd40000 + n).toString(16);
  const e = { ...f, boundary_uuid: gen(8400 + n), kind: 'sha', fact, fact_raw: fact, question: `Which commit did fixture step ${n} record?`,
    source_entry_uuid: gen(9400 + n), repo_roots: ['/home/u/tree'] };
  return { ...e, qid: D.qidOf(e) as string };
}
/** headless-on as the operator writes it from `marker`: lib's formatHeadlessList. */
function marker(home: string, refs: Ref[]): void {
  const p = L.historyPaths(home).headlessOn as string;
  mkdirSync(join(p, '..'), { recursive: true, mode: 0o700 });
  writeFileSync(p, L.formatHeadlessList({ storeId: STORE, pairs: refs.map((r) => ({ ccrcId: r.ccrc_id, generation: r.generation })) }) as string, { mode: 0o600 });
}
type Saved = { path: string; sha: string };
function saveFrozen(entries: R[]): Saved & { entries: R[] } {
  const text = D.frozenListText('quiz', { writer_model: OPUS, labeller: { ...G.LABELLER, sha_min_prefix: 7 } }, entries) as string;
  const p = join(mkTmp('ccrc-qs-in-'), 'frozen.json');
  writeFileSync(p, text, { mode: 0o600 });
  return { path: p, sha: L.sha256Hex(text) as string, entries: (JSON.parse(text) as R).entries as R[] };
}
const inp = (name: string, s: Saved): string[] => [`--${name}`, s.path, `--${name}-sha256`, s.sha];

type Result = { code: unknown; stdout: string; stderr: string; refusal: { word: string; detail: string } | null };
/** One subcommand in-process, as main runs it (the grammar, then the handler with `deps`): stdout and stderr captured, a
 *  refusal answered as {word, detail}; any other throw is the case's failure. */
async function run(home: string, argv: string[], deps?: R): Promise<Result> {
  const err: string[] = [];
  const out: string[] = [];
  const e1 = vi.spyOn(process.stderr, 'write').mockImplementation(((s: string | Uint8Array) => { err.push(String(s)); return true; }) as typeof process.stderr.write);
  const o1 = vi.spyOn(process.stdout, 'write').mockImplementation(((s: string | Uint8Array) => { out.push(String(s)); return true; }) as typeof process.stdout.write);
  try {
    const { sub, flags } = D.parseArgs(argv, { specs: QS.FLAG_SPECS, subs: QS.SUBCOMMANDS }) as { sub: string; flags: R };
    const code = await QS.HANDLERS[sub](flags, { HOME: home, TMUX_PANE: undefined, LANG }, deps);
    return { code, stdout: out.join(''), stderr: err.join(''), refusal: null };
  } catch (e) {
    if (e instanceof D.DriverRefusal || e instanceof QS.QuizSingleRefusal) return { code: null, stdout: out.join(''), stderr: err.join(''), refusal: { word: (e as R).word, detail: (e as R).detail } };
    throw e;
  } finally {
    e1.mockRestore();
    o1.mockRestore();
  }
}
const shaLine = (r: Result): string => /sha256 ([0-9a-f]{64})\n$/.exec(r.stderr)?.[1] ?? `no sha line in ${JSON.stringify(r.stderr)}`;

/** `setup` on `home`, its seed fixed: the setup file under a fresh --out, and its sha. */
async function setup(home: string, extra: string[] = [], mode = 'restricted'): Promise<Saved & { out: string; value: R }> {
  const out = freshOut('setup');
  const r = await run(home, ['setup', '--out', out, '--account', 'up-a', '--budget', '5000000', '--settings-mode', mode,
    '--writer-model', OPUS, '--judge-model', OPUS, '--arm-model', ARM_MODEL, ...extra], { seed: () => SEED });
  if (r.code !== 0) throw new Error(`fixture: setup failed: ${JSON.stringify(r)}`);
  const p = join(out, 'setup.json');
  return { path: p, sha: shaOfFile(p), out, value: json(p) };
}

/** A fixture week: a node, its setup, four questions over two listed families (q[0] answers correctly, q[1] wrongly, q[2]
 *  gives no ANSWER line, q[3] fails to run twice), step 0b's passing streams, and the arms' argv. */
async function week(o: { budget?: string; mode?: string } = {}) {
  const home = node();
  const s = await setup(home, o.budget === undefined ? [] : [], o.mode ?? 'restricted');
  if (o.budget !== undefined) {
    const v = { ...s.value, budget: Number(o.budget) };
    writeFileSync(s.path, `${L.canonicalJson(v) as string}\n`, { mode: 0o600 });
    s.sha = shaOfFile(s.path);
    s.value = v;
  }
  const made = [entry(FAM_A, 1), entry(FAM_A, 2), entry(FAM_B, 3), entry(FAM_B, 4)];
  const fz = saveFrozen(made);
  const q = fz.entries;
  marker(home, [FAM_A, FAM_B]);
  const mode = s.value.settings_mode as string;
  plantStep0b(home, mode);
  const byFact = (e: R): string => e.fact as string;
  put(home, mode, payloadOf(q[0]!.qid), '.jsonl', stream({ text: `It was that one.\nANSWER: ${byFact(q[0]!)}` }));
  put(home, mode, payloadOf(q[1]!.qid), '.jsonl', stream({ text: 'ANSWER: 0000000' }));
  put(home, mode, payloadOf(q[2]!.qid), '.jsonl', stream({ text: 'I cannot tell.' }));
  put(home, mode, payloadOf(q[3]!.qid), '.jsonl', stream({ result: false }));
  put(home, mode, payloadOf(q[3]!.qid), '.exit', '1');
  const out = freshOut('week');
  return { home, s, fz, q, out, mode, argv: (extra: string[] = []): string[] => ['arms', '--out', out, ...inp('setup', s), ...inp('frozen', fz), ...extra] };
}

/** The week's setup rewritten with `patch` (a new sha, which w.argv() then names). */
function reSetup(w: { s: Saved & { value: R } }, patch: R): void {
  const v = { ...w.s.value, ...patch };
  writeFileSync(w.s.path, `${L.canonicalJson(v) as string}\n`, { mode: 0o600 });
  w.s.sha = shaOfFile(w.s.path);
  w.s.value = v;
}
/** Every file under `dir` with its bytes' sha, and every directory: a snapshot to compare before and after. */
function tree(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? [`${d.name}/`, ...tree(join(dir, d.name)).map((x) => `${d.name}/${x}`)]
    : [`${d.name} ${shaOfFile(join(dir, d.name))}`])).sort();
}

// ── Task 3: the module's first acts, setup, source, freeze and marker ───────────────────────────────────────────────
describe('Task 3: the module refuses inside a pane and inside a session before it reads anything', () => {
  const child = (env: Record<string, string>, args: string[]): ReturnType<typeof spawnSync> => {
    const home = mkTmp('ccrc-qs-refuse-');
    return spawnSync(process.execPath, ['--no-warnings', SCRIPT, ...args], { cwd: home, encoding: 'utf8', timeout: 60_000,
      env: { ...scrubbedEnv(process.env), HOME: home, ...env } });
  };
  it('TMUX_PANE refuses in-pane and CLAUDECODE refuses in-session, exit 2, with no --out made and no input read', () => {
    const out = freshOut();
    const args = ['setup', '--out', out, '--account', 'up-a', '--budget', '10', '--settings-mode', 'restricted', '--writer-model', OPUS,
      '--judge-model', OPUS, '--arm-model', ARM_MODEL];
    const pane = child({ TMUX_PANE: '%1' }, args);
    expect([pane.status, pane.stdout]).toEqual([2, '']);
    expect(pane.stderr).toMatch(/^ccrc history-quiz-single: in-pane: /);
    const sess = child({ CLAUDECODE: '1' }, args);
    expect([sess.status, sess.stdout]).toEqual([2, '']);
    expect(sess.stderr).toMatch(/^ccrc history-quiz-single: in-session: /);
    const empty = child({ CLAUDECODE: '' }, ['report', '--out', out, '--setup', '/nonexistent/setup.json', '--setup-sha256', '0'.repeat(64)]);
    expect([empty.status, String(empty.stderr).split(':')[1]], 'an empty CLAUDECODE is set too').toEqual([2, ' in-session']);
    expect(existsSync(out), 'nothing was made').toBe(false);
    const bare = child({}, []);
    expect([bare.status, bare.stderr], 'CONTROL: outside both, the grammar answers').toEqual([2, 'ccrc history-quiz-single: args-invalid: no subcommand\n']);
  });

  it('its words: the driver\'s, plus its own, and only those (run 3538 adds account-moved)', () => {
    expect([...QS.QUIZ_SINGLE_REASONS]).toEqual(['in-session', 'release-moved', 'repilot-release-moved', 'account-moved']);
    for (const w of QS.QUIZ_SINGLE_REASONS as string[]) expect(D.DRIVER_REASONS, w).not.toContain(w);
    expect(() => new QS.QuizSingleRefusal('in-pane', 'x')).toThrow(TypeError);
  });
});

describe('Task 3: setup', () => {
  it('refuses without --settings-mode (no default) and with a mode outside SETTINGS_MODES, before --out', async () => {
    const home = node();
    const out = freshOut();
    const base = ['setup', '--out', out, '--account', 'up-a', '--budget', '10', '--writer-model', OPUS, '--judge-model', OPUS, '--arm-model', ARM_MODEL];
    expect((await run(home, base)).refusal).toEqual({ word: 'args-invalid', detail: 'settings-mode-required' });
    expect((await run(home, [...base, '--settings-mode', 'loose'])).refusal?.word).toBe('args-invalid');
    expect(existsSync(out)).toBe(false);
  });

  it('refuses a judge or writer model that is not an exact Opus id and a Fable arm model, before --out', async () => {
    const home = node();
    const out = freshOut();
    const argv = (w: string, j: string, a: string): string[] => ['setup', '--out', out, '--account', 'up-a', '--budget', '10', '--settings-mode', 'restricted',
      '--writer-model', w, '--judge-model', j, '--arm-model', a];
    expect((await run(home, argv(OPUS, 'claude-sonnet-9-1', ARM_MODEL))).refusal).toMatchObject({ word: 'args-invalid', detail: expect.stringMatching(/^judge-model /) });
    expect((await run(home, argv('claude-sonnet-9-1', OPUS, ARM_MODEL))).refusal).toMatchObject({ word: 'args-invalid', detail: expect.stringMatching(/^writer-model /) });
    expect((await run(home, argv(OPUS, OPUS, 'claude-fable-9-1'))).refusal).toMatchObject({ word: 'args-invalid', detail: expect.stringMatching(/^arm-model .* is forbidden for an arm$/) });
    expect(existsSync(out)).toBe(false);
  });

  it('writes setup.json: its own kind, the fields sourcing and the batches read, the drawn seed, and what it measured, for information only', async () => {
    const home = node();
    const s = await setup(home, ['--target', '40']);
    const v = s.value;
    expect(v.kind).toBe('ccrc-history-quiz-single-setup');
    expect(Object.keys(v).sort()).toEqual(['account', 'arm_model', 'budget', 'judge_model', 'kind', 'labeller', 'limits', 'measured', 'quiz', 'rubric_id',
      'seed', 'settings_mode', 'v', 'writer_model']);
    expect(v).toMatchObject({ account: 'up-a', budget: 5_000_000, settings_mode: 'restricted', seed: SEED, rubric_id: 'v1',
      quiz: { target: 40, caps: { family: 5, boundary: 3, kind_per_family: 2 }, writer_input: 'excerpt' }, limits: D.LIMITS_DEFAULTS });
    expect(v.labeller.sha_min_prefix).toBe(7);
    expect(v.measured.release).toEqual({ state: 'value', tag: STAMP });
    expect(v.measured.claude_code).toEqual({ state: 'value', version: '2.9.1 (Claude Code)' });
    expect(readFileSync(join(s.out, '.ccrc-history-quiz-single'), 'utf8')).toBe('ccrc-history-quiz-single-out\n');
    expect(existsSync(join(s.out, D.OUT_MARKER as string)), 'beside the driver\'s own marker').toBe(true);
    expect(statSync(s.out).mode & 0o777).toBe(0o700);
  });
});

describe('Task 3: source, freeze and marker', () => {
  it('source walks every admitted family through sourceQuiz (no exclusion), and freeze gives a frozen list loadFrozenList reads by its sha', async () => {
    const home = node();
    const s = await setup(home);
    const made = [entry(FAM_A, 7), entry(FAM_B, 8), entry(FAM_A, 9)];
    const seen: R[] = [];
    const sourceQuiz = async (o: R): Promise<R> => {
      seen.push({ mode: o.mode, seedHex: o.seedHex, exclude: o.exclude, plan: o.plan, shaMinPrefix: o.shaMinPrefix, store: o.rs.storeId });
      return { entries: made.map((e, i) => ({ ...e, rank: ['k', i] })), fidelity: [], counts: { writer: { questions: 3, failed_runs: 0 } }, asof_same_ms_hits: {} };
    };
    const src = await run(home, ['source', '--out', s.out, ...inp('setup', s)], { sourceQuiz });
    expect(src.refusal).toBeNull();
    expect(seen).toEqual([{ mode: 'quiz', seedHex: SEED, exclude: { pilotFamilies: [], assignment: [] }, plan: { target: 100, caps: s.value.quiz.caps },
      shaMinPrefix: 7, store: STORE }]);
    const sourcedPath = join(s.out, 'quiz', 'sourced.json');
    expect(shaLine(src)).toBe(shaOfFile(sourcedPath));
    expect(json(sourcedPath)).toMatchObject({ kind: D.SOURCED_KIND, record_sha256: s.sha, store_id: STORE });
    const fr = await run(home, ['freeze', '--out', s.out, ...inp('setup', s), '--sourced', sourcedPath, '--sourced-sha256', shaLine(src)]);
    expect(fr.refusal).toBeNull();
    const frozenPath = join(s.out, 'quiz', 'frozen.json');
    const doc = D.loadFrozenList(frozenPath, shaLine(fr), 'quiz') as R;
    expect(doc.entries.map((e: R) => e.qid).sort()).toEqual(made.map((e) => e.qid).sort());
    expect(json(join(s.out, D.QUIZ_META_FILE as string))).toMatchObject({ record_sha256: s.sha, n_questions: 3, n_families: 2 });
  });

  it('freeze refuses a sourced list another setup wrote', async () => {
    const home = node();
    const s = await setup(home);
    const p = join(mkTmp('ccrc-qs-in-'), 'sourced.json');
    const text = `${L.canonicalJson({ kind: D.SOURCED_KIND, v: 1, record_sha256: 'f'.repeat(64), store_id: STORE, assignment_sha256: 'a'.repeat(64), inputs: [], entries: [], counts: {}, asof_same_ms_hits: {}, spend: 0 }) as string}\n`;
    writeFileSync(p, text);
    expect((await run(home, ['freeze', '--out', s.out, ...inp('setup', s), '--sourced', p, '--sourced-sha256', L.sha256Hex(text)])).refusal)
      .toMatchObject({ word: 'input-invalid', detail: expect.stringMatching(/^sourced names f{64}, not this setup/) });
  });

  it('marker prints the headless-on text the frozen families need, its sha on stderr, and writes nothing', async () => {
    const home = node();
    const fz = saveFrozen([entry(FAM_A, 1), entry(FAM_B, 2)]);
    const r = await run(home, ['marker', ...inp('frozen', fz)]);
    const want = L.formatHeadlessList({ storeId: STORE, pairs: [FAM_A, FAM_B].map((f) => ({ ccrcId: f.ccrc_id, generation: f.generation })) }) as string;
    expect(r.stdout).toBe(want);
    expect(shaLine(r)).toBe(L.sha256Hex(want));
    expect(existsSync(L.historyPaths(home).headlessOn as string), 'the marker is the operator\'s to write').toBe(false);
  });

  it('the module spells no node:sqlite load, imports the driver and the gate, and is no gate code file', () => {
    const text = readFileSync(SCRIPT, 'utf8');
    expect(text.split('\n').filter((l) => /(['"`])node:sqlite\1/.test(l))).toEqual([]);
    expect(text).toContain("from './history-replay.mjs'");
    expect(text).toContain("from './history-gate.mjs'");
    expect(G.GATE_CODE_FILES).not.toContain('deploy/history-quiz-single.mjs');
  });
});

// ── Task 4: step 0b's probes, one arm, its judge, and the stop ──────────────────────────────────────────────────────
describe('Task 4: arms runs step 0b\'s probes first, then the treatment arm alone', () => {
  it('a failing probe (the skill missing from every init) refuses pilot-failed before any arm spawns, and the result is written', async () => {
    const w = await week();
    const noSkill = stream({ skills: [], session: 'fixture-qs-noskill', calls: [{ command: 'x' }] });
    plantStep0b(w.home, w.mode, Object.fromEntries((D.STEP0B_PROBES as string[]).map((p) => [p, noSkill])));
    const r = await run(w.home, w.argv(), FAKE);
    expect(r.refusal?.word).toBe('pilot-failed');
    expect(r.refusal?.detail).toMatch(/failed .*skill/);
    expect(questionRuns(w.home), 'no question was spawned').toEqual([]);
    const res = json(join(w.out, 'quiz', 'step0b', `${w.mode}.json`));
    expect(res).toMatchObject({ kind: 'ccrc-history-quiz-single-step0b', setup_sha256: w.s.sha, passed: false });
    expect(existsSync(join(w.out, 'quiz', 'arms-summary.json'))).toBe(false);
  });

  it('a failing deny probe refuses the same way', async () => {
    const w = await week();
    const p = (D.step0bProbesOf(w.home, D.STEP0B_SYNTHETIC_TRANSCRIPT) as R[]).find((x) => x.probe === 'deny-rg')!;
    plantStep0b(w.home, w.mode, { 'deny-rg': stream({ session: 'fixture-qs-deny-rg', calls: [{ command: p.command }] }) });
    const r = await run(w.home, w.argv(), FAKE);
    expect(r.refusal).toMatchObject({ word: 'pilot-failed', detail: expect.stringMatching(/failed .*deny-rg/) });
    expect(questionRuns(w.home)).toEqual([]);
  });

  it('only the treatment arm spawns, at most ARM_ATTEMPTS_MAX times a question, and the summary counts the one arm', async () => {
    const w = await week();
    writeFileSync(join(w.home, STUB_VERSION), '2.9.2 (Claude Code)\n');   // F5: moved since setup, and still runs
    const r = await run(w.home, w.argv(), FAKE);
    expect(r.refusal).toBeNull();
    const qr = questionRuns(w.home);
    expect(new Set(qr.map((x) => x.arm))).toEqual(new Set([TREATMENT]));
    expect(qr.some((x) => x.arm === CONTROL)).toBe(false);
    const per = (qid: string): number => qr.filter((x) => x.stdin === payloadOf(qid)).length;
    expect(w.q.map((e) => per(e.qid as string))).toEqual([1, 1, 1, D.ARM_ATTEMPTS_MAX]);
    const sum = json(join(w.out, 'quiz', 'arms-summary.json'));
    expect(shaLine(r)).toBe(shaOfFile(join(w.out, 'quiz', 'arms-summary.json')));
    expect(sum).toMatchObject({ kind: 'ccrc-history-quiz-single-arms-summary', setup_sha256: w.s.sha, frozen_sha256: w.fz.sha, arm: TREATMENT,
      settings_mode: 'restricted', stop: null, ccrc_release: STAMP, claude_code_versions: ['2.9.2 (Claude Code)'], steer_armed: 'no', agents_on_armed: 'no',
      counts: { questions: 4, answered: 3, run_failed: 1, rerun_owed: 0, not_run: 0 }, answers: { value: 2, unknown: 0, absent: 1, correct: 1 } });
    expect(sum.answers.value + sum.answers.absent + sum.answers.unknown, 'the answered questions').toBe(3);
    expect(sum.finished_ms).toBeGreaterThanOrEqual(sum.started_ms);
    expect(readdirSync(join(w.out, 'quiz', 'answers')).sort()).toEqual(w.q.map((e) => `${e.qid as string}.${TREATMENT}.json`).sort());
  });

  it('a family not listed in headless-on refuses family-unlisted before --out', async () => {
    const w = await week();
    marker(w.home, [FAM_A]);
    const r = await run(w.home, w.argv(), FAKE);
    expect(r.refusal?.word).toBe('family-unlisted');
    expect(existsSync(w.out)).toBe(false);
  });

  it('the run stops at the budget, with the stop in the summary, and nothing is retried', async () => {
    const w = await week({ budget: '600' });
    const r = await run(w.home, w.argv(), FAKE);
    expect(r.refusal?.word).toBe('budget-exhausted');
    expect(json(join(w.out, 'quiz', 'arms-summary.json')).stop).toMatchObject({ word: 'budget-exhausted', kind: 'stop' });
    expect(r.stderr).toMatch(/arms stop budget-exhausted: \d+ question\(s\) not run/);
  });

  it('a resumed arms on another release refuses release-moved: one week runs on one release', async () => {
    const w = await week({ budget: '600' });
    await run(w.home, w.argv(), FAKE);
    setRelease(w.home, 'v9.9.9');
    const again = await run(w.home, w.argv(), FAKE);
    expect(again.refusal).toMatchObject({ word: 'release-moved' });
  });

  it('judge writes its own kind over the one arm: the non-correct answered questions, the run-failed one excluded', async () => {
    const w = await week();
    await run(w.home, w.argv(), FAKE);
    const sumPath = join(w.out, 'quiz', 'arms-summary.json');
    const r = await run(w.home, ['judge', '--out', w.out, ...inp('setup', w.s), ...inp('frozen', w.fz), '--arms-summary', sumPath, '--arms-summary-sha256', shaOfFile(sumPath)], FAKE);
    expect(r.refusal).toBeNull();
    const j = json(join(w.out, 'quiz', 'judged.json'));
    expect(shaLine(r)).toBe(shaOfFile(join(w.out, 'quiz', 'judged.json')));
    expect(j).toMatchObject({ kind: 'ccrc-history-quiz-single-judged', arm: TREATMENT, judge_model: OPUS, ccrc_release: STAMP,
      counts: { excluded_correct: 1, excluded_run_failed_questions: 1 } });
    expect(j.items).toHaveLength(2);
    const map = json(join(w.out, 'quiz', 'judge.map.json'));
    expect(new Set((map.items as R[]).map((m) => m.arm))).toEqual(new Set([TREATMENT]));
  });

  it('nothing is written under HOME but the stub\'s own log and controls', async () => {
    const w = await week();
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));
    const before = new Set(walk(w.home));
    await run(w.home, w.argv(), FAKE);
    const sumPath = join(w.out, 'quiz', 'arms-summary.json');
    await run(w.home, ['judge', '--out', w.out, ...inp('setup', w.s), ...inp('frozen', w.fz), '--arms-summary', sumPath, '--arms-summary-sha256', shaOfFile(sumPath)], FAKE);
    const added = walk(w.home).filter((p) => !before.has(p)).map((p) => p.slice(w.home.length + 1));
    // SQLite's own -shm and -wal beside the WAL store: a read-only open (openReplayStore's openReader) makes them, as any reader does.
    const sidecar = (p: string): boolean => /^\.ccrc\/history\/db\/history\.db-(shm|wal)$/.test(p);
    expect(added.filter((p) => p !== STUB_LOG && !p.startsWith(`${STUB_DIR}/`) && !sidecar(p))).toEqual([]);
  });
});

/** The stop (waiver condition 3): the module in a child process, as the operator runs it, its store reads stood in through
 *  main's deps by a wrapper this case writes. Every question's arm run sleeps, and the signal is sent only once both of
 *  the batch's lanes (its concurrency, 2) hold a live run, each already logged (a stub writes its pid file after its log
 *  line). So no run is in flight when the signal lands: a lane spawns again only after its run closes, past the driver's
 *  yield and stop check, and every log line past the count is a run spawned after the signal (fix round 3: with one
 *  sleeper, the other lane went on spawning its questions, and a run it started before the signal but logged after the
 *  count was counted as one after it). */
async function stopRun(): Promise<{ status: number | null; signal: string | null; stderr: string; childAlive: boolean; spawnedAfter: number; summary: boolean }> {
  const w = await week();
  for (const e of w.q) put(w.home, w.mode, payloadOf(e.qid as string), '.sleep', '20000');
  const wrapper = join(mkTmp('ccrc-qs-wrap-'), 'run.mjs');
  writeFileSync(wrapper, `const m = await import(${JSON.stringify(pathToFileURL(SCRIPT).href)});
const deps = {
  recheck: async (_rs, es) => new Map(es.map((e) => [e.qid, { ok: true, boundaryEntryId: 0, cut: { qid: e.qid } }])),
  payloads: (_rs, _id, _q, cut) => ({ state: 'payloads', plain: 'fixture payload ' + cut.qid + '\\n', carded: ${JSON.stringify(`${CARD}\n\nfixture payload `)} + cut.qid + '\\n', card: { state: 'card', line: ${JSON.stringify(CARD)} } }),
};
process.exitCode = await m.main(process.argv.slice(2), { HOME: process.env.HOME, TMUX_PANE: process.env.TMUX_PANE, LANG: process.env.LANG, CLAUDECODE: process.env.CLAUDECODE }, deps);
`);
  try {
    const env = { ...scrubbedEnv(process.env), HOME: w.home } as NodeJS.ProcessEnv;
    const child = spawn(process.execPath, ['--no-warnings', wrapper, ...w.argv()], { cwd: w.home, env, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (b: Buffer) => { stderr += b.toString('utf8'); });
    const pidFiles = w.q.map((e) => join(w.home, STUB_DIR, `${keyOf(w.mode, payloadOf(e.qid as string))}.pid`));
    const started = (): string[] => pidFiles.filter((f) => existsSync(f));
    const deadline = Date.now() + 30_000;
    while (started().length < 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    if (started().length !== 2) { child.kill('SIGKILL'); throw new Error(`fixture: both lanes' sleeping arm runs never started: ${stderr}`); }
    const stubPids = started().map((f) => Number(readFileSync(f, 'utf8')));
    const before = runs(w.home).length;
    child.kill('SIGINT');
    const done = await new Promise<{ status: number | null; signal: string | null }>((resolve) => child.on('close', (status, signal) => resolve({ status, signal })));
    const spawnedAfter = runs(w.home).length - before;
    const live = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
    const alive = (): boolean => stubPids.some(live);
    const until = Date.now() + 8_000;
    while (alive() && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
    const childAlive = alive();
    // Any sleeper still running, the two counted and any a broken stop let start, is killed by its group.
    for (const f of started()) { try { process.kill(-Number(readFileSync(f, 'utf8')), 'SIGKILL'); } catch { /* gone */ } }
    return { ...done, stderr, childAlive, spawnedAfter, summary: existsSync(join(w.out, 'quiz', 'arms-summary.json')) };
  } finally {
    // the wrapper and the week's directories go with the case's mkTmp fixtures
  }
}

describe('Task 4: the stop (waiver condition 3)', () => {
  it('a SIGINT while both lanes\' arm runs are live signals their groups; nothing further is spawned or written, and it refuses interrupted', async () => {
    const r = await stopRun();
    expect(r.spawnedAfter, 'no run after the signal').toBe(0);
    expect([r.status, r.signal]).toEqual([2, null]);
    expect(r.stderr).toMatch(/ccrc history-quiz-single: interrupted: SIGINT received/);
    expect(r.childAlive, 'both live arm runs were stopped').toBe(false);
    expect(r.summary, 'no summary after interrupted').toBe(false);
  }, 60_000);
});

describe('Task 4: the judge masks under two readings and refuses when they disagree (re-spelled; K26)', () => {
  it('two readings that mask a reply alike agree; a pair learned between them refuses masking-snapshots-disagree judge, never the newer mask', () => {
    const secret = ['zq', 'qs', 'secret', 'value01'].join('');
    const e = entry(FAM_A, 1);
    const items = [{ qid: e.qid, arm: TREATMENT, entry: e, reply: `ANSWER: 0000000 and ${secret}` }];
    const map = D.judgeMapOf(SEED, [e], [TREATMENT]) as R[];
    const none = L.makePairIndex([]);
    const learned = L.makePairIndex([{ len: secret.length, sha256: L.sha256Hex(secret) }]);
    expect(L.redactField(secret, learned), 'fixture: the learned pair masks the value').not.toContain(secret);
    expect(QS.judgeJobsAgreed({ items, map, idx: none, freshIdx: L.makePairIndex([]) }), 'CONTROL: alike').toHaveLength(1);
    expect(() => QS.judgeJobsAgreed({ items, map, idx: none, freshIdx: learned })).toThrow(/input-invalid: masking-snapshots-disagree judge/);
  });
});

// ── Task 5: the single-arm report ───────────────────────────────────────────────────────────────────────────────────
async function reportFixture() {
  const w = await week();
  expect((await run(w.home, w.argv(), FAKE)).refusal).toBeNull();
  const sumPath = join(w.out, 'quiz', 'arms-summary.json');
  const sum = { path: sumPath, sha: shaOfFile(sumPath) };
  expect((await run(w.home, ['judge', '--out', w.out, ...inp('setup', w.s), ...inp('frozen', w.fz), ...inp('arms-summary', sum)], FAKE)).refusal).toBeNull();
  const jPath = join(w.out, 'quiz', 'judged.json');
  const judged = { path: jPath, sha: shaOfFile(jPath) };
  return { ...w, sum, judged, reportArgv: (j: Saved = judged): string[] => ['report', '--out', w.out, ...inp('setup', w.s), ...inp('frozen', w.fz), ...inp('arms-summary', sum), ...inp('judged', j)] };
}

describe('Task 5: the single-arm report, with no comparison figure', () => {
  it('carries exactly §4\'s fields, as canonical JSON and one newline, its sha on stderr over those bytes', async () => {
    const f = await reportFixture();
    const r = await run(f.home, f.reportArgv());
    expect(r.refusal).toBeNull();
    const p = join(f.out, 'single-report.json');
    const text = readFileSync(p, 'utf8');
    const rep = JSON.parse(text) as R;
    expect(text).toBe(`${L.canonicalJson(rep) as string}\n`);
    expect(shaLine(r)).toBe(L.sha256Hex(text));
    expect(Object.keys(rep).sort()).toEqual([...QS.REPORT_FIELDS].sort());
    const sum = json(f.sum.path);
    expect(rep).toMatchObject({ kind: 'ccrc-history-quiz-single-report', v: 1, arm: TREATMENT, pilot: 'skipped-by-ruling', settings_mode: 'restricted',
      frozen_sha256: f.fz.sha, n_questions: 4, n_families: 2, measured_ms: sum.finished_ms, judge_model: OPUS, ccrc_release: STAMP,
      steer_armed: 'no', agents_on_armed: 'no',
      inputs: { setup_sha256: f.s.sha, frozen_sha256: f.fz.sha, arms_summary_sha256: f.sum.sha, judged_sha256: f.judged.sha } });
    expect(rep.counts).toEqual({ questions: 4, answered: 2, correct: 1, run_failed: 1, absent: 1 });
    expect(rep.counts.questions).toBe(rep.counts.answered + rep.counts.run_failed + rep.counts.absent);
    expect(rep.share).toEqual({ num: 1, den: 2 });
    const famA = G.familyKey(FAM_A.store_id, FAM_A.ccrc_id, FAM_A.generation);
    const famB = G.familyKey(FAM_B.store_id, FAM_B.ccrc_id, FAM_B.generation);
    const clusters = new Map<string, R>([[famA, { num: 0, den: 0 }], [famB, { num: 0, den: 0 }]]);
    const answered = { [f.q[0]!.qid]: true, [f.q[1]!.qid]: false } as Record<string, boolean>;
    for (const e of f.q) if (e.qid in answered) { const c = clusters.get(G.familyKey(e.store_id, e.ccrc_id, e.generation))!; c.den += 1; if (answered[e.qid]) c.num += 1; }
    const ci = G.clusterBootstrap({ clusters: [...clusters.values()], rng: QS.intervalStreamOf(SEED), mode: 'share' }) as R;
    expect(rep.interval).toEqual({ lower: { ...ci.lower }, upper: { ...ci.upper }, ci: 95, method: 'percentile', B: 10000 });
    expect(rep.claude_code_versions).toEqual(['2.9.1 (Claude Code)']);
  });

  it('no forbidden key at any depth and no PASS in the text; the guard throws on each planted key and on PASS', async () => {
    const f = await reportFixture();
    await run(f.home, f.reportArgv());
    const text = readFileSync(join(f.out, 'single-report.json'), 'utf8');
    const keys: string[] = [];
    const walk = (v: unknown): void => { if (Array.isArray(v)) v.forEach(walk); else if (v !== null && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.push(k); walk(x); } };
    walk(JSON.parse(text));
    for (const k of ['verdict', 'gate', 'criteria', 'lift', 'delta', 'pass']) expect(keys, k).not.toContain(k);
    expect(text).not.toContain('PASS');
    const rep = JSON.parse(text) as R;
    expect(() => QS.assertNoComparison(rep), 'CONTROL: the report itself passes').not.toThrow();
    for (const k of QS.REPORT_FORBIDDEN_KEYS as string[]) {
      expect(() => QS.assertNoComparison({ ...rep, [k]: 0 }), k).toThrow(TypeError);
      expect(() => QS.assertNoComparison({ ...rep, counts: { ...rep.counts, [k.toUpperCase()]: 0 } }), `nested ${k}`).toThrow(TypeError);
    }
    expect(() => QS.assertNoComparison({ ...rep, inputs: [{ lift: 1 }] }), 'inside a list').toThrow(TypeError);
    expect(() => QS.assertNoComparison({ ...rep, judge_model: 'PASS' })).toThrow(TypeError);
  });

  it('mixed releases refuse release-moved: the arms on one release, the judge on another', async () => {
    const f = await reportFixture();
    const j = json(f.judged.path);
    const p = join(mkTmp('ccrc-qs-in-'), 'judged.json');
    writeFileSync(p, `${L.canonicalJson({ ...j, ccrc_release: 'v9.9.9' }) as string}\n`);
    const r = await run(f.home, f.reportArgv({ path: p, sha: shaOfFile(p) }));
    expect(r.refusal).toMatchObject({ word: 'release-moved', detail: `the arms ran on ${STAMP}, the judge on v9.9.9` });
  });

  it('a report whose answered count is zero refuses: no share without a denominator', () => {
    const e = entry(FAM_A, 1);
    const answers = new Map([[e.qid as string, { question_state: 'run-failed' }]]);
    expect(() => QS.singleReportOf({ setup: { seed: SEED, settings_mode: 'restricted', judge_model: OPUS }, setupSha256: 'a'.repeat(64), frozen: { entries: [e] },
      frozenSha256: 'b'.repeat(64), summary: { finished_ms: 1, ccrc_release: STAMP, claude_code_versions: [], steer_armed: 'no', agents_on_armed: 'no' },
      summarySha256: 'c'.repeat(64), judged: { claude_code_version: 'x' }, judgedSha256: 'd'.repeat(64), answers })).toThrow(/no question was answered/);
  });

  it('the armed words: steer yes, no, partial and unmeasured, agents-on yes, no and unmeasured, a failed lstat never read as no', () => {
    expect(QS.steerWordOf({ off: 'absent', steerOff: 'absent', families: ['present', 'present'] })).toBe('yes');
    expect(QS.steerWordOf({ off: 'absent', steerOff: 'absent', families: ['present', 'absent'] })).toBe('partial');
    expect(QS.steerWordOf({ off: 'absent', steerOff: 'absent', families: ['absent', 'absent'] })).toBe('no');
    expect(QS.steerWordOf({ off: 'present', steerOff: 'absent', families: ['present'] }), 'history-off stops steering').toBe('no');
    expect(QS.steerWordOf({ off: 'absent', steerOff: 'present', families: ['present'] }), 'steer-off too').toBe('no');
    expect(QS.steerWordOf({ off: 'absent', steerOff: 'absent', families: ['present', 'unmeasured'] })).toBe('unmeasured');
    expect(QS.agentsWordOf({ state: 'absent' })).toBe('no');
    expect(QS.agentsWordOf({ state: 'unmeasured' })).toBe('unmeasured');
    expect(QS.agentsWordOf({ state: 'present', isFile: true, isSymbolicLink: false })).toBe('yes');
    expect(QS.agentsWordOf({ state: 'present', isFile: false, isSymbolicLink: true })).toBe('no');
    const home = mkTmp('ccrc-qs-armed-');
    expect(QS.armedWordsOf(home, ['quiz-a', 'quiz-b'])).toEqual({ steer: 'no', agents: 'no' });
    const steerDir = join(home, L.SWITCHES.steerOnDir as string);
    mkdirSync(steerDir, { recursive: true });
    writeFileSync(join(steerDir, 'quiz-a'), '');
    writeFileSync(join(home, L.SWITCHES.agentsOn as string), '');
    expect(QS.armedWordsOf(home, ['quiz-a', 'quiz-b'])).toEqual({ steer: 'partial', agents: 'yes' });
    writeFileSync(join(steerDir, 'quiz-b'), '');
    expect(QS.armedWordsOf(home, ['quiz-a', 'quiz-b']).steer).toBe('yes');
    if ((process.getuid?.() ?? 1) !== 0) {
      chmodSync(join(home, '.ccrc', 'history'), 0o000);
      try {
        expect(QS.armedWordsOf(home, ['quiz-a']), 'a failed lstat is unmeasured').toEqual({ steer: 'unmeasured', agents: 'unmeasured' });
      } finally {
        chmodSync(join(home, '.ccrc', 'history'), 0o700);
      }
    }
  });
});

// ── Fix round 1 (review 2409): the --out the module adopts, the week's budget, step 0b on a moved build, the summary ──
describe('fix round 1: a --out the module did not make is never adopted (F1), and a week never runs in the setup\'s (F6)', () => {
  it('arms, judge and report against a W2 run\'s --out (the driver\'s marker alone) each refuse out-refused and leave its bytes unchanged', async () => {
    const f = await reportFixture();
    const w2 = D.prepareOut(freshOut('w2')) as string;   // a W2 run's --out, as the driver makes it
    mkdirSync(join(w2, 'quiz'), { mode: 0o700 });
    writeFileSync(join(w2, 'quiz', 'w2-answer.json'), '{"kind":"fixture"}\n', { mode: 0o600 });
    writeFileSync(join(w2, 'spend.jsonl'), '', { mode: 0o600 });
    const before = tree(w2);
    const forms: Array<[string, string[]]> = [
      ['arms', ['arms', '--out', w2, ...inp('setup', f.s), ...inp('frozen', f.fz)]],
      ['judge', ['judge', '--out', w2, ...inp('setup', f.s), ...inp('frozen', f.fz), ...inp('arms-summary', f.sum)]],
      ['report', ['report', '--out', w2, ...inp('setup', f.s), ...inp('frozen', f.fz), ...inp('arms-summary', f.sum), ...inp('judged', f.judged)]],
    ];
    const spawned = runs(f.home).length;
    for (const [name, argv] of forms) {
      const r = await run(f.home, argv, FAKE);
      expect(r.refusal, name).toMatchObject({ word: 'out-refused', detail: expect.stringMatching(/^\.ccrc-history-quiz-single absent: /) });
      expect(tree(w2), `${name} wrote nothing into the W2 --out`).toEqual(before);
    }
    expect(runs(f.home).length, 'nothing was spawned').toBe(spawned);
    expect(existsSync(join(w2, '.ccrc-history-quiz-single'))).toBe(false);
  });

  it('a --out nested in a W2 run\'s --out, as spelled or through a symlink into it, is refused for arms, judge and report, before anything is made (F1-a)', async () => {
    const f = await reportFixture();
    const w2 = D.prepareOut(freshOut('w2')) as string;
    mkdirSync(join(w2, 'deep'), { mode: 0o700 });
    writeFileSync(join(w2, 'spend.jsonl'), '', { mode: 0o600 });
    const link = join(mkTmp('ccrc-qs-link-'), 'into-w2');
    symlinkSync(join(w2, 'deep'), link);
    const before = tree(w2);
    const spawned = runs(f.home).length;
    for (const [where, out] of [['nested', join(w2, 'week')], ['nested deeper', join(w2, 'deep', 'week')], ['through a symlink', join(link, 'week')]] as const) {
      const forms: Array<[string, string[]]> = [
        ['arms', ['arms', '--out', out, ...inp('setup', f.s), ...inp('frozen', f.fz)]],
        ['judge', ['judge', '--out', out, ...inp('setup', f.s), ...inp('frozen', f.fz), ...inp('arms-summary', f.sum)]],
        ['report', ['report', '--out', out, ...inp('setup', f.s), ...inp('frozen', f.fz), ...inp('arms-summary', f.sum), ...inp('judged', f.judged)]],
      ];
      for (const [name, argv] of forms) {
        const r = await run(f.home, argv, FAKE);
        expect(r.refusal, `${name}, ${where}`).toMatchObject({ word: 'out-refused', detail: expect.stringMatching(/^--out is inside .*, which holds the driver's marker \.ccrc-history-replay: /) });
        expect(tree(w2), `${name}, ${where}: nothing made in the W2 --out`).toEqual(before);
      }
    }
    expect(runs(f.home).length, 'nothing was spawned').toBe(spawned);
  });

  it('a week nested in the setup\'s --out is refused the same way (F1-a)', async () => {
    const w = await week();
    const before = tree(w.s.out);
    const r = await run(w.home, ['arms', '--out', join(w.s.out, 'week'), ...inp('setup', w.s), ...inp('frozen', w.fz)], FAKE);
    expect(r.refusal).toMatchObject({ word: 'out-refused', detail: expect.stringMatching(/^--out is inside /) });
    expect(tree(w.s.out)).toEqual(before);
    expect(runs(w.home)).toEqual([]);
  });

  it('arms refuses a --out holding this setup\'s setup.json, before its claim and any spawn', async () => {
    const w = await week();
    const before = tree(w.s.out);
    const r = await run(w.home, ['arms', '--out', w.s.out, ...inp('setup', w.s), ...inp('frozen', w.fz)], FAKE);
    expect(r.refusal).toMatchObject({ word: 'out-refused', detail: expect.stringMatching(/holds this setup's setup\.json/) });
    expect(tree(w.s.out)).toEqual(before);
    expect(runs(w.home)).toEqual([]);
  });
});

describe('fix round 1: --budget is the week\'s, the arms and the judge together (F3)', () => {
  it('the judge\'s cap is what the arms left of --budget, and a resumed judge stops at the same point', async () => {
    const w = await week();
    // Each judge run spends 65 and labels nothing, so every job owes a second attempt. The gate runs before every spawn,
    // and the batch's two jobs start at the judge's concurrency (2) before either has spent: both pass a cap of 1, and the
    // gate stops the first spawn of the second attempts' batch. That is the bound: two whole runs past the stop.
    writeFileSync(join(w.home, STUB_DIR, 'default.jsonl'), stream({ text: 'LABEL: fixture' }));
    const scratch = freshOut('measure');
    expect((await run(w.home, ['arms', '--out', scratch, ...inp('setup', w.s), ...inp('frozen', w.fz)], FAKE)).refusal).toBeNull();
    const armsSpend = D.spentSoFar(scratch) as number;
    expect(armsSpend, 'fixture: the arms spend something').toBeGreaterThan(0);
    reSetup(w, { budget: armsSpend + 1 });
    expect((await run(w.home, w.argv(), FAKE)).refusal).toBeNull();
    expect(D.spentSoFar(w.out), 'the arms spend the same on the week\'s ledger').toBe(armsSpend);
    const sumPath = join(w.out, 'quiz', 'arms-summary.json');
    const judgeArgv = ['judge', '--out', w.out, ...inp('setup', w.s), ...inp('frozen', w.fz), '--arms-summary', sumPath, '--arms-summary-sha256', shaOfFile(sumPath)];
    const at = runs(w.home).length;
    const first = await run(w.home, judgeArgv, FAKE);
    expect(first.refusal?.word).toBe('budget-exhausted');
    expect(runs(w.home).length - at, 'one batch of judge runs, then the week\'s budget is spent').toBe(2);
    const again = await run(w.home, judgeArgv, FAKE);
    expect(again.refusal?.word, 'a resumed judge gets no fresh budget').toBe('budget-exhausted');
    expect(runs(w.home).length - at, 'and stops at the same point').toBe(2);
    expect(existsSync(join(w.out, 'quiz', 'judged.json'))).toBe(false);
  });

  it('arms that spent the whole --budget leave the judge nothing: it refuses before any spawn', async () => {
    const w = await week();
    const scratch = freshOut('measure');
    expect((await run(w.home, ['arms', '--out', scratch, ...inp('setup', w.s), ...inp('frozen', w.fz)], FAKE)).refusal).toBeNull();
    const armsSpend = D.spentSoFar(scratch) as number;
    reSetup(w, { budget: armsSpend + 1 });
    expect((await run(w.home, w.argv(), FAKE)).refusal).toBeNull();
    // One more arms-side row (a repeated name, as the ledger allows) takes the arms' spend past the whole --budget.
    const ledger = join(w.out, 'spend.jsonl');
    const rows = readFileSync(ledger, 'utf8').split('\n').filter((l) => l !== '');
    const extra = rows.find((l) => !l.includes('/judge/') && (JSON.parse(l) as R).tokens > 0)!;
    writeFileSync(ledger, `${rows.join('\n')}\n${extra}\n`);
    const outside = D.spentSoFar(w.out) as number;
    expect(outside).toBeGreaterThan(armsSpend);
    const sumPath = join(w.out, 'quiz', 'arms-summary.json');
    const at = runs(w.home).length;
    const r = await run(w.home, ['judge', '--out', w.out, ...inp('setup', w.s), ...inp('frozen', w.fz), '--arms-summary', sumPath, '--arms-summary-sha256', shaOfFile(sumPath)], FAKE);
    expect(r.refusal).toEqual({ word: 'budget-exhausted', detail: `spent ${outside} of ${armsSpend + 1} before the judge: --budget is the week's, arms and judge together` });
    expect(runs(w.home).length).toBe(at);
  });
});

describe('fix rounds 1 and 2: a resumed arms probes step 0b again on a build it never probed, under that build\'s names (F4)', () => {
  const step0bRuns = (home: string): number => runs(home).length - questionRuns(home).length;
  const turnRuns = (home: string): number => runs(home).filter((r) => r.stdin === D.TURN_PROBE_PROMPT).length;
  const resultOf = (w: { out: string; mode: string }): R => json(join(w.out, 'quiz', 'step0b', `${w.mode}.json`));
  /** The account's limits row at `pct` (the gate stops at 70). */
  const limitsAt = (home: string, pct: number): void => {
    const nowS = Math.floor(Date.now() / 1000);
    writeFileSync(join(home, '.cc-limits', 'up-a.json'), JSON.stringify({ five: pct, seven: pct, ts: nowS - 60, fiveResetAt: nowS + 3600, sevenResetAt: nowS + 86400 }));
  };
  /** FAKE, with the limits row raised past the threshold from the recheck stand-in once `when` holds: the next spawn's gate
   *  stops the run there (limits-threshold), a real stop at a chosen point. Every step 0b card asks recheck of the one
   *  question it reads, and the arms' preflight of its whole pending batch, each before its spawns. */
  const tripWhen = (home: string, when: (es: R[]) => boolean): R => ({ ...FAKE,
    recheck: async (rs: unknown, es: R[]): Promise<Map<string, R>> => { if (when(es)) limitsAt(home, 90); return (FAKE.recheck as (a: unknown, b: R[]) => Promise<Map<string, R>>)(rs, es); } });
  const armsPreflight = (es: R[]): boolean => es.length > 1;
  /** A week whose first arms passes step 0b on 2.9.1, then stops before any question runs. */
  async function stoppedAfterStep0b() {
    const w = await week();
    const r = await run(w.home, w.argv(), tripWhen(w.home, armsPreflight));
    expect(r.refusal?.word, 'fixture: stopped after step 0b').toBe('limits-threshold');
    expect(questionRuns(w.home), 'fixture: no question ran').toEqual([]);
    expect(resultOf(w).passed).toBe(true);
    limitsAt(w.home, 10);
    return w;
  }
  const token = (v: string): string => QS.buildTokenOf(v) as string;

  it('every round\'s runs carry the build and the round: round 0 under the first build\'s token', async () => {
    const w = await week();
    expect((await run(w.home, w.argv(), FAKE)).refusal).toBeNull();
    const names = (resultOf(w).runs as R[]).map((x) => x.name as string);
    expect(names.length).toBeGreaterThan(1);
    for (const n of names) expect(n.startsWith(`quiz/step0b/${w.mode}.${token('2.9.1 (Claude Code)')}.r0/`), n).toBe(true);
    expect(token('2.9.1 (Claude Code)')).toMatch(/^v2\.9\.1-claude-code-[0-9a-f]{8}$/);
    expect(token('2.9.1 (Claude Code)'), 'two lines that fold alike still name apart').not.toBe(token('2.9.1 [claude code]'));
  });

  it('the same build reuses the passed result; another build, with questions still to run, probes again before the next arm', async () => {
    const w = await stoppedAfterStep0b();
    const n = step0bRuns(w.home);
    expect(n, 'fixture: step 0b ran').toBeGreaterThan(0);
    const same = await run(w.home, w.argv(), tripWhen(w.home, armsPreflight));
    expect(same.refusal?.word, 'stopped again at the arms\' preflight, past step 0b').toBe('limits-threshold');
    expect(same.stderr).not.toMatch(/probing again/);
    expect(step0bRuns(w.home), 'the build it probed: reused').toBe(n);
    limitsAt(w.home, 10);
    writeFileSync(join(w.home, STUB_VERSION), '2.9.2 (Claude Code)\n');
    const moved = await run(w.home, w.argv(), FAKE);
    expect(moved.refusal).toBeNull();
    expect(moved.stderr).toMatch(/step 0b probed 2\.9\.1 \(Claude Code\), this node runs 2\.9\.2 \(Claude Code\): probing again/);
    expect(step0bRuns(w.home), 'another build: probed again').toBe(2 * n);
    const res = resultOf(w);
    expect(res.round).toBe(1);
    expect(new Set((res.batches as R[]).map((b) => b.claude_code_version))).toEqual(new Set(['2.9.2 (Claude Code)']));
    expect(questionRuns(w.home).length, 'then the arms ran').toBeGreaterThan(0);
    expect(json(join(w.out, 'quiz', 'arms-summary.json')).step0b.sha256).toBe(shaOfFile(join(w.out, 'quiz', 'step0b', `${w.mode}.json`)));
  });

  it('a probe stopped part-way on one build and resumed on another runs fresh probes, never the first build\'s runs (F4-a)', async () => {
    const w = await stoppedAfterStep0b();
    const a = resultOf(w);
    const aSha = shaOfFile(join(w.out, 'quiz', 'step0b', `${w.mode}.json`));
    expect(turnRuns(w.home)).toBe(1);
    writeFileSync(join(w.home, STUB_VERSION), '2.9.2 (Claude Code)\n');
    const atB = turnRuns(w.home);
    const b = await run(w.home, w.argv(), tripWhen(w.home, () => turnRuns(w.home) > atB));
    expect(b.refusal?.word, 'build B: stopped after its round\'s turn-bound run').toBe('limits-threshold');
    expect(turnRuns(w.home), 'B\'s turn-bound run finished').toBe(2);
    expect(shaOfFile(join(w.out, 'quiz', 'step0b', `${w.mode}.json`)), 'no result was written for B').toBe(aSha);
    limitsAt(w.home, 10);
    writeFileSync(join(w.home, STUB_VERSION), '2.9.3 (Claude Code)\n');
    const c = await run(w.home, w.argv(), FAKE);
    expect(c.refusal).toBeNull();
    expect(turnRuns(w.home), 'build C ran its own turn-bound run, B\'s was not reused').toBe(3);
    const res = resultOf(w);
    expect(res.round).toBe((a.round as number) + 1);
    const names = [...(res.runs as R[]).map((x) => x.name as string), ...(res.batches as R[]).flatMap((x) => x.runs as string[])];
    for (const n of names) expect(n.startsWith(`quiz/step0b/${w.mode}.${token('2.9.3 (Claude Code)')}.r1/`), n).toBe(true);
    expect(names.some((n) => n.includes(token('2.9.2 (Claude Code)'))), 'no run of B is recorded').toBe(false);
    expect(new Set((res.batches as R[]).map((x) => x.claude_code_version))).toEqual(new Set(['2.9.3 (Claude Code)']));
  });

  it('a resumed arms with every question settled does not probe again on a moved build: nothing runs, and the summary\'s step 0b sha stays true (F4-b)', async () => {
    const w = await week();
    expect((await run(w.home, w.argv(), FAKE)).refusal).toBeNull();
    const step0bPath = join(w.out, 'quiz', 'step0b', `${w.mode}.json`);
    const sha = shaOfFile(step0bPath);
    const all = runs(w.home).length;
    writeFileSync(join(w.home, STUB_VERSION), '2.9.2 (Claude Code)\n');
    const noSkill = stream({ skills: [], session: 'fixture-qs-noskill', calls: [{ command: 'x' }] });
    plantStep0b(w.home, w.mode, Object.fromEntries((D.STEP0B_PROBES as string[]).map((p) => [p, noSkill])));   // a probe now would fail
    const r = await run(w.home, w.argv(), FAKE);
    expect(r.refusal).toBeNull();
    expect(r.stderr).toMatch(/every question is settled, so nothing runs and step 0b is not probed again/);
    expect(runs(w.home).length, 'nothing ran on the new build').toBe(all);
    expect(shaOfFile(step0bPath), 'the passed result stands').toBe(sha);
    expect(json(join(w.out, 'quiz', 'arms-summary.json')).step0b.sha256).toBe(sha);
  });

  it('a re-probe that fails refuses pilot-failed, records the failure, and leaves the summary as it was', async () => {
    const w = await stoppedAfterStep0b();
    const sumPath = join(w.out, 'quiz', 'arms-summary.json');
    const sum = shaOfFile(sumPath);
    writeFileSync(join(w.home, STUB_VERSION), '2.9.2 (Claude Code)\n');
    const noSkill = stream({ skills: [], session: 'fixture-qs-noskill', calls: [{ command: 'x' }] });
    plantStep0b(w.home, w.mode, Object.fromEntries((D.STEP0B_PROBES as string[]).map((p) => [p, noSkill])));
    const r = await run(w.home, w.argv(), FAKE);
    expect(r.refusal?.word).toBe('pilot-failed');
    expect(resultOf(w)).toMatchObject({ passed: false });
    expect(shaOfFile(sumPath), 'no summary after a failed probe').toBe(sum);
    expect(questionRuns(w.home), 'no question ran').toEqual([]);
    expect((await run(w.home, w.argv(), FAKE)).refusal?.word, 'and the week stays failed').toBe('pilot-failed');
  });
});

// ── quiz-pilot-checks ruling 5: `arms --repilot`, the one door that pilots a failed week's --out again ─────────────────
describe('quiz-pilot-checks ruling 5: arms --repilot pilots a failed week again on its own ledger', () => {
  const noSkill = stream({ skills: [], session: 'fixture-qs-noskill', calls: [{ command: 'x' }] });
  const failAll = (w: { home: string; mode: string }): void => plantStep0b(w.home, w.mode, Object.fromEntries((D.STEP0B_PROBES as string[]).map((p) => [p, noSkill])));
  const resultPath = (w: { out: string; mode: string }): string => join(w.out, 'quiz', 'step0b', `${w.mode}.json`);
  async function failedWeek() {
    const w = await week();
    failAll(w);
    const r = await run(w.home, w.argv(), FAKE);
    expect(r.refusal?.word, 'fixture: the first pilot failed').toBe('pilot-failed');
    return w;
  }

  it('CONTROL: without --repilot a failed pilot still refuses pilot-failed, and nothing spawns', async () => {
    const w = await failedWeek();
    const before = runs(w.home).length;
    expect((await run(w.home, w.argv(), FAKE)).refusal?.word).toBe('pilot-failed');
    expect(runs(w.home).length).toBe(before);
  });

  it('on a new release: the failed result is kept, the week is re-pinned, the pilot runs as round 1, passes, and the arms run', async () => {
    const w = await failedWeek();
    const failedBytes = readFileSync(resultPath(w));
    plantStep0b(w.home, w.mode);
    setRelease(w.home, 'v9.9.9');
    const r = await run(w.home, w.argv(['--repilot']), FAKE);
    expect(r.refusal).toBeNull();
    expect(readFileSync(join(w.out, QS.step0bFailedRel(w.mode, 0) as string)).equals(failedBytes), 'the failed round 0 result is kept as it was').toBe(true);
    expect(json(resultPath(w))).toMatchObject({ round: 1, passed: true });
    expect(json(join(w.out, QS.RELEASE_PIN_FILE as string)).ccrc_release).toBe('v9.9.9');
    expect(json(join(w.out, 'quiz', 'arms-summary.json'))).toMatchObject({ stop: null, ccrc_release: 'v9.9.9' });
    expect(questionRuns(w.home).length, 'the arms ran after the passing pilot').toBeGreaterThan(0);
  });

  it('both pilots spend on the week\'s one ledger, so the first pilot\'s spend counts toward the week\'s --budget', async () => {
    const w = await failedWeek();
    const firstPilot = D.spentSoFar(w.out) as number;
    expect(firstPilot, 'fixture: the first pilot spent').toBeGreaterThan(0);
    plantStep0b(w.home, w.mode);
    setRelease(w.home, 'v9.9.9');
    await run(w.home, w.argv(['--repilot']), FAKE);
    const names = (D.spendLinesOf(w.out) as R[]).map((l) => l.name as string);
    expect(names.some((n) => n.includes('.r0/')) && names.some((n) => n.includes('.r1/')), 'both rounds are on this --out\'s ledger').toBe(true);
    expect(D.spentSoFar(w.out) as number).toBeGreaterThan(firstPilot);
  });

  it('a re-pilot that fails again refuses pilot-failed and keeps both failed results', async () => {
    const w = await failedWeek();
    setRelease(w.home, 'v9.9.9');
    const r = await run(w.home, w.argv(['--repilot']), FAKE);
    expect(r.refusal?.word).toBe('pilot-failed');
    expect(json(resultPath(w))).toMatchObject({ round: 1, passed: false });
    expect(existsSync(join(w.out, QS.step0bFailedRel(w.mode, 0) as string))).toBe(true);
    expect(questionRuns(w.home)).toEqual([]);
  });

  it('with a passed result here, --repilot changes nothing: the arms run as any arms does', async () => {
    const w = await week();
    const r = await run(w.home, w.argv(['--repilot']), FAKE);
    expect(r.refusal).toBeNull();
    expect(json(resultPath(w))).toMatchObject({ round: 0, passed: true });
    expect(existsSync(join(w.out, QS.step0bFailedRel(w.mode, 0) as string))).toBe(false);
  });

  it('refuses out-refused when an arm batch was planned on the --out: a week\'s arms never span two releases', async () => {
    const w = await week({ budget: '600' });
    expect((await run(w.home, w.argv(), FAKE)).refusal?.word, 'fixture: the arms started and stopped at the budget').toBe('budget-exhausted');
    expect(D.readArmManifests(w.out, 'quiz').length, 'fixture: an arm batch was planned').toBeGreaterThan(0);
    // The shape a re-probe on a new build leaves when it fails after arms ran (the budget stop leaves no room to spawn one
    // here): the result is this setup's, its pilot failed, and arm batches stand beside it.
    writeFileSync(resultPath(w), `${L.canonicalJson({ ...json(resultPath(w)), round: 1, passed: false }) as string}\n`);
    expect((await run(w.home, w.argv(), FAKE)).refusal?.word, 'CONTROL: without --repilot it refuses as a failed pilot').toBe('pilot-failed');
    const pinBefore = readFileSync(join(w.out, QS.RELEASE_PIN_FILE as string));
    setRelease(w.home, 'v9.9.9');
    const r = await run(w.home, w.argv(['--repilot']), FAKE);
    expect(r.refusal).toMatchObject({ word: 'out-refused', detail: expect.stringMatching(/^--repilot: an arm batch was planned/) });
    expect(readFileSync(join(w.out, QS.RELEASE_PIN_FILE as string)).equals(pinBefore), 'the pin is untouched').toBe(true);
  });

  // fix round 1, F3: both write sites compose the pin through releasePinText; each is held to the literal fields.
  it('the pin each write site leaves is exactly the release pin\'s fields: the first start at round 0, a re-pilot at its round', async () => {
    const w = await failedWeek();
    const pinPath = join(w.out, QS.RELEASE_PIN_FILE as string);
    // stage B, B0: each pin now records the pilot key it was written on
    expect(json(pinPath), 'the first start').toEqual({ kind: QS.RELEASE_PIN_KIND, v: 1, setup_sha256: w.s.sha, ccrc_release: STAMP, round: 0, key: QK() });
    expect(readFileSync(pinPath, 'utf8')).toBe(QS.releasePinText(w.s.sha, STAMP, 0, QK()));
    plantStep0b(w.home, w.mode);
    setRelease(w.home, 'v9.9.9');
    expect((await run(w.home, w.argv(['--repilot']), FAKE)).refusal).toBeNull();
    expect(json(pinPath), 'the re-pilot\'s replacement').toEqual({ kind: QS.RELEASE_PIN_KIND, v: 1, setup_sha256: w.s.sha, ccrc_release: 'v9.9.9', round: 1, key: QK() });
    expect(readFileSync(pinPath, 'utf8')).toBe(QS.releasePinText(w.s.sha, 'v9.9.9', 1, QK()));
  });

  it('a pin that is not this setup\'s is never replaced: --repilot refuses out-refused (fix round 1, F3)', async () => {
    const w = await failedWeek();
    const pinPath = join(w.out, QS.RELEASE_PIN_FILE as string);
    writeFileSync(pinPath, QS.releasePinText('0'.repeat(64), STAMP, 0, QK()) as string);
    const before = readFileSync(pinPath);
    setRelease(w.home, 'v9.9.9');
    const r = await run(w.home, w.argv(['--repilot']), FAKE);
    expect(r.refusal).toMatchObject({ word: 'out-refused', detail: expect.stringMatching(/is not this run's pin/) });
    expect(readFileSync(pinPath).equals(before)).toBe(true);
  });

  // fix round 2 (review 3528, F2): the pin reader's and the composer's own guards, each with a case that fails on removal.
  it('a pin with no round, as older code wrote it, reads as round 0: --repilot pilots as round 1 on the new release', async () => {
    const w = await failedWeek();
    const pinPath = join(w.out, QS.RELEASE_PIN_FILE as string);
    writeFileSync(pinPath, `${L.canonicalJson({ kind: QS.RELEASE_PIN_KIND, v: 1, setup_sha256: w.s.sha, ccrc_release: STAMP }) as string}\n`);
    expect(json(pinPath).round, 'fixture: the pin carries no round').toBeUndefined();
    plantStep0b(w.home, w.mode);
    setRelease(w.home, 'v9.9.9');
    const r = await run(w.home, w.argv(['--repilot']), FAKE);
    expect(r.refusal).toBeNull();
    expect(json(resultPath(w))).toMatchObject({ round: 1, passed: true });
    expect(json(pinPath)).toMatchObject({ ccrc_release: 'v9.9.9', round: 1 });
    expect(existsSync(join(w.out, QS.step0bFailedRel(w.mode, 0) as string)), 'the round 0 result kept').toBe(true);
  });

  // review 3533, F5: a round that is present but damaged reads as round 0, as the absent one does (no writer makes one); the
  // mutant that reads it as written (`round: p.round`) refuses 1.5, '2' and 7.5 out-refused, so these rows tell the two apart.
  for (const damaged of [1.5, '2', -3, 7.5, null]) {
    it(`a pin whose round is present but damaged (${JSON.stringify(damaged)}) reads as round 0: --repilot pilots as round 1`, async () => {
      const w = await failedWeek();
      const pinPath = join(w.out, QS.RELEASE_PIN_FILE as string);
      writeFileSync(pinPath, `${L.canonicalJson({ kind: QS.RELEASE_PIN_KIND, v: 1, setup_sha256: w.s.sha, ccrc_release: STAMP, round: damaged }) as string}\n`);
      expect(json(pinPath).round, 'fixture: the pin carries the damaged round').toEqual(damaged);
      plantStep0b(w.home, w.mode);
      setRelease(w.home, 'v9.9.9');
      const r = await run(w.home, w.argv(['--repilot']), FAKE);
      expect(r.refusal).toBeNull();
      expect(json(resultPath(w))).toMatchObject({ round: 1, passed: true });
      expect(json(pinPath)).toMatchObject({ ccrc_release: 'v9.9.9', round: 1 });
    });
  }

  it('a pin whose round is past the next one is refused out-refused, and nothing is replaced', async () => {
    const w = await failedWeek();
    const pinPath = join(w.out, QS.RELEASE_PIN_FILE as string);
    writeFileSync(pinPath, QS.releasePinText(w.s.sha, STAMP, 2, QK()) as string);
    const pin = readFileSync(pinPath);
    setRelease(w.home, 'v9.9.9');
    const r = await run(w.home, w.argv(['--repilot']), FAKE);
    expect(r.refusal).toMatchObject({ word: 'out-refused', detail: expect.stringMatching(/names round 2, past the next round 1/) });
    expect(readFileSync(pinPath).equals(pin)).toBe(true);
    expect(existsSync(join(w.out, QS.step0bFailedRel(w.mode, 0) as string))).toBe(false);
  });

  it('a pin of another kind is refused by the pin reader, even with this setup\'s sha', async () => {
    const w = await failedWeek();
    const pinPath = join(w.out, QS.RELEASE_PIN_FILE as string);
    writeFileSync(pinPath, `${L.canonicalJson({ kind: 'not-the-pin', v: 1, setup_sha256: w.s.sha, ccrc_release: STAMP, round: 0 }) as string}\n`);
    const pin = readFileSync(pinPath);
    setRelease(w.home, 'v9.9.9');
    const r = await run(w.home, w.argv(['--repilot']), FAKE);
    expect(r.refusal).toMatchObject({ word: 'out-refused', detail: expect.stringMatching(/is not this run's pin/) });
    expect(readFileSync(pinPath).equals(pin)).toBe(true);
  });

  it('a failed week whose pin was removed is refused out-refused: --repilot never pins a week afresh', async () => {
    const w = await failedWeek();
    rmSync(join(w.out, QS.RELEASE_PIN_FILE as string));
    setRelease(w.home, 'v9.9.9');
    const r = await run(w.home, w.argv(['--repilot']), FAKE);
    expect(r.refusal).toMatchObject({ word: 'out-refused', detail: expect.stringMatching(/^--repilot: no quiz\/arms-release\.json beside a failed step 0b/) });
    expect(existsSync(join(w.out, QS.RELEASE_PIN_FILE as string)), 'nothing was written').toBe(false);
  });

  it('the composer refuses a round that is not a non-negative integer', () => {
    for (const bad of [-1, 1.5, Number.NaN, '1', null, undefined]) {
      expect(() => QS.releasePinText('a'.repeat(64), 'v1', bad, QK()), String(bad)).toThrow(TypeError);
    }
    expect(QS.releasePinText('a'.repeat(64), 'v1', 0, QK()), 'CONTROL').toMatch(/"round":0/);
  });

  it('the composer refuses a key that is no pilot key (stage B, B0)', () => {
    const bad: unknown[] = [undefined, null, {}, { claude_code: '' , code_shas: QK().code_shas }, { claude_code: 'b', code_shas: {} },
      { claude_code: 'b', code_shas: { f: 'not-hex' } }, { ...QK(), extra: 1 }];
    for (const k of bad) expect(() => QS.releasePinText('a'.repeat(64), 'v1', 0, k), JSON.stringify(k)).toThrow(TypeError);
    expect(JSON.parse(QS.releasePinText('a'.repeat(64), 'v1', 0, QK()) as string).key, 'CONTROL').toEqual(QK());
  });

  // fix round 1, F2: a re-pilot round that stopped before its result was written resumes only on its own release.
  /** A failed week whose re-pilot on v9.9.9 stopped (limits-threshold) after its box run, before any result was written. */
  async function stoppedRepilot() {
    const w = await failedWeek();
    plantStep0b(w.home, w.mode);
    setRelease(w.home, 'v9.9.9');
    let cards = 0;
    const limits = (pct: number): void => {
      const nowS = Math.floor(Date.now() / 1000);
      writeFileSync(join(w.home, '.cc-limits', 'up-a.json'), JSON.stringify({ five: pct, seven: pct, ts: nowS - 60, fiveResetAt: nowS + 3600, sevenResetAt: nowS + 86400 }));
    };
    const trip: R = { ...FAKE, recheck: async (rs: unknown, es: R[]): Promise<Map<string, R>> => {
      cards += 1;
      if (cards === 2) limits(90);   // the card before the first arm batch: the next spawn's gate stops the round
      return (FAKE.recheck as (a: unknown, b: R[]) => Promise<Map<string, R>>)(rs, es);
    } };
    const r = await run(w.home, w.argv(['--repilot']), trip);
    expect(r.refusal?.word, 'fixture: the re-pilot round stopped').toBe('limits-threshold');
    expect(json(resultPath(w)), 'fixture: no round 1 result yet').toMatchObject({ round: 0, passed: false });
    expect(json(join(w.out, QS.RELEASE_PIN_FILE as string)), 'fixture: the pin names the round under way').toMatchObject({ ccrc_release: 'v9.9.9', round: 1 });
    limits(10);
    return w;
  }

  it('the round under way, resumed on its own release: it finishes as round 1 and the arms run', async () => {
    const w = await stoppedRepilot();
    const r = await run(w.home, w.argv(['--repilot']), FAKE);
    expect(r.refusal).toBeNull();
    expect(json(resultPath(w))).toMatchObject({ round: 1, passed: true });
    expect(questionRuns(w.home).length).toBeGreaterThan(0);
  });

  for (const [why, tag] of [['forward to a newer release', 'v9.9.10'], ['back to the release that already failed', STAMP]] as Array<[string, string]>) {
    it(`the round under way, resumed after the release moved ${why}: repilot-release-moved, the pin and the result untouched`, async () => {
      const w = await stoppedRepilot();
      const pinPath = join(w.out, QS.RELEASE_PIN_FILE as string);
      const pin = readFileSync(pinPath);
      const res = readFileSync(resultPath(w));
      const before = runs(w.home).length;
      setRelease(w.home, tag);
      const r = await run(w.home, w.argv(['--repilot']), FAKE);
      expect(r.refusal).toMatchObject({ word: 'repilot-release-moved', detail: expect.stringContaining('under way on v9.9.9') });
      expect(readFileSync(pinPath).equals(pin), 'the pin').toBe(true);
      expect(readFileSync(resultPath(w)).equals(res), 'the result').toBe(true);
      expect(runs(w.home).length, 'nothing spawned past the version probe').toBeLessThanOrEqual(before + 1);
      expect(questionRuns(w.home)).toEqual([]);
    });
  }

  it('--repilot is an arms flag only', async () => {
    const w = await week();
    const sumPath = join(w.out, 'quiz', 'arms-summary.json');
    const r = await run(w.home, ['judge', '--out', w.out, ...inp('setup', w.s), ...inp('frozen', w.fz), '--arms-summary', sumPath, '--arms-summary-sha256', 'a'.repeat(64), '--repilot'], FAKE);
    expect(r.refusal).toMatchObject({ word: 'args-invalid', detail: '--repilot is not a judge flag' });
  });
});

describe('fix round 1: report recomputes the summary from the answer records (F5)', () => {
  it('an answer record edited after the judge refuses arms-summary-mismatch before any scoring, and no report is written', async () => {
    const f = await reportFixture();
    const p = join(f.out, 'quiz', 'answers', `${f.q[1]!.qid as string}.${TREATMENT}.json`);
    const rec = json(p);
    expect(rec.correct, 'fixture: q[1] answered wrongly').toBe(false);
    writeFileSync(p, `${L.canonicalJson({ ...rec, correct: true }) as string}\n`);
    const r = await run(f.home, f.reportArgv());
    expect(r.refusal).toMatchObject({ word: 'input-invalid', detail: expect.stringMatching(/^arms-summary-mismatch: /) });
    expect(existsSync(join(f.out, 'single-report.json'))).toBe(false);
  });
});

// ── Task 6: W2's readers refuse every file the module writes (the history coordinator's skip condition 1) ─────────
/** Whether every one of W2's record readers refuses this file: loadFinalRecord and loadArmRun (both sections) refuse it
 *  as a record, and validateOpenRecord's draft and final checks fail it. */
function refusedByW2(p: string, fz: Saved): { ok: boolean; accepted: string[] } {
  const sha = shaOfFile(p);
  const flags = { record: p, 'record-sha256': sha, part1: p, 'part1-sha256': sha, frozen: fz.path, 'frozen-sha256': fz.sha };
  const accepted: string[] = [];
  const refuses = (name: string, fn: () => unknown): void => {
    try { fn(); accepted.push(name); } catch (e) { if (!(e instanceof D.DriverRefusal)) throw e; }
  };
  refuses('loadFinalRecord', () => D.loadFinalRecord(flags, { nowMs: Date.now() }));
  refuses('loadArmRun quiz', () => D.loadArmRun(flags, 'quiz', { nowMs: Date.now() }));
  refuses('loadArmRun pilot', () => D.loadArmRun(flags, 'pilot', { nowMs: Date.now() }));
  let value: unknown = null;
  try { value = JSON.parse(readFileSync(p, 'utf8')); } catch { value = null; }
  if (value !== null) {
    const asDraft = { ...(value as R), part: 'draft' };
    const asFinal = { ...(value as R), part: 'final' };
    if ((G.validateOpenRecord(value, { draft: null, predecessor: null, frozen: null }) as R).ok === true) accepted.push('validateOpenRecord');
    if ((G.validateOpenRecord(asDraft, { draft: null, predecessor: null, frozen: null }) as R).ok === true) accepted.push('validateOpenRecord draft');
    if ((G.validateOpenRecord(asFinal, { draft: asDraft, predecessor: null, frozen: { families: [], n_questions: 0 } }) as R).ok === true) accepted.push('validateOpenRecord final');
  }
  return { ok: accepted.length === 0, accepted };
}

describe('Task 6: W2\'s readers refuse every file the module writes (skip condition 1)', () => {
  it('every file under the setup --out and the week --out, each one, is refused by loadFinalRecord, loadArmRun and validateOpenRecord', async () => {
    const f = await reportFixture();
    await run(f.home, f.reportArgv());
    const made = [entry(FAM_A, 7)];
    // The stand-in drives the driver's own writers: the real writer handle pins quiz/writer/<qid>.input.json before its run,
    // and writeBaselineRecord writes quiz/baseline.json (W2's kind), as the real sourceQuiz does.
    const sourceQuiz = async (o: R): Promise<R> => {
      const e = made[0]!;
      const leaf = { text: `the fixture leaf records ${e.fact_raw as string}`, rawLen: 64 };
      await o.writer.ask('quiz', { ...e, leaf, pair: null, span: [leaf] });
      D.writeBaselineRecord(o.out, 'quiz', { storeId: STORE, rows: [D.baselineRow(e.boundary_uuid, { state: 'discard', why: 'fixture-discard' })] });
      return { entries: made.map((x, i) => ({ ...x, rank: ['k', i] })), fidelity: [], counts: {}, asof_same_ms_hits: {} };
    };
    expect((await run(f.home, ['source', '--out', f.s.out, ...inp('setup', f.s)], { sourceQuiz })).refusal).toBeNull();
    const writerInput = join(f.s.out, 'quiz', 'writer', `${made[0]!.qid as string}.input.json`);
    expect(existsSync(writerInput), 'the walk reaches a real writer input').toBe(true);
    const sourcedPath = join(f.s.out, 'quiz', 'sourced.json');
    await run(f.home, ['freeze', '--out', f.s.out, ...inp('setup', f.s), '--sourced', sourcedPath, '--sourced-sha256', shaOfFile(sourcedPath)]);
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));
    const files = [...walk(f.s.out), ...walk(f.out)].filter((p) => !p.endsWith('.lock'));
    const kinds = new Set(files.map((p) => { try { return (json(p).kind as string | undefined) ?? '-'; } catch { return '-'; } }));
    for (const k of ['ccrc-history-quiz-single-setup', 'ccrc-history-quiz-single-step0b', 'ccrc-history-quiz-single-arms-summary', 'ccrc-history-quiz-single-judged',
      'ccrc-history-quiz-single-report', 'ccrc-history-w2-answer', 'ccrc-history-w2-arm-batch', 'ccrc-history-w2-judge-map', D.SOURCED_KIND as string, 'ccrc-history-w2-quiz',
      D.BASELINE_RECORD_KIND as string]) {
      expect(kinds, `the walk reaches a ${k} file`).toContain(k);
    }
    expect(D.BASELINE_RECORD_KIND).toBe('ccrc-history-w2-baseline');
    expect(files, 'the writer input is among the walked files').toContain(writerInput);
    const accepted = files.map((p) => ({ p: p.slice(f.home.length), r: refusedByW2(p, f.fz) })).filter((x) => !x.r.ok);
    expect(accepted).toEqual([]);
  });

  it('CONTROL: the check reports a reader that accepts: a genuine W2 part 1 draft, built by the driver\'s buildDraft, is accepted by validateOpenRecord', () => {
    const shas = (D.codeShas(REPO) as R).files as Record<string, string>;
    const s0 = { kind: D.STEP0A_KIND, v: 1, measured_ms: 1_700_000_000_000, account: 'up-a', settings_mode: 'restricted', claude_code_version: '2.9.1',
      wrapper_sha256: null, flags_accepted: Object.fromEntries((D.contractFlags('restricted') as string[]).map((x) => [x, true])),
      writer_init: { tools: [] }, judge_init: { tools: [] }, box_init: { tools: ['Bash', 'Agent'] }, code_shas: shas, release_stamp: STAMP, budget: 100_000, spend: 600 };
    const pilot = { kind: D.PILOT_SOURCE_KIND, v: 1, store_id: STORE, seed: SEED, n_fidelity: 5, n_usage: 5, families: [FAM_A], fidelity: [],
      frozen_sha256: 'e'.repeat(64), writer_model: OPUS,
      used: { labeller: { ...G.LABELLER, path_forms: [...G.LABELLER.path_forms] }, sha_min_prefix: 7, writer_input: 'excerpt', baseline_files: 'v1',
        writer_prompt_sha256: G.WRITER_PROMPT_SHA256, answer_protocol_sha256: G.ANSWER_PROTOCOL_SHA256 },
      code_shas: shas, release_stamp: STAMP, budget: 3_000_000, spend: 900_000, counts: {} };
    const draft = D.buildDraft({ nodes: [{ label: 'node-0', store_id: STORE }], step0a: [{ ...s0, label: 'node-0', store_id: STORE }], pilot, account: 'up-a',
      models: { arm: ARM_MODEL, writer: OPUS, judge: OPUS }, gateCode: { release_tag: STAMP, files: shas }, seedHex: SEED, nowMs: 1_700_000_100_000,
      overrides: {}, supersedes: null }) as R;
    expect((G.validateOpenRecord(draft, { draft: null, predecessor: null, frozen: null }) as R).ok, 'fixture: the draft validates').toBe(true);
    const p = join(mkTmp('ccrc-qs-ctl-'), 'part1.json');
    writeFileSync(p, `${L.canonicalJson(draft) as string}\n`);
    const fz = saveFrozen([entry(FAM_A, 1)]);
    expect(refusedByW2(p, fz)).toMatchObject({ ok: false, accepted: expect.arrayContaining(['validateOpenRecord']) });
    const empty = join(mkTmp('ccrc-qs-ctl-'), 'x.json');
    writeFileSync(empty, '{}\n');
    expect(refusedByW2(empty, fz).ok, 'CONTROL: an empty object is refused by every reader').toBe(true);
  });
});

// ── run 3538: the week's account (the coordinator's rulings 3 and 4 of 2026-11-23) ──────────────────────────────────────
describe('run 3538: arms and judge run on the week\'s account, recorded in the week\'s folder', () => {
  const GEN = 'gen-b';
  const GEN_LOG = 'stub-log-gen-b.jsonl';
  /** The fixture HOME's folder for a generated account's declared credentials file, as history-replay.test.ts's admission
   *  fixtures spell it; the file planted there is empty, and admission only stats it. */
  const CRED_DIR = '.cc-secrets';
  /** A second account, generated, with its own launcher (the stub, logging to its own file), credentials file and limits row,
   *  all inside the fixture HOME. */
  function addGen(home: string, row: R | null = { five: 10, seven: 10 }): void {
    const f = join(home, '.ccrc', 'accounts.json');
    const roster = json(f);
    roster.accounts.push({ id: GEN, label: GEN, configDirSuffix: '.gen-b', homeAble: true, telemetry: 'anthropic',
      exec: { kind: 'generated', provider: 'anthropic', secretsFile: `${CRED_DIR}/gen-b.env` } });
    writeFileSync(f, `${JSON.stringify(roster, null, 2)}\n`);
    writeFileSync(join(home, '.local', 'bin', GEN), STUB.replace(JSON.stringify(STUB_LOG), JSON.stringify(GEN_LOG)), { mode: 0o700 });
    mkdirSync(join(home, CRED_DIR), { recursive: true, mode: 0o700 });
    writeFileSync(join(home, CRED_DIR, 'gen-b.env'), '', { mode: 0o600 });
    const nowS = Math.floor(Date.now() / 1000);
    if (row !== null) writeFileSync(join(home, '.cc-limits', `${GEN}.json`), JSON.stringify({ ts: nowS - 60, fiveResetAt: nowS + 3600, sevenResetAt: nowS + 86400, ...row }));
  }
  const genRuns = (home: string): R[] => (existsSync(join(home, GEN_LOG)) ? readFileSync(join(home, GEN_LOG), 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as R) : []);
  const recPath = (out: string): string => join(out, 'quiz', 'week-account.json');
  const judgeArgv = (w: R, extra: string[] = []): string[] => {
    const sumPath = join(w.out, 'quiz', 'arms-summary.json');
    return ['judge', '--out', w.out, ...inp('setup', w.s), ...inp('frozen', w.fz), '--arms-summary', sumPath, '--arms-summary-sha256', shaOfFile(sumPath), ...extra];
  };

  it('arms --account runs the week on that account: recorded through the one composer, step 0b and every arm on its launcher', async () => {
    const w = await week();
    addGen(w.home);
    const r = await run(w.home, w.argv(['--account', GEN]), FAKE);
    expect(r.refusal).toBeNull();
    expect(readFileSync(recPath(w.out), 'utf8')).toBe(QS.weekAccountText(w.s.sha, GEN));
    expect(runs(w.home), 'nothing ran on the setup\'s launcher').toEqual([]);
    expect(genRuns(w.home).filter((x) => x.argv[0] !== '--version').length).toBeGreaterThan(0);
    expect(json(join(w.out, 'quiz', 'step0b', `${w.mode}.json`)).account, 'ruling 4: the pilot\'s checks ran on the account in use').toBe(GEN);
    expect(w.s.value.account, 'CONTROL: the setup is the other account').toBe('up-a');
  });

  it('without --account the week is the setup\'s, as before, and is recorded so', async () => {
    const w = await week();
    expect((await run(w.home, w.argv(), FAKE)).refusal).toBeNull();
    expect(readFileSync(recPath(w.out), 'utf8')).toBe(QS.weekAccountText(w.s.sha, 'up-a'));
  });

  it('the record stands before the first spawn: a pilot that fails leaves it', async () => {
    const w = await week();
    addGen(w.home);
    const p = (D.step0bProbesOf(w.home, D.STEP0B_SYNTHETIC_TRANSCRIPT) as R[]).find((x) => x.probe === 'deny-rg')!;
    plantStep0b(w.home, w.mode, { 'deny-rg': stream({ session: 'fixture-qs-deny-rg', calls: [{ command: p.command }] }) });
    expect((await run(w.home, w.argv(['--account', GEN]), FAKE)).refusal?.word).toBe('pilot-failed');
    expect(json(recPath(w.out)).account).toBe(GEN);
  });

  // fix round 1 (review 3545 F3): the record is on disk before the --version spawn, the week's first
  it('the record stands before the --version spawn: a --version that fails leaves it', async () => {
    const w = await week();
    addGen(w.home);
    rmSync(join(w.home, STUB_VERSION));   // the stub then prints no version line
    const r = await run(w.home, w.argv(['--account', GEN]), FAKE);
    expect(r.refusal?.word).toBe('version-unmeasured');
    expect(readFileSync(recPath(w.out), 'utf8')).toBe(QS.weekAccountText(w.s.sha, GEN));
    expect(genRuns(w.home), 'CONTROL: nothing past --version ran').toEqual([]);
  });

  it('the record stands before the --version spawn: a run killed while --version runs leaves it', async () => {
    const w = await week();
    addGen(w.home);
    // the week's launcher holds its --version run open and says so, so the driver can be killed there
    const launcher = join(w.home, '.local', 'bin', GEN);
    const held = readFileSync(launcher, 'utf8').replace("if (argv[0] === '--version') {",
      "if (argv[0] === '--version') { fs.writeFileSync(at('version.pid'), String(process.pid)); await new Promise((r) => setTimeout(r, 30000));");
    expect(held, 'fixture: the --version line was found').not.toBe(readFileSync(launcher, 'utf8'));
    writeFileSync(launcher, held, { mode: 0o700 });
    const wrapper = join(mkTmp('ccrc-qs-wrap-'), 'run.mjs');
    writeFileSync(wrapper, `const m = await import(${JSON.stringify(pathToFileURL(SCRIPT).href)});
const deps = {
  recheck: async (_rs, es) => new Map(es.map((e) => [e.qid, { ok: true, boundaryEntryId: 0, cut: { qid: e.qid } }])),
  payloads: (_rs, _id, _q, cut) => ({ state: 'payloads', plain: 'fixture payload ' + cut.qid + '\\n', carded: ${JSON.stringify(`${CARD}\n\nfixture payload `)} + cut.qid + '\\n', card: { state: 'card', line: ${JSON.stringify(CARD)} } }),
};
process.exitCode = await m.main(process.argv.slice(2), { HOME: process.env.HOME, LANG: process.env.LANG }, deps);
`);
    const child = spawn(process.execPath, ['--no-warnings', wrapper, ...w.argv(['--account', GEN])],
      { cwd: w.home, env: { ...scrubbedEnv(process.env), HOME: w.home } as NodeJS.ProcessEnv, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (b: Buffer) => { stderr += b.toString('utf8'); });
    const closed = new Promise<{ signal: string | null }>((resolve) => child.on('close', (_s, signal) => resolve({ signal })));
    const pidFile = join(w.home, 'version.pid');
    const deadline = Date.now() + 30_000;
    while (!existsSync(pidFile) && child.exitCode === null && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    try {
      expect(existsSync(pidFile), `fixture: the --version run started (${stderr})`).toBe(true);
      child.kill('SIGKILL');
      expect((await closed).signal).toBe('SIGKILL');
      expect(readFileSync(recPath(w.out), 'utf8'), 'a week killed at its first spawn is a spawned week on its account').toBe(QS.weekAccountText(w.s.sha, GEN));
    } finally {
      child.kill('SIGKILL');
      if (existsSync(pidFile)) { try { process.kill(Number(readFileSync(pidFile, 'utf8')), 'SIGKILL'); } catch { /* gone */ } }
    }
  }, 60_000);

  // fix round 1 (review 3545 F1): only an admitted account becomes the week's record, so the runner can try the next one
  it('an account admission refuses is never recorded: no --out, no record, nothing spawned', async () => {
    const w = await week();
    addGen(w.home);
    rmSync(join(w.home, CRED_DIR, 'gen-b.env'));   // its declared credentials file absent: admission refuses it
    const r = await run(w.home, w.argv(['--account', GEN]), FAKE);
    expect(r.refusal?.word).toBe('account-refused');
    expect(existsSync(w.out)).toBe(false);
    expect(existsSync(recPath(w.out))).toBe(false);
    expect([runs(w.home), genRuns(w.home)]).toEqual([[], []]);
  });

  // fix round 1 (review 3545 F2): every spawn's gate reads the week's account's row, not the setup's
  it('the spawn gate reads the week\'s account\'s row: it rising past the threshold after admission stops the run, the setup\'s row low', async () => {
    const w = await week();
    addGen(w.home);
    const genRow = join(w.home, '.cc-limits', `${GEN}.json`);
    const deps: R = { ...FAKE, recheck: async (rs: unknown, es: R[]): Promise<Map<string, R>> => {
      if (es.length > 1) {   // the arms' preflight of its whole batch, after admission and step 0b, before any question spawns
        const nowS = Math.floor(Date.now() / 1000);
        writeFileSync(genRow, JSON.stringify({ five: 90, seven: 90, ts: nowS - 60, fiveResetAt: nowS + 3600, sevenResetAt: nowS + 86400 }));
      }
      return (FAKE.recheck as (a: unknown, b: R[]) => Promise<Map<string, R>>)(rs, es);
    } };
    const r = await run(w.home, w.argv(['--account', GEN]), deps);
    expect(r.refusal?.word).toBe('limits-threshold');
    expect(json(genRow).seven, 'CONTROL: the week\'s row was raised').toBe(90);
    expect(json(join(w.home, '.cc-limits', 'up-a.json')).seven, 'CONTROL: the setup\'s row stayed low').toBe(10);
    expect(genRuns(w.home).filter((x) => typeof x.stdin === 'string' && x.stdin.startsWith(`${CARD}\n\nfixture payload `)), 'no question spawned').toEqual([]);
    expect(json(recPath(w.out)).account).toBe(GEN);
  });

  it('the gate reads the week\'s account\'s own row: no row there stops the act before --out, whatever the setup\'s row says', async () => {
    const w = await week();
    addGen(w.home, null);
    const r = await run(w.home, w.argv(['--account', GEN]), FAKE);
    expect(r.refusal).toMatchObject({ word: 'limits-stale', detail: 'absent' });
    expect(existsSync(w.out)).toBe(false);
    expect(genRuns(w.home)).toEqual([]);
  });

  it('an act given another account than the week\'s record refuses account-moved before any spawn: arms and judge', async () => {
    const w = await week();
    addGen(w.home);
    expect((await run(w.home, w.argv(['--account', GEN]), FAKE)).refusal).toBeNull();
    const before = [runs(w.home).length, genRuns(w.home).length];
    const arms = await run(w.home, w.argv(['--account', 'up-a']), FAKE);
    expect(arms.refusal?.word).toBe('account-moved');
    expect(arms.refusal?.detail, 'no account is named in the detail').not.toMatch(/up-a|gen-b/);
    const armsBare = await run(w.home, w.argv(), FAKE);
    expect(armsBare.refusal?.word, 'no flag is the setup\'s account, which is not this week\'s').toBe('account-moved');
    const judge = await run(w.home, judgeArgv(w, ['--account', 'up-a']), FAKE);
    expect(judge.refusal?.word).toBe('account-moved');
    expect([runs(w.home).length, genRuns(w.home).length], 'nothing spawned').toEqual(before);
    expect(readFileSync(recPath(w.out), 'utf8'), 'the record is never rewritten').toBe(QS.weekAccountText(w.s.sha, GEN));
    expect((await run(w.home, judgeArgv(w, ['--account', GEN]), FAKE)).refusal, 'CONTROL: the week\'s own account judges').toBeNull();
  });

  it('a week an older build ran (its release pin, no record) reads as the setup\'s account', async () => {
    const w = await week();
    addGen(w.home);
    expect((await run(w.home, w.argv(), FAKE)).refusal).toBeNull();
    rmSync(recPath(w.out));
    expect(QS.weekAccountOf(w.out, w.s.sha, 'up-a')).toEqual({ state: 'recorded', account: 'up-a', older: true });
    expect((await run(w.home, w.argv(['--account', GEN]), FAKE)).refusal?.word).toBe('account-moved');
    expect((await run(w.home, w.argv(), FAKE)).refusal, 'CONTROL: the setup\'s account resumes it').toBeNull();
    expect(existsSync(recPath(w.out)), 'an older week is not given a record').toBe(false);
  });

  it('a record that is not this run\'s, or not a regular file, refuses out-refused and spawns nothing', async () => {
    const w = await week();
    expect((await run(w.home, w.argv(), FAKE)).refusal).toBeNull();
    const n = runs(w.home).length;
    writeFileSync(recPath(w.out), QS.weekAccountText('0'.repeat(64), 'up-a') as string);
    expect((await run(w.home, w.argv(), FAKE)).refusal).toMatchObject({ word: 'out-refused', detail: 'quiz/week-account.json is not this run\'s record' });
    rmSync(recPath(w.out));
    mkdirSync(recPath(w.out));
    expect((await run(w.home, w.argv(), FAKE)).refusal).toMatchObject({ word: 'out-refused', detail: 'quiz/week-account.json is not-regular' });
    expect(runs(w.home).length).toBe(n);
  });

  it('weekAccountOf answers none for a week that has spawned nothing, and never throws on a missing folder', () => {
    const out = freshOut('never');
    expect(QS.weekAccountOf(out, 'a'.repeat(64), 'up-a')).toEqual({ state: 'none' });
    mkdirSync(join(out, 'quiz'), { recursive: true });
    writeFileSync(join(out, 'quiz', 'week-account.json'), QS.weekAccountText('a'.repeat(64), 'lane-a') as string);
    expect(QS.weekAccountOf(out, 'a'.repeat(64), 'up-a')).toEqual({ state: 'recorded', account: 'lane-a', older: false });
    writeFileSync(join(out, 'quiz', 'week-account.json'), 'not json');
    expect(QS.weekAccountOf(out, 'a'.repeat(64), 'up-a').state).toBe('unreadable');
  });

  it('the composer refuses an account that is not a non-empty string', () => {
    for (const bad of ['', null, 7, undefined]) expect(() => QS.weekAccountText('a'.repeat(64), bad), String(bad)).toThrow(TypeError);
    expect(JSON.parse(QS.weekAccountText('a'.repeat(64), 'lane-a') as string)).toEqual({ kind: QS.WEEK_ACCOUNT_KIND, v: 1, setup_sha256: 'a'.repeat(64), account: 'lane-a' });
  });
});

// ── quiz pilot stage B (Overlord W1a, run 3561): characterization of main (e29f704d47) before any stage-B change ──
// The task note is docs/superpowers/programs/overlord/quiz-pilot-stage-b.md. Committed green against main's code first; each
// later stage-B commit edits only the rows its ruling moves, and says which.
describe('stage B characterization of main (e29f704d47): what a passing week spawns and records', () => {
  const judgeArgv = (w: R): string[] => {
    const sumPath = join(w.out, 'quiz', 'arms-summary.json');
    return ['judge', '--out', w.out, ...inp('setup', w.s), ...inp('frozen', w.fz), '--arms-summary', sumPath, '--arms-summary-sha256', shaOfFile(sumPath)];
  };

  it('every arms run, the box run, the probes and the questions, spawns with the arm argv and nothing else', async () => {
    const w = await week();
    expect((await run(w.home, w.argv(), FAKE)).refusal).toBeNull();
    const want = D.spawnArgv({ mode: 'arm', model: ARM_MODEL, settingsMode: w.mode, home: w.home }) as string[];
    const got = runs(w.home);
    expect(got.length).toBe(1 + (D.STEP0B_PROBES as string[]).length + 3 + D.ARM_ATTEMPTS_MAX);
    for (const r of got) expect(r.argv).toEqual(want);
  });

  it('every judge run spawns with the judge argv and nothing else', async () => {
    const w = await week();
    expect((await run(w.home, w.argv(), FAKE)).refusal).toBeNull();
    const n = runs(w.home).length;
    expect((await run(w.home, judgeArgv(w), FAKE)).refusal).toBeNull();
    const want = D.spawnArgv({ mode: 'judge', model: OPUS, settingsMode: w.mode, home: w.home }) as string[];
    const got = runs(w.home).slice(n);
    expect(got.length).toBeGreaterThan(0);
    for (const r of got) expect(r.argv).toEqual(want);
  });

  it('the step 0b result\'s fields, and a probe run\'s record fields', async () => {
    const w = await week();
    expect((await run(w.home, w.argv(), FAKE)).refusal).toBeNull();
    const res = json(join(w.out, 'quiz', 'step0b', `${w.mode}.json`));
    expect(Object.keys(res).sort()).toEqual(['account', 'batches', 'checks', 'failed', 'kind', 'measured_ms', 'model', 'passed', 'persistence', 'probes',
      'question', 'round', 'runs', 'settings_mode', 'setup_sha256', 'store_id', 'subagent', 'synthetic_transcript', 'unmeasured', 'v']);
    expect(Object.keys(res.checks.plugins).sort()).toEqual(['loaded', 'state']);
    const name = res.batches[1].runs[0] as string;
    const rec = json(join(w.out, `${name}.run.json`));
    expect(Object.keys(rec).sort()).toEqual(['account', 'code', 'cwd', 'kind', 'mode', 'model', 'ms', 'name', 'settings_mode', 'signal', 'stream_sha256',
      'tokens', 'unknown_options', 'usage_assistant_tokens', 'usage_result_tokens', 'v']);
  });

  it('the release pin\'s fields', async () => {
    const w = await week();
    expect((await run(w.home, w.argv(), FAKE)).refusal).toBeNull();
    // Changed by B0 (was: no key): the pin records the pilot key it was written on.
    expect(Object.keys(json(join(w.out, 'quiz', 'arms-release.json'))).sort()).toEqual(['ccrc_release', 'key', 'kind', 'round', 'setup_sha256', 'v']);
  });
});

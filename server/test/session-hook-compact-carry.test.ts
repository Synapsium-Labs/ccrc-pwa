// `compactions-write-no-hookstate` (D-5239; spec 2026-10-16 §5.8, §6.1; plan Task 10): behind the server's word
// `dispatch-live-gate-v1`, PreCompact and PostCompact write NO hookstate, so the file stays byte for byte as it was
// and carries the whole field set by construction. Without the word (absent, stale, torn, future, malformed, or a
// file listing other words) a compaction writes exactly what it writes today.
//
// Runs ccd/session-hook.sh for real inside a fixture HOME. The harness is COPIED from
// session-hook-turnmark.test.ts (a test file cannot import another). Payloads copy the key sets of the committed
// `clear-compact-resume` and agent captures (server/test/fixtures/delegation/), with neutral ids and the captures'
// own neutral rig paths.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import {
  SERVER_CAPS, SERVER_CAPS_FILE, SERVER_CAPS_LEASE_S, parseServerCaps, renderServerCaps,
} from '../../shared/api.js';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');
const HELPER_SRC = path.resolve(__dirname, '../../ccd/compact-card.mjs');
const DELEGATION = path.resolve(__dirname, 'fixtures/delegation');
const FIVE = path.resolve(__dirname, 'fixtures/hook/stop-bg-five-kinds.json');

const ID = 'lane-a-project-a';
const UUID = '00000000-0000-4000-8000-000000000001';
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
const WORD = 'dispatch-live-gate-v1';
const TRANSCRIPT = `/rig/fixhome/cfg/projects/-rig-repo/${UUID}.jsonl`;

let home: string;
beforeEach(() => {
  home = mkTmp('ccrc-hook-compact-');
  fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  fs.writeFileSync(path.join(home, '.cc-sessions', `${ID}.generation`), GENERATION);
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'tmux'), `#!/bin/sh\necho "cc-${ID}"\n`, { mode: 0o755 });
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const hookEnv = (): NodeJS.ProcessEnv => ({
  ...process.env, HOME: home,
  PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
  TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: UUID, CLAUDE_PID: '4242',
  CCRC_SESSION_GENERATION: GENERATION,
});
/** One hook run; the header contract's exit 0 and silence asserted on every run. */
const run = (payload: object, env: NodeJS.ProcessEnv = {}): void => {
  const r = spawnSync('bash', [HOOK], { input: JSON.stringify(payload), encoding: 'utf8', env: { ...hookEnv(), ...env } });
  expect(r.status, 'the hook contract: exit 0 on every path').toBe(0);
  expect(r.stdout, 'an unarmed compaction prints nothing (PreCompact prints only when armed and scope main)').toBe('');
};
const reg = (): string => path.join(home, '.cc-sessions');
const stateFile = (): string => path.join(reg(), `${ID}.hookstate.json`);
const stateBytes = (): Buffer => fs.readFileSync(stateFile());
const readState = (): Record<string, unknown> => JSON.parse(fs.readFileSync(stateFile(), 'utf8')) as Record<string, unknown>;
const markFile = (): string => path.join(reg(), `${ID}.turn.json`);

// ── The server-caps fixture, written the way Task 9b's writers write it ──────────────────────────────────────────
const capsPath = (): string => path.join(home, '.ccrc', SERVER_CAPS_FILE);
const nowS = (): number => Math.floor(Date.now() / 1000);
const writeCapsText = (text: string): void => {
  fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  fs.writeFileSync(capsPath(), text, { mode: 0o600 });
};
/** A current file listing `words`, `ageS` seconds old. */
const writeCaps = (words: readonly string[] = [WORD], ageS = 0): void => writeCapsText(renderServerCaps(words, nowS() - ageS));

// ── Payloads: the committed captures' key sets ──────────────────────────────────────────────────────────────────
const preCompact = (trigger: 'auto' | 'manual' = 'auto'): object => ({
  session_id: UUID, transcript_path: TRANSCRIPT, cwd: '/rig/repo', prompt_id: '00000000-0000-4000-8000-0000000000c1',
  hook_event_name: 'PreCompact', trigger, custom_instructions: null,
});
const postCompact = (trigger: 'auto' | 'manual' = 'auto'): object => ({
  session_id: UUID, transcript_path: TRANSCRIPT, cwd: '/rig/repo', prompt_id: '00000000-0000-4000-8000-0000000000c1',
  hook_event_name: 'PostCompact', trigger, compact_summary: 'fixture summary',
});
const promptSubmit = (prompt = 'fixture prompt'): object => ({
  session_id: UUID, transcript_path: TRANSCRIPT, cwd: '/rig/repo', prompt_id: '00000000-0000-4000-8000-0000000000a2',
  permission_mode: 'default', hook_event_name: 'UserPromptSubmit', prompt,
});
/** The committed five-kind Stop, its task list replaced. */
const stop = (tasks: unknown[] = []): object =>
  ({ ...(JSON.parse(fs.readFileSync(FIVE, 'utf8')) as Record<string, unknown>), background_tasks: tasks });
const workflow = (id: string): object =>
  ({ id, type: 'workflow', status: 'running', description: 'fixture workflow', name: 'fixwf' });
const subagentStart = (agentId: string): object => ({
  session_id: UUID, transcript_path: TRANSCRIPT, cwd: '/rig/repo', prompt_id: '00000000-0000-4000-8000-0000000000a2',
  agent_id: agentId, agent_type: 'general-purpose', hook_event_name: 'SubagentStart',
});
const askPreToolUse = (): object => ({
  session_id: UUID, transcript_path: TRANSCRIPT, cwd: '/rig/repo', prompt_id: '00000000-0000-4000-8000-0000000000a2',
  permission_mode: 'default', effort: { level: 'medium' }, hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion',
  tool_use_id: 'toolu_fixture000001',
  tool_input: { questions: [{ question: 'Fixture question?', header: 'Fixture', options: [{ label: 'A' }, { label: 'B' }], multiSelect: false }] },
});

/** A Stop's `done`, then its file aged to `atMs` so a rewrite can never collide with it in the same millisecond. */
const doneAt = (atMs: number, tasks: unknown[] = []): Buffer => {
  run(stop(tasks));
  const s = readState();
  fs.writeFileSync(stateFile(), JSON.stringify({ ...s, updatedAt: atMs }) + '\n');
  return stateBytes();
};
const T0 = Date.now() - 40 * 60_000;

describe('the skip engages only behind the server\'s word (D-5239, spec §6.1)', () => {
  const NOT_ADVERTISED: Array<[string, () => void]> = [
    ['absent', () => {}],
    ['stale (lease + 1 s)', () => writeCaps([WORD], SERVER_CAPS_LEASE_S + 1)],
    ['torn (no end line)', () => writeCapsText(`at ${nowS()}\ncaps ${WORD}\n`)],
    ['a third line other than end', () => writeCapsText(`at ${nowS()}\ncaps ${WORD}\nfin\n`)],
    ['listing only hook-main-state-v1', () => writeCaps(['hook-main-state-v1'])],
    ['in the future', () => writeCapsText(`at ${nowS() + 60}\ncaps ${WORD}\nend\n`)],
    ['a word off the grammar beside it', () => writeCapsText(`at ${nowS()}\ncaps ${WORD} Bad_Word\nend\n`)],
    ['a prefix of the word only', () => writeCaps(['dispatch-live-gate'])],
    ['the word with a suffix only', () => writeCaps([`${WORD}x`])],
    ['a fourth line after end', () => writeCapsText(`at ${nowS()}\ncaps ${WORD}\nend\nend\n`)],
    ['a 12-digit at', () => writeCapsText(`at 00${nowS()}\ncaps ${WORD}\nend\n`)],
  ];
  it.each(NOT_ADVERTISED)('%s → PreCompact writes working and PostCompact manual a fresh done (today\'s bytes)', (_l, plant) => {
    plant();
    const before = doneAt(T0);
    run(preCompact('manual'));
    expect(stateBytes().equals(before)).toBe(false);
    expect(readState()).toMatchObject({ state: 'working', event: 'PreCompact' });
    run(postCompact('manual'));
    const s = readState();
    expect(s).toMatchObject({ state: 'done', event: 'PostCompact' });
    expect(s['updatedAt'] as number).toBeGreaterThan(T0 + 30 * 60_000);
    run(postCompact('auto'));
    expect(readState()).toMatchObject({ state: 'working', event: 'PostCompact' });
  });

  // The word class is spelled letter by letter, not as a range: under a UTF-8 locale a bash range such as `a-z` may
  // collate a non-ASCII lowercase letter into it, and the TypeScript grammar (ASCII only) refuses such a word.
  it('a non-ASCII lowercase word beside it, under LC_ALL=en_US.UTF-8 → the gate stays closed (today\'s bytes)', () => {
    writeCapsText(`at ${nowS()}\ncaps ${WORD} caf\u00e9\nend\n`);
    const before = doneAt(T0);
    run(preCompact('manual'), { LC_ALL: 'en_US.UTF-8' });
    expect(stateBytes().equals(before)).toBe(false);
    expect(readState()).toMatchObject({ state: 'working', event: 'PreCompact' });
  });

  // D-8354: the file is planted after the Stop, so the second of lease it has left covers the PreCompact's run alone,
  // and the case says so when a slow runner spent that second before the hook read its clock.
  it('control: the word listed in a current file (lease − 1 s, beside another word) → the skip', () => {
    const before = doneAt(T0);
    const at = nowS() - (SERVER_CAPS_LEASE_S - 1);
    writeCapsText(renderServerCaps(['hook-main-state-v1', WORD], at));
    run(preCompact('manual'));
    expect(nowS() - at, 'the file was still inside its lease when the hook had run').toBeLessThanOrEqual(SERVER_CAPS_LEASE_S);
    expect(stateBytes().equals(before)).toBe(true);
  });

  it('the hook\'s literals are the TypeScript ones: the word is in SERVER_CAPS, the file name and the lease match', () => {
    const src = fs.readFileSync(HOOK, 'utf8');
    expect(SERVER_CAPS).toContain(WORD);
    const gated = [...src.matchAll(/_hook_server_cap ([a-z0-9-]+); then hs_skip=1/g)].map((m) => m[1]);
    expect(gated, 'the compaction skip is gated on this one word').toEqual([WORD]);
    for (const g of gated) expect(SERVER_CAPS as readonly string[]).toContain(g);
    expect(src).toContain(`"$HOME/.ccrc/${SERVER_CAPS_FILE}"`);
    expect(src).toContain(`now - at <= ${SERVER_CAPS_LEASE_S} ))`);
  });

  // The bash grammar and the TypeScript one agree on every row: the hook engages exactly when `parseServerCaps`
  // answers ok and lists the word (the iterating case).
  //
  // D-8354: a row's `at` is relative to the moment its case runs, never to the file's collection. The table used to
  // read the clock once, at collection. On a macOS shard the row built 175 s old (a 5 s margin) was reached about
  // 5.5 s after collection: `parseServerCaps` judged it inside the 180 s lease, then the Stop and the PreCompact ran,
  // the hook read its clock past the lease, and the two "disagreed" about a file whose age the case itself had let
  // cross the boundary between the two reads. So each row
  // is a function of the moment, rendered after the Stop, and the parser is asked at both ends of the hook's run: the
  // hook reads its clock between them, a row's answer is one interval of that clock, and so the hook must answer what
  // both ends answer. A runner too slow for a row's 5 s margin says so, instead of naming a disagreement.
  type Row = (at: (dtS?: number) => string) => string;
  const symbolic = (dtS = 0): string => (dtS === 0 ? '<now>' : `<now${dtS > 0 ? '+' : ''}${dtS}>`);
  const atFrom = (nowSec: number) => (dtS = 0): string => String(nowSec + dtS);
  const TABLE: Row[] = [
    (at) => `at ${at()}\ncaps ${WORD}\nend\n`,
    (at) => `at ${at()}\ncaps\nend\n`,
    (at) => `at ${at()}\ncaps hook-main-state-v1 ${WORD}\nend\n`,
    (at) => `at ${at()}\ncaps ${WORD}\nend`,
    (at) => `at ${at()}\ncaps ${WORD}\nend\nx`,
    (at) => `at ${at()}\ncaps ${WORD}\n`,
    (at) => `at ${at()}\ncaps  ${WORD}\nend\n`,
    (at) => `at ${at()}\ncaps ${WORD} \nend\n`,
    (at) => `at ${at()}\ncaps ${WORD}\nEND\n`,
    (at) => `at  ${at()}\ncaps ${WORD}\nend\n`,
    (at) => `at ${at(-SERVER_CAPS_LEASE_S + 5)}\ncaps ${WORD}\nend\n`,
    (at) => `at ${at(-SERVER_CAPS_LEASE_S - 5)}\ncaps ${WORD}\nend\n`,
    (at) => `at ${at(60)}\ncaps ${WORD}\nend\n`,
    () => `at 123456789012\ncaps ${WORD}\nend\n`,
    (at) => `at ${at()}\ncaps ${'a'.repeat(65)} ${WORD}\nend\n`,
    (at) => `at ${at()}\ncaps ${WORD}\r\nend\n`,
    () => `\n`,
    () => ``,
  ];
  const advertised = (text: string, nowSec: number): boolean => {
    const p = parseServerCaps(text, nowSec);
    return p.ok && p.words.includes(WORD);
  };
  it.each(TABLE.map((row) => [JSON.stringify(row(symbolic)), row] as const))('grammar row %s: the hook and parseServerCaps agree', (_l, row) => {
    const before = doneAt(T0);
    const t0 = nowS();
    const text = row(atFrom(t0));
    writeCapsText(text);
    run(preCompact('auto'));
    const t1 = nowS();
    const want = advertised(text, t0);
    expect(advertised(text, t1), `the row's answer held from ${t0} to ${t1}, the seconds the hook read its clock in`).toBe(want);
    expect(stateBytes().equals(before), `parseServerCaps at ${t0}: ${JSON.stringify(parseServerCaps(text, t0))}`).toBe(want);
  });
});

describe('behind the word, a compaction writes no hookstate (D-5239, spec §5.8)', () => {
  beforeEach(() => { writeCaps(); });

  it('Stop at T0, then PreCompact → the file byte-identical', () => {
    const before = doneAt(T0);
    run(preCompact('auto'));
    expect(stateBytes().equals(before)).toBe(true);
  });

  it('then PostCompact auto → byte-identical; PostCompact manual → byte-identical (no fresh done, no badge)', () => {
    const before = doneAt(T0);
    run(preCompact('auto'));
    run(postCompact('auto'));
    expect(stateBytes().equals(before)).toBe(true);
    run(preCompact('manual'));
    run(postCompact('manual'));
    expect(stateBytes().equals(before)).toBe(true);
    expect(readState()).toMatchObject({ state: 'done', event: 'Stop', updatedAt: T0 });
  });

  it('the whole field set survives: the delegated pair, the roster, interrupted, waitPrev and aliveAt', () => {
    run(promptSubmit());
    run(subagentStart('a0000000000000001'));
    run(subagentStart('a0000000000000002'));
    run(stop([workflow('w00000001'), workflow('w00000002')]));
    const s = readState();
    expect(s).toMatchObject({ state: 'done', bgDelegated: 2, bgDelegatedKinds: 'workflow' });
    expect((s['subagents'] as unknown[]).length).toBe(2);
    // An earlier write's `interrupted`, a carried `waitPrev` and an `aliveAt` (fields other writers leave): the skip
    // must carry what it never computes.
    fs.writeFileSync(stateFile(), JSON.stringify({
      ...s, updatedAt: T0, interrupted: true, aliveAt: T0 + 5_000,
      waitPrev: { state: 'done', event: 'Stop', updatedAt: T0 - 1_000, ask: null, interrupted: false },
    }) + '\n');
    const before = stateBytes();
    for (const p of [preCompact('auto'), postCompact('auto'), preCompact('manual'), postCompact('manual')]) {
      run(p);
      expect(stateBytes().equals(before), (p as { hook_event_name: string; trigger: string }).hook_event_name).toBe(true);
    }
    expect(readState()).toMatchObject({
      bgDelegated: 2, bgDelegatedKinds: 'workflow', interrupted: true, aliveAt: T0 + 5_000,
      waitPrev: { state: 'done', event: 'Stop' },
    });
  });

  it('UserPromptSubmit at T1, then PreCompact and PostCompact auto → working at T1 kept (a mid-turn compaction)', () => {
    run(promptSubmit());
    const t1 = readState()['updatedAt'];
    const before = stateBytes();
    run(preCompact('auto'));
    run(postCompact('auto'));
    expect(stateBytes().equals(before)).toBe(true);
    expect(readState()).toMatchObject({ state: 'working', event: 'UserPromptSubmit', updatedAt: t1 });
  });

  it('waiting is carried with its ask', () => {
    run(askPreToolUse());
    const before = stateBytes();
    run(preCompact('auto'));
    run(postCompact('manual'));
    expect(stateBytes().equals(before)).toBe(true);
    expect(readState()).toMatchObject({ state: 'waiting' });
    expect(readState()['ask']).not.toBeNull();
  });

  it('no file → still no file', () => {
    run(preCompact('auto'));
    run(postCompact('manual'));
    expect(fs.existsSync(stateFile())).toBe(false);
  });

  it('the compaction helpers still run: PreCompact publishes the set, PostCompact commits its journal line', () => {
    fs.copyFileSync(HELPER_SRC, path.join(reg(), 'compact-card.mjs'));
    const proj = path.join(home, '.claude', 'projects', '-rig-repo');
    fs.mkdirSync(proj, { recursive: true });
    const transcript = path.join(proj, `${UUID}.jsonl`);
    fs.writeFileSync(transcript, '{"type":"user"}\n');
    const old = nowS() - 600;
    fs.utimesSync(transcript, old, old);
    const tree = path.join(home, 'repo');
    fs.mkdirSync(tree);
    const before = doneAt(T0);
    run({ ...preCompact('manual'), transcript_path: transcript, cwd: tree });
    expect(fs.existsSync(path.join(reg(), `${ID}.compactset`)), 'PreCompact\'s set').toBe(true);
    run({ ...postCompact('manual'), transcript_path: transcript, cwd: tree });
    const lines = fs.readFileSync(path.join(reg(), `${ID}.compactions`), 'utf8').split('\n').filter((l) => l !== '');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ trigger: 'manual', scope: 'main' });
    expect(stateBytes().equals(before), 'and the hookstate still untouched').toBe(true);
  });

  it('the turn marker is untouched by a compaction (it never recorded compactions)', () => {
    run(promptSubmit());
    run(stop());
    const mark = fs.readFileSync(markFile());
    run(preCompact('manual'));
    run(postCompact('manual'));
    expect(fs.readFileSync(markFile()).equals(mark)).toBe(true);
  });
});

// The full real sequence of an idle `/compact` is Stop, PreCompact, SubagentStop, PostCompact. Behind this word alone
// the SubagentStop between the two compaction events still rewrites the hookstate (a fresh `bucketSince`), so the
// visible effect needs Task 2's carry (D-5232) behind its own word `hook-main-state-v1`.
const compactionSubagentStop = (): object => ({
  session_id: UUID, transcript_path: TRANSCRIPT, cwd: '/rig/repo', prompt_id: '00000000-0000-4000-8000-0000000000c1',
  permission_mode: 'default', agent_id: 'a80efa07709a9de58', agent_type: '', effort: { level: 'medium' },
  hook_event_name: 'SubagentStop', stop_hook_active: false,
  agent_transcript_path: `/rig/fixhome/cfg/projects/-rig-repo/${UUID}/subagents/agent-a80efa07709a9de58.jsonl`,
  last_assistant_message: 'fixture', background_tasks: [], session_crons: [],
});
describe('the full real /compact sequence (D-5232 lands the SubagentStop half)', () => {
  it('both words advertised: Stop at T0, PreCompact, SubagentStop, PostCompact(manual) → the main state untouched', () => {
    writeCaps([WORD, 'hook-main-state-v1']);
    const before = doneAt(T0);
    run(preCompact('manual'));
    run(compactionSubagentStop());
    run(postCompact('manual'));
    // Not byte-identical: the compaction's own agent is a real agent, so its SubagentStop writes `aliveAt` (the carry's
    // one write). Every other field, the main state and its stamp among them, is the Stop's, byte for byte.
    const { aliveAt, ...rest } = readState();
    expect(typeof aliveAt).toBe('number');
    expect(JSON.stringify(rest)).toBe(JSON.stringify(JSON.parse(before.toString()) as object));
    expect(rest).toMatchObject({ state: 'done', event: 'Stop', updatedAt: T0 });
  });
  it('the same sequence behind dispatch-live-gate-v1 alone → the SubagentStop rewrites the main state (today\'s bytes)', () => {
    writeCaps([WORD]);
    doneAt(T0);
    run(preCompact('manual'));
    run(compactionSubagentStop());
    expect(readState()['updatedAt'] as number).toBeGreaterThan(T0 + 30 * 60_000);
    expect(readState()).not.toHaveProperty('aliveAt');
  });
});

// How many SubagentStops a typed `/compact` fires between PreCompact and PostCompact, by version range, as the committed
// corpus measures it: one up to 2.1.299, two from 2.1.311 (the recapture of 2026-11-06; whether that is a second compaction
// agent or a retry against the rig's mock, whose reply is no summary, the fixtures do not say). Each range ends at a
// captured version: a later version comes with its recapture and a hand edit here, and until then it reds below.
const COMPACT_STOPS: ReadonlyArray<{ from: string; to: string; stops: number }> = [
  { from: '2.1.280', to: '2.1.299', stops: 1 },
  { from: '2.1.311', to: '2.1.319', stops: 2 },
];
const byVersion = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true });
const stopsFor = (v: string): number | undefined =>
  COMPACT_STOPS.find((r) => byVersion(v, r.from) >= 0 && byVersion(v, r.to) <= 0)?.stops;
type CapEv = { event: string; payload: Record<string, unknown> };
const capture = (v: string, scenario: string): CapEv[] =>
  (JSON.parse(fs.readFileSync(path.join(DELEGATION, v, `${scenario}.json`), 'utf8')) as { events: CapEv[] }).events;
const corpusVersions = fs.readdirSync(DELEGATION).filter((d) => /^\d+\.\d+\.\d+$/.test(d)
  && fs.existsSync(path.join(DELEGATION, d, 'clear-compact-resume.json'))).sort(byVersion);
/** What is wrong with a capture's compaction, as words; [] when it holds: the Stop, PreCompact(manual), only SubagentStops,
 *  each the compaction's own agent (no type, an id no SubagentStart of the capture named), PostCompact(manual), the count
 *  pinned for the version, and no `/compact` prompt. */
const compactionProblems = (v: string, ev: CapEv[]): string[] => {
  const out: string[] = [];
  const prompts = ev.filter((e) => e.event === 'UserPromptSubmit').map((e) => String(e.payload['prompt']));
  if (prompts.some((p) => p === '/compact' || p.startsWith('/compact '))) out.push('a /compact prompt');
  const pre = ev.findIndex((e) => e.event === 'PreCompact');
  const post = ev.findIndex((e, i) => i > pre && e.event === 'PostCompact');
  if (pre < 1 || post < 0) return [...out, 'no PreCompact after an event, or no PostCompact after it'];
  if (ev[pre - 1]!.event !== 'Stop') out.push('no Stop before the PreCompact');
  const between = ev.slice(pre + 1, post);
  if (between.some((e) => e.event !== 'SubagentStop')) out.push('an event other than SubagentStop between them');
  const started = new Set(ev.filter((e) => e.event === 'SubagentStart').map((e) => String(e.payload['agent_id'])));
  for (const s of between) {
    if (s.payload['agent_type'] !== '') out.push(`a stop with agent type ${JSON.stringify(s.payload['agent_type'])}`);
    if (started.has(String(s.payload['agent_id']))) out.push('a stop whose id a SubagentStart named');
  }
  if (between.length !== stopsFor(v)) out.push(`${between.length} stops, where ${String(stopsFor(v))} is pinned for ${v}`);
  if (ev[pre]!.payload['trigger'] !== 'manual' || ev[post]!.payload['trigger'] !== 'manual') out.push('a trigger other than manual');
  return out;
};

// Measured first (plan Task 10), and on every recapture since: a typed `/compact` fires PreCompact, the compaction's own
// SubagentStops (as many as COMPACT_STOPS pins for the version) and PostCompact, and NO UserPromptSubmit. So the hook has
// no `/compact` prompt arm, and this pin holds the corpus to that: a build that starts sending one fails here and needs
// the arm.
describe('a typed /compact sends no UserPromptSubmit (the measurement the tail is written to)', () => {
  it('the corpus holds the scenario', () => { expect(corpusVersions.length).toBeGreaterThan(0); });
  it.each(corpusVersions)('%s: Stop, PreCompact(manual), the compaction\'s SubagentStops (count pinned by version), PostCompact(manual); no /compact prompt', (v) => {
    const ev = capture(v, 'clear-compact-resume');
    expect(compactionProblems(v, ev)).toEqual([]);
    const pre = ev.findIndex((e) => e.event === 'PreCompact');
    const post = ev.findIndex((e, i) => i > pre && e.event === 'PostCompact');
    // The fixtures above copy these key sets.
    expect(Object.keys(ev[pre]!.payload).sort()).toEqual(Object.keys(preCompact()).sort());
    expect(Object.keys(ev[post]!.payload).sort()).toEqual(Object.keys(postCompact()).sort());
  });
  it('the check can fail: a SubagentStart naming a compaction stop\'s id, or a count off the pin, is a problem', () => {
    const v = corpusVersions[corpusVersions.length - 1]!;
    const ev = capture(v, 'clear-compact-resume');
    const pre = ev.findIndex((e) => e.event === 'PreCompact');
    const named: CapEv = { event: 'SubagentStart', payload: { agent_id: ev[pre + 1]!.payload['agent_id'], agent_type: '' } };
    expect(compactionProblems(v, [...ev.slice(0, pre - 1), named, ...ev.slice(pre - 1)])).toContain('a stop whose id a SubagentStart named');
    expect(compactionProblems(v, [...ev.slice(0, pre + 1), ...ev.slice(pre + 2)]).join(' ')).toMatch(/stops, where \d is pinned/);
  });
});

// The roster block (D-5232) handles each SubagentStop on its own: it removes only the roster entry with the stop's id, a
// no-op for the compaction's agent, and re-reads and keeps the main state the file holds. So from 2.1.311, where a
// compaction fires two stops, the second does what the first does. This row replays each such version's own compaction
// payloads, PreCompact through PostCompact, through the real hook, from three setups taken from 2.1.319's captures (an
// idle `done`, a mid-turn `working`, and `agent-iso-bg`'s first Stop, whose `background_tasks` holds the running agent,
// so the delegated pair is live: at least 1, `subagent`), each with one unrelated roster entry, with `hook-main-state-v1`
// advertised and without it, and holds the state, the roster and the pair kept after each stop and after PostCompact.
// The corpus holds no live ask, no subagent's own wait (no AskUserQuestion or PermissionRequest in any capture) and
// nothing that sets `interrupted`, so those keys are held only at their setup values.
describe('every compaction SubagentStop keeps the main state, two from 2.1.311 as one before', () => {
  const twoStop = corpusVersions.filter((v) => stopsFor(v) === 2);
  const SETUPS: Record<'done' | 'working' | 'done, delegated', () => CapEv> = {
    done: () => { const ev = capture('2.1.319', 'clear-compact-resume'); return ev[ev.findIndex((e) => e.event === 'PreCompact') - 1]!; },
    working: () => {
      const ev = capture('2.1.319', 'clear-compact-resume');
      return ev.slice(0, ev.findIndex((e) => e.event === 'PreCompact')).reverse().find((e) => e.event === 'UserPromptSubmit')!;
    },
    'done, delegated': () => capture('2.1.319', 'agent-iso-bg').find((e) => e.event === 'Stop')!,
  };
  /** An unrelated agent's SubagentStart, from 2.1.319's agent-plain capture: it carries its own id. */
  const unrelatedStart = (): CapEv => capture('2.1.319', 'agent-plain').find((e) => e.event === 'SubagentStart')!;
  /** Kept through every stop, on both branches. */
  const KEPT = ['state', 'ask', 'interrupted', 'subagents', 'waitBy', 'waitPrev', 'bgDelegated', 'bgDelegatedKinds'] as const;
  const pick = (s: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> => Object.fromEntries(keys.map((k) => [k, s[k]]));
  const CAPS = { 'hook-main-state-v1 advertised': [WORD, 'hook-main-state-v1'], 'hook-main-state-v1 not advertised': [WORD] } as const;

  const replay = (caps: readonly string[], setup: CapEv, v: string): { before: Record<string, unknown>; stops: Array<Record<string, unknown>>; end: Record<string, unknown>; t0: number } => {
    writeCaps(caps);
    const env = { CLAUDE_CODE_SESSION_ID: String(setup.payload['session_id']) };
    const go = (p: Record<string, unknown>): void => {
      const r = spawnSync('bash', [HOOK], { input: JSON.stringify(p), encoding: 'utf8', env: { ...hookEnv(), ...env } });
      expect(r.status, `${String(p['hook_event_name'])}: exit 0`).toBe(0);
    };
    go(setup.payload);
    go(unrelatedStart().payload);
    // The setup's clock readings fixed, so two runs compare: the stamp and the roster entry's start.
    const s = readState();
    const subs = (s['subagents'] as Array<Record<string, unknown>>).map((e) => ({ ...e, startedAt: T0 }));
    fs.writeFileSync(stateFile(), JSON.stringify({ ...s, updatedAt: T0, subagents: subs }) + '\n');
    const before = readState();
    const t0 = Date.now();
    const stops: Array<Record<string, unknown>> = [];
    const ev = capture(v, 'clear-compact-resume');
    const pre = ev.findIndex((e) => e.event === 'PreCompact');
    const post = ev.findIndex((e, i) => i > pre && e.event === 'PostCompact');
    for (const e of ev.slice(pre, post + 1)) {
      go(e.payload);
      if (e.event === 'SubagentStop') stops.push(readState());
    }
    const end = readState();
    fs.rmSync(stateFile());
    return { before, stops, end, t0 };
  };
  const rows = twoStop.flatMap((v) => Object.keys(CAPS).flatMap((c) => Object.keys(SETUPS).map((s) => [v, c, s] as const)));

  it('the corpus has two-stop versions to replay', () => { expect(twoStop.length).toBeGreaterThan(0); });
  it.each(rows)('%s, %s, from %s: each SubagentStop keeps the main state, and the end equals 2.1.299\'s one-stop run', (v, c, from) => {
    const hms = c === 'hook-main-state-v1 advertised';
    const caps = CAPS[c as keyof typeof CAPS];
    const setup = SETUPS[from as keyof typeof SETUPS]();
    const two = replay(caps, setup, v);
    expect(two.before['state']).toBe(from === 'working' ? 'working' : 'done');
    expect((two.before['subagents'] as unknown[]).length, 'the unrelated roster entry').toBe(1);
    if (from === 'done, delegated') {
      expect(two.before['bgDelegated'] as number, 'the delegated pair is live').toBeGreaterThanOrEqual(1);
      expect(two.before['bgDelegatedKinds'], 'the delegated pair is live').toBe('subagent');
    }
    expect(two.stops).toHaveLength(2);
    for (const k of two.stops) {
      expect(pick(k, KEPT)).toEqual(pick(two.before, KEPT));
      if (hms) {
        // The stamp stands, and the carry's one write is `aliveAt`: the hook wrote at this stop.
        expect(pick(k, ['event', 'updatedAt'])).toEqual(pick(two.before, ['event', 'updatedAt']));
        expect(k['aliveAt'] as number).toBeGreaterThanOrEqual(two.t0);
      } else {
        // Today's branch (`_hook_keep_stamp`): the stop writes a fresh stamp over a state it keeps.
        expect(k['event']).toBe('SubagentStop');
        expect(k['updatedAt'] as number).toBeGreaterThanOrEqual(two.t0);
      }
    }
    // PostCompact writes nothing under the word (D-5239), so the end still holds what the stops kept.
    expect(pick(two.end, KEPT), 'kept after PostCompact').toEqual(pick(two.before, KEPT));
    const one = replay(caps, setup, '2.1.299');
    expect(one.stops).toHaveLength(1);
    // `aliveAt` is a fresh reading on both branches; `updatedAt` only without the word (with it the stamp stands at T0).
    const timeless = (s: Record<string, unknown>): Record<string, unknown> => {
      const { aliveAt: _a, updatedAt: u, ...rest } = s;
      return hms ? { ...rest, updatedAt: u } : rest;
    };
    expect(timeless(two.end)).toEqual(timeless(one.end));
  });
});

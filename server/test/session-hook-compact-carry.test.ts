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
const run = (payload: object): void => {
  const r = spawnSync('bash', [HOOK], { input: JSON.stringify(payload), encoding: 'utf8', env: hookEnv() });
  expect(r.status, 'the hook contract: exit 0 on every path').toBe(0);
  expect(r.stdout, 'a compaction prints nothing').toBe('');
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

  it('control: the word listed in a current file (lease − 1 s, beside another word) → the skip', () => {
    writeCaps(['hook-main-state-v1', WORD], SERVER_CAPS_LEASE_S - 1);
    const before = doneAt(T0);
    run(preCompact('manual'));
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
  const n = nowS();
  const TABLE: string[] = [
    `at ${n}\ncaps ${WORD}\nend\n`,
    `at ${n}\ncaps\nend\n`,
    `at ${n}\ncaps hook-main-state-v1 ${WORD}\nend\n`,
    `at ${n}\ncaps ${WORD}\nend`,
    `at ${n}\ncaps ${WORD}\nend\nx`,
    `at ${n}\ncaps ${WORD}\n`,
    `at ${n}\ncaps  ${WORD}\nend\n`,
    `at ${n}\ncaps ${WORD} \nend\n`,
    `at ${n}\ncaps ${WORD}\nEND\n`,
    `at  ${n}\ncaps ${WORD}\nend\n`,
    `at ${n - SERVER_CAPS_LEASE_S + 5}\ncaps ${WORD}\nend\n`,
    `at ${n - SERVER_CAPS_LEASE_S - 5}\ncaps ${WORD}\nend\n`,
    `at ${n + 60}\ncaps ${WORD}\nend\n`,
    `at 123456789012\ncaps ${WORD}\nend\n`,
    `at ${n}\ncaps ${'a'.repeat(65)} ${WORD}\nend\n`,
    `at ${n}\ncaps ${WORD}\r\nend\n`,
    `\n`,
    ``,
  ];
  it.each(TABLE.map((t) => [JSON.stringify(t), t]))('grammar row %s: the hook and parseServerCaps agree', (_l, text) => {
    writeCapsText(text);
    const p = parseServerCaps(text, nowS());
    const want = p.ok && p.words.includes(WORD);
    const before = doneAt(T0);
    run(preCompact('auto'));
    expect(stateBytes().equals(before), `parseServerCaps: ${JSON.stringify(p)}`).toBe(want);
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

// Measured first (plan Task 10): a typed `/compact` fires PreCompact, a SubagentStop (the compaction's own agent)
// and PostCompact, and NO UserPromptSubmit. On every build in the committed corpus (2.1.280 to 2.1.292); a workstation
// rig run on 2.1.300 measured the same sequence (recorded in the PR). So the hook has no `/compact` prompt arm, and
// this pin holds the corpus to that: a build that starts sending one fails here and needs the arm.
describe('a typed /compact sends no UserPromptSubmit (the measurement the tail is written to)', () => {
  const versions = fs.readdirSync(DELEGATION).filter((d) => /^\d+\.\d+\.\d+$/.test(d)
    && fs.existsSync(path.join(DELEGATION, d, 'clear-compact-resume.json')));
  it('the corpus holds the scenario', () => { expect(versions.length).toBeGreaterThan(0); });
  it.each(versions)('%s: Stop, PreCompact(manual), SubagentStop, PostCompact(manual); no /compact prompt', (v) => {
    const cap = JSON.parse(fs.readFileSync(path.join(DELEGATION, v, 'clear-compact-resume.json'), 'utf8')) as
      { events: Array<{ event: string; payload: Record<string, unknown> }> };
    const ev = cap.events;
    const prompts = ev.filter((e) => e.event === 'UserPromptSubmit').map((e) => String(e.payload['prompt']));
    expect(prompts.filter((p) => p === '/compact' || p.startsWith('/compact '))).toEqual([]);
    const pre = ev.findIndex((e) => e.event === 'PreCompact');
    expect(pre).toBeGreaterThan(0);
    expect(ev.slice(pre - 1, pre + 3).map((e) => e.event)).toEqual(['Stop', 'PreCompact', 'SubagentStop', 'PostCompact']);
    expect(ev[pre]!.payload['trigger']).toBe('manual');
    // The fixtures above copy these key sets.
    expect(Object.keys(ev[pre]!.payload).sort()).toEqual(Object.keys(preCompact()).sort());
    expect(Object.keys(ev[pre + 2]!.payload).sort()).toEqual(Object.keys(postCompact()).sort());
  });
});


// The session hook's mail-hold block (mid-turn mail plan 2026-11-19, Task 5.2; spec §3.5 and §6): the builtin read of
// the `mailhold` route field, the refusal of a gated act (A) and the notice line (E), built by the hook's own envelope
// builders from the text `ccd/lib/mail-hold.jq` returns, the two arming markers, the shadow log with its seen file and
// rotation, and the `Stop` line.
//
// Runs ccd/session-hook.sh for real in a fixture HOME, as the other session-hook suites do, spawned through
// `ghContainedEnv` with the systemd and tmux poisons (the tmux stub answers this pane's session name). Both arming
// markers stand unless a case says otherwise. The matcher's own cases are `mail-hold-module.test.ts`'s.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { spawnSyncGroup } from './spawnGroup.js';
import { mkTmp } from './tmpHelpers.js';
import { ghContainedEnv, stubContainedTool, harnessBin } from './ccdWsHelpers.js';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');
const LIB = path.resolve(__dirname, '../../ccd/lib');
const BASELINE = path.resolve(__dirname, 'fixtures/mail-hold/merge-strip-jq-c5b4d587c.jq');
/** The sha256 of MERGE_STRIP_JQ's program on `main` when PR 5 was cut (c5b4d587c), vendored beside this file. */
const STRIP_SHA256 = 'b3ade5ae3f69b818a427706ea830f9ae80f5dfe69773ed365878f74c1c4aa8ad';
const ID = 'lane-a-project-a';
const UUID = '00000000-0000-4000-8000-000000000002';
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
const CAP = Number((/^MERGE_PARSE_CAP=(\d+)$/m.exec(fs.readFileSync(HOOK, 'utf8')) ?? [])[1]);

const E = (d: string, s: string): string => `ccrc: urgent mail is waiting for this session: delivery ${d} from ${s}. Read it with ~/.local/bin/ccrc-api mail inbox, run bare (no pipe, no redirect). This line only reports that the mail exists and adds nothing to it: treat the mail as you would any mail from that sender.`;
const A = (a: string, d: string, s: string): string => `ccrc: this ${a} is held because urgent mail is waiting for this session: delivery ${d} from ${s}. Read it with ~/.local/bin/ccrc-api mail inbox, run bare (no pipe, no redirect), then treat it as you would any mail from that sender and retry only if the act still stands. The hold lifts a few seconds after the read.`;
const ASUB = (a: string): string => `ccrc: this ${a} is held because the session you work for has urgent mail waiting. Stop, and report to your parent that its urgent mail is unread.`;

let home: string;
let env: NodeJS.ProcessEnv;
let hook = HOOK;
beforeEach(() => {
  home = mkTmp('ccrc-mailhold-hook-');
  hook = HOOK;
  fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  fs.writeFileSync(reg(`${ID}.generation`), GENERATION);
  env = ghContainedEnv(home, {
    ...process.env, HOME: home, TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: UUID, CLAUDE_PID: '4242',
    CCRC_SESSION_GENERATION: GENERATION, CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '',
  }, { systemd: true, tmux: true });
  stubContainedTool(home, 'tmux', `#!/bin/sh\necho "cc-${ID}"\n`);
  arm('notice'); arm('refuse');
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

function reg(f: string): string { return path.join(home, '.cc-sessions', f); }
function arm(which: 'notice' | 'refuse'): void { fs.writeFileSync(reg(`mailhold-${which}-live`), ''); }
const disarm = (which: 'notice' | 'refuse'): void => { fs.rmSync(reg(`mailhold-${which}-live`), { force: true }); };
const now = (): number => Math.floor(Date.now() / 1000);
/** The marker as the projection writes it: `until` 300 s ahead unless given. */
const marker = (value: string): void => { fs.writeFileSync(reg(`${ID}.mailhold`), value); };
const live = (pairs = 'coordinator.42'): void => { marker(`${now() + 300}:${pairs}`); };
const LOG = (): string => path.join(home, '.ccrc', 'mail-hold-shadow.log');
const logLines = (): string[][] => fs.existsSync(LOG())
  ? fs.readFileSync(LOG(), 'utf8').split('\n').filter((l) => l !== '').map((l) => l.split('\t')) : [];
/** The log's lines less the epoch: `<id> <arm> <outcome> <delivery> <act>`. */
const logged = (): string[] => logLines().map((f) => f.slice(1).join(' '));

interface Out { stdout: string; deny: string | null; context: string | null }
const run = (payload: object): Out => {
  const r = spawnSyncGroup('bash', [hook], { input: JSON.stringify(payload), encoding: 'utf8', env, timeout: 60_000 });
  expect(r.error, 'the spawn itself did not fail').toBeUndefined();
  expect(r.status, 'the hook contract: exit 0 on every path').toBe(0);
  expect(r.stderr, 'the hook is silent on stderr').toBe('');
  const line = r.stdout.trim();
  if (line === '') return { stdout: '', deny: null, context: null };
  const j = JSON.parse(line) as { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string; additionalContext?: string } };
  const h = j.hookSpecificOutput ?? {};
  return { stdout: line, deny: h.permissionDecision === 'deny' ? String(h.permissionDecisionReason) : null, context: h.additionalContext ?? null };
};
const base = (extra: object = {}): object => ({ hook_event_name: 'PreToolUse', session_id: UUID, cwd: home, ...extra });
const bash = (command: string, extra: object = {}): Out => run(base({ tool_name: 'Bash', tool_input: { command }, ...extra }));
const read = (file = path.join(home, 'notes.txt'), extra: object = {}): Out => run(base({ tool_name: 'Read', tool_input: { file_path: file }, ...extra }));
const stop = (): Out => run({ hook_event_name: 'Stop', session_id: UUID, cwd: home, stop_hook_active: false });
const denyEnvelope = (reason: string): string => JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
const nudgeEnvelope = (c: string): string => JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: c } });

describe('no marker: the call pays nothing new', () => {
  it('an ungated Read with no marker makes the pinned number of jq calls, none of them the block\'s', () => {
    const realJq = spawnSync('sh', ['-c', 'command -v jq'], { encoding: 'utf8' }).stdout.trim();
    expect(realJq).not.toBe('');
    const calls = path.join(home, 'jq-calls');
    fs.writeFileSync(path.join(harnessBin(home), 'jq'), `#!/bin/sh\nprintf '%s\\037\\n' "$*" >> '${calls}'\nexec '${realJq}' "$@"\n`, { mode: 0o755 });
    read();   // the warm-up: a first call may write state a later one only reads
    fs.writeFileSync(calls, '');
    expect(read()).toEqual({ stdout: '', deny: null, context: null });
    const argv = fs.readFileSync(calls, 'utf8').split('\u001f\n').filter((l) => l !== '');
    expect(argv.length, 'a floor: the wrapper saw the hook\'s own calls, so this case cannot pass vacuously').toBeGreaterThan(0);
    expect(argv.filter((a) => a.includes('mail-hold') || a.includes('mail_hold') || a.includes('--arg pairs')), 'a call of the block').toEqual([]);
    // THE PINNED COUNT: update it, with its reason, when another arm adds a jq call to an ungated Read.
    expect(argv.length, `the jq calls of an ungated Read with no marker:\n${argv.map((a) => a.slice(0, 80)).join('\n')}`).toBe(JQ_CALLS_NO_MARKER);
    expect(logLines()).toEqual([]);
  });
});
/** Measured on this PR's tip: the jq calls one ungated main-thread Read makes with no marker (the payload parse and the
 *  hookstate write among them). The block adds none. */
const JQ_CALLS_NO_MARKER = 6;

describe('a live marker', () => {
  it('an ungated main-thread call gets E\'s line, built by _hook_nudge_json, and proceeds', () => {
    live();
    expect(read().stdout).toBe(nudgeEnvelope(E('42', 'its coordinator')));
    expect(bash('ls -la').stdout).toBe(nudgeEnvelope(E('42', 'its coordinator')));
  });
  it('a gated main-thread call gets A\'s main-thread text, built by _hook_deny_json', () => {
    live('overlord.7');
    expect(bash('git push origin HEAD').stdout).toBe(denyEnvelope(A('git push', '7', 'the Overlord')));
  });
  it('the two paths the strip feeds, end to end: a quoted target (unquoted by mh_prep in the hook\'s own strip call), and the over-cap kinds', () => {
    live();
    expect(bash('git merge "origin/main"').deny).toBe(A('git merge', '42', 'its coordinator'));
    expect(bash("git rebase 'main'").deny).toBe(A('git rebase', '42', 'its coordinator'));
    expect(bash('git pull origin "HEAD"').deny).toBe(A('git pull', '42', 'its coordinator'));
    expect(bash('git merge --no-ff -m "sync (weekly)" origin/main').deny).toBe(A('git merge', '42', 'its coordinator'));
    expect(bash('git merge feature-x -m "x; git merge main y"').context).toBe(E('42', 'its coordinator'));
    const over = `echo ${'x'.repeat(CAP)} && git push`;
    expect(bash(over).deny).toMatch(new RegExp(`^${A('git push', '42', 'its coordinator').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} This command is ${Buffer.byteLength(over)} bytes`));
    expect(bash(`echo ${'y'.repeat(CAP + 10)}`).context).toBe(E('42', 'its coordinator'));
  });
});

describe('the strip\'s pre-filter reads the command, not the whole payload (fix round 1, F7)', () => {
  it('a working directory named after a gated verb starts no strip call of the block; a gated command does', () => {
    const realJq = spawnSync('sh', ['-c', 'command -v jq'], { encoding: 'utf8' }).stdout.trim();
    const calls = path.join(home, 'jq-calls');
    fs.writeFileSync(path.join(harnessBin(home), 'jq'), `#!/bin/sh\nprintf '%s\\037\\n' "$*" >> '${calls}'\nexec '${realJq}' "$@"\n`, { mode: 0o755 });
    const named = path.join(home, 'merge-push-demo');
    fs.mkdirSync(named);
    live();
    const strips = (command: string, cwd: string): number => {
      fs.writeFileSync(calls, '');
      expect(bash(command, { cwd }).context, command).toBe(E('42', 'its coordinator'));
      return fs.readFileSync(calls, 'utf8').split('\u001f\n').filter((a) => a.includes('mh_prep')).length;
    };
    expect(strips('ls', named), 'cwd holds merge and push, the command neither').toBe(0);
    expect(strips('ls', home)).toBe(0);
    // The field after the command: the read ends at the command's closing quote.
    fs.writeFileSync(calls, '');
    expect(run(base({ tool_name: 'Bash', tool_input: { command: 'ls', description: 'Push the branch, then merge it' } })).context).toBe(E('42', 'its coordinator'));
    expect(fs.readFileSync(calls, 'utf8').split('\u001f\n').filter((a) => a.includes('mh_prep')), 'a description naming the verbs').toEqual([]);
    expect(strips('git status && git log --grep push', home), 'CONTROL: a command holding a gated word is stripped').toBe(1);
  });
});

describe('a lease that does not hold (D3)', () => {
  it('an expired marker: the gated call proceeds, and the log records `lapsed`', () => {
    marker(`${now() - 1}:coordinator.42`);
    expect(bash('git push').stdout).toBe('');
    expect(read().stdout).toBe('');
    expect(logged()).toEqual([`${ID} refuse lapsed 42 git-push`]);
  });
  it('a marker past now + 360: the gated call proceeds, and the log records `far`', () => {
    marker(`${now() + 400}:coordinator.42`);
    expect(bash('git push').stdout).toBe('');
    expect(logged()).toEqual([`${ID} refuse far 42 git-push`]);
  });
  it('a marker at exactly now + 360 holds (the clock read before and after; run again when they differ)', () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const before = now();
      marker(`${before + 360}:coordinator.42`);
      const out = bash('git push');
      if (now() !== before) continue;
      expect(out.deny).toBe(A('git push', '42', 'its coordinator'));
      return;
    }
    throw new Error('the clock moved during every attempt');
  });
  it('a symlinked marker holds nothing, and logs nothing', () => {
    const target = path.join(home, 'elsewhere');
    fs.writeFileSync(target, `${now() + 300}:coordinator.42`);
    fs.symlinkSync(target, reg(`${ID}.mailhold`));
    expect(bash('git push').stdout).toBe('');
    expect(read().stdout).toBe('');
    expect(logLines()).toEqual([]);
  });
  it.each(['garbage', `${now() + 300}:peer.42`, `${now() + 300}:coordinator.042`, `0${now() + 300}:coordinator.42`, ''])(
    'a malformed marker %j holds nothing, and logs nothing', (v) => {
      marker(v);
      expect(bash('git push').stdout).toBe('');
      expect(read().stdout).toBe('');
      expect(logLines()).toEqual([]);
    });
  it('with $REG/mail-disabled present, nothing is refused or said', () => {
    live();
    fs.writeFileSync(reg('mail-disabled'), '');
    expect(bash('git push').stdout).toBe('');
    expect(read().stdout).toBe('');
    expect(logLines()).toEqual([]);
  });
});

describe('a deny an earlier arm built is kept byte for byte', () => {
  it('the worker merge deny: its envelope is the same with and without a live marker', () => {
    fs.writeFileSync(reg(`${ID}.hold`), 'program:project-a wave:2/5 run:17');
    const without = bash('gh pr merge 42').stdout;
    expect(without).toContain('"permissionDecision":"deny"');
    live();
    expect(bash('gh pr merge 42').stdout).toBe(without);
    expect(logLines(), 'the block did not run').toEqual([]);
  });
  it('the fan-out routing deny: an Agent call that names no model keeps its deny, and gets no E line', () => {
    const agent = (): Out => run(base({ tool_name: 'Agent', tool_input: { description: 'd', prompt: 'p' } }));
    const without = agent().stdout;
    expect(without).toContain('"permissionDecision":"deny"');
    live();
    expect(agent().stdout).toBe(without);
  });
});

describe('advice is overwritten', () => {
  it('the graph arm\'s Read nudge does not suppress E\'s line', () => {
    const tree = path.join(home, 'tree');
    fs.mkdirSync(path.join(tree, 'src'), { recursive: true });
    const git = (...a: string[]): string => spawnSync('git',
      ['-C', tree, '-c', 'user.email=f@example.invalid', '-c', 'user.name=fixture', ...a], { encoding: 'utf8' }).stdout.trim();
    git('init', '-q');
    fs.writeFileSync(path.join(tree, 'src', 'a.ts'), 'export {};\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'c');
    fs.mkdirSync(path.join(tree, 'graphify-out'));
    fs.writeFileSync(path.join(tree, 'graphify-out', 'graph.json'), `{\n  "hyperedges": [],\n  "built_at_commit": "${git('rev-parse', 'HEAD')}"\n}\n`);
    fs.writeFileSync(path.join(tree, 'graphify-out', '.graphify_engine'), '0.9.9\n');
    const src = path.join(tree, 'src', 'a.ts');
    const nudge = read(src, { cwd: tree });
    expect(nudge.context, 'CONTROL: the graph arm nudges this Read').not.toBeNull();
    expect(nudge.context).not.toBe(E('42', 'its coordinator'));
    live();
    expect(read(src, { cwd: tree }).context).toBe(E('42', 'its coordinator'));
  });
  it('under a live marker the landing advisory\'s sync gives E\'s line, not the advisory\'s (A shadow)', () => {
    disarm('refuse');
    const advisory = bash('git merge origin/main').context;
    expect(advisory, 'CONTROL: the advisory speaks with no marker').toMatch(/^ccrc landing advisory:/);
    live();
    expect(bash('git merge origin/main').context).toBe(E('42', 'its coordinator'));
  });
});

describe('the thread', () => {
  const joined = (): void => { fs.writeFileSync(reg(`${ID}.joined`), 'agent-a1\n'); };
  it('a joined subagent\'s `git push` gets the subagent text, and its ungated call gets no line', () => {
    joined();
    live();
    expect(bash('git push', { agent_id: 'agent-a1' }).deny).toBe(ASUB('git push'));
    expect(read(undefined, { agent_id: 'agent-a1' }).stdout).toBe('');
  });
  it('an unjoined agent_id gets the main-thread text, and E\'s line', () => {
    live();
    expect(bash('git push', { agent_id: 'agent-zz' }).deny).toBe(A('git push', '42', 'its coordinator'));
    expect(read(undefined, { agent_id: 'agent-zz' }).context).toBe(E('42', 'its coordinator'));
  });
});

describe('a missing module (D3)', () => {
  it('nothing is denied or said, and the log records `module-missing` once a session and hold', () => {
    const dir = path.join(home, 'hookcopy');
    fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
    fs.copyFileSync(HOOK, path.join(dir, 'session-hook.sh'));
    for (const f of fs.readdirSync(LIB)) if (f !== 'mail-hold.jq') fs.copyFileSync(path.join(LIB, f), path.join(dir, 'lib', f));
    hook = path.join(dir, 'session-hook.sh');
    live();
    expect(bash('git push').stdout).toBe('');
    expect(read().stdout).toBe('');
    expect(logged()).toEqual([`${ID} - module-missing 42 -`]);
    live('coordinator.43');
    expect(read().stdout).toBe('');
    expect(logged()).toEqual([`${ID} - module-missing 42 -`, `${ID} - module-missing 43 -`]);
  });
});

describe('shadow (P7)', () => {
  it('neither arming marker: nothing is refused or said, and the log records `would` for the line and the refusal', () => {
    disarm('notice'); disarm('refuse');
    live();
    expect(bash('git push').stdout).toBe('');
    expect(read().stdout).toBe('');
    expect(logged()).toEqual([`${ID} refuse would 42 git-push`, `${ID} notice would 42 -`]);
  });
  it('only mailhold-notice-live: E\'s line is said, and A is `would`', () => {
    disarm('refuse');
    live();
    expect(read().context).toBe(E('42', 'its coordinator'));
    expect(bash('git push').context).toBe(E('42', 'its coordinator'));
    expect(logged()).toEqual([`${ID} notice did 42 -`, `${ID} refuse would 42 git-push`]);
  });
  it('only mailhold-refuse-live: A refuses, and E is `would`', () => {
    disarm('notice');
    live();
    expect(read().stdout).toBe('');
    expect(bash('git push').deny).toBe(A('git push', '42', 'its coordinator'));
    expect(logged()).toEqual([`${ID} notice would 42 -`, `${ID} refuse did 42 git-push`]);
  });
});

describe('the outcome is in the seen key (N2)', () => {
  it('a hold logged `refuse would` that then lapses logs `refuse lapsed` once', () => {
    disarm('refuse');
    live();
    bash('git push');
    marker(`${now() - 5}:coordinator.42`);
    bash('git push');
    bash('git push');
    expect(logged()).toEqual([`${ID} refuse would 42 git-push`, `${ID} notice did 42 -`, `${ID} refuse lapsed 42 git-push`]);
  });
  it('a hold logged `notice would` whose E arming marker is then touched logs `notice did` once', () => {
    disarm('notice');
    live();
    read();
    arm('notice');
    read();
    read();
    expect(logged()).toEqual([`${ID} notice would 42 -`, `${ID} notice did 42 -`]);
  });
});

describe('the log\'s bound (P8)', () => {
  it('a 300-call hold in shadow leaves one `notice would` line, its refusals one per act and outcome, and its stops one per turn', () => {
    disarm('notice'); disarm('refuse');
    live();
    for (let i = 0; i < 300; i += 1) {
      if (i % 50 === 0) bash('git push');
      else if (i % 50 === 1) bash('git commit -m x');
      else if (i % 100 === 2) stop();
      else read();
    }
    const lines = logged();
    expect(lines.filter((l) => l === `${ID} notice would 42 -`)).toHaveLength(1);
    expect(lines.filter((l) => l === `${ID} refuse would 42 git-push`)).toHaveLength(1);
    expect(lines.filter((l) => l === `${ID} refuse would 42 git-commit`)).toHaveLength(1);
    expect(lines.filter((l) => l === `${ID} stop - 42 -`)).toHaveLength(3);
    expect(lines).toHaveLength(6);
    const seen = fs.readFileSync(path.join(home, '.ccrc', 'mail-hold-shadow.d', ID), 'utf8');
    expect(seen.split('\n')[0]).toBe('coordinator.42');
  }, 300_000);
  it('a new pair set starts the seen file again', () => {
    disarm('notice');
    live('coordinator.42');
    read();
    read();
    live('coordinator.42,overlord.50');
    read();
    expect(logged()).toEqual([`${ID} notice would 42 -`, `${ID} notice would 42 -`]);
    expect(fs.readFileSync(path.join(home, '.ccrc', 'mail-hold-shadow.d', ID), 'utf8')).toBe('coordinator.42,overlord.50\nnotice.42.-.would\n');
  });
  it('past 1 MiB the log moves to `.1`, and the next line starts a new file', () => {
    disarm('notice');
    fs.writeFileSync(LOG(), `${'x'.repeat(100)}\n`.repeat(11_000));
    live();
    read();
    expect(fs.statSync(`${LOG()}.1`).size).toBe(101 * 11_000);
    expect(logged()).toEqual([`${ID} notice would 42 -`]);
  });
  it('a log under 1 MiB is appended to', () => {
    disarm('notice');
    fs.writeFileSync(LOG(), 'old\n');
    live();
    read();
    expect(fs.existsSync(`${LOG()}.1`)).toBe(false);
    expect(fs.readFileSync(LOG(), 'utf8').split('\n')[0]).toBe('old');
  });
});

describe('the Stop line (P9)', () => {
  it('on Stop with a marker file present, the log gains one `stop` line; with none, nothing', () => {
    stop();
    expect(logLines()).toEqual([]);
    live('overlord.9');
    stop();
    const l = logLines();
    expect(l).toHaveLength(1);
    expect(l[0]!.slice(1)).toEqual([ID, 'stop', '-', '9', '-']);
    expect(l[0]![0]).toMatch(/^\d{10,11}$/);
  });
});

describe('MERGE_STRIP_JQ is untouched (P6, N7)', () => {
  it('its text, cut from the hook, has the sha256 of the program on main when PR 5 was cut, vendored beside this file', () => {
    const bytes = fs.readFileSync(BASELINE);
    expect(createHash('sha256').update(bytes).digest('hex'), 'the vendored baseline was edited').toBe(STRIP_SHA256);
    const prog = (/^MERGE_STRIP_JQ='([\s\S]*?)'$/m.exec(fs.readFileSync(HOOK, 'utf8')) ?? [])[1] ?? '';
    expect(prog).not.toBe('');
    expect(createHash('sha256').update(prog).digest('hex'), 'MERGE_STRIP_JQ changed').toBe(STRIP_SHA256);
  });
});

// The subagent's ack refusal (plan Task 6.1; spec §3.5, D10): the one arm that runs with no marker, in a joined subagent
// only, behind a builtin prefilter on the command (`mail`, and `ack` or `inbox`). Armed by `mailhold-refuse-live`.
describe('the subagent\'s ack refusal (Task 6.1)', () => {
  const ACK = 'ccrc: a subagent does not ack ccrc mail. Report to your parent instead.';
  const joined = (): void => { fs.writeFileSync(reg(`${ID}.joined`), 'agent-a1\n'); };
  const subBash = (command: string): Out => bash(command, { agent_id: 'agent-a1' });
  const REFUSED: Array<[string, string]> = [
    ['~/.local/bin/ccrc-api mail ack 7 --json -', 'mail-ack'], ['~/.local/bin/ccrc-api mail inbox', 'mail-inbox'],
    ['ccrc-api mail inbox > f', 'mail-inbox'], ['ccrc-api mail inbox >> f', 'mail-inbox'], ['ccrc-api mail inbox &> f', 'mail-inbox'],
    ['ccrc-api mail inbox >&2', 'mail-inbox'], ['ccrc-api mail inbox 2>/dev/null', 'mail-inbox'], ['"$API" mail inbox', 'mail-inbox'],
    ['/home/u/.local/bin/ccrc-api mail inbox', 'mail-inbox'], ['x=$(ccrc-api mail inbox)', 'mail-inbox'],
  ];
  const PASSED = ['ccrc-api mail inbox | cat', 'ccrc-api mail inbox > /dev/null', 'ccrc-api mail list --to lane-a', 'ccrc-api mail fetch 7'];
  it.each(REFUSED)('a joined subagent\'s %j is refused with no marker, by _hook_deny_json, and logged once', (c, act) => {
    joined();
    expect(subBash(c).stdout).toBe(denyEnvelope(ACK));
    expect(subBash(c).stdout).toBe(denyEnvelope(ACK));
    expect(logged()).toEqual([`${ID} ack did ${act === 'mail-ack' ? '7' : '-'} ${act}`]);
  });
  it('under a live marker a joined subagent\'s ack is refused too, and the log names the delivery', () => {
    joined();
    live();
    expect(subBash('ccrc-api mail ack 7').stdout).toBe(denyEnvelope(ACK));
    expect(subBash('ccrc-api mail inbox').stdout).toBe(denyEnvelope(ACK));
    expect(logged(), 'an ack names its own delivery, an inbox the marker\'s (F7)').toEqual([`${ID} ack did 7 mail-ack`, `${ID} ack did 42 mail-inbox`]);
  });
  it.each(PASSED)('a joined subagent\'s %j passes, with and without a marker', (c) => {
    joined();
    expect(subBash(c).stdout).toBe('');
    live();
    expect(subBash(c).stdout).toBe('');
    expect(logLines()).toEqual([]);
  });
  it('the main thread and an unjoined agent_id are not refused, with no marker and under one', () => {
    for (const c of ['ccrc-api mail ack 7', 'ccrc-api mail inbox']) {
      expect(bash(c).stdout, c).toBe('');
      expect(bash(c, { agent_id: 'agent-zz' }).stdout, c).toBe('');
    }
    expect(logLines()).toEqual([]);
    live();
    expect(bash('ccrc-api mail ack 7').context).toBe(E('42', 'its coordinator'));
    expect(bash('ccrc-api mail ack 7', { agent_id: 'agent-zz' }).context).toBe(E('42', 'its coordinator'));
  });
  it('shadow: with mailhold-refuse-live absent nothing is refused, and `ack would` is logged once a key', () => {
    disarm('refuse');
    joined();
    expect(subBash('ccrc-api mail ack 7').stdout).toBe('');
    expect(subBash('ccrc-api mail ack 8').stdout).toBe('');
    expect(subBash('ccrc-api mail inbox').stdout).toBe('');
    expect(subBash('ccrc-api mail ack 7').stdout).toBe('');
    expect(logged()).toEqual([`${ID} ack would 7 mail-ack`, `${ID} ack would 8 mail-ack`, `${ID} ack would - mail-inbox`]);
  });
  it('the prefilter: a joined subagent\'s call with no `mail` word, or none of `ack` and `inbox`, makes no call of the block', () => {
    const realJq = spawnSyncGroup('sh', ['-c', 'command -v jq'], { encoding: 'utf8', timeout: 10_000 }).stdout.trim();
    const calls = path.join(home, 'jq-calls');
    fs.writeFileSync(path.join(harnessBin(home), 'jq'), `#!/bin/sh\nprintf '%s\\037\\n' "$*" >> '${calls}'\nexec '${realJq}' "$@"\n`, { mode: 0o755 });
    joined();
    const blockCalls = (c: string): string[] => {
      fs.writeFileSync(calls, '');
      subBash(c);
      return fs.readFileSync(calls, 'utf8').split('\u001f\n').filter((a) => a.includes('mail-hold') || a.includes('--arg pairs'));
    };
    expect(blockCalls('ls -la'), 'no mail word').toEqual([]);
    expect(blockCalls('ccrc-api mail list --to lane-a'), 'mail, but neither ack nor inbox').toEqual([]);
    expect(blockCalls('grep -r inbox notes'), 'inbox, but no mail').toEqual([]);
    expect(blockCalls('ccrc-api mail inbox | cat'), 'CONTROL: the prefilter passes, so the module decides').toHaveLength(1);
    fs.writeFileSync(calls, '');
    expect(bash('ccrc-api mail inbox').stdout, 'the main thread, with no marker').toBe('');
    expect(fs.readFileSync(calls, 'utf8').split('\u001f\n').filter((a) => a.includes('mail-hold') || a.includes('--arg pairs')),
      'the prefilter tests tmsub: a main-thread inbox makes no call of the block').toEqual([]);
  });
  it('with $REG/mail-disabled present, nothing is refused', () => {
    joined();
    fs.writeFileSync(reg('mail-disabled'), '');
    expect(subBash('ccrc-api mail ack 7').stdout).toBe('');
    expect(logLines()).toEqual([]);
  });
  it('with the module missing, nothing is refused, and `module-missing` is logged once with no marker', () => {
    const dir = path.join(home, 'hookcopy');
    fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
    fs.copyFileSync(HOOK, path.join(dir, 'session-hook.sh'));
    for (const f of fs.readdirSync(LIB)) if (f !== 'mail-hold.jq') fs.copyFileSync(path.join(LIB, f), path.join(dir, 'lib', f));
    hook = path.join(dir, 'session-hook.sh');
    joined();
    expect(subBash('ccrc-api mail ack 7').stdout).toBe('');
    expect(subBash('ccrc-api mail inbox').stdout).toBe('');
    expect(logged()).toEqual([`${ID} - module-missing - -`]);
  });
});

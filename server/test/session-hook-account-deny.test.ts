/**
 * The session hook's account arm (D-6202; accounts plan Task A9, spec §3.1, G21): on EVERY fleet session — a top-level
 * session, a coordinator and a dispatched child, each on the main thread and in a subagent — the PreToolUse arm denies
 * the account-management verbs (`ccrc account <mutating sub>`, `seed`, `openrouter-management`, `ccd-account-auth`,
 * `ccd account-pane`) in every form #646's normaliser reads (path-qualified, quoted, backslashed, `$VAR` programs,
 * `bash -c`), Read and Bash of the secret and scratch paths and `agent.env`, writes under `.auth/` and `.accounts/`,
 * and bare `env` / `printenv`. A top-level session's other behaviour is unchanged, and #646's child arm is untouched.
 *
 * It NEVER refuses a swap path (the operator's Q8 ruling of 2026-10-19): every form in `must-allow.json` (iterated,
 * never respelled) passes for all six callers with no output at all, which is what `main`'s hook printed for each.
 *
 * Runs `ccd/session-hook.sh` for real in a fixture HOME (`session-hook-approval-deny.test.ts`'s harness). Never the
 * live HOME.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');
/** The one MUST-ALLOW corpus, iterated, never respelled (`account-deny.test.ts` and the plan's Step 4b read it too). */
const mustAllow = (): Array<{ tool: string; input: Record<string, unknown> }> =>
  JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixtures/account-deny/must-allow.json'), 'utf8'));
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
const TOP = 'project-a-calm-mesa';
const COORD = 'project-b-calm-ridge';
const CHILD = 'project-b-quiet-basin';
/** A neutral `cwd`: one naming `account` or `env` would pass the prefilter for every call and leave it untested. */
const CWD = '/srv/work/project-a';

let home: string;
beforeAll(() => {
  home = mkTmp('ccrc-acctdeny-hook-');
  const reg = path.join(home, '.cc-sessions');
  fs.mkdirSync(reg, { recursive: true });
  for (const id of [TOP, COORD, CHILD]) fs.writeFileSync(path.join(reg, `${id}.generation`), GENERATION);
  fs.writeFileSync(path.join(reg, `${CHILD}.child`), '7');            // the coordinator's dispatched child
  // tmux answers the pane's session name from `TMUX_PANE` (`%<id>`), so each caller is its own row.
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'tmux'), '#!/bin/sh\nprintf "cc-%s\\n" "${TMUX_PANE#%}"\n', { mode: 0o755 });
});
afterAll(() => { fs.rmSync(home, { recursive: true, force: true }); });

type Envelope = { hookSpecificOutput: { hookEventName?: string; permissionDecision?: string; permissionDecisionReason?: string } };
const SUB = { agent_id: 'a0000000000000001', agent_type: 'general-purpose' };
const CALLERS: ReadonlyArray<[string, string, Record<string, unknown>]> = [
  ['a top-level session, main thread', TOP, {}], ['a top-level session, subagent', TOP, SUB],
  ['a coordinator, main thread', COORD, {}], ['a coordinator, subagent', COORD, SUB],
  ['a child, main thread', CHILD, {}], ['a child, subagent', CHILD, SUB],
];

const hookEnv = (id: string): NodeJS.ProcessEnv => ({
  ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
  TMUX_PANE: `%${id}`, CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION,
});
const payload = (tool: string, input: Record<string, unknown>, extra: Record<string, unknown>): string =>
  JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, cwd: CWD, ...extra });

/** One PreToolUse event through the real hook: the raw stdout, after the hook contract's checks. */
const fireRaw = (id: string, tool: string, input: Record<string, unknown>, extra: Record<string, unknown>): string => {
  const r = spawnSync('bash', [HOOK], { input: payload(tool, input, extra), encoding: 'utf8', env: hookEnv(id) });
  expect(r.status, 'the hook contract: exit 0 on every path').toBe(0);
  expect(r.stderr, 'the hook contract: silent on stderr').toBe('');
  return r.stdout;
};
/** The deny reason, or null when nothing was denied. */
const fire = (id: string, tool: string, input: Record<string, unknown>, extra: Record<string, unknown>): string | null => {
  const line = fireRaw(id, tool, input, extra).trim();
  if (line === '') return null;
  const env = JSON.parse(line) as Envelope;
  expect(env.hookSpecificOutput.hookEventName).toBe('PreToolUse');
  return env.hookSpecificOutput.permissionDecision === 'deny' ? String(env.hookSpecificOutput.permissionDecisionReason) : null;
};
/** Many events at once, a few processes in flight (the corpus is ~300 forms × six callers): each one's stdout. */
const fireMany = async (id: string, extra: Record<string, unknown>, rows: ReadonlyArray<{ tool: string; input: Record<string, unknown> }>): Promise<string[]> => {
  const out: string[] = new Array(rows.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < rows.length) {
      const i = next++;
      const row = rows[i]!;
      out[i] = await new Promise<string>((resolve, reject) => {
        const p = spawn('bash', [HOOK], { env: hookEnv(id) });
        let so = ''; let se = '';
        p.stdout.on('data', (d: Buffer) => { so += d.toString(); });
        p.stderr.on('data', (d: Buffer) => { se += d.toString(); });
        p.on('error', reject);
        p.on('close', (code) => resolve(code === 0 && se === '' ? so : `exit ${code} stderr ${se}`));
        p.stdin.end(payload(row.tool, row.input, extra));
      });
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return out;
};

const DENIED: ReadonlyArray<[string, string, Record<string, unknown>]> = [
  ['ccrc account remove --id lane-x', 'Bash', { command: 'ccrc account remove --id lane-x' }],
  ['~/.local/bin/ccrc account add …', 'Bash', { command: '~/.local/bin/ccrc account add --id lane-x --provider anthropic' }],
  ['ccrc \'account\' "remove"', 'Bash', { command: 'ccrc \'account\' "remove" --id lane-x' }],
  ['C=ccrc; $C account remove', 'Bash', { command: 'C=ccrc; $C account remove --id lane-x' }],
  ['ccrc account openrouter-management ceiling --usd 100000', 'Bash', { command: 'ccrc account openrouter-management ceiling --usd 100000' }],
  ['cat ~/.cc-secrets/x-oauth.env', 'Bash', { command: 'cat ~/.cc-secrets/x-oauth.env' }],
  ['a Read of ~/.ccrc/auth-scratch/x/pkce', 'Read', { file_path: '~/.ccrc/auth-scratch/x/pkce' }],
  ['printenv', 'Bash', { command: 'printenv' }],
];

describe('the account arm denies on every session (D-6202)', () => {
  for (const [caller, id, extra] of CALLERS) {
    it.each(DENIED)(`${caller}: %s is denied with the envelope`, (_n, tool, input) => {
      const why = fire(id, tool, input, extra);
      expect(why).not.toBeNull();
      expect(why).toMatch(/^ccrc: this call is .*account-management act no fleet session runs/);
      expect(why).toMatch(/Switching accounts is never refused/);
    });
  }

  it.each(CALLERS)('%s: the wider forms are denied too (a backslash, a path, a `bash -c`, the pane, the helper, a write, `env`)', (_c, id, extra) => {
    for (const command of [
      'ccrc acc\\ount re\\move --id lane-x', '"$HOME/.local/bin/ccrc" account credential --id lane-x', "bash -c 'ccrc account check --id lane-x'",
      'cd x && FOO=1 ccrc account enable --id lane-x', 'ccd account-pane --id lane-x --method setup-token', 'C=ccd; $C account-pane --id lane-x',
      '~/.local/bin/ccd-account-auth lane-x setup-token', 'ccrc account seed --id lane-x', 'head ~/.ccrc/agent.env',
      'cat ~/.ccrc/codex/lane-c/runtime.env', 'echo x > ~/.cc-sessions/.accounts/lane-x.json', 'rm -rf ~/.cc-sessions/.auth/lane-x',
      'env', 'env | grep TOKEN', 'printenv -0', '(env)', 'echo "$(env)"',
    ]) expect(fire(id, 'Bash', { command }, extra), command).not.toBeNull();
    for (const [tool, input] of [
      ['Read', { file_path: '~/.cc-secrets/lane-x-oauth.env' }], ['Grep', { pattern: 'x', path: '~/.ccrc/agent.env' }],
      ['Write', { file_path: '~/.cc-sessions/.accounts/lane-x.json', content: '{}' }],
      ['Edit', { file_path: '~/.cc-sessions/.auth/lane-x/status', old_string: 'a', new_string: 'b' }],
    ] as const) expect(fire(id, tool, input, extra), `${tool} ${JSON.stringify(input)}`).not.toBeNull();
  });

  it.each(CALLERS)('%s: the evasion case — `bash -c "$(printf …)"` assembling the verb is NOT denied: the documented limit of an accident guard', (_c, id, extra) => {
    expect(fire(id, 'Bash', { command: 'bash -c "$(printf \'%s\' \'ccrc acc\' \'ount remove\')"' }, extra)).toBeNull();
  });

  it.each(CALLERS)('%s: a read of the lane-state file, a source file named like the helper and a variable read stay open', (_c, id, extra) => {
    for (const command of ['cat ~/.cc-sessions/.accounts/lane-x.json', 'grep -n foo ccd/ccd-account-auth.test.ts',
      'printenv HOME', 'env -i FOO=1 true', 'ccrc account roster --json', 'source .venv/bin/activate']) {
      expect(fire(id, 'Bash', { command }, extra), command).toBeNull();
    }
    expect(fire(id, 'Read', { file_path: '~/.cc-sessions/.accounts/lane-x.json' }, extra)).toBeNull();
  });
});

describe('#646\'s child arm is untouched by the account arm', () => {
  it('a child is still denied a SAFETY verb, with #646\'s own reason; a top-level session is not (its other behaviour is unchanged)', () => {
    const child = fire(CHILD, 'Bash', { command: 'ccd ws-rm x' }, {});
    expect(child).toMatch(/a dispatched child never runs in any form/);
    expect(fire(TOP, 'Bash', { command: 'ccd ws-rm x' }, {})).toBeNull();
    expect(fire(COORD, 'Bash', { command: 'ccrc-api approvals rule 1 allow' }, {})).toBeNull();
    expect(fire(CHILD, 'Bash', { command: 'ccrc-api approvals rule 1 allow' }, {})).toMatch(/approval surface/);
  });
});

describe('MUST-ALLOW: no swap path is ever refused (the operator\'s Q8 ruling, 2026-10-19)', () => {
  const rows = mustAllow();
  it.each(CALLERS)('%s: every form in must-allow.json gets no deny envelope, and the hook prints what main printed (nothing)', async (_c, id, extra) => {
    expect(rows.length).toBeGreaterThan(250);
    const outs = await fireMany(id, extra, rows);
    const bad = outs.flatMap((o, i) => (o === '' ? [] : [`${JSON.stringify(rows[i]!.input)} -> ${o.trim()}`]));
    expect(bad).toEqual([]);
  }, 300_000);
});

/**
 * The child's approval-surface and forbidden-verb deny (plan Task 14, spec §6.6, D-5297, D-5299): for any session
 * whose row carries `$REG/<id>.child`, main thread or subagent, the session hook's PreToolUse arm DENIES
 *   (a) a tool call that reaches the approval surface: `approvals` as `ccrc-api`'s first argument in any invocation
 *       form, `/api/approvals`, the pinned public key's or the server's private key's path, or a Write or Edit of a
 *       key or the verifier;
 *   (b) a Bash call that runs a SAFETY `ccd` verb or `ccrc update` / `ccrc rollback` in any invocation form.
 * Children run with permissions bypassed, so no prompt and no classifier sees these; invariant 10 rests on this deny.
 * A top-level session is untouched.
 *
 * And the hook's static copy of the classifier's `forbidden` match (`APPROVAL_FORBIDDEN_JQ`), which this deny and the
 * PermissionRequest arm both read, is held equal to `approvalClass`'s over Task 12's corpus.
 *
 * Runs `ccd/session-hook.sh` for real in a fixture HOME (the role-skill deny's harness). Never the live HOME.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { approvalClass, rootsForChild, FORBIDDEN_CCD_VERBS, type ApprovalClass } from '../src/coord/approvalguard.js';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');
const CORPUS_FILE = path.resolve(__dirname, 'fixtures/approvals/guard-corpus.json');
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
const ID = 'project-a-quiet-basin';

/** The hook's jq program, read out of the hook (one single-quoted assignment), never respelled here. */
export const hookForbiddenJq = (): string => {
  const src = fs.readFileSync(HOOK, 'utf8');
  const m = src.match(/^APPROVAL_FORBIDDEN_JQ='([^']*)'$/m);
  if (m === null) throw new Error('APPROVAL_FORBIDDEN_JQ is not one single-quoted assignment in the hook');
  return m[1] as string;
};

/** Runs the hook's jq program over a stream of `{tool_name, tool_input}` payloads: one output line per payload. */
const runForbiddenJq = (mode: 'class' | 'deny', payloads: ReadonlyArray<{ tool_name: string; tool_input: unknown }>): string[] => {
  const r = spawnSync('jq', ['-r', '--arg', 'q', "'", '--arg', 'mode', mode, hookForbiddenJq()], {
    input: payloads.map((p) => JSON.stringify(p)).join('\n'), encoding: 'utf8', maxBuffer: 1 << 26,
  });
  expect(r.status, r.stderr).toBe(0);
  const lines = r.stdout.split('\n');
  lines.pop();
  expect(lines).toHaveLength(payloads.length);
  return lines;
};

let home: string;
beforeEach(() => {
  home = mkTmp('ccrc-aprdeny-');
  fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  fs.writeFileSync(path.join(home, '.cc-sessions', `${ID}.generation`), GENERATION);
  fs.writeFileSync(path.join(home, '.cc-sessions', `${ID}.child`), '7');
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'tmux'), `#!/bin/sh\necho "cc-${ID}"\n`, { mode: 0o755 });
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

type Envelope = { hookSpecificOutput: { hookEventName?: string; permissionDecision?: string; permissionDecisionReason?: string } };

/** One PreToolUse event through the real hook; returns the deny reason, or null when nothing was denied. */
const fire = (tool: string, toolInput: Record<string, unknown>, extra: Record<string, unknown> = {}): string | null => {
  const r = spawnSync('bash', [HOOK], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: toolInput, cwd: home, ...extra }),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
      TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION },
  });
  expect(r.status, 'the hook contract: exit 0 on every path').toBe(0);
  expect(r.stderr, 'the hook contract: silent on stderr').toBe('');
  const line = r.stdout.trim();
  if (line === '') return null;
  expect(line.split('\n'), 'one envelope').toHaveLength(1);
  const env = JSON.parse(line) as Envelope;
  expect(env.hookSpecificOutput.hookEventName).toBe('PreToolUse');
  return env.hookSpecificOutput.permissionDecision === 'deny' ? String(env.hookSpecificOutput.permissionDecisionReason) : null;
};
const SUB = { agent_id: 'a0000000000000001', agent_type: 'general-purpose' };
const THREADS: ReadonlyArray<[string, Record<string, unknown>]> = [['main thread', {}], ['subagent', SUB]];
const bash = (command: string, extra: Record<string, unknown> = {}): string | null => fire('Bash', { command }, extra);

describe('the hook\'s forbidden match is held equal to approvalClass over Task 12\'s corpus', () => {
  interface Row { tool: string; input: Record<string, unknown>; class: ApprovalClass; why: string; ctx: { cwd: string | null } }
  const rows: Row[] = JSON.parse(fs.readFileSync(CORPUS_FILE, 'utf8'));
  const HOMEDIR = '/rig/home';
  const roots = rootsForChild({ id: ID, workdir: `${HOMEDIR}/ws/${ID}`, child: { kind: 'child', runId: 7 } }, HOMEDIR);
  it('every row: the hook copy answers forbidden exactly when the classifier does', () => {
    expect(roots).not.toBeNull();
    expect(rows.filter((r) => r.class === 'forbidden').length, 'the corpus has forbidden rows to hold').toBeGreaterThan(40);
    const hook = runForbiddenJq('class', rows.map((r) => ({ tool_name: r.tool, tool_input: r.input })));
    const mismatches = rows.flatMap((r, i) => {
      const ts = approvalClass(r.tool, r.input, { ...roots!, ...r.ctx }) === 'forbidden';
      const sh = (hook[i] as string) !== '';
      return ts === sh ? [] : [`${r.why}: classifier ${ts ? 'forbidden' : 'not'}, hook ${sh ? 'forbidden' : 'not'}`];
    });
    expect(mismatches).toEqual([]);
  });
  it('a 2,000-character script with one forbidden line is forbidden; the same without it is not', () => {
    const filler = Array.from({ length: 60 }, (_, i) => `echo line-${i} >/dev/null`).join('\n');
    const [withIt, without] = runForbiddenJq('class', [
      { tool_name: 'Bash', tool_input: { command: `${filler}\nccd ws-reap\n${filler}` } },
      { tool_name: 'Bash', tool_input: { command: `${filler}\n${filler}` } },
    ]);
    expect(withIt).not.toBe('');
    expect(without).toBe('');
  });
});

describe('the approval-surface deny: a child cannot reach the approval surface (D-5297)', () => {
  const surface = [
    '"$API" approvals rule 1 allow',
    '$API approvals rule 1 allow',
    'ccrc-api approvals rule 1 allow',
    '~/.local/bin/ccrc-api approvals rule 1 allow',
    'curl -s -X POST http://127.0.0.1:7788/api/approvals/1/rule',
    'cat ~/.ccrc/approval-signing.key',
    'cat ~/.ccrc/approval-signing.pub',
  ];
  it.each(THREADS)('%s: every invocation form is denied, naming the approval surface', (_t, extra) => {
    for (const c of surface) {
      const why = bash(c, extra);
      expect(why, c).not.toBeNull();
      expect(why, c).toMatch(/^ccrc: /);
      expect(why, c).toContain('approval');
    }
  });
  it.each(THREADS)('%s: a Write or an Edit of a key or the verifier is denied', (_t, extra) => {
    for (const [tool, input] of [
      ['Write', { file_path: `${home}/.ccrc/approval-signing.pub`, content: 'x' }],
      ['Edit', { file_path: `${home}/.ccrc/approval-signing.pub`, old_string: 'a', new_string: 'b' }],
      ['Write', { file_path: `${home}/.cc-sessions/approval-verify.mjs`, content: 'x' }],
    ] as const) {
      expect(fire(tool, input, extra), `${tool} ${input.file_path}`).not.toBeNull();
    }
  });
  it('only the first argument counts: `"$API" mail send` with "approvals" in its body is not denied', () => {
    for (const [, extra] of THREADS) {
      expect(bash('"$API" mail send --json - <<<\'{"to":"x","body":"three approvals pending"}\'', extra)).toBeNull();
      expect(bash('echo approvals', extra)).toBeNull();
    }
  });
  it('a top-level session (no .child) is not denied', () => {
    fs.rmSync(path.join(home, '.cc-sessions', `${ID}.child`));
    for (const [, extra] of THREADS) {
      expect(bash('"$API" approvals rule 1 allow', extra)).toBeNull();
      expect(fire('Write', { file_path: `${home}/.ccrc/approval-signing.pub`, content: 'x' }, extra)).toBeNull();
    }
  });
});

describe('the forbidden-verb deny: a child never runs a SAFETY verb or ccrc update/rollback, in any form (D-5299)', () => {
  const verbs = [...FORBIDDEN_CCD_VERBS.map((v) => `ccd ${v}`), 'ccrc update', 'ccrc rollback'];
  const forms = (cmd: string): string[] => {
    const [prog, ...rest] = cmd.split(' ');
    const tail = rest.join(' ');
    return [
      `${cmd} x`,
      `~/.local/bin/${prog} ${tail} x`, `/home/u/.local/bin/${prog} ${tail} x`, `./${prog} ${tail} x`,
      `FOO=1 ${cmd} x`, `env FOO=1 ${cmd} x`,
      `cd x && ${cmd} y`, `true; ${cmd} y`, `false || ${cmd} y`, `echo | ${cmd} y`,
      `bash -c '${cmd} y'`, `sh -c '${cmd} y'`,
    ];
  };
  it.each(THREADS)('%s: every verb in every form is denied through the deny printer', (_t, extra) => {
    const missed: string[] = [];
    for (const v of verbs) for (const c of forms(v)) {
      const why = bash(c, extra);
      if (why === null || !why.startsWith('ccrc: ')) missed.push(c);
    }
    expect(missed).toEqual([]);
  });
  it('the reason names the verb', () => {
    expect(bash('ccd ws-rm x')).toContain('ccd ws-rm');
    expect(bash('ccrc rollback')).toContain('ccrc update or rollback');
  });
  it('a top-level session is not denied any of them', () => {
    fs.rmSync(path.join(home, '.cc-sessions', `${ID}.child`));
    for (const [, extra] of THREADS) for (const v of verbs) expect(bash(`${v} x`, extra), v).toBeNull();
  });
  it('ccd ws-list and echo ws-rm from a child are not denied', () => {
    for (const [, extra] of THREADS) {
      expect(bash('ccd ws-list', extra)).toBeNull();
      expect(bash('echo ws-rm', extra)).toBeNull();
      expect(bash('ccd ws-gc', extra), 'ws-gc without --prune').toBeNull();
    }
  });
  it('a deny already set is never replaced', () => {
    // The merge deny fires first on a child's `gh pr merge`; a chain that also runs a verb keeps the merge reason.
    const why = bash('gh pr merge 1 && ccd ws-rm x');
    expect(why).not.toBeNull();
    expect(why).toContain('merge');
  });
});

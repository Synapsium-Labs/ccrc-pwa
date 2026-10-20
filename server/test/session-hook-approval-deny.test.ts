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
/** The payload's `cwd`, NEUTRAL: the payload carries it, and a cwd naming `ccd`, `ccrc` or `approval` (the test run's
 *  tmp root does) would pass the deny's substring prefilter for every call, so the prefilter itself would go untested. */
const CWD = '/srv/work/project-a';
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
const fire = (tool: string, toolInput: Record<string, unknown>, extra: Record<string, unknown> = {},
  envExtra: Record<string, string> = {}): string | null => {
  const r = spawnSync('bash', [HOOK], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: toolInput, cwd: CWD, ...extra }),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
      TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION, ...envExtra },
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
const bash = (command: string, extra: Record<string, unknown> = {}, envExtra: Record<string, string> = {}): string | null =>
  fire('Bash', { command }, extra, envExtra);

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
    // The forms bash reads the same after it removes quotes, backslashes and line continuations, or expands a
    // variable (security review of Task 14): each was let through before the deny normalised the command.
    'ccrc-api "approvals" rule 1 allow',
    "ccrc-api 'approvals' rule 1 allow",
    'ccrc-api appro\\vals rule 1 allow',
    '"${API:?}" approvals rule 1 allow',
    '"$API" \\\n  approvals rule 1 allow',
    'A=~/.local/bin/ccrc-api; "$A" approvals rule 1 allow',
    '$CCRC_API approvals rule 1 allow',
    '"$(command -v ccrc-api)" approvals rule 1 allow',
    "ccrc-a''pi approvals rule 1 allow",
    // The claimant mail's own rule block (D-5489, amended): a quoted heredoc reads the reason, jq pipes the body in.
    'IFS= read -r reason <<\'REASON\'\nfine\nREASON\n' +
      'jq -nc --arg id "$id" --arg uuid "$uuid" --arg reason "$reason" \'{fromId:$id,fromUuid:$uuid,verdict:"allow",reason:$reason}\' |\n' +
      '  "$API" approvals rule 1 --json -\n',
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
  it.each(THREADS)('%s: a Read, Grep or Glob of a signing key is denied (spec §6.1: the deny refuses the private key\'s path)', (_t, extra) => {
    for (const [tool, input] of [
      ['Read', { file_path: `${home}/.ccrc/approval-signing.key` }],
      ['Read', { file_path: `${home}/.ccrc/approval-signing.pub` }],
      ['Grep', { pattern: 'PRIVATE', path: `${home}/.ccrc/approval-signing.key` }],
      ['Glob', { pattern: '**/approval-signing*', path: `${home}/.ccrc` }],
    ] as const) {
      const why = fire(tool, input, extra);
      expect(why, `${tool} ${JSON.stringify(input)}`).not.toBeNull();
      expect(why, tool).toContain('approval');
    }
  });
  it('a Read of the verifier, which holds no secret, is not denied', () => {
    expect(fire('Read', { file_path: `${home}/.cc-sessions/approval-verify.mjs` })).toBeNull();
  });
  it('a top-level session (no .child) is not denied', () => {
    fs.rmSync(path.join(home, '.cc-sessions', `${ID}.child`));
    for (const [, extra] of THREADS) {
      expect(fire('Read', { file_path: `${home}/.ccrc/approval-signing.key` }, extra)).toBeNull();
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
      // Bash removes quotes, backslashes and line continuations before it runs a word, and expands a variable or a
      // command substitution into the program: each form below runs the same command, and each passed the deny
      // before it normalised the command (security review of Task 14). Kept as permanent red-then-green cases.
      `${prog} ${rest.map((w) => `"${w}"`).join(' ')} x`,
      `${prog} ${rest.map((w) => `'${w}'`).join(' ')} x`,
      `${prog} ${rest.map((w) => `$'${w}'`).join(' ')} x`,
      `${prog} ${rest.map((w) => `${w.slice(0, 1)}\\${w.slice(1)}`).join(' ')} x`,
      `${prog} ${rest.map((w) => w.replace('-', '\\-')).join(' ')} x`,
      `${prog} ${rest.map((w) => `${w.slice(0, 2)}''${w.slice(2)}`).join(' ')} x`,
      `${prog} \\\n  ${tail} x`,
      `${(prog as string).slice(0, 1)}''${(prog as string).slice(1)} ${tail} x`,
      `${(prog as string).slice(0, 1)}\\${(prog as string).slice(1)} ${tail} x`,
      `${(prog as string).slice(0, 1)}\\\n${(prog as string).slice(1)} ${tail} x`,
      `P=${prog}; $P ${tail} x`, `P=${prog}; "\${P}" ${tail} x`,
      `$(which ${prog}) ${tail} x`, `"$(command -v ${prog})" ${tail} x`, `\`which ${prog}\` ${tail} x`,
      `bash -c "${prog} ${rest.map((w) => `\\"${w}\\"`).join(' ')} y"`,
    ];
  };
  it.each(THREADS)('%s: every verb in every form is denied through the deny printer', (_t, extra) => {
    const missed: string[] = [];
    for (const v of verbs) for (const c of forms(v)) {
      const why = bash(c, extra);
      if (why === null || !why.startsWith('ccrc: ')) missed.push(c);
    }
    expect(missed).toEqual([]);
  }, 90_000);  // every verb times every form is a real hook run each: ~14 s on a laptop, past the 20 s Linux default on CI
  it.each(THREADS)('%s: ws-gc with a quoted or escaped --prune is denied', (_t, extra) => {
    for (const c of ["ccd ws-gc '--prune'", 'ccd ws-gc "--prune"', 'ccd ws-gc \\--prune', 'P=ccd; $P ws-gc --prune']) {
      expect(bash(c, extra), c).toContain('ccd ws-gc --prune');
    }
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
      // Normalising quotes must not turn an ordinary call into a forbidden one.
      expect(bash("grep -n 'ws-rm' src/x.ts", extra)).toBeNull();
      expect(bash('npm update', extra)).toBeNull();
      expect(bash('"$EDITOR" notes.md', extra)).toBeNull();
    }
  });
  it('a deny already set is never replaced', () => {
    // The merge deny fires first on a child's `gh pr merge`; a chain that also runs a verb keeps the merge reason.
    const why = bash('gh pr merge 1 && ccd ws-rm x');
    expect(why).not.toBeNull();
    expect(why).toContain('merge');
  });
});

// D-5696's enforcement for bypassed children (D-5993's companion, review of CB1b): a child runs with permissions
// bypassed, so a rule the classifier alone holds never fires for it. The deny arm therefore carries a third category,
// `build`, read in deny mode only: a write into the build directory or onto the launcher (the classifier's own
// pattern), and Claude Code's `install` or `update` under any path head or a `claude…` wrapper name, normalised as the
// verbs are. The deny file's bare rules stay; this is the arm that covers what they cannot spell.
describe('the build deny: a child never writes a Claude Code build or the launcher, nor runs its install or update (D-5696)', () => {
  const denied = [
    'ln -sf /tmp/x ~/.local/bin/claude', 'cp /tmp/x ~/.local/share/claude/versions/2.1.302',
    'mv build/claude "$HOME/.local/share/claude/versions/2.1.302"', 'echo x > /home/u/.local/bin/claude',
    'rm -rf ~/.local/share/claude/versions', 'cd /tmp && cp x ~/.local/bin/claude',
    '~/.local/bin/claude install 2.1.302', '/home/u/.local/bin/claude update', 'claude update', 'claude install stable',
    'claude-corp update', 'claude2 install 2.1.302', './claude install latest',
    "c''laude update", 'c\\laude install x', '"claude" "update"', 'bash -c "claude update"', 'true; claude update',
    '$(which claude) update', '"$(command -v claude)" install 2.1.302', 'P=claude; $P update',
    '~/.local/bin/upstream-a update', '/home/u/.local/bin/upstream-a install 2.1.302',
  ];
  it.each(THREADS)('%s: every write and every install or update form is denied, naming the build', (_t, extra) => {
    const missed = denied.filter((c) => { const why = bash(c, extra); return why === null || !why.includes('Claude Code build'); });
    expect(missed).toEqual([]);
  }, 60_000);
  it.each(THREADS)('%s: an edit tool writing into the build directory or onto the launcher is denied', (_t, extra) => {
    for (const fp of [`${home}/.local/share/claude/versions/2.1.302`, `${home}/.local/bin/claude`]) {
      expect(fire('Write', { file_path: fp, content: 'x' }, extra), fp).toContain('Claude Code build');
      expect(fire('Edit', { file_path: fp, old_string: 'a', new_string: 'b' }, extra), fp).toContain('Claude Code build');
    }
  });
  it('reads, ordinary installs and look-alike paths are not denied', () => {
    for (const [, extra] of THREADS) {
      for (const c of [
        'ls ~/.local/share/claude/versions', 'claude --version', 'claude mcp list', 'npm install', 'npm update',
        'pip install -r requirements.txt', 'cat ~/.local/bin/claude', 'cp /tmp/x ~/.local/bin/claude.bak',
        'cp /tmp/x ~/.local/share/claude/versions-old/2.1.302', 'cp /tmp/x ~/.local/bin/claude-a',
        'git log --oneline -- docs/update-claude.md', '"$PIP" install x', 'ls ~/.claude && npm install',
        'claude -p "update the changelog"', 'claude --resume x',
      ]) expect(bash(c, extra), c).toBeNull();
      expect(fire('Write', { file_path: `${home}/.local/share/claude/versions-old/x`, content: 'x' }, extra)).toBeNull();
    }
  });
  it('a top-level session is not denied any of them', () => {
    fs.rmSync(path.join(home, '.cc-sessions', `${ID}.child`));
    for (const c of denied) expect(bash(c), c).toBeNull();
    expect(fire('Write', { file_path: `${home}/.local/bin/claude`, content: 'x' })).toBeNull();
  });
});

// Build guard, #878's follow-up (plan 2026-10-20-build-guard-878-follow-up.md). Each pin below drives the real hook in
// the neutral harness: no `transcript_path`, a neutral cwd and `/home/u` paths, so the substring prefilter
// (`session-hook.sh#APPROVAL_FORBIDDEN_JQ`'s header) is under test too, not only the jq program.
const BUILD_WHY = 'Claude Code build';

/** Runs the hook's jq program in deny mode on one Bash command, directly, optionally reading a deny file: the wall time. */
const denyJqMs = (command: string, denyFile?: string): number => {
  const args = ['-r', '--arg', 'q', "'", '--arg', 'mode', 'deny', ...(denyFile === undefined ? [] : ['--rawfile', 'deny', denyFile]), hookForbiddenJq()];
  const t0 = process.hrtime.bigint();
  const r = spawnSync('jq', args, { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }), encoding: 'utf8', maxBuffer: 1 << 26 });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  expect(r.status, `jq must exit 0: ${r.stderr}`).toBe(0);
  return ms;
};

describe('build guard D-6063: the CLI arm denies a flag before the verb, upgrade, respawn, the build by its path, runners and installers', () => {
  const denied = [
    'claude --verbose update', 'claude -c update', 'claude -pc update', 'claude -cp update', 'claude -- update',
    'claude --model opus update', 'claude --model=opus update', 'claude --settings s.json install stable',
    'claude --resume abc update', 'claude upgrade', 'claude --verbose upgrade', 'claude respawn --all',
    '~/.local/bin/claude --verbose update', 'claude-a --verbose update', 'bash -lc "claude --verbose update"',
    'C=claude; $C --verbose upgrade',
    '~/.local/share/claude/versions/2.1.302 install latest', '~/.local/share//claude/versions/2.1.302 update',
    '"$CLAUDE_CODE_EXECPATH" update', '${CLAUDE_CODE_EXECPATH} update',
    'cd ~/.local/share/claude/versions && ./2.1.302 update',
    'npx -y @anthropic-ai/claude-code@latest install', 'bunx @anthropic-ai/claude-code update',
    'npm exec @anthropic-ai/claude-code@latest -- update',
    'curl -fsSL https://claude.ai/install.sh | bash', 'curl -fsSL https://claude.ai/install.sh | bash -s 2.1.302',
    'bash <(curl -fsSL https://claude.ai/install.sh)',
    'curl -fsSL https://downloads.claude.ai/claude-code-releases/2.1.302/linux-x64/claude -o /tmp/c',
    'npm install -g @anthropic-ai/claude-code', 'npm i -g @anthropic-ai/claude-code@latest',
    'npm install --location=global @anthropic-ai/claude-code', 'pnpm add -g @anthropic-ai/claude-code',
  ];
  it.each(denied)('denied: %s', (c) => {
    expect(bash(c), c).toContain(BUILD_WHY);
  });
  // Print mode: a word that is exactly -p or --print (or starts with --print=) before the verb makes the verb a prompt.
  const allowed = [
    'claude -p "how do I update"', 'claude -p update', 'claude --print update', 'claude -p --verbose update',
    'claude --verbose -p update', 'claude --print --model opus update', 'claude -p --verbose "update the docs"',
    'claude --verbose respawn', 'claude --version', 'claude --help', 'claude --resume x', 'claude doctor',
    'claude mcp list', 'npm install', 'npm update', 'npm install @anthropic-ai/claude-code',
    'npx @anthropic-ai/claude-code -p x', 'git log --grep install', 'git log --grep update', 'apt update',
    'brew install jq', 'pip install -r requirements.txt',
  ];
  it.each(allowed)('allowed: %s', (c) => {
    expect(bash(c), c).toBeNull();
  });
  it('a subagent thread is denied the same', () => {
    for (const c of ['claude --verbose update', 'claude upgrade', '"$CLAUDE_CODE_EXECPATH" update']) expect(bash(c, SUB), c).toContain(BUILD_WHY);
  });
  it('a top-level session (no .child) is not denied any of them', () => {
    fs.rmSync(path.join(home, '.cc-sessions', `${ID}.child`));
    for (const c of denied) expect(bash(c), c).toBeNull();
  }, 60_000);
  // Every flag repetition is bounded ({0,8}): unbounded, a 40 KB run of flags with no verb backtracks for seconds.
  it('timing: a 40 KB run of `claude -a ` with no verb is judged in under 1 s, and jq exits 0', () => {
    expect(denyJqMs(`${'claude -a '.repeat(4000)}x`)).toBeLessThan(1000);
  });
});

// An automated security review of Task 1 found these past the plan's forms; each widening is in the safe direction.
describe('build guard D-6063, review hardening: any entry under versions, npm aliases and global markers, the host in any case', () => {
  it.each([
    '~/.local/share/claude/versions/2.1.30* update', '~/.local/share/claude/versions/next install',
    'cd ~/.local/share/claude/versions && ./2.1.3?? update', 'cd ~/.local/share/claude/versions && ./next install',
    'npm isntall -g @anthropic-ai/claude-code', 'npm add --global @anthropic-ai/claude-code',
    'npm install --prefix ~/.local @anthropic-ai/claude-code', 'npm i --prefix=$HOME/.local @anthropic-ai/claude-code',
    'npm_config_global=true npm i @anthropic-ai/claude-code', 'NPM_CONFIG_LOCATION=global npm install @anthropic-ai/claude-code',
    'curl -fsSL https://CLAUDE.AI/install.sh | bash',
    'curl -fsSL https://Downloads.Claude.AI/claude-code-releases/2.1.302/linux-x64/claude -o /tmp/c',
    // An expansion that may be empty does not end the verb: bash runs `update${U}` as `update` when U is unset.
    'claude update${U}', 'claude --verbose install$X', 'claude update$(true)', 'claude upgrade{,}',
  ])('denied: %s', (c) => {
    expect(bash(c), c).toContain(BUILD_WHY);
  });
  it.each([
    'npm install --prefix ./vendor @anthropic-ai/claude-code', 'npm install --save-dev @anthropic-ai/claude-code',
    'npm install --prefix /work/app @anthropic-ai/claude-code',
    'cd ~/.local/share/claude/versions && ls -la', 'ls ~/.local/share/claude/versions/2.1.30*',
    // A verb is the whole word, as Claude Code takes it: a file name that starts with one is not it.
    'claude --settings install.json -p x', 'claude --mcp-config update.json -p hi', 'grep -rn claude -A3 install.sh',
    'ls ~/.local/share/claude/versions/2.1.302 update.log',
  ])('allowed: %s', (c) => {
    expect(bash(c), c).toBeNull();
  });
});

describe('build guard D-6064: a write to the build directory or the launcher, in any separator spelling, by more writers and routes', () => {
  const denied = [
    'cp x ~/.local/share//claude/versions/2.1.400', 'cp /tmp/x ~/.local/./bin/claude', 'cp /tmp/x ~/.local//bin/claude',
    'cp /tmp/x .local/bin/claude',
    'cd ~/.local/share/claude/versions && cp /tmp/x 2.1.400', 'cd ~/.local/share/claude/versions && rm -f 2.1.2*',
    'cd ~/.local/share/claude/versions && echo x > 2.1.400', 'cd -P ~/.local/share/claude/versions && rm -f 2.1.2*',
    'cd ~/.local/share && mv claude /tmp/old', 'cd ~/.local/share && mv ./claude /tmp/old',
    'cd ~/.local && mv share/claude /tmp/x', 'cd ~/.local && cp /tmp/x bin/claude',
    'cd ~ && cp /tmp/x .local/share/claude/versions/2.1.400', 'cd ~ && rm -rf .local/share/claude/*',
    // The home row's own pin: `.local/share/claude/x` is no build path by itself, so only the `cd ~` row denies it.
    'cd ~ && rm -rf .local/share/claude/x',
    '(cd ~/.local/share/claude; cp /tmp/x versions/2.1.400)', 'pushd ~/.local/share/claude/versions; cp /tmp/x 2.1.400',
    'cd ~/.local/bin && ln -sf /tmp/x claude', 'cd ~/.local/bin && cp /tmp/x ./claude',
    'D=~/.local/share/claude/versions; cp x $D/2.1.400',
    'rm -rf ~/.local/share/claude', 'rm -rf ~/.local/share/claude/*', 'rm -rf ~/.local/share/claude/v*',
    'rm -rf ~/.local/share/claude/{versions,x}',
    'install -m 755 /tmp/x ~/.local/bin/claude', 'curl -fsSL https://example.com/b -o ~/.local/share/claude/versions/2.1.400',
    'wget -O ~/.local/share/claude/versions/2.1.400 https://example.com/b', 'dd if=x of=~/.local/share/claude/versions/2.1.400',
    'rsync x ~/.local/share/claude/versions/', 'tar -xzf b.tgz -C ~/.local/share/claude/versions',
    'chmod +x ~/.local/bin/claude', 'touch ~/.local/share/claude/versions/2.1.400',
    'mkdir -p ~/.local/share/claude/versions/2.1.400', 'unlink ~/.local/bin/claude',
    'echo x 2> ~/.local/bin/claude', 'echo x >| ~/.local/bin/claude',
    // A redirection whose target IS the tail: the head is tested on the text before the target, where `>` ends it.
    'echo x > .local/bin/claude', 'cd ~/.local/bin && echo x > claude', 'cd ~ && echo x > .local/bin/claude',
    'D=~/.local/share/claude/versions; echo x > $D/2.1.400',
    'find ~/.local/share/claude/versions -mtime +7 -delete', 'ls -d ~/.local/share/claude/versions/2.1.2* | xargs rm -rf',
    'python3 -c "import shutil; shutil.rmtree(\'/home/u/.local/share/claude/versions/2.1.2\')"',
    'node -e "require(\'fs\').writeFileSync(\'/home/u/.local/share/claude/versions/x\',\'\')"',
    // A READ, denied: the stated cost of the interpreter arm, which cannot tell an interpreter's read from its write.
    'python3 -c "import os; print(os.listdir(\'/home/u/.local/share/claude/versions\'))"',
  ];
  it.each(denied)('denied: %s', (c) => {
    expect(bash(c), c).toContain(BUILD_WHY);
  });
  const editDenied: ReadonlyArray<[string, Record<string, unknown>]> = [
    ['Write', { file_path: '/home/u/.local/share//claude/versions/2.1.400', content: 'x' }],
    ['Write', { file_path: '/home/u/.local/share/claude/x/../versions/2.1.400', content: 'x' }],
    ['Write', { file_path: '~/.local/bin/claude', content: 'x' }],
    ['Edit', { file_path: '/home/u/.local/bin/./claude', old_string: 'a', new_string: 'b' }],
    ['MultiEdit', { file_path: '/home/u/.local/share/claude//versions/x', edits: [{ old_string: 'a', new_string: 'b' }] }],
    ['NotebookEdit', { notebook_path: '/home/u/.local/share/claude/versions/../versions/x.ipynb', new_source: 'x' }],
  ];
  it.each(editDenied)('denied: %s %j', (tool, input) => {
    expect(fire(tool, input), `${tool} ${JSON.stringify(input)}`).toContain(BUILD_WHY);
  });
  const allowed = [
    // Review Focus 1: ordinary commands, reads of the build paths and near-names.
    'npm install', 'npm update', 'git log --grep install', 'pip install -r requirements.txt', 'apt update',
    'claude --version', 'claude -p "how do I update"', 'claude mcp list', 'claude doctor', 'ccrc install --help',
    'ls ~/.local/share/claude/versions', 'cat ~/.local/bin/claude', 'du -sh ~/.local/share/claude/versions',
    'sha256sum ~/.local/share/claude/versions/2.1.302', 'readlink -f ~/.local/bin/claude', 'ls ~/.local/share/claude/*',
    'cp /tmp/x ~/.local/bin/claude.bak', 'cp /tmp/x ~/.local/bin/claude-a', 'install -m 755 tool ~/.local/bin/mytool',
    'mkdir -p ~/.local/share/myapp',
    // And Task 2's own.
    'find ~/.local/share/claude/versions -maxdepth 1 -type f', 'cd ~/.local/share/claude/versions && ls -la',
    'cd ~/.local/share/claude/versions && ls 2>/dev/null', 'cd ~/.local/share/claude/versions && ls 2>&1 | head',
    'cd ~/.local/share/claude/versions && ls >&2', 'cd ~/.local/share/claude/versions && ls > /dev/null',
    'cd ~/.local/share && mkdir myapp', 'cd ~/.local/share && rm -rf claude-code-cache', 'cd ~ && rm -rf claude',
    'cd ~/.local && mkdir -p share/myapp',
    'cd ~ && cp /tmp/x .local/share/myapp/', 'cd ~/.local/bin && ls -la', 'cd ~/.local/bin && cp /tmp/x ccd-helper',
    'cd ~/project && mkdir -p claude/versions && cp x claude/versions/', 'cp /tmp/x ~/.local/share/claude-code-cache/x',
    'rm -rf ~/.local/share/claude-code-cache', 'cp /tmp/x ~/.local/share/claude/versions-old/2.1.302',
    'curl -fsSL https://example.com/b -o /tmp/x && tar -xzf /tmp/x -C /tmp/out',
    'mkdir -p ~/.local/share/myapp && cp x ~/.local/share/myapp/', 'chmod +x scripts/install.sh', 'python3 -c "print(1)"',
  ];
  it.each(allowed)('allowed: %s', (c) => {
    expect(bash(c), c).toBeNull();
  });
  it.each([
    ['Write', { file_path: '/home/u/docs/local/share/claude/versions.md', content: 'x' }],
    ['Write', { file_path: '/home/u/.local/share/claude/versions-old/x', content: 'x' }],
  ] as const)('allowed: %s %j', (tool, input) => {
    expect(fire(tool, input)).toBeNull();
  });
  // Known gap, D-6064's residual: Bash text is never normalised, so `..` inside a path is past the match.
  it('residual (known gap): `..` inside Bash text is not normalised, so this write is allowed', () => {
    expect(bash('cp x ~/.local/share/claude/foo/../versions/2.1.400')).toBeNull();
  });
  it('a subagent thread is denied the same', () => {
    expect(bash('cp /tmp/x ~/.local//bin/claude', SUB)).toContain(BUILD_WHY);
    expect(fire('Write', { file_path: '/home/u/.local/share//claude/versions/2.1.400', content: 'x' }, SUB)).toContain(BUILD_WHY);
  });
  it('a top-level session (no .child) is not denied any of them', () => {
    fs.rmSync(path.join(home, '.cc-sessions', `${ID}.child`));
    for (const c of denied) expect(bash(c), c).toBeNull();
    for (const [tool, input] of editDenied) expect(fire(tool, input), tool).toBeNull();
  }, 60_000);
  // Every separator repetition is bounded ({0,8}): an unbounded one made jq abort ("retry-limit-in-match over"), and
  // an empty answer is the deny arm FAILING OPEN.
  it('timing: `~/.local/share/` then 40 KB of `./` is judged in under 1 s, and jq exits 0', () => {
    expect(denyJqMs(`~/.local/share/${'./'.repeat(20000)}`)).toBeLessThan(1000);
  });
  // Segment-heavy input was already slow on main, since jq compiles a regex on every per-segment call: main's deny
  // program took 13.0 s on this 43 KB input where class mode took 4.7 s (a ratio of 2.8 to 3.1, measured on a loaded
  // box). Every segment-scanning arm first tests its anchor on the whole command, so deny mode must stay no slower
  // than main's, held as a ratio to class mode (unchanged from main) on the same input, which load scales alike.
  it('timing: 43 KB of `cd ~/.local/ && ` is no slower in deny mode than on main (at most 3x class mode)', () => {
    const cmd = 'cd ~/.local/ && '.repeat(2700);
    const t0 = process.hrtime.bigint();
    const r = spawnSync('jq', ['-r', '--arg', 'q', "'", '--arg', 'mode', 'class', hookForbiddenJq()], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: cmd } }), encoding: 'utf8', maxBuffer: 1 << 26 });
    const classMs = Number(process.hrtime.bigint() - t0) / 1e6;
    expect(r.status, r.stderr).toBe(0);
    expect(denyJqMs(cmd)).toBeLessThan(3 * classMs);
  }, 180_000);
});


describe('build guard D-6065: a write to a file the launcher, the roll or the guard trusts', () => {
  const TRUST_WHY = 'launcher, roll or guard trusts';
  const denied = [
    'echo 2.1.999 >> ~/.ccrc/claude-smoked', 'echo "anthropic 2.1.999" > ~/.ccrc/claude-target', 'rm ~/.ccrc/claude-halted',
    'touch ~/.cc-sessions/claude-roll-live', 'cp /tmp/x ~/.ccrc//claude-target', 'cd ~/.ccrc && echo x > claude-smoked',
    'echo pass > ~/.cc-sessions/lane-a-project-a.claude-canary', 'echo 2.1.302 > ~/.cc-sessions/lane-a-project-a.claude-build',
    'touch ~/.cc-sessions/.claude-roll.lock', 'cp /tmp/x ~/.cc-sessions/child-deny.settings.json',
    'echo 0 > ~/.cc-sessions/lane-a-project-a.deny-settings', 'cd ~/.cc-sessions && cp /tmp/x child-deny.settings.json',
  ];
  it.each(denied)('denied: %s', (c) => {
    expect(bash(c), c).toContain(TRUST_WHY);
  });
  const editDenied: ReadonlyArray<[string, Record<string, unknown>]> = [
    ['Write', { file_path: '/home/u/.ccrc/claude-target', content: 'x' }],
    ['Edit', { file_path: '/home/u/.cc-sessions/child-deny.settings.json', old_string: 'a', new_string: 'b' }],
    ['Write', { file_path: '/home/u/.cc-sessions//x/../claude-roll-live', content: 'x' }],
  ];
  it.each(editDenied)('denied: %s %j', (tool, input) => {
    expect(fire(tool, input), `${tool} ${JSON.stringify(input)}`).toContain(TRUST_WHY);
  });
  it.each([
    'cat ~/.ccrc/claude-target', 'ls ~/.cc-sessions/', 'sha256sum ~/.ccrc/claude-smoked',
    'cat ~/.cc-sessions/child-deny.settings.json', 'cp /tmp/x ~/.ccrc/other-file', 'cd ~/.ccrc && cat claude-target',
  ])('allowed: %s', (c) => {
    expect(bash(c), c).toBeNull();
  });
  it('a subagent thread is denied the same; a top-level session is not', () => {
    expect(bash('echo 2.1.999 >> ~/.ccrc/claude-smoked', SUB)).toContain(TRUST_WHY);
    fs.rmSync(path.join(home, '.cc-sessions', `${ID}.child`));
    for (const c of denied) expect(bash(c), c).toBeNull();
  }, 60_000);
});

describe('build guard D-6066: the upstream id, read from the deny file the installer writes', () => {
  // The deny file is built by the REAL installer in a fixture HOME, invoked as install-session-hooks.test.ts invokes it
  // (`--homes <home>/.claude`, HOME set to the fixture), with `~/.ccrc/accounts.sh` naming the upstream id or not.
  const INSTALLER = path.resolve(__dirname, '../../ccd/install-session-hooks.sh');
  const built = new Map<string, string>();
  const denyFileText = (upstream: string | null): string => {
    const key = upstream ?? '';
    const have = built.get(key);
    if (have !== undefined) return have;
    const h = mkTmp('ccrc-aprdeny-inst-');
    try {
      fs.mkdirSync(path.join(h, '.claude'), { recursive: true });
      fs.writeFileSync(path.join(h, '.claude', 'settings.json'), '{}');
      fs.mkdirSync(path.join(h, 'ccrc-backups'), { recursive: true });
      if (upstream !== null) {
        fs.mkdirSync(path.join(h, '.ccrc'), { recursive: true });
        fs.writeFileSync(path.join(h, '.ccrc', 'accounts.sh'), `CCRC_UPSTREAM=${upstream}\n`);
      }
      const r = spawnSync('bash', [INSTALLER, '--homes', path.join(h, '.claude')], { env: { ...process.env, HOME: h }, encoding: 'utf8' });
      expect(r.status, r.stderr).toBe(0);
      const text = fs.readFileSync(path.join(h, '.cc-sessions', 'child-deny.settings.json'), 'utf8');
      built.set(key, text);
      return text;
    } finally { fs.rmSync(h, { recursive: true, force: true }); }
  };
  const DENY = (): string => path.join(home, '.cc-sessions', 'child-deny.settings.json');
  const useDenyFile = (upstream: string | null): void => { fs.writeFileSync(DENY(), denyFileText(upstream)); };

  it('the fixture is the real installer\'s: the upstream-a file pairs install and update for upstream-a, the default one does not', () => {
    const rules = (u: string | null): string[] => (JSON.parse(denyFileText(u)) as { permissions: { deny: string[] } }).permissions.deny;
    expect(rules('upstream-a')).toEqual(expect.arrayContaining(['Bash(upstream-a install:*)', 'Bash(upstream-a update:*)']));
    expect(rules(null).some((r) => r.includes('upstream-a'))).toBe(false);
    expect(rules(null)).toContain('Bash(ccrc update:*)');
  });

  const denied = [
    'upstream-a update', 'upstream-a install 2.1.302', 'upstream-a --verbose upgrade', 'FOO=1 upstream-a update',
    'env upstream-a update', 'true; upstream-a update', 'bash -c "upstream-a install 2.1.302"',
    'cd ~/.local/bin && ./upstream-a update', 'U=upstream-a; $U update',
    'cp /tmp/x ~/.local/bin/upstream-a', 'echo x > "$HOME/.local/bin/upstream-a"',
    'cd ~/.local/bin && ln -sf /tmp/x upstream-a', 'cd ~/.local/bin && cp /tmp/x ./upstream-a',
  ];
  it.each(denied)('with the upstream-a deny file, denied: %s', (c) => {
    useDenyFile('upstream-a');
    expect(bash(c), c).toContain(BUILD_WHY);
  });
  it.each(['Write', 'Edit'] as const)('with the upstream-a deny file, denied: %s on /home/u/.local/bin/upstream-a', (tool) => {
    useDenyFile('upstream-a');
    const input = tool === 'Write' ? { file_path: '/home/u/.local/bin/upstream-a', content: 'x' }
      : { file_path: '/home/u/.local/bin/upstream-a', old_string: 'a', new_string: 'b' };
    expect(fire(tool, input)).toContain(BUILD_WHY);
  });
  it.each([
    'upstream-a --version', 'upstream-a -p "update the changelog"', 'upstream-ab update',
    'cp /tmp/x ~/.local/bin/upstream-a.bak', 'cat ~/.local/bin/upstream-a',
  ])('with the upstream-a deny file, allowed: %s', (c) => {
    useDenyFile('upstream-a');
    expect(bash(c), c).toBeNull();
  });
  // Every deny file holds `Bash(ccrc update:*)` alone: only a head the file pairs with BOTH verbs is Claude Code's.
  it.each(['ccrc install --help', 'ccrc upgrade --help', 'cp /tmp/x ~/.local/bin/ccrc'])(
    'with the default deny file, no Claude Code build reason: %s', (c) => {
      useDenyFile(null);
      expect(bash(c) ?? '', c).not.toContain(BUILD_WHY);
    });
  it('parity: every head the generated file pairs is denied bare and as a launcher, for both verbs', () => {
    useDenyFile('upstream-a');
    const rules = (JSON.parse(denyFileText('upstream-a')) as { permissions: { deny: string[] } }).permissions.deny;
    const paired = [...new Set(rules.flatMap((r) => /^Bash\(([a-z][a-z0-9-]{0,31}) install:\*\)$/.exec(r)?.[1] ?? []))]
      .filter((p) => rules.includes(`Bash(${p} update:*)`));
    expect(paired).toEqual(expect.arrayContaining(['claude', 'upstream-a']));
    const missed = paired.flatMap((p) => [`${p} install`, `${p} update`, `~/.local/bin/${p} install`, `~/.local/bin/${p} update`])
      .filter((c) => !(bash(c) ?? '').includes(BUILD_WHY));
    expect(missed).toEqual([]);
  });
  it('the pair rule\'s other half: a head the file lists with install:* only gets no upstream-id entry, as on main', () => {
    const rules = (JSON.parse(denyFileText(null)) as { permissions: { deny: string[] } }).permissions.deny;
    fs.writeFileSync(DENY(), JSON.stringify({ permissions: { deny: [...rules, 'Bash(tool-b install:*)'] } }));
    expect(bash('tool-b update')).toBeNull();
    expect(bash('tool-b install')).toBeNull();
    expect(bash('claude update')).toContain(BUILD_WHY);
  });
  // The deny file is one per box, so a child that could make it unreadable would open every child's deny arm: an
  // unreadable or over-cap file passes nothing, and only the upstream-id arms go, as on main.
  it('regression: with no deny file, a symlinked, unparsable, unreadable or over-cap one, upstream-a update is allowed and main\'s denies stand', () => {
    const big = JSON.stringify({ permissions: { deny: [
      ...(JSON.parse(denyFileText('upstream-a')) as { permissions: { deny: string[] } }).permissions.deny,
      ...Array.from({ length: 6500 }, (_, i) => `Bash(padding-${i} install:*)`),
    ] } });
    expect(big.length).toBeGreaterThan(190_000);
    const asRoot = process.getuid?.() === 0;
    // The cap counts BYTES only because `_hook_deny_text` reads under `LC_ALL=C`. This file is a valid deny file that
    // pairs upstream-a, padded with two-byte characters: over the cap in bytes, within it in characters, and well under
    // the 128 KiB one `--arg` may hold. Counted in bytes it passes nothing, so `upstream-a update` stays allowed, as on
    // main; counted in characters, under a UTF-8 locale, it passes, jq parses it, and `upstream-a update` is denied.
    // Held only where bash, under that locale, counts one such character as length 1; elsewhere the setup is skipped,
    // by name.
    const UTF8 = { LC_ALL: 'C.UTF-8' };
    const utf8Counts = spawnSync('bash', ['-c', 'x=$(printf "\\303\\251"); printf %s "${#x}"'], { env: { ...process.env, ...UTF8 }, encoding: 'utf8' }).stdout === '1';
    const wide = JSON.stringify({ permissions: { deny: [
      ...(JSON.parse(denyFileText('upstream-a')) as { permissions: { deny: string[] } }).permissions.deny,
      `Bash(padding ${String.fromCharCode(0xe9).repeat(49_000)}:*)`,
    ] } });
    expect(Buffer.byteLength(wide)).toBeGreaterThan(65_536);
    expect(Buffer.byteLength(wide)).toBeLessThan(110_000);
    expect([...wide].length).toBeLessThanOrEqual(65_536);
    for (const setup of ['none', 'symlink', 'unparsable', 'mode 000', 'over the cap', 'over the cap in two-byte characters'] as const) {
      if (setup === 'mode 000' && asRoot) continue;
      if (setup === 'over the cap in two-byte characters' && !utf8Counts) {
        console.warn('skipped setup "over the cap in two-byte characters": bash under LC_ALL=C.UTF-8 does not count one two-byte character as length 1 here');
        continue;
      }
      const env = setup === 'over the cap in two-byte characters' ? UTF8 : {};
      fs.rmSync(DENY(), { force: true });
      if (setup === 'symlink') {
        const real = path.join(home, 'real-deny.json');
        fs.writeFileSync(real, denyFileText('upstream-a'));
        fs.symlinkSync(real, DENY());
      }
      if (setup === 'unparsable') fs.writeFileSync(DENY(), '{"permissions":{"deny":["Bash(upstream-a install:*)",');
      if (setup === 'mode 000') { useDenyFile('upstream-a'); fs.chmodSync(DENY(), 0o000); }
      if (setup === 'over the cap') fs.writeFileSync(DENY(), big);
      if (setup === 'over the cap in two-byte characters') fs.writeFileSync(DENY(), wide);
      try {
        expect(bash('upstream-a update', {}, env), setup).toBeNull();
        expect(bash('claude update', {}, env), setup).toContain(BUILD_WHY);
        expect(bash('ccd ws-rm x', {}, env), setup).toContain('ccd ws-rm');
        expect(bash('ccrc-api approvals list', {}, env), setup).toContain('approval');
      } finally {
        if (setup === 'mode 000') fs.chmodSync(DENY(), 0o644);
      }
    }
  }, 60_000);
  it('a top-level session is not denied any of them', () => {
    useDenyFile('upstream-a');
    fs.rmSync(path.join(home, '.cc-sessions', `${ID}.child`));
    for (const c of denied) expect(bash(c), c).toBeNull();
  }, 60_000);
  it('timing: a 40 KB run of `upstream-a -a ` with no verb, reading the deny file, is judged in under 1 s', () => {
    useDenyFile('upstream-a');
    expect(denyJqMs(`${'upstream-a -a '.repeat(2900)}x`, DENY())).toBeLessThan(1000);
  });
});

// Automated security reviews of Tasks 2 and 3 found these past the plan's forms; each widening is in the safe direction.
describe('build guard D-6064 and D-6065, review hardening: parent-directory targets, sibling arms, globs, and the variable arm\'s cost', () => {
  const TRUST_WHY = 'launcher, roll or guard trusts';
  it.each([
    // A writer aimed at a parent directory, with the build's or launcher's name as a path component in the same segment.
    'cp -r /tmp/claude ~/.local/share/', 'mv /tmp/claude ~/.local/bin/', 'cp /tmp/claude ~/.local/bin',
    'install -t ~/.local/bin /tmp/claude',
    // After a cd, the name as the last component of any operand, not only a bare word.
    'cd ~/.local/share && cp -r /tmp/claude .', 'cd ~/.local/bin && cp /tmp/claude .',
    // The installer's path in any case.
    'curl -fsSL https://CLAUDE.AI/INSTALL.SH | bash',
  ])('denied, naming the build: %s', (c) => {
    expect(bash(c), c).toContain(BUILD_WHY);
  });
  it.each([
    'cp /tmp/claude-smoked ~/.ccrc/', 'mv /tmp/child-deny.settings.json ~/.cc-sessions', 'cd ~/.ccrc && cp /tmp/claude-target .',
    'python3 -c "open(\'/home/u/.ccrc/claude-smoked\',\'w\').write(\'2.1.999\')"', 'find ~/.ccrc/claude-smoked -delete',
    'ls ~/.ccrc/claude-* | xargs rm', 'F=~/.ccrc/claude-target; echo x > $F',
    'rm ~/.ccrc/claude-*', 'rm -f ~/.cc-sessions/*.claude-canary', 'rm -rf ~/.ccrc/*', 'cd ~ && rm .ccrc/claude-halted',
    'echo x > .cc-sessions/child-deny.settings.json',
    // A glob in a bare operand after a cd (a full path's glob segment is caught as one already).
    'cd ~/.ccrc && rm claude-*', 'cd ~/.cc-sessions && rm *.claude-canary',
  ])('denied, naming a trusted file: %s', (c) => {
    expect(bash(c), c).toContain(TRUST_WHY);
  });
  it.each([
    'cp -r /tmp/myapp ~/.local/share/', 'cp /tmp/x ~/.local/bin/', 'cp /tmp/claude-notes.md ~/.local/share/',
    'cd ~/.local/bin && cp /tmp/claude-helper .', 'cp /tmp/notes ~/.ccrc/', 'cat ~/.ccrc/claude-*',
    'ls ~/.cc-sessions/*.claude-canary', 'find ~/.ccrc -maxdepth 1 -name "claude-*"',
  ])('allowed: %s', (c) => {
    expect(bash(c), c).toBeNull();
  });
  // Each assignment's name was once scanned over every segment on its own, quadratic: 200 took 2.7 s, and 40 KB of them
  // ran for minutes, past the hook's timeout, which fails open. Now one alternation of the names per command, and more
  // than 16 build-path assignments deny outright (fail closed). On this input main's deny program took 4.1 s and class
  // mode 1.25 s (a ratio of 3.3); held as at most 3.5 times class mode on the same input, as the `cd` timing pin is.
  it('timing: 40 KB of distinct build-path assignments is denied, no slower than main (at most 3.5x class mode)', () => {
    const cmd = Array.from({ length: 1600 }, (_, i) => `V${i}=~/.local/bin/claude; `).join('');
    const t0 = process.hrtime.bigint();
    const cls = spawnSync('jq', ['-r', '--arg', 'q', "'", '--arg', 'mode', 'class', hookForbiddenJq()], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: cmd } }), encoding: 'utf8', maxBuffer: 1 << 26 });
    const classMs = Number(process.hrtime.bigint() - t0) / 1e6;
    expect(cls.status, cls.stderr).toBe(0);
    const r = spawnSync('jq', ['-r', '--arg', 'q', "'", '--arg', 'mode', 'deny', hookForbiddenJq()], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: cmd } }), encoding: 'utf8', timeout: 60_000 });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain(BUILD_WHY);
    expect(denyJqMs(cmd)).toBeLessThan(3.5 * classMs);
  }, 180_000);
  // The cap counts assignments, not distinct names: seventeen of one name used to fill a 17-match window that `unique`
  // then shrank to one, so an eighteenth name's writer went unread.
  it('seventeen assignments of one name, then a writer through another, is denied', () => {
    expect(bash(`${'V=~/.local/bin/claude; '.repeat(17)}W=~/.local/bin/claude; cp /tmp/x $W`)).toContain(BUILD_WHY);
  });
  it('a few build-path assignments and no writer are allowed; a writer through any of them is denied', () => {
    const vars = Array.from({ length: 12 }, (_, i) => `V${i}=~/.local/share/claude/versions; `).join('');
    expect(bash(`${vars}ls $V3`)).toBeNull();
    expect(bash(`${vars}cp x $V7/2.1.400`)).toContain(BUILD_WHY);
  });
});

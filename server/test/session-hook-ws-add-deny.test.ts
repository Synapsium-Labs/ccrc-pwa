/**
 * The child's workspace deny (D-8978, D-8979): the session hook's PreToolUse arm DENIES `ccd ws-add` in a workspace that
 * carries the child marker (`$REG/<id>.child`, which only a dispatch writes). A workspace a worker makes itself belongs to
 * no run, so the console lists it as "Not in a programme" and its coordinator never sees it. The arm rides the worker
 * merge deny's strip and head grammar (`CCD_WSADD_RE`, cut where `CCD_DOOR_RE` is), so a mention in quoted text, a
 * comment or a heredoc passes, as a merge mention does. A session without the marker is never asked: a coordinator, the
 * operator and a held but unmarked session run `ccd ws-add` as before, and the server's own dispatch
 * (`ws-add --no-rc --child <run>`) is an agent exec, never a tool call, so no hook sees it.
 *
 * `fixtures/ws-add-deny/must-deny.json` is every spelling a child is refused; `must-allow.json` is what a child (working
 * on ccrc itself, say) writes that names the verb and must pass. Both are iterated, never respelled here.
 *
 * Runs `ccd/session-hook.sh` for real in a fixture HOME, as `session-hook-merge-deny.test.ts` does.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { CHILD_DENY_RULES } from '../../shared/api.js';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');
const FIX = path.resolve(__dirname, 'fixtures/ws-add-deny');
const MUST_DENY: string[] = JSON.parse(fs.readFileSync(path.join(FIX, 'must-deny.json'), 'utf8'));
const MUST_ALLOW: string[] = JSON.parse(fs.readFileSync(path.join(FIX, 'must-allow.json'), 'utf8'));
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
const ID = 'demo-quiet-basin';
const WAVE_HOLD = 'program:project-a wave:2/5 run:17';
/** The server's dispatch argv as a child would have to type it (`dispatch.ts` composes it through `CcdArgv`). */
const DISPATCH = "ccd ws-add --no-rc --child 17 --surface agent --actor 'run:17 dispatch' project-a slug-a";

let home: string;
beforeEach(() => {
  home = mkTmp('ccrc-childws-');
  fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  fs.writeFileSync(path.join(home, '.cc-sessions', `${ID}.generation`), GENERATION);
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'tmux'), `#!/bin/sh\necho "cc-${ID}"\n`, { mode: 0o755 });
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const reg = (name: string): string => path.join(home, '.cc-sessions', name);
/** The child marker, as `cmd_ws_add --child 17` writes it. */
const marker = (): void => { fs.writeFileSync(reg(`${ID}.child`), '17'); };

const bash = (command: string): string | null => {
  const r = spawnSync('bash', [HOOK], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: home }),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
      TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION },
  });
  expect(r.status, 'the hook contract: exit 0 on every path').toBe(0);
  expect(r.stderr, 'the hook contract: silent on stderr').toBe('');
  const line = r.stdout.trim();
  if (line === '') return null;
  const j = JSON.parse(line) as { hookSpecificOutput: { permissionDecision?: string; permissionDecisionReason?: string } };
  return j.hookSpecificOutput.permissionDecision === 'deny' ? String(j.hookSpecificOutput.permissionDecisionReason) : null;
};
const WS_REASON = 'a child never creates a workspace (`ccd ws-add`)';

describe('the child\'s workspace deny (D-8978)', () => {
  it('the corpus holds the server\'s dispatch argv among the spellings a child is refused', () => {
    expect(MUST_DENY).toContain(DISPATCH);
    expect(MUST_DENY.length).toBeGreaterThan(10);
    expect(MUST_ALLOW.length).toBeGreaterThan(10);
  });

  it.each(MUST_DENY)('a child is refused %j, with the workspace reason', (c) => {
    marker();
    const d = bash(c);
    expect(d, c).not.toBeNull();
    expect(d, c).toContain(WS_REASON);
    expect(d, 'the reason sends the child to its coordinator').toContain('ask your coordinator');
  });

  it.each(MUST_ALLOW)('a child passes %j', (c) => {
    marker();
    expect(bash(c), c).toBeNull();
  });

  it('a dangling marker link is still a marker: existence decides, never contents', () => {
    fs.symlinkSync(path.join(home, 'nowhere'), reg(`${ID}.child`));
    expect(bash('ccd ws-add project-a')).toContain(WS_REASON);
  });

  it('a session without the marker is never asked: top-level, and held but unmarked, run every spelling as before', () => {
    for (const c of MUST_DENY) expect(bash(c), `top-level: ${c}`).toBeNull();
    fs.writeFileSync(reg(`${ID}.hold`), WAVE_HOLD);
    for (const c of [DISPATCH, 'ccd ws-add project-a slug-a']) expect(bash(c), `held: ${c}`).toBeNull();
  });

  it('a merge deny already set is kept: the workspace question is asked only when the merge questions set none', () => {
    marker();
    const d = bash('ccd ws-add project-a; gh pr merge 42');
    expect(d, 'the merge question answers first').toContain('a wave\'s session never merges');
    expect(d).not.toContain(WS_REASON);
  });

  it('LISTED passes, said rather than hidden: a `bash -c` string, a variable command word and a quoted verb', () => {
    marker();
    for (const c of ['bash -c "ccd ws-add project-a"', 'C=ccd; $C ws-add project-a', "ccd 'ws-add' project-a"]) {
      expect(bash(c), c).toBeNull();
    }
    const hook = fs.readFileSync(HOOK, 'utf8');
    const a = hook.indexOf('# THE CHILD\'S WORKSPACE DENY (D-8978, D-8979).');
    expect(a, 'the hook\'s header names the arm').toBeGreaterThan(0);
    const b = hook.indexOf('\n#\n', a);
    expect(hook.slice(a, b), 'the header says it is an accident guard').toContain('AN ACCIDENT GUARD, NOT A WALL');
    expect(hook.slice(a, b)).toContain('`bash -c "…"`, a quoted or variable command word, a quoted verb');
  });

  it('CCD_WSADD_RE is derived from GH_MERGE_RE\'s head: the cut occurs once and the head is shared', () => {
    const hookText = fs.readFileSync(HOOK, 'utf8');
    const defs = ['GH_MERGE_RE', 'CCD_DOOR_CUT', 'CCD_WSADD_RE'].map((n) => {
      const m = new RegExp(`^${n}=.*$`, 'm').exec(hookText);
      if (m === null) throw new Error(`the hook no longer defines ${n} on one line`);
      return m[0];
    }).join('\n');
    const run = (script: string, ...args: string[]): string => {
      const r = spawnSync('bash', ['-c', `${defs}\n${script}`, 'x', ...args], { encoding: 'utf8' });
      expect(r.status, r.stderr).toBe(0);
      return r.stdout;
    };
    const [mergeRe, cut, wsRe] = run('printf "%s\\0%s\\0%s" "$GH_MERGE_RE" "$CCD_DOOR_CUT" "$CCD_WSADD_RE"').split('\0') as [string, string, string];
    expect(mergeRe.split(cut).length, 'the cut occurs once in GH_MERGE_RE').toBe(2);
    const headEnd = wsRe.indexOf('ccd[ \t]+ws-add');
    expect(headEnd, 'the verb tail follows the head').toBeGreaterThan(0);
    expect(mergeRe.startsWith(wsRe.slice(0, headEnd)), 'CCD_WSADD_RE\'s head is GH_MERGE_RE\'s, character for character').toBe(true);
    const verdicts = (cmds: string[]): boolean[] =>
      run('for c in "$@"; do if [[ "$c" =~ $CCD_WSADD_RE ]]; then echo 1; else echo 0; fi; done', ...cmds).trim().split('\n').map((x) => x === '1');
    const yes = ['ccd ws-add x', 'HOME=/tmp/x ccd ws-add x', 'env ccd ws-add x', 'echo ok; ccd ws-add x', 'x=$(ccd ws-add y)',
      'timeout 60 ccd ws-add x', '~/.local/bin/ccd ws-add x', 'ccd ws-add;echo', 'ccd\tws-add'];
    const no = ['ccd ws-addx', 'echo ccd ws-add', 'xccd ws-add', 'ccd ws-list', 'ccd ws-ad', 'gh pr merge 42'];
    expect(verdicts(yes), `matched: ${yes.join(' | ')}`).toEqual(yes.map(() => true));
    expect(verdicts(no), `matched: ${no.join(' | ')}`).toEqual(no.map(() => false));
  });

  it('the deny file layer: CHILD_DENY_RULES names `ccd ws-add`, so Claude Code\'s own matcher stops the plain form too', () => {
    expect(CHILD_DENY_RULES).toContain('Bash(ccd ws-add:*)');
  });

  describe('the arm\'s budget', () => {
    /** A `jq` first on PATH that logs each call's option words, then runs the real one. */
    const countJq = (): void => {
      const real = (process.env['PATH'] ?? '').split(':').map((d) => path.join(d, 'jq')).find((p) => fs.existsSync(p));
      if (real === undefined) throw new Error('no jq on PATH');
      fs.writeFileSync(path.join(home, 'bin', 'jq'),
        `#!/bin/sh\nl=""\nfor a in "$@"; do case "$a" in -*|cap|allow) l="$l $a";; esac; done\necho "$l" >> "${path.join(home, 'jq.calls')}"\nexec ${real} "$@"\n`,
        { mode: 0o755 });
    };
    const strips = (c: string): number => {
      const f = path.join(home, 'jq.calls');
      fs.rmSync(f, { force: true });
      bash(c);
      return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.includes('--argjson cap')).length : 0;
    };

    it('only a child\'s `ws-add` payload wakes the strip; no other session forks for it', () => {
      countJq();
      bash('echo warm');
      expect(strips('ccd ws-add project-a'), 'a top-level session forked the strip for ws-add').toBe(0);
      marker();
      expect(strips('ccd ws-add project-a'), 'a child\'s ws-add did not wake the strip once').toBe(1);
      expect(strips('ccd ws-adz project-a'), 'a child\'s other verb woke the strip').toBe(0);
    });
  });
});

/**
 * The worker ready deny (D-8997, D-8998): a PR still under review must not be landable, so a worker opens its PR as a
 * draft and only the coordinator marks it ready for review, once its review passes and immediately before it lands it.
 * The session hook's PreToolUse arm DENIES `gh pr ready` to a session it calls a worker: one whose hold names a programme
 * wave, or whose workspace carries the child marker (`$REG/<id>.child`, which only a dispatch writes). The arm rides the
 * worker merge deny's strip and head grammar (`GH_READY_RE`, derived from `GH_MERGE_RE`), so a mention in quoted text, a
 * comment or a heredoc passes, as a merge mention does, and `gh pr ready <n> --undo` (back to a draft) passes, the flag
 * read as a whole word of that command (`--undo=false` is a ready, and refused). The same worker is refused a
 * `gh pr create` that holds no `--draft` or `-d`, the likelier accident. A session with neither, a coordinator's or the
 * operator's, is never asked: the coordinator's `gh pr ready <n>` runs.
 *
 * `fixtures/pr-ready-deny/must-deny.json` is every spelling of a ready a worker is refused; `must-allow.json` is what a
 * worker writes that names the verb and must pass; `create-must-deny.json` and `create-must-allow.json` are the same for
 * `gh pr create`. All four are iterated, never respelled here.
 *
 * Runs `ccd/session-hook.sh` for real in a fixture HOME, as `session-hook-ws-add-deny.test.ts` does.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');
const FIX = path.resolve(__dirname, 'fixtures/pr-ready-deny');
const MUST_DENY: string[] = JSON.parse(fs.readFileSync(path.join(FIX, 'must-deny.json'), 'utf8'));
const MUST_ALLOW: string[] = JSON.parse(fs.readFileSync(path.join(FIX, 'must-allow.json'), 'utf8'));
const CREATE_DENY: string[] = JSON.parse(fs.readFileSync(path.join(FIX, 'create-must-deny.json'), 'utf8'));
const CREATE_ALLOW: string[] = JSON.parse(fs.readFileSync(path.join(FIX, 'create-must-allow.json'), 'utf8'));
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
const ID = 'demo-quiet-basin';
const WAVE_HOLD = 'program:project-a wave:2/5 run:17';

let home: string;
beforeEach(() => {
  home = mkTmp('ccrc-prrdy-');
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
/** A dispatched worker's hold, as dispatch writes it. */
const hold = (v: string = WAVE_HOLD): void => { fs.writeFileSync(reg(`${ID}.hold`), v); };

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
const READY_REASON = 'a worker never marks its own PR ready for review (`gh pr ready`)';
const CREATE_REASON = 'a worker opens its PR as a draft: a `gh pr create` without `--draft`';

describe('the worker ready deny (D-8998)', () => {
  it('the corpora are non-trivial and hold the plain spelling and its undo', () => {
    expect(MUST_DENY).toContain('gh pr ready 42');
    expect(MUST_ALLOW).toContain('gh pr ready 42 --undo');
    expect(MUST_DENY.length).toBeGreaterThan(10);
    expect(MUST_ALLOW.length).toBeGreaterThan(10);
  });

  it.each(MUST_DENY)('a child is refused %j, with the ready reason', (c) => {
    marker();
    const d = bash(c);
    expect(d, c).not.toBeNull();
    expect(d, c).toContain(READY_REASON);
    expect(d, c).toContain('child marker');
    expect(d, 'the reason names the remedy for a PR opened ready').toContain('gh pr ready <n> --undo');
  });

  it.each(MUST_DENY)('a session whose hold names a programme wave is refused %j', (c) => {
    hold();
    const d = bash(c);
    expect(d, c).not.toBeNull();
    expect(d, c).toContain(READY_REASON);
    expect(d, c).toContain('hold names a programme wave');
  });

  it.each(MUST_ALLOW)('a worker passes %j', (c) => {
    marker();
    hold();
    expect(bash(c), c).toBeNull();
  });

  it('the create corpora are non-trivial and hold the bare create, its draft and the false value', () => {
    expect(CREATE_DENY).toContain('gh pr create --fill');
    expect(CREATE_DENY).toContain('gh pr create --draft=false --fill');
    expect(CREATE_ALLOW).toContain('gh pr create --draft --fill');
    expect(CREATE_DENY.length).toBeGreaterThan(10);
    expect(CREATE_ALLOW.length).toBeGreaterThan(10);
  });

  it.each(CREATE_DENY)('a child is refused the ready-PR create %j, with the create reason', (c) => {
    marker();
    const d = bash(c);
    expect(d, c).not.toBeNull();
    expect(d, c).toContain(CREATE_REASON);
    expect(d, c).toContain('child marker');
    expect(d, 'the reason names the draft spelling').toContain('gh pr create --draft');
  });

  it.each(CREATE_DENY)('a session whose hold names a programme wave is refused the ready-PR create %j', (c) => {
    hold();
    const d = bash(c);
    expect(d, c).not.toBeNull();
    expect(d, c).toContain(CREATE_REASON);
    expect(d, c).toContain('hold names a programme wave');
  });

  it.each(CREATE_ALLOW)('a worker passes the create %j', (c) => {
    marker();
    hold();
    expect(bash(c), c).toBeNull();
  });

  it('a dangling marker link is still a marker: existence decides, never contents', () => {
    fs.symlinkSync(path.join(home, 'nowhere'), reg(`${ID}.child`));
    expect(bash('gh pr ready 42')).toContain(READY_REASON);
  });

  it('a session with neither is never asked: the coordinator and a top-level session run every spelling', () => {
    for (const c of [...MUST_DENY, ...CREATE_DENY]) expect(bash(c), `top-level: ${c}`).toBeNull();
    hold('program:project-a');
    expect(bash('gh pr ready 42'), 'a hold that names no wave is not a worker').toBeNull();
  });

  it('a merge deny already set is kept: the ready question is asked only when nothing above set a deny', () => {
    marker();
    const d = bash('gh pr ready 42; gh pr merge 42');
    expect(d, 'the merge question answers first').toContain('a wave\'s session never merges');
    expect(d).not.toContain(READY_REASON);
  });

  it('LISTED passes, said rather than hidden: a `bash -c` string, a variable command word and a quoted verb', () => {
    marker();
    for (const c of ['bash -c "gh pr ready 42"', 'G=gh; $G pr ready 42', "gh pr 'ready' 42"]) {
      expect(bash(c), c).toBeNull();
    }
    const hook = fs.readFileSync(HOOK, 'utf8');
    const a = hook.indexOf('# THE WORKER READY DENY (D-8997, D-8998).');
    expect(a, 'the hook\'s header names the arm').toBeGreaterThan(0);
    const b = hook.indexOf('\n#\n', a);
    const header = hook.slice(a, b).replace(/\n# ?/g, ' ');
    expect(header, 'the header says it is an accident guard').toContain('AN ACCIDENT GUARD, NOT A WALL');
    expect(header).toContain('`bash -c "…"`, a quoted or variable command word, a quoted verb');
  });

  it('GH_READY_RE is derived from GH_MERGE_RE: the cut occurs once and the head and gh flags are shared', () => {
    const hookText = fs.readFileSync(HOOK, 'utf8');
    const defs = ['GH_MERGE_RE', 'GH_READY_CUT', 'GH_READY_RE'].map((n) => {
      const m = new RegExp(`^${n}=.*$`, 'm').exec(hookText);
      if (m === null) throw new Error(`the hook no longer defines ${n} on one line`);
      return m[0];
    }).join('\n');
    const run = (script: string, ...args: string[]): string => {
      const r = spawnSync('bash', ['-c', `${defs}\n${script}`, 'x', ...args], { encoding: 'utf8' });
      expect(r.status, r.stderr).toBe(0);
      return r.stdout;
    };
    const [mergeRe, cut, readyRe] = run('printf "%s\\0%s\\0%s" "$GH_MERGE_RE" "$GH_READY_CUT" "$GH_READY_RE"').split('\0') as [string, string, string];
    expect(mergeRe.split(cut).length, 'the cut occurs once in GH_MERGE_RE').toBe(2);
    const tail = readyRe.lastIndexOf('[ \t]+ready(');
    expect(tail, 'the verb tail follows the head').toBeGreaterThan(0);
    expect(mergeRe.startsWith(readyRe.slice(0, tail)), 'GH_READY_RE\'s head is GH_MERGE_RE\'s, character for character').toBe(true);
    expect(mergeRe.slice(tail).startsWith(cut), 'only the verb tail differs').toBe(true);
    const verdicts = (cmds: string[]): boolean[] =>
      run('for c in "$@"; do if [[ "$c" =~ $GH_READY_RE ]]; then echo 1; else echo 0; fi; done', ...cmds).trim().split('\n').map((x) => x === '1');
    const yes = ['gh pr ready 42', 'gh -R o/r pr ready 1', 'gh pr -R o/r ready', 'echo ok; gh pr ready', 'x=$(gh pr ready 4)',
      '/usr/local/bin/gh pr ready 1', 'timeout 60 gh pr ready 3', 'gh pr ready;echo'];
    const no = ['gh pr readyx', 'echo gh pr ready', 'gh pr merge 42', 'gh pr view 42', 'gh ready', 'xgh pr ready'];
    expect(verdicts(yes), `matched: ${yes.join(' | ')}`).toEqual(yes.map(() => true));
    expect(verdicts(no), `matched: ${no.join(' | ')}`).toEqual(no.map(() => false));
  });

  it('GH_READY_UNDO_RE, GH_CREATE_RE and GH_CREATE_DRAFT_RE share GH_READY_RE\'s head and read a whole flag of that command', () => {
    const hookText = fs.readFileSync(HOOK, 'utf8');
    const names = ['GH_MERGE_RE', 'GH_READY_CUT', 'GH_READY_RE', 'GH_READY_UNDO_RE', 'GH_CREATE_RE', 'GH_CREATE_DRAFT_RE'];
    const defs = names.map((n) => {
      const m = new RegExp(`^${n}=.*$`, 'm').exec(hookText);
      if (m === null) throw new Error(`the hook no longer defines ${n} on one line`);
      return m[0];
    }).join('\n');
    for (const n of ['GH_READY_UNDO_RE', 'GH_CREATE_RE', 'GH_CREATE_DRAFT_RE']) {
      expect(defs, `${n} is derived from GH_MERGE_RE by the same cut`).toContain(`${n}=\${GH_MERGE_RE%"$GH_READY_CUT"*}`);
    }
    const verdicts = (re: string, cmds: string[]): boolean[] => {
      const script = `${defs}\nfor c in "$@"; do if [[ "$c" =~ $${re} ]]; then echo 1; else echo 0; fi; done`;
      const r = spawnSync('bash', ['-c', script, 'x', ...cmds], { encoding: 'utf8' });
      expect(r.status, r.stderr).toBe(0);
      return r.stdout.trim().split('\n').map((x) => x === '1');
    };
    const undoYes = ['gh pr ready 42 --undo', 'gh pr ready --undo 42', 'gh pr ready 42 --undo=true', 'gh pr ready 42 --undo;echo'];
    const undoNo = ['gh pr ready 42 --undo=false', 'gh pr ready 42 --undone', 'echo --undo; gh pr ready 42', 'gh pr ready 42'];
    expect(verdicts('GH_READY_UNDO_RE', undoYes), undoYes.join(' | ')).toEqual(undoYes.map(() => true));
    expect(verdicts('GH_READY_UNDO_RE', undoNo), undoNo.join(' | ')).toEqual(undoNo.map(() => false));
    const draftYes = ['gh pr create --draft', 'gh pr create --fill -d', 'gh pr new --draft=1', 'gh -R o/r pr create --draft --fill'];
    const draftNo = ['gh pr create --fill', 'gh pr create --draft=false', 'gh pr create --fill; echo --draft', 'gh pr create --drafts'];
    expect(verdicts('GH_CREATE_DRAFT_RE', draftYes), draftYes.join(' | ')).toEqual(draftYes.map(() => true));
    expect(verdicts('GH_CREATE_DRAFT_RE', draftNo), draftNo.join(' | ')).toEqual(draftNo.map(() => false));
    const createYes = ['gh pr create', 'gh pr new --fill', 'echo ok; gh pr create --fill'];
    const createNo = ['gh pr created', 'gh issue create', 'echo gh pr create'];
    expect(verdicts('GH_CREATE_RE', createYes), createYes.join(' | ')).toEqual(createYes.map(() => true));
    expect(verdicts('GH_CREATE_RE', createNo), createNo.join(' | ')).toEqual(createNo.map(() => false));
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

    it('only a worker\'s `ready` payload wakes the strip; no other session forks for it', () => {
      countJq();
      bash('echo warm');
      expect(strips('gh pr ready 42'), 'a top-level session forked the strip for ready').toBe(0);
      hold();
      expect(strips('gh pr ready 42'), 'a held worker\'s ready did not wake the strip once').toBe(1);
      expect(strips('gh pr view 42'), 'a worker\'s other verb woke the strip').toBe(0);
      expect(strips('gh pr create --fill'), 'a held worker\'s create did not wake the strip once').toBe(1);
    });
  });
});

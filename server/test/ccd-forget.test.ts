/**
 * `ccd forget <id>` — the end-of-life a non-workspace session never had.
 *
 * A dead wrapper session (`claude-corp-data-internal`, exited, tmux gone) was
 * an IMMORTAL fleet row: the only removal flow in the design is archive→reap,
 * both workspace-only by contract, and `_reg_purge` was reachable solely from
 * `ws-rm`, `ws-reap`'s tail and `ws-gc`'s dead-reg arm — all workspace-scoped.
 * `forget` removes exactly the registry entry and nothing else: no git state
 * is involved (that is what makes it safe), and the transcript and pasted
 * images stay on disk — a deletion this verb does not name is not one anybody
 * consented to, so it deletes nothing it would have to name.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, WS_ADD, ghContainedEnv, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-forget-'); });
afterEach(() => { h.cleanup(); });

/** Deadness is a PRECONDITION `forget` proves, so `_alive` answers "no" by
 *  default and one test flips it. `_ws_unsupervise` logs so the resurrection
 *  guard is visible; tmux logs for the same reason. */
const DEAD = `_ws_unsupervise() { echo "unsupervise $1" >> "$HOME/ccd-calls"; };
  tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; return 1; }; _alive() { return 1; };`;

const shFail = (snippet: string): { code: number; stderr: string; stdout: string } => {
  try { return { code: 0, stderr: '', stdout: h.sh(snippet) }; }
  catch (e) {
    const err = e as { status?: number; stderr?: Buffer; stdout?: Buffer };
    return { code: err.status ?? 1, stderr: String(err.stderr ?? ''), stdout: String(err.stdout ?? '') };
  }
};

/** A dead wrapper session on a project's main checkout — the exact registry
 *  shape `claude-corp-data-internal` had in production: uuid, project,
 *  workdir, wrapper, hookstate — and NO `.workspace`. Written with `_reg_set`
 *  (the same writer ccd uses) rather than `cmd_start`, which would want tmux. */
const deadWrapperSession = (id = 'claude-corp-demo'): string => {
  h.sh(`_reg_set ${id} uuid 72be9ee2-0000-4bcc-b60b-0cfc0dc3d199
    _reg_set ${id} project demo
    _reg_set ${id} workdir /data/projects/demo
    _reg_set ${id} wrapper claude-corp`);
  fs.writeFileSync(path.join(h.home, '.cc-sessions', `${id}.hookstate.json`), '{"v":1}');
  return id;
};

describe('ccd forget', () => {
  it('purges a dead non-workspace session — the whole entry, nothing else', () => {
    const id = deadWrapperSession();
    // The two things forget must NOT touch, planted so their survival is an
    // assertion rather than an accident: the transcript and the pasted images.
    const tdir = path.join(h.home, '.claude-corp', 'projects', '-data-projects-demo');
    fs.mkdirSync(tdir, { recursive: true });
    const transcript = path.join(tdir, '72be9ee2-0000-4bcc-b60b-0cfc0dc3d199.jsonl');
    fs.writeFileSync(transcript, '{"type":"message"}\n');
    const clips = path.join(h.home, '.cc-clips', id);
    fs.mkdirSync(clips, { recursive: true });
    fs.writeFileSync(path.join(clips, 'paste-1.png'), 'png');

    const out = h.sh(`${DEAD} cmd_forget ${id}`);
    expect(out).toContain(`forgot ${id}`);
    // Every registry file goes, including the dotted one the purge loop skips
    // by suffix and removes by name.
    const left = fs.readdirSync(path.join(h.home, '.cc-sessions')).filter((n) => n.startsWith(`${id}.`));
    expect(left).toEqual([]);
    // What was kept is still there, verbatim.
    expect(fs.existsSync(transcript)).toBe(true);
    expect(fs.existsSync(path.join(clips, 'paste-1.png'))).toBe(true);
  });

  it('disables supervision before purging, so the unit cannot resurrect a forgotten row', () => {
    const id = deadWrapperSession();
    h.sh(`${DEAD} cmd_forget ${id}`);
    const calls = fs.readFileSync(path.join(h.home, 'ccd-calls'), 'utf8');
    expect(calls).toContain(`unsupervise ${id}`);
  });

  it('refuses a session that is still running', () => {
    const id = deadWrapperSession();
    const r = shFail(`_alive() { return 0; }; cmd_forget ${id}`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('still running');
    expect(h.reg(id, 'uuid'), 'a refusal must not purge anything').not.toBeNull();
  });

  it('refuses a workspace — those have the audited path, and forget is not it', () => {
    h.makeRepo('demo');
    h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
    const r = shFail(`${DEAD} cmd_forget demo-quiet-basin`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('workspace');
    expect(h.reg('demo-quiet-basin', 'uuid')).not.toBeNull();
    expect(fs.existsSync(path.join(h.home, 'worktrees', 'demo', 'quiet-basin'))).toBe(true);
  });

  it('refuses a held session — present-but-unreadable reads as held too', () => {
    const id = deadWrapperSession();
    fs.writeFileSync(path.join(h.home, '.cc-sessions', `${id}.hold`), 'program:evals');
    const r = shFail(`${DEAD} cmd_forget ${id}`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('held');
    expect(h.reg(id, 'uuid')).not.toBeNull();
  });

  it('refuses an id it has no record of, and a bad id shape outright', () => {
    expect(shFail(`${DEAD} cmd_forget nope-never`).stderr).toContain('no such session');
    expect(shFail(`${DEAD} cmd_forget 'a/b'`).code).not.toBe(0);
  });
});

describe('the dispatcher', () => {
  const runCcd = (...args: string[]): { code: number; stdout: string; stderr: string } => {
    try {
      return {
        code: 0, stderr: '',
        stdout: execFileSync('bash', [CCD, ...args], {
          encoding: 'utf8', cwd: h.home,
          env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true }),
        }),
      };
    } catch (e) {
      const err = e as { status?: number; stdout?: Buffer; stderr?: Buffer };
      return { code: err.status ?? 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') };
    }
  };

  it('routes forget, demands its argv, and advertises it in caps', () => {
    const r = runCcd('forget');
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('usage: ccd forget <id>');
    expect(runCcd('caps').stdout.split('\n')).toContain('forget');
  });
});

// ccd owns worktree lifecycle beside the tmux and systemd lifecycle it already
// owns. These tests source ccd under an isolated HOME, exactly as
// ccd-limits.test.ts does, so nothing here can touch the real registry.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const CCD = path.resolve(__dirname, '../../../ccrc-portability/ccd');
let home: string;

const sh = (snippet: string): string =>
  execFileSync('bash', ['-c', `source "${CCD}"; ${snippet}`],
    { encoding: 'utf8', env: { ...process.env, HOME: home } }).trim();

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'ccrc-ccd-ws-'));
  fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  fs.mkdirSync(path.join(home, '.cc-limits'), { recursive: true });
  const bin = path.join(home, '.local', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  for (const w of ['claude', 'claude2', 'claude-corp']) {
    fs.writeFileSync(path.join(bin, w), '#!/bin/sh\n', { mode: 0o755 });
  }
});

afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const reg = (id: string, field: string): string | null => {
  const p = path.join(home, '.cc-sessions', `${id}.${field}`);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : null;
};

describe('home is explicit at creation', () => {
  it('writes home when cmd_start registers a new session', () => {
    fs.mkdirSync(path.join(home, 'projects', 'demo'), { recursive: true });
    // _spawn needs tmux; register only, then assert the field.
    sh(`_reg_set claude2-demo wrapper claude2
        _reg_set claude2-demo project demo
        _ws_seed_home claude2-demo claude2`);
    expect(reg('claude2-demo', 'home')).toBe('claude2');
  });

  it('does not overwrite a home that was already chosen', () => {
    sh(`_reg_set claude2-demo home claude-corp
        _ws_seed_home claude2-demo claude2`);
    expect(reg('claude2-demo', 'home')).toBe('claude-corp');
  });
});

describe('slug rules', () => {
  const ok = (s: string): boolean =>
    sh(`_ws_slug_valid '${s}' && echo yes || echo no`) === 'yes';

  it('accepts lowercase alphanumeric and hyphens', () => {
    expect(ok('quiet-mesa')).toBe(true);
    expect(ok('a1')).toBe(true);
  });

  it('rejects dots, because tmux -t reads session:window.pane', () => {
    expect(ok('quiet.mesa')).toBe(false);
  });

  it('rejects slashes, because systemd instance names escape them', () => {
    expect(ok('feat/thing')).toBe(false);
  });

  it('rejects a leading hyphen, uppercase, and over-length', () => {
    expect(ok('-mesa')).toBe(false);
    expect(ok('Quiet-Mesa')).toBe(false);
    expect(ok('a'.repeat(32))).toBe(false);
  });

  it('generates a slug that is itself valid', () => {
    const slug = sh(`_ws_slug_new demo`);
    expect(sh(`_ws_slug_valid '${slug}' && echo yes || echo no`)).toBe('yes');
  });

  it('never collides with an existing registry entry', () => {
    // Pin the generator to one candidate, then occupy it.
    fs.writeFileSync(path.join(home, '.cc-sessions', 'demo-quiet-mesa.uuid'), 'x');
    const slug = sh(`CCD_WS_SLUG=quiet-mesa _ws_slug_new demo || echo EXHAUSTED`);
    expect(slug).toBe('EXHAUSTED');
  });

  it('honours CCD_WS_SLUG when the name is free', () => {
    expect(sh(`CCD_WS_SLUG=quiet-mesa _ws_slug_new demo`)).toBe('quiet-mesa');
  });

  it('rejects an invalid CCD_WS_SLUG rather than passing it through', () => {
    expect(sh(`CCD_WS_SLUG=quiet.mesa _ws_slug_new demo || echo REJECTED`)).toBe('REJECTED');
    expect(sh(`CCD_WS_SLUG=feat/thing _ws_slug_new demo || echo REJECTED`)).toBe('REJECTED');
  });
});

/** A real git repo with one commit and an origin, so worktree/base logic is
 *  exercised for real rather than mocked. */
const makeRepo = (name: string): string => {
  const origin = path.join(home, 'origins', `${name}.git`);
  const main = path.join(home, 'projects', name);
  execFileSync('git', ['init', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-b', 'main', main]);
  const g = (...a: string[]): void => {
    execFileSync('git', ['-C', main, ...a], {
      env: { ...process.env, HOME: home, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@x',
             GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x' },
    });
  };
  fs.writeFileSync(path.join(main, 'README.md'), 'hi\n');
  g('add', 'README.md');
  g('commit', '-m', 'init');
  g('remote', 'add', 'origin', origin);
  g('push', '-u', 'origin', 'main');
  g('remote', 'set-head', 'origin', '-a');
  return main;
};

/** ws-add spawns a session; tmux is not available under test, so stub _spawn
 *  and the systemd call. Everything else runs for real. */
const WS_ADD = `_spawn() { :; }; _ws_supervise() { :; };`;

describe('ws-add', () => {
  it('creates a worktree on a new branch off origin/HEAD', () => {
    makeRepo('demo');
    sh(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
    const wt = path.join(home, 'worktrees', 'demo', 'quiet-mesa');
    expect(fs.existsSync(path.join(wt, 'README.md'))).toBe(true);
    const branch = execFileSync('git', ['-C', wt, 'rev-parse', '--abbrev-ref', 'HEAD'],
      { encoding: 'utf8' }).trim();
    expect(branch).toBe('quiet-mesa');
  });

  it('registers the workspace with every field the wire needs', () => {
    makeRepo('demo');
    sh(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
    expect(reg('demo-quiet-mesa', 'project')).toBe('demo');
    expect(reg('demo-quiet-mesa', 'workspace')).toBe('quiet-mesa');
    expect(reg('demo-quiet-mesa', 'base')).toBe('origin/main');
    expect(reg('demo-quiet-mesa', 'workdir'))
      .toBe(path.join(home, 'worktrees', 'demo', 'quiet-mesa'));
    expect(reg('demo-quiet-mesa', 'home')).not.toBeNull();
    // wrapper and uuid are what _spawn's own guard demands
    // (`[[ -n "$wrapper" && -n "$workdir" && -n "$uuid" ]] || die ...`, ccd:497-503).
    // _spawn is stubbed to a no-op under every ws-add test, so that guard never
    // runs here — these two assertions are what would catch a dropped
    // `_reg_set` for either field instead of a silent, worktree-already-created
    // "incomplete registry" death in production. No .cc-limits fixtures exist
    // in this test's HOME, so _ws_least_loaded is deterministic: every wrapper
    // scores 0 and the first of VALID_WRAPPERS (claude) wins.
    expect(reg('demo-quiet-mesa', 'wrapper')).toBe('claude');
    expect(reg('demo-quiet-mesa', 'uuid')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('excludes .ccrc/ so a draft file can never be committed', () => {
    const main = makeRepo('demo');
    sh(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
    const exclude = fs.readFileSync(path.join(main, '.git', 'info', 'exclude'), 'utf8');
    expect(exclude).toContain('.ccrc/');
  });

  it('runs .ccrc/workspace.sh with MAIN and WT set', () => {
    const main = makeRepo('demo');
    fs.mkdirSync(path.join(main, '.ccrc'));
    fs.writeFileSync(path.join(main, '.ccrc', 'workspace.sh'),
      '#!/bin/sh\nprintf "%s\\n%s\\n" "$MAIN" "$WT" > "$WT/setup-ran"\n', { mode: 0o755 });
    sh(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
    const wt = path.join(home, 'worktrees', 'demo', 'quiet-mesa');
    expect(fs.readFileSync(path.join(wt, 'setup-ran'), 'utf8')).toBe(`${main}\n${wt}\n`);
  });

  it('records setup failure without destroying the workspace', () => {
    const main = makeRepo('demo');
    fs.mkdirSync(path.join(main, '.ccrc'));
    fs.writeFileSync(path.join(main, '.ccrc', 'workspace.sh'), '#!/bin/sh\nexit 3\n', { mode: 0o755 });
    sh(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
    expect(reg('demo-quiet-mesa', 'setup')).toBe('failed');
    expect(fs.existsSync(path.join(home, 'worktrees', 'demo', 'quiet-mesa'))).toBe(true);
  });

  it('refuses a project that is not a git repo', () => {
    fs.mkdirSync(path.join(home, 'projects', 'bare'), { recursive: true });
    expect(() => sh(`${WS_ADD} cmd_ws_add bare`)).toThrow();
  });
});

describe('_ws_least_loaded', () => {
  it('picks the account with the most headroom, not VALID_WRAPPERS[0]', () => {
    // Same fixture shape _limit_score reads, per ccd-limits.test.ts: {"five":N,"seven":N,"ts":epoch}.
    // claude (first in VALID_WRAPPERS) is made the WORST choice on purpose, so a selector
    // that just returned the first wrapper (ignoring load) would fail this assertion.
    const t = Math.floor(Date.now() / 1000);
    const writeLimits = (wrapper: string, five: number, seven: number): void =>
      fs.writeFileSync(path.join(home, '.cc-limits', `${wrapper}.json`),
        JSON.stringify({ five, seven, ts: t }));
    writeLimits('claude', 80, 40);       // score 80 — worst
    writeLimits('claude2', 5, 3);        // score 5 — cheapest
    writeLimits('claude-corp', 90, 95);  // score 95 — worst of all
    expect(sh('_ws_least_loaded')).toBe('claude2');
  });
});

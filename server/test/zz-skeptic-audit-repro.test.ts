import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { WS_ADD } from './ccdWsHelpers.js';
import { GH_STUB, makePrHarness, type PrHarness } from './ccdPrHelpers.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-skeptic-'); });
afterEach(() => { h.cleanup(); });

const ARCH = `_ws_unsupervise() { echo "unsupervise $1" >> "$HOME/ccd-calls"; };
  _ws_supervise() { :; }; _spawn() { :; }; _spawn_start() { SPAWN_FROMSWAP=0; }; _spawn_settle() { :; };
  tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; return 1; }; _session_verdict() { echo gone; };`;

function drifted(): { main: string; wt: string } {
  const main = h.makeGhRepo('demo');
  h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
  const wt = path.join(h.home, 'worktrees', 'demo', 'quiet-basin');
  fs.writeFileSync(path.join(wt, 'f1.txt'), 'work 1\n');
  h.git(wt, 'add', 'f1.txt');
  h.git(wt, 'commit', '-m', 'work 1');
  h.git(main, 'merge', '--ff-only', 'ws/quiet-basin');
  h.git(main, 'push', 'origin', 'main');
  h.sh(`cd "${wt}" && git checkout -q -b feat/x origin/main`);
  h.ghRows([]);
  h.sh(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
  return { main, wt };
}

describe('REPRO: drifted workspace, reap killed AFTER (f)', () => {
  it('what does the audit say the branch is?', () => {
    const { main, wt } = drifted();
    const tok = JSON.parse(h.sh(`${GH_STUB} ${ARCH} cmd_ws_audit --session demo-quiet-basin`)).token;
    expect(typeof tok).toBe('string');

    // A REAL interruption right after (f): the worktree removal succeeds and
    // the process is SIGKILLed before the breadcrumb advances to `branch`.
    const KILL = `${ARCH} git() { if [[ "$*" == *"worktree remove"* ]]; then command git "$@"; kill -9 $$; fi; command git "$@"; };`;
    const killed = h.run(`${GH_STUB} ${KILL} cmd_ws_reap --expect ${tok} --session demo-quiet-basin`);
    // eslint-disable-next-line no-console
    console.log('killed rc', killed.code, 'stdout', killed.stdout, 'stderr', killed.stderr);
    expect(fs.existsSync(wt), 'the worktree really is gone').toBe(false);
    expect(h.reg('demo-quiet-basin', 'reaping')).toBe('worktree');

    const tomb = JSON.parse(fs.readFileSync(
      path.join(h.home, '.cc-sessions', '.reaped', 'demo-quiet-basin.json'), 'utf8'));
    // eslint-disable-next-line no-console
    console.log('TOMB branch', tomb.branch, 'registryBranch', tomb.registryBranch, 'tip', tomb.tip);

    const a = JSON.parse(h.sh(`${GH_STUB} ${ARCH} cmd_ws_audit --session demo-quiet-basin`));
    // eslint-disable-next-line no-console
    console.log('AUDIT', JSON.stringify({
      verdict: a.verdict, branch: a.branch, registryBranch: a.registryBranch,
      drift: a.drift, headMatchesRegistry: a.headMatchesRegistry,
      commitsAheadOfBase: a.commitsAheadOfBase, merge: a.merge, pr: a.pr,
      reaping: a.reaping, exists: a.exists, detail: a.detail, token: a.token,
    }, null, 1));

    // And what does a resume actually delete?
    const feat = h.git(main, 'rev-parse', '--verify', 'refs/heads/feat/x');
    expect(feat).toMatch(/^[0-9a-f]{40}$/);
    const r = h.run(`${GH_STUB} ${ARCH} cmd_ws_reap --expect ${'0'.repeat(64)} --session demo-quiet-basin`);
    // eslint-disable-next-line no-console
    console.log('RESUME', r.code, r.stdout, r.stderr);
    // eslint-disable-next-line no-console
    console.log('after resume: feat/x =', h.git(main, 'branch', '--list', 'feat/x'),
      '| ws/quiet-basin =', h.git(main, 'branch', '--list', 'ws/quiet-basin'));
  }, 60000);
});

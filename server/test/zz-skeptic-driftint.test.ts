import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { WS_ADD } from './ccdWsHelpers.js';
import { GH_STUB, makePrHarness, type PrHarness } from './ccdPrHelpers.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-skeptic-driftint-'); });
afterEach(() => { h.cleanup(); });

const ARCH = `_ws_unsupervise() { :; }; _ws_supervise() { :; }; _spawn() { :; };
  _spawn_start() { SPAWN_FROMSWAP=0; }; _spawn_settle() { :; };
  tmux() { return 1; }; _session_verdict() { echo gone; };`;

const audit = (pre = '', id = 'demo-quiet-basin'): Record<string, any> =>
  JSON.parse(h.sh(`${GH_STUB} ${ARCH} ${pre} cmd_ws_audit --session ${id}`));

/** registry branch ws/quiet-basin carries UNPUSHED work; git has feat/x
 *  checked out, which origin/HEAD already holds. */
function driftedContained(): { main: string; wt: string } {
  const main = h.makeGhRepo('demo');
  h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
  const wt = path.join(h.home, 'worktrees', 'demo', 'quiet-basin');
  fs.writeFileSync(path.join(wt, 'f.txt'), 'local only\n');
  h.git(wt, 'add', 'f.txt'); h.git(wt, 'commit', '-m', 'local only');
  h.sh(`cd "${wt}" && git checkout -q -b feat/x origin/main`);
  h.ghRows([]);
  h.sh(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
  return { main, wt };
}

describe('SKEPTIC: drifted reap, interrupted', () => {
  it('audits reapable before the interrupt', () => {
    driftedContained();
    const a = audit();
    expect([a.verdict, a.branch, a.registryBranch, a.merge?.proof]).toEqual(
      ['reapable', 'feat/x', 'ws/quiet-basin', 'contained']);
  }, 30000);

  it('after the interrupt the audit still says reap-interrupted', () => {
    const { wt, main } = driftedContained();
    // the state a SIGKILL between `git worktree remove` (f) and (g) leaves
    h.sh('_reg_set demo-quiet-basin reaping worktree');
    h.git(main, 'worktree', 'remove', '--force', wt);
    expect(fs.existsSync(wt)).toBe(false);
    expect(h.git(main, 'for-each-ref', '--format=%(refname:short)', 'refs/heads')
      .split('\n').filter(Boolean).sort()).toEqual(['feat/x', 'main', 'ws/quiet-basin']);
    const a = audit();
    expect({ verdict: a.verdict, branch: a.branch, reaping: a.reaping, detail: a.detail })
      .toEqual({ verdict: 'reap-interrupted', branch: 'feat/x', reaping: 'worktree', detail: a.detail });
  }, 30000);

  it('NON-drifted, interrupted AFTER the branch delete (g)', () => {
    const { wt, main } = driftedContained();
    h.sh('_reg_set demo-quiet-basin reaping clips');
    h.git(main, 'worktree', 'remove', '--force', wt);
    // (g) deleted the branch this cleanup was about; make the registry name it
    // too, so this case carries NO drift at all.
    h.git(main, 'branch', '-D', 'feat/x');
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'demo-quiet-basin.branch'), 'feat/x\n');
    const a = audit();
    expect({ verdict: a.verdict, detail: a.detail }).toEqual({ verdict: 'reap-interrupted', detail: a.detail });
  }, 30000);
});

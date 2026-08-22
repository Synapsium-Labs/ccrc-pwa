import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { WS_ADD } from './ccdWsHelpers.js';
import { GH_STUB, makePrHarness, type PrHarness } from './ccdPrHelpers.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-c1-repro-'); });
afterEach(() => { h.cleanup(); });

const ARCH = `_ws_unsupervise() { echo "unsupervise $1" >> "$HOME/ccd-calls"; };
  _ws_supervise() { :; }; _spawn() { :; }; _spawn_start() { SPAWN_FROMSWAP=0; }; _spawn_settle() { :; };
  tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; return 1; }; _session_verdict() { echo gone; };`;

function build(stale: boolean): Record<string, any> {
  const main = h.makeGhRepo('demo');
  h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
  const wt = path.join(h.home, 'worktrees', 'demo', 'quiet-basin');
  for (const n of ['1', '2']) {
    fs.writeFileSync(path.join(wt, `f${n}.txt`), `work ${n}\n`);
    h.git(wt, 'add', `f${n}.txt`); h.git(wt, 'commit', '-m', `work ${n}`);
  }
  // pushed WITH -u at commit 2: upstream config + tracking ref land here
  h.git(wt, 'push', '-u', 'origin', 'ws/quiet-basin');
  if (stale) {
    // ONE MORE local commit, then the operator merges the branch into main IN
    // THIS CLONE and pushes MAIN — no ref surgery anywhere. The tracking ref
    // for the branch is never touched by that push, so it stays at commit 2
    // while commit 3 is genuinely on origin, reachable from origin/main.
    fs.writeFileSync(path.join(wt, 'f3.txt'), 'work 3\n');
    h.git(wt, 'add', 'f3.txt'); h.git(wt, 'commit', '-m', 'work 3');
  }
  h.git(main, 'merge', '--no-ff', 'ws/quiet-basin', '-m', 'merge the work (#42)');
  h.git(main, 'push', 'origin', 'main');
  fs.appendFileSync('/tmp/c1-repro.log', `tracking=${h.git(main, 'rev-parse', 'refs/remotes/origin/ws/quiet-basin')} branch=${h.git(main, 'rev-parse', 'refs/heads/ws/quiet-basin')}\n`);
  // ground truth: every commit on the branch is reachable from origin/main
  const anc = h.run(`git -C "${main}" merge-base --is-ancestor refs/heads/ws/quiet-basin refs/remotes/origin/main && echo CONTAINED`);
  fs.appendFileSync('/tmp/c1-repro.log', `ground truth ancestry(stale=${stale}): rc=${anc.code} ${anc.stdout}\n`);
  h.ghRows([]);
  h.sh(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
  const out = JSON.parse(h.sh(`${GH_STUB} ${ARCH} cmd_ws_audit --session demo-quiet-basin`));
  fs.appendFileSync('/tmp/c1-repro.log', `${stale ? 'STALE' : 'CONTROL'}: ${JSON.stringify(out)}\n`);
  return out;
}

describe('C1 vs a stale tracking ref', () => {
  it('control: no stale ref', () => {
    const out = build(false);
    expect(out).toBeTruthy();
  }, 60000);
  it('stale tracking ref', () => {
    const out = build(true);
    expect(out).toBeTruthy();
  }, 60000);
});

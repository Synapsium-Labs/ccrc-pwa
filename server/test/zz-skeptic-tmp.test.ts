import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { WS_ADD } from './ccdWsHelpers.js';
import { GH_STUB, makePrHarness, type PrHarness } from './ccdPrHelpers.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-skeptic-'); });
afterEach(() => { h.cleanup(); });

const ARCH = `_ws_unsupervise() { :; }; _ws_supervise() { :; }; _spawn() { :; };
  _spawn_start() { SPAWN_FROMSWAP=0; }; _spawn_settle() { :; };
  tmux() { return 1; }; _session_verdict() { echo gone; };`;

const audit = (): Record<string, any> =>
  JSON.parse(h.sh(`${GH_STUB} ${ARCH} cmd_ws_audit --session demo-quiet-basin`));

describe('skeptic: pushed without -u', () => {
  it('what does it answer', () => {
    const main = h.makeGhRepo('demo');
    h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
    const wt = path.join(h.home, 'worktrees', 'demo', 'quiet-basin');
    fs.writeFileSync(path.join(wt, 'f1.txt'), 'unmerged\n');
    h.git(wt, 'add', 'f1.txt');
    h.git(wt, 'commit', '-m', 'work origin never merged');
    // THE PUSH — bare, no -u.
    h.git(wt, 'push', 'origin', 'ws/quiet-basin');
    // preconditions, measured
    let upstream = true;
    try { h.git(main, 'rev-parse', '--verify', '--quiet', 'ws/quiet-basin@{upstream}'); } catch { upstream = false; }
    let cfg = true;
    try { h.git(main, 'config', '--get', 'branch.ws/quiet-basin.merge'); } catch { cfg = false; }
    const rtr = h.git(main, 'rev-parse', '--verify', 'refs/remotes/origin/ws/quiet-basin');
    const tip = h.git(wt, 'rev-parse', 'HEAD');
    fs.writeFileSync('/tmp/skeptic-out.txt', `upstream=${upstream} cfg=${cfg} rtr=${rtr} tip=${tip}
`);
    h.ghRows([]);
    h.sh(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
    const a = audit();
    fs.appendFileSync('/tmp/skeptic-out.txt', `VERDICT=${a.verdict}
`);
    fs.appendFileSync('/tmp/skeptic-out.txt', `DETAIL=${a.detail}
`);
    expect(fs.existsSync(wt)).toBe(true);
  }, 60000);
});

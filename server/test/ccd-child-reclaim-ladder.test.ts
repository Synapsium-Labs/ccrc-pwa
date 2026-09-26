// `_ws_reclaim_eval` — the reclaim ladder, rung by rung (spec 2026-09-22 §5.5).
// Called directly: the verb that consumes it lands in Task 4 and the audit that
// prints it in Task 5, and neither can be more right than this function is.
//
// The ORDER is part of the spec (§5.5's table): rung 2 (`not-a-child`)
// outranks every retryable rung, so a workspace nobody marked never reads as
// "try again".
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CCD } from './ccdWsHelpers.js';
import {
  CHILD_BRANCH, CHILD_ID, CHILD_STUBS, TMUX_FAULTS, evalOf, makeChild, plantTmux, wideDigitLocale,
} from './childReclaimFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-child-reclaim-ladder-'); });
afterEach(() => { h.cleanup(); });

const reg = (field: string): string => path.join(h.home, '.cc-sessions', `${CHILD_ID}.${field}`);
const calls = (): string[] => h.calls();
const resetCalls = (): void => { fs.rmSync(path.join(h.home, 'ccd-calls'), { force: true }); };
/** A live session with one attached client. */
const ATTACHED = 'tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; case "$1" in has-session) return 0 ;; list-clients) echo /dev/pts/3 ;; *) return 1 ;; esac; };';
/** A live session that will not list its clients. */
const UNLISTABLE = 'tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; case "$1" in has-session) return 0 ;; *) return 1 ;; esac; };';

describe('a finished child passes, and its token is a fingerprint', () => {
  it('answers reclaimable with a 64-hex token, stable across two reads of an unchanged child', () => {
    makeChild(h);
    const a = evalOf(h);
    const b = evalOf(h);
    expect(a.verdict, a.detail).toBe('reclaimable');
    expect(a.token).toMatch(/^[0-9a-f]{64}$/);
    expect(b.token).toBe(a.token);
  }, 60_000);

  it('moves the token when a fingerprinted fact moves — defer, a file, a stash, a clip, the marker', () => {
    const { wt } = makeChild(h);
    const base = evalOf(h).token;
    expect(evalOf(h, { defer: 1 }).token, '--defer-expired is an INPUT, so a token minted without it cannot be spent with it')
      .not.toBe(base);
    fs.appendFileSync(path.join(wt, 'f1.txt'), 'stashed\n');
    h.git(wt, 'stash', 'push', '-m', 'kept');
    const withStash = evalOf(h).token;
    expect(withStash, 'the stash list is an input (the tree is clean again)').not.toBe(base);
    fs.writeFileSync(path.join(wt, 'late.txt'), 'late\n');
    const withFile = evalOf(h).token;
    expect(withFile, 'the status digest is an input').not.toBe(withStash);
    fs.mkdirSync(path.join(h.home, '.cc-clips', CHILD_ID), { recursive: true });
    fs.writeFileSync(path.join(h.home, '.cc-clips', CHILD_ID, 'shot.png'), 'png');
    const withClip = evalOf(h).token;
    expect(withClip, 'the clips manifest is an input').not.toBe(withFile);
    fs.writeFileSync(reg('child'), '8');
    expect(evalOf(h).token, 'the marker itself is an input').not.toBe(withClip);
  }, 90_000);
});

describe('rungs 1 and 2 — identity, and the two authorities', () => {
  it('refuses no-such-session when there is no registry row', () => {
    expect(evalOf(h).verdict).toBe('no-such-session');
  });

  it('refuses not-a-workspace for a main checkout', () => {
    h.sh(`_reg_set ${CHILD_ID} uuid u-1; _reg_set ${CHILD_ID} child 7`);
    expect(evalOf(h).verdict).toBe('not-a-workspace');
  });

  it('refuses not-a-child with no marker, an unreadable one, a malformed one, and one naming another run', () => {
    makeChild(h);
    expect(h.reg(CHILD_ID, 'child'), 'wave 1 wrote the marker through the real ws-add').toBe('7');
    expect(evalOf(h, { childOf: '8' }).verdict, 'the two authorities disagree').toBe('not-a-child');
    expect(evalOf(h, { childOf: '7' }).verdict, 'the two authorities agree').toBe('reclaimable');
    for (const bad of ['seven', '0', '07', '7 ', '12345678901', '']) {
      fs.writeFileSync(reg('child'), bad);
      expect(evalOf(h).verdict, `marker ${JSON.stringify(bad)}`).toBe('not-a-child');
    }
    fs.rmSync(reg('child'));
    expect(evalOf(h).verdict, 'no marker').toBe('not-a-child');
  }, 60_000);

  // PORTED (fix round, F23): mode-000 on a regular file is a POSIX read
  // refusal, not a systemd/launchd or GNU/BSD distinction — a non-root user
  // is denied identically on Darwin. No `itLinux` reason survives; runnable
  // on both platforms.
  it('refuses not-a-child when the marker is present but unreadable', () => {
    makeChild(h);
    fs.chmodSync(reg('child'), 0o000);
    try { expect(evalOf(h).verdict).toBe('not-a-child'); } finally { fs.chmodSync(reg('child'), 0o644); }
  }, 60_000);

  it('ranks not-a-child ABOVE every retryable rung — paused, held and attached do not make it "try again"', () => {
    makeChild(h);
    fs.rmSync(reg('child'));
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'reclaim-paused'), '');
    fs.writeFileSync(reg('hold'), 'program:x wave:2/3');
    expect(evalOf(h, { pre: ATTACHED }).verdict).toBe('not-a-child');
  }, 60_000);

  it('refuses not-a-child for a marker only a locale-widened range admits — rung 2 is wave 1’s `_child_runid_valid`, on BOTH arms', (ctx) => {
    // Wave 1 measured the bare `=~ ^[1-9][0-9]{0,9}$` ACCEPTING `1²` under
    // `en_US.UTF-8`; `_child_runid_valid` shadows `LC_ALL=C`. A rung that
    // re-spelled the bare pattern would pass this marker — and with the verb's
    // `--child-of '1²'`, the "two authorities" would agree on a non-id.
    makeChild(h);
    const loc = wideDigitLocale(h);
    if (loc === '') { ctx.skip(); return; }
    fs.writeFileSync(reg('child'), '1²');
    const pre = `LC_ALL=${loc};`;
    expect(evalOf(h, { pre }).verdict, 'fresh arm, the audit form').toBe('not-a-child');
    expect(evalOf(h, { pre, childOf: '1²' }).verdict, 'fresh arm, both sides spelling the same non-id').toBe('not-a-child');
    expect(h.sh(`${CHILD_STUBS} ${pre} _ws_reclaim_resume_eval ${CHILD_ID} 0 '' children >/dev/null;`
      + ` printf '%s' "$REAP_VERDICT"`), 'the resume arm').toBe('not-a-child');
  }, 60_000);
});

describe('rungs 3 to 6 — the retryable ones', () => {
  it('refuses paused while the kill-switch exists — a file, or even a directory', () => {
    makeChild(h);
    const pause = path.join(h.home, '.cc-sessions', 'reclaim-paused');
    fs.writeFileSync(pause, '');
    expect(evalOf(h).verdict).toBe('paused');
    fs.rmSync(pause);
    fs.mkdirSync(pause);
    expect(evalOf(h).verdict, '-e, not -f').toBe('paused');
  }, 60_000);

  it('refuses held on a hold, and on an unreadable hold', () => {
    makeChild(h);
    fs.writeFileSync(reg('hold'), 'program:x wave:2/3');
    const held = evalOf(h);
    expect(held.verdict).toBe('held');
    expect(held.detail).toContain('program:x wave:2/3');
  }, 60_000);

  // PORTED (fix round, F23): same mode-000-on-a-regular-file shape as above.
  it('treats an unreadable hold as held', () => {
    makeChild(h);
    fs.writeFileSync(reg('hold'), 'x');
    fs.chmodSync(reg('hold'), 0o000);
    try {
      const held = evalOf(h);
      expect(held.verdict).toBe('held');
      expect(held.detail).toContain('<unreadable — treat as held>');
    } finally { fs.chmodSync(reg('hold'), 0o644); }
  }, 60_000);

  it('refuses attached on a client, on an unlistable session, and asks through an ANCHORED target', () => {
    makeChild(h);
    resetCalls();
    expect(evalOf(h, { pre: ATTACHED }).verdict).toBe('attached');
    // `=` anchors the target: a bare `cc-<id>` is an fnmatch pattern that
    // resolves a prefix to a DIFFERENT session (`ccd-win-size.test.ts` measures it).
    expect(calls()).toContain(`tmux has-session -t =cc-${CHILD_ID}`);
    expect(calls()).toContain(`tmux list-clients -t =cc-${CHILD_ID} -F #{client_tty}`);
    expect(calls().some((c) => / -t cc-/.test(c)), 'no unanchored target').toBe(false);
    expect(evalOf(h, { pre: UNLISTABLE }).verdict, 'presence unmeasured is not absence').toBe('attached');
  }, 60_000);

  it('refuses tree-busy while an operation is in progress in the child’s own tree', () => {
    const { wt, main } = makeChild(h);
    const mergeHead = h.git(wt, 'rev-parse', '--path-format=absolute', '--git-path', 'MERGE_HEAD');
    fs.writeFileSync(mergeHead, `${h.git(main, 'rev-parse', 'HEAD')}\n`);
    const busy = evalOf(h);
    expect(busy.verdict).toBe('tree-busy');
    expect(busy.detail).toContain('merge in progress');
  }, 60_000);

  it('--defer-expired skips rungs 5 and 6 and NOTHING else', () => {
    const { wt, main } = makeChild(h);
    const mergeHead = h.git(wt, 'rev-parse', '--path-format=absolute', '--git-path', 'MERGE_HEAD');
    fs.writeFileSync(mergeHead, `${h.git(main, 'rev-parse', 'HEAD')}\n`);
    resetCalls();
    expect(evalOf(h, { defer: 1, pre: ATTACHED }).verdict).toBe('reclaimable');
    expect(calls().filter((c) => c.includes('list-clients')), 'rung 5 was not even asked').toEqual([]);
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'reclaim-paused'), '');
    expect(evalOf(h, { defer: 1 }).verdict, 'the pause is NOT a presence rung').toBe('paused');
    fs.rmSync(path.join(h.home, '.cc-sessions', 'reclaim-paused'));
    fs.writeFileSync(reg('hold'), 'x');
    expect(evalOf(h, { defer: 1 }).verdict, 'nor is the hold').toBe('held');
  }, 90_000);
});

describe('rung 5 asks tmux through `_session_probe`, ANCHORED — "tmux could not be asked" is unmeasured, never "no session" (spec §5.5)', () => {
  // `can't find session` is the ONE answer that means gone. A server that
  // refused the connection, a socket with nobody serving it and a socket that
  // is not there all say only that tmux could not be asked: a live, attached
  // session may be behind any of them. The verb never reads PROBE_SUBSTRATE,
  // so `no server running` and a missing socket are unknown here too.
  it.each(Object.entries(TMUX_FAULTS))('%s → unmeasured, no token, and tmux’s own words in the detail', (_what, fault) => {
    makeChild(h);
    plantTmux(h, { fault });
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.token).toBe('');
    expect(r.detail).toContain(fault);
    expect(calls(), 'asked, and asked ANCHORED').toContain(`tmux has-session -t =cc-${CHILD_ID}`);
  }, 60_000);

  it('the CONTROL: `can’t find session` is gone — reclaimable; and a live session with no client passes too', () => {
    makeChild(h);
    expect(h.run(`${CHILD_STUBS} tmux has-session -t =cc-${CHILD_ID}`).stderr, 'the model says gone')
      .toContain(`can't find session: =cc-${CHILD_ID}`);
    expect(evalOf(h).verdict).toBe('reclaimable');
    plantTmux(h, { sessions: [`cc-${CHILD_ID}`] });
    expect(evalOf(h).verdict).toBe('reclaimable');
    plantTmux(h, { clients: { [`cc-${CHILD_ID}`]: '/dev/pts/4' } });
    expect(evalOf(h).verdict, 'and the attached check still runs on a live one').toBe('attached');
  }, 60_000);

  it('the CONTROL: an attached prefix-SIBLING `cc-<id>x` does not make the child read present', () => {
    makeChild(h);
    const sib = `cc-${CHILD_ID}x`;
    plantTmux(h, { sessions: [sib], clients: { [sib]: '/dev/pts/9' } });
    // The model resolves a BARE target as tmux does — to the sibling — so the
    // anchoring is what this case measures, not an artefact of the stub.
    expect(h.run(`${CHILD_STUBS} tmux has-session -t cc-${CHILD_ID}`).code, 'an unanchored target finds the sibling').toBe(0);
    expect(h.run(`${CHILD_STUBS} tmux has-session -t =cc-${CHILD_ID}`).code, 'an anchored one does not').toBe(1);
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('reclaimable');
  }, 60_000);
});

describe('rung 7 — branch-elsewhere', () => {
  it('refuses when another worktree stands on the branch the tail would delete', () => {
    const { wt, main } = makeChild(h);
    h.git(wt, 'checkout', '--detach');
    h.git(main, 'worktree', 'add', path.join(h.home, 'elsewhere'), CHILD_BRANCH);
    const r = evalOf(h);
    expect(r.verdict).toBe('branch-elsewhere');
    expect(r.detail).toContain(path.join(h.home, 'elsewhere'));
  }, 60_000);
});

describe('rung 8 — the tree reads, after the permission pass', () => {
  // PORTED (fix round, F23): the normalise pass is `find -P … -xdev -user …
  // -perm -u=rwx … -exec chmod u+rwx {} \;` — read by the Darwin lens as
  // BSD-valid — and mode-000 denies a non-root owner identically on both
  // userlands. No `itLinux` reason survives.
  it('normalises a mode-000 directory it owns, then reads it — the owner bits and nothing else', () => {
    const { wt } = makeChild(h);
    const a = path.join(wt, 'a');
    fs.mkdirSync(path.join(a, 'b'), { recursive: true });
    fs.writeFileSync(path.join(a, 'b', 'hidden.txt'), 'work nobody could see');
    fs.chmodSync(path.join(a, 'b'), 0o000);
    fs.chmodSync(a, 0o000);
    try {
      const r = evalOf(h);
      expect(r.verdict, r.detail).toBe('reclaimable');
      expect(fs.statSync(a).mode & 0o700).toBe(0o700);
      expect(fs.statSync(a).mode & 0o077, 'group and other bits untouched').toBe(0);
    } finally {
      fs.chmodSync(a, 0o755); fs.chmodSync(path.join(a, 'b'), 0o755);
    }
  }, 60_000);

  // PORTED (fix round, F23): the shim replaces `chmod` on PATH with a plain
  // `#!/bin/sh` script `find -exec` resolves the same way on both userlands;
  // nothing here is GNU-only.
  it('refuses tree-unreadable when the pass cannot fix the tree', () => {
    const { wt } = makeChild(h);
    const a = path.join(wt, 'a');
    fs.mkdirSync(a);
    fs.writeFileSync(path.join(a, 'hidden.txt'), 'x');
    fs.chmodSync(a, 0o000);
    // A chmod that exits 0 and changes nothing — the shape of an entry another
    // uid owns, which this uid cannot fix. `find -exec` resolves chmod on PATH.
    const shim = path.join(h.home, 'shim');
    fs.mkdirSync(shim);
    fs.writeFileSync(path.join(shim, 'chmod'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    try {
      const r = evalOf(h, { pre: `PATH="${shim}:$PATH";` });
      expect(r.verdict).toBe('tree-unreadable');
      expect(r.detail).toContain(wt);
    } finally { fs.chmodSync(a, 0o755); }
  }, 60_000);

  it('answers unmeasured — NEVER tree-unreadable — for a row that does not say where the tree is', () => {
    // Spec §5.5, rung 8: `tree-unreadable` is a tree still unreadable after
    // the permission pass. A row with no workdir never reached the pass.
    makeChild(h);
    fs.rmSync(reg('workdir'));
    const noRow = evalOf(h);
    expect(noRow.verdict, noRow.detail).toBe('unmeasured');
    expect(noRow.token).toBe('');
  }, 60_000);
});

describe('a vanished worktree is reclaimed; a directory git does not record is refused (spec §5.5)', () => {
  it('a child whose worktree directory is GONE is reclaimable over what is left — never unmeasured, and its own token', () => {
    // "A vanished worktree is not a refusal": nothing on disk can hold unseen
    // work any more, and a retry could never succeed.
    const { wt } = makeChild(h);
    const present = evalOf(h);
    fs.rmSync(wt, { recursive: true, force: true });
    const gone = evalOf(h);
    expect(gone.verdict, gone.detail).toBe('reclaimable');
    expect(gone.token).toMatch(/^[0-9a-f]{64}$/);
    expect(gone.token, 'a token minted over the tree can never be spent on its absence').not.toBe(present.token);
    expect(h.sh(`${CHILD_STUBS} _ws_reclaim_eval ${CHILD_ID} 0 '' >/dev/null; printf '%s' "$RECLAIM_WORKTREE"`))
      .toBe('absent');
  }, 60_000);

  it('the vanished arm still asks rungs 2, 4, 5 and 7 — nothing that guards the branch is skipped', () => {
    const { wt, main } = makeChild(h);
    fs.rmSync(wt, { recursive: true, force: true });
    expect(evalOf(h, { childOf: '8' }).verdict, 'rung 2').toBe('not-a-child');
    expect(evalOf(h, { pre: ATTACHED }).verdict, 'rung 5').toBe('attached');
    fs.writeFileSync(reg('hold'), 'x');
    expect(evalOf(h).verdict, 'rung 4').toBe('held');
    fs.rmSync(reg('hold'));
    // Rung 7: git's own stale record of the vanished tree is pruned (fixture
    // repository only) so ANOTHER worktree can take the branch the tail would
    // delete — the shape the CAS alone would not notice.
    h.git(main, 'worktree', 'prune');
    h.git(main, 'worktree', 'add', path.join(h.home, 'elsewhere'), CHILD_BRANCH);
    const r = evalOf(h);
    expect(r.verdict, 'rung 7').toBe('branch-elsewhere');
    expect(r.detail).toContain(path.join(h.home, 'elsewhere'));
  }, 90_000);

  it('refuses no-worktree-record — TERMINAL — for a directory that EXISTS but git does not record, before any probe reads it', () => {
    const { wt, main } = makeChild(h);
    // `ccd-ws-audit.test.ts`'s own no-record shape: removing `$main/.git/
    // worktrees/<slug>` leaves the directory and the branch intact while every
    // read of the directory fails `not a git repository` — which is also why
    // the record is asked before rung 6, whose probe reads git in the tree.
    const admin = path.join(main, '.git', 'worktrees', 'quiet-basin');
    expect(fs.existsSync(admin), 'the CONTROL: git names the admin directory after the worktree basename').toBe(true);
    fs.rmSync(admin, { recursive: true, force: true });
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('no-worktree-record');
    expect(r.token).toBe('');
    // …and a plain directory standing where the worktree was: the same answer.
    fs.rmSync(wt, { recursive: true, force: true });
    fs.mkdirSync(wt, { recursive: true });
    expect(evalOf(h).verdict).toBe('no-worktree-record');
  }, 60_000);
});

describe('a probe that could not RUN is `unmeasured` — never a token, never terminal', () => {
  // Spec §5.5, rung 8: `tree-unreadable` is terminal for a tree unreadable
  // AFTER the permission pass. A probe that never ran measured nothing; a
  // terminal word for it would never be retried (wave 4's sweep skips the
  // attention list).
  it.each([
    ['rung 6: the operation probe failed', '_ws_child_op() { return 1; };'],
    ['rung 8: the permission pass ran out of time', '_plat_timeout() { return 124; };'],
    ['the stash list could not be read', '_ws_reclaim_stash_shas() { return 1; };'],
    ['the clips manifest could not be listed', '_ws_clip_manifest() { return 1; };'],
    // The identity probes too — each was a `tree-unreadable` fold once.
    ['the repository could not be resolved', '_ws_common_dir() { return 1; };'],
    ['the worktree list could not be enumerated', '_ws_branch_elsewhere() { return 1; };'],
    // git's record of the child's OWN workdir, when the list itself fails:
    // unmeasured, never the terminal `no-worktree-record` (a list that could
    // not be read is not "no record").
    ['git’s worktree list could not be read — never "no record"',
      'git() { case "$*" in *"worktree list"*) return 128 ;; esac; command git "$@"; };'],
    // …and a directory git DOES record that resolves to no repository (its
    // `.git` gone): the record says it is ours, the tree cannot say so.
    ['a recorded worktree whose directory resolves to no repository',
      '_ws_common_dir() { case "$1" in */worktrees/demo/quiet-basin) return 1 ;; esac; git -C "$1" rev-parse --path-format=absolute --git-common-dir; };'],
    ['the nested-checkout scan could not run', '_ws_nested_checkouts() { return 1; };'],
  ])('%s → unmeasured, no token', (_what, pre) => {
    makeChild(h);
    const r = evalOf(h, { pre });
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.token).toBe('');
  }, 60_000);

  // PORTED (fix round, F23): same PATH-shim shape as the case above.
  it('a tree STILL unreadable after the pass keeps the terminal word — the pass RAN', () => {
    // The `refuses tree-unreadable when the pass cannot fix the tree` case
    // above, restated as the control for this describe: rc 1 is not rc 2.
    const { wt } = makeChild(h);
    const a = path.join(wt, 'a');
    fs.mkdirSync(a);
    fs.chmodSync(a, 0o000);
    const shim = path.join(h.home, 'shim');
    fs.mkdirSync(shim);
    fs.writeFileSync(path.join(shim, 'chmod'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    try { expect(evalOf(h, { pre: `PATH="${shim}:$PATH";` }).verdict).toBe('tree-unreadable'); }
    finally { fs.chmodSync(a, 0o755); }
  }, 60_000);
});

describe('a probe that could not RUN, continued — the permission pass and rung 9’s per-checkout reads', () => {
  // Spec §5.5, rung 8's rule: a probe that did not run measured nothing, so it
  // answers unmeasured and the lane retries it. The terminal words keep what a
  // read PROVED.
  // PORTED (fix round, F23): `_plat_timeout` is a ccd shell FUNCTION this
  // stub overrides directly — never the real `timeout(1)` — so the codes
  // simulated here are not a GNU-coreutils fact and carry no platform
  // dependency.
  it.each([[125], [126], [127], [137]])('the permission pass exited %i — it never ran to the end → unmeasured, not tree-unreadable', (code) => {
    const { wt } = makeChild(h);
    const a = path.join(wt, 'a');
    fs.mkdirSync(a);
    fs.chmodSync(a, 0o000);
    try {
      const r = evalOf(h, { pre: `_plat_timeout() { return ${code}; };` });
      expect(r.verdict, r.detail).toBe('unmeasured');
      expect(r.token).toBe('');
    } finally { fs.chmodSync(a, 0o755); }
  }, 60_000);

  /** A clean, pushed clone of ANOTHER repository at `<wt>/vendor/other` —
   *  the shape rung 9 passes when every read of it succeeds. */
  const foreignClone = (wt: string): string => {
    const origin = path.join(h.home, 'origins', 'other.git');
    execFileSync('git', ['init', '--bare', '-q', '-b', 'main', origin]);
    const seedRepo = path.join(h.home, 'seed-other');
    execFileSync('git', ['init', '-q', '-b', 'main', seedRepo]);
    fs.writeFileSync(path.join(seedRepo, 'r'), 'r');
    h.git(seedRepo, 'add', 'r'); h.git(seedRepo, 'commit', '-m', 'r');
    h.git(seedRepo, 'remote', 'add', 'origin', origin); h.git(seedRepo, 'push', '-q', 'origin', 'main');
    const clone = path.join(wt, 'vendor', 'other');
    execFileSync('git', ['clone', '-q', origin, clone]);
    return clone;
  };

  it.each([
    ['its repository could not be resolved',
      '_ws_common_dir() { case "$1" in */vendor/other) return 1 ;; esac; git -C "$1" rev-parse --path-format=absolute --git-common-dir; };'],
    ['its status could not be read', 'git() { case "$*" in *"/vendor/other status "*) return 128 ;; esac; command git "$@"; };'],
    ['its commits could not be counted', 'git() { case "$*" in *"/vendor/other rev-list "*) return 128 ;; esac; command git "$@"; };'],
  ])('a nested checkout of another repository: %s → unmeasured', (_what, pre) => {
    const { wt } = makeChild(h);
    foreignClone(wt);
    expect(evalOf(h).verdict, 'the CONTROL: every read succeeds, clean and pushed').toBe('reclaimable');
    const r = evalOf(h, { pre });
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.token).toBe('');
  }, 60_000);

  it('a nested checkout of this repository whose top could not be read → unmeasured', () => {
    const { wt, main } = makeChild(h);
    h.git(main, 'worktree', 'add', '-b', 'ws/nested', path.join(wt, 'inner'));
    const pre = 'git() { case "$*" in *"/inner rev-parse --path-format=absolute --show-toplevel"*) return 128 ;; esac; command git "$@"; };';
    const r = evalOf(h, { pre });
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.token).toBe('');
  }, 60_000);
});

describe('rung 9 — containment', () => {
  it('refuses a nested checkout of ANOTHER repository that holds a commit on none of its remotes', () => {
    const { wt } = makeChild(h);
    const nested = path.join(wt, 'vendor', 'lib');
    fs.mkdirSync(nested, { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main', nested]);
    fs.writeFileSync(path.join(nested, 'x'), 'x');
    h.git(nested, 'add', 'x');
    h.git(nested, 'commit', '-m', 'local only');
    const r = evalOf(h);
    expect(r.verdict).toBe('containment-unproven');
    expect(r.detail).toContain('on none of its remotes');
  }, 60_000);

  it('refuses a DIRTY nested checkout of another repository, and passes a clean, pushed one', () => {
    const { wt } = makeChild(h);
    const origin = path.join(h.home, 'origins', 'other.git');
    execFileSync('git', ['init', '--bare', '-q', '-b', 'main', origin]);
    const seedRepo = path.join(h.home, 'seed-other');
    execFileSync('git', ['init', '-q', '-b', 'main', seedRepo]);
    fs.writeFileSync(path.join(seedRepo, 'r'), 'r');
    h.git(seedRepo, 'add', 'r'); h.git(seedRepo, 'commit', '-m', 'r');
    h.git(seedRepo, 'remote', 'add', 'origin', origin); h.git(seedRepo, 'push', '-q', 'origin', 'main');
    const clone = path.join(wt, 'vendor', 'other');
    execFileSync('git', ['clone', '-q', origin, clone]);
    expect(evalOf(h).verdict, 'clean and pushed: nothing of it is lost').toBe('reclaimable');
    fs.writeFileSync(path.join(clone, 'dirty'), 'd');
    expect(evalOf(h).verdict).toBe('containment-unproven');
  }, 60_000);

  it('NEVER refuses a nested checkout of the child’s OWN repository, dirty or not — it is pinned', () => {
    const { wt, main } = makeChild(h);
    h.git(main, 'worktree', 'add', '-b', 'ws/nested', path.join(wt, 'inner'));
    fs.writeFileSync(path.join(wt, 'inner', 'dirty.txt'), 'dirty');
    expect(evalOf(h).verdict).toBe('reclaimable');
    expect(h.sh(`${CHILD_STUBS} _ws_reclaim_eval ${CHILD_ID} 0 '' >/dev/null; printf '%s' "$RECLAIM_NESTED"`))
      .toContain(path.join(wt, 'inner'));
  }, 60_000);

  it('refuses containment-unproven when the child’s own workdir is a worktree of ANOTHER repository', () => {
    makeChild(h);
    const other = h.makeRepo('other');
    const alien = path.join(h.home, 'alien');
    h.git(other, 'worktree', 'add', '-b', 'ws/alien', alien);
    fs.writeFileSync(reg('workdir'), alien);
    expect(evalOf(h).verdict).toBe('containment-unproven');
  }, 60_000);
});

describe('the tree at the workdir must be the child’s own — a link, or a path another row names, refuses (spec §5.5, rung 9)', () => {
  /** A sibling worktree `other` of the child's OWN repository, left DIRTY, and
   *  the child's directory replaced by a link to it — the shape in which a
   *  ladder that followed the leaf would pin `other`'s work into the child's
   *  WIP commit and the tail would remove `other`. */
  const plantLink = (main: string, wt: string): string => {
    const other = path.join(h.home, 'other');
    h.git(main, 'worktree', 'add', '-b', 'ws/other', other);
    fs.writeFileSync(path.join(other, 'dirty.txt'), 'uncommitted work of another session\n');
    fs.appendFileSync(path.join(other, 'README.md'), 'edited\n');
    fs.rmSync(wt, { recursive: true, force: true });
    fs.symlinkSync(other, wt);
    return other;
  };
  /** Everything of `other` that a reclaim could change: every entry under it
   *  (path, type, mode, bytes), git's record of it, its branch tip, its status
   *  and its branch's subjects. */
  const snapshot = (main: string, other: string): Record<string, unknown> => {
    const tree: string[] = [];
    const walk = (d: string): void => {
      for (const n of fs.readdirSync(d).sort()) {
        const p = path.join(d, n);
        const st = fs.lstatSync(p);
        const rel = path.relative(other, p);
        if (st.isDirectory()) { tree.push(`d ${st.mode.toString(8)} ${rel}`); walk(p); }
        else tree.push(`f ${st.mode.toString(8)} ${rel} ${fs.readFileSync(p).toString('base64')}`);
      }
    };
    walk(other);
    const stanza = h.git(main, 'worktree', 'list', '--porcelain').split('\n\n')
      .find((s) => s.startsWith(`worktree ${other}\n`)) ?? '<no record>';
    return {
      tree,
      record: stanza,
      tip: h.git(main, 'rev-parse', 'refs/heads/ws/other'),
      status: h.git(other, 'status', '--porcelain=v1', '--untracked-files=all'),
      subjects: h.git(main, 'log', '--format=%s', 'refs/heads/ws/other'),
    };
  };

  it('(a) refuses a workdir that is a symbolic link to another worktree, the child’s record present — and `other` is untouched', () => {
    const { main, wt } = makeChild(h);
    const other = plantLink(main, wt);
    expect(fs.existsSync(path.join(main, '.git', 'worktrees', 'quiet-basin')), 'the child’s record is present').toBe(true);
    const before = snapshot(main, other);
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('containment-unproven');
    expect(r.detail).toContain('symbolic link');
    expect(r.token).toBe('');
    expect(snapshot(main, other)).toEqual(before);
    expect(String(before['subjects'])).not.toContain('ccrc: WIP pinned');
  }, 60_000);

  it('(b) refuses the same link with the child’s record REMOVED — and `other` is untouched', () => {
    const { main, wt } = makeChild(h);
    const other = plantLink(main, wt);
    fs.rmSync(path.join(main, '.git', 'worktrees', 'quiet-basin'), { recursive: true, force: true });
    const before = snapshot(main, other);
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('containment-unproven');
    expect(r.detail).toContain('symbolic link');
    expect(r.token).toBe('');
    expect(snapshot(main, other)).toEqual(before);
    expect(String(before['subjects'])).not.toContain('ccrc: WIP pinned');
  }, 60_000);

  it('the CONTROL: a symlinked ANCESTOR is legal — only the leaf is tested', () => {
    // Projects live under a mounted volume reached through a link on the
    // fleet box; a guard that resolved the whole path would refuse every child.
    const { wt } = makeChild(h);
    fs.symlinkSync(path.join(h.home, 'worktrees'), path.join(h.home, 'wtlink'));
    fs.writeFileSync(reg('workdir'), path.join(h.home, 'wtlink', 'demo', 'quiet-basin'));
    expect(fs.realpathSync(path.join(h.home, 'wtlink', 'demo', 'quiet-basin'))).toBe(wt);
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('reclaimable');
  }, 60_000);

  it('refuses when ANOTHER registry row names the same workdir — literally, and by its resolved path', () => {
    const { wt, tip } = makeChild(h);
    const other = (id: string, workdir: string): void => {
      fs.writeFileSync(path.join(h.home, '.cc-sessions', `${id}.uuid`), `u-${id}`);
      fs.writeFileSync(path.join(h.home, '.cc-sessions', `${id}.workdir`), workdir);
    };
    other('demo-twin', wt);
    const literal = evalOf(h);
    expect(literal.verdict, literal.detail).toBe('containment-unproven');
    expect(literal.detail).toContain('demo-twin');
    expect(literal.token).toBe('');
    fs.rmSync(path.join(h.home, '.cc-sessions', 'demo-twin.uuid'));
    fs.rmSync(path.join(h.home, '.cc-sessions', 'demo-twin.workdir'));
    // The same directory spelled through a link: two literals, one tree.
    fs.symlinkSync(path.join(h.home, 'worktrees'), path.join(h.home, 'wtlink'));
    other('demo-alias', path.join(h.home, 'wtlink', 'demo', 'quiet-basin'));
    const resolved = evalOf(h);
    expect(resolved.verdict, resolved.detail).toBe('containment-unproven');
    expect(resolved.detail).toContain('demo-alias');
    // Nothing was pinned or deleted: the ladder only evaluates.
    expect(fs.existsSync(wt)).toBe(true);
    expect(h.git(wt, 'rev-parse', 'HEAD')).toBe(tip);
  }, 60_000);

  it('the CONTROL: one row, or a second row naming a DIFFERENT workdir, proceeds', () => {
    makeChild(h);
    expect(evalOf(h).verdict, 'one row').toBe('reclaimable');
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'demo-elsewhere.uuid'), 'u-2');
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'demo-elsewhere.workdir'),
      path.join(h.home, 'worktrees', 'demo', 'quiet-basin-2'));
    const r = evalOf(h);
    expect(r.verdict, `a row naming another path: ${r.detail}`).toBe('reclaimable');
  }, 60_000);

  it('the vanished arm asks it too: a GONE workdir another row names is not reclaimed over', () => {
    const { wt } = makeChild(h);
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'demo-twin.uuid'), 'u-2');
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'demo-twin.workdir'), wt);
    fs.rmSync(wt, { recursive: true, force: true });
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('containment-unproven');
  }, 60_000);

  // A ROW ROOTED INSIDE THE CHILD IS ANOTHER SESSION'S TREE (spec §5.5, rung 9
  // asked of the path, extended to a path below it). The review measured both
  // shapes reclaimed: a nested same-repository worktree with its own row had
  // its files pinned and its tree and branch deleted, and a row at
  // `<child>/server` was left naming a deleted directory — neither session's
  // unit or pane ever stopped. `POST /api/sessions` starts a session at any
  // directory, so either shape is reachable.
  const otherRow = (id: string, workdir: string): void => {
    fs.writeFileSync(path.join(h.home, '.cc-sessions', `${id}.uuid`), `u-${id}`);
    fs.writeFileSync(path.join(h.home, '.cc-sessions', `${id}.workdir`), workdir);
  };

  it('refuses when ANOTHER registry row is rooted inside the child — a nested worktree on another branch', () => {
    const { main, wt, tip } = makeChild(h);
    const inner = path.join(wt, 'inner');
    h.git(main, 'worktree', 'add', '-b', 'ws/other-live', inner);
    fs.writeFileSync(path.join(inner, 'live.txt'), 'another session’s uncommitted work\n');
    otherRow('demo-other-live', inner);
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('containment-unproven');
    expect(r.detail, 'the detail names the session to end or purge').toContain('demo-other-live');
    expect(r.detail).toContain('rooted inside');
    expect(r.token).toBe('');
    expect(fs.readFileSync(path.join(inner, 'live.txt'), 'utf8')).toContain('uncommitted');
    expect(h.git(wt, 'rev-parse', 'HEAD')).toBe(tip);
  }, 60_000);

  it('refuses when ANOTHER registry row is rooted at `<child>/server` — a plain subdirectory', () => {
    const { wt } = makeChild(h);
    fs.mkdirSync(path.join(wt, 'server'));
    otherRow('demo-sub', path.join(wt, 'server'));
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('containment-unproven');
    expect(r.detail).toContain('demo-sub');
    expect(r.token).toBe('');
  }, 60_000);

  it('refuses a nested row spelled through a symlinked ANCESTOR that resolves inside the child — the resolved comparison', () => {
    const { wt } = makeChild(h);
    fs.mkdirSync(path.join(wt, 'server'));
    fs.symlinkSync(path.join(h.home, 'worktrees'), path.join(h.home, 'wtlink'));
    const spelled = path.join(h.home, 'wtlink', 'demo', 'quiet-basin', 'server');
    expect(spelled.startsWith(`${wt}/`), 'the CONTROL: no literal prefix of the child').toBe(false);
    otherRow('demo-alias-sub', spelled);
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('containment-unproven');
    expect(r.detail).toContain('demo-alias-sub');
    expect(r.detail, 'its resolved path is one plain path below the child: inside, not merely spelled through').toContain('rooted inside');
  }, 60_000);

  it('refuses a row spelled through a link INSIDE the child that resolves outside it — the literal comparison', () => {
    // The resolved arm alone would pass this row: its path resolves to
    // `$HOME/elsewhere`. But the path it names, `<child>/lnk`, goes with the
    // child, so the literal arm is not implied by the resolved one here.
    const { wt } = makeChild(h);
    fs.mkdirSync(path.join(h.home, 'elsewhere'));
    fs.symlinkSync(path.join(h.home, 'elsewhere'), path.join(wt, 'lnk'));
    otherRow('demo-through-link', path.join(wt, 'lnk'));
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('containment-unproven');
    expect(r.detail).toContain('demo-through-link');
    expect(r.detail, 'a plain path below the child IS inside it').toContain('rooted inside');
  }, 60_000);

  it('refuses a row spelled THROUGH the child with `..` — even one naming an ANCESTOR — and says so, not "rooted inside"', () => {
    // Fail-closed, and named as what it is: `ccd start` stores a workdir as
    // given, so `<child>/..` is writable, and it stops resolving once the
    // child is removed. Its detail says it is spelled through the child; it
    // never claims the row lies inside it. (Strings, not `path.join`, which
    // would normalise the very spelling under test.)
    const { wt } = makeChild(h);
    fs.mkdirSync(path.join(h.home, 'elsewhere'));
    for (const [id, spelled] of [['demo-up', `${wt}/..`], ['demo-out', `${wt}/../../../elsewhere`]] as const) {
      otherRow(id, spelled);
      const r = evalOf(h);
      expect(r.verdict, `${spelled}: ${r.detail}`).toBe('containment-unproven');
      expect(r.detail).toContain(id);
      expect(r.detail).toContain(`spell their workdir through ${wt}, not as one plain path`);
      expect(r.detail).toContain('cannot prove it lies outside');
      expect(r.detail, 'it is not inside the child, and the detail does not say it is').not.toContain('rooted inside');
      expect(r.token).toBe('');
      fs.rmSync(path.join(h.home, '.cc-sessions', `${id}.uuid`));
      fs.rmSync(path.join(h.home, '.cc-sessions', `${id}.workdir`));
    }
    expect(evalOf(h).verdict, 'the CONTROL: without those rows').toBe('reclaimable');
  }, 60_000);

  it('the vanished arm asks it too: a GONE child with a row rooted at `<child>/server` is not reclaimed over', () => {
    const { wt } = makeChild(h);
    fs.rmSync(wt, { recursive: true, force: true });
    expect(evalOf(h).verdict, 'the CONTROL: the vanished child alone reclaims').toBe('reclaimable');
    otherRow('demo-sub', path.join(wt, 'server'));
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('containment-unproven');
    expect(r.detail).toContain('demo-sub');
    expect(r.detail).toContain('rooted inside');
  }, 60_000);

  it('the vanished arm: a row spelled THROUGH the gone child (`<child>/..`) refuses as spelled through, never "rooted inside"', () => {
    // With the child's tree gone, `_ws_realpath` resolves only the prefix that
    // still exists and re-attaches the rest as written, so `<child>/..`
    // resolves to `<child>/..` itself — below the child as a string, and not
    // one plain path. Strings, not `path.join`, which would normalise it.
    // The third spelling reaches the child through a symlinked ANCESTOR, so
    // only its resolved form is below the child — and it is not plain either.
    const { wt } = makeChild(h);
    fs.rmSync(wt, { recursive: true, force: true });
    fs.mkdirSync(path.join(h.home, 'elsewhere'));
    fs.symlinkSync(path.join(h.home, 'worktrees'), path.join(h.home, 'wtlink'));
    for (const [id, spelled] of [['demo-up', `${wt}/..`], ['demo-out', `${wt}/../../../elsewhere`],
      ['demo-alias-up', `${path.join(h.home, 'wtlink', 'demo', 'quiet-basin')}/..`]] as const) {
      otherRow(id, spelled);
      const r = evalOf(h);
      expect(r.verdict, `${spelled}: ${r.detail}`).toBe('containment-unproven');
      expect(r.detail).toContain(`registry row(s) ${id} spell their workdir through ${wt}, not as one plain path`);
      expect(r.detail, 'it is not inside the child, and the detail does not say it is').not.toContain('rooted inside');
      fs.rmSync(path.join(h.home, '.cc-sessions', `${id}.uuid`));
      fs.rmSync(path.join(h.home, '.cc-sessions', `${id}.workdir`));
    }
  }, 60_000);

  it('the CONTROL: a `<child>x` sibling row is not inside the child, and it reclaims', () => {
    // A component boundary, not a string prefix: `quiet-basinx` starts with
    // `quiet-basin` and is a sibling.
    const { wt } = makeChild(h);
    fs.mkdirSync(`${wt}x`);
    otherRow('demo-sibling', `${wt}x`);
    const r = evalOf(h);
    expect(r.verdict, `a <child>x sibling: ${r.detail}`).toBe('reclaimable');
  }, 60_000);

  it('the CONTROL: an ANCESTOR row, spelled plainly, is not this refusal, and it reclaims', () => {
    // A session rooted ABOVE the child is not refused — the child is inside
    // IT, not the other way about.
    const { wt } = makeChild(h);
    otherRow('demo-above', path.dirname(wt));
    const r = evalOf(h);
    expect(r.verdict, `an ancestor row: ${r.detail}`).toBe('reclaimable');
  }, 60_000);

  it('a trailing slash cannot walk past the leaf: a LIVE link spelled `<wt>/` refuses, and `other` is untouched', () => {
    // `lstat("<link>/")` follows the link, so `-L "<wt>/"` is false: the
    // spelling itself is refused where the row is read.
    const { main, wt } = makeChild(h);
    const other = plantLink(main, wt);
    fs.writeFileSync(reg('workdir'), `${wt}/`);
    const before = snapshot(main, other);
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('containment-unproven');
    expect(r.detail).toContain('not one plain absolute path');
    expect(r.token).toBe('');
    expect(snapshot(main, other)).toEqual(before);
  }, 60_000);

  it('a trailing slash on a DANGLING link is not a vanished worktree', () => {
    const { wt } = makeChild(h);
    fs.rmSync(wt, { recursive: true, force: true });
    fs.symlinkSync(path.join(h.home, 'nowhere'), wt);
    fs.writeFileSync(reg('workdir'), `${wt}/`);
    const out = h.sh(`${CHILD_STUBS} _ws_reclaim_eval ${CHILD_ID} 0 '' >/dev/null;`
      + ` printf '%s|%s' "$REAP_VERDICT" "$RECLAIM_WORKTREE"`);
    expect(out, 'the vanished arm never fired').toBe('containment-unproven|');
  }, 60_000);

  it('every other non-canonical spelling of the workdir refuses — `/.`, `/..`, `//`, `/./`, `/../`, relative', () => {
    const { wt } = makeChild(h);
    const dir = path.dirname(wt);
    for (const spelled of [`${wt}/.`, `${wt}/..`, `${dir}//quiet-basin`, `${dir}/./quiet-basin`,
      `${dir}/../demo/quiet-basin`, path.relative(h.home, wt)]) {
      fs.writeFileSync(reg('workdir'), spelled);
      expect(evalOf(h).verdict, spelled).toBe('containment-unproven');
    }
    fs.writeFileSync(reg('workdir'), wt);
    expect(evalOf(h).verdict, 'the CONTROL: the plain spelling').toBe('reclaimable');
  }, 90_000);

  it('refuses not-a-workspace when the row names the project’s MAIN checkout', () => {
    // git's record for `$main` is the main worktree's own stanza (listed
    // first): without this rung the ladder answered reclaimable on `main`.
    const { main } = makeChild(h);
    fs.writeFileSync(path.join(main, 'untracked-main.txt'), 'x');
    fs.writeFileSync(reg('workdir'), main);
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('not-a-workspace');
    expect(r.detail).toContain('main checkout');
    expect(r.token).toBe('');
  }, 60_000);

  it('refuses not-a-workspace when the row names the project directory and that directory is a LINKED worktree', () => {
    // Not the first stanza of `worktree list`, so git's record alone does not
    // say "main checkout"; the resolved path against `$main`'s does.
    const { main } = makeChild(h);
    const demo2 = path.join(h.home, 'projects', 'demo2');
    h.git(main, 'worktree', 'add', '-b', 'proj2-main', demo2);
    fs.writeFileSync(path.join(demo2, 'untracked.txt'), 'x');
    fs.writeFileSync(reg('project'), 'demo2');
    fs.writeFileSync(reg('workdir'), demo2);
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('not-a-workspace');
    expect(r.detail).toContain('project directory');
    expect(r.token).toBe('');
    // The same directory spelled through a symlinked ANCESTOR (canonical, so
    // the spelling guard passes it): the comparison is of RESOLVED paths.
    fs.symlinkSync(path.join(h.home, 'projects'), path.join(h.home, 'plink'));
    fs.writeFileSync(reg('workdir'), path.join(h.home, 'plink', 'demo2'));
    const spelled = evalOf(h);
    expect(spelled.verdict, spelled.detail).toBe('not-a-workspace');
    expect(spelled.detail).toContain('project directory');
  }, 60_000);

  it('and the FIRST-stanza check still holds on its own: a row whose project is a linked worktree, naming the repository’s real main checkout', () => {
    // The resolved path differs from `$main` here, so only git's record says
    // this is the main worktree.
    const { main } = makeChild(h);
    const demo2 = path.join(h.home, 'projects', 'demo2');
    h.git(main, 'worktree', 'add', '-b', 'proj2-main', demo2);
    fs.writeFileSync(reg('project'), 'demo2');
    fs.writeFileSync(reg('workdir'), main);
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('not-a-workspace');
    expect(r.detail).toContain('main checkout');
  }, 60_000);

  // PORTED (fix round, F23): a directory's read-vs-execute (search) bits are
  // standard POSIX semantics, not a Linux/Darwin difference.
  it('an UNLISTABLE registry answers unmeasured — never a token, never a new word', () => {
    // Search permission without read: every `$REG/<id>.<field>` the rungs above
    // read by name still opens, and only the LISTING fails.
    makeChild(h);
    const regDir = path.join(h.home, '.cc-sessions');
    fs.chmodSync(regDir, 0o300);
    try {
      const r = evalOf(h);
      expect(r.verdict, r.detail).toBe('unmeasured');
      expect(r.token).toBe('');
    } finally { fs.chmodSync(regDir, 0o755); }
  }, 60_000);

  // PORTED (fix round, F23): mode-000 on a regular file, same as the marker
  // and hold cases above.
  it('an unreadable `.workdir` of another row answers unmeasured — it cannot be proven not to name this tree', () => {
    makeChild(h);
    const f = path.join(h.home, '.cc-sessions', 'demo-twin.workdir');
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'demo-twin.uuid'), 'u-2');
    fs.writeFileSync(f, '/somewhere');
    fs.chmodSync(f, 0o000);
    try {
      const r = evalOf(h);
      expect(r.verdict, r.detail).toBe('unmeasured');
      expect(r.token).toBe('');
    } finally { fs.chmodSync(f, 0o644); }
  }, 60_000);
});

describe('the classifier the pin phase stages through', () => {
  it('drops every secret-shaped path, untracked or ignored — by ANY path component, not the basename alone', () => {
    const { wt } = makeChild(h);
    fs.writeFileSync(path.join(wt, '.gitignore'), '.env.local\n');
    h.git(wt, 'add', '.gitignore'); h.git(wt, 'commit', '-m', 'ignore');
    fs.writeFileSync(path.join(wt, '.env'), 'SECRET=1');
    fs.mkdirSync(path.join(wt, 'secrets'));
    fs.writeFileSync(path.join(wt, 'secrets', 'token.txt'), 't');
    fs.writeFileSync(path.join(wt, '.env.local'), 'SECRET=2');
    fs.writeFileSync(path.join(wt, '.env.example'), 'SECRET=');
    fs.writeFileSync(path.join(wt, 'notes.txt'), 'n');
    const out = h.sh(`${CHILD_STUBS} _ws_reclaim_eval ${CHILD_ID} 0 '' >/dev/null;`
      + ` printf 'S:%s\\n' "\${RECLAIM_SECRETS[@]}"; printf 'T:%s\\n' "\${RECLAIM_STAGE[@]}"`);
    const secrets = out.split('\n').filter((l) => l.startsWith('S:')).map((l) => l.slice(2)).sort();
    const stage = out.split('\n').filter((l) => l.startsWith('T:')).map((l) => l.slice(2)).sort();
    expect(secrets).toEqual(['.env', '.env.local', 'secrets/token.txt']);
    expect(stage).toEqual(['.env.example', 'notes.txt']);
  }, 60_000);
});

describe('stash attribution — one rule in two copies, held equal', () => {
  it('_ws_reclaim_stash_shas lists exactly as many stashes as _ws_stash_count counts, named and anonymous', () => {
    const { wt, main } = makeChild(h);
    fs.appendFileSync(path.join(wt, 'f1.txt'), 'named\n');
    h.git(wt, 'stash', 'push', '-m', 'named');
    h.git(wt, 'checkout', '--detach');
    fs.appendFileSync(path.join(wt, 'f2.txt'), 'anon\n');
    h.git(wt, 'stash', 'push', '-m', 'anon');
    h.git(wt, 'checkout', CHILD_BRANCH);
    const [shas, count] = h.sh(`printf '%s|%s' "$(_ws_reclaim_stash_shas "${main}" ${CHILD_BRANCH} | grep -c .)"`
      + ` "$(_ws_stash_count "${main}" ${CHILD_BRANCH})"`).split('|');
    expect(count).toBe('2');
    expect(shas).toBe(count);
  }, 60_000);
});

describe('the region', () => {
  const src = fs.readFileSync(CCD, 'utf8');
  it('is bracketed by its two markers, once each, and its CODE never calls reap’s ladder or tail', () => {
    expect(src.split('RECLAIM-BEGIN').length - 1).toBe(1);
    expect(src.split('RECLAIM-END').length - 1).toBe(1);
    const region = src.slice(src.indexOf('RECLAIM-BEGIN'), src.indexOf('RECLAIM-END'));
    // Comment lines are dropped first: the region's comments NAME reap's
    // functions to say why they are not used, and that is not a call.
    const code = region.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    expect(code.length, 'the region has code in it').toBeGreaterThan(5000);
    // They accept OPPOSITE evidence (spec §5.5): a reclaim that consulted
    // `_ws_reap_eval` would refuse every dirty child the ruling says to pin.
    expect(code).not.toMatch(/_ws_reap_eval\b/);
    expect(code).not.toMatch(/_ws_reap_tail\b/);
  });
});

describe('rung 6 defers a held index lock; rung 8 keeps `tree-unreadable` for a read that RAN (the final review’s P2, P6)', () => {
  it('P2: an index.lock in the child’s own tree is tree-busy — and --defer-expired passes it', () => {
    const { wt } = makeChild(h);
    const lock = `${h.git(wt, 'rev-parse', '--path-format=absolute', '--git-path', 'index')}.lock`;
    fs.writeFileSync(lock, '');
    const busy = evalOf(h);
    expect(busy.verdict).toBe('tree-busy');
    expect(busy.detail).toBe(`a git command holds the index lock of ${wt} (${lock})`);
    expect(evalOf(h, { defer: 1 }).verdict, 'a bounded deferral — the ceiling passes it').toBe('reclaimable');
    fs.rmSync(lock);
    expect(evalOf(h).verdict).toBe('reclaimable');
  }, 60_000);

  it('P6: the ignored scan running out of time is unmeasured — never tree-unreadable, and never reap’s "reap again"', () => {
    const { wt } = makeChild(h);
    fs.writeFileSync(path.join(wt, '.gitignore'), 'build/\n');
    h.git(wt, 'add', '.gitignore'); h.git(wt, 'commit', '-q', '-m', 'ignore');
    fs.mkdirSync(path.join(wt, 'build', 'deep'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'build', 'deep', 'a.o'), 'x');
    const e = evalOf(h, { pre: 'REAP_SCAN_SECONDS=0;' });
    expect(e.verdict, e.detail).toBe('unmeasured');
    expect(e.token).toBe('');
    expect(e.detail).toContain('did not finish within 0s');
    expect(e.detail, 'reap’s remedy asks a human to act').not.toContain('reap again');
    const a = h.run(`${CHILD_STUBS} REAP_SCAN_SECONDS=0; cmd_ws_audit --session ${CHILD_ID} --reclaim`);
    expect(a.code, 'the audit exits 1 on unmeasured').toBe(1);
    expect((JSON.parse(a.stdout) as { verdict: string }).verdict).toBe('unmeasured');
  }, 60_000);

  it.each([
    ['its own git status was killed (rc 137)',
      'git() { case "$*" in *"--untracked-files=all"*) return 137 ;; esac; command git "$@"; };'],
    ['its own git status could not start (rc 126)',
      'git() { case "$*" in *"--untracked-files=all"*) return 126 ;; esac; command git "$@"; };'],
    ['the ignored scan could not make a scratch file',
      '_ws_collect_ignored() { REAP_IGNREASON=""; return 1; }; _plat_mktemp() { case "${FUNCNAME[1]}" in _ws_reclaim_ignored_fail) return 1 ;; esac; mktemp; };'],
    ['the collector’s own read failed once and not again',
      '_ws_collect_ignored() { REAP_IGNREASON=""; return 1; };'],
    ['the collector’s git status was killed, and is killed again',
      '_ws_collect_ignored() { REAP_IGNREASON=""; return 1; }; git() { case "$*" in *"--ignored=matching"*) return 143 ;; esac; command git "$@"; };'],
  ])('%s → unmeasured, not tree-unreadable', (_what, pre) => {
    makeChild(h);
    const r = evalOf(h, { pre });
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.token).toBe('');
  }, 60_000);

  it('the CONTROL: a collector read that RAN and reported the tree unreadable keeps the terminal word', () => {
    makeChild(h);
    const r = evalOf(h, { pre: '_ws_collect_ignored() { REAP_IGNREASON=""; return 1; };'
      + ' git() { case "$*" in *"--ignored=matching"*) echo "warning: could not open directory \'x/\'" >&2; return 0 ;; esac; command git "$@"; };' });
    expect(r.verdict, r.detail).toBe('tree-unreadable');
    expect(r.detail).toContain('could not open directory');
  }, 60_000);
});

describe('the hidden-edit PATH set is a fingerprint input — the audit and the verb share it (spec §5.5 step 2)', () => {
  /** `f`, committed, flagged, and left as committed. */
  const hide = (wt: string, f: string, flag: '--skip-worktree' | '--assume-unchanged'): void => {
    fs.writeFileSync(path.join(wt, f), 'password: template\n');
    h.git(wt, 'add', f); h.git(wt, 'commit', '-m', `add ${f}`);
    h.git(wt, 'update-index', flag, f);
  };

  it('moves the token when a hidden path starts differing, and back when it stops — never on its mtime alone', () => {
    const { wt } = makeChild(h);
    hide(wt, 'db.yml', '--skip-worktree');
    hide(wt, 'au.yml', '--assume-unchanged');
    const base = evalOf(h);
    expect(base.verdict, base.detail).toBe('reclaimable');
    const later = new Date(Date.now() + 3_600_000);
    fs.utimesSync(path.join(wt, 'db.yml'), later, later);
    expect(evalOf(h).token, 'an mtime is not an edit').toBe(base.token);
    fs.writeFileSync(path.join(wt, 'db.yml'), 'password: local\n');
    expect(h.git(wt, 'status', '--porcelain'), 'the CONTROL: git status cannot see it').toBe('');
    const skip = evalOf(h).token;
    expect(skip, 'a skip-worktree path that starts differing is drift').not.toBe(base.token);
    fs.writeFileSync(path.join(wt, 'au.yml'), 'password: local\n');
    const both = evalOf(h).token;
    expect(both, 'an assume-unchanged path that starts differing is drift').not.toBe(skip);
    fs.writeFileSync(path.join(wt, 'db.yml'), 'password: template\n');
    fs.writeFileSync(path.join(wt, 'au.yml'), 'password: template\n');
    expect(evalOf(h).token, 'the SET is the input, not its history: both stopped differing').toBe(base.token);
  }, 90_000);

  it('moves the token when a NESTED same-repository checkout’s hidden path starts differing', () => {
    const { wt, main } = makeChild(h);
    const inner = path.join(wt, 'inner');
    h.git(main, 'worktree', 'add', '-b', 'ws/nested', inner);
    hide(inner, 'cfg.yml', '--skip-worktree');
    const base = evalOf(h);
    expect(base.verdict, base.detail).toBe('reclaimable');
    fs.writeFileSync(path.join(inner, 'cfg.yml'), 'password: local\n');
    expect(evalOf(h).token).not.toBe(base.token);
  }, 90_000);

  /** A clean, pushed clone of ANOTHER repository at `<wt>/vendor/other`, its `cfg.yml` flagged skip-worktree. */
  const foreignFlagged = (wt: string): string => {
    const origin = path.join(h.home, 'origins', 'other.git');
    execFileSync('git', ['init', '--bare', '-q', '-b', 'main', origin]);
    const seedRepo = path.join(h.home, 'seed-other');
    execFileSync('git', ['init', '-q', '-b', 'main', seedRepo]);
    fs.writeFileSync(path.join(seedRepo, 'cfg.yml'), 'orig\n');
    h.git(seedRepo, 'add', 'cfg.yml'); h.git(seedRepo, 'commit', '-m', 'cfg');
    h.git(seedRepo, 'remote', 'add', 'origin', origin); h.git(seedRepo, 'push', '-q', 'origin', 'main');
    const clone = path.join(wt, 'vendor', 'other');
    execFileSync('git', ['clone', '-q', origin, clone]);
    h.git(clone, 'update-index', '--skip-worktree', 'cfg.yml');
    return clone;
  };

  it('refuses containment-unproven for a checkout of ANOTHER repository holding a hidden-flag edit — it cannot be pinned here', () => {
    const { wt } = makeChild(h);
    const clone = foreignFlagged(wt);
    expect(evalOf(h).verdict, 'the CONTROL: flagged but UNCHANGED, it holds nothing unkept').toBe('reclaimable');
    fs.writeFileSync(path.join(clone, 'cfg.yml'), 'LOCAL-EDIT-ONLY-COPY\n');
    expect(h.git(clone, 'status', '--porcelain'), 'the CONTROL: git status cannot see it').toBe('');
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('containment-unproven');
    expect(r.detail).toContain(clone);
    expect(r.detail).toContain('hidden-flag');
    expect(r.detail).toContain('will not delete unkept');
  }, 90_000);

  it('the audit’s `sensitive` list names a hidden SECRET edit the pin will drop — the child’s and a nested checkout’s', () => {
    const { wt, main } = makeChild(h);
    hide(wt, '.env', '--skip-worktree');
    fs.writeFileSync(path.join(wt, '.env'), 'KEY=live\n');
    const inner = path.join(wt, 'inner');
    h.git(main, 'worktree', 'add', '-b', 'ws/nested', inner);
    hide(inner, '.env', '--assume-unchanged');
    fs.writeFileSync(path.join(inner, '.env'), 'KEY=live\n');
    const out = h.sh(`${CHILD_STUBS} _ws_reclaim_eval ${CHILD_ID} 0 '' >/dev/null; printf '%s\\n' "$REAP_VERDICT" "\${REAP_SENSITIVE[@]}"`);
    const [verdict, ...sensitive] = out.split('\n').filter(Boolean);
    expect(verdict).toBe('reclaimable');
    expect(sensitive.sort()).toEqual(['.env', 'inner/.env']);
  }, 90_000);

  it('`sensitive` names a nested hidden secret relative to the RESOLVED workdir — as the pin records it — when the workdir is spelt through a symlinked parent', () => {
    const { wt, main } = makeChild(h);
    const inner = path.join(wt, 'inner');
    h.git(main, 'worktree', 'add', '-b', 'ws/nested', inner);
    hide(inner, '.env', '--assume-unchanged');
    fs.writeFileSync(path.join(inner, '.env'), 'KEY=live\n');
    fs.symlinkSync(path.join(h.home, 'worktrees'), path.join(h.home, 'wtlink'));
    fs.writeFileSync(reg('workdir'), path.join(h.home, 'wtlink', 'demo', 'quiet-basin'));
    const out = h.sh(`${CHILD_STUBS} _ws_reclaim_eval ${CHILD_ID} 0 '' >/dev/null; printf '%s\\n' "$REAP_VERDICT" "\${REAP_SENSITIVE[@]}"`);
    const [verdict, ...sensitive] = out.split('\n').filter(Boolean);
    expect(verdict).toBe('reclaimable');
    expect(sensitive, 'the audit spells the path the verb records as `inner/.env`').toEqual(['inner/.env']);
  }, 90_000);

  it('answers unmeasured — never a token — when `ls-files -v` answers a tag it does not know', () => {
    const { wt } = makeChild(h);
    const blob = h.git(wt, 'rev-parse', 'HEAD:f1.txt');
    const r = evalOf(h, { pre: `git() { case " $* " in *" ls-files -v -s -z "*) printf 'K 100644 ${blob} 0\\tf1.txt\\0'; return 0 ;; esac; command git "$@"; };` });
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.detail).toContain('a tag this reclaim does not know');
  }, 60_000);

  it('answers unmeasured — never a token — when a hidden path’s content cannot be read', () => {
    const { wt } = makeChild(h);
    hide(wt, 'db.yml', '--skip-worktree');
    fs.writeFileSync(path.join(wt, 'db.yml'), 'password: local\n');
    const r = evalOf(h, { pre: 'git() { case " $* " in *" hash-object "*) echo "fatal: could not open db.yml" >&2; return 128 ;; esac; command git "$@"; };' });
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.token).toBe('');
    expect(r.detail).toContain('db.yml');
  }, 60_000);
});

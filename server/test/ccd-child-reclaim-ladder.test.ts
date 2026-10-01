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
import { CCD, WS_ADD } from './ccdWsHelpers.js';
import {
  CHILD_BRANCH, CHILD_ID, CHILD_RUN, CHILD_STUBS, TMUX_FAULTS, atticReach, childReclaimVerb, evalOf, makeChild, plantTmux,
  wideDigitLocale, type Child, type LadderAnswer,
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

  // Mode-000 on a regular file is a POSIX read refusal, not a systemd/launchd
  // or GNU/BSD distinction: a non-root user is denied identically on Darwin.
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

  // Same mode-000-on-a-regular-file shape as above — no platform distinction.
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
    // The EXACT target `=cc-<id>:` (D-3525): a bare `cc-<id>` is a search that
    // resolves a prefix to a DIFFERENT session (`ccd-tmux-anchor.test.ts` measures it
    // on real tmux), and a colon-less `=cc-<id>` is exact only for session-type verbs.
    expect(calls()).toContain(`tmux has-session -t =cc-${CHILD_ID}:`);
    expect(calls()).toContain(`tmux list-clients -t =cc-${CHILD_ID}: -F #{client_tty}`);
    expect(calls().some((c) => / -t cc-/.test(c)), 'no unanchored target').toBe(false);
    expect(calls().some((c) => / -t =[^ ]*[^: ](?: |$)/.test(c)), 'no colon-less anchor').toBe(false);
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
    expect(calls(), 'asked, and asked EXACTLY').toContain(`tmux has-session -t =cc-${CHILD_ID}:`);
  }, 60_000);

  it('the CONTROL: `can’t find session` is gone — reclaimable; and a live session with no client passes too', () => {
    makeChild(h);
    expect(h.run(`${CHILD_STUBS} tmux has-session -t =cc-${CHILD_ID}:`).stderr, 'the model says gone, in tmux\'s words')
      .toContain(`can't find session: cc-${CHILD_ID}`);
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
    expect(h.run(`${CHILD_STUBS} tmux has-session -t =cc-${CHILD_ID}:`).code, 'an exact one does not').toBe(1);
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
  // The normalise pass is `find -P … -xdev -user … -perm -u=rwx … -exec
  // chmod u+rwx {} \;`, BSD-valid syntax on both userlands, and mode-000
  // denies a non-root owner identically on both.
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

  // The shim replaces `chmod` on PATH with a plain `#!/bin/sh` script;
  // `find -exec` resolves an external binary off PATH the same way on both
  // userlands, so nothing here is GNU-only.
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

  // Same PATH-shim mechanism as the case above — platform-neutral.
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
  // `_plat_timeout` is a ccd shell FUNCTION this stub overrides directly —
  // never the real `timeout(1)` binary — so the codes simulated here are a
  // fact about this stub, not about GNU coreutils, and carry no platform
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

describe('rung 9 and the contained git read an untracked file whatever `status.showUntrackedFiles` says (spec §5.5)', () => {
  // `status.showUntrackedFiles=no` — in a repository's own config or the
  // user's global one — makes a bare `git status --porcelain` list NO
  // untracked file, and makes `status --ignored=matching` die ("Unsupported
  // combination of ignored and untracked-files arguments"). Rung 9's proof
  // that a checkout of ANOTHER repository is clean must still see an
  // untracked file there, or the tail's forced removal takes it unkept; and
  // the child's own ignored-file read (rung 8) must not strand every child
  // such a config covers: git exits 128 there, which the ladder reads as a
  // read that did not run to its end — `unmeasured`, retried, never passing.
  const NOTE = 'untracked-notes.txt';
  const NO = '[status]\n\tshowUntrackedFiles = no\n';
  /** A clean, pushed clone of ANOTHER repository at `<wt>/vendor/other`,
   *  holding one UNTRACKED file — built through the harness's git (HOME = the
   *  fixture HOME), never the vitest process's own git configuration. */
  const foreignWithNote = (wt: string): string => {
    const origin = path.join(h.home, 'origins', 'other.git');
    h.git(h.home, 'init', '--bare', '-q', '-b', 'main', origin);
    const seedRepo = path.join(h.home, 'seed-other');
    h.git(h.home, 'init', '-q', '-b', 'main', seedRepo);
    fs.writeFileSync(path.join(seedRepo, 'r'), 'r');
    h.git(seedRepo, 'add', 'r'); h.git(seedRepo, 'commit', '-m', 'r');
    h.git(seedRepo, 'remote', 'add', 'origin', origin); h.git(seedRepo, 'push', '-q', 'origin', 'main');
    const clone = path.join(wt, 'vendor', 'other');
    h.git(h.home, 'clone', '-q', origin, clone);
    fs.writeFileSync(path.join(clone, NOTE), 'the only copy\n');
    return clone;
  };
  /** The ladder as `ws-audit --reclaim` and `ws-reclaim` run it: under
   *  `_ws_reclaim_contained` (their one fork, `_ws_reclaim_fork`). `evalOf`
   *  calls `_ws_reclaim_eval` bare. */
  const containedEvalOf = (): LadderAnswer => {
    const out = h.sh(`${CHILD_STUBS} _ws_reclaim_contained _ws_reclaim_eval ${CHILD_ID} 0 '' >/dev/null;`
      + ` printf '%s\\x1f%s\\x1f%s' "$REAP_VERDICT" "$REAP_TOKEN" "$REAP_DETAIL"`);
    const [verdict = '', token = '', detail = ''] = out.split('\x1f');
    return { verdict, token, detail };
  };
  /** The verb refused with `word`, and the clone's untracked file is still there, byte for byte. */
  const refusedAndKept = (clone: string, token: string, word: string): void => {
    const v = childReclaimVerb(h, token || 'f'.repeat(64));
    expect(v.code, `a refusal is an ANSWER — exit 0. stderr: ${v.stderr}`).toBe(0);
    expect((JSON.parse(v.stdout) as Record<string, unknown>)['refused'], v.stdout).toBe(word);
    expect(fs.readFileSync(path.join(clone, NOTE), 'utf8'), 'the untracked file survives the verb').toBe('the only copy\n');
  };

  it('a foreign clone holding an untracked file, `status.showUntrackedFiles=no` in ITS OWN config, refuses containment-unproven — and the file is there after the verb', () => {
    const c = makeChild(h);
    const clone = foreignWithNote(c.wt);
    h.git(clone, 'config', 'status.showUntrackedFiles', 'no');
    expect(h.git(clone, 'status', '--porcelain'), 'the CONTROL: under this config a bare status reads the clone clean').toBe('');
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('containment-unproven');
    expect(r.detail).toContain(clone);
    expect(r.detail).toContain('1 uncommitted file(s)');
    expect(r.token).toBe('');
    const rc = containedEvalOf();
    expect(rc.verdict, `contained, as the verb runs it: ${rc.detail}`).toBe('containment-unproven');
    refusedAndKept(clone, r.token, 'containment-unproven');
  }, 90_000);

  it('the same, with `status.showUntrackedFiles=no` in the user’s GLOBAL config (the fixture HOME’s ~/.gitconfig)', () => {
    const c = makeChild(h);
    const clone = foreignWithNote(c.wt);
    fs.appendFileSync(path.join(h.home, '.gitconfig'), NO);
    expect(h.git(clone, 'status', '--porcelain'), 'the CONTROL: the global config reaches the clone').toBe('');
    // The ladder is read contained here: bare, the child's own
    // `--ignored=matching` read dies under a global `no` (the next cases).
    const r = containedEvalOf();
    expect(r.verdict, r.detail).toBe('containment-unproven');
    expect(r.detail).toContain(clone);
    expect(r.detail).toContain('1 uncommitted file(s)');
    refusedAndKept(clone, r.token, 'containment-unproven');
  }, 90_000);

  it('the CONTROL: the same clone with NO such config refuses containment-unproven, bare and contained, as it always did', () => {
    const c = makeChild(h);
    const clone = foreignWithNote(c.wt);
    expect(h.git(clone, 'status', '--porcelain')).toBe(`?? ${NOTE}`);
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('containment-unproven');
    expect(r.detail).toContain('1 uncommitted file(s)');
    expect(containedEvalOf().verdict).toBe('containment-unproven');
    refusedAndKept(clone, r.token, 'containment-unproven');
  }, 90_000);

  // Mode 000 on a directory is a POSIX refusal for a non-root user on Linux
  // and Darwin alike.
  it('rung 9’s predicate, called bare, under `no`: a directory it cannot open answers 2 — a read that did not finish, never clean', () => {
    const c = makeChild(h);
    const clone = foreignWithNote(c.wt);
    fs.rmSync(path.join(clone, NOTE));
    h.git(clone, 'config', 'status.showUntrackedFiles', 'no');
    const d = path.join(clone, 'd');
    fs.mkdirSync(d);
    fs.writeFileSync(path.join(d, 'f'), 'the only copy\n');
    const probe = `_ws_reclaim_foreign_clean "${clone}"; printf '%s\\x1f%s' "$?" "$_WS_FOREIGN_WHY"`;
    fs.chmodSync(d, 0o000);
    try {
      const [rc = '', why = ''] = h.sh(probe).split('\x1f');
      expect(rc, why).toBe('2');
      expect(why).toContain(`could not read the checkout of another repository at ${clone}`);
    } finally { fs.chmodSync(d, 0o755); }
    const [rc = '', why = ''] = h.sh(probe).split('\x1f');
    expect(rc, `the CONTROL: opened, what it holds is uncommitted work — ${why}`).toBe('1');
  }, 60_000);

  /** The child reclaims, and its own untracked file is in the attic. */
  const reclaimsKeeping = (c: Child): void => {
    fs.writeFileSync(path.join(c.wt, 'late.txt'), 'uncommitted, untracked\n');
    expect(h.git(c.wt, 'status', '--porcelain'), 'the CONTROL: under this config a bare status hides it').toBe('');
    const r = containedEvalOf();
    expect(r.verdict, r.detail).toBe('reclaimable');
    const v = childReclaimVerb(h, r.token);
    expect(v.code, v.stdout + v.stderr).toBe(0);
    expect(fs.existsSync(c.wt), 'the child’s tree is gone').toBe(false);
    const kept = atticReach(h, c).some((sha) => h.git(c.main, 'ls-tree', '-r', '--name-only', sha).split('\n').includes('late.txt'));
    expect(kept, 'the untracked file the config hides was pinned before the tree went').toBe(true);
  };

  it('a child whose repository sets `status.showUntrackedFiles=no` reclaims — its ignored-file read no longer dies, which stranded it `unmeasured` for good', () => {
    const c = makeChild(h);
    h.git(c.main, 'config', 'status.showUntrackedFiles', 'no');
    reclaimsKeeping(c);
  }, 90_000);

  it('a child under a GLOBAL `status.showUntrackedFiles=no` reclaims too', () => {
    const c = makeChild(h);
    fs.appendFileSync(path.join(h.home, '.gitconfig'), NO);
    reclaimsKeeping(c);
  }, 90_000);
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
    // An EXISTING directory: a row whose spelling resolves only below a missing component is a projection,
    // and is unmeasured (D-3731) — `resolution basis` and `removed ancestor alias` below pin that side.
    fs.mkdirSync(path.join(h.home, 'worktrees', 'demo', 'quiet-basin-2'));
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
    // Fail-closed, and named as what it is: an older `ccd start` stored a
    // workdir as given, so `<child>/..` can stand in a row, and it stops resolving once the
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

  it('the vanished arm: a row spelled THROUGH the gone child (`<child>/..`) refuses as spelled through — or, reached through a linked ancestor, as unresolvable — never "rooted inside"', () => {
    // The compare reads `_ws_reclaim_resolve`, which FAILS `<child>/..` once
    // the child's tree is gone — a `..` below a missing component cannot be
    // placed — so the first two spellings are never placed by resolution:
    // each is refused by the LITERAL through arm, below the child as a string
    // and not one plain path (review 213, F3). Strings, not `path.join`, which
    // would normalise them.
    // The third spelling reaches the child through a symlinked ANCESTOR, so it
    // is not literally below the child and is asked whether it resolves at
    // all — and it does not: a `..` below a missing component (`quiet-basin/..`,
    // the child's tree gone) names wherever that directory once led, which
    // cannot be placed. So that row is UNRESOLVABLE — `unmeasured`, a retry,
    // never a placement — and not spelled through.
    const { wt } = makeChild(h);
    fs.rmSync(wt, { recursive: true, force: true });
    fs.mkdirSync(path.join(h.home, 'elsewhere'));
    fs.symlinkSync(path.join(h.home, 'worktrees'), path.join(h.home, 'wtlink'));
    for (const [id, spelled] of [['demo-up', `${wt}/..`], ['demo-out', `${wt}/../../../elsewhere`],
      ['demo-alias-up', `${path.join(h.home, 'wtlink', 'demo', 'quiet-basin')}/..`]] as const) {
      otherRow(id, spelled);
      const r = evalOf(h);
      if (id === 'demo-alias-up') {
        expect(r.verdict, `${spelled}: ${r.detail}`).toBe('unmeasured');
        expect(r.token).toBe('');
        expect(r.detail).toContain(`registry row(s) ${id} name a workdir that cannot be resolved`);
        expect(r.detail).toContain('; a \'..\' in it follows a directory that no longer exists, or cannot otherwise be placed;');
      } else {
        expect(r.verdict, `${spelled}: ${r.detail}`).toBe('containment-unproven');
        expect(r.detail).toContain(`registry row(s) ${id} spell their workdir through ${wt}, not as one plain path`);
      }
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

  // A directory's read-vs-execute (search) permission bits are standard
  // POSIX semantics, not a Linux/Darwin difference.
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

  // Mode-000 on a regular file, the same shape as the marker and hold cases
  // above — no platform distinction.
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

describe('an OTHER row whose workdir is not absolute cannot be placed — unmeasured, and a refusal found in the same pass outranks it (spec §5.5, rung 9)', () => {
  // Each reader resolves a relative spelling against its OWN cwd — `ccd start`'s
  // `-d` against the caller's, a supervised pane against its unit's, the
  // reclaim against the agent's — so none of them says where that session's
  // tree is. The review's measured shape: a session started as `ccd start …
  // quiet-basin/server` from `~/worktrees/demo` stores `quiet-basin/server`;
  // the reclaim, run from `$HOME`, resolved it to `$HOME/quiet-basin/server`,
  // read it as outside, and removed `<child>/server` with the other session's
  // files in it. Not terminal: the fault is another row's, so the ladder's
  // answer is the retryable `unmeasured`.
  const otherRow = (id: string, workdir: string): void => {
    fs.writeFileSync(path.join(h.home, '.cc-sessions', `${id}.uuid`), `u-${id}`);
    fs.writeFileSync(path.join(h.home, '.cc-sessions', `${id}.workdir`), workdir);
  };
  const dropRow = (id: string): void => {
    for (const f of ['uuid', 'workdir']) fs.rmSync(path.join(h.home, '.cc-sessions', `${id}.${f}`), { force: true });
  };
  const UNPLACED = 'name no plain absolute workdir, or one that resolves to a path opening with //, so ccd cannot place them against this child';

  it('the reviewer’s shape: a row `quiet-basin/server`, the reclaim’s cwd `$HOME` — unmeasured, never reclaimable, and `<child>/server` stands', () => {
    const { wt } = makeChild(h);
    fs.mkdirSync(path.join(wt, 'server'));
    fs.writeFileSync(path.join(wt, 'server', 'live.txt'), 'another session’s uncommitted work\n');
    expect(evalOf(h).verdict, 'the CONTROL: without the row').toBe('reclaimable');
    otherRow('demo-nested', 'quiet-basin/server');
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.token).toBe('');
    expect(r.detail).toContain(`registry row(s) demo-nested ${UNPLACED}`);
    expect(r.detail).toContain('ccd start <id> stores a plain absolute workdir');
    expect(fs.readFileSync(path.join(wt, 'server', 'live.txt'), 'utf8')).toContain('uncommitted');
  }, 60_000);

  it('a relative row naming a path OUTSIDE the child, in another project, is unmeasured too — the accepted cost', () => {
    makeChild(h);
    fs.mkdirSync(path.join(h.home, 'projects', 'elsewhere', 'sub'), { recursive: true });
    otherRow('elsewhere-sub', 'projects/elsewhere/sub');
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.detail).toContain(`registry row(s) elsewhere-sub ${UNPLACED}`);
    expect(r.token).toBe('');
  }, 60_000);

  it('an EMPTY other row is unmeasured — never skipped as if it named nothing', () => {
    makeChild(h);
    otherRow('demo-blank', '');
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.detail).toContain(`registry row(s) demo-blank ${UNPLACED}`);
    expect(r.token).toBe('');
  }, 60_000);

  it('an unrelated relative row AND a row rooted inside the child refuse containment-unproven, whichever `find` lists first', () => {
    // The listing's order is the directory's, not the names': hashed on ext4,
    // creation order on tmpfs, name order elsewhere. So each pair of names is
    // planted in BOTH creation orders, the order `find` hands the loop is READ
    // for every placement, and the case asserts it saw both — an order it
    // never exercised is not one it pinned.
    const { wt } = makeChild(h);
    fs.mkdirSync(path.join(wt, 'server'));
    const seen = new Set<string>();
    const pairs = [['demo-a-rel', 'demo-z-abs'], ['demo-z-rel', 'demo-a-abs'], ['demo-m-rel', 'demo-b-abs'],
      ['demo-c-rel', 'demo-n-abs'], ['demo-q-rel', 'demo-d-abs'], ['demo-e-rel', 'demo-r-abs']] as const;
    for (const [rel, abs] of pairs) {
      for (const relFirst of [true, false]) {
        if (relFirst) { otherRow(rel, 'projects/elsewhere'); otherRow(abs, path.join(wt, 'server')); }
        else { otherRow(abs, path.join(wt, 'server')); otherRow(rel, 'projects/elsewhere'); }
        const listed = h.sh(`find -P "$REG" -mindepth 1 -maxdepth 1 -name '*.workdir' ! -name '.*'`).split('\n');
        const iRel = listed.indexOf(path.join(h.home, '.cc-sessions', `${rel}.workdir`));
        const iAbs = listed.indexOf(path.join(h.home, '.cc-sessions', `${abs}.workdir`));
        expect(iRel >= 0 && iAbs >= 0, listed.join('\n')).toBe(true);
        const order = iRel < iAbs ? 'relative-first' : 'absolute-first';
        seen.add(order);
        const r = evalOf(h);
        expect(r.verdict, `${rel}/${abs}, ${order}: ${r.detail}`).toBe('containment-unproven');
        expect(r.detail).toContain(`registry row(s) ${abs} rooted inside`);
        expect(r.detail, 'the refusal is the answer; the unplaced row is not in it').not.toContain(rel);
        expect(r.token).toBe('');
        dropRow(rel); dropRow(abs);
      }
    }
    expect([...seen].sort(), 'both listing orders were exercised').toEqual(['absolute-first', 'relative-first']);
  }, 180_000);

  // Mode-000 on a regular file, as the unreadable-row case above — no platform
  // distinction. Order-proof the same way as the case above: each pair of
  // names planted in both creation orders, the order `find` lists READ, both
  // orders asserted seen — an outranking pinned in one order is pinned in none.
  it('the UNREADABLE row takes the same shape: a row rooted inside the child found in the same pass outranks it, whichever `find` lists first — and with an unplaced row both are named', () => {
    const { wt } = makeChild(h);
    fs.mkdirSync(path.join(wt, 'server'));
    const seen = new Set<string>();
    const pairs = [['demo-a-locked', 'demo-z-nested'], ['demo-z-locked', 'demo-a-nested'], ['demo-m-locked', 'demo-b-nested'],
      ['demo-c-locked', 'demo-n-nested'], ['demo-q-locked', 'demo-d-nested'], ['demo-e-locked', 'demo-r-nested']] as const;
    const plantLocked = (id: string): void => {
      otherRow(id, '/somewhere');
      fs.chmodSync(path.join(h.home, '.cc-sessions', `${id}.workdir`), 0o000);
    };
    const unlock = (id: string): void => {
      const f = path.join(h.home, '.cc-sessions', `${id}.workdir`);
      if (fs.existsSync(f)) fs.chmodSync(f, 0o644);
    };
    for (const [locked, nested] of pairs) {
      for (const lockedFirst of [true, false]) {
        try {
          if (lockedFirst) { plantLocked(locked); otherRow(nested, path.join(wt, 'server')); }
          else { otherRow(nested, path.join(wt, 'server')); plantLocked(locked); }
          const listed = h.sh(`find -P "$REG" -mindepth 1 -maxdepth 1 -name '*.workdir' ! -name '.*'`).split('\n');
          const iL = listed.indexOf(path.join(h.home, '.cc-sessions', `${locked}.workdir`));
          const iN = listed.indexOf(path.join(h.home, '.cc-sessions', `${nested}.workdir`));
          expect(iL >= 0 && iN >= 0, listed.join('\n')).toBe(true);
          const order = iL < iN ? 'unreadable-first' : 'nested-first';
          seen.add(order);
          const r = evalOf(h);
          expect(r.verdict, `${locked}/${nested}, ${order}: ${r.detail}`).toBe('containment-unproven');
          expect(r.detail).toContain(`registry row(s) ${nested} rooted inside`);
          expect(r.token).toBe('');
        } finally { unlock(locked); }
        dropRow(locked); dropRow(nested);
      }
    }
    expect([...seen].sort(), 'both listing orders were exercised').toEqual(['nested-first', 'unreadable-first']);
    const f = path.join(h.home, '.cc-sessions', 'demo-locked.workdir');
    try {
      plantLocked('demo-locked');
      otherRow('demo-blank', '');
      const both = evalOf(h);
      expect(both.verdict, both.detail).toBe('unmeasured');
      expect(both.detail).toContain(`could not read ${f}`);
      expect(both.detail).toContain(`registry row(s) demo-blank ${UNPLACED}`);
    } finally { unlock('demo-locked'); }
  }, 240_000);

  it('a row spelled with a leading `//` is not placed either — `//<child>/server` is unmeasured, and `<child>/server` stands', () => {
    // bash's `pwd -P`, which `_ws_realpath` answers with, KEEPS a leading `//`
    // (POSIX leaves it implementation-defined), so the resolved spelling is no
    // prefix of the child's and the row read as outside: the verb removed the
    // other session's files (review fr171-B C1, measured). Fail-closed, like a
    // row that is not absolute.
    const { wt } = makeChild(h);
    fs.mkdirSync(path.join(wt, 'server'));
    fs.writeFileSync(path.join(wt, 'server', 'live.txt'), 'another session’s uncommitted work\n');
    otherRow('demo-nested', `/${wt}/server`);
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.token).toBe('');
    expect(r.detail).toContain(`registry row(s) demo-nested ${UNPLACED}`);
    expect(r.detail, 'the value is never printed').not.toContain(`/${wt}`);
    expect(fs.readFileSync(path.join(wt, 'server', 'live.txt'), 'utf8')).toContain('uncommitted');
  }, 60_000);

  it('a PLAIN absolute row that RESOLVES to a `//` spelling — through a link whose target opens with `//` — is not placed either, and `<child>/server` stands', () => {
    // `$HOME/elsewhere/dslink` -> `/` + `<child>`: the row's value is one plain
    // path, but `_ws_realpath` (bash's `pwd -P`) resolves it to
    // `//<child>/server`, no prefix of the child's — it read as outside, and
    // the verb removed the other session's files (rereview fr171-B-r1 N1,
    // measured). Whether a platform's `pwd -P` keeps that `//` is read here,
    // never assumed: where it does (bash on Linux, measured) the row is
    // unplaced; where it collapses it the row places inside the child and is
    // refused. Either way nothing of that session's is removed.
    const { wt } = makeChild(h);
    fs.mkdirSync(path.join(wt, 'server'));
    fs.writeFileSync(path.join(wt, 'server', 'live.txt'), 'another session’s uncommitted work\n');
    fs.mkdirSync(path.join(h.home, 'elsewhere'));
    fs.symlinkSync(`/${wt}`, path.join(h.home, 'elsewhere', 'dslink'));
    const row = path.join(h.home, 'elsewhere', 'dslink', 'server');
    const resolved = h.sh(`_ws_realpath "${row}"`);
    if (process.platform !== 'darwin') expect(resolved, 'bash keeps the link target’s leading `//`').toBe(`/${wt}/server`);
    otherRow('demo-dslink', row);
    const r = evalOf(h);
    if (resolved.startsWith('//')) {
      expect(r.verdict, r.detail).toBe('unmeasured');
      expect(r.detail).toContain(`registry row(s) demo-dslink ${UNPLACED}`);
    } else {
      expect(r.verdict, r.detail).toBe('containment-unproven');
      expect(r.detail).toContain('registry row(s) demo-dslink rooted inside');
    }
    expect(r.token).toBe('');
    expect(r.detail, 'the value is never printed').not.toContain(row);
    expect(fs.readFileSync(path.join(wt, 'server', 'live.txt'), 'utf8')).toContain('uncommitted');
    // The CONTROL: the same link with a plain target places inside the child.
    dropRow('demo-dslink');
    fs.symlinkSync(wt, path.join(h.home, 'elsewhere', 'plainlink'));
    otherRow('demo-plainlink', path.join(h.home, 'elsewhere', 'plainlink', 'server'));
    const c = evalOf(h);
    expect(c.verdict, c.detail).toBe('containment-unproven');
    expect(c.detail).toContain('registry row(s) demo-plainlink rooted inside');
  }, 60_000);

  it('a `//` VALUE is unplaced even where it resolves plain — through an absolute-target link — so the literal clause is pinned on its own', () => {
    // bash's `pwd -P` drops a leading `//` at a link with an ABSOLUTE target,
    // so `//$HOME/abslink/quiet-basin/server` resolves to the plain
    // `<child>/server`: the resolved clause passes it, and only the literal
    // one refuses to place it (rereview fr171-B-r2 M2). Without the literal
    // clause the row would place as NESTED and refuse — never a deletion.
    const { wt } = makeChild(h);
    fs.mkdirSync(path.join(wt, 'server'));
    fs.writeFileSync(path.join(wt, 'server', 'live.txt'), 'another session’s uncommitted work\n');
    fs.symlinkSync(path.join(h.home, 'worktrees', 'demo'), path.join(h.home, 'abslink'));
    const row = `/${path.join(h.home, 'abslink', 'quiet-basin', 'server')}`;
    if (process.platform !== 'darwin') {
      expect(h.sh(`_ws_realpath "${row}"`), 'it resolves plain, so the resolved clause passes it').toBe(path.join(wt, 'server'));
    }
    otherRow('demo-absrow', row);
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.detail).toContain(`registry row(s) demo-absrow ${UNPLACED}`);
    expect(r.detail, 'the value is never printed').not.toContain('abslink');
    expect(fs.readFileSync(path.join(wt, 'server', 'live.txt'), 'utf8')).toContain('uncommitted');
  }, 60_000);

  it('a CHILD whose own workdir resolves to a `//` spelling places no other row against it — unmeasured; a row LITERALLY naming it or a path inside it still refuses', () => {
    // `$HOME/worktrees` -> `/` + `$HOME/wtreal`: the child's workdir resolves
    // to `//…/wtreal/demo/quiet-basin`, so a row spelled by the REAL path
    // inside the child resolves plain, is no prefix of it, and read as
    // outside — the verb removed its files (rereview fr171-B-r2 I1, measured).
    const { wt } = makeChild(h);
    fs.mkdirSync(path.join(wt, 'server'));
    fs.writeFileSync(path.join(wt, 'server', 'live.txt'), 'another session’s uncommitted work\n');
    const real = path.join(h.home, 'wtreal', 'demo', 'quiet-basin', 'server');
    // The CONTROL, an ordinary child: the real path is the child's, and the row refuses.
    otherRow('demo-other', path.join(wt, 'server'));
    expect(evalOf(h).verdict, 'an ordinary child refuses the nested row').toBe('containment-unproven');
    dropRow('demo-other');
    fs.renameSync(path.join(h.home, 'worktrees'), path.join(h.home, 'wtreal'));
    fs.symlinkSync(`/${path.join(h.home, 'wtreal')}`, path.join(h.home, 'worktrees'));
    const mine = h.sh(`_ws_realpath "${wt}"`);
    if (process.platform !== 'darwin') expect(mine, 'the child resolves to a `//` spelling').toBe(`/${path.join(h.home, 'wtreal', 'demo', 'quiet-basin')}`);
    expect(evalOf(h).verdict, 'with no other row there is nothing to place: it reclaims').toBe('reclaimable');
    otherRow('demo-other', real);
    const r = evalOf(h);
    if (mine.startsWith('//')) {
      expect(r.verdict, r.detail).toBe('unmeasured');
      expect(r.detail).toContain(`registry row(s) demo-other cannot be placed against this child: ${CHILD_ID}'s own workdir resolves to a path opening with //`);
      expect(r.detail, 'the value is never printed').not.toContain('wtreal');
    } else {
      expect(r.verdict, r.detail).toBe('containment-unproven');
    }
    expect(r.token).toBe('');
    expect(fs.readFileSync(path.join(real, 'live.txt'), 'utf8')).toContain('uncommitted');
    // A literal refusal still outranks it (M1): a row naming the child's own
    // spelling, and one naming a path inside it through that spelling.
    for (const [id, spelled, says] of [['demo-twin', wt, 'also named by registry row(s) demo-twin'],
      ['demo-nested', path.join(wt, 'server'), 'registry row(s) demo-nested rooted inside']] as const) {
      otherRow(id, spelled);
      const t = evalOf(h);
      expect(t.verdict, `${id}: ${t.detail}`).toBe('containment-unproven');
      expect(t.detail).toContain(says);
      dropRow(id);
    }
  }, 90_000);

  it('the CONTROL for `//`: a trailing-`/` row rooted inside the child still refuses containment-unproven, and so does a `///` one', () => {
    const { wt } = makeChild(h);
    fs.mkdirSync(path.join(wt, 'server'));
    for (const spelled of [`${wt}/server/`, `//${wt}/server`]) {
      otherRow('demo-nested', spelled);
      const r = evalOf(h);
      expect(r.verdict, `${spelled}: ${r.detail}`).toBe('containment-unproven');
      expect(r.detail).toContain('registry row(s) demo-nested');
      dropRow('demo-nested');
    }
  }, 60_000);

  it('the CONTROLS, unchanged: an absolute row at `<child>/server`, and the same row as `ccd start` now stores it from a relative operand, refuse containment-unproven', () => {
    const { wt } = makeChild(h);
    fs.mkdirSync(path.join(wt, 'server'));
    otherRow('demo-nested', path.join(wt, 'server'));
    const abs = evalOf(h);
    expect(abs.verdict, abs.detail).toBe('containment-unproven');
    expect(abs.detail).toContain('registry row(s) demo-nested rooted inside');
    dropRow('demo-nested');
    // The reviewer's operand, typed where the reviewer typed it: `ccd start`
    // resolves it against ITS cwd and stores the absolute path it entered.
    h.sh(`_supervised_start() { :; }; _alive() { return 1; }; builtin cd -- "$HOME/worktrees/demo"`
      + ' && cmd_start claude demo quiet-basin/server >/dev/null');
    expect(h.reg('claude-demo', 'workdir'), 'the row names the directory the operand named').toBe(path.join(wt, 'server'));
    const resolved = evalOf(h);
    expect(resolved.verdict, resolved.detail).toBe('containment-unproven');
    expect(resolved.detail).toContain('registry row(s) claude-demo rooted inside');
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

// THE LOGICAL RESOLVER (spec §5.5, rung 9). One `_ws_reclaim_resolve` call
// answers both questions `_ws_reclaim_workdir_shared` asks of a row — whether
// it can be placed at all, and where — and the child's own canonical comes
// from the same operation. Ported by content from the final resolver at
// immutable `1a02baac7` (no cherry-pick; its /proc arm, its call-site hunks
// and its split suite stay behind). Every spelling holding `..` is built by
// concatenation: `path.join` would normalise away the very input under test.
describe('the logical resolver places every row and the child by one call (spec §5.5, rung 9)', () => {
  const otherRowOf = (id: string, workdir: string): void => {
    fs.writeFileSync(path.join(h.home, '.cc-sessions', `${id}.uuid`), `u-${id}`);
    fs.writeFileSync(path.join(h.home, '.cc-sessions', `${id}.workdir`), workdir);
  };
  const dropRowOf = (id: string): void => {
    fs.rmSync(path.join(h.home, '.cc-sessions', `${id}.uuid`), { force: true });
    fs.rmSync(path.join(h.home, '.cc-sessions', `${id}.workdir`), { force: true });
  };
  /** `<rc>\x1f<_WS_RESOLVED>` for one call, in an environment `pre`/`vars` shape. */
  const resolveOf = (p: string, pre = '', vars: NodeJS.ProcessEnv = {}): string =>
    h.sh(`${pre} _ws_reclaim_resolve "${p}"; printf '%s\\x1f%s' "$?" "$_WS_RESOLVED"`, vars);
  const resolvable = (p: string): string => h.sh(`_ws_reclaim_resolvable "${p}"; printf '%s' "$?"`);
  /** `$HOME/lnk -> $HOME/elsewhere/sub`, with `$HOME/elsewhere/gone` standing: below `lnk/..` the KERNEL's walk
   *  continues in `elsewhere`, a logical `cd` in `$HOME`. */
  const plantLinkedPrefix = (): void => {
    fs.mkdirSync(path.join(h.home, 'elsewhere', 'sub'), { recursive: true });
    fs.mkdirSync(path.join(h.home, 'elsewhere', 'gone'));
    fs.symlinkSync(path.join(h.home, 'elsewhere', 'sub'), path.join(h.home, 'lnk'));
  };
  const UNRESOLVED = 'name a workdir that cannot be resolved completely (a directory or link on its path cannot be entered'
    + ' or followed, or no longer exists, so its spelling no longer says where that session lives; a \'..\' in it follows a'
    + ' directory that no longer exists, or cannot otherwise be placed; or it holds a control character), so ccd cannot place'
    + ' them against this child';

  it('an existing path through a symlinked ancestor resolves to its physical path', () => {
    const c = makeChild(h);
    fs.mkdirSync(path.join(c.wt, 'server'));
    fs.symlinkSync(path.join(h.home, 'worktrees'), path.join(h.home, 'wtlink'));
    const child = fs.realpathSync(c.wt);
    expect(resolveOf(path.join(h.home, 'wtlink', 'demo', 'quiet-basin'))).toBe(`0\x1f${child}`);
    expect(resolveOf(`${h.home}/wtlink/demo/quiet-basin/server/`)).toBe(`0\x1f${child}/server`);
    expect(resolveOf(c.wt), 'the child, by its own spelling').toBe(`0\x1f${child}`);
  }, 60_000);

  it('logical entry: an existing `<link>/..` spelling lands where bash’s logical cd lands, never the kernel’s walk', () => {
    const c = makeChild(h);
    plantLinkedPrefix();
    const rel = path.relative(h.home, c.wt);
    const raw = `${h.home}/lnk/../${rel}`;
    const child = fs.realpathSync(c.wt);
    expect(h.sh(`cd -- "${raw}" && pwd -P`), 'the CONTROL: a pane entering the spelling lands in the child').toBe(child);
    expect(fs.existsSync(path.join(h.home, 'elsewhere', rel)), 'the CONTROL: the kernel’s walk names nothing').toBe(false);
    expect(resolveOf(raw)).toBe(`0\x1f${child}`);
    const outside = `${h.home}/lnk/../elsewhere/x`;
    expect(resolveOf(outside), 'below the logical entry, a missing rest is projected from there')
      .toBe(`0\x1f${fs.realpathSync(path.join(h.home, 'elsewhere'))}/x`);
  }, 60_000);

  it('a suffix below a proven-absent component is projected as one canonical string', () => {
    const c = makeChild(h);
    fs.symlinkSync(path.join(h.home, 'worktrees'), path.join(h.home, 'wtlink'));
    const child = fs.realpathSync(c.wt);
    expect(resolveOf(`${h.home}/wtlink/demo/quiet-basin/gone/a//b/`)).toBe(`0\x1f${child}/gone/a/b`);
    expect(resolveOf(`${h.home}/deleted/long/ago`)).toBe(`0\x1f${fs.realpathSync(h.home)}/deleted/long/ago`);
    expect(resolveOf('/nonexistent-ccrc-root/x')).toBe('0\x1f/nonexistent-ccrc-root/x');
  }, 60_000);

  it('unresolved suffix: a real `..` component below a missing directory fails, and only a `..` component does', () => {
    const c = makeChild(h);
    const rel = path.relative(h.home, c.wt);
    for (const p of [`${h.home}/gone/../${rel}`, `${h.home}/gone/sub/../../${rel}`, `${h.home}/gone/..`]) {
      expect(resolveOf(p), `${p} is never resolved`).toBe('1\x1f');
      expect(resolvable(p), `${p}: the verdict alone agrees`).toBe('1');
    }
    for (const p of [`${h.home}/gone/..x/${rel}`, `${h.home}/gone/./${rel}`, `${h.home}/worktrees/../gone/${rel}`]) {
      expect(resolveOf(p).startsWith('0\x1f'), `${p} resolves: \`gone\` is proven absent`).toBe(true);
      expect(resolvable(p)).toBe('0');
    }
  }, 60_000);

  it('logical entry: a `<link>/..` prefix whose logical walk fails never falls back to the kernel’s walk', () => {
    const c = makeChild(h);
    plantLinkedPrefix();
    const raw = `${h.home}/lnk/../gone/../${path.relative(h.home, c.wt)}`;
    fs.mkdirSync(path.join(h.home, 'gone'));
    expect(resolveOf(raw), 'the CONTROL: while `gone` stands the spelling IS the child').toBe(`0\x1f${fs.realpathSync(c.wt)}`);
    fs.rmdirSync(path.join(h.home, 'gone'));
    expect(h.sh(`cd -- "${h.home}/lnk/../gone/.." && pwd -P`), 'the CONTROL: bash’s own `cd` falls back to the kernel’s walk')
      .toBe(fs.realpathSync(path.join(h.home, 'elsewhere')));
    expect(resolveOf(raw)).toBe('1\x1f');
    expect(resolvable(raw)).toBe('1');
  }, 60_000);

  it('a spelling holding a control character or a newline fails with an empty result', () => {
    const c = makeChild(h);
    fs.symlinkSync(c.wt, path.join(h.home, 'lnk\n'));
    for (const snippet of [`"${h.home}/lnk"$'\\n'"/gone"`, `"${c.wt}"$'\\t'`, `"${c.wt}/a"$'\\x01'"b"`]) {
      expect(h.sh(`_ws_reclaim_resolve ${snippet}; printf '%s\\x1f%s' "$?" "$_WS_RESOLVED"`), snippet).toBe('1\x1f');
    }
  }, 60_000);

  it('an unreadable or non-directory interruption fails — it never reads as absent', () => {
    const c = makeChild(h);
    expect(resolveOf(path.join(c.wt, 'f1.txt', 'x')), 'a regular file on the path').toBe('1\x1f');
    const server = path.join(c.wt, 'server');
    fs.mkdirSync(path.join(server, 'inner'), { recursive: true });
    const locked = path.join(h.home, 'locked');
    fs.mkdirSync(locked);
    fs.symlinkSync(server, path.join(locked, 'l'));
    fs.symlinkSync(path.join(locked, 'l'), path.join(h.home, 'a'));
    expect(resolveOf(path.join(h.home, 'a')), 'the CONTROL: searchable, it resolves inside the child')
      .toBe(`0\x1f${fs.realpathSync(server)}`);
    fs.chmodSync(locked, 0o600);
    fs.chmodSync(server, 0o600);
    try {
      expect(resolveOf(path.join(h.home, 'a')), 'a link across an unsearchable directory').toBe('1\x1f');
      expect(resolveOf(path.join(server, 'inner', 'x')), 'a path below an unsearchable directory').toBe('1\x1f');
    } finally { fs.chmodSync(locked, 0o755); fs.chmodSync(server, 0o755); }
  }, 60_000);

  // THE ENVIRONMENTS a reclaim may run in. A bare `cd`, `pwd` or `printf` is
  // environment-shaped: a physical mode carried in, or a function of that
  // name (or of `builtin`, or `set`) imported through the environment, which
  // bash installs in the very shell that sources ccd.
  type Env = 'normal' | 'set -P' | 'an imported cd' | 'an imported pwd' | 'an imported builtin' | 'an imported set'
    | 'an imported printf';
  const ENVS: Record<Env, { pre: string; vars: Record<string, string> }> = {
    normal: { pre: '', vars: {} },
    'set -P': { pre: 'set -P;', vars: {} },
    'an imported cd': { pre: '', vars: { 'BASH_FUNC_cd%%': '() { builtin cd -P -- "${@: -1}"; }' } },
    'an imported pwd': { pre: '', vars: { 'BASH_FUNC_pwd%%': '() { builtin pwd -L; }' } },
    'an imported builtin': { pre: '', vars: {
      'BASH_FUNC_builtin%%': '() { if [[ "$1" == cd ]]; then command cd -P -- "${@: -1}"; else command builtin "$@"; fi; }' } },
    'an imported set': { pre: '', vars: {
      'BASH_FUNC_set%%': '() { if [[ "$1" == -o && "$2" == posix ]]; then return 0; fi; builtin set "$@"; }' } },
    'an imported printf': { pre: '', vars: {
      'BASH_FUNC_printf%%': '() { if [[ "$PWD" == */quiet-basin ]]; then builtin printf \'y\\nx\'; else builtin printf "$@"; fi; }' } },
  };
  /** THE CONTROL that each hostility is in force: five probes, and every hostile environment answers one of them
   *  unlike `normal` — so a crash, or an import that did nothing, cannot pass as green. */
  const expectHostile = (env: Env): void => {
    const got = h.sh(`${ENVS[env].pre} mkdir -p "$HOME/probe/quiet-basin";`
      + ' ( cd -- "$HOME/lnk/.." >/dev/null 2>&1 && pwd -P ); printf \'\\x1f\';'
      + ' ( builtin cd -L -- "$HOME/lnk" >/dev/null 2>&1 && pwd -P ); printf \'\\x1f\';'
      + ' ( builtin cd -L -- "$HOME/lnk/.." >/dev/null 2>&1 && builtin pwd -P ); printf \'\\x1f\';'
      + ' ( set -o posix; [[ -o posix ]] && printf on || printf off ); printf \'\\x1f\';'
      + ' ( cd -- "$HOME/probe/quiet-basin" && printf x ); rm -rf "$HOME/probe"', ENVS[env].vars)
      .split('\x1f').map((x) => x.trim());
    const home = fs.realpathSync(h.home);
    const elsewhere = fs.realpathSync(path.join(h.home, 'elsewhere'));
    const sub = fs.realpathSync(path.join(h.home, 'elsewhere', 'sub'));
    const want: Record<Env, string[]> = {
      normal: [home, sub, home, 'on', 'x'],
      'set -P': [elsewhere, sub, home, 'on', 'x'],
      'an imported cd': [elsewhere, sub, home, 'on', 'x'],
      'an imported pwd': [h.home, `${h.home}/lnk`, home, 'on', 'x'],
      'an imported builtin': [home, sub, elsewhere, 'on', 'x'],
      'an imported set': [home, sub, home, 'off', 'x'],
      'an imported printf': [home, sub, home, 'on', 'y\nx'],
    };
    expect(got, `the CONTROL (${env}): bare cd of <lnk>/.., pwd -P in <lnk>, builtin cd -L of <lnk>/.., set -o posix, printf x`)
      .toEqual(want[env]);
  };

  for (const env of Object.keys(ENVS) as Env[]) {
    it(`logical entry under ${env}: the path and its verdict come from one call, and the environment steers neither`, () => {
      const c = makeChild(h);
      plantLinkedPrefix();
      expectHostile(env);
      const child = fs.realpathSync(c.wt);
      const raw = `${h.home}/lnk/../gone/../${path.relative(h.home, c.wt)}`;
      const inEnv = (p: string): string => resolveOf(p, ENVS[env].pre, ENVS[env].vars);
      expect(inEnv(c.wt), 'the child, at itself').toBe(`0\x1f${child}`);
      fs.mkdirSync(path.join(h.home, 'gone'));
      expect(inEnv(raw), 'standing, the spelling IS the child').toBe(`0\x1f${child}`);
      fs.rmdirSync(path.join(h.home, 'gone'));
      expect(inEnv(raw), 'vanished, the logical walk fails — never the kernel’s fallback').toBe('1\x1f');
      expect(h.sh(`${ENVS[env].pre} _ws_reclaim_resolvable "${raw}"; printf '%s' "$?"`, ENVS[env].vars)).toBe('1');
    }, 60_000);
  }

  it('logical entry: `CDPATH` never redirects the entry', () => {
    fs.mkdirSync(path.join(h.home, 'rel'));
    fs.mkdirSync(path.join(h.home, 'cdp', 'rel'), { recursive: true });
    const home = fs.realpathSync(h.home);
    expect(h.sh('CDPATH="$HOME/cdp"; ( cd -- rel >/dev/null 2>&1 && pwd -P )'), 'the CONTROL: a bare `cd` follows CDPATH')
      .toBe(`${home}/cdp/rel`);
    expect(h.sh('CDPATH="$HOME/cdp"; _ws_reclaim_resolve rel/gone; printf \'%s\\x1f%s\' "$?" "$_WS_RESOLVED"'),
      'entered where the walk found it (the cwd), never through CDPATH').toBe(`0\x1f${home}/rel/gone`);
  }, 60_000);

  it('places a row: a link across an unsearchable directory OUTSIDE the child is unmeasured — never reclaimable', () => {
    const c = makeChild(h);
    const server = path.join(c.wt, 'server');
    fs.mkdirSync(server);
    fs.writeFileSync(path.join(server, 'live.txt'), 'another session’s uncommitted work\n');
    const locked = path.join(h.home, 'locked');
    fs.mkdirSync(locked);
    fs.symlinkSync(server, path.join(locked, 'l'));
    fs.symlinkSync(path.join(locked, 'l'), path.join(h.home, 'a'));
    otherRowOf('demo-a', path.join(h.home, 'a'));
    const control = evalOf(h);
    expect(control.verdict, `the CONTROL: searchable, it places inside the child — ${control.detail}`).toBe('containment-unproven');
    fs.chmodSync(locked, 0o600);
    let r: LadderAnswer;
    try { r = evalOf(h); } finally { fs.chmodSync(locked, 0o755); }
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.token).toBe('');
    expect(r.detail).toContain(`registry row(s) demo-a ${UNRESOLVED}`);
    expect(r.detail, 'the value is never printed').not.toContain(path.join(h.home, 'a'));
    expect(fs.readFileSync(path.join(server, 'live.txt'), 'utf8')).toContain('uncommitted');
  }, 60_000);

  it('places a row by logical entry: `<lnk>/../gone/../<child>` IS the child while `gone` stands, and is unmeasured once it goes', () => {
    const c = makeChild(h);
    plantLinkedPrefix();
    fs.mkdirSync(path.join(h.home, 'gone'));
    const raw = `${h.home}/lnk/../gone/../${path.relative(h.home, c.wt)}`;
    otherRowOf('demo-dotdot', raw);
    const shared = evalOf(h);
    expect(shared.verdict, shared.detail).toBe('containment-unproven');
    expect(shared.detail).toContain('is also named by registry row(s) demo-dotdot');
    fs.rmdirSync(path.join(h.home, 'gone'));
    const r = evalOf(h);
    expect(r.token, `the evaluation minted a destructive token — ${r.verdict}: ${r.detail}`).toBe('');
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.detail).toContain(`registry row(s) demo-dotdot ${UNRESOLVED}`);
    expect(r.detail, 'the value is never printed').not.toContain('gone/..');
  }, 60_000);

  it('places a row: a spelling holding a newline is unmeasured, and its value is never printed', () => {
    const c = makeChild(h);
    fs.symlinkSync(c.wt, path.join(h.home, 'lnk\n'));
    otherRowOf('demo-nl', `${path.join(h.home, 'lnk')}\n/gone`);
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.token).toBe('');
    expect(r.detail).toContain(`registry row(s) demo-nl ${UNRESOLVED}`);
    expect(r.detail).not.toContain('/gone');
  }, 60_000);

  it('places a row against the child’s own canonical: a child that cannot be resolved has no fallback, and a literal row is still refused', () => {
    const c = makeChild(h);
    fs.mkdirSync(path.join(c.wt, 'server'));
    fs.mkdirSync(path.join(h.home, 'elsewhere'));
    const demo = path.dirname(c.wt);
    otherRowOf('demo-else', path.join(h.home, 'elsewhere'));
    expect(evalOf(h).verdict, 'the CONTROL: searchable, a row outside places nowhere').toBe('reclaimable');
    fs.chmodSync(demo, 0o000);
    let own: string; let out: LadderAnswer; let nested: LadderAnswer;
    try {
      own = resolveOf(c.wt);
      out = evalOf(h);
      otherRowOf('demo-nested', path.join(c.wt, 'server'));
      nested = evalOf(h);
    } finally { fs.chmodSync(demo, 0o755); }
    expect(own, 'the CONTROL: the child’s own workdir does not resolve').toBe('1\x1f');
    expect(out.token).toBe('');
    expect(out.verdict, out.detail).toBe('unmeasured');
    expect(out.detail).toContain(`registry row(s) demo-else cannot be placed against this child: ${CHILD_ID}'s own workdir cannot be resolved`);
    expect(nested.verdict, `a literal row outranks it — ${nested.detail}`).toBe('containment-unproven');
    expect(nested.detail).toContain('registry row(s) demo-nested rooted inside');
    dropRowOf('demo-nested');
  }, 60_000);
});

// THE RESOLVER SAYS HOW IT FORMED ITS ANSWER (D-3731, R31). `complete`: every
// component of the current spelling was walked and entered. `absent-suffix`:
// the rest below a PROVEN-absent component was re-attached as text — namespace
// presentation, not evidence of where a session's cwd remains. `unmeasured`:
// no answer. An alternate row is placed only on `complete`; the child's own
// vanished worktree keeps R19.
const PLACEMENT_ALT = 'demo-alias-live';
const altRowFile = (field: string): string => path.join(h.home, '.cc-sessions', `${PLACEMENT_ALT}.${field}`);
const writeAltRow = (workdir: string): void => {
  fs.writeFileSync(altRowFile('uuid'), `u-${PLACEMENT_ALT}`);
  fs.writeFileSync(altRowFile('workdir'), workdir);
};
/** `<rc>\x1f<_WS_RESOLVED>\x1f<_WS_RESOLVE_BASIS>` for one call. */
const basisOf = (p: string): string =>
  h.sh(`_ws_reclaim_resolve "${p}"; printf '%s\\x1f%s\\x1f%s' "$?" "$_WS_RESOLVED" "$_WS_RESOLVE_BASIS"`);
/** Every entry under `dir` but `.git` — path, type, mode, and a file's bytes or a link's target — or `gone`. The
 *  verb suite's `treeOf`, which this mirrors, compares bytes too (plan Task 2 Step 2; review 213, F4). */
const treeBytes = (dir: string): string[] | 'gone' => {
  if (!fs.existsSync(dir)) return 'gone';
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const n of fs.readdirSync(d).sort()) {
      if (n === '.git') continue;
      const p = path.join(d, n);
      const st = fs.lstatSync(p);
      const rel = path.relative(dir, p);
      if (st.isDirectory()) { out.push(`d ${st.mode.toString(8)} ${rel}`); walk(p); }
      else if (st.isSymbolicLink()) out.push(`l ${rel} -> ${fs.readlinkSync(p)}`);
      else out.push(`f ${st.mode.toString(8)} ${rel} ${fs.readFileSync(p).toString('base64')}`);
    }
  };
  walk(dir);
  return out;
};
/** The child's tree byte for byte, its git status, its branch, and the alternate row's bytes — what a refusal
 *  leaves standing. */
const placementState = (c: Child): Record<string, unknown> => ({
  tree: treeBytes(c.wt),
  wt: fs.existsSync(c.wt) ? h.git(c.wt, 'status', '--porcelain=v1', '--untracked-files=all') : 'gone',
  tip: h.git(c.main, 'rev-parse', `refs/heads/${CHILD_BRANCH}`),
  row: [altRowFile('uuid'), altRowFile('workdir')].map((f) => fs.readFileSync(f).toString('base64')),
});

describe('resolution basis — how the resolver formed its answer (D-3731)', () => {
  it('resolution basis: a complete existing path is complete', () => {
    const c = makeChild(h);
    fs.symlinkSync(path.join(h.home, 'worktrees'), path.join(h.home, 'wtlink'));
    const child = fs.realpathSync(c.wt);
    expect(basisOf(c.wt)).toBe(`0\x1f${child}\x1fcomplete`);
    expect(basisOf(`${h.home}/wtlink/demo/quiet-basin/`)).toBe(`0\x1f${child}\x1fcomplete`);
  }, 60_000);

  it('resolution basis: proven missing suffix is absent-suffix', () => {
    const c = makeChild(h);
    const child = fs.realpathSync(c.wt);
    expect(basisOf(`${c.wt}/gone/a//b/`)).toBe(`0\x1f${child}/gone/a/b\x1fabsent-suffix`);
    expect(basisOf(`${h.home}/deleted/long/ago`)).toBe(`0\x1f${fs.realpathSync(h.home)}/deleted/long/ago\x1fabsent-suffix`);
  }, 60_000);

  it('resolution basis: a recursive logical-dotdot resolution keeps its own basis', () => {
    const c = makeChild(h);
    fs.mkdirSync(path.join(h.home, 'elsewhere', 'sub'), { recursive: true });
    fs.symlinkSync(path.join(h.home, 'elsewhere', 'sub'), path.join(h.home, 'lnk'));
    const home = fs.realpathSync(h.home);
    expect(basisOf(`${h.home}/lnk/../${path.relative(h.home, c.wt)}`), 're-walked from the entry, every component stands')
      .toBe(`0\x1f${fs.realpathSync(c.wt)}\x1fcomplete`);
    expect(basisOf(`${h.home}/lnk/../alias/server`), 're-walked from the entry, `alias` is proven absent there')
      .toBe(`0\x1f${home}/alias/server\x1fabsent-suffix`);
  }, 60_000);

  it('resolution basis: unreadable non-directory and failed absence stay unmeasured', () => {
    const c = makeChild(h);
    const server = path.join(c.wt, 'server');
    fs.mkdirSync(path.join(server, 'inner'), { recursive: true });
    const locked = path.join(h.home, 'locked');
    fs.mkdirSync(locked);
    fs.symlinkSync(server, path.join(locked, 'l'));
    fs.symlinkSync(path.join(locked, 'l'), path.join(h.home, 'a'));
    const spellings: Array<[string, string]> = [
      ['a regular file on the path', path.join(c.wt, 'f1.txt', 'x')],
      ['a component no stat can look at (longer than NAME_MAX)', `${h.home}/${'n'.repeat(300)}/x`],
      ['an unresolved `..` below a missing directory', `${h.home}/gone/../${path.relative(h.home, c.wt)}`],
      ['a link across an unsearchable directory', path.join(h.home, 'a')],
      ['a path below an unsearchable directory', path.join(server, 'inner', 'x')],
    ];
    fs.chmodSync(locked, 0o600);
    fs.chmodSync(server, 0o600);
    let out: string[];
    try { out = spellings.map(([, p]) => basisOf(p)); } finally { fs.chmodSync(locked, 0o755); fs.chmodSync(server, 0o755); }
    spellings.forEach(([why], i) => expect(out[i], why).toBe('1\x1f\x1funmeasured'));
    for (const snippet of [`"${c.wt}"$'\\n'"/x"`, `"${c.wt}/a"$'\\x01'"b"`]) {
      expect(h.sh(`_ws_reclaim_resolve ${snippet}; printf '%s\\x1f%s\\x1f%s' "$?" "$_WS_RESOLVED" "$_WS_RESOLVE_BASIS"`),
        `a control character: ${snippet}`).toBe('1\x1f\x1funmeasured');
    }
  }, 60_000);

  it('resolution basis: a failed call retains nothing of the call before it', () => {
    const c = makeChild(h);
    const out = h.sh(`_ws_reclaim_resolve "${c.wt}/gone"; _ws_reclaim_resolve "${c.wt}/f1.txt/x";`
      + ` printf '%s\\x1f%s\\x1f%s' "$?" "$_WS_RESOLVED" "$_WS_RESOLVE_BASIS"`);
    expect(out, 'the absent-suffix answer before it is gone').toBe('1\x1f\x1funmeasured');
    const after = h.sh(`_ws_reclaim_resolve "${c.wt}"; _ws_reclaim_resolve "${h.home}/gone/../x";`
      + ` printf '%s\\x1f%s\\x1f%s' "$?" "$_WS_RESOLVED" "$_WS_RESOLVE_BASIS"`);
    expect(after, 'and so is a complete one').toBe('1\x1f\x1funmeasured');
  }, 60_000);

  it('removed ancestor alias is unmeasured', () => {
    const c = makeChild(h);
    fs.mkdirSync(path.join(c.wt, 'server'));
    fs.writeFileSync(path.join(c.wt, 'server', 'live.txt'), 'another session’s uncommitted work\n');
    const alias = path.join(h.home, 'alias');
    fs.symlinkSync(c.wt, alias);
    const raw = `${alias}/server`;
    writeAltRow(raw);
    const standing = evalOf(h);
    expect(standing.verdict, `the CONTROL: while the alias stands the row is rooted inside — ${standing.detail}`)
      .toBe('containment-unproven');
    expect(standing.detail).toContain(`registry row(s) ${PLACEMENT_ALT} rooted inside`);
    fs.unlinkSync(alias);
    const before = placementState(c);
    expect(JSON.stringify(before['tree']), 'the CONTROL: the snapshot carries the other session’s bytes')
      .toContain(fs.readFileSync(path.join(c.wt, 'server', 'live.txt')).toString('base64'));
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.token).toBe('');
    expect(r.detail).toContain(`registry row(s) ${PLACEMENT_ALT} `);
    expect(r.detail, 'the row’s spelling is never printed').not.toContain(raw);
    expect(r.detail).not.toContain('alias/server');
    expect(placementState(c), 'the tree, the branch and the row stand, byte for byte').toEqual(before);
    expect(basisOf(raw), 'the same spelling is now only a projection')
      .toBe(`0\x1f${fs.realpathSync(h.home)}/alias/server\x1fabsent-suffix`);
    fs.symlinkSync(c.wt, alias);
    expect(basisOf(raw), 'the CONTROL: with the alias standing it resolves completely, inside the child')
      .toBe(`0\x1f${fs.realpathSync(c.wt)}/server\x1fcomplete`);
  }, 60_000);

  it('removed ancestor alias through real dotdot is unmeasured', () => {
    const c = makeChild(h);
    fs.mkdirSync(path.join(c.wt, 'server'));
    fs.mkdirSync(path.join(h.home, 'elsewhere', 'sub'), { recursive: true });
    fs.symlinkSync(path.join(h.home, 'elsewhere', 'sub'), path.join(h.home, 'lnk'));
    const alias = path.join(h.home, 'alias');
    fs.symlinkSync(c.wt, alias);
    // `lnk` is entered before the `..` decides the logical parent: logically `$HOME`, where `alias` stands;
    // the kernel's walk names `elsewhere/alias`, where nothing does.
    const raw = `${h.home}/lnk/../alias/server`;
    expect(fs.existsSync(path.join(h.home, 'elsewhere', 'alias')), 'the CONTROL: nothing at the kernel’s spelling').toBe(false);
    expect(h.sh(`cd -- "${raw}" && pwd -P`), 'the CONTROL: a pane entering the row lands in the child')
      .toBe(`${fs.realpathSync(c.wt)}/server`);
    writeAltRow(raw);
    const standing = evalOf(h);
    expect(standing.verdict, `the CONTROL: placed where the logical entry lands — ${standing.detail}`).toBe('containment-unproven');
    fs.unlinkSync(alias);
    const before = placementState(c);
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.token).toBe('');
    expect(r.detail).toContain(`registry row(s) ${PLACEMENT_ALT} `);
    expect(r.detail).not.toContain(raw);
    expect(placementState(c)).toEqual(before);
    expect(basisOf(raw), 'the re-walk from the entry projects below the proven-absent alias')
      .toBe(`0\x1f${fs.realpathSync(h.home)}/alias/server\x1fabsent-suffix`);
    fs.symlinkSync(c.wt, alias);
    expect(basisOf(raw), 'the CONTROL: complete, where the logical entry lands').toBe(`0\x1f${fs.realpathSync(c.wt)}/server\x1fcomplete`);
  }, 60_000);
});

// THE CONTROLS the complete-only rule must leave as they were (mutation table rows 13, 15, 16). Top level, so
// an anchored selector reaches each by its exact title.
it('complete existing inside alternate row is containment-unproven', () => {
  const c = makeChild(h);
  fs.mkdirSync(path.join(c.wt, 'server'));
  fs.symlinkSync(c.wt, path.join(h.home, 'alias'));
  const raw = `${h.home}/alias/server`;
  writeAltRow(raw);
  expect(raw.startsWith(`${c.wt}/`), 'the CONTROL: no literal prefix of the child').toBe(false);
  expect(basisOf(raw)).toBe(`0\x1f${fs.realpathSync(c.wt)}/server\x1fcomplete`);
  const r = evalOf(h);
  expect(r.verdict, r.detail).toBe('containment-unproven');
  expect(r.detail).toContain(`registry row(s) ${PLACEMENT_ALT} rooted inside`);
  expect(r.token).toBe('');
}, 60_000);

it('literal containment outranks incomplete physical basis', () => {
  const c = makeChild(h);
  const cases: Array<[string, string, string]> = [
    ['nested, below a missing directory', `${c.wt}/gone/x`, 'rooted inside'],
    ['spelled through, with a `..` below a missing directory', `${c.wt}/gone/../x`, `spell their workdir through ${c.wt}`],
  ];
  for (const [label, spelled, says] of cases) {
    writeAltRow(spelled);
    expect(basisOf(spelled).endsWith('\x1fcomplete'), `the CONTROL (${label}): the physical basis is incomplete`).toBe(false);
    const r = evalOf(h);
    expect(r.verdict, `${label}: ${r.detail}`).toBe('containment-unproven');
    expect(r.detail).toContain(says);
  }
  fs.rmSync(c.wt, { recursive: true, force: true });
  writeAltRow(c.wt);
  expect(basisOf(c.wt), 'the CONTROL: the gone child’s own path is only a projection').toMatch(/\x1fabsent-suffix$/);
  const same = evalOf(h);
  expect(same.verdict, `the same path, the child gone: ${same.detail}`).toBe('containment-unproven');
  expect(same.detail).toContain(`is also named by registry row(s) ${PLACEMENT_ALT}`);
}, 60_000);

it('vanished subject remains reclaimable under R19', () => {
  // The subject's OWN gone worktree is a projection too — and it is not an alternate row: R19 reclaims it. A
  // complete row outside stands beside it, so the subject's resolution is actually compared against.
  const c = makeChild(h);
  fs.mkdirSync(path.join(h.home, 'outside', 'server'), { recursive: true });
  writeAltRow(path.join(h.home, 'outside', 'server'));
  fs.rmSync(c.wt, { recursive: true, force: true });
  expect(basisOf(c.wt), 'the CONTROL: the subject resolves as a projection').toMatch(/^0\x1f.*\x1fabsent-suffix$/);
  const r = evalOf(h);
  expect(r.verdict, r.detail).toBe('reclaimable');
  expect(r.token).toMatch(/^[0-9a-f]{64}$/);
}, 60_000);

// THE PER-ROW RESET (D-3733). `_ws_reclaim_workdir_shared` clears `wr`, `rok` and `basis` for every row it reads.
// Without that reset a projected row listed AFTER a complete one inherits the complete row's `rok=1` and is
// compared physically — D-3731 re-opened by directory order alone (review 212, its X2b). The listing's order is
// the directory's (hashed on ext4, creation order on tmpfs), so pairs of names are planted in alternating creation
// orders until `find` has listed the complete row first AND the projected row first. The order is READ for every
// placement, and both are asserted seen: an order never exercised is not one pinned.
const PROJECTED_WHY = 'name a workdir that cannot be resolved completely';
const plainRow = (id: string, workdir: string): void => {
  fs.writeFileSync(path.join(h.home, '.cc-sessions', `${id}.uuid`), `u-${id}`);
  fs.writeFileSync(path.join(h.home, '.cc-sessions', `${id}.workdir`), workdir);
};
const dropPlainRow = (id: string): void => {
  for (const f of ['uuid', 'workdir']) fs.rmSync(path.join(h.home, '.cc-sessions', `${id}.${f}`), { force: true });
};
/** `_ws_reclaim_eval`'s answer for any child id — `evalOf` asks `CHILD_ID` alone. */
const evalAs = (id: string): LadderAnswer => {
  const out = h.sh(`${CHILD_STUBS} _ws_reclaim_eval ${id} 0 '' >/dev/null;`
    + ` printf '%s\\x1f%s\\x1f%s' "$REAP_VERDICT" "$REAP_TOKEN" "$REAP_DETAIL"`);
  const [verdict = '', token = '', detail = ''] = out.split('\x1f');
  return { verdict, token, detail };
};

it('a complete row listed before a projected row lends it no placement proof', () => {
  const c = makeChild(h);
  fs.mkdirSync(path.join(c.wt, 'server'));
  const complete = path.join(h.home, 'outside', 'server');
  fs.mkdirSync(complete, { recursive: true });
  // Entered while `alias` led into the child; `alias` is gone, so the spelling projects outside it.
  const projected = `${h.home}/alias/server`;
  expect(basisOf(complete), 'the CONTROL: the complete row resolves completely').toMatch(/^0\x1f.*\x1fcomplete$/);
  expect(basisOf(projected), 'the CONTROL: the projected row reads outside the child, as text')
    .toBe(`0\x1f${fs.realpathSync(h.home)}/alias/server\x1fabsent-suffix`);
  plainRow('demo-solo', complete);
  expect(evalOf(h).verdict, 'the CONTROL: the complete row alone holds nothing').toBe('reclaimable');
  dropPlainRow('demo-solo');
  const seen = new Set<string>();
  for (let i = 0; i < 64 && seen.size < 2; i += 1) {
    const done = `demo-c${i}-whole`;
    const proj = `demo-p${i}-proj`;
    if (i % 2 === 0) { plainRow(done, complete); plainRow(proj, projected); }
    else { plainRow(proj, projected); plainRow(done, complete); }
    const listed = h.sh(`find -P "$REG" -mindepth 1 -maxdepth 1 -name '*.workdir' ! -name '.*'`).split('\n');
    const iDone = listed.indexOf(path.join(h.home, '.cc-sessions', `${done}.workdir`));
    const iProj = listed.indexOf(path.join(h.home, '.cc-sessions', `${proj}.workdir`));
    expect(iDone >= 0 && iProj >= 0, listed.join('\n')).toBe(true);
    const order = iDone < iProj ? 'complete-first' : 'projected-first';
    seen.add(order);
    const r = evalOf(h);
    expect(r.verdict, `${done}/${proj}, ${order}: ${r.detail}`).toBe('unmeasured');
    expect(r.detail).toContain(`registry row(s) ${proj} ${PROJECTED_WHY}`);
    expect(r.detail, 'the complete row is placed, never named').not.toContain(done);
    expect(r.token).toBe('');
    dropPlainRow(done); dropPlainRow(proj);
  }
  expect([...seen].sort(), 'both listing orders were exercised').toEqual(['complete-first', 'projected-first']);
  expect(fs.existsSync(path.join(c.wt, 'server')), 'the child’s tree stands').toBe(true);
}, 180_000);

// THE HOLD IS D-3731'S COST, PINNED (review 212, F1; D-3734). A row whose directory is gone resolves only as a
// projection, so it holds EVERY child's reclaim at `unmeasured` — a present child, a vanished one, and two vanished
// children each other. R19's own arm is unchanged: each vanished child alone still reclaims. Recovery is not here.
it('ambiguous row hold: a present child beside an unrelated gone-directory row is unmeasured', () => {
  const c = makeChild(h);
  const retired = path.join(h.home, 'projects', 'retired', 'x');
  fs.mkdirSync(retired, { recursive: true });
  plainRow('demo-stale', retired);
  expect(evalOf(h).verdict, 'the CONTROL: while its directory stands the row is placed outside').toBe('reclaimable');
  fs.rmSync(path.join(h.home, 'projects', 'retired'), { recursive: true, force: true });
  const r = evalOf(h);
  expect(r.verdict, r.detail).toBe('unmeasured');
  expect(r.detail).toContain(`registry row(s) demo-stale ${PROJECTED_WHY}`);
  // The remedy is the operator's F3 ruling, as review 213 (r3, r4) asked it be worded: restore the LINK to its
  // original target, or purge the row once its session has ended — and never create a directory where a link
  // stood, which re-points the spelling by replacement (D-3735) and let the verb remove the tree (measured).
  expect(r.detail, 'the remedy: searchable, the link restored, or the row purged (review 212 F3, review 213 r3)')
    .toContain('make it searchable if a directory on its path cannot be searched, restore a link on its path to its'
      + ' original target (never create a directory in a link\'s place), or purge the row once its session has ended');
  expect(r.detail, 'and never invites re-pointing').not.toContain('re-point');
  expect(r.detail, 'nor restoring "its path", which reads as a mkdir').not.toContain('restore its path');
  expect(r.detail, 'by id only').not.toContain(retired);
  expect(r.token).toBe('');
  expect(fs.existsSync(c.wt)).toBe(true);
}, 60_000);

it('ambiguous row hold: a vanished subject beside a vanished sibling row is unmeasured', () => {
  const c = makeChild(h);
  const sibling = path.join(h.home, 'worktrees', 'demo', 'sibling');
  fs.mkdirSync(sibling, { recursive: true });
  plainRow('demo-sibling', sibling);
  fs.rmSync(c.wt, { recursive: true, force: true });
  const alone = evalOf(h);
  expect(alone.verdict, `the CONTROL: R19 — the vanished subject reclaims while the sibling stands — ${alone.detail}`)
    .toBe('reclaimable');
  fs.rmSync(sibling, { recursive: true, force: true });
  const r = evalOf(h);
  expect(r.verdict, r.detail).toBe('unmeasured');
  expect(r.detail).toContain(`registry row(s) demo-sibling ${PROJECTED_WHY}`);
  expect(r.detail, 'by id only').not.toContain(sibling);
  expect(r.token).toBe('');
}, 60_000);

it('ambiguous row hold: two vanished children hold each other', () => {
  const c = makeChild(h);
  h.sh(`${WS_ADD} CCD_WS_SLUG=still-harbor cmd_ws_add --child ${CHILD_RUN} demo`);
  const other = 'demo-still-harbor';
  const otherWt = path.join(h.home, 'worktrees', 'demo', 'still-harbor');
  expect(fs.existsSync(path.join(h.home, '.cc-sessions', `${other}.child`)), 'the CONTROL: a second marked child').toBe(true);
  fs.rmSync(c.wt, { recursive: true, force: true });
  const first = evalOf(h);
  expect(first.verdict, `the CONTROL: R19 — one vanished child reclaims while the other stands — ${first.detail}`)
    .toBe('reclaimable');
  fs.rmSync(otherWt, { recursive: true, force: true });
  const mine = evalOf(h);
  expect(mine.verdict, mine.detail).toBe('unmeasured');
  expect(mine.detail).toContain(`registry row(s) ${other} ${PROJECTED_WHY}`);
  expect(mine.token).toBe('');
  const theirs = evalAs(other);
  expect(theirs.verdict, theirs.detail).toBe('unmeasured');
  expect(theirs.detail).toContain(`registry row(s) ${CHILD_ID} ${PROJECTED_WHY}`);
  expect(theirs.token).toBe('');
  expect(mine.detail, 'the other row by id only').not.toContain(otherWt);
  expect(theirs.detail, 'the other row by id only').not.toContain(c.wt);
}, 120_000);

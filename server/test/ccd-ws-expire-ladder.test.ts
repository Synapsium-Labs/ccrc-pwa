// `_ws_expire_eval` — the expiry ladder, rung by rung (workspace lifecycle spec 2026-09-24 §5.3). Called directly,
// with `_WS_RCL_ACT=expire` as `cmd_ws_expire` sets it (the audit sets none: rung 5's one extra question reads the
// binding, which one case below holds): the verb and the audit that consume it can be no more right than this function is.
//
// The ORDER is the spec's: rung 1 (`no-such-session`, `not-a-workspace`), rung 2′ (`not-archived`, `not-expired`,
// `child`), then child reclamation's rungs 3-10 unchanged (`paused`, `held`, `attached`, the identity refusal
// `no-worktree-record`, the vanished-worktree arm, `tree-busy`, `branch-elsewhere`, `tree-unreadable`,
// `containment-unproven`) — with rung 5 asked MORE of for an expiry: a detached pane and a live unit refuse `live`.
// FIXTURE HOME ONLY (`wsExpireFixture.ts`).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CHILD_ID, CHILD_STUBS, TMUX_FAULTS, evalOf, makeChild, plantTmux } from './childReclaimFixture.js';
import { EXP_BRANCH, EXP_ID, EXP_STUBS, NOW, OLD, WEEK, archiveAt, expireEvalOf, makeArchived } from './wsExpireFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-ws-expire-ladder-'); });
afterEach(() => { h.cleanup(); });

const reg = (field: string): string => path.join(h.home, '.cc-sessions', `${EXP_ID}.${field}`);
/** A live session with one attached client. */
const ATTACHED = 'tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; case "$1" in has-session) return 0 ;; list-clients) echo /dev/pts/3 ;; *) return 1 ;; esac; };';
/** A unit systemd reports running. */
const UNIT_ACTIVE = '_svc_is_active() { printf active; };';

describe('an archived workspace a week old passes, and its token binds the archive', () => {
  it('answers expirable with a 64-hex token, stable across two reads of an unchanged workspace', () => {
    makeArchived(h);
    const a = expireEvalOf(h);
    expect(a.verdict, a.detail).toBe('expirable');
    expect(a.token).toMatch(/^[0-9a-f]{64}$/);
    expect(expireEvalOf(h).token).toBe(a.token);
  }, 60_000);

  it('the seven-day boundary is exact: 604799 seconds refuses not-expired, 604800 proceeds', () => {
    makeArchived(h, NOW - (WEEK - 1));
    const young = expireEvalOf(h);
    expect(young.verdict).toBe('not-expired');
    expect(young.token).toBe('');
    expect(young.detail).toContain(`${WEEK - 1} seconds ago`);
    archiveAt(h, NOW - WEEK);
    expect(expireEvalOf(h).verdict).toBe('expirable');
  }, 60_000);

  it('an archive stamped in the FUTURE is not old — not-expired, never a negative age read as old', () => {
    makeArchived(h, NOW + 3600);
    expect(expireEvalOf(h).verdict).toBe('not-expired');
  }, 60_000);

  it('the archive EPOCH is a token input: the same tree archived again has another token', () => {
    makeArchived(h);
    const first = expireEvalOf(h).token;
    archiveAt(h, OLD + 1);
    const again = expireEvalOf(h);
    expect(again.verdict).toBe('expirable');
    expect(again.token, 'a return and a re-archive start a new token — the old one cannot spend it').not.toBe(first);
  }, 60_000);

  it('an expiry token is never a reclaim token over the same facts — `mode=expire` leads it', () => {
    makeArchived(h);
    const out = h.sh(`${CHILD_STUBS} _ws_expire_now() { echo ${NOW}; }; _WS_RCL_ACT=expire; _ws_expire_eval ${EXP_ID} >/dev/null;`
      + ' printf "%s\\n" "${_WS_LADDER_BIND[@]}"');
    expect(out.split('\n')).toEqual(['mode=expire', `id=${EXP_ID}`, `archivedAt=${OLD}`]);
  }, 60_000);
});

describe('the shared ladder needs its caller’s binding', () => {
  it('entered with no binding — no rungs 1-2 asked — it is unmeasured, never a token over no population', () => {
    makeArchived(h);
    const out = h.sh(`${CHILD_STUBS} _ws_reclaim_reset; _ws_reclaim_ladder ${EXP_ID} 0 >/dev/null;`
      + ' printf "%s\\x1f%s" "$REAP_VERDICT" "$REAP_TOKEN"');
    expect(out.split('\x1f')).toEqual(['unmeasured', '']);
  }, 60_000);
});

describe('rung 1 — identity', () => {
  it('refuses no-such-session when there is no registry row', () => {
    makeArchived(h);
    fs.rmSync(reg('uuid'));
    expect(expireEvalOf(h).verdict).toBe('no-such-session');
  }, 60_000);

  it('refuses not-a-workspace for a main checkout — even one carrying an archive stamp', () => {
    makeArchived(h);
    fs.rmSync(reg('workspace'));
    const r = expireEvalOf(h);
    expect(r.verdict).toBe('not-a-workspace');
    expect(r.detail).toContain('never expired');
  }, 60_000);
});

describe('rung 2′ — archived, a week ago, and not a child', () => {
  it('refuses not-archived when no `.archived` stamp stands', () => {
    makeArchived(h);
    fs.rmSync(reg('archived'));
    expect(expireEvalOf(h).verdict).toBe('not-archived');
  }, 60_000);

  it('a stamp that is not an epoch is UNMEASURED — never old, never a token', () => {
    makeArchived(h);
    for (const bad of ['soon', '', '0', '0123', '1e9', '-5']) {
      fs.writeFileSync(reg('archived'), `${bad}\n`);
      const r = expireEvalOf(h);
      expect(r.verdict, JSON.stringify(bad)).toBe('unmeasured');
      expect(r.token).toBe('');
    }
    fs.rmSync(reg('archived'));
    fs.mkdirSync(reg('archived'));
    expect(expireEvalOf(h).verdict, 'a directory standing there is no epoch').toBe('unmeasured');
  }, 60_000);

  it('refuses child for a marker that reads as a child, a malformed one, an unreadable one and a dangling link', () => {
    makeArchived(h);
    const marker = reg('child');
    for (const plant of [
      () => fs.writeFileSync(marker, '7\n'),
      () => fs.writeFileSync(marker, 'not-a-run\n'),
      () => { fs.writeFileSync(marker, '7\n'); fs.chmodSync(marker, 0o000); },
      () => fs.symlinkSync(path.join(h.home, 'nowhere'), marker),
    ]) {
      fs.rmSync(marker, { force: true });
      plant();
      const r = expireEvalOf(h);
      expect(r.verdict, r.detail).toBe('child');
      expect(r.token).toBe('');
      fs.rmSync(marker, { force: true });
    }
    expect(expireEvalOf(h).verdict, 'the CONTROL: no marker, no refusal').toBe('expirable');
  }, 90_000);

  it('rung 2′ outranks every retryable rung after it — paused, held and attached do not hide a child or a young archive', () => {
    makeArchived(h);
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'reclaim-paused'), '');
    fs.writeFileSync(reg('hold'), 'program:x wave:1/1');
    fs.writeFileSync(reg('child'), '7\n');
    expect(expireEvalOf(h, { pre: ATTACHED }).verdict).toBe('child');
    fs.rmSync(reg('child'));
    archiveAt(h, NOW - 60);
    expect(expireEvalOf(h, { pre: ATTACHED }).verdict).toBe('not-expired');
  }, 60_000);
});

describe('rungs 3 to 6 — the RECLAIM ladder’s, asked unchanged', () => {
  it('refuses paused while the cleanup switch stands — a file, a directory, a dangling link', () => {
    makeArchived(h);
    const pause = path.join(h.home, '.cc-sessions', 'reclaim-paused');
    fs.writeFileSync(pause, '');
    expect(expireEvalOf(h).verdict).toBe('paused');
    fs.rmSync(pause);
    fs.mkdirSync(pause);
    expect(expireEvalOf(h).verdict).toBe('paused');
    fs.rmdirSync(pause);
    fs.symlinkSync(path.join(h.home, 'nowhere'), pause);
    expect(expireEvalOf(h).verdict).toBe('paused');
  }, 60_000);

  it('refuses held — an archived workspace still held after a week is not acted on', () => {
    makeArchived(h);
    fs.writeFileSync(reg('hold'), 'program:x wave:2/3');
    const r = expireEvalOf(h);
    expect(r.verdict).toBe('held');
    expect(r.detail).toContain('program:x wave:2/3');
  }, 60_000);

  it('refuses attached on an attached client — asked through the ANCHORED target', () => {
    makeArchived(h);
    expect(expireEvalOf(h, { pre: ATTACHED }).verdict).toBe('attached');
    expect(h.calls()).toContain(`tmux has-session -t =cc-${EXP_ID}:`);
  }, 60_000);

  it('refuses tree-busy while an operation is in progress, and while a git command holds the index lock', () => {
    const { wt, main } = makeArchived(h);
    const mergeHead = h.git(wt, 'rev-parse', '--path-format=absolute', '--git-path', 'MERGE_HEAD');
    fs.writeFileSync(mergeHead, `${h.git(main, 'rev-parse', 'HEAD')}\n`);
    expect(expireEvalOf(h).verdict).toBe('tree-busy');
    fs.rmSync(mergeHead);
    const idx = h.git(wt, 'rev-parse', '--path-format=absolute', '--git-path', 'index');
    fs.writeFileSync(`${idx}.lock`, '');
    expect(expireEvalOf(h).verdict).toBe('tree-busy');
  }, 60_000);

  it('tmux that could not be asked is unmeasured — never "no session", never a token', () => {
    makeArchived(h);
    plantTmux(h, { fault: TMUX_FAULTS['no server running'] });
    const r = expireEvalOf(h);
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.token).toBe('');
  }, 60_000);
});

// THE COORDINATOR'S RULING (D), review 240's "already archived" follow-up: an `.archived` row whose pane or supervisor
// is LIVE is never expired. Measured before the rung existed (the plan's mutation row deletes the call): a DETACHED
// `cc-<id>` pane and a running unit with no pane both passed every rung and minted a token. `attached` asks only for a
// client; `tree-busy` only for a git operation or an index lock. What the rung asks is the PANE and the UNIT — a
// process whose cwd is the worktree but which runs outside both (an operator's own shell) is not seen, by design and
// stated (the plan's departure `expire-refuses-a-live-pane-or-unit`).
describe('rung 5, asked more of for an expiry — a live pane or a live unit refuses `live`', () => {
  it('a `cc-<id>` session that is up with NO client attached (a detached pane) refuses live', () => {
    makeArchived(h);
    plantTmux(h, { sessions: [`cc-${EXP_ID}`] });
    const r = expireEvalOf(h);
    expect(r.verdict, r.detail).toBe('live');
    expect(r.detail).toContain('no terminal attached');
    expect(r.token).toBe('');
  }, 60_000);

  it('a live UNIT with no pane refuses live; a unit the manager will not describe is unmeasured', () => {
    makeArchived(h);
    const r = expireEvalOf(h, { pre: UNIT_ACTIVE });
    expect(r.verdict, r.detail).toBe('live');
    expect(r.detail).toContain(`claude-session@${EXP_ID}`);
    expect(expireEvalOf(h, { pre: '_svc_is_active() { printf activating; };' }).verdict).toBe('live');
    expect(expireEvalOf(h, { pre: '_svc_is_active() { :; };' }).verdict, 'no answer is not absence').toBe('unmeasured');
    expect(expireEvalOf(h, { pre: '_svc_is_active() { printf failed; };' }).verdict, 'a failed unit is not restarted').toBe('expirable');
  }, 60_000);

  it('asked by the BINDING, not the flavour: `_ws_expire_eval` called with no `_WS_RCL_ACT` set still refuses live', () => {
    makeArchived(h);
    const out = h.sh(`${EXP_STUBS} ${UNIT_ACTIVE} _ws_expire_eval ${EXP_ID} >/dev/null;`
      + ' printf "%s\\x1f%s\\x1f%s" "$_WS_RCL_ACT" "$REAP_VERDICT" "$REAP_TOKEN"');
    expect(out.split('\x1f'), 'the global flavour is a reclaim\'s, and the expiry still asked').toEqual(['reclaim', 'live', '']);
  }, 60_000);

  it('the CONTROL: ws-reclaim is NOT asked this — a finished child with a detached pane is still reclaimable', () => {
    makeChild(h);
    plantTmux(h, { sessions: [`cc-${CHILD_ID}`] });
    expect(evalOf(h).verdict).toBe('reclaimable');
    expect(evalOf(h, { pre: UNIT_ACTIVE }).verdict, 'and a live unit is the tail\'s to stop').toBe('reclaimable');
  }, 60_000);
});

// ON DARWIN A `failed` IS A STAMP, NOT AN ANSWER FROM LAUNCHD (`_svc_is_active` prints it from `$REG/<id>.svcfailed`
// before it asks launchd, and nothing that starts the job again clears it): a running job under a stale stamp would
// pass as stopped. So the expiry asks launchd as the reclaim tail does. Forced on any host the way the tail's own rows
// force it — `CCD_OS=darwin` assigned after the source — with `_svc_launchctl`, ccd's one door to launchctl, recording
// and answering, and `_svc_is_active` answering the stamp's `failed`.
describe('rung 5 on Darwin — a `failed` stamp is stopped only when launchd says the job is not loaded', () => {
  const LABEL = `gui/${process.getuid?.() ?? 0}/app.ccrc.session.${EXP_ID}`;
  const darwin = (out: string, rc: number): string =>
    'CCD_OS=darwin; _svc_is_active() { printf failed; };'
    + ' _svc_launchctl() { echo "launchctl $*" >> "$HOME/ccd-calls"; [[ "$1" == print ]] || return 0;'
    + ` printf '%s\\n' '${out}'; return ${rc}; };`;

  it.each([
    ['launchd shows the job running', 'live', 'state = running', 0],
    ['launchd has the job loaded, not running (it can start the pane)', 'live', 'state = waiting', 0],
    ['launchctl could not be asked (exit 1: no binary, or the sandbox guard)', 'unmeasured', '', 1],
    ['the CONTROL: launchd answers exit 113, not loaded', 'expirable', 'Could not find service', 113],
  ] as const)('a stamp, and %s → %s', (_what, want, out, rc) => {
    makeArchived(h);
    const r = expireEvalOf(h, { pre: darwin(out, rc) });
    expect(r.verdict, r.detail).toBe(want);
    expect(h.calls(), 'launchd was asked by the label ccd spells').toContain(`launchctl print ${LABEL}`);
  }, 60_000);
});

describe('rungs 7 to 9 and the identity refusal — the RECLAIM ladder’s, asked unchanged', () => {
  it('refuses branch-elsewhere when another worktree stands on the branch', () => {
    const { wt, main } = makeArchived(h);
    h.git(wt, 'checkout', '--detach');
    h.git(main, 'worktree', 'add', path.join(h.home, 'elsewhere'), EXP_BRANCH);
    expect(expireEvalOf(h).verdict).toBe('branch-elsewhere');
  }, 60_000);

  it('refuses tree-unreadable when the permission pass cannot fix the tree', () => {
    const { wt } = makeArchived(h);
    const a = path.join(wt, 'a');
    fs.mkdirSync(a);
    fs.writeFileSync(path.join(a, 'hidden.txt'), 'x');
    fs.chmodSync(a, 0o000);
    const shim = path.join(h.home, 'shim');
    fs.mkdirSync(shim);
    fs.writeFileSync(path.join(shim, 'chmod'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    try {
      expect(expireEvalOf(h, { pre: `PATH="${shim}:$PATH";` }).verdict).toBe('tree-unreadable');
    } finally { fs.chmodSync(a, 0o755); }
  }, 60_000);

  it('refuses no-worktree-record for a directory git does not record', () => {
    const { main } = makeArchived(h);
    fs.rmSync(path.join(main, '.git', 'worktrees', 'quiet-dune'), { recursive: true, force: true });
    expect(expireEvalOf(h).verdict).toBe('no-worktree-record');
  }, 60_000);

  it('refuses containment-unproven for a workdir that is a symbolic link', () => {
    const { wt } = makeArchived(h);
    const real = `${wt}-real`;
    fs.renameSync(wt, real);
    fs.symlinkSync(real, wt);
    const r = expireEvalOf(h);
    expect(r.verdict, r.detail).toBe('containment-unproven');
    expect(r.detail).toContain('symbolic link');
  }, 60_000);

  it('a VANISHED worktree is expirable over what is left, with its own token', () => {
    const { wt } = makeArchived(h);
    const present = expireEvalOf(h);
    fs.rmSync(wt, { recursive: true, force: true });
    const gone = expireEvalOf(h);
    expect(gone.verdict, gone.detail).toBe('expirable');
    expect(gone.token).toMatch(/^[0-9a-f]{64}$/);
    expect(gone.token).not.toBe(present.token);
  }, 60_000);
});

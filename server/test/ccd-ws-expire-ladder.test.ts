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
import {
  EXP_BRANCH, EXP_ID, EXP_STUBS, NOW, OLD, WEEK, archiveAt, expireEvalOf, holdCwd, makeArchived,
} from './wsExpireFixture.js';

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

// THE COORDINATOR'S RULING 3 (3962): rung 5, for an expiry only, also refuses `in-use` (retryable) when any process's
// working directory is the worktree or lies under it — the process the pane and the unit questions cannot see (an
// operator's own shell). `sleep 60` stands for it, started with its cwd where the case says; the CONTROL is a
// `ws-reclaim` over the same shape, which never asks. `/proc` is read through the seam `_ws_expire_proc_root`, and a
// FAKE root (a directory of `<pid>/cwd` links and `<pid>/stat` files) names the cases a live box cannot be made to
// produce on demand: ccd's own process in the worktree, its children, a pid that vanished, a link nobody may read.
describe('rung 5, a process whose working directory is the worktree — `in-use`', () => {
  const real = (p: string): string => fs.realpathSync(p);

  it('a `sleep` whose cwd IS the worktree refuses in-use, names the pid and the path, and nothing is touched', () => {
    const { wt } = makeArchived(h);
    const s = holdCwd(wt);
    try {
      const r = expireEvalOf(h);
      expect(r.verdict, r.detail).toBe('in-use');
      expect(r.detail).toContain(`process ${s.pid} `);
      expect(r.detail).toContain(real(wt));
      expect(r.token).toBe('');
      expect(h.calls(), 'no unit or pane call was made').toEqual(expect.not.arrayContaining([expect.stringMatching(/^(unsupervise|tmux kill)/)]));
      expect(fs.existsSync(wt)).toBe(true);
    } finally { s.stop(); }
  }, 60_000);

  it('a `sleep` whose cwd is a SUBDIRECTORY of the worktree refuses in-use too', () => {
    const { wt } = makeArchived(h);
    fs.mkdirSync(path.join(wt, 'deep', 'er'), { recursive: true });
    const s = holdCwd(path.join(wt, 'deep', 'er'));
    try {
      const r = expireEvalOf(h);
      expect(r.verdict, r.detail).toBe('in-use');
      expect(r.detail).toContain(`process ${s.pid} `);
    } finally { s.stop(); }
  }, 60_000);

  it('a `sleep` in a SIBLING directory whose name merely begins with the worktree’s (`<worktree>2`) is not in it — expirable', () => {
    const { wt } = makeArchived(h);
    const sibling = `${wt}2`;
    fs.mkdirSync(sibling);
    const s = holdCwd(sibling);
    try {
      const r = expireEvalOf(h);
      expect(r.verdict, r.detail).toBe('expirable');
    } finally { s.stop(); }
  }, 60_000);

  it('the same `sleep` once it is gone: the CONTROL — expirable', () => {
    const { wt } = makeArchived(h);
    const s = holdCwd(wt);
    s.stop();   // SIGKILL: the cwd link is released at exit, a zombie's cannot be read
    expect(expireEvalOf(h).verdict).toBe('expirable');
  }, 60_000);

  it('a /proc that cannot be listed is UNMEASURED — never "nobody", never a token', () => {
    makeArchived(h);
    const missing = expireEvalOf(h, { pre: '_ws_expire_proc_root() { printf %s "$HOME/no-such-proc"; };' });
    expect(missing.verdict, missing.detail).toBe('unmeasured');
    expect(missing.token).toBe('');
    fs.mkdirSync(path.join(h.home, 'empty-proc'));
    const empty = expireEvalOf(h, { pre: '_ws_expire_proc_root() { printf %s "$HOME/empty-proc"; };' });
    expect(empty.verdict, 'a listing that does not even hold ccd’s own pid measured nothing').toBe('unmeasured');
    expect(empty.token).toBe('');
  }, 60_000);

  // The fake root: `$HOME/fp/<pid>/cwd` (a link) and `stat` (the kernel's one line, whose fourth field is the parent).
  const FAKE = (wt: string): string => [
    'mkdir -p "$HOME/fp/$$"; ln -sfn "$HOME" "$HOME/fp/$$/cwd";',
    '_fp() { mkdir -p "$HOME/fp/$1"; ln -sfn "$2" "$HOME/fp/$1/cwd"; printf "%s (a b) S %s 1 1 0\\n" "$1" "$3" > "$HOME/fp/$1/stat"; };',
    `_fp 4242 "${real(wt)}/sub" 1;`,
    '_ws_expire_proc_root() { printf %s "$HOME/fp"; };',
  ].join(' ');

  it('a fake /proc: a stranger in the worktree refuses in-use; ccd’s own process, its children and a vanished pid are skipped', () => {
    const { wt } = makeArchived(h);
    // ccd's own process has its cwd in the worktree (a caller that ran it from there); a child of ccd, a pid with no
    // cwd link left (4301), a pid whose cwd link vanished after the listing (4303: a cwd but NO stat file) and a pid
    // whose cwd link answers EACCES (4304: its directory cannot be searched — planted unless the suite runs as root,
    // which reads through it) are not users either. `$BASHPID` is pinned apart from `$$` by the next case.
    const root = process.getuid?.() === 0;
    const skipped = [
      'rm -f "$HOME/fp/$$/cwd"; _fp $$ "' + real(wt) + '" 1;',   // ccd itself, with a readable stat: only the skip of its own pid can pass it
      '_fp 4300 "' + real(wt) + '" $$;',
      'mkdir -p "$HOME/fp/4301";',
      '_fp 4303 "' + real(wt) + '" 1; rm -f "$HOME/fp/4303/stat";',
      root ? ':' : '[[ -e "$HOME/fp/4304" ]] || { _fp 4304 "' + real(wt) + '" 1; chmod 000 "$HOME/fp/4304"; };',
    ].join(' ');
    const eacces = path.join(h.home, 'fp', '4304');
    try {
      const alone = expireEvalOf(h, { pre: `${FAKE(wt)} rm -rf "$HOME/fp/4242"; ${skipped}` });
      expect(alone.verdict, alone.detail).toBe('expirable');
      const withStranger = expireEvalOf(h, { pre: `${FAKE(wt)} ${skipped}` });
      expect(withStranger.verdict, withStranger.detail).toBe('in-use');
      expect(withStranger.detail).toContain('process 4242 ');
      expect(withStranger.detail).not.toContain('process 4303 ');
      expect(withStranger.detail).not.toContain('process 4304 ');
      expect(withStranger.detail).not.toContain('process 4300 ');
    } finally { if (fs.existsSync(eacces)) fs.chmodSync(eacces, 0o755); }
  }, 60_000);

  it('`$BASHPID` is skipped apart from `$$`: a process whose parent is the scanning subshell is not a user', () => {
    const { wt } = makeArchived(h);
    const asked = (child: string): string => h.sh(`${EXP_STUBS} ${FAKE(wt)} rm -rf "$HOME/fp/4242"; _ws_reclaim_reset;`
      + ` ( ${child} _ws_expire_cwd_users ${EXP_ID} "${wt}"; printf '%s' "$REAP_VERDICT" )`);
    expect(asked('_fp 4310 "' + real(wt) + '" $BASHPID;'), 'a child of the subshell that scans (BASHPID != $$ here)').toBe('');
    expect(asked('_fp 4310 "' + real(wt) + '" 1;'), 'the CONTROL: the same process under another parent').toBe('in-use');
  }, 60_000);

  // A skip needs PROOF the process vanished. What is not proof — a stat file that does not parse, a ps that is missing
  // or fails with output — is UNMEASURED: reading it as "gone" would answer "nobody" over a live process (measured by
  // review: with ps missing, the broad except skipped the live sleep and the scan answered rc 0).
  it('a stat file that does not parse is UNMEASURED — never a skip, never "nobody"', () => {
    const { wt } = makeArchived(h);
    for (const bad of ['garbage', '4242 (a b) S', '4242 (a b) S notanumber 1 1 0', '']) {
      const r = expireEvalOf(h, { pre: `${FAKE(wt)} printf '%s\\n' '${bad}' > "$HOME/fp/4242/stat";` });
      expect(r.verdict, `stat ${JSON.stringify(bad)}: ${r.detail}`).toBe('unmeasured');
      expect(r.token).toBe('');
    }
  }, 90_000);

  it('a leaf that is a symbolic link is judged by its own name: nobody’s cwd reads through it, and the later rung refuses it', () => {
    const { wt } = makeArchived(h);
    const target = `${wt}-real`;
    fs.renameSync(wt, target);
    fs.symlinkSync(target, wt);
    const s = holdCwd(target);
    try {
      const r = expireEvalOf(h);
      expect(r.verdict, 'not in-use: the process is in the link’s TARGET; the link itself is containment-unproven').toBe('containment-unproven');
    } finally { s.stop(); }
  }, 60_000);

  it('a VANISHED worktree has no cwd to ask about — expirable over what is left', () => {
    const { wt } = makeArchived(h);
    fs.rmSync(wt, { recursive: true, force: true });
    expect(expireEvalOf(h).verdict).toBe('expirable');
  }, 60_000);

  it('the CONTROL: ws-reclaim is NOT asked this — a finished child with a process in its worktree is still reclaimable', () => {
    const c = makeChild(h);
    const s = holdCwd(c.wt);
    try {
      const r = evalOf(h);
      expect(r.verdict, r.detail).toBe('reclaimable');
    } finally { s.stop(); }
  }, 60_000);
});

// ON DARWIN the same question is asked of `lsof -a -d cwd -Fpn`, through the seam `_ws_expire_lsof` (no lsof is
// installed here, and a stub can name the listing exactly). A listing is trusted only when it holds ccd's own process —
// the Linux arm's rule — so an lsof that is missing, fails, or prints nothing is UNMEASURED.
describe('rung 5 on Darwin — a cwd under the worktree, asked of lsof', () => {
  const lsof = (body: string, rc = 0): string => `CCD_OS=darwin; _ws_expire_lsof() { ${body} return ${rc}; };`;
  const listing = (pid: number | string, dir: string): string =>
    `printf 'p%s\\nn%s\\np%s\\nn%s\\n' "$$" "$HOME" "${pid}" "${dir}";`;

  it('lists a process with its cwd in the worktree → in-use; in a sibling → expirable', () => {
    const { wt } = makeArchived(h);
    const sibling = `${wt}2`;
    fs.mkdirSync(sibling);
    const s = holdCwd(wt);
    const t = holdCwd(sibling);
    try {
      const hit = expireEvalOf(h, { pre: lsof(listing(s.pid, fs.realpathSync(wt))) });
      expect(hit.verdict, hit.detail).toBe('in-use');
      expect(hit.detail).toContain(`process ${s.pid} `);
      const sub = expireEvalOf(h, { pre: lsof(listing(s.pid, `${fs.realpathSync(wt)}/sub`)) });
      expect(sub.verdict, 'a subdirectory').toBe('in-use');
      const miss = expireEvalOf(h, { pre: lsof(listing(t.pid, fs.realpathSync(sibling))) });
      expect(miss.verdict, miss.detail).toBe('expirable');
    } finally { s.stop(); t.stop(); }
  }, 60_000);

  // `ps` is how the Darwin arm learns a hit's parent. It is hidden from the scan alone (PATH narrowed to a directory
  // that holds python3 and nothing else, for the python3 call only), so the rest of the ladder still finds its tools.
  const withPs = (dir: string): string => `python3() { PATH="${dir}" command python3 "$@"; };`;
  const binDir = (name: string, ps?: string): string => {
    const d = path.join(h.home, name);
    fs.mkdirSync(d);
    fs.symlinkSync(h.sh('command -v python3').trim(), path.join(d, 'python3'));   // through the harness: all three poisons
    if (ps !== undefined) fs.writeFileSync(path.join(d, 'ps'), `#!/bin/sh\n${ps}\n`, { mode: 0o755 });
    return d;
  };

  it('a live process in the worktree and a `ps` that is MISSING is UNMEASURED — never skipped as if it had vanished', () => {
    const { wt } = makeArchived(h);
    const s = holdCwd(wt);
    try {
      const r = expireEvalOf(h, { pre: lsof(listing(s.pid, fs.realpathSync(wt))) + withPs(binDir('no-ps')) });
      expect(r.verdict, r.detail).toBe('unmeasured');
      expect(r.token).toBe('');
    } finally { s.stop(); }
  }, 60_000);

  // A SKIP NEEDS THE KERNEL'S WORD. `ps` that fails, is killed by a signal or says nothing is an ERROR, whatever its
  // status: with the process alive (a real `sleep` in the worktree) every one of them is UNMEASURED. Only a pid the
  // kernel no longer has (`kill(pid, 0)` answers ESRCH) is skipped. Review measured the previous rule — "ps exits
  // non-zero with no output means gone" — answering nobody for four of the first five.
  const psCase = (name: string, ps: string): { verdict: string; detail: string } => {
    const { wt } = makeArchived(h);
    const s = holdCwd(wt);
    try {
      return expireEvalOf(h, { pre: lsof(listing(s.pid, fs.realpathSync(wt))) + withPs(binDir(name, ps)) });
    } finally { s.stop(); }
  };

  it.each([
    ['(a) exits 1 with only stderr', 'echo "ps: something broke" >&2; exit 1'],
    ['(a2) exits 2 with output', 'echo "ps: kernel said no"; exit 2'],
    ['(a3) a silent exit 127', 'exit 127'],
    ['(b) is killed by SIGKILL', 'kill -9 $$'],
    ['(b2) is killed by SIGSEGV', 'kill -SEGV $$'],
    ['(d) exits 0 with an empty answer', 'exit 0'],
    ['(d2) exits 0 with an answer that is no pid', 'echo not-a-pid'],
  ] as const)('a live process in the worktree and a `ps` that %s is UNMEASURED — never a skip', (what, ps) => {
    const r = psCase(`ps-${what.slice(1, 3)}`, ps);
    expect(r.verdict, `${what}: ${r.detail}`).toBe('unmeasured');
  }, 60_000);

  it('(c) a pid the KERNEL no longer has is skipped — whether ps answers an error or says nothing', () => {
    const { wt } = makeArchived(h);
    // A real pid, finished AND REAPED before the listing names it (bash waits for it), so `kill(pid, 0)` is ESRCH.
    const gone = Number(h.sh('sleep 0 & echo $!; wait').trim());   // through the harness: all three poisons
    const pre = (extra: string): string => lsof(listing(gone, fs.realpathSync(wt))) + extra;
    expect(expireEvalOf(h, { pre: pre('') }).verdict, 'the real ps: no such process').toBe('expirable');
    for (const ps of ['exit 1', 'echo "ps: it broke" >&2; exit 2', 'kill -9 $$']) {
      const r = expireEvalOf(h, { pre: pre(withPs(binDir(`ps-c${ps.length}`, ps))) });
      expect(r.verdict, `${ps}: ${r.detail}`).toBe('expirable');
    }
  }, 90_000);

  it('lsof not on PATH is found at the fallback (/usr/sbin on macOS); found nowhere it is unmeasured', () => {
    const { wt } = makeArchived(h);
    const s = holdCwd(wt);
    try {
      const stub = path.join(h.home, 'sbin-lsof');
      fs.writeFileSync(stub, `#!/bin/sh\nprintf 'p%s\\nn%s\\np%s\\nn%s\\n' "$PPID_OF_CCD" "$HOME" "${s.pid}" "${fs.realpathSync(wt)}"\n`, { mode: 0o755 });
      const notOnPath = 'CCD_OS=darwin; command() { if [[ "$1" == -v && "$2" == lsof ]]; then return 1; fi; builtin command "$@"; };';
      const found = expireEvalOf(h, { pre: `${notOnPath} export PPID_OF_CCD=$$; _ws_expire_lsof_fallback() { printf %s "${stub}"; };` });
      expect(found.verdict, found.detail).toBe('in-use');
      const nowhere = expireEvalOf(h, { pre: `${notOnPath} _ws_expire_lsof_fallback() { printf %s "${h.home}/no-such-lsof"; };` });
      expect(nowhere.verdict, nowhere.detail).toBe('unmeasured');
    } finally { s.stop(); }
  }, 90_000);

  // THE LSOF IS BOUNDED (`WS_EXPIRE_LSOF_DEADLINE_S`, through `_plat_timeout`): the reap lock is held while it runs and a
  // hung network mount can block it for ever. The stub is a real BINARY (a function stub cannot wedge — the bound execs
  // its argv) that prints ccd's own pid and the stranger FIRST and then hangs, so a listing that is only cut short would
  // still look complete: a timeout is unmeasured, never "nobody" and never a partial listing believed. The sleeper is
  // finite (30 s) so that, with the bound removed, the case FAILS on its own elapsed-time assertion rather than hanging.
  it('an lsof that outruns its bound is UNMEASURED — even one that already listed ccd and a process in the worktree', () => {
    const { wt } = makeArchived(h);
    const s = holdCwd(wt);
    try {
      const stub = path.join(h.home, 'slow-lsof');
      fs.writeFileSync(stub, `#!/bin/sh\nprintf 'p%s\\nn%s\\np%s\\nn%s\\n' "$PID_OF_CCD" "$HOME" "${s.pid}" "${fs.realpathSync(wt)}"\nexec sleep 30\n`, { mode: 0o755 });
      const pre = 'CCD_OS=darwin; command() { if [[ "$1" == -v && "$2" == lsof ]]; then return 1; fi; builtin command "$@"; };'
        + ` export PID_OF_CCD=$$; WS_EXPIRE_LSOF_DEADLINE_S=1; CCD_TIMEOUT_KILL_AFTER=2; _ws_expire_lsof_fallback() { printf %s "${stub}"; };`;
      const t0 = Date.now();
      const r = expireEvalOf(h, { pre });
      const took = Date.now() - t0;
      expect(took, 'the bound cut it short (the stub sleeps 30 s)').toBeLessThan(15_000);
      expect(r.verdict, r.detail).toBe('unmeasured');
      expect(r.detail).toContain('did not finish within 1s');
      expect(r.token).toBe('');
    } finally { s.stop(); }
  }, 40_000);

  it('an lsof that fails, prints nothing, or lists everybody but ccd is UNMEASURED', () => {
    makeArchived(h);
    for (const [what, pre] of [
      ['exits 1 with nothing', lsof('', 1)],
      ['exits 0 with nothing', lsof('')],
      ['is absent', 'CCD_OS=darwin; _ws_expire_lsof() { lsof-that-is-not-installed; };'],
      ['lists a listing without ccd', lsof(`printf 'p1\\nn/\\n';`)],
    ] as const) {
      const r = expireEvalOf(h, { pre });
      expect(r.verdict, `lsof ${what}: ${r.detail}`).toBe('unmeasured');
      expect(r.token).toBe('');
    }
  }, 90_000);
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

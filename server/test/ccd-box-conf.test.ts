// `~/.ccrc/ccrc.conf` — the operator's own box preferences, and the three keys
// `ccd` reads out of it today. The file is documented by
// `deploy/ccrc.conf.example`, which is the only copy of it in git.
//
// WHAT THIS FILE IS DEFENDING, in one sentence: ABSENCE IS NOT A VALUE. A box
// with no preferences file, a file with the key missing, and a key left blank
// must every one of them behave exactly as the build did before the file
// existed. That is what makes the feature safe to ship to a fleet whose
// operators never open it, and it is the property most easily lost by a later
// change that "tidies up" a default — so every accessor below is asserted in
// BOTH directions, the unchanged one first.
//
// FIXTURE HOME ONLY (`makeCcdHarness`). HOME is ccd's single isolation
// boundary; nothing here may reach the live registry, tmux, or systemd.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, seedAccountsSh, WS_ADD, CCD, type CcdHarness } from './ccdWsHelpers.js';
import { POOLED_TEST_ROSTER } from './fixtures/poolRule.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-box-conf-'); });
afterEach(() => { h.cleanup(); });

const confPath = (): string => path.join(h.home, '.ccrc', 'ccrc.conf');
const conf = (body: string): void => { fs.writeFileSync(confPath(), body); };

/** `_conf_get <KEY>` printed value and status, in one line the test can read.
 *  The status is half the contract — three different conditions arrive as an
 *  empty string and a caller must be able to tell them apart. */
const get = (key: string): string => h.sh(`v="$(_conf_get ${key})"; printf 'rc=%s [%s]' "$?" "$v"`);

describe('_conf_get — one key out of the preferences file, and why it is empty', () => {
  it('NO FILE is rc 1: this box states no preferences at all', () => {
    expect(get('CCRC_SESSION_ACCOUNT')).toBe('rc=1 []');
  });

  it('NO KEY ARGUMENT answers rc 2 instead of taking the shell down', () => {
    // `ccd` runs under `set -u`, where a bare `$1` in a function called with
    // no argument aborts the shell — and this reader is reachable from the
    // supervise tick, where that is a supervisor lost rather than an answer
    // missed. `_conf_bool` one screen down already carries this guard and
    // states the argument; the reader carrying the opposite shape would be the
    // asymmetry, not the guard.
    conf('CCRC_SESSION_ACCOUNT=claude\n');
    expect(h.sh('_conf_get; echo "rc=$?"')).toBe('rc=2');
  });

  it('and an empty key does not fold onto a line that merely starts with `=`', () => {
    // The reason the guard ANSWERS rather than aborts, made concrete: with
    // `key=""` the match arm reads `"="*`, so without the guard this file's
    // first line would be returned as the value of a key nobody named — a
    // wrong answer, which is worse than a loud one.
    conf('=not-a-key\nCCRC_SESSION_ACCOUNT=claude\n');
    expect(h.sh('_conf_get; echo "[$?]"')).toBe('[2]');
  });

  it('a file that does not set the key is rc 2 — a different fact from rc 1', () => {
    // Kept distinct deliberately. Nothing branches on it today; "you have no
    // conf file" and "your conf file does not set that" are different
    // sentences for whatever eventually reports this to an operator, and the
    // reader must not make that choice on a caller's behalf.
    conf('# nothing here\n');
    expect(get('CCRC_SESSION_ACCOUNT')).toBe('rc=2 []');
  });

  it('a blank value is rc 2 — writing `KEY=` is not a value', () => {
    conf('CCRC_SESSION_ACCOUNT=\n');
    expect(get('CCRC_SESSION_ACCOUNT')).toBe('rc=2 []');
  });

  it('reads a plain value', () => {
    conf('CCRC_SESSION_ACCOUNT=claude-a\n');
    expect(get('CCRC_SESSION_ACCOUNT')).toBe('rc=0 [claude-a]');
  });

  it.each([
    ['one layer of double quotes', 'CCRC_SESSION_ACCOUNT="claude-a"\n'],
    ['one layer of single quotes', "CCRC_SESSION_ACCOUNT='claude-a'\n"],
    ['surrounding whitespace', 'CCRC_SESSION_ACCOUNT=   claude-a   \n'],
    ['leading indentation', '    CCRC_SESSION_ACCOUNT=claude-a\n'],
    ['a CRLF line ending', 'CCRC_SESSION_ACCOUNT=claude-a\r\n'],
    ['no trailing newline at all', 'CCRC_SESSION_ACCOUNT=claude-a'],
  ])('normalises %s', (_label, body) => {
    conf(body);
    expect(get('CCRC_SESSION_ACCOUNT')).toBe('rc=0 [claude-a]');
  });

  it('the LAST assignment wins, as it does in a shell', () => {
    conf('CCRC_SESSION_ACCOUNT=claude-b\nCCRC_SESSION_ACCOUNT=claude-a\n');
    expect(get('CCRC_SESSION_ACCOUNT')).toBe('rc=0 [claude-a]');
  });

  it('ignores comments and keys that merely look like the one asked for', () => {
    conf('# CCRC_SESSION_ACCOUNT=commented\nXCCRC_SESSION_ACCOUNT=prefixed\n'
       + 'CCRC_SESSION_ACCOUNTS=plural\n');
    expect(get('CCRC_SESSION_ACCOUNT')).toBe('rc=2 []');
  });

  it('does NOT strip a trailing comment — the validators are what make that loud', () => {
    // Neither systemd nor a shell strips one, and a reader that did would be
    // the only thing on the box with that opinion. The value comes back whole
    // and `_conf_session_effort` below refuses it rather than typing it.
    conf('CCRC_SESSION_EFFORT=high  # my choice\n');
    expect(get('CCRC_SESSION_EFFORT')).toBe('rc=0 [high  # my choice]');
  });

  it('`export KEY=value` is rc 4 — REFUSED, and refused loudly', () => {
    // This repo already ruled on the form: `deploy.sh`'s `env_drop_guard` and
    // `ccrc`'s `_box_env_value` both treat `export` as not-a-value because
    // systemd does not accept it, and `deploy-env-guard.test.ts` pins that
    // agreement by name. Accepting it here would make this the one file on the
    // box with its own dialect — and the deploy's key-drop guard would then be
    // blind to a key it exists to protect, so a shipment could silently un-set
    // a preference nobody could see the box had. Refused; and because a key
    // silently unread is what this feature exists to prevent, refused with a
    // sentence rather than a shrug.
    conf('export CCRC_SESSION_ACCOUNT=claude-a\n');
    expect(get('CCRC_SESSION_ACCOUNT')).toBe('rc=4 []');
  });

  it('an accepted assignment wins over an exported one, whatever the order', () => {
    conf('export CCRC_SESSION_ACCOUNT=claude-b\nCCRC_SESSION_ACCOUNT=claude-a\n');
    expect(get('CCRC_SESSION_ACCOUNT')).toBe('rc=0 [claude-a]');
    conf('CCRC_SESSION_ACCOUNT=claude-a\nexport CCRC_SESSION_ACCOUNT=claude-b\n');
    expect(get('CCRC_SESSION_ACCOUNT')).toBe('rc=0 [claude-a]');
  });

  it('an exported OTHER key is not mistaken for this one', () => {
    conf('export CCRC_SESSION_EFFORT=high\n');
    expect(get('CCRC_SESSION_ACCOUNT')).toBe('rc=2 []');
  });

  it('AN UNREADABLE FILE IS rc 3 — unmeasured, not absent — and is SILENT', () => {
    // The distinction is the point: a caller that read "could not open it" as
    // "no preference" would hand the machine back the decision the operator
    // took away from it. The silence is the second half: this runs on the
    // five-second supervise tick, and `_rc_enabled` one screen up carries the
    // same lesson — a redirect whose suppression comes too late prints a raw
    // `Permission denied`, with ccd's own line number, on every tick.
    conf('CCRC_SESSION_ACCOUNT=claude-a\n');
    fs.chmodSync(confPath(), 0o000);
    const out = h.sh(`v="$(_conf_get CCRC_SESSION_ACCOUNT 2>"$HOME/conf-stderr")"; `
      + `printf 'rc=%s [%s]' "$?" "$v"`);
    expect(out).toBe('rc=3 []');
    expect(fs.readFileSync(path.join(h.home, 'conf-stderr'), 'utf8')).toBe('');
  });

  it('NEVER SOURCED: a command substitution in a value is returned as inert text', () => {
    // This is the "it can never run a command" claim in the example file's
    // header, measured rather than promised. The file is hand-edited, so
    // sourcing it would run whatever a typo produced with ccd's privileges on
    // the supervisor tick.
    conf(`CCRC_SESSION_ACCOUNT=$(touch "${path.join(h.home, 'PWNED')}")\n`);
    expect(get('CCRC_SESSION_ACCOUNT'))
      .toBe(`rc=0 [$(touch "${path.join(h.home, 'PWNED')}")]`);
    expect(fs.existsSync(path.join(h.home, 'PWNED')), 'the value was EXECUTED').toBe(false);
  });
});

describe('_conf_bool — a yes/no preference, generously spelled', () => {
  const bool = (v: string): string => h.sh(`_conf_bool ${JSON.stringify(v)}; echo $?`);

  it.each(['on', 'ON', '1', 'yes', 'true', 'enabled'])('%s is TRUE (0)', (v) => {
    expect(bool(v)).toBe('0');
  });
  it.each(['off', 'OFF', '0', 'no', 'false', 'disabled'])('%s is FALSE (1)', (v) => {
    expect(bool(v)).toBe('1');
  });
  it.each(['', 'maybe', 'please stop', 'offf'])('%j is neither (2)', (v) => {
    // The third answer is what keeps an unrecognised word from being guessed
    // at in either direction.
    expect(bool(v)).toBe('2');
  });

  it('BOTH directions have a vocabulary, and that is not decoration', () => {
    // `_rc_enabled` accepts the single token `on` and reads everything else as
    // off, which is right for a file an INSTALLER writes. This file is
    // hand-edited, and there the strict rule fails in the one direction that
    // matters: an operator who writes `false` means to pin the box, and a
    // strict reader would leave the machine free to move their sessions while
    // the file plainly says not to.
    conf('CCRC_SESSION_AUTOSWAP=false\n');
    expect(h.sh('_conf_autoswap_pinned && echo pinned || echo free')).toBe('pinned');
  });
});

describe('_conf_autoswap_pinned — doubt is never a pin', () => {
  const pinned = (): string => h.sh('_conf_autoswap_pinned && echo pinned || echo free');

  it('no file at all: free, exactly as before this feature existed', () => {
    expect(pinned()).toBe('free');
  });
  it.each([
    ['the key absent', '# nothing\n'],
    ['the key blank', 'CCRC_SESSION_AUTOSWAP=\n'],
    ['an explicit on', 'CCRC_SESSION_AUTOSWAP=on\n'],
    ['a word nobody recognises', 'CCRC_SESSION_AUTOSWAP=sometimes\n'],
  ])('%s: free', (_l, body) => { conf(body); expect(pinned()).toBe('free'); });

  it.each(['off', 'OFF', 'no', 'false', '0', 'disabled'])('%s: pinned', (v) => {
    conf(`CCRC_SESSION_AUTOSWAP=${v}\n`);
    expect(pinned()).toBe('pinned');
  });

  it('an UNREADABLE file is free, not pinned — the fail-safe direction', () => {
    // Treating doubt as a pin means one `chmod` accident silently disables the
    // rate-limit rescue on every session on the box. Leaving the decision
    // where it already was costs a preference not taken, which is recoverable;
    // the other direction is a fleet that stops rescuing itself and says
    // nothing. The operator hears about it from `ws-add` and from each pane
    // creation, which is where the noise is allowed to go.
    conf('CCRC_SESSION_AUTOSWAP=off\n');
    fs.chmodSync(confPath(), 0o000);
    expect(pinned()).toBe('free');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// CCRC_SESSION_AUTOSWAP=off — the three places a pinned box is enforced.
// ─────────────────────────────────────────────────────────────────────────

const SID = 'claude-demo';
const PANE_PID = '4242';

/** A live-looking session on `claude`, both cooldown gates open. Same shape as
 *  `ccd-auto-swap-hold.test.ts`'s, which is the file this one's fixtures are
 *  modelled on. */
const seedSession = (): void => {
  fs.mkdirSync(path.join(h.home, 'projects', 'demo'), { recursive: true });
  h.sh(`_reg_set ${SID} uuid 11111111-1111-4111-8111-111111111111
    _reg_set ${SID} project demo
    _reg_set ${SID} workdir "$HOME/projects/demo"
    _reg_set ${SID} wrapper claude
    _reg_set ${SID} started 1`);
};

/** The AFFINITY arm: a pane at a clean prompt, idle long enough, every gate
 *  open but the one under test. */
const AFFINITY = `
  tmux() { case "\${1:-}" in
             capture-pane) printf '%s\\n' "❯ " ;;
             list-panes)   echo ${PANE_PID} ;;
           esac; return 0; };
  _swap_target() { echo claude-a; }; _avail() { return 0; };
  _dispatch_swap() { echo "dispatch $1 -> $2" >> "$HOME/ccd-calls"; };
`;

/** The RESCUE arm: a real limit banner, classified by the REAL
 *  `_pane_hard_blocked` — the classifier IS the discriminator here. */
const RESCUE = `
  tmux() { case "\${1:-}" in
             capture-pane) echo "API Error: 429 Too Many Requests" ;;
           esac; return 0; };
  _swap_target() { echo claude-a; }; _avail() { return 0; };
  _dispatch_swap() { echo "dispatch $1 -> $2" >> "$HOME/ccd-calls"; };
`;

/** The live process-status file the affinity gate reads. It lives under the
 *  CURRENT account's config dir (`_cfg_dir "$wrapper"`), so a case that moves
 *  the session to another account has to plant it there — the default is the
 *  fixture roster's `claude`. */
const idleStatus = (cfg = '.claude'): void => {
  const dir = path.join(h.home, cfg, 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${PANE_PID}.json`),
    JSON.stringify({ status: 'idle', statusUpdatedAt: 1 }));
};

const pin = (): void => { conf('CCRC_SESSION_AUTOSWAP=off\n'); };

describe('the pin at the tick — _auto_swap_check stops BOTH arms', () => {
  it('control: an UNPINNED box relocates on the affinity path', () => {
    // Asserted first and on purpose: without it every negative below is
    // vacuous — a fixture that never dispatches proves nothing about a gate.
    seedSession(); idleStatus();
    h.sh(`${AFFINITY} _auto_swap_check ${SID}`);
    expect(h.calls().join('\n')).toContain(`dispatch ${SID} -> claude-a`);
  });

  it('control: an UNPINNED box rescues a hard-blocked session', () => {
    seedSession();
    h.sh(`${RESCUE} _auto_swap_check ${SID}`);
    expect(h.calls().join('\n')).toContain(`dispatch ${SID} -> claude-a`);
  });

  it('pinned: the AFFINITY relocation does not happen', () => {
    seedSession(); idleStatus(); pin();
    h.sh(`${AFFINITY} _auto_swap_check ${SID}`);
    expect(h.calls().join('\n')).not.toContain('dispatch');
    expect(h.reg(SID, 'lastswap'), 'a withheld swap stamps nothing').toBeNull();
  });

  it('pinned: the RESCUE does not happen either — the cost the key states out loud', () => {
    // `deploy/ccrc.conf.example` says this in the operator's own words rather
    // than leaving it to be discovered: `off` disables BOTH arms, the
    // rate-limit rescue included, and a blocked session sits until a human
    // moves it. That is the trade the key exists to offer.
    seedSession(); pin();
    h.sh(`${RESCUE} _auto_swap_check ${SID}`);
    expect(h.calls().join('\n')).not.toContain('dispatch');
  });

  it('pinned AND hard-blocked: the row is MARKED STRANDED, never silently skipped', () => {
    // The mutant this kills is a bare `return 0` at the gate. A row reaching
    // that line has a real destination, so the "no destination" arm above it
    // cannot fire for it — a bare return would leave a pinned, blocked session
    // with no marker, no banner and no swap.log line. Silent is the one thing
    // it must not be: the operator is now the rescue mechanism, and they can
    // only act on what they can see.
    seedSession(); pin();
    h.sh(`${RESCUE} _auto_swap_check ${SID}`);
    const stranded = h.reg(SID, 'stranded');
    expect(stranded, 'no strand marker was written').not.toBeNull();
    expect(stranded).toContain('CCRC_SESSION_AUTOSWAP');
    expect(stranded, 'the sentence must name the verb that fixes it')
      .toContain(`ccd swap ${SID}`);
    // `<epoch> <reason>`, the shape `packedStamp` reads: it splits at the FIRST
    // space, and `_strand_mark` always writes the epoch there, so the reason
    // is carried whole whatever it starts with. Asserted as the format it is,
    // not as a constraint on the text.
    expect(stranded).toMatch(/^\d+ \S/);
  });

  it('pinned and HEALTHY: no strand marker — a pin is not a fault', () => {
    seedSession(); idleStatus(); pin();
    h.sh(`${AFFINITY} _auto_swap_check ${SID}`);
    expect(h.reg(SID, 'stranded')).toBeNull();
  });

  it("an account the OPERATOR switched to also holds — it is not pulled back home", () => {
    // The requirement in the operator's own words: a session they moved by hand
    // stays where they put it until they move it back. That is the RETURN-HOME
    // arm, not the leave-home one, and it is a distinct mutant: a gate placed
    // only on the ceiling path would let a pinned session drift home on its
    // own, which reads to the operator as the machine overruling them.
    seedSession();
    h.sh(`_reg_set ${SID} wrapper claude-a`);   // as if they had swapped
    idleStatus('.claude-a');                    // the status file follows the account
    const RETURN_HOME = AFFINITY.replace('echo claude-a;', 'echo claude;');
    // Control first: unpinned, the tick really does pull it home.
    h.sh(`${RETURN_HOME} _auto_swap_check ${SID}`);
    expect(h.calls().join('\n')).toContain(`dispatch ${SID} -> claude`);
    fs.rmSync(path.join(h.home, 'ccd-calls'));
    h.sh(`_reg_set ${SID} lastswap 0`);   // reopen the cooldown the control stamped
    pin();
    h.sh(`${RETURN_HOME} _auto_swap_check ${SID}`);
    expect(h.calls().join('\n')).not.toContain('dispatch');
    expect(h.reg(SID, 'wrapper'), 'it was pulled back to its home account').toBe('claude-a');
  });

  it('unpinning restores the relocation without anything else changing', () => {
    seedSession(); idleStatus(); pin();
    h.sh(`${AFFINITY} _auto_swap_check ${SID}`);
    expect(h.calls().join('\n')).not.toContain('dispatch');
    fs.writeFileSync(confPath(), 'CCRC_SESSION_AUTOSWAP=on\n');
    h.sh(`${AFFINITY} _auto_swap_check ${SID}`);
    expect(h.calls().join('\n')).toContain(`dispatch ${SID} -> claude-a`);
  });
});

describe('the backstop in the funnel — _dispatch_swap', () => {
  // Unreachable on today's code, because the tick's gate returns above both of
  // this function's call sites. It exists because this function is the one
  // mechanism in ccd that starts a swap with no human, and a third automatic
  // caller added later would otherwise walk straight past the preference.
  const DISPATCH_STUBS = `_svc_run_detached() { echo "detached $*" >> "$HOME/ccd-calls"; };`;

  it('control: unpinned, it dispatches', () => {
    h.sh(`${DISPATCH_STUBS} _dispatch_swap ${SID} claude-a`);
    expect(h.calls().join('\n')).toContain('detached');
  });

  it('pinned, it withholds and SAYS SO in swap.log', () => {
    pin();
    h.sh(`${DISPATCH_STUBS} _dispatch_swap ${SID} claude-a`);
    expect(h.calls().join('\n')).not.toContain('detached');
    const log = fs.readFileSync(path.join(h.home, '.cc-sessions', 'swap.log'), 'utf8');
    expect(log).toContain(`dispatch WITHHELD ${SID} -> claude-a`);
    expect(log).toContain('CCRC_SESSION_AUTOSWAP');
  });
});

describe('the deploy-window refusal — cmd_swap and CCD_SWAP_AUTO', () => {
  // `ccd` lands on the fleet host while every supervisor is live and still
  // running its PRE-DEPLOY inode. That supervisor has no pin in it and goes on
  // dispatching; its dispatch arrives HERE, at the on-disk cmd_swap. This is
  // the line that makes the preference true the moment ccd lands rather than
  // at the next supervisor sweep.
  const SWAP_STUBS = 'systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; }; '
    + 'launchctl() { echo "launchctl $*" >> "$HOME/ccd-calls"; }; '
    + 'tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; }; sleep() { :; };';

  const SWAP_UUID = '22222222-2222-4222-8222-222222222222';

  /** A row `cmd_swap` can actually carry: the registry fields AND a transcript
   *  under the source account's config dir. Without the transcript the verb
   *  refuses long after this file's guard with "no transcript found", and the
   *  CONTROL case below would pass for the wrong reason. */
  const seedSwap = (): void => {
    const wd = path.join(h.home, 'projects', 'demo');
    fs.mkdirSync(wd, { recursive: true });
    h.sh(`_reg_set ${SID} uuid ${SWAP_UUID}
      _reg_set ${SID} wrapper claude
      _reg_set ${SID} project demo
      _reg_set ${SID} workdir ${wd}`);
    const mdir = fs.realpathSync(wd).replace(/[/._]/g, '-');
    const dir = path.join(h.home, '.claude', 'projects', mdir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${SWAP_UUID}.jsonl`),
      '{"message":{"content":[{"type":"text","text":""}]}}');
  };

  it('an AUTOMATIC swap into a pinned box is refused and marked', () => {
    seedSwap(); pin();
    // A SUBSHELL, because `die` is `exit` and not `return`: an `|| true` after
    // it never runs, and the snippet's own shell would take the exit status.
    const out = h.sh(`( ${SWAP_STUBS} cmd_swap ${SID} claude-a ) 2>&1 || true`,
      { TMUX: '', CCD_SWAP_AUTO: '1' });
    expect(out).toContain('automatic account switching is off');
    expect(h.reg(SID, 'wrapper'), 'the session was moved anyway').toBe('claude');
    expect(h.reg(SID, 'stranded')).toContain('CCRC_SESSION_AUTOSWAP');
  });

  it("THE OPERATOR'S OWN swap is untouched — that is the whole contract", () => {
    // No `CCD_SWAP_AUTO`, so this is a human (or the PWA, which reaches this
    // same function). The machine stops moving sessions; the operator does not.
    seedSwap(); pin();
    h.sh(`${SWAP_STUBS} cmd_swap ${SID} claude-a 2>&1 || true`, { TMUX: '' });
    expect(h.reg(SID, 'wrapper'), 'a pinned box refused its own operator').toBe('claude-a');
  });

  it('control: an automatic swap into an UNPINNED box still lands', () => {
    seedSwap();
    h.sh(`${SWAP_STUBS} cmd_swap ${SID} claude-a 2>&1 || true`,
      { TMUX: '', CCD_SWAP_AUTO: '1' });
    expect(h.reg(SID, 'wrapper')).toBe('claude-a');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// CCRC_SESSION_ACCOUNT — the account a NEW session is born on.
// ─────────────────────────────────────────────────────────────────────────

/** `cmd_ws_add`'s failure-tolerant runner: the verb `die`s on some inputs and
 *  `h.sh` throws on a non-zero exit, so stderr has to be recovered. */
const shFail = (snippet: string): { code: number; stderr: string; stdout: string } => {
  try { return { code: 0, stderr: '', stdout: h.sh(snippet) }; }
  catch (e) {
    const err = e as { status?: number; stderr?: Buffer; stdout?: Buffer };
    return { code: err.status ?? 1, stderr: String(err.stderr ?? ''), stdout: String(err.stdout ?? '') };
  }
};

/** `ws-add`, with stderr captured to a FILE rather than left to the parent.
 *  `h.sh` returns stdout and hands stderr straight through, so on a SUCCESSFUL
 *  run — which is every warn-and-fall-back case here — there is no other way
 *  to read the warning the operator is meant to see. */
const addWorkspace = (): { code: number; stderr: string; stdout: string } => {
  const errFile = path.join(h.home, 'ws-add-stderr');
  const r = shFail(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo 2>"${errFile}"`);
  const captured = fs.existsSync(errFile) ? fs.readFileSync(errFile, 'utf8') : '';
  return { ...r, stderr: r.stderr + captured };
};

/** The id `ws-add` mints for `demo`/`quiet-mesa`. */
const WS_ID = 'demo-quiet-mesa';

const disable = (w: string): void =>
  fs.writeFileSync(path.join(h.home, '.cc-sessions', `${w}-disabled`), '');

describe('CCRC_SESSION_ACCOUNT — a birth-only preference', () => {
  it('control: with no preference, placement is whatever it always was', () => {
    h.makeRepo('demo');
    expect(addWorkspace().code).toBe(0);
    // The automatic pick with a fixture roster and no telemetry is the first
    // home-able lane. The point of this case is only that it is NOT the
    // account the tests below ask for, so those cannot pass vacuously.
    expect(h.reg(WS_ID, 'wrapper')).toBe('claude');
  });

  it('places a new session on the named account, and seeds `home` to it', () => {
    h.makeRepo('demo');
    conf('CCRC_SESSION_ACCOUNT=claude-a\n');
    expect(addWorkspace().code).toBe(0);
    expect(h.reg(WS_ID, 'wrapper')).toBe('claude-a');
    // `_ws_seed_home` runs on the same `$hw`, so the session also RETURNS to
    // the operator's account rather than to the one the machine would have
    // picked — which is what makes the preference hold across a swap back.
    expect(h.reg(WS_ID, 'home')).toBe('claude-a');
  });

  it('AFTER the re-pick, not before — the fetch-window re-measurement cannot undo it', () => {
    // `cmd_ws_add` chooses an account twice, and the second choice happens
    // after `git fetch`/`git worktree add`. A preference honoured at the first
    // pick would be silently overwritten by the second. This case is what
    // makes that placement a mechanism rather than a comment: the account
    // asked for here is NOT the one the automatic pick produces (proved by the
    // control above), so it can only survive if it was applied last.
    h.makeRepo('demo');
    conf('CCRC_SESSION_ACCOUNT=claude-d\n');
    expect(addWorkspace().code).toBe(0);
    expect(h.reg(WS_ID, 'wrapper')).toBe('claude-d');
  });

  it.each([
    ['an id that is not in the roster', 'claude-nope', 'not in this box'],
    ['an account whose lane is switched off', 'claude-a', 'switched off'],
    ['an account sessions are never placed on', 'gpt', 'not an account sessions are placed on'],
  ])('warns and falls back on %s', (_label, id, fragment) => {
    // WARNS AND FALLS BACK; NEVER REFUSES. `ws-add` is the verb the PWA
    // creates every session with, so a preferences file able to `die` here
    // would let one stale account id stop session creation on the whole box —
    // the opposite of what an operator reaching for predictability asked for.
    h.makeRepo('demo');
    if (id === 'claude-a') disable('claude-a');
    // `gpt` IS in the fixture roster and the harness deliberately installs no
    // wrapper for it — an overflow lane nobody installed is the ordinary state
    // of a box. Installing one here is what makes this case test the gate it
    // names: without it `_account_ok` refuses first and `_is_home_able` could
    // be deleted with this file still green.
    if (id === 'gpt') {
      const w = path.join(h.home, '.local', 'bin', 'gpt');
      fs.writeFileSync(w, '#!/bin/sh\nexit 0\n'); fs.chmodSync(w, 0o755);
    }
    conf(`CCRC_SESSION_ACCOUNT=${id}\n`);
    const r = addWorkspace();
    expect(r.code, 'a bad preference must not stop session creation').toBe(0);
    expect(h.reg(WS_ID, 'wrapper')).toBe('claude');
    expect(r.stderr).toContain('CCRC_SESSION_ACCOUNT');
    expect(r.stderr).toContain(fragment);
  });

  it('an existing session is never moved by this key — it decides births only', () => {
    h.makeRepo('demo');
    expect(addWorkspace().code).toBe(0);
    expect(h.reg(WS_ID, 'wrapper')).toBe('claude');
    conf('CCRC_SESSION_ACCOUNT=claude-a\n');
    // The tick is the only thing that reads a running row, and it moves
    // nothing on account of this key.
    idleStatus();
    h.sh(`${AFFINITY} _auto_swap_check ${WS_ID}`);
    expect(h.reg(WS_ID, 'wrapper')).toBe('claude');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// CCRC_SESSION_EFFORT — typed once, at birth, and then left alone.
// ─────────────────────────────────────────────────────────────────────────

const EFFORT_STUBS = `sleep() { :; };
  tmux() { echo "tmux $*" >> "$HOME/ccd-calls";
    case "\${1:-}" in capture-pane) printf '%s\\n' "? for shortcuts\\n❯ " ;; esac; return 0; };
  _pane_box_draft() { printf '%s' ""; };`;

const inject = (id = SID): string =>
  h.sh(`${EFFORT_STUBS} _inject_spawn_effort cc-test ${id}; echo "rc=$?"`);

const typed = (): string[] => h.calls().filter((l) => l.includes('-l /effort'));

describe('CCRC_SESSION_EFFORT — the level, and the end of the retyping', () => {
  it('control: with no preference, the build default is typed on EVERY pane creation', () => {
    // This is today's behaviour and the reason the key is worth having. ccd
    // never reads the level already set, so a level chosen by hand is reverted
    // the next time anything restarts the pane — a supervisor revival, a swap
    // landing, a restart after a refused swap.
    inject(); inject();
    expect(typed()).toEqual(['tmux send-keys -t cc-test -l /effort ultracode',
                             'tmux send-keys -t cc-test -l /effort ultracode']);
    expect(h.reg(SID, 'effortset'), 'nothing is recorded without the key').toBeNull();
  });

  it('types the operator level ONCE and records it', () => {
    conf('CCRC_SESSION_EFFORT=high\n');
    expect(inject()).toContain('rc=0');
    expect(typed()).toEqual(['tmux send-keys -t cc-test -l /effort high']);
    expect(h.reg(SID, 'effortset')).toMatch(/^\d+ high$/);
  });

  it('and does NOT type it again on the next pane creation', () => {
    conf('CCRC_SESSION_EFFORT=high\n');
    inject();
    expect(inject(), 'a skip must report that it typed nothing').toContain('rc=1');
    expect(typed()).toHaveLength(1);
  });

  it('types again, once, when the operator CHANGES the level', () => {
    // The comparison is against the RECORDED level rather than mere presence,
    // so editing the key takes effect on the next pane creation instead of
    // requiring the operator to know a marker exists and delete it.
    conf('CCRC_SESSION_EFFORT=high\n');
    inject();
    conf('CCRC_SESSION_EFFORT=xhigh\n');
    inject(); inject();
    expect(typed()).toEqual(['tmux send-keys -t cc-test -l /effort high',
                             'tmux send-keys -t cc-test -l /effort xhigh']);
    expect(h.reg(SID, 'effortset')).toMatch(/^\d+ xhigh$/);
  });

  it('a SKIPPED injection records nothing, so the level is still typed later', () => {
    // The guards fire on exactly the panes most likely to be revivals — one
    // waiting out a limit, one restored with a draft in the box. Stamping at
    // the call site, or on any exit but the one that actually sent the
    // keystrokes, would record a lie about precisely those.
    conf('CCRC_SESSION_EFFORT=high\n');
    const ARMED_PANE = `sleep() { :; };
      tmux() { echo "tmux $*" >> "$HOME/ccd-calls";
        case "\${1:-}" in capture-pane) echo "Usage limit reached · continuing automatically at 11:50am" ;; esac; return 0; };
      _pane_box_draft() { printf '%s' ""; };`;
    expect(h.sh(`${ARMED_PANE} _inject_spawn_effort cc-test ${SID}; echo "rc=$?"`))
      .toContain('rc=1');
    expect(typed()).toEqual([]);
    expect(h.reg(SID, 'effortset'), 'a skip recorded a level it never typed').toBeNull();
    expect(inject()).toContain('rc=0');
    expect(typed()).toEqual(['tmux send-keys -t cc-test -l /effort high']);
  });

  it('refuses a value that is not a single bare word, and says why', () => {
    // The value is typed LITERALLY into a live pane and then submitted. A
    // value carrying a newline would submit whatever followed it as a second
    // line of input to a running session; one carrying a space would send the
    // remainder as an argument nobody wrote. This is also what makes the
    // un-stripped trailing comment loud rather than silently wrong.
    conf('CCRC_SESSION_EFFORT=high  # my choice\n');
    const out = h.sh(`${EFFORT_STUBS} _inject_spawn_effort cc-test ${SID} 2>"$HOME/eff-stderr"; echo "rc=$?"`);
    expect(out).toContain('rc=0');
    expect(typed(), 'the build default stands in').toEqual(
      ['tmux send-keys -t cc-test -l /effort ultracode']);
    const err = fs.readFileSync(path.join(h.home, 'eff-stderr'), 'utf8');
    expect(err).toContain('CCRC_SESSION_EFFORT');
    expect(err).toContain('not a single bare word');
  });

  it('a newline in the value can never reach the pane', () => {
    conf('CCRC_SESSION_EFFORT=high\\nrm -rf /\n');
    h.sh(`${EFFORT_STUBS} _inject_spawn_effort cc-test ${SID} 2>/dev/null`);
    expect(typed().join('\n')).not.toContain('rm -rf');
  });
});

describe('CCRC_SESSION_ACCOUNT and the pool — the pool stays absolute', () => {
  // A standing box-level preference is a WEAKER claim than a pool tag, and the
  // file already treats it that way one rung over: `_swap_target` refuses to
  // return a session to a wrong-pool home, and the automatic rotation never
  // crosses, marker or no marker. `ws-add` also has no `--cross-pool` to offer
  // as the declared override that `start`, `swap` and `prefer` all carry — so
  // "refuse and point at the flag" is not a shape available at this verb.
  beforeEach(() => { seedAccountsSh(h.home, POOLED_TEST_ROSTER); });

  const tag = (project: string, bytes: string): void => {
    const dir = path.join(h.home, '.cc-sessions', 'pools');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, project), bytes);
  };

  it('control: in-pool, the preference is honoured', () => {
    h.makeRepo('demo');
    tag('demo', 'pool-b');
    conf('CCRC_SESSION_ACCOUNT=claude-b\n');
    expect(addWorkspace().code).toBe(0);
    expect(h.reg(WS_ID, 'wrapper')).toBe('claude-b');
  });

  it('a wrong-pool preference warns and falls back to the pool-legal choice', () => {
    h.makeRepo('demo');
    tag('demo', 'pool-b');
    conf('CCRC_SESSION_ACCOUNT=claude-a\n');   // pool-a
    const r = addWorkspace();
    expect(r.code).toBe(0);
    expect(h.reg(WS_ID, 'wrapper')).toBe('claude-b');
    expect(r.stderr).toContain("'claude-a' is in pool 'pool-a'");
    expect(r.stderr).toContain("project 'demo' is in pool 'pool-b'");
  });

  it('an UNREADABLE tag refuses the whole verb, and the preference cannot lift it', () => {
    // `_project_pool_state` keeps `unreadable`/`malformed` distinct from
    // `untagged` precisely so a chmod cannot quietly make a project
    // unconstrained. `ws-add` acts on that first: `_ws_least_loaded` skips
    // every account under an undecidable tag and the verb refuses, so the
    // preference is never even consulted here. Asserted as it actually
    // behaves — the point is that a preferences file cannot turn a refusal
    // into a placement.
    h.makeRepo('demo');
    tag('demo', 'pool-b');
    fs.chmodSync(path.join(h.home, '.cc-sessions', 'pools', 'demo'), 0o000);
    conf('CCRC_SESSION_ACCOUNT=claude-b\n');
    const r = addWorkspace();
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('tag:unreadable');
    expect(h.reg(WS_ID, 'wrapper'), 'a session was created anyway').toBeNull();
  });

  it('the accessor itself refuses under an undecidable tag — belt and braces', () => {
    // Unreachable from `ws-add` today (the case above refuses first), and kept
    // anyway: the accessor must not be the thing that lifts a pool constraint
    // if it ever gains a second caller. Driven directly, which is the only way
    // to reach the arm at all.
    tag('demo', 'pool-b');
    fs.chmodSync(path.join(h.home, '.cc-sessions', 'pools', 'demo'), 0o000);
    conf('CCRC_SESSION_ACCOUNT=claude-b\n');
    const out = h.sh('_conf_session_account demo; printf "[%s] %s" "$CONF_ACCOUNT" "$CONF_ACCOUNT_WHY"');
    expect(out).toContain('[]');
    expect(out).toMatch(/pool tag for project 'demo' is (unreadable|malformed)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// The mutants a first cut of this suite let through. Each case below names
// the specific change to ccd/ccd it is here to turn red.
// ─────────────────────────────────────────────────────────────────────────

describe('an unreadable preferences file is SAID, not just survived', () => {
  // `_conf_get` returns rc 3 for "the file exists and could not be read", and
  // the reader's header promises every caller says so. The first cut returned
  // silently at both loud call sites, which made the promise false and left an
  // operator whose file lost its permissions with the machine quietly deciding
  // again. The mutation these kill: dropping the `-ne 3` arm from either
  // accessor.
  const unreadable = (body: string): void => { conf(body); fs.chmodSync(confPath(), 0o000); };

  it('ws-add names the file', () => {
    h.makeRepo('demo');
    unreadable('CCRC_SESSION_ACCOUNT=claude-a\n');
    const r = addWorkspace();
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('could not be read');
    expect(r.stderr).toContain('ccrc.conf');
  });

  it('the effort injection names the file', () => {
    unreadable('CCRC_SESSION_EFFORT=high\n');
    h.sh(`${EFFORT_STUBS} _inject_spawn_effort cc-test ${SID} 2>"$HOME/eff-stderr"`);
    expect(fs.readFileSync(path.join(h.home, 'eff-stderr'), 'utf8')).toContain('could not be read');
    expect(typed(), 'the build default stands in').toHaveLength(1);
  });
});

describe('a value the build cannot read as yes or no is not silently ignored', () => {
  // THE FAILURE THIS KEY EXISTS TO PREVENT, arriving through the key itself.
  // `CCRC_SESSION_AUTOSWAP` is read only by the supervise tick, which may not
  // print — so before this, an operator who wrote `off  # pin this box` got a
  // box that went on switching accounts with nothing said anywhere. The
  // trailing comment is not stripped (deliberately, see `_conf_get`), so this
  // is the likeliest way to land there, not a contrived one.
  it('a trailing comment does NOT pin, and ws-add says so', () => {
    h.makeRepo('demo');
    conf('CCRC_SESSION_AUTOSWAP=off   # pin this box\n');
    expect(h.sh('_conf_autoswap_pinned && echo pinned || echo free')).toBe('free');
    const r = addWorkspace();
    expect(r.stderr).toContain('CCRC_SESSION_AUTOSWAP');
    expect(r.stderr).toContain('is not a yes/no word');
    expect(r.stderr, 'the message must name the fix').toContain("just 'off'");
  });

  it('a recognised value says nothing at all — the warning is for confusion, not for use', () => {
    h.makeRepo('demo');
    conf('CCRC_SESSION_AUTOSWAP=off\n');
    expect(addWorkspace().stderr).not.toContain('CCRC_SESSION_AUTOSWAP');
  });

  it('and neither does a box with no file', () => {
    h.makeRepo('demo');
    expect(addWorkspace().stderr).not.toContain('CCRC_SESSION_AUTOSWAP');
  });
});

describe('the effort shape gate, isolated', () => {
  it('a bare space is enough to refuse the value', () => {
    // The earlier fixtures carried `#` and `\` as well, so widening
    // CONF_EFFORT_RE to admit a space left the suite green. This one carries
    // nothing but the space, which is the character the gate's own comment
    // names: `/effort high please` would send `please` as an argument nobody
    // wrote.
    conf('CCRC_SESSION_EFFORT=high please\n');
    h.sh(`${EFFORT_STUBS} _inject_spawn_effort cc-test ${SID} 2>"$HOME/eff-stderr"`);
    expect(typed()).toEqual(['tmux send-keys -t cc-test -l /effort ultracode']);
    expect(fs.readFileSync(path.join(h.home, 'eff-stderr'), 'utf8'))
      .toContain('not a single bare word');
  });

  it('a slash is refused too — the value reaches the pane literally', () => {
    conf('CCRC_SESSION_EFFORT=high/../x\n');
    h.sh(`${EFFORT_STUBS} _inject_spawn_effort cc-test ${SID} 2>/dev/null`);
    expect(typed().join('\n')).not.toContain('high/');
  });
});

describe('the effort marker is written only where something was typed', () => {
  it('a DRAFT in the input box skips, reports the skip, and records nothing', () => {
    // The second of the two guards. Only the armed-pane guard was driven
    // before, so re-flattening this exit to `return 0` left the suite green.
    conf('CCRC_SESSION_EFFORT=high\n');
    const DRAFT_PANE = `sleep() { :; };
      tmux() { echo "tmux $*" >> "$HOME/ccd-calls";
        case "\${1:-}" in capture-pane) printf '%s\\n' "? for shortcuts\\n❯ " ;; esac; return 0; };
      _pane_box_draft() { printf '%s' "half a sentence"; };`;
    expect(h.sh(`${DRAFT_PANE} _inject_spawn_effort cc-test ${SID}; echo "rc=$?"`))
      .toContain('rc=1');
    expect(typed()).toEqual([]);
    expect(h.reg(SID, 'effortset')).toBeNull();
  });

  it('WITHOUT an id nothing is recorded, whatever the file says', () => {
    // `_reg_set "" effortset …` would write `$REG/.effortset` — a dot-leading
    // name no registry glob sweeps and no session owns. The conjunct that
    // prevents it has no other test: every other case here passes an id.
    conf('CCRC_SESSION_EFFORT=high\n');
    h.sh(`${EFFORT_STUBS} _inject_spawn_effort cc-test`);
    expect(typed()).toEqual(['tmux send-keys -t cc-test -l /effort high']);
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', '.effortset')),
      'an id-less call wrote a marker nothing owns').toBe(false);
  });
});

describe('what the pinned box writes to swap.log, and what it must not', () => {
  const swapLog = (): string => {
    const f = path.join(h.home, '.cc-sessions', 'swap.log');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  };

  it('the backstop withholds BEFORE claiming a dispatch', () => {
    // Moving the backstop below the "dispatch … (in Ns)" line would make
    // swap.log say both things about one attempt — a forensic trail that
    // contradicts itself on every tick.
    pin();
    h.sh(`_svc_run_detached() { echo "detached $*" >> "$HOME/ccd-calls"; }; _dispatch_swap ${SID} claude-a`);
    expect(swapLog()).toContain('dispatch WITHHELD');
    expect(swapLog(), 'swap.log claims a dispatch it withheld').not.toMatch(/dispatch \S+ -> \S+ \(in/);
  });

  it('a pinned, blocked row does not churn stranded/unstranded every tick', () => {
    // THE GATE'S PLACEMENT, which nothing else pins. Below `_strand_clear`
    // instead of above it, each tick would clear the marker and re-write it:
    // two swap.log lines every five seconds, forever, in the file that exists
    // to be read by a human beside every swap decision.
    seedSession(); pin();
    h.sh(`${RESCUE} _auto_swap_check ${SID}`);
    h.sh(`${RESCUE} _auto_swap_check ${SID}`);
    h.sh(`${RESCUE} _auto_swap_check ${SID}`);
    expect(swapLog(), 'the strand is being cleared and re-marked every tick')
      .not.toContain('unstranded');
    expect(swapLog().split('\n').filter((l) => l.includes('stranded')),
      'one strand episode must log once, not once per tick').toHaveLength(1);
  });
});

describe('the effort marker dies with the conversation it described', () => {
  // THE HOLE THE REVIEW FOUND. `--resume <uuid>` can leave no session — the
  // transcript is gone — and `_spawn_start` retries once with `--session-id`,
  // which starts a BRAND-NEW Claude Code session in the same registry row. A
  // new session is at the build's default level, so a marker saying "this
  // session already has the operator's level" is now false about a session
  // that no longer exists. Left in place it silences CCRC_SESSION_EFFORT for
  // the life of the row — the key would work once and then quietly stop.
  //
  // The substrate: a tmux whose `--resume` new-session leaves no pane and
  // whose `--session-id` one does, which is `ccd-spawn-split.test.ts`'s own
  // RESUME_DIES fixture.
  const RESUME_DIES = `sleep() { :; };
    tmux() {
      echo "tmux $*" >> "$HOME/ccd-calls"
      case "$1" in
        new-session)  case "$*" in *--session-id*) : > "$HOME/pane-up" ;; esac ;;
        has-session)  [[ -e "$HOME/pane-up" ]] ;;
        list-sessions) return 0 ;;
      esac
    };`;

  const seedRow = (): void => {
    h.sh(`_reg_set ${SID} wrapper claude
          _reg_set ${SID} workdir '${h.home}'
          _reg_set ${SID} uuid deadbeef-0000-4000-8000-000000000000`);
  };

  it('a resume that had to start a NEW session clears it', () => {
    conf('CCRC_SESSION_EFFORT=high\n');
    seedRow();
    h.sh(`_reg_set ${SID} effortset "1700000000 high"`);
    expect(h.reg(SID, 'effortset'), 'the fixture did not take').toBe('1700000000 high');
    h.sh(`${RESUME_DIES} rm -f "$HOME/pane-up"; _spawn_start ${SID} resume`);
    // Both spawn lines really happened — otherwise this proves nothing.
    expect(h.calls().filter((c) => c.startsWith('tmux new-session'))).toHaveLength(2);
    expect(h.reg(SID, 'effortset'),
      'the marker outlived the conversation it described').toBeNull();
  });

  it('an ordinary resume that DID come back leaves the marker alone', () => {
    // The control: a session that really resumed is the same conversation, and
    // its level is whatever it was switched to. Re-typing there is the thing
    // this key exists to stop.
    const TMUX = `sleep() { :; };
      tmux() {
        echo "tmux $*" >> "$HOME/ccd-calls"
        case "$1" in
          new-session)  : > "$HOME/pane-up" ;;
          has-session)  [[ -e "$HOME/pane-up" ]] ;;
          list-sessions) return 0 ;;
        esac
      };`;
    conf('CCRC_SESSION_EFFORT=high\n');
    seedRow();
    h.sh(`_reg_set ${SID} effortset "1700000000 high"`);
    h.sh(`${TMUX} rm -f "$HOME/pane-up"; _spawn_start ${SID} resume`);
    expect(h.reg(SID, 'effortset')).toBe('1700000000 high');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// The TEMPLATE, which is shipped to boxes and is therefore part of the code.
// ─────────────────────────────────────────────────────────────────────────
describe('deploy/ccrc.conf.example — the shape a deploy can carry safely', () => {
  const EXAMPLE = path.resolve(__dirname, '..', '..', 'deploy', 'ccrc.conf.example');
  const text = (): string => fs.readFileSync(EXAMPLE, 'utf8');

  it('every key is COMMENTED OUT — an unedited copy must take nothing away', () => {
    // THE PROPERTY THE DEPLOY LANE DEPENDS ON. `env_drop_guard` refuses a
    // shipment that would drop a key the box currently sets, and it decides
    // that by which key NAMES appear. A commented line names nothing, so
    // copying this template and shipping it un-sets nothing and the guard
    // still speaks up if it would. A bare `KEY=` is the dangerous shape: this
    // file's reader calls it "no preference" while the guard calls the name
    // still-set, and a preference leaves the box with nobody saying a word.
    // Uncommenting a key here — to make the template "ready to fill in" —
    // silently restores that, which is why it is a test and not a convention.
    const live = text().split('\n').filter((l) => /^\s*[A-Za-z_][A-Za-z0-9_]*=/.test(l));
    expect(live, `these lines set a key in the shipped template:\n${live.join('\n')}`).toEqual([]);
  });

  it('documents exactly the keys ccd reads — in both directions', () => {
    // A key ccd reads and the template never mentions is undiscoverable; a key
    // the template offers and ccd never reads is a promise the box does not
    // keep. Both are the kind of drift a comment cannot hold.
    const documented = [...text().matchAll(/^#(CCRC_[A-Z0-9_]+)=/gm)].map((m) => m[1]).sort();
    // `CCD` from the harness, never a second spelling of the path: this repo
    // pins that to one file and `single-definition.test.ts` says so.
    const ccdSrc = fs.readFileSync(CCD, 'utf8');
    const read = [...new Set(
      ccdSrc.split('\n')
        .filter((l) => !/^\s*#/.test(l))
        .flatMap((l) => [...l.matchAll(/_conf_get (CCRC_[A-Z0-9_]+)/g)].map((m) => m[1])),
    )].sort();
    expect(documented).toEqual(read);
  });

  it('says that absence is not a value, in its own words', () => {
    // The one sentence the whole feature rests on. If it ever stops being
    // true, this file is where an operator would have been told.
    expect(text()).toContain('ABSENCE IS NOT A VALUE');
  });
});

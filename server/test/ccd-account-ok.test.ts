// _account_ok generalizes the gpt-only kill-switch (`_gpt_enabled`) to every
// wrapper: a lane is a legal AUTOMATIC destination iff its wrapper binary is
// executable AND its <w>-disabled marker is absent. Manual verbs (start/swap/
// prefer) deliberately bypass this — a named wrapper is an operator override
// by construction, not a rotation candidate. This file also pins the two
// placement rules that consume it (_ws_least_loaded, _swap_target) and the
// re-expressed _gpt_enabled, which must keep exactly its old behavior.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, CCD, WS_ADD, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
let home: string;

const sh = (s: string, env: NodeJS.ProcessEnv = {}): string => h.sh(s, env);
const ok = (snippet: string): boolean => sh(`${snippet} && echo yes || echo no`) === 'yes';
const reg = (id: string, field: string): string | null => h.reg(id, field);
const makeRepo = (name: string): string => h.makeRepo(name);

const writeLimits = (w: string, five: number, seven: number): void =>
  fs.writeFileSync(path.join(home, '.cc-limits', `${w}.json`),
    JSON.stringify({ five, seven, ts: Math.floor(Date.now() / 1000) }));

const disable = (w: string): void =>
  fs.writeFileSync(path.join(home, '.cc-sessions', `${w}-disabled`), '');

beforeEach(() => { h = makeCcdHarness('ccrc-ccd-account-ok-'); home = h.home; });
afterEach(() => { h.cleanup(); });

describe('_account_ok', () => {
  it('succeeds in a fresh harness (stub binary present, no marker)', () => {
    expect(ok('_account_ok claude')).toBe(true);
  });

  it('fails once the lane is disabled, and recovers when the marker is removed', () => {
    const marker = path.join(home, '.cc-sessions', 'claude-disabled');
    fs.writeFileSync(marker, '');
    expect(ok('_account_ok claude')).toBe(false);
    fs.rmSync(marker);
    expect(ok('_account_ok claude')).toBe(true);
  });

  it('fails when the wrapper is not executable', () => {
    fs.chmodSync(path.join(home, '.local', 'bin', 'claude-a'), 0o644);
    expect(ok('_account_ok claude-a')).toBe(false);
  });
});

describe('_ws_least_loaded skips excluded lanes', () => {
  it('skips disabled lanes even when their score is best', () => {
    writeLimits('claude', 90, 90);       // worst score, but the only enabled lane
    writeLimits('claude-a', 5, 5);
    writeLimits('claude-b', 5, 5);
    writeLimits('claude-d', 5, 5);
    disable('claude-a');
    disable('claude-b');
    disable('claude-d');
    expect(sh('_ws_least_loaded')).toBe('claude');
  });

  it('skips a lane with no executable', () => {
    writeLimits('claude', 50, 50);
    writeLimits('claude-a', 5, 5);        // best score, but no executable
    writeLimits('claude-b', 40, 40);
    writeLimits('claude-d', 60, 60);
    fs.rmSync(path.join(home, '.local', 'bin', 'claude-a'));
    expect(sh('_ws_least_loaded')).toBe('claude-b');
  });
});

describe('_swap_target: disabled excludes a lane as a DESTINATION, never evacuates a session already there', () => {
  it('cur==home, home disabled but under the rate ceiling -> stays (empty stdout)', () => {
    // Spec rule, verbatim: "disabled excludes a lane as a destination; it
    // never evacuates a session already there." The cur==home branch
    // (ccd/ccd ~6406-6407) is `_avail "$home" && return 0` — deliberately no
    // `_account_ok` check. A future edit that hoisted `_account_ok` above
    // that `_avail` would evacuate every session off a lane the operator
    // only meant to stop RECEIVING new work; today this stays green.
    writeLimits('claude', 5, 5);   // well under SWAP_CEILING
    disable('claude');
    expect(sh('_swap_target claude-demo claude claude')).toBe('');
  });

  it('registry home disabled, current wrapper fine -> stays put (empty stdout)', () => {
    // cur (claude-a) and home (claude) differ; claude carries no telemetry so
    // the OLD `_avail "$home"` alone would call it free and route back onto it.
    disable('claude');
    expect(sh('_swap_target claude-demo claude-a claude')).toBe('');
  });

  it('the must-leave candidate loop skips a disabled lane even at the best score', () => {
    writeLimits('claude', 99, 99);       // cur==home, over SWAP_CEILING: must leave
    writeLimits('claude-b', 5, 5);    // best score, but disabled
    writeLimits('claude-a', 50, 50);      // worse score, the only eligible candidate
    writeLimits('claude-d', 60, 60);  // worse still, so claude-a remains the pick
    disable('claude-b');
    expect(sh('_swap_target claude-demo claude claude')).toBe('claude-a');
  });

  it('the must-leave candidate loop ranks an UNMEASURED candidate last, not first', () => {
    // The magnet Task 6 removed from `_ws_least_loaded`, in the place it
    // survived until review round 1: `: "${sc:=0}"` scored an account that has
    // never reported as 0 — better than every account that honestly said how
    // loaded it was — and since it never reports, it went on winning every
    // rescue forever. `: "${sc:=100}"` is exact: `_avail` has already rejected
    // everything at or above SWAP_CEILING (98), so a measured candidate that
    // reaches the ranking line always outranks an unmeasured one.
    writeLimits('claude', 99, 99);       // cur==home, over SWAP_CEILING: must leave
    writeLimits('claude-a', 50, 50);      // measured, and the worst measured score here
    writeLimits('claude-d', 60, 60);  // measured, worse still
    // claude-b: NO limits file at all. Wholly unmeasured, and the old
    // `:=0` made it the pick.
    expect(sh('_swap_target claude-demo claude claude')).toBe('claude-a');
  });

  it('...but an unmeasured candidate stays ELIGIBLE when it is all there is', () => {
    // Ranking last must not become skipping: this loop is the escape route,
    // and `_ws_least_loaded`'s "skip it" is only affordable because placement
    // has an all-unmeasured fallback. A rescue that answered "" here would
    // strand the session on the account it cannot stay on.
    writeLimits('claude', 99, 99);   // cur==home, over the ceiling: must leave
    // claude-a / claude-b / claude-d: no telemetry whatsoever.
    // First in roster declaration order wins the 100-way tie, same tie-break
    // as _ws_least_loaded and projectHome.
    expect(sh('_swap_target claude-demo claude claude')).toBe('claude-a');
  });

  it('the must-leave candidate loop still skips a candidate over the rate ceiling', () => {
    // _account_ok gates existence+enablement only; it must not swallow the
    // pre-existing pressure gate (_avail) the loop already had.
    writeLimits('claude', 99, 99);       // cur==home, over SWAP_CEILING: must leave
    writeLimits('claude-a', 99, 99);      // account_ok is fine, but also over the ceiling
    writeLimits('claude-d', 99, 99);  // likewise over the ceiling, so no lane qualifies
    disable('claude-b');              // excluded a different way, to isolate the avail check
    // No candidate qualifies, so the function's own exit code is non-zero
    // (the trailing `[[ -n "$best" ]] && echo` never runs) — `|| true` is the
    // house idiom for capturing that empty stdout without throwing.
    expect(sh('_swap_target claude-demo claude claude || true')).toBe('');
  });
});

describe('_gpt_enabled re-expressed as _account_ok gpt', () => {
  it('fails when the gpt wrapper is not installed (harness never installs it)', () => {
    expect(ok('_gpt_enabled')).toBe(false);
  });

  it('still honors $REG/gpt-disabled once the wrapper exists', () => {
    fs.writeFileSync(path.join(home, '.local', 'bin', 'gpt'), '#!/bin/sh\n', { mode: 0o755 });
    expect(ok('_gpt_enabled')).toBe(true);
    disable('gpt');
    expect(ok('_gpt_enabled')).toBe(false);
  });
});

// cmd_ws_add hoists the account pick into its preflight, beside the disk
// floor: _ws_least_loaded is pure reads, so it is safe to run before anything
// is created. All-excluded must refuse before the worktree/branch/registry
// exist — the same "leave the box exactly as it found it" contract the disk
// floor already keeps (ccd-workspaces.test.ts's disk-floor describe block).
describe('cmd_ws_add preflight — all-excluded refuses before anything exists', () => {
  it('dies and creates no worktree, no branch, no registry entry', () => {
    makeRepo('demo');
    disable('claude'); disable('claude-a'); disable('claude-b'); disable('claude-d');
    expect(() => sh(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`)).toThrow();
    expect(fs.existsSync(path.join(home, 'worktrees', 'demo', 'quiet-mesa'))).toBe(false);
    expect(reg('demo-quiet-mesa', 'uuid')).toBeNull();
    // The branch must not exist either: a preflight that ran after
    // `worktree add` would leave a branch behind on every refusal.
    const branches = execFileSync('git',
      ['-C', path.join(home, 'projects', 'demo'), 'branch', '--list', 'ws/quiet-mesa'],
      { encoding: 'utf8' });
    expect(branches.trim()).toBe('');
  });

  it('names each wrapper with its reason — disabled and missing both appear', () => {
    makeRepo('demo');
    disable('claude'); disable('claude-b'); disable('claude-d');
    fs.rmSync(path.join(home, '.local', 'bin', 'claude-a'));
    let stderr = '';
    try {
      sh(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
    } catch (e) {
      stderr = String((e as { stderr?: string }).stderr ?? '');
    }
    expect(stderr).toContain('claude:disabled');
    expect(stderr).toContain('claude-a:missing');
    expect(stderr).toContain('claude-b:disabled');
    expect(stderr).toContain('claude-d:disabled');
    expect(stderr).toContain('nothing was touched');
  });

  it('one enabled lane still succeeds and lands on it, even at the worst score', () => {
    // Pressure alone never refuses (the all-pinned fixture rule stands):
    // claude-b is the only _account_ok lane, despite scoring worst.
    makeRepo('demo');
    writeLimits('claude', 5, 5);
    writeLimits('claude-a', 5, 5);
    writeLimits('claude-b', 90, 90);
    writeLimits('claude-d', 5, 5);
    disable('claude'); disable('claude-a'); disable('claude-d');
    sh(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
    expect(reg('demo-quiet-mesa', 'wrapper')).toBe('claude-b');
  });
});

// ── THE ROSTER CAN CHANGE UNDER A RUNNING ccd ────────────────────────────────
// `ccd` sources `~/.ccrc/accounts.sh` ONCE, at startup, so `CCRC_ACCOUNTS` is a
// SNAPSHOT: a `ccrc account remove` landing while a ccd verb is in flight leaves
// that verb still believing in the account it is about to write. What it writes
// is a registry row naming a lane the roster no longer has, and that session
// then refuses to start (`wrapper missing`) until an operator re-points it by
// hand. So every account-valued WRITE re-reads the projection as it stands NOW,
// immediately before it writes.
//
// A RE-READ AND NOT A LOCK (operator ruling, 2026-09-11). ccd's placement paths
// are the hot ones on this box; making `start`, `swap`, `prefer` and `ws-add`
// depend on a fleet-wide flock would let one stuck holder delay every session
// start. This narrows the window to the microseconds between the re-read and
// the `_reg_set` rather than closing it, and the residual is the same
// operator-recoverable row it always was.
//
// THE FIXTURE IS THE STALENESS ITSELF. `sh()` sources ccd — which sources
// `accounts.sh` — and only then runs the snippet, so a snippet that rewrites
// that file before calling the verb reproduces the live condition exactly: an
// in-process array that names the account, and a file that does not.
describe('an account-valued write re-reads the roster it is about to name', () => {
  /** `node "$HOME/drop-account.mjs" <id>` — the projection rewritten as
   *  `ccrc account remove`'s own regeneration leaves it. A FILE rather than an
   *  inline `node -e`, because this has to run inside a bash snippet inside a
   *  TypeScript string and every layer of that nesting has its own quoting. */
  const plantDropper = (): void => {
    fs.writeFileSync(path.join(home, 'drop-account.mjs'), [
      "import { readFileSync, writeFileSync } from 'node:fs';",
      "const gone = process.argv[2];",
      "const p = `${process.env.HOME}/.ccrc/accounts.sh`;",
      "const kept = readFileSync(p, 'utf8').split('\\n')",
      "  .filter((l) => !l.includes(`${gone})`))",
      "  .map((l) => l.replace(/^(CCRC_ACCOUNTS|CCRC_HOME_ABLE|CCRC_MEASURED)=\\((.*)\\)$/,",
      "    (_m, k, v) => `${k}=(${v.split(' ').filter((x) => x !== gone).join(' ')})`));",
      "writeFileSync(p, kept.join('\\n'));",
    ].join('\n'));
  };
  const drop = (gone: string): string => `node "$HOME/drop-account.mjs" ${gone}`;

  const shFail = (snippet: string): { code: number; stdout: string; stderr: string } => {
    try { return { code: 0, stdout: sh(snippet), stderr: '' }; }
    catch (e) {
      const err = e as { status?: number; stdout?: Buffer; stderr?: Buffer };
      return { code: err.status ?? 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') };
    }
  };

  beforeEach(() => { plantDropper(); });

  it('the fixture really does leave ccd stale — the array names what the file does not', () => {
    // THE CONTROL FOR EVERY CASE BELOW. If the rewrite did not land, or landed
    // before ccd sourced the file, each of those cases would be asserting that
    // a verb refuses an account that was never there — green for the wrong
    // reason, and green with the guard deleted too.
    const out = sh(`${drop('claude-a')}\n`
      + 'printf \'%s|\' "${CCRC_ACCOUNTS[@]}"\n'
      + 'printf \'%s\' "$(grep -c "^CCRC_ACCOUNTS=.*claude-a" "$HOME/.ccrc/accounts.sh" || true)"');
    expect(out, 'ccd no longer carries the pre-removal roster').toContain('claude-a|');
    expect(out.endsWith('0'), 'the projection still names the dropped account').toBe(true);
  });

  it('cmd_start refuses a wrapper the roster dropped, and writes no registry row', () => {
    fs.mkdirSync(path.join(home, 'projects', 'demo'), { recursive: true });
    const r = shFail(`${drop('claude-a')}\ncmd_start claude-a demo`);
    expect(r.code, 'cmd_start started a session on a removed account').not.toBe(0);
    expect(r.stderr).toContain('claude-a');
    // AND THE REMEDY IS ONE THE OPERATOR CAN TYPE. The first draft of this
    // refusal said "(ccd accounts)" — a verb this build does not have, which is
    // the same defect the removal report carried about `ccrc models <id> rm`.
    // Pinned in both directions so the sentence cannot drift back.
    expect(r.stderr).toContain('ccrc account roster');
    expect(readFileSync(CCD, 'utf8'), 'ccd grew an `accounts` verb — this assertion is now the stale one')
      .not.toMatch(/^\s+accounts\)/m);
    expect(reg('claude-a-demo', 'wrapper'),
      'a registry row names an account the roster no longer has').toBeNull();
    expect(reg('claude-a-demo', 'home')).toBeNull();
  });

  it('cmd_prefer refuses a home the roster dropped, and leaves the old home standing', () => {
    sh(`_reg_set demo-quiet-mesa uuid u
        _reg_set demo-quiet-mesa wrapper claude
        _reg_set demo-quiet-mesa home claude`);
    const r = shFail(`${drop('claude-a')}\ncmd_prefer demo-quiet-mesa claude-a`);
    expect(r.code, 'cmd_prefer set a home on a removed account').not.toBe(0);
    expect(reg('demo-quiet-mesa', 'home')).toBe('claude');
  });

  it('cmd_swap refuses a target the roster dropped BEFORE it tears the session down', () => {
    // The pre-flight order this verb already keeps for a missing transcript
    // ("a refusal here costs nothing and leaves the session alive on the account
    // that still holds its file"), applied to a target that stopped existing:
    // the check is above the `systemctl stop` and the `tmux kill-session`.
    sh(`_reg_set claude-demo uuid u
        _reg_set claude-demo wrapper claude
        _reg_set claude-demo workdir "$HOME"`);
    const r = shFail(`${drop('claude-a')}\n`
      // THE PRE-FLIGHT ABOVE THIS ONE HAS TO PASS, or the case is green for the
      // wrong reason: measured, without this stub the swap refuses with "no
      // transcript found" and never reaches the question under test — and it
      // refuses that way with the guard deleted too.
      + '_transcript_matches() { echo found; }\n'
      + '_svc_stop() { echo "svc_stop $*" >> "$HOME/ccd-calls"; }\n'
      + 'cmd_swap claude-demo claude-a');
    expect(r.code, 'cmd_swap swapped onto a removed account').not.toBe(0);
    expect(reg('claude-demo', 'wrapper')).toBe('claude');
    expect(h.calls().join('\n'), 'the session was torn down for a swap that could not land')
      .not.toContain('svc_stop');
  });

  it('cmd_swap refuses a target that disappears mid-carry, and never flips the registry', () => {
    // THE SECOND CHECK, AND THE ONE THE FIRST CANNOT STAND IN FOR. The carry
    // runs between them — a `cp -a` over a sidecar can take minutes — which is
    // exactly the window a removal fits in. Driven by making the carry itself
    // rewrite the projection, because that is the only way a test can put the
    // removal INSIDE the swap.
    sh(`_reg_set claude-demo uuid u
        _reg_set claude-demo wrapper claude
        _reg_set claude-demo workdir "$HOME"`);
    const r = shFail(
      '_svc_stop() { :; }; _svc_start() { :; }\n'
      + '_swap_beat() { :; }; _swap_beat_stop() { :; }\n'
      + '_transcript_matches() { echo found; }\n'
      + '_swap_carry_sidecars() { :; }\n'
      + `_swap_carry_jsonl() { ${drop('claude-a')}; return 0; }\n`
      + 'cmd_swap claude-demo claude-a');
    expect(r.code, 'the registry was flipped onto an account removed mid-carry').not.toBe(0);
    expect(reg('claude-demo', 'wrapper')).toBe('claude');
  });

  it('tells an unreadable projection apart from a roster that changed, at the widest window', () => {
    // THE ONE CALL SITE THAT LEAVES SOMETHING ON DISK, and the first cut of it
    // collapsed three conditions into one sentence asserting the third: an
    // `accounts.sh` that could not be sourced, an array it no longer defines,
    // and a roster in which every lane is genuinely out. All three made the
    // pick empty; the refusal told the operator a removal had landed and
    // pointed at `rm $REG/<w>-disabled`, when the fix for two of them is
    // `ccrc install`. The sibling helper this same change added gets this right
    // — three answers, not two — and the site that can strand a worktree was
    // the one that did not.
    makeRepo('demo');
    const r = shFail(`${WS_ADD} CCD_WS_SLUG=quiet-mesa\n`
      + 'rm -f "$HOME/.ccrc/accounts.sh"\ncmd_ws_add demo');
    expect(r.code).not.toBe(0);
    expect(r.stderr, 'an unreadable projection was reported as a roster change')
      .toContain('ccrc install');
    expect(r.stderr, 'it blamed a removal for a file it could not read')
      .not.toContain('no account is available for placement');
    // AND IT STILL NAMES WHAT IS ON DISK, which is the half that makes either
    // refusal actionable: the worktree and the branch exist and no row names them.
    expect(r.stderr).toContain('quiet-mesa');
    expect(reg('demo-quiet-mesa', 'uuid')).toBeNull();
  });

  it('the re-read answers from the FILE, never from the array it inherited', () => {
    // `$( . accounts.sh )` runs in a subshell that has already inherited
    // `CCRC_ACCOUNTS` from ccd's own startup source. So a projection that
    // sources cleanly and no longer DEFINES the array — truncated before the
    // assignment, hand-edited — leaves `declare -p CCRC_ACCOUNTS` succeeding
    // against the stale inherited value, and the re-read answers from the very
    // snapshot it exists to correct. The same idiom is sound in `ccrc`, which
    // never sources this file into its own shell; it is specifically ccd where
    // the variable is pre-set.
    fs.writeFileSync(path.join(home, 'truncated.sh'), '# nothing but a comment\n');
    const out = sh('cp "$HOME/truncated.sh" "$HOME/.ccrc/accounts.sh"\n'
      + '_wrapper_rostered_now claude-a; printf \'%s\' "$?"');
    expect(out, 'the re-read answered 0 or 1 from the inherited array').toBe('2');
  });

  it('the fresh pick never names an account this process cannot resolve', () => {
    // The re-pick reads the CURRENT projection, but `_ccrc_cfg_dir`,
    // `_ccrc_label` and `_ccrc_hue` in this process are still the startup
    // snapshot's — and the generated `_ccrc_cfg_dir` has no default arm, so an
    // id it has never heard of answers EMPTY at exit 0. An account added AND
    // enabled during the `git fetch` window would therefore be picked, exec'd
    // fine, and then have no config directory for the rest of the run:
    // `_sync_uuid` returns early and the session's uuid is never mirrored.
    // The re-pick exists to avoid a REMOVED account, so it is scoped to the
    // intersection — it may drop a lane, never adopt one.
    makeRepo('demo');
    fs.writeFileSync(path.join(home, '.local', 'bin', 'newcomer'), '#!/bin/sh\n', { mode: 0o755 });
    const add = [
      "import { readFileSync, writeFileSync } from 'node:fs';",
      "const p = `${process.env.HOME}/.ccrc/accounts.sh`;",
      "writeFileSync(p, readFileSync(p, 'utf8')",
      "  .replace(/^(CCRC_ACCOUNTS|CCRC_HOME_ABLE|CCRC_MEASURED)=\\((.*)\\)$/gm,",
      "    (_m, k, v) => `${k}=(${v} newcomer)`));",
    ].join('\n');
    fs.writeFileSync(path.join(home, 'add-account.mjs'), add);
    // The newcomer is made the cheapest lane by a mile, so a re-pick that was
    // free to adopt it WOULD.
    writeLimits('claude', 90, 90);
    writeLimits('claude-a', 90, 90);
    writeLimits('claude-b', 90, 90);
    writeLimits('claude-d', 90, 90);
    writeLimits('newcomer', 1, 1);
    sh(`${WS_ADD} CCD_WS_SLUG=quiet-mesa\nnode "$HOME/add-account.mjs"\ncmd_ws_add demo`);
    const landed = reg('demo-quiet-mesa', 'wrapper');
    expect(landed, 'the re-pick adopted an account this process cannot resolve')
      .not.toBe('newcomer');
    expect(landed, 'it did not land anywhere at all').toBeTruthy();
    // …and the account it DID pick is one this process can name a config
    // directory for, which is the property the intersection buys.
    expect(sh(`_cfg_dir ${landed}`), `_cfg_dir ${landed} answered empty`).toBeTruthy();
  });

  it('cmd_ws_add re-picks from the roster as it stands, not as it stood at the pre-flight', () => {
    // The account is chosen in the pre-flight, BEFORE a fetch and a
    // `git worktree add` that take seconds — so this verb's window is the widest
    // of the four, and its answer is not a refusal but a FRESH PICK: placement
    // here is automatic, and a newer measurement is strictly the better one.
    makeRepo('demo');
    writeLimits('claude', 90, 90);
    writeLimits('claude-a', 1, 1);
    writeLimits('claude-b', 50, 50);
    writeLimits('claude-d', 60, 60);
    sh(`${WS_ADD} CCD_WS_SLUG=quiet-mesa\n${drop('claude-a')}\ncmd_ws_add demo`);
    const landed = reg('demo-quiet-mesa', 'wrapper');
    expect(landed, 'the workspace landed on an account the roster no longer has')
      .not.toBe('claude-a');
    expect(landed, 'it did not land anywhere at all').toBeTruthy();
    expect(reg('demo-quiet-mesa', 'home')).toBe(landed);
  });
});

// `$REG/<account>-authdead` is the account-health probe's durable verdict, in the
// tree's one fault format — `"<epoch> <reason>"`, the shape `swapblocked` already
// uses (`_swap_refuse`, ccd/ccd:13949). This file pins the READER and the NAMESPACE; the two
// placement consumers are pinned in the describes Task 2 adds below.
//
// THE DIGITS GATE IS NOT COSMETIC. ccd runs under `set -u`, and every reader of a
// stamped marker in this file validates the epoch as digits BEFORE any arithmetic
// touches it (`_auto_swap_check`'s `bts`, ccd/ccd:12229-12230) — a hand-edited or
// half-written field otherwise emits an unbound-variable line on every supervise
// tick. `_authdead` is a predicate rather than an arithmetic reader, so the gate
// buys something else here: it is what makes a TRUNCATED marker read as "no
// verdict" instead of as a verdict nobody wrote.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeCcdHarness, seedAccountsSh, CCD, type CcdHarness } from './ccdWsHelpers.js';
import { DEFAULT_TEST_ROSTER } from './helpers.js';

let h: CcdHarness;
let home: string;

const sh = (s: string, env: NodeJS.ProcessEnv = {}): string => h.sh(s, env);
const ok = (snippet: string): boolean => sh(`${snippet} && echo yes || echo no`) === 'yes';
const marker = (w: string): string => path.join(home, '.cc-sessions', `${w}-authdead`);
const mark = (w: string, body: string): void => fs.writeFileSync(marker(w), body);

/** A FIXTURE credential file at `$HOME/<rel>` — fixture bytes, never a real
 *  token. `makeCcdHarness` seeds no `~/.cc-secrets` and no `.credentials.json`,
 *  so every test that does not call this sees a lane ccd cannot name (D-3524).
 *  Its ctime is "now", the only clock a test can give a file, so the marker
 *  epochs below sit far from it on purpose: `PAST` (2025-09-07) reads as "the
 *  credential changed after the verdict", `future()` as "the credential
 *  predates it", and neither can land in the same second as the write. */
const cred = (rel: string, body = 'export CLAUDE_CODE_OAUTH_TOKEN=fixture\n'): string => {
  const p = path.join(home, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  return p;
};
const nowS = (): number => Math.floor(Date.now() / 1000);
const PAST = 1757203200;
const future = (): number => nowS() + 3600;
/** The file's own ctime, in the epoch seconds `stat -c %Z` prints. */
const ctimeS = (p: string): number => Math.floor(fs.statSync(p).ctimeMs / 1000);
/** Block until the wall clock has left the second `p`'s ctime fell in, so a
 *  marker ccd stamps with its own `date +%s` is strictly later than the file.
 *  Needed only where the CODE writes the epoch (the rescue); everywhere else
 *  the test chooses one far from now. */
const pastCtimeSecond = (p: string): void => {
  const until = (ctimeS(p) + 1) * 1000 + 50;
  while (Date.now() < until) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, until - Date.now());
};

beforeEach(() => { h = makeCcdHarness('ccrc-ccd-authdead-'); home = h.home; });
afterEach(() => { h.cleanup(); });

describe('_authdead', () => {
  it('is false when no marker exists', () => {
    expect(ok('_authdead claude')).toBe(false);
  });

  it('is true for the shipped format, "<epoch> <reason>"', () => {
    mark('claude', '1757203200 auth-401');
    expect(ok('_authdead claude')).toBe(true);
  });

  it('is true for a bare epoch with no reason — the reason is a note, the stamp is the fact', () => {
    mark('claude', '1757203200');
    expect(ok('_authdead claude')).toBe(true);
  });

  it('is FALSE for an empty file — a marker nobody finished writing is not a verdict', () => {
    mark('claude', '');
    expect(ok('_authdead claude')).toBe(false);
  });

  it('is FALSE when the first field is not digits', () => {
    mark('claude', 'yesterday auth-401');
    expect(ok('_authdead claude')).toBe(false);
  });

  it('is FALSE for a LIVE SYMLINK to a file whose first word is digits — the marker may not be fabricated', () => {
    // D-2989, re-censused BY PAIRING (a type test on any `$REG` path followed by
    // a read of it). `-f` FOLLOWS the chain, so a link at
    // `$REG/<wrapper>-authdead` pointing anywhere readable whose first word is
    // digits passed the test and the `cat` below returned THAT file's bytes — a
    // fabricated AUTH-DEAD verdict sourced from outside `$REG`. `ccd/ccd:6017`
    // skips placement on it and the rescue arm scores `sc=101` from it, so the
    // fabricated value decides where a session lands.
    // The first census could not reach this site: it named the class by the
    // FIELD-path grammar `$REG/<id>.<field>`, which excludes a `-authdead`
    // marker BY CONSTRUCTION while the defect is identical.
    const foreign = path.join(home, 'outside-the-registry');
    fs.writeFileSync(foreign, '1757203200 auth-401');
    fs.symlinkSync(foreign, marker('claude'));
    expect(ok('_authdead claude')).toBe(false);
  });

  it('CONTROL: a REAL regular file holding those same bytes is still TRUE', () => {
    // Without this the case above is equally consistent with a guard that broke
    // every marker. Same bytes, same path, the only difference being the TYPE.
    mark('claude', '1757203200 auth-401');
    expect(ok('_authdead claude')).toBe(true);
  });

  it('CONTROL: a DANGLING symlink was already false, which is why it pinned nothing', () => {
    // Recorded as a control rather than as evidence: `-f` is false for a broken
    // link for free, so a dangling case is GREEN with no guard at all. That is
    // exactly why this class survived three rounds of review — the shape that
    // had to be planted was a link that RESOLVES.
    fs.symlinkSync(path.join(home, 'no-such-target'), marker('claude'));
    expect(ok('_authdead claude')).toBe(false);
  });

  it('answers per account, never fleet-wide', () => {
    mark('claude-a', '1757203200 auth-401');
    expect(ok('_authdead claude-a')).toBe(true);
    expect(ok('_authdead claude')).toBe(false);
    expect(ok('_authdead claude-b')).toBe(false);
  });

  it('prints nothing on either path — it is a predicate, not a reader', () => {
    mark('claude', '1757203200 auth-401');
    expect(sh('_authdead claude; _authdead claude-b; echo END')).toBe('END');
  });
});

// D-3524. The marker is a verdict about ONE credential — the one the lane had
// loaded when the 401 was measured. Once the account's credential FILE has
// changed at or after the marker's epoch, the verdict is about bytes no longer
// on disk, and ccd's one reader expires it: so a re-login revives the account at
// the next placement or home decision, with no spawn and no probe (macOS has no
// probe at all). The file is stat'ed, never opened — it holds a secret. Only a
// file the roster DECLARES (or the upstream's `<id>-oauth.env`) is ever named: a
// lane with no `secretsFile` is unnameable, and its marker never expires here.
describe('_authdead expires a marker once the account\'s credential file changes (D-3524)', () => {
  it('a credential changed after the verdict: not dead, the marker is removed, and nothing is printed on either stream', () => {
    cred('.cc-secrets/claude-a-oauth.env');
    mark('claude-a', `${PAST} auth-401`);
    expect(sh('{ _authdead claude-a; echo "rc=$?"; } 2>&1')).toBe('rc=1');
    expect(fs.existsSync(marker('claude-a'))).toBe(false);
  });

  it('CONTROL: a credential older than the verdict leaves it standing', () => {
    cred('.cc-secrets/claude-a-oauth.env');
    mark('claude-a', `${future()} rescue-401`);
    expect(ok('_authdead claude-a')).toBe(true);
    expect(fs.existsSync(marker('claude-a'))).toBe(true);
  });

  it('the SAME second counts as changed — `>=`, so a tie fails toward reviving the account', () => {
    const p = cred('.cc-secrets/claude-a-oauth.env');
    mark('claude-a', `${ctimeS(p)} auth-401`);
    expect(ok('_authdead claude-a')).toBe(false);
    expect(fs.existsSync(marker('claude-a'))).toBe(false);
  });

  it('judges by ctime, never mtime: a restore that backdates mtime (`cp -p`) is still a change', () => {
    // `utimes` sets mtime to 2025-06-01 — before PAST — and moves ctime to now,
    // exactly what `cp -p` from an old backup does (measured on this box).
    const p = cred('.cc-secrets/claude-a-oauth.env');
    fs.utimesSync(p, 1748736000, 1748736000);
    mark('claude-a', `${PAST} auth-401`);
    expect(ok('_authdead claude-a')).toBe(false);
  });

  it('the upstream is judged by `.cc-secrets/<upstream>-oauth.env`, what its launcher and the probe read', () => {
    cred('.cc-secrets/claude-oauth.env');
    mark('claude', `${PAST} auth-401`);
    expect(ok('_authdead claude')).toBe(false);
  });

  it('a lane the roster gives no secretsFile is UNNAMEABLE: a `.credentials.json` rewritten after the verdict does not expire it', () => {
    // Round 1 of D-3524 dropped the config-dir arm. `.credentials.json` changes for
    // reasons that are not a re-login — 7 of 17 on the fleet box had a ctime 0-3 h
    // old, on lanes whose credential is not even that file, cause unmeasured — so
    // judging a login lane by it expired every standing marker within hours and
    // brought D-3522's loop back. `claude-b` (Anthropic, generated, no secretsFile:
    // what `ccrc account add --method login` writes) and `gpt` (external) alike.
    cred('.claude-b/.credentials.json', '{}\n');
    mark('claude-b', `${PAST} auth-401`);
    expect(ok('_authdead claude-b')).toBe(true);
    expect(fs.existsSync(marker('claude-b'))).toBe(true);
    cred('.claude-gpt/.credentials.json', '{}\n');
    mark('gpt', `${PAST} auth-401`);
    expect(ok('_authdead gpt')).toBe(true);
  });

  it('an accounts.sh from before `_ccrc_secrets_file` names nothing for a generated lane — never the `<id>-oauth.env` guess', () => {
    cred('.cc-secrets/claude-a-oauth.env');
    mark('claude-a', `${PAST} auth-401`);
    expect(ok('unset -f _ccrc_secrets_file; _authdead claude-a')).toBe(true);
  });

  it('an old accounts.sh cannot say whether a secrets file was declared, so a config-dir `.credentials.json` is not read either', () => {
    // `claude-a` DECLARES `.cc-secrets/claude-a-oauth.env`; with the projection
    // gone, falling through to its config dir would judge it by a file its
    // wrapper never authenticates with. No lane is judged by that file at all
    // since round 1; this pins that the old-accounts.sh path grows no fallback.
    cred('.claude-a/.credentials.json', '{}\n');
    mark('claude-a', `${PAST} auth-401`);
    expect(ok('unset -f _ccrc_secrets_file; _authdead claude-a')).toBe(true);
  });

  it('reads a leading-zero epoch in base 10, never as octal', () => {
    // Bytes off disk. `(( … >= 01757203289 ))` is an octal parse error in bash
    // (it holds an 8 and a 9), which would read "unchanged" and keep a verdict
    // on a credential that was replaced.
    cred('.cc-secrets/claude-a-oauth.env');
    mark('claude-a', '01757203289 auth-401');
    expect(ok('_authdead claude-a')).toBe(false);
  });

  it('a SYMLINKED credential source is unnameable — the verdict is not re-dated by a link', () => {
    const real = cred('elsewhere/claude-a-oauth.env');
    fs.mkdirSync(path.join(home, '.cc-secrets'), { recursive: true });
    fs.symlinkSync(real, path.join(home, '.cc-secrets', 'claude-a-oauth.env'));
    mark('claude-a', `${PAST} auth-401`);
    expect(ok('_authdead claude-a')).toBe(true);
  });

  it('a NON-REGULAR credential source (a FIFO) is unnameable, and answers without blocking', () => {
    fs.mkdirSync(path.join(home, '.cc-secrets'), { recursive: true });
    execFileSync('mkfifo', [path.join(home, '.cc-secrets', 'claude-a-oauth.env')]);
    mark('claude-a', `${PAST} auth-401`);
    expect(sh(`timeout 5 bash -c 'source "${CCD}"; _authdead claude-a'; echo "rc=$?"`)).toBe('rc=0');
  });

  // THE STAT WINDOW (D-3524 round 1). Deciding to expire takes a fork and a
  // `stat`; the probe's `_ah_mark` and a rescue both `mv -f` a fresh verdict into
  // the same path, and one can land inside that window. A remove BY PATH then
  // deleted the fresh verdict and answered "not dead" about a credential just
  // measured dead. `_plat_ctime` is the seam inside the window, so an override
  // that renames a fresh marker into place before it stats replays the
  // interleaving deterministically. `real_ctime` is the shipped body, copied.
  const inWindow = (move: boolean): string =>
    `eval "real_ctime() $(declare -f _plat_ctime | tail -n +2)"
     _plat_ctime() { ${move ? 'mv -f "$HOME/fresh-marker" "$REG/claude-a-authdead";' : ''} real_ctime "$@"; }
     _authdead claude-a && echo dead || echo live`;

  it('a fresh verdict renamed in while the old one is judged SURVIVES, and the account reads dead', () => {
    cred('.cc-secrets/claude-a-oauth.env');
    mark('claude-a', `${PAST} auth-401`);            // the old verdict: the credential changed after it
    const fresh = `${future()} auth-401`;
    fs.writeFileSync(path.join(home, 'fresh-marker'), fresh);
    expect(sh(inWindow(true))).toBe('dead');
    expect(fs.readFileSync(marker('claude-a'), 'utf8')).toBe(fresh);
  });

  it('a FIFO renamed in inside the window is never opened — the re-read answers dead without blocking', () => {
    // The re-read keeps `_authdead`'s `-f` rung: an open of a FIFO with no writer
    // never returns, and this runs inside account loops on the 5-second tick.
    cred('.cc-secrets/claude-a-oauth.env');
    mark('claude-a', `${PAST} auth-401`);
    execFileSync('mkfifo', [path.join(home, 'fresh-marker')]);
    expect(sh(`timeout 5 bash -c 'source "${CCD}"; ${inWindow(true)}'; echo "rc=$?"`)).toBe('dead\nrc=0');
  });

  it('a SYMLINK renamed in carrying the judged epoch is not read through, and not removed', () => {
    // And its `! -L` rung: a link would let any file answer for the marker, and
    // the `rm` would then take the link on the strength of another file's bytes.
    cred('.cc-secrets/claude-a-oauth.env');
    mark('claude-a', `${PAST} auth-401`);
    const foreign = path.join(home, 'outside-the-registry');
    fs.writeFileSync(foreign, `${PAST} auth-401`);
    fs.symlinkSync(foreign, path.join(home, 'fresh-marker'));
    expect(sh(inWindow(true))).toBe('dead');
    expect(fs.lstatSync(marker('claude-a')).isSymbolicLink()).toBe(true);
  });

  it('CONTROL: the same seam with nothing renamed in still expires the old verdict', () => {
    // Without this the case above is equally consistent with an override that
    // broke the expiry outright — same seam, same file, only the rename differs.
    cred('.cc-secrets/claude-a-oauth.env');
    mark('claude-a', `${PAST} auth-401`);
    expect(sh(inWindow(false))).toBe('live');
    expect(fs.existsSync(marker('claude-a'))).toBe(false);
  });
});

describe('the marker is DOTLESS, so no registry glob can eat it', () => {
  // Every registry glob in ccd is suffix-shaped and runs the same one-dot rule
  // (`[[ "$suffix" == *.* ]] && continue`) at THREE sites: `_reg_purge`,
  // `_ws_slug_free` and `_ws_slug_residue`. All three glob `"$REG/$id".*`,
  // which requires a literal dot AFTER the id — and since D-2605 the last two
  // ALSO take a second, dot-LEADING pass over the private compaction families,
  // so for those two the dot-skip is no longer the whole reason. The
  // assertions below stay GREEN either way, because the marker is DOTLESS
  // *and* matches no `.<id>.`-prefixed family — restated here rather than left
  // standing, since a comment that goes on giving only the OLD reason is a lie
  // no suite can catch. So a
  // dotless `<account>-authdead` is invisible to them even when a session id
  // collides with it byte for byte. Asserted rather than assumed, because the
  // collision is what a per-account marker in the session namespace risks and it
  // is exactly the class `_reg_purge`'s own header records as measured.
  it('survives _reg_purge of a session whose id IS the marker name', () => {
    const reg = path.join(home, '.cc-sessions');
    mark('claude-authdead', '1757203200 auth-401');
    fs.writeFileSync(path.join(reg, 'claude-authdead.uuid'), 'u\n');
    fs.writeFileSync(path.join(reg, 'claude-authdead.wrapper'), 'claude\n');
    sh('_reg_purge claude-authdead');
    expect(fs.existsSync(path.join(reg, 'claude-authdead.uuid')), 'the session row survived').toBe(false);
    expect(fs.existsSync(marker('claude-authdead')), 'the marker was swept').toBe(true);
  });

  it('does not make a colliding slug read as occupied', () => {
    // The other direction of the same rule: `_ws_slug_free` must not see the
    // dotless marker either, or the marker would wedge a slug forever.
    mark('demo-quiet', '1757203200 auth-401');
    expect(ok('_ws_slug_free demo quiet')).toBe(true);
  });
});

const writeLimits = (w: string, five: number, seven: number): void =>
  fs.writeFileSync(path.join(home, '.cc-limits', `${w}.json`),
    JSON.stringify({ five, seven, ts: Math.floor(Date.now() / 1000) }));

describe('_ws_least_loaded drops an auth-dead lane from SCORING and from the PREFERRED fallback, never from ELIGIBILITY', () => {
  it('does not place a new workspace on the cheapest lane when that lane is auth-dead', () => {
    writeLimits('claude', 50, 50);
    writeLimits('claude-a', 5, 5);        // cheapest, but dead
    writeLimits('claude-b', 40, 40);
    writeLimits('claude-d', 60, 60);
    mark('claude-a', '1757203200 auth-401');
    expect(sh('_ws_least_loaded')).toBe('claude-b');
  });

  it('STILL ANSWERS when every home-able lane is auth-dead — the condemned tier is reachable', () => {
    // THE CASE THE SECOND FALLBACK TIER IS PLACED FOR. Collect condemned lanes
    // nowhere — a bare `_authdead "$w" && continue` above the score — and this
    // function echoes "" here, `cmd_ws_add` dies with no destination, and a
    // fleet whose accounts are all merely UNVERIFIED cannot take a workspace at
    // all. Eligibility must survive one bad probe run; only preference changes.
    writeLimits('claude', 50, 50);
    writeLimits('claude-a', 5, 5);
    writeLimits('claude-b', 40, 40);
    writeLimits('claude-d', 60, 60);
    for (const w of ['claude', 'claude-a', 'claude-b', 'claude-d']) mark(w, '1757203200 auth-401');
    expect(sh('_ws_least_loaded')).toBe('claude');   // roster declaration order
  });

  it('DOES NOT fall back to a condemned lane while a healthy one is behind it', () => {
    // THE OTHER SIDE OF THE SAME TIER, and the defect this file used to assert
    // as correct (D-1954). No telemetry anywhere, so nothing is scorable and the
    // fallback alone decides — and the fallback used to be one variable assigned
    // BEFORE the health skip, i.e. the first placeable lane whether or not the
    // probe had already measured its credential dead. `claude` is first in
    // roster declaration order and condemned; `claude-a` is neither.
    mark('claude', '1757203200 auth-401');
    expect(sh('_ws_least_loaded')).toBe('claude-a');
  });

  it('does not let a condemned lane back into the fallback by being the only MEASURED one', () => {
    // The scored set can empty for two different reasons — nothing measured, or
    // everything measured condemned — and reading the second as the first is
    // how a "take the first candidate" fallback re-preferred the lane the skip
    // had just rejected. `claude`'s honest 5 buys it nothing here.
    writeLimits('claude', 5, 5);
    mark('claude', '1757203200 auth-401');
    expect(sh('_ws_least_loaded')).toBe('claude-a');
  });

  it('prefers a MEASURED healthy lane over an unmeasured one, condemned lanes aside', () => {
    // The tiers do not reorder the ones that were already there: a condemned
    // first lane drops to last, and the surviving lanes still rank measured
    // before unmeasured. `claude-b` is the only lane with telemetry left.
    writeLimits('claude', 5, 5);
    writeLimits('claude-b', 90, 90);
    mark('claude', '1757203200 auth-401');
    expect(sh('_ws_least_loaded')).toBe('claude-b');
  });

  it('a re-logged-in lane leaves the condemned tier at the next placement — the marker expires on read (D-3524)', () => {
    writeLimits('claude', 50, 50);
    writeLimits('claude-a', 5, 5);        // cheapest, and its credential was rewritten after the verdict
    writeLimits('claude-b', 40, 40);
    writeLimits('claude-d', 60, 60);
    cred('.cc-secrets/claude-a-oauth.env');
    mark('claude-a', `${PAST} auth-401`);
    expect(sh('_ws_least_loaded')).toBe('claude-a');
    expect(fs.existsSync(marker('claude-a'))).toBe(false);
  });

  it('CONTROL: a lane whose credential predates the verdict stays condemned', () => {
    writeLimits('claude', 50, 50);
    writeLimits('claude-a', 5, 5);
    writeLimits('claude-b', 40, 40);
    writeLimits('claude-d', 60, 60);
    cred('.cc-secrets/claude-a-oauth.env');
    mark('claude-a', `${future()} rescue-401`);
    expect(sh('_ws_least_loaded')).toBe('claude-b');
    expect(fs.existsSync(marker('claude-a'))).toBe(true);
  });
});

describe('_swap_target ranks an auth-dead lane LAST, and never makes it ineligible', () => {
  const seedSession = (id: string, wrapper: string): void => {
    const reg = path.join(home, '.cc-sessions');
    fs.writeFileSync(path.join(reg, `${id}.uuid`), 'u\n');
    fs.writeFileSync(path.join(reg, `${id}.wrapper`), `${wrapper}\n`);
    fs.writeFileSync(path.join(reg, `${id}.home`), `${wrapper}\n`);
  };

  it('prefers a measured healthy lane over a cheaper auth-dead one', () => {
    seedSession('claude-demo', 'claude');
    writeLimits('claude', 99, 99);        // cur: pinned, must leave
    writeLimits('claude-a', 5, 5);        // cheapest, but dead
    writeLimits('claude-b', 40, 40);
    writeLimits('claude-d', 60, 60);
    mark('claude-a', '1757203200 auth-401');
    expect(sh('_swap_target claude-demo claude claude')).toBe('claude-b');
  });

  it('STILL RESCUES onto an auth-dead lane when it is the only destination left', () => {
    // The rescue lane's rule, and the thing to pin hardest: an over-eager
    // verdict must cost PREFERENCE, never a destination. A `continue` here
    // leaves `best` empty, `_swap_target` prints nothing, `_auto_swap_check`
    // returns silently, and a session with a lost-auth screen up stays wedged
    // with no swap.log line and no notification.
    //
    // `|| true` IS LOAD-BEARING, and it is here so this case can FAIL rather
    // than ERROR. `_swap_target`'s last statement is `[[ -n "$best" ]] && echo
    // "$best"`, so an empty `best` makes the function — and the `bash -c`
    // around it — exit 1, and `makeCcdHarness`'s `sh` is `execFileSync`, which
    // THROWS on a non-zero exit. Without the `|| true` the mutation that turns
    // the guard into a `continue` would blow up inside the harness instead of
    // reporting `expected '' to be 'claude-d'`, and an unmeasurable mutation is
    // the one thing this table may not have.
    seedSession('claude-demo', 'claude');
    writeLimits('claude', 99, 99);        // cur: pinned
    writeLimits('claude-a', 99, 99);      // over the ceiling — _avail rejects
    writeLimits('claude-b', 99, 99);      // over the ceiling — _avail rejects
    writeLimits('claude-d', 5, 5);        // the only available lane, and dead
    mark('claude-d', '1757203200 auth-401');
    expect(sh('_swap_target claude-demo claude claude || true')).toBe('claude-d');
  });

  it('RANKS BELOW unmeasured, losing to a silent lane it would beat on roster order', () => {
    // SAYING IT OUT LOUD, as the version of this case that pinned the two as
    // EQUAL asked the edit that separated them to. They are no longer equal:
    // auth-dead is 101, one tier below unmeasured's 100, so `claude-a` loses to
    // `claude-b` here DESPITE winning roster order — which is exactly what the
    // old equality could not express, because at a shared 100 the strict `<`
    // handed the rescue to whichever condemned lane came first.
    //
    // Why the tier and not the tie: an auth-dead lane cannot refresh its own
    // telemetry (nothing runs there to render a statusline), so within hours it
    // reads unmeasured anyway and `sc` is already 100 from `: "${sc:=100}"`. At
    // a shared 100 the guard's whole effect was the window in which a dead lane
    // still carried fresh both-halves telemetry — here, `claude-a`'s 5/5.
    seedSession('claude-demo', 'claude');
    writeLimits('claude', 99, 99);        // cur: pinned
    writeLimits('claude-a', 5, 5);        // dead -> 101, not the 5 it measures
    mark('claude-a', '1757203200 auth-401');
    // claude-b and claude-d have no telemetry file at all -> unmeasured -> 100
    expect(sh('_swap_target claude-demo claude claude')).toBe('claude-b');
  });

  it('loses to a healthy lane when NEITHER has telemetry — the steady state', () => {
    // THE CASE THE OLD EQUALITY LOST, and the reason for the tier. This is not
    // a corner: it is what an auth-dead lane looks like a few hours after the
    // probe marks it, every time, because it cannot report and `_limit_field`
    // retracts the sample whose window has ended. Both lanes are scoreless, so
    // the ONLY thing separating them is the health verdict — at `sc=100` the
    // strict `<` gave the rescue to `claude-a` on roster order alone, sending a
    // hard-blocked session to the one account measured as not authenticating.
    seedSession('claude-demo', 'claude');
    writeLimits('claude', 99, 99);        // cur: pinned, must leave
    mark('claude-a', '1757203200 auth-401');   // dead, and no telemetry -> 101
    // claude-b, claude-d: healthy and silent -> unmeasured -> 100
    expect(sh('_swap_target claude-demo claude claude')).toBe('claude-b');
  });
});

// D-3522: a 401 writes no usage telemetry, so `_avail` passes an auth-dead home,
// and the "home recovered: go back" arm returned a rescued session straight to
// the account it was rescued off — after SWAP_COOLDOWN idle, or at once on a
// forced call, ahead of the candidate loop's rank-101 demotion.
describe('_swap_target never returns a session to an auth-dead home (D-3522)', () => {
  const away = (id: string, wrapper: string, homeW: string): void => {
    const reg = path.join(home, '.cc-sessions');
    fs.writeFileSync(path.join(reg, `${id}.uuid`), 'u\n');
    fs.writeFileSync(path.join(reg, `${id}.wrapper`), `${wrapper}\n`);
    fs.writeFileSync(path.join(reg, `${id}.home`), `${homeW}\n`);
  };

  it('an idle rescued session stays where it is instead of going home to a dead account', () => {
    away('claude-demo', 'claude-b', 'claude');
    writeLimits('claude', 5, 5);          // home reads healthy: a 401 wrote nothing
    writeLimits('claude-b', 40, 40);      // cur: fine to stay on
    expect(sh('_swap_target claude-demo claude-b claude || true')).toBe('claude');   // control: live home
    mark('claude', '1757203200 auth-401');
    expect(sh('_swap_target claude-demo claude-b claude || true')).not.toBe('claude');
  });

  it('a forced rescue off cur does not land on the dead home either — it takes a live candidate', () => {
    away('claude-demo', 'claude-b', 'claude');
    writeLimits('claude', 5, 5);
    writeLimits('claude-b', 99, 99);      // cur: pinned, must leave
    writeLimits('claude-a', 10, 10);
    writeLimits('claude-d', 20, 20);
    expect(sh('_swap_target claude-demo claude-b claude 1 || true')).toBe('claude');   // control
    mark('claude', '1757203200 auth-401');
    expect(sh('_swap_target claude-demo claude-b claude 1 || true')).toBe('claude-a');
  });

  it('a re-login sends the session home at the next decision, with no spawn — the marker expires on read (D-3524)', () => {
    away('claude-demo', 'claude-b', 'claude');
    writeLimits('claude', 5, 5);
    writeLimits('claude-b', 40, 40);
    cred('.cc-secrets/claude-oauth.env');     // the upstream's credential, rewritten after the verdict
    mark('claude', `${PAST} auth-401`);
    expect(sh('_swap_target claude-demo claude-b claude || true')).toBe('claude');
    expect(fs.existsSync(marker('claude'))).toBe(false);
  });

  it('CONTROL: a credential older than the verdict still refuses the home', () => {
    away('claude-demo', 'claude-b', 'claude');
    writeLimits('claude', 5, 5);
    writeLimits('claude-b', 40, 40);
    cred('.cc-secrets/claude-oauth.env');
    mark('claude', `${future()} rescue-401`);
    expect(sh('_swap_target claude-demo claude-b claude || true')).not.toBe('claude');
    expect(fs.existsSync(marker('claude'))).toBe(true);
  });
});

describe('a clean spawn clears the marker only when the credential changed, or ccd cannot name one (D-3524)', () => {
  // §A.6's second owner, AMENDED. It was "any successful session start on that
  // account", on the argument that a TUI coming up proves the credential
  // authenticates. Measured 2026-09-28, that premise is false: Claude Code
  // 2.1.280 draws its prompt on a dead OAuth token (it swallows its one startup
  // 401), `_accept_first_run_prompts` reads that as rc 0, and the clear wiped the
  // marker D-3522's rescue had just written — so the home arm sent the rescued
  // session back to the 401. The evidence is now the credential FILE: rc 0 keeps
  // a marker whose account's credential predates it, clears one whose credential
  // changed since, and keeps TODAY'S rule — clear — for a lane ccd cannot name a
  // credential for (any lane whose roster declares no secretsFile — a login lane,
  // an external lane — or an old accounts.sh).
  //
  // rc 0 ONLY, still. `cmd_start` clears `swapblocked` on the ATTEMPT
  // (ccd/ccd:13258) because a swap refusal is a stale banner an operator
  // supersedes by acting. An auth-dead marker is a MEASUREMENT: clearing it on
  // an attempt would erase a true fault with no evidence. rc 2 is "waiting for
  // login" and rc 5 is "hard-blocked at startup (limit/spend banner, or lost
  // auth)" — both are the OPPOSITE of evidence.
  // `|| true` IS LOAD-BEARING. `_spawn_settle` ends in `return "$prompt_rc"`,
  // so the rc 2 and rc 5 cases make the `bash -c` exit 2 and 5
  // — and `makeCcdHarness`'s `sh` is `execFileSync`, which THROWS on any
  // non-zero exit (ccd runs `set -uo pipefail`, no `-e`, so nothing else
  // rescues it). Swallowing the code here is what makes those two cases assert
  // rather than error, which is the only way Step 5's second mutation can be
  // measured at all.
  const settle = (id: string, rc: number, pre = ''): string =>
    sh(`${pre} _accept_first_run_prompts() { return ${rc}; }; _tmux() { echo t; };`
      + ` _inject_spawn_effort() { :; }; _lc_done() { :; }; _spawn_settle ${id} "" || true`);

  const seedOn = (id: string, wrapper: string): void => {
    const reg = path.join(home, '.cc-sessions');
    fs.writeFileSync(path.join(reg, `${id}.uuid`), 'u\n');
    fs.writeFileSync(path.join(reg, `${id}.wrapper`), `${wrapper}\n`);
  };

  it('KEEPS the marker when the account\'s credential predates the verdict — the TUI came up on the credential measured dead', () => {
    seedOn('claude-demo', 'claude-a');
    cred('.cc-secrets/claude-a-oauth.env');
    mark('claude-a', `${future()} rescue-401`);
    settle('claude-demo', 0);
    expect(fs.existsSync(marker('claude-a'))).toBe(true);
    expect(fs.existsSync(path.join(home, '.cc-sessions', 'claude-demo.stopped')), 'the .stopped half is unchanged').toBe(false);
  });

  it('clears it when the credential changed after the verdict', () => {
    seedOn('claude-demo', 'claude-a');
    cred('.cc-secrets/claude-a-oauth.env');
    mark('claude-a', `${PAST} auth-401`);
    settle('claude-demo', 0);
    expect(fs.existsSync(marker('claude-a'))).toBe(false);
  });

  it('a lane with no nameable credential keeps today\'s rule: rc 0 clears — a fallback now, not evidence', () => {
    // The harness seeds no credential file at all, so `claude-a` is unnameable
    // here. This was the whole of §A.6's owner 2; it survives only for lanes
    // ccd cannot see, where dropping it would leave nothing but the probe and an
    // operator `rm` to revive the account.
    seedOn('claude-demo', 'claude-a');
    mark('claude-a', `${future()} auth-401`);
    settle('claude-demo', 0);
    expect(fs.existsSync(marker('claude-a'))).toBe(false);
  });

  it('the upstream is judged by `.cc-secrets/<upstream>-oauth.env`', () => {
    seedOn('claude-demo', 'claude');
    cred('.cc-secrets/claude-oauth.env');
    mark('claude', `${future()} rescue-401`);
    settle('claude-demo', 0);
    expect(fs.existsSync(marker('claude'))).toBe(true);
    mark('claude', `${PAST} rescue-401`);
    settle('claude-demo', 0);
    expect(fs.existsSync(marker('claude'))).toBe(false);
  });

  it('a lane with no secretsFile is unnameable, so rc 0 clears — even while its `.credentials.json` predates the marker', () => {
    // Round 1: `.credentials.json` is never a credential source (it changes
    // without a re-login), so a login lane keeps §A.6's rc-0 clear whole.
    seedOn('claude-demo', 'claude-b');
    cred('.claude-b/.credentials.json', '{}\n');
    mark('claude-b', `${future()} rescue-401`);
    settle('claude-demo', 0);
    expect(fs.existsSync(marker('claude-b'))).toBe(false);
  });

  it('an API-key lane\'s marker survives a clean spawn, and expires when its key file is rewritten — no probe measures it', () => {
    // `ccrc account add` writes an OpenRouter or compatible lane as `generated`,
    // telemetry `anthropic`, secretsFile `.cc-secrets/<id>-<provider>.env`.
    // `ccd-account-health` only ever sources `.cc-secrets/<id>-oauth.env`, so it
    // REFUSES this lane and never clears its marker: what ends one is a rewrite of
    // the key file, or an operator `rm`. A 401 on an API key is an invalid key.
    seedAccountsSh(home, { ...DEFAULT_TEST_ROSTER, accounts: [...DEFAULT_TEST_ROSTER.accounts, {
      id: 'orl', label: 'orl', configDirSuffix: '.claude-orl',
      exec: { kind: 'generated', provider: 'openrouter', secretsFile: '.cc-secrets/orl-openrouter.env' },
      homeAble: true, hue: 'amber', telemetry: 'anthropic',
    }] });
    seedOn('claude-demo', 'orl');
    const key = cred('.cc-secrets/orl-openrouter.env', 'export ANTHROPIC_AUTH_TOKEN=fixture\n');
    const verdict = ctimeS(key) + 1;                  // written after the key, as a rescue's would be
    mark('orl', `${verdict} rescue-401`);
    settle('claude-demo', 0);
    expect(fs.existsSync(marker('orl')), 'a clean spawn is no evidence on an API key either').toBe(true);
    expect(ok('_authdead orl')).toBe(true);
    // The key is replaced the way `ccrc account credential` does it (tmp + rename),
    // strictly after the verdict's second.
    while (Date.now() < verdict * 1000 + 50) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    const tmp = path.join(home, '.cc-secrets', 'orl-openrouter.env.tmp');
    fs.writeFileSync(tmp, 'export ANTHROPIC_AUTH_TOKEN=fixture-2\n');
    fs.renameSync(tmp, key);
    expect(ok('_authdead orl')).toBe(false);
    expect(fs.existsSync(marker('orl'))).toBe(false);
  });

  it('an old accounts.sh with no `_ccrc_secrets_file` is unnameable for a generated lane, so rc 0 clears', () => {
    seedOn('claude-demo', 'claude-a');
    cred('.cc-secrets/claude-a-oauth.env');
    mark('claude-a', `${future()} rescue-401`);
    settle('claude-demo', 0, 'unset -f _ccrc_secrets_file;');
    expect(fs.existsSync(marker('claude-a'))).toBe(false);
  });

  it('an external lane is unnameable even with a `.credentials.json` in its config dir, so rc 0 clears', () => {
    seedOn('claude-demo', 'gpt');
    cred('.claude-gpt/.credentials.json', '{}\n');
    mark('gpt', `${future()} rescue-401`);
    settle('claude-demo', 0);
    expect(fs.existsSync(marker('gpt'))).toBe(false);
  });

  it('a symlinked or non-regular credential source is unnameable, so rc 0 clears', () => {
    const real = cred('elsewhere/claude-a-oauth.env');
    fs.mkdirSync(path.join(home, '.cc-secrets'), { recursive: true });
    fs.symlinkSync(real, path.join(home, '.cc-secrets', 'claude-a-oauth.env'));
    seedOn('claude-demo', 'claude-a');
    mark('claude-a', `${future()} rescue-401`);
    settle('claude-demo', 0);
    expect(fs.existsSync(marker('claude-a')), 'a symlink').toBe(false);
    fs.unlinkSync(path.join(home, '.cc-secrets', 'claude-a-oauth.env'));
    execFileSync('mkfifo', [path.join(home, '.cc-secrets', 'claude-a-oauth.env')]);
    mark('claude-a', `${future()} rescue-401`);
    settle('claude-demo', 0);
    expect(fs.existsSync(marker('claude-a')), 'a FIFO').toBe(false);
  });

  it('an epoch too long to compare is unmeasurable, so rc 0 keeps the old rule and clears', () => {
    // 25 digits: bash arithmetic would wrap it (to 1590897978359414783, measured)
    // and call the credential "unchanged" for good. Bounded at 18 digits, it is
    // answer 2 instead — nobody can say — which is the old rc-0 clear.
    seedOn('claude-demo', 'claude-a');
    cred('.cc-secrets/claude-a-oauth.env');
    mark('claude-a', '9999999999999999999999999 auth-401');
    settle('claude-demo', 0);
    expect(fs.existsSync(marker('claude-a'))).toBe(false);
  });

  it('leaves every OTHER account\'s marker standing', () => {
    seedOn('claude-demo', 'claude-a');
    mark('claude-a', '1757203200 auth-401');
    mark('claude-b', '1757203200 auth-401');
    settle('claude-demo', 0);
    expect(fs.existsSync(marker('claude-b'))).toBe(true);
  });

  it('does NOT clear on rc 2 — "waiting for login" is the opposite of evidence', () => {
    seedOn('claude-demo', 'claude-a');
    mark('claude-a', '1757203200 auth-401');
    settle('claude-demo', 2);
    expect(fs.existsSync(marker('claude-a'))).toBe(true);
  });

  it('does NOT clear on rc 5 — hard-blocked at startup, which includes lost auth', () => {
    seedOn('claude-demo', 'claude-a');
    mark('claude-a', '1757203200 auth-401');
    settle('claude-demo', 5);
    expect(fs.existsSync(marker('claude-a'))).toBe(true);
  });
});

// THE CARRIED RESIDUE OF D-3522, replayed the way it was first measured (a
// fixture HOME on the tree's ccd, 2026-09-28): a rescue off a 401 writes the
// marker and moves S away; ANOTHER session's clean spawn on the dead account —
// rc 0, because 2.1.280 draws its prompt on a dead token — wiped it; and the next
// home decision sent S straight back to the 401. One bounce per wipe, per rescued
// session homed on the account. Measured before the fix: step 3 `marker: WIPED`,
// step 4 `[claude]`.
describe('the carried loop: another session\'s clean spawn on a dead account no longer sends the rescued one back (D-3524)', () => {
  const ROW = (at: number): string => JSON.stringify({
    parentUuid: 'p', isSidechain: false, type: 'assistant', uuid: 'e1', timestamp: new Date(at * 1000).toISOString(),
    message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: 'Please run /login · API Error: 401 OAuth token has expired.' }] },
    isApiErrorMessage: true, error: 'authentication_failed', apiErrorStatus: 401,
  });
  /** tmux answers a prompt pane, a wide pane and `$BORN` for `session_created`;
   *  the dispatch is recorded rather than run. No real tmux or systemd. */
  const STUBS = `
    tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; case "$*" in *pane_active*) echo "1 200"; return 0 ;; esac
      case "\${1:-}" in capture-pane) printf '%s\\n' '? for shortcuts' '❯ ' ;; list-panes) echo 4242 ;; display-message) echo "$BORN" ;; esac; return 0; };
    _pane_box_draft() { :; }; _route_degrade_at_move() { return 0; };
    _dispatch_swap() { echo "dispatch $1 -> $2" >> "$HOME/ccd-calls"; };`;
  const seedRow = (id: string, uuid: string): void => {
    sh(`_reg_set ${id} wrapper claude; _reg_set ${id} home claude; _reg_set ${id} project demo
        _reg_set ${id} workdir "$HOME/projects/demo"; _reg_set ${id} uuid ${uuid}; _reg_set ${id} started 1`);
  };

  it('rescue writes the marker; a clean spawn of another session on the account keeps it; the home arm still refuses', () => {
    fs.mkdirSync(path.join(home, 'projects', 'demo'), { recursive: true });
    writeLimits('claude', 5, 5);           // home: cheapest, and a 401 writes no telemetry
    writeLimits('claude-a', 10, 10);
    writeLimits('claude-b', 10, 10);
    seedRow('s1', '11111111-0000-4000-8000-000000000001');
    seedRow('t1', '22222222-0000-4000-8000-000000000002');
    // The account's credential, untouched since long before the verdict: written
    // first, and the pane born after it (a file's ctime cannot be set back).
    const src = cred('.cc-secrets/claude-oauth.env');
    const BORN = nowS() + 30;
    const t = sh('_transcript_path s1');
    fs.mkdirSync(path.dirname(t), { recursive: true });
    fs.writeFileSync(t, [JSON.stringify({ type: 'user', uuid: 'u1', timestamp: 't', message: { role: 'user', content: 'go' } }), ROW(BORN + 30)].join('\n') + '\n');
    pastCtimeSecond(src);

    // 1. the rescue: s1's own process wrote the 401, so it moves and marks.
    sh(`${STUBS} _auto_swap_check s1`, { BORN: String(BORN) });
    const moved = h.calls().filter((l) => l.startsWith('dispatch s1 -> '));
    expect(moved, 'the rescue dispatched s1 off its dead home').toHaveLength(1);
    const dest = moved[0]!.replace('dispatch s1 -> ', '');
    expect(dest).not.toBe('claude');
    expect(fs.readFileSync(marker('claude'), 'utf8')).toMatch(/^\d+ rescue-401$/);
    sh(`_reg_set s1 wrapper ${dest}`);

    // 2. t1, idle on the same dead account, restarts: 2.1.280 reaches rc 0.
    sh(`_accept_first_run_prompts() { return 0; }; _tmux() { echo t; }; _inject_spawn_effort() { :; };`
      + ' _lc_done() { :; }; _spawn_settle t1 "" || true');
    expect(fs.existsSync(marker('claude')), 'the clean spawn kept the marker').toBe(true);

    // 3. s1's next home decision: its home is still auth-dead, so it stays away.
    expect(sh(`_swap_target s1 ${dest} claude || true`)).not.toBe('claude');
  });
});

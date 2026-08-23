// server/test/ccd-actor-flags.test.ts
//
// Wave 5 — the `--surface`/`--actor`/`--reason` flag loops on the five
// non-deleting workspace verbs, and wave 5's pins over the three validators
// WAVE 3 ships (`_LC_DEC_MAX`, `_lc_surface_norm`, `_lc_dec_ok`). Two file-
// local helpers are declared here for Tasks 45-49 to append tests around:
// `shFail` and `seedWorkspace`. Their signatures are fixed by Task 44 (this
// task) and may not change downstream.
//
// Properties pinned below, MEASURED against `ccd/ccd` as shipped (not assumed
// from this task's own brief — see the GAP note below, where the brief's own
// prose turned out to be wrong):
//
//   1. GIVENNESS IS NOT SOMETHING `_lc_surface_norm` ITSELF DISTINGUISHES.
//      Measured against wave 3 as shipped (`ccd:1511`) and against its own
//      authoring brief (task-16-brief.md's own pin: `_lc_surface_norm ""` ->
//      `''`, `_lc_surface_norm` with no argument -> `''`): a call with NO
//      argument and a call with an EXPLICIT empty-string argument both answer
//      `''` — `[[ -n "${1-}" ]]` cannot tell "unset" from "set-to-empty"
//      apart. `unknown` is reserved for a genuinely unrecognised WORD (`zzz`,
//      or the literal `none`, which is the ABSENT-marker word itself and so a
//      word this ccd does not accept as a value). A caller that wants
//      "--surface absent" and "--surface ''" to read differently has to make
//      that distinction ITSELF, with `${var+x}`, before ever calling this
//      helper — that is wave 5's job (Tasks 45-49), not wave 3's.
//   2. THE CAP IS BYTES, AND THE POLICY IS REFUSE. 512 BYTES, never 512
//      characters and never a silent truncation: a 900-byte reason recorded as
//      512 reads as the operator's own words (AUDIT B5).
//   3. ONLY LENGTHS REACH ARITHMETIC. `--actor`/`--reason` are free text off
//      the wire; a hostile argv word must never reach a `(( ))` or an array
//      subscript unmeasured.
//
// GAP FOUND BY THIS TASK, NOT FIXED BY IT (this task writes no bash):
// this task's own Interfaces section describes `_lc_dec_ok` as "exit 0 iff
// <value> is non-blank after a whitespace strip AND at most _LC_DEC_MAX
// bytes" — but that is not what wave 3 shipped, and not what wave 3 was ever
// asked to ship: `_lc_dec_ok`'s own doc comment (`ccd:1527`) is length-only
// ("0 iff it fits _LC_DEC_MAX *BYTES*. Prints nothing."), and its authoring
// brief (task-16-brief.md line 26) specifies the same length-only contract,
// with no blank guard. Measured: `_lc_dec_ok ''` and `_lc_dec_ok '   '` both
// return 0 today. `cmd_ws_hold` (`ccd:3517`) has its OWN, separate
// `[[ -n "${reason//[[:space:]]/}" ]] || die` guard that never routes through
// `_lc_dec_ok` at all; `ws-rm`/`forget` (`ccd:2835`, `ccd:10844`) call ONLY
// `_lc_dec_ok`, so today `--reason ''` on either of those two verbs is
// ACCEPTED, not refused. This is pinned below as what IS true — a future
// change that adds a blank guard to `_lc_dec_ok` (or to each wave-5 verb,
// mirroring `cmd_ws_hold`'s polarity) is expected to break that one
// assertion on purpose. Flagged for the operator in the Task 44 report: this
// needs a ruling before Tasks 45-49's `--reason` loops can claim blank-reason
// refusal on `ws-rm`/`forget` parity grounds.
//
// CONTAINMENT: every ccd call here goes through `h.sh`, so this file spawns no
// bash of its own and `ccd-workspaces.test.ts:1045`'s scan matches nothing in
// it. Snippets that can reach a lifecycle emit site must stub `tmux`
// (HEAD AUDIT w23 M-A) — none in this file do: every snippet below stays
// inside `_lc_surface_norm`/`_lc_dec_ok`/`_reg_set`, none of which reach
// `_lc_obs`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, mkdirSync } from 'node:fs';
import { makeCcdHarness, CCD, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-actorflags-'); });
afterEach(() => { h.cleanup(); });

/** `h.sh` throws on a non-zero exit; this reports the exit code, stdout and
 *  stderr instead, which is what every refusal assertion below needs. */
const shFail = (snippet: string): { code: number; stderr: string; stdout: string } => {
  try { return { code: 0, stderr: '', stdout: h.sh(snippet) }; }
  catch (e) {
    const err = e as { status?: number; stderr?: Buffer; stdout?: Buffer };
    return { code: err.status ?? 1, stderr: String(err.stderr ?? ''), stdout: String(err.stdout ?? '') };
  }
};

/** A workspace row complete enough for the five verbs to get past `no such
 *  session` / `not a workspace` and reach their own bodies — INCLUDING a real
 *  directory at `workdir` on disk, not just registry fields: fix-round-1
 *  finding 1 measured that `cmd_ws_archive` refuses "worktree is gone"
 *  (ccd:3713) before its own body when the directory is absent, which the
 *  doc comment above already promised callers would not have to work around
 *  themselves.
 *
 *  `id` drives `workspace`/`workdir`/`branch`, not just the registry row
 *  key (fix-round-1 finding 2): the id shape this file uses throughout is
 *  `demo-<slug>`, so the slug is `id` with that fixed `demo-` prefix
 *  stripped (or `id` itself, for a caller that passes something else). Two
 *  different ids now seed two INDEPENDENT rows at two independent
 *  directories — `seedWorkspace()` and `seedWorkspace('demo-quiet-basin-2')`
 *  no longer alias one `workdir`, which they did before by accident of both
 *  being hardcoded to the same literal path. */
const seedWorkspace = (id = 'demo-quiet-basin'): string => {
  const slug = id.startsWith('demo-') ? id.slice('demo-'.length) : id;
  const workdir = `${h.home}/worktrees/demo/${slug}`;
  mkdirSync(workdir, { recursive: true });
  h.sh(`_reg_set ${id} uuid 72be9ee2-0000-4bcc-b60b-0cfc0dc3d199
    _reg_set ${id} project demo
    _reg_set ${id} workspace ${slug}
    _reg_set ${id} workdir ${workdir}
    _reg_set ${id} branch ws/${slug}
    _reg_set ${id} wrapper claude`);
  return id;
};

describe('_lc_surface_norm — ccd:619 closed set, spelled once more and never a third time', () => {
  it.each(['cli', 'pwa', 'agent', 'ccd'])('passes %s through unchanged', (word) => {
    expect(h.sh(`_lc_surface_norm ${word}`)).toBe(word);
  });

  it('answers `unknown` for a word outside the set', () => {
    // Independent claims — expect.soft, per the standing rule (RULE 1).
    expect.soft(h.sh(`_lc_surface_norm zzz`)).toBe('unknown');
    // `none` is the ABSENT marker a CALLER writes for itself downstream, so a
    // caller that literally passes the word `none` has said a word this ccd
    // does not know as a surface — not "no flag".
    expect.soft(h.sh(`_lc_surface_norm none`)).toBe('unknown');
  });

  it("answers empty for BOTH no argument and an explicit empty-string argument — givenness is the CALLER's distinction, not this helper's", () => {
    // See property 1 in the file header. Independent claims — expect.soft.
    expect.soft(h.sh(`_lc_surface_norm ''`)).toBe('');
    expect.soft(h.sh(`_lc_surface_norm`)).toBe('');
  });

  it('never dies — it is called inside $( ), where a die kills only the subshell', () => {
    // `ccd-die-containment.test.ts:350` is the standing guard; this is the
    // behavioural half for the one helper wave 5 wraps in a substitution.
    expect(h.sh(`x=$(_lc_surface_norm zzz); printf 'AFTER:%s' "$x"`)).toBe('AFTER:unknown');
  });
});

describe('_lc_dec_ok — length only: BYTES, and the policy is REFUSE, never truncate', () => {
  it('accepts ordinary free text', () => {
    expect(shFail(`_lc_dec_ok 'device:Mozilla/5.0 (iPhone)'`).code).toBe(0);
  });

  it('measures BYTES, not characters — and REFUSES rather than truncating', () => {
    // AUDIT B5: one number, one unit, one policy. Independent claims —
    // expect.soft. 512 one-byte characters sits at the cap and is accepted;
    // 513 is refused.
    expect.soft(shFail(`_lc_dec_ok "$(printf 'a%.0s' {1..512})"`).code).toBe(0);
    expect.soft(shFail(`_lc_dec_ok "$(printf 'a%.0s' {1..513})"`).code).not.toBe(0);
    // 200 four-byte characters = 800 BYTES but only 200 CHARACTERS. A character
    // cap would accept this and hand `_lc_json` an 800-byte field — over a
    // third of `LC_LINE_MAX` spent on one declaration.
    expect.soft(shFail(`_lc_dec_ok "$(printf '\\U0001F600%.0s' {1..200})"`).code).not.toBe(0);
  });

  it('accepts blank and whitespace-only values today — see the GAP note in the file header', () => {
    // Pinned as what IS true (measured, and matching task-16-brief.md's own
    // length-only contract for this helper), not what this task's Interfaces
    // section aspirationally describes. Independent claims — expect.soft.
    expect.soft(shFail(`_lc_dec_ok ''`).code).toBe(0);
    expect.soft(shFail(`_lc_dec_ok '   '`).code).toBe(0);
    expect.soft(shFail(`_lc_dec_ok "$(printf '\\t')"`).code).toBe(0);
  });

  it('prints nothing and never dies on refusal — the refusal belongs to the VERB', () => {
    const r = shFail(`_lc_dec_ok "$(printf 'a%.0s' {1..513})"; printf 'AFTER:%s' "$?"`);
    expect.soft(r.code).toBe(0);
    expect.soft(r.stdout).toBe('AFTER:1');
  });

  it('never evaluates the value — only its length reaches an arithmetic context', () => {
    const canary = `${h.home}/pwned`;
    expect.soft(shFail(`_lc_dec_ok 'x[$(touch ${canary})]'`).code).toBe(0);
    expect.soft(shFail(`_lc_dec_ok '$(touch ${canary})'`).code).toBe(0);
    expect.soft(h.sh(`[[ -e '${canary}' ]] && echo yes || echo no`)).toBe('no');
  });

  it('scopes its byte measurement — the caller keeps counting what it counted', () => {
    // AUDIT M2: an absolute `4` here is environment-dependent. Measured on this
    // box: `LANG=en_US.UTF-8` -> 4, `env -u LANG -u LC_ALL bash` -> 5, and
    // `makeCcdHarness` inherits `process.env`, so the answer depended on
    // whoever launched vitest. The PROPERTY is that `_lc_dec_ok`'s
    // `local LC_ALL=C` is restored when the local goes out of scope, so the pin
    // is BEFORE == AFTER, under a locale this snippet sets itself.
    const out = h.sh(
      `LC_ALL=C.UTF-8; s=$'caf\\u00e9'; before=\${#s}; _lc_dec_ok "$s"; after=\${#s}; `
      + `printf '%s %s' "$before" "$after"`);
    const [before, after] = out.split(' ');
    expect.soft(after, 'the helper leaked its LC_ALL into the caller').toBe(before);
    expect.soft(before, 'under the locale this snippet pinned, and only there').toBe('4');
  });
});

describe('the closed set is spelled exactly twice in ccd', () => {
  it('appears at _ws_unsupervise and in _lc_surface_norm, and nowhere else', () => {
    // ONE more copy than shipped, deliberately, and never a third. Five inline
    // `case "$surface" in cli|pwa|agent|ccd)` copies — one per wave-5 verb — is
    // the drift shape `wsaudit.test.ts` exists to catch, one language over: a
    // fifth surface word added to `_ws_unsupervise` and to four of the five
    // verbs is green everywhere and wrong on one verb forever.
    const hits = readFileSync(CCD, 'utf8').split('\n')
      .filter((l) => l.includes('cli|pwa|agent|ccd'));
    expect(hits, `the closed set is spelled ${hits.length} times:\n${hits.join('\n')}`)
      .toHaveLength(2);
  });
});

/** Stubs every irreversible thing `cmd_ws_archive` does, so these cases measure
 *  ARGV PARSING and nothing else. `tmux` is stubbed for wave 2's `_lc_obs`
 *  (HEAD AUDIT w23 M-A) — without it these snippets shell the live tmux.
 *  `seedWorkspace` itself now creates `workdir` on disk (fix-round-1 finding
 *  1), so no task-local `mkdir -p` belongs here any more. */
const ARCHIVE_STUBS = `tmux() { return 1; }; _ws_unsupervise() { :; };
  _ws_idle_ok() { return 0; }; _ws_status() { echo idle; }; _ws_archive_manifest() { echo '{}'; };`;

describe('ws-archive accepts the dec flags in any position', () => {
  it.each([
    ['before the required flag', `--surface pwa --session ID`],
    ['after the required flag',  `--session ID --surface pwa`],
    ['in the --flag=value form', `--session ID --surface=pwa`],
    ['with all three flags',     `--session ID --surface pwa --actor 'device:iPhone' --reason 'tidy'`],
  ])('parses --surface %s', (_name, tail) => {
    const id = seedWorkspace();
    expect(shFail(`${ARCHIVE_STUBS} cmd_ws_archive ${tail.replace('ID', id)} >/dev/null`).code).toBe(0);
  });

  it('treats a blank --surface as a word it does not know, never as no flag', () => {
    // GAP FOUND BY THIS TASK: the brief's own text asserts `_lc_surface_norm
    // ''` returns `unknown` — measured false (D-200): the bare helper answers
    // EMPTY for both "no argument" and an explicit blank (pinned already in
    // the `_lc_surface_norm` describe block above), which is exactly why
    // givenness has to be resolved in THIS flag loop, not by re-deriving it
    // from the bare helper. So this probes `cmd_ws_archive`'s own
    // function-local `lc_surface` instead of calling `_lc_surface_norm`
    // directly: `_ws_archive_manifest` is dynamically scoped under bash, so a
    // stub that runs where `cmd_ws_archive` calls it can see the caller's
    // `local lc_surface` and echo it out. Task 49 has not wired an emit site
    // yet, so this is the only way to observe the value this task computes.
    // `--surface ''` is ACCEPTED (a caller may honestly not know its own
    // surface) and normalises to `unknown`. What it must never do is
    // normalise to `none`, which is the marker for "no flag was given at
    // all".
    const id = seedWorkspace();
    expect(shFail(`${ARCHIVE_STUBS} cmd_ws_archive --session ${id} --surface '' >/dev/null`).code).toBe(0);
    // A FRESH id: the call above already wrote `$REG/$id.archived`, and
    // `cmd_ws_archive`'s own early-return for an already-archived session
    // sits before `_ws_archive_manifest` is ever reached — a second call on
    // the same id would never fire the probe below.
    //
    // The probe writes to a FILE, not stdout: `manifest=$(_ws_archive_manifest
    // "$id")` captures every line the stub prints, so an extra echo on stdout
    // becomes part of the manifest and fails ccd's own JSON parse.
    const id2 = seedWorkspace('demo-quiet-basin-2');
    const PROBE = `_ws_archive_manifest() { printf '%s' "$lc_surface" > "$HOME/probe-surface"; echo '{}'; };`;
    h.sh(`${ARCHIVE_STUBS} ${PROBE} cmd_ws_archive --session ${id2} --surface ''`);
    expect(readFileSync(`${h.home}/probe-surface`, 'utf8')).toBe('unknown');
  });

  it('refuses a --surface with no value rather than looping forever', () => {
    // `shift 2` past the end of argv FAILS under `set -uo pipefail` with no
    // `-e`: it shifts nothing and the loop never terminates (ccd:9610-9612 says
    // so about `cmd_stop`'s identical loop).
    const id = seedWorkspace();
    const r = shFail(`${ARCHIVE_STUBS} cmd_ws_archive --session ${id} --surface`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('usage: ccd ws-archive');
  });

  it('refuses a blank --actor, and an over-long one, naming the flag', () => {
    const id = seedWorkspace();
    const blank = shFail(`${ARCHIVE_STUBS} cmd_ws_archive --session ${id} --actor ''`);
    expect(blank.code).not.toBe(0);
    expect(blank.stderr).toContain('--actor');
    const long = shFail(
      `${ARCHIVE_STUBS} cmd_ws_archive --session ${id} --actor "$(printf 'a%.0s' {1..513})"`);
    expect(long.code).not.toBe(0);
    expect(long.stderr).toContain('--actor');
  });

  it('still refuses extra positionals — the arity rule survives the strip', () => {
    const id = seedWorkspace();
    const r = shFail(`${ARCHIVE_STUBS} cmd_ws_archive --session ${id} extra`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('usage: ccd ws-archive --session <id>');
  });
});

/** Stubs enough of `cmd_ws_restore` for the flag-parsing/refusal cases below,
 *  none of which reach past the reap-lock acquisition (`ccd:4200`) — every
 *  case here either refuses inside the wave-5 loop or refuses at the
 *  pre-existing `no-such-session` check a few lines later, both well above
 *  the lock. `flock` is stubbed because the real one needs a lock FILE this
 *  harness has no reason to create for a case that never reaches it. */
const RESTORE_STUBS = `tmux() { return 1; }; flock() { return 0; };
  _ws_supervise() { :; }; _spawn() { :; };`;

describe('ws-restore takes the same three flags, and refuses through _lc_refuse', () => {
  it('refuses a valueless --surface with its OWN usage sentence', () => {
    const id = seedWorkspace();
    const r = shFail(`${RESTORE_STUBS} cmd_ws_restore --session ${id} --surface`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('usage: ccd ws-restore');
  });

  it('refuses a blank --actor, naming the flag', () => {
    const id = seedWorkspace();
    const r = shFail(`${RESTORE_STUBS} cmd_ws_restore --session ${id} --actor ''`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('--actor');
  });

  it('refuses a blank --reason, naming the flag — the same non-blank check as --actor', () => {
    // `_lc_dec_ok` is length-only (D-200, ccd:1527) and returns 0 for '', so
    // it cannot be the blank guard on its own — this verb needs its OWN
    // non-blank check ahead of `_lc_dec_ok`, mirroring `--actor` above and
    // `cmd_ws_hold` (ccd:3517). Not in the brief's own step-2 sample, added
    // here because the brief's --actor check and this one are one guard
    // copied twice; a mutant on one without a test on the other would ship a
    // silent asymmetry between the two flags.
    const id = seedWorkspace();
    const r = shFail(`${RESTORE_STUBS} cmd_ws_restore --session ${id} --reason ''`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('--reason');
  });

  it('binds the real session id from CLEANED argv, not a flag value ahead of --session', () => {
    // GAP FOUND BY THIS TASK, against the brief's own placement: unlike
    // `cmd_ws_archive` (Task 45), whose `local id=$2` runs AFTER its arity
    // check, `cmd_ws_restore`'s `local id="${2-}"` was ALREADY the first
    // statement in this function's body before wave 5 touched it, and that
    // one binding is reused through the bad-session-id/no-such-session checks
    // a few lines below. The brief's literal instruction — insert "immediately
    // above the arity refusal", read as between `local id="${2-}"` and the
    // `[[ $# -eq 2 ... ]]` check — would have left `id` bound from RAW,
    // flag-polluted argv: `--surface pwa --session <id>` would have captured
    // `id=pwa` (the word AFTER `--surface`, since that is `$2` before the loop
    // ever strips it) and then refused a legitimate restore as
    // `no-such-session: pwa` once the flags were gone from argv. This task's
    // block sits BEFORE `local id="${2-}"` instead, so the assignment reads
    // the CLEANED `$2`.
    //
    // Mutant: move the wave-5 block back below `local id="${2-}"` (the
    // brief's literal placement) — this assertion goes red, reporting
    // `no such session: pwa` instead of naming the id that was actually
    // asked for. See task-46-report.md.
    const r = shFail(`${RESTORE_STUBS} cmd_ws_restore --surface pwa --session totally-bogus-id`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('no such session: totally-bogus-id');
    expect(r.stderr).not.toContain('no such session: pwa');
  });

  it('adds NO bare `die "` to a body wave 3 scans', () => {
    // The mechanism, not the instance: `ccd-refusal-scan.test.ts` slices
    // `cmd_ws_restore` and requires every fatal refusal in it to go through
    // `_lc_refuse`, so that a destroyed-or-refused act leaves a record. This
    // assertion is the local half, so the failure names THIS task's block
    // rather than arriving as a scanner red four files away.
    const src = readFileSync(CCD, 'utf8');
    const from = src.indexOf('\ncmd_ws_restore() {');
    const to = src.indexOf('\ncmd_ws_attic() {', from);
    expect(from, 'cmd_ws_restore was not found').toBeGreaterThan(-1);
    expect(to, 'cmd_ws_attic was not found — the slice has no end').toBeGreaterThan(from);
    const body = src.slice(from, to).split('\n');
    expect(body.length, 'the slice collapsed').toBeGreaterThan(50);
    const bare = body.filter((l) => /\bdie "/.test(l) && !/^\s*#/.test(l))
      .filter((l) => l.includes('--surface') || l.includes('--actor') || l.includes('--reason'));
    expect(bare, `wave-5 flag refusals must ride _lc_refuse:\n${bare.join('\n')}`).toEqual([]);
  });
});

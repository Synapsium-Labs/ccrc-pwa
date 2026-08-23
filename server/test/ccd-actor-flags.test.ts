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
import { readFileSync } from 'node:fs';
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
 *  session` / `not a workspace` and reach their own bodies. */
const seedWorkspace = (id = 'demo-quiet-basin'): string => {
  h.sh(`_reg_set ${id} uuid 72be9ee2-0000-4bcc-b60b-0cfc0dc3d199
    _reg_set ${id} project demo
    _reg_set ${id} workspace quiet-basin
    _reg_set ${id} workdir ${h.home}/worktrees/demo/quiet-basin
    _reg_set ${id} branch ws/quiet-basin
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
 *  MEASURED GAP: `seedWorkspace`'s own doc comment promises a row "complete
 *  enough … to reach their own bodies", but it writes only registry fields —
 *  it never creates `workdir` on disk, and `cmd_ws_archive` (ccd:3690s)
 *  refuses with "worktree is gone" before its own body when the directory is
 *  absent. `seedWorkspace`'s signature/semantics are the fixed interface
 *  Tasks 46-49 build on, so the `mkdir -p` lives HERE, task-local, rather
 *  than inside it. */
const ARCHIVE_STUBS = `tmux() { return 1; }; _ws_unsupervise() { :; };
  mkdir -p "$HOME/worktrees/demo/quiet-basin";
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

// Projects a parsed `Roster` (shared/roster.ts) into the bash `ccd` sources
// at runtime — the file body for `~/.ccrc/accounts.sh`. Task 4 wraps this
// output with the provenance marker; this module only emits the body.
//
// Plain, dependency-free ESM — not TypeScript — because `deploy/deploy.sh`
// (Task 10) runs this generator with a bare `node`: no build step, no
// `tsx`, no compiled `dist/`. Writing this in TS would either add a build
// dependency to the deploy path or force a second, hand-copied emitter —
// which is exactly the drift Stage 2a exists to kill. Types live alongside
// in the hand-written `shared/generate.d.mts`.
//
// `roster` is consumed structurally (a plain object with `accounts`,
// `homeAble`, `byIdLengthDesc`, `upstreamId`), never imported as a type —
// there is no build step here, so there is nothing to import against at
// runtime.
//
// Two different embedding contexts, two different escaping rules:
//
//  - Account `id`s are emitted RAW, with no quoting at all — as bash array
//    elements, as `case` patterns, and as the value of `CCRC_UPSTREAM`.
//    `shared/roster.ts`'s `ID_RE` (`^[a-z][a-z0-9-]{0,31}$`) already limits
//    every id to letters, digits and hyphens: no whitespace, no glob
//    metacharacters, nothing a shell treats specially, so quoting would add
//    nothing. It would actively break one guarantee this file must uphold:
//    `_ccrc_id_wrapper`'s case arms are matched by the test suite as bare
//    `id-*)` text (`/^[a-z0-9-]+-\*\)/`), and a case *pattern* quoted with
//    `'...'` is legal bash but no longer matches that assertion.
//  - Account `hue`s are emitted raw for the same reason ids are: `parseRoster`
//    narrows every hue to one of the six words in `HUES` before this function
//    can see it, and none of them contains a shell metacharacter.
//  - `configDirSuffix` AND `label` are embedded inside a double-quoted string
//    (`"$HOME/<suffix>"`, `echo "<label>"`), where `$`, `` ` `` and `"` are
//    still live to the shell. `dqEscape` below backslash-escapes exactly the
//    characters that are special inside a double-quoted bash string, so a
//    suffix containing one can never break out of the string or trigger
//    expansion. It is a no-op for every suffix in the fixture roster (`.a`,
//    `.ab`, `.abc` contain none of those characters), so it changes nothing
//    about the brief's example output while closing a real gap for any
//    suffix that does.
//
//    `label` is the LOOSER of the two and the reason this matters in
//    practice: `parseRoster` requires only that it be a non-empty string
//    with no control characters, so `$(id)` or a bare `"` is a perfectly
//    valid label — and `_ccrc_label` is sourced by
//    `ccd/statusline-command.sh` on every status-bar render, under whatever
//    account is running. Without `dqEscape` a label would be a command
//    substitution executing in every Claude Code session on the box.
//
//    `shared/roster.ts`'s `parseRoster` ALSO now rejects a `configDirSuffix`
//    containing anything outside a conservative safe set (letters, digits,
//    `.`, `-`, `_`) — do not read that as making `dqEscape` redundant and
//    delete it. `generateAccountsSh` consumes a `Roster` structurally (see
//    above: no import, no runtime check that its argument ever passed
//    through `parseRoster`), so the parser's gate protects only rosters
//    that were actually parsed by it. `dqEscape` is what protects this
//    function itself, for every caller — including one that builds a
//    `Roster`-shaped object by hand, the way
//    `server/test/roster-generate.test.ts`'s hostile-payload case
//    deliberately does. Two independent locks on one door, on purpose.

/**
 * Backslash-escapes the characters that are still live inside a
 * double-quoted bash string (`\`, `"`, `$`, and `` ` ``), so the result can
 * be embedded between double quotes without escaping the quote itself or
 * triggering command/parameter substitution.
 *
 * @param {string} s
 * @returns {string}
 */
function dqEscape(s) {
  return s.replace(/[\\"$`]/g, '\\$&');
}

/**
 * Bash array literal `(a b c)` from a list of already ID_RE-validated ids —
 * left unquoted; see the file header for why that is safe here.
 *
 * @param {readonly string[]} ids
 * @returns {string}
 */
function idArray(ids) {
  return `(${ids.join(' ')})`;
}

/**
 * Generates the body of `~/.ccrc/accounts.sh` from a parsed roster.
 * Returns the file body only — no provenance marker (Task 4 adds that).
 *
 * `$HOME` is emitted UNEXPANDED inside every `_ccrc_cfg_dir` case body: the
 * generated file resolves `$HOME` against whatever process sources it, not
 * against the machine that ran this generator. Both installer test suites
 * relocate `HOME` to a tmpdir, and ccd's own header documents `$HOME` as the
 * single isolation boundary the test harness sets — a generator that baked
 * in the generating machine's home would pass locally and write to the
 * wrong directory everywhere else.
 *
 * `_ccrc_cfg_dir` has no default `case` arm: an unknown id must answer
 * empty at exit 0, matching today's hand-written `_cfg_dir` contract
 * exactly. Five of its six call sites in `ccd` depend on that silence —
 * they either return early on empty output or build a path from it that
 * then fails to `stat`. A default arm, or a non-zero exit, would change
 * ccd's control flow at every one of those sites.
 *
 * `_ccrc_id_wrapper` arms are emitted from `roster.byIdLengthDesc` —
 * longest id first, `id` ascending as the tie-break (that ordering is
 * `shared/roster.ts`'s job, not re-derived here) — so a shorter id that is
 * a textual prefix of a longer one can never match first. Unlike
 * `_ccrc_cfg_dir`, it DOES have a default arm: `echo "$CCRC_UPSTREAM"`, so a
 * session id matching no known account still resolves to the upstream
 * account rather than to nothing.
 *
 * THAT ORDERING IS THE WHOLE POINT OF EMITTING THIS FUNCTION, and it is worth
 * recording what it cost when the arms were hand-written in `ccd` instead.
 * Bash `case` takes the FIRST arm that matches, never the longest, so
 * `claude-corp-*` and `claude-dev0-*` had to be kept above the shorter
 * `claude-*` by hand. When `claude-dev0` arrived the hand-written comment
 * beside those arms said "longest match wins" — which is false, and which
 * would have invited a maintainer to sort the arms alphabetically and make
 * `claude-dev0-*` dead code. The failure that follows is silent: every dev0
 * id resolves to `claude`, so `_home_for` reports the wrong home and
 * `_swap_target`'s "home recovered" branch permanently evacuates every dev0
 * session, with no error printed anywhere. Emitting the arms in
 * length-descending order makes that a property of this function rather than
 * of the care taken by the last person to touch a `case` statement — and it
 * is why `server/test/roster-generate.test.ts` asserts the BEHAVIOUR of the
 * generated bash (a prefix-colliding roster of `a`, `a-b`, `a-b-c` resolving
 * correctly) rather than the literal arm text.
 *
 * ── `_ccrc_dir_id`, `_ccrc_label`, `_ccrc_hue`, `CCRC_MEASURED` ──
 *
 * The four emissions that finished what stage 2a started. Their one consumer
 * is `ccd/statusline-command.sh`, which until they existed held the LAST
 * hand-written copy of the roster in the tree — four literal `case` arms
 * mapping a config dir to an account, and four more mapping it to a label and
 * a colour. An account those arms did not name got no `~/.cc-limits/<id>.json`
 * written for it, ever, and `projectHome`'s "unknown is not zero" rule then
 * ranked it below every measured account for good: a free-form account that
 * was silently never placed and never rescued. Free-form ids were half
 * delivered for exactly as long as that map was hand-kept.
 *
 * `_ccrc_dir_id` runs the map BACKWARDS — `"$HOME/<suffix>"` → id — which is
 * the direction a statusline needs, because Claude Code hands its hook a
 * `CLAUDE_CONFIG_DIR` and nothing else. Its patterns are DOUBLE-QUOTED, so
 * `$HOME` still expands but the expansion is matched literally rather than as
 * a glob; `_ccrc_cfg_dir`'s arms are bare ids and need no such quoting. It
 * shares that function's other contract exactly — no default arm, so an
 * unrecognised config dir answers empty at exit 0 and the caller decides what
 * that means.
 *
 * Arm ORDER is irrelevant here, unlike `_ccrc_id_wrapper`'s: these patterns
 * are whole literal strings, not prefixes, so nothing can shadow anything.
 * That holds only because `parseRoster` now rejects two accounts sharing one
 * `configDirSuffix` — with duplicates permitted, `_ccrc_dir_id` would resolve
 * a shared dir to whichever account this emitter happened to write first, and
 * a bash `case` arm order is the last place anyone would look for the reason
 * one account's telemetry vanished. Declaration order is used for all three
 * of these purely so the generated file reads in roster order.
 *
 * `CCRC_MEASURED` is `telemetry === 'anthropic'`, the accounts that report
 * rate limits. It exists so the statusline never writes a `~/.cc-limits` row
 * for an account the roster says has no such telemetry (`gpt`) — the file
 * would be indistinguishable from a real measurement and would hand
 * `projectHome` the fake zero that `telemetry: 'none'` was added to prevent.
 * Emitted as an array beside `CCRC_HOME_ABLE` rather than as a fifth
 * function, because membership is the only question anyone asks of it.
 *
 * @param {import('./roster.js').Roster} roster
 * @returns {string}
 */
export function generateAccountsSh(roster) {
  const ids = roster.accounts.map((a) => a.id);
  const homeAbleIds = roster.homeAble.map((a) => a.id);
  const measuredIds = roster.accounts.filter((a) => a.telemetry === 'anthropic').map((a) => a.id);

  const cfgArms = roster.byIdLengthDesc
    .map((a) => `    ${a.id}) echo "$HOME/${dqEscape(a.configDirSuffix)}" ;;`)
    .join('\n');

  const wrapperArms = roster.byIdLengthDesc
    .map((a) => `    ${a.id}-*) echo ${a.id} ;;`)
    .join('\n');

  const dirIdArms = roster.accounts
    .map((a) => `    "$HOME/${dqEscape(a.configDirSuffix)}") echo ${a.id} ;;`)
    .join('\n');

  // `printf '%s\\n'`, not `echo`, and ONLY here. Bash's `echo` builtin eats a
  // first argument made entirely of `-` followed by `n`/`e`/`E` and treats it
  // as options, printing nothing: `_ccrc_label` for a label of `-n` returns the
  // empty string, and the statusline renders a nameless account. `parseRoster`
  // accepts `-n` — a label is validated only as a non-empty string with no
  // control characters, which is the right rule for display text.
  //
  // Every OTHER arm in this file keeps `echo`, because none of them can produce
  // that shape: ids and `CCRC_UPSTREAM` are `ID_RE`-constrained to a leading
  // lowercase LETTER, hues are one of six literal words, and `_ccrc_cfg_dir`'s
  // bodies always contain a `/`.
  const labelArms = roster.accounts
    .map((a) => `    ${a.id}) printf '%s\\n' "${dqEscape(a.label)}" ;;`)
    .join('\n');

  const hueArms = roster.accounts
    .map((a) => `    ${a.id}) echo ${a.hue} ;;`)
    .join('\n');

  return `#!/usr/bin/env bash
# Generated from ~/.ccrc/accounts.json. Do not edit — \`ccrc install\` rewrites it.
CCRC_ACCOUNTS=${idArray(ids)}
CCRC_HOME_ABLE=${idArray(homeAbleIds)}
CCRC_MEASURED=${idArray(measuredIds)}
CCRC_UPSTREAM=${roster.upstreamId}
_ccrc_cfg_dir() {
  case "$1" in
${cfgArms}
  esac
}
_ccrc_id_wrapper() {
  case "$1" in
${wrapperArms}
    *) echo "$CCRC_UPSTREAM" ;;
  esac
}
_ccrc_dir_id() {
  case "$1" in
${dirIdArms}
  esac
}
_ccrc_label() {
  case "$1" in
${labelArms}
  esac
}
_ccrc_hue() {
  case "$1" in
${hueArms}
  esac
}
`;
}

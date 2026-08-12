// Cross-language fixture test — increment 1a of
// docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md. It drives
// ccd's bash against a TypeScript roster and demands they agree.
//
// THIS FILE IS ON ITS WAY OUT, and knows it. The roster it used to compare
// against — `shared/api.ts`'s `ACCOUNTS` — was deleted in Task 6 of the
// stage-2a plan, because the roster is runtime data now
// (`~/.ccrc/accounts.json`). Task 8 then made ccd SOURCE the generated
// projection of it (`~/.ccrc/accounts.sh`, which `makeCcdHarness` writes into
// every fixture home), so ccd no longer keeps copies at all: `VALID_WRAPPERS`
// is gone, `_is_valid_wrapper` iterates `CCRC_ACCOUNTS`, and `_cfg_dir` /
// `_id_wrapper` are one-line delegates to generated functions. What is left
// for this file to compare is therefore a generated bash roster against a
// hand-written TypeScript one — the same roster twice, which is why Task 9
// rewrites it into a round-trip with no literal on either side and deletes
// `ccdMirror.ts` with it.
//
// Until that lands, what stops the two drifting is still a test that RUNS the
// bash and checks its answers, every suite run, rather than a comment asking a
// future author not to.
//
// EVERY comparison below is bidirectional (a `toEqual` between two sets),
// not "each roster member gets a matching ccd answer" — that weaker form was
// this file's own first draft, and it has a hole: it only ever asks ccd
// about wrappers the mirror already knows, so a lane ccd grew on its own was
// invisible to it. That used to be a live hazard — the established idiom for
// adding an opt-in lane was a literal appended after `${VALID_WRAPPERS[@]}`
// plus new `_cfg_dir`/`_id_wrapper` case arms, per `gpt`'s own precedent —
// and it is now structurally impossible, because there is nowhere in ccd to
// append one. The bidirectional form stays anyway: it is what NOTICES that,
// and one of the describes below asserts that the tail after
// `${CCRC_ACCOUNTS[@]}` is empty for exactly that reason. Every describe
// PARSES OR ENUMERATES ccd's own answer space — the full arm set of a case
// statement, the full token list of a for loop — and compares that set, both
// directions, against `WRAPPERS.filter(w => CCD_MIRROR[w]!.ccdValid)` (or
// `.homeAble`).
//
// `_ccrc_cfg_dir`, `_ccrc_id_wrapper`, `CCRC_HOME_ABLE` and
// `_is_valid_wrapper` are
// executed for real, via the isolated-HOME `sh()` idiom every other ccd test
// file in this directory uses (see ccdWsHelpers.ts's own docstring for why
// HOME is the isolation boundary and `cwd: home` matters). Where a function's
// full answer SPACE (not just its answer to one input) is needed, `declare -f
// <name>` dumps its body as text and the case-statement arms are parsed out
// of that dump — still executed bash, just read back rather than probed input
// by input.
//
// `statusline-command.sh`'s two label maps are the one entry here that truly
// CANNOT be usefully executed in a fixture test: the script reads its own
// process's `CLAUDE_CONFIG_DIR` env var (there is no argv to point it at a
// fixture HOME) and needs JSON piped to its stdin to produce anything at
// all. Per this project's own instruction ("if a bash copy cannot be
// executed safely in a test, assert on its parsed source text instead and
// SAY SO") it gets a parsed-source-text pin below instead — a bidirectional
// set comparison, same as every other describe in this file.
//
// `install-session-hooks.sh`'s and `install-coordinator-skill.sh`'s default
// `homes` arrays were NOT in that category — an earlier version of this
// comment claimed they were, and their own behavioural tests disproved it —
// and the question has since dissolved: both installers source the same
// generated roster ccd does, so there is no array left to parse. See the note
// where the two parsed-source describes used to be, further down.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CCD_MIRROR, CCD_MIRROR_NAMES } from './fixtures/ccdMirror.js';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ccrcRoot = path.resolve(here, '..', '..');
const WRAPPERS = CCD_MIRROR_NAMES;

/** Set equality for two string lists, order-independent and dedup'd — every
 *  comparison in this file is "the same SET", never "the same order", since
 *  bash's case-arm declaration order and the mirror's declaration order have
 *  no reason to agree (and `VALID_WRAPPERS`'s own describe below, which DOES
 *  care about order, uses a plain `toEqual` instead). */
const sortedSet = (xs: readonly string[]): string[] => [...new Set(xs)].sort();

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-wrapper-roster-'); });
afterEach(() => { h.cleanup(); });

describe('ccd CCRC_HOME_ABLE agrees with CCD_MIRROR.homeAble', () => {
  it('is exactly the home-able wrappers, in roster declaration order', () => {
    // Was `VALID_WRAPPERS`, a literal in ccd, until ccd started sourcing the
    // generated `~/.ccrc/accounts.sh` the harness writes. Declaration ORDER is
    // still asserted (a plain toEqual, not a set): `_ws_least_loaded`'s
    // tie-break is a strict `<`, so the first home-able account wins a tie,
    // and two other suites pin that as `claude`.
    const got = h.sh('echo "${CCRC_HOME_ABLE[@]}"').split(/\s+/).filter(Boolean);
    const want = WRAPPERS.filter((w) => CCD_MIRROR[w]!.homeAble);
    expect(got).toEqual(want);
  });
});

describe('ccd _is_valid_wrapper agrees with CCD_MIRROR.ccdValid', () => {
  it('accepts exactly the ccd-valid wrappers, and rejects every other one', () => {
    // roster -> ccd: every wrapper the mirror knows gets asked, and its answer
    // must match `.ccdValid`. This alone is the weaker, one-directional form
    // (see file header) — the set-equality test right below is what closes
    // the other direction.
    for (const w of WRAPPERS) {
      const ok = h.sh(`_is_valid_wrapper '${w}' && echo yes || echo no`) === 'yes';
      expect(ok, w).toBe(CCD_MIRROR[w]!.ccdValid);
    }
  });

  it("ccd -> roster: _is_valid_wrapper's own accepted set is exactly the mirror's ccd-valid set", () => {
    // `_is_valid_wrapper`'s body used to be `for v in "${VALID_WRAPPERS[@]}"
    // gpt; do ... done` — the home-able array plus literal EXTRAS appended
    // after it, the established idiom for adding an opt-in ccd-valid lane —
    // and this parsed that tail to catch a lane ccd grew that the roster never
    // heard of. It now iterates CCRC_ACCOUNTS, which comes from the roster, so
    // the tail must be EMPTY: a literal appended here would be exactly the
    // copy this whole change removed.
    const body = h.sh('declare -f _is_valid_wrapper');
    const m = /for v in "\$\{CCRC_ACCOUNTS\[@\]\}"([^;]*);/.exec(body);
    expect(m, "_is_valid_wrapper's `for v in \"${CCRC_ACCOUNTS[@]}\";` line").not.toBeNull();
    const extras = (m as RegExpExecArray)[1].trim().split(/\s+/).filter(Boolean);
    expect(extras, 'a literal wrapper name appended after the roster array').toEqual([]);
    const got = sortedSet(h.sh('echo "${CCRC_ACCOUNTS[@]}"').split(/\s+/).filter(Boolean));
    const want = sortedSet(WRAPPERS.filter((w) => CCD_MIRROR[w]!.ccdValid));
    expect(got).toEqual(want);
  });
});

describe('ccd _cfg_dir agrees with CCD_MIRROR.configDirSuffix', () => {
  it('maps every ccd-valid wrapper onto the roster\'s own config dir, and nothing onto the rest', () => {
    // `_cfg_dir` is a delegate to the generated `_ccrc_cfg_dir`, whose case
    // statement has one arm per ROSTERED account and no default arm — so an id
    // the roster does not name echoes nothing at exit 0. That silence, not a
    // thrown error, is exactly what `configDirFor` (server/src/config.ts)
    // treats as "answer undefined", and what five of `_cfg_dir`'s six call
    // sites in ccd depend on.
    for (const w of WRAPPERS) {
      const got = h.sh(`_cfg_dir '${w}'`);
      const want = CCD_MIRROR[w]!.ccdValid ? path.join(h.home, CCD_MIRROR[w]!.configDirSuffix) : '';
      expect(got, w).toBe(want);
    }
  });

  it('answers an unrostered wrapper with empty stdout at exit 0, through the delegate', () => {
    // The silence above, asserted where ccd actually calls it. Every id in
    // `WRAPPERS` is rostered, so the loop never exercises the no-arm path and
    // the `: ''` branch of its `want` is dead — this is the case that walks
    // it. Exit 0 is half the contract: `_ws_status` and `_transcript_path`
    // read the empty ANSWER, not a failure, and `set -uo pipefail` would not
    // save a call site that assumed otherwise.
    expect(h.sh("_cfg_dir 'no-such-account' && echo RC0")).toBe('RC0');
  });

  it("ccd -> roster: _cfg_dir's own case-arm set is exactly the mirror's ccd-valid set", () => {
    // Every arm in `_cfg_dir`'s case statement is a BARE wrapper name
    // (`claude)`, `claude2)`, ... — never a `-*)` glob, that's `_id_wrapper`'s
    // shape below — so the pattern word IS the wrapper name directly.
    // Anchored to a whole trimmed line (`declare -f` puts one case arm per
    // line) so this can never also match an `echo "$HOME/..."` body line.
    // `_ccrc_cfg_dir`, not `_cfg_dir`: ccd's own function is a one-line
    // delegate now, and the `case` it delegates to is generated from the
    // roster into `~/.ccrc/accounts.sh`. Still `declare -f`, still executed
    // bash, just one name further in.
    const body = h.sh('declare -f _ccrc_cfg_dir');
    const arms = [...body.matchAll(/^\s*([a-z][a-z0-9-]*)\)\s*$/gm)].map((m) => m[1]);
    expect(arms.length).toBeGreaterThan(0); // the parse itself must find something, or this vacuously passes
    const got = sortedSet(arms);
    const want = sortedSet(WRAPPERS.filter((w) => CCD_MIRROR[w]!.ccdValid));
    expect(got).toEqual(want);
  });
});

describe('ccd _id_wrapper agrees with CCD_MIRROR.idPrefix, for the wrappers ccd knows', () => {
  it('resolves a synthetic id under each ccd-valid wrapper\'s idPrefix to that wrapper', () => {
    for (const w of WRAPPERS) {
      if (!CCD_MIRROR[w]!.ccdValid) continue; // ccd's own case statement has no branch for this one — see below
      const id = `${CCD_MIRROR[w]!.idPrefix}fixture-slug`;
      expect(h.sh(`_id_wrapper '${id}'`), w).toBe(w);
    }
  });

  it("ccd -> roster: _id_wrapper's own set of possible answers is exactly the mirror's ccd-valid set", () => {
    // Each `-*)` arm's body is `echo <wrapper>` on the very next line — that
    // echoed token, not the glob prefix, is ccd's actual ANSWER for an id
    // shaped that way, so it's what this compares against the roster (rather
    // than relying on every `idPrefix` happening to equal `wrapper + '-'`,
    // which is true of every member today but isn't a rule this file should
    // assume elsewhere).
    // `_ccrc_id_wrapper` for the same reason `_cfg_dir` became
    // `_ccrc_cfg_dir` above. Its generated default arm (`*) echo
    // "$CCRC_UPSTREAM"`) does not match this pattern — the glob must start
    // with a lowercase id — so it stays out of the answer set, which is
    // right: it names no account of its own.
    const body = h.sh('declare -f _ccrc_id_wrapper');
    const arms = [...body.matchAll(/^\s*[a-z][a-z0-9-]*-\*\)\s*\n\s*echo\s+(\S+)\s*$/gm)].map((m) => m[1]);
    expect(arms.length).toBeGreaterThan(0);
    const got = sortedSet(arms);
    const want = sortedSet(WRAPPERS.filter((w) => CCD_MIRROR[w]!.ccdValid));
    expect(got).toEqual(want);
  });

  // The bash-side twin of the exact bug `idHomeWrapper` (server/src/fleet.ts)
  // guards against. `claude-dev0-` is a strict extension of `claude-`, and a
  // bash `case` takes the FIRST arm that matches, not the longest — so the
  // `claude-dev0-*)` arm only works while it sits ABOVE `claude-*)`. Move it
  // below and every dev0 id silently comes back `claude`, re-attributing a
  // whole account's sessions with no error anywhere.
  //
  // This case used to assert the opposite (ccd was silent on claude-dev0, and
  // an id under that prefix resolved to `claude`) and was written to go red
  // the day ccd learned the account. That day has come: dev0 is home-able and
  // ccd-valid, so ccd mints `claude-dev0-*` ids for real and this pins the
  // ARM ORDER that keeps them attributed correctly.
  it('matches claude-dev0-* before the shorter claude-*, never attributing a dev0 id to claude', () => {
    expect(CCD_MIRROR['claude-dev0']!.ccdValid).toBe(true);
    const id = `${CCD_MIRROR['claude-dev0']!.idPrefix}fixture-slug`;
    expect(h.sh(`_id_wrapper '${id}'`)).toBe('claude-dev0');
  });
});

// Architecture doc increment 2 — "the hooks install lane derives its homes
// from the roster" — used to be pinned HERE, by parsing each installer's
// literal `homes=(...)` fallback with `/else homes=\(([^)]*)\); fi/` and
// comparing it against `CCD_MIRROR.hooksAble`. Both describes are gone
// because both literals are: each installer now sources the same generated
// `~/.ccrc/accounts.sh` ccd does and covers every rostered account, so there
// is no array to parse and no `hooksAble` subset to compare against. The
// claim did not weaken — it moved to the behavioural pins that already
// existed beside it (`install-session-hooks.test.ts`,
// `install-coordinator-skill.test.ts`, both "default homes are the roster,
// behaviourally"), which run each installer with no `--homes` argv against a
// fixture HOME and now also assert that a box with NO roster is refused by
// name rather than silently installing nowhere.

// I8: `REQUIRED_REFS` (install-coordinator-skill.sh) is the OTHER hardcoded
// literal this installer carries, and it exists for exactly the failure mode
// this file's own header describes for `homes=(...)` — a literal array is a
// PROJECTION of something real that a future change can silently drift away
// from, and "a comment asking a future author to keep them in sync" is not a
// mechanism. Here the real thing is not the roster but the filesystem itself:
// `REQUIRED_REFS` names the `references/*.md` files a partial rsync (the
// specific hazard its own script comment names — SKILL.md sorts before
// `references/`, so an interrupted `rsync -az --delete` can land SKILL.md
// with an incomplete or absent `references/`) must NOT be allowed to ship
// without. A fifth reference file landing under `references/` with no
// matching `REQUIRED_REFS` entry would make the guard silently optional for
// it — exactly the half-installed shape the guard exists to refuse — and
// nothing before this test would have noticed.
describe('install-coordinator-skill.sh REQUIRED_REFS agrees with the real references/ directory (I8)', () => {
  it('names exactly the .md files that live under ccd/coordinator-skill/references/ today', () => {
    const src = readFileSync(path.join(ccrcRoot, 'ccd', 'install-coordinator-skill.sh'), 'utf8');
    const m = /REQUIRED_REFS=\(([^)]*)\)/.exec(src);
    expect(m, "install-coordinator-skill.sh's REQUIRED_REFS=(...) line").not.toBeNull();
    const declared = sortedSet((m as RegExpExecArray)[1].trim().split(/\s+/).filter(Boolean));
    const actual = sortedSet(
      readdirSync(path.join(ccrcRoot, 'ccd', 'coordinator-skill', 'references'))
        .filter((n) => n.endsWith('.md')),
    );
    expect(actual.length).toBeGreaterThan(0); // the parse itself must find something, or this vacuously passes
    expect(declared).toEqual(actual);
  });
});

// Also gone with them: the `ccdValid ⊆ hooksAble` invariant (fix, review
// finding 15). It existed because the two sets were kept by different hands —
// `hooksAble` by the installers' literal arrays, `ccdValid` by ccd's own
// `VALID_WRAPPERS` plus its appended literals — so nothing stopped an account
// ccd could place a session on from being absent from the installers' lists,
// leaving the coordinator on a home with no `skills/ccrc-coordinator` (Build 7
// operator ruling 2 places it like any other session, with no pinned account).
// One roster now feeds ccd's placement AND both installers, so the subset
// relation is not an invariant to check but an identity: every account ccd can
// place on is a rostered account, and the installers cover the roster.

describe('ccd statusline-command.sh label maps agree with CCD_MIRROR', () => {
  // Not executed — this file's own header names it (not the two installers
  // above, which DO get a real subprocess pin now) as the one genuine
  // "cannot be usefully executed in a fixture test" case: the script
  // needs a real CLAUDE_CONFIG_DIR (it reads its OWN process's env, not an
  // argv) plus a JSON stdin payload to produce anything at all. Parses the
  // two `case "$cfg" in ... esac` blocks instead — one picks the human-facing
  // `acct=` label (segment 0, the account chip), the other the `lbl=`
  // filename fragment `~/.cc-limits/<lbl>.json` is written under.
  //
  // Both are verbatim duplicates of roster fields for the home-able three:
  // `configDirSuffix -> label` for `acct=`, `configDirSuffix -> the roster
  // KEY itself` for `lbl=`. `lbl=` is the load-bearing one — `lbl=""` (the
  // `*)` fallback) skips the telemetry write entirely, so a home-able account
  // missing from this map reports no usage, ever. Until Stage 2a's Task 6 that
  // was a magnet: `projectHome` (server/src/limits.ts) scored an unmeasured
  // account 0, so the `+` button projected every new workspace onto the one
  // account nobody could see, forever. Unknown now ranks BELOW every measured
  // account, which inverts the failure rather than removing it — such an
  // account is now the LAST one placement will ever choose, and is placed on
  // only when nothing at all has reported. Either way this map is what decides
  // whether an account is visible to the routing rule at all.
  const src = readFileSync(path.join(ccrcRoot, 'ccd', 'statusline-command.sh'), 'utf8');
  const wantSuffixes = sortedSet(
    WRAPPERS.filter((w) => CCD_MIRROR[w]!.homeAble).map((w) => CCD_MIRROR[w]!.configDirSuffix));
  const suffixToWrapper = new Map(WRAPPERS.map((w) => [CCD_MIRROR[w]!.configDirSuffix, w] as const));

  it('the acct= display-label map (segment 0) covers exactly the home-able config dirs, with matching labels', () => {
    const arms = [...src.matchAll(/"\$HOME\/([^"]+)"\)\s+acct="([^"]*)"\s*;;/g)]
      .map((mm) => [mm[1], mm[2]] as const);
    expect(arms.length).toBeGreaterThan(0);
    expect(sortedSet(arms.map(([suffix]) => suffix))).toEqual(wantSuffixes);
    for (const [suffix, raw] of arms) {
      const w = suffixToWrapper.get(suffix);
      expect(w, suffix).toBeDefined();
      // Strip the ANSI colour wrapper (`${CYAN}...${RESET}`) — the label
      // text itself is what must match the roster, not the colour it's
      // painted in (that's `colorVar`, a PWA-only concern with no bash twin).
      const label = raw.replace(/^\$\{[A-Z]+\}/, '').replace(/\$\{RESET\}$/, '');
      expect(label, suffix).toBe(CCD_MIRROR[w!]!.label);
    }
  });

  it('the lbl= telemetry-filename map covers exactly the home-able config dirs, with lbl equal to the roster key', () => {
    const arms = [...src.matchAll(/"\$HOME\/([^"]+)"\)\s+lbl="([^"]*)"\s*;;/g)]
      .map((mm) => [mm[1], mm[2]] as const);
    expect(arms.length).toBeGreaterThan(0);
    expect(sortedSet(arms.map(([suffix]) => suffix))).toEqual(wantSuffixes);
    for (const [suffix, lbl] of arms) {
      expect(lbl, suffix).toBe(suffixToWrapper.get(suffix));
    }
  });
});

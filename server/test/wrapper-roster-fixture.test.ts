// Cross-language fixture test — increment 1a of
// docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md. It drives
// ccd's bash against a TypeScript roster and demands they agree.
//
// THIS FILE IS ON ITS WAY OUT, and knows it. The roster it used to compare
// against — `shared/api.ts`'s `ACCOUNTS` — was deleted in Task 6 of the
// stage-2a plan, because the roster is runtime data now
// (`~/.ccrc/accounts.json`). ccd's bash does not read it until Task 8, and
// this file is rewritten in Task 9 into a round-trip that GENERATES the bash
// from a roster and executes it, with no literal on either side. Until then it
// compares ccd's hand-written arrays and case arms against
// `test/fixtures/ccdMirror.ts`, a literal transcription of the same five
// accounts — because the thing on the other side of the comparison is still a
// literal, and the guarantee is worth keeping alive in the meantime.
//
// So: ccd keeps its own copies (`_cfg_dir`, `_id_wrapper`, `VALID_WRAPPERS`,
// `_is_valid_wrapper`) for now, and what stops the two drifting apart is a
// test that RUNS the bash and checks its answers, every suite run, rather than
// a comment asking a future author not to.
//
// EVERY comparison below is bidirectional (a `toEqual` between two sets),
// not "each roster member gets a matching ccd answer" — that weaker form was
// this file's own first draft, and it has a hole: it only ever asks ccd
// about wrappers the mirror already knows, so a lane ccd grows on its own
// (`_is_valid_wrapper`'s established idiom is a literal appended after
// `${VALID_WRAPPERS[@]}`, plus new `_cfg_dir`/`_id_wrapper` case arms, per
// `gpt`'s own precedent — never touching `VALID_WRAPPERS` itself) is invisible
// to it. Every describe below instead PARSES OR ENUMERATES ccd's own answer
// space — the full arm set of a case statement, the full token list of a for
// loop — and compares that set, both directions, against
// `WRAPPERS.filter(w => CCD_MIRROR[w]!.ccdValid)` (or `.homeAble` /
// `.hooksAble`, per map). A wrapper ccd knows and the roster does not now
// fails exactly as loudly as the reverse.
//
// `_cfg_dir`, `_id_wrapper`, `VALID_WRAPPERS` and `_is_valid_wrapper` are
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
// `homes` arrays are NOT in that category, and an earlier version of this
// comment claimed they were — a claim disproved by this same commit's own
// `install-session-hooks.test.ts` ("...default homes agree with
// CCD_MIRROR.hooksAble, behaviourally") and `install-coordinator-skill.test.ts`
// ("...default homes agree with CCD_MIRROR.hooksAble, behaviourally"): both
// give a fixture HOME a config dir for EVERY roster wrapper first (not "every
// one is skipped when it doesn't exist" — none is absent), run the installer
// with no `--homes` argv (its real default), and assert the managed file
// lands in exactly the `hooksAble` ones. That is a `--homes`-less invocation
// whose effect is fully revealing, and it passes. The two `describe` blocks
// immediately below are a second, cheaper pin on the identical claim — parsed
// source text, no subprocess — not a substitute for one a fixture cannot
// make revealing.
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

describe('ccd VALID_WRAPPERS agrees with CCD_MIRROR.homeAble', () => {
  it('is exactly the home-able wrappers, in roster declaration order', () => {
    const got = h.sh('echo "${VALID_WRAPPERS[@]}"').split(/\s+/).filter(Boolean);
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
    // `_is_valid_wrapper`'s body (ccd:104) is `for v in "${VALID_WRAPPERS[@]}"
    // gpt; do ... done` — VALID_WRAPPERS (home-able) plus zero or more literal
    // EXTRAS appended after it, which is the established, reviewed idiom for
    // adding an opt-in (non-home-able) ccd-valid lane, per `gpt`'s own
    // precedent. Parsing that literal tail — rather than only ever asking
    // `_is_valid_wrapper` about wrappers the mirror already lists — is what
    // catches a lane ccd grows that the roster never heard of.
    const homeAble = h.sh('echo "${VALID_WRAPPERS[@]}"').split(/\s+/).filter(Boolean);
    const body = h.sh('declare -f _is_valid_wrapper');
    const m = /for v in "\$\{VALID_WRAPPERS\[@\]\}"([^;]*);/.exec(body);
    expect(m, "_is_valid_wrapper's `for v in \"${VALID_WRAPPERS[@]}\" ...;` line").not.toBeNull();
    const extras = (m as RegExpExecArray)[1].trim().split(/\s+/).filter(Boolean);
    const got = sortedSet([...homeAble, ...extras]);
    const want = sortedSet(WRAPPERS.filter((w) => CCD_MIRROR[w]!.ccdValid));
    expect(got).toEqual(want);
  });
});

describe('ccd _cfg_dir agrees with CCD_MIRROR.configDirSuffix', () => {
  it('maps every ccd-valid wrapper onto the roster\'s own config dir, and nothing onto the rest', () => {
    // `_cfg_dir`'s case statement has no branch at all for a wrapper ccd
    // does not know about (`claude-dev0` today) — no default arm, so it
    // echoes nothing. That silence, not a thrown error, is exactly what
    // `configDirFor` (server/src/config.ts) treats as "answer undefined".
    for (const w of WRAPPERS) {
      const got = h.sh(`_cfg_dir '${w}'`);
      const want = CCD_MIRROR[w]!.ccdValid ? path.join(h.home, CCD_MIRROR[w]!.configDirSuffix) : '';
      expect(got, w).toBe(want);
    }
  });

  it("ccd -> roster: _cfg_dir's own case-arm set is exactly the mirror's ccd-valid set", () => {
    // Every arm in `_cfg_dir`'s case statement is a BARE wrapper name
    // (`claude)`, `claude2)`, ... — never a `-*)` glob, that's `_id_wrapper`'s
    // shape below — so the pattern word IS the wrapper name directly.
    // Anchored to a whole trimmed line (`declare -f` puts one case arm per
    // line) so this can never also match an `echo "$HOME/..."` body line.
    const body = h.sh('declare -f _cfg_dir');
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
    const body = h.sh('declare -f _id_wrapper');
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

// Architecture doc increment 2: "the hooks install lane derives its homes
// from the roster" — for a bash `homes=(...)` fallback that means "is pinned
// against the roster by this fixture test", not "reads the roster at runtime"
// (Task 8's job, not this file's — see the header). Two scripts now carry that exact
// fallback shape — install-session-hooks.sh and, since PR J's install lane,
// install-coordinator-skill.sh — and both are checked here rather than one
// getting a second, duplicate describe block elsewhere in the tree.
const parseDefaultHomes = (scriptRelPath: string): string[] => {
  const src = readFileSync(path.join(ccrcRoot, ...scriptRelPath.split('/')), 'utf8');
  const m = /else homes=\(([^)]*)\); fi/.exec(src);
  expect(m, `${scriptRelPath}'s default \`homes=(...)\` fallback line`).not.toBeNull();
  return [...(m as RegExpExecArray)[1].matchAll(/"\$HOME\/([^"]+)"/g)].map((mm) => mm[1]!);
};
const wantHooksAbleHomes = WRAPPERS.filter((w) => CCD_MIRROR[w]!.hooksAble).map((w) => CCD_MIRROR[w]!.configDirSuffix);

describe('install-session-hooks.sh default homes agrees with CCD_MIRROR.hooksAble', () => {
  // Not executed — see this file's header. Parses the literal `homes=(...)`
  // array the script falls back to when no `--homes` argv is given.
  it('installs into exactly the hooksAble config dirs, as literal $HOME/<suffix> paths, in roster order', () => {
    expect(parseDefaultHomes('ccd/install-session-hooks.sh')).toEqual(wantHooksAbleHomes);
  });
});

describe('install-coordinator-skill.sh default homes agrees with CCD_MIRROR.hooksAble', () => {
  // Same fixture, same reason — a sixth account with `hooksAble: true` must
  // land in BOTH default lists or it silently keeps its session hooks and
  // loses the coordinator skill (or the reverse), a split nobody would notice
  // outside this test.
  it('installs into exactly the hooksAble config dirs, as literal $HOME/<suffix> paths, in roster order', () => {
    expect(parseDefaultHomes('ccd/install-coordinator-skill.sh')).toEqual(wantHooksAbleHomes);
  });
});

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

// Fix, review finding 15: the two pins directly above (and the behavioural
// one in install-coordinator-skill.test.ts) all key on `hooksAble`, because
// that is the field the installer's `homes=(...)` fallback is actually
// derived from — bash cannot import a TypeScript roster, so this literal
// array is the projection. But the SAFETY property Build 7's operator
// ruling 2 actually depends on ("place the coordinator like any other
// session, no pinned account") is about `ccdValid`: that is the set ccd's
// own `_ws_least_loaded` can ACTUALLY land a session on. Nothing before this
// test asserted `ccdValid ⊆ hooksAble` — the two sets only coincide today
// because every wrapper in the roster happens to carry `hooksAble: true`.
// Add a wrapper with `ccdValid: true, hooksAble: false` (a plausible
// combination — e.g. a managed/corporate profile whose `settings.json` must
// not be touched) and every pin above stays green, because all of them read
// `hooksAble`; `_ws_least_loaded` can still land the coordinator there, on a
// home with no `skills/ccrc-coordinator` at all — no contract, no clause 3
// reap prohibition, no clause 9 `/clear` prohibition.
describe('CCD_MIRROR: ccdValid is a subset of hooksAble (Build 7 operator ruling 2\'s own precondition)', () => {
  it('every wrapper ccd can place a session on also gets the coordinator skill installed', () => {
    for (const w of WRAPPERS) {
      if (!CCD_MIRROR[w]!.ccdValid) continue;
      expect(CCD_MIRROR[w]!.hooksAble,
        `${w} is ccdValid (a placement target) but hooksAble is false — ` +
          '_ws_least_loaded could place the coordinator on a home with no skill installed').toBe(true);
    }
  });
});

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

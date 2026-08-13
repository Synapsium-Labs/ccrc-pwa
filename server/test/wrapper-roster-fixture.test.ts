// Cross-language fixture test — increment 1a of
// docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md. It drives
// ccd's bash against a TypeScript roster and demands they agree.
//
// NOT on its way out any more — an earlier version of this comment said it
// was, on the theory that once ccd stopped keeping its own copies of the
// roster there would be nothing left here worth comparing. That theory was
// half right. The roster this file used to compare against —
// `shared/api.ts`'s `ACCOUNTS` — was deleted in Task 6 of the stage-2a plan,
// because the roster is runtime data now (`~/.ccrc/accounts.json`), and
// Task 8 made ccd SOURCE the generated projection of it
// (`~/.ccrc/accounts.sh`, which `makeCcdHarness` writes into every fixture
// home) instead of keeping copies: `VALID_WRAPPERS` is gone,
// `_is_valid_wrapper` iterates `CCRC_ACCOUNTS`, and `_cfg_dir` / `_id_wrapper`
// are one-line delegates to generated functions. But the describes below
// still earn their keep: they check that ccd's bash answer SPACE — the full
// arm set of a `case` statement, the full token list of a `for` loop — is
// EXACTLY the roster's, in both directions, which "ccd now sources a
// generated file" does not itself guarantee (a generator with a bug and a
// hand-written mirror with the SAME bug would agree with each other forever,
// green). Task 9 adds one more describe, further down, that checks a
// property those four cannot: that the generated bash and the SERVER's own
// TypeScript (`configDirFor`, `idHomeWrapper`) compute the same answer for
// the same input — across a roster built specifically to expose the
// ordering bug this codebase has already shipped once by hand. `ccdMirror.ts`
// stays; see its own header, and the note beside the new describe below, for
// why the round-trip does not make the rest of this file redundant.
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
//
// WHAT THIS FILE ACTUALLY GUARANTEES, STATED PRECISELY — read this before
// trusting a green run here for more than it proves. Before Stage 2a, every
// comparison in this file ran against `shared/api.ts`'s `ACCOUNTS`, the same
// literal the SERVER imported and ran on — so a drift caught here WAS a
// drift in production. That is no longer true. `ACCOUNTS` is gone (Task 6);
// every roster on both sides of every describe below — `CCD_MIRROR` (derived
// from `DEFAULT_TEST_ROSTER`) and the round-trip's two fixture rosters — is
// a roster THIS TEST FILE wrote, never the one a real box boots with. A
// production `~/.ccrc/accounts.json` with a typo'd id, a wrong
// `configDirSuffix`, or a missing account is invisible to every describe ABOVE
// the round-trip, because none of them reads one. What a green run there DOES
// still prove is that the MACHINERY agrees with itself for whatever roster it
// is handed — `generateAccountsSh`, `configDirFor`, `idHomeWrapper`,
// `_is_valid_wrapper`, `_ccrc_cfg_dir` and `_ccrc_id_wrapper` all computing
// the same answer for the same input, including on a roster built to expose
// the one ordering bug this codebase has already shipped by hand once (see
// the round-trip describe below). That is real coverage — it is what stops a
// future edit to any one of those six from silently disagreeing with the
// other five — but it is coverage of the CODE, not of the DATA.
//
// THE ROUND-TRIP IS NOW THE EXCEPTION, and this paragraph used to say so as a
// promise rather than a fact ("the day a test here reads THAT file instead of
// a fixture this file wrote, the guarantee gets its production-drift-detecting
// strength back"). Task 10 put both real rosters in the repo and the
// round-trip below now reads them OFF DISK — `deploy/accounts.default.json`,
// what a fresh install ships, and `deploy/accounts.migration.json`, this
// fleet's five real accounts byte for byte, which is what every box on it gets
// seeded with. A typo in either one is now a red run here, not a crash-looping
// deploy. The adversarial prefix-collision roster stays alongside them: the
// shipped rosters are what ccrc DEPLOYS, the adversarial one is what actually
// exercises the length-descending arm order, and neither substitutes for the
// other.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CCD_MIRROR, CCD_MIRROR_NAMES } from './fixtures/ccdMirror.js';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { seedRoster } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { loadConfig, configDirFor } from '../src/config.js';
import { idHomeWrapper } from '../src/fleet.js';
import { generateAccountsSh } from '../../shared/generate.mjs';

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

// Task 9's own addition, and the reason this file's guarantee-strength
// paragraph up top exists: a ROUND-TRIP, run over two rosters, that never
// touches `makeCcdHarness`/`CCD_MIRROR` at all. Every describe above this one
// asks "does ccd's bash agree with a hand-written side table"; this one asks
// "does the GENERATOR's bash agree with the SERVER's own TypeScript
// (`configDirFor`, server/src/config.ts; `idHomeWrapper`, server/src/fleet.ts)
// for the SAME roster object" — the drift a hand-typed mirror can never
// catch, because a generator with a bug and a mirror with the identical bug
// agree with each other forever, green. It is why `ccdMirror.ts` does not
// become redundant just because this describe exists: this checks
// per-input AGREEMENT between two independent implementations, the four
// describes above check answer-SPACE completeness against `CCD_MIRROR`
// (which the round-trip does not touch at all), and the statusline describe
// below needs `CCD_MIRROR.label`, a concept with no TypeScript twin to
// cross-check against. Three different properties; none subsumes another.
//
// Three rosters, and the last is the point. The first two are the rosters
// this repo SHIPS, read straight off disk (Task 10) rather than transcribed
// into a fixture: `deploy/accounts.default.json` is what a fresh install gets,
// `deploy/accounts.migration.json` is this fleet's five real accounts, and
// `deploy/deploy.sh` seeds a box's `~/.ccrc/accounts.json` from one of them.
// Reading them here is what makes a typo in either a red suite instead of a
// crash-looping service — but neither PROVES the arm ordering, because no two
// ids in either roster share a prefix, so a `case` statement with the WRONG
// arm order (alphabetical, insertion order, anything but length-descending)
// still answers every probe correctly on both, by accident.
// `PREFIX_COLLISION_ROSTER`, below, is built to fail that accident: `a`,
// `a-b` and `a-b-c` are each a strict textual prefix of the next, so an arm
// placed above a longer one that should have sorted first (bash's `case`
// takes the FIRST match, never the longest) mis-resolves a `a-b-c-…` id to
// `a` and this test goes red. It is the adversarial fixture, not the
// production-shaped one, that actually PROVES the length-descending
// ordering `shared/generate.mjs` documents, rather than trusting the
// comment.
//
// ONE bash process per roster, not one per probe. Every account contributes
// two probes (`_ccrc_cfg_dir` and `_ccrc_id_wrapper`), joined into a single
// `;`-separated snippet and run through one `execFileSync` call — the
// per-wrapper describes above already spawn one bash process per input each,
// and a per-account × per-id matrix over two rosters would multiply that
// badly if it followed the same shape.
const PREFIX_COLLISION_ROSTER = {
  version: 1,
  accounts: [
    {
      id: 'a', label: 'A', configDirSuffix: '.a',
      exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic',
    },
    {
      id: 'a-b', label: 'AB', configDirSuffix: '.a-b',
      exec: { kind: 'generated' }, homeAble: true, hue: 'violet', telemetry: 'anthropic',
    },
    {
      id: 'a-b-c', label: 'ABC', configDirSuffix: '.a-b-c',
      exec: { kind: 'generated' }, homeAble: false, hue: 'blue', telemetry: 'none',
    },
  ],
};

/** A roster this repo actually ships, read off disk. Deliberately NOT a
 *  transcription: the whole value of these two cases is that the bytes under
 *  test are the bytes `deploy/deploy.sh` seeds a box with. */
const shippedRoster = (name: string): unknown =>
  JSON.parse(readFileSync(path.join(ccrcRoot, 'deploy', name), 'utf8')) as unknown;

describe('accounts.sh round-trip: the generated bash agrees with the server TypeScript, for real rosters', () => {
  it.each([
    ['the shipped fresh-install default (deploy/accounts.default.json)',
      shippedRoster('accounts.default.json')],
    ["the shipped migration roster (deploy/accounts.migration.json) — today's five real accounts",
      shippedRoster('accounts.migration.json')],
    ['adversarial (ids are strict prefixes of each other)', PREFIX_COLLISION_ROSTER],
  ] as const)('%s: _ccrc_cfg_dir and _ccrc_id_wrapper match configDirFor and idHomeWrapper for every account',
    (_label, spec) => {
      const home = mkTmp('ccrc-roundtrip-');
      seedRoster(home, spec);
      // `loadConfig`, not a bare `parseRoster` call — the same path every
      // server test takes to get a real `CcrcConfig`, so `cfg.roster` is the
      // exact object `configDirFor` and `idHomeWrapper` see in production,
      // not a second parse this test built only for itself.
      const cfg = loadConfig({ CCRC_HOME: home });
      writeFileSync(path.join(home, '.ccrc', 'accounts.sh'), generateAccountsSh(cfg.roster));

      const probes = cfg.roster.accounts.flatMap((a) => [
        `_ccrc_cfg_dir '${a.id}'`,
        `_ccrc_id_wrapper '${a.id}-quiet-basin'`,
      ]);
      const out = execFileSync(
        'bash', ['-c', `source "$HOME/.ccrc/accounts.sh"; ${probes.join('; ')}`],
        { cwd: home, env: { ...process.env, HOME: home }, encoding: 'utf8' },
      ).trim().split('\n');

      cfg.roster.accounts.forEach((a, i) => {
        expect(out[i * 2], `_ccrc_cfg_dir ${a.id}`).toBe(configDirFor(cfg, a.id));
        expect(out[i * 2 + 1], `_ccrc_id_wrapper ${a.id}-quiet-basin`)
          .toBe(idHomeWrapper(cfg.roster, `${a.id}-quiet-basin`));
      });
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

// `statusline-command.sh` used to be pinned here by two parsed-source
// describes, because it held the last hand-written roster copy in the tree:
// one `case "$cfg" in ... esac` mapping a config dir to a display label, and a
// second mapping it to the `~/.cc-limits/<lbl>.json` filename. Those describes
// compared both maps to `CCD_MIRROR`, in both directions, and were the only
// thing keeping four literal arms in step with the roster.
//
// The maps are gone. The script sources the same generated
// `~/.ccrc/accounts.sh` that ccd and both installers do, and asks it
// `_ccrc_dir_id` / `_ccrc_label` / `_ccrc_hue` / `CCRC_MEASURED` — so there is
// no second copy left to agree with, and the drift those describes detected
// cannot occur. Their replacement is not a weaker version of the same check:
// per-input BEHAVIOUR is now proven by executing the real script against a
// fixture HOME (`server/test/statusline-script.test.ts`, which the old
// describes' header called impossible — it is not; the script reads its own
// process env, and `spawnSync` sets that), and what remains worth pinning
// here is the structural claim those tests cannot make from the inside: that
// no account map has come BACK.
//
// That claim is worth a test rather than a comment because the regression is
// so cheap to make. Adding an arm to a `case` in a shell script is the
// obvious local fix for "my new account has no label", it works for the
// author's account, and it silently reintroduces exactly the failure stage 2a
// existed to remove: an account absent from the map is never measured, and
// `projectHome` (server/src/limits.ts) ranks an unmeasured account below every
// measured one, so it is never placed. Silently. Forever.
describe('statusline-command.sh carries no account map of its own', () => {
  const src = readFileSync(path.join(ccrcRoot, 'ccd', 'statusline-command.sh'), 'utf8');

  it('has no `"$HOME/<dir>")` case arm — the shape every hand-written account map took', () => {
    // Both deleted maps, and any third one, are this pattern. The one literal
    // config dir the script may still name is the no-roster fallback
    // (`cfg="$HOME/.claude"`), which is an ASSIGNMENT, not a case arm, and is
    // Claude Code's own default rather than a roster claim.
    const arms = [...src.matchAll(/"\$HOME\/[^"]*"\)/g)].map((m) => m[0]);
    expect(arms, 'a config-dir case arm is back in statusline-command.sh — put the mapping in '
      + 'shared/generate.mjs and read it through ~/.ccrc/accounts.sh instead').toEqual([]);
  });

  it('names no account label and no non-upstream config dir in CODE', () => {
    // `CCD_MIRROR.label`'s last reader, repurposed: these are the strings the
    // script must NOT contain. A label has no other business in a file that
    // gets every display string from the roster.
    //
    // Full-line comments are stripped first, and that is not a loophole — a
    // `case` arm cannot live inside one. It is a necessity: `gpt`'s label IS
    // the string "gpt", which the script's prose names when explaining why a
    // `telemetry: 'none'` account gets no `~/.cc-limits` row. A test that
    // could not tell code from commentary would force that explanation out of
    // the file, which is the opposite of what this file is for. (Trailing
    // comments are deliberately NOT stripped: the script has none carrying an
    // account name, and stripping from a bare `#` would need to know which
    // ones sit inside a string.)
    const code = src.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    for (const w of WRAPPERS) {
      const acct = CCD_MIRROR[w]!;
      expect(code, `statusline-command.sh names ${w}'s label literally`).not.toContain(acct.label);
      // The upstream account's suffix is exempt: `.claude` is the documented
      // fallback for a box with no roster at all.
      if (acct.configDirSuffix !== '.claude') {
        expect(code, `statusline-command.sh names ${w}'s config dir literally`)
          .not.toContain(acct.configDirSuffix);
      }
    }
  });

  it('reads the roster projection instead — the four questions a statusline has', () => {
    expect(src).toContain('.ccrc/accounts.sh');
    for (const q of ['_ccrc_dir_id', '_ccrc_label', '_ccrc_hue', 'CCRC_MEASURED']) {
      expect(src, `statusline-command.sh no longer asks the roster for ${q}`).toContain(q);
    }
  });
});

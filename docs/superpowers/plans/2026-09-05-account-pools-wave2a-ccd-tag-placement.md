# Account pools — wave 2a: the tag on the fleet box, the one predicate, and placement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the project pool tag on the fleet box — its storage, its writer verb, its one reader — give `ccd` the single predicate every account decision will ask, and make fresh placement (`_ws_least_loaded` / `cmd_ws_add`) honour it.

**Architecture:** A project's pool is one file at `$REG/pools/<project>` (a dotless registry subdirectory, spec §4 approach B). `ccd` reads it through exactly one function, `_project_pool_state`, which answers one of four words and never `die`s — it runs inside the long-lived `cmd_supervise` loop. Every decider asks one predicate, `_pool_ok <wrapper> <state-word>`, whose three exit codes (serve / mismatch / undecidable) are what keep "we cannot read the tag" from collapsing into "the project is unconstrained". This wave ships the storage, the verb, the grant, the predicate, fresh placement, the `pools-v1` capability token, the doctor check and the `rehome` lifecycle act. The auto-swap tick, the strand, the crossing marker and the manual verbs are wave 2b's; the server's routes and readers are wave 3's.

**Tech Stack:** bash 5.2 (`ccd/ccd`, `ccd/ccrc-doctor-checks`), TypeScript (`shared/`, `server/src`, `agent/src`, `pwa/src`), vitest, node >= 22.13.0.

**Spec:** `docs/superpowers/specs/2026-09-04-account-pools-design.md`

**Base:** `origin/main` `2b15144e`; branch `ws/amber-summit`

**AGENT-FIRST.** This wave touches `ccd/`. It deploys to the fleet host before the server, always — the ordering is stated in README's "Deploy" section and restated with the exact commands in Task 9. Nothing in this plan runs a deploy; the last task names the two commands for the operator or the coordinator to run.

---

## Global Constraints

Copied from the spec and the repo's `CLAUDE.md`. Every task's requirements implicitly include this section.

- **Fixture HOMEs only.** Every `ccd` test runs under `makeCcdHarness(prefix)` (`server/test/ccdWsHelpers.ts`), whose `$HOME` is a throwaway `mkTmp` directory. `$REG` is `$HOME/.cc-sessions`, so a test that wrote a real tag would retag the live fleet. Never run any `ccd` verb against the live `$HOME`; never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or any `claude-session@*` unit.
- **No account name, pool name, label, host or IP in any shipped source file.** Fixture names only: pools `pool-a` / `pool-b`; projects `demo`, `quiet-basin`, `acct-a-demo`; account ids from `DEFAULT_TEST_ROSTER` (`server/test/helpers.ts:60`) — `claude`, `claude-a`, `claude-b` (label `team·b`), `gpt` (not home-able), `claude-d`. `single-definition.test.ts` and `topology-clean.test.ts` scan the whole tree, docs included.
- **`FLEET_PROTO` stays 1; the wire is additive-only.** This wave adds no wire field at all. A newer peer must tolerate an older peer omitting a field, through a single reader per field.
- **No overloaded null at a seam.** Two conditions a caller handles differently must not collapse to one value. `unreadable` and `malformed` are never folded into `untagged` — folding would silently lift the constraint.
- **Agent-first for `ccd/`.** A change touching `ccd/`, `session-hook.sh` or `ccd/coordinator-skill/` ships to the fleet host before the server.
- **`EXEC_COMMANDS = ['tmux','ccd']` stays closed. No `gh` grant, ever.** The one grant this wave adds is a two-token `ccd` prefix, enrolled in `REQUIRED_VERB_FLAG`.
- **L0 imports nothing.** `shared/*.ts` imports nothing at all, not even `node:*` — the PWA bundles those files. `shared/lifecycle.ts` is L0 and `lifecycle.test.ts` asserts it holds no `import` line.
- **Mutation-table discipline.** Every guard ships WITH a test that goes RED when the guard is deleted or mutated, measured before and after — not asserted in a comment. TDD, red first. Each task below names the exact mutation and the expected red.
- **Deviation numbers come only from the allocator.** This plan's plan-time numbers, D-1665–D-1670, were minted in ONE allocator call and defined in `## Deviations found` at plan commit; where a task records one of them it carries a `LEDGER:` line, or an inline reference, that REFERENCES the number. A deviation found during execution is allocated in its own call at the moment it is found, never taken from a gap in that block.
- **Node floor `>=22.13.0`, identical across the three engines.** Never lower an engine to make `node-floor.test.ts` green.
- **Run a suite in the FOREGROUND, timeout >= 600000 ms**, from inside its package: `cd server && ./node_modules/.bin/vitest run test/<file>.test.ts`. NEVER bare `npx vitest` — it resolves a global copy with no jsdom and falsely reports "no tests". Type-check is each package's `npm run build` (`tsc` for `server`/`agent`, `tsc --noEmit && vite build` for `pwa`); there is no `typecheck` script.
- **Known load flakes** — re-run IN ISOLATION before calling a real break: `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`.

**Wave 1 is a hard prerequisite of Task 1.** This wave's very first test imports `POOL_NAME_RE` from `shared/roster.ts` and `POOL_RULE_CASES` / `POOLED_TEST_ROSTER` from `server/test/fixtures/poolRule.ts`, and `_acct_pool`'s tests need `generateAccountsSh` to emit `_ccrc_pool` into the fixture `accounts.sh`. All three are wave 1's deliverables. **Before Task 1, merge wave 1's branch into `ws/amber-summit` (or rebase this wave onto it) and confirm the three names resolve** — otherwise Task 1's red is a module-resolution error rather than the missing guard, which is not a measurement of anything.

---

## Wave map

| Wave | Plan file |
|---|---|
| 1 — roster field, mirrors, generator, `RosterWire` | `docs/superpowers/plans/2026-09-05-account-pools-wave1-roster.md` |
| **2a — this plan** | `docs/superpowers/plans/2026-09-05-account-pools-wave2a-ccd-tag-placement.md` |
| 2b — auto-swap tick, strand, crossing marker, manual verbs | `docs/superpowers/plans/2026-09-05-account-pools-wave2b-ccd-swap-strand-crossing.md` |
| 3 — server L1/L3, registry, routes, watcher frame, health | `docs/superpowers/plans/2026-09-05-account-pools-wave3-server.md` |
| 4 — PWA | `docs/superpowers/plans/2026-09-05-account-pools-wave4-pwa.md` |
| 5 — README, `CLAUDE.md`, comment corrections | `docs/superpowers/plans/2026-09-05-account-pools-wave5-docs.md` |

The spec's §15 names five waves; the split of its wave 2 into 2a and 2b is D-1670, defined in this plan's `## Deviations found`.

**Consumes (from wave 1):**

- `shared/roster.ts` → `export const POOL_NAME_RE = /^[a-z][a-z0-9-]{0,31}$/;`
- `shared/generate.mjs` `generateAccountsSh` → emits `_ccrc_pool()` ALWAYS (empty `case` when no account is tagged); contract: empty stdout, rc 0, for an untagged or unknown id.
- `server/test/fixtures/poolRule.ts` → `POOL_RULE_CASES: readonly PoolRuleCase[]` (`{ name, accountPool: string | null, project: ProjectPoolWire, expect: 'serve' | 'mismatch' | 'undecidable' }`) and `POOLED_TEST_ROSTER` (`DEFAULT_TEST_ROSTER` with `claude`→`pool-a`, `claude-a`→`pool-a`, `claude-b`→`pool-b`, `gpt`→`null`, `claude-d`→`null`).
- `shared/api.ts` → `ProjectPoolWire` (the type `POOL_RULE_CASES` rows are shaped in).

**Produces (for waves 2b, 3, 4):**

| Name | Home | Contract |
|---|---|---|
| `POOLS_DIR` | `ccd/ccd`, beside `REG=` | `POOLS_DIR="$REG/pools"` — exactly one assignment in the file |
| `POOL_NAME_RE` (bash) | `ccd/ccd`, beside `POOLS_DIR` | `POOL_NAME_RE='^[a-z][a-z0-9-]{0,31}$'` — exactly one assignment in the file |
| `POOL_NAME_RE` (bash) | `ccd/ccrc-doctor-checks`, above `_check_pools` | same bytes, exactly one assignment in that file |
| `_pool_name_valid <v>` | `ccd/ccd` | rc 0/1 via `[[ "${1-}" =~ $POOL_NAME_RE ]]` |
| `_project_pool_state <project>` | `ccd/ccd`, beside `_lane_enabled` | stdout one of `named <n>` \| `untagged` \| `unreadable` \| `malformed`; ALWAYS rc 0; never `die`s |
| `_acct_pool <wrapper>` | `ccd/ccd`, beside `_is_home_able` | stdout the account's pool name or empty; ALWAYS rc 0; silent over an `accounts.sh` with no `_ccrc_pool` |
| `_pool_ok <wrapper> <state-word>` | `ccd/ccd`, beside `_acct_pool` | rc 0 serve / 1 mismatch / 2 undecidable |
| `_ws_least_loaded [project]` | `ccd/ccd:3530` | optional positional; zero-arg unchanged; empty stdout = no placement |
| `cmd_project_pool` + dispatcher arm `project-pool)` | `ccd/ccd` | `ccd project-pool --project <p> --pool <name>` \| `--clear` |
| `pools-v1` | `ccd/ccd` `cmd_caps`, after `echo actor-flags-v1` | the capability token wave 3 gates `--cross-pool` argv on |
| `POOLS_CAP` | `server/src/ccdargv.ts`, beside `ACTOR_FLAGS_CAP` | `export const POOLS_CAP = 'pools-v1';` |
| `CCD_ARGV.projectPoolSet(project, pool)` | `server/src/ccdargv.ts` | `['project-pool','--project',p,'--pool',pool]` |
| `CCD_ARGV.projectPoolClear(project)` | `server/src/ccdargv.ts` | `['project-pool','--project',p,'--clear']` |
| `POOLS_DIR_NAME` | `server/src/pools.ts` (NEW) | `export const POOLS_DIR_NAME = 'pools';` — wave 3 fills the rest of the file |
| `rehome` | `_LC_ACTS` (`ccd/ccd`), `LifecycleAct` + `LIFECYCLE_ACT_MAP` (`shared/api.ts`), `ACT_WORD` (`pwa/src/session/journalWords.ts`) | the lifecycle act wave 2b's re-seed and `cmd_prefer` journal |
| `project-pool-tag` | `shared/lifecycle.ts` `LIFECYCLE` | pattern `O`, `collector: null`, ruling text verbatim from spec §9 |

**Explicitly NOT this wave** (do not build them here): `_strand_mark` / `_strand_clear` / `_strand_why`, `$REG/<id>.crosspool`, `--cross-pool` on any verb, `CCD_SWAP_AUTO`, `_swap_target`'s and `_auto_swap_check`'s insertions, `CCD_ARGV.swapCross` / `startCross` / `enableCross`, `POST /api/projects/:project/pool`, `server/src/poolrule.ts`, `readProjectPools`, any `shared/api.ts` wire type, any PWA component.

---

## Task 1: The tag's home — `POOLS_DIR`, `POOL_NAME_RE`, `_pool_name_valid`, `_project_pool_state`, and the parity pin

**Files:**
- Modify: `ccd/ccd:765-771` (constants beside `REG=`)
- Modify: `ccd/ccd:1024-1028` (the two new functions beside `_lane_enabled`)
- Create: `server/src/pools.ts`
- Create: `server/test/pool-name-parity.test.ts`
- Create: `server/test/ccd-project-pool.test.ts` (the reader half; Task 3 appends the verb half)

**Interfaces:**
- Consumes: `POOL_NAME_RE: RegExp` from `shared/roster.ts` (wave 1).
- Produces:
  - bash `POOLS_DIR="$REG/pools"`, `POOL_NAME_RE='^[a-z][a-z0-9-]{0,31}$'`
  - bash `_pool_name_valid <value>` → rc 0 when the value matches, 1 otherwise
  - bash `_project_pool_state <project>` → stdout exactly one of `named <name>` / `untagged` / `unreadable` / `malformed`; rc always 0
  - `export const POOLS_DIR_NAME = 'pools';` from `server/src/pools.ts`

**Spec:** §5.4.1 (storage), §5.4.3 (the reader, body verbatim), §8 (single definition: one TS regex, one bash literal, pinned by text extraction), §10 (the legacy-row guard).

**Mutation table:**
- Row 5 — bash literals equal the TS literals. Goes red when either literal drifts or is duplicated: the parity test asserts EXACTLY ONE `POOL_NAME_RE=` and EXACTLY ONE `POOLS_DIR=` in `ccd/ccd`, and compares each to `POOL_NAME_RE.source` / `POOLS_DIR_NAME`.
- Row 10 — four-word reader, never dies. Goes red when any arm folds into another, when the `-n "$1"` guard is removed, or when a `die` is introduced.

**LEDGER:** the pool-name grammar and the `pools` directory name each exist in two languages, and the tree has no structural way to hold two hand-written spellings equal — `ccd/ccrc-wrapper-shape:67` already keeps an unpinned bash copy of `shared/roster.ts`'s `ID_RE` and says so ("Kept here, not derived from the TypeScript"). `pool-name-parity.test.ts` is the mechanism that makes the pool pair's agreement measured rather than remembered (D-1665 — spec §12 P-12).

- [ ] **Step 1: Write the failing test — the parity pin**

Create `server/test/pool-name-parity.test.ts`:

```ts
// The pool vocabulary is spelled once per LANGUAGE and the spellings are held
// equal HERE, because they cannot be held equal structurally: `ccd/ccd` sources
// nothing from this repository, and `ccd/ccrc-doctor-checks` is sourced under
// `set -u` by things that are not `ccrc` (`ccrc-doctor.test.ts`'s `tableNames()`
// does exactly that), so neither can import a TypeScript constant. This is the
// `CCRC_RC_FILE` mechanism from `single-definition.test.ts`, applied to the two
// values the pool design puts in two languages: the NAME GRAMMAR and the
// DIRECTORY NAME.
//
// The precedent this improves on is `ccd/ccrc-wrapper-shape:67`, which holds a
// hand-written bash copy of `shared/roster.ts`'s `ID_RE` and discloses that
// nothing pins it. These two are pinned.
//
// EXACTLY ONE occurrence each, not "at least one": a second assignment in the
// same file is the drift this exists to refuse, and a scan that took the first
// match would not see it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { POOL_NAME_RE } from '../../shared/roster.js';
import { POOLS_DIR_NAME } from '../src/pools.js';
import { CCD } from './ccdWsHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ccrcRoot = path.resolve(here, '..', '..');
const ccdSrc = readFileSync(CCD, 'utf8');

/** The single capture, with the count asserted first — a helper rather than a
 *  repeated three-line block, because this file makes the same claim about
 *  three literals in two files. */
const exactlyOne = (src: string, re: RegExp, what: string): string => {
  const all = [...src.matchAll(re)];
  expect(all.length, `${what}: expected exactly one occurrence, found ${all.length}`).toBe(1);
  return all[0]![1]!;
};

describe('the pool-name grammar is one grammar in two languages', () => {
  it('guards the guard: the TypeScript regex is the anchored shape it claims to be', () => {
    // A `POOL_NAME_RE` that had become `//` would make every comparison below
    // pass against an empty bash literal.
    expect(POOL_NAME_RE.source.startsWith('^')).toBe(true);
    expect(POOL_NAME_RE.source.endsWith('$')).toBe(true);
    expect(POOL_NAME_RE.source.length).toBeGreaterThan(8);
  });

  it('ccd/ccd holds exactly one POOL_NAME_RE, byte-equal to shared/roster.ts', () => {
    const bash = exactlyOne(ccdSrc, /^POOL_NAME_RE='([^']*)'$/gm, 'ccd/ccd POOL_NAME_RE');
    expect(bash).toBe(POOL_NAME_RE.source);
  });
});

describe('the pools directory is one name in two languages', () => {
  it('ccd/ccd holds exactly one POOLS_DIR, and its tail is POOLS_DIR_NAME', () => {
    const tail = exactlyOne(ccdSrc, /^POOLS_DIR="\$REG\/([^"]*)"$/gm, 'ccd/ccd POOLS_DIR');
    expect(tail).toBe(POOLS_DIR_NAME);
  });

  it('guards the guard: POOLS_DIR_NAME is a plain dotless segment', () => {
    // A dot-leading directory would land inside ccd's own private namespace
    // (spec §4), and a name with a slash would not be one directory at all.
    expect(POOLS_DIR_NAME).toMatch(/^[a-z][a-z0-9-]*$/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/pool-name-parity.test.ts`
Expected: FAIL — `Cannot find module '../src/pools.js'` (the file does not exist yet). Once Step 3 creates it, the remaining reds are `ccd/ccd POOL_NAME_RE: expected exactly one occurrence, found 0` and `ccd/ccd POOLS_DIR: expected exactly one occurrence, found 0`.

- [ ] **Step 3: Create `server/src/pools.ts` with the one constant**

```ts
/**
 * L3 — the server's view of the fleet box's project pool tags.
 *
 * WAVE 2a SHIPS ONE LINE OF IT, DELIBERATELY. `readProjectPools`, `poolFor`,
 * `poolsEnforcement` and `poolsWire` are wave 3's; what has to exist NOW is a
 * TypeScript spelling of the directory name for `pool-name-parity.test.ts` to
 * compare `ccd/ccd`'s `POOLS_DIR=` against. The alternative — waiting for wave
 * 3 — would mean the bash constant shipped to the fleet with nothing holding
 * it equal to anything, which is the state `ccd/ccrc-wrapper-shape:67` is
 * already in and discloses.
 */
export const POOLS_DIR_NAME = 'pools';
```

- [ ] **Step 4: Add the two constants to `ccd/ccd`**

Insert immediately after `PROJECTS_ROOT` / `WORKTREES_ROOT` (`ccd/ccd:771-772`), before the roster comment block that begins `# THE ACCOUNT ROSTER IS DATA`:

```bash
# THE PROJECT POOL TAG lives in a DOTLESS registry subdirectory, one file per
# project (spec §4, approach B). Outside every git tree and every session cwd,
# beside the switches an operator already hand-touches (`<w>-disabled`,
# `coordinator-paused`, `mail-disabled`) — `ls ~/.cc-sessions/pools/` shows
# every tag and `echo pool-a > pools/demo` is the 2 am idiom.
#
# DOTLESS, and that is measured rather than assumed: every registry glob is
# SUFFIX-shaped (`_reg_purge` and `_ws_slug_free` glob `"$REG/$id".*`), so a
# directory is invisible to all of them. `$REG/<project>.pool` was ruled out by
# a real collision — ids are `<wrapper>-<project>`, so a project named
# `acct-a-demo` would produce the per-session `pool` field of the session
# `acct-a-demo`, which is a SPACE-SEPARATED CANDIDATE LIST and not a pool name
# at all (see `_pool_for`). Dot-LEADING was ruled out because dot-leading is
# this file's private namespace and the operator must be able to touch this one.
POOLS_DIR="$REG/pools"
# The pool-name grammar, ONCE in this file. Same shape as `shared/roster.ts`'s
# ID_RE, for the reason that file's docstring gives: the value is embedded
# unquoted in a generated bash `case` arm (`_ccrc_pool`) and printed with
# `echo`, and a leading lowercase letter is what makes `echo` safe.
# `server/test/pool-name-parity.test.ts` extracts this line and the one above
# and holds both equal to their TypeScript spellings — the two files cannot
# share a value, so the agreement is measured instead.
POOL_NAME_RE='^[a-z][a-z0-9-]{0,31}$'
```

- [ ] **Step 5: Run the parity test to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/pool-name-parity.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Write the failing test — the reader**

Create `server/test/ccd-project-pool.test.ts`:

```ts
// `$REG/pools/<project>` — the project pool tag, its reader and (Task 3) its
// writer verb.
//
// Everything runs against the isolated fixture HOME (`makeCcdHarness`), never
// the live one: `$REG` is `$HOME/.cc-sessions`, so a test that wrote a real tag
// would retag an actual project on the fleet.
//
// THE READER RUNS INSIDE `cmd_supervise`'s 5-second loop, so it may never
// `die`: a supervisor that exits on an unreadable tag stops supervising. That
// is pinned by interposing `die() { echo DIED; exit 99; }` AFTER sourcing ccd
// and asserting the word came back instead (the `ccd-die-containment.test.ts`
// technique).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-project-pool-'); });
afterEach(() => { h.cleanup(); });

const REG = (): string => path.join(h.home, '.cc-sessions');
const POOLS = (): string => path.join(REG(), 'pools');

/** Plants a tag file with EXACT bytes — no helper newline, because the byte
 *  assertions below are about exactly that. */
function plantTag(project: string, bytes: string): string {
  fs.mkdirSync(POOLS(), { recursive: true });
  const p = path.join(POOLS(), project);
  fs.writeFileSync(p, bytes);
  return p;
}

/** ccd's own answer, captured with stderr FOLDED IN, so "the reader printed a
 *  word" and "the reader printed a word and complained on stderr" are
 *  distinguishable. `h.sh` returns stdout only. */
const state = (project: string): string =>
  h.sh(`{ _project_pool_state ${JSON.stringify(project)}; } 2>&1`);

describe('_project_pool_state — four words, always rc 0', () => {
  it('answers `untagged` when the pools directory does not exist at all', () => {
    expect(fs.existsSync(POOLS())).toBe(false);
    expect(state('demo')).toBe('untagged');
  });

  it('answers `untagged` for a project with no file, when other projects have one', () => {
    plantTag('quiet-basin', 'pool-a');
    expect(state('demo')).toBe('untagged');
  });

  it('answers `named <n>` for a well-formed tag, with and without a trailing newline', () => {
    // A shell `echo pool-a > pools/demo` is a LEGAL writer (ruling 2), so the
    // reader strips trailing whitespace. Both bytes must read the same.
    plantTag('demo', 'pool-a');
    expect(state('demo')).toBe('named pool-a');
    plantTag('demo', 'pool-a\n');
    expect(state('demo')).toBe('named pool-a');
    plantTag('demo', 'pool-a\n\n  \t\n');
    expect(state('demo')).toBe('named pool-a');
  });

  it('answers `malformed` for two tokens, for uppercase, and for empty', () => {
    // Each is a DIFFERENT bad shape and they share one word because they share
    // one remedy: rewrite the file as a single lowercase token.
    for (const bytes of ['pool a', 'Pool-a', '', 'pool_a', '-pool-a']) {
      plantTag('demo', bytes);
      expect(state('demo'), JSON.stringify(bytes)).toBe('malformed');
    }
  });

  it('answers `unreadable` for a directory at the tag path — any uid, root included', () => {
    fs.mkdirSync(path.join(POOLS(), 'demo'), { recursive: true });
    expect(state('demo')).toBe('unreadable');
  });

  it.skipIf(process.getuid?.() === 0)(
    'answers `unreadable` for a mode-000 file, and NEVER `untagged`', () => {
      // THE DEFECT THIS IS ABOUT: folding unreadable into untagged silently
      // LIFTS the constraint — the project becomes unconstrained because a
      // permission bit was wrong, and nothing anywhere says so.
      const p = plantTag('demo', 'pool-a');
      fs.chmodSync(p, 0o000);
      try {
        expect(state('demo')).toBe('unreadable');
      } finally {
        fs.chmodSync(p, 0o600);
      }
    });

  it('answers `untagged` for an EMPTY project argument, never resolving to the directory', () => {
    // A pre-2026 registry row with no `.project` field hands this function the
    // empty string. Without the `-n "$1"` guard the path is `$POOLS_DIR/`,
    // `cat` on a directory fails, and every such session reads `unreadable` —
    // fail-shut on a row whose project is merely unknown (spec §10).
    fs.mkdirSync(POOLS(), { recursive: true });
    expect(h.sh('{ _project_pool_state ""; } 2>&1')).toBe('untagged');
    expect(h.sh('{ _project_pool_state; } 2>&1')).toBe('untagged');
  });

  it('never dies, on every one of the four inputs, and always exits 0', () => {
    fs.mkdirSync(path.join(POOLS(), 'acct-a-demo'), { recursive: true });   // unreadable
    plantTag('demo', 'pool-a');                                            // named
    plantTag('quiet-basin', 'Pool a');                                     // malformed
    const out = h.sh(
      'die() { echo DIED; exit 99; }; '
      + 'for p in demo quiet-basin acct-a-demo nothing-here ""; do '
      + '  { _project_pool_state "$p"; } 2>&1; echo "rc=$?"; '
      + 'done');
    expect(out).not.toContain('DIED');
    expect(out.split('\n').filter((l) => l.startsWith('rc='))).toEqual(
      ['rc=0', 'rc=0', 'rc=0', 'rc=0', 'rc=0']);
    expect(out.split('\n').filter((l) => !l.startsWith('rc='))).toEqual(
      ['named pool-a', 'malformed', 'unreadable', 'untagged', 'untagged']);
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-project-pool.test.ts`
Expected: FAIL, 8 failing — every case throws from `execFileSync` with `_project_pool_state: command not found` on stderr.

- [ ] **Step 8: Write the reader and the grammar predicate**

Insert into `ccd/ccd` immediately after `_lane_enabled` (`ccd/ccd:1024`) and before the `_account_ok` comment block at `:1025`:

```bash
_pool_name_valid() { [[ "${1-}" =~ $POOL_NAME_RE ]]; }   # value -> 0 iff it is a legal pool name
# THE ONLY READER OF THE PROJECT TAG in this file. Four words, ALWAYS rc 0,
# and it may never `die`: every decider calls it once per decision and one of
# those deciders is `_auto_swap_check`, inside the long-lived `cmd_supervise`
# loop — a reader that exited there would stop the supervisor.
#
# FOUR WORDS, NOT THREE. `unreadable` (permissions, a directory where the file
# belongs, a symlink loop) and `malformed` (bytes that are not one legal token)
# have DIFFERENT REMEDIES, and neither is ever folded into `untagged`: folding
# would silently LIFT the constraint, so a chmod would quietly make a project
# unconstrained. `_pool_ok` answers rc 2 for both — nobody decides — and the
# callers branch three ways.
#
# WORD ON STDOUT, NOT AN EXIT CODE. An rc-based reader splits the fourth state
# across two functions, and a `$(…)` capture that forgot `$?` reads unreadable
# as empty, i.e. as untagged. There is nothing to forget here.
_project_pool_state() {   # project -> "named <n>" | untagged | unreadable | malformed ; always rc 0
  local f v
  # A registry row with no `.project` field (pre-2026-07-28 rows have none)
  # must never resolve to the DIRECTORY: `$POOLS_DIR/` would `cat` a directory
  # and read `unreadable` for every such session.
  [[ -n "${1-}" ]] || { echo untagged; return 0; }
  f="$POOLS_DIR/$1"
  [[ -e "$f" ]] || { echo untagged; return 0; }
  v=$(cat -- "$f" 2>/dev/null) || { echo unreadable; return 0; }
  # A shell `echo pool-a > pools/demo` is a legal writer (ruling 2), so a
  # trailing newline is not malformed. Leading whitespace IS: the grammar is
  # anchored, and a leading space is a hand-edit nobody meant.
  v=${v%"${v##*[![:space:]]}"}
  _pool_name_valid "$v" && { echo "named $v"; return 0; }
  echo malformed
}
```

- [ ] **Step 9: Run the reader test to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-project-pool.test.ts`
Expected: PASS, 8 tests (7 on a box where the suite runs as root — the mode-000 case skips).

- [ ] **Step 10: Measure the mutations (row 5 and row 10)**

Run each mutation, confirm the named red, then revert it before the next.

1. In `ccd/ccd`, duplicate the `POOL_NAME_RE='…'` line.
   Run: `cd server && ./node_modules/.bin/vitest run test/pool-name-parity.test.ts`
   Expected: FAIL — `ccd/ccd POOL_NAME_RE: expected exactly one occurrence, found 2`.
2. In `ccd/ccd`, change `POOLS_DIR="$REG/pools"` to `POOLS_DIR="$REG/poolz"`.
   Run: same file. Expected: FAIL — `expected 'poolz' to be 'pools'`.
3. In `_project_pool_state`, change `{ echo unreadable; return 0; }` to `{ echo untagged; return 0; }`.
   Run: `cd server && ./node_modules/.bin/vitest run test/ccd-project-pool.test.ts`
   Expected: FAIL — the directory case and the mode-000 case, `expected 'untagged' to be 'unreadable'`.
4. In `_project_pool_state`, delete the `[[ -n "${1-}" ]] || { echo untagged; return 0; }` line.
   Run: same file. Expected: FAIL — "answers `untagged` for an EMPTY project argument", `expected 'unreadable' to be 'untagged'`.
5. In `_project_pool_state`, replace `echo malformed` with `die "bad pool tag"`.
   Run: same file. Expected: FAIL — "never dies", the output contains `DIED`.

- [ ] **Step 11: Commit**

```bash
git add ccd/ccd server/src/pools.ts server/test/pool-name-parity.test.ts server/test/ccd-project-pool.test.ts
git commit -m "feat(ccd): the project pool tag has a home, a grammar and one reader that never dies"
```

---

## Task 2: The one predicate — `_acct_pool` and `_pool_ok`

**Files:**
- Modify: `ccd/ccd:1090` (immediately after `_is_home_able`)
- Create: `server/test/ccd-pool-ok.test.ts` (the predicate half; Task 5 appends the placement half)

**Interfaces:**
- Consumes: `_project_pool_state`'s four words (Task 1); `_ccrc_pool <id>` from `~/.ccrc/accounts.sh` (wave 1's generator — empty stdout, rc 0, for an untagged or unknown id); `POOL_RULE_CASES`, `POOLED_TEST_ROSTER` from `server/test/fixtures/poolRule.ts` (wave 1); `seedAccountsSh(home, roster)` from `server/test/ccdWsHelpers.ts`.
- Produces:
  - `_acct_pool <wrapper>` → stdout the account's pool name, or empty for an untagged account, an unknown id, or an `accounts.sh` that predates pools. ALWAYS rc 0, never anything on stderr.
  - `_pool_ok <wrapper> <state-word>` → rc 0 serve / 1 mismatch / 2 undecidable.

**Spec:** §5.2 (the rule, spelled once per language), §5.5.1 (both functions, body verbatim), §6 (the `_pool_ok` seam: a boolean would fold undecidable into one side).

**Mutation table:**
- Row 6 — `_pool_ok` is "either untagged or equal", rc 2 on undecidable. Goes red when any disjunct is removed, when the comparison is inverted, or when the `*)` arm returns 0 or 1 instead of 2. Driven over `POOL_RULE_CASES`, the same table wave 3's `poolVerdict` and wave 4's `splitByPool` are driven over.

- [ ] **Step 1: Write the failing test**

Create `server/test/ccd-pool-ok.test.ts`:

```ts
// The rule, in bash: an account MAY serve a project iff the account is
// untagged, or the project is untagged, or the names are equal — and if the
// project's tag cannot be read, NOBODY DECIDES.
//
// Driven over `POOL_RULE_CASES`, the ONE fixture table wave 3's `poolVerdict`
// and wave 4's `splitByPool` are driven over too, so the three spellings of
// one rule cannot drift apart without a red suite in at least one of them.
//
// TWO BLOCKS, TWO SUBJECTS, and the split is deliberate:
//   * `_pool_ok` is the RULE. Its only use of the wrapper argument is to ask
//     `_acct_pool`, so the table is driven with `_ccrc_pool` overridden to the
//     row's own `accountPool` — which lets EVERY row run, including one naming
//     a pool no fixture account carries, and keeps this block independent of
//     what wave 1 chose to put in `POOLED_TEST_ROSTER`.
//   * `_acct_pool` is the ROSTER READ. It is pinned separately against the
//     REAL generated `accounts.sh`, which is the only thing that can prove the
//     generator and this reader agree.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeCcdHarness, seedAccountsSh, type CcdHarness } from './ccdWsHelpers.js';
import { POOL_RULE_CASES, POOLED_TEST_ROSTER } from './fixtures/poolRule.js';
import type { ProjectPoolWire } from '../../shared/api.js';

let h: CcdHarness;
beforeEach(() => {
  h = makeCcdHarness('ccrc-ccd-pool-ok-');
  seedAccountsSh(h.home, POOLED_TEST_ROSTER);
});
afterEach(() => { h.cleanup(); });

/** The bash word `_project_pool_state` would print for a wire state. The one
 *  place the two languages' spellings meet; it is HERE and not in shipped
 *  source because nothing shipped crosses the two. */
const stateWord = (p: ProjectPoolWire): string =>
  p.state === 'tagged' ? `named ${p.name}` : p.state;

/** `serve` -> 0, `mismatch` -> 1, `undecidable` -> 2. */
const WANT_RC: Record<string, number> = { serve: 0, mismatch: 1, undecidable: 2 };

describe('_pool_ok over POOL_RULE_CASES — the rule, three exit codes', () => {
  it('guards the guard: the table is not empty and covers all three verdicts', () => {
    // A scan over an empty list passes everything.
    expect(POOL_RULE_CASES.length).toBeGreaterThanOrEqual(10);
    for (const want of ['serve', 'mismatch', 'undecidable']) {
      expect(POOL_RULE_CASES.some((c) => c.expect === want), want).toBe(true);
    }
    // Both undecidable STATES are exercised, not just one of them.
    for (const st of ['unreadable', 'malformed']) {
      expect(POOL_RULE_CASES.some((c) => c.project.state === st), st).toBe(true);
    }
  });

  it.each(POOL_RULE_CASES.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    // `_ccrc_pool` overridden to this row's account pool: the generator's own
    // contract is "empty stdout, rc 0, for an untagged or unknown id", so an
    // untagged account is a function that prints nothing.
    const stub = c.accountPool === null
      ? '_ccrc_pool() { return 0; };'
      : `_ccrc_pool() { echo ${JSON.stringify(c.accountPool)}; };`;
    const out = h.sh(
      `${stub} { _pool_ok anyaccount ${JSON.stringify(stateWord(c.project))}; } 2>&1; echo "rc=$?"`);
    // stderr is folded into stdout: a predicate that answered correctly while
    // complaining is not a predicate a supervisor loop can call every 5 s.
    expect(out).toBe(`rc=${WANT_RC[c.expect]}`);
  });

  it('undecidable is a THIRD answer, not a mismatch — an untagged account does not decide either', () => {
    // The mutant this kills: `*) return 1 ;;`. With it, an unreadable tag
    // becomes "this account may not serve", every candidate is refused, and a
    // permissions bug reads exactly like an empty pool.
    for (const word of ['unreadable', 'malformed']) {
      const out = h.sh(`_ccrc_pool() { return 0; }; _pool_ok anyaccount ${word}; echo "rc=$?"`);
      expect(out, word).toBe('rc=2');
    }
  });
});

describe('_acct_pool — the roster read, over the real generated accounts.sh', () => {
  it('answers the pool the generator emitted, per account', () => {
    expect(h.sh('_acct_pool claude')).toBe('pool-a');
    expect(h.sh('_acct_pool claude-a')).toBe('pool-a');
    expect(h.sh('_acct_pool claude-b')).toBe('pool-b');
  });

  it('answers EMPTY for an untagged account and for an unknown id, rc 0, silently', () => {
    // The generator emits one `case` arm per TAGGED account only, so silence
    // is the answer for both — the collapse is accepted because
    // `_is_valid_wrapper` gates every id before any pool question is asked
    // (spec §6, first row).
    for (const w of ['claude-d', 'gpt', 'no-such-account']) {
      expect(h.sh(`out=$( { _acct_pool ${w}; } 2>&1 ); printf '%s|%s' "$out" "$?"`), w)
        .toBe('|0');
    }
  });

  it('answers EMPTY, rc 0 and SILENTLY over an accounts.sh that predates pools', () => {
    // A new ccd over an old `~/.ccrc/accounts.sh` must read every account as
    // untagged — today's behaviour — with no `command not found` on stderr and
    // no rc 127. `unset -f` reproduces exactly the state `declare -F` measures.
    const out = h.sh(
      'unset -f _ccrc_pool; out=$( { _acct_pool claude; } 2>&1 ); printf \'%s|%s\' "$out" "$?"');
    expect(out).toBe('|0');
  });

  it('guards the guard: the harness roster really does define _ccrc_pool', () => {
    // Without this the previous case proves nothing — an accounts.sh that
    // never had the function would make `unset -f` a no-op.
    expect(h.sh('declare -F _ccrc_pool >/dev/null && echo yes || echo no')).toBe('yes');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-pool-ok.test.ts`
Expected: FAIL — every `_pool_ok` case throws with `_pool_ok: command not found`, and every `_acct_pool` case with `_acct_pool: command not found`. (The "guards the guard" cases pass — `POOL_RULE_CASES` and `_ccrc_pool` are wave 1's and already there.)

- [ ] **Step 3: Write the predicate**

Insert into `ccd/ccd` immediately after `_is_home_able` (`ccd/ccd:1090`), before `_id()` at `:1091`:

```bash
# THE ACCOUNT SIDE of the pool rule. `_ccrc_pool` is generated into
# `~/.ccrc/accounts.sh` (shared/generate.mjs) with one `case` arm per TAGGED
# account, so its contract is "empty stdout, rc 0, for an untagged or unknown
# id" — `_ccrc_cfg_dir`'s rule, and the caller decides what silence means.
#
# THE `declare -F` GUARD IS WHY A NEW ccd RUNS OVER AN OLD accounts.sh. During
# the minutes between the roster lane and the ccd lane of an agent deploy, and
# on any box whose roster was never regenerated, the function does not exist.
# Under `set -uo pipefail` with no `-e`, `declare -F` on an undefined function
# short-circuits cleanly, no array is touched, and every account reads as
# untagged — today's behaviour, with no `command not found` on stderr and no
# rc 127 leaking into a `$(…)` capture.
_acct_pool() { declare -F _ccrc_pool >/dev/null 2>&1 && _ccrc_pool "$1"; return 0; }
# THE RULE, spelled once in this language: an account may serve a project iff
# the account is untagged, or the project is untagged, or the names are equal.
#
# THREE EXIT CODES, NOT A BOOLEAN. A boolean would fold "the tag cannot be
# read" into one side of the answer — either silently lifting the constraint or
# silently refusing every account — and both are wrong: when the tag is
# undecidable, NOBODY DECIDES. Callers branch three ways. The same three
# verdicts are `shared/poolrule.ts`'s `PoolVerdict` and are driven from one
# fixture table (`server/test/fixtures/poolRule.ts`) in both languages.
#
# THE STATE IS PASSED IN, not read here: callers obtain it ONCE per decision
# (`pps=$(_project_pool_state "$project")`) and pass the word, so a loop over
# five candidates costs one `cat`, not five.
_pool_ok() {   # wrapper pool-state -> 0 serve | 1 mismatch | 2 undecidable
  local ap pp; ap=$(_acct_pool "$1")
  case "$2" in
    untagged)  return 0 ;;
    "named "*) pp=${2#named } ;;
    *)         return 2 ;;                     # unreadable | malformed: nobody decides
  esac
  [[ -z "$ap" || "$ap" == "$pp" ]]
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-pool-ok.test.ts`
Expected: PASS — 4 `_acct_pool` cases, 2 rule cases, plus one per `POOL_RULE_CASES` row (>= 10).

- [ ] **Step 5: Measure the mutations (row 6)**

Apply each, confirm the red, revert.

1. `*) return 2 ;;` → `*) return 1 ;;`.
   Expected: FAIL — every `undecidable` row of the table, and "undecidable is a THIRD answer", `expected 'rc=1' to be 'rc=2'`.
2. `[[ -z "$ap" || "$ap" == "$pp" ]]` → `[[ "$ap" == "$pp" ]]` (untagged-account disjunct removed).
   Expected: FAIL — every row whose `accountPool` is `null` against a tagged project, `expected 'rc=1' to be 'rc=0'`.
3. `untagged) return 0 ;;` → `untagged) return 1 ;;` (untagged-project disjunct removed).
   Expected: FAIL — every `{state:'untagged'}` row, `expected 'rc=1' to be 'rc=0'`.
4. `[[ -z "$ap" || "$ap" == "$pp" ]]` → `[[ -z "$ap" || "$ap" != "$pp" ]]` (comparison inverted).
   Expected: FAIL — the `same-pool` rows go to `rc=1` and the `pool-mismatch` rows to `rc=0`.
5. `_acct_pool` → drop the `declare -F` guard, leaving `_acct_pool() { _ccrc_pool "$1"; return 0; }`.
   Expected: FAIL — "answers EMPTY, rc 0 and SILENTLY over an accounts.sh that predates pools": the captured value is bash's own `_ccrc_pool: command not found` line rather than the empty string.

- [ ] **Step 6: Commit**

```bash
git add ccd/ccd server/test/ccd-pool-ok.test.ts
git commit -m "feat(ccd): one predicate answers the pool question, and undecidable is its own answer"
```

---

## Task 3: The writer verb — `ccd project-pool`, its dispatcher arm, and the `pools-v1` capability token

**Files:**
- Modify: `ccd/ccd:5116` (insert `cmd_project_pool` after `cmd_coord_pause`'s closing brace, before `cmd_ws_archive`)
- Modify: `ccd/ccd:4746-4747` (caps heredoc: `project-pool` between `prefer` and `start`)
- Modify: `ccd/ccd:4804-4805` (`echo pools-v1` after `echo actor-flags-v1`)
- Modify: `ccd/ccd:13449` (dispatcher arm) and `ccd/ccd:13453` (the usage line)
- Modify: `server/src/ccdargv.ts:346` (`POOLS_CAP` beside `ACTOR_FLAGS_CAP`)
- Modify: `server/test/ccd-archive.test.ts:154` (`KNOWN_CAPABILITY_TOKENS`)
- Test: `server/test/ccd-project-pool.test.ts` (append the verb describes)
- Test: `server/test/pool-name-parity.test.ts` (append the fixture-HOME round trip)

**Interfaces:**
- Consumes: `POOLS_DIR`, `POOL_NAME_RE`, `_pool_name_valid`, `_project_pool_state` (Task 1); `_acct_pool` (Task 2); `_ws_project_valid` (`ccd/ccd:3462`); `_plat_mv_notdir` (`ccd/ccd:75`); `PROJECTS_ROOT` (`ccd/ccd:771`); `CCRC_ACCOUNTS` (from `accounts.sh`); `ACTOR_FLAGS_CAP` (`server/src/ccdargv.ts:346`).
- Produces:
  - `ccd project-pool --project <p> --pool <name>` → stdout `tagged <p> <name>`, exit 0
  - `ccd project-pool --project <p> --clear` → stdout `untagged <p>`, exit 0
  - one `$REG/swap.log` line per call: `<date> pool-tag <p>: <old|-> -> <new|->`
  - stderr `warn: no rostered account is in pool <name>` when no `CCRC_ACCOUNTS` member carries the name
  - `ccd caps` advertises the verb `project-pool` and the token `pools-v1`
  - `export const POOLS_CAP = 'pools-v1';` in `server/src/ccdargv.ts`

**Spec:** §5.4.2 (the verb, modelled line for line on `cmd_coord_pause`), §5.4.1 (atomicity, content, absent-directory), §5.11 (the caps token), §9 (no `_lc_done` line — the lifecycle vocabulary is per-session and `cmd_coord_pause` journals nothing either).

**Mutation table:**
- Row 11 — the verb validates before touching the filesystem. Goes red when the `_ws_project_valid` call is removed: `--project ../x`, `.hidden`, `'a b'` and `''` must all die with no file created anywhere under `$HOME`.
- Row 12 — checked write/unlink polarity. Goes red when either `|| die` is removed: a read-only `pools/` must exit non-zero saying `NOT tagged`, and an undeletable tag must say `STILL tagged`.
- Row 13 — `--clear` is idempotent and existence-free. Goes red when the existence check is applied to `--clear`.
- Row 14 — the written bytes carry no newline and a shell newline is tolerated. Goes red when the writer switches to `echo` or the reader drops the strip.
- Row 9 — the marker namespace cannot collide. Goes red when the marker is relocated to `$REG/<project>.<anything>`.
- Row 18 (caps half) — `ccd-archive.test.ts`'s caps ↔ dispatcher equality. Goes red when the heredoc entry or the dispatcher arm is missing, in either direction, and when `pools-v1` is advertised without joining `KNOWN_CAPABILITY_TOKENS` (it then falls into that test's `verbs` partition and reds as a phantom verb).
- Row 47 (two of the three ways) — `KNOWN_CAPABILITY_TOKENS` exact equality plus `toContain(POOLS_CAP)`; `caps-token-shape.test.ts` covers the token by derivation and needs no edit.

**LEDGER:** the registry already has a `pool` field and it is a SPACE-SEPARATED CANDIDATE LIST with no writer in the tree (`_pool_for`, `ccd/ccd:10984`), not a pool NAME — two meanings of one word in one file. Renaming the field is out of scope; the collision is recorded in a comment at `_pool_for` and pinned by the `acct-a-demo` case in `ccd-project-pool.test.ts` (D-1666 — spec §12 P-7).

**LEDGER:** `swap.log` gains a line class whose subject is a PROJECT where every other line's subject is a session id (`pool-tag <p>: <old> -> <new>`). Deliberate — the retag is the cause of the `rehome` / `auto-pool` lines that follow it, and a reader who cannot see the cause beside its effects has to correlate two files (D-1667 — spec §12 P-11).

- [ ] **Step 1: Write the failing test — the verb**

Append to `server/test/ccd-project-pool.test.ts`. Add to the existing imports:

```ts
import { execFileSync } from 'node:child_process';
import { ghContainedEnv, CCD } from './ccdWsHelpers.js';
```

and append these helpers and describes:

```ts
/** stdout captured BESIDE stderr and the code, `ccd-coord-pause.test.ts`'s
 *  helper: on this verb the defect that matters is a refusal that still
 *  printed `tagged`, and a code-and-stderr-only helper cannot see it. */
const shFail = (snippet: string): { code: number; stderr: string; stdout: string } => {
  try { return { code: 0, stderr: '', stdout: h.sh(snippet) }; }
  catch (e) {
    const err = e as { status?: number; stderr?: Buffer; stdout?: Buffer };
    return { code: err.status ?? 1, stderr: String(err.stderr ?? ''), stdout: String(err.stdout ?? '') };
  }
};

/** The DISPATCHER, not the function. The agent invokes this verb as
 *  `ccd project-pool --project demo --pool pool-a`, so the `case` arm is
 *  load-bearing production surface: a shipped `cmd_project_pool` with no arm
 *  answers the usage line at exit 1 for every tap the phone makes. */
const runCcd = (...args: string[]): { code: number; stdout: string; stderr: string } => {
  const opts = {
    encoding: 'utf8' as const, cwd: h.home,
    env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }),
  };
  try { return { code: 0, stdout: execFileSync('bash', [CCD, ...args], opts).trim(), stderr: '' }; }
  catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, stdout: String(err.stdout ?? '').trim(), stderr: String(err.stderr ?? '') };
  }
};

const swapLog = (): string => {
  const p = path.join(REG(), 'swap.log');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
};

/** Everything under $HOME, so "nothing was touched" is a measurement rather
 *  than a spot check on one path. */
const treeUnderHome = (): string[] => {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      out.push(path.relative(h.home, p));
      if (e.isDirectory() && !e.isSymbolicLink()) walk(p);
    }
  };
  walk(h.home);
  return out.sort();
};

describe('ccd project-pool — the writer verb', () => {
  it('tags a project through the DISPATCHER, and says so', () => {
    h.makeRepo('demo');
    const r = runCcd('project-pool', '--project', 'demo', '--pool', 'pool-a');
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('tagged demo pool-a');
    expect(state('demo')).toBe('named pool-a');
  });

  it('names itself in the usage line every mistyped verb prints', () => {
    const r = runCcd();
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('project-pool');
  });

  it('writes the value with NO trailing newline', () => {
    // `_reg_set`'s convention (`printf '%s'`). The mutant is `echo "$pool"`,
    // which is invisible to every word-level assertion above.
    h.makeRepo('demo');
    h.sh('cmd_project_pool --project demo --pool pool-a');
    expect(fs.readFileSync(path.join(POOLS(), 'demo'), 'utf8')).toBe('pool-a');
  });

  it('leaves no tmp file behind, and the tag is a regular file', () => {
    h.makeRepo('demo');
    h.sh('cmd_project_pool --project demo --pool pool-a');
    expect(fs.readdirSync(POOLS())).toEqual(['demo']);
    expect(fs.statSync(path.join(POOLS(), 'demo')).isFile()).toBe(true);
  });

  it('creates $REG/pools lazily on the first --pool', () => {
    h.makeRepo('demo');
    expect(fs.existsSync(POOLS())).toBe(false);
    h.sh('cmd_project_pool --project demo --pool pool-a');
    expect(fs.statSync(POOLS()).isDirectory()).toBe(true);
  });

  it('retags in place, and logs one pool-tag line per call with the old and new names', () => {
    h.makeRepo('demo');
    h.sh('cmd_project_pool --project demo --pool pool-a');
    h.sh('cmd_project_pool --project demo --pool pool-b');
    expect(h.sh('cmd_project_pool --project demo --clear')).toBe('untagged demo');
    const lines = swapLog().trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/ pool-tag demo: - -> pool-a$/);
    expect(lines[1]).toMatch(/ pool-tag demo: pool-a -> pool-b$/);
    expect(lines[2]).toMatch(/ pool-tag demo: pool-b -> -$/);
  });

  it('clears idempotently and without any existence check on the project', () => {
    // The doctor's `pools-stale` remedy IS `--clear` on a project whose
    // directory and registry rows are both gone. If that refused, the remedy
    // for the finding could never be applied.
    plantTag('acct-a-demo', 'pool-a');
    expect(h.sh('cmd_project_pool --project acct-a-demo --clear')).toBe('untagged acct-a-demo');
    expect(fs.existsSync(path.join(POOLS(), 'acct-a-demo'))).toBe(false);
    expect(h.sh('cmd_project_pool --project acct-a-demo --clear')).toBe('untagged acct-a-demo');
    expect(h.sh('cmd_project_pool --project never-existed --clear')).toBe('untagged never-existed');
  });

  it('accepts a registry-only project on --pool — a custom workdir has no directory', () => {
    // Four production projects are not git repositories and dispatched
    // workspaces can carry a workdir outside $PROJECTS_ROOT, so "a project" is
    // EITHER a directory under $PROJECTS_ROOT OR a registry row naming it.
    fs.writeFileSync(path.join(REG(), 'claude-quiet-basin.project'), 'quiet-basin');
    expect(fs.existsSync(path.join(h.home, 'projects', 'quiet-basin'))).toBe(false);
    expect(h.sh('cmd_project_pool --project quiet-basin --pool pool-a')).toBe('tagged quiet-basin pool-a');
  });

  it('refuses --pool for a project that is neither a directory nor a registry row', () => {
    const r = shFail('cmd_project_pool --project never-existed --pool pool-a');
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('no such project');
    expect(r.stdout).not.toContain('tagged');
    expect(fs.existsSync(POOLS())).toBe(false);
  });

  it('refuses a missing, an extra and a misspelt flag — each by the usage sentence', () => {
    for (const argv of ['', '--project', '--project demo', '--project demo --pool',
      '--project demo --pool pool-a extra', '--proj demo --pool pool-a',
      '--project demo --poool pool-a']) {
      const r = shFail(`cmd_project_pool ${argv}`);
      expect(r.code, `argv: ${argv}`).not.toBe(0);
      expect(r.stderr, `argv: ${argv}`)
        .toContain('usage: ccd project-pool --project <p> --pool <name>|--clear');
    }
  });

  it('validates the project BEFORE touching the filesystem, and touches nothing', () => {
    const before = treeUnderHome();
    for (const p of ['../x', '.hidden', 'a b', '', 'a/b']) {
      const r = shFail(`cmd_project_pool --project ${JSON.stringify(p)} --pool pool-a`);
      expect(r.code, JSON.stringify(p)).not.toBe(0);
      expect(r.stderr, JSON.stringify(p)).toContain('invalid project');
    }
    expect(treeUnderHome()).toEqual(before);
  });

  it('refuses an off-grammar pool name by its OWN sentence, not the usage one', () => {
    // A caller who got the shape right and the vocabulary wrong is a different
    // condition from a malformed argv, and folding them answers "usage" to
    // someone whose usage was fine (`cmd_coord_pause`'s own split).
    h.makeRepo('demo');
    for (const bad of ['Pool-a', 'pool a', '', '-pool', 'pool_a', 'a'.repeat(33)]) {
      const r = shFail(`cmd_project_pool --project demo --pool ${JSON.stringify(bad)}`);
      expect(r.code, JSON.stringify(bad)).not.toBe(0);
      expect(r.stderr, JSON.stringify(bad)).toContain('invalid pool name');
      expect(r.stderr, JSON.stringify(bad)).not.toContain('usage: ccd project-pool');
    }
    expect(fs.existsSync(POOLS())).toBe(false);
  });

  it('warns on stderr — and still tags — when no rostered account carries the name', () => {
    // A WARNING, not a refusal: this pool may be about to gain an account, and
    // the FLEET's roster copy is the authority (the server's can lag it).
    h.makeRepo('demo');
    const opts = {
      encoding: 'utf8' as const, cwd: h.home,
      env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }),
    };
    const out = execFileSync('bash',
      ['-c', `source ${JSON.stringify(CCD)}; cmd_project_pool --project demo --pool pool-b 2>&1`], opts);
    expect(out).toContain('warn: no rostered account is in pool pool-b');
    expect(out).toContain('tagged demo pool-b');
    expect(state('demo')).toBe('named pool-b');
  });

  it('refuses when $REG is not a directory — the tag has nowhere to live', () => {
    // Deleting $REG does NOT produce this state: ccd runs `mkdir -p "$REG"` at
    // source time. A FILE at the path is the state the guard answers, and it
    // discriminates for any uid, root included.
    fs.rmSync(REG(), { recursive: true, force: true });
    fs.writeFileSync(REG(), 'not a directory\n');
    const r = shFail('cmd_project_pool --project demo --pool pool-a');
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('no registry');
    expect(r.stdout).not.toContain('tagged');
  });
});

describe('ccd project-pool — the write is CHECKED in both directions', () => {
  it('refuses LOUDLY when the tag cannot be written — it is NOT tagged (any uid)', () => {
    // A regular FILE where $REG/pools belongs makes `mkdir -p` fail for root
    // too. ccd runs `set -uo pipefail` with NO `-e`: unguarded, the failure
    // falls straight through to the echo and a route keyed on the exit code is
    // told the project is constrained while ccd places work anywhere it likes.
    h.makeRepo('demo');
    fs.writeFileSync(POOLS(), 'not a directory\n');
    const r = shFail('cmd_project_pool --project demo --pool pool-a');
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('NOT tagged');
    expect(r.stdout).not.toContain('tagged demo');
  });

  it('refuses LOUDLY when the rename cannot land — it is NOT tagged (any uid)', () => {
    // A DIRECTORY at the tag path: `_plat_mv_notdir` refuses to overwrite a
    // directory with a non-directory on both userlands, for any uid.
    h.makeRepo('demo');
    fs.mkdirSync(path.join(POOLS(), 'demo'), { recursive: true });
    const r = shFail('cmd_project_pool --project demo --pool pool-a');
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('NOT tagged');
    expect(r.stdout).not.toContain('tagged demo');
    // …and the tmp file it could not rename is gone.
    expect(fs.readdirSync(POOLS())).toEqual(['demo']);
  });

  it.skipIf(process.getuid?.() === 0)(
    'refuses LOUDLY when the tmp write is denied — it is NOT tagged', () => {
      h.makeRepo('demo');
      fs.mkdirSync(POOLS(), { recursive: true });
      fs.chmodSync(POOLS(), 0o500);
      try {
        const r = shFail('cmd_project_pool --project demo --pool pool-a');
        expect(r.code).not.toBe(0);
        expect(r.stderr).toContain('NOT tagged');
        expect(r.stdout).not.toContain('tagged demo');
      } finally {
        fs.chmodSync(POOLS(), 0o700);
      }
    });

  it('refuses LOUDLY when the tag cannot be removed — it is STILL tagged (any uid)', () => {
    // `rm -f` suppresses ENOENT only; EISDIR still exits non-zero, for root as
    // well. The polarity that matters: a caller told the project was untagged
    // while the constraint still binds every placement.
    fs.mkdirSync(path.join(POOLS(), 'demo'), { recursive: true });
    const r = shFail('cmd_project_pool --project demo --clear');
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('STILL tagged');
    expect(r.stdout).not.toContain('untagged demo');
  });
});

describe('the marker namespace cannot collide with a session id', () => {
  it('a tag for project acct-a-demo is not the registry `pool` field of session acct-a-demo', () => {
    // The registry `pool` field is a SPACE-SEPARATED CANDIDATE LIST with no
    // writer in the tree, not a pool name — two meanings of one word in one
    // file (D-1666). `$REG/<project>.pool` would have made them one
    // file: ids are `<wrapper>-<project>`, so a project named `acct-a-demo`
    // collides with the session `acct-a-demo`.
    fs.writeFileSync(path.join(REG(), 'acct-a-demo.project'), 'acct-a-demo');
    h.sh('cmd_project_pool --project acct-a-demo --pool pool-a');
    expect(h.reg('acct-a-demo', 'pool')).toBeNull();
    expect(h.sh('_pool_for acct-a-demo')).toBe(h.sh('_default_pool acct-a-demo'));
  });

  it('_reg_purge takes the row and leaves the tag byte-identical', () => {
    // `_reg_purge` is what `forget`, `ws-reap` and the dead-reg arm all use.
    // A project's tag outlives every one of its workspaces BY DESIGN.
    fs.writeFileSync(path.join(REG(), 'acct-a-demo.project'), 'acct-a-demo');
    fs.writeFileSync(path.join(REG(), 'acct-a-demo.uuid'), '1'.repeat(36));
    h.sh('cmd_project_pool --project acct-a-demo --pool pool-a');
    const before = fs.readFileSync(path.join(POOLS(), 'acct-a-demo'));
    h.sh('_reg_purge acct-a-demo');
    expect(fs.existsSync(path.join(REG(), 'acct-a-demo.uuid'))).toBe(false);
    expect(fs.readFileSync(path.join(POOLS(), 'acct-a-demo'))).toEqual(before);
  });

  it('a project literally named `pools` does not wedge the slug namespace', () => {
    fs.writeFileSync(path.join(REG(), 'pools-quiet-basin.uuid'), '2'.repeat(36));
    h.makeRepo('pools');
    h.sh('cmd_project_pool --project pools --pool pool-a');
    // The DIRECTORY $REG/pools is invisible to the suffix-shaped glob
    // `$REG/<id>.*` that `_ws_slug_free` walks; only the real registry row
    // holds a slug.
    expect(h.sh('_ws_slug_free pools quiet-basin && echo free || echo taken')).toBe('taken');
    expect(h.sh('_ws_slug_free pools quiet-mesa && echo free || echo taken')).toBe('free');
    expect(state('pools')).toBe('named pool-a');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-project-pool.test.ts`
Expected: FAIL — every new case throws with `cmd_project_pool: command not found`, and "names itself in the usage line" fails with `expected 'usage: ccd {start|ensure|…}' to contain 'project-pool'`.

- [ ] **Step 3: Write the verb**

Insert into `ccd/ccd` immediately after `cmd_coord_pause`'s closing brace (`ccd/ccd:5116`), before `cmd_ws_archive` at `:5118`:

```bash
cmd_project_pool() {   # ccd project-pool --project <p> --pool <name> | --project <p> --clear
  # THE PROJECT SIDE of the pool rule gets a writer a phone can reach. The tag
  # is `$POOLS_DIR/<project>` — one file, one token — and until this verb
  # existed the only writer was an ssh session and an `echo`, which ruling 2
  # rules out as the only way in.
  #
  # MODELLED LINE FOR LINE ON `cmd_coord_pause` ABOVE: flag-led, EXACT arity
  # (usage die otherwise), validation before anything on disk is touched, and
  # BOTH write arms CHECKED. That last is not decoration: ccd runs
  # `set -uo pipefail` with NO `-e` (ccd:9), so an unchecked write that failed
  # would fall straight through to the echo and report a tag that is not there.
  # This is the verb where a false success is worst — a route keyed on the exit
  # code then believes a project is constrained while placement is free.
  #
  # NO `_lc_done` LINE. The lifecycle vocabulary is per-SESSION and this verb
  # acts on a project; `cmd_coord_pause` journals nothing for the same reason.
  # The record it does leave is one `swap.log` line, below.
  local project pool="" clear=0
  local usage="usage: ccd project-pool --project <p> --pool <name>|--clear"
  case "$#" in
    4) [[ $1 == --project && $3 == --pool ]] || die "$usage"; project=$2; pool=$4 ;;
    3) [[ $1 == --project && $3 == --clear ]] || die "$usage"; project=$2; clear=1 ;;
    *) die "$usage" ;;
  esac
  # BEFORE THE FILESYSTEM. `_ws_project_valid` refuses `..`, `.`, dot-leading,
  # whitespace and slashes, so the joined path can never leave `$POOLS_DIR` and
  # a dot-leading name can never alias this directory's own tmp namespace.
  _ws_project_valid "$project" \
    || die "invalid project '$project' — allowed chars: A-Za-z0-9 . _ -, and no LEADING dot (the tag is a file in $POOLS_DIR, whose dot-leading names are its tmp namespace)"
  [[ -d "$REG" ]] || die "no registry at $REG"

  local oldstate old="-" new="-"
  oldstate=$(_project_pool_state "$project")
  case "$oldstate" in "named "*) old=${oldstate#named } ;; esac

  if (( clear )); then
    # NO EXISTENCE CHECK ON `--clear`, deliberately. The doctor's `pools-stale`
    # remedy IS this command run against a project whose directory and registry
    # rows are both gone; a remedy that refused on the very state it cures
    # would leave the finding unfixable.
    if [[ -e "$POOLS_DIR/$project" ]]; then
      rm -f -- "$POOLS_DIR/$project" \
        || die "could not remove the pool tag for $project — it is STILL tagged ($POOLS_DIR/$project)"
    fi
  else
    _pool_name_valid "$pool" \
      || die "invalid pool name '$pool' — one token matching $POOL_NAME_RE (lowercase, starts with a letter, max 32 chars)"
    # EXISTENCE, ON THE `--pool` ARM ONLY. Two ways to be a project: a
    # directory under $PROJECTS_ROOT, or a registry row that names one — which
    # is what makes the four non-git projects and every custom-workdir session
    # taggable. The glob is guarded because an empty registry leaves it its own
    # literal text and grep would complain about a file that is not there.
    [[ -d "$PROJECTS_ROOT/$project" ]] \
      || grep -qxF -- "$project" "$REG"/*.project 2>/dev/null \
      || die "no such project '$project' — neither $PROJECTS_ROOT/$project nor any registry row names it"
    # A WARNING, NOT A REFUSAL. This pool may be about to gain an account, and
    # the FLEET's roster copy is the authority — the server's can lag it
    # (§3.3). When it bites, it bites loudly: an empty pool STRANDS.
    local w hit=0
    for w in "${CCRC_ACCOUNTS[@]}"; do
      [[ "$(_acct_pool "$w")" == "$pool" ]] && { hit=1; break; }
    done
    (( hit )) || echo "warn: no rostered account is in pool $pool" >&2

    mkdir -p -- "$POOLS_DIR" \
      || die "could not create $POOLS_DIR — $project is NOT tagged"
    # `_reg_set`'s atomicity, verbatim: tmp then rename. A SIGKILL between the
    # two leaks one dot-leading tmp — the same disclosed price `_reg_set` pays,
    # and every reader skips dot-leading entries, which is exact because no
    # project may lead with a dot.
    local tmp="$POOLS_DIR/.$project.$BASHPID.tmp"
    printf '%s' "$pool" > "$tmp" 2>/dev/null \
      || { rm -f -- "$tmp"; die "could not write the pool tag for $project — it is NOT tagged"; }
    _plat_mv_notdir "$tmp" "$POOLS_DIR/$project" \
      || { rm -f -- "$tmp"; die "could not write the pool tag for $project — it is NOT tagged"; }
    new="$pool"
  fi

  # THE ONE swap.log LINE WHOSE SUBJECT IS A PROJECT. Every other line in that
  # file names a session id. Deliberate: the retag is the CAUSE of the
  # `rehome`/`auto-pool` lines that follow it within a tick, and a reader who
  # cannot see the cause beside its effects has to correlate two files.
  echo "$(date '+%F %T') pool-tag $project: $old -> $new" >> "$REG/swap.log"
  if (( clear )); then echo "untagged $project"; else echo "tagged $project $new"; fi
}
```

- [ ] **Step 4: Add the dispatcher arm, the usage line, the caps entry and the caps token**

1. `ccd/ccd:13449` — insert after `  coord-pause) shift; cmd_coord_pause "$@" ;;`:

```bash
  project-pool) shift; cmd_project_pool "$@" ;;
```

2. `ccd/ccd:13453` — the usage line's brace list gains `|project-pool` immediately after `coord-pause`.

3. `ccd/ccd:4746-4747` — insert `project-pool` into the `cmd_caps` heredoc between `prefer` and `start` (the heredoc is ASCII-sorted; `pre` < `pro` < `sta`).

4. `ccd/ccd:4804` — insert after `echo actor-flags-v1`:

```bash
  # `pools-v1` says THIS copy of ccd honours project pool tags: it reads
  # `$POOLS_DIR/<project>`, applies `_pool_ok` at every account decision, and
  # understands `--cross-pool` on the manual verbs. It gates exactly ONE server
  # decision — "may I build a `--cross-pool` argv" — and `capSupported` refuses
  # on no evidence, because the wrong guess there is a SILENT SUCCESS: an old
  # ccd meets a trailing `--cross-pool` as a positional and, where it does not
  # die, `runCcdOr502` renders exit 0 as `200 {ok:true}` for a crossing that
  # never happened. The TAG ROUTE needs no token: the verb and every reader
  # ship in one ccd inode, so `project-pool`'s presence in `ccdVerbs` IS the
  # evidence. Same argument, same polarity, as `actor-flags-v1` above.
  echo pools-v1
```

- [ ] **Step 5: Add `POOLS_CAP` and update `KNOWN_CAPABILITY_TOKENS`**

`server/src/ccdargv.ts` — insert immediately after `export const ACTOR_FLAGS_CAP = 'actor-flags-v1';` (`:346`):

```ts
/** The `ccd caps` token that says this box honours project pool tags (wave
 *  2a). Spelled ONCE in `server/src`, for `ACTOR_FLAGS_CAP`'s reason: a
 *  capability token copied into two files is the drift shape
 *  `single-definition.test.ts` exists for. ccd's own `echo pools-v1` and
 *  `ccd-archive.test.ts`'s `KNOWN_CAPABILITY_TOKENS` are the other two
 *  spellings, and that test's `toContain` assertion is what keeps THIS one
 *  equal to them.
 *
 *  It gates ONE decision, and only one: whether the server may build a
 *  `--cross-pool` argv (wave 3). The tag route is gated on the VERB's presence
 *  instead, and the 409 pre-check and the placement forecast are the server's
 *  own decisions over data it reads and are not gated at all. */
export const POOLS_CAP = 'pools-v1';
```

`server/test/ccd-archive.test.ts:154` becomes:

```ts
  const KNOWN_CAPABILITY_TOKENS = ['actor-flags-v1', 'lifecycle-v1', 'pools-v1', 'stop-surface'];
```

and add, beside the existing `expect(KNOWN_CAPABILITY_TOKENS).toContain(ACTOR_FLAGS_CAP);` (`:164`):

```ts
    expect(KNOWN_CAPABILITY_TOKENS).toContain(POOLS_CAP);
```

with `POOLS_CAP` added to that file's import from `../src/ccdargv.js`.

- [ ] **Step 6: Append the fixture-HOME round trip to the parity test**

Append to `server/test/pool-name-parity.test.ts`. Add to its imports:

```ts
import fs from 'node:fs';
import { makeCcdHarness } from './ccdWsHelpers.js';
```

and append:

```ts
describe('the two directory-name spellings are the same directory on a real box', () => {
  it('the verb writes where POOLS_DIR_NAME says the server will look', () => {
    // Text extraction proves the two LITERALS agree. This proves the running
    // bash actually joins them the way the TypeScript will: a `POOLS_DIR` that
    // was correct in its assignment and wrong at its use site is invisible to
    // the extraction above.
    const h = makeCcdHarness('ccrc-pool-parity-');
    try {
      h.makeRepo('demo');
      expect(h.sh('cmd_project_pool --project demo --pool pool-a')).toBe('tagged demo pool-a');
      const p = path.join(h.home, '.cc-sessions', POOLS_DIR_NAME, 'demo');
      expect(fs.existsSync(p), `nothing at ${p}`).toBe(true);
      expect(fs.readFileSync(p, 'utf8')).toBe('pool-a');
    } finally {
      h.cleanup();
    }
  });
});
```

- [ ] **Step 7: Run the three suites to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-project-pool.test.ts
cd server && ./node_modules/.bin/vitest run test/pool-name-parity.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-archive.test.ts test/caps-token-shape.test.ts
```
Expected: PASS in all three. `caps-token-shape.test.ts` needs no edit — it reads `cmd_caps`'s bare `echo <token>` lines out of `ccd/ccd` and crosses them through the real `parseCcdCaps`, so `pools-v1` is covered by derivation the moment it is echoed.

- [ ] **Step 8: Measure the mutations (rows 9, 11, 12, 13, 14, 18, 47)**

Apply each, confirm the red, revert.

1. Delete the `_ws_project_valid "$project" || die …` line.
   Expected: FAIL — "validates the project BEFORE touching the filesystem", `treeUnderHome()` differs (a file appears at `.cc-sessions/pools/a b`).
2. Change the write arm's `|| { rm -f -- "$tmp"; die "…NOT tagged"; }` on `_plat_mv_notdir` to a bare `_plat_mv_notdir "$tmp" "$POOLS_DIR/$project"`.
   Expected: FAIL — "refuses LOUDLY when the rename cannot land", `expected 0 not to be 0` and stdout carries `tagged demo pool-a`.
3. Change the unlink arm's `|| die "…STILL tagged"` to a bare `rm -f -- "$POOLS_DIR/$project"`.
   Expected: FAIL — "refuses LOUDLY when the tag cannot be removed", stdout carries `untagged demo`.
4. Move the existence check above the `if (( clear ))` branch so it applies to `--clear` too.
   Expected: FAIL — "clears idempotently and without any existence check", `no such project 'never-existed'`.
5. Change `printf '%s' "$pool" > "$tmp"` to `echo "$pool" > "$tmp"`.
   Expected: FAIL — "writes the value with NO trailing newline", `expected 'pool-a\n' to be 'pool-a'`.
6. Delete the dispatcher arm `project-pool) shift; cmd_project_pool "$@" ;;`.
   Expected: FAIL — `ccd-project-pool.test.ts` "tags a project through the DISPATCHER" (exit 1, the usage line), and `ccd-archive.test.ts` "advertises exactly the verbs the dispatcher implements" with `project-pool` present in caps and absent from the dispatcher.
7. Delete `project-pool` from the `cmd_caps` heredoc.
   Expected: FAIL — `ccd-archive.test.ts`, the same case, the list short one.
8. Delete `pools-v1` from `KNOWN_CAPABILITY_TOKENS` while leaving `echo pools-v1`.
   Expected: FAIL — `ccd-archive.test.ts`: `pools-v1` falls into the `verbs` partition and reads as a phantom verb; plus `expect(KNOWN_CAPABILITY_TOKENS).toContain(POOLS_CAP)`.
9. Change `POOLS_CAP` to `'pools-v2'`.
   Expected: FAIL — `expect(KNOWN_CAPABILITY_TOKENS).toContain(POOLS_CAP)`.
10. Relocate the marker: change `POOLS_DIR="$REG/pools"` to `POOLS_DIR="$REG"` and the tag path to `$REG/$project.pool`.
    Expected: FAIL — "a tag for project acct-a-demo is not the registry `pool` field of session acct-a-demo": `h.reg('acct-a-demo','pool')` is `'pool-a'` instead of `null`, and `_pool_for` answers `pool-a` instead of the default pool. (`pool-name-parity.test.ts` also reds on the `POOLS_DIR` extraction.)

- [ ] **Step 9: Record D-1666 at `_pool_for`**

Append to the comment block above `_pool_for` (`ccd/ccd:10984`), immediately after `_default_pool`'s closing brace:

```bash
# TWO MEANINGS OF ONE WORD, IN ONE FILE, and this is the sentence that keeps
# the next reader from conflating them. The registry `pool` field read here is
# a SPACE-SEPARATED CANDIDATE LIST of wrappers a session may auto-swap between,
# and it has NO WRITER anywhere in this tree — an operator sets it by hand.
# The `pool` of the account-pools design is a NAME, one token, and it lives in
# two other places entirely: `_ccrc_pool <account>` (the roster's projection)
# and `$POOLS_DIR/<project>` (the project's tag). Renaming this field is out of
# scope; `ccd-project-pool.test.ts`'s `acct-a-demo` case is what proves the two
# cannot become one file by accident.
```

- [ ] **Step 10: Re-run and commit**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-project-pool.test.ts test/pool-name-parity.test.ts test/ccd-archive.test.ts test/caps-token-shape.test.ts
```
Expected: PASS.

```bash
git add ccd/ccd server/src/ccdargv.ts server/test/ccd-archive.test.ts server/test/ccd-project-pool.test.ts server/test/pool-name-parity.test.ts
git commit -m "feat(ccd): a project tag a phone can set — the project-pool verb, its dispatcher arm and the pools-v1 token"
```

---

## Task 4: The grant — the agent's two-token prefix and the two `CCD_ARGV` builders

**Files:**
- Modify: `agent/src/whitelist.ts:240-242` (`REQUIRED_VERB_FLAG`)
- Modify: `agent/src/whitelist.ts:306-370` (`EXEC_WHITELIST.ccd`)
- Create: `agent/test/types/bypasses/g10-project-pool-without-project.ts`
- Modify: `agent/test/whitelist-structural.test.ts:81-103` (`EXPECTED`)
- Modify: `agent/test/whitelist.test.ts` (path and exec cases)
- Modify: `server/src/ccdargv.ts:313-314` (two new `CCD_ARGV` entries)
- Modify: `server/test/whitelist-subset.test.ts:18-58` (`SAMPLES`) and `:310-346` (`EXPECTED`)

**Interfaces:**
- Consumes: `cmd_project_pool`'s argv shape (Task 3); `argv()` / `CcdArgv` from `server/src/ccdargv.ts`.
- Produces:
  - `EXEC_WHITELIST.ccd` gains `['project-pool', '--project']`
  - `REQUIRED_VERB_FLAG` gains `'project-pool': '--project'`
  - `CCD_ARGV.projectPoolSet(project: string, pool: string): CcdArgv` → `['project-pool','--project',project,'--pool',pool]`
  - `CCD_ARGV.projectPoolClear(project: string): CcdArgv` → `['project-pool','--project',project,'--clear']`

**Spec:** §5.4.2 ("Grant"), §5.1 (`EXEC_COMMANDS` stays closed, write root unchanged), §5.11.

**Why the builders ship in this wave and not with the route:** `whitelist-subset.test.ts` layer 3 walks every granted `ccd` prefix and asserts each is reachable from some `CCD_ARGV` entry — `expect(reachable, 'ccd <prefix> is granted but no route builds it').toBe(true)`. Adding the grant with no builder makes that assertion red immediately. Confirmed by reading `server/test/whitelist-subset.test.ts:135-157`. The ROUTE that calls the builders is wave 3's; `CCD_ARGV` entries with no route are fine (layer 3 checks the other direction only, and layer 2's `SAMPLES` is what proves they are reachable).

**Mutation table:**
- Row 15 — the two-token grant is really two tokens. Goes red when the `REQUIRED_VERB_FLAG` enrolment is removed: the g10 bypass fixture must not compile (`whitelist-structural.test.ts` `EXPECTED` demands `TS2322`), and `isExecAllowed('ccd', ['project-pool','demo'])` must stay `false`.
- Row 16 (this wave's half) — every built argv is admitted and every grant is reachable. Goes red when a grant or a builder is deleted, or a sample is omitted (`SAMPLES` and `EXPECTED` are both `Record<keyof typeof CCD_ARGV, …>`, so an omission is a TS2741 that `typecheck-tests.test.ts` catches).
- Row 17 (agent half) — the server never writes the marker. Goes red when the write root is widened: `checkPath('<home>/.cc-sessions/pools/demo', cfg, 'write')` must stay `null`.

- [ ] **Step 1: Write the failing tests — the agent side**

Create `agent/test/types/bypasses/g10-project-pool-without-project.ts`:

```ts
// BYPASS FIXTURE — MUST NOT COMPILE.
//
// ACCOUNT POOLS, wave 2a: `['project-pool', '--project']` -> `['project-pool']`,
// i.e. a grant that keeps the verb and drops the flag that is its entire
// argument surface.
//
// This is g9's shape one verb over, and it is here because the two halves of
// the mechanism are separable and only one of them is visible to a subset
// test. `isExecAllowed` is PREFIX-matching — its own comment says "tokens after
// the prefix are unconstrained" — so `['project-pool']` admits
// `ccd project-pool --project demo --pool pool-a` exactly as the two-token
// grant does, and `server/test/whitelist-subset.test.ts` stays green on the
// narrowed grant. What refuses is the ENROLMENT in `REQUIRED_VERB_FLAG`: it
// makes this edit a TS2322 on the proof line here, and a boot refusal at
// module load.
//
// A bare `project-pool` is not a narrower grant. It permits every positional
// form the verb might ever grow — and this verb REWRITES A PLACEMENT POLICY
// for a whole project, from a route the PWA reaches with no token of any kind.
import type { ExecWhitelist, LawfulGrants } from '../../../src/whitelist.js';

const table = {
  tmux: [['has-session']],
  ccd: [['start'], ['project-pool']],
} as const satisfies ExecWhitelist;

export const proven: LawfulGrants<typeof table> = table;
```

Add to `agent/test/whitelist-structural.test.ts`'s `EXPECTED`, after the `g9` entry:

```ts
  // ACCOUNT POOLS wave 2a, g9's finding one verb over: a two-token grant is
  // only two tokens wide while its verb is ENROLLED in `REQUIRED_VERB_FLAG`.
  'g10-project-pool-without-project.ts': {
    what: 'the pool tag verb granted without the flag that is its whole argument surface',
    codes: ['TS2322'],
  },
```

Add to `agent/test/whitelist.test.ts`, inside the `whitelist.checkPath` describe (after the lifecycle-journal case):

```ts
  it('the pools directory is READ-allowed and WRITE-forbidden — the server can never set a tag directly', () => {
    // Account pools, spec §5.1: the server READS `$REG/pools/` through the
    // agent (wave 3's `readProjectPools`) and writes it ONLY by asking ccd to
    // run `project-pool`. The write root stays `.cc-clips` and nothing else,
    // so a future refactor that reached for `io.writeFile` on a tag would be
    // structurally incapable rather than merely discouraged.
    seed();
    const cfg = { home, projectsRoot };
    const dir = path.join(home, '.cc-sessions', 'pools');
    for (const p of [dir, path.join(dir, 'demo'), path.join(dir, 'acct-a-demo')]) {
      expect(await checkPath(p, cfg, 'read'), `${p} must be readable`).not.toBeNull();
      expect(await checkPath(p, cfg, 'write'), `${p} must NOT be writable`).toBeNull();
    }
  });
```

(the surrounding `it` is `async`, as its siblings are).

Add to `agent/test/whitelist.test.ts`'s `whitelist.isExecAllowed` describe:

```ts
  it('grants project-pool ONLY with --project, in both directions', () => {
    // The flag is not a confirmation token here, it is the verb's whole
    // argument surface — and prefix matching leaves everything after it
    // unconstrained, so the two forms below are the entire difference the
    // grant can express.
    expect(isExecAllowed('ccd', ['project-pool', '--project', 'demo', '--pool', 'pool-a'])).toBe(true);
    expect(isExecAllowed('ccd', ['project-pool', '--project', 'demo', '--clear'])).toBe(true);
    expect(isExecAllowed('ccd', ['project-pool', 'demo'])).toBe(false);
    expect(isExecAllowed('ccd', ['project-pool'])).toBe(false);
    expect(isExecAllowed('ccd', ['project-pool', '--pool', 'pool-a'])).toBe(false);
  });
```

- [ ] **Step 2: Run the agent suites to verify they fail**

```bash
cd agent && ./node_modules/.bin/vitest run test/whitelist-structural.test.ts test/whitelist.test.ts
```
Expected: FAIL — `whitelist-structural.test.ts` "has an expectation for every fixture on disk, and a fixture for every expectation" is green (both sides gained `g10`), but `g10-project-pool-without-project.ts` reports no `TS2322` at all (`expected [] to deeply equal ['TS2322']`), because `project-pool` is not enrolled. `whitelist.test.ts` "grants project-pool ONLY with --project" fails on the first `toBe(true)`. The `checkPath` case PASSES already — `.cc-sessions` is a read root by prefix and the write root is `.cc-clips` — which is exactly the property it exists to keep true.

- [ ] **Step 3: Add the grant and the enrolment**

`agent/src/whitelist.ts:240-242` becomes:

```ts
export const REQUIRED_VERB_FLAG = {
  'ws-reap': '--expect', 'ws-rename': '--session', 'coord-pause': '--state',
  'project-pool': '--project',
} as const;
```

and its docstring gains a fourth paragraph, after the `coord-pause` one:

```
 * `project-pool` (account pools) is the fourth, and it is `coord-pause`'s
 * argument again with a sharper edge: `--project` is not a confirmation token,
 * it is the verb's whole argument surface, and the verb REWRITES A PLACEMENT
 * POLICY — after it runs, ccd will refuse to put a session on an account that
 * was legal a second earlier. A one-token `['project-pool']` grant would permit
 * every positional form the verb might ever grow, for a route the PWA reaches
 * with no box token of any kind.
```

`agent/src/whitelist.ts` — add to `EXEC_WHITELIST.ccd`, after the `['coord-pause', '--state'],` entry:

```ts
    // The project pool tag's writer (account pools, spec §5.4.2), granted on
    // `coord-pause`'s own argument: `$REG/pools/<project>` is a registry-file
    // write/unlink, non-destructive, and granting it widens nothing that
    // deletes. The server may write only `~/.cc-clips` on the fleet host and
    // `FleetIO` has no unlink at all, so setting or clearing a tag is not a
    // mutation that exists server-side — the same gap `ws-hold`/`ws-release`
    // and `coord-pause` were minted for.
    //
    // ENROLLED in `REQUIRED_VERB_FLAG` above, for `coord-pause`'s reason and
    // then some: prefix matching leaves everything after the granted tokens
    // unconstrained, so an unenrolled `['project-pool']` would admit every
    // positional form the verb might grow — and this verb changes where work
    // may be PLACED, not merely whether it is paused.
    ['project-pool', '--project'],
```

- [ ] **Step 4: Run the agent suites to verify they pass**

```bash
cd agent && npm run build && ./node_modules/.bin/vitest run test/whitelist-structural.test.ts test/whitelist.test.ts test/whitelist-noghosts.test.ts
```
Expected: PASS. (`npm run build` proves the real `LAWFUL_EXEC_WHITELIST` proof line still typechecks with the new prefix.)

- [ ] **Step 5: Write the failing test — the server's builders**

`server/test/whitelist-subset.test.ts` — add to `SAMPLES` (after `coordPause`):

```ts
  // Two ENTRIES, not one parameterised by `pool: string | null` — the
  // `start`/`enable` rule at `ccdargv.ts:180`: the route picks between two
  // words, the argv shapes differ in their tail, and layer 3 fails outright if
  // nothing builds one of them.
  projectPoolSet: ['demo', 'pool-a'],
  projectPoolClear: ['demo'],
```

and to `EXPECTED` (after `coordPause`):

```ts
    projectPoolSet: ['project-pool', '--project', 'demo', '--pool', 'pool-a'],
    projectPoolClear: ['project-pool', '--project', 'demo', '--clear'],
```

- [ ] **Step 6: Run it to verify it fails**

```bash
cd server && ./node_modules/.bin/vitest run test/whitelist-subset.test.ts
```
Expected: FAIL — layer 3's "every ccd prefix the agent grants is reachable from some CCD_ARGV entry" reports `ccd project-pool --project is granted but no route builds it`; layer 2's "has a sample for every CCD_ARGV entry" reports `SAMPLES` holding two keys `CCD_ARGV` does not.

- [ ] **Step 7: Add the two builders**

`server/src/ccdargv.ts` — insert into `CCD_ARGV` after `coordPause` (`:313`):

```ts
  /** The project pool tag's two writers (account pools, spec §5.4.2). TWO
   *  ENTRIES, not one builder taking `pool: string | null` — the `start`/
   *  `enable` rule above: the route picks between two words, the agent grants
   *  the one prefix that covers both, and `whitelist-subset` enumerates each
   *  separately so a shape nothing builds cannot hide behind its sibling.
   *
   *  `project` reaches ccd UNVALIDATED, exactly as `/api/projects/:project/
   *  workspaces` sends it: `_ws_project_valid` on the box is the authority,
   *  and nothing server-side joins a request-supplied name into a path. */
  projectPoolSet:   (project: string, pool: string) =>
                      argv(['project-pool', '--project', project, '--pool', pool]),
  projectPoolClear: (project: string) =>
                      argv(['project-pool', '--project', project, '--clear']),
```

- [ ] **Step 8: Run the server suites to verify they pass**

```bash
cd server && npm run build && ./node_modules/.bin/vitest run test/whitelist-subset.test.ts test/ccdargv-brand.test.ts
```
Expected: PASS.

- [ ] **Step 9: Measure the mutations (rows 15, 16, 17)**

Apply each, confirm the red, revert.

1. Remove `'project-pool': '--project'` from `REQUIRED_VERB_FLAG`, leaving the grant.
   Run: `cd agent && ./node_modules/.bin/vitest run test/whitelist-structural.test.ts`
   Expected: FAIL — `g10-project-pool-without-project.ts`, `expected [] to deeply equal ['TS2322']`.
2. Narrow the grant to `['project-pool']`.
   Run: `cd agent && npm run build`
   Expected: FAIL — TS2322 on `const LAWFUL_EXEC_WHITELIST: LawfulGrants<typeof EXEC_WHITELIST> = EXEC_WHITELIST;`. And `cd agent && ./node_modules/.bin/vitest run test/whitelist.test.ts` → `isExecAllowed('ccd', ['project-pool','demo'])` becomes `true`.
3. Delete `CCD_ARGV.projectPoolClear`.
   Run: `cd server && ./node_modules/.bin/vitest run test/whitelist-subset.test.ts`
   Expected: FAIL — "has a sample for every CCD_ARGV entry" (`SAMPLES` has a key `CCD_ARGV` lacks), plus TS2353 under `cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts`.
4. Delete `['project-pool', '--project'],` from `EXEC_WHITELIST.ccd`, leaving the builders.
   Run: `cd server && ./node_modules/.bin/vitest run test/whitelist-subset.test.ts`
   Expected: FAIL — layer 2, `projectPoolSet -> ccd project-pool --project demo --pool pool-a`, `expected false to be true`.
5. Widen the write root: add `|| isUnder(canonicalTarget, path.join(canonicalHome, '.cc-sessions'))` to `checkPath`'s write arm.
   Run: `cd agent && ./node_modules/.bin/vitest run test/whitelist.test.ts`
   Expected: FAIL — "the pools directory is READ-allowed and WRITE-forbidden", plus the pre-existing lifecycle-journal and `.cc-sessions/a.wrapper` write cases.

- [ ] **Step 10: Commit**

```bash
git add agent/src/whitelist.ts agent/test/types/bypasses/g10-project-pool-without-project.ts agent/test/whitelist-structural.test.ts agent/test/whitelist.test.ts server/src/ccdargv.ts server/test/whitelist-subset.test.ts
git commit -m "feat(agent,server): the tag verb crosses the wire as two tokens and nothing wider"
```

---

## Task 5: Placement — `_ws_least_loaded [project]` and `cmd_ws_add`'s refusal

**Files:**
- Modify: `ccd/ccd:3530` (the header comment) and `ccd/ccd:3583-3592` (the loop)
- Modify: `ccd/ccd:3701-3715` (`cmd_ws_add`'s preflight and refusal)
- Test: `server/test/ccd-pool-ok.test.ts` (append the placement describes)

**Interfaces:**
- Consumes: `_project_pool_state` (Task 1), `_pool_ok` / `_acct_pool` (Task 2), `_account_ok` (`ccd/ccd:1028`), `_lane_enabled` (`:1024`), `_limit_score` (`:11076`), `CCRC_HOME_ABLE` (from `accounts.sh`).
- Produces: `_ws_least_loaded [project]` — with no argument, byte-identical behaviour to today (`${1-}` reads as `untagged`); with a project, the cheapest account that both passes `_account_ok` and satisfies `_pool_ok`; empty stdout when there is none, which the CALLER disambiguates.

**Spec:** §5.5.2 (placement), §6 (the `_ws_least_loaded` seam and its overload), §3.1 (fresh placement is `cmd_ws_add` → `_ws_least_loaded` → `_ws_seed_home`).

**Mutation table:**
- Row 28 (the bash half; the `projectHome` half is wave 3's `projected-home.test.ts`) — `_ws_least_loaded <p>` skips other-pool lanes and zero-arg is unchanged. Goes red when the filter is dropped or the positional is made required.
- Row 29 — `cmd_ws_add` refuses pool-empty and undecidable naming the reason, touching nothing. Goes red when the reason arm is removed, or when `"$project"` is not passed.

**LEDGER:** `_ws_least_loaded`'s empty answer folds two conditions — "every in-pool account is at ceiling or disabled" and "the project's tag is undecidable, so nobody may decide". The overload is NOT widened at the callee (its stdout is a wrapper name and there is no second channel); it is resolved at the caller, which re-reads `_project_pool_state` and names which of the two it was in its refusal (D-1668 — spec §12 P-13).

- [ ] **Step 1: Write the failing test**

Append to `server/test/ccd-pool-ok.test.ts`. Add to the imports:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { WS_ADD } from './ccdWsHelpers.js';
```

and append:

```ts
const writeLimits = (w: string, five: number, seven: number): void =>
  fs.writeFileSync(path.join(h.home, '.cc-limits', `${w}.json`),
    JSON.stringify({ five, seven, ts: Math.floor(Date.now() / 1000) }));

const disable = (w: string): void =>
  fs.writeFileSync(path.join(h.home, '.cc-sessions', `${w}-disabled`), '');

const tag = (project: string, bytes: string): void => {
  const dir = path.join(h.home, '.cc-sessions', 'pools');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, project), bytes);
};

const shFail2 = (snippet: string): { code: number; stderr: string; stdout: string } => {
  try { return { code: 0, stderr: '', stdout: h.sh(snippet) }; }
  catch (e) {
    const err = e as { status?: number; stderr?: Buffer; stdout?: Buffer };
    return { code: err.status ?? 1, stderr: String(err.stderr ?? ''), stdout: String(err.stdout ?? '') };
  }
};

describe('_ws_least_loaded [project] — placement honours the tag', () => {
  // POOLED_TEST_ROSTER: claude -> pool-a, claude-a -> pool-a, claude-b ->
  // pool-b, claude-d untagged, gpt untagged and NOT home-able.
  it('zero-arg is byte-identical to today: the cheapest home-able lane wins', () => {
    writeLimits('claude', 50, 50);
    writeLimits('claude-a', 60, 60);
    writeLimits('claude-b', 1, 1);
    writeLimits('claude-d', 70, 70);
    expect(h.sh('_ws_least_loaded')).toBe('claude-b');
  });

  it('zero-arg is unchanged even when the same project IS tagged elsewhere', () => {
    // `${1-}` reads as `untagged`, so every pre-existing caller keeps its exact
    // meaning without knowing pools exist. The parity harness's zero-arg calls
    // depend on it.
    tag('demo', 'pool-a');
    writeLimits('claude', 50, 50);
    writeLimits('claude-b', 1, 1);
    expect(h.sh('_ws_least_loaded')).toBe('claude-b');
  });

  it('with a tagged project it skips other-pool lanes, however cheap they are', () => {
    tag('demo', 'pool-a');
    writeLimits('claude', 50, 50);
    writeLimits('claude-a', 60, 60);
    writeLimits('claude-b', 1, 1);      // cheapest, and in the WRONG pool
    writeLimits('claude-d', 70, 70);
    expect(h.sh('_ws_least_loaded demo')).toBe('claude');
  });

  it('an UNTAGGED account serves a tagged project — it is not "in no pool", it is unconstrained', () => {
    tag('demo', 'pool-a');
    writeLimits('claude', 90, 90);
    writeLimits('claude-a', 90, 90);
    writeLimits('claude-b', 1, 1);      // wrong pool
    writeLimits('claude-d', 5, 5);      // untagged, and cheapest of the eligible
    expect(h.sh('_ws_least_loaded demo')).toBe('claude-d');
  });

  it('falls back to the first IN-POOL account when nothing eligible is measured', () => {
    // The `first` fallback sits AFTER the pool filter, so an all-unmeasured
    // in-pool set falls back to the first IN-POOL account in roster order —
    // never to a cheaper-looking account in another pool.
    tag('demo', 'pool-b');
    writeLimits('claude', 1, 1);        // pool-a: must not be the fallback
    expect(h.sh('_ws_least_loaded demo')).toBe('claude-b');
  });

  it('answers EMPTY when every in-pool lane is disabled', () => {
    tag('demo', 'pool-b');
    disable('claude-b');
    disable('claude-d');
    expect(h.sh('_ws_least_loaded demo')).toBe('');
  });

  it('answers EMPTY when the tag is undecidable — nobody decides, not "everyone may"', () => {
    // The mutant this kills is the one that matters most: an undecidable tag
    // that let placement proceed would put work on whatever account is
    // cheapest, i.e. it would silently LIFT the constraint on a chmod.
    for (const bytes of ['Pool a', '']) {
      tag('demo', bytes);
      writeLimits('claude-b', 1, 1);
      expect(h.sh('_ws_least_loaded demo'), JSON.stringify(bytes)).toBe('');
    }
    fs.rmSync(path.join(h.home, '.cc-sessions', 'pools', 'demo'));
    fs.mkdirSync(path.join(h.home, '.cc-sessions', 'pools', 'demo'));
    expect(h.sh('_ws_least_loaded demo')).toBe('');
  });
});

describe('cmd_ws_add refuses in-pool, names the reason, and touches nothing', () => {
  it('names the pool, each accounts own first failing predicate, and the remedies', () => {
    h.makeRepo('demo');
    tag('demo', 'pool-b');
    disable('claude-b');
    disable('claude-d');
    const r = shFail2(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('in pool pool-b');
    // FIRST FAILING PREDICATE IN LOOP ORDER, mirroring `_ws_least_loaded`'s own
    // order: missing, then disabled, then pool. An account that is BOTH
    // disabled and in the wrong pool is reported as disabled, because that is
    // the check that ran first and the one the operator fixes first.
    expect(r.stderr).toContain('claude:pool=pool-a');
    expect(r.stderr).toContain('claude-a:pool=pool-a');
    expect(r.stderr).toContain('claude-b:disabled');
    expect(r.stderr).toContain('claude-d:disabled');
    expect(r.stderr).toContain('nothing was touched');
    // …and it really touched nothing.
    expect(fs.existsSync(path.join(h.home, 'worktrees', 'demo', 'quiet-mesa'))).toBe(false);
    expect(h.reg('demo-quiet-mesa', 'uuid')).toBeNull();
  });

  it('names the TAG, not the accounts, when the tag is undecidable', () => {
    // The two empties `_ws_least_loaded` cannot tell apart, told apart here.
    // Without this the operator is sent to enable a lane for a project whose
    // problem is a permission bit on one file.
    h.makeRepo('demo');
    tag('demo', 'Pool a');
    const r = shFail2(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('tag:malformed');
    expect(r.stderr).toContain('.cc-sessions/pools/demo');
    expect(r.stderr).not.toContain(':disabled');
    expect(h.reg('demo-quiet-mesa', 'uuid')).toBeNull();
  });

  it('still places into a tagged project when the pool has an account', () => {
    // The other direction: the refusal must not have become the only outcome.
    h.makeRepo('demo');
    tag('demo', 'pool-b');
    writeLimits('claude', 1, 1);        // cheapest, wrong pool
    writeLimits('claude-b', 90, 90);
    h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
    expect(h.reg('demo-quiet-mesa', 'home')).toBe('claude-b');
  });

  it('an untagged project keeps the pre-existing refusal sentence exactly', () => {
    // No pool words where there is no pool. The reason list is unchanged for
    // every project on the box that nobody has tagged.
    h.makeRepo('demo');
    for (const w of ['claude', 'claude-a', 'claude-b', 'claude-d']) disable(w);
    const r = shFail2(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('no account available for placement —');
    expect(r.stderr).not.toContain('in pool');
    expect(r.stderr).not.toContain(':pool=');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-pool-ok.test.ts`
Expected: FAIL — the zero-arg cases and the untagged-project refusal PASS (nothing changed for them yet); "with a tagged project it skips other-pool lanes" gives `'claude-b'` instead of `'claude'`; "answers EMPTY when the tag is undecidable" gives `'claude-b'`; both new `cmd_ws_add` cases fail on the missing reason substrings.

- [ ] **Step 3: Teach `_ws_least_loaded` the optional positional**

`ccd/ccd:3530` — the signature comment becomes:

```bash
_ws_least_loaded() {   # [project] -> the home-able account with the most headroom, or "" if none is placeable
```

and append to that function's existing comment block, immediately above `local best=""` (`:3583`):

```bash
  # THE OPTIONAL POSITIONAL IS THE PROJECT (account pools, spec §5.5.2), and
  # zero-arg keeps today's meaning EXACTLY: `_project_pool_state ""` answers
  # `untagged` by its own first guard, `_pool_ok` returns 0 for `untagged`, and
  # every pre-existing caller — the parity harness included — is byte-identical.
  #
  # THE STATE IS READ ONCE, before the loop, and the WORD is passed to each
  # candidate: a loop over five accounts costs one `cat`, not five.
  #
  # ONE PREDICATE, NO SECOND EXIT. An UNDECIDABLE tag needs no early return of
  # its own: `_pool_ok` answers 2 for every candidate, every candidate
  # `continue`s, `first` stays empty and this function answers "" — which is
  # the right answer (nobody may decide) reached by the same line that skips a
  # wrong-pool lane. Deleting that line therefore reds BOTH the skip cases and
  # the undecidable cases, which is why there is no second guard here to keep
  # in step with it.
  #
  # THE EMPTY ANSWER IS OVERLOADED and stays that way: "" is both "every
  # in-pool lane is at ceiling or disabled" and "the tag is undecidable". There
  # is no second channel on this seam — stdout carries a wrapper name — so the
  # CALLER re-reads the state and names which it was (`cmd_ws_add`, below).
  local pps; pps=$(_project_pool_state "${1-}")
```

and the loop body (`:3584-3589`) becomes:

```bash
  for w in "${CCRC_HOME_ABLE[@]}"; do
    _account_ok "$w" || continue
    # AFTER `_account_ok`, BEFORE `first`: the fallback below must land on the
    # first IN-POOL account, never on a cheaper-looking lane in another pool.
    _pool_ok "$w" "$pps" || continue
    [[ -z "$first" ]] && first="$w"
    sc=$(_limit_score "$w"); [[ -z "$sc" ]] && continue
    (( sc < bs )) && { bs=$sc; best="$w"; }
  done
```

- [ ] **Step 4: Pass the project and name the reason in `cmd_ws_add`**

`ccd/ccd:3707-3715` becomes:

```bash
  local hw; hw=$(_ws_least_loaded "$project")
  if [[ -z "$hw" ]]; then
    # TWO EMPTIES, TOLD APART HERE (spec §6). `_ws_least_loaded` answers "" for
    # "every in-pool lane is unusable" AND for "the tag is undecidable", and
    # the two have completely different remedies — enable a lane versus fix one
    # file's bytes. Re-reading the state costs one `cat` on a path that is
    # already refusing.
    local w why="" pps ppn=""
    pps=$(_project_pool_state "$project")
    case "$pps" in "named "*) ppn=${pps#named } ;; esac
    if [[ "$pps" != untagged && -z "$ppn" ]]; then
      why=" tag:$pps $POOLS_DIR/$project"
    else
      for w in "${CCRC_HOME_ABLE[@]}"; do
        # FIRST FAILING PREDICATE IN LOOP ORDER — `_ws_least_loaded`'s own
        # order, so the reason names the check that actually stopped this
        # account rather than the last one that would have.
        if   [[ ! -x "$WRAPPER_DIR/$w" ]]; then why+=" $w:missing"
        elif ! _lane_enabled "$w";       then why+=" $w:disabled"
        # `pps` is `untagged` or `named …` in this branch, so `_pool_ok` can
        # only answer 0 or 1 here, and an account reported with `pool=` is
        # always a TAGGED one — the empty answer never reaches this string.
        elif ! _pool_ok "$w" "$pps";     then why+=" $w:pool=$(_acct_pool "$w")"
        fi
      done
    fi
    die "no account available for placement${ppn:+ in pool $ppn} —${why}; enable one (rm $REG/<w>-disabled)${ppn:+, tag an account into pool $ppn in ~/.ccrc/accounts.json and redeploy the agent lane, or untag the project (ccd project-pool --project $project --clear)} and retry — nothing was touched"
  fi
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-pool-ok.test.ts test/ccd-account-ok.test.ts test/ccd-workspaces.test.ts
```
Expected: PASS. `ccd-account-ok.test.ts` and `ccd-workspaces.test.ts` are the pre-existing owners of `_ws_least_loaded` and `cmd_ws_add`'s preflight; both must stay green, which is what proves zero-arg is unchanged.

- [ ] **Step 6: Measure the mutations (rows 28-bash, 29)**

Apply each, confirm the red, revert.

1. Delete `_pool_ok "$w" "$pps" || continue` from the loop.
   Expected: FAIL — "with a tagged project it skips other-pool lanes" (`'claude-b'` for `'claude'`), "falls back to the first IN-POOL account" (`'claude'` for `'claude-b'`), "answers EMPTY when every in-pool lane is disabled", and all three undecidable cases.
2. Move `_pool_ok "$w" "$pps" || continue` BELOW `[[ -z "$first" ]] && first="$w"`.
   Expected: FAIL — "falls back to the first IN-POOL account", `expected 'claude' to be 'claude-b'`.
3. Make the positional required: `local pps; pps=$(_project_pool_state "$1")`.
   Expected: FAIL — every zero-arg case in `ccd-account-ok.test.ts` and `ccd-pool-ok.test.ts` throws with `$1: unbound variable`.
4. Change `_ws_least_loaded "$project"` back to `_ws_least_loaded` in `cmd_ws_add`.
   Expected: FAIL — "names the pool, each account's own first failing predicate" (placement succeeds where it must refuse) and "still places into a tagged project" now seeds `claude`.
5. Delete the `elif ! _pool_ok "$w" "$pps"; then why+=" $w:pool=$(_acct_pool "$w")"` arm.
   Expected: FAIL — "names the pool…", `expected stderr to contain 'claude:pool=pool-a'`.
6. Delete the `if [[ "$pps" != untagged && -z "$ppn" ]]` branch, leaving only the account loop.
   Expected: FAIL — "names the TAG, not the accounts, when the tag is undecidable", `expected stderr to contain 'tag:malformed'`.

- [ ] **Step 7: Commit**

```bash
git add ccd/ccd server/test/ccd-pool-ok.test.ts
git commit -m "feat(ccd): fresh placement asks the pool question, and a refusal says which of the two empties it was"
```

---

## Task 6: The `rehome` lifecycle act, in all three vocabularies

**Files:**
- Modify: `ccd/ccd:1670-1672` (`_LC_ACTS`)
- Modify: `shared/api.ts:4609-4631` (the `LifecycleAct` union) and `:4638-4644` (`LIFECYCLE_ACT_MAP`)
- Modify: `pwa/src/session/journalWords.ts:27-36` (`ACT_WORD`)
- Modify: `server/test/lifecycle-acts.test.ts:15-22, :33, :54`
- Modify: `server/test/lifecycle-vocabulary.test.ts:27` (prose) and `:148`
- Modify: `server/test/ccd-lifecycle-emit.test.ts:27`
- Modify: `server/test/single-definition.test.ts:2136` (prose) and `:2138`

**Interfaces:**
- Produces: the act token `rehome`, accepted by `_lc_emit` (via `_LC_ACTS`), modelled by `LifecycleAct`, rendered by `ACT_WORD`. Wave 2b's re-seed and `cmd_prefer` write `_lc_done rehome "$id" "" meas.from <old> meas.home <new> meas.reason <pool|prefer> [meas.pool <name>] [dec.crosspool 1]`.

**Spec:** §5.5.4 item 1 (the re-seed journals `rehome`), §5.5.5 (`cmd_prefer` journals it for the first time, P-2 (D-1677)), §11 row 32.

**Why the ACT ships here and its call sites do not:** `lifecycle-vocabulary.test.ts` EXECUTES `_LC_ACTS` under `makeCcdHarness` and asserts set equality with `LIFECYCLE_ACTS` minus the degrade, in both directions. Wave 2b's first `_lc_done rehome …` line would be written by a ccd whose `_LC_ACTS` did not carry the token, and `_lc_emit` would degrade it to `act:"unknown"` with `badact:"rehome"`. Shipping the vocabulary a wave early costs nothing and is exactly what the `gc` act already does — declared, wire-facing, additive-only, and emitted by nothing (`shared/api.ts:4621-4628`).

**Mutation table:**
- Row 32 — `rehome` in both vocabularies. Goes red when either side lacks it: `lifecycle-vocabulary.test.ts` on the SET (`expected [22 acts] to deeply equal [21 acts]`), and TS2739 on `ACT_WORD` / `LIFECYCLE_ACT_MAP` under `pwa`'s `npm run build` and `server`'s `typecheck-tests.test.ts`.

- [ ] **Step 1: Write the failing test — the count guards move first**

`server/test/lifecycle-acts.test.ts` — add `rehome: true,` to `ALL_ACTS` (after `reap: true,`), and change:

```ts
    expect(ACTS.length).toBe(23);
```
```ts
    expect(LIFECYCLE_ACTS.filter((a) => a !== LC_ACT_UNKNOWN)).toHaveLength(22);
```

`server/test/lifecycle-vocabulary.test.ts:148` — `expect.soft(want.length, 'guards the guard: an empty want passes everything').toBe(22);` (and its header line `:27` "…(21 acts)" becomes "…(22 acts)").

`server/test/ccd-lifecycle-emit.test.ts:27` — `expect(want.length, 'guards the guard: an empty want passes everything').toBe(22);`

`server/test/single-definition.test.ts:2138` — `expect(LIFECYCLE_ACTS.length).toBe(23);` (and the prose at `:2136` "8 of 22" becomes "8 of 23").

- [ ] **Step 2: Run them to verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/lifecycle-acts.test.ts test/lifecycle-vocabulary.test.ts test/ccd-lifecycle-emit.test.ts test/single-definition.test.ts
```
Expected: FAIL — `lifecycle-acts.test.ts` "covers the whole union" (`expected 22 to be 23`) and TS2353 on `ALL_ACTS`'s `rehome` key under `typecheck-tests`; the three count guards all `expected 21 to be 22` / `expected 22 to be 23`.

- [ ] **Step 3: Add the act to L0**

`shared/api.ts` — in the `LifecycleAct` union, insert after the `reap` member (`:4620`):

```ts
  | 'rehome'        // a session's HOME account moved — the pool re-seed
                    // (account pools §5.5.4) and `ccd prefer`, which wrote
                    // `.home` and journalled nothing until this act existed.
                    // DISTINCT FROM `swap`: `swap` moves the session it is
                    // running on, `rehome` moves the account it returns to.
```

and in `LIFECYCLE_ACT_MAP` (`:4638-4644`) add `rehome: true,` after `reap: true,`.

- [ ] **Step 4: Add the act to `_LC_ACTS`**

`ccd/ccd:1670-1672` becomes (the array is alphabetical; `reap` < `rehome` < `release`):

```bash
_LC_ACTS=(archive attic-drop claim create destroy enable ensure forget gc
          hold purge reap rehome release rename restore spawn start stop
          supervise swap unsupervise)
```

- [ ] **Step 5: Add the PWA word**

`pwa/src/session/journalWords.ts` — in `ACT_WORD`, after `reap: 'reaped',`:

```ts
  rehome: 'home account moved',
```

- [ ] **Step 6: Run the suites to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/lifecycle-acts.test.ts test/lifecycle-vocabulary.test.ts test/ccd-lifecycle-emit.test.ts test/single-definition.test.ts test/typecheck-tests.test.ts
cd pwa && npm run build && ./node_modules/.bin/vitest run test/journal-words.test.ts
```
Expected: PASS. (`typecheck-tests` is a known load flake — re-run it in isolation before calling a red real.)

- [ ] **Step 7: Measure the mutation (row 32)**

1. Remove `rehome` from `_LC_ACTS` only.
   Run: `cd server && ./node_modules/.bin/vitest run test/lifecycle-vocabulary.test.ts test/ccd-lifecycle-emit.test.ts`
   Expected: FAIL — both files' set equality, `expected [ …21 acts… ] to deeply equal [ …22 acts… ]`.
2. Remove `rehome: true` from `LIFECYCLE_ACT_MAP` only, leaving the union member.
   Run: `cd server && npm run build`
   Expected: FAIL — TS2739 on `const LIFECYCLE_ACT_MAP: Record<LifecycleAct, true>`, property `rehome` missing.
3. Remove `rehome: 'home account moved'` from `ACT_WORD`.
   Run: `cd pwa && npm run build`
   Expected: FAIL — TS2739 on `Record<LifecycleAct, string>`; and `cd pwa && ./node_modules/.bin/vitest run test/journal-words.test.ts` → `no word for act rehome`.

- [ ] **Step 8: Commit**

```bash
git add ccd/ccd shared/api.ts pwa/src/session/journalWords.ts server/test/lifecycle-acts.test.ts server/test/lifecycle-vocabulary.test.ts server/test/ccd-lifecycle-emit.test.ts server/test/single-definition.test.ts
git commit -m "feat(shared,ccd,pwa): rehome joins the act vocabulary, in all three spellings at once"
```

---

## Task 7: The lifecycle manifest entry for `project-pool-tag`

**Files:**
- Modify: `shared/lifecycle.ts:16-32` (`LIFECYCLE`)
- Modify: `server/test/lifecycle.test.ts:840-855` (the manifest describe)

**Interfaces:**
- Consumes: `LifecycleClass` (`shared/lifecycle.ts:5-14`).
- Produces: one `LIFECYCLE` entry named `project-pool-tag`, pattern `O`, `collector: null`, `ruling` non-empty.

**Spec:** §9 (the manifest table and the ruling text), §5.4.1 (Lifecycle row: `_reg_purge`, `ws-rm`, `ws-reap`, `ws-gc`, `ws-archive`, `ws-restore` and `forget` never name `pools/`).

**Mutation table:**
- Row 50 — the manifest entry carries a ruling. Goes red when the ruling is emptied (the existing collector-null assertion) or when the class is dropped (the new named assertion).

- [ ] **Step 1: Write the failing test**

`server/test/lifecycle.test.ts` — inside `describe('shared/lifecycle.ts — the policy §4(a) manifest')`, add:

```ts
  it('declares project-pool-tag, and it is a collector-less class with an operator ruling', () => {
    // `docs/superpowers/specs/2026-08-11-artifact-lifecycle-policy.md` §1.2
    // makes an unassigned artifact class a defect, and this one has NO
    // COLLECTOR by design: a project's pool tag outlives every one of its
    // workspaces — `_reg_purge`, `ws-rm`, `ws-reap`, `ws-gc`, `ws-archive`,
    // `ws-restore` and `forget` all glob `$REG/<id>.*` and none of them can
    // see a dotless directory. Nothing sweeps operator intent; the operator
    // clears it, and `ccrc doctor` says when it has gone inert.
    //
    // The three per-id fields the pool design also adds (`.stranded`,
    // `.strandnotify`, `.crosspool`, wave 2b) need no entry of their own: they
    // are registry fields under the one-dot rule and purge with the row, like
    // `swapblocked` and `lastswap`.
    const c = LIFECYCLE.find((x) => x.name === 'project-pool-tag');
    expect(c, 'shared/lifecycle.ts declares no project-pool-tag class').toBeTruthy();
    expect(c!.pattern).toBe('O');
    expect(c!.collector).toBeNull();
    expect(c!.ruling).toContain('ccd project-pool');
    expect(c!.ruling).toContain('pools-stale');
    expect(c!.root).toContain('pools/');
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts`
Expected: FAIL — `shared/lifecycle.ts declares no project-pool-tag class`, `expected undefined to be truthy`.

- [ ] **Step 3: Add the entry**

`shared/lifecycle.ts` — append to the `LIFECYCLE` array, after the `graph-sweep-census` entry:

```ts
  { name: 'project-pool-tag', root: '~/.cc-sessions/pools/<project>', pattern: 'O',
    creators: ['ccd project-pool', 'operator shell'], collector: null,
    bound: 'until cleared', tier: '<64 bytes per tagged project, one file per project',
    ruling: 'Operator intent on the record: persists until `ccd project-pool --project <p> --clear` or `rm`. A tag whose project directory and registry rows are both gone is inert — no lane reads it — and `ccrc doctor` lists it as WARN `pools-stale`.' },
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts`
Expected: PASS. The pre-existing "is L0: imports nothing at all" case must stay green — the new entry adds no import.

- [ ] **Step 5: Measure the mutation (row 50)**

1. Set the entry's `ruling` to `''`.
   Expected: FAIL — the pre-existing "every collector-less class carries a non-empty operator ruling" (`project-pool-tag needs a ruling`) AND the new case's `toContain`.
2. Delete the entry.
   Expected: FAIL — the new case, `shared/lifecycle.ts declares no project-pool-tag class`.

- [ ] **Step 6: Commit**

```bash
git add shared/lifecycle.ts server/test/lifecycle.test.ts
git commit -m "docs(lifecycle): the project pool tag is operator intent with no collector, and says so in the manifest"
```

---

## Task 8: The doctor's `pools` check

**Files:**
- Modify: `ccd/ccrc-doctor-checks:166-195` (`CCRC_DOCTOR_CHECKS` gains `pools` after `wrappers`)
- Modify: `ccd/ccrc-doctor-checks:2638` (insert `POOL_NAME_RE` and `_check_pools` between `_check_wrappers`'s closing brace and the `_check_graphify` header block)
- Modify: `ccd/ccrc-doctor-checks:3278-3285` (the D-72 note)
- Modify: `server/test/pool-name-parity.test.ts` (the third literal)
- Modify: `server/test/ccrc-doctor.test.ts` (a new `describe`)

**Interfaces:**
- Consumes: `_dr_pass` / `_dr_warn` / `_dr_fail` / `_dr_join` (`ccd/ccrc-doctor-checks:202-220`); `~/.ccrc/accounts.sh` (the projection ccd obeys — reading it here rather than `accounts.json` is D-1669); `POOL_NAME_RE` (a third bash spelling — see below).
- Produces: `_check_pools`, returning 0 / 1 / 2 by the file's own convention.

**Spec:** §5.4.6 (the check and its six verdict classes), §5.3 (the D-72 note must say `pool` is covered by the digest and `hidden` is not).

**The third bash spelling, argued rather than smuggled.** `ccrc-doctor-checks` is sourced under `set -u` by things that are not `ccrc` — `ccrc-doctor.test.ts`'s `tableNames()` does exactly that — so a top-level reference to another tool's variable would make sourcing it FAIL, and a `${…:-…}` fallback is a second spelling with a branch in front of it (D-92's trade, restated in `single-definition.test.ts`'s `CCRC_RC_FILE` block). The file therefore carries its own `POOL_NAME_RE`, exactly as it carries its own `CCRC_RC_FILE` (`:1434`) and as `ccd/ccrc-wrapper-shape:67` carries its own hand-written copy of `shared/roster.ts`'s `ID_RE`. Reusing `WRAPPER_ID_RE` instead was rejected: the two grammars COINCIDE for a stated reason (§5.3) but they are not the same vocabulary, and spelling a pool name as an account id is the "two meanings of one name" defect this design already records once (D-1666). `pool-name-parity.test.ts` grows a third extraction, so this copy — unlike `WRAPPER_ID_RE` — is measured.

**Mutation table:**
- Row 5 (extended) — the doctor's literal equals the other two. Goes red when it drifts or is duplicated.
- Row 49 — the doctor names each class with its own remedy. Goes red when classes are joined into one verdict line, or when `pools` is dropped from `CCRC_DOCTOR_CHECKS` (the table ↔ function census reds in both directions, and the "runs every check in the table" case loses its verdict line).

- [ ] **Step 1: Write the failing test**

Append the third extraction to `server/test/pool-name-parity.test.ts`, inside the grammar describe:

```ts
  it('ccd/ccrc-doctor-checks holds exactly one POOL_NAME_RE, byte-equal to the other two', () => {
    // A THIRD bash spelling, and the reason it exists rather than being
    // imported: this file is sourced under `set -u` by things that are not
    // `ccrc` (this suite's own `tableNames()` is one), so it cannot reference
    // another tool's variable at the top level — D-92's trade, the one
    // `CCRC_RC_FILE` already makes here. What it CAN have is a pin.
    const checks = readFileSync(path.join(ccrcRoot, 'ccd', 'ccrc-doctor-checks'), 'utf8');
    const bash = exactlyOne(checks, /^POOL_NAME_RE='([^']*)'$/gm, 'ccrc-doctor-checks POOL_NAME_RE');
    expect(bash).toBe(POOL_NAME_RE.source);
  });
```

Append to `server/test/ccrc-doctor.test.ts` (after the `wrappers` describe):

```ts
describe('ccrc doctor: pools', () => {
  /** `$HOME/.cc-sessions/pools/<project>`, with EXACT bytes. */
  function tag(home: string, project: string, bytes: string): string {
    const d = join(home, '.cc-sessions', 'pools');
    mkdirSync(d, { recursive: true });
    const p = join(d, project);
    writeFileSync(p, bytes);
    return p;
  }

  /** A project directory under `$HOME/projects`, which is where the check
   *  looks for one — the same spelling `_check_graphify` uses (`:2764`). */
  const project = (home: string, name: string): void =>
    mkdirSync(join(home, 'projects', name), { recursive: true });

  /** The roster projection ccd obeys, so the orphan arm has a pool vocabulary
   *  to measure against. Generated, never hand-written — a fixture accounts.sh
   *  typed out here would be a copy of the roster deciding what the check
   *  believes. */
  const pooledRoster = (home: string): void => seedAccountsSh(home, POOLED_TEST_ROSTER);

  it('PASSES with no pools directory at all — nothing is tagged, nothing is constrained', () => {
    const home = healthy('ccrc-doctor-pools-none-');
    const line = lineFor(runDoctor(home).stdout, 'pools');
    expect(line).toMatch(/^PASS pools: /);
    expect(line).toContain('no project pools tagged');
  });

  it('PASSES on a tagged, coherent box — one line, no remedy', () => {
    const home = healthy('ccrc-doctor-pools-ok-');
    pooledRoster(home);
    project(home, 'demo');
    tag(home, 'demo', 'pool-a');
    const out = runDoctor(home).stdout;
    expect(lineFor(out, 'pools')).toMatch(/^PASS pools: /);
    expect(out.split('\n').filter((l) => / pools: /.test(l))).toHaveLength(1);
  });

  it('FAILS pools-malformed with its own remedy, and names the file', () => {
    const home = healthy('ccrc-doctor-pools-malformed-');
    pooledRoster(home);
    project(home, 'demo');
    tag(home, 'demo', 'Pool a');
    const lines = runDoctor(home).stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL pools: ') && l.includes('pools-malformed'));
    expect(i, `no pools-malformed line:\n${lines.join('\n')}`).toBeGreaterThan(-1);
    expect(lines[i]).toContain('demo');
    expect(lines[i + 1]).toMatch(/^ {2}remedy: \S/);
  });

  it('WARNS pools-stale for a tag whose project and registry rows are both gone', () => {
    const home = healthy('ccrc-doctor-pools-stale-');
    pooledRoster(home);
    tag(home, 'quiet-basin', 'pool-a');   // no projects/quiet-basin, no *.project row
    const lines = runDoctor(home).stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN pools: ') && l.includes('pools-stale'));
    expect(i, `no pools-stale line:\n${lines.join('\n')}`).toBeGreaterThan(-1);
    // The remedy is the verb, and the verb's `--clear` arm is existence-free
    // precisely so this remedy always works.
    expect(lines[i + 1]).toContain('ccd project-pool --project quiet-basin --clear');
  });

  it('does NOT call a registry-only project stale', () => {
    // The `--pool` arm accepts a project that exists only as a registry row;
    // the doctor must use the same two-way test, or it reports every
    // custom-workdir project as stale.
    const home = healthy('ccrc-doctor-pools-regonly-');
    pooledRoster(home);
    mkdirSync(join(home, '.cc-sessions'), { recursive: true });
    writeFileSync(join(home, '.cc-sessions', 'claude-quiet-basin.project'), 'quiet-basin');
    tag(home, 'quiet-basin', 'pool-a');
    expect(lineFor(runDoctor(home).stdout, 'pools')).toMatch(/^PASS pools: /);
  });

  it('WARNS pools-orphan-pool when no rostered account carries the name', () => {
    const home = healthy('ccrc-doctor-pools-orphan-');
    pooledRoster(home);
    project(home, 'demo');
    tag(home, 'demo', 'pool-c');          // no account in POOLED_TEST_ROSTER carries it
    const lines = runDoctor(home).stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN pools: ') && l.includes('pools-orphan-pool'));
    expect(i, `no pools-orphan-pool line:\n${lines.join('\n')}`).toBeGreaterThan(-1);
    expect(lines[i + 1]).toMatch(/^ {2}remedy: \S/);
  });

  it('WARNS pools-tmp-leak for a dot-leading entry, with `rm` as the remedy', () => {
    const home = healthy('ccrc-doctor-pools-leak-');
    pooledRoster(home);
    project(home, 'demo');
    tag(home, 'demo', 'pool-a');
    tag(home, '.demo.4242.tmp', 'pool-a');
    const lines = runDoctor(home).stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN pools: ') && l.includes('pools-tmp-leak'));
    expect(i, `no pools-tmp-leak line:\n${lines.join('\n')}`).toBeGreaterThan(-1);
    expect(lines[i + 1]).toContain('rm');
  });

  it('FAILS pools-unlistable when a regular file sits where the directory belongs', () => {
    const home = healthy('ccrc-doctor-pools-unlistable-');
    mkdirSync(join(home, '.cc-sessions'), { recursive: true });
    writeFileSync(join(home, '.cc-sessions', 'pools'), 'not a directory\n');
    const lines = runDoctor(home).stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL pools: ') && l.includes('pools-unlistable'));
    expect(i, `no pools-unlistable line:\n${lines.join('\n')}`).toBeGreaterThan(-1);
    expect(lines[i + 1]).toMatch(/^ {2}remedy: \S/);
  });

  it.skipIf(process.getuid?.() === 0)(
    'FAILS pools-unreadable for a mode-000 tag, and never calls it untagged', () => {
      const home = healthy('ccrc-doctor-pools-unreadable-');
      pooledRoster(home);
      project(home, 'demo');
      const p = tag(home, 'demo', 'pool-a');
      chmodSync(p, 0o000);
      try {
        const lines = runDoctor(home).stdout.split('\n');
        const i = lines.findIndex((l) => l.startsWith('FAIL pools: ') && l.includes('pools-unreadable'));
        expect(i, `no pools-unreadable line:\n${lines.join('\n')}`).toBeGreaterThan(-1);
        expect(lines[i]).toContain('demo');
      } finally {
        chmodSync(p, 0o600);
      }
    });

  it('gives each class its OWN line and its OWN remedy, never one joined verdict', () => {
    // Two classes with two different remedies on one box: `pools-malformed` is
    // "rewrite the file", `pools-stale` is "clear the tag". Joining them hands
    // one finding the other's instruction, the collapse `_check_wrappers` was
    // split for.
    const home = healthy('ccrc-doctor-pools-two-');
    pooledRoster(home);
    project(home, 'demo');
    tag(home, 'demo', 'Pool a');
    tag(home, 'quiet-basin', 'pool-a');
    const lines = runDoctor(home).stdout.split('\n');
    const verdicts = lines.filter((l) => / pools: /.test(l));
    expect(verdicts.length, `expected two pools verdict lines:\n${lines.join('\n')}`).toBe(2);
    for (const v of verdicts) {
      expect(lines[lines.indexOf(v) + 1]).toMatch(/^ {2}remedy: \S/);
    }
  });
});
```

with `POOLED_TEST_ROSTER` imported from `./fixtures/poolRule.js` and `seedAccountsSh` added to the existing `./ccdWsHelpers.js` import.

- [ ] **Step 2: Run them to verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/pool-name-parity.test.ts test/ccrc-doctor.test.ts
```
Expected: FAIL — the parity file reports `ccrc-doctor-checks POOL_NAME_RE: expected exactly one occurrence, found 0`; every new doctor case reports `expected undefined to match /^PASS pools: /` (there is no `pools` line at all). The pre-existing "every name in the table has a `_check_<name>` function, and vice versa" and "runs every check in the table" stay green until Step 3 adds the table entry.

- [ ] **Step 3: Add the literal and the check**

`ccd/ccrc-doctor-checks:166` — insert `pools` into `CCRC_DOCTOR_CHECKS` immediately after `wrappers`. (Pools are the roster's SECOND projection; the check that measures the first one is its neighbour.)

`ccd/ccrc-doctor-checks:2638` — after `_check_wrappers`'s closing brace and before the `# ── graphify:` header block:

```bash
# ── the project pool tags (account pools, spec §5.4.6) ────────────────────
# `$HOME/.cc-sessions/pools/<project>` is one file per tagged project, holding
# one token. This check REPORTS and RESOLVES NOTHING — `_check_wrappers`'s own
# contract — because every finding here is either an operator's intent to
# revise or a permission bit no doctor should silently change.
#
# THE GRAMMAR IS SPELLED HERE, and that is D-92's trade rather than an
# oversight: this file is sourced under `set -u` by things that are not `ccrc`
# (`ccrc-doctor.test.ts`'s `tableNames()`), so a top-level reference to `ccd`'s
# `POOL_NAME_RE` would make sourcing it FAIL, and a `${…:-…}` fallback is the
# second spelling with a branch in front of it. `CCRC_RC_FILE` below makes the
# identical trade. What is different from `ccrc-wrapper-shape`'s hand-copy of
# `ID_RE` is that this one is PINNED: `server/test/pool-name-parity.test.ts`
# extracts all three spellings — TypeScript, `ccd/ccd`, and this line — and
# holds them byte-equal.
POOL_NAME_RE='^[a-z][a-z0-9-]{0,31}$'
_check_pools() {
  local dir="$HOME/.cc-sessions/pools" reg="$HOME/.cc-sessions" proot="$HOME/projects"
  if [ ! -e "$dir" ]; then
    _dr_pass pools "no project pools tagged ($dir does not exist) — every project is unconstrained, which is the pre-pools behaviour"
    return 0
  fi
  # A regular file, a dangling symlink, or a directory nobody may list. ccd
  # reads the same directory and cannot decide a tag it cannot reach, so this
  # is a FAIL rather than the absence above.
  if [ ! -d "$dir" ] || [ ! -r "$dir" ] || [ ! -x "$dir" ]; then
    _dr_fail pools "pools-unlistable: $dir is not a listable directory, so no project's tag can be read — ccd reads this same path" \
      "fix what is at that path — check with: ls -ld $dir"
    return 1
  fi

  # ONE BUCKET PER REMEDY, this file's standing rule: two conditions cured by
  # the same command share a verdict line; a condition with a DIFFERENT cure
  # gets its own line and its own remedy. Five buckets, five different cures.
  local p_leak=() p_unread=() p_malformed=() p_stale=() p_orphan=()
  # The pool vocabulary the FLEET obeys — `~/.ccrc/accounts.sh`, the generated
  # projection, not `accounts.json`. Sourced in a SUBSHELL so nothing it
  # defines lands in doctor's namespace. When it cannot be read the orphan arm
  # makes NO CLAIM (an empty `known`): `_check_wrappers` already FAILs loudly
  # for a missing or unreadable roster with its own remedy, and inventing a
  # second verdict for the same condition would hand one fact two vocabularies.
  local known=""
  if [ -r "$HOME/.ccrc/accounts.sh" ]; then
    known="$( . "$HOME/.ccrc/accounts.sh" 2>/dev/null \
      && declare -F _ccrc_pool >/dev/null 2>&1 \
      && for a in "${CCRC_ACCOUNTS[@]}"; do _ccrc_pool "$a"; done )" || known=""
  fi

  local n f v
  for f in "$dir"/*; do
    [ -e "$f" ] || continue          # unmatched glob: no nullglob here
    n="${f##*/}"
    case "$n" in
      .*) p_leak+=("$n"); continue ;;
    esac
    # The four arms are `_project_pool_state`'s, in its order and with its
    # meanings — a doctor that measured the tag differently from the file that
    # obeys it would report on a rule nobody enforces.
    if ! v="$(cat -- "$f" 2>/dev/null)"; then
      p_unread+=("$n"); continue
    fi
    v="${v%"${v##*[![:space:]]}"}"
    if ! [[ "$v" =~ $POOL_NAME_RE ]]; then
      p_malformed+=("$n"); continue
    fi
    # STALE is about the PROJECT, not the pool: a directory under the projects
    # root, or a registry row naming it — the same two-way test the verb's
    # `--pool` arm applies, so a custom-workdir project is never called stale.
    if [ ! -d "$proot/$n" ] && ! grep -qxF -- "$n" "$reg"/*.project 2>/dev/null; then
      p_stale+=("$n")
    fi
    # ORPHAN is about the POOL: no rostered account carries the name, so this
    # pool is EMPTY and every session of this project will strand rather than
    # cross (ruling 6). WARN, not FAIL — the pool may be about to gain an
    # account (O5).
    if [ -n "$known" ] && ! printf '%s\n' "$known" | grep -qxF -- "$v"; then
      p_orphan+=("$n ($v)")
    fi
  done

  local rc=0
  if [ "${#p_unread[@]}" -gt 0 ]; then
    _dr_fail pools "pools-unreadable: $(_dr_join ${p_unread[@]+"${p_unread[@]}"}) — the tag exists and cannot be read, so ccd refuses to place work for these projects rather than treating them as unconstrained" \
      "fix the mode/ownership under $dir — check with: ls -l $dir"
    rc=1
  fi
  if [ "${#p_malformed[@]}" -gt 0 ]; then
    _dr_fail pools "pools-malformed: $(_dr_join ${p_malformed[@]+"${p_malformed[@]}"}) — the file holds something that is not one pool name, so nothing can decide these projects' placement" \
      "rewrite each as a single lowercase token: ccd project-pool --project <p> --pool <name>"
    rc=1
  fi
  if [ "${#p_stale[@]}" -gt 0 ]; then
    _dr_warn pools "pools-stale: $(_dr_join ${p_stale[@]+"${p_stale[@]}"}) — tagged, but no project directory and no registry row of that name exists, so nothing reads these tags" \
      "clear each: ccd project-pool --project <p> --clear (for these: $(_dr_join ${p_stale[@]+"${p_stale[@]}"}))"
    [ "$rc" -eq 1 ] || rc=2
  fi
  if [ "${#p_orphan[@]}" -gt 0 ]; then
    _dr_warn pools "pools-orphan-pool: $(_dr_join ${p_orphan[@]+"${p_orphan[@]}"}) — no account in this box's roster is in that pool, so a hard-blocked session of these projects will strand rather than cross" \
      "either tag an account into the pool in \$HOME/.ccrc/accounts.json and redeploy the agent lane, or retag the project: ccd project-pool --project <p> --pool <name>"
    [ "$rc" -eq 1 ] || rc=2
  fi
  if [ "${#p_leak[@]}" -gt 0 ]; then
    _dr_warn pools "pools-tmp-leak: $(_dr_join ${p_leak[@]+"${p_leak[@]}"}) — a dot-leading entry, i.e. a tmp file a SIGKILL left between the write and the rename; inert, and no reader sees it" \
      "rm the named entries under $dir"
    [ "$rc" -eq 1 ] || rc=2
  fi
  if [ "$rc" -ne 0 ]; then return "$rc"; fi
  _dr_pass pools "every project tag under $dir is one legal pool name, names a project that exists, and names a pool this box's roster carries"
}
```

- [ ] **Step 4: Update the D-72 note**

`ccd/ccrc-doctor-checks:3285` — append to the D-72 paragraph, after the sentence ending "…run on each box.":

```bash
# WHAT THE DIGEST NOW COVERS, and what it still does not. `pool` IS covered:
# `shared/generate.mjs` emits `_ccrc_pool()` into `accounts.sh` always — an
# empty `case` when nothing is tagged — precisely so a pool disagreement
# between the two boxes changes the bytes and reads as `divergent` here, with
# this check's existing remedy. `hidden` is NOT covered, and joins `exec.kind`
# and `secretsFile` in the same disclosure: the generator emits none of the
# three, so two rosters differing only in a `hidden` flag produce the same
# digest and report `'agreed'`. Expect a TRANSIENT `divergent` during any
# agent-first deploy that adds or changes pools — the roster lane lands on one
# box before the other, the deploy output says so, and it clears when the
# second lane runs.
```

- [ ] **Step 5: Run the suites to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/pool-name-parity.test.ts test/ccrc-doctor.test.ts test/ccrc-doctor-graphify.test.ts
```
Expected: PASS. The two table-census cases (`every name in the table has a _check_<name> function, and vice versa`; `runs every check in the table and reports one verdict line each`) and the output-contract shape/summary cases all derive their counts from `tableNames()`, so they absorb the new entry with no literal to update.

- [ ] **Step 6: Measure the mutations (rows 5-extended, 49)**

Apply each, confirm the red, revert.

1. Change `POOL_NAME_RE` in `ccrc-doctor-checks` to `'^[a-z][a-z0-9_-]{0,31}$'`.
   Run: `cd server && ./node_modules/.bin/vitest run test/pool-name-parity.test.ts`
   Expected: FAIL — `expected '^[a-z][a-z0-9_-]{0,31}$' to be '^[a-z][a-z0-9-]{0,31}$'`.
2. Remove `pools` from `CCRC_DOCTOR_CHECKS`, leaving `_check_pools`.
   Run: `cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts`
   Expected: FAIL — "every name in the table has a `_check_<name>` function, and vice versa" (`ORPHAN _check_pools`), and every case in the new describe (no `pools` line at all).
3. Join the stale and malformed buckets into one `_dr_fail` line.
   Expected: FAIL — "gives each class its OWN line and its OWN remedy", `expected two pools verdict lines`.
4. Delete the `p_stale` registry-row half of the two-way test (`&& ! grep -qxF …`).
   Expected: FAIL — "does NOT call a registry-only project stale".
5. Change the `p_unread` bucket to `p_stale` (fold unreadable into stale).
   Expected: FAIL — "FAILS pools-unreadable for a mode-000 tag" (no `pools-unreadable` line), and the output-contract "exits 1 when any check fails" arithmetic on that fixture.

- [ ] **Step 7: Commit**

```bash
git add ccd/ccrc-doctor-checks server/test/pool-name-parity.test.ts server/test/ccrc-doctor.test.ts
git commit -m "feat(doctor): a pools check that names each finding with the command that cures it"
```

---

## Task 9: Whole-branch gate, and the agent-first deploy order

**Files:** none modified. This task runs suites and states the deploy order.

**Interfaces:**
- Consumes: everything Tasks 1-8 produced.
- Produces: a measured green branch, and the deploy instruction for the operator or the coordinator.

**Spec:** §5.11 ("Agent-first is mandatory"), §15 step 1.

**Mutation table:** none of its own — this task is the census that every earlier task's guard is still live together, which the per-task runs cannot show (they run one file at a time).

- [ ] **Step 1: Run the full package suites, in the foreground**

```bash
cd server && npm run test
cd agent && npm run test
cd pwa && npm run test
```
Expected: PASS in all three. Timeout >= 600000 ms, foreground — backgrounding hides a hang and these suites are load-sensitive. Known load flakes (`ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`) must be re-run IN ISOLATION before being called a real break; CI on the quiet box is the arbiter.

- [ ] **Step 2: Type-check every package**

```bash
cd server && npm run build
cd agent && npm run build
cd pwa && npm run build
```
Expected: PASS. There is no `typecheck` script in any package; `build` is `tsc` for `server` and `agent` and `tsc --noEmit && vite build` for `pwa`.

- [ ] **Step 3: Run the tree-wide guards**

```bash
git fetch origin main
cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts test/topology-clean.test.ts test/dtbd.test.ts
```
Expected: PASS. `deviation-refs.test.ts` compares this branch's ledger entries against `origin/main`'s WITHOUT merging and reds on any allocator-era number defined in two plans — it fires before the merge that would otherwise decide it. `topology-clean.test.ts` and `single-definition.test.ts` scan the whole tree including this plan document; the only names anywhere in this wave are the fixture ones (`pool-a`, `pool-b`, `demo`, `quiet-basin`, `acct-a-demo`, and the `DEFAULT_TEST_ROSTER` account ids). `dtbd.test.ts` reds the tree on the placeholder deviation token a session writes when it cannot reach the allocator; this plan writes no deviation numbers of its own, so it carries none.

- [ ] **Step 4: Confirm the caps↔dispatcher and vocabulary parities one more time, together**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-archive.test.ts test/caps-token-shape.test.ts test/lifecycle-vocabulary.test.ts test/lifecycle-acts.test.ts test/whitelist-subset.test.ts
```
Expected: PASS. These five are the cross-file parities this wave moved; a per-task run proved each in isolation, and this proves they still agree with each other.

- [ ] **Step 5: The deploy order, in words — AGENT-FIRST**

**The plan's implementer does NOT run these.** Deploy is the operator's or the coordinator's act, on a machine whose `~/.ccrc/deploy.env` holds the coordinates. Record here what must happen and in which order:

> Every change under `ccd/` ships to the fleet host BEFORE the server. README's "Deploy" section states the rule and the reason: "A change that touches `ccd/` — the hook script in particular — must ship to the fleet host *before or with* the server, because the server reads what the hook writes." This wave adds a ccd VERB and a caps TOKEN, so the sharper form applies too: the agent caches `ccd caps` at boot, and the agent deploy installs `ccd` BEFORE restarting the agent, so the reverse order pins a stale verb set.
>
> **Fleet host (agent lane) first:**
>
> ```bash
> bash deploy/deploy.sh agent
> ```
>
> The target comes from `CCRC_AGENT_BOX` in `~/.ccrc/deploy.env`, or from an explicit `<host>` argument. It **never** falls back to `$CCRC_BOX`, which on this two-box fleet is the SERVER box, and it refuses with exit 2 rather than guessing. Within that one run the roster (`accounts.sh`, carrying wave 1's `_ccrc_pool`) lands before `ccd`, then the agent restarts (a fresh `ready` frame carries the new `rosterFp` and a `ccdVerbs` list including `project-pool` and `pools-v1`), then the supervisor sweep runs behind its mandatory `KillMode=process` preflight.
>
> **Then the server box:**
>
> ```bash
> bash deploy/deploy.sh
> ```
>
> The gate is the server lane's own final step: `/health` reporting the shipped sha.
>
> **What the operator should expect, and it is not a fault:** `rosterAgreement: divergent` — the banner and `ccrc doctor`'s `fleet` FAIL — for the minutes between the two lanes, because `accounts.sh` now carries `_ccrc_pool` on one box and not yet on the other. It clears when the second lane runs. This is the detection the emission exists for, working.
>
> **Nothing changes on the fleet until something is tagged.** After both lanes: every account is untagged, `~/.cc-sessions/pools/` does not exist, `_project_pool_state` answers `untagged` everywhere, `_pool_ok` answers 0 for every pair, and placement is byte-identical to today. `ccrc doctor` should show `PASS pools: no project pools tagged`. Tagging is a separate, reversible operator act (`ccd project-pool --project <p> --pool <name>`, or the PWA once wave 4 ships), and `--clear` undoes it with nothing to move.
>
> **Rollback** for this wave alone is the `~/ccrc-backups/<ts>/ccd` restore README documents, plus `systemctl --user restart ccrc-agent.service`. Because nothing is tagged after a clean deploy, there is normally nothing to roll back FROM.

- [ ] **Step 6: Commit (documentation only — no code in this task)**

This task adds no files. If Steps 1-4 surfaced a fix, commit that fix under its own task's scope and re-run this task from Step 1.

---

## Deviations found

**Allocated and defined in one act, from the live allocator, on 2026-09-05.**
`~/.local/bin/ccrc-api ledger allocate --json -` with `project: ccrc-pwa`, `count: 26` and `byId`
filled from this pane (`ccrc-pwa-amber-summit`) answered **D-1663**–**D-1688** and moved the floor to
**1689**. The block covers all six account-pools wave plans; each number is defined in exactly ONE of
them, and this section holds the ones that belong to this wave. Where a task carries a `LEDGER:` line, it
states the same finding in that task's words and REFERENCES the number; it does not define it. A
plan-time refinement with no `LEDGER:` line is defined here alone, names the task it shapes, and is
referenced inline where that task was decided. Every deviation
FOUND during execution is allocated in its own call at the moment it is found, never taken from a gap
in this block.

The spec's `P-<n>` labels (§12) were provisional and are cited here only as provenance — a `P-` label
is never a ledger number.

- **D-1665** (Tasks 1, 8) — the pool-name grammar and the `pools` directory name are spelled in two
  languages across three files (`shared/roster.ts`, `ccd/ccd`, `ccd/ccrc-doctor-checks` — the doctor's
  copy is D-92's trade, since that file is sourced under `set -u` by callers that are not `ccrc`);
  `pool-name-parity.test.ts` holds all of them byte-equal by text extraction, which
  `ccd/ccrc-wrapper-shape:67`'s unpinned `ID_RE` copy never had. (spec §12 P-12)
- **D-1666** (Task 3) — the registry already carries a per-session `pool` field, a space-separated
  CANDIDATE LIST with no writer in the tree (`_pool_for`, `ccd/ccd:10984`), and the account-pools design
  adds a pool NAME under the same word. Renaming the field is out of scope; the collision is disclosed at
  `_pool_for` and in `_reg_purge`'s inventory, and `ccd-project-pool.test.ts`'s `acct-a-demo` case proves
  the two can never become one file. (spec §12 P-7)
- **D-1667** (Task 3) — `swap.log` gains its one line class whose subject is a PROJECT
  (`pool-tag <p>: <old> -> <new>`) where every other line's subject is a session id — deliberate, so the
  retag sits beside the `rehome`/`auto-pool` lines it causes within the next tick. (spec §12 P-11)
- **D-1668** (Task 5) — `_ws_least_loaded`'s empty answer folds "every in-pool lane is at ceiling or
  disabled" into "the tag is undecidable"; the seam is not widened (stdout carries a wrapper name and there
  is no second channel), and the caller `cmd_ws_add` re-reads the state and names which of the two it was
  in its refusal. (spec §12 P-13)
- **D-1669** (Task 8) — plan-time deviation from spec §5.4.6: the doctor's `pools-orphan-pool` arm reads
  the generated `~/.ccrc/accounts.sh` (the projection `ccd` obeys) rather than `accounts.json`, so it
  measures what will actually strand and needs no second roster parser; an unreadable projection makes no
  orphan claim, because `_check_wrappers` already FAILs that condition with its own remedy.
- **D-1670** (plan shape) — plan-time deviation from spec §15: the spec's wave 2 is split into 2a (tag,
  predicate, placement, grant, caps, doctor, the `rehome` vocabulary) and 2b (tick, strand, crossing,
  manual verbs) — six PRs, not five, each merged before the next is cut; 2b's branch is cut from 2a's
  merged tip because every 2b test calls 2a's reader and predicate.

### Found during execution

Allocated in their own act at the moment they were found, never taken from a gap in the
D-1663–D-1688 block. A `D-TBD-<slug>` here is a number REQUESTED and not yet issued; it is
substituted before wave-done.

- **D-1744** (Task 1) — `_project_pool_state`'s
  `[[ -e "$f" ]] || { echo untagged; return 0; }` — this plan's own Step 8 body, transcribed
  verbatim from spec §5.4.3 — treats "not `-e`" as ABSENCE, and `-e` is false for three
  conditions that are not absence: a symlink LOOP at the tag path, a BROKEN symlink at the tag
  path, and an unsearchable `$POOLS_DIR` (mode 000), the last of which answers `untagged` for
  EVERY project on the box at once. Each silently LIFTS the placement constraint, which is the
  defect the four-word reader exists to refuse, and the shipped comment names "a symlink loop"
  as an `unreadable` case the code does not deliver.
  The spec defeats itself here rather than being deviated from: §10's failure table answers
  "Tag silently lifted because a read failed" with "Four-word reader; `unreadable != untagged`
  pinned on both sides", and §5.4.3's comment on the `cat` line claims ELOOP is caught there
  when `-e` has already returned false and `cat` is never reached. Fixed in wave 2a, in the
  reader itself, with a test per condition: absence is now PROVEN, not assumed.
  **THE RULE THIS BREAKS IS `CLAUDE.md`'s "no overloaded null at a seam", not merely spec
  hygiene** — the coordinator reproduced all three conditions independently before minting and
  ruled it so. `untagged` means the project is UNCONSTRAINED and placement may go anywhere;
  `unreadable` means NOBODY KNOWS and placement must refuse. Folding the second into the first
  does not lose information, it INVERTS the safe default — and the mode-000 arm inverts it for
  every project on the box at once, so the failure is silent, total, and looks exactly like a
  fleet nobody ever tagged.
  **WHICH HALF OF THE SPEC IS WRONG, recorded here so the next reader of §5.4.3 finds the
  correction attached to it:** §5.4.3's BODY is the wrong half; §10's failure table STANDS.
  Correcting the spec's own text is WAVE 5's, not this wave's — the coordinator carries it into
  that brief.
  WHY NOT DEFERRED TO A LATER WAVE: wave 3's `readProjectPools` (spec §5.4.4) mirrors this
  reader's four states in TypeScript, so a fold left standing here is a fold copied into the
  server. **Obligation on wave 3:** its `readFileMeasured` arm has the same shape and must be
  checked for the same collapse — `absent` from a `readdir` listing plus a per-file measured
  read is a different mechanism from `-e`, but the polarity question is identical.

- **D-TBD-read-failure-folds-into-eof** (Task 1, PARKED WITH DISCLOSURE — not fixed) —
  `_project_pool_state`'s NUL-detecting read, `{ IFS= read -r -d '' v; } 2>/dev/null < "$f"`,
  uses `read`'s exit status to tell "a NUL delimiter was found" (rc 0, `malformed`) from
  "EOF reached first" (rc 1, the ordinary path). `read` also returns 1 for a read FAILURE, so a
  failure past the `-f && -r` guard falls into the ordinary path: a symlink to `/proc/self/mem`
  passes both tests, fails EIO, and answers `malformed`; fd exhaustion (EMFILE) does the same.
  The variant nobody could construct — a read delivering PARTIAL bytes before erroring — would
  answer `named <partial-prefix>`, reported as unconstructed rather than excluded.
  **NOT CLOSED, DELIBERATELY.** `_pool_ok` maps BOTH `unreadable` and `malformed` to rc 2, so
  every decider this wave ships treats the two identically: the fold is at the operator-DIAGNOSTIC
  seam, not a decision seam, and its whole cost is the doctor proposing `rewrite the file as one
  lowercase token` where the cure is `fix the I/O error`. Placement refuses either way. Closing it
  needs a distinction bash's `read` does not expose, i.e. a fork on the 5-second `cmd_supervise`
  path — reinstating the exact cost this round removed, to improve a message on an unconstructible
  condition. Disclosed in the function's comment and PINNED by a test that says it pins a known
  residual, in `_reg_set`'s "disclosed price" idiom.
  **Obligation on wave 3, which CAN discharge this one:** `readFileMeasured` already tells absent
  from unreadable from over-cap, so the TypeScript mirror has the mechanism bash lacks. It must not
  reproduce this fold — a failed read there is `unreadable`, never `malformed` and never a name.

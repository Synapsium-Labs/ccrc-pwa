# Account pools — wave 5: the prose catches up with the mechanism — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every operator-facing sentence about account placement true again — the README's pools story, the two source comments the design measured as false, one deploy echo, and one CLAUDE.md bullet — and pin each of them to the source it describes so it cannot quietly go false a second time.

**Architecture:** This wave writes no mechanism. It CONSUMES everything waves 1–4 shipped (the roster `pool` field and its projection, `ccd`'s reader/predicate/verb/strand/crossing, the server's `pools.ts`/`poolrule.ts`/routes, the PWA's chips and sheets) and produces PROSE plus the tests that hold the prose to the code. Every pin follows `server/test/readme-holds.test.ts`'s shape: slice the passage by its own markers, then assert it against the SOURCE it describes — never against a fixed sentence a future edit could silently falsify. One new suite, `server/test/pools-prose.test.ts`, carries all eight describe blocks; nothing else in `server/test` is edited.

**Tech Stack:** Markdown (`README.md`, `CLAUDE.md`), TypeScript comment (`server/src/config.ts`), bash comment (`ccd/ccd`), bash (`deploy/deploy.sh`), vitest (`server/test/pools-prose.test.ts`).

**Spec:** docs/superpowers/specs/2026-09-04-account-pools-design.md

**Base:** origin/main 2b15144e; branch ws/amber-summit

**AGENT-FIRST.** Task 6 edits `ccd/ccd`. A change under `ccd/` ships to the fleet host BEFORE the server — `bash deploy/deploy.sh agent` first, then `bash deploy/deploy.sh` — even when the change is a comment, because the two lanes install different inodes of the same file and the fleet host is the one that runs it. The order is spelled out again in Task 9.

## Global Constraints

- **Fixture HOMEs only.** No test in this plan runs `ccd` at all, and none may read or write the live `$HOME`. Every assertion is a read of a TRACKED file in this checkout.
- **No account name, label, host or pool name from the live fleet, anywhere.** Fixture pool names are `pool-a` and `pool-b`; fixture projects are `demo`, `quiet-basin`, `acct-a-demo`; fixture account ids are `claude`, `claude-a`, `claude-b`, `gpt`, `claude-d`. `server/test/topology-clean.test.ts` scans every tracked file, docs included, and reds on operator residue.
- **`FLEET_PROTO` stays 1; the wire is additive-only.** This wave changes no wire type, but its prose must not describe a bumped protocol.
- **No overloaded null at a seam.** The prose must keep `unreadable` and `malformed` distinct from `untagged` everywhere it names them — folding them in a sentence is how the folding gets built next.
- **Agent-first for `ccd/`** (Task 6, and the deploy order in Task 9).
- **`EXEC_COMMANDS` stays `['tmux','ccd']`; `gh` gets no grant.** Nothing here adds a verb or a grant; prose that implies one is false.
- **L0 `shared/*.ts` imports nothing.** Unchanged by this wave; the pins read `shared/roster.ts` and `shared/generate.mjs` as TEXT, never by import.
- **Mutation-table discipline.** Every prose correction ships with an assertion that goes RED against the sentence it replaces, measured before and after — not a comment.
- **Deviation numbers come only from the allocator.** This plan's plan-time numbers, D-1685–D-1688, were minted in ONE allocator call and defined in `## Deviations found` at plan commit; the `LEDGER:` lines in Tasks 1, 2, 5 and 6 REFERENCE them. A deviation found during execution is allocated in its own call at the moment it is found, never taken from a gap in that block.
- **README is canonical; CLAUDE.md is the non-obvious operational rules.** CLAUDE.md's addition is ONE bullet block of at most 12 lines (Task 8) — everything long goes in README.

---

## Wave map

The other four plans, all under `docs/superpowers/plans/`:
`2026-09-05-account-pools-wave1-roster.md` (roster field, mirrors, generator, `RosterWire`),
`2026-09-05-account-pools-wave2a-ccd-tag-placement.md` (`ccd` reader, verb, predicate, placement, grant, caps),
`2026-09-05-account-pools-wave2b-ccd-swap-strand-crossing.md` (auto-swap, strand, crossing marker, manual verbs),
`2026-09-05-account-pools-wave3-server.md` (L1/L3, registry, routes, watcher frame, health),
`2026-09-05-account-pools-wave4-pwa.md` (PWA surfaces).
This wave depends on the NAMES below, not on those paths.

**Consumes (documented by this wave, produced by waves 1–4):**

- Wave 1, `shared/`: `AccountDef.pool: string | null`; `POOL_NAME_RE = /^[a-z][a-z0-9-]{0,31}$/` in `shared/roster.ts`; `ACCOUNT_KEYS` gains `'pool'`; `shared/roster-json.mjs`'s `checkAccount` mirrors `pool` and finally checks `hidden`; `shared/generate.mjs`'s `generateAccountsSh` emits `_ccrc_pool()` always; `RosterWire.pool: string | null`; `shared/poolrule.ts`'s `poolRule`.
- Wave 2a, `ccd/ccd` + agent: `POOLS_DIR="$REG/pools"`; `POOL_NAME_RE=` (one bash literal in `ccd/ccd`, a pinned second in `ccd/ccrc-doctor-checks`); `_pool_name_valid`; `_project_pool_state` (four words — `named <n>` / `untagged` / `unreadable` / `malformed` — always rc 0); `_acct_pool`; `_pool_ok` (rc 0 serve / 1 mismatch / 2 undecidable); `_ws_least_loaded [project]` and `cmd_ws_add`'s pool/tag refusal reasons; `ccd project-pool --project <p> --pool <name> | --clear` (`cmd_project_pool`); `echo pools-v1` in `cmd_caps`; `EXEC_WHITELIST.ccd` gains `['project-pool','--project']`; `CCD_ARGV.projectPoolSet` / `projectPoolClear`; `POOLS_CAP = 'pools-v1'`; `POOLS_DIR_NAME = 'pools'` in `server/src/pools.ts`; the `rehome` act in `_LC_ACTS`, `LifecycleAct`/`LIFECYCLE_ACT_MAP` and `ACT_WORD`; the doctor's `_check_pools` (verdict prefixes `pools-unlistable`, `pools-unreadable`, `pools-malformed`, `pools-stale`, `pools-orphan-pool`, `pools-tmp-leak`).
- Wave 2b, `ccd/ccd`: the `_swap_target` and `_auto_swap_check` insertions; `_strand_mark` / `_strand_clear` / `_strand_why`; `$REG/<id>.stranded`, `$REG/<id>.strandnotify`, `$REG/<id>.crosspool`; `swap.log` verbs `pool-tag`, `rehome`, `auto-pool`, `stranded`, `unstranded`, `cross-pool`, `crosspool-ended`; the `--cross-pool` flag on `cmd_swap`/`cmd_start`/`cmd_enable`/`cmd_prefer`; the die prefixes `pool-mismatch: ` and `pool tag for <p> is `; `CCD_SWAP_AUTO=1`; the notify text `cc swap STRANDED: `.
- Wave 3, server: `server/src/pools.ts` (`readProjectPools`, `poolFor`, `poolsEnforcement`, `poolsWire`); `server/src/poolrule.ts` (`poolVerdict`, `poolEligible`, `projectPlacement`); `SessionRecord.stranded`; `POST /api/projects/:project/pool`; `crossPool?: boolean` on the swap and sessions routes with 409 `pool-mismatch`, 503 `pool-unreadable`, 501 `unsupported`; the `pools` frame; `FleetHealth.projectPools`.
- Wave 4, PWA: `accountPool`, `splitByPool`, `PoolSheet`, the `proj-card-pool` chip, `N stranded`, the SwapSheet "show other pools (N)" disclosure, `.sess-stranded`, `data-offpool`, the `FleetHostBanner` `unavailable` arm.

**Execution precondition, stated plainly:** this wave runs LAST. Its suite reads files the earlier waves create — `server/src/pools.ts`, `ccd/ccd`'s `POOLS_DIR`/`_project_pool_state`/`--cross-pool`, `pwa/src/fleet/SessionLine.tsx`'s `data-offpool`, `shared/generate.mjs`'s `_ccrc_pool` — and it will throw ENOENT or fail a grounding assertion if it is executed before waves 1–4 are merged. That is the intended behaviour: a prose pin whose subject has not shipped should refuse, not pass.

**Produces (for reviewers and later waves):**

- `server/test/pools-prose.test.ts` — the prose ratchet. Eight describe blocks, each slicing one passage by DISTINCTIVE anchors and grounding it in source.
- `README.md` § "Account pools: tagging a project to a set of accounts" — the canonical operator-facing account of the feature. Any later wave that changes a pool behaviour edits this section and reds this suite if it does not.
- `CLAUDE.md`'s account-pools bullet — the coder-facing invariants.

---

## File structure

| File | Change | Responsible for |
|---|---|---|
| `server/test/pools-prose.test.ts` | **Create** (Task 1, appended by Tasks 2–8) | Holding every pools sentence to the code it describes |
| `README.md:806-808` | Modify (Task 1) | The manual-placement claim (D-1685 — spec §12 P-9) |
| `README.md:632-634`, `:641-647`, `:727-734` | Modify (Task 2) | The account entry, the projection's contents, the digest's two sides (D-1686 — spec §12 P-6) |
| `README.md` after `:858` | Modify — new `###` subsection (Tasks 3, 4) | The whole pools story, inside the existing `## Accounts` section |
| `README.md:2088-2097` | Modify (Task 7) | Deploy ordering: pools are agent-first, and the transient banner |
| `server/src/config.ts:197-201` | Modify — comment only (Task 5) | The roster is seeded once per box (D-1687 — spec §12 P-4) |
| `ccd/ccd:3546-3551` | Modify — comment only (Task 6) | `accounts.sh` carries telemetry; the gap is the consumer (D-1688 — spec §12 P-5) |
| `deploy/deploy.sh` after `:507` | Modify — one echo (Task 7) | Saying, in the deploy's own output, that `divergent` between the lanes is expected |
| `CLAUDE.md` after `:150` | Modify — one bullet block ≤ 12 lines (Task 8) | The pool invariants a coder must not break; the re-measured README line count |

**Prose pins already in the tree that these edits run beside.** Each was read at `2b15144e`; none of them forbids anything this plan writes, and the implementer must not break them:

| Suite | What it asserts about README/CLAUDE.md |
|---|---|
| `server/test/oss-metadata.test.ts:89-101` | CLAUDE.md's `README.md` (~N lines) claim is within 10% of the real count. **README grows by ~140 lines in Tasks 1–4 and 7 — Task 8 re-measures and updates the number.** |
| `server/test/readme-holds.test.ts` | The "Workspace holds & programs" section and the "Exec whitelist" `--surface` bullet. Untouched by this wave. |
| `server/test/box-token-census.test.ts:277-385` | README's auth, mail-bus and caps paragraphs (route names + number words), and CLAUDE.md's box-token bullet, sliced `- **Box token gates every coordination WRITE**` → `'\n- **'`. Task 8's bullet goes in a DIFFERENT section, above it, so that slice is unaffected. |
| `server/test/ledger-instruction.test.ts:90-110` | CLAUDE.md's deviation-ledger bullet, sliced `- **Deviation ledger (D-N):**` → `'\n- **Wire discipline'`. **Nothing may be inserted between those two bullets** — Task 8 inserts AFTER the Wire-discipline bullet ends. |
| `server/test/coord-pause-route.test.ts:412-450` | CLAUDE.md's box-token bullet again. Unaffected, same reason. |
| `server/test/mail-hardening.test.ts:384-407` | CLAUDE.md's "Open on `main`" void-writer sentence. Untouched. |
| `server/test/worker-skill.test.ts:118-134` | Every mention of `ccd/worker-skill/SKILL.md` in README.md and CLAUDE.md must state "twelve clauses" within 160 characters. **Do not name that path in any new prose.** |
| `server/test/ccrc-update.test.ts:910-934` | README states `bash ≥ <floor>`. Untouched. |
| `server/test/license.test.ts:105-127` | README has a `## License` section naming the holder, the licence and §13. Untouched. |
| `server/test/ccrc-install-graphify.test.ts:558-674` | README's graphify enumeration, and two NEGATIVE scans over the WHOLE README: no present-tense verb (`converges|writes|installs|plants|puts`) within 140 characters of `block`/`read rule` and `CLAUDE.md`, and none within 140 characters of `always_on/claude-md.md`. **New README prose must not put `CLAUDE.md` near those verbs** — this wave's prose never names `CLAUDE.md` at all. |
| `server/test/topology-clean.test.ts` | Every tracked file, docs included: no operator host, IP, tailnet or account residue. Fixture names only. |
| `server/test/single-definition.test.ts` | Four TS roots (`shared`, `server/src`, `pwa/src`, `agent/src`) — no second copy of a single-source value. Run after every task; docs are not in `ROOTS` but the suite reads specific docs by path. |

`CONTRIBUTING.md` was READ at `2b15144e` and describes neither the roster fields nor the swap verbs (its 107 lines cover layout, suites, review expectations, the `D-N` convention and the licence; the only match for "account" is the word "preference"). **No CONTRIBUTING.md task exists in this wave, by measurement.** Its ledger paragraph is pinned by `ledger-instruction.test.ts` and must stay untouched.

`ccd/coordinator-skill/SKILL.md` and `ccd/worker-skill/SKILL.md` are VERBATIM-pinned by `server/test/coordinator-skill.test.ts` and `server/test/worker-skill.test.ts`. **This wave edits neither.** Open item, for the orchestrator rather than for a task: a worker whose wave lands in a pooled project can now be refused placement by `ws-add` with a `pool=` reason, and the worker skill's brief-and-ask clauses say nothing about it. Whether clause 3 (the workspace) or clause 11 (the structured ask) should learn the word "pool" is a skill decision with its own verbatim-pin ceremony, and it is deliberately NOT a task here.

---

### Task 1: README — manual placement overrides the disabled gate, not the pool rule

**Files:**
- Create: `server/test/pools-prose.test.ts`
- Modify: `README.md:806-808` (inside `### Placement honors the disabled marker`)

**Interfaces:**
- Consumes: `ccd/ccd`'s `--cross-pool` flag and its `pool-mismatch: ` die prefix (wave 2b); `server/test/ccdWsHelpers.ts`'s `export const CCD` (the ONE spelling of the ccd path in this tree).
- Produces: `passage(name, text, from, to, min?)` and `sentencesOf(text)` helpers, and `placementSection()`, used by every later task in this file.

**Spec:** §12 P-9 (D-1685) (the superseded sentence), §5.5.5 (what the four manual verbs now do), §5.7.1 (`--cross-pool` is not `--force`).

**Mutation table:** row 52 — *README prose about manual bypass is true.* Goes red when the sentence is left unedited (`bypasses the gate entirely` still present), when a reworded sentence claims a manual verb bypasses placement policy without naming what it does not bypass, or when `--cross-pool` disappears from the section while `ccd` still has the flag.

**LEDGER:** README's placement section told operators that `ccd start`, `ccd swap` and `ccd prefer` bypass the placement gate "entirely" — true of the `-disabled` marker, false of the pool rule the same three verbs now enforce, and the sentence was the operator's only written account of what a manual verb overrides (D-1685 — spec §12 P-9).

- [ ] **Step 1: Write the failing test**

Create `server/test/pools-prose.test.ts`:

```ts
// Prose that must stay TRUE about account pools: README's placement and pools
// sections, CLAUDE.md's invariant bullet, and the three non-README sentences the
// design measured as false (D-1685, D-1686, D-1687, D-1688).
//
// The shape is `readme-holds.test.ts`'s, for its reason as much as its form:
// slice the passage by its OWN markers and check it against the SOURCE it
// describes, never against a fixed sentence a future edit could silently
// falsify. Four times before this file existed, prose in this tree overclaimed
// and no assertion held it.
//
// Terminators are DISTINCTIVE literals, never `'\n### '` or `'\n- **'` —
// `ledger-instruction.test.ts`'s D-1443 lesson: `indexOf` stops at the FIRST
// closing anchor after the opener, so a generic terminator is matched by any new
// heading or bullet written INSIDE the region; the passage silently truncates,
// the length check is a lower bound a truncated passage still clears, and every
// negative assertion then passes over text that was cut away.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// The path to the ccd script is spelled in exactly ONE file in this tree and
// `single-definition.test.ts` enforces it — import the constant, never re-spell
// it here (`readme-holds.test.ts` records the same rule).
import { CCD } from './ccdWsHelpers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string): string => readFileSync(path.join(root, rel), 'utf8');
const readme = (): string => read('README.md');
const ccd = (): string => readFileSync(CCD, 'utf8');

/** A passage sliced by its own markers. Both anchors must exist and the slice
 *  must be long enough to BE the passage: an anchor that stopped matching would
 *  otherwise yield '' and satisfy every negative assertion below it. */
const passage = (name: string, text: string, from: string, to: string, min = 200): string => {
  const a = text.indexOf(from);
  expect(a, `${name}: the opening anchor is gone`).toBeGreaterThan(-1);
  const b = text.indexOf(to, a + from.length);
  expect(b, `${name}: the closing anchor is gone`).toBeGreaterThan(a);
  const out = text.slice(a, b);
  expect(out.length, `${name} is too short to be the passage`).toBeGreaterThan(min);
  return out;
};

/** Whitespace-flattened. EVERY multi-word assertion in this file runs over a
 *  flattened passage, because README and CLAUDE.md are hard-wrapped prose: the
 *  phrase a check looks for routinely spans a line break, and a raw
 *  `toContain`/`toMatch` would then miss it. On a NEGATIVE assertion that is a
 *  false GREEN — the exact failure mode that gets a scanner deleted — and on a
 *  positive one it is a red for the wrong reason. Line-anchored checks (the
 *  numbered rollout steps, the bullet's line count) use the raw slice. */
const flat = (text: string): string => text.replace(/\s+/g, ' ');

/** Sentence-split, not whole-section matching: an absolute word used correctly
 *  three paragraphs away must not trip a check aimed at one claim. Splits on
 *  `.`/`:` followed by whitespace — coarse, but it keeps each claim in its own
 *  window (`readme-holds.test.ts`'s helper, copied). Always fed a FLATTENED
 *  passage, so a sentence is one line by the time it is matched. */
const sentencesOf = (text: string): string[] => text.split(/(?<=[.:])\s+/);

const placementSection = (): string =>
  passage('README, the disabled-marker section', readme(),
    '### Placement honors the disabled marker', '\n### Login screens get no keystrokes');

describe('README: manual placement is not a blanket override (spec §11 row 52)', () => {
  it('no longer says the manual verbs bypass the gate entirely', () => {
    expect(flat(placementSection())).not.toMatch(/bypasses the gate entirely/);
  });

  it('does not claim a manual verb bypasses placement policy, in a wider set of phrasings', () => {
    // The literal above is one spelling of the claim. This is the claim itself:
    // any sentence that names a manual verb AND an overriding word has to say
    // what it does NOT override, or it is the same overclaim reworded.
    for (const s of sentencesOf(flat(placementSection()))) {
      if (/\b(bypass(es|ed)?|ignor(es|ed)?|overrides?)\b/i.test(s)
          && /`ccd (start|swap|prefer)`/.test(s)) {
        expect(s, `unqualified override claim: "${s.trim()}"`).toMatch(/--cross-pool/);
      }
    }
  });

  it('names the flag a crossing actually takes, and ccd actually has it', () => {
    expect(flat(placementSection())).toMatch(/--cross-pool/);
    // Grounded in the shipped script, not merely asserted in prose: the flag
    // exists and the refusal it overrides has its own die prefix.
    expect(ccd(), 'ccd has no --cross-pool flag — the README now describes a flag that is gone')
      .toMatch(/--cross-pool/);
    expect(ccd(), 'ccd no longer refuses a pool mismatch — re-decide this paragraph')
      .toMatch(/pool-mismatch: /);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/pools-prose.test.ts`

Expected: 3 FAIL.
- `no longer says the manual verbs bypass the gate entirely` → `AssertionError: expected '### Placement honors the disabled …' not to match /bypasses the gate entirely/`
- `does not claim a manual verb bypasses placement policy…` → `unqualified override claim: "Manual placement (\`ccd start\`, \`ccd swap\`, \`ccd prefer\`) bypasses the gate entirely — naming a wrapper by hand is an operator override by construction."` — expected to match `/--cross-pool/`
- `names the flag a crossing actually takes…` → `expected '### Placement honors the disabled …' to match /--cross-pool/`

- [ ] **Step 3: Write the minimal implementation**

In `README.md`, replace exactly these three lines (806-808):

```
session already sitting there. Manual placement (`ccd start`, `ccd swap`,
`ccd prefer`) bypasses the gate entirely — naming a wrapper by hand is an
operator override by construction. One correction to that override: `ccd
```

with:

```
session already sitting there. Manual placement (`ccd start`, `ccd swap`,
`ccd prefer`) overrides the **disabled** gate — naming a wrapper by hand is an
operator override by construction — but it is not a blanket override of every
placement rule, because all three verbs refuse a target whose pool disagrees
with the project's unless you pass `--cross-pool` (see "Account pools" below).
One correction to that override: `ccd
```

Write it as one sentence with no internal `.` or `:` — `sentencesOf` splits on those, and a colon before `--cross-pool` would cut the flag out of the very sentence that has to name it.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/pools-prose.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Prove the guard is a mechanism, not a comment**

Re-insert `bypasses the gate entirely` in place of `overrides the **disabled** gate` in README, re-run the suite, record: 2 red (tests 1 and 2). Revert the edit, re-run: 3 green. Paste both counts into the commit body.

- [ ] **Step 6: Commit**

```bash
git add server/test/pools-prose.test.ts README.md
git commit -m "docs(readme): manual placement overrides the disabled gate, not the pool rule"
```

---

### Task 2: README — the account entry and the projection, derived from what the code accepts and emits

**Files:**
- Modify: `README.md:632-634` (the projection parenthetical), `README.md:641-647` (the account-entry sentence), `README.md:727-734` (the two-boxes bullet's second paragraph)
- Modify: `server/test/pools-prose.test.ts` (append one describe block)

**Interfaces:**
- Consumes: `shared/roster.ts`'s `ACCOUNT_KEYS` (wave 1 adds `'pool'`; `'hidden'` was already there); `shared/generate.mjs`'s `generateAccountsSh` template (wave 1 adds `_ccrc_pool()`); `AccountDef.hidden: boolean`, `AccountDef.pool: string | null`.
- Produces: `emittedNames()` — the list of `CCRC_*` and `_ccrc_*` names the generator actually writes into `accounts.sh`, derived from `shared/generate.mjs`'s template. Task 6 reuses it.

**Spec:** §12 P-6 (D-1686) (the account-entry sentence lacks `hidden`), §5.3 (the `pool` key, its grammar, the `_ccrc_pool` emission, and `hidden` staying outside the digest while `pool` is inside it).

**Mutation table:** rows 1–4 are wave 1's; this task's own guard is the DERIVATION — the account-entry sentence must name every key `ACCOUNT_KEYS` accepts, and the projection paragraph must name every symbol the generator emits. Goes red when a key or an emission is added and the sentence is not; goes red today because `hidden` and `pool` are missing from one and `_ccrc_pool`, `CCRC_MEASURED`, `_ccrc_dir_id`, `_ccrc_label` and `_ccrc_hue` from the other.

**LEDGER:** the README sentence that enumerates an account entry has never named `hidden`, so the one declared field that decides whether ccrc presents an entry as an account at all was documented nowhere an operator reads; the same sentence now also has to carry `pool`, and the enumeration is replaced by one derived from `ACCOUNT_KEYS` so it cannot fall behind a third time (D-1686 — spec §12 P-6).

- [ ] **Step 1: Write the failing test**

Append to `server/test/pools-prose.test.ts`:

```ts
/** Every symbol the generator actually writes into `accounts.sh`, read off its
 *  own template rather than listed here — the same derivation discipline the
 *  roster itself is under (`single-definition.test.ts`). */
const emittedNames = (): string[] => {
  const gen = read('shared/generate.mjs');
  const names = [
    ...[...gen.matchAll(/^(CCRC_[A-Z_]+)=/gm)].map((m) => m[1]!),
    ...[...gen.matchAll(/^(_ccrc_[a-z_]+)\(\) \{/gm)].map((m) => m[1]!),
  ];
  expect(names.length, 'the accounts.sh template moved — this derivation is over nothing')
    .toBeGreaterThan(6);
  return names;
};

describe('README: the roster-side account facts (D-1686)', () => {
  const entrySentence = (): string =>
    flat(passage('README, the account-entry sentence', readme(),
      'An account entry is', '**Getting the file onto a box.**'));

  it('names EXACTLY the keys parseRoster accepts — derived from ACCOUNT_KEYS, not remembered', () => {
    const m = /const ACCOUNT_KEYS: ReadonlySet<string> = new Set\(\s*\[([^\]]*)\]/
      .exec(read('shared/roster.ts'));
    expect(m, 'the ACCOUNT_KEYS literal moved — this derivation is over nothing').not.toBeNull();
    const keys = [...m![1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
    expect(keys.length, 'the ACCOUNT_KEYS literal came out empty').toBeGreaterThan(5);
    // The brace group, not the paragraph: `toContain('id')` would be satisfied
    // by the word "considered", so a per-word scan here proves almost nothing.
    const g = /An account entry is `\{([^}]*)\}`/.exec(entrySentence());
    expect(g, "the account-entry sentence no longer opens with a `{…}` key list").not.toBeNull();
    const listed = g![1]!.split(/,\s*/).map((k) => k.trim()).filter(Boolean);
    expect([...listed].sort(),
      'the README key list and ACCOUNT_KEYS disagree — one of them grew and the other did not')
      .toEqual([...keys].sort());
  });

  it('names every symbol the generator emits into accounts.sh', () => {
    const p = flat(passage('README, the projection paragraph', readme(),
      '`accounts.sh` is a pure projection', 'Nothing hand-edits it'));
    for (const n of emittedNames()) {
      expect(p, `the projection paragraph never names \`${n}\``).toContain(n);
    }
  });

  it('states which side of the roster digest each optional key falls on', () => {
    const p = flat(passage('README, the two-boxes bullet', readme(),
      'It compares the **projections**', '- **Limit telemetry is roster-driven too**'));
    expect(p, 'the digest paragraph does not say where `pool` falls').toMatch(/`pool`/);
    expect(p, 'the digest paragraph does not say where `hidden` falls').toMatch(/`hidden`/);
    // Grounded, both ways round: the generator emits pools and emits nothing
    // named for `hidden` — which is the entire content of the claim.
    expect(emittedNames().filter((n) => /pool/i.test(n)),
      'accounts.sh carries no pool emission — the README claim that pools are inside the digest is false')
      .not.toEqual([]);
    expect(emittedNames().filter((n) => /hidden/i.test(n)),
      'accounts.sh now carries hidden — the README claim that it is outside the digest is false')
      .toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/pools-prose.test.ts`

Expected: 3 new FAIL (Task 1's three stay green).
- `names EXACTLY the keys parseRoster accepts` → `the README key list and ACCOUNT_KEYS disagree — one of them grew and the other did not`, with the diff showing `hidden` and `pool` present on the ACCOUNT_KEYS side and absent from the README side
- `names every symbol the generator emits into accounts.sh` → `the projection paragraph never names \`CCRC_MEASURED\``
- `states which side of the roster digest each optional key falls on` → `the digest paragraph does not say where \`pool\` falls`

- [ ] **Step 3: Write the minimal implementation**

(a) `README.md:632-634` — replace:

```
`accounts.sh` is a pure projection of `accounts.json` — `deploy/gen-accounts.mjs`
produces it (`CCRC_ACCOUNTS`, `CCRC_HOME_ABLE`, `CCRC_UPSTREAM`,
`_ccrc_cfg_dir`, `_ccrc_id_wrapper`), and the deploy generates it from the
```

with:

```
`accounts.sh` is a pure projection of `accounts.json` — `deploy/gen-accounts.mjs`
produces it (`CCRC_ACCOUNTS`, `CCRC_HOME_ABLE`, `CCRC_MEASURED`,
`CCRC_UPSTREAM`, `_ccrc_cfg_dir`, `_ccrc_id_wrapper`, `_ccrc_dir_id`,
`_ccrc_label`, `_ccrc_hue`, `_ccrc_pool` — the whole emitted surface, because a
field the projection drops is a field no drift detector can see), and the
deploy generates it from the
```

(b) `README.md:641-647` — replace:

```
An account entry is `{id, label, configDirSuffix, exec, homeAble, hue,
telemetry}` — validated by `shared/roster.ts` (`parseRoster`), whose errors all
carry a remedy. `id` is `^[a-z][a-z0-9-]{0,31}$` because it becomes a filename
under `~/.local/bin/`, a bash `case` pattern and a session-id prefix; `label` is
what the PWA renders; `homeAble: false` holds an account out of automatic
placement; `telemetry: 'none'` says the account will never report rate limits,
so its permanent unknown is not read as permanent emptiness.
```

with:

```
An account entry is `{id, label, configDirSuffix, exec, homeAble, hue,
telemetry, hidden, pool}` — validated by `shared/roster.ts` (`parseRoster`),
whose errors all carry a remedy. `id` is `^[a-z][a-z0-9-]{0,31}$` because it
becomes a filename under `~/.local/bin/`, a bash `case` pattern and a session-id
prefix; `label` is what the PWA renders; `homeAble: false` holds an account out
of automatic placement; `telemetry: 'none'` says the account will never report
rate limits, so its permanent unknown is not read as permanent emptiness;
`hidden: true` declares the entry to be roster PLUMBING rather than one of your
accounts — the `upstream` entry naming the binary every generated wrapper
`exec`s — so no surface presents it as an account you hold; and `pool` is an
optional pool name carrying `id`'s own grammar, which is the account half of the
rule "Account pools" below states in full. Both optional keys default to the
old behaviour when absent: `hidden` to `false`, `pool` to untagged, which means
unconstrained.
```

(c) `README.md:734` — after `server on the other end of a socket to disagree with.`, and still inside the same indented bullet paragraph, add:

```

  Digesting the PROJECTION rather than the JSON also decides, per key, whether a
  cross-box disagreement is visible at all, and the two optional keys fall on
  opposite sides. `pool` is **inside** the digest: `_ccrc_pool` is emitted for
  every tagged account, so two boxes whose pools disagree read `divergent` and
  the banner's existing remedy is the right one. `hidden` is **outside** it:
  nothing in `accounts.sh` carries that key, so two copies that disagree about
  `hidden` project byte-identical bash and report `agreed` — the same gap
  `exec.kind` and `exec.secretsFile` sit in, and the reason `ccrc doctor`'s
  wrapper check rather than the fingerprint is what catches those. Between the
  two lanes of one agent-first deploy that changes pools, `divergent` is
  EXPECTED for the minutes in between, and the deploy says so as it runs.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/pools-prose.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Prove the derivation reds on a missing key**

Delete `, hidden` from the account-entry sentence, re-run: 1 red naming `hidden`. Restore it, delete `` `_ccrc_pool` `` from the projection parenthetical, re-run: 1 red naming `_ccrc_pool`. Restore, re-run: 6 green. Record all three counts in the commit body.

- [ ] **Step 6: Commit**

```bash
git add server/test/pools-prose.test.ts README.md
git commit -m "docs(readme): the account entry and the projection, derived from what the code accepts and emits"
```

---

### Task 3: README — where a project's pool tag lives, and what it outlives

**Files:**
- Modify: `README.md` — insert a new `###` subsection between line 858 (`(\`touch\`/\`rm\`), not a detected one.`) and line 860 (`### Login screens get no keystrokes, and lost auth joins the rescue lane`)
- Modify: `server/test/pools-prose.test.ts` (append one describe block)

**Interfaces:**
- Consumes: `POOLS_DIR="$REG/pools"`, `_project_pool_state`, `ccd project-pool` (wave 2a); `POOLS_DIR_NAME = 'pools'` and `readProjectPools` (`server/src/pools.ts`, waves 2a/3); the 409/503 refusals (wave 3).
- Produces: `poolsSection()` — the slice `### Account pools: tagging a project to a set of accounts` → `'\n### Login screens get no keystrokes'`, used again by Task 4.

**Spec:** §4 (why the tag lives at `~/.cc-sessions/pools/<project>`, and the two rejected homes), §5.1 (the role matrix — `ccd` decides, the server refuses and forecasts), §5.2 (the rule), §5.4.1 (storage, the absent file, not backed up, the tag outliving every workspace, `ccrc uninstall`), §5.4.3 (the four words).

**Mutation table:** rows 9, 10 and 17 are waves 2a/3's mechanisms; this task's guard is that the SECTION describing them stays true — it names the marker path, the four reader words with `unreadable`/`malformed` never folded into `untagged`, and the "the server never places or writes" claim, each grounded in `ccd/ccd`, `server/src/pools.ts` and `ccd/ccrc`. Goes red when the section is deleted or reworded past those claims, and when the mechanism moves under it (`POOLS_DIR` relocated, a write appearing in `pools.ts`, `pools` appearing in the uninstaller).

- [ ] **Step 1: Write the failing test**

Append to `server/test/pools-prose.test.ts`:

```ts
/** The raw slice — line-anchored checks need it. Every phrase check below runs
 *  over `flat(poolsSection())` instead. */
const poolsSection = (): string =>
  passage('README, the account-pools section', readme(),
    '### Account pools: tagging a project to a set of accounts',
    '\n### Login screens get no keystrokes');

describe('README: where the project tag lives (spec §4, §5.4.1)', () => {
  it('states the rule and that untagged means unconstrained', () => {
    const s = flat(poolsSection());
    expect(s, 'the section never states the rule itself').toMatch(/either side is untagged or/i);
    expect(s, 'ruling 3 is the one thing every operator must read here').toMatch(/unconstrained/);
    expect(s).toMatch(/tagging only ever tightens/i);
  });

  it('names the marker path ccd actually reads, and the verb that writes it', () => {
    const s = flat(poolsSection());
    expect(s).toContain('~/.cc-sessions/pools/');
    expect(s).toContain('ccd project-pool');
    // Grounded: one bash constant, one server constant, same directory name.
    expect(ccd(), 'ccd no longer keeps its pools directory where the README says')
      .toMatch(/POOLS_DIR="\$REG\/pools"/);
    expect(read('server/src/pools.ts'), 'the server no longer spells the directory once')
      .toMatch(/POOLS_DIR_NAME = 'pools'/);
  });

  it('keeps the four reader words distinct — unreadable is never untagged', () => {
    const s = flat(poolsSection());
    for (const w of ['untagged', 'malformed', 'unreadable']) {
      expect(s, `the section never names the \`${w}\` state`).toContain(w);
    }
    // The overloaded-null defect, stated as prose can state it: no sentence may
    // say an unreadable or malformed tag is TREATED as untagged.
    for (const sentence of sentencesOf(s)) {
      if (/\b(unreadable|malformed)\b/.test(sentence)) {
        expect(sentence, `a sentence folds an undecidable tag into untagged: "${sentence.trim()}"`)
          .not.toMatch(/\b(reads?|treated) as untagged\b/i);
      }
    }
    // Grounded in the reader that produces the four words.
    expect(ccd(), 'ccd has no four-word pool reader — re-decide this paragraph')
      .toMatch(/_project_pool_state\(\)/);
  });

  it('says the server refuses and forecasts but never places or writes', () => {
    const s = flat(poolsSection());
    expect(s).toMatch(/never places/);
    expect(s).toMatch(/never writes the marker/);
    // Grounded: the server's pools module is a READER. A write appearing here is
    // the change that makes the sentence false.
    expect(read('server/src/pools.ts'), 'server/src/pools.ts now writes — the README claim is false')
      .not.toMatch(/writeFile|io\.write/);
  });

  it('says the tag outlives every workspace and survives an uninstall', () => {
    const s = flat(poolsSection());
    for (const verb of ['ws-rm', 'ws-reap', 'ws-gc', 'forget']) {
      expect(s, `the section does not name \`${verb}\` among the verbs that leave the tag alone`)
        .toContain(verb);
    }
    expect(s).toContain('ccrc uninstall');
    expect(s, 'the section does not say the tag is outside the backup set').toMatch(/not backed up/i);
    // Grounded: the uninstaller does not name `pools` at all, which is exactly
    // why the tag survives it.
    expect(read('ccd/ccrc'), 'ccrc now touches pools/ — the README claim that uninstall leaves it is false')
      .not.toMatch(/pools/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/pools-prose.test.ts`
Expected: 5 new FAIL, each on the same first assertion —
`README, the account-pools section: the opening anchor is gone` (expected -1 to be greater than -1).

- [ ] **Step 3: Write the minimal implementation**

In `README.md`, insert this subsection after line 858 and its following blank line, immediately before `### Login screens get no keystrokes, and lost auth joins the rescue lane`:

````markdown
### Account pools: tagging a project to a set of accounts

**The rule, once.** An account carries an optional pool name; a project carries
an optional pool name; an account may serve a project when either side is
untagged or the two names are equal. That is the whole policy. An account is
tagged in `~/.ccrc/accounts.json` (`"pool": "pool-a"`, carrying `id`'s grammar);
a project is tagged by a one-token file at `~/.cc-sessions/pools/<project>` on
the fleet host. **Untagged means unconstrained** — every account and every
project starts untagged, and tagging only ever tightens, so nothing on the box
behaves differently until you tag something.

**`ccd` decides; the server refuses and forecasts.** Every place ccd chooses an
account applies the rule: `ws-add`'s placement, the 5 s auto-swap tick, and the
manual verbs. The server reads the same file through the agent and uses it for
exactly two things — refusing a swap or a create it can already see is wrong
(`409 pool-mismatch`, or `503` when the tag cannot be read), and forecasting
where the next workspace would land. It never places a session and it never
writes the marker; the agent's write root is unchanged.

**Tagging.** From the phone: tap a project card and pick a pool. The list is
derived from the pools your accounts actually carry — inventing a brand-new name
is a shell act, deliberately, because a pool with no account in it is the
shortest path to a stranded session. From a shell on the fleet host:

```bash
ccd project-pool --project demo --pool pool-a   # tag
ccd project-pool --project demo --clear         # untag; always allowed, even for a deleted project
echo pool-a > ~/.cc-sessions/pools/demo         # the 2 am idiom; the trailing newline is stripped
ls ~/.cc-sessions/pools/                        # every tag on the box, in one listing
```

The file holds one token matching `^[a-z][a-z0-9-]{0,31}$`. Anything else — two
words, an uppercase letter, a directory in its place, a file the reader cannot
open — is `malformed` or `unreadable`, and **neither is ever quietly downgraded
to untagged**: on a tag nobody can read, nobody decides. Creation refuses naming
the path, the auto-swapper holds where it is, and the server answers 503. A
typo strands one project, which is the point of one file per project.

**Why the tag lives there.** `~/.cc-sessions/pools/<project>` is a dotless
subdirectory of the registry, beside the switches you already touch by hand
(`<wrapper>-disabled`, `coordinator-paused`). Two other homes were designed in
full and rejected. Inside the project's own checkout (`<project>/.ccrc/pool`)
puts policy in the tree every session runs in: one `git clean -fdx` deletes it
and the project silently reverts to unconstrained, and one `git add -A` commits
a pool name into a public repository. One JSON document for every project
(`~/.ccrc/projects.json`) makes a single hand-typed trailing comma unreadable
for *every* project at once — no placement and no rescue anywhere on the box
until somebody fixes it. `$REG/<project>.pool` was not an option either: session
ids are `<wrapper>-<project>`, so tagging a project named `acct-a-demo` would be
writing session `acct-a-demo`'s own registry field.

**What the tag outlives.** Nothing that cleans up a workspace touches it —
`ws-rm`, `ws-reap`, `ws-gc`, `ws-archive`/`ws-restore` and `forget` never name
`pools/` — so a project's tag survives every one of its sessions and workspaces.
It is operator intent, not session state. `ccrc uninstall` leaves it too, like
the `-disabled` markers and the rest of the registry's operator switches. And
like every other marker it is **not backed up**: the backup set is ccd, the
units, the served dists and coord.db, never `~/.cc-sessions` markers. A box
rebuilt from a backup comes back untagged, which is to say unconstrained — the
PWA's flag on an untagged project is the signal that it happened.
````

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/pools-prose.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Prove the pins bite**

Change `never writes the marker` to `writes the marker only on request` and re-run: 1 red. Revert. Delete `ws-reap` from the outlives paragraph and re-run: 1 red naming `ws-reap`. Revert, re-run: 11 green. Record the counts in the commit body.

- [ ] **Step 6: Commit**

```bash
git add server/test/pools-prose.test.ts README.md
git commit -m "docs(readme): where a project's pool tag lives, and what it outlives"
```

---

### Task 4: README — retag timing, the strand, the crossing, the skew and the rollout

**Files:**
- Modify: `README.md` — append to the `### Account pools` subsection created in Task 3, still above `### Login screens get no keystrokes`
- Modify: `server/test/pools-prose.test.ts` (append one describe block)

**Interfaces:**
- Consumes: `SWAP_COOLDOWN` (`ccd/ccd:805`) and `SWAPBLOCK_COOLDOWN` (`:806`); `_strand_mark`/`_strand_clear`; the notify prefix `cc swap STRANDED: `; `$REG/<id>.crosspool` and the `crosspool-ended` log verb; `data-offpool` (`pwa/src/fleet/SessionLine.tsx`, wave 4); the 409/501/502/503 answers (wave 3).
- Produces: nothing new — the section is complete after this task, and `poolsSection()` is its slice.

**Spec:** §5.5.4 (the timing the operator should know), §5.8 (the strand, its banner and its remedies), §5.7 (`--cross-pool` versus `--force`, and the swap/prefer split accepted as §14 O1), §5.11 (the skew table and the agent-first order), §15 (the six rollout steps).

**Mutation table:** rows 33, 34, 36, 41, 42, 44 and 47 are waves 2b/3's mechanisms; this task's guard is that the section's numbers and names are DERIVED from them — the two cooldown figures are extracted from `ccd/ccd` and compared with the prose, and the strand and crossing vocabulary is asserted against the shipped script. Goes red when either cooldown constant changes and the paragraph does not, when the notify prefix or a log verb is renamed, or when the six rollout steps lose a step.

- [ ] **Step 1: Write the failing test**

Append to `server/test/pools-prose.test.ts`:

```ts
describe('README: what a retag does, and when (spec §5.5.4, §5.8, §5.7, §5.11, §15)', () => {
  /** Both gate figures, read off ccd rather than remembered — the bash-floor
   *  idiom in `ccrc-update.test.ts`: a bumped constant must move the prose. */
  const cooldowns = (): { swap: string; block: string } => {
    const s = /^SWAP_COOLDOWN=(\d+)/m.exec(ccd());
    const b = /^SWAPBLOCK_COOLDOWN=(\d+)/m.exec(ccd());
    expect(s, 'ccd no longer spells SWAP_COOLDOWN — this derivation is over nothing').not.toBeNull();
    expect(b, 'ccd no longer spells SWAPBLOCK_COOLDOWN — this derivation is over nothing').not.toBeNull();
    return { swap: s![1]!, block: b![1]! };
  };

  it('states the two gates a retag waits on, with the numbers ccd actually enforces', () => {
    const s = flat(poolsSection());
    const { swap, block } = cooldowns();
    expect(s, `the timing paragraph does not state the ${swap}s swap cooldown`).toContain(swap);
    expect(s, `the timing paragraph does not state the ${block}s refusal cooldown`).toContain(block);
    expect(s).toContain('SWAP_COOLDOWN');
    expect(s).toContain('SWAPBLOCK_COOLDOWN');
    // The three exceptions to "it waits", each named.
    expect(s, 'hard-blocked sessions do not wait; the paragraph must say so').toMatch(/hard-blocked/);
    expect(s, 'a hold defers a retag; the paragraph must say so').toMatch(/held|hold/);
    expect(s, 'the visible waiting state is the one an operator can act on').toContain('data-offpool');
    // Grounded in the PWA cell that renders it.
    expect(read('pwa/src/fleet/SessionLine.tsx'),
      'the PWA no longer marks an off-pool row — the README describes a cell that is gone')
      .toContain('data-offpool');
  });

  it('describes the strand with the vocabulary ccd actually writes, and three remedies', () => {
    const s = flat(poolsSection());
    expect(s).toContain('cc swap STRANDED');
    expect(s).toContain('stranded');
    expect(s).toContain('unstranded');
    // The three remedies of ruling 6, each identifiable.
    expect(s, 'remedy 1 (enable a lane) is missing').toMatch(/-disabled/);
    expect(s, 'remedy 2 (tag another account into the pool) is missing')
      .toMatch(/tag another account/i);
    expect(s, 'remedy 3 (untag the project) is missing').toMatch(/--clear|untag the project/);
    // Grounded: the marker, the clear and the banner text all exist.
    expect(ccd()).toMatch(/_strand_mark/);
    expect(ccd()).toMatch(/_strand_clear/);
    expect(ccd(), 'the notify banner text changed — the README quotes a sentence nobody sends')
      .toContain('cc swap STRANDED: ');
  });

  it('keeps --cross-pool and --force distinct, and states which one sticks', () => {
    const s = flat(poolsSection());
    expect(s).toContain('--cross-pool');
    expect(s).toContain('--force');
    for (const sentence of sentencesOf(s)) {
      if (/--force/.test(sentence)) {
        expect(sentence, `--force is described as a pool override: "${sentence.trim()}"`)
          .not.toMatch(/cross(es|ing)? (a )?pool/i);
      }
    }
    expect(s, 'the swap/prefer split (spec §14 O1) is the thing operators get wrong')
      .toMatch(/prefer --cross-pool/);
    expect(s, 'automatic moves never cross — the sentence that keeps ruling 8 honest')
      .toMatch(/never cross/i);
    // Grounded: the marker and its end-of-life log verb.
    expect(ccd()).toMatch(/crosspool/);
    expect(ccd(), 'the crossing no longer ends with a logged reason').toMatch(/crosspool-ended/);
  });

  it('names the skew states an operator can see, and the six rollout steps', () => {
    const s = flat(poolsSection());
    for (const code of ['409', '501', '502', '503']) {
      expect(s, `the skew table never mentions ${code}`).toContain(code);
    }
    expect(s, 'the transient the two lanes produce is the one that gets reported as a fault')
      .toContain('divergent');
    expect(s, 'the agent lane goes first — the ordering rule this whole feature rides on')
      .toMatch(/deploy\.sh agent/);
    // Six steps, numbered — over the RAW slice, because this one is anchored to
    // the start of a line and flattening would destroy the anchor.
    const raw = poolsSection();
    for (const n of [1, 2, 3, 4, 5, 6]) {
      expect(raw, `rollout step ${n} is missing`).toMatch(new RegExp(`^${n}\\. `, 'm'));
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/pools-prose.test.ts`
Expected: 4 new FAIL —
`the timing paragraph does not state the 900s swap cooldown`, `expected '### Account pools…' to contain 'cc swap STRANDED'`, `expected '### Account pools…' to contain '--cross-pool'`, `the skew table never mentions 409`.

- [ ] **Step 3: Write the minimal implementation**

Append to the `### Account pools` subsection in `README.md`, after the "What the tag outlives" paragraph and before `### Login screens get no keystrokes`:

```markdown
**Retagging a running project, and when it takes effect.** A retag is not a
restart. Within one 5 s tick, every session of that project whose *home* account
is out of pool is re-seeded to an in-pool home (a `rehome` line in `swap.log`
and a `rehome` act in the lifecycle journal), and every session whose *current*
account is out of pool becomes a must-leave. When it actually moves is the part
worth knowing: the move goes through the same two gates every auto-swap does —
`SWAP_COOLDOWN`, 900 s since that session's last landed swap, and
`SWAPBLOCK_COOLDOWN`, 1800 s since a refused one — so a session that swapped in
the last quarter hour keeps running on the wrong-pool account until its gate
opens, and then goes with an `auto-pool` line. Two sessions do not wait:
a hard-blocked one takes the rescue arm immediately, and a session under a
program hold does not move *at all* until it is released — a retag never breaks
a hold. The visible waiting state is `data-offpool` on the session row: the
account chip says this session is running in one pool while its project is in
another, which is exactly true, and reads as "queued", not "stuck". Retagging
deliberately does not bypass `SWAP_COOLDOWN`; that gate exists to stop a swap
storm and a retag is not a good reason to reopen one.

**An empty pool strands, loudly.** When a session is hard-blocked and no account
in its pool can take it, ccd **stays in the pool** and makes the state visible
rather than crossing out of it: a `stranded` line in `swap.log` naming each
candidate and the first reason it failed (`pool=…`, `disabled`, `missing`,
`limit`), a marker on the row, one notify banner (`cc swap STRANDED: …`, floored
to one per 1800 s so a scrolling limit banner cannot storm it), a stranded cell
on the session row and an `N stranded` count on the project card. Three
remedies, all yours: enable a lane in that pool (`rm
~/.cc-sessions/<wrapper>-disabled`), tag another account into the pool, or untag
the project (`ccd project-pool --project <p> --clear`). Nothing stamps a
cooldown, so recovery needs no further action — the first tick on which an
in-pool account has room rescues the session and writes `unstranded`. This also
made an **older** silence loud: a hard-blocked session with every account at
ceiling used to retry every 5 s forever with no marker and no log line, and it
does not any more, tagged project or not.

**Crossing on purpose: `--cross-pool`, which is not `--force`.** `--force` means
one thing and still means only that — accept the transcript loss a swap costs. A
crossing is a different decision, so it takes its own flag on `ccd swap`, `ccd
start`, `ccd enable` and `ccd prefer`, and the two compose. From the PWA the
mismatched accounts sit behind a **show other pools** disclosure in the swap
sheet, and picking one there is what sets the flag; a plain pick posts the body
it always did, and a mismatch comes back `409` with the sentence naming both
pools. Every crossing writes a `cross-pool` line and a per-session marker, and
that marker is what stops the pool machinery undoing the crossing on the next
tick. It is deliberately narrow. `swap --cross-pool` moves the session and
leaves its home alone, so when home recovers the session returns home exactly as
it does after any manual swap today — and that return is a move off the crossed
account, which ends the crossing (`crosspool-ended`). To stay crossed through a
home recovery, move the home: `ccd prefer --cross-pool`. **Automatic moves never
cross**, marker or no marker: the candidate loop stays pool-filtered in every
case.

**Deploy order, and what half-deployed looks like.** Pools touch `ccd/`, so the
fleet host goes first — `bash deploy/deploy.sh agent <host>`, then `bash
deploy/deploy.sh`.

| State | What you see |
|---|---|
| New server, old `ccd` | Tags display but nothing on the fleet enforces them: the chips dim, the fleet banner says the fleet host's ccd does not honour project pools yet, the tag route answers `501` and so does a cross-pool tap. The server's own refusal still stands — a mismatched swap gets `409`, so this state produces refusals, never wrong placements. |
| New `ccd`, old server | The fleet enforces everywhere and strands loudly; the PWA has no override yet, so a mismatched swap dies inside ccd and surfaces as a `502` carrying ccd's own sentence. |
| New `ccd`, old `accounts.sh` | Every account reads untagged — today's behaviour, no noise. |
| Mid-deploy, one deploy long | New placements and manual verbs bind the rule at once; each running session's auto-swapper is still the pre-deploy code until its unit restarts, and a refusal inside a dispatched swap marks a strand rather than failing silently. |
| The two `accounts.json` copies disagree | `roster: 'divergent'` and the amber banner. ccd obeys the fleet host's copy and the server refuses by its own, so a disagreement is loud in both directions rather than silently permissive. The project tag has one copy and cannot skew at all. |

**Rolling it out.** Nothing changes until something is tagged, and every step is
reversible by untagging.

1. **Ship the code with nothing tagged.** Agent lane first, then the server. Zero
   behaviour change: every account untagged, `pools/` absent. Expect
   `roster: 'divergent'` between the two lanes; it clears on the second deploy.
2. **Tag accounts.** Edit `~/.ccrc/accounts.json` on both boxes and redeploy both
   lanes. Still no behaviour change — no project is tagged yet, so the rule
   permits everything.
3. **Check the pools exist.** `ccrc doctor`'s `pools` check passes,
   `GET /api/accounts` shows a `pool` per account, and the pool sheet lists the
   names you expect.
4. **Tag projects one at a time**, starting with one whose pool has headroom.
   Watch `swap.log` for `rehome`, `auto-pool` and `auto-rescue`, and the cards
   for `N stranded`.
5. **Expect strands where a pool is thin.** A pool of one or two accounts, both
   at ceiling, strands its hard-blocked sessions instead of crossing. That is
   the design working, not a fault; the banner names the three remedies.
6. **Rollback** is `ccd project-pool --project <p> --clear` — nothing moves,
   because untagged is unconstrained. For the account side, remove the `pool`
   keys and redeploy agent-first. The per-session pool fields purge with their
   registry rows and are harmless if left behind.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/pools-prose.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 5: Prove the derived numbers bite**

Change `900 s` to `600 s` in the timing paragraph, re-run: 1 red (`the timing paragraph does not state the 900s swap cooldown`). Revert. Delete rollout step 5, re-run: 1 red (`rollout step 5 is missing`). Revert, re-run: 15 green. Record the counts in the commit body.

- [ ] **Step 6: Commit**

```bash
git add server/test/pools-prose.test.ts README.md
git commit -m "docs(readme): retag timing, the strand, the crossing and the rollout"
```

---

### Task 5: `server/src/config.ts` — the roster is seeded once per box, never shipped to both

**Files:**
- Modify: `server/src/config.ts:197-201` (the `loadRoster` docstring — comment only, no code)
- Modify: `server/test/pools-prose.test.ts` (append one describe block)

**Interfaces:**
- Consumes: `deploy/deploy.sh`'s `ship_roster()` (`:468-474`) — the create-if-missing seed the corrected sentence describes.
- Produces: nothing; `loadRoster`'s behaviour is unchanged.

**Spec:** §3.3 (`~/.ccrc/accounts.json` exists once per box, seeded once by `ship_roster`, never overwritten — which is why a pool field that is not emitted is a pool field whose cross-box drift nobody sees), §12 P-4 (D-1687).

**Mutation table:** no §11 row — the guard is this task's own, and it is the one the finding asks for: the sentence must not claim deploy ships one file to both boxes, and the replacement must name the seed mechanism that actually exists in `deploy.sh`. Goes red when the old sentence returns, and when `ship_roster`'s create-if-missing guard is deleted (which would make the NEW sentence false in the other direction).

**LEDGER:** `server/src/config.ts`'s `loadRoster` docstring justified reading the local roster in remote fleet mode with "deploy ships the same `accounts.json` to both boxes" — `deploy/deploy.sh`'s `ship_roster` copies it only when the box has none and never overwrites, so the two copies are hand-owned and may differ, which is the entire reason `rosterAgreement` exists (D-1687 — spec §12 P-4).

- [ ] **Step 1: Write the failing test**

Append to `server/test/pools-prose.test.ts`:

```ts
describe('server/src/config.ts: the roster is SEEDED once per box (D-1687)', () => {
  /** The docstring, flattened out of its ` * ` prefixes — a hard-wrapped claim
   *  routinely spans a line break, and a literal containment check would miss
   *  it: a false GREEN on a negative assertion, which is worse than a false
   *  red. */
  const doc = (): string =>
    flat(passage('config.ts, the loadRoster docstring', read('server/src/config.ts'),
      'Reads and validates `accountsPath`', 'function loadRoster')
      .replace(/\n\s*\*\s?/g, ' '));

  it('no longer claims deploy ships the same accounts.json to both boxes', () => {
    expect(doc()).not.toMatch(/ships? the same `accounts\.json` to both boxes/);
    // The claim, not just its spelling: no sentence may pair the deploy with
    // both boxes as if one file reached them.
    for (const s of sentencesOf(doc())) {
      if (/\bdeploy\b/.test(s) && /both boxes/.test(s)) {
        expect(s, `the docstring still describes one file reaching two boxes: "${s.trim()}"`)
          .toMatch(/seed|never overwrit|hand-owned/i);
      }
    }
  });

  it('names the seed that actually ships it, and deploy.sh still behaves that way', () => {
    expect(doc()).toMatch(/ship_roster/);
    const deploy = read('deploy/deploy.sh');
    // The create-if-missing guard IS the fact the docstring now states.
    expect(deploy, 'ship_roster no longer seeds create-if-missing — the docstring is false again')
      .toMatch(/ship_roster\(\) \{[\s\S]{0,400}?\[ -f ~\/\.ccrc\/accounts\.json \]/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/pools-prose.test.ts`
Expected: 2 new FAIL —
`expected ' Reads and validates \`accountsPath\` …' not to match /ships? the same \`accounts\.json\` to both boxes/`, and `expected ' Reads and validates …' to match /ship_roster/`.

- [ ] **Step 3: Write the minimal implementation**

In `server/src/config.ts`, replace lines 197-201:

```ts
 * In remote fleet mode this still reads the LOCAL box's copy, unconditionally
 * — the server may run on a different machine from the accounts it manages
 * (that is the production topology), but deploy ships the same
 * `accounts.json` to both boxes, so there is no agent round-trip to make
 * here and no FleetIO indirection to add.
```

with:

```ts
 * In remote fleet mode this still reads the LOCAL box's copy, unconditionally
 * — the server may run on a different machine from the accounts it manages
 * (that is the production topology). It is NOT that the two boxes hold one
 * file: `ship_roster` (`deploy/deploy.sh`) seeds `~/.ccrc/accounts.json` only
 * when the box has none and never overwrites it afterwards, so each box's copy
 * is hand-owned and the two can differ — which is precisely why
 * `rosterAgreement` (`server/src/fleetstate.ts`) compares the generated
 * projections continuously and the PWA banners `divergent`. What follows from
 * that is the opposite of an argument for an agent round-trip: THIS box's
 * roster is the one this server serves, answers `GET /api/accounts` from and
 * builds argv against, so reading it locally is reading the right file, and a
 * FleetIO indirection here would silently swap in the OTHER box's answer.
```

No code changes; the function body below is untouched.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/pools-prose.test.ts`
Expected: PASS (17 tests).

- [ ] **Step 5: Verify no other copy of the false sentence exists in shipped source**

Run: `git grep -n "accounts.json" -- server/src shared agent/src pwa/src`

Read every hit. The claim being hunted is "one file reaches both boxes", and it spans line breaks in a wrapped comment, so a phrase grep would miss it — read the hits rather than grepping for the sentence. Measured at `2b15144e`, 20 hits, and only `config.ts:200` carries the claim. The two worth knowing about, because they look like they might: `server/src/fleetstate.ts:76-91` already states the TRUE version ("the two `accounts.json` files are deliberately NOT what is compared… `accounts.json` is user-owned and never overwritten"), so the corrected docstring now agrees with it instead of contradicting it; and `server/src/sessionws.ts:733` says "see `config.ts`'s own comment on why", which points at the `configDirFor` comment at `config.ts:176-189`, NOT at the docstring this task rewrites — leave it alone. If a further copy exists, correct it in this same task and name the path in the commit body.

- [ ] **Step 6: Type-check and commit**

```bash
cd server && npm run build
```
Expected: exits 0, no diagnostics. **There is no `typecheck` script in this tree** — measured at `2b15144e`: `server` and `agent` declare `dev`/`build`/`test`, `pwa` declares `dev`/`build`/`preview`/`test`, and `build` is `tsc` (`tsc --noEmit && vite build` in the PWA). `server/dist/` is gitignored, so running it leaves no diff. A comment-only change cannot alter types; this proves the block is still a valid comment and not, say, an unterminated `/*`.

```bash
git add server/test/pools-prose.test.ts server/src/config.ts
git commit -m "fix(config): the roster is seeded once per box, never shipped to both"
```

---

### Task 6: `ccd/ccd` — `accounts.sh` does carry telemetry; the gap is the consumer

**Files:**
- Modify: `ccd/ccd:3546-3551` (the `_ws_least_loaded` header comment — comment only, no code)
- Modify: `server/test/pools-prose.test.ts` (append one describe block)

**Interfaces:**
- Consumes: `emittedNames()` from Task 2; `shared/generate.mjs`'s `CCRC_MEASURED` emission (`telemetry === 'anthropic'`, pinned by `server/test/roster-generate.test.ts:130-134`).
- Produces: nothing; `_ws_least_loaded`'s behaviour is unchanged, and the gap the comment declares stays open.

**Spec:** §12 P-5 (D-1688).

**Mutation table:** no §11 row — this task's own guard, in two halves. The false sentences must be gone, AND the gap the corrected comment declares must still be real: the loop body must not read `CCRC_MEASURED`. Goes red when the old wording returns, and red again the day somebody implements the consumer without rewriting the comment — which is the outcome this pin wants.

**AGENT-FIRST:** this is a `ccd/` edit. Deploy order in Task 9.

**LEDGER:** `ccd/ccd`'s `_ws_least_loaded` comment asserted that the generated `accounts.sh` carries "no telemetry field at all" and that "bash still has nothing to consult" — `shared/generate.mjs` has emitted `CCRC_MEASURED`, derived from `telemetry === 'anthropic'`, since 2026-08-13, so the parity gap the comment documents is real but its stated cause is not: what is missing is the consumer, not the data (D-1688 — spec §12 P-5).

- [ ] **Step 1: Write the failing test**

Append to `server/test/pools-prose.test.ts`:

```ts
describe('ccd: accounts.sh DOES carry telemetry — the gap is the consumer (D-1688)', () => {
  const header = (): string =>
    flat(passage('ccd, the _ws_least_loaded header comment', ccd(),
      '_ws_least_loaded() {', 'local best=""').replace(/^\s*#\s?/gm, ''));
  const body = (): string =>
    passage('ccd, the _ws_least_loaded body', ccd(), 'local best="" bs=1000', '\n}', 80);

  it('no longer says the generated file carries no telemetry field', () => {
    const h = header();
    expect(h).not.toMatch(/no telemetry field at all/);
    expect(h).not.toMatch(/bash still has nothing to consult/);
  });

  it('names the array that carries it, and the generator still emits that array', () => {
    expect(header(), 'the comment does not name the array bash can actually read')
      .toMatch(/CCRC_MEASURED/);
    expect(emittedNames(), 'the generator stopped emitting CCRC_MEASURED — rewrite this comment again')
      .toContain('CCRC_MEASURED');
  });

  it('the gap the comment declares is still REAL — this loop does not consume it', () => {
    // Deliberately two-sided. If a future change makes `_ws_least_loaded` read
    // CCRC_MEASURED, this reds — and it should: the comment would then be
    // describing a gap that has closed, which is how it went wrong the first
    // time. Rewrite the comment in the same commit that closes it.
    expect(body(), 'the loop now reads CCRC_MEASURED — the comment above it is stale again')
      .not.toMatch(/CCRC_MEASURED/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/pools-prose.test.ts`
Expected: 2 new FAIL —
`expected '_ws_least_loaded() { …' not to match /no telemetry field at all/`, and `the comment does not name the array bash can actually read`. The third test PASSES already (the loop genuinely does not read the array); say so in the run notes rather than treating it as a miss.

- [ ] **Step 3: Write the minimal implementation**

In `ccd/ccd`, replace lines 3546-3551:

```bash
  #   1. It skips an account whose roster entry says telemetry:'none' — an
  #      account that will never report, so its permanent unknown must not read
  #      as permanent emptiness. ~/.ccrc/accounts.sh HAS now arrived and this
  #      gap did not close with it: the generated file carries ids, home-ability
  #      and the upstream id, and no telemetry field at all (shared/
  #      generate.mjs), so bash still has nothing to consult.
```

with:

```bash
  #   1. It skips an account whose roster entry says telemetry:'none' — an
  #      account that will never report, so its permanent unknown must not read
  #      as permanent emptiness. THE DATA IS HERE: ~/.ccrc/accounts.sh carries
  #      CCRC_MEASURED (shared/generate.mjs, telemetry === 'anthropic', pinned
  #      by server/test/roster-generate.test.ts). What is missing is the
  #      CONSUMER — this loop never reads it — so the gap is one `case`
  #      membership test away, not a projection change. An earlier version of
  #      this comment claimed accounts.sh had "no telemetry field at all", which
  #      was stale from the day the array shipped.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/pools-prose.test.ts`
Expected: PASS (20 tests).

- [ ] **Step 5: Prove the ccd script is still syntactically whole**

Run: `bash -n ccd/ccd`
Expected: exits 0, no output. (A comment edit cannot break parsing, and this is the cheap proof that no `#` was dropped.)

Then run the two ccd suites nearest this function, in the foreground:

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-account-ok.test.ts test/projected-home.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/test/pools-prose.test.ts ccd/ccd
git commit -m "fix(ccd): accounts.sh does carry telemetry — the gap is the consumer, not the projection"
```

---

### Task 7: `deploy/deploy.sh` and README — the `divergent` banner between the two lanes is expected, and says so

**Files:**
- Modify: `deploy/deploy.sh` — one `echo` immediately after `:507` (`echo "roster fingerprint on $BOX: …"`), inside the `if [ "$TARGET" = "agent" ]; then` branch
- Modify: `README.md:2088-2097` (the `**Ordering between the two targets.**` paragraph in `## Deploy`)
- Modify: `server/test/pools-prose.test.ts` (append one describe block)

**Interfaces:**
- Consumes: `ship_roster`, `roster_fp` and `$ACCOUNTS_SH` (already in the agent lane); `rosterAgreement`'s `divergent` verdict (`server/src/fleetstate.ts`).
- Produces: nothing programmatic — the echo is operator output on stdout, matching the lane's existing `roster fingerprint on $BOX: …` style (plain stdout for facts; `>&2` with a `deploy: ` prefix is reserved for failures and warnings, and this is neither).

**Spec:** §5.3 ("During every agent-first deploy that adds pools the banner will show for the minutes between the two lanes — expected; the deploy output says so"), §5.11 (agent-first is mandatory), §15 step 1.

**Mutation table:** no §11 row — this task's own guard: the agent lane's roster block must carry the sentence beside the fingerprint it explains, and README's ordering paragraph must say the same thing. Goes red when the echo is deleted or moved out of the agent lane's roster block, and when the README paragraph loses the transient.

- [ ] **Step 1: Write the failing test**

Append to `server/test/pools-prose.test.ts`:

```ts
describe('deploy.sh + README: the divergent banner between the two lanes is EXPECTED', () => {
  it('the agent lane prints the note beside the fingerprint it explains', () => {
    const lane = passage('deploy.sh, the agent lane roster block', read('deploy/deploy.sh'),
      'if [ "$TARGET" = "agent" ]; then', 'THE SECOND SEED-ONCE FACT');
    expect(lane, 'the fingerprint line moved out of the agent lane').toMatch(/roster fingerprint on \$BOX/);
    expect(lane, 'the agent lane never mentions the divergence its own run produces')
      .toMatch(/divergent/);
    // It names the remedy — the OTHER lane — so the note is actionable rather
    // than merely reassuring.
    expect(lane, 'the note does not name the second lane that clears it')
      .toMatch(/deploy\/deploy\.sh/);
  });

  it('README says the same thing where it states the ordering rule', () => {
    const p = passage('README, the deploy ordering paragraph', readme(),
      '**Ordering between the two targets.**', '**Restore** (manual, from the target box');
    expect(p, 'the ordering paragraph does not mention pools').toMatch(/pool/i);
    expect(p, 'the ordering paragraph does not name the transient the two lanes produce')
      .toMatch(/divergent/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/pools-prose.test.ts`
Expected: 2 new FAIL —
`the agent lane never mentions the divergence its own run produces`, and `the ordering paragraph does not mention pools`.

- [ ] **Step 3: Write the minimal implementation**

(a) In `deploy/deploy.sh`, after line 507:

```bash
  echo "roster fingerprint on $BOX: $(roster_fp "$ACCOUNTS_SH")"
```

add:

```bash
  # The banner this lane is about to raise, said out loud so it is not reported
  # as a fault. `rosterAgreement` compares the two boxes' GENERATED accounts.sh,
  # so any roster change — an account, a pool — makes the two disagree from the
  # moment this lane lands until the server lane ships the same roster.
  echo "  until the server lane runs with this roster, /api/fleet/health reports roster: divergent and the PWA shows the amber banner — expected between the two lanes; 'bash deploy/deploy.sh' clears it"
```

(b) In `README.md`, replace line 2097 (`zero if the agent ships first.`) with:

```
zero if the agent ships first. Account pools are the same rule with a *visible*
transient: between the two lanes the boxes' rosters differ, so
`GET /api/fleet/health` reports `roster: 'divergent'` and the PWA raises its
amber banner until the server lane runs. That is expected, not a fault — the
agent lane prints the same sentence as it goes — and the second deploy clears
it.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/pools-prose.test.ts`
Expected: PASS (22 tests).

- [ ] **Step 5: Prove deploy.sh is still whole, and still refuses to guess**

```bash
bash -n deploy/deploy.sh
cd server && ./node_modules/.bin/vitest run test/deploy-coordinates.test.ts test/deploy-env-guard.test.ts
```
Expected: `bash -n` exits 0 with no output; both suites PASS. (The echo lands after the lane's own refusals, so no target can be guessed by reaching it.)

- [ ] **Step 6: Commit**

```bash
git add server/test/pools-prose.test.ts deploy/deploy.sh README.md
git commit -m "docs(deploy): the divergent banner between the two lanes is expected, and the run says so"
```

---

### Task 8: `CLAUDE.md` — one bullet block of pool invariants, and the re-measured README size

**Files:**
- Modify: `CLAUDE.md` — insert one bullet block after line 150 (the end of the `- **Wire discipline …**` bullet), before the blank line and `## Coordination (Build 7) invariants a coder must NOT break`
- Modify: `CLAUDE.md` — the `README.md` (~N lines) figure in the file's third paragraph
- Modify: `server/test/pools-prose.test.ts` (append one describe block)

**Interfaces:**
- Consumes: `POOLS_DIR="$REG/pools"`, `_project_pool_state`, `--cross-pool` (waves 2a/2b); `POOLS_DIR_NAME = 'pools'` (`server/src/pools.ts`, wave 2a).
- Produces: the coder-facing invariant text every later pools change is reviewed against.

**Spec:** §5.1 (role matrix), §5.2 (the rule), §4 (the namespace claim and the `acct-a-demo` collision), §5.4.3 (the four-word reader, the only reader), §5.7.1 (`--cross-pool` ≠ `--force`), §9 (the three per-id fields purge with the row), §14 O7 (fixture names).

**Mutation table:** row 51 — *no operator names in source* (the bullet names `pool-a`/`pool-b` and says why); plus this task's own guard, box-token-census's "TRUE, not merely present" shape: each claim in the bullet is checked against the source it describes.

**Placement, non-negotiable:** the block goes AFTER the Wire-discipline bullet. `server/test/ledger-instruction.test.ts:92` slices CLAUDE.md from `- **Deviation ledger (D-N):**` to `'\n- **Wire discipline'` — a bullet inserted between those two anchors silently truncates that passage and turns seven live assertions green over text that was cut away (its own D-1443 docstring records the measurement).

- [ ] **Step 1: Write the failing test**

Append to `server/test/pools-prose.test.ts`:

```ts
describe('CLAUDE.md: the account-pools bullet is TRUE, not merely present', () => {
  const bullet = (): string =>
    flat(passage('CLAUDE.md, the account-pools bullet', read('CLAUDE.md'),
      '- **Account pools', '\n## Coordination (Build 7) invariants'));

  it('states the rule, the authority, and the namespace fact', () => {
    const b = bullet();
    expect(b, 'ruling 3 in five words').toMatch(/untagged = unconstrained/i);
    expect(b, 'tagging only tightens — the other half of ruling 3').toMatch(/only tighten/i);
    expect(b, 'the marker path a coder must not relocate').toContain('~/.cc-sessions/pools/<project>');
    expect(b, 'the rejected spelling has to be named to be forbidden').toContain('$REG/<project>');
    expect(b, 'ccd is the authority; the server refuses and forecasts').toMatch(/never places/i);
    expect(b, 'the four-word reader is the only reader').toMatch(/_project_pool_state/);
    expect(b, '--cross-pool is not --force').toContain('--cross-pool');
    expect(b, 'the three per-id fields purge with the row').toMatch(/purge with the row/i);
    expect(b, 'fixture pool names, so nobody types a real one').toMatch(/pool-a/);
  });

  it('is short enough to be the non-obvious rules rather than the README', () => {
    const raw = passage('CLAUDE.md, the account-pools bullet (raw)', read('CLAUDE.md'),
      '- **Account pools', '\n## Coordination (Build 7) invariants');
    expect(raw.split('\n').filter((l) => l.trim() !== '').length,
      'CLAUDE.md says README is canonical — this bullet is over 12 lines').toBeLessThanOrEqual(12);
  });

  it('is grounded in the shipped mechanism it describes', () => {
    expect(ccd(), 'ccd relocated its pools directory').toMatch(/POOLS_DIR="\$REG\/pools"/);
    expect(ccd(), 'the four-word reader is gone').toMatch(/_project_pool_state\(\)/);
    expect(read('server/src/pools.ts')).toMatch(/POOLS_DIR_NAME = 'pools'/);
    expect(read('server/src/pools.ts'), 'the server writes pools now — the bullet is false')
      .not.toMatch(/writeFile|io\.write/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/pools-prose.test.ts`
Expected: 2 new FAIL, both on `CLAUDE.md, the account-pools bullet: the opening anchor is gone` (the first two tests slice the bullet). The third test — `is grounded in the shipped mechanism it describes` — reads only `ccd/ccd` and `server/src/pools.ts` and PASSES already; note that in the run record rather than treating it as a miss.

- [ ] **Step 3: Write the minimal implementation**

(a) In `CLAUDE.md`, insert after line 150 (`computes it). \`FLEET_PROTO_MIN\` is a dormant kill-switch.`):

```markdown
- **Account pools — both sides optional, `ccd` is the authority.** An account carries an optional `pool`
  (`accounts.json`, emitted as `_ccrc_pool` into `accounts.sh`, so a cross-box disagreement is visible);
  a project carries one at `~/.cc-sessions/pools/<project>` — a DOTLESS registry subdirectory, never
  `$REG/<project>.<x>` (ids are `<wrapper>-<project>`, so a project named `acct-a-demo` would write
  session `acct-a-demo`'s own field). Serve iff either side is untagged or the names are equal:
  **untagged = unconstrained, and tagging can only tighten.** `ccd` decides at every placement, tick and
  manual verb; the server REFUSES (409/503) and FORECASTS and **never places or writes the marker**.
  `_project_pool_state` is the ONLY reader and answers four words — `named <n>`/`untagged`/`unreadable`/
  `malformed`, always rc 0 — and an undecidable tag never folds into `untagged`. `--cross-pool` is NOT
  `--force` (transcript loss): it is the declared crossing, and `.crosspool`/`.stranded`/`.strandnotify`
  are one-dot registry fields that purge with the row. Fixtures are `pool-a`/`pool-b`; real pool names
  are operator DATA and appear in no shipped file (`topology-clean`).
```

(b) Re-measure README and update the size claim. Run `wc -l README.md`, then in CLAUDE.md's third paragraph replace `**\`README.md\` (~2165 lines)` with the measured figure rounded to the nearest five (e.g. `~2360`). `server/test/oss-metadata.test.ts` allows 10% drift and README grows ~140 lines in this wave — the claim is still inside tolerance before the edit, and this keeps it honest rather than merely legal.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd server && ./node_modules/.bin/vitest run test/pools-prose.test.ts test/oss-metadata.test.ts
```
Expected: PASS — `pools-prose` 25 tests, `oss-metadata` green including `CLAUDE.md's README size claim is still true`.

- [ ] **Step 5: Prove the neighbouring CLAUDE.md pins still slice what they think they slice**

```bash
cd server && ./node_modules/.bin/vitest run test/ledger-instruction.test.ts test/box-token-census.test.ts test/coord-pause-route.test.ts test/mail-hardening.test.ts test/worker-skill.test.ts
```
Expected: all PASS. If `ledger-instruction` reds with "the closing anchor is gone" or a passage-length failure, the bullet was inserted in the wrong place — move it below the Wire-discipline bullet and re-run.

- [ ] **Step 6: Commit**

```bash
git add server/test/pools-prose.test.ts CLAUDE.md
git commit -m "docs(claude-md): the pool rule, the namespace and the four-word reader in one bullet"
```

---

### Task 9: Whole-branch gate

**Files:** none modified — this task only measures.

**Interfaces:**
- Consumes: every task above.
- Produces: the measured evidence the wave is mergeable, and the deploy order for the one `ccd/` change it carries.

**Spec:** §11 rows 51 and 52 (this wave's two rows), §5.11 (agent-first).

**Mutation table:** row 51 — *no operator names in source* — discharged here by running `topology-clean` over the whole tree after the last prose edit; row 52 — discharged in Task 1 and re-run here.

- [ ] **Step 1: Full package suites, in the foreground**

```bash
cd server && npm run test
```
Expected: PASS. Known load flakes (`ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`) are re-run IN ISOLATION before being called a break:
`cd server && ./node_modules/.bin/vitest run test/<name>.test.ts`

```bash
cd agent && npm run test
cd pwa && npm run test
```
Expected: PASS. (Neither package is edited by this wave; they run because `ccd/ccd` changed under them.)

- [ ] **Step 2: The corpus ratchets, after the last prose edit**

```bash
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts test/topology-clean.test.ts test/dtbd.test.ts
```
Expected: PASS. `topology-clean` is the row-51 discharge: it walks every tracked file, docs included, and reds on an operator host, address, tailnet or account residue. A red naming a README or CLAUDE.md line means a real name was typed where a fixture belonged.

- [ ] **Step 3: The cross-branch ledger check**

```bash
git fetch origin main
cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts
```
Expected: PASS. This compares this branch's plan entries against `origin/main`'s WITHOUT merging; it must be run after the orchestrator has written the `## Deviations found` section, and again before the merge.

- [ ] **Step 4: Type-check**

```bash
cd server && npm run build
cd agent && npm run build
cd pwa && npm run build
```
Expected: each exits 0. **`build` IS the type-check here** — measured at `2b15144e`, no package in this tree declares a `typecheck` script: `server`/`agent` run bare `tsc`, `pwa` runs `tsc --noEmit && vite build`. The one type-check this misses is `server/test/**`, which `server/tsconfig.json`'s `include` deliberately excludes and which `server/test/typecheck-tests.test.ts` covers by spawning its own `tsc` from inside `npm run test` — so `pools-prose.test.ts` is type-checked by Step 1, not by this step. Emitted `dist/` trees are gitignored and leave no diff.

- [ ] **Step 5: The prose suite, one more time, whole**

```bash
cd server && ./node_modules/.bin/vitest run test/pools-prose.test.ts test/readme-holds.test.ts test/oss-metadata.test.ts test/license.test.ts test/ccrc-install-graphify.test.ts test/ccrc-update.test.ts
```
Expected: PASS — every suite in the tree that reads README.md or CLAUDE.md, green together.

- [ ] **Step 6: The deploy order, in words**

This wave edits `ccd/ccd` (Task 6), so it is **agent-first**, exactly as the repo does it:

```bash
bash deploy/deploy.sh agent      # fleet host: coordinates from ~/.ccrc/deploy.env; no host argument needed on this fleet
bash deploy/deploy.sh            # server box
```

The agent lane installs `ccd` before restarting the agent (the agent caches `ccd caps` at boot, so the reverse order pins a stale verb set), and the server lane's final gate is README's own: `/health` reporting the shipped sha. Do not run either lane as part of executing this plan — the deploy is the operator's act, after review and merge.

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

- **D-1685** (Task 1) — README's placement section said `ccd start`/`swap`/`prefer` "bypass the gate
  entirely" — true of the `-disabled` marker, false of the pool rule the same three verbs now enforce, and
  the sentence was the operator's only written account of what a manual verb overrides. Rewritten to name
  `--cross-pool`, and pinned by `pools-prose.test.ts`. (spec §12 P-9)
- **D-1686** (Task 2) — README's account-entry sentence never named `hidden` (nor, now, `pool`), so the
  one declared field that decides whether an entry is presented as an account was documented nowhere an
  operator reads; the enumeration is now DERIVED from `ACCOUNT_KEYS` by the pin so it cannot fall behind
  a third time. (spec §12 P-6)
- **D-1687** (Task 5) — `server/src/config.ts:197-201` claimed deploy ships one `accounts.json` to both
  boxes; `ship_roster` (`deploy/deploy.sh:468-474`) seeds create-if-missing and never overwrites, so the
  two copies are hand-owned and may differ — the entire reason `rosterAgreement` exists. (spec §12 P-4)
- **D-1688** (Task 6) — `ccd/ccd:3546-3551` said `accounts.sh` carries "no telemetry field at all";
  `CCRC_MEASURED` has been emitted since 2026-08-13, so the comment's cause was false while its gap (no
  consumer in `_ws_least_loaded`) is real. Rewritten, and pinned two-sided so the comment reds again the
  day the consumer lands without it. (spec §12 P-5)

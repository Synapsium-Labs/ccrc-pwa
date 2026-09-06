# Account pools — wave 1: the roster's pool field, its two mirrors, and the rule spelled once — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an account an optional pool name that survives every hop it has to survive — the JSON roster, the bare-`node` validator, the generated `accounts.sh` bash, and the wire — and spell the pool rule once in TypeScript so waves 3 and 4 consume one decision instead of two.

**Architecture:** Five additive edits and one new pure module. `shared/roster.ts` gains `POOL_NAME_RE` (deliberately `ID_RE`'s grammar, for `ID_RE`'s reason) and a REQUIRED `AccountDef.pool: string | null` whose `null` is what an absent key parses to. `shared/roster-json.mjs` — the bare-`node` mirror that promises to be "stricter, never laxer" — mirrors `pool` and, in the same act, closes the `hidden` gap that made the promise false. `shared/generate.mjs` emits `_ccrc_pool()` into `~/.ccrc/accounts.sh` ALWAYS (an empty `case` when nothing is tagged), so the emission is inside `rosterAgreement`'s digest and `declare -F _ccrc_pool` is a version probe. `shared/api.ts` gains the project-pool wire vocabulary (types only — their consumers are waves 3 and 4) and `RosterWire.pool`, emitted by `GET /api/accounts`. New `shared/poolrule.ts` (L0) holds `poolRule`, the one TypeScript spelling of design §5.2, driven through the fixture table `ccd`'s bash and the PWA will later be driven through too.

**Tech Stack:** TypeScript (strict, NodeNext) in `shared/` and `server/src`; dependency-free ESM (`.mjs` + hand-written `.d.mts`) for the deploy-side mirrors; vitest for every suite; bash-in-a-subshell for the generated file's behaviour.

**Spec:** `docs/superpowers/specs/2026-09-04-account-pools-design.md`

**Base:** `origin/main` `2b15144e`; branch `ws/amber-summit`

**Not agent-first.** This wave touches nothing under `ccd/`, `session-hook.sh` or `ccd/coordinator-skill/`, so the agent-first deploy rule does not bind it and there is no deploy step here — waves 2a/2b carry that. One consequence worth knowing before the bytes reach a box: `accounts.sh` gains `_ccrc_pool`, which changes its `bodyDigest`, so `rosterAgreement` reads `divergent` for the minutes between the agent lane and the server lane (spec §5.3 records that as expected, with the banner's existing remedy). Nothing in `ccd` calls `_ccrc_pool` until wave 2a, so an `accounts.sh` carrying the new function and a `ccd` with no caller for it is inert.

---

## Global Constraints

Copied from the spec and from `CLAUDE.md`. Every task's requirements implicitly include this section.

- **Fixture HOMEs only.** No test may run against the live `$HOME`. `mkTmp` (`server/test/tmpHelpers.ts`) is how a home is made; `seedRoster` / `seedAccountsSh` are how one is filled. Never run any `ccd` verb against the live `$HOME`; never touch tmux, `~/.cc-sessions`, `~/.cc-limits`, or a `claude-session@*` unit.
- **No account name, pool name, host name or IP that belongs to a real operator, anywhere** — source, test, or this document. Fixture pool names are `pool-a`, `pool-b` (and `pool-ab`, used once to prove the comparison is equality and not a prefix). Fixture account ids are `DEFAULT_TEST_ROSTER`'s: `claude`, `claude-a`, `claude-b` (label `team·b`), `gpt`, `claude-d`. `server/test/topology-clean.test.ts` and `server/test/single-definition.test.ts` scan the whole tracked tree, documents included.
- **`FLEET_PROTO` stays 1; the wire is additive-only.** A new field never bumps the protocol. A newer peer must tolerate an older peer omitting a field, through a SINGLE reader per field.
- **No overloaded null at a seam.** Two conditions a caller handles differently must not collapse to one value. `unreadable` and `malformed` are never folded into `untagged`; an absent `pool` key and a written `"pool": null` are different remedies and are refused differently.
- **Agent-first for `ccd/`** — not triggered by this wave (see the header note); waves 2a/2b own it.
- **`EXEC_COMMANDS = ['tmux','ccd']` stays closed. No `gh` grant, ever.** This wave adds no exec surface at all.
- **L0 imports nothing.** `shared/*.ts` is bundled by the PWA, so it may not import `node:*` — not even for types. `shared/poolrule.ts` imports ONLY types, and only from `./api.js`.
- **Mutation-table discipline.** Every guard ships WITH a test that goes RED when the guard is deleted or mutated, measured before and after — not asserted in a comment. TDD, red first.
- **Deviation numbers come only from the allocator.** This plan's plan-time numbers, D-1663 and D-1664, were minted in ONE allocator call and defined in `## Deviations found` at plan commit; the `LEDGER:` lines in Tasks 2 and 5 REFERENCE them. A deviation found during execution is allocated in its own call at the moment it is found, never taken from a gap in that block.
- **Node floor `>=22.13.0`,** identical across the three engines; if `node-floor.test.ts`'s absolute assertion reds while the others are green, RAISE engines — never lower them.
- **Run suites in the FOREGROUND**, timeout ≥ 600000 ms, from inside the package: `cd server && ./node_modules/.bin/vitest run test/<file>.test.ts`. NEVER bare `npx vitest` — it resolves a global copy with no jsdom and falsely reports "no tests".

---

## Wave map

Every wave's plan lives at `docs/superpowers/plans/2026-09-05-account-pools-<wave-slug>.md`. The spec's wave 2 was split in two at plan time (2a, 2b), so the program is six PRs, each merged before the next is cut.

| Wave | Owns |
|---|---|
| **1 (this one)** — `2026-09-05-account-pools-wave1-roster.md` | roster field, both mirrors, generator, wire vocabulary, rule core, fixtures |
| 2a — `2026-09-05-account-pools-wave2a-ccd-tag-placement.md` | `ccd`'s reader + the `project-pool` verb + the `_pool_ok` predicate + placement (`_ws_least_loaded [project]`, `cmd_ws_add`) + the agent grant + the two `CCD_ARGV` entries + `POOLS_CAP` + the doctor check + the `rehome` act in all three vocabularies |
| 2b — `2026-09-05-account-pools-wave2b-ccd-swap-strand-crossing.md` | `ccd`'s deciders: the auto-swap tick, the strand, the crossing marker, the four manual verbs |
| 3 — `2026-09-05-account-pools-wave3-server.md` | server L1/L3 (`server/src/pools.ts`, `server/src/poolrule.ts`), registry `stranded`, the routes, the watcher frame, health |
| 4 — `2026-09-05-account-pools-wave4-pwa.md` | PWA: `accountPool`, `splitByPool`, `PoolSheet`, the chips, the sheets, the store slot |
| 5 — `2026-09-05-account-pools-wave5-docs.md` | README, `CLAUDE.md`, and the `config.ts` / `ccd` comment corrections |

**This wave CONSUMES nothing from an earlier wave** — it is the substrate.

**This wave PRODUCES, and later waves must import these exact names rather than re-spell them:**

| Name | Home | First consumer |
|---|---|---|
| `POOL_NAME_RE` (`/^[a-z][a-z0-9-]{0,31}$/`, exported) | `shared/roster.ts` | wave 2a pins `ccd`'s bash literal against `POOL_NAME_RE.source`; wave 3's tag route validates the request body with it |
| `AccountDef.pool: string | null` | `shared/roster.ts` | wave 3's `poolEligible` / `projectPlacement` |
| `RosterJsonAccount.pool: string | null` | `shared/roster-json.d.mts` | `shared/generate.mjs`, already, in this wave |
| `_ccrc_pool()` in `~/.ccrc/accounts.sh` | `shared/generate.mjs` | wave 2a's `_acct_pool` |
| `ProjectPoolWire`, `PoolsEnforcement`, `ProjectPoolsWire` | `shared/api.ts` | wave 3 (`pools.ts`, the frame, health) and wave 4 (`splitByPool`, the chips) |
| `RosterWire.pool: string | null` | `shared/api.ts` | wave 4's `accountPool(roster, wrapper)` — the ONLY PWA reader of the field |
| `poolRule(accountPool, projectPool): PoolVerdict` and `PoolVerdict` | `shared/poolrule.ts` | wave 3's `server/src/poolrule.ts` (value import, wrapped as `poolVerdict`); wave 4's `splitByPool` (value import — the PWA COMPOSES this spelling, it does not re-spell the rule) |
| `POOL_RULE_CASES`, `PoolRuleCase` | `server/test/fixtures/poolRule.ts` | wave 2a's `ccd-pool-ok.test.ts` (the bash spelling); wave 3's `pools.test.ts` (the roster-lookup wrapper). The PWA test package cannot import `server/test/fixtures`, and does not need to: `splitByPool` calls `poolRule`, so wave 4 tests the composition, not the rule |
| `POOLED_TEST_ROSTER` | `server/test/fixtures/poolRule.ts` | wave 2a passes it to `seedAccountsSh(home, POOLED_TEST_ROSTER)` |

**Two facts later waves need and cannot see from their own diffs:**

1. **The PWA already imports `shared/roster.ts`** — `pwa/src/lib/offline.ts:10` imports the VALUE `HUES`, and `pwa/src/lib/accounts.ts:29` imports `type { Hue }`. `pwa/tsconfig.json`'s `include` is `["src", "test", "vite.config.ts", "../shared"]`, so `shared/poolrule.ts` is compiled by the PWA's own `tsc --noEmit` from the moment it lands. Wave 4's import of `poolRule` therefore needs no new plumbing and no build change — only the import line.
2. **Wave 1 edits exactly one PWA file: `pwa/test/rosterFixture.ts`** (Task 4), because `RosterWire.pool` is REQUIRED and that fixture is a typed `RosterWire[]` literal. All five entries get `pool: null`. **Wave 4 must not re-add them**; it builds its pooled variants by mapping over `TEST_ROSTER`, the way `pwa/test/swap-sheet.test.tsx:131` already does for `hidden`.

**One thing wave 4 must NOT "fix":** `RosterWire.pool` rides the PWA's offline snapshot (`pwa/src/lib/offline.ts`'s `FleetSnapshot.roster`), exactly as `hue` and `hidden` already do. Spec §5.9's "nothing about pools is persisted … in the PWA offline snapshot" is about the PROJECT-pool machinery — the `pools` frame, `ProjectRow.pool`, the store slot — whose staleness would render a cached tag as live policy. An account's pool is roster IDENTITY, and a cold start that has labels and hues but no pools would be a snapshot that is half itself. `isRosterWireLike` (`offline.ts:47`) does not check `pool`, just as it does not check `hidden`, which is precisely why wave 4's `accountPool` must test `typeof v === 'string'` rather than trusting the static type.

---

## File map

| File | Task | Responsibility after this wave |
|---|---|---|
| `shared/roster.ts` | 1 | Owns the pool GRAMMAR (`POOL_NAME_RE`) and the parse/refusal of `AccountDef.pool`. |
| `shared/roster-json.mjs` | 2 | The bare-`node` mirror of that validation, now genuinely stricter-never-laxer. Returns `pool` so the generator can emit it. |
| `shared/roster-json.d.mts` | 2 | Types the mirror's output. |
| `shared/generate.mjs` | 3 | Projects `pool` into `_ccrc_pool()` in `~/.ccrc/accounts.sh`. |
| `shared/api.ts` | 4 | Declares the project-pool wire vocabulary and `RosterWire.pool`. |
| `server/src/server.ts` | 4 | `GET /api/accounts` copies `pool` onto the wire. |
| `pwa/test/rosterFixture.ts` | 4 | Compile-forced: the typed `RosterWire[]` fixture answers the new required field. |
| `shared/poolrule.ts` (new) | 5 | The one TypeScript spelling of the rule. Pure L0, type imports only. |
| `server/test/fixtures/poolRule.ts` (new) | 3, 5 | `POOLED_TEST_ROSTER` (Task 3) and the `POOL_RULE_CASES` truth table (Task 5) — one definition, three language consumers. |
| `server/test/roster.test.ts` | 1 | Pins the parser's pool refusals. |
| `server/test/gen-accounts.test.ts` | 2, 3 | Pins CLI ⇄ TypeScript agreement in both directions, with pools. |
| `server/test/roster-generate.test.ts` | 1, 3 | Pins the generated bash's behaviour by executing it. |
| `server/test/accounts-route.test.ts` | 4 | Pins the wire's key set and the emitted values. |
| `server/test/pool-rule-core.test.ts` (new) | 5 | Drives `poolRule` over the table, and pins the module's L0 purity. |

---

### Task 1: The roster learns `pool` — grammar, type, parser

**Files:**
- Modify: `shared/roster.ts` — `AccountDef` (`:71`–`:111`, new field after `hidden` at `:110`); `POOL_NAME_RE` beside `ID_RE` (`:217`); `ACCOUNT_KEYS` (`:238`–`:240`); `parseAccount`'s `hidden` block (`:445`–`:457`); the return (`:484`)
- Modify: `server/test/roster-generate.test.ts:98`–`:102` — the one hand-built `Roster`-shaped object in the tree, which the required field makes incomplete
- Test: `server/test/roster.test.ts` — the `hidden` trio at `:116`–`:146` is the template

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export const POOL_NAME_RE: RegExp` — the literal `/^[a-z][a-z0-9-]{0,31}$/`. Exported (unlike `ID_RE`, which is module-private) because it has three readers outside this file.
  - `AccountDef.pool: string | null` — required on the type, `null` = untagged.
  - `parseRoster` throws `RosterError` for a present-and-invalid `pool`, with `remedy` naming `~/.ccrc/accounts.json` and the grammar.

**Spec:** §5.3 (account side, the `~/.ccrc/accounts.json` paragraph), §8 (L0 imports nothing).

**Mutation table:** row 1 — "`parseRoster` refuses invalid `pool`", goes red when the throw or the `POOL_NAME_RE.test` is deleted. The `it.each` refusal block below is measured against exactly that mutation in Step 7.

Anchor quotes, so the sites are findable even if the numbers drift. `shared/roster.ts:214`–`:217`:

```ts
 * has no room for anything else, including whitespace. Capped at 32
 * characters (one leading letter plus up to 31 more).
 */
const ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
```

`shared/roster.ts:238`–`:240`:

```ts
const ACCOUNT_KEYS: ReadonlySet<string> = new Set(
  ['id', 'label', 'configDirSuffix', 'exec', 'homeAble', 'hue', 'telemetry', 'hidden'],
);
```

`shared/roster.ts:457`, `:484`:

```ts
  const hidden = hiddenRaw === true;
...
  return { id, label, configDirSuffix, exec, homeAble, telemetry, hue, hidden };
```

- [ ] **Step 1: Write the failing tests**

In `server/test/roster.test.ts`, change the import on line 2 to pull in the regex:

```ts
import { parseRoster, RosterError, POOL_NAME_RE } from '../../shared/roster.js';
```

and add this block immediately after the `hidden` trio (after the "refuses a non-boolean hidden…" test that ends at `:146`, before the "warns but does not fail on an unknown field" test):

```ts
  // `pool` — the operator's optional grouping of accounts, and the account half
  // of the rule an account may serve a project by (design §5.2). OPTIONAL in
  // the FILE like `hidden`, and `null` on the type: absence is how the roster
  // says "untagged", which is what every roster written before this field
  // existed says, so nothing on a live box changes on the day it ships.
  it('parses a pool tag, and answers null for an account carrying none', () => {
    const r = parseRoster({ version: 1, accounts: [
      { id: 'claude', label: 'claude', configDirSuffix: '.claude', exec: { kind: 'upstream' },
        homeAble: true, hue: 'cyan', telemetry: 'anthropic', pool: 'pool-a' },
      { id: 'work', label: 'work', configDirSuffix: '.work', exec: { kind: 'generated' },
        homeAble: true, hue: 'green', telemetry: 'anthropic' },
    ] });
    expect(r.byId.get('claude')!.pool).toBe('pool-a');
    expect(r.byId.get('work')!.pool).toBeNull();
  });

  // Five refusals, one per way a hand-edited roster gets this wrong. A written
  // `null` is in the list ON PURPOSE and is NOT the same as an absent key:
  // absence is the file saying "untagged", a written `null` is a half-finished
  // edit, and folding the two would be this parser narrowing a distinction it
  // received. Every remedy names the file and the grammar, because nobody
  // reading a boot refusal at 2am has this regex memorised.
  it.each([
    ['an empty pool name', ''],
    ['an explicit null pool — absence is untagged, a written null is a half-edit', null],
    ['a non-string pool', 7],
    ['a pool name with an uppercase letter', 'Corp'],
    ['a pool name containing a space', 'a b'],
  ])('refuses %s, naming the file and the fix', (_name, pool) => {
    const bad = { version: 1, accounts: [
      { id: 'claude', label: 'claude', configDirSuffix: '.claude', exec: { kind: 'upstream' },
        homeAble: true, hue: 'cyan', telemetry: 'anthropic', pool },
    ] };
    expect(() => parseRoster(bad)).toThrow(RosterError);
    try {
      parseRoster(bad);
    } catch (e) {
      expect((e as RosterError).message).toMatch(/invalid pool/i);
      expect((e as RosterError).remedy).toContain('~/.ccrc/accounts.json');
      expect((e as RosterError).remedy).toContain('^[a-z][a-z0-9-]{0,31}$');
    }
  });

  // `pool` in ACCOUNT_KEYS is what stops `warnUnknownKeys` printing "unknown
  // field" for a roster this parser now fully understands. A warning on a legal
  // field trains the operator to ignore the one diagnostic that catches a real
  // typo — `secretFile` for `secretsFile`, the case that docstring names.
  it('does not warn about the pool key it now understands', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      parseRoster({ version: 1, accounts: [
        { id: 'claude', label: 'claude', configDirSuffix: '.claude', exec: { kind: 'upstream' },
          homeAble: true, hue: 'cyan', telemetry: 'anthropic', pool: 'pool-b' },
      ] });
      expect(warn.mock.calls.some(([m]) => typeof m === 'string' && m.includes('"pool"'))).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });

  // The grammar is ID_RE's, deliberately, and the boundary is worth pinning
  // rather than trusting to a shared regex source: `ccd` carries a hand-typed
  // bash copy of this literal (wave 2a), and a drift in the CAP is the drift a
  // "same shape" comment would never catch.
  it('accepts the full 32-character grammar and refuses what falls outside it', () => {
    const longest = `a${'b'.repeat(31)}`;
    expect(longest.length).toBe(32);
    expect(POOL_NAME_RE.test(longest)).toBe(true);
    expect(POOL_NAME_RE.test(`${longest}b`)).toBe(false);
    expect(POOL_NAME_RE.test('1pool')).toBe(false);
    expect(POOL_NAME_RE.test('-pool')).toBe(false);
    expect(POOL_NAME_RE.test('pool_a')).toBe(false);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/roster.test.ts`

Expected: FAIL — the whole file fails to load, because `POOL_NAME_RE` is not exported yet:
`SyntaxError: The requested module '/…/shared/roster.ts' does not provide an export named 'POOL_NAME_RE'`.

- [ ] **Step 3: Add the grammar**

In `shared/roster.ts`, immediately after `const ID_RE = …` (`:217`) and before the `LABEL_UNSAFE_RE` docstring:

```ts
/**
 * The pool-name charset — deliberately `ID_RE`'s exact shape, and for `ID_RE`'s
 * exact reason. A pool name is embedded UNQUOTED in a generated bash `case` arm
 * (`_ccrc_pool`, `shared/generate.mjs`) and printed with `echo`: a leading
 * lowercase LETTER is what makes that `echo` safe, since bash's builtin
 * swallows a first argument made entirely of `-` followed by `n`/`e`/`E` and
 * prints nothing — the failure `generate.mjs` already documents for labels.
 * `[a-z0-9-]` then leaves no room for whitespace, which `ccd` would word-split
 * when it reads the value back through an unquoted `$( … )`.
 *
 * EXPORTED, unlike `ID_RE`, because it has three readers outside this file: the
 * bare-`node` mirror (`shared/roster-json.mjs`) copies the literal, the
 * project-pool route validates a request body against this object, and `ccd`'s
 * own `POOL_NAME_RE=` bash literal is pinned equal to `POOL_NAME_RE.source` by
 * text extraction. One grammar, one definition, three readers.
 */
export const POOL_NAME_RE = /^[a-z][a-z0-9-]{0,31}$/;
```

- [ ] **Step 4: Add the field, the key, and the parse**

In `AccountDef`, after `hidden: boolean;` (`:110`):

```ts
  /** The operator's optional grouping of accounts — a billing or tenancy pool.
   *  An account may serve a project when either side is untagged or the two
   *  names agree; `shared/poolrule.ts` is the one place that rule is spelled in
   *  TypeScript, and `ccd`'s `_pool_ok` is the one place it is spelled in bash.
   *
   *  REQUIRED on the type, with `null` as the untagged answer, so every
   *  constructor of an `AccountDef` has to say which it means. The field is
   *  OPTIONAL in the file, and `null` is what absence parses to — but an
   *  explicit `"pool": null` in the JSON is REFUSED rather than folded into
   *  absence. The two are different situations with different remedies: absence
   *  is the file saying "untagged", a written `null` is an edit someone did not
   *  finish, and answering "untagged" for it would be this parser narrowing a
   *  distinction it received. */
  pool: string | null;
```

In `ACCOUNT_KEYS` (`:238`–`:240`):

```ts
const ACCOUNT_KEYS: ReadonlySet<string> = new Set(
  ['id', 'label', 'configDirSuffix', 'exec', 'homeAble', 'hue', 'telemetry', 'hidden', 'pool'],
);
```

In `parseAccount`, immediately after `const hidden = hiddenRaw === true;` (`:457`) and before the blank line preceding `const telemetry = …`:

```ts
  // OPTIONAL in the file like `hidden` above, and refused rather than coerced
  // when it is present and wrong — a literal `null` included. `typeof null ===
  // 'object'`, so the `!== undefined` guard admits `null` to the check on
  // purpose: see `AccountDef.pool` for why absence and a written `null` are not
  // the same fact. The grammar is `POOL_NAME_RE`, which is `ID_RE`'s, because
  // the value ends up in the same two places an id does — a bash `case` arm and
  // an `echo`.
  const poolRaw = raw['pool'];
  if (poolRaw !== undefined && (typeof poolRaw !== 'string' || !POOL_NAME_RE.test(poolRaw))) {
    throw new RosterError(
      `account "${id}" has an invalid pool ${JSON.stringify(poolRaw)}: a pool name must start ` +
        'with a lowercase letter and contain only lowercase letters, digits and hyphens ' +
        '(max 32 characters).',
      `Set "pool" for account "${id}" in ${ROSTER_PATH} to a name matching ` +
        '^[a-z][a-z0-9-]{0,31}$, or remove the key entirely to leave the account untagged.',
    );
  }
  const pool = poolRaw === undefined ? null : poolRaw;
```

And the return at `:484`:

```ts
  return { id, label, configDirSuffix, exec, homeAble, telemetry, hue, hidden, pool };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd server && ./node_modules/.bin/vitest run test/roster.test.ts`

Expected: PASS, all tests in the file.

- [ ] **Step 6: Run the typechecker — the required field has made the tree's one hand-built `Roster` incomplete**

Run: `cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts`

Expected: FAIL on the first assertion (`server/test/ is clean under a tests-inclusive project`) with

```
test/roster-generate.test.ts(111,…): error TS2345: Argument of type '{ version: 1; accounts: { … }[]; … }' is not assignable to parameter of type 'Roster'.
  … Types of property 'accounts' are incompatible …
  Property 'pool' is missing in type '{ id: string; label: string; configDirSuffix: string; exec: { kind: "upstream"; }; homeAble: boolean; hue: "cyan"; telemetry: "anthropic"; hidden: false; }' but required in type 'AccountDef'.

(Shape, not a transcript: the real diagnostic interposes two more `Type '…' is not assignable` lines
and its column is not 38. Match on the file, the code `TS2345` and the `Property 'pool' is missing`
line — not on the column or the exact line count.)
```

This is the point of making the field required rather than optional: `generateAccountsSh` consumes a `Roster` STRUCTURALLY with no runtime check that its argument ever passed through `parseRoster`, and `shared/generate.d.mts` is what makes the compiler the check instead. The hostile-payload fixture is the only object in the tree that builds one by hand.

- [ ] **Step 7: Close it, and measure the guard**

In `server/test/roster-generate.test.ts`, `hostileAccount` (`:98`–`:102`) becomes:

```ts
    const hostileAccount = {
      id: 'hostile', label: 'Hostile', configDirSuffix: hostileSuffix,
      exec: { kind: 'upstream' as const }, homeAble: true,
      hue: 'cyan' as const, telemetry: 'anthropic' as const, hidden: false,
      // Required on `AccountDef` — this object is deliberately built by hand
      // rather than parsed, so the compiler is the only thing that can ask it
      // for every field. Untagged: this case is about `dqEscape`, not pools.
      pool: null,
    };
```

Then measure the mutation the row-1 guard exists for. Temporarily delete the `!POOL_NAME_RE.test(poolRaw)` disjunct from `parseAccount` (leaving only the `typeof` test) and run:

Run: `cd server && ./node_modules/.bin/vitest run test/roster.test.ts`
Expected: FAIL — 3 of the 5 `it.each` refusal rows (`''`, `'Corp'` and `'a b'`) now parse instead of throwing:
`AssertionError: expected [Function] to throw RosterError`. The other two (`null`, `7`) are still caught by the surviving `typeof` test, which is exactly why the grammar needs its own row rather than sharing one.

Restore the disjunct, then delete the whole `if (poolRaw !== undefined && …) { throw … }` block and re-run:
Expected: FAIL — all 5 refusal rows.

Restore the block.

- [ ] **Step 8: Run both suites to verify they pass**

Run: `cd server && ./node_modules/.bin/vitest run test/roster.test.ts test/roster-generate.test.ts test/typecheck-tests.test.ts`

Expected: PASS. (`typecheck-tests` is on the known-load-flake list; if it reds on a timeout rather than a `TS` code, re-run it alone before treating it as a break.)

> **Revised after this task landed.** Fix round 1 of Task 2 hedged the `POOL_NAME_RE` docstring's
> `ccd` sentence — `ccd` *will* carry a bash literal, pinned *once* wave 2a's parity scan lands — because
> the present-tense form asserted a mechanism that does not exist until wave 2a. The shipped
> `shared/roster.ts` is authoritative over the paste in Step 3 above.

- [ ] **Step 9: Commit**

```bash
git add shared/roster.ts server/test/roster.test.ts server/test/roster-generate.test.ts
git commit -m "feat(roster): an account carries an optional pool name, refused rather than coerced"
```

---

### Task 2: The bare-`node` mirror learns `pool`, and stops being laxer than it promised

**Files:**
- Modify: `shared/roster-json.mjs` — the header's "stricter, never laxer" paragraph (`:49`–`:54`); a `POOL_NAME_RE` mirror after `LABEL_UNSAFE_RE` (`:96`–`:99`); two new checks in `checkAccount` between the `homeAble` gate (`:192`–`:196`) and the `telemetry` gate (`:198`); the return (`:222`–`:225`)
- Modify: `shared/roster-json.d.mts` — `RosterJsonAccount` (`:11`–`:22`)
- Test: `server/test/gen-accounts.test.ts` — the `CASES` REJECT table (`:222`–`:277`)

**Interfaces:**
- Consumes: `POOL_NAME_RE`'s grammar from Task 1 (copied as a literal, not imported — a bare `node` cannot import TypeScript). **What pins THIS copy is behaviour, not text** (D-1742): wave 2a's text-extraction parity test reads `ccd/ccd` and `ccrc-doctor-checks`, never a `.mjs`, and `single-definition.test.ts` filters `/\.tsx?$/`, so it cannot see this file either. The mechanism is the REJECT table in this task's own suite, which drives the same malformed pool names through both sides — which is why the table gains an over-the-cap row here as well as the five grammar rows.
- Produces: `checkAccount` returns `pool: string | null` on every account, which `generateAccountsSh` reads in Task 3. `checkAccount` also VALIDATES `hidden` without returning it — the emitter has no use for the value, and the file's own contract is "reject anything the SERVER would reject", not "reject anything the generator would trip over".

**Spec:** §5.3 (the `shared/roster-json.mjs` paragraph), §3.4, §12 P-1 (D-1663).

**Mutation table:** row 2 — "`roster-json.mjs` mirrors `pool` and `hidden`", goes red when either `bad()` is deleted. The `hidden: 'false'` row is measured RED on the pre-change tree in Step 2, which is D-1663's measurement and the whole reason this row is in the table.

`LEDGER:` `shared/roster-json.mjs`'s header promised, in its own words, to be "STRICTER than `parseRoster`, never laxer" — and had never learned `hidden`. It accepted `hidden: "false"`, a truthy string that removes an account from every surface that lists one, while `loadConfig` refuses to boot on the same bytes: a crash-looping `ccrc.service` behind a green deploy, which is exactly the outcome that paragraph says cannot happen. Closed here in the same act that adds `pool`, and the closure is measured — the `gen-accounts.test.ts` REJECT row for it was red on the tree before the check landed. (D-1663 — spec §12 P-1)

Anchor quotes. `shared/roster-json.mjs:96`–`:99`:

```js
/** Mirrors `shared/roster.ts`'s `LABEL_UNSAFE_RE` — C0 controls plus DEL.
 *  A label reaches a one-line terminal status bar and the tmux-capture
 *  parser that reads it back; a control byte breaks both. */
const LABEL_UNSAFE_RE = /[\u0000-\u001f\u007f]/;   // <- the literal in the file; escapes shown, not the raw bytes
```

`shared/roster-json.mjs:192`–`:202`:

```js
  const homeAble = raw['homeAble'];
  if (typeof homeAble !== 'boolean') {
    bad(`account "${id}" has a non-boolean homeAble.`,
      `Set "homeAble" to true or false for account "${id}".`);
  }

  const telemetry = raw['telemetry'];
  if (telemetry !== 'anthropic' && telemetry !== 'none') {
    bad(`account "${id}" has an invalid telemetry ${JSON.stringify(telemetry)}.`,
      `Set "telemetry" for account "${id}" to "anthropic" or "none".`);
  }
```

- [ ] **Step 1: Write the failing tests**

In `server/test/gen-accounts.test.ts`, add SEVEN rows to the `CASES` array (declared at `:222`, ending with `'two upstream accounts'` at `:276`) — the six this task first drafted, plus the over-the-cap row D-1742 adds. Put them immediately after the `['a non-boolean homeAble', roster(acct({ homeAble: 'yes' }))],` row:

```ts
    // D-1663 (spec §12 P-1), closed in this task. This file's whole argument is the REJECT
    // direction — "a roster the CLI accepted and the server rejected would
    // deploy a box whose `ccd` works and whose `ccrc.service` crash-loops every
    // three seconds behind a green deploy" — and `hidden` was that roster. The
    // validator never learned the field, so `"false"` (a truthy string that
    // erases an account from every surface listing one) sailed through here and
    // died at `loadConfig`. This row was RED on the tree before the mirror
    // learned the field; that measurement is what makes it a mechanism.
    ['a non-boolean hidden — a truthy string that would erase an account', roster(acct({ hidden: 'false' }))],
    // `pool` is embedded UNQUOTED in a generated bash `case` arm and printed
    // with `echo`, so its grammar is `ID_RE`'s and every way out of it is
    // refused on both sides.
    ['a pool name with an uppercase letter', roster(acct({ pool: 'Corp' }))],
    ['an empty pool name', roster(acct({ pool: '' }))],
    ['a non-string pool', roster(acct({ pool: 7 }))],
    ['a pool name carrying a shell metacharacter', roster(acct({ pool: 'a$(id)' }))],
    ['an explicit null pool — absence means untagged, a written null is a half-edit', roster(acct({ pool: null }))],
    // The CAP, measured rather than assumed (D-1742). No text scan
    // reads a `.mjs`, so this table is the only thing holding the two copies of the
    // grammar equal, and a cap that drifted — `{0,31}` against `{0,63}` — is the one
    // drift every other row in this block survives: 33 lowercase letters are legal
    // under both spellings of the charset and illegal under only one of the lengths.
    ['a pool name one character past the 32-character cap', roster(acct({ pool: 'a'.repeat(33) }))],
```

- [ ] **Step 2: Run the tests to verify they fail — and record which half fails**

Run: `cd server && ./node_modules/.bin/vitest run test/gen-accounts.test.ts`

Expected: PASS for all seven rows in the first `it.each` (`… — parseRoster throws on it`) — Task 1 already made the six `pool` rows throw (the over-cap name is refused by `POOL_NAME_RE`'s `{0,31}` bound), and `hidden: 'false'` has thrown since `hidden` existed.

Expected: FAIL for all seven rows in the second `it.each` (`… — the CLI exits nonzero and writes NO bash`):

```
AssertionError: a roster the server refuses to boot on must fail the deploy, not generate a file
  expected 0 not to be 0
```

The `hidden` row failing here **on a tree this task has not yet touched** is D-1663's measurement. Record the run.

- [ ] **Step 3: Mirror the grammar**

In `shared/roster-json.mjs`, after `LABEL_UNSAFE_RE` (`:99`):

```js
/** Mirrors `shared/roster.ts`'s exported `POOL_NAME_RE`. Kept here as a literal
 *  rather than imported for this file's standing reason: a bare `node` cannot
 *  import the TypeScript. `ccd` carries a third copy in bash.
 *
 *  WHAT HOLDS THE THREE EQUAL IS NOT THE SAME MECHANISM IN EACH CASE, and saying
 *  so matters more than the tidy sentence this comment used to carry
 *  (D-1742). `ccd`'s bash literal is pinned against
 *  `POOL_NAME_RE.source` by TEXT EXTRACTION — a scan that reads the bash file.
 *  THIS copy is pinned by BEHAVIOUR instead: no text scan reads a `.mjs`
 *  (`single-definition.test.ts` filters `/\.tsx?$/`, and wave 2a's parity test
 *  reads `ccd/ccd` and `ccrc-doctor-checks`), so what measures the agreement is
 *  `server/test/gen-accounts.test.ts`'s REJECT table, which drives the same
 *  malformed pool names — empty, uppercase, non-string, shell metacharacter,
 *  written `null`, and one character past the cap — through the CLI and the
 *  parser and requires both to refuse. A grammar drift big enough to matter
 *  reds a row there. Read that table; it is the census. */
const POOL_NAME_RE = /^[a-z][a-z0-9-]{0,31}$/;
```

- [ ] **Step 4: Add the two checks and return `pool`**

In `checkAccount`, between the `homeAble` gate (ending `:196`) and the `telemetry` gate (`:198`):

```js
  // Mirrors `parseRoster`'s `hidden` gate — the one this file never had (spec
  // §12 P-1, D-1663). The field is OPTIONAL, so absence is legal; a PRESENT non-boolean
  // is not. `"false"` is a truthy string, and truthiness on this field removes
  // an account from every surface that lists one, which the server refuses at
  // boot while this validator waved it through.
  const hidden = raw['hidden'];
  if (hidden !== undefined && typeof hidden !== 'boolean') {
    bad(`account "${id}" has a non-boolean hidden.`,
      `Set "hidden" to true or false for account "${id}", or remove the key.`);
  }

  // Mirrors `parseRoster`'s `pool` gate, including its refusal of an explicit
  // `null`: absence is the file saying "untagged", a written `null` is a
  // half-finished edit, and this file may not be laxer than the parser about
  // which one it is looking at.
  const pool = raw['pool'];
  if (pool !== undefined && (typeof pool !== 'string' || !POOL_NAME_RE.test(pool))) {
    bad(`account "${id}" has an invalid pool ${JSON.stringify(pool)}.`,
      `Set "pool" for account "${id}" to a name matching ^[a-z][a-z0-9-]{0,31}$ — lowercase `
      + 'letters, digits and hyphens only — or remove the key to leave the account untagged.');
  }
```

And the return (`:222`–`:225`) becomes:

```js
  // `hidden` is checked above and deliberately NOT returned: the emitter has no
  // use for it (it stays outside `accounts.sh`, so outside `bodyDigest` and
  // outside `rosterAgreement`'s reach — the doctor's D-72 note is where that
  // asymmetry is explained). `pool` IS returned, because `_ccrc_pool` is
  // generated from it — which is the whole reason the field is emitted at all:
  // a roster field that never reaches `accounts.sh` is a field whose cross-box
  // drift nobody can see.
  return {
    id, label, configDirSuffix: suffix, homeAble, telemetry, hue,
    execKind: exec['kind'], secretsFile: exec['secretsFile'],
    pool: pool === undefined ? null : pool,
  };
```

- [ ] **Step 5: Make the header's claim true**

Replace the paragraph at `shared/roster-json.mjs:49`–`:54` with:

```js
// The asymmetry that agreement permits, stated on purpose: this file may be
// STRICTER than `parseRoster`, never laxer. A roster it wrongly rejects fails
// a deploy loudly, with the offending field named; a roster it wrongly
// accepts ships a box that cannot boot. Unknown FIELDS are the one thing it
// does not check at all — `parseRoster` only warns about those and never
// throws, so ignoring them cannot make this file laxer than the parser.
//
// THAT WAS AN ASPIRATION, NOT A MEASURED FACT, for as long as `hidden`
// existed. This file never learned the field, so it accepted `hidden:
// "false"` — a truthy string that removes an account from every surface that
// lists one — while `loadConfig` refused to boot on the same bytes. A
// crash-looping `ccrc.service` behind a green deploy is precisely the outcome
// the paragraph above says cannot happen, and it stood for as long as the
// claim did. The gap closed in the same act that added `pool`, and it closed
// as a MECHANISM: `server/test/gen-accounts.test.ts`'s REJECT table now
// carries a `hidden: "false"` row, measured red on the tree before this check
// landed. Read that table, not this paragraph — it is the census of what the
// two sides agree to refuse, and it is the thing that goes red when they stop
// agreeing.
```

- [ ] **Step 6: Type the new field**

In `shared/roster-json.d.mts`, add to `RosterJsonAccount` after `hue: Hue;` (`:17`):

```ts
  /** The account's pool, or `null` for untagged — `AccountDef.pool`
   *  (`shared/roster.ts`) one-for-one, including that a JSON `null` is
   *  REFUSED and only an absent key produces this `null`. Returned rather
   *  than merely validated because `generateAccountsSh` emits it into
   *  `_ccrc_pool`. `hidden` is validated by `checkAccount` and NOT returned:
   *  nothing downstream of this type reads it. */
  pool: string | null;
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd server && ./node_modules/.bin/vitest run test/gen-accounts.test.ts`

Expected: PASS, both `it.each` blocks over all rows.

- [ ] **Step 8: Measure the mutation**

Delete the `hidden` `bad()` block from `checkAccount` and run:
Run: `cd server && ./node_modules/.bin/vitest run test/gen-accounts.test.ts`
Expected: FAIL — `a non-boolean hidden … — the CLI exits nonzero and writes NO bash`, `expected 0 not to be 0`.

Restore it, delete the `pool` `bad()` block, re-run:
Expected: FAIL — all NINE `pool` rows of the second `it.each`.

**And note what this mutation does NOT measure** (D-1742, fix round 1). Deleting the
gate means the mirrored `POOL_NAME_RE` is never consulted at all, so every pool row reds whatever the
literal reads — this mutation proves the GATE rejects those shapes, and nothing about the literal. The
plan first wrote a conditional here ("if the over-cap row alone stays green…") naming an outcome its
own mutation cannot produce. The measurement that actually pins the mirrored literal is a different
one, and it is the one to run: **drift the literal, one character at a time, and confirm exactly the
rows that name that drift go red.** Measured in fix round 1, each restored between:

| drift of `shared/roster-json.mjs`'s literal | reds, and nothing else |
|---|---|
| `/^[a-z0-9-][a-z0-9-]{0,31}$/` — leading-letter anchor lost | `-pool`, `1pool` |
| `/^[a-z][a-z0-9_-]{0,31}$/` — underscore admitted | `pool_a` |
| `/^[a-z][a-z0-9-]{0,63}$/` — cap widened | the over-cap row |

Every one of those drifts makes this file LAXER than `parseRoster`, which is the single direction its
header forbids — which is why the census is behavioural rows and not a comment.

Restore it.

> **Revised after this task landed.** Fix round 1 added three more REJECT rows (`-pool`, `1pool`,
> `pool_a`), hedged the `ccd` sentences, and narrowed "no text scan reads a `.mjs`" to "no text scan
> pins a regex literal in a `.mjs`" — `source-bytes.test.ts` does read this file, for bytes rather than
> for grammar. The shipped `shared/roster-json.mjs` and `server/test/gen-accounts.test.ts` are
> authoritative over the pastes above.

- [ ] **Step 9: Commit**

```bash
git add shared/roster-json.mjs shared/roster-json.d.mts server/test/gen-accounts.test.ts
git commit -m "fix(roster-json): the bare-node validator mirrors pool, and closes the hidden gap its own header denied"
```

---

### Task 3: `accounts.sh` answers an account's pool

**Files:**
- Create: `server/test/fixtures/poolRule.ts` — `POOLED_TEST_ROSTER` only in this task; Task 5 appends the truth table to the same file
- Modify: `shared/generate.mjs` — a new `poolArms` beside `hueArms` (`:202`–`:204`), a new emission after `_ccrc_hue()` (`:233`–`:237`), and a docstring section beside the `_ccrc_dir_id`/`_ccrc_label`/`_ccrc_hue` one (`:129`)
- Test: `server/test/roster-generate.test.ts` (a new `describe`), `server/test/gen-accounts.test.ts` (one ACCEPT row)

**Interfaces:**
- Consumes: `AccountDef.pool` (Task 1); `RosterJsonAccount.pool` (Task 2) — the CLI path reads the mirror's value, the TypeScript path reads the parser's, and the ACCEPT row is what proves the two produce identical bytes.
- Produces:
  - In the generated `~/.ccrc/accounts.sh`, after `_ccrc_hue()`:
    ```bash
    _ccrc_pool() {
      case "$1" in
        <id>) echo <pool> ;;    # one arm per TAGGED account, byIdLengthDesc order
      esac
    }
    ```
    Contract: **empty stdout at rc 0** for an untagged id AND for an unknown one. Defined even with zero arms.
  - `export const POOLED_TEST_ROSTER` (`server/test/fixtures/poolRule.ts`) — `DEFAULT_TEST_ROSTER` with `claude`→`pool-a`, `claude-a`→`pool-a`, `claude-b`→`pool-b`, and `gpt`/`claude-d` untagged.

**Spec:** §5.3 (the `~/.ccrc/accounts.sh` paragraph), §6 (the `_ccrc_pool` → `_acct_pool` seam row).

**Mutation table:**
- row 3 — "`_ccrc_pool` emitted, arms for tagged only, always defined", goes red when the emission is removed, made conditional, or an untagged account gets an arm.
- row 4 — "CLI and TS generator agree byte-for-byte with pools", goes red when `roster-json.mjs` stops returning `pool`.

Anchor quotes. `shared/generate.mjs:202`–`:204` and `:233`–`:238`:

```js
  const hueArms = roster.accounts
    .map((a) => `    ${a.id}) echo ${a.hue} ;;`)
    .join('\n');
...
_ccrc_hue() {
  case "$1" in
${hueArms}
  esac
}
`;
```

- [ ] **Step 1: Create the pooled fixture roster**

Create `server/test/fixtures/poolRule.ts`:

```ts
// The pool fixtures every language's copy of the pool machinery is driven
// through. Two exports with two different jobs, in one file because they are
// one subject:
//
//  - `POOLED_TEST_ROSTER` — `DEFAULT_TEST_ROSTER` with pool tags, DERIVED from
//    it rather than retyped, so an account added to or renamed in the root test
//    roster cannot leave a stale copy here. `server/test/helpers.ts`'s docstring
//    states the rule this obeys: that roster is ROOT, and the only other copies
//    are derived from it.
//  - `POOL_RULE_CASES` (added by wave 1's Task 5) — the truth table of the rule
//    itself.
//
// Pool names here are `pool-a` / `pool-b` / `pool-ab`, and account ids are the
// test roster's. No operator's real pool name, account name or label appears in
// this repository at all (spec §8, "Single definition"); `topology-clean.test.ts`
// is what keeps that true.
import { DEFAULT_TEST_ROSTER } from '../helpers.js';

/** Which fixture accounts carry a tag. Two accounts share `pool-a` on purpose —
 *  a pool of one cannot tell "the rule picked the in-pool account" from "the
 *  rule picked the only account left". `gpt` and `claude-d` are absent from this
 *  map, so they stay untagged, which is the state every account on a live box is
 *  in on the day pools ship. */
const POOL_BY_ID: Readonly<Record<string, string | undefined>> = {
  claude: 'pool-a',
  'claude-a': 'pool-a',
  'claude-b': 'pool-b',
};

/**
 * `DEFAULT_TEST_ROSTER`, tagged. Raw JSON shape, not a parsed `Roster`: it is
 * fed to `parseRoster`, `seedRoster` and `seedAccountsSh`, all of which take
 * `unknown` and do their own parsing, so this is the same kind of value the
 * roster on disk is.
 *
 * An untagged account gets NO `pool` KEY, rather than `pool: null` — the parser
 * refuses a written `null` (`AccountDef.pool`), and a fixture that could not be
 * written by hand into `~/.ccrc/accounts.json` is not a fixture of anything.
 */
export const POOLED_TEST_ROSTER = {
  ...DEFAULT_TEST_ROSTER,
  accounts: DEFAULT_TEST_ROSTER.accounts.map((a) => {
    const pool = POOL_BY_ID[a.id];
    return pool === undefined ? { ...a } : { ...a, pool };
  }),
};
```

- [ ] **Step 2: Write the failing tests**

In `server/test/roster-generate.test.ts`, append a new `describe` at the end of the file (after the statusline-projection describe, which closes at `:196`):

```ts
// The account half of project pools. `_ccrc_pool` is the ONE thing on the
// account side that crosses into bash, and it is emitted rather than
// hand-written for the reason the whole of this file exists: a hand-kept `case`
// is a roster copy, and a roster copy is a silently unplaced account.
describe('generateAccountsSh — the pool projection', () => {
  // Some accounts tagged, some not — the only shape that can tell "one arm per
  // TAGGED account" from "one arm per account".
  const pooledRoster = parseRoster({ version: 1, accounts: [
    { id: 'a', label: 'A', configDirSuffix: '.a', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic', pool: 'pool-a' },
    { id: 'a-b-c', label: 'ABC', configDirSuffix: '.abc', exec: { kind: 'generated' }, homeAble: true, hue: 'violet', telemetry: 'anthropic', pool: 'pool-b' },
    { id: 'a-b', label: 'AB', configDirSuffix: '.ab', exec: { kind: 'external' }, homeAble: false, hue: 'blue', telemetry: 'none' },
  ] });

  const pooledHome = mkTmp('roster-gen-pool-');
  mkdirSync(path.join(pooledHome, '.ccrc'), { recursive: true });
  writeFileSync(path.join(pooledHome, '.ccrc', 'accounts.sh'), generateAccountsSh(pooledRoster));

  // The module-level `roster` (a, a-b-c, a-b) carries no pool at all — every
  // roster on every box, the day this ships.
  const untaggedHome = mkTmp('roster-gen-untagged-pool-');
  mkdirSync(path.join(untaggedHome, '.ccrc'), { recursive: true });
  writeFileSync(path.join(untaggedHome, '.ccrc', 'accounts.sh'), generateAccountsSh(roster));

  it('is defined even when NO account is tagged, so `declare -F` is a version probe', () => {
    // Two independent things depend on the unconditional emission: ccd asks
    // `declare -F _ccrc_pool` to learn whether this box's accounts.sh knows
    // about pools at all, and a new ccd calls the function every 5 seconds — a
    // conditional emission would be `command not found` on the supervisor's hot
    // loop, on every box whose roster has no tags yet.
    expect(sh(untaggedHome, 'declare -F _ccrc_pool >/dev/null && echo yes')).toBe('yes');
    expect(sh(untaggedHome, "_ccrc_pool 'a' ; echo \"rc=$?\"")).toBe('rc=0');
  });

  it('emits an EMPTY case for an all-untagged roster, not a missing function and not a default arm', () => {
    const body = generateAccountsSh(roster);
    expect(body).toContain('_ccrc_pool() {');
    const block = body.slice(body.indexOf('_ccrc_pool() {'));
    expect(block.slice(0, block.indexOf('esac'))).not.toMatch(/\) echo /);
  });

  it('answers the pool name for a tagged account', () => {
    expect(sh(pooledHome, "_ccrc_pool 'a'")).toBe('pool-a');
    expect(sh(pooledHome, "_ccrc_pool 'a-b-c'")).toBe('pool-b');
  });

  it('answers empty at rc 0 for an untagged account AND for an unknown id — the caller decides what silence means', () => {
    // `_ccrc_cfg_dir`'s contract, restated: the two silences are deliberately
    // one value here, and that fold is safe only because `_is_valid_wrapper`
    // gates every id before any pool question is asked (design §6).
    expect(sh(pooledHome, "_ccrc_pool 'a-b' ; echo \"rc=$?\"")).toBe('rc=0');
    expect(sh(pooledHome, "_ccrc_pool 'nosuch' ; echo \"rc=$?\"")).toBe('rc=0');
  });

  it('emits one arm per TAGGED account only, in byIdLengthDesc order', () => {
    const body = generateAccountsSh(pooledRoster);
    const block = body.slice(body.indexOf('_ccrc_pool() {'));
    const arms = [...block.slice(0, block.indexOf('esac'))
      .matchAll(/^ {4}([a-z0-9-]+)\) echo ([a-z0-9-]+) ;;$/gm)].map((m) => [m[1]!, m[2]!]);
    // `a-b` is untagged and has NO arm; the two that remain are longest-first.
    expect(arms).toEqual([['a-b-c', 'pool-b'], ['a', 'pool-a']]);
  });

  it('sits after _ccrc_hue, where the roster projection ends', () => {
    const body = generateAccountsSh(pooledRoster);
    expect(body.indexOf('_ccrc_pool() {')).toBeGreaterThan(body.indexOf('_ccrc_hue() {'));
  });
});
```

In `server/test/gen-accounts.test.ts`, add the import

```ts
import { POOLED_TEST_ROSTER } from './fixtures/poolRule.js';
```

beside the existing `import { DEFAULT_TEST_ROSTER } from './helpers.js';` (`:41`), and add one row to the ACCEPT `it.each` (`:164`–`:171`), after the `DEFAULT_TEST_ROSTER` row:

```ts
    ['the test default roster with pool tags on some accounts', POOLED_TEST_ROSTER],
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/roster-generate.test.ts test/gen-accounts.test.ts`

Expected: FAIL.
- `roster-generate.test.ts` — all six new cases go red, split **two throwing, four asserting**
  (measured; an earlier draft of this paragraph said three and three).

  **THROWING**, because the bash child exits nonzero and `sh()` propagates that as
  `Command failed: bash -c …` before any assertion runs — `is defined even when NO account is tagged`
  (`declare -F _ccrc_pool` returns 1 on an undefined function, so the `&&` short-circuits and bash
  exits 1) and `answers the pool name for a tagged account` (a bare `_ccrc_pool 'a'` is
  `command not found`, exit 127).

  **ASSERTING** — `emits an EMPTY case…` (`expected '…' to contain '_ccrc_pool() {'`),
  `emits one arm per TAGGED account only…` (`arms` is `[]` against a two-row expectation),
  `sits after _ccrc_hue` (`indexOf` returns `-1`), and — the one worth understanding —
  `answers empty at rc 0 for an untagged account AND for an unknown id`, which compares
  `'rc=127'` against `'rc=0'` rather than throwing. Its snippet sequences with `;`, not `&&`, so the
  missing function's 127 is captured by `$?` and printed, and the LAST command in the child is the
  `echo` — which succeeds. `bash -c` therefore exits 0 and `sh()` never throws. That is the same
  property the test relies on in the GREEN state, where it is what lets an rc be asserted at all;
  worth knowing before reading any `; echo "rc=$?"` snippet in this file as a throw.
- `gen-accounts.test.ts` — the new ACCEPT row PASSES (both sides currently ignore `pool`, so both emit identical pool-free bash). That is expected: it becomes load-bearing at Step 4, and is measured as such in Step 6.

- [ ] **Step 4: Emit it**

In `shared/generate.mjs`, after the `hueArms` block (`:202`–`:204`):

```js
  // One arm per TAGGED account, in `byIdLengthDesc` order like `_ccrc_cfg_dir`
  // above. `typeof a.pool === 'string'` rather than a truthiness test and rather
  // than `!= null`: `generateAccountsSh` consumes a `Roster` STRUCTURALLY, with no
  // runtime check that its argument ever passed through `parseRoster` or
  // `rosterFromJson` (see the header). `!= null` would already exclude both
  // `null` and `undefined`, so that is NOT the distinction being drawn here — what
  // `typeof === 'string'` adds is refusing a non-string that reached this function
  // without being validated by either producer, which `.mjs` callers are not
  // typechecked against. `a.pool = 7` under `!= null` emits `id) echo 7 ;;`; under
  // this predicate it emits no arm. Untagged, unvalidated and junk all produce no
  // arm, which is the only answer this emitter can honestly give for a value it
  // was never allowed to see.
  const poolArms = roster.byIdLengthDesc
    .filter((a) => typeof a.pool === 'string')
    .map((a) => `    ${a.id}) echo ${a.pool} ;;`)
    .join('\n');
```

and in the returned template literal, after the `_ccrc_hue()` block and before the closing backtick:

```
_ccrc_pool() {
  case "$1" in
${poolArms}
  esac
}
```

Add this section to `generateAccountsSh`'s JSDoc, immediately after the `── `_ccrc_dir_id`, `_ccrc_label`, `_ccrc_hue`, `CCRC_MEASURED` ──` section ends (before the `@param` line at `:167`):

```
 * ── `_ccrc_pool` ──
 *
 * The account half of project pools. Emitted ALWAYS, even when no account is
 * tagged — an empty `case` — for two reasons that are not the same reason:
 * `declare -F _ccrc_pool` is how `ccd` asks whether this box's `accounts.sh`
 * knows about pools at all, and a new `ccd` calls this function on the
 * supervisor's 5-second loop, where `command not found` would be the answer on
 * every box whose roster has no tags yet. An empty `case … esac` is valid bash
 * and answers empty at rc 0, which is exactly the contract below.
 *
 * That contract is `_ccrc_cfg_dir`'s, restated: empty stdout at exit 0 for an
 * untagged id AND for an unknown one, with the caller deciding what silence
 * means. Folding those two silences together is a real fold and is disclosed
 * rather than assumed — it is safe only because `_is_valid_wrapper` gates every
 * id before a pool question is ever asked of it.
 *
 * Values are emitted RAW, like ids and hues and for the same reason:
 * `POOL_NAME_RE` (`shared/roster.ts`) is `ID_RE`'s shape, so a pool name holds
 * no whitespace and no shell metacharacter, and `echo` is safe because the name
 * must begin with a lowercase letter and so can never be `-n`/`-e`/`-E`.
 *
 * This emission is also why `pool` is in `accounts.sh` at all rather than only
 * in the JSON: `rosterAgreement` compares digests of the GENERATED file
 * (`server/src/fleetstate.ts`), so a roster field that is never emitted is a
 * field whose disagreement between the box's two hand-owned `accounts.json`
 * copies nobody can see. `hidden` is deliberately outside the digest and stays
 * there.
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd server && ./node_modules/.bin/vitest run test/roster-generate.test.ts test/gen-accounts.test.ts`

Expected: PASS. The `gen-accounts` ACCEPT rows now compare bash that CONTAINS `_ccrc_pool` arms on the pooled roster, so the CLI's `rosterFromJson` must be returning `pool` — Task 2's return is what makes this green.

- [ ] **Step 6: Measure the mutations**

Row 4 — delete `pool: pool === undefined ? null : pool,` from `checkAccount`'s return (`shared/roster-json.mjs`) and run:
Run: `cd server && ./node_modules/.bin/vitest run test/gen-accounts.test.ts`
Expected: FAIL — `the test default roster with pool tags on some accounts: stdout is byte-identical …`, a string diff whose CLI side is missing three `_ccrc_pool` arms. Restore it.

Row 3 — change the `poolArms` filter to `.filter(() => true)` and run:
Run: `cd server && ./node_modules/.bin/vitest run test/roster-generate.test.ts`
Expected: FAIL — `emits one arm per TAGGED account only…`, an arm for `a-b` whose pool prints as `null` (not `undefined`: `pooledRoster` came through `parseRoster`, which parses an absent `pool` key to `null`, and `null` still satisfies the assertion's `[a-z0-9-]+` capture, so the row appears and `toEqual` fails); and `emits an EMPTY case for an all-untagged roster…`. Restore the filter.

Row 3 — wrap the emission so it is skipped when `poolArms === ''` and run:
Expected: FAIL — `is defined even when NO account is tagged`, which THROWS `Command failed: bash -c …` rather than comparing a value (the function is undefined again in `untaggedHome`, so `declare -F` exits 1 and the `&&` short-circuits), and `emits an EMPTY case…` on its assertion. Restore.

- [ ] **Step 7: Commit**

```bash
git add shared/generate.mjs server/test/fixtures/poolRule.ts server/test/roster-generate.test.ts server/test/gen-accounts.test.ts
git commit -m "feat(generate): accounts.sh answers an account's pool, always defined, tagged accounts only"
```

---

### Task 4: The wire — `RosterWire.pool`, and the project-pool vocabulary

**Files:**
- Modify: `shared/api.ts` — the three project-pool types after `ProjectRow` (`:1367`–`:1371`); `RosterWire.pool` after `hidden` (`:2599`)
- Modify: `server/src/server.ts:1186`–`:1188` — `GET /api/accounts`'s roster map
- Modify: `pwa/test/rosterFixture.ts:25`–`:38` — compile-forced by the required field
- Test: `server/test/accounts-route.test.ts` — the roster assertion (`:155`–`:173`) and the key-set pin (`:180`–`:185`)

**Interfaces:**
- Consumes: `AccountDef.pool` (Task 1).
- Produces:
  ```ts
  export type ProjectPoolWire =
    | { state: 'tagged'; name: string } | { state: 'untagged' }
    | { state: 'malformed' } | { state: 'unreadable' };
  export type PoolsEnforcement = 'enforced' | 'unavailable' | 'unknown';
  export type ProjectPoolsWire =
    | { listed: true; byProject: Record<string, ProjectPoolWire>; enforcement: PoolsEnforcement }
    | { listed: false; enforcement: PoolsEnforcement };
  ```
  and `RosterWire.pool: string | null`, emitted by `GET /api/accounts`.

  The three project-pool types have no consumer in this wave, on purpose: they land here so waves 3 and 4 import ONE spelling rather than each inventing its own, which is how the server's 409 and the phone's disclosure would come to disagree about what "malformed" means.

**Spec:** §5.4.5 (the three types), §5.9 (`RosterWire.pool` and the wire-discipline census), §5.3 (the `RosterWire.pool` paragraph).

**Mutation table:** part of row 51's surface (new literals under the scanned roots — run `single-definition` and `topology-clean` after this task; the whole-branch gate repeats it). The wire itself is pinned by `accounts-route.test.ts`'s key-set assertion, which goes red when `pool: a.pool` is dropped from the handler.

Anchor quotes. `shared/api.ts:1367`–`:1371`:

```ts
export interface ProjectRow {
  name: string;
  workdir: string;
  readiness?: ProjectReadiness | null;
}
```

`server/src/server.ts:1186`–`:1188`:

```ts
      roster: deps.cfg.roster.accounts.map((a) => ({
        id: a.id, label: a.label, hue: a.hue, homeAble: a.homeAble, hidden: a.hidden,
      })),
```

- [ ] **Step 1: Write the failing tests**

In `server/test/accounts-route.test.ts`, extend the imports at `:10`–`:13`:

```ts
import type { AccountsResponse, AccountUsage } from '../../shared/api.js';
import { loadConfig } from '../src/config.js';
import { buildServer } from '../src/server.js';
import { seedRoster, testDeps } from './helpers.js';
import { POOLED_TEST_ROSTER } from './fixtures/poolRule.js';
import { mkTmp } from './tmpHelpers.js';
```

Add a helper beside `getPayload` (after `:39`):

```ts
/** `testDeps` seeds `DEFAULT_TEST_ROSTER` into the home it is handed; this
 *  re-seeds a different roster over that file and rebuilds the config from it,
 *  so the route answers over a roster that actually carries pool tags. Two
 *  `loadConfig` calls, not one, because the roster is read once at boot.
 *
 *  ONLY safe for routes that never shell out: `base.runCcd` was built by
 *  `testDeps` against the FIRST config, so a route reading `cfg.ccdBin` through
 *  the runner would be running against the pre-swap one. `GET /api/accounts`
 *  touches neither, which is why this shortcut is enough here and would not be
 *  enough for a swap or sessions route. */
async function getPayloadWithRoster(home: string, rosterJson: unknown): Promise<AccountsResponse> {
  const base = testDeps(home);
  seedRoster(home, rosterJson);
  const app = await buildServer({ ...base, cfg: loadConfig({ CCRC_HOME: home }) });
  try {
    const res = await app.inject({ method: 'GET', url: '/api/accounts' });
    expect(res.statusCode).toBe(200);
    return res.json() as AccountsResponse;
  } finally {
    await app.close();
  }
}
```

Update the roster assertion at `:166`–`:172` to carry the new field:

```ts
    expect(roster).toEqual([
      { id: 'claude', label: 'claude', hue: 'cyan', homeAble: true, hidden: false, pool: null },
      { id: 'claude-a', label: 'claude-a', hue: 'violet', homeAble: true, hidden: false, pool: null },
      { id: 'claude-b', label: 'team·b', hue: 'blue', homeAble: true, hidden: false, pool: null },
      { id: 'gpt', label: 'gpt', hue: 'magenta', homeAble: false, hidden: false, pool: null },
      { id: 'claude-d', label: 'claude-d', hue: 'green', homeAble: true, hidden: false, pool: null },
    ]);
```

Update the key-set pin at `:183`:

```ts
      expect(Object.keys(entry).sort()).toEqual(['hidden', 'homeAble', 'hue', 'id', 'label', 'pool']);
```

And add, immediately after the `ships no launch or secrets detail to the browser` test (which closes at `:185`):

```ts
  // The account half of project pools reaches the phone here and nowhere else.
  // `null` for an untagged account is a VALUE on this wire, not an omission:
  // the PWA's single reader answers `null` for an absent key too (an older
  // server), and both mean "untagged" — the permissive direction, and today's
  // behaviour. What must never happen is a handler that quietly drops the field
  // and makes every account look untagged on a fleet where pools are enforced.
  it('carries each account\'s pool, and null for the untagged ones', async () => {
    const { roster } = await getPayloadWithRoster(
      seedLimits({ claude: { five: 2, seven: 3 } }), POOLED_TEST_ROSTER);
    expect(roster.map((a) => [a.id, a.pool])).toEqual([
      ['claude', 'pool-a'],
      ['claude-a', 'pool-a'],
      ['claude-b', 'pool-b'],
      ['gpt', null],
      ['claude-d', null],
    ]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/accounts-route.test.ts`

Expected: FAIL, three tests:
- `carries the roster, including accounts telemetry has never mentioned` — `toEqual` diff, every entry missing `pool: null`.
- `ships no launch or secrets detail to the browser` — `expected [ 'hidden', 'homeAble', 'hue', 'id', 'label' ] to deeply equal [ 'hidden', 'homeAble', 'hue', 'id', 'label', 'pool' ]`.
- `carries each account's pool, and null for the untagged ones` — every second element `undefined`.

- [ ] **Step 3: Declare the project-pool vocabulary**

In `shared/api.ts`, immediately after `ProjectRow` closes (`:1371`) and before the `foldSkillStates` docstring:

```ts
/**
 * What a project's pool tag (`~/.cc-sessions/pools/<project>` on the fleet box)
 * was MEASURED to be.
 *
 * FOUR states, and no reader may fold one into another. `unreadable` (the file
 * is there and could not be read — EACCES, a directory planted at the path, a
 * symlink loop) and `malformed` (it was read and is not one pool name) are the
 * two ways NOBODY DECIDES: creation refuses naming the file, the auto-swapper
 * holds, the server answers 503. Folding either into `untagged` would silently
 * LIFT the constraint — the overloaded-null defect this tree refuses at a seam,
 * in its most expensive form, because the direction of the mistake is always
 * "run the work somewhere it was not allowed to run".
 *
 * No detail string beside the state, deliberately: the PWA's warning chip
 * carries the full path and `ccrc doctor` carries the bytes, so a third
 * rendering of the same fact would be a third thing to keep true.
 *
 * Declared ahead of its consumers so both ends of the wire import ONE spelling
 * rather than each inventing its own.
 */
export type ProjectPoolWire =
  | { state: 'tagged'; name: string }
  | { state: 'untagged' }
  | { state: 'malformed' }
  | { state: 'unreadable' };

/**
 * Whether the fleet's `ccd` actually HONOURS project pools — the version-skew
 * channel for this feature, and three-valued for `lifecycleState`'s reason:
 * `unknown` means "this server has not measured", and a two-state answer would
 * make that look like one of the other two.
 *
 * `unavailable` is what arms the PWA's host banner ("the fleet host's ccd does
 * not honour project pools yet"); `unknown` arms nothing, because a banner on
 * no evidence is a banner nobody can act on.
 */
export type PoolsEnforcement = 'enforced' | 'unavailable' | 'unknown';

/**
 * The fleet-level pool census, as one frame carries it.
 *
 * `listed: false` is not "no projects are tagged" — it is "this server could not
 * enumerate the tags", which is the registry root being unlistable or a regular
 * file planted where `pools/` belongs. The distinction survives to the phone
 * because a fleet of silently untagged projects and a fleet whose tags cannot be
 * read look identical otherwise, and only one of them is a reason to stop
 * trusting the chips.
 *
 * FLEET-LEVEL, never per session: a `FleetSession` field would make
 * `reviveFleetSession` a second producer of this fact, which is the argument the
 * `divergence` frame already makes for itself.
 */
export type ProjectPoolsWire =
  | { listed: true; byProject: Record<string, ProjectPoolWire>; enforcement: PoolsEnforcement }
  | { listed: false; enforcement: PoolsEnforcement };
```

- [ ] **Step 4: Add the roster field and emit it**

In `shared/api.ts`, in `RosterWire` after `hidden: boolean;` (`:2599`):

```ts
  /** The operator's pool for this account, or `null` for untagged — see
   *  `AccountDef.pool` (`shared/roster.ts`) for what a pool is and why an
   *  absent key, not a written `null`, is how the roster file says "untagged".
   *
   *  ADDITIVE, and `FLEET_PROTO` is deliberately not bumped for it, on
   *  `hidden`'s exact terms. A server built before this field omits it, and the
   *  PWA's SINGLE reader (`accountPool`, `pwa/src/lib/accounts.ts`) tests
   *  `typeof v === 'string'` and answers `null` for anything else — so an older
   *  payload reads as untagged, which is the permissive direction and today's
   *  behaviour. A reader that trusted the static type here would be trusting a
   *  cast: the offline snapshot's `isRosterWireLike` does not check this field,
   *  any more than it checks `hidden`.
   *
   *  REQUIRED on this interface even though it is optional in the roster FILE,
   *  for the reason `hidden` gives above: a handler that forgot to copy it
   *  would ship a wire on which every account looks untagged — on a fleet where
   *  pools are enforced, a phone offering swaps `ccd` will refuse — and the
   *  compiler is the only thing that can catch a field-by-field rebuild
   *  dropping one. */
  pool: string | null;
```

In `server/src/server.ts:1186`–`:1188`:

```ts
      roster: deps.cfg.roster.accounts.map((a) => ({
        id: a.id, label: a.label, hue: a.hue, homeAble: a.homeAble, hidden: a.hidden,
        pool: a.pool,
      })),
```

- [ ] **Step 5: Answer the required field in the PWA's typed fixture**

`pwa/test/rosterFixture.ts` declares `TEST_ROSTER: RosterWire[]`, so a required field is a compile error there. Replace the comment at `:25`–`:29` and the array at `:30`–`:38`:

```ts
// `hidden: false` on every entry, spelled out rather than defaulted: the field
// is REQUIRED on `RosterWire` so a handler cannot forget to emit it, and this
// fixture is what the tests treat as "what production actually sends". The two
// cases that differ — a declared-plumbing entry, and an OLDER wire that omits
// the key altogether — are built by the tests that are about them.
//
// `pool: null` is here on exactly the same terms, and every entry is UNTAGGED
// on purpose: this is the roster a fleet has before anyone tags anything, which
// is the state every existing test in this suite is implicitly asserting
// against. A test that needs a tagged account builds one by mapping over this
// array — `swap-sheet.test.tsx` already does that for `hidden` — rather than
// tagging entries here and changing what every other test believes production
// sends.
export const TEST_ROSTER: RosterWire[] = [
  { id: 'claude', label: 'team·max', hue: 'cyan', homeAble: true, hidden: false, pool: null },
  { id: 'claude2', label: 'team·alt', hue: 'violet', homeAble: true, hidden: false, pool: null },
  { id: 'claude-corp', label: 'team·b', hue: 'blue', homeAble: true, hidden: false, pool: null },
  // Opt-in only: a lane a session reaches solely by being sent there on
  // purpose, never one ccd's `_ws_least_loaded` chooses on its own.
  { id: 'gpt', label: 'gpt', hue: 'magenta', homeAble: false, hidden: false, pool: null },
  { id: 'claude-dev0', label: 'team·d', hue: 'green', homeAble: true, hidden: false, pool: null },
];
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd server && ./node_modules/.bin/vitest run test/accounts-route.test.ts test/typecheck-tests.test.ts`

Expected: PASS.

Run: `cd pwa && npm ci && ./node_modules/.bin/tsc --noEmit -p tsconfig.json`

Expected: exit 0, no output. (`pwa/tsconfig.json` includes `test` and `../shared`, so this is the gate that would have caught the fixture — `pwa`'s `npm run test` is `vitest run` and strips types.)

- [ ] **Step 7: Measure the mutation**

Delete `pool: a.pool,` from the handler's roster map and run:
Run: `cd server && ./node_modules/.bin/vitest run test/accounts-route.test.ts`
Expected: FAIL — `ships no launch or secrets detail to the browser` (the key set loses `'pool'`), `carries the roster, …` (`toEqual` diff), and `carries each account's pool, …` (every pool `undefined`).

Restore it.

- [ ] **Step 8: Run the residue scans, since new literals landed under the scanned roots**

Run: `cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts test/topology-clean.test.ts`

Expected: PASS. (Row 51: the only new string-ish literals are the state words `tagged`/`untagged`/`malformed`/`unreadable` and the enforcement words, none of which names an account, a pool or a host.)

- [ ] **Step 9: Commit**

```bash
git add shared/api.ts server/src/server.ts server/test/accounts-route.test.ts pwa/test/rosterFixture.ts
git commit -m "feat(wire): RosterWire carries an account's pool, and the project-pool vocabulary lands beside it"
```

---

### Task 5: The rule, spelled once in TypeScript

**Files:**
- Create: `shared/poolrule.ts`
- Modify: `server/test/fixtures/poolRule.ts` — append `PoolRuleCase` and `POOL_RULE_CASES` to the file Task 3 created
- Test: `server/test/pool-rule-core.test.ts` (new)

**Interfaces:**
- Consumes: `ProjectPoolWire` (Task 4).
- Produces:
  ```ts
  export type PoolVerdict =
    | { ok: true;  why: 'untagged-project' | 'untagged-account' | 'same-pool' }
    | { ok: false; reason: 'pool-mismatch'; accountPool: string; projectPool: string }
    | { ok: false; reason: 'pool-undecidable'; state: 'unreadable' | 'malformed' };
  export function poolRule(accountPool: string | null, projectPool: ProjectPoolWire): PoolVerdict;

  export interface PoolRuleCase {
    name: string; accountPool: string | null; project: ProjectPoolWire;
    expect: 'serve' | 'mismatch' | 'undecidable'; why: string;
  }
  export const POOL_RULE_CASES: readonly PoolRuleCase[];
  ```
  Wave 3's `server/src/poolrule.ts` VALUE-imports `poolRule` and widens the union with `{ ok: true; why: 'account-not-in-roster' }` as `RosterVerdict`; wave 4's `splitByPool` value-imports the same function. `ccd`'s bash `_pool_ok` maps `serve`→rc 0, `mismatch`→rc 1, `undecidable`→rc 2 over the same table.

  **Plan-time refinement of spec §5.2/§8, recorded in this wave's ledger.** The spec placed the TypeScript rule in `server/src/poolrule.ts` (L1) and named a THIRD spelling in the PWA (`splitByPool`), with the fixture table driven through all three. Because `shared/*.ts` is already bundled by the PWA, the rule lives HERE (L0) instead: the server's L1 module and the PWA's `splitByPool` both call `poolRule`, so there are TWO spellings (TypeScript, bash), one per language that cannot share code, and the PWA composes rather than re-derives. Every later "three spellings" the spec says reads as two.

**Spec:** §5.2 (the rule), §5.6 (the verdict union), §8 (ring placement; the L0 constraint) — with the refinement above.

**Mutation table:**
- row 7 (the TS half) — "the same rule in L1 and in the PWA", driven over `POOL_RULE_CASES` with a fixture-count floor and at least one reject per rule. Goes red when the rule drifts or a fixture class is deleted. The bash half (`ccd-pool-ok.test.ts`) is wave 2a's, over this same table; wave 4 pins that `splitByPool` calls `poolRule` (composition), which is what makes a PWA copy of the rule impossible rather than merely tested.

`LEDGER:` The spec's §8 ring table placed the TypeScript pool rule in `server/src/poolrule.ts` (L1) and named a third spelling in the PWA; at plan time the rule moved to `shared/poolrule.ts` (L0) so the server and the PWA consume one spelling, and the fixture table has two consumers (bash, TypeScript), not three. A refinement, not a reversal: the spec's constraints (pure, type-only imports, purity-scanned) all still hold and are pinned by this task's scan. (D-1664 — plan-time deviation from spec §5.2/§8)
- The purity pin is this wave's own guard on §8's L0 row, in the shape `coord-caps-policy.test.ts:124`–`:172` already uses.

- [ ] **Step 1: Write the failing tests**

In `server/test/fixtures/poolRule.ts`, add the type import beside the existing `DEFAULT_TEST_ROSTER` import at the top of the file:

```ts
import type { ProjectPoolWire } from '../../../shared/api.js';
import { DEFAULT_TEST_ROSTER } from '../helpers.js';
```

then append to the end of the file:

```ts
/**
 * One row of the pool-rule truth table — the ONE definition of the rule's
 * cases, driven through both of its spellings: `poolRule` (`shared/poolrule.ts`,
 * the TypeScript the server and the PWA both call) and `ccd`'s bash `_pool_ok`.
 * The two cannot share code across the language boundary, so they share
 * FIXTURES, exactly as `fixtures/leastLoaded.ts` already does for the placement
 * rule. If either drifts, its own suite reds against these rows.
 *
 * `expect` is deliberately a THIRD vocabulary rather than either
 * implementation's own: bash answers rc 0/1/2 and TypeScript answers a
 * discriminated union, and writing the table in either idiom would quietly make
 * it that side's fixture with the other side translating. Mapping:
 *
 *   serve       -> bash rc 0   /  `{ ok: true }`
 *   mismatch    -> bash rc 1   /  `{ ok: false, reason: 'pool-mismatch' }`
 *   undecidable -> bash rc 2   /  `{ ok: false, reason: 'pool-undecidable' }`
 */
export interface PoolRuleCase {
  name: string;
  /** `null` = an untagged account, or one this side cannot see — see
   *  `poolRule`'s docstring for why those two are deliberately one value. */
  accountPool: string | null;
  project: ProjectPoolWire;
  expect: 'serve' | 'mismatch' | 'undecidable';
  /** Why this row is in the table, in one sentence — what breaks if it goes. */
  why: string;
}

export const POOL_RULE_CASES: readonly PoolRuleCase[] = [
  {
    name: 'both-untagged', accountPool: null, project: { state: 'untagged' }, expect: 'serve',
    why: 'ruling 3 — an untagged project is unconstrained, which is the behaviour every box has today',
  },
  {
    name: 'untagged-project-tagged-account', accountPool: 'pool-a', project: { state: 'untagged' }, expect: 'serve',
    why: 'tagging an ACCOUNT constrains nothing on its own; rollout step 2 depends on this row being true',
  },
  {
    name: 'untagged-project-other-tagged-account', accountPool: 'pool-b', project: { state: 'untagged' }, expect: 'serve',
    why: 'the same for a second pool name — the answer must not depend on which name',
  },
  {
    name: 'untagged-account-tagged-project', accountPool: null, project: { state: 'tagged', name: 'pool-a' }, expect: 'serve',
    why: 'an account with no pool serves any project — the second disjunct of the rule',
  },
  {
    name: 'same-pool-a', accountPool: 'pool-a', project: { state: 'tagged', name: 'pool-a' }, expect: 'serve',
    why: 'the names agree',
  },
  {
    name: 'same-pool-b', accountPool: 'pool-b', project: { state: 'tagged', name: 'pool-b' }, expect: 'serve',
    why: 'the names agree, for a second name — an implementation that hard-coded one pool passes the row above alone',
  },
  {
    name: 'mismatch-a-into-b', accountPool: 'pool-a', project: { state: 'tagged', name: 'pool-b' }, expect: 'mismatch',
    why: 'the refusal ruling 4 makes overridable only by an explicit, separate flag',
  },
  {
    name: 'mismatch-b-into-a', accountPool: 'pool-b', project: { state: 'tagged', name: 'pool-a' }, expect: 'mismatch',
    why: 'the same in the other direction — the rule is symmetric, and an inverted comparison passes one row alone',
  },
  {
    name: 'mismatch-on-a-prefix', accountPool: 'pool-a', project: { state: 'tagged', name: 'pool-ab' }, expect: 'mismatch',
    why: 'the comparison is EQUALITY, not a prefix or glob match — a TS `startsWith`, or a bash `==` with an '
      + 'unquoted right side, passes every other row in this table',
  },
  {
    name: 'unreadable-tagged-account', accountPool: 'pool-a', project: { state: 'unreadable' }, expect: 'undecidable',
    why: 'the tag exists and could not be read: nobody decides, and nobody crosses',
  },
  {
    name: 'unreadable-untagged-account', accountPool: null, project: { state: 'unreadable' }, expect: 'undecidable',
    why: 'THE ROW THAT MATTERS — an untagged account must not short-circuit past an unknown constraint. '
      + 'This is what fails when the untagged shortcuts are evaluated before the undecidable states',
  },
  {
    name: 'malformed-tagged-account', accountPool: 'pool-b', project: { state: 'malformed' }, expect: 'undecidable',
    why: 'a hand-typed tag with two tokens is a rewrite, not a permission',
  },
  {
    name: 'malformed-untagged-account', accountPool: null, project: { state: 'malformed' }, expect: 'undecidable',
    why: 'the same short-circuit as unreadable-untagged-account, for the other undecidable state',
  },
];
```

Create `server/test/pool-rule-core.test.ts`:

```ts
// `shared/poolrule.ts` — the TypeScript spelling of design §5.2's one rule,
// driven through `POOL_RULE_CASES`, the same table `ccd`'s `_pool_ok` is driven
// through. Two implementations, one table: either drifting reds its own suite
// against the same rows, which is what "spelled once per language" has to mean
// when the languages cannot share code. The PWA is not a third: `splitByPool`
// calls this function.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { poolRule } from '../../shared/poolrule.js';
import { POOL_RULE_CASES } from './fixtures/poolRule.js';

describe('poolRule over the shared truth table', () => {
  it.each(POOL_RULE_CASES.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const v = poolRule(c.accountPool, c.project);
    const actual = v.ok ? 'serve' : v.reason === 'pool-mismatch' ? 'mismatch' : 'undecidable';
    expect(actual, c.why).toBe(c.expect);
  });

  it('a mismatch carries BOTH names, so no caller re-derives them', () => {
    // The 409 body, `ccd`'s die text and the PWA's confirm sentence all name the
    // two pools. Carrying them on the verdict is what stops three callers each
    // looking them up again — and disagreeing when one of them looks in the
    // wrong roster copy.
    expect(poolRule('pool-a', { state: 'tagged', name: 'pool-b' })).toEqual({
      ok: false, reason: 'pool-mismatch', accountPool: 'pool-a', projectPool: 'pool-b',
    });
  });

  it('an undecidable carries WHICH state, because the two have different remedies', () => {
    // `unreadable` is a permissions problem; `malformed` is "rewrite the file".
    // A single `undecidable` token would send the operator to the wrong one.
    expect(poolRule('pool-a', { state: 'unreadable' }))
      .toEqual({ ok: false, reason: 'pool-undecidable', state: 'unreadable' });
    expect(poolRule('pool-a', { state: 'malformed' }))
      .toEqual({ ok: false, reason: 'pool-undecidable', state: 'malformed' });
  });

  it('names every serve REASON, so a collapsed `why` cannot pass', () => {
    // "served because the project is untagged" and "served because the names
    // agree" are different facts to a reader deciding whether tagging the
    // project would change anything — and the PWA's copy is built from them.
    expect(poolRule(null, { state: 'untagged' })).toEqual({ ok: true, why: 'untagged-project' });
    expect(poolRule('pool-a', { state: 'untagged' })).toEqual({ ok: true, why: 'untagged-project' });
    expect(poolRule(null, { state: 'tagged', name: 'pool-a' })).toEqual({ ok: true, why: 'untagged-account' });
    expect(poolRule('pool-a', { state: 'tagged', name: 'pool-a' })).toEqual({ ok: true, why: 'same-pool' });
  });
});

describe('the table this drives is a real table', () => {
  // The floor, in `single-definition.test.ts`'s idiom: a scan over an emptied or
  // narrowed fixture list passes everything, so THIS goes red rather than every
  // assertion above going quietly vacuous.
  it('has a floor of rows, unique names, and covers every project state', () => {
    expect(POOL_RULE_CASES.length).toBeGreaterThanOrEqual(12);
    expect(new Set(POOL_RULE_CASES.map((c) => c.name)).size).toBe(POOL_RULE_CASES.length);
    expect([...new Set(POOL_RULE_CASES.map((c) => c.expect))].sort())
      .toEqual(['mismatch', 'serve', 'undecidable']);
    expect([...new Set(POOL_RULE_CASES.map((c) => c.project.state))].sort())
      .toEqual(['malformed', 'tagged', 'unreadable', 'untagged']);
  });

  it('exercises all five verdicts the rule can produce', () => {
    const outcomes = new Set(POOL_RULE_CASES.map((c) => {
      const v = poolRule(c.accountPool, c.project);
      return v.ok ? v.why : v.reason;
    }));
    expect([...outcomes].sort()).toEqual([
      'pool-mismatch', 'pool-undecidable', 'same-pool', 'untagged-account', 'untagged-project',
    ]);
  });

  it('carries a REJECT per rule — both undecidable states over both account shapes, and a mismatch each way', () => {
    for (const state of ['unreadable', 'malformed'] as const) {
      const rows = POOL_RULE_CASES.filter((c) => c.project.state === state && c.expect === 'undecidable');
      expect(rows.some((c) => c.accountPool === null), `${state} over an UNTAGGED account`).toBe(true);
      expect(rows.some((c) => c.accountPool !== null), `${state} over a TAGGED account`).toBe(true);
    }
    // Both directions plus the prefix row: an inverted comparison and a
    // `startsWith` are the two mutations one mismatch row alone survives.
    expect(POOL_RULE_CASES.filter((c) => c.expect === 'mismatch').length).toBeGreaterThanOrEqual(3);
    // Both untagged disjuncts, separately — one of them alone leaves the other
    // deletable.
    expect(POOL_RULE_CASES.some((c) => c.accountPool === null && c.project.state === 'tagged')).toBe(true);
    expect(POOL_RULE_CASES.some((c) => c.accountPool !== null && c.project.state === 'untagged')).toBe(true);
  });
});

describe('shared/poolrule.ts is the pure L0 module its ring requires', () => {
  const SRC = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'shared', 'poolrule.ts'),
    'utf8');

  /** Comments blanked, positions preserved — `coord-caps-policy.test.ts`'s
   *  helper, kept for its reason: this module's own header NAMES `node:` and
   *  `server/src` while promising not to import them, and would red every
   *  assertion below on its own prose.
   *
   *  IF THIS FILE REDS WITH `no imports found — the scan is over nothing`, READ
   *  THIS BEFORE DOUBTING THE MODULE. Block comments are blanked FIRST, with a
   *  lazy `/\*[\s\S]*?\*\/`. So a `/*` written inside a LINE comment — the easiest
   *  way being to type a path glob like `shared/` followed by a star and `.ts` —
   *  opens a match that runs to the next real `*\/`, swallowing every line
   *  between, the `import type` line included. The scan then measures nothing and
   *  says so. That is not a false alarm: it is this assertion doing the one job
   *  it exists for, and the fix is in `shared/poolrule.ts`'s prose, not here.
   *  (D-1741, found before this file first landed.) */
  const code = (): string => SRC
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));

  it('the scan is over real code, not an empty string', () => {
    expect(code()).toContain('export function poolRule');
    expect(code().replace(/\s/g, '').length).toBeGreaterThan(200);
  });

  it('takes TYPE imports only — L0 imports nothing, not even node:*', () => {
    // The PWA bundles every `shared/*.ts`, so a `node:` import here does not
    // degrade anything — it breaks the client bundle. And a VALUE import is what
    // would let a decision start depending on something that has to be
    // constructed, which is the ring rule L0 exists to state.
    const imports = [...code().matchAll(/^\s*import\b[^\n]*/gm)].map((m) => m[0]!);
    expect(imports.length, 'no imports found — the scan is over nothing').toBeGreaterThan(0);
    for (const line of imports) {
      expect(line, `poolrule.ts takes a VALUE import: ${line.trim()}`).toMatch(/^\s*import\s+type\b/);
    }
    expect(code(), 'poolrule.ts imports a node builtin — the PWA bundles this file')
      .not.toMatch(/from\s+'node:/);
  });

  it('has no clock, no filesystem, no reply', () => {
    expect(code(), 'poolrule.ts reads the clock — the rule is no longer a pure decision')
      .not.toMatch(/\bDate\s*\.\s*now\s*\(|\bnew\s+Date\s*\(|performance\s*\.\s*now/);
    expect(code(), 'poolrule.ts reaches for a filesystem').not.toMatch(/\bfs\s*\.|require\s*\(/);
    expect(code(), 'poolrule.ts names a reply — an L0 decision does not answer HTTP')
      .not.toMatch(/\breply\b|\bFastify|\bapp\s*\./);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/pool-rule-core.test.ts`

Expected: FAIL — the file does not load:
`Error: Failed to load url ../../shared/poolrule.js` (or `Cannot find module '…/shared/poolrule.js'`).

- [ ] **Step 3: Write the module**

Create `shared/poolrule.ts`:

```ts
// The one TypeScript spelling of the pool rule (design §5.2):
//
//   An account `a` may serve a project `p` iff pool(a) is null, or pool(p) is
//   null, or pool(a) === pool(p). If pool(p) cannot be read, NOBODY DECIDES.
//
// L0, like every other module in `shared/`: it imports nothing but TYPES,
// not even `node:*`, because the PWA bundles this file. That is not a formality here —
// it is the whole reason the rule lives in `shared/` rather than under
// `server/src/`. The server's 409 pre-check (wave 3) and the phone's "show
// other pools" disclosure (wave 4) will be two renderings of ONE decision, and
// two copies of it would drift; the copy the phone showed would then offer a
// swap the copy the API enforces refuses, which is the failure the shared
// fixture table (`server/test/fixtures/poolRule.ts`) exists to make impossible.
// `ccd`'s bash `_pool_ok` will be the other spelling (wave 2a) — it cannot
// share code across the language boundary, so it shares that same table
// instead. Nothing outside this wave imports this function yet; every consumer
// named in this file is an obligation on the wave that names it, not a report.
//
// PRECEDENCE IS THE POINT, and the order below is not arbitrary:
//
//  1. `unreadable` / `malformed` are decided FIRST, before either untagged
//     shortcut. An unreadable tag over an UNTAGGED account still answers
//     undecidable: the constraint is unknown, not absent, and answering "serve"
//     there would lift a constraint nobody has read. This is the one ordering
//     mistake that is invisible in every other row of the table.
//  2. `untagged-project` — ruling 3: tagging only ever tightens, so an untagged
//     project keeps today's unconstrained behaviour and nothing strands on
//     rollout.
//  3. `untagged-account` — an account with no pool serves anything.
//  4. Equal names serve; anything else is a mismatch, and the verdict CARRIES
//     BOTH NAMES so a 409 body, a die message and a chip can each say which two
//     pools disagreed without looking either of them up again.
import type { ProjectPoolWire } from './api.js';

/**
 * Why an account may or may not serve a project.
 *
 * The `ok: true` arm keeps its REASON rather than collapsing to a boolean:
 * "served because the project is untagged" and "served because the names agree"
 * are different facts to a reader deciding whether tagging the project would
 * change anything, and the PWA builds its copy from that difference.
 *
 * `pool-undecidable` is not a third flavour of "no". A refusal says the operator
 * may override it on purpose (`--cross-pool`, a 409 with an override); an
 * undecidable says nobody has an answer, and its honest surfaces are a 503 and a
 * warning chip carrying the path — never a 409 offering a crossing over a
 * constraint that was never read.
 */
export type PoolVerdict =
  | { ok: true; why: 'untagged-project' | 'untagged-account' | 'same-pool' }
  | { ok: false; reason: 'pool-mismatch'; accountPool: string; projectPool: string }
  | { ok: false; reason: 'pool-undecidable'; state: 'unreadable' | 'malformed' };

/**
 * The rule, once.
 *
 * `accountPool` is `null` for an untagged account — and, deliberately, also for
 * an account THIS SIDE CANNOT SEE. The PWA will read it through `accountPool`
 * (`pwa/src/lib/accounts.ts`, wave 4), which must answer `null` for a wrapper the
 * roster on the wire does not carry, and that fold is the permissive direction on
 * purpose:
 * `ccd`'s `_is_valid_wrapper` is the authority on which wrappers exist, the
 * server's roster copy can lag the fleet's, and a display that HID a live
 * non-roster account would be worse than one that offers it and lets `ccd`
 * refuse. The fold is disclosed here rather than left for a reader to discover.
 */
export function poolRule(accountPool: string | null, projectPool: ProjectPoolWire): PoolVerdict {
  if (projectPool.state === 'unreadable' || projectPool.state === 'malformed') {
    return { ok: false, reason: 'pool-undecidable', state: projectPool.state };
  }
  if (projectPool.state === 'untagged') return { ok: true, why: 'untagged-project' };
  if (accountPool === null) return { ok: true, why: 'untagged-account' };
  return accountPool === projectPool.name
    ? { ok: true, why: 'same-pool' }
    : { ok: false, reason: 'pool-mismatch', accountPool, projectPool: projectPool.name };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && ./node_modules/.bin/vitest run test/pool-rule-core.test.ts`

Expected: PASS — 13 table rows plus 9 standalone assertions, **22 tests**.

**Do not write the phrase `` `shared/*.ts` `` (or any other `/*` sequence) into a LINE comment in
this module (D-1741).** The purity scan's `code()` helper blanks BLOCK
comments first, and its lazy `/\*[\s\S]*?\*/` would match from that `/*` all the way to the first
real `*/` — swallowing the `import type` line on the way — so `imports.length` reads 0 and
`no imports found — the scan is over nothing` reds on a perfectly correct module. Measured, on the
module text exactly as listed above: as first drafted, `imports: 0`; with the header's `` `shared/*.ts` ``
reworded to `` `shared/` ``, `imports: 1`, all type-only, 768 non-whitespace characters. Say
`` `shared/` `` or `` `shared/<name>.ts` ``.

- [ ] **Step 5: Measure the mutations**

Each of these is restored before the next.

1. Move both untagged shortcuts ABOVE the undecidable check (`untagged-project`, then `accountPool === null`, then the undecidable arm):
   Expected: FAIL — exactly two rows, `unreadable-untagged-account` and `malformed-untagged-account`, each `expected 'serve' to be 'undecidable'`. The two TAGGED-account undecidable rows still pass, which is the point: this precedence error is invisible in every row except those two, and they are in the table for it.
2. Delete the `|| projectPool.state === 'malformed'` disjunct:
   Expected: FAIL — also `an undecidable carries WHICH state`, plus `malformed-untagged-account` (`expected 'serve' to be 'undecidable'`) and `malformed-tagged-account` (`expected 'mismatch' to be 'undecidable'` — the malformed row falls through to the name comparison against a `tagged`-only field, which does not exist, so the comparison sees `undefined` and takes the mismatch arm). `tsc` also refuses this mutation, since `projectPool.name` no longer narrows; vitest's esbuild strips types, so the suite still runs it and the assertion above is what you will see.
3. Invert the comparison to `accountPool !== projectPool.name`:
   Expected: FAIL — `same-pool-a`, `same-pool-b`, `mismatch-a-into-b`, `mismatch-b-into-a`,
   `mismatch-on-a-prefix`, and the two shape assertions that name the arms directly:
   `a mismatch carries BOTH names` and `names every serve REASON`.
4. Replace the comparison with `projectPool.name.startsWith(accountPool)`:
   Expected: FAIL — `mismatch-on-a-prefix` alone. This is the row that exists for exactly this mutation.
5. Delete four rows from `POOL_RULE_CASES` — delete the LAST four, so the two undecidable-state
   classes are the ones that go:
   Expected: FAIL — `has a floor of rows, unique names, and covers every project state`
   (`expected 9 to be greater than or equal to 12`), and, because those four rows are also the only
   carriers of two other guarantees, `exercises all five verdicts the rule can produce` and
   `carries a REJECT per rule`. The floor test is the row-count guard; the other two are why "any
   four" is the wrong instruction — no four-row deletion from a 13-row table leaves the floor test
   as the ONLY red, since the surviving assertions jointly require ten specific rows.
6. Add `import { readFileSync } from 'node:fs';` to `shared/poolrule.ts`, beside the existing import:
   Expected: FAIL — `takes TYPE imports only`, ONCE. Both of that test's guards see the mutation
   (`imports` becomes the two lines, and the `node:` scan matches), but the value-import loop's
   `expect` throws first, so vitest reports one failing test, not two. Measured on the fixed header:
   `imports: 2`, `allTypeOnly: false`, `node: hit: true`. **On the UNFIXED header this mutation
   produces no new red at all** — the added import is blanked with the rest, and the pre-existing
   `no imports found` red is what you see — which is the second reason D-1741
   is a defect rather than a cosmetic one.

- [ ] **Step 6: Typecheck and re-run**

Run: `cd server && ./node_modules/.bin/vitest run test/pool-rule-core.test.ts test/typecheck-tests.test.ts`
Expected: PASS.

Run: `cd pwa && ./node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: exit 0. (`../shared` is in the PWA's `include`, so this is where an L0 violation in the new module surfaces for the client bundle.)

- [ ] **Step 7: Commit**

```bash
git add shared/poolrule.ts server/test/fixtures/poolRule.ts server/test/pool-rule-core.test.ts
git commit -m "feat(poolrule): the pool rule spelled once in TypeScript, over the table its two spellings share"
```

---

### Task 6: Whole-branch gate

**Files:** none modified — this task runs gates and fixes what they find.

**Interfaces:**
- Consumes: everything Tasks 1–5 produced.
- Produces: a branch whose full suites are green and whose new numbers, names and literals survive every tree-wide scan.

**Spec:** §11 row 51 (no operator names in source); the program's per-wave merge gate.

**Mutation table:** row 51 — "no operator names in source", goes red when a real pool or account name is typed. `single-definition` and `topology-clean` are the mechanism.

- [ ] **Step 1: Full package suites, in the foreground**

Run, one at a time, each with a timeout of at least 600000 ms:

```bash
cd server && npm ci && npm run test
cd agent && npm ci && npm run test
cd pwa && npm ci && npm run test
```

Expected: PASS.

`server`'s suite is load-sensitive. The known load flakes are `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state` — re-run any of those IN ISOLATION before calling it a real break, and note that a single green isolated run of `ccd-session-state` is not proof the failure was load. Nothing this wave touched is in those files.

- [ ] **Step 2: The PWA's typechecker, which its `npm run test` does not run**

```bash
cd pwa && ./node_modules/.bin/tsc --noEmit -p tsconfig.json
```

Expected: exit 0, no output. This is the gate that sees `pwa/test/rosterFixture.ts` and `shared/poolrule.ts` — `vitest run` strips types and would not.

- [ ] **Step 3: The ledger guard, against `origin/main` and without merging**

```bash
git fetch origin main
cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts
```

Expected: PASS. This wave defines D-1663 and D-1664 in `## Deviations found`, both issued by the allocator in the plan-commit call, so the suite has something real to measure: it reds if an allocator-era number is defined by a DIFFERENT plan file across HEAD and the fetched base. Note what green does NOT mean here: **this plan file is itself already on `origin/main`** (`ece7597a`, PR #56), so the block is not "this branch's alone" and never was — the same file defining the same numbers on both sides is one definition, not a collision. Green means no OTHER plan has taken one of them. It is run rather than assumed because green-trivially and green-because-nobody-looked are the same output and only one of them is a measurement.

- [ ] **Step 4: The tree-wide scans**

```bash
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts test/topology-clean.test.ts test/dtbd.test.ts
```

Expected: PASS.

What each is actually checking here:
- `single-definition` scans `shared/`, `server/src`, `pwa/src`, `agent/src` (NOT `server/test`) for a second copy of a single-sourced value and for any source file restating the roster as an array literal. `POOL_NAME_RE` exists once under those roots — `sources()` filters `/\.tsx?$/`, so `shared/roster-json.mjs`'s deliberate cross-language mirror is invisible to this scan and is held equal behaviourally instead, by `gen-accounts.test.ts`'s REJECT table (D-1742; wave 2a's text extraction covers `ccd`'s bash copy, not this one).
- `topology-clean` walks `git ls-files` — every tracked file, code and document alike — for an operator's real host, account or label. The fixture names this wave introduced (`pool-a`, `pool-b`, `pool-ab`) are the only new name-shaped literals.
- `dtbd` git-greps the tracked tree for a concrete `D-TBD` placeholder. This plan defines none at rest; any `D-TBD-<slug>` written into `## Deviations found` during execution must be substituted with an allocated number before this gate can pass, which is the mechanism that makes the placeholder a promise rather than a note.

- [ ] **Step 5: Re-run the five suites this wave touched, in isolation**

```bash
cd server && ./node_modules/.bin/vitest run test/roster.test.ts
cd server && ./node_modules/.bin/vitest run test/gen-accounts.test.ts
cd server && ./node_modules/.bin/vitest run test/roster-generate.test.ts
cd server && ./node_modules/.bin/vitest run test/accounts-route.test.ts
cd server && ./node_modules/.bin/vitest run test/pool-rule-core.test.ts
cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
```

Expected: PASS, each.

- [ ] **Step 6: Confirm nothing under `ccd/` moved**

```bash
git diff --stat origin/main...HEAD -- ccd/ deploy/
```

Expected: empty. If it is not, the agent-first rule binds this wave after all and the deploy order in the header note is wrong — stop and say so rather than deploying server-first.

- [ ] **Step 7: Commit anything the gates required**

If Steps 1–6 were all green with no edits, there is nothing to commit and this step is a no-op — say so rather than making an empty commit. Otherwise:

```bash
git add <the exact paths the gates required>
git commit -m "test(pools): the whole-branch gate's findings on wave 1"
```

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

- **D-1663** (Task 2) — `shared/roster-json.mjs` promised to be "stricter, never laxer" than `parseRoster`
  and never learned `hidden`: it accepted `hidden: "false"` behind a green deploy while `loadConfig`
  refused the same bytes at boot. Closed in the same act that adds `pool`; the `gen-accounts.test.ts`
  REJECT row for it is measured red on the tree before the check lands. (spec §12 P-1)
- **D-1664** (Task 5) — plan-time refinement of spec §5.2/§8: the TypeScript pool rule lives in
  `shared/poolrule.ts` (L0), not `server/src/poolrule.ts` (L1), so the server's L1 wrapper and the PWA's
  `splitByPool` both call ONE spelling; the fixture table `POOL_RULE_CASES` therefore has two consumers
  (bash `_pool_ok`, TypeScript `poolRule`), not the spec's three. The spec's constraints on the module —
  pure, type-only imports, purity-scanned — all still hold and are pinned by this task's scan.

**Found during execution of this wave, 2026-09-06.** Both were surfaced by the controller's pre-flight
audit of this plan against the tree, before Task 1 was dispatched, and both change SHIPPED source rather
than only this document. Both were requested from the coordinator in one `deviation-request` and
**minted from the live allocator on 2026-09-06** — project `ccrc-pwa`, count 2, floor now 1743 — then
substituted here and in the two source files that cite them. Neither number was ever written before it
was issued.

- **D-1741** (Task 5) — the module text this plan listed for
  `shared/poolrule.ts` opened its header with ``// L0, like every other `shared/*.ts`: …``, and the
  `/*` inside `` `shared/*.ts` `` is the FIRST `/*` in the file. The purity scan's `code()` helper
  (copied from `coord-caps-policy.test.ts`) blanks BLOCK comments first with a lazy
  `/\*[\s\S]*?\*/`, so that match ran from inside a LINE comment all the way to the close of the
  `PoolVerdict` docstring — swallowing the `import type { ProjectPoolWire } …` line on the way. The
  scan then found zero imports and reded on its own vacuity tripwire,
  `no imports found — the scan is over nothing`, against a module that was completely correct.
  Measured on the listed text: `imports: 0` as drafted; `imports: 1`, all type-only, 768
  non-whitespace characters with the header reworded to `` `shared/` ``. The mutation the task uses to
  prove the guard (`add a node:fs import`) produced NO new red at all under the original header, which
  is what makes this a defect rather than a typo: the guard would have shipped measuring nothing but
  its own tripwire. Closed by rewording the header; the tripwire itself is kept, because it is the
  thing that caught this.
- **D-1742** (Task 2) — this plan mandated a comment into `shared/roster-json.mjs`
  saying `ccd` carries a third copy of the grammar "and the three are pinned equal by text extraction
  rather than by hope", and repeated the claim in Task 2's Interfaces bullet and Task 6's gate note.
  Nothing pins THIS copy. Wave 2a's parity test extracts three literals from two files — `ccd/ccd`
  (`POOL_NAME_RE`, `POOLS_DIR`) and `ccrc-doctor-checks` (`POOL_NAME_RE`) — and never reads a `.mjs`;
  `single-definition.test.ts`'s `sources()` filters `/\.tsx?$/`, so it cannot see the file either. A
  comment asserting a mechanism that does not exist is the failure mode this tree names outright
  ("a comment is a request; a red suite is a mechanism"), and it was about to ship in the same file
  whose LAST false header claim is D-1663. Closed both ways: the comment now says what actually holds
  the copies equal — behaviour, via `gen-accounts.test.ts`'s REJECT table, for this copy, and text
  extraction for `ccd`'s (hedged to the future tense it belongs in, here and in Task 1's docstring) —
  and that table grew from five pool rows to NINE, so the two copies of the grammar are held equal by
  behaviour across four drift classes rather than by a sentence.

  **The first attempt at this fix was itself overstated, which is the part worth recording.** It added
  ONE row — one character past the 32-character cap — and a comment calling the table "the census".
  The task review measured that claim and refuted it: the six pool rows of that draft survived
  `/^[a-z0-9-][a-z0-9-]{0,31}$/` (leading-letter anchor lost) and `/^[a-z][a-z0-9_-]{0,31}$/`
  (underscore admitted), and each of those drifts makes this file LAXER than `parseRoster` — the one
  direction its header forbids. The leading-letter clause is the safety-load-bearing one: it is what
  makes the generated `echo` safe, because bash swallows a first argument of `-` followed by
  `n`/`e`/`E`. Fix round 1 added `-pool`, `1pool` and `pool_a`, and measured all four drift classes by
  DRIFTING THE MIRRORED LITERAL rather than by deleting the gate — each drift reding exactly the rows
  that name it and nothing else. A census claim is worth exactly the mutation that was run against it,
  and the first one had not been run.

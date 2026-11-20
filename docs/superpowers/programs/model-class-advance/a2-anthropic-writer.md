# A2: the source, the aliases file, holds and doctor (Anthropic arm, programme wave 7)

Programme `model-class-advance`, epic `anthropic-arm`, ticket `anthropic-writer`. Run 2851. It builds Tasks A2.1 to
A2.5 of `docs/superpowers/plans/2026-11-18-model-class-advance-anthropic-arm.md`, on `main` after #2943.

## What was built

- **A2.1, the cache parser** (`shared/model-aliases.mjs`): `parseCatalogueCache` and `newestCache`.
- **A2.2, the resolver and the file** (same module): `resolveAliases`, `parseAliases`, `serializeAliases`,
  `aliasesSourceCause` and `bareModelId`, with the fixture table `server/test/fixtures/model-id-bare.json`.
- **A2.3, the writer** (`deploy/models-anthropic.mjs`, called from `deploy/models-op.mjs`): the op `aliases-refresh`,
  the Anthropic path for `hold`, `release` and `revert` (`hold.model`, `releasedAt`), `rm` removing the aliases file,
  and `show` answering `aliases`. In `shared/model-advance.mjs`: `seedAnthropicAdvance`, the three optional keys and
  the four cause words.
- **A2.4, the refresh and the push:** `lanes` lists Anthropic rows with `ids` per class. `ccrc models refresh` runs
  `aliases-refresh` per Anthropic lane after the Codex steps and inside the same deadline, and pushes each move as one
  line built by `moveline`. `modelsPushDecision` accepts `telemetry: 'anthropic'`, and the notify route's refusal
  detail names it.
- **A2.5, doctor:** `advance-health` answers Anthropic lanes (blocked causes, held behind, sessions behind through
  `aliasSessionBehind`, and sessions unmeasured). The doctor printer has the new SKIP/PASS wording, the three remedy
  clauses, the release wording for an Anthropic held-behind row, and the `alias-launch-v1` gate.

## A2.1 Step 1: the cache, measured read-only on the fleet box (key paths and value types only)

- **Format.** A current-format file carries `catalog.config.provider_alias_targets`, and each class key holds
  `.default`, the target id (plus `.per_provider.*`, never read). An older-format file has rows and no such map; a
  file named `tok-…` can still be the older format. Each file also has `version` (a number), `fetchedAt` and
  `staleAt`, both numbers of epoch milliseconds, `resolution` (a string or null) and an organisation field, which
  nothing reads.
- **Rows.** The rows are `catalog.config.models[]`. Each row has:
  - `id` and `name` (the label);
  - `min_claude_code_version`, a dotted version, or null or absent;
  - `runtime.effort_levels` (strings) and `runtime.default_effort`;
  - `thinking.type`, which is `effort` or `none`.
  - In the current format, every row has one or the other: a `runtime.effort_levels` list, or `thinking.type` `none`
    with no list. In the older format, no row carries `runtime.effort_levels`.
  - So "takes none" is `thinking.type === 'none'` and parses to `[]`. A row with neither parses to `null`. The parser
    never falls back to `thinking.effort_options`.
- **Build.** Each home's `.last-update-result.json` carries `version_to`, a dotted version; on every home measured,
  `outcome` and `status` were `success`.

## The live gate (wave contract), measured read-only

I measured the branch's `aliases-refresh`, `advance-health` and doctor's four model-advance checks against the fleet
box's own files on 2026-11-20. The scratch home held:

- symbolic links to each Anthropic home's cache directory, `settings.json` and `.last-update-result.json`;
- links to the lane model files and the session registry;
- the roster, read in place.

Every write landed in the scratch home. Nothing was written under the live home, nothing was installed, and no
`--fix` ran. Stand-in names are used below.

- **Lanes:** 17 in all, 2 Codex and 15 Anthropic. Three Anthropic homes have a current cache, and each gets an id for
  all four classes from it (source `cache`, not stale). One home has only an older-format cache (stale, no id). Eleven
  have no cache.
- **Orphaned levels:** one home keeps a saved Fable level under an id that is not the current one, and its file names
  it as `orphaned`.
- **Moves:** no class moved, because a first refresh is a baseline.
- **Doctor:** all four checks PASS.
  - The 12 homes with no id appear as `model-advance-blocked`'s note, "no source until ccd marks alias launches". The
    box's `ccd caps` does not list `alias-launch-v1` yet, because Task A3.2 adds it.
  - Once it does, those 12 WARN with the named cause `alias-source-absent`, which also meets the gate.
  - The real lock path (`_models_lock_path`) raises no `lock-unwritable`.
- **Sessions:** none behind and none unmeasured on the three sourced lanes.

## Departures (named by slug; the coordinator issues numbers)

- **`anthropic-arm-own-module`** (ruled 2026-11-20). The Anthropic arm lives in `deploy/models-anthropic.mjs`, not in
  `deploy/models-op.mjs` as the plan's file lists say. With it inside, `models-op.mjs` grew by 402 net code lines and
  passed 3,000 lines, so the large-file row would have listed it. The line counts before and after the move, and how
  the shared helpers are reached, are in the wave-done mail.
- **`sheet-words-anthropic-holds`.** `pwa/src/accounts/modelsSheetWords.ts` gained sentences for the four refusals a
  hold on an Anthropic lane can print: `alias-source-absent`, `aliases-file-unreadable`, `aliases-file-invalid` and
  `settings-overrides-hold`. `models-verb-codes.test.ts` lists the three codes only `aliases-refresh` prints as another
  op's. Without them, that guard is red. Task A4.3 rewrites the sheet for Anthropic lanes and may reword them.
- **`readme-anthropic-causes`** (a follow-up). Task A2.5 Step 4, the README lines, was not done: the README is held
  under another run's freeze, and its holder refused the edit. It is owed once that freeze lifts.

## Choices the plan left open

- **Resolver:**
  - `cache.fetchedAt` may be null, but only for an older-format cache.
  - An optional `ownUnreadable` input is the only way the file records `cache: {none: 'unreadable'}`.
  - `cacheTarget` keeps the cache's raw target even when the build cannot launch it, so labels read `id`, never
    `cacheTarget`.
  - A tie with the prior `evidenceAt` keeps the prior class whole.
  - `aliasesSourceCause` answers `alias-source-absent` before `alias-cache-stale`.
  - `orphaned` takes the greatest bare id of the family, so key order never decides it.
- **Writer:**
  - A refresh writes the advance file only when it records a move.
  - An advance file that cannot be read refuses the refresh, and neither file is written.
  - A `settings.json` that cannot be read refuses a hold as `settings-overrides-hold`, because it cannot be shown not
    to name the key.
  - `revert` holds at `previous.model` (`by: 'revert'`) and adds no history entry.
  - `aliases-refresh` on a lane that is not Anthropic refuses `not-an-anthropic-lane`.
- **Refresh rows:**
  - Refreshed: `{id, ok: true, aliases: {ok: true, moved}}`.
  - Not run (`budget-deferred`, or `not-capable`): `ok: true` with `aliases.ok: false`, so the run does not fail.
  - Refused: `ok: false` with `reason`, and the run fails.
- **Doctor population:** an Anthropic lane is in `advance-health` only when its aliases file or its advance file
  exists, readable or not, which mirrors a registry lane with no registry file. An absent aliases file is no finding.
- **A window after a revert.** `revert` writes no aliases file, so `unobserved` is set by the next refresh. Until then
  (up to an hour) `model-held-behind` can name a class that was just reverted. It is left as found, for the
  coordinator to rule.
- **Guard 4's held-id half** reads other classes' held ids from `heldRow`. A held model with no cache row is then
  caught only by the family half.

## Inert at merge

`ccrc-models-advance.test.ts`'s case "inert at merge" runs `main`'s `ccd/ccrc` beside this branch's op. It asserts
that `aliases-refresh` is never called and that no aliases file is written. It also reads `main`'s `ccd/ccd` and its
libraries through `spliceCcd`, and asserts that none of them names the aliases file, the launch marker or the module.
A mutation that feeds it this branch's `ccrc` reds it.

## Measured figures

- **Growth.** `ccd/ccrc-doctor-checks` grows by 23 net code lines and `ccd/ccrc` by 39, against the limit of 40 (the
  second after the trim the coordinator ruled).
- **Box environment.** Two `ccrc-install-codex` cases fail on this box with a `browser-mcp` WARN. They fail the same
  way on a clean copy of `main`'s tree, so it is the box, not this wave.

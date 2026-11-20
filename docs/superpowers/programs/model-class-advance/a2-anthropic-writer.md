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
  the four cause words. Until Task A3.4, `hold` and `revert` on an Anthropic lane refuse at the arm's door (D-8820).
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

- **Doctor:** every lane on the box, of both kinds, read PASS on all four checks.
  - The Anthropic lanes whose homes give no id yet appear in `model-advance-blocked`'s PASS as its note, "no source
    until ccd marks alias launches": the box's `ccd caps` does not list `alias-launch-v1` yet (Task A3.2 adds it), so
    no launch can report an id there. Once it does, such a lane WARNs with the named cause `alias-source-absent`,
    which also meets the gate.
  - The real lock path (`_models_lock_path`) raises no `lock-unwritable`.
- **Moves:** none, because a first refresh is a baseline.

## Departures

Defined in the plan's "Deviations found", numbers issued by the coordinator in fix round 1.

- **D-8818, `anthropic-arm-own-module`.** The Anthropic arm lives in `deploy/models-anthropic.mjs`, not in
  `deploy/models-op.mjs` as the plan's file lists say. With it inside, `models-op.mjs` grew by 402 net code lines and
  passed 3,000 lines (3,484), so the large-file row would have listed it. After the move it is 2,991 lines, 23 net code
  lines over its merge base, and the arm is 545. The arm imports only `shared/*`; the helpers both files need reach it
  through one `io` object the op builds at load.
- **D-8819, `sheet-words-anthropic-holds`.** `pwa/src/accounts/modelsSheetWords.ts` gained sentences for the five
  refusals a hold on an Anthropic lane can print: `alias-hold-not-applied`, `alias-source-absent`,
  `aliases-file-unreadable`, `aliases-file-invalid` and `settings-overrides-hold`. `models-verb-codes.test.ts` lists the
  three codes only `aliases-refresh` prints as another op's. Without them, that guard is red. Task A4.3 rewrites the
  sheet for Anthropic lanes and may reword them.
- **D-8820.** `hold` and `revert` on an Anthropic lane refuse `alias-hold-not-applied`, writing nothing, until Task
  A3.4 makes ccd apply a held id at launch; `release` stays open. The gate is one constant, `ANTHROPIC_HOLDS_APPLIED`
  in the arm. The hold path behind it is whole, and its tests run through a copy with the gate open
  (`server/test/modelsOpCopy.ts`'s `holdsAppliedOp`). A test of the shipped op, and one through `ccrc models`, red
  when the gate is opened.
- **D-8821.** An Anthropic lane's sessions are named unmeasured with the advance file's own cause,
  `advance-file-unreadable` or `advance-file-invalid`, never one folded word.
- **D-8822.** `shared/model-aliases.mjs` imports `shared/model-advance.mjs` as well as `shared/models.mjs`, and both
  modules name members the plan did not list (`rowLaunchable`, `VERSION_RE`, `heldUnobserved`; `SIDECAR_TS_MAX_S`,
  `AT_RE`, `isAt`), each the one owner of its rule.
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
  - Two readers of a home's `settings.json`, differing legitimately (an opposite safety direction). `settingsDrift`, in
    the op's Codex arm (unchanged), reads it for a REPORT: an absent, unreadable or invalid file all mean "every key
    missing", which it then lists. The arm's `readHomeSettings` reads it to ALLOW a hold, so it keeps absent apart
    from unreadable and invalid and refuses on either of the last two, since such a file cannot be shown not to name
    the class's key. Its refusal never carries the parser's message, which quotes the text around the bad token.
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
- **The window after a revert, closed.** `revert` writes no aliases file, so the file can still call a just-reverted
  class observed. The health reading asks `heldUnobserved` again of the hold standing at its read, the same rule the
  resolver sets `unobserved` with, so a revert right after a recorded move names nothing until a refresh reads
  evidence newer than the hold.
- **Guard 4's held-id half** reads other classes' held ids from `heldRow`. A held model with no cache row is then
  caught only by the family half.

## Inert at merge

`ccrc-models-advance.test.ts`'s case "inert at merge" has two halves.

- **The older ccrc.** It runs the merge base's `ccd/ccrc` beside this branch's op. A positive control shows it reached
  the op, asked for the lanes and answered an empty refresh; the case then asserts that `aliases-refresh` is never
  called and that no aliases file is written. A mutation that feeds it this branch's `ccrc` reds it.
- **The older ccd.** It reads the merge base's `ccd/ccd` and its libraries through `spliceCcd` and asserts that none of
  them names the aliases file, the launch marker or the module. That pins a fact about the ccd this branch merges
  over, which is what "an older ccd" means here; no change on this branch can red it.

## Measured figures

- **Growth.** `ccd/ccrc-doctor-checks` grows by 23 net code lines and `ccd/ccrc` by 39, against the limit of 40 (the
  second after the trim the coordinator ruled). Fix round 1 changes neither file, nor `deploy/models-op.mjs` (2,991
  lines).
- **Box environment.** Two `ccrc-install-codex` cases fail on this box with a `browser-mcp` WARN. They fail the same
  way on a clean copy of `main`'s tree, so it is the box, not this wave.
- **The loopback curl case.** `ccrc-containment`'s case "(h) the loopback curl front" fails on this box with
  `--url=: expected 7 to be 2`, run alone at this branch's tip and run alone at its merge base in a scratch tree: the
  same failure at both, in a file this branch does not touch.

# Wave A4: the console on an Anthropic lane

A task note for the programme ledger (model-class-advance, programme wave 9; Tasks A4.1 to A4.3 of
[the Anthropic arm plan](../../plans/2026-11-18-model-class-advance-anthropic-arm.md), section "Wave A4"), with the
two findings of review 2886 this wave carried (F10, F15). The coordinator folds what it needs into
[the ledger](../model-class-advance.md); this file is not the ledger. The plan's “Deviations found” defines the
coordinator-issued D-8921 through D-8930.

## What landed

- **Task A4.1, the wire.**
  - **The op's `show`.** It gives an Anthropic lane its class labels from the lane's aliases file:
    `anthropicLabels` in `deploy/models-anthropic.mjs`, called from `describe`. `deploy/models-op.mjs` is at 2999
    lines.
  - **Held class.** While a hold stands, a class's `model` is the held id (`hold.model`). The label and levels come
    from `heldRow` only if its id matches; otherwise the label is the held id and the levels are null. `aliasId`
    carries the alias's own id when it differs; the alias's build requirement does not describe the held id (D-8929).
  - **No usable id.** The class stays on the wire with null model, label and levels. The row can still name why an
    alias cannot launch.
  - **New optional fields.** `LaneClassModel` (`shared/models.ts`) gains `takesNoEffort`, `source`, `cacheTarget`,
    `seenId`, `unobserved`, `unlaunchable`, `aliasId` and `orphanedEffort`.
  - **One reader per runtime.** On the server it is `classRow` (`server/src/laneModels.ts`); in the PWA it is
    `asLaneModelsRead`'s `asClassExtras` (`pwa/src/lib/models.ts`). Each keeps a well-formed field, reads an absent one
    as today, and drops a malformed one while keeping the row.
  - **Three answers, never folded.** `readAnthropicShow` answers an Anthropic lane in one of three ways:
    - `read`, when the aliases file was read;
    - `absent` (lane kind `anthropic`), when the file is absent or the op is older and sends no `aliases` key;
    - `unreadable`, when the file is unreadable or invalid.
  - **Takes none.** A row that takes no level rides as `efforts: []` with `takesNoEffort: true`, and a reader asks the
    second first.
- **Task A4.2, labels (amended, below).**
  - **Rows.** On an Anthropic lane, `modelOptions` keeps every class as a row whatever its id, shows the label from the
    read with the class word as sublabel, and keeps the class word as the readback key, so the row lights from the
    family name the pane prints across a release.
  - **Which lane gets this.** The roster's `telemetry: 'anthropic'` decides it, not the list: an external or OpenRouter
    lane carries a class registry and still gets the Anthropic list, and keeps its id readback (slug
    `registry-lane-readback`).
- **Task A4.3, the Models sheet (amended, below).**
  - **Where it opens.** The Accounts screen offers the Models act on an Anthropic lane too. One L1 predicate decides it
    from the roster's lane kind (`modelsActOffered`, `pwa/src/accounts/modelsSheetWords.ts`), and the sheet is told the
    lane is Anthropic by a prop.
  - **What a class card says** (each line from `anthropicFacts`):
    - where its id came from (Claude Code's catalogue, or a launch);
    - both ids when the catalogue and a launch disagree;
    - the held id (from `advance…hold.model`) with the alias's current id beside it;
    - the orphaned saved level;
    - that the class has no id, or that the lane's build is older than its model needs, naming both builds;
    - that the alias's resolution is not observed while the hold stands, on its own held class only.
  - **Held class.** A held class also carries one sentence for D-8820's residual: a supervisor still running the
    previous ccd body launches its sessions without the held model until it restarts, and the update's degraded sweep
    line names it. The sentence is a fact, not an instruction.
  - **The PWA reader keeps the held id.** It now keeps `hold.model`; the reader R4 wrote dropped it (slug
    `pwa-hold-model-reader`).
- **F10.** The server's push-refusal log line says "a codex-kind or Anthropic lane", and its local-mode remedy names
  the Anthropic row's `telemetry` beside the codex exec block, which is kept word for word. Both are pinned in
  `server/test/notify-push.test.ts`. `server/src/server.ts` was under another worker's claim; its holder agreed to the
  two hunks by mail before the edit.
- **F15.**
  - **Where the push moved.** The hourly refresh sends one push per (class, from, to) over every Anthropic lane it
    moved (`_models_aliases_push`, `ccd/ccrc`), after the loop has run them all. The advance records stay per lane.
  - **The line.** It names the lanes in roster order: `lane-a, lane-b: <class> <from> → <to>`.
  - **What reads it.** `modelsPushOf`'s moved shape takes several lanes (the failure shapes still take one),
    `modelsPushDecision` asks the roster about each lane, and the tag joins the lanes. A single-lane line and its tag
    are unchanged.
  - **The pinning test.** Two lanes on one alias move send one push (`server/test/ccrc-models-advance.test.ts`).

## Rulings applied

- **The coordinator's ruling of 2026-11-22 (call 297, the settings audit).**
  - **A4.2 (slug `no-effort-picker-narrowing`).** It builds the labels only. `effortOptions`, `effortIsKnown` and
    `laneClassEfforts` are as on main: no per-class narrowing, no takes-none Auto row, and no new Ultracode placement.
  - **A4.3 (slug `no-hold-release-controls`).** The sheet adds no Hold and no Release on an Anthropic lane. Codex
    lanes keep both controls as they are.
- **Review 3378 (slug `revert-withheld-anthropic`, D-8930).** The Anthropic sheet also withholds Revert, which would
  create a hold the refresh skips and the sheet cannot release. It still shows a standing hold. The
  `revert-holds-until-newer` follow-up gives both arms a Revert whose hold ends when a newer model appears.
- **Departure, slug `models-sheet-file`.** The plan names `pwa/src/accounts/AccountSheet.tsx` for the sheet. The sheet R4
  built is `pwa/src/accounts/ModelsSheet.tsx` with its words in `modelsSheetWords.ts`, and its act is offered from
  `pwa/src/screens/AccountsScreen.tsx`, so those three files carry the task.
- **Departure, slug `no-a11y-file`.** The plan names `pwa/test/a11y-*` for the sheet, and none exists. The browser
  fixture checks horizontal containment at three widths. Before Revert was withheld it also measured the height of
  that button. It did not measure vertical reach. The sheet now offers no class controls on an Anthropic lane.
- **Departure, slug `push-line-multi-lane`.** F15 widens the push line's grammar in `shared/models.mjs` and
  `shared/models.d.mts`, which the wave's file list does not name.
- **Departure, slug `labels-in-arm-module`.** The op's `describe` calls the projector in the Anthropic arm instead
  of growing an inline block past the op's limit.
- **Departure, slug `held-drops-unlaunchable`.** The alias's build requirement is not a fact about the held id.

## Screenshots

From `pwa/browser/models-sheet-anthropic.browser.test.ts` in Chromium, against the production build with fixture data
only. The lane is `lane-a`, the model ids are invented, and one class is held with the alias moved since. Another class
has no id, one cannot be launched by the lane's build, and one is on a cached id with the catalogue and a launch
disagreeing.

- Phone, 360x740: [top](../../../design/2026-10-13-model-class-auto-advance-design/models-anthropic-360.png) and
  [scrolled to the end](../../../design/2026-10-13-model-class-auto-advance-design/models-anthropic-360-end.png)
- Laptop, 1280x800: [models-anthropic-1280.png](../../../design/2026-10-13-model-class-auto-advance-design/models-anthropic-1280.png)
- Wide, 1920x1080: [models-anthropic-1920.png](../../../design/2026-10-13-model-class-auto-advance-design/models-anthropic-1920.png)

At each width the fixture checks that the sheet and its cards do not overflow horizontally and that there are no
Hold, Release or Revert buttons. It does not measure vertical reach.

## Inert at merge

- **New server, older op.** The op sends no `aliases` key, so the lane reads `absent` as today. This pair is tested: "the
  aliases state words keep three answers" in `server/test/lane-models-op.test.ts`.
- **New PWA, older server.** The class rows come without the new fields and read exactly as today. This pair is tested:
  "an older server's answer reads as today" in `pwa/test/models.test.ts`.
- **New server, op older than this wave.** An older op prints the parsed aliases file beside `labels: null`; the server
  reads that lane `absent` as before, never `unreadable`, so a server rolled out first changes nothing ("an older op
  that sends the aliases file but no labels reads the lane absent, as before").
- **Older PWA, new server, until the page reloads (untested).** The older PWA ignores the new fields and still opens
  Models only on Codex lanes. When it sees the new Anthropic `read` response, it keys picker rows on model IDs
  rather than family words: the active row is not lit and classes without an ID drop out. On a session with a
  recorded class route, the queued badge can also stay on even after the session is running that class. These
  differences last until the console reloads the PWA the server now serves.
- **Older server, new fleet box (F15).** A line naming several lanes is read as not a model line, so that move gets its
  banner and one log line but no phone push until the server box is updated. A single-lane move is unchanged.

## What the review pass changed

Three per-task reviewers read the build before the push. Nothing was blocking. These were fixed in the same push, each
test red first or proved by a mutation that turned it red:

- **Older op, newer server.** A parsed aliases file beside `labels: null` reads `absent`, not `unreadable`.
- **Unlaunchable alias on a held class.** A held class no longer carries its alias id's build need (`unlaunchable`). It
  launches on the held id, and `aliasId` names the alias's id.
- **No Hold or Release, decided in L1.** `classActs` decides it from the lane kind, so a missing flag can no longer
  draw them.
- **The four Anthropic hold refusals** (D-8819's sentences) now state facts and ask no hand act.
- **The supervisor sentence** is conditional ("If a session supervisor … still runs the previous ccd build …").

The held-out review (3378) led to three further fixes: `classActs` withholds Revert on Anthropic lanes and the unused
confirmation text is gone; `anthropicLabels` refuses to borrow metadata from a mismatching held row; and the refresh
logs each group it skips at its deadline.

## Residuals (no ask; the coordinator's to place)

- **No screen-level test of the Models act on an Anthropic lane.** The Accounts screen's test file is under another
  worker's claim. What covers the gate instead:
  - the L1 predicate's tests (`modelsActOffered`, `modelsSheetAnthropic`);
  - the new browser test, which opens the sheet from an Anthropic lane's fold. It runs in the merge queue, not on a
    pull request.
- **The server's over-cap log detail.** It still names a failure line with long ids as the one shape over the cap, and a
  moved line naming many lanes can pass the cap now too. `server/src/server.ts` was edited under another worker's
  consent for the two F10 hunks only, so that third wording waits.
- **Push budget.** The grouped push runs after the last Anthropic lane, on that lane's tail reserve: about 44 s, and 13 s
  per push. Past about three groups the refresh can run out of time. A group skipped before the hook gets neither a
  banner nor a phone push; the refresh logs the skipped group and its per-lane advance records still stand.
- **Historical plan prose.** D-8751 and Task A2.4 describe the earlier one-push-line-per-lane behavior. D-8927 records
  F15's grouped shape.
- **Over-cap push lines.** A moved line naming many lanes with long ids can pass `MODELS_PUSH_MAX` (300), and is then
  refused the phone push as `over-cap`, though the banner still goes out. The line is not split under the cap.
- **The server's test-file typecheck did not run here.** The test slice's memory cap killed it on every attempt while
  the box was loaded. The server's and the PWA's source typechecks are clean, and CI runs the test-file typecheck.

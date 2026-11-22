# Wave A4: the console on an Anthropic lane

A task note for the programme ledger (model-class-advance, programme wave 9; Tasks A4.1 to A4.3 of
[the Anthropic arm plan](../../plans/2026-11-18-model-class-advance-anthropic-arm.md), section "Wave A4"), with the
two findings of review 2886 this wave carried (F10, F15). The coordinator folds what it needs into
[the ledger](../model-class-advance.md); this file is not the ledger. Departures are named by slug; the coordinator
allocates any number.

## What landed

- **Task A4.1, the wire.**
  - **The op's `show`.** It gives an Anthropic lane its class labels from the lane's aliases file:
    `anthropicLabels` in `deploy/models-anthropic.mjs`, called from `describe`. `deploy/models-op.mjs` is at 2999
    lines.
  - **Held class.** While a hold stands, a class's `model` is the held id (`hold.model`) with its `heldRow`'s label and
    levels, and `aliasId` carries the alias's own id when it differs.
  - **No id, or unlaunchable.** Such a class is a row of nulls.
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
  - **A4.3 (slug `no-hold-release-controls`).** The sheet adds no Hold and no Release on an Anthropic lane. Revert is
    offered when the box says it can, and Codex lanes keep Hold and Release as they are.
- **Departure, slug `models-sheet-file`.** The plan names `pwa/src/accounts/AccountSheet.tsx` for the sheet. The sheet R4
  built is `pwa/src/accounts/ModelsSheet.tsx` with its words in `modelsSheetWords.ts`, and its act is offered from
  `pwa/src/screens/AccountsScreen.tsx`, so those three files carry the task.
- **Departure, slug `no-a11y-file`.** The plan names `pwa/test/a11y-*` for the sheet, and none exists. The sheet's
  controls are measured in a real browser instead, by the new browser test below: named, at least 44px tall and inside
  the sheet at every width.
- **Departure, slug `push-line-multi-lane`.** F15 widens the push line's grammar in `shared/models.mjs` and
  `shared/models.d.mts`, which the wave's file list does not name.

## Screenshots

From `pwa/browser/models-sheet-anthropic.browser.test.ts` in Chromium, against the production build with fixture data
only. The lane is `lane-a`, the model ids are invented, and one class is held with the alias moved since. Another class
has no id, one cannot be launched by the lane's build, and one is on a cached id with the catalogue and a launch
disagreeing.

- Phone, 360x740: [top](../../../design/2026-10-13-model-class-auto-advance-design/models-anthropic-360.png) and
  [scrolled to the end](../../../design/2026-10-13-model-class-auto-advance-design/models-anthropic-360-end.png)
- Laptop, 1280x800: [models-anthropic-1280.png](../../../design/2026-10-13-model-class-auto-advance-design/models-anthropic-1280.png)
- Wide, 1920x1080: [models-anthropic-1920.png](../../../design/2026-10-13-model-class-auto-advance-design/models-anthropic-1920.png)

At each width nothing scrolls sideways, nothing a card holds leaves it, and the one control, Revert, is inside the sheet.

## Inert at merge

- **New server, older op.** The op sends no `aliases` key, so the lane reads `absent` as today. This pair is tested: "the
  aliases state words keep three answers" in `server/test/lane-models-op.test.ts`.
- **New PWA, older server.** The class rows come without the new fields and read exactly as today. This pair is tested:
  "an older server's answer reads as today" in `pwa/test/models.test.ts`.
- **Older PWA, new server.** The older PWA ignores the new fields. Its sheet opens on Codex lanes only, and its picker
  keys Anthropic rows on ids, which no row lit before either.
- **Older server, new fleet box (F15).** A line naming several lanes is read as not a model line, so that move gets its
  banner and one log line but no phone push until the server box is updated. A single-lane move is unchanged.

## Residuals (no ask; the coordinator's to place)

- **Revert's confirm and the absent Release.** Revert's confirm still says the class is held "until you release it",
  and an Anthropic lane's sheet has no Release. The ticket `revert-holds-until-newer` changes Revert's hold for both
  arms.
- **Over-cap push lines.** A moved line naming many lanes with long ids can pass `MODELS_PUSH_MAX` (300), and is then
  refused the phone push as `over-cap`, though the banner still goes out. The line is not split under the cap.
- **The server's test-file typecheck did not run here.** The test slice's memory cap killed it on every attempt while
  the box was loaded. The server's and the PWA's source typechecks are clean, and CI runs the test-file typecheck.

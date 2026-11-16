# The session model picker names its models from the lane registry

**Defect.** On a session that runs on the gpt lane, the "Choose a model" sheet listed four model names that the lane
no longer ran. Its registry had moved every class to a newer model, and the catalogue had labels for them. The cause
was in `pwa/src/lib/models.ts`. `modelOptions` hard-coded one label per class for each list: four names for the gpt
lane and four more for the Anthropic list. Its comments repeated the same names. Every model advance left the picker,
the new-session sheet's Class choice and the routing line one release behind, until someone edited a label by hand.

**Fix (D-8406).** The lane registry is the one owner of which model a class maps to. The catalogue owns what that
model is called. This tree spells no model name.

- `shared/models.mjs` spells the models directory and the two file names once (`MODELS_DIR_NAME`, `registryFileName`,
  `catalogueFileName`; `deploy/models-op.mjs` now builds its paths from them). It also defines the read grant's shape
  (`isLaneModelsReadName`) and the derivation `laneClassModels(registry, catalogue)`: each class's model, plus the
  catalogue's label for that model. These are the facts `ccrc models <lane> show` prints. The wire types
  (`LaneClassModel`, `LaneModelsRead`, `LaneModelsAnswer`) live beside them in `shared/models.ts`.
- `GET /api/models/:lane` (`server/src/laneModels.ts`) reads the two files through the fleet's `read` op. An
  unrostered lane is `not-found` before any path is built. The two non-readings stay apart: a lane with no registry is
  `absent`, and a registry that cannot be read is `unreadable`. A missing catalogue costs only the labels. The route is
  session-gated, not EXEMPT, and takes no box token.
- The agent admits exactly those two names in `~/.ccrc/models`, for read only (`isLaneModelsFile`). It uses the node
  files' canonical-path equality, so a symlink at either name, or a symlinked `models` directory, is refused.
- The PWA reads the route through `useLaneModels`, with `asLaneModelsRead` as its one wire guard and the screen cache
  for a second visit. `modelOptions(wrapper, lane, current, routing?)` takes that read. Each row's label is the
  catalogue label of the model the registry maps its class to, and its sublabel is the class name ("Opus class").
  Its readback key is the registry's model id. Matching is loose (case, punctuation and a context suffix are folded),
  and the longest matching key wins. A class the registry marks unavailable has no row. With no read, an `absent` or
  an `unreadable` one, each row is its class name alone, never a remembered model name.
  - The Anthropic list keeps its family-word readback.
  - The dedicated list has none, so a class it cannot name is never shown as pending.
  - The order, the route value a tap sends, the `Default` row and the degraded note are unchanged.
- `pwa/test/model-name-census.test.ts` fails on a model display name (`GPT-<n>`, `Opus <n>`, `Sonnet <n>`,
  `Haiku <n>`, `Fable <n>`) anywhere in `pwa/src` outside tests, comments included.
- `pwa/browser/model-sheet-labels.browser.test.ts` checks the sheet at 360, 390, 1280 and 1920 px, in both skins and
  both palettes. It uses a long catalogue label. The label wraps inside its row, and nothing runs past the sheet or the
  page.

## Deviations found

- **D-8406 (2026-11-13)** — `model-picker-from-registry`: the session model picker, the routing line and the
  new-session sheet name a class's model from the lane's registry and catalogue (`GET /api/models/:lane`), never from
  a name in code. This is the Codex half of the auto-advance design's D17 ("labels from data"). It departs from that
  design's D14 in one respect. D14 moved the Models panel's read onto a planned agent `models` op (`show`), which is
  unbuilt. This change reads the two files through the agent's existing file read instead, which was the approved
  Section 4 path before D14. The new grant admits exactly two names per lane, for read only. Neither file holds a
  secret, and a wire-triggered spawn would be a heavier security surface than one read grant. When the `models` op
  lands, its `show` carries the same facts. `readLaneModels` then moves onto it, and the grant is retired in the same
  change, so there are never two readers. The Anthropic half of D17 (labels from a lane's `aliases.json`) waits on
  that file, which D18 has not ruled. Until then, an Anthropic lane's rows read their class names, and the family-word
  readback keeps the active row and the pending check working.

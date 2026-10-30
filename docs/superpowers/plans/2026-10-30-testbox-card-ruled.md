# The test box card: its read seam and its width bands

One departure found by TB10 of the test box plan (`docs/superpowers/plans/2026-10-29-test-box.md`, D-7412) while
building the Settings card. The ledger issued the number on 2026-10-30.

- **D-7566 (2026-10-30)** — `testbox-card-read`: the Test box card reads the block through its own read hook and wire guard. It picks its width band through the desk query and a wide query, and sets that band on the card.

**What the plan names, and what the build adds.** The plan's Files list for TB10 names `TestBoxSection.tsx`,
`AutomationSection.tsx`, `SettingsDataProvider.tsx` (a `testbox` poll in the view) and `settingsText.ts`. A poll in the
view needs a hook and a client call, as every other Settings read has. So the build adds:

- `pwa/src/fleet/useTestboxView.ts`, the read hook. It has `useDispatchAbandonView`'s shape and runs through the one
  poll primitive (`usePoll`).
- Three `api` methods in `pwa/src/lib/api.ts`: `testbox`, `setTestboxSwitch` (which sends `{on}` and nothing else) and
  `testboxToolsSync` (which sends no body).

The block's type belongs to the server's L1 decider (`server/src/testbox.ts`), and the PWA never imports
`server/src`. So the hook restates the fields the card draws, and `asTestboxBlock` is their one guard. The box's status
answer goes through `shared/testbox.ts`'s one frame reader. A block this build cannot read counts as a failed read,
never as a half-drawn card. No server route or shared wire type changes: the card uses only what TB9 shipped (D-7411,
D-7554, D-7555).

**The width bands.** Spec §2.7's table gives the card a different layout at phone, laptop and wide widths, and at
phone a disclosure that the other two do not have. A stylesheet cannot remove an element, so the band is read once in
`TestBoxSection`:

- phone below the desk width (`useDesk`, `DESK_QUERY`);
- wide from `TESTBOX_WIDE_QUERY`, the shell's 1600 px;
- laptop between the two.

The card carries the band as `data-band`, and `settings.css` gives each band its layout. jsdom can then hold the
table's structure row by row (`src/fleet/TestBoxSection.test.tsx`), and Chrome holds its geometry
(`browser/testbox-card.browser.test.ts`). Spec §2.7 names no home for the counts, the pristine installs or the failed
keys at the laptop width. The build keeps the versions table open there and puts the rest behind one disclosure. At the
wide width the versions table and the pristine-installs table sit open side by side.

**Bring tools up to date stays visible while a sync runs.** The plan shows the button "when a tool differs or the last
sync failed", reading `syncing <tool>` while the sync runs. The button stays visible while the box reports `syncing`,
or while the page's own request is in flight, even if no cell differs. The `syncing <tool>` label therefore stays in
place until the sync ends.

**The count.** The plan counts the Automation cards as 3 → 4, plus #1844's cards. #1844 and #1900 (D-7453) have both
merged, so the measured count is 5 → 6, with the Test box card last (D-7418).

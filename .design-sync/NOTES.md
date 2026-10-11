# design-sync notes — @ccrc/ui

Repo-specific gotchas a sync run should know before it starts.

## The package ships source; `dist/` exists only for this sync

`exports['.']` points at `./src/index.ts` and must stay that way — `pwa` consumes the
source (Tailwind's `@source` scans the `.tsx`, and pwa's vitest carries
`server.deps.inline: ['@ccrc/ui']`). `npm run build` in `ui/` emits `dist/` for the
converter alone. Always pass `--entry ui/dist/ui/src/index.js`.

The `dist/` tree is NESTED — `dist/ui/src/**` beside `dist/shared/**` — because
`status-dot.tsx` type-imports `SessionBucket` from `../../../shared/api`, which makes the
repo root the real common source directory (`tsconfig.build.json` pins `rootDir: ".."`;
without it tsc refuses with TS5011).

**That nesting broke the first converter run and cost a full rebuild.** `findTypesRoot`
looks for `.d.ts` files directly inside `dist/`, finds none (they are two levels down),
falls back to the package dir, and enumerates zero exports — every storybook title then
drops as `[TITLE_UNMAPPED]` and the build emits 0 components while still exiting 0. The
fix is the `"types": "./dist/ui/src/index.d.ts"` field in `ui/package.json`. Do not
remove it. It is inert for `pwa`, which resolves types through `exports`.

## Accepted: the mono families are a system stack, not missing webfonts

`[FONT_MISSING]` names Cascadia Code, JetBrains Mono and Roboto Mono. **Operator
accepted substitutes on 2026-09-29**, and the reasoning is that they are not substitutes:
all three are middle entries in `--family-mono`, whose head is
`ui-monospace, "SF Mono"` (resolves on macOS) and which reaches `Consolas` on Windows and
terminates at `monospace` everywhere. ccrc ships no webfonts by design — mono is the
machine's voice in the platform's own face. Shipping one of the three would CHANGE the
design rather than repair it.

Re-check only if `tokens.css` starts naming a real brand face.

## [GENERAL] The storybook style entry must layer the reset, like the app does

**Symptom:** every Button story rendered with no background fill and square
corners, on BOTH panels — so the compare sheets looked consistent and would have
graded as a false `match`. `min-h-tap` (44px), `text-base` (16px), `font-ui` and
`flex` all applied normally.

**Root cause:** `.storybook/preview.ts` imported `reset.css` as a plain JS
import, which loads the vendored Tailwind preflight UNLAYERED. Unlayered rules
beat every cascade layer, so preflight's `button { background-color: transparent }`
and `border-radius: 0` won over `@layer utilities`'s `.bg-accent` and
`.rounded-md`. Only the properties preflight touches were affected, which is why
it looked like partial styling rather than missing CSS.
`pwa/src/styles/base.css` always imported it as `layer(base)` — the divergence
between the app's load order and Storybook's is what kept the bug invisible.

**Fix:** `ui/.storybook/preview.css`, two lines mirroring base.css
(`@import theme.css` then `@import reset.css layer(base)`), imported from
preview.ts instead of the two JS imports.

**Found by this sync**, not by the 2280 tests or the contrast gate: the gate
reads the stylesheets, and no test screenshots a story. Diagnosis was a
computed-style probe of the built storybook, not the sheets — the sheets agree
when both sides are wrong the same way.

## Overlay components render as single cards

`Sheet`, `QuickConfirm` and `ToastHost` all position content with `fixed`/portals, so no
grid layout can present their stories side by side (`[GRID_OVERFLOW]`). Each carries
`cfg.overrides.<Name> = {cardMode: "single", primaryStory: ...}`. The primaries are the
archetypes, not the edge cases: `Sheet` → `WithTitle` (not `LongTitle`/`FullWell`),
`QuickConfirm` → `Stop` (the story whose doc comment carries the component's thesis:
the consequence sentence does the work), `ToastHost` → `WithAction`.

## `Toast` is titled for the story, exported as `ToastHost`

`cfg.titleMap = {"Toast": "ToastHost"}`. The module also exports a bare `toast()`
function, which is not a component and correctly does not get a card.

## `_ds_bundle.css` comes from the reference storybook

There is no `cfg.cssEntry`: the package's CSS entry is `styles/theme.css`, which holds
Tailwind v4 directives rather than compiled output, so pointing `cssEntry` at it would
ship uncompiled CSS. `[CSS_FROM_STORYBOOK]` picks up the storybook's own compiled
`iframe-*.css` instead, which is the real generated utility set. This is deliberate.

## If a history rewrite ever runs on this branch, re-stage before syncing

`git filter-branch` (used once, 2026-09-30, to purge 11 MB of build artifacts a
stray `git add -A` had tracked during a rebase) updates the WORKING TREE as well
as history: files tracked in the old HEAD and absent from the new one are
deleted from disk. That emptied `ds-bundle/`, `.design-sync/sb-reference/` and
the staged `.ds-sync/*.mjs` scripts, while leaving `.ds-sync/node_modules` — so
the next converter run failed with `Cannot find module .ds-sync/package-build.mjs`
rather than anything sync-shaped.

Recovery is the §2.4 `cp -r` line plus a storybook rebuild; nothing is lost,
because all three are regenerable. What DID survive, and what matters:
`.design-sync/.cache/compare/*.grade.json` (all seven grades) and the durable
set. A second trap follows immediately: the converter refuses
`[OUT_UNSAFE]` on a `ds-bundle/` left as empty directories — `rm -rf ds-bundle`
first, it is regenerable output.

## Re-sync risks

- **The `types` field and the nested `dist/`.** If anyone flattens the build or drops
  `types`, the converter silently emits 0 components again. Exit code stays 0 — check the
  `components:` line in the build log, never the exit code.
- **`_ds_bundle.css` is downstream of the reference storybook build.** A stale
  `.design-sync/sb-reference` therefore means stale component CSS, not just a stale
  grading oracle. Rebuild the reference whenever `ui/src` changes.
- **The contrast gate does not reach Claude Design.** `pwa/design/audit.mjs` runs over
  this repo's stylesheets; designs the agent produces are outside it. A canvas can show a
  pair the gate would refuse. That is caught at the code step, not the design step.
- **Wave 2 landed 2026-09-29 and `legacy.css` is gone.** The call sites now use the
  primitives directly, so the gate moved `482 -> 462` on purpose: twenty pairs left the
  census because they were duplicate rules, not because anything regressed. If a future
  run sees 482 again, something re-introduced a duplicate stylesheet.
- **`Button`'s reduced-motion handling lives in the cva now, nowhere else.** legacy.css's
  `prefers-reduced-motion` block used to carry it. Same for the 0.85 opacity pin's
  measurement, which now exists only as a comment in `status-dot.tsx` — the utility is
  invisible to a gate that reads stylesheets, so that comment is the record.
- **Seven scoped descendant rules select on the hook classes** (`.block-screen
  .btn-primary`, `.acct-list ... .limit-fill`, ...) from `fleet.css`/`chat.css`/
  `shell.css`, which are imported UNLAYERED and therefore beat `@layer utilities`. Keep
  `btn-primary`/`btn-ghost`/`limit-fill` on the components.

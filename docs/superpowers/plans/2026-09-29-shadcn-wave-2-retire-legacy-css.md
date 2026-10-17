# shadcn wave 2 — the call sites take the primitives, and legacy.css retires

**Goal:** empty `pwa/src/styles/legacy.css`. Wave 1 moved the seven primitives into
`@ccrc/ui` but left legacy.css carrying a copy of their rules so unmigrated call sites
kept working. This wave migrates those call sites and deletes the copies.

**Why it matters beyond tidiness:** the contrast gate's `ALL 482 PASS` is currently
flattering, and wave 1's own commit message says so. The migrated components' real pairs
(`bg-accent` on `text-ink-on-accent`) are already invisible to the census — the 482 holds
only because legacy.css still carries duplicate rules the gate can see. Emptying it makes
the number honest, and the number is expected to MOVE. A drop is the correct outcome, not
a regression to paper over.

## Design

**Posture:** none

**Why:** this wave changes no visual output. Every swap is measured identical below —
`.btn-primary`'s declarations and the `Button` cva base are the same set, token for
token. A design canvas would depict a screen that is deliberately unchanged.

## Measured scope, 2026-09-29

The pre-compaction estimate of "~45 components each losing its `useStore()` call" was
wrong and is corrected here: there are **3** `useStore()` sites in the whole tree, and
none of them is what this wave touches.

| Batch | Sites | Files |
|---|---|---|
| B1 — `btn-primary` / `btn-ghost` -> `<Button variant>` | 54 | 16 |
| B2 — `qc-consequence` / `qc-actions` | 8 | 3 |
| B3 — `.dot*` | **0 hand-written** | — |
| B4 — `limit-track` / `limit-fill` -> `<LimitBar>` | 2 | 1 (`SwapSheet`) |

B3 is empty because `tool-dot--*` (chat.css) is a different vocabulary: legacy's `.dot*`
rules are already pure duplicates of `dotVariants`, reachable only through the hook
classes the new component carries.

## The swap is exact

`.btn-primary` declares `display:flex`, `align-items/justify-content:center`,
`min-height:var(--tap-min)`, `width:100%`, `border:none`, `border-radius:var(--r-md)`,
`background:var(--accent)`, `color:var(--ink-on-accent)`, `--weight-semibold --fs-base
--family-ui`, `cursor:pointer`, `transition:transform var(--dur-press) var(--curve-swift)`,
`:active:not(:disabled)` scale .97, and a disabled pair of `--edge-subtle`/`--ink-disabled`.

`buttonVariants`' base plus its `primary` variant is that same set, as utilities.
`Button` extends `ButtonHTMLAttributes`, defaults `type="button"` and merges `className`,
so every call site's props carry over untouched.

**One measured difference, accepted:** legacy sets `line-height:1` through the `font:`
shorthand; `text-base` brings its own. With `min-h-tap` (44px) against a 15px font the
min-height dominates, so single-line buttons do not move. A button whose label WRAPS
would grow. No current call site wraps.

## Three things that must not break

1. **Structural hook classes stay.** `fleet.css:526` (`.acct-list ... .limit-fill`),
   `fleet.css:919` (`.sess-line--active .sess-lamp > .dot`) and `chat.css:83`
   (`.chat-meta .dot`) are descendant rules in ANOTHER package's stylesheet. The new
   components carry `.dot` / `.limit-fill` as selectors-only. Deleting the legacy RULE is
   safe; dropping the hook CLASS is not.
2. **`legacy.css` is imported `layer(components)`.** Utilities beat it, which is what let
   migrated and unmigrated call sites coexist. As it empties, that import goes too.
3. **Tests target the legacy class names.** `.qc-actions .btn-primary` is how several
   tests find a button. Those selectors must keep resolving — the hook classes are why
   they do.

## Tasks

- [x] **Task 1 — B1, the 16 files.** Swap each `<button className="btn-primary|btn-ghost">`
      for `<Button variant>`; extra classes move to `className`. Suite green after.
- [x] **Task 2 — B2, the three sheets.** `qc-consequence`/`qc-actions` call sites.
- [x] **Task 3 — B4, `SwapSheet`'s hand-drawn bar** -> `<LimitBar>`.
- [x] **Task 4 — retire the migrated rules from legacy.css**, drop the import when empty.
- [x] **Task 5 — re-measure the gate and RECORD the new number**, whatever it is, with
      the delta explained. Update wave 1's flattering-number note.

## Measurements

- **The gate moved, as predicted: `ALL 482 PASS` -> `ALL 462 PASS`.** Twenty pairs left
  the census because they were legacy.css's duplicate copies of rules that are now
  utilities, and `design/audit.mjs` reads stylesheets. Nothing regressed and no pair got
  worse; the gate simply stopped counting rules that no longer exist. **462 is the honest
  number** wave 1's commit said 482 was not.
- Suite: **2278 of 2278** (was 2280 — `it.each(stylesheets(ROOT))` generates one case per
  discovered sheet, and legacy.css is no longer discovered).
- `tsc --noEmit` clean in both packages; production build green; storybook build green.
- Built CSS verified to still carry every utility the swap depends on: `bg-accent`,
  `text-ink-on-accent`, `min-h-tap`, `rounded-md`, `bg-limit-ok`, `gap-2`, `mb-5`,
  `leading-normal`.

## Two silent losses caught before they shipped

Both would have passed the suite and the gate.

1. **`Button` had no reduced-motion handling of its own.** legacy.css's
   `@media (prefers-reduced-motion: reduce)` block was carrying `.btn-primary`/`.btn-ghost`,
   and the cva never did. Deleting the block would have dropped it silently.
   `motion-reduce:transition-none` added to the base and to the ghost variant.
2. **The 0.85 measurement had only one home.** `StatusDot` carried
   `motion-reduce:opacity-85` but not the reasoning that chose 0.85 over 0.8 — the
   measured 2.88-at-0.8 light-theme failure, and the four grounds reading down to 3.10.
   That lived only in legacy.css's comment. It now lives in `status-dot.tsx`, which is the
   only record left, because the utility is invisible to the gate.

## What the gate itself forced

`audit.mjs:1075` fails on a **stale registry entry** — a registry that outlives its rule.
So the four `legacy.css` keys (`.btn-ghost` grounds, two disabled-control exemptions, and
the `.dot--busy/.dot--attention 0.85` opacity entry) had to retire in the same commit as
the rules. The coupling is deliberate and it worked: it is why this was a careful deletion
rather than an `rm`.

`contrast.test.ts`'s registered-fade mutation case was retargeted rather than deleted — it
mutated legacy.css's 0.85, so it moved to `chat.css`'s `.pending-send-it:disabled` 0.6,
the one registered fade left in the audited set. The mechanism it guards is unchanged.

## What deliberately stayed

- **The structural hook classes.** `Button` still carries `btn-primary`/`btn-ghost`,
  `LimitBar` still carries `limit-fill`. Seven scoped descendant rules in `fleet.css`,
  `chat.css` and `shell.css` select on them (`.block-screen .btn-primary { width: auto }`,
  `.acct-list .acct-row[data-disabled='true'] .limit-fill`, ...), and several tests find
  buttons through `.qc-actions .btn-primary`. Those stylesheets are imported UNLAYERED, so
  they beat `@layer utilities` — which is what makes a contextual override still win.
- **`.typed-caret` moved to `fleet.css` rather than dying.** It was never a primitive,
  `TypedLabel.tsx` still renders it, and fleet is its only consumer.
- **`SwapSheet`'s `Gauge` is not a `LimitBar`.** Its layout differs (label/track/pct in
  separate cells vs the component's `20px 1fr 40px` row), so swapping the component in
  would have changed the design. It reuses the vocabulary instead: `fillVariants` and
  `TRACK` are now exported from `limit-bar.tsx`, beside `buttonVariants` and `dotVariants`,
  so there is one definition of the bar rather than two that drift.

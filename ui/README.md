# @ccrc/ui — Phosphor & Ink

The design system behind ccrc's console: the tokens, the Tailwind theme that
exposes them as utilities, and the shared components. The app consumes
**source** — `exports['.']` points at `src/index.ts` and the consuming app's
vite compiles it, so there is no `dist` for `pwa` to go stale. (`npm run build`
does emit one, for a single reader: the /design-sync converter. Nothing in the
app resolves it.)

    cd ui && npm ci && npm run storybook      # every component, every state

Storybook's toolbar carries the things the system is actually about: the
**theme** switch (every palette, dark and light), the **skin** switch (Refined
and Instrument, below) and the **viewport**, whose presets are the widths
every change is checked at: phone 360, 390 and 438, laptop 1280 and 1470, and
wide 1920. The a11y addon runs axe against each story.

## Using it

    import { Button, Sheet, StatusDot } from '@ccrc/ui';

One stylesheet entry point, and the order matters:

    @import '@ccrc/ui/styles/theme.css';              /* MUST come first */
    @import '@ccrc/ui/styles/reset.css' layer(base);  /* MUST be layered */

`theme.css` carries Tailwind's own `@import`s and pulls `tokens.css` in itself.
CSS drops an `@import` that follows any rule, so importing anything with rules
ahead of it discards Tailwind silently — the build succeeds and emits zero
utilities. The reset goes in `layer(base)` because an unlayered reset outranks
every layered rule, including the utilities it is supposed to lose to.

## The rules the palette is built on

- **GLOW MEANS LIFE.** Only `busy` and `attention` emit light. Nothing else
  glows — not an account, not `done`, not `cleanup`.
- **Two cues per state, never colour alone.** A status carries a word *and* a
  glyph; that is what keeps `done` from fusing with `idle`.
- **Mono is the machine's voice**, sans is human prose. Paths, ids, account
  names, limits and timestamps are mono; chat, buttons and dialog copy are sans.
- **Wells are cut into the interface** and stay dark in both themes.
- **Tokens are the only source of colour.** `theme.css` maps, it never defines:
  every entry is `var(--token)`. That is what makes `[data-theme='light']`
  re-resolve, and it is checked — `pwa/design/contrast-check.mjs` parses these
  stylesheets and measures every pair in both themes.

## Adding a token

Add it to `tokens.css`, then map it in `theme.css`. Check the name against
Tailwind v4's namespaces first: `--text-*`, `--font-*`, `--leading-*`,
`--tracking-*`, `--shadow-*` and `--ease-*` are Tailwind's, and a collision
makes `@theme inline` emit a circular reference that CSS drops — silently, in
one theme. That is why the local families are spelled `--fs-*`, `--family-*`,
`--lh-*`, `--ls-*`, `--elev-*` and `--curve-*`.

Then check the KEY, the utility's spelling, against every namespace its
utility reads, not just its own. `text-*` reads `--color-*` as well as
`--text-*`, `font-*` reads `--font-weight-*` as well as `--font-*`, and `w-*`
and `max-w-*` read Tailwind's `--container-*` beside `--spacing-*`. A key two
of them share compiles as whichever one Tailwind tries first, with no warning.
That is why the page title's role is `text-title` and not `text-page`: `page`
is the page ground's colour, so `text-page` paints text in it.
`pwa/test/skin-catalogue.test.ts` compiles every key the bridge maps, and
every key of Tailwind's own theme, through every utility that reads it, and
reds on a key that another namespace claims, whichever side loses.

## Skins

The skin is a third axis beside the palette and light/dark (D-5093):
`data-skin` on `<html>`, `refined` or `instrument`. A skin varies density,
structure and chrome. It never varies colour: colour is the palette's axis,
and the contrast gate measures each palette once, for both skins.

- `src/styles/skins.ts` holds the catalogue (`SKINS`), the storage key
  (`SKIN_STORAGE_KEY`, `ccrc-skin`), the closed list of tokens a skin may
  override (`SKIN_TOKENS`, by class), `resolveSkin` and `applySkin`.
- `src/styles/skins.css` holds Instrument's values as
  `:root[data-skin='instrument']` blocks. Refined is `:root` itself and has no
  block. The selector's (0,2,0) specificity outranks every palette block, so
  source order never decides a tie. Two rules follow from that:
  - Every duration sits inside `@media (prefers-reduced-motion: no-preference)`,
    because the same specificity would otherwise beat `:root`'s reduced-motion
    block and re-animate the app.
  - `--row-h` is 44px, and 32px only inside `@media (pointer: fine)`, so a
    coarse pointer, or one reporting `pointer: none`, keeps the tap floor.
- The attribute is always stamped, Refined included, unlike Phosphor's palette,
  which is stamped by absence. The app's half is `pwa/src/lib/skin.ts`
  (`setSkin`, `initSkin`, `useSkin`), and `pwa/index.html` stamps the stored
  value before first paint.
- **The roles.** `tokens.css`'s `:root` declares the type and density roles at
  Refined's values (`--fs-ui`, `--fs-prose`, `--fs-meta`, `--fs-page`, the
  `--*-section` set, `--gutter`, `--row-h`, `--pad-card`, `--gap-section`,
  `--page-max`, `--page-max-wide`, `--measure-chat`). Each one chooses a step
  from a scale, so it adds no new size. `theme.css` maps them as `text-md`
  (the 14px scale step), `text-ui`, `text-prose`, `text-meta`, `text-title`
  (the page title, `--fs-page`) and `text-section`, and as the spacing keys
  `gutter`, `row`, `card` and `section` (`px-gutter`, `min-h-row`, `p-card`,
  `gap-section`). `cn()` is taught every one of these names, or it would
  delete the ink beside `text-meta`. A role sets the font size only: Tailwind
  attaches no line height to a key it did not define. The page title's key is
  `title` because `page` is already a colour (see "Adding a token").
- **Nothing reads the roles yet.** The shared primitives adopt them in a later
  change. Until then, Instrument differs from Refined only in radii, card
  elevation and motion.

Storybook's **Skin** toolbar applies the skin through the same `applySkin`
the app calls, and the token reference has a **Skin roles** page that shows
every `SKIN_TOKENS` value as the selected skin resolves it.

### Axe in each skin

A build opens every story in the skin named by `STORYBOOK_SKIN`, read through
`resolveSkin`, so an unset or unknown value is Refined. CI's `storybook-a11y`
job runs axe over the default build only, for now. To run it over every story
in both skins locally, build twice:

    npm run build-storybook -- --quiet
    STORYBOOK_SKIN=instrument npm run build-storybook -- --quiet -o storybook-static-instrument

Serve each build in the background:

    ./node_modules/.bin/vite preview --outDir storybook-static --host 127.0.0.1 --port 6006 --strictPort &
    ./node_modules/.bin/vite preview --outDir storybook-static-instrument --host 127.0.0.1 --port 6007 --strictPort &

Then run the test runner once against each:

    npm run test-storybook -- --maxWorkers=2 --url http://127.0.0.1:6006
    npm run test-storybook -- --maxWorkers=2 --url http://127.0.0.1:6007

The test runner drives Playwright's Chromium, which
`./node_modules/.bin/playwright install chromium` fetches once. Stop the two
servers when the runs finish.

### Reaching Instrument before there is a picker

Instrument is a preview until its shell lands, and the Settings picker comes
later. Until the command palette offers "Switch layout", select it from the
browser console on the app's own page, then reload:

    localStorage.setItem('ccrc-skin', 'instrument')

To return to the default, remove it and reload:

    localStorage.removeItem('ccrc-skin')

## Identity core

Some things never vary between skins (D-5094, spec §3.1). A skin may change
how dense the console is. It never changes what the console is:

- **The wordmark `❯ ccrc`.** The `❯` is in `--accent`, then `ccrc` in mono at
  medium weight, top-left in every shell.
- **The `❯` caret** means "selected" or "acting" wherever it appears, page
  titles included. A skin never adds a second cursor glyph.
- **The phosphor accent** (`--accent` and its family) marks commit actions, the
  active selection and living status, and nothing else.
- **Glow means life.** Only `busy` and `attention` emit light, at the same
  rhythm in both skins.
- **Lamp dots** (`StatusDot`) pair a glyph with a word, and stay round.
- **Dark wells.** Terminals and code sit in wells that stay dark in every
  palette.
- **The Geist pair** sets every glyph in both skins.
- **Lane hues.** Each lane keeps its hue and its mono name, and never glows.
- **The twelve palettes**, light and dark, render in both skins. A skin cannot
  add, remove or retint one.
- **The rule of voice.** Mono for what the machine says, sans for prose, and
  tabular figures for readouts.
- **The accessibility floors.** `--tap-min` (44px), `--fs-input` (16px),
  `--fs-2xs` (11px) as the smallest type, and `prefers-reduced-motion`. Rows
  are 44px tall unless the primary pointer is fine.

`pwa/test/skin-identity.test.ts` holds the token half. Every rule is run
against the real tree and against a planted copy, so each one is shown to
fire. It reads `skins.css` and `tokens.css` and fails when:

- a declaration in `skins.css` sits outside a `:root[data-skin='<id>']` block
  (optionally inside `@media`), or the id is not a non-default skin in `SKINS`;
- a declared property is not a `SKIN_TOKENS` member, or a member has no
  default in `tokens.css`'s top-level `:root`;
- `skins.css` holds a colour literal (hex, a colour function, a named or
  system colour), names `currentColor`, or uses a `var()` outside its class's
  allowlist. Elevation may name `--edge-subtle` and `--edge-strong`. Type may
  name `--fs-*`, `--ls-*`, `--weight-*` and the two families. Density may
  name `--sp-*`. Radius, meter and motion name nothing;
- a type role is not `var()` of a step on its own scale, or a family role is
  not one of the Geist pair. This is checked in `skins.css` and in Refined's
  own `:root` values alike (D-5243);
- a `--dur-*` sits outside `@media (prefers-reduced-motion: no-preference)`.
  A skin block is (0,2,0) and outranks the reduced-motion `:root`;
- a tap-bearing density token (`--row-h`) is below `--tap-min` outside
  `@media (pointer: fine)`, in either file (D-5243);
- a `[data-theme]` palette block declares a type, density, radius, meter or
  motion skin token (elevation is the one shared class);
- `skins.css` holds `!important`;
- the contrast gate's stylesheet walk (`pwa/design/audit.mjs`) no longer lists
  `ui/src/styles/skins.css` by that exact path.

Three censuses in the same file keep the skin out of shared code:

- `data-skin` appears in no stylesheet under `pwa/src` or `ui/src` but
  `skins.css`. W2's skin stylesheets select on their own classes, never on
  the attribute.
- `data-skin` and `dataset.skin` appear in no source under `pwa/src`,
  `ui/src`, `ui/.storybook` or `pwa/index.html` but `skins.ts`,
  `pwa/src/lib/skin.ts` and `index.html`. Tests and stories are excluded.
- `useSkin` is reached only from a file its registry lists. The registry is
  empty until the skin picker and W2's shells add theirs.

To give a skin a new token, add it to `SKIN_TOKENS` in the right class, give it
a default in `tokens.css`'s `:root`, and only then set it in `skins.css`. If
its class's rule does not fit the value, the value is probably a colour or a
new size, and it belongs in a palette or on a scale instead. The element half
of the guard, which covers the shells themselves, lands with W2.

## Fonts

The Geist pair is self-hosted (D-5095). Nothing is fetched from a font host,
and `geist` is not a dependency (spec §12 O5).

- **The files.** `src/fonts/Geist-Variable.woff2` and
  `src/fonts/GeistMono-Variable.woff2`, each one variable file covering weights
  100 to 900, and `src/fonts/OFL.txt`, all taken unchanged from the `geist`
  npm package at **1.8.1** (`npm pack geist@1.8.1` in a scratch directory).
  The note above the faces in `src/styles/tokens.css` records each file's
  SHA-256, and `pwa/test/fonts.test.ts` holds them.
- **The rules.** Two top-level `@font-face` rules atop `src/styles/tokens.css`
  declare `'Geist'` and `'Geist Mono'` with `font-display: swap`, beside the
  stacks that name them. They are not in a `fonts.css` of their own (D-5450):
  the contrast gate requires every stylesheet under `src/` to hold a style
  rule. Vite resolves each `url()` from `src/styles/`, in the app's build and
  in Storybook's, and emits a hashed asset under `/assets/`.
- **The stacks.** `--family-ui` and `--family-mono` lead with the pair and keep
  the system stacks behind it, so a glyph Geist lacks falls back, per glyph,
  to the face it had before.
- **The licence.** SIL Open Font License 1.1. The app ships a byte-identical
  copy at `/licenses/Geist-OFL.txt` (`pwa/public/licenses/`), and the service
  worker never answers `/licenses/` with the app shell (`swDenylist`).
- **To update the pair,** pack the new release, copy the three files over,
  and change the version and the hashes in `tokens.css`, in this section and
  in `fonts.test.ts`, together. Copy `OFL.txt` to `pwa/public/licenses/Geist-OFL.txt`
  again.

## Hook classes

Components carry their original bare class names (`btn-primary`, `sheet-panel`,
`dot`) alongside the utilities. Those carry no styling — they are stable
selectors that `fleet.css`, `chat.css` and the test suite key on. They go when
their last consumer migrates.

## Tests

There is no suite here. The primitives are exercised from `pwa/`, where their
consumers live — `pwa/test/primitives.test.tsx` plus every sheet and flow test.

## Where the boundary is

**This package owns a vocabulary, not just a set of files.** `btn-primary`,
`btn-ghost`, `dot`, `dot--busy`, `limit-fill`, `limit-track`, `skel`,
`sheet-panel`, `qc-actions` are emitted by the cva definitions here and by
nothing else. A call site never writes them by hand:

| you need | you import |
|---|---|
| a button | `Button` |
| a link that looks like a button | `buttonVariants({ variant })` |
| a bar in a layout that is not `LimitBar`'s own row | `fillVariants`, `LIMIT_TRACK` |
| a status glyph | `StatusDot` |

`pwa/test/design-system-boundary.test.ts` enforces the WHOLE table — every
class in the list above, not just the button's — and reds on any `.tsx` that
hand-writes one, naming the file and the classes.

It is word-bounded on purpose, because three shapes must stay legal:

- **a modifier passed to the primitive** — `<Skeleton className="proj-skel">`,
  `<Skeleton className="skel--user">`. That is how a call site adapts a
  primitive to its layout, and it never forks the styling.
- **the sheets' own hook classes** — `qc-consequence`, `qc-actions`. Those
  belong to the three sheets that roll their own confirm rather than to
  `QuickConfirm`, and tests and scoped rules select on them.
- **chat.css's look-alikes** — `pr-dot`, `tool-dot--run`, `chat-skel` are a
  different vocabulary that merely resembles this one.

**Why a guard and not a convention.** The convention failed once, silently and
expensively. Wave 2 retired `pwa/src/styles/legacy.css`, the last copy of the
button's styling outside this package. While that sat on a branch, `main` grew
four new files hand-writing `btn-primary`/`btn-ghost` on raw `<button>`
elements. Both sides stayed green — the app's tests never render those buttons
against the retired stylesheet, and the contrast gate reads stylesheets, so a
class with no rule behind it is invisible to it. Ten buttons lost their styling
outright and only the rebase revealed it.

**The classes still ship on the rendered element**, deliberately. Several
scoped rules in `fleet.css`, `chat.css` and `shell.css` select on them
(`.block-screen .btn-primary { width: auto }`, `.btn-ghost.settings-move`,
`.acct-list .acct-row[data-disabled='true'] .limit-fill`), and those sheets are
imported unlayered so they still beat `@layer utilities`. They are structural
hooks for contextual overrides and for tests, never styling.

## What belongs here, and what does not

Here: anything rendered on more than one screen whose appearance is a
design decision — the primitives above, the tokens, the theme bridge.

Not here: anything that knows about ccrc's domain. A component that reads a
session's bucket, calls the API, or touches the store belongs in `pwa/src`.
`StatusDot` is the edge case that proves the line — it type-imports
`SessionBucket` from `shared/` so its `DOT` record stays exhaustive, but it
takes that bucket as a prop and fetches nothing.

## Known boundary debt

`@ccrc/ui` is **this product's** design system, not a generic library, so a type
import from `shared/` is fine and always was — `status-dot.tsx` type-imports
`SessionBucket`, and `tsconfig.build.json`'s `rootDir: ".."` exists for it.

Two components went further in the composite migration and import **values**:

- `components/build-line.tsx` — `remoteSides`, `statedOf`, `pendingTag`
- `components/mail-strip.tsx` — `MAIL_GATE_HELD_COUNT`, `MAIL_GATE_HELD_MS`

The ring rule is not violated: `shared/` is L0 and imports nothing, so there is
no cycle, and `pendingTag` was moved DOWN into L0 rather than reached up for.
The PACKAGE boundary is. A value import gives `@ccrc/ui` a runtime dependency on
ccrc's domain vocabulary — `BuildLine` is now a design-system component that
knows what a release tag is — and because `rootDir` is the repo, `npm run build`
emits `dist/shared/*.js` beside `dist/ui/`, so the /design-sync converter pulls
update-management logic in alongside the button.

Recorded rather than fixed, deliberately: it is cheap to reverse now (both
belong in `pwa/src/fleet/`, built FROM ui primitives) and expensive once more
components follow the precedent.

"Do not treat these two as licence" used to be the whole of the enforcement,
which is to say there was none. It is now `pwa/test/ui-package-boundary.test.ts`,
which scans every file `tsconfig.build.json` actually EMITS — stories are
excluded there, so a story may build a fixture from `MAIL_GATE_HELD_COUNT`
without reaching `dist/` — and asserts the holder list is **exactly** these two.
Both directions: a third component cannot follow the precedent, and an entry
left behind after one is reversed reds as stale rather than quietly holding the
door open for a replacement.

## What the app may reach back into

The ordering above means an app sheet can always scope over a ui class, and
several rules rely on it. The line is between PLACING a component and
REDRESSING one: size, spacing, flow and position are the call site's business —
only `fleet.css` knows a ghost button sits in a two-up action row — while a
colour, border, face or shadow set from outside is a second definition of what
the thing looks like, living in a sheet the component's own story never loads.
That is how a palette drifts in one theme only, and the contrast gate cannot
see it either: it reads the rule it finds and has no opinion about which
package should own it.

The same test guards this, on the rule's SUBJECT rather than its ancestors —
`.sheet-panel .proj-ready` is the app scoping its own class inside a sheet and
is nobody's business but the app's; `.chat-meta .dot` is the reverse. The
remedy for a refused rule is the `className` modifier shape above. Three
appearance reach-ins predate the guard and are carried as a named census with
their reasons, asserted in both directions like the import list.

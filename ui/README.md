# @ccrc/ui — Phosphor & Ink

The design system behind ccrc's console: the tokens, the Tailwind theme that
exposes them as utilities, and the shared components. The app consumes
**source** — `exports['.']` points at `src/index.ts` and the consuming app's
vite compiles it, so there is no `dist` for `pwa` to go stale. (`npm run build`
does emit one, for a single reader: the /design-sync converter. Nothing in the
app resolves it.)

    cd ui && npm ci && npm run storybook      # every component, every state

Storybook's toolbar carries the two things the system is actually about: the
**theme** switch (Phosphor dark / Paper light) and the **viewport** (phone,
tablet, desktop). The a11y addon runs axe against each story.

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

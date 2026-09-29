# @ccrc/ui — Phosphor & Ink

The design system behind ccrc's console: the tokens, the Tailwind theme that
exposes them as utilities, and the shared components. Ships **source** — no
build step, no `dist` to go stale; the consuming app's vite compiles it.

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

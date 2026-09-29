# ccrc — Phosphor & Ink

The operating console for a fleet of Claude Code sessions. Mobile-first, dark by
default, built so a glance answers "what needs me?"

## Setup — no provider, one attribute

There is **no React provider and no theme context.** Components read CSS custom
properties, nothing else. Two things must be true or everything renders wrong:

1. **The theme is an attribute on the root element.** `:root` IS the dark theme
   ("Phosphor"); `[data-theme="light"]` ("Paper") re-resolves every token. Set
   `data-theme="dark"` or `data-theme="light"` on `<html>`.
2. **Paint the ground.** Nothing paints the page for you — put `bg-page` on the
   body or the outermost element, or the page shows the host's background under
   dark-theme text.

```jsx
<div data-theme="dark" className="bg-page text-ink-primary font-ui"
     style={{ minHeight: '100dvh' }}>
  <Button variant="primary" onClick={send}>Send it</Button>
</div>
```

## Styling idiom — Tailwind v4 utilities over semantic tokens

Never a raw hex, never a numeric Tailwind colour (`bg-gray-800` is not in this
system). Utilities are semantic:

| Family | Real names |
|---|---|
| grounds | `bg-page` `bg-surface` `bg-raised` `bg-sheet` `bg-well` `bg-scrim` |
| ink | `text-ink-primary` `text-ink-secondary` `text-ink-tertiary` `text-ink-on-accent` |
| accent | `bg-accent` `text-accent` |
| status | `text-status-busy` `text-status-attention` `text-status-done` `text-status-idle` `text-status-cleanup` `text-status-dead` |
| limits | `bg-limit-ok` `bg-limit-warn` `bg-limit-critical` `bg-limit-track` |
| edges | `border-edge-strong` |
| type | `font-ui` `font-mono` · `text-2xs` `text-sm` `text-base` `text-lg` |
| elevation | `shadow-card` `shadow-sheet` |
| glow | `shadow-glow-dot-busy` `shadow-glow-dot-attention` |
| motion | `animate-breathe` `animate-pulse-attention` `animate-shimmer` `animate-toast-in` · `duration-press` `duration-bar` |
| layering | `z-sheet` `z-drawer` `z-toast` |
| touch | `min-h-tap` (every interactive target) |

**The compiled utility set covers what these components use.** For anything else
— spacing, the six account hues, syntax colours — use the token directly:
`style={{ color: 'var(--acct-violet)' }}`. Every token in `styles.css` is live
in both themes; a utility class that was never compiled silently does nothing.

## Five laws — designs that ignore these do not look like ccrc

1. **Glow means life.** Only `busy` and `attention` emit light
   (`shadow-glow-dot-busy`, `animate-breathe`). Idle, done, cleanup, dead and
   archived are **matte**. A glowing "done" is a lie about the fleet.
2. **Mono is the machine's voice.** `font-mono` for ids, paths, commands,
   counts, timestamps. `font-ui` for prose written to a human.
3. **Wells are cut into the interface.** `bg-well` stays dark in BOTH themes —
   terminals and logs are holes, not cards. Text on them takes
   `var(--ink-on-well)`: that token ships, but no primitive uses the bare
   utility, so `text-ink-on-well` was never compiled. This is the rule above in
   miniature — check `_ds_bundle.css` before reaching for a class.
4. **Two cues per state, never colour alone.** Every status carries a word AND a
   glyph beside its colour. Selection is reverse video, not a tint.
5. **Limit bands are fixed:** ok under 50%, warn 50–75, critical over 75. Use
   `limitBand(pct)` rather than re-deciding the thresholds.

## Where the truth is

- `styles.css` → `_ds_bundle.css` — every token and every compiled utility. Read
  it before inventing a name.
- `components/primitives/<Name>/<Name>.prompt.md` — usage per component.
- `components/primitives/<Name>/<Name>.d.ts` — the prop contract.

`window.CcrcUi` also exports helpers that are not components: `toast(message,
kind, action)` fires a toast into a mounted `ToastHost`; `cn()` merges classes;
`limitBand()`, `buttonVariants()`, `dotVariants()` and `fillVariants()` expose
the variant logic, and `LIMIT_TRACK` is the class string for the groove a limit
fill sits in. Reach for those when your layout differs from the component's own
— a gauge that puts the label and percentage in different cells still wants
this bar's exact vocabulary.

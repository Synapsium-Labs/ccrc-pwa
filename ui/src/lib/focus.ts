// The keyboard focus ring, owned by the design system.
//
// WHY THIS EXISTS. Until now `@ccrc/ui` carried ZERO `:focus-visible` rules
// across every component it ships. The ring was one blanket rule in the app's
// `base.css`:
//
//     :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }
//
// which has two consequences the package should not have accepted. The first
// is that NO component shows a focus state in Storybook — the app's stylesheet
// is not loaded there — so a design system shipping 24 components could not
// demonstrate, review or screenshot keyboard focus for any of them. The second
// is that a component cannot opt into a different ring where it needs one,
// because it has no ring of its own to vary.
//
// THIS CHANGES NOTHING IN THE APP, BY CONSTRUCTION. The values are base.css's
// own, token for token. And the app rule is UNLAYERED while these utilities
// land in `@layer utilities`, so in the app the blanket rule wins on cascade
// order and paints exactly what it painted before. In Storybook, where that
// rule does not exist, these are what draw. Identical pixels in both places,
// for two different reasons.
//
// NOT `:focus`, ALWAYS `:focus-visible`. A mouse press must not leave a ring
// behind — that is the whole distinction the pseudo-class exists for, and the
// app has relied on it since base.css was written.
//
// MEASURED: `--accent` against the three grounds a focused control sits on
// (`--bg-page`, `--bg-surface`, `--bg-raised`) clears WCAG 2.1 SC 1.4.11's
// 3:1 for a non-text indicator in all twelve palettes — 4.57 at worst
// (GitHub Light, on raised), 10.37 at best. `focus-ring.test.ts` holds that.

/** `outline: 2px solid var(--accent); outline-offset: 2px`, on keyboard focus
 *  only. Appended to a component's class string, never to a call site's — a
 *  ring is the component's business, like its radius. */
export const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-phosphor focus-visible:outline-offset-2';

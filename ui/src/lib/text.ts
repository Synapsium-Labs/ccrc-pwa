// Two shapes that are class strings and nothing else.
//
// Both were found by the shape census, and both share the same awkwardness:
// each is a handful of utilities that two or three app rules spelled
// identically, applied to an element that already exists for other reasons.
// A `<MonoPath>` component would wrap a `<span>` the call site already
// renders, and an `<AttentionDot>` cannot be a component at all — it is a
// `::before` on something else.
//
// So they are constants, which is the same answer `TEXT_INPUT_INLINE` got for
// the same question. The value of moving them here is not the line count: it
// is that the next consumer has somewhere to take them FROM, and that the
// census can refuse a fourth copy by name.

/** A path that may be long. `.reap-ignored` and `.reap-size` (chat.css, the
 *  reap sheet's workspace lines) and `.hotfiles-path` (fleet.css, a hot-file
 *  claim's path) declared the same four, and the first of them added
 *  `word-break` — which is the declaration that makes the shape what it is, so
 *  it rides here and the other two inherit a fix they were missing.
 *
 *  `block`, not `inline`: all three sit in a stacked list where a path owns
 *  its own line. `break-all` is Tailwind's spelling of `word-break:
 *  break-word`'s useful half — a `/home/you/very/long/workspace` must break
 *  somewhere, and a path has no spaces to break at. */
export const MONO_PATH = 'block font-mono text-xs text-ink-secondary break-all';

/** The 6px dot an offline strip draws before its word. `.offline-banner::before`
 *  (fleet.css) and `.chat-banner--offline::before` (chat.css) are the same five
 *  declarations in two stylesheets — the one piece of the offline strip that
 *  banner.tsx's header said "stays its own rule until it earns a component".
 *  Two copies of it is the strip earning one, and a `::before` is the half a
 *  component could never have carried.
 *
 *  It does NOT breathe. The strips it marks are a STATE — the socket is down —
 *  and this palette's rule is that attention is a mark and only busy is alive. */
export const ATTENTION_DOT =
  "before:content-[''] before:block before:size-[6px] before:rounded-full"
  + ' before:bg-status-attention';

/** The MICRO-LABEL above a block: mono, 2xs, medium, uppercase, tracked out.
 *
 *  FOUR COPIES, AND THE FOURTH WAS INSIDE `@ccrc/ui`. Three stylesheet rules
 *  declared the identical four — `tool-card.css .tool-eyebrow`,
 *  `task-card.css .task-card-field dt` and `chat.css
 *  .ask-envelope-more-heading` — and `sheet.tsx` spelled the same utilities
 *  inline for `.sheet-eyebrow`. The app's shape census could not see any of
 *  it: two of the rules are in `@ccrc/ui`, which it left out of scope, and
 *  the fourth is not a rule at all. The census reads both packages in the
 *  same commit that adds this, which is what will refuse the fifth.
 *
 *  COLOUR IS NOT HERE, deliberately: `--ink-tertiary` is what each rule
 *  declares and what the contrast gate measures it by, keyed on
 *  `<basename> <selector>`. A colour that moved into a utility string would
 *  leave three gate entries measuring a rule that no longer paints — the
 *  "shape moves, ground stays" rule this package follows for every
 *  migration. Each call site keeps its own one-declaration rule.
 *
 *  `not-italic normal-nums`: the three rules used the `font:` SHORTHAND,
 *  which resets `font-style` and `font-variant` on the way past. Longhand
 *  utilities do not, so the resets are spelled — the same two `KEYCAP`
 *  carries, for the same reason. */
export const EYEBROW =
  'font-mono text-2xs font-medium uppercase leading-none tracking-caps'
  + ' not-italic normal-nums';

/** A LIST THAT IS NOT A LIST — bullets off, no indent, laid out as a grid.
 *
 *  FOUR COPIES, THREE OF THEM IN THE APP: `fleet.css .settings-nodes` and
 *  `.settings-releases`, `.update-move-sheet .update-move-list`, and
 *  `mail-card.css .mail-card-artifacts` inside this package — the fourth is
 *  why the shape census now reads both. `list-style: none; margin: 0;
 *  padding: 0; display: grid` is the whole of it: a semantic `<ul>`/`<ol>`
 *  that must not look like one.
 *
 *  NO GAP, deliberately. Each of the four picks its own (`--sp-1`, or none at
 *  all), and the row rhythm is the list's own decision rather than this
 *  shape's. NO GROUND either — nothing here paints, so unlike a card shell
 *  this one can move without taking a contrast-gate key with it. */
export const RESET_LIST = 'list-none m-0 p-0 grid';

// ---------------------------------------------------------------------------
// GLYPHS THAT CARRY MEANING, and the one blind spot every census shares.
//
// A single-character literal is under `literal-census`'s 25-character floor AND
// carries no space, so that census is structurally blind to a glyph written
// twice; `markup-census` reads class literals and attribute counts, not text
// nodes; `shape-census` reads stylesheets. Nothing in the repo could see that
// three production call sites in TWO packages each typed `✉` for the same idea.
//
// These join the `*_GLYPH` vocabulary the app already keeps per state
// (`RUN_GLYPH`, `MARKER_GLYPH`, `READY_GLYPH`, `DISPATCH_GLYPH`, `DOOR_GLYPH`,
// `ASK_GLYPH`, `CROSSING_GLYPH`…). Those are keyed BY STATE because the rule
// there is that a state is never read out of colour alone. These three are not
// per-state: they are one idea with one spelling, and the reason they are here
// rather than in a `Record` is that both packages draw them.
// ---------------------------------------------------------------------------

/** Mail. Drawn by `MailBadge` (app), `MailCard` and `MailStrip` (this
 *  package) — three production sites across the two packages, each with its own
 *  copy of the character before this. */
export const MAIL_GLYPH = '✉';

/** A warning the surface has no room to spell out. `SessionLine`'s own header
 *  carries the argument: on a phone the sentence becomes this mark, and the
 *  full text lives in the actions sheet where there is room for it. Also
 *  `DISPATCH_GLYPH.stalled`. */
export const WARN_GLYPH = '⚠';

/** Settings — the door's glyph, and the feed's word for a coordination event. */
export const SETTINGS_GLYPH = '⚙';

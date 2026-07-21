# ccrc — "Phosphor & Ink"

> **Adopted direction — 2026-07-21.** Chosen by a three-candidate judge panel
> (terminal / instrument / glass), with the user's live endorsement of the
> phosphor-and-ink direction as the deciding signal. The strongest ideas from
> the non-winning candidates are folded in below — policy-aligned limit bands,
> lamp bezels, tabular live clocks, ping rings, indexed dialog rows, EXIT
> badges, safe-area tokens, capped wells, threshold narration, and the
> `--acct-active` rebinding mechanism — chosen because each strengthens (or is
> neutral to) the phosphor-and-ink identity. The non-winning candidates live in
> the session scratchpad. Full visual sign-off still happens at end-of-build.

**Candidate direction: refined terminal heritage.** Dark-first, true light theme,
monospace accents, session-status glow. Elegant, not retro-kitsch.

## Aesthetic thesis

ccrc is a lens held up to living terminals. The design does not *imitate* a
terminal — no scanlines, no CRT curvature, no green-on-black walls of text — it
*inherits* from one, the way a good watch inherits from an instrument panel.
Three inheritances, used with discipline:

1. **Phosphor as life.** On a CRT, glow meant the electron beam was hitting the
   glass — the machine was alive. Here, the only things allowed to emit light
   are living states: a busy session breathes a soft green bloom; a session
   waiting on you pulses amber, faster. Idle is matte. **Dead is flat** — no
   glow, reduced ink, a machine gone cold. Status is legible from across the
   room without reading a word, because light itself is the signal.

2. **Mono is the machine's voice.** A strict typographic split: monospace for
   anything the machine says or *is* — project paths, account names, tool
   names, limits percentages, timestamps, keycaps, code. The system sans for
   anything a human reads as prose — chat text, buttons, dialog copy. The
   split does the explaining: you always know whether you're reading the fleet
   or talking to it.

3. **The `❯` cursor.** ccd's TUI menus mark the selected row with `❯`. That
   glyph is promoted to the app's mark of intent: it sits in the prompt input,
   marks the preselected option in dialog sheets, and blinks (as a block `▍`)
   at the end of streaming text. It is the one piece of terminal furniture that
   crosses into the chrome — everything else stays modern.

The signature element is the **breathing status glow**; everything around it is
quiet: hairline borders, generous dark air, one accent hue.

## Palette logic

**Dark (default):** green-cast graphite, not neutral black — the tint of dark
CRT glass. Four background layers step upward (`page → surface → raised`), and
one layer steps *down*: `--bg-well`, darker than the page, for terminal drawer
and code blocks. Wells are cut into the interface; content sits on it.

**Light:** a paper terminal, not an inversion — warm gray-green paper, white
cards, ink at full darkness, real shadows (glow reads as a halo in daylight,
so its alpha drops and its color darkens). One deliberate constant: **wells
stay dark in light mode**, like the embedded terminal in every serious IDE.
The phosphor identity survives daylight inside the glass.

**Hue governance** (the load-bearing decision):

- **Green/amber/red belong to state**: busy, attention, dead — and the same
  three hues band the limits bar to the operator's own model-routing policy
  thresholds (**ok < 50%, warn 50–75%, critical > 75%**). Amber literally
  means "prefer handing work off"; red means "hand off everything spec-able" —
  a gauge going amber is an instruction, not decoration. Same hue = same
  meaning everywhere.
- **The four accounts live in the cool half of the wheel**, 40°+ apart:
  claude = cyan, claude-corp = blue, claude2 = violet, gpt = magenta. No
  account hue can ever be misread as session state. Chips always carry the
  account name in mono; color is the secondary cue, never the only one.
  Components consume account color through one variable: screens stamp
  `data-acct` at their root and `tokens.css` rebinds `--acct-active` /
  `--acct-active-tint` to that account's pair — chat headers and chips style
  against `--acct-active` only, and no component hard-codes an account hue.
  The glow never rebinds: glow stays green/amber only.
- **The interactive accent is the phosphor green** — send button, links, focus
  ring, the `❯` preselect. "Acting" and "working" deliberately share one color
  story: what you press is what makes sessions glow.

All ratios verified programmatically (74 pairs, both themes —
`contrast-check.mjs` in this directory): text roles ≥ 4.5:1, non-text UI roles
(dots, bar fills, focus ring) ≥ 3:1. Exact ratios are annotated per-token in `tokens.css`.

## Typography

- **UI face:** `system-ui` stack — SF Pro / Segoe / Roboto. The sans stays
  neutral on purpose; personality is carried by the mono and the light.
- **Mono accent face:** `ui-monospace, "SF Mono", "Cascadia Code",
  "JetBrains Mono", Menlo, Consolas, "Roboto Mono", monospace`. No webfonts —
  every platform's best mono is already installed, and the PWA shell stays
  featherweight.
- **Scale:** 11 / 12 / 13 / 15 / 17 / 20 / 24, with `--text-input: 16px`
  (iOS zoom-jump guard, a spec acceptance criterion). Chat body 15px/1.5.
  Card titles are **17px medium mono** — the project name set like a directory
  listing is the fleet's most characterful move.
- **Labels:** uppercase mono 11px, +0.08em tracking, tertiary ink — the
  eyebrow voice for "5H", "7D", section headers, keycap legends.
- **Readouts:** `font-variant-numeric: tabular-nums` on every mono value that
  updates in place — elapsed clocks, percentages, durations — so a ticking
  readout never jitters sideways.

## Spatial system

4px base grid (`--sp-1..12`). Cards pad 16, screens gutter 16, vertical rhythm
between cards 12. Radii encode importance: 6 (inline code, keycaps, badges) →
10 (tool cards, buttons) → 16 (session cards, bubbles) → 22 (sheet/drawer top
corners) → full (dots, pills). Touch floor 44px everywhere (spec criterion);
dialog option rows run 52+. Safe-area insets padded on header, input bar,
sheets — promoted to tokens (`--safe-top` / `--safe-bottom`, aliasing
`env(safe-area-inset-*)`) so padding rules can compose them.

## Motion language

Durations: press 120 · fade 180 · expand 240 · ping 300 · navigate 320 · sheet
420 · limit-bar 600. Easings: `--ease-swift cubic-bezier(0.2,0,0,1)` for
everyday movement; `--ease-spring cubic-bezier(0.32,1.25,0.46,1)` (small
overshoot) for sheets and drawer only.

What animates, and why:

- **Busy glow breathes** — opacity 0.55→1 over 2600ms, ease-in-out alternate,
  on a pseudo-element (compositor-only; never animate box-shadow directly).
  Calm respiration, not a spinner.
- **Attention pulses at 1300ms** — exactly twice busy's tempo; urgency is
  encoded in rhythm, same mechanism.
- **Streaming text** fades in per chunk (180ms) behind a blinking block caret
  `▍` (1100ms, `steps(2)`), which vanishes when the turn completes.
- **Status dot changes pop and ping**: scale 1→1.35→1 in 240ms, layered with a
  one-shot 300ms expanding ring (`--dur-ping`) radiating off the lamp in the
  new state's color — you *see* idle become busy.
- **Limit bars glide** to new widths over 600ms; band color crossfades.
- **Sheets & drawer spring** up in 420ms, exit swiftly in 320ms; card→chat is
  a shared-element transition (320ms) of the card header into the chat header.
- **Press states** compress to scale 0.97 in 120ms.
- `prefers-reduced-motion`: all durations →1ms, glow freezes at mid-intensity,
  caret holds solid, ping never fires. Nothing vanishes; nothing moves.
  Freezing is done by disabling the animation and pinning opacity — never by
  zeroing the loop periods, since a 0s infinite-alternate loop strobes.

## Component treatments

**Session card** — `--bg-surface`, radius 16, hairline edge, mono project
title, account chip, right-aligned status lamp. *Busy:* border warms toward
green and a two-ring-plus-halo phosphor bloom (`--glow-busy`) breathes on a
pseudo-element; dot carries its own small bloom; meta line is a live elapsed
clock — "working · 04:12" in busy-green mono, tabular-nums so the tick never
jitters. *Attention:* amber equivalent, faster pulse, plus a "waiting on you"
amber-tinted badge — never a bare dot to interpret. *Dead:* the machine gone
cold — title falls to secondary ink, the account chip drains to gray (identity
stays in the mono name), matte red dot in its lamp, meta reads "exited · 3h
ago — chat is read-only" in dead-red (the state *and* its consequence in one
line), limits bars hidden (meaningless when dead), and a full-width ghost
"Restart" button. The cold treatment is done entirely with color tokens —
never element opacity, which would push ink below AA. No glow — glow means
life.

**Chat** — terminal semantics, modern clothes. *User turns* are input: right-
aligned bubbles, `--bg-raised`, radius 16 with a 6px bottom-right corner, sans
15px. *Assistant turns* are output: no bubble — full-width flush prose with
rendered markdown; inline code in raised chips, code blocks in dark wells
(both themes). Turn boundaries are whitespace + a mono 11px timestamp. Send
states: pending `◌` → confirmed `✓` → failed red `!` with retry, in mono.

**Tool card** — the machine's work, filed neatly. *Collapsed:* one 44px row —
result dot (green ✓ / red ✕ / breathing while running), mono tool name,
truncated mono summary in tertiary, right-aligned mono duration ("0.4s",
tabular-nums; a live elapsed clock while running), chevron. *Expanded:* the
row plus an inset dark well (radius 10, capped at `--well-max` 240px with
internal scroll so a long test log never swallows the chat column) with the
command and result excerpt in 13px mono, `overflow-x: auto`, diff lines tinted
`--diff-add`/`--diff-del`, and a mono meta footer ("exit 0 · 1.2s"). Non-zero
exits swap the plain meta line for a tinted **`EXIT 1` mono micro-badge** —
`--status-dead-text` on the 12%-alpha `--status-dead-tint` pill — so failure
is glanceable in the transcript scroll. The well is the terminal peeking
through the chat — the structured layer and the escape hatch share one
material.

**Dialog sheet** — where the TUI menu becomes native. Scrim, spring-up sheet
(`--bg-sheet`, radius 22 top), grabber, sans title + question, then option rows
(52px min, hairline-separated), each carrying a mono index digit (1/2/3) — the
same numbers ccd's actual TUI menu answers to. The preselected row wears the
`❯` cursor in phosphor green on `--accent-tint` plus a right-aligned `↵` hint;
other rows keep an empty glyph slot so text never shifts. Footer, mono 11:
"Tap an option — it answers in the session." Tapping replays the exact
arrow-walk; the sheet is a skin over the real menu.

**Terminal drawer** — the app's basement. Swipe-up sheet in `--bg-well` (the
darkest surface in either theme), radius 22 top, grabber, xterm.js fitted to
width. Above the keyboard: a quick-key row of mono keycaps (`esc ↑ ↓ tab ⏎
⇧tab`) — raised 6px-radius caps, 44px targets, 120ms press-compress. The
drawer is where phosphor is allowed to be literal; the chrome around it stays
composed.

**Limits bar** — two rows (5h / 7d): mono 11px label, 4px rounded track, fill
banded to the routing-policy thresholds (ok < 50%, warn 50–75%, critical >
75%), mono percentage in tabular-nums. Fills glide (600ms) rather than snap.
When a bar crosses into critical, the card narrates the consequence in a mono
status line — "5h limit near — will move to claude" — using ccd's actual swap
behavior, so a red band is a forecast, not an alarm. In the header of a chat,
the same bar collapses to a 2px sliver under the account chip.

**Status lamp** — the 8px status dot seated in an 18px well (`--lamp-size`): a
`--bg-well` floor with an inset hairline ring, so the phosphor reads as an
indicator lamp lit behind glass — and the lamp keeps its dark glass in the
light theme, like the wells. Busy: phosphor + small bloom, breathing.
Attention: amber + bloom, pulsing at double tempo. Idle: matte gray-green.
Dead: matte red. State changes pop (scale 1→1.35→1) and fire the one-shot ping
ring. Inline contexts (chat header meta, tool rows) use the bare 6px dot.
Never the sole signal — every dot travels with a mono status word or badge
(spec: "no state the user has to interpret from a status dot alone").

**Interrupt** — a keycap, not an icon: a raised mono `esc` cap in the chat
header, enabled only while busy; pressing it compresses like a key.

## Token table

Full annotated values (with computed contrast ratios per theme) live in
`tokens.css`; this is the map.

| Group | Token | Dark | Light | Role (AA target) |
|---|---|---|---|---|
| bg | `--bg-page` | `#0B0D0C` | `#F4F6F3` | app background |
| bg | `--bg-surface` | `#141715` | `#FFFFFF` | cards, headers |
| bg | `--bg-raised` | `#1C201D` | `#EAEEEA` | chips, input, user bubble |
| bg | `--bg-well` | `#070808` | `#141715` | terminal/code/lamp — dark in both themes |
| bg | `--bg-sheet` | `#181C19` | `#FFFFFF` | bottom sheets |
| bg | `--scrim` | `rgba(4,6,5,.62)` | `rgba(20,26,22,.42)` | behind sheets |
| edge | `--edge-subtle` / `--edge-strong` | `#262B27` / `#39403A` | `#DDE2DC` / `#C3CAC2` | hairlines (decorative) |
| ink | `--ink-primary` | `#ECF0EC` | `#1A201B` | body text (4.5+; actual 14–17) |
| ink | `--ink-secondary` | `#ADB6AE` | `#4E5850` | supporting text (4.5+; actual 6.3–8.7) |
| ink | `--ink-tertiary` | `#8B948C` | `#5F6962` | timestamps/meta (4.5+; actual 4.9–6.2) |
| ink | `--ink-disabled` | `#5C655D` | `#98A29A` | disabled (WCAG-exempt) |
| ink | `--ink-on-well` | `#DEE4DE` | `#DEE4DE` | code text (13.9–15.5) |
| ink | `--ink-on-accent` | `#082312` | `#FFFFFF` | text on accent (5.3–8.9) |
| accent | `--accent` | `#45D67E` | `#0E7B3F` | actions, links, focus, `❯` |
| accent | `--accent-tint` | `#12291B` | `#DFF2E5` | preselected row bg |
| status | `--status-busy` / `-text` | `#45D67E` / `#57E08B` | `#178A48` / `#106E39` | dot 3:1 / label 4.5:1 |
| status | `--status-idle` | `#7C867D` | `#6C766E` | matte dot (3:1) |
| status | `--status-attention` / `-text` / `-tint` | `#F2B84B` / `#F2B84B` / `#2E2413` | `#B27400` / `#8A5A0A` / `#F7E9CF` | dot / badge text / badge bg |
| status | `--status-dead` / `-text` | `#E06A55` / `#E8836F` | `#B2402C` / `#B2402C` | matte dot / label |
| status | `--status-dead-tint` | `rgba(224,106,85,.12)` | `rgba(178,64,44,.12)` | EXIT badge pill (label 4.8–5.9 on it) |
| account | `--acct-claude` / `-tint` | `#6FD6EA` / `#0E2A31` | `#0A6377` / `#DAF0F6` | cyan chip (4.5+; 5.8–9.0) |
| account | `--acct-claude2` / `-tint` | `#C7A7F4` / `#241C38` | `#6D3FB4` / `#EDE6FA` | violet chip |
| account | `--acct-corp` / `-tint` | `#96B4F4` / `#16233B` | `#2F55B8` / `#E3EAFA` | blue chip |
| account | `--acct-gpt` / `-tint` | `#F0A3C8` / `#331B28` | `#A62667` / `#FAE3EE` | magenta chip |
| account | `--acct-active` / `-tint` | rebound per `[data-acct]` | same | screen-scoped account accent |
| limits | `--limit-track` | `#242A25` | `#E3E7E2` | bar track |
| limits | `--limit-ok` / `-warn` / `-critical` | `#45D67E` / `#F2B84B` / `#E06A55` | `#178A48` / `#B27400` / `#B2402C` | fills, 3:1 vs track; bands <50 / 50–75 / >75% |
| diff | `--diff-add` / `--diff-del` | `#57E08B` / `#F08A78` | same (wells stay dark) | well-only accents |
| type | `--font-ui` / `--font-mono` | system sans / ui-monospace stack | same | voice split |
| type | `--text-2xs…2xl` | 11/12/13/15/17/20/24 | same | scale |
| type | `--text-input` | 16px | same | iOS zoom guard |
| type | `--leading-tight/normal/mono` | 1.25 / 1.5 / 1.55 | same | line heights |
| type | `--weight-regular/medium/semibold` | 400 / 500 / 600 | same | weights |
| type | `--tracking-caps` | 0.08em | same | mono label tracking |
| space | `--sp-1…12` | 4→48px (4px grid) | same | spacing |
| space | `--safe-top` / `--safe-bottom` | `env(safe-area-inset-*, 0px)` | same | notch / home-bar padding |
| space | `--tap-min` | 44px | same | touch floor |
| size | `--lamp-size` / `--well-max` | 18px / 240px | same | dot lamp bezel / well height cap |
| radius | `--r-sm/md/lg/xl/full` | 6/10/16/22/999px | same | radii |
| elevation | `--shadow-card` / `--shadow-sheet` | subtle black | real gray shadows | depth |
| glow | `--glow-busy` / `--glow-attention` | green/amber 3-layer bloom | darker hue, lower alpha | the signature |
| glow | `--glow-dot-busy` / `-attention` | 8px dot bloom | 7px, dimmer | dot halo |
| motion | `--dur-press/fast/base/slow/sheet/bar` | 120/180/240/320/420/600ms | same | durations |
| motion | `--dur-ping` | 300ms | same | dot state-change ring |
| motion | `--ease-swift` / `--ease-spring` / `--ease-breathe` | see tokens | same | easings |
| motion | `--breathe-period` / `--pulse-period` / `--caret-period` | 2600/1300/1100ms | same | rhythms |
| z | `--z-header/sheet/drawer/toast` | 10/40/50/60 | same | stacking |

## What this direction refuses

Scanline overlays, CRT bezels/curvature, glow on non-living things, green body
text, ASCII-art decoration, webfonts, more than one accent hue in the chrome,
account-hued glow (glow is green/amber only, even with `--acct-active` in
play). The terminal heritage is carried by four small things — the
glass-tinted darks, the mono voice, the `❯`, and the phosphor breath — and by
nothing else.

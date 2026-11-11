# Overlord: the product's name, wordmark and two characters

**For:** the rename of the product from ccrc to Overlord, and the characters that give the Overlord a face.
**Kind:** static mockups, with each character's moods animated
**Viewports:** phone 390x844 (splash), icon sizes 512, 192 and 32

This brief records a design that is already drawn, on the canvas "Overlord Branding" (`CANVASES.md`). Its artwork is
exported beside it under `docs/design/overlord/`, so the implementation can start from the shapes, not from a picture of them.

## The decision

The operator ruled on 2026-11-11 that the whole product (the repository, the app and its name) renames to **Overlord**.
The coordinator above every coordinator, called the Overlord in `docs/superpowers/specs/2026-11-09-overlord-design.md`,
is part of the reason: it is the console's home (R9 there), and the wordmark leads home. So the product and its home
share one name, and the characters below are the Overlord's face. One word, one thing.

This brief does not rename anything. The rename itself (package names, the `ccrc` and `ccd` commands, the
`~/.ccrc` paths, the repository) is implementation work of its own, with its own plan.

## What it must reproduce exactly

- **Colour comes from the tokens.** The canvas was drawn in Phosphor's dark values, and every colour in it is a token
  there. In the app each fill reads the token, so a character follows the palette and light/dark:

  | Drawn as | Token | Used for |
  |---|---|---|
  | `#0B0D0C` | `--bg-page` | pupils, the splash ground |
  | `#45D67E` | `--accent` | the bodies, the wordmark's underscore |
  | `#ECF0EC` | `--ink-primary` | the white of the eye, the Zs, the `!` and `?` |
  | `#F2B84B` | `--status-attention` | the crowns, the eyestalk tips, the Dark Lord's eyes and trim |
  | `#E06A55` | `--status-dead` | the Dark Lord's eyes in Angry only |
  | `#5C655D`, `#8B948C`, `#ADB6AE` | `--ink-disabled`, `--ink-tertiary`, `--ink-secondary` | Offline |

  Two values on the canvas are not tokens and should become one, or be replaced by the nearest: the eyelid and rim
  shading (black at 22–35% over the body) and the tears' blue (`#2988FF`). The card borders (`#2A302C`) belong to the
  canvas, not the design.
- **GLOW MEANS LIFE still holds.** The characters never glow. Amber is the crown's colour and the Dark Lord's eyes, not
  a light.
- **Pixels stay whole.** Both characters are drawn on a 32×32 grid with `shape-rendering: crispEdges`. Scale them by
  whole multiples, and move parts by whole grid cells: every animation is `steps(1)`, never eased.
- **Reduced motion stills everything.** Every animation sits behind `prefers-reduced-motion`; the still frame is the
  mood's resting pose.
- **The eye is shared.** The Orb's eye is one almond, one round pupil and a glint. Every Orb mood starts from it.

## The pieces

1. **The wordmark** — `overlord_`, lower case, monospace, heavy, the underscore in the accent. On launch it types
   itself out one letter at a time, and the underscore then blinks once a second like a prompt. The canvas loops the
   typing every eight seconds so it can be seen; the app plays it once.
2. **The words** — "Your agents await." (serif, the greeting), and under it "RESISTANCE IS OPTIONAL" (monospace, small
   capitals, spaced), the strapline.
3. **Two characters.** The **Orb** (the default): a floating round body that is mostly one eye, with two gold-tipped
   eyestalks and a small gold crown. The **Dark Lord**: a horned helm with gold trim and two amber eyes in a T-shaped
   visor. Each has the same fourteen moods.
4. **The splash screen** — the character in Neutral, the wordmark, the greeting and the strapline. One per character.
5. **The icons** — the home-screen icon (512, rounded square), the maskable icon (192, the mark inside the inner 80%),
   a light variant, and the favicon, which is the Orb's eye alone, because the whole Orb blurs at 32.

## The moods, and when the app shows each

The app-state column is the canvas's suggestion, for the implementation's plan to confirm.

| Mood | The Orb | The Dark Lord | Shown when |
|---|---|---|---|
| Neutral | looks about, blinks | steady eyes, a calm blink | the everyday face |
| Happy | the lower lid smiles, hops | eyes curve up, hops | a wave landed, the checks are green |
| Laughing | eye squeezed shut, shakes | eyes scrunched into chevrons, shakes | everything merged first time |
| Sleeping | eye closed, breathing, Zs; every 9 s peeks under a heavy lid, looks left, right, centre | eyes shut to lines, Zs; opens the left eye, then the right | the fleet is idle |
| Thinking | pupil up and aside, drifting; three dots tick | eyes high, drifting; three dots tick | sessions are working, nothing needs you |
| Alert | eye wide, hops, a flashing `!` | eyes wide, hops, a flashing `!` | a session has a question for you |
| Suspicious | eye narrowed to a slit, sliding | eyes narrowed to lines, sliding | a reviewer is re-measuring a "done" claim |
| Confused | one side of the lid lowered, pupil swings; a `?` | one eye wide, one narrowed, swapping; a `?` | a worker went quiet and nobody knows why yet |
| Sad | the upper lid droops, eye down, a slow blink | eyes droop at the outer corners, a slow blink | a session is stuck, waiting on you |
| Crying | Sad, with tears, sobbing | Sad, with tears down the helm, sobbing | a session died, or an account hit its limit |
| Afraid | eye wide, pinprick pupil darting, trembling, sweat | eyes wide, small pupils darting, trembling, sweat | something destructive waits for your say-so |
| Angry | lid pulled down in a V, shaking | eyes slanted and red, shaking | something was refused, or keeps failing |
| Dizzy | pupil circling, swaying | eyes circling, swaying | an account swap or a rate limit is in progress |
| Offline | grey, eye crossed out, still | grey, eyes crossed out, still | the app cannot reach the box |

Each mood is one file, `docs/design/overlord/svg/<character>-<mood>.svg`, with its animation inside it (`orb-sleeping.svg`,
`dark-lord-alert.svg`). `docs/design/overlord/reference.html` shows everything at once: both splash screens, the icons
and both mood sets.

## Choosing a character

The operator picks the Orb or the Dark Lord at setup, and can swap at any time in Settings, beside the theme picker.
The choice is saved per person, not per device, and applies at once, with no reload. The Orb is the default.

## What the platforms allow

- **The home-screen and Dock icon is fixed.** It is taken when the app is installed, cannot animate, and does not
  reliably follow a later change, so it cannot follow the character choice. The canvas draws it with the Orb; an
  alternative is a mark that belongs to neither character (the crown, or `o_`). The open question below.
- **The icon can carry a count.** The Badging API (`navigator.setAppBadge`) puts a number on the installed icon, on the
  Dock and on phones that support it. The tree does not use it yet. The count of sessions waiting on the operator is
  the candidate.
- **A push notification's picture is still.** The mood can show in a notification's icon as its still frame, where the
  platform shows a custom icon at all. Dizzy, Thinking and Laughing rely on motion, so their still frame must be chosen
  with care. The animations play inside the app.

## What must not change

- Phosphor's palette, its tokens and the contrast gate's pairs. The characters read tokens; they add no palette.
- The fonts the app ships (Geist, Geist Mono). The canvas set its text in JetBrains Mono, Source Serif 4 and Inter as
  stand-ins; whether the brand earns a face of its own is an open question, not a given.

## Open questions

1. **The installed icon:** the Orb, as drawn, or a mark neither character owns, since the icon cannot follow the choice?
2. **The brand's type:** the wordmark and the serif greeting in the shipped families, or one new face for the brand?
3. **The two non-token values** (the shading, the tears' blue): which tokens they become.
4. **Which moods ship first.** Neutral, Thinking, Alert and Sleeping cover what the app shows most of the time.

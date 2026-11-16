// vaul's motion, on the tokens (D-5930). The one place it is retimed.
//
// vaul slides its panel and fades its overlay with KEYFRAMES ('slideFromBottom',
// 'fadeIn' and the closing pair), at an unlayered 'animation-duration: .5s' it
// injects at runtime. A transition utility never reaches a keyframe, so the
// retime is on the animation properties, and important because vaul's rule is
// unlayered: a layered utility wins over it only on importance.
//
// vaul also moves the panel with a TRANSITION of its own: the snap-back after a
// drag that does not dismiss ('resetDrawer' inlines 'transition: transform .5s
// cubic-bezier(.32,.72,0,1)') and the drag-dismiss slide. An inline style yields
// only to an important declaration, so 'VAUL_MOTION' retimes the transition too,
// from the same four variables: under reduced motion the snap-back is 1ms, not
// vaul's half second. The command palette has no drag, so for it they are inert.
//
// 'VAUL_MOTION' reads four variables; each surface sets them from the tokens
// ('SHEET_MOTION_VARS', 'PALETTE_MOTION_VARS'). The tokens' reduced-motion
// block takes every '--dur-*' to 1ms, so a surface that is on the tokens
// honours 'prefers-reduced-motion' with nothing more.
//
// EVERY CLASS HERE IS WRITTEN LITERALLY. Tailwind emits CSS only for the class
// tokens it reads in the source (the @source glob over ts and tsx), so a class built
// at runtime would ship with no rule behind it. Join these with '+' and a
// space, never by interpolation ('pwa/test/sheet-motion.test.tsx' scans this
// file for one).

/** vaul's keyframes and its inline drag transitions, timed by '--vaul-in-*' while open and '--vaul-out-*' while closing. */
export const VAUL_MOTION =
  'data-[state=open]:[animation-duration:var(--vaul-in-dur)]!'
  + ' data-[state=open]:[animation-timing-function:var(--vaul-in-curve)]!'
  + ' data-[state=closed]:[animation-duration:var(--vaul-out-dur)]!'
  + ' data-[state=closed]:[animation-timing-function:var(--vaul-out-curve)]!'
  + ' data-[state=open]:[transition-duration:var(--vaul-in-dur)]!'
  + ' data-[state=open]:[transition-timing-function:var(--vaul-in-curve)]!'
  + ' data-[state=closed]:[transition-duration:var(--vaul-out-dur)]!'
  + ' data-[state=closed]:[transition-timing-function:var(--vaul-out-curve)]!';

/** The Sheet's pace: the entrance springs ('--dur-sheet'), the exit leaves swiftly ('--dur-slow'). */
export const SHEET_MOTION_VARS =
  '[--vaul-in-dur:var(--dur-sheet)]'
  + ' [--vaul-in-curve:var(--curve-spring)]'
  + ' [--vaul-out-dur:var(--dur-slow)]'
  + ' [--vaul-out-curve:var(--curve-swift)]';

/** The command palette's pace (D-5457): in at '--dur-base', out at '--dur-fast', both on the swift curve. */
export const PALETTE_MOTION_VARS =
  '[--vaul-in-dur:var(--dur-base)]'
  + ' [--vaul-in-curve:var(--curve-swift)]'
  + ' [--vaul-out-dur:var(--dur-fast)]'
  + ' [--vaul-out-curve:var(--curve-swift)]';

/** The Sheet's desktop arm's pace (D-5933, D-6032): from 900 the centred dialog fades in at '--dur-base' and out at
 *  '--dur-fast', both on the swift curve, scrim and panel alike. Written after 'SHEET_MOTION_VARS' on the same
 *  element, so at that width these win (a media variant is emitted after the plain utility). */
export const SHEET_DESK_MOTION_VARS =
  'min-[900px]:[--vaul-in-dur:var(--dur-base)]'
  + ' min-[900px]:[--vaul-in-curve:var(--curve-swift)]'
  + ' min-[900px]:[--vaul-out-dur:var(--dur-fast)]'
  + ' min-[900px]:[--vaul-out-curve:var(--curve-swift)]';

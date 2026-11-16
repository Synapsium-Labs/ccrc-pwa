// The reader lab's checks, in the result's order (native Docs reader, the reader lab plan of 2026-11-03, Task 8; the
// reader lab design, section 3.2). Ring L1: it imports nothing.

/** The ten lines: the seven walls and the teardown signal (E18), then the two E17 lines. */
export type LabCheckId = 'opaque-origin' | 'no-ambient-state' | 'no-cookie' | 'csp-27' | 'no-popup-top-nav'
  | 'no-self-navigate' | 'bridge-strays' | 'self-nav-teardown' | 'busy-frame' | 'mermaid';

/** The step after which each line has its outcome (the run's step numbers; `csp-27` waits for the hostile page). */
export const LAB_CHECK_STEP: Readonly<Record<LabCheckId, number>> = {
  'opaque-origin': 2, 'no-ambient-state': 2, 'no-cookie': 3, 'csp-27': 7, 'no-popup-top-nav': 1,
  'no-self-navigate': 5, 'bridge-strays': 7, 'self-nav-teardown': 5, 'busy-frame': 6, mermaid: 8,
};
export const LAB_CHECKS = Object.keys(LAB_CHECK_STEP) as LabCheckId[];
/** The seven walls, which E18's summary counts. */
export const LAB_WALLS: readonly LabCheckId[] = LAB_CHECKS.slice(0, 7);
/** E18's lines: the seven walls, then the engine's teardown signal. */
export const LAB_E18: readonly LabCheckId[] = LAB_CHECKS.slice(0, 8);
/** E17's lines: the busy frame's fact and the Mermaid stall. */
export const LAB_E17: readonly LabCheckId[] = LAB_CHECKS.slice(8);

/** A line's outcome. Every line has three, never two: the walls and `mermaid` answer `holds`, `does-not-hold` or
 *  `not-measured`; `self-nav-teardown` answers `holds`, `differs` (from desktop Chromium: a miss E18 investigates, never a
 *  broken wall) or `not-measured`; `busy-frame` is a fact that gates nothing: `shared-thread`, `own-thread` or
 *  `not-measured`. */
export type LabVerdict = 'holds' | 'does-not-hold' | 'not-measured' | 'differs' | 'shared-thread' | 'own-thread';
export interface LabOutcome {
  readonly verdict: LabVerdict;
  /** A short fact for the result line; empty when there is none. */
  readonly detail: string;
}

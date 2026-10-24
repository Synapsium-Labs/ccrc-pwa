// The one step an arrow key, Home or End takes across `n` items (T2c, D-6329): right and down to the next, left and up
// to the previous, Home to the first, End to the last, and null for any other key. FleetTable's toggle and tabs wrap
// (a choice that cycles); the lanes row's cards do not (a list of places read most free first). Pure: the event half
// (preventDefault, the pick, the focus) stays with each caller.
const STEP: Readonly<Record<string, number>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

export function rovingStep(key: string, at: number, n: number, _opts: { wrap: boolean }): number | null {
  return key === 'Home' ? 0 : key === 'End' ? n - 1
    : STEP[key] === undefined ? null : (at + STEP[key]! + n) % n;
}

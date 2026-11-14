// Overlord W1a, launch profiles PR B, Task 6 (spec §3.3.7 H14, Table 11.1d): auto memory for `plain` sessions, a Settings row.
// This file is its L0 half: the two choices, the default, the wire view of `GET`/`POST /api/coord/plain-auto-memory` and the
// row's words. L0: the PWA bundles `shared/`, so this file imports nothing. It sits outside `shared/api.ts` for
// `lane-arm.ts`'s reason: other programmes append at that file's foot.
//
// WHAT IT MOVES. Nothing, on its own: the launch-profile lane reads it for a session whose role reads `plain` and writes the
// route field `automem` from it, and ccd applies that at the session's next launch. While the `launch-profile` lane is shadow
// (its Shadow lanes row), no route is written, so this row changes no session. Every other role's auto memory is off by its
// profile, whatever this row says.

/** The row's two stored choices (`plain_memory_settings.choice`): `on` keeps Claude Code's auto memory for plain sessions,
 *  `off` turns it off at their next launch. */
export const PLAIN_AUTO_MEMORY_CHOICES = ['off', 'on'] as const;
export type PlainAutoMemoryChoice = (typeof PLAIN_AUTO_MEMORY_CHOICES)[number];
export function isPlainAutoMemoryChoice(v: unknown): v is PlainAutoMemoryChoice {
  return typeof v === 'string' && (PLAIN_AUTO_MEMORY_CHOICES as readonly string[]).includes(v);
}
/** The default on a fleet host (H14): off. The migration seeds it, and a lost row reads as it. */
export const PLAIN_AUTO_MEMORY_DEFAULT: PlainAutoMemoryChoice = 'off';

/** `GET`/`POST /api/coord/plain-auto-memory`'s answer: the choice as read (null when the stored row could not be read or
 *  holds a word this build does not know, which the lane reads as unmeasured and writes nothing for), the default and the
 *  choices. */
export interface PlainAutoMemoryView {
  choice: PlainAutoMemoryChoice | null;
  default: PlainAutoMemoryChoice;
  choices: readonly PlainAutoMemoryChoice[];
}

/** The row's words. One sentence each; nothing in the PWA retypes one. */
export const PLAIN_AUTO_MEMORY_TEXT = {
  legend: 'Auto memory for plain sessions',
  purpose: 'Whether a session that is neither a coordinator nor a dispatched worker keeps Claude Code\'s auto memory. '
    + 'Every other role has it off.',
  choices: { off: 'Off', on: 'On' } satisfies Record<PlainAutoMemoryChoice, string>,
  notes: {
    off: 'From its next launch, a plain session loads no project memory and writes none. Nothing is deleted.',
    on: 'Plain sessions keep Claude Code\'s auto memory: each loads its account\'s project memory and may add to it.',
  } satisfies Record<PlainAutoMemoryChoice, string>,
  shadow: 'This applies once the Launch profiles lane is live (Settings › Automation › Shadow lanes); until then no launch changes.',
  unread: 'The server could not read this row, so plain sessions are left as they are.',
} as const;

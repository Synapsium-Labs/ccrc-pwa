// The stall watch's L0 values that live outside `shared/api.ts` (stall watch settings, design 2026-10-05 §12 and §13;
// programme stall-watch-settings, wave 4). `shared/api.ts` is cited by line from the spec and plan corpus, and other
// programmes append at its foot, so these sit in a file of their own. L0: the PWA bundles `shared/`, so this file
// takes no value import and no `node:` module. Its one import is a type from `./api.js`, erased at build.
//
// What lives here, once:
// - `StallWatchRefusal`, `STALL_WATCH_REFUSALS` and `isStallWatchRefusal`: the codes `POST /api/coord/stall-watch`
//   refuses with. `stall-settings-route.test.ts` holds the list equal to the codes the POST handler sends.
// The line for an answer that carries none of those codes is `STALL_CONFIRM_TEXT.unconfirmed`, in `shared/api.ts`
// with the section's other words, where the PWA's device-word scan reads it.
import type { StallConfirmRequired } from './api.js';

/** Every refusal code `POST /api/coord/stall-watch` answers with (stall-watch settings §10, §13): spelled once, as a
 *  total table's keys, and the runtime list derived. An answer carrying any other code confirms nothing about the
 *  write (`an-answer-without-a-refusal-code-reads-unconfirmed` (D-4045)). */
export type StallWatchRefusal = 'bad-request' | 'not-configured' | StallConfirmRequired['error'];
const STALL_WATCH_REFUSAL_TABLE: Readonly<Record<StallWatchRefusal, true>> = {
  'bad-request': true, 'not-configured': true, 'confirm-required': true,
};
export const STALL_WATCH_REFUSALS: readonly StallWatchRefusal[] =
  Object.keys(STALL_WATCH_REFUSAL_TABLE) as StallWatchRefusal[];
/** The refusal guard: the `includes` form, never `in`, so an inherited key such as `constructor` is never a code. */
export function isStallWatchRefusal(v: unknown): v is StallWatchRefusal {
  return typeof v === 'string' && (STALL_WATCH_REFUSALS as readonly string[]).includes(v);
}

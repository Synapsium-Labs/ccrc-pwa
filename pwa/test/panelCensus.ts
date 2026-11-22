// THE SESSION PANEL'S BANNED WORDS (session helpers HF2, D-8877; review 3123 F1): one owner of what no page of the session
// panel may say, read by the jsdom census (`session-panel-sheds.test.tsx`), the real-Chrome ones
// (`session-panel-words.browser.test.ts`, `delegation-rows.browser.test.ts`) and the words module's own rows
// (`delegation-words.test.ts`).
//
// Spec 2026-11-19-session-helpers-design §4.4 spells the five words out, and they are written here as literals, on their own:
// `LIVENESS_QUALIFIER` (`delegationWords.ts`) is kept as wire tolerance (the coordinator's ruling on review 3123, call 98) and
// no page reads it, so a census that took its words from that table alone would loosen with any edit to it. The table's words
// and sentences are banned too, and `delegation-words.test.ts` pins that its words are these five.
import { LIVENESS_QUALIFIER } from '../src/fleet/delegationWords';

/** §4.4's five words, as the spec spells them: "none of the liveness words a worktree row carries today". */
export const SECTION_4_4_WORDS = ['not confirmed', 'stop not seen', 'session asleep', 'end recorded', 'unmeasured'] as const;

/** Every word and sentence no page of the session panel may say: §4.4's five, and the table's words and sentences. */
export const PANEL_BANNED: readonly string[] = [
  ...new Set([...SECTION_4_4_WORDS, ...Object.values(LIVENESS_QUALIFIER).flatMap((q) => [q.word, q.title])]),
];

/** The banned words and sentences found in `texts`, case-insensitively. */
export const bannedIn = (texts: readonly string[]): string[] =>
  PANEL_BANNED.filter((w) => texts.some((t) => t.toLowerCase().includes(w.toLowerCase())));

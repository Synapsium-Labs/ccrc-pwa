import {
  COORD_DB_STATE_MAP, FLOOR_STATE_MAP, READY_VERDICT_MAP, SKILL_STATE_MAP, TOKEN_STATE_MAP,
  READINESS_KEYS, preconditionCell,
  type ProjectReadiness, type ReadinessFacts, type ReadyVerdict,
} from '../../../shared/api';

/**
 * The program-ready badge's words and glyphs (program-leverage wave 3, F3).
 *
 * `runWords.ts`'s idiom, and its alphabet: a `Record` keyed BY the type so a
 * member added to the union with no entry here is a compile error rather than
 * a silently unlabelled badge, and the same four characters the rest of this
 * board already uses — nothing invents a fifth vocabulary of shapes.
 *
 * The two-cue rule: a word AND a glyph, never colour alone. A badge that says
 * "ready" only by being green is unreadable to a colour-blind operator and
 * invisible in a screenshot.
 */
export const READY_GLYPH: Record<ReadyVerdict, string> = {
  ready: '✓',
  blocked: '✕',
  unknown: '?',
};

/** The glyph for the arm that is NOT a verdict: the server measures readiness
 *  and has not swept yet (`readiness: null` on the wire). `·` is this board's
 *  standing "nothing to report yet" mark. */
export const READY_PENDING_GLYPH = '·';

export function readinessWord(r: ProjectReadiness): string {
  return READY_VERDICT_MAP[r.verdict];
}

/**
 * Every precondition that is NOT ok, said in its own vocabulary's words.
 *
 * Reads the shared maps rather than retyping their members: a free-standing
 * list of the words here is exactly the drift `single-definition.test.ts`
 * exists to catch, and its own comment names "a PWA badge" as the case.
 *
 * Note what this deliberately does NOT do: it never says "not ready" for a
 * precondition that merely could not be measured. `SKILL_STATE_MAP` and
 * friends carry the honest phrase for each arm, and the caller renders the
 * verdict word beside them.
 */
/** How each precondition names itself when it is NOT ok. The MAPS are the
 *  vocabulary; this only supplies the noun the map cannot know. */
const PHRASE: { readonly [K in keyof ReadinessFacts]: (r: ProjectReadiness) => string } = {
  worker: (r) => `worker skill ${SKILL_STATE_MAP[r.worker]}`,
  coordinator: (r) => `coordinator skill ${SKILL_STATE_MAP[r.coordinator]}`,
  floor: (r) => FLOOR_STATE_MAP[r.floor],
  boxToken: (r) => TOKEN_STATE_MAP[r.boxToken],
  coordDb: (r) => COORD_DB_STATE_MAP[r.coordDb],
};

export function missingPreconditions(r: ProjectReadiness): string[] {
  // The ok-test is `preconditionCell`, NOT a second copy of each vocabulary's
  // ok member (fix round 1, minor 5). Re-spelling them here is how this list
  // and `readyVerdict` came to be able to disagree — a badge reading "not
  // ready" over an empty list, or the reverse.
  return READINESS_KEYS
    .filter((k) => preconditionCell(r, k) !== 'ok')
    .map((k) => PHRASE[k](r));
}

/** The sentence behind the badge. `ready` has nothing to list, so it says so
 *  rather than rendering an empty tooltip. */
export function readinessTitle(r: ProjectReadiness): string {
  const missing = missingPreconditions(r);
  return missing.length === 0 ? 'all program preconditions hold' : missing.join('; ');
}

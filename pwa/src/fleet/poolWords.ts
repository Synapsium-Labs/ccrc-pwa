// The POOL surface's shared sentences — the three that two or three screens
// were each spelling for themselves.
//
// WHY A WORDS FILE AND NOT ONE PER SCREEN. Pools are one vocabulary across
// four surfaces (the project sheet, the account sheet, the accounts screen and
// the card's chip), and these three sentences say the same thing about an
// account and about a project. Every OTHER sentence on those surfaces is
// subject-specific and stays where it is — `${project}'s pool tag is
// malformed.` names a file the account side has no equivalent of.
//
// FOUND BY THE LITERAL CENSUS. None of these is a class, an element or a
// stylesheet rule, so the three censuses that came before it were structurally
// blind to them: they are copy, in template literals, inside ternaries.

/** The default arm of a state switch this build does not know. It is reached
 *  through a `never` exhaustiveness check on the account side and through a
 *  ternary's tail on the project side — same sentence, same cause: the wire
 *  grew a pool state this bundle predates. */
export const poolAppOlder = (subject: string): string =>
  `This app is older than the fleet; reload to understand ${subject}'s pool.`;

/** The write landed and left nothing behind — said of an account or of a
 *  project, which is why it takes the subject rather than naming one. */
export const poolCleared = (subject: string): string => `${subject} is no longer in a pool.`;

/** The write's refusal, as a toast. Un-terminated after the dash: the detail
 *  that follows is `apiErrorText`'s, and it carries its own punctuation. */
export const poolWriteFailed = (detail: string): string => `Couldn't set the pool — ${detail}`;

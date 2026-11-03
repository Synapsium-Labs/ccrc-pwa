// Hand-written types for `shared/redact.mjs`, the one implementation (the `models.d.mts` pattern). The names and the
// shapes are the `.mjs`'s exactly; `shared/redact.ts` re-exports them for TypeScript callers.

/** The profiles: a profile is the frozen list of rule ids it runs, in order. */
export type RedactProfile = 'egress' | 'docs' | 'linear-egress';

/** The two credential shapes the egress and linear-egress profiles read from their caller (their one home is
 *  `CREDENTIAL_MASKS` in `shared/api.ts`, which this module cannot import): a bare regular-expression source each. */
export interface RedactShapes {
  readonly genericSk: string;
  readonly jwt: string;
}

/** The egress mask. */
export const EGRESS_MASK: '[REDACTED]';

/** Every rule id, in table order. */
export const RULE_IDS: readonly string[];

/** Each profile's rule ids, in the order they run. */
export const PROFILES: { readonly [P in RedactProfile]: readonly string[] };

/** `text` with every rule of `profile` applied. The egress and linear-egress profiles need `shapes` (they throw
 *  without them); the docs profile takes none. Idempotent per profile. `redactCount(…).text`. */
export function redact(profile: RedactProfile, text: string, shapes?: RedactShapes): string;

/** What `redactCount` answers: the redacted text, and the number of spans the steps replaced with a different text. */
export interface RedactCount {
  readonly text: string;
  readonly masked: number;
}

/** The same steps as `redact`, counted (#1444). */
export function redactCount(profile: RedactProfile, text: string, shapes?: RedactShapes): RedactCount;

/** The docs profile's rows as `[pattern, suffix]`, in profile order: what `DOCS_REDACT_RULES` is. */
export function docsRuleRows(): [pattern: string, suffix: string][];

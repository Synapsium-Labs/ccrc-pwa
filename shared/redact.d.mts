// Hand-written types for `shared/redact.mjs`, the one implementation (the `models.d.mts` pattern). The names and the
// shapes are the `.mjs`'s exactly; `shared/redact.ts` re-exports them for TypeScript callers.

/** The profiles: a profile is the frozen list of rule ids it runs, in order. */
export type RedactProfile = 'egress' | 'docs' | 'linear-egress';

/** The two history profiles (C1l PR 2, R11): rule sets `historyRules` builds for `ccd/history/lib.mjs`, never text steps. */
export type HistoryProfile = 'history-base' | 'history-v2';

/** One form of a history rule set: `final`, and one pattern per slot. */
export interface HistoryRuleForm {
  readonly final: boolean;
  readonly json: RegExp;
  readonly namedHead: RegExp;
  readonly namedTail: RegExp;
  readonly namedValue: RegExp;
  readonly bearer: RegExp;
  readonly mailToken: RegExp;
  readonly bearerSticky: RegExp;
  readonly mailTokenSticky: RegExp;
  readonly query: RegExp;
}

/** A history rule set: the field pass's form and the second belt's structure-safe form. */
export interface HistoryRuleSet {
  readonly field: HistoryRuleForm;
  readonly final: HistoryRuleForm;
}

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
export const PROFILES: { readonly [P in RedactProfile | HistoryProfile]: readonly string[] };

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

/** The rule set a history profile names, as `ccd/history/lib.mjs` reads it; fresh expressions on every call. Throws for
 *  any other profile. */
export function historyRules(profile: HistoryProfile): HistoryRuleSet;

/** The docs profile's rows as `[pattern, suffix]`, in profile order: what `DOCS_REDACT_RULES` is. */
export function docsRuleRows(): [pattern: string, suffix: string][];

// The typed re-export of `shared/redact.mjs`, the one implementation (the `models.ts` pattern, D-5867). Nothing is
// defined here: the rule table, the profiles, `redact` and `redactCount` live in the `.mjs`, whose types are
// `redact.d.mts`.
export {
  EGRESS_MASK, PROFILES, RULE_IDS, docsRuleRows, redact, redactCount, type RedactCount, type RedactProfile, type RedactShapes,
} from './redact.mjs';

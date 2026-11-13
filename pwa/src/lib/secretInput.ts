/**
 * THE ONE WAY A SECRET-ENTRY FIELD SAYS "NOT A LOGIN" (D-8404): spread on every input where a key, token or sign-in
 * code is pasted (`{...SECRET_INPUT}`), and on no other.
 *
 * A masked field with `autocomplete="off"` alone is still a login slot to a browser or a password manager, which
 * offered saved logins in Settings' Linear key field. This set turns off autocomplete, capitalisation, correction and
 * spellcheck, and carries each manager's own opt-out: 1Password (`data-1p-ignore`), LastPass (`data-lpignore`),
 * Bitwarden (`data-bwignore`) and Dashlane (`data-form-type="other"`).
 *
 * - It never says `new-password` (that invites a manager to generate one) or `one-time-code` (a phone offers an SMS
 *   code). A field that is masked today stays `type="password"`: masking is the field's, not this set's.
 * - The field carries no `name`, and its id comes from `useId`, so nothing a manager keys on is left.
 * - The console's own passphrase (sign-in, the step-up) is the one password here, keeps `current-password` and never
 *   spreads this. `pwa/test/secret-input.test.ts` holds which files do.
 */
export const SECRET_INPUT = {
  autoComplete: 'off',
  autoCapitalize: 'off',
  autoCorrect: 'off',
  spellCheck: false,
  'data-1p-ignore': 'true',
  'data-lpignore': 'true',
  'data-bwignore': 'true',
  'data-form-type': 'other',
} as const;

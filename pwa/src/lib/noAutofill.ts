/**
 * NO AUTOFILL (D-8405): the attributes that keep a browser's and a password manager's saved sign-in out of a field
 * that is not the sign-in.
 *
 * Settings › Linear's "Add a workspace" key field is `type="password"`, and `autocomplete="off"` alone did not hold:
 * browsers ignore `off` on a password field and offer, or fill, the operator's saved console passphrase there, which
 * is not a Linear API key. Two shapes, one per kind of field:
 *
 * - {@link SECRET_NO_AUTOFILL} for a pasted key or token (`type="password"`): `autocomplete="new-password"`, the one
 *   value browsers honour on a password field as "do not fill a saved password here".
 * - {@link TEXT_NO_AUTOFILL} for a short text box near one (a team key): `autocomplete="off"`.
 *
 * Both carry {@link PASSWORD_MANAGER_IGNORE}, the opt-out each common password manager reads (1Password, LastPass,
 * Bitwarden, Dashlane), since an extension does not follow `autocomplete`. The sign-in and step-up passphrase fields
 * (`current-password`) do not use these: filling those is wanted.
 */
export const PASSWORD_MANAGER_IGNORE = {
  'data-1p-ignore': 'true',
  'data-lpignore': 'true',
  'data-bwignore': 'true',
  'data-form-type': 'other',
} as const;

/** Spread on a pasted key or token field (`type="password"`). */
export const SECRET_NO_AUTOFILL = { autoComplete: 'new-password', ...PASSWORD_MANAGER_IGNORE } as const;

/** Spread on a short text box that is not a credential. */
export const TEXT_NO_AUTOFILL = { autoComplete: 'off', ...PASSWORD_MANAGER_IGNORE } as const;

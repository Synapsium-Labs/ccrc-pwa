// THE ONE ASSERTION A SECRET-ENTRY FIELD IS HELD TO (D-8404). Every test that mounts a field where a key, token or
// sign-in code is pasted calls it, so a field that drops one opt-out is red in its own suite, and the four suites
// cannot each check a different subset. Not a test file, so it registers no suite of its own.
import { expect } from 'vitest';

/** A name or id a browser or password manager reads as a credential slot. `useId`'s ids never match it. */
const CREDENTIAL_LIKE = /pass|pwd|user|login|email|token|secret|key|card|otp|code|auth/i;

/** The field does not invite autofill: autocomplete, autocapitalize and autocorrect off, no spellcheck, the
 *  password-manager opt-outs (1Password, LastPass, Bitwarden, Dashlane), and no name or id a manager keys on. */
export function expectSecretInput(el: HTMLInputElement): void {
  expect(el.getAttribute('autocomplete')).toBe('off');
  expect(el.getAttribute('autocapitalize')).toBe('off');
  expect(el.getAttribute('autocorrect')).toBe('off');
  expect(el.getAttribute('spellcheck')).toBe('false');
  expect(el.hasAttribute('data-1p-ignore')).toBe(true);
  expect(el.getAttribute('data-lpignore')).toBe('true');
  expect(el.hasAttribute('data-bwignore')).toBe(true);
  expect(el.getAttribute('data-form-type')).toBe('other');
  expect(el.hasAttribute('name')).toBe(false);
  expect(el.id).not.toMatch(CREDENTIAL_LIKE);
}

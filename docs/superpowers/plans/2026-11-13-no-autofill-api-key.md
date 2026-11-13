# No autofill in key fields

- **D-8405 (2026-11-13)** — `no-autofill-api-key`: a field where a Linear API key, a provider key or a ledger secret is pasted carries `autocomplete="new-password"` and the password managers' opt-outs (`SECRET_NO_AUTOFILL`, `pwa/src/lib/noAutofill.ts`); Settings › Project linking's team key box carries `autocomplete="off"` and the same opt-outs (`TEXT_NO_AUTOFILL`). The sign-in and step-up passphrase fields keep `current-password`.

## Why

The operator asked (2026-11-13, a screenshot of Settings) that the browser stop filling the API key field. Settings ›
Linear's "Add a workspace" field is `type="password"` with `autocomplete="off"`. Browsers ignore `off` on a password
field, so the console's saved sign-in was offered, or filled, in a field that takes a Linear API key. A password
manager extension does not read `autocomplete` at all.

## What changes

- `pwa/src/lib/noAutofill.ts`: `PASSWORD_MANAGER_IGNORE` (`data-1p-ignore`, `data-lpignore`, `data-bwignore`,
  `data-form-type="other"`), `SECRET_NO_AUTOFILL` (`autocomplete="new-password"`, the value browsers honour on a
  password field as "do not fill a saved password here") and `TEXT_NO_AUTOFILL` (`autocomplete="off"`).
- `SECRET_NO_AUTOFILL` on the three pasted-secret fields: `pwa/src/screens/LinearSection.tsx` (Add a workspace),
  `pwa/src/accounts/SecretField.tsx` (account keys and tokens) and `pwa/src/ledgers/ItemView.tsx` (a ledger item's
  secret).
- `TEXT_NO_AUTOFILL` on `pwa/src/screens/settings/ProjectLinkingCard.tsx`'s team key box, the formless text box on
  the same page a browser would take for a user name.

## Deviations found

- The accounts specs (`2026-09-05-account-connections-ui-design.md`, `2026-10-18-accounts-connect-design.md`) say
  the secret field is `autocomplete="off"`. It is now `new-password` with the opt-outs, because `off` does not hold on
  a password field. The specs are not edited; `SecretField.tsx`'s header names the change.
- Not done here: the same screenshot's Project linking rows (a project repeating, a team key typed by hand). They
  were not part of this request.

## Tests

- `pwa/test/linear-section.test.tsx`, `secret-field.test.tsx`, `item-secret.test.tsx`: each secret field is
  `type="password"` with `autocomplete="new-password"`, every opt-out attribute, and (where it held before) no `name`.
- `pwa/test/project-linking-card.test.tsx`: every row's team key box, empty or holding a key, has
  `autocomplete="off"`, every opt-out attribute and no `name`.

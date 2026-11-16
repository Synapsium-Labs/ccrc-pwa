# Secret-entry fields: nothing autofills them

- **D-8404 (2026-11-13)** — `secret-input-no-autofill`: every field where a key, token or sign-in code is pasted spreads one set of attributes, `SECRET_INPUT` (`pwa/src/lib/secretInput.ts`): `autocomplete="off"`, `autocapitalize="off"`, `autocorrect="off"`, `spellcheck=false`, and the password managers' own opt-outs `data-1p-ignore`, `data-lpignore="true"`, `data-bwignore` and `data-form-type="other"`. Masked fields stay `type="password"`; none says `new-password`. The sign-in code field moves from `autocomplete="one-time-code"` to the same set (a departure from the accounts-connect design's §6.2 row 6 and §12.4). The console's own passphrase fields keep `current-password`.

## Why

Browsers and password managers offered saved logins in Settings' "Add a workspace: its Linear API key" field. It was
`type="password"` with `autocomplete="off"`, and a masked field with only that is still a login slot to them. The
other secret fields each spelled a slightly different subset of the same attributes by hand.

## The fields

| File | Field | Before | After |
|---|---|---|---|
| `pwa/src/screens/LinearSection.tsx` | Add a workspace: its Linear API key | password; autocomplete, autocapitalize, spellcheck off | password; `SECRET_INPUT` |
| `pwa/src/accounts/SecretField.tsx` | Connect and Replace: the pasted token or API key | password with Show; autocomplete, autocapitalize, autocorrect, spellcheck off | password with Show; `SECRET_INPUT` |
| `pwa/src/ledgers/ItemView.tsx` | A ledger item's secret | password; autocomplete, autocapitalize, spellcheck off | password; `SECRET_INPUT` |
| `pwa/src/accounts/CodeField.tsx` | The sign-in code claude.ai shows | text; `one-time-code` | text; `SECRET_INPUT` |

Not secret fields, unchanged: `accounts/ConfirmItsYou.tsx` and `components/LoginScreen.tsx` (the console's own
passphrase: a password manager filling it is the point, `current-password`), the Linear team key in
`screens/settings/ProjectLinkingCard.tsx` (a short team prefix, not a credential), and the test box's address, port
and login in `fleet/TestBoxConnect.tsx`.

## Deviations found

- The code field's `one-time-code` (the accounts-connect design, §6.2 row 6 and §12.4) invites a phone to offer an
  SMS code and a password manager to offer an authenticator code. The code is claude.ai's and is never either, so it
  joins the set like the other secret fields.

## Tests

- `pwa/test/secretInputAttrs.ts`: `expectSecretInput`, the one assertion of the whole set (and no `name`, and an id
  that is not credential-like). `linear-section.test.tsx`, `secret-field.test.tsx`, `item-secret.test.tsx` and
  `code-field.test.tsx` call it on their field.
- `pwa/test/secret-input.test.ts`: the set's exact contents; the four files above are exactly the ones that spread
  it; any other masked input is red until it is named as a secret field or the passphrase; only the passphrase files
  say `current-password`; no secret field sets its own `autoComplete`.

## Layout

Attributes only: no markup, class or style changes, so the cards read as before at 390, 1280 and 1920.

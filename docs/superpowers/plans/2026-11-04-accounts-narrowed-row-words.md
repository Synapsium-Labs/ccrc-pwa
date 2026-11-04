# Accounts connect: the words on a narrowed provider or method row

**Goal:** the Add account sheet stops telling the operator to update a fleet that is already up to date.

**Before this change:** a provider or method whose cap word the fleet does not advertise narrowed in place with "Needs a fleet update". On a fully updated fleet that line still showed for OpenAI and OpenRouter, because no release supports them yet, so an update would not have helped.

**This change:** those rows read "Not available on this fleet yet", which stays true whether or not a later release adds the row. The constant is now `NOT_ON_THIS_FLEET_YET` (`pwa/src/fleet/accountWords.ts`), and `pwa/test/connect-sheet.test.tsx` pins the literal words.

**Not changed:** which rows narrow, and when. The door's own `unsupported` line, "Needs a fleet update: the fleet host doesn't support adding accounts yet.", stays: it shows when the agent or `ccd caps` lacks `account-v2`, and an update does cure that. Earlier plans keep their wording as the record of what they built.

## Deviations found

- **D-7991 (2026-11-04)** — `narrowed-row-words-promise-no-update` (N4; the operator's ruling of 2026-11-03): the accounts plan's method step said "Needs a fleet update". As built, a row the fleet does not advertise reads "Not available on this fleet yet", because a missing cap word does not show that an update exists. The sheet still cannot tell "update to get this" from "no release has this", so it claims neither.

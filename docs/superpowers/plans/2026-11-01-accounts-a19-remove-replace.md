# Accounts connect A19: Remove, Discard, Replace token by paste, the revoke checklist and the compromise disclosure

**Goal:** plan Task A19 of `2026-10-18-accounts-connect.md` (spec §9, §11, §3.11; N3, N6; G34). The Accounts screen's fold gets **Remove…** on every lane and **Replace token** on an Anthropic token lane. Remove runs the box's pre-check, blocks on live and sleeping sessions with a way through (A3's mover, and Wake and move), then takes a typed-id confirm and a danger button with step-up, and shows the verb's ledger with each kind's revoke link and, for a token, the revoke checklist item. **Discard this lane** is offered where the box measures a lane discardable. Replace token takes a pasted token, validate-first, then runs a fresh check, lists the live sessions with one-tap Restart, and ends with the revoke checklist item. `CompromiseSteps` is spec §3.11's disclosure. The decisions this task makes are numbered D-7742 below.

**The OA1 record** (`2026-11-01-accounts-oa1-record.md`), read where this task touches it:
- **G23 was not measured.** A sign-in lane's row at the provider says the result is **unmeasured**: "Signed out here. Whether that also ended the sign-in at Anthropic is unmeasured." It never says the sign-in ended at Anthropic, and never that it is still valid. The section's heading claims nothing either: it reads "At the provider", and the spec's "Still valid at the provider until you revoke it" heads it only when every row is measured still valid. The box answers `state: 'unmeasured'` for that row (A16), and the sheet words that state, not a guess.
- **§9 was not measured.** This task has no sign-out step (that is A23's switch), so nothing here reads it.
- **§3.3, the Codex device code and the setup-token code shape** are read by no part of this task: Replace is the paste method only, and Mint is A22's and A38's.

**Before this change:** a lane could be removed, discarded or given a new token only on the fleet host. A16 gave the box the pre-check, Discard, the sleeping-session rule and the ledger, and A17 the routes (`remove`, `credential`, `revoke-ack`), but no screen called them.

**Change:**
- `pwa/src/accounts/RemoveSheet.tsx` (new): the remove sheet, with `RevokeItem` (the checklist item), `GuardedAct` (Confirm it's you, then the act's one button) and `refusalWordOf`, which `ReplaceSheet.tsx` reuses.
- `pwa/src/accounts/ReplaceSheet.tsx` (new): Replace token by paste.
- `pwa/src/accounts/CompromiseSteps.tsx` (new): the disclosure, and `compromiseStepsFor`, its steps for a roster.
- `pwa/src/screens/AccountsScreen.tsx`: the fold (Replace token on a token lane, Remove… on every lane) under the knob row, and the two sheets, hosted by the screen.
- `pwa/src/fleet/TroubleCard.tsx`: a token lane's credential act as a button (`replace`): "Paste a token" on Signed out, "Replace token" on Expiring.
- `pwa/src/fleet/MoveSessionsSheet.tsx`: `only`, the sessions a move takes (absent: every session on the lane, as before).
- `pwa/src/accounts/ConnectSheet.tsx`: the result frame shows `CompromiseSteps` for every method but the sign-in.
- `pwa/src/lib/api.ts`: `accountRemoveCheck`, `accountRemove`, `accountCredential`, `accountRevokeAck`.
- `pwa/src/fleet/accountWords.ts` (at the foot): every sentence the two sheets and the disclosure say, the refusal words by code, and `REVOKE_PAGES`.
- `pwa/src/fleet/fleet.css` (at the foot): the fold, the session rows, the ledger and the disclosure. `pwa/design/audit.mjs`: the grounds of the new rules (the sheet panel).

**Tests:**
- New: `pwa/test/remove-sheet.test.tsx`, `pwa/test/replace-token.test.tsx` and `pwa/browser/remove-sheet.browser.test.ts`.
- Extended: `server/test/hibernate-census.test.ts` (the two sheets' `presenceOf` reads) and `pwa/test/role-census.test.ts` (a session's restart word and the disclosure's steps read the meta role).

**Mutation table (run):**

| Mutant | Suite | Red |
|---|---|---|
| sleeping sessions not counted (`still` reads the live count alone) | remove-sheet | "the destructive button is disabled while a live or sleeping session remains, and recounts as they move", and "Discard is offered only…" (its sleeper case) |
| the confirm compares case-insensitively | remove-sheet | "the typed confirm must equal the id" |
| the tick sends the token's hint | remove-sheet | "the ledger shows the token as still valid with its checklist item, and the tick sends `revoke-ack` with no value" |
| Discard offered for an ever-enabled lane (the box's `discardable` ignored) | remove-sheet | "Discard is offered only for a never-enabled lane with no sessions", and every case that types the confirm (the typed field is gone) |
| `CompromiseSteps` always shows OpenRouter | replace-token | "`CompromiseSteps` names only the providers in the roster" |

**Per width × skin × mode (Step 4):** `pwa/browser/remove-sheet.browser.test.ts` measures this in a real Chrome over the production build, with no fleet behind it.

| | 360 | 390 | 1280 | 1920 |
|---|---|---|---|---|
| Refined · Phosphor & Ink (dark) | ✓ | ✓ | ✓ | ✓ |
| Refined · Phosphor Daylight (light) | ✓ | ✓ | ✓ | ✓ |
| Instrument · Phosphor & Ink (dark) | ✓ | ✓ | ✓ | ✓ |
| Instrument · Phosphor Daylight (light) | ✓ | ✓ | ✓ | ✓ |

Each ✓ checks these things:
- The skin and theme drawn are the ones the cell names, and at every step nothing scrolls sideways, in the page or in the sheet.
- The fold: Replace token on the token lane, Remove… on every lane, each at least 44px tall; a sign-in lane has no Replace token.
- The sheet is a bottom sheet at 360 and 390, full width, and the centred dialog (md 560) at 1280 and 1920 (D-5933's desktop arm, which is on main).
- The blocked pre-check: the box's line ("1 live session · not the upstream lane · 2 other lanes can take new sessions · no sign-in in progress · read just now"), the sleeping session listed apart, and the danger button disabled as "Remove lane-b · 2 sessions still on it". Move, Move all and Wake and move are each at least 44px tall.
- Move opens A3's mover in the remove sheet's place, one sheet at a time; closing it asks the box again, and the line recounts. Wake and move does the same, and the button then reads "Remove lane-b".
- The typed confirm with the keyboard up: at 360 the viewport is cut to 420px tall once the field has focus (headless Chrome raises no keyboard, so the cut stands in for one). The panel stays on the screen, and the danger button is inside the panel and the viewport.
- The danger button, reached by Tab from the field, draws a focus ring (an outline or a box shadow), in both palettes. Its contrast is the gate's.
- The ledger: Removed, Kept on the box and Still valid at the provider, the revoke link to `https://claude.ai/settings/claude-code`, and the checklist item, ticked. On a phone (a coarse pointer) the item is at least 44px tall; at a desk's fine pointer the option row keeps its own height (spec §12.4's floor is for coarse pointers).
- Discard on a lane the box measures discardable: one danger button, "Discard this lane", and no typed field.
- Replace: the secret field, then the restart row, the revoke item unticked, and the disclosure, opened; the pasted token is in no DOM node.

Contrast is the gate's job: `node design/contrast-check.mjs` passes every pair.

## Decisions

- **D-7742 (2026-11-01)** — `remove-replace-revoke-as-built` (accounts plan Task A19; spec §9, §11, §3.11; N3, N6; G34): the as-built decisions of A19, and where it departs from the plan's wording.
  1. **The pre-check is the box's, asked again after every Move.** The sheet asks `remove {mode:'check'}` when it opens and whenever the screen can act again. It asks again when the mover closes, whether the mover was opened by Move, Move all or Wake and move, and after a refusal. The latest ask wins: an older answer that lands after a newer ask is dropped. The line is the box's measurement with its age. The sheet derives no count of its own: the destructive button counts the box's live count plus its sleeping ids.
  2. **One sheet at a time.** While A3's mover is open, the remove sheet steps aside (it stays mounted, closed) and returns when the mover closes. Two stacked dialogs would split the focus trap. The mover takes `only`, the sessions this move covers: one session for Move, the store's live rows for Move all (every session on the lane when the store has none), and the woken ones for Wake and move.
  3. **Sleeping sessions (N3, D-7733).** The box lists them by id, apart from the live ones. **Wake and move** wakes each through the existing ensure route, one at a time, then opens the mover over the woken. The server records each as an asked wake in the fleet-wide wake budget (D-5242), and the budget never refuses it. A wake that fails is named, and that session stays asleep on the lane, so the button stays held.
  4. **What else holds the act.** A sign-in in progress ("Cancel the sign-in first"), the upstream lane, and a live count the box could not take (`live: null`) each draw their sentence, and the act is not drawn. No other lane able to take new sessions does not hold it: the verb refuses `last-home-able` only when the removal would leave none, and the sheet words that refusal.
  5. **Discard replaces the typed confirm where the box allows it.** It is offered only when the box's pre-check says `discardable` and counts no live or sleeping session. It is one danger tap with step-up, and the route and the verb check it again. It is offered in the sheet, not on the fold, because the screen's lane answer carries neither `addedAt` nor `enabledAt`, so only the box can say whether a lane was ever turned on.
  6. **The typed confirm is the exact id**, case and spaces included. A `confirm-mismatch` refusal empties the field.
  7. **The ledger is the verb's answer.** Removed, Kept on the box and the rehomed archived sessions are the verb's lines, in mono. "Still valid at the provider" has one row per `atProvider` entry, worded by kind and state. The link is chosen by the box's page word: `REVOKE_PAGES` maps `claude-code-settings`, `claude-account-settings`, `openrouter-keys` and `chatgpt-settings` to their URLs, because the box never answers a URL. A key's row names its hint when the screen read one before the removal. A sign-in's `unmeasured` follows the OA1 record (above).
  8. **The revoke checklist item (N6).** It is an `OptionRow` checkbox, ticked only once `revoke-ack` has answered. The body is `{laneId, kind}` and nothing else: no value and no hint. A refused tick says so, and the item stays unticked. A record line under it says "token marked revoked" or "not marked revoked". **The lane's full record** that spec §9 names does not exist yet: §4.4's "Full record ›" is unbuilt, and the audit read is deferred (§13.1). So the sheet's record line says it, and the `revoke-acknowledged` audit row, or its absence, is the durable record.
  9. **A removal whose answer never came** re-reads the roster. If the lane is gone, it was removed and the ledger is lost, and the sheet says so. If the lane is still there, it was not removed, and the sheet asks the box again. If the read fails too, the outcome is still unknown, the sheet asks the box again, and it sends nothing again.
  10. **Replace token is the paste method only, on an Anthropic token lane.** The box validates the token before it writes anything (A16), so a refusal leaves the lane as it was, and the field is re-presented empty. The token lives only in `SecretField`'s DOM node, as in the connect sheet (D-7740 (3)). After a save, the sheet runs Check: the box clears the lane's check when it swaps the token, and spec §9 ends every re-login with a fresh check. An answer that never came says the outcome is unknown and runs the check, rather than guessing. OpenRouter's Replace key builds on this sheet in A27, which also opens this task's Discard from its result frame. Mint a new token is A22's and A38's.
  11. **Restart.** The sessions that hold the old token are the lane's live sessions when the save landed, frozen then, so a restarted session keeps its row and its word. One tap each, through the existing stop, then the one ensure (`ensureSession`).
  12. **The trouble card.** A token lane's card offers its credential act as a button when the screen can act: "Paste a token" on Signed out and "Replace token" on Expiring. Each opens the replace sheet. The fleet-host command stays beside it, as Check again's does (D-7732).
  13. **The fold.** It sits under the knob row: Replace token (ghost), then Remove… (danger-ghost). When the screen cannot act (offline, or `connectBlock`), both stay drawn and disabled, named by the knob row's reason. The screen hosts both sheets, not the card, because a removed lane's card goes away with it and its ledger must stay.
  14. **`CompromiseSteps`** is a closed `<details>` disclosure. It names only the providers in the roster, in spec §3.11's order. Anthropic's step names tokens, sign-ins or both, by the kinds present (a lane whose kind the roster does not say could be either, so it names both). The rebuilt-box step names the Codex gateway key only when a Codex lane is present. It is shown in the connect sheet's result frame for every method but the sign-in, and at the end of Replace. It is exported for Settings › Security (the Settings plan's R5).

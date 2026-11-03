# Accounts connect A38: re-authenticate an existing Anthropic lane

**Goal:** plan Task A38 of `2026-10-18-accounts-connect.md` (spec §9 rows 1 and 2, §4.2, §4.4; D-5514, Q1). An existing Anthropic lane can be re-authenticated from the Accounts screen. **Sign in again** works on a sign-in lane. **Mint a new token** works on a token lane: it is the primary fix of a Signed-out token lane, and it is the fold's and the Expiring card's **Replace token**, with mint first and paste second. The **Expiring (minted token)** card offers Replace token and Switch to sign-in. Every one of these ends the same way: the restart list, the revoke item for a replaced token, and a fresh check.

OA1's record (`2026-11-01-accounts-oa1-record.md`) is applied where this task reads it:
- G23 is unmeasured, so "Sign this lane out and start again" says only what is done on the fleet host, and nothing about the provider.
- The setup-token code shape is still pending, so the mint checks the spec's provisional shape (`authCodeShapeOk`, A21's), as A22 does.
- §9 (a live session after a logout) is not read by this task. The switches are A23's sheet, whose Sign the old sign-in out keeps its danger confirm.
- §3.3 and the Codex device code are not read by this task.

**Before this change:**
- A Signed-out sign-in card offered only the fleet-host command.
- A token lane's card and fold offered only A19's paste arm (Paste a token, Replace token by paste).
- No screen act re-authenticated a lane, though the box's same-method arms (A20) and the routes (A21) were already merged. A23 (#2195, which this change is built on) had added the two method switches, its switch sheet, the shared sign-in attempt and the shared restart list.

**Change:**
- `pwa/src/accounts/ReauthSheet.tsx` (new):
  - `troubleActs`: each card's acts in order, for a lane's word and kind.
  - The re-auth sheet. Its frames are: Confirm (what happens, the step-up, then the one primary) → A22's run (the URL card, the code field, the countdown, Cancel) → the ending or a terminal state. The attempt is A23's `useSignInAttempt`, drawn by its `SignInLive`, in A23's `AccountSheet` shell. The ending lists sessions with A23's `RestartList`.
  - With `resume`, it opens at the run frame on the attempt the server holds, as A23's two sheets do.
- `pwa/src/fleet/TroubleCard.tsx`: A19's `replace` act and A23's `switchTo` become one ordered `acts` list, the first being the primary. The acts are the card's first action, under its effect.
- `pwa/src/screens/AccountsScreen.tsx`:
  - It builds each card's acts and hosts the re-auth sheet. The two switch acts open A23's `MethodSwitchSheet`.
  - The fold gains Sign in again on a sign-in lane.
  - A token lane's Replace token opens the mint where the fleet can mint.
  - Continue on a re-auth's attempt reopens the re-auth sheet (`resumeSheetFor`'s new `reauth`).
  - Without `account-auth-v1`, everything is as before.
- `pwa/src/accounts/ReplaceSheet.tsx`: where the fleet can mint, **Mint a new token instead** sits above the paste field.
- `pwa/src/accounts/useSignInAttempt.tsx`:
  - `WrongAccountAct` ("Sign this lane out and start again" with its confirm) moves here from the connect sheet, so the connect sheet's result frame and the re-auth sheet's ending draw one component. The markup census sees no copied block.
  - The host may word a refused start (`startRefusal`). The re-auth adds that the old credential is untouched.
- `pwa/src/accounts/ConnectSheet.tsx`: it draws `WrongAccountAct` in place of its own copy, with no change in what it renders or announces.
- `pwa/src/accounts/connectFlow.ts`: `resumeSheetFor` takes whether the lane has been checked. The same method on a checked lane is a re-auth; on a lane the connect sheet is still adding (never checked), it is the connect sheet's.
- `pwa/src/accounts/AccountSheet.tsx`: an optional hook class beside `acct-connect` (`acct-reauth`).
- `pwa/src/accounts/RemoveSheet.tsx`: `StepUpFor` is exported.
- `pwa/src/fleet/accountWords.ts`: every sentence the re-auth says. The switch words (`SWITCH_TO_TOKEN`, `SWITCH_TO_SIGN_IN`, `CLOSE`, `START_SWITCH_AGAIN`, `SWITCH_START`) are A23's and are reused, not defined again.
- `pwa/src/fleet/fleet.css`: the card's acts. Below 900 they stack, the primary first; at 900 and up they share a row.
- `pwa/src/lib/api.ts` is unchanged. A22 already added every route this task calls.

**Tests:**
- New: `pwa/test/reauth-sheet.test.tsx`. It covers:
  - each card's acts in their order, with the fallback when the fleet cannot run a sign-in;
  - step-up before any request, for each act on the card and the fold;
  - the ending shared by a mint and a sign-in: the fresh check, the restart list, the revoke item only for a replaced token, the stated identity defaulting to the old one, and the read-back identity with its sign-out and restart;
  - a cancelled re-auth that says the old credential is untouched and leaves the card as it was;
  - an expired and a refused attempt, each worded from its code;
  - Replace token offering mint first and paste second, with each sheet leading to the other;
  - the two switch acts opening A23's switch sheet, never this one;
  - Continue on a re-auth's attempt reopening the re-auth sheet at its code field with no new start, and `resumeSheetFor`'s rule.
- New: `pwa/browser/reauth-sheet.browser.test.ts` (Step 4).
- Extended: the no-duration source scan in `sign-in-sheet.test.tsx` and the no-storage scan in `auth-resume-banner.test.tsx` now cover `ReauthSheet.tsx`.
- Unchanged and green: A23's `method-switch` and `auth-resume-banner`, and `sign-in-sheet`, `replace-token`, `remove-sheet`, `accounts-trouble`, `connect-sheet`, `accounts-screen`, `account-knob`, `code-field`, `fleet-pieces` and `markup-census`. Their fixtures that advertise `account-v2` alone still see A19's paste arm.
- `server/test/hibernate-census.test.ts` is unchanged: the re-auth sheet reads presence through A23's `RestartList.tsx` (`restartableOn`), the census's one row for the restart list.

**Mutation table (run):**

| Mutant | Suite | Red |
|---|---|---|
| Sign in again as the sign-in card's primary (`troubleActs` order swapped) | reauth-sheet | "a Signed-out sign-in lane's card holds Switch to a long-lived token first and Sign in again second" |
| paste first in Replace token (`['paste-token', 'mint-new-token']`) | reauth-sheet | "a Signed-out token lane's primary fix is Mint a new token" |
| skip step-up on re-auth (the primary not held by `stepUp.needed`, the start run outside `runAct`) | reauth-sheet | all five "each act asks for step-up before any request" cases |
| no fresh check at the end (`installed` without `check()`) | reauth-sheet | "each ends with the restart list, the revoke item for a replaced token, and a fresh check", and "the same identity read back offers no sign-out" |
| the Expiring card without Switch to sign-in | reauth-sheet | "the Expiring (minted token) card offers Replace token and Switch to sign-in" |
| Continue on a re-auth's attempt opens the connect sheet (the `reauth` arm of `openResume` dropped) | reauth-sheet | "Continue on a checked lane reopens the re-auth sheet at its code field, with no new start" |

Every case was also run green against the unmutated tree.

**Per width × skin × mode (Step 4):** `pwa/browser/reauth-sheet.browser.test.ts` runs in a real Chrome over the production build. The fleet's routes are answered by its fixture: lane-a is a signed-out sign-in lane, lane-b a signed-out token lane, and lane-c a minted token about 11 months old with one live session.

| | 360 | 390 | 1280 | 1920 |
|---|---|---|---|---|
| Refined · Phosphor & Ink (dark) | ✓ | ✓ | ✓ | ✓ |
| Refined · Phosphor Daylight (light) | ✓ | ✓ | ✓ | ✓ |
| Instrument · Phosphor & Ink (dark) | ✓ | ✓ | ✓ | ✓ |
| Instrument · Phosphor Daylight (light) | ✓ | ✓ | ✓ | ✓ |
| Offline mid-attempt (dark), each skin | ✓ | | ✓ | |

Each ✓ checks these things:
- The skin and theme drawn are the ones the cell names. At every step, nothing scrolls sideways, in the page or in the sheet.
- Each trouble card holds its two acts in the spec's order, the first being the primary, each at the tap floor. Below 900 the second stacks under the primary; at 900 and up they share a row. The Expiring card says both of its sentences.
- The confirm frame: Paste a token instead, then Mint a new token as the primary.
- The run: the URL card, and the countdown read from `expiresAt`.
- The ending:
  - the fresh check's word;
  - the stated identity, defaulting to the old one;
  - Restart at the tap floor, and the revoke item at the tap floor below 900 (A19's rule: Instrument's desk rows are denser);
  - the compromise disclosure;
  - the install line and the check line in the ledger;
  - the code in no DOM node.
- Offline mid-attempt: the server-isn't-answering sentence with the last-known deadline's clock, no link, no code field and no Send, and Cancel drawn but refused.

## Decisions

- **D-7872 (2026-11-01)** — `reauth-sheet-as-built` (accounts plan Task A38; spec §9 rows 1, 2, §4.2, §4.4; D-5514, Q1, N5, N6): the as-built decisions of A38, and where it departs from the plan's wording.
  1. **One sheet for both re-auths.** `ReauthSheet` runs A22's sign-in on an existing lane, with the method it already has: no add, no Turn it on, no Discard. The attempt is A23's `useSignInAttempt`, the connect sheet's and the switch sheet's own, so the three sheets cannot drift. The box's same-method arm (A20) signs in, or mints, into the scratch dir and installs only after its own check, under the lane lock. The sheet's Confirm frame says that until it passes, the lane keeps what it has. Nothing is sent before the frame's one primary, and the primary is held while Confirm it's you is showing. Every later start (Start again; Sign this lane out and start again) runs through a mounted step-up gate's `runAct`, and a start refused `step-up-required` marks the stamp lapsed (A22's rule).
  2. **The terminal states say the old credential is untouched**, each from its code: "Nothing changed: lane-b keeps its old sign-in" (or "token"). That covers expired, code refused, link untrusted, cancelled, node changed, the helper's own failure, and every start refused with a word, worded by A22's `signInStartRefusal` and then the untouched sentence (the hook's `startRefusal`). Two states cannot say it:
     - a start whose outcome is unknown says the old credential "was not replaced here";
     - `lost` (the server no longer holds the attempt) says whether it finished is unknown, and asks for a check.
     Each terminal state offers Start again and Close.
  3. **The ending** is the same for every re-auth (spec §9). It shows:
     - the install line;
     - the restart list, listing the sessions live on the lane when the helper said `done`;
     - the fresh check, followed by a re-read of the store, so the card's word follows the check;
     - the result word and identity line. A check that is refused or never answered leaves its sentence and Check again.
     For a mint, the ending also shows the stated identity (asked again, with the lane's old identity as its default text), the revoke item for the old token (N6, unticked by default) and the compromise disclosure. For a sign-in, the identity is read back. When both the old identity and the new one are measured and they differ, the sheet shows "Not the account this lane had? It had … · **Sign this lane out and start again**" (`WrongAccountAct`, the connect sheet's own act, now shared). That act takes two taps behind the step-up, runs N5's sign-out and then a new attempt of the same method. Its confirm says that sessions on the lane fail their next turn until the new sign-in finishes, and, G23 being unmeasured, says nothing about the provider.
  4. **The restart lead follows how a session reads its credential.** A token is read at a session's start, so after a mint, sessions "keep the old credential until they restart". A sign-in is read at the next request, so after Sign in again they "pick up the new sign-in at their next request", and Restart is for one stuck on the old error (spec §9 row 1). The list is A23's `RestartList` with its `useRestarts`, shared with Replace token and the switch sheet.
  5. **The cards' acts** (`troubleActs`), where the fleet advertises `account-auth-v1`, are:
     - Signed out on a sign-in lane: Switch to a long-lived token (primary, Q1), then Sign in again.
     - Signed out on a token lane: Mint a new token (primary), then Paste a token.
     - Expiring (a minted token): Replace token (primary, the mint), then Switch to sign-in.
     Without that cap word, a token lane keeps A19's paste arm alone (ghost, as before) and a sign-in lane gets no act. The acts are drawn only where the screen can act (online, `connect` present, the lane in the roster), as A19's was. They are the card's first action, under its effect, and the fleet-host command stays below them.
  6. **Replace token is mint first, paste second.** Where the fleet can mint, the fold's and the Expiring card's Replace token open the re-auth sheet on the mint. That sheet's quiet act, **Paste a token instead**, closes it and opens A19's paste sheet. The paste sheet carries **Mint a new token instead** above its field, which goes back the other way. One sheet is open at a time, so only one step-up challenge is ever live (`useStepUp`'s one-instance rule).
  7. **The switches are A23's sheet.** The two switch acts on the cards (Switch to a long-lived token, the Signed-out sign-in card's primary; Switch to sign-in, the Expiring card's second) open A23's `MethodSwitchSheet`, as the fold's do. That sheet carries spec §9's Sign the old sign-in out with its danger confirm and the closing line "Sessions on this lane won't ask you to sign in again for about a year". A23's single `switchTo` prop on the trouble card is folded into the `acts` list, so a card's acts have one order and one primary.
  8. **No Turn it on.** A re-auth never offers Turn it on (spec §6.2: "skipped if the lane was already on"). A Signed-out or Expiring lane is never also Off, because Off outranks both, and an off lane's knob row stays the way to turn it on.
  9. **A closed re-auth resumes in the re-auth sheet.** A re-auth closed mid-attempt keeps running on the box until `expiresAt`, and A23's banner offers Continue. `resumeSheetFor` decides which sheet continues it. The other method is a switch (A23's sheet). The same method on a lane whose state holds a check is a re-auth, which reopens this sheet at the code field with no new start. The same method on a lane with no check yet is the connect sheet's sign-in of a lane it is adding, as A23 had it. A lane the connect sheet adds is never checked before its sign-in finishes, so its attempt never resumes here. The one gap: a lane that was never checked at all (added on the fleet host and re-authenticated from its fold before any check) resumes in the connect sheet, whose sentences are a new lane's.

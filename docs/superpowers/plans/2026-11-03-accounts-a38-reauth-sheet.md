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
- `pwa/src/accounts/connectFlow.ts`: `resumeSheetFor` takes whether the lane is past its adding (`isPastAdding`: a check, the 401 marker, or any word but Off). The same method on such a lane is a re-auth; on a lane the connect sheet is still adding (Off, with neither a check nor the marker), it is the connect sheet's.
- `pwa/src/accounts/AccountSheet.tsx`: an optional hook class beside `acct-connect` (`acct-reauth`).
- `pwa/src/accounts/RemoveSheet.tsx`: `StepUpFor` is exported.
- `pwa/src/fleet/accountWords.ts`: every sentence the re-auth says. The switch words (`SWITCH_TO_TOKEN`, `SWITCH_TO_SIGN_IN`, `CLOSE`, `START_SWITCH_AGAIN`, `SWITCH_START`) are A23's and are reused, not defined again.
- `pwa/src/fleet/fleet.css`: the card's acts. Below 900 they stack, the primary first; at 900 and up they share a row.
- `pwa/src/lib/api.ts` is unchanged. A22 already added every route this task calls.
- Fix round 4 (D-7872 (10), the operator's option 1): `oldCredentialOf` in `connectFlow.ts` replaces `laneHasNoCredential`, and the re-auth and method switch sheets word the old credential from it. The new `pwa/src/accounts/signOuts.ts` holds the app's sign-out record, which the re-auth sheet and the connect sheet's sign-out both write. The screen hands both sheets the lane's telemetry row. `pwa/browser/reauth-sheet.browser.test.ts` serves the run's one shared build (`sharedDist`), as main's browser files now do.

**Tests:**
- New: `pwa/test/reauth-sheet.test.tsx`. It covers:
  - each card's acts in their order, with the fallback when the fleet cannot run a sign-in;
  - step-up before any request, for each act on the card and the fold;
  - the ending shared by a mint and a sign-in: the fresh check, the restart list, the revoke item only for a replaced token, the stated identity defaulting to the old one, and the read-back identity with its sign-out and restart;
  - a cancelled re-auth that says the old credential is untouched and leaves the card as it was;
  - an expired and a refused attempt, each worded from its code;
  - after Sign this lane out and start again, a cancelled (and a Start again after it), an expired, a code-refused, a failed and a start-refused attempt, each saying the lane is signed out and never that the old credential is untouched; and `reauthEnd`'s and `reauthStartRefusal`'s words for every terminal kind, both methods, with and without the sign-out;
  - the sign-out outliving its sheet: signed out, started, the sheet unmounted, then resumed in a fresh sheet (`resume`) on the lane the screen read again, whose cancel says the lane is signed out; and Sign in again opened later on the lane as the screen last held it, whose intro says so, until a passing check newer than the sheet's last one;
  - a lane that says it has no credential (`no-credential`), on both methods: the intro, a cancel, an expiry after Start again and a refused start each say it is signed out; a lane with its credential keeps the untouched intro and ending; and `laneHasNoCredential`'s rule;
  - Replace token offering mint first and paste second, with each sheet leading to the other;
  - the two switch acts opening A23's switch sheet, never this one;
  - Continue on a re-auth's attempt reopening the re-auth sheet at its code field with no new start: on a checked lane, and on a Signed-out sign-in lane with no check (the 401 marker alone, the common Sign in again case); `resumeSheetFor`'s rule and `isPastAdding`'s.
- New: `pwa/browser/reauth-sheet.browser.test.ts` (Step 4).
- New in fix round 4: `pwa/test/reauth-wording.test.tsx`, the ruling per sheet. The rule itself and every word built on it. The re-auth sheet on both methods: a fresh lane with a passing check (keeps), a never-checked lane (neutral intro, cancel and refused start), a lane signed out elsewhere (a 401 after its passing check, or its check cleared: neutral), after a sign-out in this sheet (signed out), resumed after an unmount on the lane as last read and as read again (neutral, never keeps), then a newer passing check (keeps), and resumed after a simulated reload (neutral). The switch sheet: a fresh lane (keeps, in the intro, a cancel and the both-held line), a never-checked lane (neutral in all three), the Signed-out card's case and a token lane signed out elsewhere (neutral), a sign-out the app ran (neutral) and the box's `no-credential` (signed out). The connect sheet: its Sign this lane out and start again is recorded, so a re-auth opened later on the lane as last read is neutral. `reauth-sheet` and `method-switch` now give a passing check to the lanes whose cases say the lane keeps what it has, and the cases the ruling changed now expect the neutral words.
- Extended: the no-duration source scan in `sign-in-sheet.test.tsx` and the no-storage scan in `auth-resume-banner.test.tsx` now cover `ReauthSheet.tsx`.
- Unchanged and green: A23's `method-switch` and `auth-resume-banner`, and `sign-in-sheet`, `replace-token`, `remove-sheet`, `accounts-trouble`, `connect-sheet`, `accounts-screen`, `account-knob`, `code-field`, `fleet-pieces` and `markup-census`. Their fixtures that advertise `account-v2` alone still see A19's paste arm.
- `server/test/hibernate-census.test.ts` is unchanged: the re-auth sheet reads presence through A23's `RestartList.tsx` (`restartableOn`), the census's one row for the restart list.

**Mutation table (run), fix rounds 1 to 3.** Its rows name the tests as they were then. Round 4 renamed the ones whose words the ruling changed, and replaced `laneHasNoCredential` with `oldCredentialOf`; its own table follows this one.

| Mutant | Suite | Red |
|---|---|---|
| Sign in again as the sign-in card's primary (`troubleActs` order swapped) | reauth-sheet | "a Signed-out sign-in lane's card holds Switch to a long-lived token first and Sign in again second" |
| paste first in Replace token (`['paste-token', 'mint-new-token']`) | reauth-sheet | "a Signed-out token lane's primary fix is Mint a new token" |
| skip step-up on re-auth (the primary not held by `stepUp.needed`, the start run outside `runAct`) | reauth-sheet | all five "each act asks for step-up before any request" cases |
| no fresh check at the end (`installed` without `check()`) | reauth-sheet | "each ends with the restart list, the revoke item for a replaced token, and a fresh check", and "the same identity read back offers no sign-out" |
| the Expiring card without Switch to sign-in | reauth-sheet | "the Expiring (minted token) card offers Replace token and Switch to sign-in" |
| Continue on a re-auth's attempt opens the connect sheet (the `reauth` arm of `openResume` dropped) | reauth-sheet | "Continue on a checked lane reopens the re-auth sheet at its code field, with no new start" |
| the resume reads a held check alone (`openResume` passes `check !== undefined`, as before the fix round) | reauth-sheet | "Continue on a Signed-out sign-in lane with no check (the 401 marker alone) reopens the re-auth sheet, not the connect sheet's" |
| `isPastAdding` without the 401 marker | reauth-sheet | "a lane is past its adding on a check, the 401 marker or any word but Off; an Off lane with neither is one being added" |
| the sign-out not remembered (`signOutRestart` without `signedOut.current = true`) | reauth-sheet | the cancelled, expired, refused-code, failed and start-refused cases of "after Sign this lane out and start again, every ending says the lane is signed out" |
| `reauthEnd` ignores `signedOut` (always the untouched sentence) | reauth-sheet | the cancelled, expired, refused-code and failed cases, and "no ending after a sign-out says the old credential is untouched; before one, every ending that can says so" |
| the ref not seeded from the lane (`useRef(false)`) | reauth-sheet | "signed out in one sheet and resumed in a fresh one, its cancel says the lane is signed out", and both methods' "the intro, a cancel, an expiry and a refused start each say … is signed out" |
| the sign-out not kept beyond the sheet (`signOuts.set` dropped) | reauth-sheet | "signed out in one sheet and resumed in a fresh one, …" and "Sign in again opened later on the lane it signed out says so from the start, until a newer passing check" |
| the intro ignores the seed (`reauthIntro(id, method)`) | reauth-sheet | "Sign in again opened later on the lane it signed out …", and both methods' "the intro, a cancel, …" |
| the lane's `no-credential` word not read | reauth-sheet | both methods' "the intro, a cancel, …", and "the rule: the lane's no-credential word, or this app's sign-out until a newer passing check; nothing else" |
| any lane not ready read as one with no credential (`!lane.ready`) | reauth-sheet | "a cancelled re-auth says the old credential is untouched …", "an expired or refused attempt says so, each from its code", "a lane with its credential keeps the wording it had …" and "the rule: …" |
| a passing check never retires the sign-out | reauth-sheet | "Sign in again opened later on the lane it signed out …" and "the rule: …" |
| the check from before the sign-out retires it (no `checkAt` comparison) | reauth-sheet | "Sign in again opened later on the lane it signed out …" and "the rule: …" |

Every case was also run green against the unmutated tree.

**Mutation table (run), fix round 4 (D-7872 (10)).** Each mutant was run against `reauth-wording`, `reauth-sheet` and `method-switch`; all 16 went red.

| Mutant | Suite | Red |
|---|---|---|
| `kept` on any passing check (no comparison with the sign-out's check) | reauth-wording, reauth-sheet | "a sign-out this app knows of: neutral until a newer passing check …", "resumed after the sheet unmounts …", "after a sign-out this app ran …", "signed out there, a re-auth opened later … is neutral", "Sign in again opened later on the lane it signed out never says it keeps one …" and the rule |
| the 401 marker not read | reauth-wording | the rule, both methods' "a lane signed out elsewhere …", and the switch's "the Signed-out card's primary …" |
| any check verdict read as passing | reauth-wording, reauth-sheet | the rule, in both files |
| the sheet's own sign-out not certain (`signedOutHere` ignored) | reauth-wording, reauth-sheet | "after a sign-out in this sheet, its endings say the lane is signed out …" and round 2's five "after the sign-out" endings |
| the box's `no-credential` not read | reauth-wording, reauth-sheet | the rule, the switch's "… the box's no-credential: signed out", and both methods' "the intro, a cancel, an expiry and a refused start each say … is signed out" |
| a known sign-out makes a later sheet say signed out (round 3's behaviour) | reauth-wording, reauth-sheet | "resumed after the sheet unmounts …", "signed out there, a re-auth opened later …", "signed out in one sheet and resumed in a fresh one, its cancel claims nothing …" and the rule |
| `unsure` worded as `kept` (`oldCredentialLine`) | reauth-wording, reauth-sheet | the words case, every never-checked, signed-out-elsewhere, unmount and reload case, the switch's neutral cases, and "a cancelled re-auth on a Signed-out lane installs nothing …" |
| `unsure` intro worded as `kept` (`reauthIntro`) | reauth-wording, reauth-sheet | the words case, both methods' never-checked and signed-out-elsewhere cases, and "Sign in again opened later …" |
| the connect sheet's sign-out not recorded | reauth-wording | "signed out there, a re-auth opened later on the lane as last read is neutral, never keeps" |
| the switch sheet ignores the 401 marker | reauth-wording | "the Signed-out card's primary (a 401 after the passing check) …" |
| the switch sheet ignores the app's sign-outs | reauth-wording | "after a sign-out this app ran, on the lane as last read: neutral …" |
| the re-auth sheet ignores the app's sign-outs on mount | reauth-wording, reauth-sheet | "resumed after the sheet unmounts …", "signed out there …" and "Sign in again opened later …" |
| the re-auth sheet's sign-out not passed as its own (`signedOutHere`) | reauth-wording, reauth-sheet | "after a sign-out in this sheet …" and round 2's five endings |
| the re-auth sheet's sign-out not recorded | reauth-wording, reauth-sheet | "after a sign-out in this sheet …" (the record), "resumed after the sheet unmounts …" and "Sign in again opened later …" |
| the both-held line always `kept` | reauth-wording | "a never-checked lane: neutral in the intro, a cancel and the both-held line" |
| the re-auth intro always `kept` | reauth-wording, reauth-sheet | both methods' never-checked and signed-out-elsewhere cases, the unmount and connect-sheet cases, and both methods' no-credential intros |

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

     **After Sign this lane out and start again** (fix round 2), none of that is true: N5's sign-out already removed the old sign-in. From that sign-out until a new credential is installed, every ending (cancelled, expired, code refused, link untrusted, node changed, the helper's failure, a start refused with a word, and an unknown start) says "lane-a is signed out on the fleet host, so its sessions fail until it has a sign-in or a token again" in place of the untouched sentence, and `lost` says the lane was signed out before the attempt and asks for a check. The sheet holds this in a ref that the sign-out sets and the install clears, so a Start again after such an ending says it too.

     **On any lane with no credential** (fix round 3), the same is true from the sheet's first frame, so the ref is seeded on every mount from the lane, not from the sheet that ran the sign-out (`laneHasNoCredential`). The intro then says "A new sign-in runs on the fleet host and is checked before it is installed. lane-a is signed out on the fleet host, …" (or the token's), and every ending and refused start says the lane is signed out. Measured: the lanes wire records no credential fact after N5's sign-out. The box clears a sign-in lane's `check` and nothing else, the identity stays, and the server's display `laneNotReadyReason` never answers `no-credential` (only `enable` does, on the box; D-7732). So the seed reads two things:
     - the lane's own `notReadyReason` of `no-credential`, the box's word, wherever the wire carries it;
     - the sign-outs this app ran, kept beside the sheet in the app's memory with the last check the sheet knew of then (the box's clock). A sheet opened later on that lane says it is signed out: Continue on the banner, which mounts a fresh sheet with `resume`, and Sign in again on the card, before or after the screen reads the lanes again. That lasts until the lane shows a passing check newer than that one, which is the first record of a credential going back in, or until this app installs one.

     The Remove sheet removes the lane with its credential, so there is no card left to sign in again on. **Superseded by (10):** this round said a lane with a 401, a failed check or no check keeps its old credential, and a reload or another device lost the app's sign-out record, so a sheet there said the old credential was untouched on a lane that had none. The operator ruled option 1 on 2026-11-03, and (10) is the rule now.
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
  9. **A closed re-auth resumes in the re-auth sheet.** A re-auth closed mid-attempt keeps running on the box until `expiresAt`, and A23's banner offers Continue. `resumeSheetFor` decides which sheet continues it. The other method is a switch (A23's sheet). The same method on a lane past its adding is a re-auth, which reopens this sheet at the code field with no new start. Otherwise it is the connect sheet's sign-in of a lane it is adding, as A23 had it. `isPastAdding` reads facts that a lane the connect sheet is still adding never has. Every new lane starts off (`add` writes the off marker, and only Turn it on, after the sign-in, lifts it), so that lane's word is Off, with no check and no 401 marker. Any one of three facts says the lane exists already:
     - a check in its lane state;
     - the 401 marker (`authDead`). ccd's rescue path writes it with no check, and the health probe refuses sign-in lanes, so a Signed-out sign-in lane, the main Sign in again case, often has no check at all. The marker still holds when Off outranks it;
     - a word other than Off, since the marker that holds an added lane off is gone.

     A held check alone (this task's first cut) missed the marker-only Signed-out lane, legacy lanes and lanes a live session's 401 signed out. Its resume opened the connect sheet, with Discard this lane on a lane that has sessions (fix round 1). The one gap left: a lane that is Off on the fleet host, with neither a check nor the 401 marker, re-authenticated from its fold. It resumes in the connect sheet, whose sentences are a new lane's. The server's discard verdict still refuses that lane unless `add` made it, it was never turned on and no session runs on it.

  10. **What a sheet may say about the old credential: one rule, the operator's option 1 (fix round 4, ruled 2026-11-03).** After a sign-out the box clears the lane's check and nothing else, and the server never reports `no-credential`, so a signed-out lane looks like one never checked. Several sheets said "keeps its old sign-in" on lanes with none: the re-auth sheet after a remount or a reload, the method switch sheet, and a re-auth opened after the connect sheet's Sign this lane out and start again. The ruling: wherever the app cannot be sure the lane still holds a credential, the words must be true either way; "keeps its old sign-in" (or token) is said only on a lane with a passing check newer than any sign-out the app knows of. The precise signed-out words come with the box and server fix (#2234).
     - **The rule is one function**, `oldCredentialOf(lane, usage, signOut, signedOutHere)` in `connectFlow.ts`, which answers `kept`, `signed-out` or `unsure`:
       - `signed-out` only where it is certain: the box's own `no-credential`, or the sheet that just ran the sign-out and had the box's answer;
       - `kept` only on a passing check, with no 401 marker after it (`usage.authDead`, which a sign-out elsewhere also causes), newer than the last check known at any sign-out this app ran;
       - `unsure` everywhere else: never checked, a failed or cleared check, a 401, a sign-out an earlier sheet ran on the lane as last read, and anything a reload forgot.
     - **Its words** (`accountWords.ts`): `unsure` says "lane-a has no checked sign-in, so whether it still has one isn't known." in an intro, and "Nothing was installed." where an ending said "Nothing changed: lane-a keeps its old sign-in." (`oldCredentialLine`). `lost` asks for a check of whether the lane has a working credential, not of "which credential works". `signed-out` keeps (2)'s sentence.
     - **Every sheet that speaks of the old credential reads it**: the re-auth sheet's intro, every ending and every refused start; the method switch sheet's intro, every ending and its both-held line ("If lane-a still has its old sign-in on the fleet host, sign it out here." unless `kept`). The screen hands both sheets the lane's telemetry row for the 401 marker. The trouble card and the resume banner say nothing of the old credential, so they are unchanged. A19's paste sheet speaks of a token lane, whose token N5's sign-out does not remove, so it is unchanged too.
     - **The sign-out record** moves to `pwa/src/accounts/signOuts.ts`, the app's memory only (the no-storage scan covers it). The re-auth sheet's and the connect sheet's Sign this lane out and start again both write it, with the last check known then. It no longer makes a later sheet say "signed out": the lane may have been signed in elsewhere since, so a later sheet on the lane as last read says the neutral words, until a passing check newer than the sign-out retires the record.


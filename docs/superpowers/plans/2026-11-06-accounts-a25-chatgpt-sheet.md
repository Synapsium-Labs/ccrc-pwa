# Accounts connect A25: the ChatGPT device-code sheet

**Goal:** plan Task A25 of `2026-10-18-accounts-connect.md` (spec §7.2, §9 row 5, §11 step 4, §3.8; D-5519, N2). A ChatGPT lane is added and signed in from the PWA, its sign-in is renewed from its card, and Remove says what happens to its sign-in folder.

**Before this change:** OpenAI's row read "This app can't run it yet" on a fleet that offered it, a Signed-out Codex lane had only a fleet-host command, and the remove sheet said nothing of the lane's folder. The verb deleted it whatever the operator wanted, since no route could ask it to keep it.

## Numbers

- **D-8051 (2026-11-06)** — `chatgpt-device-code-sheet` (Task A25): the ChatGPT device-code sheet, with the fourteen decisions below, which the task's Files list and shape did not make.

1. **The Codex cap word is offered only once its sign-in can start.** `ACCOUNT_CAPS` gains `account-codex-v1`, as it gained `account-auth-v1` when A22's sheet shipped. OA1b did not measure the Codex host or `userCode` shape, so `AUTH_URL_HOSTS['openai-login']` is empty and `auth/start` refuses `method-unmeasured` (D-7792). Offering the word anyway would let the sheet add a lane, with its two ports and its folder, and then fail to sign it in. So `accountsConnect` holds the word back while that list is empty. The row narrows in place, and the fold and the trouble card offer no Sign in again. Adding the measured host opens all of it in one act: no second switch to remember. N2 is not changed.
2. **The task's Files list predates the shared attempt.** The sign-in moved into `useSignInAttempt.tsx` under A23, and A38 added `ReauthSheet.tsx`, so both change here, with `ConnectSheet.tsx`, `MethodFrame.tsx`, `connectFlow.ts` and `AccountsScreen.tsx`. `ProviderFrame.tsx` needs no change: the row narrows through `providerChoices`, and "Models: luna, terra and sol from your ChatGPT plan." stands in the method frame, where a radio would be, above Confirm it's you. `SignInMethod` gains `openai-login`; `AnthropicSignIn` names the two methods a switch runs.
3. **The folder line needs a route field.** A24 gave the argv `--delete-codex-auth`, the verb's default, and no way to keep the folder, so a line turned off would have said "kept" while the verb deleted it. `AccountRemoveBody` gains `codexAuth: 'delete' | 'keep'` (remove mode only), and the argv gains `keepCodexAuth` for the verb's existing `--keep-codex-auth`. The ledger is still the verb's answer. An agent older than this argv refuses the keep and nothing is removed, so the order of the two lanes can't delete a folder the operator kept. The ticked line needs nothing new.
4. **A device sign-in waits at `url`.** The auth library prints "Enter code:", which the helper's prompt match (`Enter the code`) does not take, and the box has nothing to ask for, so the attempt never reaches `waiting-code`. `waitsOnOperator` reads `url` as waiting for a method that shows a device code, for the resume banner and the card's resume line alike, and each says "waiting for you to approve it". The helper is unchanged.
5. **No wrong-account act on a Codex lane.** `credential --sign-out` refuses `not-a-sign-in-lane` for anything but a generated Anthropic lane, so "Sign this lane out and start again" would always fail. `ResultSignIn.wrongAccount` is optional and absent here; Sign in again replaces the sign-in. Remove and Discard remain.
6. **The URL and the code are one fact.** The helper publishes the URL a line before the code, so the card waits for both, and the ledger's waiting line waits with it. An answer that brings a URL with no code clears the code, so a stale code never sits beside a new link. N2 stays the server's: the PWA holds no shape of its own, and it shows no card once the server answers `auth-url-untrusted`.
7. **A ChatGPT lane's add carries no method.** `openai-login` is `auth-start`'s method, and `add`'s list (`ADD_METHODS`) doesn't name it, so a body with it answers `bad-request` before anything runs. Spec §7.2 step 3 sends none. `addMethodField` drops it, and `add`'s list is unchanged. Both fake boxes now take the add through the real `buildAccountArgv`, so neither can hide this again.
8. **"Signed in with ChatGPT" reads the check, not the word.** A new Codex lane is off, and `stateWordFor` answers Off first for a disabled lane whatever its check found, so a gate on `signed-in` never fired before Turn it on. `chatgptSignedInLine` needs a passing check, and a sign-out, `credential: 'none'` or a Signed-out word beats it. The result frame and Sign in again's ending share it. The fakes' lanes now come from the real `stateWordFor`.
9. **The Codex surfaces need `managed`.** `rosterKindOf` gives `kind: 'codex'` to an OpenAI lane ccrc only records too. The verb's folder step runs only for its own Codex lanes, and its install step refuses `method-not-supported` for the rest, so `managedCodex` gates Remove's folder line, the fold's Sign in again and the trouble card's. An older server's row doesn't say, so it counts as not managed.
10. **Remove's sentence follows the folder line.** `removeConsequence` said the lane's credential goes, which was always true until decision 3 opened a keep path. On a managed Codex lane it now takes the sheet's own `codexAuth`, the same value the sheet sends, so it can't drift from the line. Turned off, it says the sign-in folder stays. Turned on, it says "if that's safe to delete", because the verb still keeps a folder outside ccrc's home, one another lane reaches and one whose fate it can't read. Every other lane keeps its sentence.
11. **The card says "Don't share it", and the spec row changed with it.** The row said the code was "not a secret", while the library running this flow prints that device codes are a phishing target and spec §3.8 names the attack: a code bound by the wrong party ties its account to the lane. The sentence, spec §7.2 step 5, the plan's shape and the sentence in the 2026-09-05 spec all read the same now. What the older spec's other mentions and the helper's comments mean by "not a secret" is narrower, that the code may reach the status file, so they stay. The comment on `UserCodeWell` said "not a secret" in the first sense, so it reads the same as the card now.
12. **A resolved check is not a pass.** The check route answers 200 with the lane whatever the probe found, and all four sheets said "✓ Checked: one test reply · first-run setup verified" on any answer, so a lane the provider had just refused read as verified. `checkedLine` in `accountWords.ts` is the one reader, at `ConnectSheet`, `ReauthSheet`, `MethodSwitchSheet` and `ReplaceSheet`. It says Checked only for a verdict of `ok`. Otherwise it says "The check did not pass:" and what the verdict found, for each word `classify` writes: `auth-dead` in the Signed out lamp's word, and `unreachable`, `timeout` and `unknown` with the trouble card's "Nothing was learned about the credential; it may be fine." A word it doesn't know reads as `unknown`, and a lane with no verdict says the fleet host recorded no result. `auth-dead` doesn't claim HTTP 401, because `classify` writes it for "Not logged in" too. Two more surfaces read the same answer. The result frame's "Checked: one test reply in 1.2 s" now needs the same verdict, and the two sheets with a terminal alert announce the sentence rather than the plain ending. Fakes that answered a lane with no check now carry a verdict of `ok`, which is what they meant.
13. **Remove says what the verb does to a lane ccrc only records.** For `exec.kind: 'external'`, the verb keeps the launcher, keeps any secrets file the row names, runs no sign-out and has no folder step. It takes the roster row, the usage row, the switch, the hook state and the lane state. `removeConsequence`'s `recorded` sentence says that, where the old one said the lane's credential and everything that runs it are deleted. `ccrc-account.test.ts` already pins the verb's half. The wire could say so only for an OpenAI lane, and an `external` row may name any provider or none, so `managed: false` now rides every external row, `managed: true` still only a Codex lane, and every other lane carries neither. That moves one row: a generated OpenAI lane read `false` and now carries nothing, since ccrc writes its wrapper. `managedCodex` is unchanged, and `recordedOnly` in `connectFlow.ts` is the one reader. `roster-wire-kind.test.ts`'s "managed rides OpenAI lanes only" pinned the old contract, so it changed with it. A PWA on an older server sees `managed` absent on a non-OpenAI external lane and keeps the old sentence, but the server serves the PWA, so the two ship together.
14. **The folder line is held while a remove is in flight.** The sheet sent `codexAuth` when Remove was tapped, and the line stayed live until the answer, so a tap in between changed the sentence but not the request. `OptionRow` now takes `busy` as well as `blocked`.

**Words.** Every sentence that would be false for this flow has its own: no claude.ai, no code to paste, no code sent, no token to fall back on (`chatgptEnd`, `reauthEnd`, `signInLedger`, `signInStartRefusal`, `addRefusal` by the verb's code, the two after-an-unknown lines for every sign-in lane, and the live region's line when Use what's there takes over a folder an earlier lane left). The runtime's failure line is never quoted: `failure` is a plain word or nothing. Remove's kept-folder sentence says only what the box guarantees, that the folder stays and whatever sign-in it holds is not deleted, since the lane may be signed out or hold no sign-in.

**Still to do, by the operator:** the box run OA1b could not finish (the provider answered HTTP 530 that day) measures the Codex host, path and `userCode` shape. That change is `AUTH_URL_HOSTS`, `AUTH_URL_PATHS` and `AUTH_USER_CODE_SHAPES` in `shared/accounts.ts`, and until it lands no fleet offers this sheet. Nothing here was run against a real provider or a real code. The sheet is proved against a fake box and a stand-in host.

**Tests:**
- New: `pwa/test/chatgpt-sheet.test.tsx`, and `pwa/browser/chatgpt-sheet.browser.test.ts`: two sets of 16 width, skin and mode cells in real Chrome (the add, then Sign in again and Remove).
- New: `pwa/test/failedChecks.ts`, the answered shapes that are not a pass, with their sentences spelled out, which the four sheets' tests share.
- Extended: `server/test/accounts-route-lanes.test.ts`, `server/test/account-routes-write.test.ts`, `server/test/ccrc-account-codex-add.test.ts` (the keep flag through the real verb), `pwa/test/connect-sheet.test.tsx`, `pwa/test/reauth-sheet.test.tsx`, `pwa/test/method-switch.test.tsx`, `pwa/test/replace-token.test.tsx`, `pwa/browser/connect-sheet.browser.test.ts` (each of its cells draws a failed check, then Check again).
- Changed: `server/test/roster-wire-kind.test.ts` (decision 13). The fakes in `connect-sheet`, `sign-in-sheet`, `secret-field`, `replace-token` and `reauth-sheet`, and in the connect, sign-in, reauth and remove browser files, now answer a verdict of `ok`.
- Changed: `pwa/test/auth-resume-banner.test.tsx`. Its "a method the sheets do not run" case used `openai-login`, which they now run, so it uses `openrouter-pkce`.

**Mutation table (run):**

| Mutant | Suite | Red |
|---|---|---|
| the user code at 28px | chatgpt-sheet | "the user code at 24px fits eight characters and a hyphen in 296px" |
| render the code from the file when untrusted | chatgpt-sheet | "an untrusted `userCode` shows no code and no link" |
| the Codex folder line off by default | chatgpt-sheet | "the remove sheet's Codex line is on by default…" |
| the line off still deletes | chatgpt-sheet | "turned off, it says the folder stays and asks the verb to keep it" |
| a code kept past a URL that came without it | chatgpt-sheet | "a later answer that brings a URL with no code…" |
| the card drawn on the URL alone | chatgpt-sheet | "a URL with no device code beside it shows neither…" |
| expiry from a duration, not `expiresAt` | chatgpt-sheet | "expiry reads the code's `expiresAt` time" |
| a device sign-in never waits on the operator | chatgpt-sheet | "counts as waiting on the operator at `url`…" |
| the Signed-out card offers nothing | chatgpt-sheet | "a Signed-out Codex lane's primary fix is Sign in again…" |
| the Codex word offered with no measured host | accounts-route-lanes | "holds the Codex word back until…" |
| the route drops keep | account-routes-write | "the remove sheet's Codex line reaches the verb as its own flag…" |
| the add sends `openai-login` again | chatgpt-sheet | "the add's exact body is one the real builder writes…" and 14 others |
| the sign-in line gated on the word again | chatgpt-sheet | "after `done` the check starts the gateway…" |
| the same gate, in the result frame alone | chatgpt-sheet | "after `done` the check starts the gateway…" |
| the same gate, in Sign in again's ending alone | chatgpt-sheet | "an Off lane signed in again says so from its check…" |
| the line ignores the verdict | chatgpt-sheet | "a check that did not pass never says the lane is signed in" |
| the line ignores a 401 word, a sign-out or `credential: 'none'` (three mutants) | chatgpt-sheet | "the line reads what the lane proves…" |
| the kept-folder sentence promises the sign-in works | chatgpt-sheet | "turned off, it promises only what the box does…" |
| the sheet keeps the one credential sentence | chatgpt-sheet | "the sentence above the line follows it…" |
| the turned-on sentence promises the folder goes | chatgpt-sheet | "turned on, it claims no more than the verb…" |
| the code's note says "not a secret" again | chatgpt-sheet | "tells the operator not to share the code…" |
| Use what's there announces the token line on every provider | chatgpt-sheet | "says what this flow does…" |
| `managedCodex` reads the kind alone | chatgpt-sheet | "an OpenAI lane ccrc only records has no folder step…" |
| an absent `managed` reads as owned | chatgpt-sheet | "neither offers it on an OpenAI lane ccrc only records…" |
| the fold keys on the kind | chatgpt-sheet | "neither offers it on an OpenAI lane ccrc only records…" |
| the card keys on the kind | chatgpt-sheet | "neither offers it on an OpenAI lane ccrc only records…" |
| an answer with no verdict passes | connect-sheet | "a check answered no verdict at all says what it found…" |
| a word the table doesn't know passes | connect-sheet | "a word it doesn't know is not a pass…" |
| the table read without `Object.hasOwn` | connect-sheet | "a word it doesn't know is not a pass…" |
| `ConnectSheet` says Checked on any answer | connect-sheet | "a check answered auth-dead says what it found…" and two others |
| `ReauthSheet` says Checked on any answer | reauth-sheet | "a fresh check answered auth-dead says what it found…" and two others |
| `MethodSwitchSheet` says Checked on any answer | method-switch | "a fresh check answered auth-dead says what it found…" and two others |
| `ReplaceSheet` says Checked on any answer | replace-token | "a fresh check answered auth-dead says what it found…" and two others |
| the connect alert drops the sentence | connect-sheet | "a check answered auth-dead says what it found…" and two others |
| the switch alert drops the sentence | method-switch | "a fresh check answered auth-dead says what it found…" and two others |
| the latency line ignores the verdict | connect-sheet | "a check answered auth-dead says what it found…" and two others |
| Remove ignores a recorded lane | chatgpt-sheet | "a lane ccrc only records keeps its launcher and its credential…" |
| `recordedOnly` reads an absent `managed` as recorded | chatgpt-sheet | "a lane with no such line keeps its own sentence" |
| a recorded lane must be a Codex one | chatgpt-sheet | "every lane ccrc only records reads that way…" |
| the folder line stays live while busy | chatgpt-sheet | "the line is held while the remove is in flight…" |
| `managed: false` left off an undeclared lane | roster-wire-kind | "an entry with no provider carries no provider or kind…" |
| `managed: false` left off an Anthropic lane | roster-wire-kind | "managed is false on every lane ccrc only records…" |
| `managed: false` left off a key lane | roster-wire-kind | "managed is false on every lane ccrc only records…" |
| a generated OpenAI lane reads as recorded | roster-wire-kind | "managed is absent on a lane ccrc runs…" |

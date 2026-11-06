# Accounts connect A25: the ChatGPT device-code sheet

**Goal:** plan Task A25 of `2026-10-18-accounts-connect.md` (spec §7.2, §9 row 5, §11 step 4, §3.8; D-5519, N2). A ChatGPT lane is added and signed in from the PWA, its sign-in is renewed from its card, and Remove says what happens to its sign-in folder.

**Before this change:** OpenAI's row read "This app can't run it yet" on a fleet that offered it, a Signed-out Codex lane had only a fleet-host command, and the remove sheet said nothing of the lane's folder. The verb deleted it whatever the operator wanted, since no route could ask it to keep it.

## Numbers

- **D-8051 (2026-11-06)** — `chatgpt-device-code-sheet` (Task A25): the ChatGPT device-code sheet, with the six decisions below, which the task's Files list and shape did not make.

1. **The Codex cap word is offered only once its sign-in can start.** `ACCOUNT_CAPS` gains `account-codex-v1`, as it gained `account-auth-v1` when A22's sheet shipped. OA1b did not measure the Codex host or `userCode` shape, so `AUTH_URL_HOSTS['openai-login']` is empty and `auth/start` refuses `method-unmeasured` (D-7792). Offering the word anyway would let the sheet add a lane, with its two ports and its folder, and then fail to sign it in. So `accountsConnect` holds the word back while that list is empty. The row narrows in place, and the fold and the trouble card offer no Sign in again. Adding the measured host opens all of it in one act: no second switch to remember. N2 is not changed.
2. **The task's Files list predates the shared attempt.** The sign-in moved into `useSignInAttempt.tsx` under A23, and A38 added `ReauthSheet.tsx`, so both change here, with `ConnectSheet.tsx`, `MethodFrame.tsx`, `connectFlow.ts` and `AccountsScreen.tsx`. `ProviderFrame.tsx` needs no change: the row narrows through `providerChoices`, and "Models: luna, terra and sol from your ChatGPT plan." stands in the method frame, where a radio would be, above Confirm it's you. `SignInMethod` gains `openai-login`; `AnthropicSignIn` names the two methods a switch runs.
3. **The folder line needs a route field.** A24 gave the argv `--delete-codex-auth`, the verb's default, and no way to keep the folder, so a line turned off would have said "kept" while the verb deleted it. `AccountRemoveBody` gains `codexAuth: 'delete' | 'keep'` (remove mode only), and the argv gains `keepCodexAuth` for the verb's existing `--keep-codex-auth`. The ledger is still the verb's answer. An agent older than this argv refuses the keep and nothing is removed, so the order of the two lanes can't delete a folder the operator kept. The ticked line needs nothing new.
4. **A device sign-in waits at `url`.** The auth library prints "Enter code:", which the helper's prompt match (`Enter the code`) does not take, and the box has nothing to ask for, so the attempt never reaches `waiting-code`. `waitsOnOperator` reads `url` as waiting for a method that shows a device code, for the resume banner and the card's resume line alike, and each says "waiting for you to approve it". The helper is unchanged.
5. **No wrong-account act on a Codex lane.** `credential --sign-out` refuses `not-a-sign-in-lane` for anything but a generated Anthropic lane, so "Sign this lane out and start again" would always fail. `ResultSignIn.wrongAccount` is optional and absent here; Sign in again replaces the sign-in. Remove and Discard remain.
6. **The URL and the code are one fact.** The helper publishes the URL a line before the code, so the card waits for both, and the ledger's waiting line waits with it. An answer that brings a URL with no code clears the code, so a stale code never sits beside a new link. N2 stays the server's: the PWA holds no shape of its own, and it shows no card once the server answers `auth-url-untrusted`.

**Words.** Every sentence that would be false for this flow has its own: no claude.ai, no code to paste, no code sent, no token to fall back on (`chatgptEnd`, `reauthEnd`, `signInLedger`, `signInStartRefusal`, `addRefusal` by the verb's code, and the two after-an-unknown lines for every sign-in lane). The runtime's failure line is never quoted: `failure` is a plain word or nothing.

**Still to do, by the operator:** the box run OA1b could not finish (the provider answered HTTP 530 that day) measures the Codex host, path and `userCode` shape. That change is `AUTH_URL_HOSTS`, `AUTH_URL_PATHS` and `AUTH_USER_CODE_SHAPES` in `shared/accounts.ts`, and until it lands no fleet offers this sheet. Nothing here was run against a real provider or a real code. The sheet is proved against a fake box and a stand-in host.

**Tests:**
- New: `pwa/test/chatgpt-sheet.test.tsx`, and `pwa/browser/chatgpt-sheet.browser.test.ts`: two sets of 16 width, skin and mode cells in real Chrome (the add, then Sign in again and Remove).
- Extended: `server/test/accounts-route-lanes.test.ts`, `server/test/account-routes-write.test.ts`, `server/test/ccrc-account-codex-add.test.ts` (the keep flag through the real verb).
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

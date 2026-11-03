# Accounts connect A23: resume on any route, and the two method switches

**Goal:** plan Task A23 of `2026-10-18-accounts-connect.md` (spec §6.2, §9, §4.2, §4.4; Q1, N5). A sign-in this session started and left at its code is offered again on every route by an app-level banner, whose Continue opens the sheet at the code field; the lane's card says so with Continue and Cancel. A sign-in lane switches to a long-lived token (the fold's act, and a Signed-out sign-in lane's primary fix), and a token lane switches to sign-in. OA1's record (`2026-11-01-accounts-oa1-record.md`) is applied where this task reads it: §9 (what a live session does once its lane's sign-in is logged out) is not measured, so **Sign the old sign-in out** stays the spec's danger confirm while a listed session predates the switch; G23 is not measured, so the sign-out says the provider's side is unmeasured; the setup-token code shape is still pending, so the mint's code keeps the spec's provisional shape (`authCodeShapeOk`, A21's). §3.3 and the Codex device code are not read by this task.

**Before this change:** an attempt left at its code could be continued only by keeping its sheet open. `LaneWire.authAttempt` said whether this session started it (`mine`) but not its id, so no sheet could send its code after a reload. A lane's method could be changed only from the fleet host's shell. The sign-in attempt itself lived inside `ConnectSheet.tsx`.

**Change:**
- `shared/api.ts`: `LaneWire.authAttempt` is `LaneAuthAttempt`, which for the starting session also carries the attempt's `attemptId` and `method`. `server/src/accounts/attempts.ts`'s `wireOf` sends them to that session only.
- `pwa/src/accounts/useSignInAttempt.tsx` (new): the attempt, moved out of `ConnectSheet.tsx` with no change to what it does. It holds the start, the poll, the code, Cancel, each terminal state and resume. `SignInLive` draws the live attempt's run frame. Each sheet supplies its ledger, its live region, its terminal sentences and what follows `done`.
- `pwa/src/accounts/ConnectSheet.tsx`: runs the attempt through the hook, and with `resume` opens at the run frame on the attempt the server holds.
- `pwa/src/accounts/MethodSwitchSheet.tsx` (new): both switches.
- `pwa/src/accounts/AuthResumeBanner.tsx` (new): the banner, its predicate, and its placement on a phone's views other than the fleet's.
- `pwa/src/accounts/RestartList.tsx` (new): the lane's sessions with one-tap Restart, moved out of `ReplaceSheet.tsx` so the switch sheet lists them the same way.
- `pwa/src/accounts/AccountSheet.tsx` (new): the account sheets' shell (the sheet, its live region and the offline sentence), which the connect and switch sheets share.
- `pwa/src/accounts/connectFlow.ts`: `resumableAttempt`, `heldAttemptOf`, `resumeSheetFor` and `switchTargetOf`. `isSignInMethod` now takes any method word.
- `pwa/src/accounts/ResultFrame.tsx`: `StatedField` is exported, with a default text. `pwa/src/accounts/RemoveSheet.tsx`: `GuardedAct` takes a `ghost` variant.
- `pwa/src/screens/AccountsScreen.tsx`: the fold's switch acts, the trouble card's primary fix, the card's resume line, `/accounts?resume=<id>`, and the two sheets it hosts.
- `pwa/src/fleet/TroubleCard.tsx`: `switchTo`, the card's primary fix.
- `pwa/src/fleet/BannerStack.tsx` and `pwa/src/screens/FleetScreen.tsx`: the `resume` banner.
- `pwa/src/app.tsx`: `AuthResumeInDetail` at the top of the detail pane.
- `pwa/src/lib/routes.ts`: `accountsResumeHref`, `resumeParam` and `shellViewOf`, which `app.tsx` now reads too.
- `pwa/src/fleet/accountWords.ts`: every sentence the banner, the card line and the switch sheet say.
- `pwa/src/fleet/fleet.css`: the banner, the phone session's column while the banner shows, and the card line.

**Tests:**
- New:
  - `pwa/test/auth-resume-banner.test.tsx`:
    - The App loaded at `/` (at 360 and at 1920) with a `mine` attempt in `waiting-code` shows the banner, and Continue opens the code field with no new start.
    - On a phone, a session and Settings place the banner at the top of the detail pane. A desk places it in the banner stack. One instance is on screen either way.
    - Another session's attempt shows no banner, even when the wire carries an id.
    - Nothing about the attempt is read from storage, checked both live and by a scan of the source.
    - Continue on a switch's attempt opens the switch sheet.
    - `resumableAttempt`'s choice, and that the banner draws exactly when its predicate says it shows.
  - `pwa/test/method-switch.test.tsx`:
    - A Signed-out sign-in lane's primary fix is Switch to a long-lived token.
    - Each fold offers its switch.
    - A cancelled switch to sign-in leaves the card a token lane's.
    - Sign the old sign-in out is a danger confirm while a listed session predates the switch, and a plain button after. This case also covers the fresh check and the stated identity's default.
    - With no session on the lane, the sign-out is plain from the start.
    - A refused mint changes nothing.
    - The switch to sign-in ends with the restart list and the revoke item.
    - A resumed sheet starts nothing and sends its code.
  - `pwa/browser/auth-resume.browser.test.ts`: Step 4's sixteen cells.
- Extended:
  - `server/test/account-routes-auth.test.ts`: the starting session alone is told the id and method.
  - `pwa/test/sign-in-sheet.test.tsx`: its no-duration source scan now covers the new files.
  - `pwa/test/fleet-pieces.test.tsx`: its banner-module scan now reads `accounts/` too.
  - `server/test/hibernate-census.test.ts`: the presence reader that lists a lane's sessions for Restart is now `RestartList.tsx`, which both sheets call, and no longer `ReplaceSheet.tsx`.
  - `server/test/collect-lane-l0.test.ts` and `server/test/peers-claims-l0.test.ts`: their pin of `shared/api.ts`'s import lines now reads the `accounts.js` type import with `AuthMethod`. It is still one type-only line.
- Unchanged and green:
  - `pwa/test/sign-in-sheet.test.tsx`, `connect-sheet.test.tsx` and `replace-token.test.tsx` all pass over the moved code.
  - `pwa/browser/sign-in-sheet.browser.test.ts` and `connect-sheet.browser.test.ts`.
  - `pwa/test/older-server-render.test.tsx`: the stack draws no `resume` slot while none applies.

**Mutation table (run):**

| Mutant | Suite | Red |
|---|---|---|
| the banner only on `/accounts` (`AuthResumeBanner` draws nothing off `/accounts`) | auth-resume-banner | "loading `/`…" at 360 and 1920, and four more cases |
| the banner ignores `mine` (`heldAttemptOf` without `!a.mine`) | auth-resume-banner | "another session's attempt shows no banner" |
| Sign in again as the Signed-out primary (the card's primary labelled "Sign in again") | method-switch | "a Signed-out sign-in lane's primary fix is Switch to a long-lived token" |
| the sign-out step always plain (`predating` held at 0) | method-switch | "Sign the old sign-in out is a danger confirm while…" |

Every new case was also run green against the unmutated tree.

**Per width × skin × mode (Step 4):** `pwa/browser/auth-resume.browser.test.ts` measures this in a real Chrome over the production build, with the fleet's routes answered by its fixture. In each cell, a sign-in lane's switch to the token waits for its code, and a session runs on the lane.

| | 360 | 390 | 1280 | 1920 |
|---|---|---|---|---|
| Refined · Phosphor & Ink (dark) | ✓ | ✓ | ✓ | ✓ |
| Refined · Phosphor Daylight (light) | ✓ | ✓ | ✓ | ✓ |
| Instrument · Phosphor & Ink (dark) | ✓ | ✓ | ✓ | ✓ |
| Instrument · Phosphor Daylight (light) | ✓ | ✓ | ✓ | ✓ |

Each ✓ checks these things:
- The skin and theme drawn are the ones the cell names, and at every step nothing scrolls sideways, in the page or in the sheet.
- The banner on the fleet screen, on a session and on Settings: exactly one on screen, inside the viewport's width, and never over the tab bar. On the session it is never over the composer, which stays inside the viewport. This measurement found the 360 session view scrolling 19px sideways once the chat became a column item, and the chat now takes the column's width (D-7871 (3)).
- A relaunch at `/` (spec §16, its own cell): the banner is back.
- Continue: the switch sheet at its code field, with the countdown read from `expiresAt`.
- The code, then `done`:
  - the fresh check;
  - the session, with Restart;
  - Sign the old sign-in out, as the danger confirm, with "1 session on lane-b still uses the sign-in and may fail its next turn." and a danger "Sign it out anyway";
  - the closing line;
  - the code in no DOM node.

## Decisions

- **D-7871 (2026-11-01)** — `resume-and-method-switches-as-built` (accounts plan Task A23; spec §6.2, §9, §4.2, §4.4, §12.4, §16; Q1, N5): the as-built decisions of A23, and where it departs from the plan's wording.
  1. **The resumed sheet needs the attempt's id.** The plan has Continue open the sheet at the code field. `auth/code` takes `{attemptId, code}`, and the wire told a reloaded PWA only `{state, expiresAt, mine}`. So `LaneWire.authAttempt` now also carries `attemptId` and `method`, for the starting session only (`LaneAuthAttempt`, a union on `mine`). The id is no capability: `auth/code` still takes the code from that session alone (`not-your-attempt`), and Cancel never needed more than the id. The method decides the code's shape, the URL card's words and which sheet continues the attempt. Another session's answer carries neither field, and the screen reads `mine` itself, so a wire that did carry them would still offer nothing. Like the rest of `lanes`, it is in memory only, never in the offline snapshot. This adds a server file and `shared/api.ts` to the task's Files list.
  2. **One attempt, two sheets.** The connect sheet's attempt moved into `useSignInAttempt.tsx` with no change to what it does: the start, the 1.5 s poll, the URL kept once seen, the one-send latch, Cancel, the expiry at `expiresAt`, and each terminal state from a code. `SignInLive` draws the run frame. The connect and switch sheets each supply four things:
     - the ledger and the live region;
     - the terminal sentences: a new lane "exists and is off"; a switch says "Nothing changed: lane-b still uses its sign-in" (or "its token"), and a `lost` attempt, which may have finished, claims nothing and says to check the lane;
     - what follows `done`.
     Without this move, the switch sheet would be a second copy of the sign-in. A switch's `failed` after its code went reads "the new credential wasn't accepted: claude.ai refused the code, or the check of what it gave failed". The helper's `done` is reached only through `set --method`'s passing probe (A20), so a failed install also lands there. Resume adopts the held attempt with no start, and its first poll brings back the URL and the code field. The connect sheet takes `resume` for a lane it added. The switch sheet takes `resume` for a switch. Which of the two opens is decided by `resumeSheetFor`: `setup-token` on a sign-in lane, or `login` on a token lane, is a switch; the same method as the lane's is a connect, because a mint lane is a token lane from its add.
  3. **Where the banner sits.** The banner must be on every route and never over the composer or the tab bar, so it is in flow, in two places, and only one of them is ever on screen:
     - **The fleet's banner stack** (`FleetBanners`, id `resume`): a pinned door, ranked first, because its deadline is the one thing on the stack that runs out. A desk shows the stack on every route (Refined under its bar, Instrument in its list column), and a phone on its fleet view. Its slot is in the stack only while it applies, as each store notice's is: it holds no state a fold must keep, and an always-mounted slot would change the fleet's markup that the older-server baseline pins.
     - **On a phone's other views**, at the top of the detail pane (`AuthResumeInDetail`, mounted by `app.tsx`). The stack holds none there, so the fleet column that the phone hides holds no second copy (`useResumeInStack`, which reads `shellViewOf`, the view `app.tsx` now reads too).
     A phone's session view is one viewport tall, so while the banner shows, the detail pane becomes that viewport's column and the chat takes the rest at the column's full width. Step 4 measured a 19px sideways scroll at 360 before the width was set. The minutes are read from `expiresAt`, rounded up, on a 15 s clock, and the banner leaves at the deadline. Continue opens `/accounts?resume=<id>`, which opens its sheet once per value, as soon as the store's answer holds the attempt, and the query is dropped when that sheet closes. The card's line ("A sign-in is waiting for its code" with Continue and Cancel) shows for the same attempts: this session's, in `waiting-code`. A sheet closed on the Accounts screen re-reads the accounts answer, so the banner appears without waiting for the 20 s poll.
  4. **Shared pieces, written once.**
     - The lane's sessions with Restart (`RestartList`, `useRestarts`, and `restartableOn`, the one presence read that lists them) moved out of the replace sheet. A19's tests pin it unchanged.
     - The account sheets' shell (`AccountSheet`) is shared because the markup census reads the two sheets' identical shells as a component nobody wrote.
     - `StatedField` is exported with a default text.
     - `GuardedAct` takes a `ghost` variant, for the plain sign-out.
     These add `ReplaceSheet.tsx`, `ResultFrame.tsx`, `RemoveSheet.tsx`, `ConnectSheet.tsx`, `connectFlow.ts`, `BannerStack.tsx`, `FleetScreen.tsx`, `routes.ts` and `fleet.css` to the task's Files list.
  5. **Where each switch is offered.** A sign-in lane's fold offers Switch to a long-lived token as its first credential act. A token lane's fold offers Switch to sign-in after Replace token. A Signed-out sign-in lane's trouble card has Switch to a long-lived token as its first act and its one primary, beside the fleet-host command (Q1). Both acts are drawn only on a fleet that advertises the sign-in's cap word (`account-auth-v1`, in `connect.caps`). An older fleet cannot run them, and its lanes keep the acts they had. Sign in again, the Signed-out card's second act, and the Expiring card's Switch to sign-in are A38's.
  6. **Switch to a long-lived token, step by step.** The intro says nothing changes until the token passes, then **Mint the token** runs behind the step-up. Then come the attempt, the box's switch on `done`, and a fresh check. The stated identity follows, with the sign-in's measured email, read when the sheet opened, as its default text. Then the lane's sessions with Restart: those live when the switch landed, which started on the sign-in. **Sign the old sign-in out** comes last:
     - **§9 is unmeasured** (the OA1 record), so while any listed session has not been restarted, the button is a danger-ghost that reveals the confirm "1 session on lane-b still uses the sign-in and may fail its next turn." with a danger **Sign it out anyway** and Keep it.
     - Once none predates the switch (every listed one restarted, or none listed), the button is plain (ghost) and signs out directly behind the step-up.
     - Until then the sheet says the lane holds both. That is spec §9's one exception to "never two".
     - **G23 is unmeasured** (the OA1 record), so after the sign-out the sheet says "Signed out here. Whether that also ended the sign-in at Anthropic is unmeasured" and links the account settings. It never says the sign-in ended there.
     The compromise disclosure follows, as in every token lane's result. The sheet closes on "Sessions on this lane won't ask you to sign in again for about a year".
  7. **Switch to sign-in** runs the same way to the fresh check, then lists the sessions that still hold the old token, each with Restart, then the revoke checklist item for the old token (A19, N6). There is no compromise disclosure, because this is a sign-in's result, and no stated identity, because the lane reads its own account.
  8. **A terminal state** of either switch says what did not happen, then offers Start again (behind the step-up) and Close. There is no Discard: the lane existed before the switch.

Issued and unused: none.

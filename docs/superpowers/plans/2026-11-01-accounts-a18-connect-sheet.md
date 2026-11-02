# Accounts connect A18: the Add account door and the connect sheet, with Anthropic Paste end to end

**Goal:** plan Task A18 of `2026-10-18-accounts-connect.md` (spec §5, §6.1, §6.3, §12.3, §12.4, §12.5; D-5522, D-5513). The Accounts screen gets its **Add account** door, one per width, which narrows in place with its reason, and the connect sheet: Provider → Name it → Method (with Confirm it's you when the step-up has lapsed) → Run → Result. Anthropic **Paste a token** runs end to end over A17's routes. The decisions this task makes are numbered D-7740 below.

**The OA1 record** (`2026-11-01-accounts-oa1-record.md`), read where this task touches it: the sheet runs only the paste method, so no sentence here depends on D-5518's sign-in row, G23, §9, §3.3, the Codex device code or the setup-token code shape. Mint and Sign in stay narrowed in place ("Needs a fleet update") until `account-auth-v1` is advertised, and the sheet claims nothing about either.

**Before this change:** lanes could only be added on the fleet host (`ccrc account add`). The screen had Check and the kill switch (A14), and the write routes existed (A17), but no screen called `POST /api/accounts`.

**Change:**
- `pwa/src/accounts/` (new): `ConnectSheet.tsx` (the flow, the live region, `AddAccountDoor` and `DoorReason`), its frames `ProviderFrame.tsx`, `NameFrame.tsx`, `MethodFrame.tsx`, `RunFrame.tsx` and `ResultFrame.tsx`, their shared foot `FrameFoot.tsx`, `SecretField.tsx`, and `connectFlow.ts` (pure: the providers and methods narrowed by cap word, the default method from the provider table, the default hue, the id, label and secret checks).
- `pwa/src/screens/AccountsScreen.tsx`: the door (the lane list's last row on a phone, the page header's action at ≥900), its reason beneath it, and the sheet. Offline is the store's own reading (`conn === 'down'`): the door, Check and the knob are refused with one sentence and the read-line.
- `pwa/src/fleet/accountWords.ts`: every sentence the door and the sheet say, and `addRefusal`, which words an add's refusal from its code only. `pwa/src/lib/api.ts`: `accountAdd`. `pwa/src/stores/fleet.ts`: `accountsReadAt()`. `pwa/src/fleet/fleet.css`: the door and the sheet.
- `shared/api.ts`: `AccountsConnect.caps` (edited in place, so nothing below it moves). `server/src/accounts/lanes.ts`: `connect.caps` is `ACCOUNT_CAPS` filtered by what the fleet advertises.
- `shared/roster.ts` (at the foot): `RESERVED_LANE_IDS`, `newLaneIdProblem`, `newLaneLabelProblem` and `newLaneConfigSuffix`, which read the parser's own private gates. `ui/src/primitives/text-input.tsx`: `TextInput` takes `ref`, as `Button` does.
- `pwa/design/audit.mjs`: the grounds of the new rules (the page for the door, the sheet for the frames).

**Tests:**
- New: `pwa/test/connect-sheet.test.tsx`, `pwa/test/secret-field.test.tsx` (the PWA half of the canary) and `pwa/browser/connect-sheet.browser.test.ts`.
- Extended: `server/test/accounts-route-lanes.test.ts` (`connect.caps`), `pwa/test/role-census.test.ts` (the door's word, the field labels, the sheet's notes and a method's line), `server/test/delegation-wave3.integration.test.ts` (the closed scope census's `adopt` list gains `ConnectSheet.tsx` and `accountWords.ts`: the account add's roster `adopt`, not the delegation broker's adoption).

**Mutation table (run):**

| Mutant | Suite | Red |
|---|---|---|
| keep the key in the fleet store | secret-field | "…no store dump…", and "a refused paste re-presents an empty field" (its own store check) |
| skip the `visibilitychange` clear | secret-field | the hide case of "after submit, close, route change and hide…" |
| re-present the refused value (the read does not empty the field) | secret-field | "a refused paste re-presents an empty field" |
| hide the door instead of narrowing it | connect-sheet | "one door per width, and it narrows in place with each reason", and the offline case |
| the first free hue as the default | connect-sheet | "a taken hue is selectable and the least-used is the default" |
| one act left enabled offline (Check and the knob read `connect` alone) | connect-sheet | "offline, every act on the screen and in the sheet is refused…" |
| the terminal state announced as `status` | connect-sheet | "a step change lands in a `role="status"` region and a terminal state in a `role="alert"` one, each once", and the refused-paste case |
| outcome unknown sends the add again | connect-sheet | "outcome unknown re-reads the roster and resumes; no second add is sent", and its no-lane twin |
| the radio order hard-coded in `MethodFrame` | connect-sheet | "the radio order is the table's" |
| a refused check leaves Turn it on enabled, and announces "added, and off" | connect-sheet | "a refused check holds Turn it on, with the refusal beneath it and Check again beside it", and its never-answered twin |
| the census's `adopt` list left without the sheet's two files | delegation-wave3 (server) | "the closed scope census > the wave-4 shape…" |

**Per width × skin × mode (Step 4):** `pwa/browser/connect-sheet.browser.test.ts` measures this in a real Chrome over the production build, with no fleet behind it. Each cell walks Anthropic Paste end to end on its own context, and opens a second context on a dark gate's answer for the narrowed door.

| | 360 | 390 | 1280 | 1920 |
|---|---|---|---|---|
| Refined · Phosphor & Ink (dark) | ✓ | ✓ | ✓ | ✓ |
| Refined · Phosphor Daylight (light) | ✓ | ✓ | ✓ | ✓ |
| Instrument · Phosphor & Ink (dark) | ✓ | ✓ | ✓ | ✓ |
| Instrument · Phosphor Daylight (light) | ✓ | ✓ | ✓ | ✓ |

Each ✓ checks these things:
- The skin and theme drawn are the ones the cell names, and at every step nothing scrolls sideways, in the page or in the sheet.
- The door: exactly one. On a phone it is the lane list's last row, at the skin's row height (52px in Refined, 44px in Instrument). At 1280 and 1920 it is the page header's action. Narrowed (a dark gate), it stays, `aria-disabled`, with its reason and `ccrc auth on` beneath it.
- The sheet: a bottom sheet at 360 and 390, full width. At 1280 and 1920 it is **the centred dialog** (md 560), the Sheet's desktop arm (D-5933), which is already on main, so this PR records the dialog and not a bottom sheet.
- Name it: the six hue swatches sit in one row, each cell at least 44px wide. The derived folder line is one mono line that ellipsises when the name is long.
- Method: the radio follows the provider table (Sign in, Paste, Mint today; A20 reorders it Mint first). Mint and Sign in are disabled in place, and Paste is selected.
- A refused paste shows its sentence, and the field is empty. The result frame offers Turn it on under the ledger, and the token is in no DOM node.

**The offline row (§Acceptance, spec §12.5).** The same file draws one offline cell per skin at 360 and at 1280, dark, four in all, each read twice, in a real Chrome with the link cut by the harness (`cut()`: every `/api` request fails as a disconnected one and every socket closes).

| | 360 | 1280 |
|---|---|---|
| Refined · Phosphor & Ink (dark) | ✓ | ✓ |
| Instrument · Phosphor & Ink (dark) | ✓ | ✓ |

Each ✓ checks these things:
- **Warm.** The sheet is open on the method frame with a token typed when the link drops, and the page's clock then runs four minutes. The screen keeps the last answer, with every age counting on from the page's clock: each card's source reads "checked 6m ago" (it was "checked 2m ago") and its usage line "last reported Nm ago". The door is `aria-disabled` with "You're offline: nothing was sent. Read Nm ago." beneath it. Each card's switch is disabled with the same sentence as its reason, and no Check is drawn. The sheet shows the sentence, its primary is disabled, and no secret field is drawn: the typed token is in no DOM node, and the page holds no text field at all. Nothing scrolls sideways.
- **Cold.** The app starts with no link, from the offline snapshot (sessions and the roster, never `lanes`, G15), and the fleet counts the snapshot's one session. The Accounts list is the count-free placeholder, because no usage answer has landed (the same reading as `accounts-cards.browser.test.ts`'s cold cell), so no card, switch or Check is drawn on what the snapshot cannot say. The door is `aria-disabled` with "You're offline: nothing was sent. Nothing has been read from the server since this page opened." A forced tap on it opens nothing, and the page holds no text field.

Contrast is the gate's job: `node design/contrast-check.mjs` passes every pair. The narrowed door draws in the secondary ink, not the disabled ink (below).

## Decisions

- **D-7740 (2026-11-01)** — `connect-sheet-and-door-as-built` (accounts plan Task A18; spec §5, §6.1, §6.3, §12.3–§12.5; D-5522, D-5513): the as-built decisions of A18, and where it departs from the plan's wording.
  1. **The cap words reach the screen.** `GET /api/accounts`'s `connect` gains `caps`: the words of `ACCOUNT_CAPS` the fleet advertises, in that list's order (`[]` with no evidence; absent from an older server, which reads as none). The sheet narrows each provider and method by the word it needs (N4, D-7734): Anthropic `account-v2`, OpenAI `account-codex-v1`, OpenRouter `account-openrouter-v2`; paste `account-v2`, Mint and Sign in `account-auth-v1`. A word a later wave has not yet appended to `ACCOUNT_CAPS` can never be in `caps`, so its row stays narrowed until that wave lands. **A20 note:** appending `account-auth-v1` offers Mint and Sign in in this radio, Mint first once A20 reorders the table. Until A22 gives them steps, choosing one reads "This app can't run it yet: reload after the next update." at its primary, and nothing is sent.
  2. **The default method is the table's.** The radio's order is `PROVIDERS[provider].connect`, and its default is the first member that is not narrowed. Today that table is `['login', 'paste', 'setup-token']`, so the radio reads Sign in, Paste, Mint. The plan's "Mint first in the radio" holds once A20 reorders the row; this task restates neither the order nor the default.
  3. **The secret lives in its field's DOM node, not in React state.** The field is uncontrolled: React keeps a controlled input's `value` attribute in step with what is typed, which would put the token in the document's markup, where `outerHTML` or a mutation observer could read it. The sheet reads the value once, on submit, and that read empties the field (`SecretFieldHandle.take`). The field is also emptied on `visibilitychange` to hidden and on a route change, and on close it unmounts. It never enters a store, `localStorage`, `sessionStorage` or IndexedDB. Offline, the field is not drawn. Before sending, the sheet applies `isAccountStdin`, the route's and the verb's own byte rule.
  4. **After a pasted add, the sheet runs Check.** The box's paste probe validates the token, but it records no check and runs no seed, so a new lane is Not checked and `enable` would refuse it as `not-ready`. The Run frame therefore writes "created · off", then calls `POST /api/accounts/:id/check` (one test reply, which seeds), and the Result frame shows the round trip as this sheet measured it. If the check is refused, or never answers, its words stand in the ledger and on the result, and **Check again** sits beside a disabled **Turn it on**, with the box's reason beneath it. A refused check leaves no lane read (an earlier answer is not this one's), so the result treats it as not ready with the refusal as its reason, and the terminal alert announces the refusal, not "added, and off".
  5. **Outcome unknown.** An add that answers `outcome-unknown`, or a request that never completed, writes "The fleet host didn't answer in time. The lane may exist; checking…", re-reads `/api/accounts` and reads the store's roster after that read. If the lane is there, the sheet resumes at Check. If it is not, the sheet says nothing was added and returns to the method frame with the field empty. It never sends the add again. A later add that meets `lane-exists` (the server's roster has the id, this screen's did not) re-reads and says the name is taken.
  6. **Step-up.** Confirm it's you is drawn inside the method frame, above Add lane, only while the stamp has lapsed. The add waits for it. The step-up hook is mounted only while that frame is drawn and the screen is online, so the challenge is fetched when the step is shown, and an offline sheet sends nothing. **Use what's there** (`adopt`) goes back to the method frame with the field empty, and the adopting add takes the same step-up as any add (the route's five-minute rule). An add refused `step-up-required` returns to the method frame with the step showing.
  7. **The door, per width and skin.** On a phone, in both skins, the door is a `ListRow` at the skin's own `--row-h` (52px in Refined, 44px in Instrument), with the meta line beside the word. At ≥900 it is a secondary button in the `PageScaffold` header, **in Instrument too**: Instrument's list column does not hold this route's list until A4, so the list column's header action is A4's to move it to. A narrowed door is `aria-disabled` and focusable, never `disabled` and never removed. Its reason is named by `aria-describedby` and drawn beneath it (on a desk, as the body's first line under the header), with the fixing command in the trouble card's truthful Copy control when there is one. Before the first answer lands, the door narrows with "Reading the fleet host before anything can be added." A landed answer with no `connect` is a dark gate's (D-5511), so it reads the gate-dark reason. The narrowed door draws in the secondary ink: no text pair clears 4.5:1 in the disabled ink, and the word must still read.
  8. **Offline.** Offline is the store's `conn === 'down'`. The read-line is the age of the last accounts answer that landed, `accountsReadAt()`. That is a store method, not a field, so reading the time never counts as a write and an equal answer still writes nothing. The one sentence ("You're offline: nothing was sent. Read 4m ago.") refuses the door, Check and the knob on every card, and every frame's primary. No secret field is drawn.
  9. **One live region.** The sheet holds one visually hidden pair: a `role="status"` line for each step change, and a `role="alert"` line for each terminal state (a refusal, outcome unknown, the add done, the lane on). Only a transition writes them, so a re-render announces nothing.
  10. **No `CopyField.tsx`.** The plan names a new copy control, but the trouble card's `CopyCommand` (A2) is already the truthful Copy: "Copied" only once the clipboard resolves, and otherwise the text is selected with "Couldn't copy: press and hold to copy". The door's reason reuses it: the command field's rule now names `.acct-door-reason .acct-fix-field` too, and the hold line takes the sheet's notes rule. A second component would be a second mechanism.
  11. **The name rules are the roster parser's.** `newLaneIdProblem` reads the parser's private `ID_RE`, and adds `auth` (the verb's `reserved-id`) to the GPT-lane toolchain ids. `newLaneLabelProblem` reads `LABEL_UNSAFE_RE`. `newLaneConfigSuffix` is the verb's G4 rule, which the sheet only displays. `connect-sheet.test.tsx` holds it to the verb's cases. The door's provider list is the keys of `PROVIDER_ROWS`, so the list and its words cannot disagree, and no file restates the provider ids as an array.

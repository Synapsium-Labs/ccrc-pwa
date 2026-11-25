# Wave 180: a refused Add account door that looked live

Task note for desktop-polish wave 180, a reported defect. Claims are labelled **measured** (run here) or **read** (from
the code, not run). Every count is the worker's own measurement: no review replayed it, and the scratch scripts and
their outputs are not in the tree.

## 1. In short

- **The defect:** on a box with sign-in off, the Accounts screen's Add account door is narrowed, so a tap does
  nothing, by design. But the door was drawn like the live buttons beside it (only its ink a shade lighter), its reason
  sat a line of text away, and the reason offered `ccrc auth on` to copy, a verb the CLI never had. The insecure-origin
  reason offered a bare `ccrc expose`, which exits 2. So a person tapped a button that looked live, saw nothing happen,
  and the one command offered could only print usage.
- **Fixed, red first** (§4): the two reasons say what is true for both kinds of box and offer only real commands that
  change nothing on their own; a narrowed door stands down in the design system's disabled look; a tap or Enter on it
  brings its reason into view, marks it for a moment and announces it once; the copy control confirms once, not once
  per press. A new guard reads the CLI's own table and fails on any command the console offers that the CLI does not
  have.
- **Not a browser fault.** The first brief read the report as a Safari defect; a real WebKit walk found nothing (§7),
  and the reporter then saw the same in Chrome.
- **No third defect** (§6): on an armed box a signed-in session is always sent the connect block; nothing in the
  narrowing depends on the browser.

## 2. The report, as received

1. "a colleague is reporting that the add account button is not working - safari". Nothing else at first.
2. The reporter's screenshot, at desk width (relayed by the coordinator): the Accounts screen with Add account in the
   header and, beneath the heading, the door's reason "Turn on sign-in for this PWA first (ccrc auth on). Without it the
   server can't tell you from a session.", the command line `ccrc auth on` with its copy button reading Copied, and three
   Copied toasts stacked at the foot. One account, no pool.
3. The reporter's second statement: the same happens in Chrome; a click on the button does nothing.

**Reading of the screenshot:** the door is narrowed for a dark gate (`doorNarrowing` answers `gate-dark` for an
accounts answer with no connect block) and ignores the tap on purpose. The defects are the look, the silence and the
command, not the refusal.

## 3. The cause

- **The command.** Read: `ccd/ccrc`'s dispatch (`case "$VERB" in`, at its end) has no `auth` verb, and `cmd_expose`
  refuses an empty subcommand (`expose: missing subcommand (duckdns|byo|ip|status)`, exit 2). The accounts spec
  (2026-10-18, §5 and §12.6) promised `ccrc auth on`; no verb was ever built, and nothing checked the console's words
  against the CLI.
- **The look.** Read: the narrowed door took `--ink-secondary` (fleet.css's comment chose it so the word "must still
  read") and kept the ghost button's border, hover ground and press, because it is `aria-disabled` rather than
  `disabled`, so the Button's `enabled:` and `disabled:` variants still drew it as enabled.
- **The silence.** Read: `AddAccountDoor`'s tap returned early when narrowed and did nothing else.
- **The toasts.** Read: `CopyCommand` toasted Copied on every resolved write.

## 4. The fixes and their measurements

### 4.1 The words (`pwa/src/fleet/accountWords.ts`, `DOOR_NARROWED`)

Each narrowing has a sentence (at most two lines at 390 px), an optional "more" behind a disclosure, and a copy line.

| Narrowing | Sentence | Behind the disclosure | Copy line |
|---|---|---|---|
| gate dark | "Sign-in is off, so accounts can't be added here;" then the CLI's account verb's add subcommand, named, "works in the fleet host's shell." | **How to turn sign-in on:** first `ccrc passwd` on this console's server (changes nothing on its own); a box reached from other devices then `ccrc expose duckdns`, `byo` or `ip`, and the steps it prints; a box used only at localhost turns it on by hand as the README's "The session gate" says, restarts, and is opened at localhost | `ccrc passwd` |
| insecure origin | "Adding accounts needs https or localhost: on this plain-HTTP origin your session could be read on the way." | **How to fix it:** `ccrc expose duckdns`, `byo` or `ip` on this console's server (`ccrc expose status` shows what is set now); or an origin set to localhost, as the README section says, restarted and opened at localhost | `ccrc expose status` |

The copy field is labelled "Command to run on this console's server" (`DOOR_COMMAND_LABEL`), since on a two-box fleet
that is not the fleet host the trouble card's commands name. The local hand route is one constant, `LOCAL_ARMING`, so a
verb can replace it later without touching the sentences around it.

**Each fact checked against the tree (read):**

| Fact | Where |
|---|---|
| no `auth` verb; `passwd` and `expose` are verbs | `ccd/ccrc`'s dispatch |
| `expose` needs `duckdns`, `byo`, `ip` or `status`; `status` only prints | `cmd_expose`, `_exp_status` |
| `expose` writes `CCRC_AUTH=on`, the origin and (but for `ip`) the rp id, prints its root steps and the restart line, and says DEGRADED if no passphrase is set | `cmd_expose` |
| a passphrase on its own changes nothing; the flag without one locks the console; order is passphrase, then the flag, then a restart | README, "The session gate" |
| the account gate accepts a plain-HTTP loopback origin and refuses only the insecure class | `server/src/accounts/gate.ts` (`accountOriginClass`) |
| the CLI's account verb runs with no sign-in check, on the fleet host | `cmd_account` reads no gate state; README, "Adding accounts" |

The coordinator's draft sentence sent every box to `ccrc expose`; the amendment (a box used only at localhost) is what
the words follow. Nothing in the draft was found wrong beyond that.

**Measured heights** (the sentence, and the whole reason with its closed disclosure and copy line), in WebKit and
Chrome alike, both narrowings:

| Skin | 360 px | 390 px |
|---|---|---|
| Refined | 2 lines, 36 px (box 188 px) | 2 lines, 36 px (box 188 px) |
| Instrument | 2 lines, 33 px (box 185 px) | 2 lines, 33 px (box 185 px) |

The first wording measured three lines at 360 and 390 in the browser leg and was shortened.

### 4.2 The guard (`pwa/test/offered-commands.test.ts`)

It reads `ccd/ccrc`: the verbs of the dispatch, and for a verb whose body refuses an empty subcommand, the subcommands
it names (its `*_SUBS` list, or its first `case "$sub" in`). Every copy line (the door's and the trouble card's) and
every `ccrc …` the door's words name must be a verb there, with a required subcommand when it needs one.
**Measured red on main** (commit `504e7c808d`, before any fix): two failures, `"ccrc auth on": ccrc has no verb
"auth"` and `"ccrc expose": ccrc expose needs one of duckdns, byo, ip, status, and got ""`. Green after.

### 4.3 The door stands down, and answers a tap

- **Look** (`pwa/src/fleet/fleet.css`): narrowed, the door takes `--ink-disabled` and, at ≥900, the `--edge-subtle`
  border, with no hover ground and no press: the ghost button's own `disabled:` stand-down. It stays focusable and
  `aria-disabled`, its reason named by `aria-describedby`. The census (`pwa/design/audit.mjs`) now lists the rule as
  an inactive control, WCAG 1.4.3's exemption, as `.send-btn:disabled` is; the reason keeps the secondary ink, which
  is measured. `node design/contrast-check.mjs`: ALL 12276 PASS. That file was claimed by another worker, who approved
  the exact two-hunk diff before it was applied.
- **Response** (`ConnectSheet.tsx`, `AccountsScreen.tsx`): a tap or Enter on the narrowed door bumps a counter;
  `DoorReason` scrolls itself into view (`block: 'nearest'`), marks itself for 1.6 s (a bar at its start edge in the
  attention colour, no ground, no motion under reduced motion) and puts its sentence in a polite live region of its
  own, one node per tap, so each tap is announced once and a re-render announces nothing.
- **Copy** (`TroubleCard.tsx`): Copied is toasted once per copy field; later presses copy again and toast nothing. A
  ref, not the state, so two presses before the first write resolves cannot both toast.

**Tests.** jsdom: `connect-sheet.test.tsx` (a tap and Enter, phone and desk: scrolled, marked, announced once, the
mark clears, a re-render adds no announcement, no sheet opens, the copy line and its label) and
`accounts-trouble.test.tsx` (three presses: one toast). Browser leg: `connect-sheet.browser.test.ts`, all sixteen
cells: the narrowed door's computed ink equals `--ink-disabled` and not the live ink, at ≥900 its border equals
`--edge-subtle` and hovering leaves a transparent ground, its sentence is at most two lines on a phone, and a real
click brings the marked reason into view and opens nothing.

**Mutants, each measured red** (applied one at a time to the file, the guarding test run, the file restored):

| Mutant | Guard | Result |
|---|---|---|
| the narrowed tap not wired | jsdom door case; browser leg (4 of 4 Refined phosphor cells) | killed, killed |
| no scroll into view | jsdom door case | killed |
| no mark | jsdom door case | killed |
| one announcement node for every tap (no key) | jsdom door case | killed |
| no announcement | jsdom door case | killed |
| a toast on every press | `accounts-trouble` | killed |
| the copy line back to `ccrc auth on` | `offered-commands` | killed |
| the insecure copy line back to bare `ccrc expose` | `offered-commands` | killed |
| the narrowed ink back to secondary | browser leg (4 of 4) | killed |
| a hover ground on the narrowed door | browser leg (the two desk cells) | killed |

## 5. The spec

The accounts spec (2026-10-18) is corrected in the same change: §5's narrowed-door sentences and §12.6's two rows,
with a line saying what changed and why.

## 6. Can the narrowing differ by browser? (read)

No. `doorNarrowing` reads only whether an accounts answer landed and its `connect` block, and the store's one writer of
that block is the `/api/accounts` answer (`landAccounts`, `pwa/src/stores/fleet.ts`). The server adds the block only
when its own session verdict for that request is `session` (`server/src/server.ts`, the `/api/accounts` handler;
`sessionVerdict`, `server/src/auth/gate.ts`). On an armed box the gate has already refused any non-exempt request
without a live session before the handler runs, so a request that reaches it is a signed-in one and gets the block.
Nothing in either step reads the browser. The one window read: a passphrase change landing between the gate's check and
the handler's (the generation moves), where that single answer would carry no block and the door would read sign-in off
until the next read, which the gate then refuses to the login screen. That is not browser-specific and not this
report, so it is noted here rather than raised as a third defect.

## 7. The Safari investigation (the first brief)

Before the screenshot, the path was walked in a real WebKit. Playwright's WebKit 2359 (Safari 27.2 user agent) was
started on the fleet box without installing anything system-wide: its missing libraries and Mesa's software EGL were
unpacked from the distribution's packages into the session's temp directory and loaded through a wrapper script. Over
the production build, at 390 x 844 and 1280 x 800, both skins, WebKit and Chrome read the same at every step: the door
drawn and uncovered at its centre (`elementFromPoint`), the sheet opening, the provider, name and method frames,
Confirm it's you calling the passkey prompt inside the tap's user activation, the paste path, and Mint's Copy link and
Open. The same held posing as an iPhone (vaul's iOS branch), with the app's service worker in control, and on the
passphrase arm; each narrowed door's reason read the same in both engines. The two differences found were the test
browser's: Playwright's Linux WebKit has no WebAuthn, and its routing cannot see requests a service worker passes on.
The production build targets Safari 16.4 (Vite 8's default), every chunk parses at ES2023, and every newer API is
feature-tested. None of it bears on the defect above.

## 8. Unmeasured

- A real Safari, or any real device, on a real box: the reporter's own screen after this change.
- A screen reader's actual announcement of the live region (jsdom shows one node per tap; no assistive technology ran).
- The local hand route itself (the README's steps) was read, not run; no box's sign-in was turned on or off.
- The full pwa jsdom suite and every browser file in parts are run before the wave-done and reported there.

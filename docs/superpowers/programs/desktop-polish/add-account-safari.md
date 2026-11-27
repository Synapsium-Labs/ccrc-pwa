# Wave 180: a refused Add account door that looked live

Task note for desktop-polish wave 180, a reported defect, with its first review's fix round. Claims are labelled
**measured** (run here) or **read** (from the code, not run). Every count is the worker's own measurement unless it says
the review's; the scratch scripts and their outputs are not in the tree.

## 1. In short

- **The defect:** on a box with sign-in off, the Accounts screen's Add account door is narrowed, so a tap does
  nothing, by design. But the door was drawn like the live buttons beside it (only its ink a shade lighter), its reason
  sat a line of text away, and the reason offered `ccrc auth on` to copy, a verb the CLI did not have. The
  insecure-origin reason offered a bare `ccrc expose`, which exits 2. So a person tapped a button that looked live, saw
  nothing happen, and the one command offered could only print usage.
- **Fixed, red first** (§4): each reason says what is true on the box that sees it and offers a copy line that exists,
  changes nothing on its own and says something true there, or none; a narrowed door stands down in the design
  system's disabled look, under a press and under forced colours too; a tap or Enter on it brings its reason into view,
  marks it for a moment and says it once, as it read at the tap; the copy control confirms once, not once per press. A
  guard in the server suite reads the CLI's own dispatch and fails on any `ccrc <word>` the console shows that is
  neither a verb there nor listed prose.
- **Not a browser fault.** The first brief read the report as a Safari defect; a real WebKit walk found nothing (§7),
  and the reporter then saw the same in Chrome.
- **No third defect** (§6): on an armed box a signed-in session is always sent the connect block; nothing in the
  narrowing depends on the browser.
- **One deviation:** D-9106, `door-stood-down` (§4.4).

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

Each narrowing has a sentence (at most two lines at 390 px), an optional "more" behind a disclosure, and a copy line
or none.

| Narrowing | Sentence | Behind the disclosure | Copy line |
|---|---|---|---|
| gate dark | "Sign-in is off, so accounts can't be added here;" then the CLI's account verb's add subcommand, named, "works in the fleet host's shell." | **How to turn sign-in on:** first `ccrc passwd` on this console's server (changes nothing on its own); a box reached from other devices with https served by the box itself then `ccrc expose duckdns`, `byo` or `ip`, and the steps it prints; a box behind the operator's own https proxy sets `CCRC_AUTH=on` with `CCRC_RP_ID` and `CCRC_ORIGIN` in `~/.ccrc/ccrc.env` and restarts; a box used only at localhost through `LOCAL_ARMING` | `ccrc passwd` |
| insecure origin | "Adding accounts needs https or localhost: on this plain-HTTP origin your session could be read on the way." | **How to fix it:** the origin was set by hand, as `CCRC_ORIGIN` in `~/.ccrc/ccrc.env` (the expose verb only ever writes an https one); behind one's own https proxy, set it there to that https address and `CCRC_RP_ID` to its domain, then restart; for https served by the box itself, first take `CCRC_AUTH`, `CCRC_RP_ID` and `CCRC_ORIGIN` out of that file (the expose verb refuses while they are set), then `ccrc expose duckdns`, `byo` or `ip`; used only on the box itself, through `LOCAL_ARMING` | `grep -E '^CCRC_(ORIGIN\|RP_ID\|AUTH)=' ~/.ccrc/ccrc.env` (`ORIGIN_READ`) |
| fleet update needed, waiting, offline | the sentence alone | none | none |

The copy field is labelled "Command to run on this console's server" (`DOOR_COMMAND_LABEL`), since on a two-box fleet
that is not the fleet host the trouble card's commands name. **The localhost hand route is written once**, as
`LOCAL_ARMING` ("set sign-in up for localhost by hand, as the README's "The session gate" says, then restart the
server"), and both reasons say it through that constant, so the coming verb (wave 181) replaces it in one edit. The
insecure-origin reason names no future verb.

**The insecure-origin copy line** (fix round 1, review F5). The first round offered `ccrc expose status`, which is
untrue on the one box that sees this reason. Read: an armed box's origin is `CCRC_ORIGIN` from `exposure.env`, else
from `ccrc.env`, since the unit reads `exposure.env` second and the later file wins for a key both set
(`deploy/ccrc.service`; corrected in desktop-polish wave 181, review run 3901 A8, which this note first had backwards),
else the default `http://localhost:<port>` (`server/src/config.ts`); `ccrc expose` writes only an
`https://` origin (both arms of `cmd_expose`); the default is loopback, which the account gate accepts. So a plain-HTTP
origin there was set in `ccrc.env` (or the unit's own environment), where `ccrc expose status` prints "not configured"
and the other expose forms refuse first while that file sets any of the three keys. No `ccrc` command shows that origin
(`ccrc settings` does not list it), so the copy line is a read of the file's three keys: it changes nothing, and on that
box it shows the plain-HTTP origin to change.

**Each fact checked against the tree (read):**

| Fact | Where |
|---|---|
| no `auth` verb; `passwd` and `expose` are verbs | `ccd/ccrc`'s dispatch |
| `expose` needs `duckdns`, `byo`, `ip` or `status`; `status` only prints, and reads only `exposure.env` | `cmd_expose`, `_exp_status` |
| `expose` refuses while `ccrc.env` sets `CCRC_ORIGIN`, `CCRC_RP_ID` or `CCRC_AUTH`, and writes only an `https://` origin | `cmd_expose` |
| `expose` writes `CCRC_AUTH=on`, the origin and (but for `ip`) the rp id, prints its root steps and the restart line, and says DEGRADED if no passphrase is set | `cmd_expose` |
| a passphrase on its own changes nothing; the flag without one locks the console; order is passphrase, then the flag, then a restart; the `ccrc.env` hand edit is for a box behind a TLS-terminating proxy of one's own | README, "The session gate" |
| the server's origin is `CCRC_ORIGIN`, else `http://localhost:<port>` | `server/src/config.ts` |
| the account gate accepts a plain-HTTP loopback origin and refuses only the insecure class | `server/src/accounts/gate.ts` (`accountOriginClass`) |
| the CLI's account verb runs with no sign-in check, on the fleet host | `cmd_account` reads no gate state; README, "Adding accounts" |

**Measured heights** (the sentence, and the whole reason with its closed disclosure and copy line), first round, in
WebKit and Chrome alike, both narrowings:

| Skin | 360 px | 390 px |
|---|---|---|
| Refined | 2 lines, 36 px (box 188 px) | 2 lines, 36 px (box 188 px) |
| Instrument | 2 lines, 33 px (box 185 px) | 2 lines, 33 px (box 185 px) |

The first wording measured three lines at 360 and 390 in the browser leg and was shortened. Fix round 1 changed no
sentence, only the disclosures and one copy line; the browser leg's two-line check on a phone still passes.

### 4.2 The guard (`server/test/single-definition/offered-commands.test.ts`)

**Where and why there** (fix round 1, the coordinator's ruling on review F4 and the judge's `rules-mixed`). The first
round's guard sat in `pwa/test` and needed a reach entry for `ccd/ccrc` in `.github/ci/reach.mjs`, a rules file. It now
lives beside the single-definition scans, which already read the console's source and the CLI: the server suite has no
foreign list, and every single-definition area file runs on every fast pull request, so the reach line came back out
and this change edits no rules file.

**What it reads.** `ccd/ccrc`'s dispatch, and for a verb whose body refuses an empty subcommand, the subcommands it
names (its `*_SUBS` list, or its first `case "$sub" in`). And every `ccrc <word>` in what a person sees in `pwa/src`:
string literals, template text and JSX text, parsed with the repo's one TypeScript parser (`server/test/scan/parse.ts`);
comments and test files are left out.

**The rule.** After the product's name a word is a verb of the dispatch (with a subcommand when it needs one), or listed
prose, in one of two lists, as ruled (36889):

1. `PLAIN_WORDS`, ordinary words nobody would read as a command ("ccrc has not read…"), one shared reason: 41 words
   (40 measured at this head, "tells" from a sentence `main` added since).
2. `COMMAND_LIKE`, words that could be read as a command after the product's name (`access`, `close`, `connect`,
   `managed`, `moves`, `next`, `on`, `operator`, `push`, `release`, `restarts`, `runs`, `sends`, `sets`, `stops`), each
   excused only inside the sentences it stands in today. All its sites were read, 23 prose hits at 22 sites over 18
   listed entries, 17 sentences and one exact literal, the `operator` entry (corrected in desktop-polish wave 181:
   review run 3901 A7 measured these at this wave's head, where this note first said 25, counting two comments the scan
   leaves out, and review run 3934 A10 the 17 and the one): each is prose and offers nothing to run, so none was a
   finding.

A listed word excuses prose, never a command: inside backticks, in a `<code>`, `<kbd>`, `<pre>` or `<samp>`, or in a
command position (a `fix`, a `command`, or anything a name with "command" in it holds, such as `fixCommands`), only a
verb counts. After a verb that needs a subcommand, a plain word is accepted in prose only ("(ccrc expose writes all
three)", `settingsText.ts`). A new word is red until it is put in one list or the other.

**Measured before building** (the ruling asked for it): over all text in `pwa/src`, 252 hits, 57 naming a verb, 74
distinct ordinary words; over what a person sees, 163 hits, 38 naming a verb, 125 sites over 54 words. That was more
than fifteen exceptions, so the list went to the coordinator first.

**Its width, stated** (in the test's header too, and in the spec): verbs are checked everywhere in that text;
subcommands only where the CLI's text lets the scan read them, so a verb that runs with no subcommand accepts any next
word and a dispatch label counts as a verb even when its arm only refuses; a command assembled from pieces at run time,
split across JSX elements, written in a comment or in CSS, or with a capitalised product name is not seen; the dispatch
is read, not the usage text.

**Measured red on main's words:** with `main`'s `accountWords.ts` in place, "each one the console shows" fails on
`ccrc auth` in the sentence and as the copy line, and on the bare `ccrc expose` twice. The self-test now uses an
invented verb (`frobnicate-zz`), so wave 181's real verb cannot turn it red (review F14).

### 4.3 The door stands down, and answers a tap

- **Look** (`pwa/src/fleet/fleet.css`): narrowed, the door takes `--ink-disabled` and, at ≥900, the `--edge-subtle`
  border, with no hover ground and no press: the ghost button's own `disabled:` stand-down. It stays focusable and
  `aria-disabled`. The census (`pwa/design/audit.mjs`) lists the rule as an inactive control, WCAG 1.4.3's exemption,
  as `.send-btn:disabled` is; the reason keeps the secondary ink, which is measured.
- **No press** (fix round 1, review F3). The primitives' press is `active:scale-[0.97]`, which Tailwind 4 writes as the
  individual `scale` property, and an `aria-disabled` button still matches `:enabled`; the first round's
  `transform: none` did not reach it. Now `scale: none`. Measured: the first browser run with `scale: none` beside
  `transform: none` was red in all 16 cells (`0.97`): the build's minifier folded the two into `transform: scale(1)` and
  dropped `scale` (read in the built stylesheet). With `scale` alone it holds; nothing on the door sets a `transform`.
- **Forced colours** (fix round 1, review F7). Forced colours replaced the disabled ink and edge with the live button's
  colours and dropped the mark's inset box-shadow. Now the door is in `GrayText` there and the mark is a 2 px inset
  outline, the channel `.sess-line--active` already uses. Measured in the browser leg by emulating forced colours.
- **The disclosure shows that it opens** (fix round 1, review F8): its summary draws the settings folds' chevron (the
  same rules, `.settings-release-fold`, with the door's selector added, so no rule shape is copied). The compromise
  sheet's own disclosure (`.acct-compromise > summary`) has the same gap and is left as it was, as ruled.
- **The answer belongs to the tap, not to the render** (fix round 1, review F1, F2, F6, F17). The first round's counter
  outlived the reason's component and its live region showed the live text, so the offline reason's age, ticking every
  minute, was announced again, and a remount replayed the scroll, the mark and the announcement with no tap. Now:
  - a tap or Enter hands `DoorReason` an answer (`DoorAnswer`): the tap's number, never reused, and the sentence as it
    read at the tap. A later render never rewrites it;
  - the screen drops the answer, and the disclosure's open state, when the narrowing changes or ends, during the render
    (`AccountsScreen.tsx`), so a tap on one reason is never said under the next;
  - a mount answers only a tap that arrives after it, so a remount (the 900 px crossing, or a narrowing that comes back
    after the door opened) brings no scroll, no mark and no filled live region;
  - the door's one live region holds the snapshot for the mark's 1.6 s and then empties, so the sentence is not left in
    the page twice;
  - **the door names no `aria-describedby`.** With it, a reader that focused the door heard the sentence as its
    description and then again from the live region on Enter. Keeping the description and saying nothing on a keyboard
    press would still read it twice to a reader on a mouse or a touch screen, so the description goes and the press is
    where the sentence is said, once, in every modality. The reason stays beneath the door as text;
  - the disclosure's open state is the screen's, so an open disclosure survives the width crossing.
- **Copy** (`TroubleCard.tsx`): Copied is toasted once per copy field; later presses copy again and toast nothing. The
  door's copy field is keyed by its command (fix round 1, review F9), so a Copied state never carries to the next
  narrowing's command.

**Tests.** jsdom, `pwa/test/connect-sheet.test.tsx`:

- "one door per width, and it narrows in place with each reason": each narrowing's copy line, or none, as a literal;
  no `aria-describedby`;
- "a tap or Enter on a narrowed door brings its reason into view, marks it and announces it once (wave 180)": both
  widths; exactly one live region in the reason; said in one live place; empties with the mark;
- "the answer is the tap's snapshot: offline, a later render and three minutes of age never rewrite or repeat it (fix
  round 1)";
- "the answer is dropped when the narrowing changes: a tap on one reason is never said under the next (fix round 1)";
- "a remount with no tap answers nothing: a tap while waiting, the door opening, then the link dropping (fix round 1)";
- "a remount with no tap answers nothing: the 900 px crossing keeps an open disclosure open and replays nothing (fix
  round 1)";
- "the door's copy field is keyed by its command: Copied does not carry to the next narrowing's command (fix round 1,
  F9)".

`accounts-trouble.test.tsx` keeps its three-presses case. Browser leg, `connect-sheet.browser.test.ts`, all 16 door
cells (both skins, both themes, 360, 390, 1280 and 1920): the narrowed door's computed ink equals `--ink-disabled` and
not the live ink; at ≥900 its border equals `--edge-subtle` and hovering leaves a transparent ground; held down under
the mouse it is `:active` with `scale` and `transform` both `none` and a transparent ground; under emulated forced
colours its colour is `GrayText`, not `ButtonText`, and the mark is a solid 2 px outline; the summary's chevron is drawn;
the door names no description; its sentence is at most two lines on a phone; and a real click brings the marked reason
into view and opens nothing.

**Mutants, each measured red** (applied one at a time, the guarding file run, the file restored; by case name):

| Mutant | Killed by |
|---|---|
| the narrowed tap not wired; no scroll; no mark; one node for every tap; no announcement (first round) | the tap case (jsdom); the browser leg for the tap |
| a toast on every press (first round) | "three presses say Copied once" |
| the live region shows the live text, not the snapshot | the snapshot case |
| a mount answers the screen's latest answer (replay) | the crossing case |
| the screen keeps the answer across a narrowing change | the narrowing-change case (it survived at first; that case was added) |
| the live region never empties | the tap case, the snapshot case |
| a second, always-filled live node (the review's R2) | the tap case, the snapshot case, both remount cases |
| `aria-describedby` back on the desk door / the phone row | the tap case (it survived at first on desk: the check was added at both widths) / the tap case and the narrowings case |
| the disclosure uncontrolled | the crossing case |
| the copy field not keyed by its command | the keyed-copy case |
| the insecure copy line changed; a copy line where there is none | the narrowings case |
| `scale: none` removed | browser leg, 16 of 16 cells |
| the forced-colours door colour removed; the forced-colours outline removed | browser leg, 16 of 16 cells each |
| the chevron's selector removed | browser leg, 16 of 16 cells |
| the narrowed ink back to secondary (re-killed this round) | browser leg, 16 of 16 cells |
| a hover ground on the narrowed door (re-killed this round) | browser leg, the desk cells |
| guard: the scan of the console skipped (the review's G1) | the positive-control case and the stale case (a first attempt was not a skip and is not counted) |
| guard: any subcommand accepted | the reader case, the listed-word case |
| guard: a listed word excuses a command; list 2 by word only; backticks not read; a backtick count not carried across a `${…}`; a plain word after a verb excused in a command | the listed-word case |
| guard: command positions not read | the listed-word case, the positive control |
| guard: `<code>` not read | the positive control |
| guard: a word in no list | "each one the console shows" |
| guard: a stale list-2 sentence | the stale case |

### 4.4 D-9106: the door stood down (`door-stood-down`)

The narrowed door is drawn in the disabled ink, and the contrast census exempts that rule as an inactive control. That
reverses the recorded choice of D-7740, that this door never takes the disabled ink. Reason: a live-looking door that
ignored a tap was the reported fault, and the reason beside it, which a person must read, stays in the measured
secondary ink. Ruled by the coordinator in fix round 1 and issued as D-9106, which the programme's plan defines
(`docs/superpowers/plans/2026-10-22-desktop-polish.md`, "Deviations found"); this note cites it.

## 5. The spec

The accounts spec (2026-10-18) is corrected in the same change: §5's narrowed-door sentences and §12.6's two rows,
with a line saying what changed and why. Fix round 1 brought them to the words above, and the guard sentence there now
says what the guard checks and what it does not see, no more.

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
feature-tested. None of it bears on the defect above. Fix round 1 was not re-walked in WebKit.

## 8. Evidence and how this landed

- **Pushes.** The brief said one push for the build; there were two: the build round, then the reach fix for a CI
  census on the draft. Fix round 1 is one push.
- **On this head merged with `main`** (`main` at `ad35cf5538`, the merge probe `git merge-tree` exit 0, so `main` was
  not absorbed; the merge commit was built in scratch and never pushed):
  - the server's single-definition area files and the reach tests: 49 files, 1662 cases, green. The first run there
    was red, which is the guard working: a sentence `main` had added ("ccrc tells the session to continue by itself")
    used a word in neither list, so "tells" went into `PLAIN_WORDS`, and the stale check covers the second list only
    (a stale plain word excuses only an ordinary word);
  - the whole pwa jsdom suite, in four shards: 627 files, 19,362 cases passed, 2 skipped;
  - every browser file, all 123, in ten parts, one process at a time, in Chrome 1243: green. Five files were re-run
    alone, each green: `linear-items`, `vaul-motion`, `role-fact` and `ask-inline` after their workers were killed by
    the test slice's memory cap (other sessions' runs were on the box too), and `reader-frame`, whose "the worst case
    renders inside the watchdog" timed out to its fallback under that load. The connect-sheet file's 20 cells are
    among them.
- **On this head:** the pwa typecheck, exit 0. The server's tests-inclusive typecheck project was killed by the test
  slice's memory cap (exit 137, 6 GB) and was not measured whole; the new scan typechecks clean under that project's
  settings with `src/`. The stylesheet censuses and the touched files: 13 files, 910 cases; `node
  design/contrast-check.mjs`: ALL 12276 PASS.
- **Not this round, as ruled:** the permanent start padding of every reason and no repaint on a tap while marked
  (F10, to the spacing wave); the hand route and Safari's Secure cookie on `http://localhost` (F13), and the older plans
  and CLI outputs that still name the old commands (F15), to wave 181; the reach census's missing stale-entry check
  (F20), to the ledger.
- **Peers.** `pwa/design/audit.mjs` is held by another worker, who approved the exact hunks before each was applied
  (the first round's two, and this round's grounding entry for the reused list rule, review F18).

## 9. Unmeasured

- A real Safari, or any real device, on a real box: the reporter's own screen after this change.
- A screen reader's actual announcement (jsdom and Chrome show one live region and one node per tap; no assistive
  technology ran), and a touch press (the browser leg holds a mouse down).
- Real Windows forced colours: the browser leg emulates them in Chromium.
- The arming routes themselves (the README's steps, the proxy edit, the expose verb) were read, not run; no box's
  sign-in was turned on or off.

# Settings, sectioned: five sections by kind, a plain-language line for every setting, and a rollback list of three (design)

**Status:** approved by the operator 2026-10-18. Rev 2: the operator ruled every decision in §15 as recommended and
let the three visual calls stand as mocked (§15.2). Rev 1 applied two reviews of rev 0 (the log is §16).
It answers the operator's ask of 2026-10-18 (§1.1) and is the W3 Settings item the two-skins programme already names
(audit U9, two-skins spec §5.3 "Settings"). The decisions only the operator could make are in §15, each now ruled.
Nothing in it is built yet.
**Date:** 2026-10-18 · **Base:** `origin/main` `537b6a41` (#626, the command palette; rev 0 measured `6702ce2e`, and
nothing between them touches a Settings file). Read-only; nothing edited.
**Branch:** chosen by the coordinator at plan time, from `origin/main` as measured then.
**Inputs.**
- A measured inventory of today's Settings screen: all 28 controls and readouts with route, scope, help text, cadence
  and risk.
- 16 full-page captures of a fixture build (Refined and Instrument × dark and light × 360, 390, 1280 and 1920) with
  3 nodes and 22 releases.
- An alignment survey of every planned change that touches Settings, re-checked against the open PRs at `537b6a41`.
- Mockups of nine Settings frames (Refined and Instrument, 390 and 1280, dark and light), on which the operator ruled
  §15's decisions and the visual calls.

The inventory, the captures, the survey and the mockups are held outside this tree. This document restates every fact it relies on
and cites the code for each, by file and by function, constant or selector. Line numbers are hints, written `≈`.
**Related:**
- `2026-10-15-ccrc-two-skins-design.md`: §5.1 (one data model), §5.3 (Settings: "sectioned (W3)"), §6, §7 (the
  picker, D-5096), §9 (the verification matrix) and §10 (waves).
- `docs/superpowers/plans/2026-10-15-ccrc-skins-foundations.md`: Ftask 11 `PageScaffold`/`Section` (D-5102),
  Ftask 12b `SkinFieldset`, and Ftask 6 danger variants (D-5099).
- `docs/superpowers/plans/2026-10-18-ccrc-skins-w2-shells.md`: S2b `routes.ts`, the door table (`go-settings`,
  `switch-layout`, `switch-theme`), S4b (Refined's frame, sidebar `clamp(320px, 24vw, 400px)`), S5 (D-5471: on a
  Refined phone the Bell lives in Settings), S9/S11 (Instrument's list column and tab bar) and S17 (parity).
- `2026-09-20-centralised-update-management-design.md` §13. That design created this screen and its release list.
- `2026-10-05-stall-watch-settings-design.md` §13. Stall watch is its section. Its "no device word" rule (P6) stands.
- `2026-10-12-path-identity-design.md` §5.7. The temp root collector is its section. Its one-resume-door rule
  stands.
- `2026-10-07-box-token-lifecycle-design.html` (rev 5): the box token card. Its G3 ("no 401 window") governs §5.5.
- The Accounts redesign, written beside this one. It removes `AuthSection` from Accounts and this spec receives it.
  D-5508 here is the one definition of that move; the Accounts spec cites it (§11.1).

**Deviation numbers.** This spec defines D-5503 to D-5508, once each, in §14. D-5509 and D-5510 were reserved for this
work and are unused.

## In short

- **Five sections, by the kind of thing they hold:**
  - **Updates**, for the whole fleet.
  - **Appearance**, for this device.
  - **Notifications**, split into "this browser" and "whole fleet".
  - **Automation**, for the whole fleet: stall watch, the temp root collector and the cleanup pause.
  - **Security**: the sign-in gate, your passkeys and session, recent account changes, and the box token.

  Each section has a one-line purpose. Each setting has a plain-language line saying what it actually does and when you
  would change it. Every one of those lines is taken from the measured effect in §2 and the code it cites, never
  guessed (D-5503).
- **One section per page, at every width and in both skins**, each with its own deep link `/settings/<section>`
  (D-5504):
  - **Refined, phone, and a narrow desktop pane:** a sections list that opens a section page.
  - **Refined, a pane of 760 px or more:** a sticky left section nav beside the reading column.
  - **Instrument:** master-detail. The section index fills the list column, the section fills the detail pane, and
    the inspector carries a release's full notes or the box token's full detail.
- **The release list shows at most three of each kind** (D-5505), and never the whole catalogue, in any fleet state:
  - **Newer:** at most three releases newer than the newest node, on the fleet's channel, then one count line.
  - **Running:** the release the fleet runs, or, for a mixed fleet, one "Update all to vX" line.
  - **Roll back to:** at most three releases older than the oldest node, on the fleet's channel (Stable releases for
    a Stable fleet), newest first. Withdrawn (yanked) releases count inside the three, and say they are withdrawn.
  - **Older ones** are named by count, with the CLI command that still moves to them.
  - **An unmeasured or all-macOS fleet** shows the newest three and a count, never the list.
  - The node row's own Roll back to its measured previous version stays.
- **When each release ran here** is not recorded anywhere today. D-5506 adds a small server record, written by the 60 s
  inventory sweep, of when a release was first and last seen running on a managed node. Rows then say "Ran here 2 Oct
  to 9 Oct". Until it lands, each row says only when the release came out.
- **One control per kind** (§6). The actions that can hurt (Roll back, Ack, Revoke) are isolated, wear the danger
  variant and ask first, naming what will change (D-5507). Rotate now and Pause all cleanup are safe and stay one tap:
  re-measured, neither can hurt. Every server action states its result and its failure in words, under the control
  that asked.
- **Security comes home** (D-5508). Sign-in, passkeys and sign-out move from Accounts into Settings › Security, beside
  the box token and the sign-in gate, so Accounts holds only lanes.
- **The "what's new" doors land on Updates.** The update banner's "See what's new" and the release push open
  `/settings/updates`, with the waiting release's notes open.
- **Waves** (§13):
  - **R1a, now:** the release window. Only `updates.tsx` and its tests.
  - **R1b, now:** the danger confirms. **R1c, now:** the label renames and result lines.
  - **R2, after #402/#627 and Ftasks 11 and 12b:** the sections and routes, in Refined, with the Security move.
  - **R3, after W2 S9 to S11 and the shared list-column seam:** Instrument's master-detail.
  - **R4, after #397 and #597:** the "ran here" record.

## 1. The ask, the rulings and the goals

### 1.1 The operator's words (2026-10-18)

> 1. Settings page redesign:
>  - tabs/sections for different types of settings and more explanation about what they actually do, and designed in
>    really nice UX way - now is terrible
>  - only show the latest 3 versions for rollback, showing all of them is ridiculous

### 1.2 Standing rulings this design obeys

1. **Improve what exists first** (operator, 2026-10-15). Measure today's behaviour and fix its real defects. Never
   reinvent what works: §2.3 lists what is kept.
2. **Every width, both skins, both modes:** phone 360, 390 and 438; laptop 900, 1024, 1280 and 1440 to 1470; wide
   1920. Dark and light, Refined and Instrument, with no horizontal page scroll and a 44 px tap floor on coarse
   pointers.
3. **Appearance sits below Updates** (operator, 2026-10-15). It was moved for its length, and §3's order keeps it
   there.
4. **The skins' identity core and one data model** (two-skins §3, §5.1). Section bodies, words, hooks and sheets are
   shared. Only the navigation frame is skin-specific. A skin owns no colour.
5. **Stall watch names no device** (stall-watch-settings §2, test P6). Its scope label reads "Whole fleet", never a
   device word.
6. **One resume door for the cleanup pause** (`CollectLaneSection.tsx` header comment; test "offers Pause only"). Resume
   stays on Runs, and Settings links to it (§5.4).
7. **"ccrc install, update and rollback beyond Settings" stay CLI** (the audit's SAFETY list). The release window
   narrows the PWA's offer. It adds no rollback path.
8. **Rolling back to a withdrawn release is permitted on purpose** (`dispatch.ts` `moveRefusal`: "yanked PERMITTED:
   rolling back to a yanked release is the point", D-3395). The window keeps that capability (§7.3).
9. **Public repo:** no hosts, IPs, account ids, emails or private paths in committed bytes. Fixtures and screenshots use
   `lane-a`, `project-a`, and nodes labelled `fleet` and `server`.

### 1.3 Goals

1. Opening Settings shows five sections. Each has a name, a one-line purpose and a live one-line status, so the
   operator can see what is there, and what needs them, before opening anything.
2. Every setting and action says what it does and when you would change it, in sentence case, in the words of §5.
3. A setting that changes the whole fleet says "Whole fleet", and one that changes only this device or browser says
   so.
4. The release list never shows more than three releases in any group, in any fleet state. The rollback group is the
   three most recent earlier releases on the fleet's channel, newest first. It says what each release was and when it
   ran here, and it handles fewer than three.
5. No action that can hurt fires on one tap. Each one names what will happen before it does, including what it will
   not undo.
6. The Settings index is at most two taps from the fleet in both skins. A section is one tap more on an Instrument
   phone (More, Settings, section), and two in Refined. §15 C1 asks W2's door table to name the section routes.
7. At 1280 and 1920 the reading column holds a readable line (≤ 760 Refined, ≤ 960 Instrument), and the page height
   per section is a few screens, not 6,300 px.

### 1.4 Non-goals

- **Accounts:** adding, minting, re-authenticating or removing lanes. That is the Accounts redesign. This spec only
  receives `AuthSection` from it and hosts its "Recent account changes" card (§5.5).
- **New settings.** No setting is added, except the Layout picker, which is Ftask 12b's and only hosted here. Nothing
  that is CLI-only today (`ccrc.env` knobs, the sign-in gate itself) gains a control.
- **Fleet operations** (audit F11: coordination pause, caps, account moves, maintenance) and **Box health** (audit
  F12). Automation reserves their slot (§3) and builds none of them.
- **Server retention of the releases table.** The window is a PWA slice. The wire still carries every row (§15
  residue).
- **The macOS auto-install gate defect** (§2.2 item 12). Recorded for its own fix.
- **A friendly name for a passkey.** The stored label is the raw user-agent claim (`deviceLabel(req)`, cut to 120
  characters). Parsing it into "Safari on iPhone" is its own item (residue).

## 2. What exists today (measured at `6702ce2e`, unchanged at `537b6a41`)

### 2.1 Structure

`SettingsScreen` (`pwa/src/screens/SettingsScreen.tsx` ≈:512) is one column. It holds a header (back, then the
`<h1>`), the unarmed-exposure banner, and then six sections in a fixed order: Updates, Appearance, Box token,
Notifications, Stall watch, Temp root collector. A test pins that order (`settings-screen.test.tsx` ≈:2334).
- It has no tabs, anchors, sub-navigation or max-width.
- `.settings-screen` pads by `--sp-2` (8 px). Section titles are `--fs-sm` semibold, which is smaller than the radio
  labels under them.
- `app.tsx` ≈:72 routes it by `/^\/settings\/?$/`, so there are no sub-routes.
- Two doors open it: the update banner's primary "See what's new" (`pwa/src/fleet/UpdateBanner.tsx` ≈:156,
  `navigate('/settings')`) and the release push (`server/src/update/notify.ts` ≈:104, `RELEASE_PUSH_URL = '/settings'`).

Height in the fixture (px):

| width | total | Updates | Appearance | Box token | Notifications | Stall watch | Collector |
|---|---|---|---|---|---|---|---|
| 360 | 6965 | 4074 | 915 | 289 | 240 | 1074 | 240 |
| 390 | 6636 | 3800 | 897 | 289 | 240 | 1038 | 240 |
| 1280 | 6305 | 3674 | 897 | 289 | 240 | 876 | 222 |
| 1920 | 6251 | 3674 | 897 | 289 | 240 | 822 | 222 |

Instrument and Refined measure the same, because no skin layout exists for Settings yet. Nothing overflows sideways at
any width.

### 2.2 The defects this design fixes

The inventory lists 26. These are the ones that shape the design:
1. **Length.** One 6,250 to 6,970 px column. The release list is more than half of it, and it grows without bound. The
   coord `releases` table is only ever upserted, and rows outside the poll window are marked `yanked=1`, never deleted
   (`applyReleaseListing`). `GET /api/updates` sends every row (`server/src/update/routes.ts` ≈:586), and
   `ReleaseList` (`pwa/src/screens/updates.tsx` ≈:277) renders every row, each with its full `<pre>` notes and a
   button. The public repo has 288 tags. The fixture's 22 rows drew 20 Roll back buttons, about 3,300 px at 390.
   Any cap must hold in every fleet state, because `releaseDirection` (`updates.tsx` ≈:140) answers `install` for
   every row when a managed node is unmeasured or unversioned, when there is no managed node, and for every tag above
   the slowest node of a mixed fleet.
2. **A withdrawn release is not marked as one.** "Yanked" means its publisher deleted it or turned it back into a draft
   on GitHub (`store.ts` `applyReleaseListing`), not that the build is bad. Only a grey `yanked` chip says so, and
   nothing says what it means for a rollback.
3. **Kinds are mixed and unlabelled.** Per-device preferences (theme, push), fleet-wide stored settings (channel,
   auto-install, release notifications, stall level, quiet time, collector), one-shot fleet actions and readouts sit
   together. "Release notifications" sits beside "Push notifications for this browser", but it is a fleet-wide intent
   (`POST /api/updates/intent {scope:'*', notify}`) that changes pushes for every subscribed device.
4. **Three actions that can hurt fire on one tap, in the harmless ghost style of Check now** (rev 1 re-measured the
   inventory's five):
   - Ack (`POST /api/updates/ack`). `ackNode` (`store.ts` ≈:7956–7963) clears the node's request and deletes every
     `node_release_refusals` row for the node, so with auto-install on the server may dispatch the same bad tag on its
     next pass.
   - Revoke passkey (on Accounts). Revoking the last one puts the box back on the passphrase alone.
   - Roll back, whose sheet wears the same tone as Install and does not say that a failed rollback is not restored.

   Rotate now and Pause all cleanup were on the inventory's list and are not on this one. A rotation opens no 401
   window and keeps the old key until the fleet box confirms the new one (box-token design G3). Pause deletes nothing
   and is the emergency brake (`CollectLaneSection`'s "doubt fails toward stopping deletion"). Both stay one tap (§6.3).
5. **Security is split.** The box token and the unarmed banner are on Settings. Passkeys and Sign out are on Accounts
   (`AccountsScreen.tsx` ≈:420 mounts `AuthSection`), where the Accounts inventory's A4–A6 defects sit.
6. **Missing explanations:**
   - Auto-install never says what it does.
   - "Box token" is never defined, and its lines are server vocabulary.
   - Release badges are unexplained.
   - Stall watch shows the "does" sentence for the current level only, so levels are chosen blind, and nothing says
     the levels are cumulative.
   - "Temp root", "licensed observations" and "legacy file" are never explained, and the collector's legend is "Choice".
7. **Labels mislead in one place.** The auto-install option "Stable releases only" (`AUTO_LABELS.stable`) does not mean
   "install stable releases whatever the channel". `autoPermits` (`shared/update-move.ts` ≈:49) returns true for
   `stable` only while the node's channel is Stable. On Dev it installs nothing.
8. **Inconsistent wording and controls.**
   - Case is mixed: "on my channel / stable only / off" (`NOTIFY_LABELS`) beside "Stable releases only / Off".
   - Three chooser idioms are used: radio lists, swatch cards and a native `<select>`.
   - Readouts mix mono and sans.
9. **Width.** At 1280 and 1920 nothing has a max-width. The quiet-time select runs about 1,500 px, and help lines run
   to about 180 characters. The phone gutter is 8 px, not 16.
10. **No Layout picker.** The skin is reachable only through storage (`ccrc-skin`).
11. **Pause's undo lives elsewhere.** Resume is on Runs. While paused the card renders `COLLECT_PAUSE_TEXT.paused`, but
    it never names where the pause is lifted.
12. **A lagging Mac disables auto-install fleet-wide** (`autoGateMissing` and the route count darwin nodes, which the PWA
    never moves). This is a non-goal here (§1.4) and goes to §15's residue.
13. **The "what's new" doors land on a long page.** Both doors of §2.1 open `/settings` at its top, above Channel and
    Auto-install, so the notes of the waiting release are a scroll away.

### 2.3 What works and is kept

- **The server's row is what is shown.** A radio is checked from the poll, never from the tap (pinned at ≈:349).
- **One move sheet** (`UpdateMoveSheet`) for every Install, Update and Roll back. It lists the nodes in dispatch order,
  says refusals in place, and stops at the first refusal (≈:945).
- **The server-decided confirm.** A 409 carries the effect, a `QuickConfirm` shows it, and the confirmed re-POST
  follows. Stall watch and the collector use it, and D-5507 extends the confirm idiom to the three actions in §2.2
  item 4.
- **One Ack** (`pwa/src/fleet/updateAck.ts`): the gate `canAck` and the tap `sendAck` are shared by the node row and the
  home screen's `HaltBanner`, so the two cannot disagree. D-5507 keeps that: the confirm lives beside them (§6.3).
- **Honest states.** Loading, not-configured, failed and stale are kept apart. Nothing says "up to date". Unreadable
  is not off.
- **The words already written.** These are copied, not rewritten: the box token's hold, state and answer sentences
  (`BOX_TOKEN_HOLD_TEXT`, `boxTokenStateText`, `rotateAnswerText`), `STALL_LEVEL_TEXT[*].does`, `COLLECT_STATE_TEXT`,
  the move sheet's lines, and `AuthSection`'s "last used …" clause and its `ccrc passwd` sign-out sentence.
- **The swatches are real palettes** (`data-theme` on each swatch).
- **The literal `NotificationBell`** in Notifications (D-5471, pinned at ≈:1820).
- **One `useUpdatesView` poll per Settings mount**, shared by Updates, Security and Notifications (W2 S2a's rule).
- **The halt line's rule** (Wave 19 UI-4): a `HaltedLine` shows only where it gates a control on screen, and it is
  that control's `aria-describedby` target.
- **TEXT IS TEXT.** Release notes, labels and details reach the DOM as text children only (the `updates.tsx`
  source-scan pin).

## 3. Information architecture (D-5503)

### 3.1 The five sections, in order

Each group is derived from the inventory's rows. The "Holds" column lists inventory row numbers (§2 of the inventory)
or, for passkeys, sign-out and account changes, the Accounts screen and the Accounts spec.

| # | Section (route) | Purpose line (shown under the name) | Scope | Holds |
|---|---|---|---|---|
| 1 | **Updates** `/settings/updates` | Which ccrc release the fleet runs, and how new releases reach it. | Whole fleet | the halt line (8); Check now and the catalogue line (6, 7); the release window (9–12, §7); the nodes (13–16); Channel and Auto-install (4, 5) |
| 2 | **Appearance** `/settings/appearance` | How ccrc looks on this device. Other devices keep their own choice. | This device | Layout (Ftask 12b) above Theme (17); the fonts licence line |
| 3 | **Notifications** `/settings/notifications` | What this browser is told, and which releases the server announces to everyone. | Two cards: "This browser" and "Whole fleet" | the Bell (20); Release notifications (21) |
| 4 | **Automation** `/settings/automation` | What the server does to the fleet by itself: checking on quiet workers, and clearing what dead sessions leave behind. | Whole fleet | Stall watch (22–25); Temp root collector (26, 27); Cleanup pause (28) |
| 5 | **Security** `/settings/security` | Who can open this console, what changed on your accounts, and the key the fleet box uses to call this server. | Cards labelled "This box", "You" and "This browser" | the sign-in gate (2); Your sign-in: passkeys; This session: Sign out (both from Accounts, D-5508); Recent account changes (the Accounts spec's audit); Box token (18, 19) |

**The order** keeps today's (Updates, then Appearance, then the rest) and puts Security last. Security is set once and
visited rarely, but its status line is on the index, so a broken state is never buried. An open sign-in gate is also a
banner on every Settings page (§5.5).

**Rejected groups**, and why:
- **"Danger zone."** A separate danger section would part every dangerous action from the thing it acts on. Roll back
  belongs beside the versions, and Revoke beside the passkey it removes. Each action is isolated *inside* its card or
  row instead (§6.3).
- **"Accounts and lanes."** Settings holds no account setting today. Pools and lanes stay on `/accounts` (the Accounts
  redesign). Security only shows the recent changes, with a link there.
- **"Sessions and coordination."** That is Automation's content under a vaguer name. Automation also reserves the slot
  for the audit's F11 fleet operations (§1.4).
- **"About."** BuildLine renders on the fleet screen (`FleetScreen.tsx` ≈:541), not here. Its placement belongs to
  S16. The Updates status line already names the running release.

### 3.2 The index row

Every section is reached through one index row, in the phone index and in both desktop navs. The row holds the
section's icon, its name, its purpose line (Refined phone index only; desktop navs show the name and status), and a
**status line**.
- **Icons.** `Icon` with `refresh-cw`, `palette`, `bell`, `bot` and `shield`, plus `chevron-right` for the phone row.
  `bell` is on `main`. The other five are vendored in R2 through `ui/design/make-icons.mjs` (its "add a name here,
  re-run, and commit both files" rule). #626, which held that file, merged at `537b6a41`.
- **The status line** is measured, built from reads the Settings frame already makes (§4.4), and never optimistic:

| Section | Status line (examples) | Tone |
|---|---|---|
| Updates | **when a release is waiting:** `v0.4.22 available · fleet runs v0.4.21` · otherwise `v0.4.21 · Stable · Auto-install off` · or `Nodes run v0.4.20 to v0.4.21` | attention (word and `↑` glyph) when a release is waiting, by `pendingTag`, the predicate the update banner and BuildLine use, so the three never disagree; amber when a node is halted, a catalogue read failed, or a node is unreachable |
| Appearance | `Refined · Phosphor & Ink` · `Follows the system` | never |
| Notifications | `Pushes on in this browser · Releases: the fleet's channel` | never (push unsupported reads "Pushes not available in this browser") |
| Automation | `Stall watch: Check silent workers · Collector: Live` · `Cleanup paused` | amber: cleanup paused, or the collector is safety-stopped. Until the first coord frame lands, the pause part is a skeleton, never "runs normally". |
| Security | `Sign-in on · 2 passkeys · Box token healthy, next rotation in 3 d` · `Sign-in locked: too many failed attempts, try again shortly` · `Sign-in off: reachable from this machine only` | red: the gate is off and reachable from other machines (`unarmedExposure`); amber: locked out, or the box token held or failed. "2 passkeys" is `AuthStatus.passkeysEnrolled`, a count the status read already carries. |

A read that has not landed shows a skeleton, and a failed read says "could not be read". Neither is folded into a
status.

### 3.3 What each section page holds

A section page is a stack of `Section` cards (Ftask 11). Each card has:
- an **eyebrow naming its scope** ("Whole fleet", "This device", "This browser", "This box", "You");
- a title;
- a purpose line;
- its settings, each with the explanation of §5;
- its actions, with any danger action isolated (§6.3);
- its readouts, folded behind "Details" when they are more than three lines.

**The card head, by skin** (ruled, §15.2). The facts are the same in both skins, and only the drawing differs:
- **Refined:** the scope eyebrow sits above the title, in mono 11 px caps in tertiary ink. That is the existing eyebrow
  idiom, so it needs no new token.
- **Instrument:** one head line. The title is in primary ink at the left, and the scope is a small mono tag at the
  right. Instrument's section titles are already mono caps, and two stacked mono-caps lines blur together.

Cards per section:
- **Updates:** Fleet version, which holds the halt line, the status, Check now and the release window (§7). Then Nodes.
  Then Update policy (Channel, Auto-install).
- **Appearance:** one card, holding Layout, Theme and the fonts line.
- **Notifications:** This browser. Then Whole fleet: release announcements.
- **Automation:** Stall watch. Then Temp root collector. Then Cleanup pause.
- **Security:** Sign-in gate (This box). Then Your sign-in (You: passkeys). Then This session (This browser: Sign out).
  Then Recent account changes (This box). Then Box token (This box).

**Updates puts the versions first and the policy last.** Today's order inside Updates is Channel, Auto-install, Check
now, then the releases. That order makes the operator scroll past set-once policy every time they open the page to
act. The halt line goes to the top (audit U9), where today it sits above the list. The operator ruled this order (§15 D7).

## 4. Navigation, by skin and width (D-5504)

### 4.1 One section per page, everywhere

Each section is its own route at every width, in both skins, rather than one long page with anchors and a scroll-spy:
- It ends the 6,300 px page.
- It gives every section a deep link that means the same thing on a phone and on a desktop.
- It needs no scroll-position logic, which the skin switch may reset anyway (two-skins §5.4).
- It lets a narrow desktop window, which keeps its own skin (two-skins §5.3), fall back to that skin's phone layout
  with no second model.

**Routes.** `/settings` is the index, and `/settings/<id>` is a section, for `id` in `updates`, `appearance`,
`notifications`, `automation` and `security`. W2's `pwa/src/lib/routes.ts` (S2b) gains the five as entries with
`top: false`, so the palette derives "Go to Settings › Updates" and the others (S-14). `app.tsx`'s regex becomes a
route-table match, after #402 (reconciled as #627). `document.title` reads `Updates · Settings · ccrc`.

**What bare `/settings` and an unknown id show:**

| Where | `/settings` | `/settings/<unknown>` |
|---|---|---|
| Refined phone, or a Refined pane under 760 px (§4.2) | the sections index | the index, with the line "That section does not exist." above it |
| Refined, pane ≥ 760 | Updates in the column, Updates current in the nav, the URL unchanged | Updates, with "That section does not exist." above its `<h2>` |
| Instrument ≥ 900 | the index in the list column, Updates in the detail, the URL unchanged | the same, with "That section does not exist." above Updates |
| Instrument phone | the index as a page | the index, with the line above it |

Nothing 404s.

**The doors that land here.** The update banner's "See what's new" (`UpdateBanner.tsx` ≈:156) and the release push
(`RELEASE_PUSH_URL`, `server/src/update/notify.ts` ≈:104) both move to `/settings/updates`, in R2. There, the waiting
release's notes (the Newer group's first row, `pendingTag`'s tag) render open and the rest stay collapsed (§7.2), so
"what's new" is the first thing the operator reads at every width.

**Headings.** The `<h1>` is "Settings" on every Settings route. That keeps the pin "titles itself Settings, as the one
level-1 heading" (≈:85). The section's name is the page's `<h2>`, each card title is an `<h3>`, and a card's sub-group
(such as Passkeys) is an `<h4>`.

### 4.2 Refined

W2 S4b fixes Refined's desktop frame at a sidebar of `clamp(320px, 24vw, 400px)`, 400 at ≥ 1600. The Settings pane is
what is left. Settings measures the pane, not the viewport (a container query on the pane), because the sidebar's
width varies:

| Pane width (viewport) | Layout |
|---|---|
| phone (viewport < 900) | **`/settings` is the sections list:** `PageScaffold` (Back to the fleet, `❯`, "Settings"), the gate banner if open, then the five index rows (§3.2) as full-width rows of at least 64 px, each a link with a chevron. **`/settings/<id>`** is the section page: Back returns to `/settings`, and the section's `<h2>` leads the body at `--fs-page`. Gutter 16 (`--gutter`), so the 8 px gutter retires. |
| pane < 760 (viewport 900 to about 1080: at 900 the pane is 580, at 1024 it is 704) | **The phone pattern, inside the pane.** The index is the pane's page, and a section page has Back to the index. A 200 px nav beside a column at these widths would leave a column of about 330 to 450 px, which is too narrow for a release row (tag, channel, date, words and a button) or the swatch grid. Release rows and key/value lines wrap by the same container query. |
| pane ≥ 760 (viewport about 1080 to 1599) | **A sticky left section nav inside the pane**, beside the fleet sidebar the shell keeps. The nav is 200 px wide, sticky under the 56 px scaffold header, and its rows are 40 px with the tint and 2 px `--accent` rail on the current section (D-5101) and `aria-current="page"`. Beside it sits the reading column at `min(100%, 760px)`: at 1280 the pane is 960, so the column is about 688 after the nav, a 24 gap and 24 gutters. |
| wide (viewport ≥ 1600) | The same, with the nav at 220. The column caps at 760. The rest of the pane stays empty, by the reading-width rule. Refined's 320 inspector rail is a session-screen element and is not mounted here. |

**Why a sections list, not sticky tabs, on a Refined phone.**
- At 360 px, five tabs carrying the names "Notifications" and "Automation" do not fit in one row. They would scroll
  sideways and hide sections.
- Two of the sections are long (Updates and Automation), so tabs would leave the operator scrolling under a bar that
  eats 44 px.
- The list carries what tabs cannot: a purpose line and a live status for every section on one screen. That status is
  what tells the operator which section needs them.
- It is what the two-skins spec already says ("subpages on a phone").
- It keeps the parity rule: the header's Settings door, then the section, is two taps.

**Why a vertical nav, not a horizontal sticky sub-nav, on a wide Refined pane.** Two-skins §5.3 says "a sticky sub-nav on
desktop". This design reads that as a vertical one:
- Five names fit as a column at any height.
- The status lines need the width a horizontal bar would not have.
- A pane of 760 or more carries 200 px of nav beside a column of at least about 490, and at 1280 a 688 px column,
  which is a readable line. Below 760 the phone pattern applies instead.

The nav rows show the name and the status line (one line, ellipsised). The purpose line is in each row's `title`, and
also leads the section page.

### 4.3 Instrument

| Width | Layout |
|---|---|
| laptop (900–1599) | **Master-detail.** On a Settings route, the 340 list column (W2 S9 `ListColumn`) holds the **section index**: the five index rows at the list's density (`--row-h`: 32 on a fine pointer, 44 on coarse), with the selected-row idiom. Under them, in `--ink-tertiary`, sits one line: "Changes here apply to the whole fleet unless a card says otherwise." The **detail pane** holds the section page at `min(100%, --page-max 960)`, as key/value panels. At 900 the detail is about 560, so release rows and key/value lines wrap by the same container query as Refined's. The **inspector** is an `I` overlay at this width (two-skins §5.3), and opens only where it has something to hold (§4.5). |
| wide (≥ 1600) | List column 420, detail, and the permanent 320 inspector. On a section with nothing to inspect, the inspector reads "Nothing selected" in tertiary ink and is never blank. |
| phone (< 900) | Under the top bar and above the five-tab bar. `More → Settings` opens `/settings`, which is **the index as a page** (the list column collapsed). That is two taps. A section is a page whose Back returns to the index, so a section is three taps from the fleet (goal 6). Its last row clears `--phone-nav-h` (W2 S11's check). The inspector content of §4.5 opens as a sheet from an "Inspect" row action. |

**The list-column seam is shared W3 shell work, not this spec's.** `ListColumn` holds the fleet list only (W2 S9 step
"holds the fleet list (today's, until S10)"). Settings needs it to show the section index, and the Accounts redesign
needs it to show its lane table. So one shared W3 shell task (named here **W3-LC**, owned by the coordinator) adds:
- a per-route list table: `ListColumn` renders the list registered for the current route id, and the fleet list
  otherwise;
- a per-route inspector slot with the same shape.

Settings registers `SettingsIndex`, the same shared component that Refined's nav and phone index render. Accounts
registers its own. R3 (§13) depends on W3-LC; it does not build it.

### 4.4 The Settings frame: reads made once, above the shell

The list column is a sibling grid item rendered by the shell (W2 S9), not a child of the detail pane where a section
mounts. A skin part may not call the network (the W2 S4a guard). So a frame inside the detail cannot feed the list
column through props or context. Instead:
- **`SettingsDataProvider`** mounts in `app.tsx` *above the shell* whenever the route matches `/settings*`, the same
  place `app.tsx` already holds app-wide data (its `useFleetStore` connect and reads, ≈:39–56). It stays mounted while
  the operator moves between sections and unmounts when they leave Settings, as today.
- It owns the reads, once per mount (table below), and publishes one `SettingsView` by context. The shell sits inside
  it, so both the list-column part (`SettingsIndex`, through W3-LC) and the detail read the same context. Neither
  imports a network hook. The skin parts read only the context.
- A test pins it: one `useUpdatesView` poll serves both the list-column index and the detail, across a walk of all
  five sections, in Instrument at 1280.

| Read | Source | Cadence | Fed to |
|---|---|---|---|
| `useUpdatesView` | `GET /api/updates`, the one poll (S-10) | today's | Updates, the index status, Notifications |
| the stall watch view | `useStallWatchView` | 60 s poll | Automation, the index status |
| the collector view | `useCollectLaneView` | today's | Automation, the index status |
| the cleanup pause | `useFleetStore`'s coord frame (`childReclaimMarker`), a WebSocket frame and not a poll | as frames arrive | Automation's Cleanup pause card, the index status (a skeleton until the first frame) |
| the auth status | `readAuthStatus()` (`GET /api/auth/status`), once per mount | once | Security, the index status, the gate banner |
| the passkey list | `api.passkeys()`, once per mount, only when the status read says the gate is armed (`mode` not `off`), as `AuthSection` does today | once | Security › Your sign-in |
| recent account changes | the Accounts spec's `GET /api/accounts/audit`, first page, once per mount (added by the Accounts plan with the route; a 404 draws nothing) | once | Security › Recent account changes |

Today's single page makes all of these but the last at once, so the provider adds no request beyond today's.
Moving between sections refetches nothing.

### 4.5 The inspector (Instrument), where useful

| Section | Selecting… | The inspector shows |
|---|---|---|
| Updates | a release row | the tag, the channel, the release date, "Ran here" (D-5506), the full notes in a `<pre>` (TEXT IS TEXT), refusals by node, and the node list that a move to it would touch, in dispatch order |
| Updates | a node row | the node's measured lines today (version, request, state, reachability, finished), `previousVersion`, its floor (`highestVersion`), and its refusals |
| Security | the Box token card | every key/value line of today's card (`readBoxTokenView`), which the card itself folds behind "Details" (§5.5) |
| others | — | "Nothing selected" |

In Refined, and on an Instrument phone, the same content is the card's "Details" disclosure or the release row's
"Notes". It is the same component, placed differently.

### 4.6 Doors and commands kept

- The Layout fieldset carries `doorMark('switch-layout')` and the Theme fieldset `doorMark('switch-theme')`, on
  `/settings/appearance` (S-2). Today W2's door table names "Settings' Skin fieldset" and "Settings' theme fieldset"
  with no route, because Settings has one. §15 C1 asks for the table to name `/settings/appearance` as their route, so
  S17(b) (every command has a visible phone door) evaluates them there.
- `go-settings` goes to `/settings`. The five Go-to entries come from `routes.ts`. S17(a) walks only `top: true`
  routes, so the `top: false` section routes are not bound by it.
- The literal `<NotificationBell/>` is on `/settings/notifications` (D-5471).
- The update banner's "See what's new" and the release push open `/settings/updates` (§4.1).

## 5. Every setting: what it does, and when you would change it

These are the words the screen shows. Each "What it does" line restates a measured effect from the inventory and cites
the code that has it. "When" is shown in `--ink-secondary` under the control's label. "What it does" is the option's
note, or the card's purpose line. Labels are sentence case throughout. Where a label changes, the old one is given in
§11.2.

### 5.1 Updates (Whole fleet)

**Card: Fleet version**

| Item | Kind | What it does (shown) | When you would use it |
|---|---|---|---|
| Halt line (when shown) | readout, amber, first on the page | today's `updateAllHaltedText(haltingNodes(nodes))` sentence, plus one added line: "Clear it with Ack on that node, under Nodes, after you have fixed what made it fail." Today's two `HaltedLine`s (in `ReleaseList` and `NodeList`) become this one line, under the UI-4 rule: it shows only while a control it gates is on screen, and it stays the `aria-describedby` target of every Install and Update button it gates. | — |
| Status line | readout | "The fleet runs v0.4.21" (every managed node), or "Nodes run v0.4.20 to v0.4.21", plus "macOS nodes are updated on the Mac itself" when one differs (`releaseRunningText`'s facts). It names an unmeasured node: "server has not reported its version yet." | — |
| Catalogue line | readout | "Release list checked 4 min ago", amber when the last check failed (`catalogueLine`). Explanation: "The server checks GitHub for new releases every 30 minutes." (`CATALOGUE_POLL_INTERVAL_MS`) | — |
| **Check now** | safe action | "Asks GitHub for new releases now, instead of waiting for the next check." (`POST /api/updates/refresh`). A 429 is said in place: "Checked too recently. Try again in *n* s." | You know a release just shipped. |
| Release window | §7 | — | — |

**Card: Nodes.** These are today's node rows, unchanged in their facts (`NodeList`). The words gain one explanation
line at the top of the card: "Each machine ccrc runs on. A node's Update and Roll back move that node only."
- **Update** (move, ghost): "Moves this node to *tag*, the newest on its channel." It opens the move sheet.
- **Roll back** (danger-ghost with a confirm, D-5507): "Moves this node back to *previousVersion*, the release it ran
  before its last update." This is the node's measured previous version, offered whether or not that version is in
  the release window (§7.4).
- **Ack** (danger-ghost with a confirm, D-5507). Its note depends on which `canAck` branch is true
  (`fleet/updateAck.ts` ≈:17):
  - a failed or reverted move: "Clears this node's failed move, so it returns to idle."
  - a standing request only: "Withdraws the request standing on this node (*kind* to *tag*)."
  - a refusal by this node: "Makes this node forget the releases it refused (*tags*)."

  Every branch adds: "Use it after you have fixed what made the move fail." `ackNode` clears the request and every
  refusal the node holds (`store.ts` ≈:7956–7963).
- The macOS row: "Not updated from here. Update this Mac with ccrc on the Mac itself." Today's `MACOS_UNMANAGED_TEXT`
  is "macOS: not centrally managed", so this is §11.2's rename.

**Card: Update policy**

| Setting | Options (label: note) | What it does | When |
|---|---|---|---|
| **Channel** | **Stable**: "Releases promoted only after they have baked." · **Dev**: "Every merge, minutes after it lands." | "Sets which release the fleet treats as newest. That drives the update banner, each node's `→` arrow, the release window (§7) and, with auto-install on, what installs." (`POST /api/updates/intent {scope:'*', channel}`, read by the resolver) | Once, at set-up. Choose Dev only if you want fixes as they merge and accept less tested builds. |
| **Auto-install** | **Off**: "Nothing installs until you press Install or Update." · **On the Stable channel only**: "Installs each new stable release by itself. While the channel is Dev, nothing installs by itself." · **On any channel**: "Installs each new release on the chosen channel by itself, Dev included." | "When on, the server installs a new release as soon as the release check sees it. It moves each node in turn (the fleet box, then the server), and a node whose new build fails its health check returns to the build it had. It never reinstalls a release a node was rolled back from: it waits for a newer one." (`autoPermits`, `dispatch.ts` ≈:139; the order is `planMove`'s; the floor rule is `moveRefusal`'s `not-newer`) | Once. Leave it Off if you want to choose when each release lands. |
| Auto-install gate note (when shown) | readout | "Auto-install needs every node to run a ccrc with the update gate. Not yet: *labels*." (today's `AUTO_GATE_NOTE`, in a sentence) | Update the named nodes first. |

### 5.2 Appearance (This device)

| Setting | Options | What it does | When |
|---|---|---|---|
| **Layout** (Ftask 12b, D-5096) | Ftask 12b's `SkinFieldset`, with its own option labels and notes. This spec hosts it and writes none of its copy. | "Changes how ccrc is laid out on this device only. Your other devices keep their own choice." (`localStorage['ccrc-skin']`) | When the default layout does not suit how you use this device. |
| **Theme** | **Follow the system**, then the eight dark and four light palettes as a **preview grid** of swatch cards, each the real palette (`data-theme`) with its name and today's note. | "Changes ccrc's colours on this device only." (`localStorage['ccrc-theme']`) | Any time. "Follow the system" switches between a dark and a light palette with the device's own setting. |
| Fonts line | readout and link | "Geist and Geist Mono, SIL Open Font License 1.1", linking `/licenses/Geist-OFL.txt` (D-5095) | — |

**The preview grid's size.** 13 cards (Follow the system plus 12 palettes):
- **Phone (column about 328 at 360):** 3 columns of compact swatches, about 104 × 64 plus a one-line name, with the
  note in the card's `title` and under the grid for the checked card only. That is 5 rows, about 560 px, against
  today's 897 to 915 px of radio rows.
- **Reading column 688 (Refined 1280) to 960 (Instrument):** U9's 160 × 100 cards with name and note, 4 to 5 per row,
  so 3 or 4 rows, about 560 to 680 px.

It stays one radio group: `role="radiogroup"`, arrow keys moving the choice, and the checked card wearing the selected
idiom plus a check glyph. Appearance is its own page now, so its length no longer pushes anything down.

### 5.3 Notifications

**Card: This browser** (scope "This browser")
- **Push notifications** is the literal `NotificationBell`, unchanged.
- **What it does:** "Lets this browser show ccrc's alerts, such as a session asking for you or a release being
  announced, even when ccrc is closed. Other browsers and devices are turned on separately." (`/api/push/subscribe`)
- **When:** on each device where you want to be told.

**Card: Release announcements** (scope "Whole fleet")

| Setting | Options | What it does | When |
|---|---|---|---|
| **Announce new releases** | **Every release on the fleet's channel** · **Stable releases only** · **None** | "Chooses which new releases the server pushes about, to every browser that has push turned on, not only this one. A push opens Settings › Updates." (`POST /api/updates/intent {scope:'*', notify}`; `RELEASE_PUSH_URL`) | If Dev-channel announcements are too many, choose Stable releases only. |

### 5.4 Automation (Whole fleet)

**Card: Stall watch.** The section's own design (stall-watch-settings §13) keeps its status block, its server-decided
confirm, its 48 h counts and its words. Three things change:
- **Purpose line:** "Notices workers that have gone quiet for too long, and, at the levels you allow, checks on them,
  tells their coordinator and you, or delivers waiting mail."
- **Level.** This keeps audit U9's plan, a stepped choice with one live explanation:
  - One lead line above the options: "Each level does everything the one above it does, plus:".
  - Each option carries a one-line note, the new part only. "Off": "Nothing." · "Log only": "Records quiet workers."
    · "Check silent workers": "Sends a check to each one." · "Alert coordinator and you": "Tells its coordinator, and
    you." · "Deliver mail to busy sessions": "Delivers mail that is waiting for them." · "Everything": "All of the
    above." The default ("Follow the fleet box's files") keeps its live "(they say: …)" clause, and its note reads
    "Uses the arming files set by hand on the fleet box, as before this setting existed." The plan checks each short
    note against `STALL_LEVEL_TEXT[level].does` and changes it if it reads differently.
  - The full `STALL_LEVEL_TEXT[level].does` sentence shows once, under the group, for the checked option, or for the
    focused one while the keyboard moves through them. That is U9's one live explanation.
  - It stays a radio group. Choosing a level still writes on choice, and anything that turns something on still asks
    (the 409 confirm).
- **Quiet time:** the 60-word paragraph becomes one line, "How long a worker may be silent before stall watch checks
  on it. Shorter means more check mail.", plus "Built-in: 2 h · Range: 30 min to 12 h" in tertiary ink. Lowering it
  still asks. The select is capped at 320 px.

No string names a device (P6).

**Card: Temp root collector**

| Item | What it does (shown) | When |
|---|---|---|
| Purpose line | "Each session gets its own temporary directory. When the session's workspace is gone, the directory is left behind. The collector finds these leftovers on the fleet box. Live lets it delete one, only after two audits, at least an idle period apart, have found it unused." (path-identity §5.7; `ws-collect`) | — |
| **Collector** (was "Choice") | **Off**: "Watches and reports what it would remove, and removes nothing." (the server's effective state is `shadowed`, `server/src/collectLane.ts` ≈:2027; `COLLECT_STATE_TEXT.shadowed`) · **Live**: "Removes a leftover temporary directory only after two idle audits have found it unused." Live asks first, naming the node and the caps (today's `QuickConfirm`). Off stays disabled while the fleet box's legacy file arms it, with today's line. | Turn it Live once its reports look right. Turn it Off if a removal surprised you. |
| Now and armed-by lines | today's `COLLECT_STATE_TEXT` and `COLLECT_ARMED_BY_TEXT`, with "licensed observations" glossed once in the purpose line ("two audits") | — |

**Card: Cleanup pause.** This card is moved out of the collector card, because it stops more than the collector.
- **Status:** "Cleanup runs normally." or "Cleanup is paused for the whole fleet", amber with the pause glyph, from the
  coord frame (today's render condition, `childReclaimMarker`). Before the first frame: a skeleton.
- **What it does:** "An emergency brake. Stops all of the fleet's automatic cleanup at once: removing finished child
  workspaces, expiring archived workspaces, the dead-coordinator lane, and the collector above. Nothing is deleted
  while paused; disk use grows until you resume." (`POST /api/coord/reclaim-pause {state:'on'}`)
- **Pause all cleanup** stays one tap, `ghost`, isolated at the foot of the card after a hairline. It is not a danger
  action: it deletes nothing, and it is offered even while the switch reads unmeasurable, because "doubt fails toward
  stopping deletion" (`CollectLaneSection`'s `PauseAllCleanup`). The same toggle on Runs stays one tap too.
- **While paused**, the card shows today's `COLLECT_PAUSE_TEXT.paused` and a link: "Resume it from the cleanup row on
  Runs." That link is the one resume door (§1.2 item 6), and the test "offers Pause only" is kept.
- **When:** cleanup is removing something it should not.

### 5.5 Security

`AuthSection` today makes its own `readAuthStatus()` and `api.passkeys()` calls, renders `<h2>` "Your sign-in" and
"This session" with an `<h3>` "Passkeys", and returns `null` when the gate is off or the status read fails. In R2 it is
**split into two card bodies**, `YourSignInCard` and `ThisSessionCard`. They take the provider's auth status and passkey
list as props, make no call of their own, and render under the card's `<h3>`, with Passkeys as an `<h4>`. This fixes
the Accounts inventory's A4–A6, the passkey-list defects that leave with it.

**What Security shows in each gate state:**

| `AuthStatus.mode`, and reach | Cards |
|---|---|
| `passphrase` | all five cards |
| `locked-out` | all five. The gate card reads "Sign-in is locked: too many failed attempts. It reopens by itself shortly." (the login rate limiter's window, `shared/api.ts` ≈:7350) |
| `off`, reachable from other machines (`unarmedExposure`) | the gate card in the danger tone, Recent account changes, and Box token. The gate card adds: "Passkeys and sign-out appear here once sign-in is on." |
| `off`, on loopback only (`unarmedExposure` false for a loopback host) | the same cards. The gate card reads "Sign-in is off. This console is reachable from this machine only." in neutral ink. |
| status unreadable | the gate card reads "Sign-in state could not be read." Your sign-in and This session are absent, with that reason in the gate card. Never "on". |

**Card: Sign-in gate** (scope "This box")
- **When sign-in is on:** one line, "Sign-in is on. Only someone with your passphrase or a passkey can open this
  console."
- **When it is off and exposed** (`unarmedExposure`): the card is the danger tone. The lead is "Anyone who can reach
  this page can control your fleet." Under it, today's remedy sentence: set `CCRC_AUTH=on`, `CCRC_RP_ID` and
  `CCRC_ORIGIN` in the server's `ccrc.env`, then restart.
- **A banner on every Settings page**, in that state only. The same lead appears as a compact banner, "Sign-in is off.
  Anyone who can reach this page can control your fleet. Fix it in Security", which links to `/settings/security`. It
  is red, with `role="alert"` once per mount. It replaces today's top-of-page paragraph, which named a route.
- **No control.** The gate is set on the server, by design (§1.4).

**Card: Your sign-in** (scope "You", from Accounts, D-5508)
- **Passkeys:** the list from the provider, one row each.
  - Each row shows the stored label as it is (the raw user-agent claim), ellipsised to one line, with the full label
    as its `title`. No parsing (§1.4).
  - Each row keeps today's words: "added 5 min ago", and ", last used three weeks ago" when the server has a use.
  - **Revoke** is danger-ghost, at the row's end (§6.3), and asks first: "Revoke the passkey *label*? It will not
    sign in again." When it is the last passkey, the confirm adds: "This is your last passkey. After it, only the
    passphrase signs in." Revoke also needs a recent passkey step-up once its guard exists (§15 D8, ruled).
- **Add a passkey on this device** stays primary. Its note: "Adds this device's passkey, so you can sign in here
  without the passphrase."
- The unreadable-store sentence is kept verbatim (D-153).

**Card: This session** (scope "This browser")
- **Sign out** stays ghost with no confirm (D-5099 #611): signing in again undoes it.
- Its note: "Signs this browser out. Other signed-in browsers stay signed in." Then today's sentence, kept: "To end
  every session at once, rotate the passphrase with `ccrc passwd` on the box."

**Card: Recent account changes** (scope "This box")
- The Accounts spec's §3.6 audit: the last 10 rows of `GET /api/accounts/audit`, newest first, each "*when* · *what*
  · *lane*", and a link "All account changes" to the Accounts screen's full record.
- **What it does:** "Every account added, signed in again, changed or removed, and from which session."
- **Gated:** the card ships with the Accounts plan, after R2, in the same PR as the audit route. A 404 from a server
  older than the PWA draws no card and no error. A failed read says "Account changes could not be read."

**Card: Box token** (scope "This box"), as a status card with Details (audit U9)
- **Definition (purpose line):** "The key that sessions and tools on the fleet box use to call this server, for mail
  and coordination. The server makes a new one every 7 days and hands it to the fleet box itself. The old key keeps
  working until the fleet box confirms the new one, so nothing restarts or drops." (`TOKEN_ROTATION_INTERVAL_MS`;
  box-token design rev 5, G3)
- **Summary line:** one sentence from the view.
  - "Healthy · rotated 2 days ago · next in 5 days" in `idle` with the fleet confirmed.
  - "Rotating: waiting for the fleet box to confirm. The old key still works." while handed out.
  - Amber for `held` or `behind`, red for `failed`, using today's state and hold sentences.
- **Details:** a disclosure holding today's key/value lines, unchanged in fact, in mono values beside sans keys. It is
  the inspector content in Instrument (§4.5).
- **Rotate now** is a safe action: `ghost`, one tap, isolated at the foot of the card after a hairline. Its note:
  "Starts a rotation now instead of waiting for the weekly one. Nothing restarts; the old key keeps working until the
  fleet box confirms." When: you think the key has leaked. Today's answers are kept as its result line, including
  "At most one Rotate now a minute".

## 6. Controls: one per kind

### 6.1 The kinds

| Kind | Control | Used for | Rule |
|---|---|---|---|
| Choose one of a few, with meaning | `@ccrc/ui` `RadioFieldset`: rows with a label and a note. Notes are in `--ink-secondary`, and the radio sits next to its label at every width (the `ThemeRow` lesson). | Layout, Channel, Auto-install, Announce new releases, Stall watch level, Collector | Every option carries a note. The checked state comes from the server or storage, never from the tap. A write in flight disables the group (today's pin ≈:1733). |
| Choose a look | the swatch preview grid (§5.2), with radio semantics | Theme | The swatches are real palettes. |
| Choose a value on a scale | native `<select>`, max 320 px. It becomes an `OptionRow` trigger once W1's Popover lands (audit B13) | Quiet time | The range and the built-in value are shown beside it. |
| Turn this browser on or off | the literal `NotificationBell` | Push | Never copied (pin ≈:1832). |
| Safe action | `Button variant="ghost"` (Add a passkey: `primary`) | Check now, Rotate now, Pause all cleanup, Add a passkey, Sign out | No confirm. Rotate now and Pause sit at the foot of their card after a hairline, because each is the card's one action. |
| Move | `Button variant="ghost"` (today's), which opens `UpdateMoveSheet` | Install, Update, "Update all to vX" | The sheet names the nodes. |
| Danger action | `Button variant="danger-ghost"`, which opens a confirm (§6.3) | Roll back (release and node), Ack, Revoke | §6.3 |
| Readout | sans key and mono value (`<dl>`); a sans sentence leads | every status line and Details | More than three lines fold behind "Details" (`<details>`). |

`MoveButton` (`updates.tsx` ≈:187) is today's single styling triple, `ghost` / `fit` / `.settings-move`. It splits by
intent: Install and Update keep `ghost`, and Roll back and Ack become `danger-ghost`. `@ccrc/ui` `Button` has
primary, danger, danger-ghost and ghost (no new variant). It is still one component, now with a `tone` prop, so no
fifth control can style itself apart. The `.settings-move` hook class stays for the censuses. Today's sizing rule is
scoped to `.btn-ghost.settings-move`, so a sibling rule `.btn-danger-ghost.settings-move` carries the same size, or the
danger buttons would drop out of it.

### 6.2 Layout of a setting row

The label goes on top, in `--fs-body` semibold, sentence case. The note follows in `--ink-secondary`, then the
control. Option notes sit under each option. The "When" line sits under the control in `--ink-tertiary`. The section
`<h2>` is at `--fs-page`, and card titles are at least the size of option labels, which fixes §2.2 item 8. Spacing
uses roles (`p-gutter`, `--pad-card`, `--row-h`), never `--sp-*` (S-13).

### 6.3 Danger, isolated and confirmed (D-5507)

- **Placement, in a card.** A card-level danger action sits at the foot of its card, after a hairline, and never beside
  a safe action of the same size.
- **Placement, in a row.** Each release row has its own Roll back, and a node row puts Update beside Roll back and Ack.
  Within a row the danger action sits at the row's end, after the safe action and separated from it by the row's action gap
  (a role token, never `--sp-*`), and is never the row's first control unless it is the only one. Install and Update stay ghost.
  The markup census pins it: in a `.settings-move` group, no `danger-ghost` precedes a `ghost`.
- **Confirms.** Each danger action opens a confirm before any request.
  - Rollbacks open `UpdateMoveSheet`, which gains a `tone` prop. Today its confirm is hard-coded `variant="primary"`
    (`UpdateMoveSheet.tsx` ≈:259). Under `tone="danger"` it is `danger`.
  - Ack opens `AckConfirm`, a new `QuickConfirm` wrapper that lives beside `canAck` and `sendAck` in
    `fleet/updateAck.ts`. The node row and `HaltBanner` both use it, so the one Ack stays one (§2.3).
  - Revoke opens `QuickConfirm` with `tone="danger"`.
- **What a confirm holds:**
  - a title that is the question;
  - one or two lines naming exactly what will change, for whom, and what will not be undone;
  - a confirm button in the `danger` variant, labelled with the verb ("Roll back 2 nodes", "Ack", "Withdraw the
    request", "Revoke");
  - Cancel, which is the default focus. `QuickConfirm` gains an opt-in `defaultFocus: 'confirm' | 'cancel'`, defaulting
    to today's behaviour, so its ten other users (Archive all, the swap, abandon, resume and session-action sheets,
    and others) do not change.

| Action | Confirm says |
|---|---|
| Roll back (release) | "Roll back the fleet to v0.4.20?" Under it, the nodes in dispatch order, then: "Each node installs v0.4.20 and runs its health check. If a node's health check fails, it stays on v0.4.20; it is not moved back." · "Auto-install will not return to v0.4.21. It waits for a newer release." (the floor, `highestVersion`, is never lowered) · when the target is withdrawn: "v0.4.20 was withdrawn by its publisher. A node may refuse it if it cannot fetch its checksums; the sheet then says so." · if the tag is unbundled for a verified node, today's blocked line |
| Roll back (node) | "Roll back *label* to *previousVersion*?" "Only this node moves. If its health check fails, it stays on *previousVersion*; it is not moved back. Auto-install will not return it to *current*." |
| Ack, failed or reverted | "Ack *label*'s failed move?" "It returns to idle and forgets every release it refused (*tags*). With auto-install on, the server may try *tag* again on its next check." Button: "Ack". |
| Ack, a standing request only | "Withdraw the request on *label*?" "The request to *kind* to *tag* is cleared, and nothing moves." Button: "Withdraw the request". |
| Ack, a refusal by this node | "Clear *label*'s refusals?" "It forgets that it refused *tags*. With auto-install on, the server may try *tag* again on its next check." Button: "Ack". |
| Revoke | §5.5's lines |

- **The server still decides.** A server-decided 409 confirm (stall watch, collector) still shows its own sheet. This
  confirm is the PWA's, and it never replaces a server's.
- **Not danger.** Sign out (D-5099), Rotate now (box-token G3: no 401 window, the old key accepted until confirmed),
  Pause all cleanup (deletes nothing; the emergency brake stays one tap, as on Runs), Install and Update (ghost, with
  their sheet).

### 6.4 Results and failures in words

Every server action writes **one result line** directly under the control that asked. It carries `role="status"` and
`aria-live="polite"`, and amber for a refusal or failure. It holds the action's existing sentence:
- `rotateAnswerText`, `updateErrorText`, `moveSkipText`, `ACK_UNREADABLE_TEXT`;
- the collector's and stall watch's lines;
- `UNCONFIRMED_TEXT` for a 2xx that could not be read.

The line stays until the next action on that control or a poll that changes what it reports. No answer to a control
that is still on screen is a toast. That keeps today's pins, such as the 409 `auto-needs-rollback-gate` rendered "not
as a toast" (≈:447), and turns today's toasting answers into lines (§11.4 lists each pin). A toast is used only when
the control is gone: the sheet or confirm closed, or the operator left the section, while the request was in flight.
`sendAck` keeps its `AckOutcome` answer and loses its own toast, so each caller (the node row, `HaltBanner`) writes its
line. A request in flight shows the verb with an ellipsis on its button ("Rotating…") and disables it. "Requested" is
never worded as "done": the move 202 reads "Requested. The nodes report back within a minute.", and the node rows
then show what they measured.

## 7. The release window (D-5505)

### 7.1 Inputs and the three fleet states

`releaseWindow(releases, nodes, channel)` is computed from:
- **managed:** `nodes.filter(isManagedNode)` (macOS nodes excluded, D-3410);
- **the fleet's channel:** the `'*'` intent's channel, the value the Channel setting shows;
- **each managed node's version** (`nodeVersion`) and floor (`highestVersion`, with `floorRead`);
- the catalogue rows, through `sortReleases` (release tags newest first; non-tag rows last).

**On the fleet's channel** means: on a **Stable** fleet, `channel === 'stable'`; on a **Dev** fleet, any release tag
(Dev sees every release). A row whose `channel` is `null` (a token this build cannot name) counts on Dev only.

The window is drawn in one of three states. None of them can show more than three rows in any group:

| State | When | Groups |
|---|---|---|
| **Measured** | at least one managed node, every managed node's version is a release tag, and the channel was read | Newer, Running (or Mixed), Roll back to (§7.2) |
| **Unmeasured** | a managed node is unmeasured or unversioned, or the channel could not be read | one group, "Releases": the newest three on the fleet's channel (any channel when it is unread), each with the button `releaseDirection` gives (today's `install` for an unmeasured fleet, whose sheet then says each node's refusal in place), then "*n* older releases not shown". The Fleet version status names the node that has not reported. No Roll back group: nothing is rolled back from a guess. |
| **Unmanaged** | no managed node (every node is macOS) | "Releases": the newest three on the fleet's channel, with no move button, then "*n* older releases not shown" and "macOS nodes are updated on the Mac itself." |

### 7.2 The measured window

Let *hi* be the newest managed node's version and *lo* the oldest. A uniform fleet has *hi* = *lo*.

1. **Newer.** Release tags strictly newer than *hi*, on the fleet's channel, not withdrawn, newest first, **at most
   three**. `pendingTag`'s tag, the one the update banner names, is the first row; if it is not the newest it is still
   placed first. Withdrawn rows are left out of Newer because the server refuses to install one (`moveRefusal`
   `unknown-tag` needs a listed, unyanked row).
   - Under them, when more exist: "*n* more newer releases on this channel are not shown. Installing the newest brings
     in every change they made."
   - **A row at or below a node's floor.** After a rollback, the release the node left is newer than *hi* but not
     newer than that node's floor, so dispatch refuses it (`not-newer`). Such a row keeps its place, its Install is
     disabled for that node, and it reads: "*label* was rolled back from this release. The server will not reinstall
     it there and waits for a newer one. `ccrc update --to <tag>` on the node moves it by hand." The sheet's own
     refusal line stays the authority.
2. **Running.**
   - **Uniform fleet:** the one row every managed node runs, with today's `releaseRunningText`. A withdrawn running
     release adds "Withdrawn by its publisher" in amber.
   - **Mixed fleet** (*lo* < *hi*): no row for any release between *lo* and *hi*. Those rows are downgrades for some
     nodes and upgrades for others, so labelling them "Newer" would mislead, and each node's own Update and Roll back
     already cover them. Instead one line: "Nodes run v0.4.10 to v0.4.21." and one move, **"Update all to v0.4.21"**:
     the Install move of *hi*, ghost, whose sheet names the nodes behind it in dispatch order.
3. **Roll back to.** Release tags strictly older than *lo*, newest first, **at most three**, chosen this way:
   - **Stable fleet:** the three newest earlier releases whose channel is Stable. Dev builds that never ran here are
     not candidates.
   - **Dev fleet:** the three newest earlier releases of any channel.
   - **The fleet's previous version.** When every managed node reports the same measured `previousVersion` *P*, *P* is
     older than *lo*, and *P* is not already among the three, *P* takes the third slot. It is marked "Ran before the
     last update". This covers a Stable fleet that last ran a Dev build, and the release a fleet just left. When the
     nodes' previous versions differ, each one stays on its node row (§7.4).
   - **Withdrawn releases count inside the three** (§7.3).
   - **The lead line** states the rule: "The three most recent earlier Stable releases. Rolling back moves every
     managed node, one at a time." On Dev: "The three most recent earlier releases, Stable and Dev."
   - Once D-5506 lands, a row that ran here says so (§7.4), and that is visible in the row, not a filter.

Under the three, one closing line, always present when older releases exist:
> *n* older releases are not offered here. To move to one of them, run `ccrc rollback --to <tag>` on each node, the
> fleet box first, or `ccrc rollout --to <tag> --downgrade` from your own machine, which moves both boxes in order. A
> node keeps its newest installed versions on disk (three by default), so a rollback to one of those needs no
> download.

The facts are `cmd_rollback`'s `--to`, `ccrc rollout`'s `--to` and `--downgrade` (a box below its floor refuses a
rollout without it), `CCRC_VERSIONS_KEEP` defaulting to 3 (`_ver_gc`), and the flip arm against the re-install arm.
*n* counts every older release-tag row not shown, of any channel.

### 7.3 Withdrawn (yanked) releases

Rolling back to a withdrawn release is permitted on purpose (§1.2 item 8), so the window keeps it:
- A withdrawn release **counts inside the three** of Roll back to, in its date order.
- Its row wears the word **"Withdrawn"** and an amber note: "Its publisher withdrew it from GitHub. It can still be
  rolled back to; a node that cannot fetch its checksums will refuse, and the sheet will say so." (`cmd_rollback` asks
  for the tag's `SHA256SUMS` first; whether a kept copy under `~/ccrc-versions` still needs it is pinned by the plan's
  first test against `ccd/ccrc`, and the note's second clause follows what it finds.)
- The confirm sheet marks the target as withdrawn (§6.3).
- A withdrawn release is never in Newer (§7.2 item 1).

### 7.4 What each row says, and what stays outside the window

Each row is compact: a two-column grid, with the facts on the left and the row's one action on the right, and "Notes"
underneath across both columns (ruled, §15.2). The grid keeps a row from wrapping at 390 px, because no date shares the
action's line.
- **First line:** the tag (mono) and the channel as a word.
- **Second line, what it was:** the first non-empty line of its notes, in sans, ellipsised to one line.
- **The meta line, when:** "Released 2026-10-09" (`releaseDate(publishedAt)`), then, joined by " · ", **when it ran
  here** from D-5506 (the table below), then any role word such as "Ran before the last update". For example: "Released
  2026-10-02 · Ran here 2 Oct to 9 Oct · Ran before the last update".
- **Notes:** a `<details>` that opens today's `<pre>` (TEXT IS TEXT). The waiting release's "Notes" (Newer's first row)
  is open by default (§4.1). In Instrument, selecting the row also puts the notes in the inspector (§4.5). A row with
  no notes reads "No release notes."

What the meta line says after "Released", from D-5506:

| Record (D-5506) | Row says |
|---|---|
| seen, now not running | "Ran here 2 Oct to 9 Oct" (first and last seen on any managed node) |
| seen, running on some nodes | "Running on fleet since 9 Oct" (node labels) |
| `null`: never seen since records began | "No record of it running here (records start 18 Oct)" |
| absent (a server before D-5506) | nothing after it. "Released" is the only date, and nothing is implied about installs. |

**Badges become words** with a glossary, rather than unexplained chips:
- **"Signed bundle"** (`bundleListed`) has the title "The release publishes a signature file, so a node can check
  what it downloads."
- **"Checked on a node"** (`verifiedAt`) has the title "A node installed it and verified its signature."
- **"Withdrawn"** (`yanked`), as §7.3.
- **"Refused by 1 of 3 nodes"** stays as a sentence, and opens the refusals in Details or the inspector.

A one-line "What these mean" disclosure under the group lead repeats the glossary, so touch users reach it without
hover.

**Outside the window:**
- **The node row's Roll back** to its measured `previousVersion` is kept in Nodes, whatever the window holds. It moves
  one node to the build it ran before its last update, which is the most common rollback. It is never hidden for
  falling outside the three, and it now wears the danger tone.
- **Blocked rows still count.** A release in the three whose rollback is blocked (`rollbackBlockers`, for example no
  signed bundle on a verified node) stays in its place with today's blocked line and a disabled button. It is not
  replaced by a fourth, so the window stays the plain "three most recent", and the blocked reason is visible.

### 7.5 Fewer than three, and the edge cases

| Case | Window shows |
|---|---|
| measured, 0 earlier releases on the channel | "No earlier release to roll back to." No group heading and no closing line. |
| measured, 1 or 2 | those rows, and the lead "The *n* most recent earlier release(s) on this channel. That is every one on record here." No closing line unless off-channel older rows exist. |
| measured, 3 and more | three rows and §7.2's closing line |
| measured, Stable fleet whose earlier releases are all Dev builds | "No earlier Stable release to roll back to." Then the closing line, which counts the Dev builds. The node row's own Roll back still offers each node's previous version. |
| measured, every earlier one withdrawn | up to three withdrawn rows, each marked, and the closing line |
| no newer release | no Newer group, and the status line carries no "available" |
| mixed fleet | §7.2 item 2's line and "Update all to *hi*", then Roll back to below *lo* |
| unmeasured or unversioned node, or channel unread | §7.1's Unmeasured state |
| no managed node (all macOS) | §7.1's Unmanaged state |
| catalogue never read or not configured | today's states (≈:602, ≈:616) |

### 7.6 How it is computed

`releaseWindow` is a pure function beside `sortReleases` in `updates.tsx`. It returns
`{ state: 'measured' | 'unmeasured' | 'unmanaged', newer, newerHidden, running, mixed, rollback, olderHidden, rule }`,
where `mixed` is `{ lo, hi } | null` and `rule` is `'stable' | 'dev'` (for the lead line). It is built only from
`sortReleases`, `releaseDirection`, `pendingTag`, `nodeVersion`, `previousVersion`, `highestVersion`, each row's
`channel` and `yanked`, and the fleet channel, so the window, the banner and the button label cannot disagree.
`ReleaseList` renders the window. The server and the wire are unchanged for the cap: the slice is the PWA's.

## 8. "Ran here": the install record (D-5506)

**Why.** The ask is for each version's "what each was and when it was installed". Today no record of when a release ran
on this fleet exists:
- `ReleaseWire` has `publishedAt` only.
- `nodes` keeps `previousVersion` with no time.
- The node's install record `~/.ccrc/installed` holds a sha.
- The `update` feed events record dispatches, not completed installs (`moveFeedRecord`), and are evicted.

The only honest date today is the release date.

**What.**
- **Table.** One additive coord migration adds the table `release_seen (tag TEXT NOT NULL PRIMARY KEY, firstSeenAt
  INTEGER NOT NULL, lastSeenAt INTEGER NOT NULL)`, plus `release_seen_since`, a one-row table recording when the
  migration ran.
- **Writer.** `sweepInventory` (`server/src/update/inventory.ts` ≈:747), the 60 s inventory sweep that `watch.ts`
  calls, is the only writer. The write goes in `inventory.ts`, not `watch.ts`, which #397 and #597 hold. For each live
  managed node whose `currentVersion` is a release tag and whose stamp was read, it upserts that tag:
  `firstSeenAt = min(existing, now)` and `lastSeenAt = now`. Unmeasured, unreachable and unversioned nodes write
  nothing.
- **Accuracy.** The dates are "seen running", accurate to the sweep's minute. They are never "installed at", which
  nothing measures. The words say "ran here".
- **Wire.** `ReleaseWire` gains `seen?: { firstAt: number; lastAt: number } | null` (absent = an older server, `null`
  = never seen since records began). `UpdatesView` gains `seenSince?: number`. Both are additive and optional, the same
  absent-is-silence rule as `floorRead`.
- **Readers.** Only the row's meta line (§7.4) and the inspector read them.
- **Retention.** One row per tag ever seen running, which is bounded by what the fleet ran. The plan may cap it at the
  last 50 tags.

**Gate.** This edits `shared/api.ts`, which both #397 (Path identity W1a) and #597 (the delegation wave-3 follow-up)
hold open. It lands after both merge, per the freeze rule. No open PR holds `inventory.ts`, `coord/schema.ts` or
`coord/store.ts` at `537b6a41`. The release window (§7) does not wait for it.

## 9. Failure modes

| Failure | What the operator sees |
|---|---|
| `/api/updates` first read fails | Updates: today's `UNREAD_TEXT`. Index status: "could not be read". Other sections are unaffected. |
| A later poll fails | the stale line on the card, the last answer kept (today) |
| A section route with an unknown id | §4.1's table: the not-found line, above the index or above Updates |
| A stall or collector read fails | that card's own unread line. The Automation status reads "Stall watch: could not be read". |
| No coord frame yet, or the WebSocket is down | the Cleanup pause card and its status part are a skeleton, with the fleet store's own connection line. Never "Cleanup runs normally" from silence. |
| The auth status read fails | §5.5's "status unreadable" row. The Security status reads "Sign-in state could not be read". It never says "on". The gate banner is not drawn (today: drawn only on a read `mode === 'off'` that `unarmedExposure` accepts). |
| The passkey list read fails | today's unreadable-store sentence (D-153) in Your sign-in |
| A confirm's request is rejected | the confirm stays open with the refusal sentence (`UpdateMoveSheet` today). For `QuickConfirm` and `AckConfirm`, it closes, and the result line under the control says it in amber. |
| A 2xx that could not be read | `UNCONFIRMED_TEXT` (or `ACK_UNREADABLE_TEXT`) under the control, and a re-poll |
| The window computes from a mixed or unmeasured fleet | §7.1 and §7.5's rows. Never a Roll back from a guess, and never more than three rows. |
| D-5506 absent on the server | no "ran here" line (§7.4) |

## 10. Accessibility, motion and light mode

- **Landmarks and headings.** The index and both desktop navs are `<nav aria-label="Settings sections">`, made of links
  (not tabs or a listbox, because each is a route), with `aria-current="page"` on the open section. The heading order
  is h1 Settings, h2 section, h3 card, h4 a card's sub-group. Scope eyebrows are text, not colour alone.
- **Focus.** Moving to a section puts focus on its `<h2>` (`tabIndex=-1`) and announces the section's name. Back
  returns focus to the index row it came from. Danger confirms trap focus and default it to Cancel
  (`defaultFocus="cancel"`). Closing a confirm returns focus to the control that opened it. Instrument's list column
  takes Tab and Enter, plus the S10 list keys once they exist. No new shortcut is added.
- **Targets.** The index rows are at least 64 px on a phone. Every control has the 44 px floor on coarse pointers
  (`tap-targets.test.tsx`). `--row-h` is 32 only under `(pointer: fine)`.
- **Live text.** Result lines are `role="status"`. The sign-in-off banner is `role="alert"` once per mount. A status
  line that changes on a poll is not live, so a 60 s poll never chatters.
- **Never colour alone.** Amber and red states carry a word ("Halted", "Paused", "Withdrawn", "Sign-in is off",
  "available") and a glyph (lamp rule, D-5094). Danger buttons are named by their verb.
- **Reduced motion.**
  - Refined's subpage push, a 200 ms slide, and Instrument's 120 ms fade become instant under
    `prefers-reduced-motion: reduce`.
  - `<details>` opens without a height animation.
  - The selected-row tint does not transition.
  - The confirm dialog's fade and scale are dropped (a W1 Sheet rule, inherited).
- **Light mode and palettes.** Everything comes from role tokens, so a skin owns no colour (D-5094).
  - The danger card and banner use `--ink-on-danger` on the danger surface.
  - Amber lines and the "available" status use the attention ink that `contrast.test.ts` already covers.
  - The swatch cards render the palette itself.
  - The contrast gate runs for every new rule in Phosphor & Ink and Daylight, and in Dracula and GitHub Light where a
    rule reads palette values (two-skins §9).
- **Text.** Prose is sans and measurements are mono (the rule of voice, A-7). Lines are capped at about 80 characters
  by the 760 and 960 columns.

## 11. Migration

### 11.1 What moves

| From | To | Note |
|---|---|---|
| `AuthSection` at the foot of `AccountsScreen.tsx` ≈:420 | Settings › Security, split into `YourSignInCard` and `ThisSessionCard` (§5.5) | D-5508, defined here once. **Settings R2 owns the move and the removal of `AccountsScreen`'s import, in one PR.** The Accounts redesign lands after it and cites D-5508 for the move; its own D-5522 keeps the door's placement and the rename. The words are kept, including "last used …" and the `ccrc passwd` sentence. |
| The unarmed banner at the top of Settings | the Security › Sign-in gate card, plus a compact banner on every Settings route | the lead sentence is added (§5.5) |
| Box token section | Security › Box token, as a status card with Details | the definition is corrected (§5.5); facts unchanged |
| — | Security › Recent account changes | the Accounts plan's card, hosted here (§5.5) |
| Release notifications, inside Notifications | Notifications › Whole fleet card | labelled as fleet-wide |
| Stall watch and Temp root collector sections | Automation | bodies unchanged except §5.4 |
| "Pause all cleanup", inside the collector card | Automation › Cleanup pause card | gains a status line and the Runs link; stays one tap |
| Channel and Auto-install, at the top of Updates | Updates › Update policy (last card) | §3.3 |
| Node inventory, mid-page | Updates › Nodes card | — |
| The halt line, above the release list and in the node list | the top of Updates › Fleet version, one line | U9; keeps the UI-4 rule (§5.1) |
| The "what's new" doors, `/settings` | `/settings/updates` | `UpdateBanner.tsx` ≈:156 and `RELEASE_PUSH_URL` |

### 11.2 What is renamed (label, old to new)

- Auto-install options:
  - "Off" stays.
  - "Stable releases only" becomes "On the Stable channel only".
  - "Every release on my channel" becomes "On any channel".
- Release notifications becomes **"Announce new releases"**. Its options "on my channel / stable only / off" become
  "Every release on the fleet's channel / Stable releases only / None".
- Collector legend "Choice" becomes **"Collector"**.
- Channel notes:
  - "Stable — releases promoted after they've baked" becomes the label "Stable" with the note "Releases promoted only
    after they have baked."
  - "Dev — every merge, minutes after it lands" becomes the label "Dev" with the note "Every merge, minutes after it
    lands."
- `MACOS_UNMANAGED_TEXT` "macOS: not centrally managed" becomes "Not updated from here. Update this Mac with ccrc on
  the Mac itself."
- Release badges: "verified" becomes "Checked on a node", "bundle listed" becomes "Signed bundle", and "yanked" becomes
  "Withdrawn".
- The section "Box token" keeps its name, under Security.
- `.settings-section` and `.settings-section-title` become `Section`. `.settings-screen` and `.settings-title` become
  `PageScaffold`.

The enum values on the wire are unchanged. Only the PWA's word tables change (`AUTO_LABELS`, `NOTIFY_LABELS`,
`CHANNEL_SENTENCES`, `COLLECT_SECTION_TEXT.legend`, `MACOS_UNMANAGED_TEXT`).

### 11.3 What is removed

- The unbounded release list: every row beyond the window of §7, in every fleet state.
- Every release row's always-open `<pre>` notes, which now sit behind the "Notes" disclosure (the waiting release's
  open by default).
- The rows between two nodes' versions in a mixed fleet, which were mislabelled as one direction.
- One-tap Ack and Revoke, and the Install-toned rollback sheet.
- The toasts that answered a control still on screen (§11.4).
- The 8 px phone gutter and the unbounded desktop width.
- The `/settings`-only route regex.
- Retired classes leave `contrast.test.ts`'s `GRANDFATHERED_UNCOVERED` in the same PR (`.settings-title` today), and
  the control and markup censuses are updated for the moved Revoke (`.accounts-session`) and the move buttons.

Nothing is removed from the server, the wire or the CLI.

### 11.4 What the tests pin

**Kept as they are:**
- The radio-from-the-poll checks (≈:349, ≈:1682).
- The literal Bell (≈:1820, ≈:1832).
- `sortReleases`, `releaseDirection` and their macOS rule (≈:691–:717).
- The move sheet's order and its first-refusal stop (≈:881–:945).
- The node-row Roll back rules (≈:1315–:1401).
- Stall watch P1 to P6.
- The collector's "offers Pause only", and Pause's one tap.
- The box-token text tests, and "posts the rotate route once" (Rotate now stays one tap).
- The `<h1>` Settings (≈:85).
- The tap floors.
- Toasts that stay toasts, because the control is already on screen as an inline line or the answer has no control:
  `settings-screen.test.tsx` ≈:447 ("… and not as a toast"), `collect-lane-section.test.tsx` ≈:248 ("a 409
  marker-still-controls shows inline") and ≈:548 ("a 501 renders inline … never a toast") keep their assertions as
  they are.

**Changed: toast pins that become result-line pins** (each keeps its sentence and tone; only the selector moves from
`.toast` to the control's `role="status"` line):
- `settings-screen.test.tsx`:
  - ≈:383 "a write whose answer is unreadable toasts that it is unconfirmed; a refusal toasts the update sentence as
    an error";
  - ≈:564 and ≈:574, the 409 `auto-needs-rollback-gate` fallbacks to "the route's own toast" (now the route's own
    line);
  - ≈:1471 "a refused ack is the route's sentence in an error toast";
  - ≈:1483 "an ack whose answer could not be read says so, and does not claim failure";
  - ≈:1794 "a refusal toasts the update route's own sentence and puts the stored choice back";
  - ≈:2583 "P2: a refused write toasts the server's detail, re-reads, and leaves the stored radio checked";
  - ≈:2633 "P2 (D-4045): a gateway 502 says the choice may or may not have been saved".
- `collect-lane-section.test.tsx` ≈:396 "403 sign-in-unarmed toasts, re-reads, and leaves Live unchecked".
- `halt-banner.test.tsx` ≈:105 "sends POST /api/updates/ack for that node once, then re-polls" (now after the
  confirm) and ≈:190 "sendAck never rejects … it answers how the Ack ended" (it no longer toasts; its caller writes
  the line).
- Each test name changes from "toasts" to "says, under the control". No assertion is weakened, and a toast test that
  survives is one whose control is gone (a new case per surface: the confirm closed while the request was in flight).

**Changed: other pins:**
- ≈:2334, "the order is Updates, Appearance, Box token, Notifications, Stall watch, Temp root collector", becomes:
  - "the index lists Updates, Appearance, Notifications, Automation, Security, in that order";
  - "each `/settings/<id>` renders that section's cards in §3.3's order";
  - "an unknown id renders the not-found line" (§4.1's table, per skin and width).
- ≈:847 and ≈:902, "every older release reads Roll back", now hold over the window only.
- ≈:1004 "badges the channel … and marks a yanked release": the words "Signed bundle", "Checked on a node" and
  "Withdrawn".
- The `NOTIFY_LABELS`, `AUTO_LABELS`, `CHANNEL_SENTENCES` and collector legend tests: §11.2's words.
- `auth-passkey.test.tsx` renders Security instead of `AccountsScreen`.
- `danger-buttons.test.tsx` gains the moved Revoke and Ack as `danger-ghost`.
- `UpdateBanner`'s "See what's new" test: it navigates to `/settings/updates`. The server's `notify` test:
  `RELEASE_PUSH_URL` is `/settings/updates`.

**New:**
- `releaseWindow`:
  - measured, uniform: three newest rollback rows, newest first; `olderHidden` counting beyond the three;
  - a **Stable fleet with 20 newer Dev builds** shows no more than three Newer rows, all Stable, and the count line;
  - a **Stable fleet whose three newest earlier rows are Dev** skips them; a **Dev fleet** does not;
  - the fleet's shared `previousVersion` takes the third slot when not among the three;
  - withdrawn rows counted inside the three, marked, and never in Newer;
  - blocked rows kept in place;
  - 0, 1 and 2 earlier releases;
  - a **mixed fleet ten versions apart**: no between rows, "Update all to *hi*", rollback below *lo*;
  - **one unmeasured node** with 22 releases: the Unmeasured state, at most three rows;
  - an **all-macOS fleet**: the Unmanaged state, at most three rows, no button;
  - a row at or below a node's floor: Install disabled for that node, with the floor line.
- The node-row Roll back is offered when its `previousVersion` is outside the window.
- Danger confirms: Roll back (release), Roll back (node), the three Ack branches on the node row, the Ack on
  `HaltBanner`, and Revoke. Each opens a confirm whose Cancel posts nothing and whose confirm posts once, and Cancel
  has the focus.
- Ack's confirm copy per `canAck` branch.
- `QuickConfirm`'s `defaultFocus` defaults to today's behaviour (a test on an untouched caller).
- Rotate now and Pause all cleanup post on one tap, with no dialog.
- The result line is `role="status"`, under its control, and not a toast.
- One `useUpdatesView` poll serves the list-column index and the detail across a walk of all five sections
  (Instrument 1280), and refetches nothing between sections.
- The Updates index status leads with "available" exactly when `pendingTag` names a tag.
- The banner's door lands on Updates with the waiting release's notes open.
- Security per gate state (§5.5's table), including `locked-out` and off-on-loopback.
- Revoke of the last passkey adds the passphrase line.
- Routes: `routes.ts` holds the five, with `top: false`.
- Headings: h1, then h2, then h3, then h4.
- The source scan for TEXT IS TEXT is extended to the notes disclosure.
- The markup census: no `danger-ghost` before a `ghost` in a `.settings-move` group.
- D-5506, server:
  - the sweep upserts first and last seen for a measured managed node only;
  - an unmeasured or unreachable node writes nothing;
  - the wire's `seen` is absent on an older fixture and `null` when never seen;
  - the migration is idempotent.

## 12. Verification

The two-skins §9 matrix covers Refined and Instrument, at **360, 390, 438, 900, 1024, 1280, 1440 and 1920**, in
Phosphor & Ink and Daylight. The surfaces are the Settings index and every section page, with the confirm open on a
phone and at ≥ 900. 900 and 1024 are the narrow-pane widths where Refined uses the phone pattern inside the pane and
Instrument's detail is 560 to 680 (§4.2, §4.3); W2 S4b already verifies "no horizontal scroll at 900".

Each capture checks:
- no horizontal scroll;
- the 16 px phone gutter;
- the column at or under 760 (Refined) and 960 (Instrument);
- the nav's current row, or, under a 760 pane, the index-then-section pattern;
- release rows that wrap rather than overflow at 900;
- the last row clearing Instrument's tab bar;
- the identity core present.

The fixture reuses the inventory's (3 nodes, 22 releases, one withdrawn, mixed notes) under public names. It adds a
mixed-version fleet, an unmeasured node, an all-macOS fleet, a Stable fleet with newer Dev builds, and a box with 1
earlier release. Before and after heights per section are recorded in the PR. The target is that no section page is
taller than about 2,400 px at 390 with the fixture.

**Parity (S17).** In Refined, every section is two taps from the fleet. In Instrument on a phone, the index is two
taps and a section is three. Goal 6 states it that way. §15 C1 asks W2's door table to name the section routes.

## 13. Waves

Each R1 PR is one review. At `537b6a41` no open PR holds `updates.tsx`, `SettingsScreen.tsx`, `UpdateMoveSheet.tsx`,
`ui/src/primitives/confirm.tsx`, `CollectLaneSection.tsx`, `StallWatchSection.tsx`, `updateAck.ts`, `HaltBanner.tsx`,
`UpdateBanner.tsx` or `server/src/update/notify.ts` (re-checked against every open PR's file list).

| Wave | Contents | Gate | Files |
|---|---|---|---|
| **R1a — now** | §7 the release window: `releaseWindow`, the three states, the groups, the closing line, words instead of badges, notes collapsed. In R1 the window sits where the list sits today. This answers the operator's "latest 3". | none | `pwa/src/screens/updates.tsx`, `pwa/test/settings-screen.test.tsx` (the window, badge and release-row pins), a new `pwa/test/release-window.test.ts` |
| **R1b — now, after R1a** | §6.3 danger confirms: release and node Roll back in the danger tone, `AckConfirm` on the node row and `HaltBanner`, `QuickConfirm`'s opt-in `defaultFocus`, the row-placement rule, and the `.btn-danger-ghost.settings-move` rule | none; if a census entry must change and that census is still #627's (#402 reconciled), that hunk waits for #627 | `pwa/src/screens/updates.tsx`, `pwa/src/fleet/UpdateMoveSheet.tsx` (`tone`), `pwa/src/fleet/updateAck.ts` (`AckConfirm`), `pwa/src/fleet/HaltBanner.tsx`, `ui/src/primitives/confirm.tsx` (`defaultFocus`), `pwa/src/fleet/fleet.css` (holds `.settings-move`), `pwa/test/settings-screen.test.tsx`, `pwa/test/halt-banner.test.tsx`, `pwa/test/danger-buttons.test.tsx`, a `ui` confirm test, `pwa/test/markup-census.test.ts` (after #627) |
| **R1c — now, after R1b** | §11.2's label renames, §5's explanations that fit today's page (option notes, the corrected collector and box-token words, Ack's per-branch note), and §6.4's result lines replacing the toasts of §11.4 | none | `pwa/src/screens/SettingsScreen.tsx`, `pwa/src/screens/updates.tsx`, `pwa/src/screens/StallWatchSection.tsx`, `pwa/src/fleet/CollectLaneSection.tsx`, `pwa/src/fleet/collectLaneWords.ts`, `pwa/src/fleet/updateAck.ts` (drops its toast), `pwa/src/fleet/HaltBanner.tsx` (writes its line), `pwa/test/settings-screen.test.tsx`, `pwa/test/collect-lane-section.test.tsx`, `pwa/test/collect-lane-words.test.ts`, `pwa/test/halt-banner.test.tsx`, `pwa/test/box-token-card.test.tsx` |
| **R2 — after #402/#627, Ftask 11, Ftask 12b and W2 S2b** | the sections and routes (§3, §4.1, §4.2, §4.4) in Refined, at every width: `SettingsDataProvider`, the index, the subpages, the pane-width rule, the desktop nav, Security receiving `AuthSection` split into two cards (D-5508), the gate banner, the Layout fieldset hosted, the five icons, and the two doors moved to `/settings/updates` | #402/#627 (`app.tsx`, `lib/api.ts`, the censuses), Ftask 11 (`PageScaffold`, `Section`), Ftask 12b (`SkinFieldset`), W2 S2b (`routes.ts`), §15 C1 | `pwa/src/app.tsx`, `pwa/src/lib/routes.ts`, new `pwa/src/screens/settings/*` (provider, index, five section pages), `pwa/src/screens/SettingsScreen.tsx` (retired into them), `pwa/src/screens/AuthSection.tsx` (split), `pwa/src/screens/AccountsScreen.tsx` (one import removed), `pwa/src/fleet/UpdateBanner.tsx`, `server/src/update/notify.ts`, `ui/design/make-icons.mjs` and `ui/src/icons/lucide.ts`, the tests of §11.4 |
| **R3 — after W2 S9 to S11 and W3-LC** | Instrument's master-detail (§4.3): `SettingsIndex` registered in the list column, the inspector content (§4.5) | W2 S9 to S11; W3-LC, the shared list-column seam (§4.3), owned by the coordinator and shared with Accounts | `pwa/src/skins/instrument/*` registration only, `instrument.css`, the Settings inspector parts |
| **R4 — after #397 and #597** | D-5506: the migration, the sweep writer, the wire field and the row line | #397 and #597 (both hold `shared/api.ts`) | `server/src/coord/schema.ts`, `server/src/coord/store.ts`, `server/src/update/inventory.ts`, `shared/api.ts`, `pwa/src/screens/updates.tsx`, their tests |

R1a answers the operator's most concrete ask (the three) on today's single page, before any structure lands. R2 moves
the window into Updates' first card.

## 14. Deviation numbers

| Number | Slug | Section |
|---|---|---|
| D-5503 | `settings-five-sections`: the five sections by kind, their order, the scope eyebrows, the index status lines, and every setting's purpose and when-line | §3, §5 |
| D-5504 | `settings-one-section-per-route`: `/settings/<id>`, the Refined sections list on a phone and in a pane under 760, the vertical nav above it, Instrument master-detail with the index in the list column, `SettingsDataProvider` above the shell, and the "what's new" doors on `/settings/updates` | §4 |
| D-5505 | `release-window-of-three`: the three fleet states; at most three Newer on the fleet's channel; the mixed-fleet line; at most three Roll back to on the fleet's channel, withdrawn included and marked, the fleet's previous version kept; the closing line naming the CLI; blocked rows kept | §7 |
| D-5506 | `release-ran-here`: the `release_seen` record written by `sweepInventory`, and the optional `seen` on `ReleaseWire` | §8 |
| D-5507 | `settings-danger-confirmed`: danger-ghost plus a confirm for Roll back, Ack (both surfaces) and Revoke; the row-placement rule; Rotate now and Pause kept one tap; results in words under the control | §6.3, §6.4 |
| D-5508 | `security-in-settings`: `AuthSection` split into two cards in Settings › Security, beside the gate, recent account changes and the box token; Accounts holds only lanes. The one definition of the sign-in move; the Accounts spec's D-5522 cites it. | §5.5, §11.1 |

Unused: D-5509, D-5510.

## 15. Operator decisions (ruled 2026-10-18)

### 15.1 The decisions

The operator ruled D1 to D11 on 2026-10-18, all as recommended, on the mockups. The middle column is what the plan
builds; the alternatives are kept so the reasons stay readable, and none of them is built.

| # | Decision | Ruled (as recommended) | The alternative (not taken) |
|---|---|---|---|
| D1 | What "latest 3" counts | **Three rollback targets**, older than what the fleet runs, with the running release shown above them as its own row. Newer releases are capped at three too. | "Running plus two" earlier releases. |
| D2 | Releases beyond the three | **Not offered in the PWA**, not even behind a "Show older" fold. One line gives the count and the CLI command (`ccrc rollback --to`, `ccrc rollout --to … --downgrade`). A fold would bring back the list you called ridiculous. | A "Show older" fold. |
| D3 | Withdrawn (yanked) releases in Roll back to | **Offered and counted inside the three**, each marked "Withdrawn" with what that means. This keeps D-3395's intent: rolling back to a withdrawn release is why the server permits it. | Hide them. That reverses D-3395, and sends that case to the CLI. |
| D4 | Which releases a Stable fleet may roll back to | **Stable releases only**, plus the release the fleet ran before its last update. Dev builds that never ran here are not offered. A Dev fleet sees both. | Any channel, for both. |
| D5 | Is a fleet Roll back a danger action (red)? | **Yes** (D-5507), because it moves every managed node and a failed one is not restored. | The move tone, like Install. |
| D6 | Ack's confirm on the home screen's halt banner | **Yes, the same confirm on both surfaces**, so the one Ack stays one. Ack forgets every release the node refused, and with auto-install on it can bring back the same bad release. | Confirm in Settings only, and keep the banner's one-tap Ack as the incident door. |
| D7 | Updates' card order | **Versions first, policy last** (Channel and Auto-install at the foot). You open Updates to act, not to re-read set-once policy. | Policy first, as today. |
| D8 | Revoke passkey: a recent passkey step-up as well as the confirm | **Yes**, the Accounts spec's 5-minute step-up (D-5512), once its guard exists. A browser left open could otherwise revoke your passkeys. Until then, the confirm only. The Accounts spec records the same answer. | Confirm only. |
| D9 | Security moves into Settings (D-5508) | **Yes**, as audits U8 and U9 already say. | Keep sign-in on Accounts. |
| D10 | No "Danger zone" section | **Agreed**: danger is isolated in each card or row (§3.1). | A separate section. |
| D11 | Build the "ran here" record (D-5506) | **Yes**: rows can then say when a release ran here, which is half of your "what each was and when it was installed". It is a small server table, and it lands last (after #397 and #597). | Release dates only. |

### 15.2 The visual calls (settled 2026-10-18)

The mockups made three calls the text had left open. The operator let all three stand as mocked:
1. **The Signed in glyph is green, without glow.** Its `●` is painted in `--status-busy`, with no glow, so a healthy
   lane reads at a glance. The word stays in quiet primary ink. Glow stays reserved for living states (the identity
   core's "glow means life", two-skins spec §3). This is drawn on the Accounts screen, and this spec records it because both specs share the lamp idiom.
2. **The Instrument card head is a title plus a scope tag**: the title in primary ink, the scope as a small mono tag
   at the right (§3.3).
3. **The release date is on the meta line.** "Released …" leaves the tag's line and opens the meta line, before "Ran
   here …" (§7.4).

The mockups' other calls followed the text and needed no ruling: the Refined eyebrow idiom (§3.3), and danger drawn in
place rather than in a section (D10).

### 15.3 For the coordinator, and the residue

**For the coordinator, not the operator:**
- **C1. W2's door table.** Amend it so `switch-layout` and `switch-theme` name `/settings/appearance` as their route,
  and S17(b) evaluates them there. That is W2's plan, so it needs the coordinator's ack before R2.
- **C2. W3-LC**, the shared list-column seam (§4.3): a per-route list and inspector slot, owned once, used by Settings
  R3 and the Accounts redesign.

**Residue (not this spec):**
- **Server retention of `releases`,** for example the last 50 per channel, so `GET /api/updates` stops carrying every
  row ever seen.
- **The darwin auto-install gate** (§2.2 item 12). `autoGateMissing` and the route should count managed nodes only.
- **Friendly passkey names** from the raw user-agent label (§1.4), and marking this device's own passkey, which needs
  a field the passkey list does not carry.
- **Fleet operations (audit F11) and Box health (F12)** fill Automation and a new card later.
- **A drawn select trigger** for Quiet time, once W1's Popover lands.

## 16. Review log

**Rev 1 to rev 2 (2026-10-18): the operator's rulings.** The operator ruled §15's D1 to D11 as recommended and let the
three visual calls stand as mocked (§15.2). Two calls change the text: the release row's date moves from the tag's line
to the meta line, in a two-column grid (§7.4), and the card head is drawn per skin, with Instrument's scope as a tag
beside the title (§3.3). The status is now approved.

**Rev 0 to rev 1 (2026-10-18).** Two reviews of rev 0, both "needs revision". Every finding above low severity and
every cheap low one was applied. Re-measured at `537b6a41`: #626 merged (the icon vendoring gate is gone), and #597
also holds `shared/api.ts` and `watch.ts`.

**Review 1** (17 findings: 4 high, 8 medium, 5 low).

| # | Severity | Found | Resolution |
|---|---|---|---|
| 1 | high | "Newer" was uncapped. On a Stable fleet with dev builds since the last promotion, a mixed fleet, an unmeasured node or an all-macOS fleet, `releaseDirection` answers `install` for nearly every row, so the whole list came back. Rows between two nodes' versions were mislabelled. | §7.1 adds three fleet states. Newer is releases above the newest node, on the channel, capped at 3 with a count line. A mixed fleet shows no between rows, and "Update all to vX" instead. Unmeasured and unmanaged show the newest 3 and a count. Tests in §11.4. Old default 4 replaced by D1. |
| 2 | high | Roll back to ignored channel, so a Stable fleet could be offered three Dev builds that never ran here. | §7.2 item 3: a Stable fleet's targets are Stable releases, a Dev fleet's any. The fleet's shared `previousVersion` takes the third slot when missing. The lead line states the rule. Tests added. D4. |
| 3 | high | The box token's definition and Rotate now's warning contradicted box-token design G3. | §5.5's definition is rewritten (the key fleet-box sessions and tools use to call the server; the old key works until confirmed). Rotate now is a safe one-tap ghost at the card's foot. Removed from D-5507's list and its tests. |
| 4 | high | Hiding yanked targets removed D-3395's deliberate capability. | §7.3: withdrawn releases count inside the three, marked "Withdrawn" with an amber note, and marked in the confirm. §1.2 item 8. D3. |
| 5 | medium | The banner's "See what's new" and `RELEASE_PUSH_URL` would land on the phone index with the notes collapsed. | Both move to `/settings/updates` in R2, and the waiting release's notes open by default (§4.1, §7.4). Tests added. |
| 6 | medium | The collector's Off note was wrong: Off is `shadowed`, which reports what it would remove. | §5.4's Off and Live notes corrected. |
| 7 | medium | The rollback confirm left out that a failed rollback is not restored, that the floor is not lowered, and that a fleet rollback is per node. | §6.3's confirms add both consequences. §7.2's closing line names `ccrc rollback --to` on each node, fleet box first, or `ccrc rollout --to … --downgrade`. A Newer row at or below a node's floor is marked (§7.2 item 1). |
| 8 | medium | Pause as a red confirmed danger action inverted the code's safety direction. | Pause stays one tap, ghost, isolated at the card's foot (§5.4, §6.3). Its explanation now says nothing is deleted while paused. Removed from D-5507. |
| 9 | medium | Ack's wording missed that it deletes every refusal and that auto-install may retry the bad tag. | §5.1 and §6.3: per-branch copy names every refusal cleared and the auto-install retry. |
| 10 | medium | Refined's 200 px nav at a 900 viewport left a column of about 330 px. | §4.2 measures the pane: under 760 px (viewport below about 1080) the phone pattern applies inside the pane. 900 and 1024 are added to §12. |
| 11 | medium | The Updates index status never said a release was waiting. | §3.2 leads with "vX available · fleet runs vY", in attention tone, by `pendingTag`. |
| 12 | medium | The specs disagreed on the Recent account changes card and the deviation number for the sign-in move, and Revoke had no step-up. | §5.5 adds the card, gated on the Accounts audit route. D-5508 is the one definition, and Accounts cites it. Revoke's step-up is D8. |
| 13 | low | The gate card and status handled only on and off, and the passkey count needed a read the index lacked. | §5.5's per-state table (locked-out, off on loopback, unreadable). The count comes from `AuthStatus.passkeysEnrolled`. |
| 14 | low | Stall watch's seven full sentences didn't say the levels are cumulative, and departed from U9 silently. | §5.4: a "does everything above it, plus" lead, one-line notes, and the full sentence for the checked or focused option only (U9). |
| 15 | low | "Never beside a safe action" cannot hold in rows. | §6.3: the row rule, pinned in the markup census. |
| 16 | low | Revoke's confirm missed the last-passkey case, and the UA parsing was an invention. | The last-passkey line is added. The raw label is kept, truncated with a `title`, and parsing moves to the residue. Marking this device's own passkey goes to the residue too: the passkey list carries no field for it. |
| 17 | — | Q1 to Q3 and the defaults | Folded into §15's decisions. |

**Review 2** (12 findings: 6 major, 3 medium, 3 low).

| # | Severity | Found | Resolution |
|---|---|---|---|
| 1 | major | The "three" cap failed open in four states. | As review 1 #1 (§7.1, §7.5, tests). |
| 2 | major | A frame inside the detail cannot feed Instrument's list column, and a skin part may not call the network. | §4.4: `SettingsDataProvider` above the shell in `app.tsx`, with a test that one poll serves both. The list-column route table and inspector slot move to the shared W3-LC (§4.3, C2). |
| 3 | major | Ack's copy was false for the request-only `canAck` branch, and `HaltBanner`'s Ack would stay one tap. | Per-branch copy and button labels (§6.3). `AckConfirm` beside `sendAck`, used by both surfaces (D6). `halt-banner.test.tsx` is in the changed tests. |
| 4 | major | R1 was too big, with an incomplete file list (`UpdateMoveSheet` tone, `confirm.tsx` focus, `StallWatchSection`, `updateAck.ts`, the CSS rule). | Split into R1a (window), R1b (confirms) and R1c (words and result lines), each with every file (§13). `defaultFocus` is opt-in, so `QuickConfirm`'s ten other users do not change. The `.btn-danger-ghost.settings-move` rule is added (§6.1). |
| 5 | major | "Changed tests" omitted the toast pins that §6.4 inverts, the badge test and the label tests. | §11.4 lists every toast pin by file, line and name, which ones stay toasts, the badge test and the label tests. |
| 6 | major | The waves missed #626 (icons), #597 (`watch.ts`, `shared/api.ts`) and #627 (#402 reconciled). | #626 merged at `537b6a41`, so R2 vendors the icons directly. The D-5506 writer moves to `inventory.ts`'s `sweepInventory`, and R4 waits for #397 and #597. #627 is named beside #402 in R1b and R2. |
| 7 | medium | Goal 6 said two taps everywhere, but an Instrument phone needs three, and Q3 aimed at the wrong S17 rule. | Goal 6 is rewritten. C1 amends W2's door table for S17(b), with the coordinator's ack before R2. |
| 8 | medium | There were cross-spec ownership gaps (the account-changes card, two deviation numbers, the import removal, `assertedAt`). | As review 1 #12. In addition, Settings R2 owns the `AuthSection` move and the import removal in one PR, and Accounts lands after it (§11.1). `assertedAt` stays the Accounts spec's (D-5512), and D8 decides whether Revoke uses it. |
| 9 | medium | "AuthSection moves whole" conflicted with the single read, the heading order and the gate-off state, and the spec dropped kept words. | §5.5: split into two prop-fed cards with h3/h4. A per-state table covers gate off or unreadable. "last used" and the `ccrc passwd` sentence are kept. Cites Accounts A4–A6. |
| 10 | low | The preview-grid arithmetic was wrong. | §5.2: 3 columns of compact swatches on a phone (5 rows, about 560 px), and 160 × 100 on desktop (3 or 4 rows). |
| 11 | low | The rollback confirm implied a safety net, and the merged halt line dropped the UI-4 rule. | The confirm states that a failed rollback is not restored. The one halt line keeps UI-4 and stays the `aria-describedby` target (§5.1, §2.3). |
| 12 | low | The frame missed the coord-frame read, defect item 11 overstated, bare `/settings` and unknown ids were unspecified, and the Layout notes were not this spec's. | The coord-frame row and skeleton are added (§4.4, §3.2, §9). Item 11 is corrected. §4.1's per-skin table covers bare and unknown routes. The Layout copy is deferred to Ftask 12b (§5.2). |

**Open from rev 1, for the plan to pin first:** whether `cmd_rollback` to a withdrawn tag kept under
`~/ccrc-versions` still needs its published `SHA256SUMS` (§7.3's note follows the answer), and the exact short notes
for the stall levels against `STALL_LEVEL_TEXT` (§5.4).

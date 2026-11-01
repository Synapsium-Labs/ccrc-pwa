# Accounts connect, Task A2 as built: one state word per lane on the Refined screen

**Status:** as built, 2026-11-01. Plan: `docs/superpowers/plans/2026-10-18-accounts-connect.md`, Task A2. Spec: `docs/superpowers/specs/2026-10-18-accounts-connect-design.md` §4.1–§4.4, §12.1, §12.4. The operator's call of 2026-11-01 lifted the 2026-10-26 refactor-first parking for the Accounts-connect plan, so A2 is built now.

**Gates, measured at this branch's base.** #402/#627: #627 merged (#402 closed in its favour), so the frozen shell files and `contrast.test.ts` are open. F11: the screen already stands on `PageScaffold` (D-5102). Settings R2d: `AccountsScreen.tsx` no longer imports `AuthSection`. A12 is on main and created `stateWordFor` ahead of A2 (D-6058 (3)); A2 renders it and never redefines it.

## Decision

- **D-7718 (2026-11-01)** — `accounts-a2-state-words` (Task A2). The Refined Accounts card draws one state word per lane, with the decisions below, and the pool chip and `AccountPoolSheet` stay through the redesign (the amendment, (1)).

  1. **The pool chip and its sheet stay (amendment to the plan and the spec).** Neither the plan's A2–A4 nor spec §4.4 lists the account pool chip on the redesigned card, and a reading of either could drop it. It stays: spec §8.4 already says pool membership stays on the existing chip once the lane exists, §12.6 lists "pool chip" among what still works in every refusal state, and the chip is the only entry point to `AccountPoolSheet` (`POST /api/pools/accounts/:id`). On the Refined card it sits on the head's second line, after the kind chip and the identity line, with every state it had (tagged, untagged, malformed, unreadable, stale, unrecognised; `data-origin`; the dimmed `accountPools: 'unavailable'` form). Task A4 carries it into Instrument's detail pane, and no later Accounts task removes it without its own ruling. `accounts-trouble.test.tsx` pins that every rostered card carries the chip and that it opens the sheet.
  2. **All seven words are reachable.** The plan wrote A2 for a world without the lane-state file (only Off, Signed out, Rate-limited and Not checked reachable). A12 landed first, so the card reads `LaneWire.state` and every word can show. The trouble cards therefore follow spec §4.2, not the plan's narrower test name: Signed out, Rate-limited, Expiring and Inconclusive lift to the top, in that order (§12.2's group order), and every other card keeps roster order. The identity line, which A12's Step 4 left to A2, renders: "Signed in as …" (a measured identity on a Signed-in lane; "Last signed in as …" on any other word), "Approved as … · stated by you", or "Key sk-or-v1-…a3f9 · validated 2d ago". The plan tier ("· Max") is not on the wire and is not drawn.
  3. **An answer with no lane state.** A dark gate's reader and an older server get no `lanes`. The card then calls the same `stateWordFor` over the telemetry row alone (`laneAnswerOf`) and, where that answers Not checked, says "no lane state on this answer" instead of "no check recorded yet", which only the file could say. It is never Signed in on an absence.
  4. **The roll-up is the body's first line.** `PageScaffold` has no subtitle slot, and adding one to `@ccrc/ui` is outside A2. The roll-up (`5 accounts · 1 signed out · 1 off`) is the page body's first paragraph, with the projection line under it. Its clauses are the four trouble words and Off; Signed in and Not checked are the remainder the total counts, as the spec's example implies.
  5. **Signed in's glyph takes the busy hue's text token.** The plan names `--status-busy` with no glow. The glyph is a character at the word's size, and the contrast gate measures it as text: `--status-busy` is a 3:1 dot token and measures 3.25–4.41 on the card or the raised ground in seven palettes. The glyph uses `--status-busy-text`, the same hue's text token, which holds 4.5 everywhere; no glow, no shadow, no animation. Rate-limited's and Expiring's glyphs take `--status-attention-text` for the same reason. No colour token is added.
  6. **Off still names the 401 it outranks.** The old card said "disabled on the fleet host; sign-in expired" when both were true. Off outranks Signed out, and the full record that would show both is a later task, so an Off card whose lane is also auth-dead reads "Off on the fleet host · also signed out (HTTP 401)" (`offAlso`).
  7. **The fixes are fleet-host commands.** Until the screen can run the acts (A3, A14, A18 onwards), each trouble card's fix is the command in a read-only mono field with a truthful Copy (§12.4): Signed out on a token or key lane, `ccrc account credential --id <id> --credential - < /path/to/credential-file` then `ccrc account check --id <id>`; Signed out on a sign-in lane, `ccrc account check --id <id>` after signing in again; Rate-limited, `ccrc account disable --id <id>`; Expiring, the credential command; Inconclusive, the check. The field is a `<code>` block that wraps, so a phone shows the whole command; a refused or missing clipboard selects it there with "Couldn't copy: press and hold to copy". "Copied" (the button and the toast) appears only once `writeText` resolves.
  8. **Files.** The plan's `server/test/single-definition.test.ts` is now a directory; A2's registry rows are appended to `server/test/single-definition/ask-digest.test.ts` beside A12's. `KIND_CODES` and `kindCodeOf` join `shared/accounts.ts`; the screen's words live in `pwa/src/fleet/accountWords.ts` and the lamp and the trouble card in `pwa/src/fleet/TroubleCard.tsx`. `AccountRow.tsx` (the picker row) changes only its comment: a picker row is a choice of target, so it keeps the lanes strip's sentence and no lamp. The `.accounts-disabled-note` rule stays in `fleet.css` (pinned by `fleet-css.test.ts` and the contrast census) though the screen no longer draws it.
  9. **Instrument until A4.** Instrument draws the same cards in its own tokens (its meters, radii and `--page-max`), and the rail still marks the Signed-out card there, because A4 has not yet moved Instrument to its table, where the rail is selection's and Signed out gets none. The rail rule is scoped to the lane card (`.accounts-row[data-state].acct-rail`) so A4's table rows never match it.

## Per width × skin × mode (Step 4)

Measured by `pwa/browser/accounts-cards.browser.test.ts` in a real Chrome over the production build, on the plan's fixture (lane-a on with a long label, lane-b 401, lane-c 5h at 100%, lane-d off, lane-e codex) and `someone@example.invalid`, with no fleet behind it. Every cell is its own case, and all sixteen are green.

| | 360 | 390 | 1280 | 1920 |
|---|---|---|---|---|
| Refined · Phosphor & Ink (dark) | ✓ | ✓ | ✓ | ✓ |
| Refined · Phosphor Daylight (light) | ✓ | ✓ | ✓ | ✓ |
| Instrument · Phosphor & Ink (dark) | ✓ | ✓ | ✓ | ✓ |
| Instrument · Phosphor Daylight (light) | ✓ | ✓ | ✓ | ✓ |

What each ✓ measured, against the plan's §Acceptance list:

- **The cell is the one it names:** the root's `data-skin` and `data-theme` are the cell's.
- **No horizontal page scroll, no overflow:** the document does not scroll sideways, and no card's content is wider than the card.
- **No clipped or overlapping text:** every head's line 1 stays on one line and its parts do not overlap; every command shows whole in its field; every truncation (the long label, the identity line) carries its whole value in `title`.
- **44px tap targets on a coarse pointer** (360 and 390): the command field and Copy are 44px or taller and stack full width; every target in the list takes a tap 21px above and below its centre, by hit test, so the pool chip counts by its `::before` hit area.
- **`--fs-input` 16 in every field:** the screen has no field; the pool chip's sheet has one, at 16px.
- **The identity core, and no glyph without its word:** every lamp is its glyph and its word; lane hues on the ids.
- **The sheet's container:** the pool chip opens the bottom sheet below 900 and the centred dialog from 900 (unchanged by A2).
- **No secret, code or key:** the key shows only as `sk-or-v1-…a3f9`, and no unmasked key shape is on the page.
- **Nothing moved that A2 did not intend:** trouble cards first (lane-b, lane-c), the roll-up, the rail on lane-b only, "weekly window only" on lane-e; at 1280 and 1920 the column at the skin's `--page-max` (760 in Refined) and the meters side by side. The picker row (`AccountRow.tsx`) changes only in a comment.

Dark and light: the contrast gate measures every new ink on the card's ground (`--bg-surface`) and on the Signed-out card's (`--bg-raised`) in every palette (`node design/contrast-check.mjs`, all pass).

**The offline row** (§Acceptance, spec §12.5), dark, each cell read twice in the same file. **Warm**: the link drops with the screen open (every `/api` request fails as disconnected and every socket closes), and the screen is left and opened again. **Cold**: the app starts with no link, from an offline snapshot holding one session and the roster.

| Offline, dark | 360 | 1280 |
|---|---|---|
| Refined | Warm ✓: the five cards keep the server's words, sources and ages, the order and the roll-up; no field, no key. **Defects:** nothing on the screen says the link is down (no since-when, no read-line); the pool chip is not refused offline (from the code: its write is sent and fails with the write-failed toast); cold, the list is one count-free placeholder with no roll-up, so the snapshot's roster is not drawn with its age. | Warm ✓, as 360, and the fleet pane beside the screen says "Reconnecting…". **Defects:** that word is the only sign the link is down (no since-when, no read-line); the pool chip and the cold placeholder as at 360. |
| Instrument | as Refined at 360 | as Refined at 1280 |

The fix for every defect in the row is Task A18's, whose shape already says it: "The screen reads from the snapshot with its ages; every act … is refused with a sentence and the read-line". None of them is A2's doing: the placeholder, the pool chip's write and the missing sentence are the screen as it was. Nothing in either reading is Signed in on an absence, and no identity or key hint shows cold, because the snapshot never holds `lanes` (G15).

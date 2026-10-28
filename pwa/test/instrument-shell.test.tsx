// Instrument's shell at laptop and wide (W2 Task S9, D-5472): the rail, the top bar, the list column and the status
// bar, placed by the shared frame. Each case mounts the whole `App` under Instrument with a desk width stubbed
// (`(min-width: 900px)` true), or reads `instrument.css` where the claim is the stylesheet's (jsdom applies no media
// query and lays nothing out, so a width or a pointer branch is asserted on the rule, and the real-browser renders in
// the PR measure the pixels).
//
// RED FIRST, on the task's base: this file did not compile there (no `skins/instrument/Rail.tsx`).
//
// MUTATION TABLE (plan Task S9 Step 3; RUN, each mutant on a `git archive` copy, this suite or skin-boundary alone):
//   Activity rendered as a disabled door ............... "…Activity not rendered…"
//   the status bar's 24px outside (pointer: fine) ...... "…under a coarse one it and its buttons are at least --tap-min"
//   the command field as a TextInput ................... "…is not a text field"
//   the status bar filters s.bucket === 'attention' .... "the status bar renders fleetSummary"
//   the top bar starts at column 2 ..................... "the top bar spans the rail's column"
//   the rail's tooltip on :hover only .................. "…shows on focus-visible"
//   Wordmark removed from TopBar ....................... skin-boundary (a)
//   a hex in instrument.css ............................ skin-boundary (c)
//
// W2 Task T2e (desk-polish, D-6335): the frame's fourth track, the list column's one head, the pool-lag readout.
// MUTATION TABLE (plan Task T2e Step 3; RUN, each mutant on the working tree, this suite alone, then reverted):
//   the fourth track unconditional ..................... "the fourth-track attribute follows the set's Inspector part, whatever its id"
//   the attribute set from the skin id ................. "the fourth-track attribute follows the set's Inspector part, whatever its id"
//   `ListColumn` keeps the head chrome ................. "at 900, 1280 and 1920 the frame holds one wordmark, and one each of …"
//   the banners tied to the head flag .................. "one banner stack at any width"
//   the pool lag dropped with the chrome ............... "the pool-lag readout shows once at the desk when the epochs differ"
// Fix round 1 (review 826, F1):
//   the rail's Inbox door without the count ............ "at the desk with mail unread, the rail's Inbox door names and shows the count, and nothing else in the frame does"
// T2e review R32, F5 (carried into T2g, D-6715; RUN, this suite alone, then reverted):
//   `unreadMailCount` without the `isUnseenAt(...)` term  "mail at the ack's own stamp, or before it, is not unread: …"
//   `isUnseenAt` as `since >= (acks[key] ?? 0)` ........ "mail at the ack's own stamp, or before it, is not unread: …"
//
// W2 Task T2g (desk-polish, D-6715): one count at the desk, in the status bar; the list head empty is not drawn.
// MUTATION TABLE (plan Task T2g Step 3; RUN, each mutant on the working tree, this suite alone unless named, then reverted):
//   `ListColumn` without `headCount={false}` ........... "at 900, 1280 and 1920 Instrument's list column draws no count line, …", the head-is-the-lag case,
//                                                         and T2e's census case (the browser leg holds the offset case)
//   `FleetColumn` passes `headCount` without `|| !desktop`  "at 899 Instrument's list column keeps its count line"
//   in `FleetScreen`, `poolLag={headCount ? poolLag : null}`  "…the head is the pool lag alone when the epochs differ…", and T2e's "the pool-lag readout shows once at the desk when the epochs differ"
//   `FleetHead`'s nothing-to-draw `return null` removed  "…and there is no head when they agree", "Refined at 1280 on an empty fleet with no lag draws no …", T2e's census case
//   Refined's `Sidebar` passes `headCount={false}` ..... "Refined's desk column keeps its count line"
//   the flag removed and `@media (min-width: 900px) { .shell-nav .fleet-count { display: none } }` in instrument.css
//                                                       skin-boundary (j) "holds on the real tree" (and three of its siblings, which scan the real sheet), and
//                                                         "at 900, 1280 and 1920 Instrument's list column draws no count line, …"
// Row 8 (Step 0's `flex: none` removed) does not apply: Step 0 found the count whole at 900, so T2g adds no `flex: none`.
// Rows 1, 4 and 7 also run in browser/instrument-desk.browser.test.ts (its own table).
//
// Desk polish S5b (D-6530): the lanes fold.
// MUTATION TABLE (plan Task S5b Step 3; the whole table RUN at 182d2ac58, the last code commit of fix round 1, and the flyout rows
// (the R120 `strip-hover-flyout` block, the Escape and flyout-name rows, fix round 2's) RUN again at d51cbc7c1, the last code commit of
// fix round 2; bounded and hash-checked; the logs are kept outside the repo. Each mutant was applied to the working tree as one
// exact-once replacement and restored from a saved copy with its sha256 checked; the named jsdom suite(s) alone, and
// browser/lanes-row.browser.test.ts or browser/refined-phone.browser.test.ts too where a row names one; then reverted.
// At 182d2ac58: 75 mutants run, 75 red, none survived, none invalid. At d51cbc7c1: 33 mutants run, 33 red, none survived, none
// invalid. The counts "of 70" and "of 26" are the browser files' sizes at 182d2ac58, "of 72" lanes-row's at d51cbc7c1; the flyout rows
// below carry the d51cbc7c1 figures, the other rows the 182d2ac58 ones):
//   fold when it would hide one lane (`count + 1`; at the desk, the line folding when one lane would overflow)
//                                                       strip-fold "it never folds to hide a single lane: five lanes show all five", "foldable is false at five lanes
//                                                         and true at six, folded or expanded", "one rule at every width: …"
//   `foldable` read from `hidden.length` ............... strip-fold "foldable is false at five lanes and true at six, folded or expanded", "expanded shows every lane, in the same order"
//   the shown lanes taken from the end ................. strip-fold "…the fold shows the freest four, in lanesByFree's order…", "six lanes fold to four and +2"; refined-phone
//                                                         "at 390 with 17 lanes the phone header shows four cards and '+13 more · …'"
//   expired and never-read lanes hidden whatever their position
//                                                       strip-fold "the fold hides by position, never by state: …"
//   the attention counts dropped from the words ........ strip-fold "+n more counts the hidden lanes that need you: …"
//   a critical lane (above 75%) counted ................ strip-fold "a hidden lane that is only critical is not counted"
//   a sign-in-expired lane at its limit counted under both
//                                                       strip-fold "a lane counts once, sign-in expired first"
//   a never-read lane counted as needing you ........... strip-fold "a never-read lane is hidden but not counted as needing you"
//   "sign-in expired" retyped in `stripFold.ts` ........ strip-fold "the words take SIGN_IN_EXPIRED and the state word"
//   the limit re-tested inline instead of `stateWordFor` strip-fold "the words take SIGN_IN_EXPIRED and the state word"
//   `FOLD_SHOWN` used at the desk too .................. strip-fold "a desk folds to one card fewer than rowFit's tracks, the last track the end cell's", "one rule at every width: …";
//                                                         lanes-row (8 of 70) "folded with 17 lanes at 900, 1280 and 1920 in both skins, the row is one line: …", "from 1920 to 1280 the folded row re-fits: …"
//   the end cell's track not left (`foldShown(true, t)` is `t`)
//                                                       strip-fold "a desk folds to one card fewer than rowFit's tracks, …", "one rule at every width: …";
//                                                         lanes-row (8 of 70) "folded with 17 lanes at 900, 1280 and 1920 in both skins, the row is one line: …", "from 1920 to 1280 the folded row re-fits: …"
//   a width query in `stripFold.ts` .................... strip-fold "stripFold.ts reads no layout"
//   `rowFit` without the gap added back ................ strip-fold "rowFit counts the tracks one line holds: …"
//   an unmeasured row read as one card (width 0 -> 1) .. strip-fold "an unmeasured desk row folds nothing: every lane, no control"
//   the floor's figure kept in `shell.css` ............. strip-fold "the card's floor is LANE_CARD_MIN, once"
//   `--lane-card-min: 260px` in the strip's rule ....... strip-fold "the card's floor is LANE_CARD_MIN, once: every lanes-row rule in shell.css reads the token, and none writes the figure"
//   `minmax(260px, 1fr)` in the flyout's rule .......... strip-fold, the same case (fix round 1: both were SURVIVED while the guard read only the strip's `grid-template-columns`)
//   the fold applied below 900 only .................... app "one fold control per width, in both skins: refined, desk, …" and the instrument one; lanes-row "folded with 17
//                                                         lanes at 900, 1280 and 1920 …" (RED, run filtered to the one view refined, phosphor, 1280px; the whole file is not run for this row:
//                                                         it outran its 580 s bound, twice, in an earlier run, with every folded desk case waiting out its own timeout)
//   hidden cards rendered and hidden by CSS ............ accounts-strip "the folded strip mounts only the shown cards", and six more
//   the control rendered outside the end cell .......... accounts-strip "the control sits in the end cell, after the last shown card and before All accounts, …"
//   the control rendered after All accounts ............ accounts-strip "the control sits in the end cell, after the last shown card and before All accounts, …"
//   the tab stop left on a card that folds away ........ accounts-strip "…a stop on a card that folds away goes to the first shown card"
//   `lanesRowLabel` called with the shown lanes ........ accounts-strip "folded, the group's name names the fullest lane, which is hidden"
//   the control spreads `commandDoor('go-accounts')` before its own `onClick`
//                                                       accounts-strip "a tap on the control folds and unfolds and never navigates, and the control carries no data-command …"
//   the same spread after its own `onClick` ............ accounts-strip "a tap on the control folds and unfolds and never navigates, …", and five more
//   an `aria-label` on the control ..................... accounts-strip "the control's name is its words (no aria-label), …", and 26 more
//   the control keyed on its state (remounts) .......... accounts-strip "focus stays on the control across Show fewer and +n more"
//   the control rendered iff `hidden.length > 0` ....... accounts-strip "focus stays on the control across Show fewer and +n more", "a tap on the control folds and unfolds …"
//   the control rendered when `expanded` regardless of `foldable`
//                                                       accounts-strip "five lanes render no fold control at all, folded or expanded: the only button in the strip is All accounts"
//                                                         (a fix round: it was SURVIVED while the one case looked for the control by name, which a control with no words does not have)
//   the component compares `live.length` with `FOLD_SHOWN`
//                                                       accounts-strip "the control renders from foldLanes alone: …"
//   the scroll run on mount ............................ accounts-strip "another tab's choice to fold, arriving after the load, scrolls nothing: only this page's own Show fewer does"
//                                                         (a fix round: it was SURVIVED while no case let a choice arrive after the load, the effect running only at mount)
//   the sentence built inline in `AccountsStrip` ....... accounts-strip "the control's words are foldWords': the component builds no sentence of its own", and six more
//   Show fewer's scroll call removed ................... accounts-strip "Show fewer scrolls the control into view with block nearest; …"; refined-phone browser (2 of 26)
//                                                         "after Show fewer the control is focused and on screen: refined, phosphor, 360px" and 390px
//   the choice kept in component state ................. strip-expanded "the choice survives a remount and a reload", and four more; refined-phone "the choice to expand is remembered across a remount"
//   a malformed value read as expanded ................. strip-expanded "absent, malformed or unreadable storage reads folded"
//   the read without try/catch ......................... strip-expanded "absent, malformed or unreadable storage reads folded", "unreadable storage reads folded until this page chooses, …"
//   the in-page value dropped when storage refuses ..... strip-expanded "a choice storage refuses still holds for this page", and two more
//   `useState` per hook instead of the shared store .... strip-expanded "two strips agree", and four more
//   the `storage` listener removed ..................... strip-expanded "a storage event for ccrc-accounts-strip updates a mounted hook", and one more
//   the fold applied in `PhoneHeader` only (the fleet column's mount given an unfolded prop)
//                                                       instrument-shell "Instrument's phone fleet column folds the same strip"
//   Instrument's first-row bound lowered below its measured 533.8 px (540 -> 530) ... refined-phone browser (1 of 26) "folded, with 17 lanes, four cards and one control …, and the first session row sits at most
//                                                         540 px down at 390×844: instrument, phosphor, 390px" (fix round 1, `instrument-first-row-is-its-chrome`: the 440 check was gated on Refined's head, so Instrument ran none)
// Fix round 1 trimmed the browser leg's geometry matrices to one palette (lanes-row 88 -> 70 cases, refined-phone 31 -> 26);
// the counts above are of the trimmed files, from the run at 182d2ac58.
// R120 `strip-hover-flyout` (accounts-strip alone, plus lanes-row where named):
//   open without the delay (`FLYOUT_OPEN_MS` -> 0) ..... "…hovering the line opens the flyout after FLYOUT_OPEN_MS, …", "a pointer passing by does not open it", "a pointer passing over the strip while the open delay
//                                                         that focus started is pending does not cancel the open", "an open the pointer started is cancelled when the pointer leaves, …"
//   close without the grace (`FLYOUT_CLOSE_MS` -> 0) ... "leaving the line and the flyout closes it after FLYOUT_CLOSE_MS; coming back within the grace keeps it", "focus leaving the strip closes it, …", and four more
//   close without handing focus back to the line ....... "Escape closes it and returns focus to the card it came from", "an open the pointer started is cancelled when the pointer leaves, …"
//   the flyout while expanded .......................... "no flyout while expanded, and none below 900", and the moot-focus case below
//   the flyout below 900 ............................... "no flyout while expanded, and none below 900"
//   the flyout reset removed when it is moot ........... "no flyout while expanded, and none below 900", and the moot-focus case below
//   a pointer leave with keyboard focus inside closing the flyout (the early return in `onLeave` removed)
//                                                       accounts-strip "it stays open while either the pointer or focus is inside the line or the flyout, and closes when neither is",
//                                                         "a pointer passing over the strip while the open delay that focus started is pending does not cancel the open", and three more
//                                                         (fix round 1: the ruled rule is "either"; the old case pinned a pointer leave closing the flyout with focus inside)
//   the early return kept for an open flyout only (`&& flyOpen`): a pointer pass cancelling the open focus started
//                                                       accounts-strip "a pointer passing over the strip while the open delay that focus started is pending does not cancel the open",
//                                                         "keyboard focus arriving while the pointer's open delay is pending takes the open over: …"
//   the early return kept for a pending open only (`&& !flyOpen`): the pointer leaving closing an open flyout focus holds
//                                                       accounts-strip "it stays open while either the pointer or focus is inside the line or the flyout, and closes when neither is", and two more
//   the moot flyout's focus hand-back removed ......... "a flyout made moot while a card of it holds focus hands the focus to the line's tab stop, never to the page: another tab expands the strip"
//                                                         (fix round 1: the reset called `setFlyOpen(false)` directly, so a focused flyout card was unmounted and focus fell to the page)
//   a second copy of the card markup ................... "the flyout's cards render through the line's own card code: one card markup in the component"
//   the flyout's cards from `shown`, not `live` ........ thirteen accounts-strip cases ("…holding every lane in lanesByFree's order", …); lanes-row (4 of 72) "hovering the folded line opens a flyout below it, …"
//   focusout ignoring `relatedTarget` .................. "focus leaving the strip closes it, and focus moving between the line and the flyout does not"
//   pointer enter not cancelling a pending close ....... "leaving the line and the flyout closes it after FLYOUT_CLOSE_MS; coming back within the grace keeps it"
//   focus between the strip's own cards opening it again "Escape stays shut for a keyboard user: an arrow move between the line's cards does not open it again"
//   the flyout `position: absolute` -> `static` ........ lanes-row (4 of 72) "hovering the folded line opens a flyout below it, drawn over the content, …"
//   the flyout's `z-index` removed ..................... lanes-row (4 of 72) "hovering the folded line opens a flyout below it, drawn over the content, …"
//   the `returningFocus` guard removed from `onGroupFocus`: no row. It was SURVIVED as a dead guard (the `relatedTarget` test above it already returns for the move the guard
//                                                         covered), so the guard was removed from `AccountsStrip` in a fix round and the cases stay green
//   the timers not cleared on unmount .................. accounts-strip "unmounting with the open delay pending, or the close grace pending, leaves no timer behind"  (a fix round: it was SURVIVED)
//   `preventDefault` dropped from the flyout's Escape .. accounts-strip "an Escape that closes it is handled there: the key press is default-prevented, …", "an Escape while the open is still pending cancels the open"
//                                                         (final review: an Escape that closes the flyout reached the desk's Escape interrupt and stopped a busy session's turn)
//   the Escape not acting while the open is pending .... accounts-strip "an Escape while the open is still pending cancels the open"
//   the flyout group named as the line's group is ...... accounts-strip "at the desk, folded, hovering the line opens the flyout after FLYOUT_OPEN_MS, …"
// R120 `strip-hover-flyout`, fix round 2 (review 1106; accounts-strip alone, each mutant on the working tree and restored from a saved copy with its sha256 checked;
// the browser rows are lanes-row's, in real Chrome). Only KEYBOARD focus (`:focus-visible`) on a card holds the flyout, and who started an open decides what a pointer does:
//   `keyboardHeld` matching `.account-gauge` without `:focus-visible` (a click's focus on a card holds the flyout)
//                                                       accounts-strip "focus a click leaves behind never holds the flyout: hover-open, click a card, the pointer leaves, …"
//   `keyboardHeld` as the bare `group.contains(el)`, the rule before this round (anything focused in the strip holds it)
//                                                       accounts-strip the same case, "nor does the end cell: hover-open, click All accounts, …" and the end-cell cases of the next row;
//                                                         lanes-row (1 of 72) "a click's focus never holds the flyout: hover-open, click All accounts, move off the strip, and it closes
//                                                         within the grace: refined, phosphor, 1280px" (the flyout never closes: the wait for it times out)
//   `keyboardHeld` testing `:focus-visible` on any element of the group, the end cell's controls too
//                                                       accounts-strip "keyboard focus in the end cell holds nothing either", "keyboard focus moving from a card of the flyout to
//                                                         the end cell, with the pointer outside, starts the grace", "focus arriving at the end cell from outside the strip opens nothing"
//   `handFocusBack` without its `focus()` call (Escape drops focus to the page)
//                                                       lanes-row (1 of 72) "Escape closes the flyout a keyboard opened and hands focus to a card of the line: refined, phosphor, 1280px"
//   `onLeave` without the `openBy` test (any keyboard focus parked in the strip saves a pointer's open)
//                                                       accounts-strip "an open the pointer started is cancelled when the pointer leaves, whatever focus is parked in the strip: after Escape the flyout stays shut"
//   a pending pointer open not taken over by keyboard focus arriving (the `openBy` upgrade removed)
//                                                       accounts-strip "keyboard focus arriving while the pointer's open delay is pending takes the open over: …"
//   `onGroupFocus` starting no close grace for focus that holds nothing
//                                                       accounts-strip "keyboard focus moving from a card of the flyout to the end cell, with the pointer outside, starts the grace"
//   `handFocusBack` without the `document.activeElement` guard (a stale `flyHeld` pulls focus out of a field)
//                                                       accounts-strip "a poll that drops the lane of the flyout card holding focus leaves no stale hold: …"
//   `handFocusBack` guarding on the body only (focus inside the strip, or nothing, not allowed)
//                                                       accounts-strip "Escape closes it and returns focus to the card it came from", "an open the pointer started is cancelled …"
//   `handFocusBack` ignoring `flyHeld` (the reviewer's mutant (a): it always focuses)
//                                                       accounts-strip "a hover-only flyout hands no focus to the line when it closes: …", "focus that left the flyout is not handed back: …",
//                                                         "a window that loses focus while a flyout card holds it: …", "Escape with focus on All accounts, which a flyout card left, …"
//   the flyout's `onBlur` not resetting `flyHeld` (the reviewer's mutant (b))
//                                                       accounts-strip "focus that left the flyout is not handed back: …", "a window that loses focus while a flyout card holds it: …",
//                                                         "Escape with focus on All accounts, which a flyout card left, …"
//   `handFocusBack` ignoring both `flyHeld` and the `activeElement` guard
//                                                       the five above and "focus outside the strip stays put when the pointer leaves and the grace runs",
//                                                         "a window that loses focus, then a field outside the strip taking it: …" (neither mutant alone reaches these two: each guard covers the other)
// The reset of a moot flyout is a plain effect now (a one-frame focus on the page is accepted), and no case pins "before the browser paints".
// `useRowWidth` (final review: it had no row; each run against accounts-strip and strip-fold):
//   the observer not disconnected on cleanup ........... accounts-strip "the desk row's observer is disconnected when the strip unmounts"  (it was SURVIVED: no case unmounted a measured strip)
//   the column gap read without the `Number.isFinite` fallback
//                                                       nineteen accounts-strip cases, the first "at the desk the row folds to the measured fit: three cards at 1248 px, …" (jsdom's gap is not a number)
//   the column gap ignored (`gap: 0` in `useRowWidth`) . accounts-strip "the desk's fit counts the column gap the group computes: 1050 px with an 8 px gap holds three tracks, …"
//                                                         (fix round 1: it was SURVIVED, every jsdom case ran with a gap of 0 and the browser leg's three desk widths count alike with 8 px or 0)
// R120 `lanes-tie-break-soonest-reset` (lane-order alone):
//   drop the reset key ................................. "lanes that tie on binding use sort by the binding window's reset, soonest first", and four more
//   reset latest first ................................. the same five
//   a lane with no reset time sorted first ............. "a tie with no reset time sorts after one with a reset time"
//   drop the other window's key ........................ "a tie on use and reset sorts by the other window's use, lowest first", "the reset outranks the other window's use, …"
//   the other window read as the binding pct ........... the same two
//   the reset read from `fiveResetAt` directly ......... "the tie-break reads the reset through bindingWindow"
//   keys 2 and 3 swapped (other window before reset) ... "the reset outranks the other window's use, and the other window's use outranks the roster"
//   key 3 after the roster ............................. "a tie on use and reset sorts by the other window's use, lowest first", "the reset outranks the other window's use, …"
//   the last group (never read, expired) sorted by reset "never-read and expired lanes still go last, in roster order, whatever their resets"
// W2 Task T2d (desk-polish, D-6330): the rail's Inbox door counts what waits on the operator, as Refined's tab does.
// MUTATION TABLE (plan Task T2d Step 3; RUN, each mutant on the working tree, this suite alone, then reverted):
//   the rail's Inbox door left on the unread count .... "the rail's Inbox door says 'waiting for you' with Refined's count"
// T2e's rows 1 and 2 under "T2e review R32, F5" above are retired: `unreadMailCount` is gone, and no door here counts
// unread mail. The F5 case and its two mutants now live in mail-screen.test.tsx, against the Inbox's own row mark.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { INSTRUMENT, REFINED } from '@ccrc/ui';
import type { AccountUsage, FleetSession, NotifyEvent, RunSummary } from '../../shared/api';
import { api } from '../src/lib/api';
import { poolLagText } from '../src/fleet/poolLag';
import { fleetSession } from './fleetFixture';
import { seventeenLanes } from './seventeenLanes';

// The bell renders only where the browser can push; this one can, so the doors' census counts it (T2e).
vi.mock('../src/lib/push', () => ({
  pushSupported: () => true,
  pushEnabled: async () => false,
}));

const { App } = await import('../src/app');
const { navigate } = await import('../src/lib/router');
const { initSkin, setSkin } = await import('../src/lib/skin');
const { useFleetStore } = await import('../src/stores/fleet');
const { ROUTES } = await import('../src/lib/routes');
const { RAIL_ITEMS } = await import('../src/skins/instrument/Rail');
const { fleetSummary } = await import('../src/fleet/fleetSummary');
const { ack, FEED_ACK_KEY, resetAcks } = await import('../src/lib/seen');
const { ShellFrame } = await import('../src/skins/frame');
const { INSTRUMENT_SET } = await import('../src/skins/instrument/parts');
const { REFINED_SET } = await import('../src/skins/refined/parts');

const SKIN_DIR = path.join(import.meta.dirname, '..', 'src', 'skins');
const CSS = readFileSync(path.join(SKIN_DIR, 'instrument', 'instrument.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const S: FleetSession = fleetSession({ id: 'lane-a-project-a', wrapper: 'lane-a', home: 'lane-a', project: 'project-a', bucket: 'attention' });
const WS: FleetSession = fleetSession({
  id: 'project-a-quiet-basin', wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workspace: 'quiet-basin',
});

/** A desk (or not) with a fine pointer: `(min-width: 900px)` answers `desk`. */
function stubWidth(desk: boolean): void {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('min-width: 900px') ? desk : q.includes('pointer: fine'),
    media: q, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }));
}

function mount(at: string, sessions: FleetSession[] = [S, WS]): void {
  act(() => useFleetStore.setState({ conn: 'open', sessions }));
  navigate(at);
  render(<App />);
}

const rail = (): HTMLElement => screen.getByRole('navigation', { name: 'Primary' });
const railDoors = (): HTMLElement[] => within(rail()).getAllByRole('button').filter((b) => b.hasAttribute('data-command'));
const topBar = (): HTMLElement => document.querySelector<HTMLElement>('header.shell-accounts')!;
const footer = (): HTMLElement => document.querySelector<HTMLElement>('footer.shell-status')!;

/** The declarations of every rule whose selector list includes `selector` exactly, outside any at-rule or inside
 *  the one named by `media` (its prelude, e.g. `(pointer: fine)`). */
function declsOf(selector: string, media: string | null = null): string {
  const blocks: { media: string | null; body: string }[] = [];
  let rest = CSS;
  const at = /@media\s*([^{]+)\{/g;
  let m: RegExpExecArray | null;
  let top = '';
  let from = 0;
  while ((m = at.exec(rest)) !== null) {
    top += rest.slice(from, m.index);
    let depth = 1;
    let i = at.lastIndex;
    for (; i < rest.length && depth > 0; i += 1) depth += rest[i] === '{' ? 1 : rest[i] === '}' ? -1 : 0;
    blocks.push({ media: m[1]!.trim(), body: rest.slice(at.lastIndex, i - 1) });
    from = i;
    at.lastIndex = i;
  }
  top += rest.slice(from);
  rest = media === null ? top : blocks.filter((b) => b.media === media).map((b) => b.body).join('\n');
  const out: string[] = [];
  for (const r of rest.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (r[1]!.split(',').map((s) => s.trim()).includes(selector)) out.push(r[2]!);
  }
  return out.join(';');
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-skin');
  initSkin();
  act(() => { setSkin(INSTRUMENT); });
  stubWidth(true);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // The `api.accounts` spies the lanes-row cases add must not leak into the next case.
  vi.restoreAllMocks();
  navigate('/');
  act(() => useFleetStore.setState({ sessions: [], conn: 'connecting', notices: [], blocked: false, pools: null, feed: [], fleetFrameSeen: false }));
  resetAcks();
  act(() => { setSkin(REFINED); });
  localStorage.clear();
});

describe('the rail', () => {
  it('the rail renders RAIL_ITEMS in order, Activity not rendered, each with its word as its name and at least --tap-min tall', () => {
    mount('/');
    const routeItems = RAIL_ITEMS.filter((i) => !('reserved' in i) && !('bell' in i));
    const words = routeItems.map((i) => ROUTES.find((r) => r.id === i.id)!.title);
    expect(words).toEqual(['Fleet', 'Inbox', 'Runs', 'Accounts', 'Archive', 'Docs', 'Settings']);
    expect(railDoors().map((b) => b.getAttribute('aria-label'))).toEqual(words);
    // Activity is held in the registry, reserved, and draws nothing: no control that does nothing ships.
    expect(RAIL_ITEMS.find((i) => i.id === 'activity')).toEqual({ id: 'activity', reserved: 'F4, W4' });
    expect(within(rail()).queryByRole('button', { name: /activity/i })).toBeNull();
    expect(within(rail()).getAllByRole('button').filter((b) => b.hasAttribute('disabled'))).toEqual([]);
    expect(rail().textContent).not.toMatch(/activity/i);
    // Every door is the tap floor tall: `Door`'s own floor, and the rail's rule restates it.
    for (const b of railDoors()) expect(b.className).toContain('min-h-tap');
    expect(declsOf('.ins-rail-item')).toMatch(/min-height:\s*var\(--tap-min\)/);
  });

  it('the rail never clips its tooltips: it is no scroll container, and each item fits its track', () => {
    // A rail with any `overflow` other than visible is a clip box in BOTH axes (overflow-y: auto computes overflow-x
    // to auto), so a tooltip drawn beside it is cut away and the hidden tips widen it into a sideways scroller.
    for (const media of [null, '(min-width: 900px)', '(min-width: 1600px)'] as const) {
      expect(declsOf('.ins-frame .shell-rail', media), String(media)).not.toMatch(/overflow/);
      expect(declsOf('.ins-rail', media), String(media)).not.toMatch(/overflow/);
    }
    // It stacks above the list column, so the tooltip draws over the list, not under it.
    expect(declsOf('.ins-frame .shell-rail', '(min-width: 900px)')).toMatch(/position:\s*relative/);
    expect(declsOf('.ins-frame .shell-rail', '(min-width: 900px)')).toMatch(/z-index:/);
    // The item is the track's width, never a fixed 52px inside a track its border makes 51px: no cut ring.
    expect(declsOf('.ins-rail-item')).toMatch(/width:\s*100%/);
    expect(declsOf('.ins-rail-item')).not.toMatch(/width:\s*\d+px/);
  });

  it('the active rail item carries aria-current=page, and only one does; a session sits under Fleet, as its breadcrumb says', () => {
    for (const [at, word] of [['/', 'Fleet'], ['/runs', 'Runs'], ['/settings/updates', 'Settings'], ['/docs', 'Docs'], [`/s/${S.id}`, 'Fleet']] as const) {
      mount(at);
      const current = railDoors().filter((b) => b.getAttribute('aria-current') === 'page');
      expect(current.map((b) => b.getAttribute('aria-label')), at).toEqual([word]);
      cleanup();
    }
  });

  it('every rail item, the command field and + carry their data-command; a rail item\'s tooltip shows on focus-visible', () => {
    mount('/');
    expect(railDoors().map((b) => b.getAttribute('data-command')))
      .toEqual(['go-fleet', 'go-inbox', 'go-runs', 'go-accounts', 'go-archive', 'go-docs', 'go-settings']);
    expect(within(topBar()).getByRole('button', { name: 'Search or run a command' })).toHaveAttribute('data-command', 'open-palette');
    expect(within(topBar()).getByRole('button', { name: 'New session' })).toHaveAttribute('data-command', 'new-session');
    // The word is in each door, for its tooltip.
    for (const b of railDoors()) expect(b.querySelector('.ins-rail-tip')?.textContent).toBe(b.getAttribute('aria-label'));
    expect(declsOf('.ins-rail-item:hover .ins-rail-tip', '(hover: hover)')).toMatch(/opacity:\s*1/);
    expect(declsOf('.ins-rail-item:focus-visible .ins-rail-tip')).toMatch(/opacity:\s*1/);
  });

  it('a rail door runs its command: Runs goes to /runs', () => {
    mount('/');
    fireEvent.click(railDoors().find((b) => b.getAttribute('aria-label') === 'Runs')!);
    expect(window.location.pathname).toBe('/runs');
  });
});

describe('the top bar', () => {
  it("the breadcrumb reads ROUTES' titles, and the session's title on a session route", () => {
    const crumbs = (): string[] => [...topBar().querySelectorAll('.ins-crumb')].map((c) => c.textContent ?? '');
    const title = (id: string): string => ROUTES.find((r) => r.id === id)!.title;
    mount('/runs');
    expect(crumbs()).toEqual([title('runs')]);
    cleanup();
    mount('/settings/updates');
    expect(crumbs()).toEqual([title('settings'), title('settings-updates')]);
    cleanup();
    mount(`/s/${WS.id}`);
    // The session header's own words: its project, then the workspace's label.
    expect(crumbs()).toEqual([title('fleet'), 'project-a', 'quiet-basin']);
    expect(topBar().querySelector('.ins-crumb:last-child')).toHaveAttribute('aria-current', 'page');
    // A crumb the bar cuts short (the overflow order gives crumbs up first) still shows its whole word on hover.
    for (const c of topBar().querySelectorAll('.ins-crumb')) expect(c).toHaveAttribute('title', c.textContent ?? '');
    cleanup();
    mount(`/s/${S.id}`);
    expect(crumbs()).toEqual([title('fleet'), 'project-a']);
  });

  it('a session the fleet does not list reads Fleet › Session, never a name guessed from its id', () => {
    mount('/s/project-z-unlisted-basin');
    const crumbs = [...topBar().querySelectorAll('.ins-crumb')].map((c) => c.textContent ?? '');
    expect(crumbs).toEqual([ROUTES.find((r) => r.id === 'fleet')!.title, ROUTES.find((r) => r.id === 'session')!.title]);
  });

  it('the command field opens the palette, and is not a text field', () => {
    mount('/');
    const field = within(topBar()).getByRole('button', { name: 'Search or run a command' });
    expect(field.tagName).toBe('BUTTON');
    expect(within(topBar()).queryByRole('textbox')).toBeNull();
    expect(within(topBar()).queryByRole('combobox')).toBeNull();
    expect(topBar().querySelector('input, textarea, [contenteditable]')).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Command palette' })).toBeNull();
    fireEvent.click(field);
    expect(screen.getByRole('combobox', { name: 'Command palette' })).toBeInTheDocument();
  });

  it('the top bar renders the wordmark first, then the crumbs, the command field and +', () => {
    mount('/');
    const bar = topBar();
    const order = [
      bar.querySelector('[data-wordmark]'),
      bar.querySelector('.ins-crumbs'),
      within(bar).getByRole('button', { name: 'Search or run a command' }),
      within(bar).getByRole('button', { name: 'New session' }),
    ];
    for (const el of order) expect(el).not.toBeNull();
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING, `item ${i}`).toBeTruthy();
    }
    // The wordmark is the frame's first chrome after the skip link: the bar precedes the rail in DOM order.
    const frame = document.querySelector('.app-shell')!;
    const kids = [...frame.children].map((c) => c.tagName.toLowerCase() + (c.getAttribute('aria-label') ? `:${c.getAttribute('aria-label')}` : ''));
    expect(kids.slice(0, 5)).toEqual(['a', 'header', 'nav:Primary', 'div', 'main']);
  });

  it("the top bar spans the rail's column", () => {
    expect(declsOf('.ins-frame .shell-accounts', '(min-width: 900px)')).toMatch(/grid-column:\s*1\s*\/\s*-1/);
    expect(declsOf('.ins-frame .shell-rail', '(min-width: 900px)')).toMatch(/grid-column:\s*1\b/);
    expect(declsOf('.ins-frame .shell-rail', '(min-width: 900px)')).toMatch(/grid-row:\s*2/);
  });
});

describe('the status bar', () => {
  it('the status bar is 24px only under a fine pointer; under a coarse one it and its buttons are at least --tap-min', () => {
    // Outside the fine-pointer block, nothing in the sheet is 24px tall …
    expect(declsOf('.ins-status')).not.toMatch(/height:\s*24px/);
    expect(declsOf('.ins-status-key')).not.toMatch(/height:\s*(?:2[0-4])px/);
    expect(declsOf('.ins-status')).toMatch(/min-height:\s*var\(--tap-min\)/);
    expect(declsOf('.ins-status-key')).toMatch(/min-height:\s*var\(--tap-min\)/);
    expect(declsOf('.ins-status-key')).toMatch(/min-width:\s*var\(--tap-min\)/);
    // … and inside it, the bar is 24px.
    expect(declsOf('.ins-status', '(pointer: fine)')).toMatch(/height:\s*24px/);
    // No other block in the sheet makes the bar dense.
    const other = CSS.replace(/@media\s*\(pointer:\s*fine\)\s*\{(?:[^{}]*\{[^}]*\})*[^{}]*\}/g, '');
    expect(other).not.toMatch(/24px/);
    // And the keys carry the hook the rules select.
    mount('/');
    const keys = within(footer()).getAllByRole('button');
    expect(keys.map((k) => k.getAttribute('data-command'))).toEqual(['open-palette', 'show-shortcuts']);
    for (const k of keys) expect(k).toHaveClass('ins-status-key');
  });

  it('the agent link reads "agent: checking" until the health poll answers, never an all-clear', () => {
    vi.stubGlobal('fetch', () => new Promise(() => {}));
    mount('/');
    expect(footer().querySelector('.ins-status-link')).toHaveTextContent('agent: checking');
    expect(footer()).not.toHaveTextContent('agent connected');
  });

  it('runs are counted only after a runs frame has arrived', () => {
    const runs = [{ state: 'working' }] as unknown as RunSummary[];
    act(() => useFleetStore.setState({ runs, runsFrameSeen: false }));
    mount('/');
    const summary = (): string => footer().querySelector('.ins-status-summary')!.textContent ?? '';
    expect(summary()).toBe(fleetSummary([S, WS], null).readout);
    expect(summary()).not.toContain('run');
    act(() => useFleetStore.setState({ runsFrameSeen: true }));
    expect(summary()).toBe(fleetSummary([S, WS], runs).readout);
    expect(summary()).toContain('1 run');
    act(() => useFleetStore.setState({ runs: [], runsFrameSeen: false }));
  });

  it('the status bar renders fleetSummary', () => {
    mount('/');
    expect(footer()).toHaveTextContent(fleetSummary([S, WS], null).readout);
    expect(footer().textContent).toContain('1 waiting');
    // The footer is not a live region.
    expect(footer().querySelector('[role="status"], [role="alert"], [aria-live]')).toBeNull();
    expect(footer()).not.toHaveAttribute('aria-live');
    // The source scan: the status bar imports the one function, and no skin file filters sessions by bucket itself.
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []));
    const status = readFileSync(path.join(SKIN_DIR, 'instrument', 'StatusBar.tsx'), 'utf8');
    expect(status).toMatch(/import \{[^}]*\bfleetSummary\b[^}]*\} from '\.\.\/\.\.\/fleet\/fleetSummary'/);
    expect(status).toMatch(/fleetSummary\(/);
    for (const f of files(SKIN_DIR)) {
      const code = readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '');
      expect(code, path.relative(SKIN_DIR, f)).not.toMatch(/\.bucket\s*[!=]==|\bbucket\s*[!=]==|['"]attention['"]\s*[!=]==/);
    }
  });
});

describe('the lanes row (T2c, D-6329)', () => {
  it("the top bar's line holds no meters, and the header's second line is the lanes row", async () => {
    const lane = (wrapper: string, five: number): AccountUsage => ({
      wrapper, five, seven: five, ts: 1, fiveResetAt: null, sevenResetAt: null, fiveRolledOver: false, sevenRolledOver: false,
      disabled: false, authDead: false,
    });
    const lanes = ['lane-a', 'lane-b', 'lane-c', 'lane-d', 'lane-e', 'lane-f', 'lane-g', 'lane-h'].map((w, i) => lane(w, 5 + i));
    vi.spyOn(api, 'accounts').mockResolvedValue({ accounts: lanes, projected: { wrapper: 'lane-a', score: 0 }, roster: [] });
    mount('/');
    const line = topBar().querySelector<HTMLElement>('.ins-topbar')!;
    await within(topBar()).findByText('lane-h');
    expect(line.querySelector('.accounts-strip, .account-gauge, .meter')).toBeNull();
    expect([...topBar().children]).toEqual([line, topBar().querySelector('.accounts-strip')]);
    expect(topBar().querySelectorAll('.accounts-strip > .account-gauge')).toHaveLength(lanes.length);
  });
});

describe('the lanes fold (S5b, D-6530)', () => {
  it("Instrument's phone fleet column folds the same strip", async () => {
    const f = seventeenLanes(Math.floor(Date.now() / 1000));
    vi.spyOn(api, 'accounts').mockResolvedValue({ accounts: f.accounts, projected: { wrapper: 'w0', score: 0 }, roster: f.roster });
    stubWidth(false);
    mount('/');
    const fleet = screen.getByRole('region', { name: 'Fleet' });
    const strip = await within(fleet).findByRole('group', { name: /^account usage, highest lane-q 100%/ });
    await within(strip).findByText('lane-a');
    expect(strip.querySelectorAll('.account-gauge')).toHaveLength(4);
    expect(within(strip).getByRole('button', { name: '+13 more · 1 sign-in expired · 1 rate-limited' })).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelectorAll('.accounts-strip')).toHaveLength(1);
  });
});

describe('one instance per width', () => {
  it('one banner stack and one full strip at any width: at 900 the full strip, in the header', () => {
    for (const desk of [false, true]) {
      stubWidth(desk);
      act(() => useFleetStore.setState({ conn: 'down', sessions: [S] }));
      navigate('/');
      render(<App />);
      const at = desk ? '900' : '899';
      expect(document.querySelectorAll('[data-banner="offline"]').length, `${at}: banner stacks`).toBe(1);
      const meters = document.querySelectorAll('.accounts-strip');
      expect(meters.length, `${at}: lanes`).toBe(1);
      expect(meters[0]!.closest('header.shell-accounts') !== null, at).toBe(desk);
      // The rail and the status bar are desk parts: mounted at 900, absent at 899.
      expect(document.querySelectorAll('nav[aria-label="Primary"]').length, `${at}: rail`).toBe(desk ? 1 : 0);
      expect(document.querySelectorAll('footer.shell-status').length, `${at}: status bar`).toBe(desk ? 1 : 0);
      cleanup();
    }
  });
});

// ---- Desk polish, T2e (D-6335) ----------------------------------------------------------------------------------

/** The width at which a desk `(min-width: N)` query answers, so one test can stand at 899, 900, 1280 and 1920. */
function stubAt(width: number): void {
  vi.stubGlobal('matchMedia', (q: string) => {
    const min = /min-width:\s*(\d+)px/.exec(q);
    return {
      matches: min !== null ? width >= Number(min[1]) : q.includes('pointer: fine'),
      media: q, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
    };
  });
}

/** The frame's doors, counted by what each one IS (its name), never by a class: the rail's and the list head's doors
 *  carry different names for one destination, and the meters' door to /accounts is not a second Accounts door. The
 *  rail's `Inbox` (`Inbox, N waiting for you`) and the list head's `Mail — N waiting for you` are told apart, so a desk
 *  that has the second back, or a rail door that lost its count, is a different census (T2e fix round 1, F1; T2d). */
function doorCounts(): Record<string, number> {
  const named = [...document.querySelectorAll<HTMLElement>('[aria-label]')];
  const count = (re: RegExp): number => named.filter((el) => re.test(el.getAttribute('aria-label') ?? '')).length;
  return {
    wordmark: document.querySelectorAll('[data-wordmark], .wordmark').length,
    docs: count(/^Docs\b/),
    accounts: count(/^(Accounts|Your sign-in and accounts)$/),
    settings: count(/^Settings\b/),
    inbox: count(/^Inbox\b/),
    mail: count(/^Mail\b/),
    waiting: count(/\d+ waiting for you$/),
    bell: count(/^Notifications (on|off)$/),
  };
}

describe('the desk (T2e): no second head in the list column, no empty fourth column', () => {
  it("the fourth-track attribute follows the set's Inspector part, whatever its id", () => {
    function Stub(): ReactNode { return <p>an inspector</p>; }
    // The frame is driven directly: the sets' own parts read providers this case does not mount.
    const bare = { Bar: null, Banners: null, Rail: null, Nav: null, StatusBar: null } as const;
    const attr = (set: Parameters<typeof ShellFrame>[0]['set']): string | null => {
      const view = render(<ShellFrame set={set} view="fleet" detailRef={{ current: null }}><p>ladder</p></ShellFrame>);
      const value = view.container.querySelector('.app-shell')!.getAttribute('data-inspector');
      view.unmount();
      return value;
    };
    stubAt(1920);
    expect(attr({ ...INSTRUMENT_SET, ...bare, Inspector: Stub })).toBe('placed');
    expect(attr({ ...INSTRUMENT_SET, ...bare, Inspector: null })).toBe('none');
    expect(attr({ ...REFINED_SET, ...bare, Inspector: null })).toBe('none');
    expect(attr({ ...REFINED_SET, ...bare, Inspector: Stub })).toBe('placed');
    // Instrument's set carries no Inspector part until S12: the attribute reads none for the set as shipped.
    expect(INSTRUMENT_SET.Inspector).toBeNull();
    expect(attr({ ...INSTRUMENT_SET, ...bare })).toBe('none');
    // The sheet keys the 320px track on the attribute and on nothing else.
    expect(declsOf('.ins-frame', '(min-width: 1600px)')).toMatch(/grid-template-columns:\s*52px 420px minmax\(0, 1fr\)\s*(;|$)/);
    expect(declsOf(".ins-frame[data-inspector='placed']", '(min-width: 1600px)'))
      .toMatch(/grid-template-columns:\s*52px 420px minmax\(0, 1fr\) 320px/);
    for (const media of [null, '(min-width: 900px)'] as const) expect(declsOf('.ins-frame', media), String(media)).not.toMatch(/\b320px/);
    expect(declsOf('.ins-frame', '(min-width: 1600px)')).not.toMatch(/\b320px/);
  });

  it('at 900, 1280 and 1920 the frame holds one wordmark, and one each of the Docs, Accounts, Settings, Inbox and Bell doors', () => {
    for (const width of [900, 1280, 1920]) {
      stubAt(width);
      mount('/');
      expect(doorCounts(), `${width}px, fleet`).toEqual({ wordmark: 1, docs: 1, accounts: 1, settings: 1, inbox: 1, mail: 0, waiting: 0, bell: 1 });
      // The list column's head drops its chrome and, with no count line (T2g) and no lag in this fixture, is not drawn.
      expect(document.querySelector('.shell-nav .fleet-head'), `${width}px`).toBeNull();
      expect(document.querySelector('.shell-nav .fleet-head .wordmark'), `${width}px`).toBeNull();
      expect(document.querySelector('.shell-nav .fleet-count'), `${width}px: no count line`).toBeNull();
      cleanup();
    }
    // Below 900 nothing changed: the head holds its chrome, and the rail and the bar are not mounted.
    stubAt(899);
    mount('/');
    expect(doorCounts(), '899px').toEqual({ wordmark: 1, docs: 1, accounts: 1, settings: 1, inbox: 0, mail: 1, waiting: 0, bell: 1 });
    expect(document.querySelector('.shell-nav .fleet-head .wordmark')).not.toBeNull();
  });

  /** `n` sessions waiting on the operator and a held child (its question is with its coordinator, so it reads
   *  `working`), past the first fleet frame, and two unread mail records, which no door counts (T2d, D-6330). */
  function waitingFleet(n: number): FleetSession[] {
    const stamp = Date.now();
    act(() => { ack(FEED_ACK_KEY, stamp); });
    const feed = [1, 2].map((seq): NotifyEvent => ({ seq, at: stamp + 60_000 + seq, kind: 'mail', sessionId: 'x', title: 'unread', body: '', runId: null }));
    act(() => useFleetStore.setState({ feed, fleetFrameSeen: true }));
    return [
      ...Array.from({ length: n }, (_, i) => fleetSession({ id: `ask-${i}`, project: 'proj', bucket: 'attention' })),
      fleetSession({ id: 'held-child', project: 'proj', bucket: 'working' }),
    ];
  }

  it("the rail's Inbox door says 'waiting for you' with Refined's count", () => {
    for (const width of [900, 1280, 1920]) {
      stubAt(width);
      mount('/', waitingFleet(2));
      const door = within(rail()).getByRole('button', { name: 'Inbox, 2 waiting for you' });
      expect(door, `${width}px`).toHaveAttribute('data-command', 'go-inbox');
      // The tooltip says the same as the name, and the pill prints the number.
      expect(door.querySelector('.ins-rail-tip')?.textContent, `${width}px: tooltip`).toBe('Inbox, 2 waiting for you');
      expect(door.textContent, `${width}px: tooltip, then the count`).toBe('Inbox, 2 waiting for you2');
      // Nothing else in the frame names or draws the count: the list head's Mail door is gone at a desk.
      expect(doorCounts(), `${width}px`).toEqual({ wordmark: 1, docs: 1, accounts: 1, settings: 1, inbox: 1, mail: 0, waiting: 1, bell: 1 });
      expect(document.querySelector('.mail-badge'), `${width}px`).toBeNull();
      expect(document.querySelectorAll('.ins-rail-count, .mail-badge-count'), `${width}px: count pills`).toHaveLength(1);
      cleanup();
    }
    // Refined's tab counts the same fleet the same way (R32's F1): one function, so no skin's door counts for itself.
    act(() => { setSkin(REFINED); });
    stubAt(1280);
    mount('/', waitingFleet(2));
    expect(screen.getByRole('button', { name: 'Inbox, 2 waiting for you' })).toHaveAttribute('data-command', 'go-inbox');
    cleanup();
    act(() => { setSkin(INSTRUMENT); });
    // The printed count is capped like the sibling doors' and the name carries the real number.
    stubAt(1280);
    mount('/', waitingFleet(120));
    const capped = within(rail()).getByRole('button', { name: 'Inbox, 120 waiting for you' });
    expect(capped.textContent).toBe('Inbox, 120 waiting for you99+');
  });

  it('with nobody waiting on the operator the Inbox door draws no badge, however much mail is unread', () => {
    for (const width of [900, 1920]) {
      stubAt(width);
      mount('/', waitingFleet(0));
      const door = within(rail()).getByRole('button', { name: 'Inbox' });
      expect(door.textContent, `${width}px`).toBe('Inbox');
      expect(door.querySelector('.ins-rail-count'), `${width}px`).toBeNull();
      expect(document.querySelectorAll('.ins-rail-count, .mail-badge-count'), `${width}px: no count pill anywhere`).toHaveLength(0);
      expect(doorCounts(), `${width}px`).toMatchObject({ inbox: 1, mail: 0, waiting: 0 });
      cleanup();
    }
    // Before the first fleet frame the rows are the offline snapshot's, not a fact: the door says nothing yet.
    stubAt(1280);
    const sessions = waitingFleet(2);
    act(() => useFleetStore.setState({ fleetFrameSeen: false }));
    mount('/', sessions);
    expect(within(rail()).getByRole('button', { name: 'Inbox' }).textContent).toBe('Inbox');
  });

  it('the pool-lag readout shows once at the desk when the epochs differ', () => {
    act(() => useFleetStore.setState({ pools: { listed: false, enforcement: 'unknown', epoch: 5, observedEpoch: 3 } }));
    for (const width of [900, 1280, 1920]) {
      stubAt(width);
      mount('/');
      expect(screen.getAllByTestId('pool-epoch-lag'), `${width}px`).toHaveLength(1);
      expect(screen.getByTestId('pool-epoch-lag')).toHaveTextContent('epoch 5 / observed 3');
      cleanup();
    }
    act(() => useFleetStore.setState({ pools: { listed: false, enforcement: 'unknown', epoch: 5, observedEpoch: 5 } }));
    stubAt(1280);
    mount('/');
    expect(screen.queryByTestId('pool-epoch-lag')).toBeNull();
  });

  it('one banner stack at any width', () => {
    for (const width of [899, 900, 1280, 1920]) {
      stubAt(width);
      act(() => useFleetStore.setState({ conn: 'down', sessions: [S] }));
      navigate('/');
      render(<App />);
      expect(document.querySelectorAll('[data-banner="offline"]').length, `${width}px: banner stacks`).toBe(1);
      cleanup();
    }
  });
});

// ---- Desk polish, T2g (D-6715) ----------------------------------------------------------------------------------

describe('the desk (T2g): one count, in the status bar', () => {
  const readout = fleetSummary([S, WS], null).readout;

  it("at 900, 1280 and 1920 Instrument's list column draws no count line, and the status bar's fleetSummary is the one count in the frame", () => {
    for (const width of [900, 1280, 1920]) {
      stubAt(width);
      mount('/');
      const counts = document.querySelectorAll('.fleet-count, .ins-status-summary');
      expect(counts, `${width}px: count elements`).toHaveLength(1);
      expect(footer().contains(counts[0]!), `${width}px: inside the status bar`).toBe(true);
      expect(counts[0]!.textContent, `${width}px`).toBe(readout);
      // By its text, not its class: a count that came back under a new class name is still a second one.
      const leaves = [...document.body.querySelectorAll('*')].filter((el) => el.children.length === 0);
      expect(leaves.filter((el) => (el.textContent ?? '').includes(readout)), `${width}px: leaves that say the count`).toHaveLength(1);
      cleanup();
    }
  });

  it("at 899 Instrument's list column keeps its count line", () => {
    stubAt(899);
    mount('/');
    expect(document.querySelector('.shell-nav .fleet-count')).toHaveTextContent(readout);
    expect(document.querySelector('footer.shell-status')).toBeNull();
  });

  it("at the desk the list column's head is the pool lag alone when the epochs differ, and there is no head when they agree", () => {
    stubAt(1280);
    act(() => useFleetStore.setState({ pools: { listed: false, enforcement: 'unknown', epoch: 5, observedEpoch: 3 } }));
    mount('/');
    const head = document.querySelector('.shell-nav .fleet-head');
    expect(head).not.toBeNull();
    expect(head!.textContent).toBe(poolLagText(5, 3));
    expect(head!.querySelector('.fleet-count, .wordmark')).toBeNull();
    cleanup();
    act(() => useFleetStore.setState({ pools: { listed: false, enforcement: 'unknown', epoch: 5, observedEpoch: 5 } }));
    mount('/');
    expect(document.querySelector('.shell-nav section[aria-label="Fleet"]')).not.toBeNull();
    expect(document.querySelector('.shell-nav .fleet-head')).toBeNull();
  });

  it("Refined's desk column keeps its count line", () => {
    act(() => { setSkin(REFINED); });
    stubAt(1280);
    mount('/');
    expect(document.querySelector('.shell-nav .fleet-count')).toHaveTextContent(readout);
  });

  it('Refined at 1280 on an empty fleet with no lag draws no .shell-nav .fleet-head', () => {
    act(() => { setSkin(REFINED); });
    stubAt(1280);
    mount('/', []);
    expect(document.querySelector('.shell-nav section[aria-label="Fleet"]')).not.toBeNull();
    expect(document.querySelector('.shell-nav .fleet-head')).toBeNull();
  });
});

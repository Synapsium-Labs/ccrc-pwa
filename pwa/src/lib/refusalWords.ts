// The PWA's refusal words: every text table, and the one function that reads a code off a failed call against one.
// Pure (L1): no fetch, no store, no component. `lib/api.ts` re-exports all of it, so each existing import and every
// screen keeps its line (ARCH-13b, #557).
import type {
  AskRefuseCode, InterruptRefusal, MoveSkipWhy, RunRouteRefuseCode, SetAccountPoolsRefuseCode, UpdateRouteError,
} from '../../../shared/api';
import { ARCHIVE_REFUSALS, type ArchiveRefusal } from '../../../shared/api';
import { SWAP_REFUSALS, type SwapRefusal } from '../../../shared/api';
import { ApiError } from './apiError';

/** The send and submit tables share this sentence: a resumed Retry (D-6367) and `/submit` both answer `nothing-to-submit`. */
const NOTHING_TO_SUBMIT_TEXT = 'The box is empty — nothing was sent from here. Check the transcript before sending again.';

/** Send failures the server names by code. Left raw these surfaced as bare
 *  slugs under the failed bubble ("dialog-open"), which says nothing about what
 *  to do next. `draft-present` is absent on purpose — it has its own sheet. */
const SEND_ERROR_TEXT: Record<string, string> = {
  'nothing-to-submit': NOTHING_TO_SUBMIT_TEXT, // a resumed Retry (D-6367) over an emptied box answers it
  'dialog-open': "Claude is asking a question — answer that first, then send.",
  // No longer "open the terminal to check": the text is verified sitting in the
  // box, the server knows it, and the failed bubble now carries a Send it
  // button that presses one more Enter. A sentence that sends the operator
  // somewhere else to do something the UI can do is the dead end this build set
  // out to close.
  'enter-ignored': "Typed it, but the session didn't take it.",
  // Replaced, not reworded. The old sentence ("The session never showed the
  // text — open the terminal to check.") went false twice in Build 8: the
  // ordinary path now REFUSES rather than clearing, so the text is still in
  // the box, and the box-scoped echo check makes this refusal fire more often.
  // A message that tells the operator to go somewhere else and do something
  // the UI can do is the dead end `enter-ignored`'s own copy was rewritten to
  // close; this is its neighbour, in the same register, and deliberately not
  // the same string — the two failures are different (nothing came back at
  // all, versus it came back and then would not go).
  'verify-failed': 'Typed it, but the session never echoed it back.',
  // D-5046: tmux refused a line of the message, so nothing was submitted, but
  // the lines before it may be sitting in the box (Retry sees them as a draft).
  'type-failed': "Couldn't type the whole message, so it wasn't sent.",
  'draft-clear-failed': "Couldn't clear the existing draft — open the terminal.",
  // The box is TALLER THAN THE PANE, so its `❯` row has scrolled out of the
  // capture the server reads and nothing in the box can be read at all
  // (`send.ts`'s `box-unreadable`, measured on a live session 2026-09-18).
  // This sentence has to name the remedy, because it is the one failure the
  // PWA genuinely cannot fix from here: nothing typed from this app can shrink
  // that draft — every attempt used to make it taller. The operator clears the
  // box in the terminal (Ctrl-C once), and sends work again immediately.
  'box-unreadable': 'The session’s input box is too full to read — clear it in the terminal (Ctrl-C once), then send again.',
  'not-alive': 'That session is not running.',
  // D-2368/D-2369: the recipient's OWN limit recovery is armed (any keystroke
  // cancels it) — only the mail lane's `holdIfAutoContinueArmed` opt-in ever
  // produces this code (dialog.ts's `autoContinueArmed`, send.ts's own doc).
  'auto-continue-armed': 'Claude is waiting out a usage limit and will continue by itself — sending now would cancel that.',
  // Worker stall watch §4.1: the recipient's pane shows a turn running ("esc to
  // interrupt"). Only the mail lane's `refuseIfTurnRunning` opt-in ever produces
  // this code (dialog.ts's `turnRunning`, send.ts's own doc); it holds the nudge
  // for a minute and counts no attempt.
  'turn-running': 'Claude is in the middle of a turn — the message waits until it finishes.',
};

/**
 * `verify-failed` has TWO outcomes and one code, so the sentence cannot come
 * from the code alone. The server sets `submittable` when the box row it read
 * back is a paste chip — Claude Code's own rendering of a large burst it holds
 * in full — which means the opposite of the table's entry: the session DID take
 * the text, it just showed a chip instead of the characters, and the `Send it`
 * button beside this sentence presses the one Enter that sends it.
 *
 * Telling the operator "never echoed it back" next to a button that sends it is
 * the contradiction this exists to remove. The flag is the discriminator here
 * for the same reason it is one in `ChatList`'s gate: the code is shared, the
 * proof is not.
 */
const VERIFY_FAILED_COLLAPSED = 'Typed it, and the session folded it into a paste chip instead of showing it.';

export const sendErrorText = (code: string, submittable?: boolean): string =>
  (code === 'verify-failed' && submittable === true)
    ? VERIFY_FAILED_COLLAPSED
    : (SEND_ERROR_TEXT[code] ?? code);

/** `POST /submit`'s own refusals. Separate from SEND_ERROR_TEXT because they
 *  answer a different question — not "why didn't my message send" but "why
 *  didn't the rescue work".
 *
 *  Not one of them is good news, and `nothing-to-submit` used to be written as
 *  if it were ("it went through after all"). An empty box is not proof that
 *  this message was sent: the draft-conflict sheet's "Replace draft" empties
 *  the box with `C-u` and types a different message over it, so the operator
 *  could be told their text went through at the exact moment it was destroyed.
 *  The server proves the box is empty; only the transcript can say what left
 *  it. */
const SUBMIT_ERROR_TEXT: Record<string, string> = {
  'nothing-to-submit': NOTHING_TO_SUBMIT_TEXT,
  'blank-first-row': "The box's first line is blank, so what would be sent can't be proven — open the terminal.",
  'box-mismatch': 'The box holds something else now — open the session and look before sending.',
  'dialog-open': 'A question is up — answer that first.',
  'not-alive': 'That session is not running.',
  'enter-ignored': "Still not taking it — open the terminal.",
  // `submitEnter`'s own copy of the refusal above. Same remedy, and the same
  // reason it cannot be done from here.
  'box-unreadable': 'The box is too full to read — clear it in the terminal (Ctrl-C once).',
};

export const submitErrorText = (code: string): string => SUBMIT_ERROR_TEXT[code] ?? code;

/** Upload failures the server names by code. Same reason as SEND_ERROR_TEXT,
 *  sharper consequence: a failed chip's only affordance is retry, and for a 413
 *  retry can never succeed — so the chip has to say what went wrong, in words
 *  that imply what to do instead. */
const UPLOAD_ERROR_TEXT: Record<string, string> = {
  'too-large': 'That file is too large — 12 MB is the limit.',
  'unsupported-type': "Can't attach that — images, text, PDF and RTF only.",
  'bad-request': "That upload didn't arrive — try attaching it again.",
  'unknown-session': 'That session is not running.',
  'bad-session-id': 'That session is not running.',
};

export const uploadErrorText = (code: string): string => UPLOAD_ERROR_TEXT[code] ?? code;

/**
 * THE APP'S ONE SENTENCE FOR A WRITE THAT DID NOT GO THROUGH, written out
 * thirteen times across seven files before this.
 *
 * It sat under every census's floor: `literal-census` reads strings of 25+
 * characters and `Couldn't stop — ` is sixteen, so nothing could see that the
 * app's whole failure voice was being re-typed per call site. One reword, or
 * one call site that said "failed to" instead, and the voice drifts with no
 * suite between.
 *
 * `apiErrorText`, never `err.message`: the runCcd routes fail as
 * 502 `{ok, stderr}` with no `error` key, so `err.message` yields the generic
 * "request failed (502)" and ccd's own refusal never reaches anyone.
 *
 * The VERB is the caller's and stays at the call site — it is the one half of
 * the sentence that is about what the operator just tried to do.
 */
export const failedTo = (verb: string, err: unknown): string =>
  `Couldn't ${verb} — ${apiErrorText(err)}`;

/**
 * The one sentence for a fleet host whose `ccd` predates the verb being
 * called — for the LIFECYCLE routes (`archive`/`restore`/PR sweep) only.
 *
 * `PrKeycap.tsx`'s `REASON_TEXT.unsupported` already owned it — it is what the
 * cap says when the PR SWEEP hits the same skew. This is the definition and
 * that map imports it, rather than the two spelling the same fact differently:
 * the reader who sees the greyed cap and the reader who taps Archive are
 * looking at one condition on one box.
 *
 * NOT the COORDINATION surfaces' 501 text (`COORD_UNSUPPORTED_TEXT`, just
 * below — spec §4.2's own literal "the fleet host needs the newer ccd").
 * That IS a second spelling of the same fact — a deliberate one, not the
 * drift this docstring used to argue against: the spec quotes its own phrase
 * verbatim and `coord-banner.test.tsx` pins it, so editing THIS constant does
 * not change what the pause banner or the abandon sheet renders.
 *
 * TWO constants, THREE call sites, and this names all three (review M2, which
 * found the previous wording had reasoned about exactly this question and then
 * listed only two of them, missing the one the same wave shipped):
 *   1. lifecycle routes (`PrKeycap.tsx`'s `REASON_TEXT.unsupported`,
 *      `PrSheet`'s archive/restore toasts) → THIS constant;
 *   2. the pause banner (`CoordBanner.tsx`'s `inlinePauseError`) → and
 *   3. the abandon sheet (`AbandonSheet.tsx`'s `ABANDON_COPY.unsupported`)
 *      → both `COORD_UNSUPPORTED_TEXT`.
 * If a fourth route ever needs the same refusal, wire it to whichever of the
 * two its own spec/test actually names — neither is universal.
 */
export const UNSUPPORTED_VERB_TEXT =
  'The fleet host is running a ccd that does not have this verb yet.';

/**
 * The same fact as `UNSUPPORTED_VERB_TEXT`, in the COORDINATION surfaces'
 * words — spec §4.2's literal phrase, pinned verbatim by
 * `coord-banner.test.tsx` and `abandon-sheet.test.tsx`.
 *
 * It lives here rather than in either component because it has TWO renderers
 * and they are in different files: `CoordBanner`'s 501 arm and
 * `AbandonSheet`'s `ABANDON_COPY.unsupported` shipped it as two byte-identical
 * literals (review M2). One box, one skew, one sentence — a reader who taps
 * Pause and a reader who taps Abandon on the same stale host must not be told
 * two different things, and two literals is how that starts.
 *
 * Lower-case and un-terminated on purpose: both sites render it as inline
 * refusal copy inside their own surface, not as a standalone sentence the way
 * `UNSUPPORTED_VERB_TEXT` reaches a toast.
 */
export const COORD_UNSUPPORTED_TEXT = 'the fleet host needs the newer ccd';

/**
 * The 404 both the abandon and the reclaim doors answer with: the run the tap
 * named is not on the board any more.
 *
 * TWO MAPS, ONE SENTENCE. `ABANDON_COPY` and `RECLAIM_COPY` each spelled it,
 * and the literal census is what found them — a copy inside a `Record` is
 * invisible to a census that reads `className=` attributes or JSX trees.
 * Those two maps stay separate and SHOULD: every other member differs, and
 * `RECLAIM_COPY`'s own comment argues one of the differences. This is the one
 * member they agree on, and it agrees for a reason — the same 404, about the
 * same board, with the same remedy (wait).
 *
 * Lower-case and un-terminated, `COORD_UNSUPPORTED_TEXT`'s rule: both sites
 * render it as inline refusal copy inside their own surface.
 */
export const UNKNOWN_RUN_TEXT = 'that run is gone — the board will catch up';

/**
 * ccd's own refusal for an empty hold reason (`cmd_ws_hold`, `ccd/ccd`),
 * verbatim: "empty reason — say which program holds this". The server's
 * `/hold` route refuses the identical input before building any argv (400
 * `bad-request`, no reason text on the wire back), so the ONLY place this
 * sentence can come from for a same-session client-side refusal is this
 * constant — copied, not fetched, because refusing before a network round
 * trip is the whole point of catching it here. `SessionActionsSheet` is the
 * one caller; keeping the string here rather than inline keeps it beside
 * `UNSUPPORTED_VERB_TEXT`, this file's other copy of a truth that also lives
 * in ccd.
 */
export const HOLD_EMPTY_REASON_TEXT = 'empty reason — say which program holds this';

/**
 * The archive door's refusals in words (workspace lifecycle spec §5.2) — one sentence per `ARCHIVE_REFUSALS` code,
 * keyed by the L0 const, never by a second spelling of a code. A `Record` over `ArchiveRefusal`, so a code added there
 * without a sentence here is a compile error. `API_ERROR_TEXT` spreads it, so every surface that toasts an archive
 * refusal through `apiErrorText` (the PR sheet, "Archive all") says the same thing the archive sheet does. None of
 * these codes is one `uploadErrorText`, `kickoffErrorText` or `sendErrorText` owns (`api.test.ts` asserts it).
 */
export const ARCHIVE_REFUSAL_TEXT: Readonly<Record<ArchiveRefusal, string>> = {
  [ARCHIVE_REFUSALS.runOpen]: 'A run still claims this workspace.',
  [ARCHIVE_REFUSALS.sessionBusy]: 'It is working — archiving now would lose the turn in progress.',
  [ARCHIVE_REFUSALS.coordinatorHasOpenRuns]: 'It coordinates open runs.',
  [ARCHIVE_REFUSALS.programmePartlyEnded]: 'The programme was only partly ended. Nothing was stopped or archived.',
  [ARCHIVE_REFUSALS.worktreeGone]: 'Its worktree is gone, so it cannot be described for the archive record.',
  [ARCHIVE_REFUSALS.statusUnknown]: 'Its status cannot be read, so it will not be archived on a guess.',
  [ARCHIVE_REFUSALS.manifestUnbuildable]: 'It cannot be described truthfully for the archive record. Nothing was touched.',
};

/**
 * The swap route's refusals in words (D-5240, working-state spec §5.9), keyed by `SWAP_REFUSALS`, never a second
 * spelling. Not spread into `API_ERROR_TEXT`: the two codes are archive's too, and a toast that reads an archive
 * sentence about a swap would be wrong, so `SwapSheet` reads this map itself. A first `sessionBusy` is answered with
 * the "swap anyway" confirm, not with this sentence; the sentence is for a refusal no consent is left to answer.
 */
export const SWAP_REFUSAL_TEXT: Readonly<Record<SwapRefusal, string>> = {
  [SWAP_REFUSALS.sessionBusy]: 'It is working — moving it now would lose the turn in progress and its background tasks.',
  [SWAP_REFUSALS.statusUnknown]: 'Its status cannot be read, so it will not be moved on a guess. Stop it first, then move it.',
  // D-5242: the row is asleep; nothing runs to move. Waking it is the session screen's (plan Task 18).
  [SWAP_REFUSALS.hibernated]: 'It is asleep, so there is nothing running to move. Wake it, then move it.',
};

/**
 * Failures the LIFECYCLE routes name by CODE rather than by ccd's stderr. Same
 * reason as `SEND_ERROR_TEXT` and `UPLOAD_ERROR_TEXT` above: left raw these
 * reach a toast as a bare slug.
 *
 * svc's round-4 residual. `/archive` and `/restore` grew a `verbSupported` gate
 * that answers `501 { error: 'unsupported' }` — a 501 has no `stderr`, so
 * `apiErrorText` fell through to `err.message`, which `ApiError`'s constructor
 * sets from `body.error`, and `PrSheet`'s toast read "Archiving failed —
 * unsupported". That is a slug where the reader needs the one thing that tells
 * them the tap will never work until the box is updated.
 *
 * Deliberately keyed on `body.error`, not on the message: the code is what the
 * server states, and a message that merely happens to equal a code should not
 * be rewritten into a sentence about the host.
 */
const API_ERROR_TEXT: Record<string, string> = {
  unsupported: UNSUPPORTED_VERB_TEXT,
  ...ARCHIVE_REFUSAL_TEXT,
  // Two of the kickoff route's four codes (program-leverage wave 4). Without
  // these the operator reads a bare slug at the one moment the sheet has stopped
  // being able to retry for them — and a box with no `coord.db` is an ordinary,
  // silent state, not an error anybody has seen before.
  //
  // The other two — `unknown-session` and `bad-session-id` — are DELIBERATELY
  // absent, and the tree said so before this comment did: `uploadErrorText`
  // consumes THIS function's output as a KEY, so a code it owns must survive
  // `apiErrorText` unchanged or the upload translator gets a sentence to look up
  // and finds nothing. Adding `unknown-session` here reds
  // "does not shadow any code the UPLOAD translator owns", measured. The
  // start-program sheet says what it needs to about those two in its own
  // sentence, where the session id is in scope anyway.
  'not-configured': 'This box does not run coordination — there is no mail store to queue a kickoff into.',
  'registry-unmeasurable': 'The session registry could not be read, so this box cannot say whether that session exists.',
  // Account pools (spec §5.6). Three codes, three different things the box
  // established — and NOT one sentence between them, because the remedies are
  // not the same: cross on purpose, fix a file on the fleet box, or type a
  // legal name. `unsupported` above already covers the 501 both pool routes
  // can answer with, so no fourth entry is added for it.
  //
  // None of these is a code `uploadErrorText`, `kickoffErrorText` or
  // `sendErrorText` owns — they consume this function's OUTPUT as a KEY, so a
  // sentence here for a code one of them owns would lose its wording. The
  // suite asserts that in both directions.
  'pool-mismatch': 'That account is in a different pool from this project. Use a flow that can disclose and confirm a pool crossing, or change the project\'s pool.',
  'pool-unreadable': 'The project\'s pool tag could not be read on the fleet host, so nothing here can decide. Fix or clear its file under ~/.cc-sessions/pools/ and try again.',
  'bad-pool-name': 'A pool name starts with a lowercase letter and holds only lowercase letters, digits and hyphens.',
};

/** `registry-unmeasurable`, read off the WORD (D-5971, #549, ARCH-11b). The
 *  server answers it at the table's 502 everywhere (`shared/refusal.ts`), and
 *  until then `server.ts` answered 503, so a reader that branched on the
 *  status rendered it as a box failure or as a reason it did not recognise.
 *  The four sheets that render it inline ask this BEFORE their status arms. */
export const isRegistryUnmeasurable = (err: unknown): boolean =>
  err instanceof ApiError && typeof err.body === 'object' && err.body !== null
  && (err.body as { error?: unknown }).error === 'registry-unmeasurable';

/** Human-readable failure text for a caught error.
 *
 *  Lifecycle send sites answer `{ ok:false, stderr }`; coded send sites answer
 *  `{ ok:false, error, ...fields }`. Those server shapes are disjoint, so these
 *  branches do not express precedence between two fields on one response. The
 *  bare message stays the floor. */
export function apiErrorText(err: unknown): string {
  if (err instanceof ApiError && typeof err.body === 'object' && err.body !== null) {
    const stderr = (err.body as { stderr?: unknown }).stderr;
    if (typeof stderr === 'string' && stderr.trim().length > 0) return stderr.trim();
    const code = (err.body as { error?: unknown }).error;
    if (code === 'pool-mismatch') {
      const { accountPool, projectPool } = err.body as {
        accountPool?: unknown;
        projectPool?: unknown;
      };
      if (typeof accountPool === 'string' && typeof projectPool === 'string') {
        return `The account pool (${accountPool}) differs from the project pool (${projectPool}).`;
      }
    }
    if (code === 'pool-unreadable') {
      const state = (err.body as { state?: unknown }).state;
      if (state === 'malformed') {
        return 'The project\'s pool tag contains an invalid pool name. Fix or clear its file under ~/.cc-sessions/pools/ and try again.';
      }
    }
    if (typeof code === 'string') {
      const text = API_ERROR_TEXT[code];
      if (text !== undefined) return text;
    }
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * `POST /api/sessions/:id/kickoff`'s own refusals (wave-4 review, MINOR 3,
 * D-1120). The fourth per-surface map in this file, composed exactly as
 * `useAttachImage.ts` composes the upload one: `kickoffErrorText(apiErrorText(err))`.
 *
 * WHY IT IS NOT MORE ENTRIES IN `API_ERROR_TEXT`. Three of the five codes that
 * route can answer with are OWNED by `uploadErrorText`, which consumes
 * `apiErrorText`'s OUTPUT as a KEY — so a sentence there hands the upload
 * translator a sentence to look up instead of a code, and its own upload
 * wording is lost. The suite says so in both directions, for all three
 * translators. Everything `API_ERROR_TEXT` already turns into a sentence passes
 * through here untouched, because a sentence matches no key.
 *
 * These are the sentences a phone shows above a retry button, so each says what
 * the box actually established and, where the answer is terminal, stops short of
 * implying a retry will help. `unknown-session` in particular used to reach the
 * operator as a bare slug inside a sentence that ALSO asserted the session was
 * running — the exact fact the registry had just denied.
 */
const KICKOFF_ERROR_TEXT: Record<string, string> = {
  'unknown-session': 'That session is no longer in the registry — nothing can be queued for it.',
  'bad-session-id': 'That session id is not one this box will accept.',
  // NOT "did not arrive": since the shared kickoff verdict, this code also
  // answers a name that DID arrive and was refused on its shape or length, and
  // a blank title. The server sends a `detail` naming which; `kickoffErrorText`
  // is the fallback for when it does not.
  'bad-request': 'That program name or title was refused — check the name is letters, numbers, '
    + 'underscores or hyphens and within the length limit, and that the title is not blank.',
  oversize: 'That program title is too long to send as mail — shorten it and start again.',
};

export const kickoffErrorText = (text: string): string => KICKOFF_ERROR_TEXT[text] ?? text;

/** Wave 8 item C: the no-bundle refusal's words, with the tag when the caller knows it (a release or node row) and
 *  without a literal placeholder when it does not (a 409 answered to a sheet or a toast). ONE spelling:
 *  UPDATE_ERROR_TEXT['no-bundle'] is this with `null`. */
export function noBundleRollbackText(tag: string | null): string {
  const how = tag === null
    ? 'On the node itself, ccrc rollback --to with that tag flips to a kept copy if the node keeps one; otherwise ccrc update --to with that tag, plus --downgrade --allow-unsigned, installs it.'
    : `On the node itself, ccrc rollback --to ${tag} flips to a kept copy if the node keeps one; otherwise ccrc update --to ${tag} --downgrade --allow-unsigned installs it.`;
  return `The catalogue lists no provenance bundle for ${tag ?? 'that release'} and the node’s install is verified, so it is not sent from here: a verified node refuses to download a release without --allow-unsigned, which a one-tap never passes. ${how} Tap Refresh if a bundle was published since the last poll, or pick a newer release.`;
}

/**
 * The update routes' refusals (W2 Task 13's route table), the sixth code table
 * in this file (after SEND, SUBMIT, UPLOAD, API and KICKOFF) — and the first
 * that is read CODE-FIRST rather than composed after `apiErrorText`
 * (D-3302).
 *
 * WHY NOT `updateText(apiErrorText(err))`, the way `kickoffErrorText` composes.
 * Two of these words already have owners: `not-configured` is `API_ERROR_TEXT`'s
 * kickoff sentence ("does not run coordination — there is no mail store to
 * queue a kickoff into"), which is false on this surface, and `bad-request` is
 * the upload and kickoff tables'. Composed after `apiErrorText`, the update
 * screen would show the kickoff sentence; composed into it, every other surface
 * would show the update one. Read first, against its own keys, each surface
 * says its own thing — and `apiErrorText` is the floor only for a code this
 * table does not own. It consumes no translator's output and no translator
 * consumes its output, so the shadowing the mutual-exclusion suite guards
 * cannot arise here; `api.test.ts` pins the other direction, that the five
 * existing tables pass every update-only word through unchanged.
 *
 * Keyed by W2's union: a word W2 adds to `UpdateRouteError` is a compile error
 * here until it has a sentence. `unauthenticated` is excluded, because a 401
 * raises the login screen through `request()` before any sentence matters.
 * `rate-limited` claims a REQUEST, never a landed answer: the route answers it
 * inside the route's derived `REFRESH_MIN_INTERVAL_MS` of the poller's last
 * request (`lastRequestAt()`, D-3203), which a failed request and the
 * scheduled poll both set, so `lastOkAt` may still be null — and nothing says
 * "checked" while it is (spec §18).
 */
const UPDATE_ERROR_TEXT: Record<Exclude<UpdateRouteError, 'unauthenticated'> | 'waiting-for-fleet', string> = {
  'not-configured': 'This box has no update control plane — it runs without a coordination database.',
  'bad-tag': 'That is not a release tag this server accepts — tags look like v0.0.9, with no leading zeros.',
  'bad-request': 'The server refused the shape of that request — reload the screen and try again.',
  'unknown-scope': 'That node has no identity yet — it follows the fleet setting until an install gives it one.',
  'unknown-node': 'That node is no longer in the inventory.',
  superseded: 'That node was reinstalled under a new identity — reload to see it.',
  // Shown for three different callers — the ack route's own 409, an apply/rollback 409, and an `{all}` skip —
  // so this sentence must read true in all three, not only the one it was first written for.
  busy: 'That node is in the middle of a move — wait for it to settle, then try again.',
  'auto-needs-rollback-gate': 'Auto-install needs the rollback gate on every node, and at least one does not carry it yet.',
  'rate-limited': 'GitHub was asked too recently — try again in a few minutes.',
  'no-channel': 'A stored channel is one this build cannot read — choose the channel again.',
  'journal-unreadable': 'The server cannot read its intent journal — nothing was changed.',
  'journal-unwritable': 'The server cannot write its intent journal — nothing was changed.',
  'unknown-tag': 'That tag is not a release this node can move to — choose one from the release list.',
  'not-newer': 'That release is not newer than what that node runs, or than its floor after a rollback — use Roll back to move it there.',
  'refused-by-node': 'That node refused this release when it failed verification — acknowledge the node to clear the refusal first.',
  'stamp-unread': 'That node’s build stamp could not be read, so nothing can say whether the release is newer — nothing was requested.',
  'floor-unread': 'That node’s floor has not been measured yet, so nothing can say whether the release is above it — nothing was requested.',
  // False on macOS, where `--detach` never exists: corrected to name both readings rather than the one that
  // assumes a Linux box behind an old ccrc.
  'no-detach-cap': 'That node’s ccrc predates the one-tap — update it once from its own shell — or it is macOS, which cannot be moved from here.',
  'no-rollback-cap': 'That node cannot roll back on request yet — update it once from its own shell.',
  'no-bundle': noBundleRollbackText(null),
  'agent-predates-update-op': 'That node’s agent predates the update op — update the node once by hand, then it can be moved from here.',
  // Programme wave 14, R15(b) (D-4268): names WHERE the remedy is. The operator read the earlier "acknowledge that
  // node" with the only Ack on another screen, labelled Ack, not "acknowledge".
  halted: 'An update failed or was reverted, and nothing moves until that node is acknowledged — tap Ack on it in the halt banner on the fleet screen, or on its row in Settings.',
  'no-previous': 'That node records no previous release to roll back to — pick a tag from the release list.',
  'no-desired': 'That node has no resolved release to install — choose a tag, or check its channel and pin.',
  // Never an HTTP 409 (the route answers it only through `{all: true}`'s per-node skip, never a single-node
  // move's own refusal) — a key `moveSkipText` needs that `updateErrorText`'s own table never looks up. The
  // skip holds EVERY non-fleet row (`dispatchRank` != 0) that is not itself halting — a server-role node and a
  // `role: null` one alike (a halting one is skipped `halted` first) — whenever a fleet row was itself skipped
  // busy or halted in the same call (D-3408).
  'waiting-for-fleet': 'Nothing was requested for that node — it is held behind a fleet node’s own move. Tap again once that node’s move settles or it is acknowledged.',
  // `satisfies` is what makes `moveSkipText`'s claim below true: the annotation above is keyed by
  // `UpdateRouteError`, which does not follow `MoveSkipWhy`, so without this a skip word added to `MoveSkipWhy`
  // alone would compile with no sentence. (`& Record<string, string>` keeps the extra keys legal.)
} satisfies Record<MoveSkipWhy, string> & Record<string, string>;

/** Operator-facing text for a failed update-route call: the code in
 *  `UPDATE_ERROR_TEXT` (OWN keys only — `Object.hasOwn`, so a body naming
 *  `toString` is not a code this table owns), else `apiErrorText`'s answer. */
export function updateErrorText(err: unknown): string {
  if (err instanceof ApiError && typeof err.body === 'object' && err.body !== null) {
    const code = (err.body as { error?: unknown }).error;
    if (typeof code === 'string' && Object.hasOwn(UPDATE_ERROR_TEXT, code)) {
      return UPDATE_ERROR_TEXT[code as keyof typeof UPDATE_ERROR_TEXT];
    }
  }
  return apiErrorText(err);
}

/** A raw wire word `UPDATE_ERROR_TEXT` has no sentence for, made printable rather than rendered raw — the same
 *  collapse `shared/agent-protocol.ts`'s `firstStderrLine` applies to a stderr line: every run outside printable
 *  ASCII (0x20–0x7E) becomes one space, the ends are trimmed, and the result is bounded so a long or hostile word
 *  cannot grow the sentence around it. */
function printableSkipWord(raw: string): string {
  const cleaned = raw.replace(/[^\x20-\x7e]+/g, ' ').trim();
  return (cleaned === '' ? '(blank)' : cleaned).slice(0, 40);
}

/** The sentence for a word `{all: true}`'s 202 skipped a node with (`MoveRequestAnswer.skipped`, programme wave 5).
 *  `MoveSkipWhy` is a subset of `UPDATE_ERROR_TEXT`'s keys, so this is the table's own sentence — the one a
 *  single-node 409 of the same word renders — and a MoveSkipWhy variant with no sentence is a compile error at
 *  `UPDATE_ERROR_TEXT`'s own definition.
 *
 *  Read with `Object.hasOwn`, never a bare index (review MINOR 2). The value arrives over the wire — additive
 *  discipline (README) means a CACHED OLDER PWA can face a NEWER server that skips for a word this build's
 *  `MoveSkipWhy` union does not carry — so `why`'s type also admits any string, the honest wire type. A bare
 *  `UPDATE_ERROR_TEXT[why]` would render the literal `"undefined"` for such a word, and would hand back the
 *  `Object.prototype` method itself for an inherited key such as `'toString'`; `hasOwn` refuses both, and the
 *  fallback names the raw word, made printable, rather than pretending nothing was skipped. */
export function moveSkipText(why: MoveSkipWhy | (string & {})): string {
  return Object.hasOwn(UPDATE_ERROR_TEXT, why)
    ? UPDATE_ERROR_TEXT[why as keyof typeof UPDATE_ERROR_TEXT]
    : `An update reason this build doesn't recognise (${printableSkipWord(why)}).`;
}

/**
 * ONE READER OF A REFUSAL CODE, against a table that owns it (ARCH-13b, #557). The code is `err.body.error` of an
 * `ApiError`, read with `Object.hasOwn` so a body naming `toString` is not a code any table owns. A code the table
 * does not own is `null`, never the raw code: the caller says what a refusal it cannot name looks like, which is how a
 * bare slug stops reaching a toast. Pair it with a `Record<Union, string>`, so a member the union gains without a
 * sentence is a compile error.
 */
export function refusalText<K extends string>(err: unknown, table: Readonly<Record<K, string>>): string | null {
  if (!(err instanceof ApiError) || typeof err.body !== 'object' || err.body === null) return null;
  const code = (err.body as { error?: unknown }).error;
  return typeof code === 'string' && Object.hasOwn(table, code) ? (table as Record<string, string>)[code]! : null;
}

/**
 * The interrupt route's refusals (`InterruptRefusal`, each a 409 with zero keys pressed), in the one sentence the
 * session screen has always toasted for all three: from the operator's chair they are the same fact, nothing is
 * running that Escape would stop. `background-only` has its own, richer toast when its body carries a readable count
 * (`backgroundOnlyRefusal`); this sentence is what an unreadable one falls back to, exactly as before.
 */
export const INTERRUPT_REFUSAL_TEXT: Readonly<Record<InterruptRefusal, string>> = {
  'not-alive': "Claude isn't working right now — nothing to stop",
  'not-busy': "Claude isn't working right now — nothing to stop",
  'background-only': "Claude isn't working right now — nothing to stop",
};

/**
 * The background work a `background-only` refusal names (ARCH-13a, `backgroundOnlyRefusal`), as one clause with no
 * framing: "2 background tasks (workflow) are still running", or "a background shell or monitor is still running" when
 * the body carries no count. The session screen frames it with what Escape would not stop, the approval's Deny with
 * "the request already resolved"; the count-and-kinds wording has this one owner.
 */
export function backgroundTasksClause(bg: { count: number | null; kinds: string[] }): string {
  if (bg.count === null) return 'a background shell or monitor is still running';
  return `${bg.count} background ${bg.count === 1 ? 'task' : 'tasks'}`
    + `${bg.kinds.length > 0 ? ` (${bg.kinds.join(', ')})` : ''} ${bg.count === 1 ? 'is' : 'are'} still running`;
}

/**
 * The coordinator's route door (`RunRouteRefuseCode`) in words. No screen renders these yet: the table exists so the
 * first one that does cannot ship a bare slug, and a code added to the union without a sentence is a compile error.
 */
export const RUN_ROUTE_REFUSAL_TEXT: Readonly<Record<RunRouteRefuseCode, string>> = {
  'no-session': 'That run has no session to change the model of.',
  'bad-session': 'That run names a session id this box will not accept.',
  'no-record': 'That session has no routing record yet, so there is nothing to change.',
  'unrouteable-record': 'That session\'s routing record holds a value the ladder does not know, so it is left alone.',
  'registry-unreadable': 'The session registry could not be read just now — try again in a moment.',
  'run-closed': 'That run is not in a state that can be re-routed.',
  ceiling: 'Already at the top of the ladder — nothing higher to move to.',
  floor: 'Already at the bottom of the ladder — nothing lower to move to.',
  'no-effort-rungs': 'That session runs a model with no effort setting — pick a model instead.',
  'fable-operator-only': 'That model is the operator\'s to select, not a coordinator\'s.',
};

/**
 * An ask answer's refusals (`AskRefuseCode`) in words, for the surfaces that answer a held question. Not rendered by
 * any screen yet (the sheets read `DIALOG_REFUSE_TEXT`, a different union); the table is the compile-time guard.
 */
export const ASK_REFUSE_TEXT: Readonly<Record<AskRefuseCode, string>> = {
  'not-alive': 'That session is not running.',
  'not-waiting': 'That session is not waiting on a question.',
  'stale-ask': 'That question has moved on — read the current one first.',
  'ask-mismatch': 'The answer does not match the question on screen.',
  'multi-question': 'That screen asks several questions at once and cannot be answered in one go.',
  range: 'That choice is outside the options offered.',
  multiselect: 'That question allows several choices — answer it as a set.',
  'duplicate-index': 'The same option was chosen twice.',
  'no-menu': 'There is no menu on screen to answer.',
  'menu-mismatch': 'The menu on screen is not the one this answer was written for.',
  'unknown-ask': 'No such question is held.',
  'not-held': 'That question is not held for an answer.',
  'ask-moved': 'The child repainted its question — read the current one and answer that.',
  'not-parent': 'Only the run\'s own coordinator can answer that question.',
  'child-unmeasurable': 'This box could not read the child, so nothing can say whether the question changed.',
  declined: 'That question was released by the coordinator, so it cannot be answered later.',
  'already-answered': 'That question was already answered.',
};

/** An account-pool write's refusals (`SetAccountPoolsRefuseCode`) in words. No screen renders it yet. */
export const SET_ACCOUNT_POOLS_REFUSAL_TEXT: Readonly<Record<SetAccountPoolsRefuseCode, string>> = {
  'multi-pool-not-supported': 'An account can be in only one pool.',
};

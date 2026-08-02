// The chat header's pull-request control.
//
// It renders for EVERY workspace session, unconditionally — before the first
// sweep, during a gh outage, and while the agent link is down. Keying its
// visibility on `pr !== null` would make its absence an affirmative claim
// ("this session cannot have a PR") rendered identically to "we have not
// looked", and would hide Retry behind a control that is not on screen.
//
// A tap does exactly one thing in every state: open the sheet. No state of the
// cap performs an action, so a misread badge can never cost anything.
import type { ReactNode } from 'react';
import type { PrChecks, PrState } from '../../../shared/api';
import './chat.css';

/** The fallback for "we have not looked yet". Exported because `PrSheet` needs
 *  the identical object and a second copy would drift. */
export const UNCHECKED_PR: PrState = {
  phase: 'unchecked', number: null, url: null, title: null, checks: null, checkNames: null,
  ahead: 0, reason: null, checkedAt: null, mergedAt: null, retryAt: null,
};

/** '2m' | '3h' | '5d', or null under a minute. */
function rel(then: number | null): string | null {
  if (then === null) return null;
  const m = Math.floor(Math.max(0, Date.now() - then) / 60_000);
  if (m < 1) return null;
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

/** The legend on the cap: a number once we have one, `PR` otherwise. In
 *  `unknown` the LAST known number stays — greying out the one fact we still
 *  hold would be a second loss on top of the failed read. */
export function prLegend(pr: PrState): string {
  return pr.number === null ? 'PR' : `#${pr.number}`;
}

/** Status is never colour-only: this glyph rides beside the dot, and the sheet
 *  repeats it as a text line. */
const CHECK_GLYPH: Record<Exclude<PrChecks, null>, string> = {
  pass: '✓', fail: '✕', pending: '▲',
};

const REASON_TEXT: Record<NonNullable<PrState['reason']>, string> = {
  timeout: 'GitHub did not answer in time.',
  offline: 'The sessions box could not reach GitHub.',
  unauthenticated: "GitHub CLI isn't logged in on the sessions box. Run `gh auth login` there.",
  'rate-limit': 'GitHub is rate-limiting this token.',
  'no-remote': 'This project has no `origin` remote.',
  unsupported: 'The fleet host is running a ccd that does not have this verb yet.',
  'agent-down': 'ccrc could not reach the sessions box.',
  error: 'GitHub could not be read.',
  // The one reason that is NOT a failed read: GitHub answered, and said merged.
  // So this copy must not blame the connection — it says what is missing and
  // implies the safe consequence (ccrc will not offer cleanup on this).
  'merge-unproven': 'GitHub reports this merged but named no usable merge commit, so ccrc will not call it merged.',
};

/** Task 3 review finding 9's docket: the registry persists `prPhase` and
 *  `prNumber` across a restart but not `reason` (registry.ts / fleet.ts's
 *  `persistedPr`), so a cold-started server rebuilds `{phase: 'unknown',
 *  reason: null}` even when the live read had a real reason — including
 *  `merge-unproven`, which is not a failed read at all. Defaulting a null
 *  reason to `REASON_TEXT.error` ("GitHub could not be read") would be an
 *  outright lie in that case and a guess in every other one, so a null reason
 *  gets its own honest-stale sentence instead of silently borrowing 'error'. */
function unknownReasonText(reason: PrState['reason']): string {
  return reason === null
    ? 'GitHub was checked before, but the reason was not kept across a restart.'
    : REASON_TEXT[reason];
}

/** The whole sentence, used as the aria-label here and as the sheet's lede. */
export function prSentence(pr: PrState, branch?: string): string {
  const since = rel(pr.checkedAt);
  // Lowercase: this clause continues the sentence started by the reason text
  // above it (which already ends in its own '.'), not a fresh one.
  const stale = since === null ? '' : ` last checked ${since} ago.`;
  switch (pr.phase) {
    case 'unchecked':
      return 'Pull request: not checked yet.';
    case 'no-commits':
      return `Pull request: \`${branch ?? 'this branch'}\` has no commits past its base.`;
    case 'none':
      return 'Pull request: no pull request yet.';
    case 'draft':
      return `Pull request #${pr.number ?? '?'}: draft.${checkText(pr)}`;
    case 'open':
      return `Pull request #${pr.number ?? '?'}: open.${checkText(pr)}`;
    case 'merged': {
      const ago = rel(pr.mergedAt);
      return `Pull request #${pr.number ?? '?'}: merged${ago === null ? '' : ` ${ago} ago`}.`;
    }
    case 'closed':
      return `Pull request #${pr.number ?? '?'}: closed without merging. This branch's commits are not on main.`;
    case 'unknown':
      return `Pull request: ${unknownReasonText(pr.reason)}${retryText(pr.retryAt)}${stale}`;
  }
}

/** The same sentence, as a native `title` renders it.
 *
 *  Fix round 3, verifier P6. Reusing `prSentence`'s output verbatim as a
 *  tooltip (final-round integration finding 5's de-duplication) regressed the
 *  copy in two ways a `title` attribute cannot help: it is PLAIN TEXT, so the
 *  markdown ticks that mark up a branch name for the lede's own presentation
 *  render as literal backticks; and the bare "Pull request: " opener repeats a
 *  subject the sheet's eyebrow, heading and visible lede have all established
 *  already. Both are dropped here — derived from the one sentence, never a
 *  second hand copy, which is what finding 5 was about.
 *
 *  A NUMBERED opener ("Pull request #42: ") is kept: the number is information
 *  the tooltip's own context does not otherwise carry. */
export function tooltipSentence(sentence: string): string {
  return sentence.replace(/^Pull request: /, '').replace(/`/g, '');
}

/** ' Retrying in 12m.' — §6's rate-limit row promises reason AND retry time,
 *  and a flat 15-minute silence with only a reason reads as broken rather than
 *  as waiting. Empty when nothing is scheduled: a route-level read failure
 *  backs nothing off, so `retryAt` is null there and this says nothing rather
 *  than inventing a time. */
function retryText(retryAt: number | null): string {
  if (retryAt === null) return '';
  const ms = retryAt - Date.now();
  if (ms <= 0) return ' Retrying now.';
  return ` Retrying in ${Math.ceil(ms / 60_000)}m.`;
}

/** THE words for a CI state, without their terminal period. Every rendering of
 *  a PR's checks anywhere in the pwa comes from this record — `prSentence`'s
 *  embedded clause below, and `PrSheet`'s own `.pr-checkline`, which used to
 *  carry a hand-written four-way copy of exactly these four strings and had
 *  already drifted from them ("no checks configured" vs "No checks
 *  configured."). Re-syncing the words would only have reset the clock; the
 *  point of the record is that there is no second place to edit. */
const CHECK_PHRASE: Record<'none' | Exclude<PrChecks, null>, string> = {
  none: 'No checks configured',
  pass: 'Checks passing',
  pending: 'Checks running',
  fail: 'Checks failing',
};

/** The checks clause as its own sentence — `PrSheet`'s check line.
 *
 *  The failing-check NAMES are deliberately not here: `PrSheet` renders them
 *  in a dedicated inert block below the line (`.pr-check-names`), and putting
 *  them in both would print the same GitHub-sourced text twice on one screen.
 *  `checkText` below appends them for the one-line sentence form, which has no
 *  such block.
 *
 *  MUTATION SURVIVOR, disclosed, on `pr.checks ?? 'none'` (same shape as this
 *  file's other one): `PrChecks` is `'pass' | 'fail' | 'pending' | null`, four
 *  values of which exactly one is falsy and it is `null`, so `??` and `||` act
 *  on identical inputs and no distinguishing call can exist. Kept as `??`
 *  because the intent is "no checks were reported", not "the report looks
 *  empty". */
export function checkPhrase(pr: PrState): string {
  return `${CHECK_PHRASE[pr.checks ?? 'none']}.`;
}

function checkText(pr: PrState): string {
  const names = pr.checks === 'fail' && pr.checkNames?.length ? `: ${pr.checkNames.join(', ')}` : '';
  return ` ${CHECK_PHRASE[pr.checks ?? 'none']}${names}.`;
}

export function PrKeycap({ pr, onOpen }: { pr: PrState | null; onOpen: () => void }): ReactNode {
  // MUTATION SURVIVOR, disclosed: `??` here is swappable for `||` with the
  // suite green, and no test can ever distinguish them. `pr` is
  // `PrState | null`, and a `PrState` is an object — so the only falsy values
  // the parameter can hold are `null` and `undefined`, exactly the two `??`
  // acts on. A distinguishing input would have to be falsy AND non-nullish
  // (`0`, `''`, `NaN`), which the type forbids at every call site. Kept as
  // `??` rather than `||` because the intent is "substitute when we have no
  // state", not "substitute when the state looks empty" — a distinction that
  // would start to matter the day `PrState` grows a falsy representation.
  const state = pr ?? UNCHECKED_PR;
  const glyph = state.checks === null ? null : CHECK_GLYPH[state.checks];
  return (
    <button
      type="button"
      className="keycap keycap--pr"
      data-phase={state.phase}
      data-checks={state.checks ?? undefined}
      aria-label={prSentence(state)}
      onClick={onOpen}
    >
      <span className="pr-dot" aria-hidden="true" />
      <span className="pr-legend">{prLegend(state)}</span>
      {glyph !== null && <span className="pr-glyph" aria-hidden="true">{glyph}</span>}
    </button>
  );
}

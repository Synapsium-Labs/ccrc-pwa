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

function checkText(pr: PrState): string {
  if (pr.checks === null) return ' No checks configured.';
  if (pr.checks === 'pass') return ' Checks passing.';
  if (pr.checks === 'pending') return ' Checks running.';
  return ` Checks failing${pr.checkNames?.length ? `: ${pr.checkNames.join(', ')}` : ''}.`;
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

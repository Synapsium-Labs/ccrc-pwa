// Settings › Security (settings spec §3.3, §5.5; D-5503): the Sign-in gate card (`SignInGateCard.tsx`), then Your
// sign-in and This session (`YourSignInCard.tsx`, `ThisSessionCard.tsx`; from Accounts, R2d, D-5508), then the Box
// token card, then the Linear card (named workspaces S4b), each a `Section` with its scope. The slot before Box token
// is reserved for "Recent account changes".
// The auth status, the passkey list and the Linear connection the cards show are the frame's reads.
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { UpdatesView } from '../../../../shared/api';
import { Button, Section, Skeleton, useNow } from '@ccrc/ui';
import { BOX_TOKEN_CARD, ResultLine, SETTINGS_AMBER_NOTE, SETTINGS_WHEN, useResultLine } from '../../fleet/settingsText';
import type { UpdatesPoll } from '../../fleet/useUpdatesView';
import { isPlaceableInstant } from '../../fleet/updatesRead';
import { armedMode } from '../../lib/auth';
import { ApiError, api, apiErrorText, readBoxTokenView } from '../../lib/api';
// `dayClock` and `elapsedWords` come THROUGH the update plane's reading
// surface, which is where the twenty wire-row-to-sentence helpers moved: the
// box-token card landed on main while that move was happening on this branch,
// and it reads two of the same clocks.
import type { RotateAnswer } from '../../../../shared/box-token';
import { TOKEN_ROTATION_INTERVAL_MS } from '../../../../shared/box-token';
// The update plane's reading surface moved to a file of its own; this screen
// composes it. `ACK_UNREADABLE_TEXT`/`canAck` come THROUGH it because
// `NodeItem` is their consumer — see that file's header.
import { dayClock, elapsedWords } from '../updates';
import '../../fleet/fleet.css';
import type { AuthRead, PasskeysRead } from './SettingsDataProvider';
import type { LinearPoll } from '../../fleet/useLinearConnection';
import { LinearSection } from '../LinearSection';
import { SignInGateCard } from './SignInGateCard';
import { ThisSessionCard } from './ThisSessionCard';
import { YourSignInCard } from './YourSignInCard';
import {
  BOX_TOKEN_FLEET_TEXT, BOX_TOKEN_TEXT, boxTokenHoldText, boxTokenStateText, boxTokenSummary, boxTokenTransportText, spanWords,
  type BoxTokenTone,
} from './boxTokenWords';

// ── The box-token card (box-token lifecycle wave 1, Task B6; spec 4.7, D-4392) ──
// A THIRD section, over the same one /api/updates poll: `view.boxToken`, read
// through `readBoxTokenView` (lib/wireReaders.ts) and nothing else. Three rules it keeps,
// each pinned in box-token-card.test.tsx:
//   * THE SERVER'S WORDS ARE WHAT IS SHOWN. Phase, hold, owed reason, failure
//     word and fleet word are the driver's; this block only puts them into
//     sentences, keyed by the L0 types so a new word is a compile error here.
//   * ABSENT AND MALFORMED ARE TWO SENTENCES. An older server sends no field; a
//     field this build cannot read is "not reported". Neither offers the button.
//   * NO VALUE, CODE OR HASH. The view carries none, and nothing here derives one.
// "Rotate now" is the session-only `POST /api/token/rotate`; its refusals are
// answers said in place, and the card re-polls after every tap.

const BOX_TOKEN_ABSENT_TEXT = 'This server reports no box-token state.';
const BOX_TOKEN_UNREADABLE_TEXT = "Box-token state: not reported (the server's answer could not be read).";
const ROTATE_UNREADABLE_TEXT = "Asked — the server's answer could not be read; the card will re-check.";

function rotateAnswerText(a: RotateAnswer | 'unreadable'): string {
  if (a === 'unreadable') return ROTATE_UNREADABLE_TEXT;
  if (a.ok) return a.outcome === 'started' ? 'Rotation started.' : 'Joined the rotation already running.';
  if (a.error === 'held') return `Not started — ${boxTokenHoldText(a.hold, a.node)}`;
  if (a.error === 'rate-limited') return `At most one Rotate now a minute — try again in ${a.retryAfterS} s.`;
  return 'This server runs no box-token driver.';
}

// ── Settings Task R1d: the card's shape (spec §5.5; D-5503's words, D-5507's rule that Rotate stays one tap) ──
// A definition, one summary sentence, today's key/value lines folded behind "Details", and Rotate now alone at the
// foot after a hairline, with its note, its when-line and its answer as the card's result line. The hold and state
// sentences (`boxTokenWords.ts`) and the answer sentences above are read by name, never retyped. Rotate now opens no
// 401 window and keeps the old key until the fleet box confirms (box-token design G3), so it stays a one-tap ghost:
// no confirm, no danger tone.

/** The summary's ink, from classes the page already carries: the note's secondary, the inline-refusal amber, and the
 *  page's one red sentence (`.settings-unarmed`, self-grounded), so no colour-bearing rule is added. */
const SUMMARY_CLASS = { calm: 'settings-note', amber: SETTINGS_AMBER_NOTE, red: 'settings-unarmed' } as const satisfies
  Record<BoxTokenTone, string>;

/** "key: value" said as a key and a value: today's lines, split at their first ": ". */
const keyValue = (line: string): [string, string] => {
  const at = line.indexOf(': ');
  return [line.slice(0, at), line.slice(at + 2)];
};

function BoxTokenSection({ view, now, reload }: { view: UpdatesView; now: number; reload: () => void }): ReactNode {
  const [busy, setBusy] = useState(false);
  const result = useResultLine();
  const v = view.boxToken === undefined ? undefined : readBoxTokenView(view.boxToken);

  // One tap, one POST, no confirm (box-token design G3). Its answer, a refusal or a failure is the line under it.
  const rotate = (): void => {
    setBusy(true);
    result.clear();
    void api.rotateBoxToken()
      .then(
        (a) => result.say(rotateAnswerText(a), a === 'unreadable' || a.ok ? 'answer' : 'refusal'),
        // A 401 brings up the login screen, which is the answer: no stale line waits behind it.
        (err: unknown) => { if (!(err instanceof ApiError && err.status === 401)) result.say(apiErrorText(err), 'refusal'); },
      )
      .finally(() => { setBusy(false); reload(); });
  };

  let body: ReactNode;
  if (v === undefined) body = <p className="settings-note">{BOX_TOKEN_ABSENT_TEXT}</p>;
  else if (v === null) body = <p className="settings-note">{BOX_TOKEN_UNREADABLE_TEXT}</p>;
  else {
    const lines: string[] = [`state: ${boxTokenStateText(v)}`];
    lines.push(v.currentSeq !== null && v.currentSince !== null && isPlaceableInstant(v.currentSince)
      ? `current value: generation #${v.currentSeq}, ${elapsedWords(now - v.currentSince)} old${v.origin === 'adopted' ? ' (hand-made, adopted)' : ''}`
      : 'current value: none');
    lines.push(v.lastRotationAt !== null && isPlaceableInstant(v.lastRotationAt)
      ? `last rotation: ${elapsedWords(now - v.lastRotationAt)} ago` : 'last rotation: never');
    if (v.rotationOwed) lines.push(`rotation owed: ${v.owedWhy ?? 'unspecified'}`);
    lines.push(`fleet: ${BOX_TOKEN_FLEET_TEXT[v.fleetConfirmed]}`);
    lines.push(boxTokenTransportText(v.fleetTransport));
    if (v.lastSync !== null) lines.push(`last sync: ${v.lastSync.word} · ${dayClock(v.lastSync.at, now)}`);
    // Two facts, so two rows (R1d): one line held both before Details split each into a key and a value.
    lines.push(`previous still presented: ${v.previousPresented}`);
    lines.push(`retired value presented: ${v.retiredPresented}`);
    // Spec 10.3's proof that the leak is retired, shown where the coordinator reads it (plan assembly).
    lines.push(`retired value refused: ${v.retiredRefused ? 'yes' : 'not yet'}`);
    if (v.lastBootRecovery !== null) {
      lines.push(`recovered at boot: from the ${v.lastBootRecovery.source} file, ${dayClock(v.lastBootRecovery.at, now)}`);
    }
    if (v.fileProblem !== null) {
      lines.push(`server token file: ${v.fileProblem.file} ${v.fileProblem.word} on re-read (the last good value is kept), ${dayClock(v.fileProblem.at, now)}`);
    }
    // One alert: three failures, or a stall that no failure counts (a hold standing for a day, a failed mint). Wave 1's
    // doctor reports these as SKIP, which no exit code sees (plan assembly, review: the downside of the arms off).
    const alert = v.banner
      ? `Box-token rotation has failed ${v.failures} times in a row (last: ${v.lastFailure ?? 'unknown'}).`
      : v.stalled?.why === 'mint-failed'
        ? 'The server could not mint a box token; every box-token call is refused until a mint succeeds.'
        : v.stalled?.why === 'owed'
          ? `A box-token rotation has been owed${isPlaceableInstant(v.stalled.since) ? ` for ${elapsedWords(now - v.stalled.since)}` : ''} and has not completed${v.hold !== null ? ` (${boxTokenHoldText(v.hold, v.holdNode)})` : ''}.`
          : null;
    const summary = boxTokenSummary(v, now);
    body = (
      <>
        {alert !== null && (
          <div className="settings-unarmed" role="alert">{alert}</div>
        )}
        <p className={SUMMARY_CLASS[summary.tone]} data-box-token="summary">{summary.text}</p>
        {/* Today's lines, unchanged in fact: sans keys, mono values that wrap rather than scroll. The fold is the
            release row's (`.settings-release-fold`: the tap-floored summary and its chevron); the grid and the
            wrap are inline layout with no colour, as R1c's Quiet time cap is, so no stylesheet changes (D-5614). */}
        <details className="settings-release-fold" data-box-token="details">
          <summary className="settings-note">Details</summary>
          <dl style={{ display: 'grid', gap: 'var(--sp-1)', margin: 0 }}>
            {lines.map(keyValue).map(([k, val]) => (
              <div key={k}>
                <dt className="settings-note">{k}</dt>
                <dd className="settings-catalogue" style={{ margin: 0, overflowWrap: 'anywhere' }}>{val}</dd>
              </div>
            ))}
          </dl>
        </details>
        {/* The foot: Rotate now alone after a hairline (D-5614: inline, naming the section rule's own token). */}
        <div
          data-box-token="foot"
          style={{
            display: 'grid', gap: 'var(--sp-2)', paddingTop: 'var(--sp-3)',
            borderTopWidth: 1, borderTopStyle: 'solid', borderTopColor: 'var(--edge-subtle)',
          }}
        >
          {/* `<Button variant="ghost">`, not a hand-written `btn-ghost`: the
              class belongs to the primitive, and the SAME screen's *Check now*
              two sections down is already written this way. The hand-written
              form arrived with the box-token card on main and this branch's two
              new guards both named it on the merge — control-census as an
              unregistered hand-drawn control, and the skin-constant guard as a
              class the Button primitive owns. */}
          <Button variant="ghost" className="settings-check" disabled={busy} onClick={rotate}>
            Rotate now
          </Button>
          <ResultLine line={result.line} />
          <p className="settings-note">{BOX_TOKEN_TEXT.rotateNote}</p>
          <p className={SETTINGS_WHEN}>{BOX_TOKEN_TEXT.rotateWhen}</p>
        </div>
      </>
    );
  }
  return (
    <Section
      level={3} scope={BOX_TOKEN_CARD.scope} title={BOX_TOKEN_CARD.title}
      purpose={<span data-box-token="purpose">{BOX_TOKEN_TEXT.purpose(spanWords(TOKEN_ROTATION_INTERVAL_MS))}</span>}
    >
      {body}
    </Section>
  );
}

/** The Security page's body (the heading is the frame's `<h2>`): the Sign-in gate card over the frame's one status
 *  read; Your sign-in and This session while that read says the gate is armed (absent while it is off, unread or
 *  pending, the gate card saying why: spec §5.5's table); then the Box token card over its one /api/updates poll; then
 *  the Linear card over the frame's one Linear read. */
export function SecuritySection({ poll, auth, passkeys, refreshAuth, linear }: {
  poll: UpdatesPoll; auth: AuthRead; passkeys: PasskeysRead; refreshAuth: () => void; linear: LinearPoll;
}): ReactNode {
  const now = useNow(30_000);
  return (
    <>
      <SignInGateCard auth={auth} />
      {auth.kind === 'read' && armedMode(auth.status.mode) && (
        <>
          <YourSignInCard status={auth.status} passkeys={passkeys} refreshAuth={refreshAuth} />
          <ThisSessionCard />
        </>
      )}
      {poll.view !== null ? (
        <BoxTokenSection view={poll.view} now={now} reload={poll.reload} />
      ) : poll.failure === null ? (
        // Before the first read lands, a skeleton rather than nothing; a failed or absent read draws no card, as
        // today's page drew none then.
        <Skeleton lines={3} />
      ) : null}
      {/* The Linear key is a credential the box holds, like the box token, so its card follows it: last, after the
          reserved "Recent account changes" slot and Box token (spec §3.3), which adding it reshuffles nothing of. It
          reads its own endpoint, so it does not wait on /api/updates. */}
      <LinearSection poll={linear} />
    </>
  );
}

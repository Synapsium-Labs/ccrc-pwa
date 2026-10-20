// Settings › Security (settings spec §3.1; D-5503): the Box token card, and the sign-in gate's unarmed-exposure
// paragraph, which the frame draws at the top of every Settings page as today's page drew it at its top. Settings
// Task R2b1 moved both here from `SettingsScreen.tsx` unchanged; the auth status they read is the frame's.
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import type { AuthStatus, UpdatesView } from '../../../../shared/api';
import { LOOPBACK_HOSTS } from '../../../../shared/base-url';
import { Button, Skeleton, elapsedShort, useNow } from '@ccrc/ui';
import { ResultLine, SETTINGS_AMBER_NOTE, useResultLine } from '../../fleet/settingsText';
import { isPlaceableInstant, type UpdatesPoll } from '../../fleet/useUpdatesView';
import { ApiError, api, apiErrorText, readBoxTokenView } from '../../lib/api';
// `dayClock` and `elapsedWords` come THROUGH the update plane's reading
// surface, which is where the twenty wire-row-to-sentence helpers moved: the
// box-token card landed on main while that move was happening on this branch,
// and it reads two of the same clocks.
import type { BoxTokenView, RotateAnswer, TokenHold } from '../../../../shared/box-token';
import { TOKEN_ROTATION_INTERVAL_MS } from '../../../../shared/box-token';
// The update plane's reading surface moved to a file of its own; this screen
// composes it. `ACK_UNREADABLE_TEXT`/`canAck` come THROUGH it because
// `NodeItem` is their consumer — see that file's header.
import { dayClock, elapsedWords } from '../updates';
import '../../fleet/fleet.css';
import type { AuthRead } from './SettingsDataProvider';

// THE UNARMED-EXPOSURE BANNER (spec §12) sits above every Settings page (the frame draws it). Its trigger
// is `AuthStatus.mode === 'off'` from the unauthenticated GET /api/auth/status
// (D-3298 — /health reports no gate state), AND a
// page origin whose hostname is not one of shared/base-url.ts's
// LOOPBACK_HOSTS: the one list of loopback spellings, reused rather than
// re-spelled (single-definition.test.ts's LOOP_SET scan holds that). Every
// non-answer draws NOTHING — a failed read, an older server with no route, a
// body without `mode` — because a red banner is a claim about this box, and a
// status read that told us nothing is not evidence of an open gate.

/** The ONE spelling of the §12 sentence (the W4 doctor check will name the same route). */
export const UNARMED_EXPOSURE_TEXT =
  "The sign-in gate is off and this page was reached over a non-loopback address — anyone who can reach it can "
  + 'change what the fleet installs, and POST /api/updates/apply will let them install it. Arm the gate: '
  + 'CCRC_AUTH=on with CCRC_RP_ID and CCRC_ORIGIN, together (ccrc expose writes all three).';

/** (D-3298) true iff status?.mode === 'off' exactly AND !LOOPBACK_HOSTS.includes(hostname). */
export function unarmedExposure(status: Partial<AuthStatus> | null, hostname: string): boolean {
  return status?.mode === 'off' && !LOOPBACK_HOSTS.includes(hostname);
}

/** The paragraph, over the frame's one status read (`SettingsDataProvider`'s `auth`, once per mount, the
 *  AccountsScreen `AuthSection` shape). Every non-answer draws nothing: pending, failed, or a body without `mode`. */
export function UnarmedExposureBanner({ auth }: { auth: AuthRead }): ReactNode {
  const status = auth.kind === 'read' ? auth.status : null;
  if (!unarmedExposure(status, location.hostname)) return null;
  return <div className="settings-unarmed" role="alert">{UNARMED_EXPOSURE_TEXT}</div>;
}

// ── The box-token card (box-token lifecycle wave 1, Task B6; spec 4.7, D-4392) ──
// A THIRD section, over the same one /api/updates poll: `view.boxToken`, read
// through `readBoxTokenView` (lib/api.ts) and nothing else. Three rules it keeps,
// each pinned in box-token-card.test.tsx:
//   * THE SERVER'S WORDS ARE WHAT IS SHOWN. Phase, hold, owed reason, failure
//     word and fleet word are the driver's; this block only puts them into
//     sentences, keyed by the L0 types so a new word is a compile error here.
//   * ABSENT AND MALFORMED ARE TWO SENTENCES. An older server sends no field; a
//     field this build cannot read is "not reported". Neither offers the button.
//   * NO VALUE, CODE OR HASH. The view carries none, and nothing here derives one.
// "Rotate now" is the session-only `POST /api/token/rotate`; its refusals are
// answers said in place, and the card re-polls after every tap.

const BOX_TOKEN_HOLD_TEXT: Record<TokenHold, (node: string | null) => string> = {
  'update-in-flight': (n) => `an update is in flight on ${n ?? 'a node'}`,
  'agent-predates-op': () => 'fleet agent predates token-sync',
  'verb-missing': (n) => `release not yet on ${n ?? 'the fleet box'} (its ccrc has no token verb)`,
  'stale-client': (n) => `a stale ccrc-api on ${n ?? 'the fleet box'}`,
  'fleet-rows': () => 'not exactly one reachable fleet node',
  'node-id-unmeasured': (n) => `the node id of ${n ?? 'the fleet box'} is not measured`,
  'link-down': () => 'the agent link is down',
  'pending-cap': () => 'the handed-out values at the cap still await confirmation',
  'no-coord': () => 'no coordination database',
  'role-unrecorded': () => "this box's role is not recorded as both (CCRC_ROLE in ~/.ccrc/ccrc.env)",
  'mint-failed': () => 'the server could not mint a value',
};

/** "held: …", the card's spelling of the server's hold word (spec 4.7's own examples). */
export function boxTokenHoldText(hold: TokenHold, node: string | null): string {
  return `held: ${BOX_TOKEN_HOLD_TEXT[hold](node)}`;
}

export function boxTokenStateText(v: BoxTokenView): string {
  switch (v.phase) {
    case 'unconfigured': return 'no current value';
    case 'idle': return 'idle';
    case 'staged': return 'rotating (a new value is staged)';
    case 'handed-out': return 'rotating (handed out, awaiting the fleet box)';
    case 'promoting': return 'rotating (promoting)';
    case 'grace': return 'grace (the previous value is still accepted)';
    case 'held': return v.hold !== null ? boxTokenHoldText(v.hold, v.holdNode) : 'held';
    case 'failed': return `failed (${v.lastFailure ?? 'unknown'})`;
  }
}

/** Plain http is said as unencrypted and still rotates (R2); `unmeasured` is never folded into https. */
export function boxTokenTransportText(t: BoxTokenView['fleetTransport']): string {
  if (t === null) return 'transport: no sync yet';
  if (t === 'unmeasured') return 'transport: not measured';
  return t === 'http' ? 'transport: http (unencrypted)' : 'transport: https';
}

const BOX_TOKEN_FLEET_TEXT: Record<BoxTokenView['fleetConfirmed'], string> = {
  current: 'confirmed the current generation',
  // `behind` says only what the server's word means: the fleet's generation read is not the current id (review 362 F3).
  // It may hold an older generation or, mid-promotion, a newer one; the card never says which.
  behind: 'not on the current generation',
  absent: 'no generation recorded on the fleet box',
  unreadable: "the fleet box's generation file could not be read",
  'own-write': 'this box writes the fleet copy itself',
  unknown: 'not yet measured',
};

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
// foot after a hairline, with its note, its when-line and its answer as the card's result line. The hold, state and
// answer sentences above are read by name, never retyped. Rotate now opens no 401 window and keeps the old key until
// the fleet box confirms (box-token design G3), so it stays a one-tap ghost: no confirm, no danger tone.

const SPAN_UNIT: Readonly<Record<string, string>> = { m: 'minute', h: 'hour', d: 'day' };

/** "2 days", "5 hours", "40 minutes", "moments": `elapsedShort`'s one-unit ladder, said in words. */
function spanWords(ms: number): string {
  const short = elapsedShort(ms);
  if (short === null) return 'moments';
  const n = Number(short.slice(0, -1));
  return `${n} ${SPAN_UNIT[short.slice(-1)] ?? short.slice(-1)}${n === 1 ? '' : 's'}`;
}

/** The card's words (spec §5.5). The interval is `TOKEN_ROTATION_INTERVAL_MS`, said in words at render, never typed:
 *  `box-token-card.test.tsx` runs against a 3-day fixture of it. The note names no interval (D-5615). */
const BOX_TOKEN_TEXT = {
  purpose: (interval: string): string => 'The key that sessions and tools on the fleet box use to call this server, '
    + `for mail and coordination. The server makes a new one every ${interval} and hands it to the fleet box itself. `
    + 'The old key keeps working until the fleet box confirms the new one, so nothing restarts or drops.',
  handedOut: 'Rotating: waiting for the fleet box to confirm. The old key still works.',
  rotateNote: 'Starts a rotation now instead of waiting for the next scheduled one. Nothing restarts; the old key keeps '
    + 'working until the fleet box confirms.',
  rotateWhen: 'You think the key has leaked.',
} as const;

const sentenceCase = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

/** The summary's ink, from classes the page already carries: the note's secondary, the inline-refusal amber, and the
 *  page's one red sentence (`.settings-unarmed`, self-grounded), so no colour-bearing rule is added. */
const SUMMARY_CLASS = { calm: 'settings-note', amber: SETTINGS_AMBER_NOTE, red: 'settings-unarmed' } as const;

/** One sentence from the view. "Healthy" only in `idle` with the fleet confirmed (`current`, or `own-write`: this box
 *  writes the fleet copy itself) and nothing owed, stalled, failing, tampered with or leaked. Amber for `held` or `behind`, red for `failed`,
 *  each with its word, from today's state sentences. */
export function boxTokenSummary(v: BoxTokenView, now: number): { text: string; tone: keyof typeof SUMMARY_CLASS } {
  if (v.phase === 'failed') return { text: sentenceCase(boxTokenStateText(v)), tone: 'red' };
  if (v.phase === 'held') return { text: sentenceCase(boxTokenStateText(v)), tone: 'amber' };
  if (v.phase === 'handed-out') return { text: BOX_TOKEN_TEXT.handedOut, tone: 'calm' };
  if (v.phase !== 'idle') return { text: sentenceCase(boxTokenStateText(v)), tone: 'calm' };
  if (v.fleetConfirmed === 'behind') return { text: `Behind: fleet ${BOX_TOKEN_FLEET_TEXT.behind}`, tone: 'amber' };
  // A tamper or leak signal is never folded under "Healthy" (D-5503: never optimistic; R1d review). The driver owes no
  // rotation for a file problem and bounds a retired presentation's owed rotation to one an hour, so an idle,
  // confirmed card can carry either; each names its fact here, in amber, as well as in Details.
  const check: string[] = [];
  if (v.fileProblem !== null) check.push(`server token file ${v.fileProblem.file} ${v.fileProblem.word} on re-read`);
  if (v.retiredPresented > 0) {
    check.push(`retired value presented ${v.retiredPresented} time${v.retiredPresented === 1 ? '' : 's'}`);
  }
  if (check.length > 0) return { text: `Check: ${check.join(' · ')}`, tone: 'amber' };
  const confirmed = v.fleetConfirmed === 'current' || v.fleetConfirmed === 'own-write';
  if (!confirmed || v.rotationOwed || v.stalled !== null || v.banner) {
    const parts = ['Idle'];
    if (v.rotationOwed) parts.push(`rotation owed: ${v.owedWhy ?? 'unspecified'}`);
    parts.push(`fleet: ${BOX_TOKEN_FLEET_TEXT[v.fleetConfirmed]}`);
    return { text: parts.join(' · '), tone: 'calm' };
  }
  const parts = ['Healthy'];
  parts.push(v.lastRotationAt !== null && isPlaceableInstant(v.lastRotationAt)
    ? `rotated ${spanWords(now - v.lastRotationAt)} ago` : 'never rotated');
  // `nextRotationAt` is optional and additive (an older server omits it), and `readBoxTokenView` passes it through
  // unread, so it is checked here: anything but a placeable instant says nothing about the next rotation.
  const next: unknown = v.nextRotationAt;
  if (typeof next === 'number' && isPlaceableInstant(next)) {
    parts.push(next > now ? `next in ${spanWords(next - now)}` : 'next due now');
  }
  // Plain http still rotates (R2), but the key travels unencrypted: said beside the verdict, not only in Details.
  if (v.fleetTransport === 'http') parts.push('transport http (unencrypted)');
  return { text: parts.join(' · '), tone: 'calm' };
}

/** "key: value" said as a key and a value: today's lines, split at their first ": ". */
const keyValue = (line: string): [string, string] => {
  const at = line.indexOf(': ');
  return [line.slice(0, at), line.slice(at + 2)];
};

function BoxTokenSection({ view, now, reload }: { view: UpdatesView; now: number; reload: () => void }): ReactNode {
  const titleId = useId();
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
          <p className="settings-note">{BOX_TOKEN_TEXT.rotateWhen}</p>
        </div>
      </>
    );
  }
  return (
    <section className="settings-section" aria-labelledby={titleId}>
      <h3 id={titleId} className="settings-section-title">Box token</h3>
      <p className="settings-note" data-box-token="purpose">{BOX_TOKEN_TEXT.purpose(spanWords(TOKEN_ROTATION_INTERVAL_MS))}</p>
      {body}
    </section>
  );
}

/** The Security page's body (the heading is the frame's `<h2>`): the Box token card, over the frame's one
 *  /api/updates poll, once a view has landed, as today's page drew it. */
export function SecuritySection({ poll }: { poll: UpdatesPoll }): ReactNode {
  const now = useNow(30_000);
  if (poll.view !== null) return <BoxTokenSection view={poll.view} now={now} reload={poll.reload} />;
  // Before the first read lands, a skeleton rather than an empty page; a failed or absent read draws nothing, as
  // today's page drew no card then.
  return poll.failure === null ? <Skeleton lines={3} /> : null;
}

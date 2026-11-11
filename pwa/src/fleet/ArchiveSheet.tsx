// The ONE "Archive" (workspace lifecycle spec §5.2) — the conversation an Archive tap opens, for every session, from
// the session header's menu and from the fleet row's actions sheet. A `Sheet`, not a `QuickConfirm`, for
// `ArchiveConflictSheet`'s reason: a refusal must be answerable INSIDE it, and `QuickConfirm` closes on every tap.
//
// THE CONFIRM READS BY CASE, and each consent is a SECOND tap after the words that ask for it:
//   - an idle workspace, or a main checkout: what archiving does to it, in its own words;
//   - busy (either kind): "It's working. Archive anyway? The turn in progress is lost." — `interrupt`;
//   - a coordinator with open runs (L5, D-8199): "It coordinates N open runs. What happens to them?" — the runs listed,
//     and three answers, each one tap that a second (the confirm) sends: Release (`runs: 'release'`, the runs stay open
//     and unclaimed), Hand over to a live coordinator picked from the project's (`runs: 'handover'`, `heir`), or End
//     programme (`programme: 'end'`, every run abandoned). Nothing is ended unless the operator picks that answer;
//     "Stop only" asks the same question, without End programme, before it stops a session that claims runs;
//   - a workspace a run still claims (`run-open`): `ArchiveConflictSheet`'s own words — `force`.
// Once a programme was ended, every later refusal says so first (the server's `ended`): a refusal only ccd can
// measure may arrive AFTER the programme end, and the operator is never shown only the second half of what happened.
// The opening case is read off the row the caller holds (`archiveInterrupts`, the runs frame). The server re-reads
// both on the request; when it disagrees, its refusal turns the sheet to the case it found, and the consents already
// given ride along — so no refusal is ever answered twice.
//
// "STOP ONLY" LIVES HERE, AND ONLY WHERE THE CALLER ASKS FOR IT. After a refusal the operator cannot fix from the
// phone — `ARCHIVE_STOP_ONLY`; a coordination store the server could not read (`runs: []`), which refuses every
// consent; a programme it could not end (`programme-partly-ended`: a run the abandon arm cannot move from its row
// refuses the same way on every retry); or a box whose ccd has no `ws-archive` (`501 unsupported`) — a sheet given
// `onStopOnly` offers it, so a live session is never left without a way to put it down. Only the actions sheet passes
// it (spec §5.2: "exactly one place"); a sheet without it says where it is instead.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ARCHIVE_REFUSALS, ARCHIVE_STOP_ONLY, CLAIMS_MOVE_REFUSALS, archiveInterrupts, isArchiveRefusal,
  substrateFault, type ArchiveRefusal, type ClaimsChoiceBody, type FleetSession, type StopBody,
} from '../../../shared/api';
import { Button, QC_ACTIONS, QC_CONSEQUENCE, Select, Sheet, toast } from '@ccrc/ui';
import { ARCHIVE_REFUSAL_TEXT, ApiError, api, apiErrorText, archivePartial } from '../lib/api';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import { ensureSession } from '../session/useEnsure';
import {
  CLAIMED_CONSEQUENCE, CLAIMED_TITLE, claimedSentence, isArchiveConflictRun, runPhrase,
  type ArchiveConflictRun,
} from './ArchiveConflictSheet';
import { claimedRunsOf } from './runWords';
import './fleet.css';
import { restoreReachesEnsure } from './archivePutAway';
import { substrateFaultText } from './substrateWords';
import { resumeHeirs, type ResumeHeir } from './resumeHeirs';

/** Restore, for both kinds of row (spec §5.2): a workspace is restored (`ws-restore`); a stopped main checkout is
 *  ensured — `cmd_ensure` clears the stop stamp on the attempt and the row's own registry fields decide the respawn,
 *  exactly as Restart session does. ONE spelling, two callers. */
export const restoreSession = (s: FleetSession): Promise<void> =>
  restoreReachesEnsure(s) ? ensureSession(s.id) : api.restore(s.id);

/** Which door the coordinator question leads to (D-8199): the archive, or "Stop only". */
type ClaimsMode = 'archive' | 'stop';

/** The answer picked on the coordinator question's first tap, sent by the confirm's second. */
type ClaimsPick =
  | { readonly kind: 'release' }
  | { readonly kind: 'handover'; readonly heir: ResumeHeir }
  | { readonly kind: 'end' };

/** What the sheet is asking right now. */
type Ask =
  | { readonly kind: 'confirm' }
  | { readonly kind: 'busy' }
  /** D-8199: the coordinator question — what happens to the runs it claims. `error` says why an earlier answer failed. */
  | { readonly kind: 'programme'; readonly runs: readonly ArchiveConflictRun[]; readonly mode: ClaimsMode; readonly error?: string }
  /** D-8199: the second tap — the picked answer, said in full, before it is sent. */
  | { readonly kind: 'claims-confirm'; readonly runs: readonly ArchiveConflictRun[]; readonly mode: ClaimsMode; readonly pick: ClaimsPick }
  | { readonly kind: 'claimed'; readonly runs: readonly ArchiveConflictRun[] }
  /** `unfixable`: a refusal outside `ARCHIVE_STOP_ONLY` that the phone cannot fix either — a store the server could
   *  not read refuses every consent, `force` and `programme: 'end'` included, and a box whose ccd has no `ws-archive`
   *  (`501 unsupported`) refuses every archive. */
  | { readonly kind: 'refused'; readonly refusal: ArchiveRefusal | null; readonly text: string; readonly unfixable?: true }
  | { readonly kind: 'partly'; readonly text: string };

interface Consent {
  readonly force: boolean; readonly interrupt: boolean; readonly programme: boolean;
  /** D-8199: the claims choice, when one was confirmed. */
  readonly claims?: ClaimsChoiceBody;
}
const NO_CONSENT: Consent = { force: false, interrupt: false, programme: false };

/** The claims choice a confirmed pick sends (D-8199). `end` is not one: it is `programme: 'end'`. */
const claimsBody = (pick: Exclude<ClaimsPick, { kind: 'end' }>): ClaimsChoiceBody =>
  pick.kind === 'release' ? { runs: 'release' } : { runs: 'handover', heir: pick.heir.id };

/** `n open run(s)`, said once. */
const nRuns = (n: number): string => `${n} open ${n === 1 ? 'run' : 'runs'}`;

/** `claims-not-moved`, said (D-8199): what moved already, what did not, and why — the reclaim door's words where it has
 *  them, else its kind and detail. */
function claimsNotMovedText(body: unknown): string {
  const b = (typeof body === 'object' && body !== null ? body : {}) as
    { moved?: unknown; refusal?: { kind?: unknown; detail?: unknown; by?: unknown } };
  const moved = runsOf({ runs: b.moved });
  const kind = typeof b.refusal?.kind === 'string' ? b.refusal.kind : null;
  const detail = typeof b.refusal?.detail === 'string' && b.refusal.detail.trim() !== '' ? b.refusal.detail.trim() : null;
  const by = typeof b.refusal?.by === 'string' && b.refusal.by !== '' ? b.refusal.by : null;
  const why = kind === CLAIMS_MOVE_REFUSALS.heirNotLive ? 'that coordinator is not live'
    : kind === CLAIMS_MOVE_REFUSALS.heirIsThisSession ? 'a session cannot hand its runs to itself'
    : kind === CLAIMS_MOVE_REFUSALS.claimantChanged ? `another session${by === null ? '' : ` (${by})`} took the runs over first`
    : kind === 'unknown-session' ? 'this box has no registry row for that coordinator'
    : kind === 'heir-is-a-worker' ? `that session is the worker of another coordinator's open run${by === null ? '' : ` (${by})`}`
    : kind ?? 'the move was refused';
  return `Its runs could not be moved: ${why}${detail !== null && kind !== null && detail !== why ? ` (${detail})` : ''}.`
    + `${moved.length > 0 ? ` Already moved: ${moved.map(runPhrase).join('; ')}.` : ''} Nothing was stopped or archived.`;
}

/** `runs` off a refusal body: every member read by `ArchiveConflictSheet`'s `isArchiveConflictRun`, the one validator
 *  of a run — never a second copy of its checks. */
const runsOf = (body: unknown): readonly ArchiveConflictRun[] => {
  const raw = typeof body === 'object' && body !== null ? (body as { runs?: unknown }).runs : undefined;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isArchiveConflictRun);
};

/** `programme-partly-ended`, said: which runs closed, which did not and why, and that nothing else happened. */
function partlyText(body: unknown): string {
  const b = (typeof body === 'object' && body !== null ? body : {}) as
    { closed?: unknown; notClosed?: unknown; refusal?: { id?: unknown; kind?: unknown; detail?: unknown } };
  const closed = runsOf({ runs: b.closed });
  const notClosed = runsOf({ runs: b.notClosed });
  const why = b.refusal && typeof b.refusal.id === 'number' && typeof b.refusal.kind === 'string'
    ? ` Run ${b.refusal.id} could not be ended (${b.refusal.kind}${typeof b.refusal.detail === 'string' ? `: ${b.refusal.detail}` : ''}).`
    : '';
  return `${closed.length > 0 ? `Ended: ${closed.map(runPhrase).join('; ')}.` : 'No run was ended.'}`
    + `${notClosed.length > 0 ? ` Still open: ${notClosed.map(runPhrase).join('; ')}.` : ''}${why}`
    + ' Nothing was stopped or archived.';
}

export interface ArchiveSheetProps {
  /** The row to archive — the caller's LIVE row, so the fault re-check below reads the newest frame. */
  session: FleetSession | null;
  open: boolean;
  onClose: () => void;
  /** The session is put away: archived, or (a main checkout) stopped into the Archived fold. */
  onArchived?: () => void;
  /** "Stop only", after a refusal the phone cannot fix (`stopOnlyClass`, below). Absent → not offered (only the
   *  actions sheet passes it). `body` carries the claims choice (D-8199) when the session claims open runs. */
  onStopOnly?: (id: string, body?: StopBody) => void;
  /** Injectable for tests — `ArchiveConflictSheet`'s own idiom. */
  archive?: typeof api.archive;
  fleet?: FleetStore;
}

export function ArchiveSheet({
  session, open, onClose, onArchived, onStopOnly, archive = api.archive, fleet = useFleetStore,
}: ArchiveSheetProps): ReactNode {
  const runs = fleet((s) => s.runs);
  const sessions = fleet((s) => s.sessions);
  const frameSeen = fleet((s) => s.fleetFrameSeen);
  const [ask, setAsk] = useState<Ask>({ kind: 'confirm' });
  /** D-8199: the coordinator picked in the hand-over picker, by id. */
  const [heirId, setHeirId] = useState('');
  const [consent, setConsent] = useState<Consent>(NO_CONSENT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The runs the door already ended on an earlier send of this sheet (its `ended`), so a refusal after that end is
   *  never read as "nothing happened". */
  const [ended, setEnded] = useState<readonly ArchiveConflictRun[]>([]);
  // `gen`, `ArchiveConflictSheet`'s idiom: an answer that lands after the sheet closed, or after it was retargeted to
  // another session, speaks for nobody on screen now.
  const gen = useRef(0);
  const id = session?.id ?? null;
  /** The open runs the frame says this session claims, as the sheet lists them. */
  const claimedOf = (sessionId: string): ArchiveConflictRun[] => claimedRunsOf(runs, sessionId)
    .map((r) => ({ id: r.id, program: r.program, wave: r.wave, waveOf: r.waveOf }));

  // The opening case, read off the row and the runs frame each time the sheet opens on a session.
  useEffect(() => {
    gen.current += 1;
    setConsent(NO_CONSENT);
    setBusy(false);
    setError(null);
    setEnded([]);
    setHeirId('');
    if (!open || session === null) return;
    const claimed = claimedOf(session.id);
    setAsk(archiveInterrupts(session) ? { kind: 'busy' }
      : claimed.length > 0 ? { kind: 'programme', runs: claimed, mode: 'archive' } : { kind: 'confirm' });
    // Re-read on open and on a retarget only: a frame landing under an open sheet must not swap its question.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, id]);

  if (!open || session === null) return null;
  const sid = session.id;
  const workspace = session.workspace !== null;
  // D-8199: who could take its runs — the live coordinators of its project, never itself (`resumeHeirs`, the Resume
  // sheet's own picker).
  const heirs = resumeHeirs(sessions, session.project, sid, frameSeen);
  const heir = heirs.find((h) => h.id === heirId) ?? null;

  const send = (next: Consent): void => {
    if (busy) return;
    // The substrate gate's confirm-path half: the fleet frame updates LIVE under an open sheet, so the fault is
    // re-read at the moment of firing and the refusal named rather than swallowed.
    const fault = substrateFault(session);
    if (fault !== null) {
      setError(substrateFaultText(fault));
      return;
    }
    const mine = gen.current;
    setConsent(next);
    setBusy(true);
    setError(null);
    void archive(sid, {
      ...(next.force ? { force: true } : {}),
      ...(next.interrupt ? { interrupt: true } : {}),
      ...(next.programme ? { programme: 'end' as const } : {}),
      ...(next.claims ?? {}),
    }).then(
      (answer) => {
        if (gen.current !== mine) return;
        setBusy(false);
        const partial = archivePartial(answer);
        if (partial !== null) {
          const why = partial.refusal !== null ? ARCHIVE_REFUSAL_TEXT[partial.refusal]
            : `${partial.detail ?? 'the archive was refused'}.`;
          const endedFirst = [...ended, ...runsOf({ runs: answer?.ended })];
          toast(`${endedFirst.length > 0 ? `Its programme was ended (${endedFirst.map(runPhrase).join('; ')}). ` : ''}`
            + `Stopped, but not archived — ${why} Archive is still offered on its row.`, 'error');
        } else {
          onArchived?.();
        }
        onClose();
      },
      (err: unknown) => {
        if (gen.current !== mine) return;
        setBusy(false);
        const code = err instanceof ApiError && typeof err.body === 'object' && err.body !== null
          ? (err.body as { error?: unknown }).error : undefined;
        const endedNow = err instanceof ApiError ? runsOf({ runs: (err.body as { ended?: unknown } | null)?.ended }) : [];
        if (endedNow.length > 0) setEnded((prev) => [...prev, ...endedNow]);
        if (err instanceof ApiError && err.status === 409 && isArchiveRefusal(code)) {
          if (code === ARCHIVE_REFUSALS.sessionBusy) return setAsk({ kind: 'busy' });
          if (code === ARCHIVE_REFUSALS.runOpen) return setAsk({ kind: 'claimed', runs: runsOf(err.body) });
          if (code === ARCHIVE_REFUSALS.coordinatorHasOpenRuns) {
            const named = runsOf(err.body);
            return setAsk(named.length > 0 ? { kind: 'programme', runs: named, mode: 'archive' } : { kind: 'refused', refusal: code,
              unfixable: true, text: `${ARCHIVE_REFUSAL_TEXT[code]} This box could not read them, so it will not archive it.` });
          }
          // D-8199: the move was refused — back to the question, saying why, with the runs still to move.
          if (code === ARCHIVE_REFUSALS.claimsNotMoved) {
            const left = runsOf({ runs: (err.body as { notMoved?: unknown } | null)?.notMoved });
            return setAsk({ kind: 'programme', runs: left.length > 0 ? left : claimedOf(sid), mode: 'archive',
              error: claimsNotMovedText(err.body) });
          }
          if (code === ARCHIVE_REFUSALS.programmePartlyEnded) return setAsk({ kind: 'partly', text: partlyText(err.body) });
          return setAsk({ kind: 'refused', refusal: code, text: ARCHIVE_REFUSAL_TEXT[code] });
        }
        // `501 unsupported`: the fleet box's ccd predates `ws-archive`, so no retry and no consent archives it there
        // until the box is updated — an unfixable refusal, answered with "Stop only" like the others.
        if (err instanceof ApiError && err.status === 501) {
          return setAsk({ kind: 'refused', refusal: null, unfixable: true, text: apiErrorText(err) });
        }
        setError(apiErrorText(err));
      },
    );
  };

  /** A refusal only "Stop only" answers: one of `ARCHIVE_STOP_ONLY`, an `unfixable` one (a store the server could not
   *  read, a box without `ws-archive`), or a programme it could not end. */
  const stopOnlyClass = ask.kind === 'partly' || (ask.kind === 'refused'
    && (ask.unfixable === true || (ask.refusal !== null && ARCHIVE_STOP_ONLY.includes(ask.refusal))));
  const stopOnly = onStopOnly !== undefined && stopOnlyClass;
  /** "Stop only" is the only stop control in the PWA, so it carries the substrate gate the header's "Stop session" had
   *  (spec §4: stop is destructive during an outage): disabled, with the chip's own title, while tmux cannot be reached.
   *  The caller's handler re-checks at fire time, since the live frame can change under the open sheet. */
  const stopFault = substrateFault(session);

  /** "Stop only" (D-8199): a session the frame says claims open runs is asked what happens to them first; any other is
   *  stopped at once, as before. */
  const stopOnlyTap = (): void => {
    const claimed = claimedOf(sid);
    if (claimed.length > 0) {
      setError(null);
      setAsk({ kind: 'programme', runs: claimed, mode: 'stop' });
      return;
    }
    onStopOnly!(sid);
    onClose();
  };

  /** The confirm's send (D-8199): an archive carries the choice as a consent; a stop hands it to "Stop only". */
  const confirmClaims = (mode: ClaimsMode, pick: ClaimsPick): void => {
    if (mode === 'stop') {
      if (pick.kind === 'end' || onStopOnly === undefined) return;
      const fault = substrateFault(session);
      if (fault !== null) { setError(substrateFaultText(fault)); return; }
      onStopOnly(sid, claimsBody(pick));
      onClose();
      return;
    }
    send(pick.kind === 'end' ? { ...consent, programme: true, claims: undefined }
      : { ...consent, programme: false, claims: claimsBody(pick) });
  };

  let title: string;
  let body: ReactNode;
  let primary: { label: string; next: Consent } | null;
  /** D-8199: the coordinator question's own footer — its three answers, or the confirm's send and Back. */
  let claimsFooter: ReactNode = null;
  switch (ask.kind) {
    case 'confirm':
      title = workspace ? 'Archive this workspace?' : 'Archive this session?';
      body = <p className={QC_CONSEQUENCE}>{workspace
        ? 'It goes offline and folds into Archived. Restore brings it back; once automatic cleanup is on, it is cleaned up seven days after its archive.'
        : 'It goes offline and folds into Archived. Restore starts it again. It is never deleted.'}</p>;
      primary = { label: 'Archive', next: consent };
      break;
    case 'busy':
      title = "It's working. Archive anyway?";
      body = <p className={QC_CONSEQUENCE}>The turn in progress is lost.</p>;
      primary = { label: 'Archive anyway', next: { ...consent, interrupt: true } };
      break;
    case 'programme': {
      const { runs: asked, mode } = ask;
      title = `It coordinates ${nRuns(asked.length)}. What happens to them?`;
      body = (
        <>
          <p className={QC_CONSEQUENCE}>{`${asked.map(runPhrase).join('; ')}.`}</p>
          <p className={QC_CONSEQUENCE}>
            Release leaves them open and unclaimed: the programme goes on, and the next coordinator to open a run picks it up.
            Hand over gives them to a live coordinator now.
            {mode === 'archive' ? ' End programme abandons every run and cleans up its workers.' : ''}
          </p>
          {heirs.length > 0 ? (
            <label className="archive-claims-heir">
              <span className={QC_CONSEQUENCE}>Hand over to</span>
              <Select aria-label="Hand over to" value={heir === null ? '' : heir.id} disabled={busy}
                      onChange={(e) => setHeirId(e.target.value)}>
                <option value="">Choose a coordinator</option>
                {heirs.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
              </Select>
            </label>
          ) : (
            <p className={QC_CONSEQUENCE}>{`No other live coordinator of ${session.project} to hand them to.`}</p>
          )}
          {ask.error !== undefined && <p className="abandon-error">{ask.error}</p>}
        </>
      );
      primary = null;
      claimsFooter = (
        <>
          <Button variant="primary" disabled={busy}
                  onClick={() => setAsk({ kind: 'claims-confirm', runs: asked, mode, pick: { kind: 'release' } })}>
            Release runs
          </Button>
          <Button variant="primary" disabled={busy || heir === null}
                  onClick={() => heir !== null && setAsk({ kind: 'claims-confirm', runs: asked, mode, pick: { kind: 'handover', heir } })}>
            {heir === null ? 'Hand over' : `Hand over to ${heir.name}`}
          </Button>
          {mode === 'archive' && (
            <Button variant="ghost" disabled={busy}
                    onClick={() => setAsk({ kind: 'claims-confirm', runs: asked, mode, pick: { kind: 'end' } })}>
              End programme
            </Button>
          )}
        </>
      );
      break;
    }
    case 'claims-confirm': {
      const { runs: asked, mode, pick } = ask;
      const act = mode === 'archive' ? 'archive' : 'stop';
      const n = asked.length === 1 ? 'its run' : `its ${asked.length} runs`;
      title = pick.kind === 'release' ? `Release ${n} and ${act}?`
        : pick.kind === 'handover' ? `Hand ${n} to ${pick.heir.name} and ${act}?`
        : 'End its programme and archive?';
      body = (
        <>
          <p className={QC_CONSEQUENCE}>{`${asked.map(runPhrase).join('; ')}.`}</p>
          <p className={QC_CONSEQUENCE}>{pick.kind === 'release'
            ? 'They stay open, claimed by nobody. Nothing is ended: the next coordinator to open a run of the programme takes it.'
            : pick.kind === 'handover'
              ? `${pick.heir.name} coordinates them from now on. Nothing is ended, and their mail follows them.`
              : 'Every open run is abandoned and its workers will be cleaned up.'}</p>
          {pick.kind === 'end' && (
            <p className={QC_CONSEQUENCE}>
              To pause a programme instead, use the coordinator pause switch under Advanced on the Runs screen — archiving its
              coordinator does not pause it.
            </p>
          )}
        </>
      );
      primary = null;
      const label = pick.kind === 'release' ? `Release and ${act}`
        : pick.kind === 'handover' ? `Hand over and ${act}` : 'End programme and archive';
      claimsFooter = (
        <>
          <Button variant="danger" disabled={busy} onClick={() => confirmClaims(mode, pick)}>
            {busy ? 'Archiving…' : label}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => setAsk({ kind: 'programme', runs: asked, mode })}>
            Back
          </Button>
        </>
      );
      break;
    }
    case 'claimed':
      title = CLAIMED_TITLE;
      body = (
        <>
          <p className={QC_CONSEQUENCE}>{claimedSentence(ask.runs.length > 0 ? ask.runs : null)}</p>
          <p className={QC_CONSEQUENCE}>{CLAIMED_CONSEQUENCE}</p>
        </>
      );
      primary = { label: 'Archive anyway', next: { ...consent, force: true } };
      break;
    case 'refused':
      title = "Couldn't archive";
      body = <p className={QC_CONSEQUENCE}>{ask.text}</p>;
      primary = null;
      break;
    case 'partly':
      title = 'The programme was only partly ended';
      body = <p className={QC_CONSEQUENCE}>{ask.text}</p>;
      primary = null;
      break;
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={title}
      eyebrow={session.project}
      // The answers are pinned in the Sheet's footer (D-5932).
      footer={
        <div className={QC_ACTIONS}>
          {primary !== null && (
            <Button variant="danger" disabled={busy} onClick={() => send(primary!.next)}>
              {busy ? 'Archiving…' : primary.label}
            </Button>
          )}
          {claimsFooter}
          {stopOnly && (
            <Button variant="danger" disabled={stopFault !== null}
                    title={stopFault === null ? undefined : substrateFaultText(stopFault)}
                    onClick={stopOnlyTap}>
              Stop only
            </Button>
          )}
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {primary === null && claimsFooter === null && !stopOnly ? 'Close' : 'Cancel'}
          </Button>
        </div>
      }
    >
      <div className="archive-conflict-sheet">
        {ended.length > 0 && (
          <p className={QC_CONSEQUENCE}>{`Its programme was ended first: ${ended.map(runPhrase).join('; ')}.`}</p>
        )}
        {body}
        {/* After a `stopOnlyClass` refusal: what "Stop only" does, or where it is. */}
        {stopOnly && (
          <p className={QC_CONSEQUENCE}>Stop only takes it offline without archiving it: it stays on the board, stopped.</p>
        )}
        {stopOnlyClass && !stopOnly && (
          <p className={QC_CONSEQUENCE}>Stop only is in this session's actions sheet on the board.</p>
        )}
        {error !== null && <p className="abandon-error">{error}</p>}
      </div>
    </Sheet>
  );
}

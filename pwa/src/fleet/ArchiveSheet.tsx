// The ONE "Archive" (workspace lifecycle spec §5.2) — the conversation an Archive tap opens, for every session, from
// the session header's menu and from the fleet row's actions sheet. A `Sheet`, not a `QuickConfirm`, for
// `ArchiveConflictSheet`'s reason: a refusal must be answerable INSIDE it, and `QuickConfirm` closes on every tap.
//
// THE CONFIRM READS BY CASE, and each consent is a SECOND tap after the words that ask for it:
//   - an idle workspace, or a main checkout: what archiving does to it, in its own words;
//   - busy (either kind): "It's working. Archive anyway? The turn in progress is lost." — `interrupt`;
//   - a coordinator with open runs (L5): "It has N open runs. End its programme too? Its workers will be cleaned up."
//     — `programme: 'end'`, with Cancel the only other choice (§11 item 1: an archived coordinator cannot keep a
//     programme alive, so pausing is the coordinator pause switch, and the sheet says so);
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
  ARCHIVE_REFUSALS, ARCHIVE_STOP_ONLY, TERMINAL_RUN_STATES, archiveInterrupts, inArchivedFold, isArchiveRefusal,
  substrateFault, type ArchiveRefusal, type FleetSession,
} from '../../../shared/api';
import { Sheet } from '../components/Sheet';
import { toast } from '../components/Toast';
import { ARCHIVE_REFUSAL_TEXT, ApiError, api, apiErrorText, archivePartial } from '../lib/api';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import {
  CLAIMED_CONSEQUENCE, claimedSentence, isArchiveConflictRun, runPhrase, type ArchiveConflictRun,
} from './ArchiveConflictSheet';
import './fleet.css';

/** Whether a session is already put away, so its menu and its actions sheet offer Restore where every other session
 *  offers Archive (spec §5.2). Every row the Archived fold holds (`inArchivedFold`, the ONE predicate — never
 *  `archivedAt` or `workspace` alone), plus a `cleanup` row: an archived workspace whose merge keeps it in the live
 *  list (`groupFleet`'s `archived` doc), archived all the same. ONE spelling, two callers. */
export const isPutAway = (s: FleetSession): boolean => inArchivedFold(s) || s.bucket === 'cleanup';

/** Restore, for both kinds of row (spec §5.2): a workspace is restored (`ws-restore`); a stopped main checkout is
 *  ensured — `cmd_ensure` clears the stop stamp on the attempt and the row's own registry fields decide the respawn,
 *  exactly as Restart session does. ONE spelling, two callers. */
export const restoreSession = (s: FleetSession): Promise<void> =>
  restoreReachesEnsure(s) ? api.ensure(s.id) : api.restore(s.id);

/** Whether this row's Restore is the SAME request as Restart session — `POST /ensure`, which a standing substrate
 *  fault refuses (spec §4): a main checkout. A workspace's Restore is `ws-restore`, a different verb, and stays
 *  ungated. The ONE spelling of that rule: the actions sheet's and the header's Restore gates both read it, and
 *  `restoreSession` above routes by it, so the gate and the route cannot drift. */
export const restoreReachesEnsure = (s: Pick<FleetSession, 'workspace'>): boolean => s.workspace === null;

/** What the sheet is asking right now. */
type Ask =
  | { readonly kind: 'confirm' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'programme'; readonly runs: readonly ArchiveConflictRun[] }
  | { readonly kind: 'claimed'; readonly runs: readonly ArchiveConflictRun[] }
  /** `unfixable`: a refusal outside `ARCHIVE_STOP_ONLY` that the phone cannot fix either — a store the server could
   *  not read refuses every consent, `force` and `programme: 'end'` included, and a box whose ccd has no `ws-archive`
   *  (`501 unsupported`) refuses every archive. */
  | { readonly kind: 'refused'; readonly refusal: ArchiveRefusal | null; readonly text: string; readonly unfixable?: true }
  | { readonly kind: 'partly'; readonly text: string };

interface Consent { readonly force: boolean; readonly interrupt: boolean; readonly programme: boolean }
const NO_CONSENT: Consent = { force: false, interrupt: false, programme: false };

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
   *  actions sheet passes it). */
  onStopOnly?: (id: string) => void;
  /** Injectable for tests — `ArchiveConflictSheet`'s own idiom. */
  archive?: typeof api.archive;
  fleet?: FleetStore;
}

export function ArchiveSheet({
  session, open, onClose, onArchived, onStopOnly, archive = api.archive, fleet = useFleetStore,
}: ArchiveSheetProps): ReactNode {
  const runs = fleet((s) => s.runs);
  const [ask, setAsk] = useState<Ask>({ kind: 'confirm' });
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

  // The opening case, read off the row and the runs frame each time the sheet opens on a session.
  useEffect(() => {
    gen.current += 1;
    setConsent(NO_CONSENT);
    setBusy(false);
    setError(null);
    setEnded([]);
    if (!open || session === null) return;
    const claimed = runs.filter((r) => r.claimedBy === session.id
      && !(TERMINAL_RUN_STATES as readonly string[]).includes(r.state))
      .map((r) => ({ id: r.id, program: r.program, wave: r.wave, waveOf: r.waveOf }));
    setAsk(archiveInterrupts(session) ? { kind: 'busy' }
      : claimed.length > 0 ? { kind: 'programme', runs: claimed } : { kind: 'confirm' });
    // Re-read on open and on a retarget only: a frame landing under an open sheet must not swap its question.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, id]);

  if (!open || session === null) return null;
  const sid = session.id;
  const workspace = session.workspace !== null;

  const send = (next: Consent): void => {
    if (busy) return;
    // The substrate gate's confirm-path half: the fleet frame updates LIVE under an open sheet, so the fault is
    // re-read at the moment of firing and the refusal named rather than swallowed.
    const fault = substrateFault(session);
    if (fault !== null) {
      setError(`tmux unreachable — ${fault.text}`);
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
            return setAsk(named.length > 0 ? { kind: 'programme', runs: named } : { kind: 'refused', refusal: code,
              unfixable: true, text: `${ARCHIVE_REFUSAL_TEXT[code]} This box could not read them, so it will not archive it.` });
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

  let title: string;
  let body: ReactNode;
  let primary: { label: string; next: Consent } | null;
  switch (ask.kind) {
    case 'confirm':
      title = workspace ? 'Archive this workspace?' : 'Archive this session?';
      body = <p className="qc-consequence">{workspace
        ? 'It goes offline and folds into Archived. Restore brings it back; once automatic cleanup is on, it is cleaned up seven days after its archive.'
        : 'It goes offline and folds into Archived. Restore starts it again. It is never deleted.'}</p>;
      primary = { label: 'Archive', next: consent };
      break;
    case 'busy':
      title = "It's working. Archive anyway?";
      body = <p className="qc-consequence">The turn in progress is lost.</p>;
      primary = { label: 'Archive anyway', next: { ...consent, interrupt: true } };
      break;
    case 'programme':
      title = `It has ${ask.runs.length} open ${ask.runs.length === 1 ? 'run' : 'runs'}. End its programme too?`;
      body = (
        <>
          <p className="qc-consequence">Its workers will be cleaned up.</p>
          <p className="qc-consequence">{`${ask.runs.map(runPhrase).join('; ')}.`}</p>
          <p className="qc-consequence">
            To pause a programme instead, use the coordinator pause switch on the Runs screen — archiving its
            coordinator does not pause it.
          </p>
        </>
      );
      primary = { label: 'End programme and archive', next: { ...consent, programme: true } };
      break;
    case 'claimed':
      title = 'This workspace is claimed';
      body = (
        <>
          <p className="qc-consequence">{claimedSentence(ask.runs.length > 0 ? ask.runs : null)}</p>
          <p className="qc-consequence">{CLAIMED_CONSEQUENCE}</p>
        </>
      );
      primary = { label: 'Archive anyway', next: { ...consent, force: true } };
      break;
    case 'refused':
      title = "Couldn't archive";
      body = <p className="qc-consequence">{ask.text}</p>;
      primary = null;
      break;
    case 'partly':
      title = 'The programme was only partly ended';
      body = <p className="qc-consequence">{ask.text}</p>;
      primary = null;
      break;
  }

  return (
    <Sheet open onClose={onClose} title={title} eyebrow={session.project}>
      <div className="archive-conflict-sheet">
        {ended.length > 0 && (
          <p className="qc-consequence">{`Its programme was ended first: ${ended.map(runPhrase).join('; ')}.`}</p>
        )}
        {body}
        {/* After a `stopOnlyClass` refusal: what "Stop only" does, or where it is. */}
        {stopOnly && (
          <p className="qc-consequence">Stop only takes it offline without archiving it: it stays on the board, stopped.</p>
        )}
        {stopOnlyClass && !stopOnly && (
          <p className="qc-consequence">Stop only is in this session's actions sheet on the board.</p>
        )}
        <div className="qc-actions">
          {primary !== null && (
            <button type="button" className="btn-primary" disabled={busy} onClick={() => send(primary!.next)}>
              {busy ? 'Archiving…' : primary.label}
            </button>
          )}
          {stopOnly && (
            <button type="button" className="btn-primary" disabled={stopFault !== null}
                    title={stopFault !== null ? `tmux unreachable — ${stopFault.text}` : undefined}
                    onClick={() => { onStopOnly!(sid); onClose(); }}>
              Stop only
            </button>
          )}
          <button type="button" className="btn-ghost" disabled={busy} onClick={onClose}>
            {primary === null && !stopOnly ? 'Close' : 'Cancel'}
          </button>
        </div>
        {error !== null && <p className="abandon-error">{error}</p>}
      </div>
    </Sheet>
  );
}

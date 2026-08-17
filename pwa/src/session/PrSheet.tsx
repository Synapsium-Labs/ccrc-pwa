// The PR sheet. Every action lives HERE — the cap only opens it — and every
// outward-facing or destructive one goes through QuickConfirm's consequence
// grammar, the primitive already used for stopping a session, swapping
// accounts and rebooting the host. Two identical ghost buttons side by side on
// a phone is not a confirmation.
//
// There is no merge button in any state, ever: merging is the irreversible
// review decision and requires the diff, which is on github.com. That also
// keeps ccrc's write surface at exactly one additive verb.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { FleetSession, PrView } from '../../../shared/api';
import { Sheet } from '../components/Sheet';
import { QuickConfirm } from '../components/QuickConfirm';
import { toast } from '../components/Toast';
import { api, apiErrorText } from '../lib/api';
import { ArchiveConflictSheet, runOpenRuns, type ArchiveConflictRun } from '../fleet/ArchiveConflictSheet';
import { isRunClosed } from '../fleet/runWords';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import { checkPhrase, prSentence, tooltipSentence, UNCHECKED_PR } from './PrKeycap';
import './chat.css';

export function PrSheet({
  session, open, onClose, onReap,
  archive = api.archive,
  fleet = useFleetStore,
}: {
  /** The fleet store, injectable exactly as `SessionActionsSheet` takes it —
   *  this sheet reads ONE slice of it (the active runs), and a test that had
   *  to mutate the app-wide singleton to set that slice would leak into every
   *  test after it. */
  fleet?: FleetStore;
  session: FleetSession | null;
  open: boolean;
  onClose: () => void;
  /** Cleanup is handed UP, never done here: the reap flow owns the audit, the
   *  manifest and the fingerprint, and this sheet must not be able to delete. */
  onReap: () => void;
  /** Injectable for tests, the same default-to-`api.archive` shape
   *  `SessionActionsSheet` and `ArchiveConflictSheet` use — three components,
   *  one idiom. */
  archive?: typeof api.archive;
}): ReactNode {
  const [view, setView] = useState<PrView | null>(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<null | 'open' | 'draft'>(null);
  /** `undefined` = no refusal to show; otherwise the runs the server named
   *  (possibly `[]` — a run-open we could not read the runs of, which the
   *  sheet renders WITHOUT inventing an id). Three states, because collapsing
   *  the empty case into "no conflict" is the defect the sheet exists to
   *  close. */
  const [conflict, setConflict] = useState<readonly ArchiveConflictRun[] | undefined>(undefined);

  const id = session?.id ?? null;
  const load = (): void => {
    if (id === null) return;
    void api.pr(id).then((v) => { setView(v); setTitle(v.draft?.title ?? ''); }).catch(() => { /* cached values stay */ });
  };
  // One-shot on open: the cached value from the fleet sweep is on screen
  // meanwhile, so the sheet is never blank.
  //
  // The `conflict` reset is UNCONDITIONAL, deliberately outside the `if (open)`
  // — `SessionActionsSheet`'s own idiom for the same state. A `409 run-open` is
  // a measurement the server made about ONE session; this component takes
  // `session` and `open` as independent props, so `id` can change with `open`
  // staying true, and a reset gated on open/close would never fire on that
  // path. Session B's operator must never be shown session A's claim with an
  // "Archive anyway" button under it.
  useEffect(() => {
    setConflict(undefined);
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, id]);

  // THE THIRD REASON a merged workspace sits unarchived, and it needs ZERO
  // wire change: the fleet store already carries the active run list. Both
  // reads are HOOKS, so they run above the `session === null` guard like every
  // other hook here.
  //
  // Gated on `runsFrameSeen` — an empty `runs` before the first frame is not
  // evidence of no runs, the store's own idiom — and DEGRADING to the shipped
  // two-reason sentence rather than asserting from a list that has not
  // arrived.
  const runsFrameSeen = fleet((s) => s.runsFrameSeen);
  const openRun = fleet((s) => s.runs).find((r) => r.sessionId === id && !isRunClosed(r)) ?? null;
  const claimingRun = runsFrameSeen ? openRun : null;

  if (!session) return null;
  // The fresh one-shot GET wins over the cached fleet-sweep value once it
  // lands — `session.pr` is the fallback for the gap before it does, not a
  // competing source of truth once `view` exists.
  //
  // MUTATION SURVIVOR, disclosed, on all three `??` below (same shape as
  // PrKeycap.tsx's own disclosed one): `view?.pr` is `PrState | undefined`,
  // `view?.facts` is `{...} | null | undefined`, `view?.draft` is
  // `{...} | null | undefined` — none of those types admit `0`, `''`, `false`
  // or any other falsy-but-not-nullish value, so `??` and `||` act on exactly
  // the same inputs here and no distinguishing call can exist. Kept as `??`
  // because the intent is "substitute when we have no fresher value", not
  // "substitute when the fresher value looks empty" — a distinction PrState,
  // the facts record and the draft record would all have to grow a falsy
  // representation to ever matter.
  const pr = view?.pr ?? session.pr;
  const facts = view?.facts ?? null;
  const draft = view?.draft ?? null;
  const archived = session.archivedAt !== null;

  /** The archive door. It is NOT `act('Archiving', …)`: a `409 run-open` is not
   *  a failure the operator can act on from a toast — the refusal names WHICH
   *  run, and naming it is the whole information. Every other failure keeps
   *  the toast (and the sentence) it always had. */
  const archiveNow = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try { await archive(session.id); load(); }
    catch (err) {
      const runs = runOpenRuns(err);
      if (runs !== null) setConflict(runs);
      else toast(`Archiving failed — ${apiErrorText(err)}`, 'error');
    }
    finally { setBusy(false); }
  };

  const act = async (label: string, fn: () => Promise<unknown>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try { await fn(); load(); }
    catch (err) { toast(`${label} failed — ${apiErrorText(err)}`, 'error'); }
    finally { setBusy(false); }
  };

  // The lede is prSentence's own words — the whole point of exporting it is
  // that the cap and this sheet can never disagree about what a phase means.
  // For 'open'/'draft' its trailing checks clause is dropped here only: that
  // detail already has a dedicated, larger presentation below (`.pr-checkline`
  // / `.pr-check-names`, the latter required to be a plain inert block for the
  // failing check names), so repeating it verbatim in the lede would put the
  // same GitHub-sourced words on screen twice. The base clause has no period
  // before the one that ends it, so slicing at the first '.' is exactly that
  // clause and nothing more.
  const sentence = prSentence(pr ?? UNCHECKED_PR, session.branch ?? undefined);
  const lede = pr && (pr.phase === 'open' || pr.phase === 'draft')
    ? sentence.slice(0, sentence.indexOf('.') + 1)
    : sentence;

  return (
    <>
      {/* No "#N" here: the lede immediately below already opens with
          "Pull request #N: …", and the eyebrow already names the project —
          repeating the number in the heading only duplicates the lede's own
          text on screen. */}
      <Sheet open={open} onClose={onClose} eyebrow={session.project} title={session.workspace ?? session.project}>
        <div className="pr-sheet">
          <p className="pr-lede">{lede}</p>

          {pr?.phase === 'unchecked' && (
            <button type="button" className="btn-ghost" onClick={load} disabled={busy}>Check now</button>
          )}

          {pr?.phase === 'no-commits' && (
            /* The disabled reason is the lede's own words, read from the same
               variable that rendered it — not a second sentence saying the
               same thing in slightly different ones (final-round integration
               finding 5: this said "<branch> has no commits past its base.",
               a hand copy of prSentence's own no-commits clause).

               `tooltipSentence` is the plain-text rendering of that same
               string, not a different sentence (fix round 3, P6): a `title`
               shows markdown ticks as ticks, and the "Pull request: " opener
               is already carried by the lede one line above. */
            <button type="button" className="btn-primary" disabled title={tooltipSentence(lede)}>
              Open pull request
            </button>
          )}

          {pr?.phase === 'none' && (
            <>
              <label className="pr-label" htmlFor="pr-title">Title</label>
              {/* One field, one thumb height. */}
              <input id="pr-title" className="pr-title-input" type="text" value={title}
                     onChange={(e) => setTitle(e.target.value)} />
              <label className="pr-label" htmlFor="pr-body">Body preview</label>
              {/* Read-only: a multi-line editor in a bottom sheet is a bad
                  surface, and the body is fully regenerable — prose edits
                  happen on GitHub, one tap away via this sheet's own link. */}
              <textarea id="pr-body" className="pr-body-preview" readOnly rows={10}
                        value={draft?.body ?? ''} />
              {facts !== null && (
                <p className="pr-facts">
                  {`${facts.branch} → ${facts.baseShort} · ${facts.repo} · `
                   + (facts.commits === null ? 'commits unknown' : `${facts.commits} commits`)}
                </p>
              )}
              {/* Three states, not two. `0` is "nothing uncommitted" and says
                  nothing; `null` is "we could not look" (deviation 11: the
                  worktree was not corroborated as this workspace's, or its tree
                  would not read) and MUST say so — the same advisory being
                  absent is what a reader takes for a clean tree. */}
              {facts !== null && facts.dirty !== null && facts.dirty > 0 && (
                <p className="pr-warn">
                  {`${facts.dirty} files are not committed — they will not be in this PR.`}
                </p>
              )}
              {facts !== null && facts.dirty === null && (
                <p className="pr-warn">
                  ccrc could not read this worktree, so it cannot say whether anything is uncommitted.
                </p>
              )}
              <button type="button" className="btn-primary" disabled={busy || session.status === 'busy'}
                      onClick={() => setConfirm('open')}>
                Open pull request
              </button>
              <button type="button" className="btn-ghost" disabled={busy || session.status === 'busy'}
                      onClick={() => setConfirm('draft')}>
                Open as draft
              </button>
            </>
          )}

          {(pr?.phase === 'open' || pr?.phase === 'draft') && (
            <>
              {pr.title !== null && <p className="pr-title">{pr.title}</p>}
              {/* Final-round integration finding 5. This was a hand-written
                  four-way `PrChecks` → words mapping — a second copy of
                  `PrKeycap`'s private `checkText`, which is exactly what
                  `UNCHECKED_PR`'s docstring says will drift, and it had:
                  "no checks configured" against "No checks configured.".
                  `checkPhrase` is now the single source both this line and
                  the cap's sentence read from, so the two cannot describe the
                  same CI state in different words. */}
              <p className="pr-checkline">{checkPhrase(pr)}</p>
              {/* INERT TEXT. These names come from GitHub and are
                  attacker-controllable on any repo that takes fork PRs; a
                  button beside them would inject them into an agent running
                  --dangerously-skip-permissions. No button, no anchor, ever. */}
              {pr.checkNames !== null && pr.checkNames.length > 0 && (
                <p className="pr-check-names" data-testid="pr-check-names">{pr.checkNames.join(', ')}</p>
              )}
              {pr.url !== null && (
                <a className="btn-ghost" href={pr.url} target="_blank" rel="noreferrer">Open on GitHub</a>
              )}
              <button type="button" className="btn-ghost"
                      onClick={() => { void navigator.clipboard?.writeText(pr.url ?? ''); toast('Link copied', 'info'); }}>
                Copy link
              </button>
              <button type="button" className="btn-ghost" onClick={load} disabled={busy}>Refresh</button>
              {/* THE HOLD CHANGES THIS SENTENCE TOO — fix-wave finding 6. The
                  merged branch below was corrected and this one was not, and
                  this is the branch an operator reads for the WHOLE of a wave:
                  a PR sits open for hours, and "when it merges, ccrc archives
                  this workspace automatically" is precisely what the hold
                  suppresses (`archiveMerged` skips on the held rung before it
                  ever asks `archiveSafety`). Same verbatim reason, same
                  no-parsing rule, and it names the release path rather than
                  promising a sweep that will never come. */}
              <p className="pr-note">
                {session.held !== null
                  ? `Merging happens on GitHub. It will NOT archive this workspace: held — ${session.held}. Release it (Release, in the session’s actions sheet) and the next sweep after the merge archives it.`
                  : 'Merging happens on GitHub. When it merges, ccrc archives this workspace automatically.'}
              </p>
            </>
          )}

          {pr?.phase === 'merged' && (
            <>
              {pr.url !== null && (
                <a className="btn-ghost" href={pr.url} target="_blank" rel="noreferrer">Open on GitHub</a>
              )}
              {archived ? (
                <>
                  <p className="pr-note">Archived — session stopped; nothing deleted</p>
                  <button type="button" className="btn-ghost" disabled={busy}
                          onClick={() => void act('Restoring', () => api.restore(session.id))}>
                    Restore
                  </button>
                  <button type="button" className="btn-ghost" onClick={onReap}>Clean up…</button>
                </>
              ) : (
                <>
                  {/* TWO reasons a merged PR can still be unarchived, and they
                      are not the same refusal — this surface is the one an
                      operator opens after a merge, so it must name the one
                      that applies (spec: every refusal is named).
                      `archiveMerged` (server/src/watch.ts) skips on
                      `r.held !== null` BEFORE it ever asks `archiveSafety`,
                      so when a hold is present it is the whole cause and the
                      session is very often idle, not busy — "session busy"
                      there would send the operator to wait out a session that
                      is not running, a wait no sweep can ever end. The hold's
                      reason is rendered verbatim (shared/api.ts's no-parsing
                      rule) so the sentence names WHICH program refuses.
                      "Archive now" stays offered in both branches, and that is
                      not an oversight: `cmd_ws_archive` in ccd/ccd has no held
                      rung of its own (only `cmd_ws_rm`/`cmd_ws_reap` do), so a
                      by-hand archive of a held workspace succeeds. Only the
                      automatic gate is off. CITED BY SYMBOL, not by line: this
                      said `ccd:1415`, and the hold wave's own insertions pushed
                      `cmd_ws_archive` down past it, so the citation came to
                      point into `cmd_caps` — a line number is a fact about a
                      revision, a function name is a fact about the program. */}
                  {/* THREE reasons now, in the order of what the operator can
                      do about them. The hold still wins when both are present:
                      one sentence, never two — a note that stacks its reasons
                      is a note nobody reads. */}
                  <p className="pr-note">
                    {session.held !== null
                      ? `Not archived — held: ${session.held}. A held workspace is skipped by every sweep; release it (Release, in the session’s actions sheet) or archive it by hand below.`
                      : claimingRun !== null
                        ? `Not archived — run ${claimingRun.id} (${claimingRun.program} wave ${claimingRun.wave}${claimingRun.waveOf === null ? '' : `/${claimingRun.waveOf}`}) is still open on this workspace. Since Build 8 the sweep asks coord.db, not only the hold file, so releasing the hold will not archive it while that run is open. Close the run, or archive it by hand below.`
                        : 'Not archived yet (session busy)'}
                  </p>
                  <button type="button" className="btn-ghost" disabled={busy}
                          onClick={() => void archiveNow()}>
                    Archive now
                  </button>
                </>
              )}
            </>
          )}

          {pr?.phase === 'closed' && (
            <>
              {/* No note here. The lede above ALREADY reads "Pull request #N:
                  closed without merging. This branch's commits are not on
                  main." — prSentence's own `closed` case. This block used to
                  repeat that second sentence verbatim, so the same words
                  appeared twice on one screen (final-round integration
                  finding 5), and the copy could drift from the one the cap's
                  aria-label speaks. Deleting the second copy is the only fix
                  that makes the drift impossible rather than merely absent. */}
              {pr.url !== null && (
                <a className="btn-ghost" href={pr.url} target="_blank" rel="noreferrer">Open on GitHub</a>
              )}
            </>
          )}

          {pr?.phase === 'unknown' && (
            <button type="button" className="btn-ghost" onClick={load} disabled={busy}>Retry</button>
          )}
        </div>
      </Sheet>
      <QuickConfirm
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === 'draft' ? 'Open as draft?' : 'Open pull request?'}
        consequence={
          `Pushes \`${facts?.branch ?? session.branch ?? ''}\` to \`${facts?.repo ?? ''}\` and opens a public pull request. Reviewers are notified. ccrc cannot undo this.`
        }
        confirmLabel={confirm === 'draft' ? 'Open as draft' : 'Open pull request'}
        onConfirm={() => {
          const isDraft = confirm === 'draft';
          void act('Opening the pull request', () =>
            api.prOpen(session.id, { title, body: draft?.body ?? '', draft: isDraft }));
        }}
      />
      {/* The refusal, as a surface the operator can answer. `sessionId` is
          what opens it, so `undefined` (no refusal) renders nothing; an empty
          `runs` array reaches the sheet as `null`, which is its "name no id"
          case — the one distinction that must not collapse back into
          "no conflict". */}
      <ArchiveConflictSheet
        sessionId={conflict === undefined ? null : session.id}
        runs={conflict !== undefined && conflict.length > 0 ? conflict : null}
        onClose={() => setConflict(undefined)}
        onDone={() => { setConflict(undefined); load(); }}
      />
    </>
  );
}

// The confirmed workspace deletion. This component SHOWS what will be
// destroyed; it decides nothing. The token the audit returned goes back as
// `expect`, and ccd re-proves the entire world state against it at the instant
// of deletion — so a stale sheet, a second tab or a replayed request refuses
// `state-changed` instead of deleting.
//
// There is no override for any refusal, anywhere: no flag, no config file, no
// "Remove anyway". Move the files, or use a terminal.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { FleetSession, ReapResult, WsAudit } from '../../../shared/api';
import { Sheet } from '../components/Sheet';
import { toast } from '../components/Toast';
import { api, apiErrorText } from '../lib/api';
// Pre-merge fix round, finding 6: byte-for-byte identical to the local
// `bytes()` this file used to define — one shared formatter, imported,
// rather than two copies that could drift. `ArchiveScreen.tsx` is the
// existing home (`FleetScreen.tsx` already imports it from there).
import { humanBytes } from '../screens/ArchiveScreen';
import './chat.css';

const days = (epochSeconds: number): string => {
  const d = Math.floor((Date.now() / 1000 - epochSeconds) / 86_400);
  return d <= 0 ? 'today' : `${d} day${d === 1 ? '' : 's'} ago`;
};

/** A byte total this screen was actually given, or the word for not having been
 *  given one. Every size on the delete-confirmation surface goes through here.
 *
 *  `A number is a measurement`: a failed `du` yields `null`, never `0` — the
 *  house rule deviation 10 and pre-merge finding F already closed for
 *  `worktreeBytes`. `ignoredBytes` is the same figure for the not-in-git tree
 *  and ccd is being fixed (verifier round 3 P3, ccd lane) to stop answering a
 *  failed read with `0`; this is the display half, and it is safe to land
 *  first because the honest branch is simply unreachable while the producer
 *  still fabricates.
 *
 *  The parameter is wider than `WsAudit` currently declares on purpose. The
 *  wire type for `ignoredBytes` is still `number` (widening it is svc's, and
 *  `worktreeBytes` is already `number | null`), so this accepts `undefined`
 *  too: an old server, or a field dropped anywhere between ccd and here,
 *  renders the honest word instead of `NaN B`. Nothing about that degradation
 *  waits on another lane.
 *
 *  `unknown` is a parameter only because the two rows read differently: the
 *  worktree row is a bare figure in its own `<span>`, the not-in-git row is
 *  inline after a count, where a bare "unknown" would not say unknown WHAT. */
const sizeText = (bytes: number | null | undefined, unknown = 'unknown'): string =>
  (typeof bytes === 'number' ? humanBytes(bytes) : unknown);

/** The clips' total, which is a SUM and therefore the one figure here that can
 *  be wrong without any single input being wrong: `n + c.bytes` silently
 *  under-counts an unmeasured clip (`3 + null === 3`) and produces `NaN` for a
 *  missing one — a partial total, which the house rule bans by name alongside
 *  `0`. Same producer class as the two rows above (`_ws_clip_manifest`'s
 *  per-clip `du -sb`, ccd:2811, still answers a failed read with 0; that half
 *  is the ccd lane's), and the same answer ArchiveScreen already gives for a
 *  partially measured set: state what WAS measured and disclose the rest,
 *  rather than fold the unknown into the number. */
const clipsSizeText = (clips: { bytes: number }[]): string => {
  const measured = clips.map((c) => c.bytes).filter((b): b is number => typeof b === 'number');
  const unmeasured = clips.length - measured.length;
  if (measured.length === 0) return 'size unknown';
  const total = humanBytes(measured.reduce((n, b) => n + b, 0));
  return unmeasured === 0 ? total : `${total} + ${unmeasured} unmeasured`;
};

export function ReapSheet({
  session, open, onClose, onReaped,
}: {
  session: FleetSession | null;
  open: boolean;
  onClose: () => void;
  onReaped: () => void;
}): ReactNode {
  const [audit, setAudit] = useState<WsAudit | null>(null);
  const [result, setResult] = useState<ReapResult | null>(null);
  const [busy, setBusy] = useState(false);
  // `null` = the reader has not chosen; the default depends on the audit (see
  // `expanded` below). Their choice, once made, wins for this target.
  const [showAll, setShowAll] = useState<boolean | null>(null);

  const id = session?.id ?? null;
  // Final-round finding F2 (destructive review). `setAudit(null)` below fixed
  // only the SYNCHRONOUS half of the stale-audit defect. The asynchronous half
  // remained: two audits can be in flight at once (open on alpha → target
  // switches to bravo), and whichever RESOLVES LAST wins. When that is alpha's,
  // the sheet's header, title and confirm button say `bravo` (they come from
  // the `session` prop) while every measured row — workdir, size, ignored
  // paths, clips — and the TOKEN come from alpha. That is this whole surface
  // failing at its one job: describing what is about to be destroyed.
  //
  // `gen` is the generation of the audit the sheet is currently willing to
  // accept. It advances on every `load()` AND in the effect's cleanup, so it
  // advances on every change of target and on every close — which means a
  // response is rendered ONLY if no target change and no newer request has
  // happened since it was issued. There is no path by which a superseded
  // response reaches `setAudit` or `toast`.
  //
  // Fix round 3 (verifier P1/P2): the cleanup bump was previously NOT shipped,
  // on the reasoning that unmount and `id -> null` are unobservable. They are
  // observable — through `toast()`, which is a GLOBAL surface that outlives
  // this component's own render. Two inputs, both now pinned below in
  // reap-sheet.test.tsx: (a) the reader dismisses the sheet (`open -> false`)
  // while an audit is in flight and it then fails — a red error toast about a
  // workspace check for a sheet that is no longer on screen; (b) the fleet
  // sweep stops listing the target, so `sessions.find(...) ?? null` makes
  // `session` null (this component's `id` goes null and it returns null before
  // rendering) and the in-flight audit then fails — a toast about a session
  // that has left the fleet. Both are exactly what the catch guard below
  // already refuses for the target-switch case; the cleanup is what extends
  // that same refusal to the close and the drop. The comment above is now a
  // description of the code rather than of an intention.
  const gen = useRef(0);
  const load = (): void => {
    if (id === null) return;
    const mine = (gen.current += 1);
    setResult(null);
    // Pre-merge fix round, finding 17-F1: this used to clear only `result`,
    // so while a fresh audit is in flight the sheet kept rendering the
    // PREVIOUS audit — and its token. Two demonstrated consequences: a
    // Re-check re-posting the stale token, and FleetScreen briefly showing
    // one session's name/size next to another's stale path when the reap
    // target switches (both pinned in reap-sheet.test.tsx /
    // fleet-screen.test.tsx). A null `audit` is what renders "Checking…"
    // instead of a stale confirm button while the fetch below is in flight.
    setAudit(null);
    // The expand/collapse choice belonged to the PREVIOUS audit's list — a new
    // target (or a Re-check) gets its own default, chosen from its own facts.
    setShowAll(null);
    void api.workspaceAudit(id)
      .then((a) => { if (gen.current === mine) setAudit(a); })
      // The toast is generation-guarded too: an error belonging to a workspace
      // the reader has already navigated away from is a message about
      // something that is no longer on screen.
      .catch((e) => { if (gen.current === mine) toast(apiErrorText(e), 'error'); });
  };
  useEffect(() => {
    if (open) load();
    // Every teardown of this effect — close, target change, target dropped to
    // null, unmount — retires the generation it set up. Whatever is still in
    // flight belongs to a sheet state the reader has left.
    return () => { gen.current += 1; };
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [open, id]);

  if (!session) return null;
  const slug = session.workspace ?? session.id;
  // Second, independent gate on the same finding, and the one that does not
  // depend on any reasoning about ordering: an audit is rendered ONLY if the
  // audit itself says it is about this session. `WsAudit.id` is ccd's own
  // first field (`_ws_audit`, ccd:2541) and the first line of the
  // fingerprint the token hashes, so it is the response's own statement of
  // what was measured — not a label this component attached to it.
  //
  // This also covers the one window the generation guard structurally cannot:
  // `session` is `sessions.find(...) ?? null` at both call sites, so a fleet
  // update can drop the target to `null` and bring a DIFFERENT one back, and
  // the render that pairs the new session with the old `audit` state commits
  // BEFORE the effect that would clear it.
  //
  // Fails safe: a mismatch renders "Checking…" — refusing to describe —
  // rather than describing the wrong workspace.
  const shown = audit !== null && audit.id === session.id ? audit : null;

  // destructive F8 residual (critic2, uncovered). The FILTER POLICY is
  // deliberately untouched — the human partner's question about it is open,
  // and this is the display half only.
  //
  // The residual: the count of noise-filtered secret-shaped matches was
  // rendered beside an ignored list capped at three, and a filtered entry is
  // precisely the one that sorts last. ccd emits `ignored` sorted
  // sensitive-first then bytes-descending (ccd:2561) and a noise-filtered
  // match leaves the entry's `sensitive` at 0 (ccd:1996-2000), so its NAME sat
  // below the cap while the NUMBER claiming it sat above — "excluded must
  // never mean invisible" held for the count and failed for the name, which is
  // the only thing a human can actually judge a wrong filter by.
  //
  // ccd caps nothing on the wire (the `ignored` array is the whole set), so
  // showing it is sufficient: when anything was filtered, the entries are
  // expanded by default. The reader may still collapse them, and the collapsed
  // toggle always says how many entries it is hiding.
  const expanded = showAll ?? (shown !== null && shown.sensitiveFiltered > 0);

  const confirm = (): void => {
    // The token guard is a TYPE guard now, not a state the UI can reach:
    // deviation 19 makes `reapable` and a token inseparable on the wire, and
    // the button below renders on `reapable` alone, so a tokenless press is
    // gone rather than silently swallowed. It stays because `token` is
    // `string | undefined` in `WsAudit` and this is what narrows it — and
    // because a silent early return under a rendered primary button was
    // exactly the defect: it is now unreachable, which is the only acceptable
    // form of it.
    if (shown?.token === undefined || busy) return;
    setBusy(true);
    void api.workspaceReap(session.id, shown.token)
      .then((r) => { setResult(r); if (r.reaped !== undefined) onReaped(); })
      .catch((e) => toast(apiErrorText(e), 'error'))
      .finally(() => setBusy(false));
  };

  return (
    <Sheet open={open} onClose={onClose} eyebrow={session.project} title={`Remove ${slug}?`}>
      <div className="reap-sheet">
        {shown === null && <p className="reap-note">Checking…</p>}

        {shown !== null && (
          <>
            {/* The breadcrumb, said out loud. A retry after a killed reap used
                to re-audit an empty directory and certify "0 files". */}
            {shown.reaping !== null && (
              <p className="reap-refusal">{`Cleanup stopped part-way (${shown.reaping}).`}</p>
            )}

            <dl className="reap-rows">
              <dt>branch</dt>
              <dd>
                {/* MUTATION SURVIVOR, disclosed, on `shown.merge.proof ?? 'none'`
                    only: `??` -> `||` survives because `WsAudit['merge']['proof']`
                    is `'ancestor' | 'tree' | 'patch-id' | 'cherry' | null` —
                    four non-empty string literals and `null`, so no value the
                    type admits is falsy-but-non-null. The two operators act on
                    exactly the same inputs at every call site; a distinguishing
                    call would need the union to grow a falsy member. Same shape
                    as PrKeycap.tsx's and PrSheet.tsx's own disclosed survivors.
                    `shown.pr.number ?? '?'` on the same line is NOT equivalent —
                    `number | null` admits `0`, a real (if unusual) PR number —
                    and is pinned by a dedicated test instead. */}
                {`${shown.branch} — merged in #${shown.pr.number ?? '?'} (proof: ${shown.merge.proof ?? 'none'}), ${days(shown.merge.fetchedAt)}`}
              </dd>

              <dt>worktree</dt>
              <dd>
                {shown.workdir}
                {/* Its own node so the figure reads as a figure. Pre-merge fix
                    round, finding F: `worktreeBytes` is `number | null` —
                    `du` failing to read even one subdirectory used to hand
                    this a real, plausible, WRONG number instead of refusing
                    to answer. `null` says "unknown" rather than guess. The
                    ternary is `sizeText` now — one refusal, shared with the
                    not-in-git total below, rather than two spellings of it. */}
                <span className="reap-size">{sizeText(shown.worktreeBytes)}</span>
              </dd>

              <dt>uncommitted</dt>
              <dd>{shown.dirty.length === 0 ? 'none' : `${shown.dirty.length} files`}</dd>

              <dt>not in git</dt>
              <dd>
                {/* Verifier round 3, P3 (display half). This is the sole size
                    figure a human reads for the not-in-git tree before
                    authorising an irreversible `rm -rf`, and it was printed
                    with `humanBytes` directly — so the moment the producer
                    hands over anything other than a number, the screen either
                    states a total it does not have or says `NaN B`. `sizeText`
                    refuses instead, in the same word the worktree row two
                    `<dd>`s above already uses. */}
                {`${shown.ignoredCount} entries, ${sizeText(shown.ignoredBytes, 'size unknown')}`}
                {shown.ignored.length > 0 && (
                  <span className="reap-ignored">
                    {(expanded ? shown.ignored : shown.ignored.slice(0, 3)).map((e) => e.path).join(' · ')}
                  </span>
                )}
                {shown.ignored.length > 3 && (
                  <button type="button" className="btn-ghost" onClick={() => setShowAll(!expanded)}>
                    {/* The collapsed label carries the total, so the size of
                        what is hidden is never itself hidden. */}
                    {expanded ? 'show fewer' : `show all ${shown.ignored.length}`}
                  </button>
                )}
                {/* The count and the total are NEVER truncated: the judgement
                    this whole design rests on is a human reading a filename. */}
                <span className="reap-note">These are in no commit and cannot be recovered.</span>
                {/* F3 refinement (pre-merge fix round): a secret-shaped name
                    ending in a source, compiled or template extension is
                    filtered as vendored/build noise rather than flagged
                    sensitive. EXCLUDED must never mean INVISIBLE — this is
                    the count surfacing where a human can actually see it, so
                    a wrong filter is something anyone would notice. */}
                {shown.sensitiveFiltered > 0 && (
                  <span className="reap-note">
                    {`${shown.sensitiveFiltered} secret-shaped ${shown.sensitiveFiltered === 1 ? 'match' : 'matches'} filtered as vendored/template.`}
                    {/* Where to look. The sentence tracks the list's actual
                        state, so it is never a promise the screen is not
                        keeping (F8 residual). */}
                    {expanded || shown.ignored.length <= 3
                      ? ' Every ignored entry is named above.'
                      : ` Tap "show all ${shown.ignored.length}" to see them.`}
                  </span>
                )}
              </dd>

              {/* CLIPS ARE DELETED TOO, so they are listed. `~/.cc-clips/<id>`
                  goes at (h) with everything in it — full-resolution pastes,
                  which is the one thing here that exists nowhere else at all —
                  and a deletion the sheet does not name is not one anybody
                  consented to. The digest is in the token, so a clip pasted
                  after this rendered refuses `state-changed`. */}
              <dt>clips</dt>
              <dd>
                {shown.clips.length === 0 ? 'none'
                  : `${shown.clips.length} pasted image${shown.clips.length === 1 ? '' : 's'}, `
                    + clipsSizeText(shown.clips)}
                {/* Distinguishable from the "not in git" row's identical-meaning
                    note just above (deviation, Task 17): both are `reap-note`
                    spans and RTL's `getByText` throws on more than one match,
                    so two nodes carrying byte-identical text is not a
                    stylistic choice here — it is untestable. "pastes" keeps
                    the substring from ever colliding with the other row's
                    exact wording. */}
                {shown.clips.length > 0 && (
                  <span className="reap-note">
                    {shown.clips.length === 1
                      ? 'This paste is in no commit and cannot be recovered.'
                      : 'These pastes are in no commit and cannot be recovered.'}
                  </span>
                )}
              </dd>

              <dt>stashes</dt>
              <dd>{shown.stashes === 0 ? 'none' : `${shown.stashes}`}</dd>

              <dt>kept</dt>
              <dd>
                {`transcript, and ${result?.attic ?? shown.commitsAheadOfBase} commits pinned in the attic (ccd ws-attic)`}
              </dd>
            </dl>

            {shown.verdict !== 'reapable' && (
              <>
                <p className="reap-refusal">{shown.sentence}</p>
                {shown.sensitive.length > 0 && (
                  <>
                    <ul className="reap-sensitive">
                      {shown.sensitive.map((p) => <li key={p}>{p}</li>)}
                    </ul>
                    {/* The ONLY affordance a refusal ever gets, because the
                        remedy is to move these files. There is no override. */}
                    <button type="button" className="btn-ghost"
                            onClick={() => { void navigator.clipboard?.writeText(shown.sensitive.join('\n')); toast('Paths copied', 'info'); }}>
                      Copy paths
                    </button>
                  </>
                )}
              </>
            )}

            {shown.verdict === 'reapable' && result === null && (
              <button type="button" className="btn-primary reap-go" disabled={busy} onClick={confirm}>
                {/* The confirm this whole design exists to protect: it must
                    say "unknown size", never a number `du` could not stand
                    behind (finding F). `sizeText` rather than a third spelling
                    of the same ternary, so an ABSENT figure refuses here too
                    instead of reaching the button as `NaN B`. */}
                {`Remove ${slug} · ${sizeText(shown.worktreeBytes, 'unknown size')}`}
              </button>
            )}

            {result !== null && result.sentence !== '' && (
              <p className="reap-refusal">{result.sentence}</p>
            )}
            {result?.refused !== undefined && (
              <button type="button" className="btn-ghost" onClick={load}>Re-check</button>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}

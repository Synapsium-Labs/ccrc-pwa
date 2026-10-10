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
import { Button, Sheet, toast } from '@ccrc/ui';
import { api, apiErrorText } from '../lib/api';
import { childLine, sizeText } from './reapWords';
import { ReapAuditRows } from './ReapAuditRows';
import './chat.css';

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
  // first field (`_ws_audit`, ccd:3445) and the first line of the
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
  // sensitive-first then bytes-descending (ccd:3465) and a noise-filtered
  // match leaves the entry's `sensitive` at 0 (ccd:2885-2889), so its NAME sat
  // below the cap while the NUMBER claiming it sat above — "excluded must
  // never mean invisible" held for the count and failed for the name, which is
  // the only thing a human can actually judge a wrong filter by.
  //
  // ccd caps nothing on the wire (the `ignored` array is the whole set), so
  // showing it is sufficient: when anything was filtered, the entries are
  // expanded by default. The reader may still collapse them, and the collapsed
  // toggle always says how many entries it is hiding.
  //
  // `?? 0` on `sensitiveFiltered` (F3): `null` means the filter never ran, so
  // there is nothing it hid and nothing to expand for.
  const expanded = showAll ?? (shown !== null && (shown.sensitiveFiltered ?? 0) > 0);

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

            <ReapAuditRows
              shown={shown}
              result={result}
              expanded={expanded}
              setShowAll={setShowAll}
            />

            {/* D4: the checkouts nested under this workspace, named — never
                folded into the ignored total's own LIST above (that row
                counts not-in-git PATHS; these are git repositories of their
                own), even though their bytes sit inside that row's TOTAL —
                see the comment on the qualifier sentence above. `null` is
                unmeasured (Phase A refused before the child walk ran) and
                `[]` is measured-and-none, same discipline as every other
                list on this sheet — both render nothing here, which is the
                correct silence for "nobody looked" and for "looked, and
                there is nothing to name".

                I1 (whole-branch review): this list used to render with no
                label at all — silent, on a REAPABLE workspace, about the one
                fact the whole sheet exists to disclose before an
                irreversible delete: these checkouts are going too. D2's own
                per-child ladder already proved every one of them fast-
                forward-merged before a token was ever issued, so the intro
                names the exact mechanism (plain `-d`, never `-D`) rather than
                leaving a reader to guess whether "removed" means the same
                thing here as it does for the parent. On a refusal nothing is
                being removed yet, so that line only says the checkouts
                exist. */}
            {shown.children !== null && shown.children.length > 0 && (
              <div className="reap-children">
                <p className="reap-note">
                  {shown.verdict === 'reapable'
                    ? 'These checkouts are removed with the workspace — each branch is deleted with plain -d:'
                    : 'Checkouts of their own live under this workspace:'}
                </p>
                <ul className="reap-children-list">
                  {shown.children.map((c) => <li key={c.path} className="reap-child">{childLine(c)}</li>)}
                </ul>
              </div>
            )}

            {shown.verdict !== 'reapable' && (
              <>
                <p className="reap-refusal">{shown.sentence}</p>
                {shown.sensitive !== null && shown.sensitive.length > 0 && (
                  <>
                    <ul className="reap-sensitive">
                      {shown.sensitive.map((p) => <li key={p}>{p}</li>)}
                    </ul>
                    {/* The ONLY affordance a refusal ever gets, because the
                        remedy is to move these files. There is no override. */}
                    <Button variant="ghost"
                            onClick={() => { void navigator.clipboard?.writeText((shown.sensitive ?? []).join('\n')); toast('Paths copied', 'info'); }}>
                      Copy paths
                    </Button>
                  </>
                )}
              </>
            )}

            {/* THE HOLD, DISCLOSED BEFORE THE COMMIT, not after it. `ccd
                ws-audit` has no held rung — it answers `reapable` for a
                workspace `ws-reap` will then refuse with `{"refused":"held"}`
                — so without this the sheet rendered a full removable verdict
                and a live confirm token, and the refusal only arrived once the
                operator had tapped the destructive button. `session.held` is
                already on the wire and already in this component's props, so
                the fact is here the whole time; nothing about the audit needs
                to change to say it. Rendered verbatim (the no-parsing rule),
                and it REPLACES the button rather than disabling it: a disabled
                Remove with no sentence is the same silence in a different
                shape, and the remedy — release first — is not something this
                sheet can do. */}
            {shown.verdict === 'reapable' && result === null && session.held !== null && (
              <p className="reap-refusal">
                {`A program has this workspace held — ${session.held} — so nothing can be removed. Release it first (Release, in the session’s actions sheet), then re-check.`}
              </p>
            )}
            {shown.verdict === 'reapable' && result === null && session.held === null && (
              <Button variant="primary" className="reap-go" disabled={busy} onClick={confirm}>
                {/* The confirm this whole design exists to protect: it must
                    say "unknown size", never a number `du` could not stand
                    behind (finding F). `sizeText` rather than a third spelling
                    of the same ternary, so an ABSENT figure refuses here too
                    instead of reaching the button as `NaN B`. */}
                {`Remove ${slug} · ${sizeText(shown.worktreeBytes, 'unknown size')}`}
              </Button>
            )}

            {result !== null && result.sentence !== '' && (
              <p className="reap-refusal">{result.sentence}</p>
            )}
            {result?.refused !== undefined && (
              <Button variant="ghost" onClick={load}>Re-check</Button>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}

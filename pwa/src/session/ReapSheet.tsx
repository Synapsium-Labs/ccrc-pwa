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
import type { FleetSession, ReapResult, WsAudit, WsAuditChild } from '../../../shared/api';
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

/** The one word this sheet uses for a read that never happened — final-round
 *  tests review F3. It is a SINGLE constant rather than five string literals
 *  because the rows below must be indistinguishable in kind: a reader who
 *  learns what it means on the "not in git" row must not have to learn it
 *  again on "uncommitted".
 *
 *  It is deliberately NOT `sizeText`'s "unknown" / "size unknown". Those two
 *  say "a measurement was attempted and could not be completed" — a `du` that
 *  failed on one subdirectory. This says "no measurement was attempted at
 *  all", which is a different fact and, on a refusal that leaves the worktree
 *  standing, the more important one. The seam pass's residual #8 asked for
 *  exactly this: two kinds of "we are not telling you a number" on one sheet,
 *  worded apart. */
const NOT_SCANNED = 'not scanned';

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
 *  `0`. Same producer class as the two rows above, and the same answer
 *  ArchiveScreen already gives for a partially measured set: state what WAS
 *  measured and disclose the rest, rather than fold the unknown into the
 *  number.
 *
 *  PRODUCER LANDED (cross-lane seam round). When this was written, the ccd
 *  half still fabricated `0` and `clips[].bytes` was `number` on the wire, so
 *  every branch below was reachable only from a fixture that went past the
 *  compile-time type — disclosed as such at the time. `_ws_clip_manifest`
 *  (ccd:3106/3109) now emits `null` for a clip it could not size, and
 *  `WsAudit['clips'][number]['bytes']` is `number | null`, so the unmeasured
 *  branches are reachable from a real audit and the fixtures no longer have to
 *  lie to reach them. The earlier disclosure worried the producer might land
 *  as `-1` or as an omitted field instead; it landed as `null`, and the
 *  parameter stays deliberately wider than the wire (`undefined` too) so an
 *  older server or a dropped field degrades to the honest word rather than to
 *  `NaN B` — the same defence `sizeText` above carries, for the same reason. */
const clipsSizeText = (clips: { bytes: number | null | undefined }[]): string => {
  const measured = clips.map((c) => c.bytes).filter((b): b is number => typeof b === 'number');
  const unmeasured = clips.length - measured.length;
  if (measured.length === 0) return 'size unknown';
  const total = humanBytes(measured.reduce((n, b) => n + b, 0));
  return unmeasured === 0 ? total : `${total} + ${unmeasured} unmeasured`;
};

/** One line per nested checkout (D4): a `stray` earns no claim about its
 *  state beyond existing at `path` — `WsAuditChild`'s own docstring is why
 *  (an unregistered checkout ccd did not create). A registered child gets
 *  its real reading: the branch it is on, how many paths are uncommitted
 *  THERE, and the git operation in progress there, if any. `dirty === null`
 *  is defensive rather than reachable today — the type admits it, and this
 *  row refuses to print "null uncommitted" the same way every other row on
 *  this sheet refuses an unmeasured figure. */
const childLine = (c: WsAuditChild): string => {
  if (c.stray) return `${c.path} — not registered with git, contents unknown`;
  const dirty = c.dirty === null ? NOT_SCANNED : `${c.dirty} uncommitted`;
  const mid = c.busy !== null ? `, mid-${c.busy}` : '';
  return `${c.path} — ${c.branch ?? 'detached'}, ${dirty}${mid}`;
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
                {/* `fetchedAt` is `number | null` (F3). 0 is a real epoch
                    second, so the old unconditional `days()` turned a refusal
                    that never reached the PR fetch into "…, 20669 days ago" —
                    a date, on the same line as two fields that were already
                    saying `null` for that state. */}
                {/* `contained` gets its own sentence because the default one
                    would lie twice on the same line: "merged in #?" claims a
                    PR this verdict deliberately binds none of, and a reader
                    who has learned that `#?` means "not scanned yet" would
                    read a completed proof as an incomplete one. The date
                    tail is shared — it is the same fetch fact either way. */}
                {shown.merge.proof === 'contained'
                  ? `${shown.branch} — never pushed; origin already holds every commit on it (proof: contained), ${shown.merge.fetchedAt === null ? `merge ${NOT_SCANNED}` : days(shown.merge.fetchedAt)}`
                  : `${shown.branch} — merged in #${shown.pr.number ?? '?'} (proof: ${shown.merge.proof ?? 'none'}), ${shown.merge.fetchedAt === null ? `merge ${NOT_SCANNED}` : days(shown.merge.fetchedAt)}`}
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

              {/* F3. `dirty` is `string[] | null`, and the null is the whole
                  point: `[]` renders as **none**, the single most reassuring
                  word on this sheet, and ccd used to emit `[]` both for "the
                  tree is clean" and for "there was no tree to read, or the
                  read failed". Those are opposite facts about a directory that
                  a refusal leaves standing. */}
              <dt>uncommitted</dt>
              <dd>
                {shown.dirty === null ? NOT_SCANNED
                  : shown.dirty.length === 0 ? 'none' : `${shown.dirty.length} files`}
              </dd>

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
                {/* AND THE COUNT IS `number | null` NOW (F3). `sizeText`
                    already refused to invent the TOTAL; the ENTRY COUNT beside
                    it was still printed raw, so an unscanned workspace read
                    "0 entries, size unknown" — half honest, and the half that
                    was not is the half a reader takes as "there is nothing
                    here". Both halves come from the same scan, so they are
                    unmeasured together or not at all. */}
                {shown.ignoredCount === null
                  ? NOT_SCANNED
                  : `${shown.ignoredCount} entries, ${sizeText(shown.ignoredBytes, 'size unknown')}`}
                {shown.ignored !== null && shown.ignored.length > 0 && (
                  <span className="reap-ignored">
                    {(expanded ? shown.ignored : shown.ignored.slice(0, 3)).map((e) => e.path).join(' · ')}
                  </span>
                )}
                {shown.ignored !== null && shown.ignored.length > 3 && (
                  <button type="button" className="btn-ghost" onClick={() => setShowAll(!expanded)}>
                    {/* The collapsed label carries the total, so the size of
                        what is hidden is never itself hidden. */}
                    {expanded ? 'show fewer' : `show all ${shown.ignored.length}`}
                  </button>
                )}
                {/* The count and the total are NEVER truncated: the judgement
                    this whole design rests on is a human reading a filename.
                    The note is suppressed when nothing was scanned: "These are
                    in no commit and cannot be recovered" under a row that just
                    said `not scanned` reads as a statement about a set the
                    screen has, and it has none. */}
                {/* D4: scoped rather than dropped when nested checkouts sit
                    inside this same total — and the scoping is LOAD-BEARING,
                    not decorative. `_ws_collect_ignored` reads `git status
                    --ignored=matching`, which collapses a nested repository
                    to ONE entry at its own root (`!! .claude/worktrees/
                    agent-a/`), and `du -sb` on that collapsed entry recurses
                    the whole child — its `.git`, its own uncommitted work,
                    everything underneath. So a live checkout's bytes ARE
                    folded into `ignoredBytes` above (an earlier version of
                    this comment claimed the opposite — that ccd's collector
                    "stops at the child's root" and the two totals never
                    overlap; measured false: `du` does not know or care that
                    the directory it just recursed happens to be a `.git`
                    boundary). The unqualified sentence — "cannot be
                    recovered" — would tell a human that reclaiming this
                    total destroys nothing they could not get back, which is
                    backwards for exactly the bytes a children block just
                    named as live. `shown.children` is `null` (unmeasured) or
                    `[]` (measured, none) for the vast majority of audits, and
                    neither earns the qualifier. */}
                {shown.ignoredCount !== null && (
                  <span className="reap-note">
                    {(shown.children?.length ?? 0) > 0
                      ? 'These are in no commit and cannot be recovered — the total includes the nested checkouts listed below, which are live repositories, not disposable output.'
                      : 'These are in no commit and cannot be recovered.'}
                  </span>
                )}
                {/* F3 refinement (pre-merge fix round): a secret-shaped name
                    ending in a source, compiled or template extension is
                    filtered as vendored/build noise rather than flagged
                    sensitive. EXCLUDED must never mean INVISIBLE — this is
                    the count surfacing where a human can actually see it, so
                    a wrong filter is something anyone would notice. */}
                {shown.ignored !== null && (shown.sensitiveFiltered ?? 0) > 0 && (
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
              {/* AND `clips` IS `… [] | null` — the sixteenth instance of the
                  measurement-forgery class, one rung above the thirteenth
                  (`bytes`) documented on `clipsSizeText`. `[]` renders as
                  **none** two lines below, and ccd emitted `[]` both for "the
                  directory was read and holds nothing" and for "the directory
                  exists and could not be opened at all" — the second stated as
                  the first, above a Remove button that was reachable, about
                  the one thing on this sheet that exists in no commit and
                  nowhere else.

                  NOT `NOT_SCANNED`, deliberately, and this is the taxonomy
                  that constant's own comment sets out: "not scanned" means no
                  measurement was attempted, and here one was attempted and
                  failed — the third kind, worded apart from both, exactly as
                  "unknown" is worded apart from "not scanned". A `clips-
                  unreadable` refusal carries the remedy in its sentence
                  below; this row's job is only to not say **none**. */}
              <dt>clips</dt>
              <dd>
                {shown.clips === null ? 'could not be read'
                  : shown.clips.length === 0 ? 'none'
                  : `${shown.clips.length} pasted image${shown.clips.length === 1 ? '' : 's'}, `
                    + clipsSizeText(shown.clips)}
                {/* Distinguishable from the "not in git" row's identical-meaning
                    note just above (deviation, Task 17): both are `reap-note`
                    spans and RTL's `getByText` throws on more than one match,
                    so two nodes carrying byte-identical text is not a
                    stylistic choice here — it is untestable. "pastes" keeps
                    the substring from ever colliding with the other row's
                    exact wording. */}
                {shown.clips !== null && shown.clips.length > 0 && (
                  <span className="reap-note">
                    {shown.clips.length === 1
                      ? 'This paste is in no commit and cannot be recovered.'
                      : 'These pastes are in no commit and cannot be recovered.'}
                  </span>
                )}
              </dd>

              {/* F3, same rung: `stashes` is `number | null`, and a 0 nobody
                  counted renders here as **none** — a promise that nothing
                  stashed is at stake, made about a list `_ws_reap_eval` never
                  opened because Phase A refused first. */}
              <dt>stashes</dt>
              <dd>
                {shown.stashes === null ? NOT_SCANNED
                  : shown.stashes === 0 ? 'none' : `${shown.stashes}`}
              </dd>

              {/* THE "KEPT" ROW MAY NOT PROMISE A COUNT NOBODY HAS TAKEN —
                  final-round tests review F5. This read
                  `${result?.attic ?? shown.commitsAheadOfBase} commits pinned
                  in the attic`, so BEFORE the reap the figure was
                  `commitsAheadOfBase`, i.e.
                  `git rev-list --count "$base..refs/heads/$branch"`. That is a
                  different quantity from what `_ws_attic_pin` actually pins:
                  one ref per DISTINCT REFLOG SHA, `sort -u | head -200`, plus
                  the tip. The two are unequal in both directions — amends and
                  rebases push the reflog above the commit count, and past 200
                  the cap truncates — so on the sheet that describes an
                  irreversible delete this row could promise MORE retention
                  than the attic will provide. Overstating what survives is the
                  dangerous direction here.

                  So: before the reap, describe the RULE, which is exact and
                  needs no measurement; after it, `result.attic` is the count
                  `_ws_attic_pin` itself returned and the row states it. That
                  leaves `commitsAheadOfBase` unrendered, deliberately — it is
                  a real and useful figure in `ccd ws-audit`'s own output, and
                  it was only ever wrong as an answer to "how much of this
                  survives". */}
              <dt>kept</dt>
              <dd>
                {result?.attic !== undefined
                  ? `transcript, and ${result.attic} commits pinned in the attic (ccd ws-attic)`
                  : 'transcript, and the branch tip plus up to 200 more commits from its reflog,'
                    + ' pinned in the attic (ccd ws-attic)'}
              </dd>
            </dl>

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
                    <button type="button" className="btn-ghost"
                            onClick={() => { void navigator.clipboard?.writeText((shown.sensitive ?? []).join('\n')); toast('Paths copied', 'info'); }}>
                      Copy paths
                    </button>
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

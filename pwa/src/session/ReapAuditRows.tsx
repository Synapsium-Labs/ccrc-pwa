// What the reap sheet SHOWS — the audit, read out row by row, before anyone
// authorises an irreversible delete.
//
// WHY IT IS ITS OWN FILE. `ReapSheet.tsx` is two things: a FLOW (fetch the
// audit, hold its token, post the reap, render the result) and this READING
// SURFACE, which was two thirds of it and is where almost every argument on
// that screen lives — which figures may be stated, which must say `not
// scanned` instead, which may never be truncated, and why the "kept" row
// describes a RULE before the reap and a COUNT after it.
//
// IT DECIDES NOTHING. Every value it renders comes from the audit the flow
// measured or from `reapWords`; the one piece of state it touches is the
// ignored list's own disclosure, which belongs to the row that renders it.
//
// The classes stay `reap-*`: chat.css grounds them. The shape moves, the
// ground stays.
import type { ReactNode } from 'react';
import { Button, MONO_PATH } from '@ccrc/ui';
import type { ReapResult, WsAudit } from '../../../shared/api';
import { NOT_SCANNED, clipsSizeText, days, sizeText } from './reapWords';
import './chat.css';

export interface ReapAuditRowsProps {
  /** The audit this sheet is about — already proved to name this session. */
  shown: WsAudit;
  /** The reap's own answer once it has run, which two rows prefer to their
   *  pre-reap reading. */
  result: ReapResult | null;
  /** The ignored list's disclosure, owned by the sheet so it survives a
   *  re-audit. */
  expanded: boolean;
  setShowAll: (next: boolean) => void;
}

export function ReapAuditRows({
  shown, result, expanded, setShowAll,
}: ReapAuditRowsProps): ReactNode {
  return (
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
                  tail is shared — it is the same fetch fact either way.

                  IT NO LONGER SAYS "never pushed". `contained` is minted by
                  the containment ladder's first rung — "origin's default
                  branch holds every commit on this branch" — which is now
                  asked of EVERY branch rather than only of branches with no
                  upstream. A branch that was pushed and merged with a real
                  merge commit reaches it, and so does one whose PR is still
                  open while its commits have landed by another route; saying
                  "never pushed" about either is the same class of false
                  sentence the ladder itself was fixed for. */}
              {shown.merge.proof === 'contained'
                ? `${shown.branch} — origin already holds every commit on it (proof: contained), ${shown.merge.fetchedAt === null ? `merge ${NOT_SCANNED}` : days(shown.merge.fetchedAt)}`
                : `${shown.branch} — merged in #${shown.pr.number ?? '?'} (proof: ${shown.merge.proof ?? 'none'}), ${shown.merge.fetchedAt === null ? `merge ${NOT_SCANNED}` : days(shown.merge.fetchedAt)}`}
              {/* THE DRIFT NOTE, and it renders on a REAPABLE verdict as much
                  as on a refusal — which is the whole reason it exists. ccd
                  used to refuse a workspace whose registry entry and git's
                  worktree record named different branches, so the operator
                  met the disagreement as a wall. It now resolves it the way
                  `ccd ws-rm` always has (git's record decides, the registry
                  is a witness) and reaps, so the last moment anyone can see
                  WHICH branch is about to go is this sheet, before the tap.

                  Rendered from `drift` — ccd's own sentence — rather than
                  assembled here from the two names: the rule has one
                  definition, on the box.

                  THE CONDITION IS THE SENTENCE, NOT `headMatchesRegistry`,
                  and that is a correction rather than a shortcut. That flag
                  is `REAP_WTHEAD === registry branch`, and `REAP_WTHEAD` is
                  EMPTY on every refusal that never reached the worktree block
                  — `no-such-session`, `not-archived`, `worktree-missing`,
                  `detached-head`, `no-worktree-record` — so keying on it
                  renders "these two records disagree" over five states in
                  which nothing was compared at all. `drift` is non-empty only
                  where ccd actually measured a disagreement, which is the
                  same rule as everywhere else in this sheet: a field that was
                  never measured says nothing rather than something plausible.
                  An older ccd that sends no `drift` REFUSES on this state, so
                  its own refusal sentence is what a reader sees — the
                  information is not lost, it arrives by the older path. */}
              {shown.drift !== null && shown.drift !== '' && (
                <span className="reap-note">{shown.drift}</span>
              )}
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
              <span className={`reap-size ${MONO_PATH}`}>{sizeText(shown.worktreeBytes)}</span>
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
                <span className={`reap-ignored ${MONO_PATH}`}>
                  {(expanded ? shown.ignored : shown.ignored.slice(0, 3)).map((e) => e.path).join(' · ')}
                </span>
              )}
              {shown.ignored !== null && shown.ignored.length > 3 && (
                <Button variant="ghost" onClick={() => setShowAll(!expanded)}>
                  {/* The collapsed label carries the total, so the size of
                      what is hidden is never itself hidden. */}
                  {expanded ? 'show fewer' : `show all ${shown.ignored.length}`}
                </Button>
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
  );
}

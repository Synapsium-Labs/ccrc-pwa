# ccrc attachment tray — deferred items and follow-ups

Everything the implementation loop consciously did **not** do, with the reason.
Triaged by the whole-branch review before merge; the branch shipped with all
Critical and Important findings closed. Nothing here blocks anything.

Companions: [spec](2026-07-26-ccrc-attachment-tray-design.md) ·
[plan](../plans/2026-07-26-ccrc-attachment-tray.md) ·
[structured-questions spec](2026-07-26-ccrc-structured-ask-design.md) (not yet implemented)

## Worth doing

**A failed chip's reason is desktop-only.** `StagedImage.error` reaches a toast
and a `title` attribute, but `title` is hover-only and this is a mobile-first
PWA — once the 4.2 s toast expires, a failed chip on a phone carries nothing but
a red border. The contained fix avoids re-opening Task 10's hit-area work: for
**permanent** failures (`too-large`, `unsupported-type`) retry can never
succeed, so don't render the retry button at all and let the strip carry the
reason; transient failures keep retry and the strip stays its hit area. The two
never coexist, so the 44px question never arises.

**The server test helpers leak temp directories.** `testDeps` / `makeApp` and the
io tests `mkdtemp` under `/tmp` and never clean up: measured at **3,544
directories / 143 MB**, growing ~82 per full server run. Pre-existing and
genuinely outside this branch, but it is real disk on a long-lived fleet host.
An `afterEach` in `server/test/helpers.ts` covers most of it.

**`ccd clip`'s own `C-u` exposure.** `send.ts`'s `replaceDraft` clear is still a
single `C-u`, with the same kill-to-line-start question a multi-line draft
raises. Unlike the attachment path it fails *loudly* (`draft-clear-failed`,
carrying the residual), and the draft's line count is unknowable in advance, so
`parts.length` cannot be reused. Needs a different approach if it ever bites.

**Untested guards**, each verified manually but unpinned: the 12 MB `readB64`
cap; "agent unreachable → null" for `readB64`; the unsupported-type toast as an
integration test; jpg/jpeg/webp content types on the clip route (only `.png` is
covered, though `CLIP_MIME` and `CLIP_NAME_RE` are proven to agree).

## Deliberately left alone

**A 72px chip cannot hold two 44px-tall controls** (44+44 > 72). On a *failed*
chip, remove is 44×24 — the shortfall lands on the destructive action rather
than the recovery one, on purpose. Padding `.attach-tray` would buy the height
at ~28% more tray at rest; that is a design decision, not a bug fix.

**`.attach-tray`'s `overflow-x: auto` forces `overflow-y` to clip** (the CSS spec
couples the axes), trimming focus rings ~3px at the bottom and ~1px at the top.
Cosmetic; rings remain clearly visible.

**Two clip paths concatenated with zero separator** parse as one bogus path.
Unreachable: `composePrompt` joins with `\n`, `ccd clip` types a trailing space.
Tightening the regex risks the four position cases it must handle.

**A symlink named as a session id inside `clipsDir` is followed** — the
containment check is lexical, no `realpath`. Exploiting it requires write access
to `clipsDir`, i.e. already being inside.

**The 413 fires after the body is buffered.** Bounded by the pre-existing 25 MB
multipart ceiling, and it matches the spec's own sample.

**The multipart drain (`req.raw.resume()`) is untestable through `app.inject`** —
`light-my-request` never waits on the request stream, so deleting both calls
leaves the suite green. The guard is still correct for real HTTP/1.1; the tests
covering it are theatre and are kept only because deleting them is worse.

**A deeply-indented first line on a narrow pane** can straddle a wrap and fail
the echo check. Needs ~194 leading columns on the canonical 220-column pane.

**`submitted()` accepts any box row not starting with the needle.** If an overlay
ever drew a `❯` row *below* the input box, a swallowed Enter would read as
success. No capture shows this happening and the codebase's own overlay test
encodes the opposite.

**`PendingClipThumbs`' `clipUrl` fallback is dead code** — it was justified as
covering a pending rehydrated across a reload, but the store has no persistence.
Harmless; note it has no `onError` degrade if it ever did fire.

**Dead CSS from the migration**: three `.attach-btn[aria-busy]` blocks and a
now-false comment in `chat.css`. `@keyframes attach-spin` correctly stays — the
uploading chip uses it.

## Spec drift to reconcile

Three things the spec promises that the plan deliberately replaced, so the spec
now describes a UI that does not exist: the send button's `aria-busy` + arc
during uploads (it is simply disabled); "the click **waits** for the uploads"
(replaced by `!staged.uploading` in `canSend`, so Cmd+Enter mid-upload is
silently swallowed); and the drop overlay's centred `drop to attach` label with
a `--dur-fast` fade (only `.inputbar` recolours).

## Verified against the deployed fleet — 2026-07-27

All three items below were open pending a deploy. The deploy happened; here is
what it found.

1. **paste → send against a real session — PASSES.** Staging is silent (0 rows
   typed into the box on upload), the clip round-trips byte-identical through
   the agent's `readB64` (154,748 bytes), and an attachment send lands as ONE
   turn with the path above the caption. The chip UI half was already covered in
   real Chromium during implementation; the deployed bundle was re-measured at
   three viewports with zero console errors.
2. **Does a real `C-u` clear a multi-line draft? NO — and neither did our fix.**
   See below.
3. **T15 send-while-busy — PASSES.** Both back-to-back sends at a busy session
   return 200 in ~0.93 s, where before one was a false `enter-ignored` on a
   delivered message and the next a genuine `draft-present` refusal.

### What item 2 actually cost

`C-u` is kill-to-**row**-start, and a row emptied by a kill still needs a second
press to join its newline away, so an N-line draft costs **2N−1** presses — not
N. Measured on a live Claude Code 2.1.220 box with a capture between every
press: 1→1, 2→3, 3→5, 4→7. The shipped `parts.length` loop therefore
under-pressed *every* multi-line draft, stranding the first line — a bare clip
path — and making the next send fail `draft-present`: exactly the outcome the
loop was written to prevent.

Wrapped rows behave differently again: they cost under 2 presses each, so
charging 2 per **visual** row over-estimates a wrapped draft and is exact for an
unwrapped one. Two independent live runs disagree by one press on the wrapped
case (3 presses over 3 rows at 120 columns, 4 over 3 rows at 220), so that
number is an upper bound, not a cost.

Fixed on `ccrc/cu-clear`: a blind floor of 2 presses per visual row (fired with
NO reads — the clear runs on the verify-failed path, where the commonest cause
is a pane not rendering what we typed, so a loop that stops when the box "reads
empty" stops on the first read of exactly that stale frame), then look rounds
that only report residue, all bounded by a 3 s wall clock because it runs
holding the session's queue slot.

## Known residue in the `C-u` clear

Three Minor items survive that fix, each verified with a probe, none blocking.

**`replaceDraft` still partially destroys a very long draft.** The threshold
moved from 5 lines to roughly 10–13 (the real bound is the 3 s budget, not the
24-press cap). Past it, the presses that DID land are gone, only the first row
is reported back, and the send is refused. It self-heals — a second "replace"
clears the remainder and sends.

**The menu guard runs only after the blind burst, so the burst itself still
fires `C-u` into a live menu** — a wider window than the pre-fix code, not a
narrower one. Deliberately left: the obvious fix, sampling `hasMenu` mid-burst,
can STRAND TEXT. `hasMenu` false-positives on a numbered-list draft, the burst
is render-independent by design precisely so it cannot stop on a bad frame, and
bailing mid-burst at the attachment site leaves the clip path in the box. That
trades a Minor — `C-u` into a menu is not destructive; the cost is a 3 s stall
and an unhelpful error — for a chance of reintroducing the Critical failure this
whole change exists to remove. Revisit only with a menu signal that cannot
collide with the user's own text.

**Above ~275 visual rows the 3 s budget cuts the blind burst short.** A 500-line
prompt gets ~556 of the ~1001 presses it needs, so text stays in the box; on the
stale-pane condition that caused the verify failure in the first place, the
following read can come back empty and report "cleared" when it is not. The
budget exists to stop one send holding the session queue for a minute, so this
is a deliberate trade at a prompt size no observed message approaches.

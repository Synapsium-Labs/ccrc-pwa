# W7 C7q note: the departures the transcript copy's pairing took (2026-10-28)

Task C7q of `2026-10-27-consolidation-w7-pwa.md` (D-7206, D-7211, D-7212, D-7213). Each departure below is named by its
slug, in this note, in the commit that took it and in the PR body. The coordinator gets numbers for them from the
allocator; this note allocates none.

## slug hook-pairing-from-absent

The plan says the envelope's pairing is attached "(`from: 'hook'`)" and that an absent `from` reads `'hook'`. The hook's
pairing is sent with `from` ABSENT, as on `main`; only the transcript copy's pairing carries the key
(`from: 'transcript'`). So every hook pairing's bytes stay what they were (Q3g's table rows and its stream rows
compare them with `toEqual` and do not change), and the parity rows read `from ?? 'hook'`. The mutation "drop `from`"
still reds every transcript state.

## slug frame-pairing-pure-rule

The attach rule sits in `server/src/pane/askPairing.ts#framePairing(ask, dialog)`, pure (L1, beside `pairEnvelope`),
and `sessionws.ts#paired` calls it with the frame's own side and the side the stream last sent. The corpus parity row
drives `SessionStream#paired` itself (through the prototype, with the two sent sides), over the `dialog` frame and over
the envelope's own frame (`ask`, or `ask_cleared` when there is none), so the row reds on the real attach path, not on
a copy of it.

## slug askpairing-import-in-wire-commit

Step 1a's list puts `askPairing.ts`'s import of `transcriptQuestion` and `usableQuestions` in the move commit. The
server reads neither until the wire row, and an unused import fails `tsc`, so the import lands in Step 2's commit, the
one that first calls them. `askPairing.ts` defines neither (`transcriptCopyRules()` 1).

## slug ageing-out-as-hook-gone

Sequence (b), "an envelope ageing out under a standing menu", is recorded as the hook's envelope going away under the
standing menu (the hookstate gone): the same `applyHook` branch (`ask` null, so `ask_cleared`) an aged envelope that
`nextAgedKeep` does not keep takes. The keep decision itself is `askkey.ts`'s and C7q does not touch it.

## slug answer-reply-modelled

Sequence (e) records the answer route's reply body as the `{ ok: true, next }` value the routes return (`server.ts`
returns `res` on success), with `next` the re-read of the pane the answer moved, emitted on the bus as
`answered:<id>` the way `answeredFrame` emits it. The route itself is not driven (it needs the pane injection path);
the stream, its gate and its frames are the real ones.

## slug blank-envelope-pairs-the-copy

The plan's behaviour row says an `ask` frame for a blank envelope "carries the copy's pairing instead of the
envelope's". Its other arm is named here: a blank question envelope with no readable copy now carries no pairing, where
the base paired the blank envelope itself. A blank envelope is no question source (D-7213), as it is to `isUsableAsk`.
No PWA reads `pairing`, so nothing renders differently. Both arms are in the PR body's behaviour row.

## slug contrast-states-first-question

The transcript states are every question (single-select and multiSelect) of every corpus envelope on every parsed
corpus screen (675). The contrast states (a blank envelope, a partly aligned copy, an approval) are taken over each
envelope's first question with options on those screens (300 each), and a blank envelope with no copy over each screen
(25), so the recorded table stays reviewable (388 KB beside Q3a's 92 KB).

## slug review-copy-read-through-shared-rule

On a review screen with no usable envelope, `askSource` answers `review` and exposes no source, so the client side of
the parity reads whether the copy pairs through the shared `transcriptQuestion` (the rule both sides import). On those
rows the parity compares the pairing's values and not the choice of source; the choice is held on every structured row
by the permanent `from` row.

## slug blank-envelope-sequence

`TRANSCRIPT_SEQUENCES` carries one sequence beyond the plan's five: "(a) connect with a blank envelope and a copy", the
stream-level twin of the corpus' blank-envelope state (the `ask` frame for a blank envelope pairs the copy).

## slug split-step-1a

The plan puts Step 1a (the move to `shared/ask-menu.ts`, which edits `pwa/src/session/askLive.ts`) and Step 2 (which
edits `server/src/pane/askPairing.ts`) in one task. `askPairing.ts` is W3-owned (Q3g), and
`consolidation-path-guard.test.ts`'s W3 row is red on a diff that touches a `pwa/` path beside a W3-owned file. The
plan names only the W1a half of that guard, so it did not foresee this. The guard is not changed. Step 1a lands as its
own PR, first, and this PR is rebased onto it, so this diff carries no `pwa/` path.

## slug hook-copy-class

The corpus gains a HOOK+COPY class, the most common live state: every usable corpus envelope (`usableQuestions`) over
every parsed corpus screen whose `Dialog.ask` is the copy of one of that envelope's questions (675 rows: 459 that
`askSource` answers structured from the hook, 216 on review screens). Both sides pair the hook's envelope there. Before
it, the contrast states paired a copy only with no envelope, a blank one, a partly aligned one or an approval, so the
permanent `from` row stayed green when either side preferred the copy over a usable envelope; only one sequence row
held that choice. It is taken over every question, as the transcript class is. `transcript-corpus.json` is re-recorded
with 675 rows added and no existing row changed.

# Landing order wave 5o, Task 2: the held-head notice, decided and queued (D-9159)

Run 4111 (wave 36). Plan: `docs/superpowers/plans/2026-11-27-landing-order-wave5o-held-head.md`, Task 2. Built on `main`
`5576023f2553c43f53532a3445fdc48c25dda558`.

## Commits

1. The move: `landingNext.ts#nextLandingNoticeOf`'s recipient block becomes the private `episodeOf`, word for word, the
   word returned where `noSend(word)` was. `landing-next-mail` ran 49 passed (49), unchanged.
2. The behaviour, whole: `LandingHeldNoticeReason`, the `held` answer, the private `heldOf`, the held arm, the identity
   and body of section 5.5, the `held-queued` result kind, one local queue in `landingControlTx.ts` for both answers, both
   header comments, the new cases, the one existing expectation that changes, and the two census rows.

## The code, against the plan

- `heldOf` is section 5.3's, character for character.
- The held arm finds the head entry by `binding.entryId`, asks `heldOf`, then `episodeOf`, and answers `held`. A held
  binding the notice does not cover, or a head entry not found, answers the binding's own word, as before.
- The identity is section 5.5's thirteen members under `'landing-head-held'`. The body is its three paragraphs; the first
  is written as two concatenated template literals, which make the plan's one sentence byte for byte.
- `landingControlTx.ts#queueNotice` digests the identity and builds the subject and detail as template literals from the
  answer's kind (`next-to-land:#<pr>:<digest>` and `landing:next:v1:<digest>`, or `head-held:#<pr>:<digest>` and
  `landing:head-held:v1:<digest>`). `queued` answers `queued` for the cue and `held-queued` for the notice; the
  `run-gone` and `duplicate` mappings are shared. The invariant throw is worded for both. Its `row` parameter is typed
  `Parameters<typeof queueLandingNoticeTx>[1] | null`, so the file gains no import of the store's types.
- New quoted kebab tokens in `server/src/coord`: `'landing-head-held'` and `'held-queued'`, the two census rows.

## Red first (before the behaviour)

`landing-next-mail`: 14 failed, 54 passed (68).

- Red, as predicted: H1, H6, H7, H9; S1, S2, S3, S4, S5, S8, S9; S7 (its first step is S1's); the new third-row case of
  the changed existing case; and the `landingNext.ts` text case (`probedHeadOf(` occurred 0 times).
- Messages: `expected a held notice, got composition-not-clean` (H1, H7, H9), `expected 'composition-not-clean' to be
  'held'` (H6), `expected { kind: 'no-send', … } to match object { kind: 'held-queued' }` (the store cases),
  `Cannot read properties of undefined (reading 'body')` (S1, no mail), `expected +0 to be 1` (the text case).
- Green on the base, as predicted (characterization of today's answers): H2, H3, H4, H5, H8, S6, and the two-row store
  case.

## Green

- `landing-next-mail` 68 passed (68).
- Each alone: `mail-routes` 62, `landing-control` 65, `landing-terminal-damage` 64, `radar-lane` 78, `landing-read-route`
  32, `landing-entry-census` 40, `landing-ejection-ask` 8, `landing-advance-route` 35, `landing-writes-route` 36,
  `landing-doors-route` 15, `coord-policy-rings` 23, `rings/watcher-store-port` 23, `single-definition/core-vocab` 60:
  all passed.
- `tsc --noEmit -p tsconfig.json`: clean.
- `tsc --noEmit -p test/tsconfig.tests.json`: killed four times by the test slice's 6G memory cap, which other runs shared
  (exit 137, `Killed`). In its place a scratch project extending that config over the three changed test files and their
  imports: clean, after one fix (H2's `heldControl` parameter needed an explicit type). The pull request's run is the
  whole-tree check.

## Mutation rows (by hand: applied with the edit tool, the named cases run alone, restored, sha256 compared, green again)

| id | Mutation | Red, as printed |
|---|---|---|
| M1 | `heldOf` answers null | the changed existing case, H1, S1 (3 failed) |
| M2 | `heldOf` drops `probed.base.state === 'conflict'` | H2: `expected { kind: 'held', … } to deeply equal { kind: 'no-send', … }` |
| M5 | `heldOf` searches `control.probe.doc.heads` itself | the `landingNext.ts` text case: `.heads` matched once |
| M6 | `heldOf` drops the reason test | H3 and H5 (`… to deeply equal { kind: 'no-send', reason: 'paused' }`) |
| M7 | the identity drops `baseSha` | H9 (same identity on two bases), S3 (`duplicate` where `held-queued`) |
| M8 | the identity adds the reason and the probed head | H1 (15 members, not 13), H9 (length 15) |
| M9 | the run arm's detail carries `nowMs` | S2: the later clock queued again |
| M10 | `episodeOf` drops `run.id !== entry.runId` | H6 (`'held'` not `'run-unreadable'`) and the cue's recipient case (`'send'`) |
| M11 | `episodeOf` drops `run.state !== 'merging'` | H6 and the cue's recipient case (`run-not-merging`) |
| M12 | the transaction uses `head-held` for both answers | S7, the cue's queue case, the cue's M20 distinct-base case |
| M13 | the ready path answers `held` | H8, the cue's tuple case, the cue's queue case |
| M20 | `episodeOf`'s no-run arm takes `entry.setBy` | H7 and the cue's no-run case (`'lane-b'` not `'creator-a'`) |
| M25 | a held queue answers `queued` | S1, S8 and the changed existing case |
| M26 | the run-less subject carries `nowMs` | S5: the later clock queued again |
| M27 | the identity keeps only project, entry, PR, base and recipient | S4: the new pin answered `duplicate` |
| M28 | the identity drops the recipient | S9: the new recipient answered `duplicate` |
| M29 | the changed existing case left over all three rows | its third row: `expected { … } to deeply equal { kind: 'no-send', … }` |

After the last row the three files read back at their built sha256 (`landingNext.ts` `1a75bebd…f846`,
`landingControlTx.ts` `ce3778fa…54ba`, the test file `afb8668e…a38d` before the type fix) and the file ran 68 passed. The
type fix came after; the file ran 68 passed again at `ca0cbeb7…5168`.

## Claims and packets

- `landingNext.ts`, `landingControlTx.ts`, `landing-next-mail.test.ts` and this note under claim 7611.
- `server/test/mail-routes.test.ts` is another run's claim: the packet (two rows, 1587 bytes, sha256
  `87e3e771ebdbc92dce7b3fa66f8779132bd5e5f3a67dbdc974961955685c31fe`) was sent to its holder, who answered yes. The diff
  was applied as sent.

## What moved since the plan's baseline

Nothing in the cited owners: `nextLandingNoticeOf`, `applyLandingControlTx` and the census rows stood as the plan quotes.

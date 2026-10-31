# Consolidation W3, Task Q3g: what the build departed from

Task Q3g of `2026-10-26-consolidation-w3-questions.md` (D-7031; ARCH-58 (#793), server half) was built as the plan
says, with the departures below. Each is spelled `slug <name>` until the coordinator issues its number. The plan file
is not edited.

- **slug q3g-stream-pin-file.** The plan names two new test files. The Step 1 characterization pin is a third,
  `server/test/ask-pairing-stream.test.ts`, with its harness in `server/test/askPairingStream.ts`. The rows that say
  which frames carry which table row are in `ask-pairing.test.ts`, and the skew rows in `ask-pairing-skew.test.ts`
  share the same harness. The reason is that the pin is the PR's first commit and must stay green and unedited through
  the move commits. So it cannot live in a file that later commits extend.
- **slug q3g-stream-pin-bytes.** The pin records each frame's bytes as the first 16 hex digits of the sha256 of its
  JSON, taken with a top-level `pairing` key removed and nothing else changed. The full frames are not written
  inline. A dialog frame carries the whole raw pane, so the frames run to kilobytes, and the hash holds the same fact:
  any change to any other byte fails the row, including a `pairing` placed inside `dialog`.
- **slug q3g-pairing-before-mask.** The stream computes `pairing` from the envelope and dialog it is about to send,
  before the stream's masker (`SessionStream`'s `send`, `maskDeep`) runs. Today's client pairs the masked frames. The
  two can differ only when the masker rewrites a question or option label, which none of the corpus's labels trigger.
  The server's answer is the one over the labels as Claude wrote them.
- **slug q3g-type-home.** The module commit declared `AskPairing` in `pane/askPairing.ts`. The wire commit moved it
  into `shared/api.ts` beside `DialogAsk`, and the module re-exports it from there. Before the move commit, the module
  commit also imported `pairMatches` from `transcript/ask.ts`, and the move commit reversed that direction. These keep
  the plan's commit order (the module, the move, the wire fields, the senders, the cap word), and every commit is
  green.
- **slug q3g-title-rules-count.** Q3a's `envelopePairingTitleRules` goes from 2 to 4 (`titleMatches` and
  `WRAP_BAR_RE` now on both sides). This is the port, "server envelope pairing 0 -> 1", and no ratchet holds this
  count. W7 brings it back to 2 when it deletes the client's copy.
- **slug q3g-presence-citation.** The child-reclamation spec cites the presence constants by line, at
  `shared/api.ts:4638-4639`, and `collect-lane-prose.test.ts` checks that citation. `AskPairing`'s 17 lines beside
  `DialogAsk` move those constants down 17 lines. The wire commit re-cites them at their new lines, 4655-4656, in the
  same commit that moves them. The spec file is outside the ledger guard. Any later PR that grows `shared/api.ts` above
  those lines must re-cite them the same way.

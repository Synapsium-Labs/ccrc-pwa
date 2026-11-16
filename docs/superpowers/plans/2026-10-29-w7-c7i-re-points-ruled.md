# W7 C7i: the re-points beyond the task's list

- **D-7459 (2026-10-29)** — W7 C7i: re-points beyond the task list: two more recap test inputs carry the flag, and the old-PWA skew row reads a frozen copy.

**D-7459.** Task C7i of `docs/superpowers/plans/2026-10-27-consolidation-w7-pwa.md` (D-7187) lists its re-pointed files: `pwa/test/chat.test.tsx`'s `foldsAway` rows (their inputs gain the flag where the server sets it) and `pwa/test/markdownCorpus.ts` (the `COMPACTION_RE` reference). The build found three more pins that read the deleted pattern's verdict. Each is re-pointed in the same way, and no assertion is loosened or dropped.

1. **`pwa/test/chat-scroll.test.tsx`.** Its three recap rows (the post-compaction session priced as one folded card, and the recap folded whoever said it) are user- and assistant-kind inputs that `COMPACTION_RE` folded. They gain `compaction: true`, which the server sets on each (the recap sentence at the start). The plan's review focus 7 names this rule: every corpus row `COMPACTION_RE` folds today carries the flag.
2. **`pwa/test/markdown-golden.test.tsx`.** `openedRecap()` renders `RECAP_CASE` as an assistant event. Its event now carries the case's own `compaction` (`RECAP_CASE.compaction`, true). The golden file `test/golden/markdown/recap-opened.html` does not change.
3. **`server/test/w7-compaction-parity.test.ts`, C7h's skew row** ("an old PWA ignores the key"). The row called today's `foldsAway`. C7i moves `foldsAway` onto the flag, so after C7i the old client the row describes is no longer in the tree. The row now reads that client's verdict from a copy frozen byte for byte (the deleted pattern, over a user- or assistant-kind text). It first holds the copy to the verdict C7a recorded for that client (the recap, and the recap a person typed), so the copy cannot drift. The row is green before and after C7i, with the same assertions. The other direction, this PWA against a server without the flag, is the new skew row C7i adds (no flag folds nothing).

The proof that each flag is the server's is a new row in `server/test/w7-compaction-parity.test.ts`. It imports `pwa/test/markdownCorpus.ts` by path and parses every corpus case and every recap placement as the user record and the assistant record Claude Code writes. The parser's flag must equal the case's own `compaction`.

The plan file is not edited, because merged plans are append-only. This note is the record.

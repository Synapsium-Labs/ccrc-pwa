# Train record block: ruled 2026-10-29

**Context.** #1797 proves a member PR that a merge train landed and closed by the
train's record. Review found that the record the PR parsed, a `- #<n> <head sha>`
list item anywhere in the train PR body, was a format of its own: no train tool
wrote it, so a real train-landed member would have been refused cleanup for ever.
The coordinator ruled the format on 2026-10-29.

**Ruling.**

1. A train PR body carries exactly one machine-readable block: an HTML comment on
   lines of its own, `<!-- ccrc-train v1`, then one line per member
   `member #<N> <40-hex head sha>`, then `-->`. Human tables may also appear and
   are never parsed.
2. A member is proven landed in a train only when it is CLOSED with the
   landed-in-train label, the train PR it names (by the label comment, or by a
   search for train PRs whose block lists it) is MERGED, and that train's block
   lists this member at exactly the member's head sha.
3. The format is documented once in the repo (the README, beside
   `CCD_LANDED_LABEL`), so the train tool can follow it.

## Deviations found

- **D-7335 (2026-10-29)** — The train record is the one `ccrc-train v1` block in a train PR's body (`<!-- ccrc-train v1`, `member #<n> <40-hex head sha>` per member, `-->`, each on its own line), and `_pr_py train-check` reads nothing else. Human tables and lists are never parsed. No block, two blocks, an unclosed block, a non-member line inside it or a member listed twice proves nothing; a member listed at another sha, or a train that is CLOSED unmerged, refuses `not-merged`. Rows in `ccd-ws-audit.test.ts` (the train describe block): table-only body, block not on its own lines, two blocks, a foreign line, a duplicate member and an unclosed block all refuse; one block listing two members lands both.

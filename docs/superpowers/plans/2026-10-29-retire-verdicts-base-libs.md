# The retire-verdicts merge-base ccd carries every library: ruled 2026-10-29

**Context.** #1897 (D-7463) gave `ccd/ccd` a second sourced library, `ccd/lib/train-proof.sh`. The differential half of `server/test/ccd-retire-verdicts.test.ts` runs the merge base's `ccd` beside today's, and its `baseCcd()` extracted only `ccd/lib/disk-retention.sh` beside the base's body. Once a branch's merge base contained #1897, that base `ccd` loaded without `ccd/lib/train-proof.sh`: its loose column answered rc 98, and its reap column died on an unbound variable. The file's 15 rows went red wherever it ran: on a pull request whose run selected it, as at least six did, and in the merge queue, as one run did. By the same code it would red `main`'s daily run too.

**Fix.** `baseCcd()` writes every file that the merge base's own tree holds under `ccd/lib/` beside the extracted body, at its repository-relative path. A base from before #1897 then extracts its tree without `ccd/lib/train-proof.sh`, and a base after it extracts that file too.

## Deviations found

- **D-7496 (2026-10-29)** — `retire-verdicts-base-every-lib`: the retire-verdicts differential extracts every file the merge base's own `ccd/lib/` holds, not one fixed library, so a base on either side of a library move runs. Row: a case pins the extracted tree's `ccd/lib` listing as equal to the base's, and M1 (writing only the first listed file) turns it red.

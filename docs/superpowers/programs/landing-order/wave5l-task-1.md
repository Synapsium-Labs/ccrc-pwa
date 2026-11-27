# Wave 5l, Task 1: the prover reads the train tool's block (D-9111)

Run 3942, programme `landing-order`, wave 32. Plan: `docs/superpowers/plans/2026-11-26-landing-order-wave5l-train-landings.md`,
Task 1, with section 12's corrections.

## Base and what moved

- Built on `main` at `ad52d25f4b7250f3dc27e179aac8fde04d52b073`, newer than the plan's source baseline `f45fce5aee`.
- `ccd/lib/train-proof.sh`, `server/src/prstate.ts` and `server/test/ccdPrHelpers.ts` are byte for byte the same at both
  commits (`git diff f45fce5aee ad52d25f4b -- <path>` answers nothing), so every cited owner reads as the plan read it.

## Claims

Claim 7333 (run 3942) holds the four code files and this note, with every other path of the wave. No path of this task
was held by another session.

## What changed

- `ccd/lib/train-proof.sh`, `_pr_train_py`'s `train-check`: `train_block` answers `('absent', None)`, `('ok', map)` or
  `('bad', why)` with its sentences unchanged; `members_block` reads the tool's block in section 4.1's grammar, its parse
  catching `(ValueError, RecursionError)`; `train_members` is the one parser the loop calls, by section 4.2's table, and
  answers the `form` the loop's two sentences name. The `train-check` comment's description of the v1 format now points
  at the README's "The train record" (section 4.2's budget paragraph); two python comment lines name D-9111 (that
  comment's edited opening, and `train_members`'s header). The file header and `_ws_train_record`'s header comment say
  what changed (bash comments, outside the growth count). (Fix round 1, F5: this note said one python comment line.)
- Growth: `ccd/lib/train-proof.sh` measured +32 net against `ad52d25f4b` as the growth check counts it
  (`growthCheck.ts#codeLines`: bash code lines plus every non-blank heredoc line, so the python's comments count and the
  bash comments and blank lines do not; 343 to 375), under the 40-line limit; no waiver. The diff itself is +62 -25
  lines (`git diff --numstat`), blanks and comments included.
- `server/src/prstate.ts`: the `landedInTrain` comment names both forms of the train record. Comment only.
- `server/test/ccdPrHelpers.ts`: `rawTrainMembers`, `trainMembers` and `toolTrainRow` (section 9).
- `server/test/ccd-train-members.test.ts` (new): P1 to P38 and P9b, 46 cases (P4 runs four bodies, P7 four, P34 two).

## The baseline split (section 9.1, F3)

Run once before the parser changed, on the new file:

- Green: P9b, P11, P15, P16, P17, P30.
- Red: every other case, 40 in all (P1 to P8, P9, P10, P12 to P14, P18 to P29, P31 to P38, with P4's, P7's and P34's
  bodies each counted).

This is the plan's baseline column exactly; no row differs. P12 to P14 were red because today's parser PROVES through
the v1 block (`50\t<M>`), and the tool-only refusals because today's sentence is `carries no ccrc-train v1 block`.

After the parser change the file is green: 46 passed.

## Regressions run (one file per process, `ccrc test`)

Each file alone, one vitest process, through `ccrc test`, after the parser change:

| File | Result |
|---|---|
| `ccd-train-members` | 46 passed |
| `ccd-pr-state` | 228 passed |
| `ccd-pr-landing` | 67 passed |
| `ccd-ws-audit` | 174 passed, 4 skipped |
| `ccd-ws-reap` | 122 passed |
| `pr-sweep` | 48 passed |
| `pr-timeout-budget` | 20 passed |
| `ccd-lib-load` | 103 passed |
| `ccd-ws-add-child` | 20 passed (no `PR_NUM` spelling added) |
| `ccd-harness-integrity` | 13 passed |
| `growth-check` | 63 passed, 3 skipped |

No file needed a re-run.

## Mutation rows (section 10)

Each row: the mutant applied in place by a driver under the session's temp root, the named file run once through `ccrc test` (vitest, `--maxWorkers=2`), every listed case red, then the file's original bytes written back and their sha256 checked equal to the committed file's. No mutant survived.

| id | Mutation | File | Run | Red cases (measured) | Restored sha256 |
|---|---|---|---|---|---|
| M1 | `members_block`'s sha check is `[0-9a-fA-F]{7,40}` | `ccd/lib/train-proof.sh` | ccd-train-members.test.ts | P2: a short sha beside a valid #42 proves nothing; P3: an uppercase sha beside a valid #42 proves nothing | `8f807fd7d5de9a55803d3c768e3c03c85dcba62d932a40ee07a1b0ea03e7e141` |
| M2 | `members_block`'s `type(pr) is int` test dropped (decimal check kept) | `ccd/lib/train-proof.sh` | ccd-train-members.test.ts | P4: a pr of "43" beside a valid #42 proves nothing | `8f807fd7d5de9a55803d3c768e3c03c85dcba62d932a40ee07a1b0ea03e7e141` |
| M3 | `members_block` takes the first opening line and ignores a second | `ccd/lib/train-proof.sh` | ccd-train-members.test.ts | P5: two tool blocks, both listing #42 at its head, prove nothing | `8f807fd7d5de9a55803d3c768e3c03c85dcba62d932a40ee07a1b0ea03e7e141` |
| M4 | `train_members` answers v1's map when both read (`if v != tm` made `if False`) | `ccd/lib/train-proof.sh` | ccd-train-members.test.ts | P12: both blocks, the tool's listing #42 at another sha, prove nothing; P13: both blocks, the v1 block listing a member the tool's does not, prove nothing | `8f807fd7d5de9a55803d3c768e3c03c85dcba62d932a40ee07a1b0ea03e7e141` |
| M5 | `train_members` answers the union of both maps, v1's entries over the tool's | `ccd/lib/train-proof.sh` | ccd-train-members.test.ts | P12: both blocks, the tool's listing #42 at another sha, prove nothing; P13: both blocks, the v1 block listing a member the tool's does not, prove nothing | `8f807fd7d5de9a55803d3c768e3c03c85dcba62d932a40ee07a1b0ea03e7e141` |
| M6 | the loop drops the `state != 'MERGED'` test | `ccd/lib/train-proof.sh` | ccd-train-members.test.ts | P16: an OPEN train with a valid tool block and merge facts is not read as proof | `8f807fd7d5de9a55803d3c768e3c03c85dcba62d932a40ee07a1b0ea03e7e141` |
| M7 | `members_block` has no duplicate-member check | `ccd/lib/train-proof.sh` | ccd-train-members.test.ts | P8: #42 listed twice proves nothing | `8f807fd7d5de9a55803d3c768e3c03c85dcba62d932a40ee07a1b0ea03e7e141` |
| M8 | `json.loads` without the `object_pairs_hook` | `ccd/lib/train-proof.sh` | ccd-train-members.test.ts | P7: content that is a key given twice proves nothing | `8f807fd7d5de9a55803d3c768e3c03c85dcba62d932a40ee07a1b0ea03e7e141` |
| M9 | `train_members` answers no map when v1 reads and the tool's block is absent | `ccd/lib/train-proof.sh` | ccd-train-members.test.ts | P15: a hand-added v1 block alone still proves; P30: a v1 block with no member at all keeps today's sentence; P9b: the v1 block alone at another sha keeps today's sentence, byte for byte | `8f807fd7d5de9a55803d3c768e3c03c85dcba62d932a40ee07a1b0ea03e7e141` |
| M19 | `json.loads` without `parse_constant` | `ccd/lib/train-proof.sh` | ccd-train-members.test.ts | P7: content that is NaN in the never-read key proves nothing | `8f807fd7d5de9a55803d3c768e3c03c85dcba62d932a40ee07a1b0ea03e7e141` |
| M20 | `members_block` accepts an empty array | `ccd/lib/train-proof.sh` | ccd-train-members.test.ts | P7: content that is an empty array proves nothing | `8f807fd7d5de9a55803d3c768e3c03c85dcba62d932a40ee07a1b0ea03e7e141` |
| M21 | the loop's two sentences always say `ccrc-train v1 block` | `ccd/lib/train-proof.sh` | ccd-train-members.test.ts | P10: the tool block does not list #42; P37: both blocks, equal maps, not listing #42: the sentence names both; P38: both blocks, equal maps, listing #42 at another sha: the sentence names both; P9: the tool block lists #42 at another sha, and the sentence names the tool block | `8f807fd7d5de9a55803d3c768e3c03c85dcba62d932a40ee07a1b0ea03e7e141` |
| M22 | `members_block` compares its fence lines without stripping them | `ccd/lib/train-proof.sh` | ccd-train-members.test.ts | P21: fence lines indented by two spaces prove; P36: fence lines indented by one tab prove | `8f807fd7d5de9a55803d3c768e3c03c85dcba62d932a40ee07a1b0ea03e7e141` |
| M23 | the absent sentence drops the words `ccrc-train v1` | `ccd/lib/train-proof.sh` | ccd-train-members.test.ts, ccd-ws-audit.test.ts (`-t` naming P18 and the two no-block audit cases) | P18: the tool's table and trailer alone, with no block, prove nothing; REFUSES when the block is not on lines of its own; REFUSES when the train PR body has only the human table and list, no ccrc-train block | `8f807fd7d5de9a55803d3c768e3c03c85dcba62d932a40ee07a1b0ea03e7e141` |
| M24 | `train_members` treats a bad members block as absent when the v1 block reads | `ccd/lib/train-proof.sh` | ccd-train-members.test.ts | P14: a v1 block that proves beside a tool block that never closes proves nothing | `8f807fd7d5de9a55803d3c768e3c03c85dcba62d932a40ee07a1b0ea03e7e141` |
| M26 | `members_block`'s parse catches `ValueError` alone | `ccd/lib/train-proof.sh` | ccd-train-members.test.ts | P31: 100 000 nested brackets are caught by the parse, and the prover prints its line | `8f807fd7d5de9a55803d3c768e3c03c85dcba62d932a40ee07a1b0ea03e7e141` |

Against the plan's predictions: every predicted case is red. M9 also reds P9b and P30 (a v1-only body then answers the
mutant's sentence), and M2's boolean and float bodies stay green under it, as row M2 says (the decimal check refuses
them too: characterization pins).

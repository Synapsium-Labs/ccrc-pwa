# Updates: the text-only residue carried past the programme's close

- **D-8393 (2026-11-12)** — the centralised-update programme's text-only residue: the wave 33 plan's three As built table wordings (#2079's review notes) and R44's four plan wordings in the wave 26 and wave 31 plans, each re-measured where it states a measurement; no code or test changes.

Refs #2083 (its "Text only (comments and plans)" section: #2079's review notes and R44 of
`docs/superpowers/programs/centralised-update-management.md`).

## What changes

- **The wave 33 plan's As built tables** (`2026-11-01-centralised-update-w33-installer-defences-and-pair-retired.md`).
  The ledger and #2083 count three wording fixes without naming them, so each table claim was read against the
  wave's merged tree (`de4eb553c`) and, where it states a red, re-measured:
  - Review Focus row 1 said every name-rule row "asserts exit 1, that the second fetch never ran, and that the raw
    name is on neither stream". Only the seven refused-name rows do; the UTF-8 caller locale row asserts exit 1, the
    rule and one fetch, and the 128-byte and `*` marker rows assert that the release installs.
  - Mutation rows 2 to 6 named "defaults" as a red row. The five-defaults pin reads only the default lines and stays
    green under every flag mutant; the row each reds beside the flag-set row is the knobs row.
  - Mutation rows 18 and 19 said "every name row". The 128-byte and `*` marker rows assert no refusal, so neither
    mutant can red them.
- **R44, the wave 31 plan** (`2026-10-24-centralised-update-w31-guard-reads-every-step-and-actions-bump.md`): M4, review
  900's mutant, is a table row; the "every new or changed row is red" sentence is narrowed to the rows that pin a
  behaviour; the claims bullet says the two comment-only edits under the later claims were accepted as Task 3's own
  comment amendments; the Task 3 table and the As built bullet say a failed credential removal warns or says nothing,
  as the shipped workflow comments do; the stale-history bullet names the wave 26 amendment.
- **R44, the wave 26 plan** (`2026-10-23-centralised-update-w26-release-build-holds-no-write-credential.md`): D-6726's
  headline and the Architecture table name the majors wave 31 moved to, beside the ones they first named.
- **The programme ledger:** each of those items is marked fixed on its own lines.

## Tests

Measured on `main` at `9bd351975`, each mutant applied to a saved copy, run once, and restored (checked with `cmp`):

- R44's M4 (times-build's `[ "${#reports[@]}" -eq 0 ] &&` dropped from its single-file fallback): with
  `ci-pipeline.test.ts` filtered to the times-build rows, 1 of 7 red, the row where a `times.json` beside the
  per-artifact directories is not handed a second time.
- Wave 33's mutants 2 to 6 against `install-sh.test.ts`: each reds the flag-set row and the knobs row (2 to 4 also
  their knobs' validation rows); the defaults pin stays green under all five. This Mac skips the four Linux-only host
  rows, so the size, trickle and below-the-floor reds in those rows were not re-measured.

## Deviations found

- R44's last item (the name-set row in `release-artifact.test.ts`, and the comments crediting both checks) is not
  here: another open PR carries it.
- #2079's other review notes in #2083's text section (the `build-line.test.tsx` comments, the `install-sh.test.ts`
  assertion that could not fail, and the traversal row's name) touch test files, not plans, and are already fixed
  on `main`: the two `build-line.test.tsx` comments say #2079 retired the pair (#2308), and the traversal row
  plants `../ccrc-evil.tar.gz` with a tarball check that can see a write (D-8385, #2696).

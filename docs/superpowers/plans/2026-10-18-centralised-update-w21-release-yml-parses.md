# release.yml parses again, and every workflow is held to parsing: Implementation Plan

Centralised update management, wave 21. This plan is the record of the change, written beside the code from `main` at `4f227da9`. Deviation numbers 5565 to 5569 were issued to this wave's run; it defines 5565 and 5566 and leaves 5567 to 5569 unused.

**Goal:** `.github/workflows/release.yml` parses as YAML again, with the release-notes step behaving exactly as before, and a test fails the build whenever any workflow or composite action stops parsing.

## The measured defect

1. **#645 broke the file.** #645 (`62db8d3b5`, "every release says what changed") added a "Write the release notes" step whose `run:` value at line 95 was a one-line PLAIN scalar containing `release.yml: could not`. Inside a plain scalar, YAML reads `: ` as a mapping indicator, so the file no longer parses ("mapping values are not allowed here", line 95). Measured with the parser this wave adds: `62db8d3b5~1` parses with 0 errors; `62db8d3b5`, `c1453e422` (v0.0.299, now stable) and `origin/main` each report 6.
2. **What it costs.** GitHub records a jobless failed `release.yml` run on every push since then, and a hand-pushed `vX.Y.0` tag would build nothing. That blocks the update-management spec's W1 exit clause "verifies under both identities", because the tag identity is `release.yml`'s.
3. **Why nothing caught it.** `build-release.test.ts` and `release-main.test.ts` pin `release.yml` as TEXT, and every byte they look for was still there. No test parsed any workflow as YAML.

## The change

**A. The guard (D-5565).** `server/test/workflow-yaml-parses.test.ts` reads the file list from the tree: every `.github/workflows/*.yml`/`*.yaml`, and every `.github/actions/<name>/action.yml`/`action.yaml`. A hand-kept list would miss a workflow added later. Each file must:

- parse with no errors, using `parseDocument(src, { uniqueKeys: true })` from the `yaml` package;
- be a mapping with `jobs:` (a workflow) or `runs:` (a composite action);
- have no one-line PLAIN `run:` that a ` #` comment cut short. This is the silent case of the same defect: YAML does not know shell quoting, so `run: echo "a #b"` parses, and the shell receives `echo "a`.

A first case checks that the scan found all five current files, so an empty list cannot pass.

**Which parser, and why.** Node has no YAML parser, and the server package had none. Measured on this box: `python3` with PyYAML is present and `ruby` is absent. Neither is a contract on GitHub's `ubuntu-latest` or `macos-latest` images, and the server suite runs on both (`test (server)`, `test-macos`). A guard that called a system interpreter would need a skip where the interpreter is missing, and a skip passes silently. A text check for `: ` cannot do the job either: it cannot tell a plain scalar from a quoted or block one, and it misses every other way a file can fail to parse. So the guard adds one devDependency to `server/`: `yaml@^2.9.1` (ISC, no dependencies of its own, published 2026-09-11, YAML 1.2). The lockfile change is the single `node_modules/yaml` entry plus the `devDependencies` line.

**B. The fix (D-5566).** The notes step's `run:` is now a `|` block scalar. The command line is byte-for-byte the old one, including the `|| { echo "::warning::…"; : > "$RUNNER_TEMP/release-notes.txt"; }` arm. Parsed, the value is the old line plus the trailing newline that `|` adds, so a failing writer still costs the release only its body. `build-release.test.ts` located the step by the one-line form (`^        run: node deploy/release-notes.mjs …`). That pin now locates `^        run: \|\n          node deploy/release-notes.mjs …` and carries a comment explaining why. The pin on the fallback arm (`release-notes\.mjs [^\n]*\|\| \{ echo "::warning::…"; : > …; \}$`) and every other text pin on `release.yml` (`build-release`, `release-main`, `oss-metadata`, `verify-provenance`, `single-definition`) hold unchanged.

**C. The sweep.** Every workflow and composite action was parsed, and every plain scalar value was checked for trailing text after it on its line. `ci.yml`, `release-main.yml`, `release-stable.yml` and `.github/actions/server-deps/action.yml` parse with 0 errors. The only trailing text belongs to flow sequences (`[main]`, `[full, rebuild]`, …), and no plain value carries a ` #` comment or a `: `. So `release.yml` line 95 was the only instance of the defect, and no other workflow file is edited.

## Mutation rows (measured 2026-10-18)

| Mutation | Result |
|---|---|
| `release.yml` restored to `origin/main` (the #645 one-line form) | red: `release.yml parses, to a mapping` (6 parse errors at lines 95–96) |
| The fixed step's command line indented with a tab | red: `release.yml parses, to a mapping` |
| ` #x` inserted into the one-line `run: gh release create …` | red: `release.yml: no one-line run: is cut short by a # comment` |
| Restored | green, 15/15 |

Four in-file cases keep the guard's teeth checked on every run: the #645 form reds, a tab-indented line reds, the block form is green, and a plain `run:` cut short by `#` is seen while the block form is not.

## Deviations found

- **D-5565.** `server/test/workflow-yaml-parses.test.ts` parses every workflow and composite action, read from the tree, with the `yaml` package, a new server devDependency. It also refuses a one-line plain `run:` cut short by a ` #` comment. Why: text pins cannot see a parse failure, no system YAML parser is guaranteed on both CI images, and a skip where one is missing would pass silently. The `#` check goes beyond the brief's "every file parses": it guards the silent case the brief's own sweep names.
- **D-5566.** The release-notes step's `run:` becomes a `|` block, and `build-release.test.ts`'s step-locating pin moves to the block form. Why: in the one-line form, the `: ` in `release.yml: could not` made the file unparseable. The command and its fallback arm are unchanged.

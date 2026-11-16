# install.sh's tag binding speaks the updater's words, and its name rows can see a write

- **D-8385 (2026-11-12)** — `install.sh --release vX.Y.Z` refuses a SHA256SUMS that names another version's tarball in `_upd_resolve`'s sentence word for word (`… — refusing; nothing on this box was changed`), pinned by `install-sh.test.ts` against ccd/ccrc's line; the tarball-name rows' "path traversal" name is `../ccrc-evil.tar.gz`, which a let-through name would write into TMPDIR itself, and every name row again asserts that no tarball was written outside the host's files, an assertion a mutation shows can fail.

## Why

Issue #2083's "Installer and release host" section carried four installer items past the centralised-update
programme's close: the tag binding, where the five `CCRC_RELEASE_*` knobs are validated, the wording of the two
release-fetch refusals, and two weak rows in `server/test/install-sh.test.ts`.

## What changed

- `install.sh`: the tag-binding refusal ends `— refusing; nothing on this box was changed`, as the updater's does.
  Nothing on the box has changed at that point: only the staging directory exists, and the EXIT trap removes it.
- `install-sh.test.ts`: the binding row reads the updater's sentence out of ccd/ccrc (`updaterBindRefusal`, the same
  shape as `updaterFetchRefusal`) and compares install.sh's stderr with it exactly.
- `install-sh.test.ts`, the tarball-name rows: the fixture host now serves each listed name, so a name let through
  would be fetched rather than 404'd. Each row asserts that no `.tar.gz` lies under the fixture home outside
  `releases/`, and checks that before the curl log, so the write check is the one that reds. The traversal row's name
  is `../ccrc-evil.tar.gz`.

## Proof by mutation (each reverted)

- With the name refusal's `exit 1` removed, the traversal row reds on the write check (`tmp/ccrc-evil.tar.gz`). With
  the same mutation and the old name `ccrc-x/../../evil.tar.gz`, the write check stays green and only the curl log
  reds: `ccrc-x` never exists in staging, so that name could not be written anywhere.
- The binding row was red before the `install.sh` change (the missing tail) and green after it.
- With the tarball fetch refusal reworded, the tarball "download failed" row reds. With the five knob calls moved to
  file scope, the `--help` and checkout rows red.

## Deviations found

- Items (2) and (3), and the first halves of (1) and (4), were already on `main` (#2308, D-8017). That PR moved the
  knob validation into the release arm, with its `--help` and checkout rows, and pinned both fetch refusals against
  ccd/ccrc (`updaterFetchRefusal`). It also bound the tag, deleted the assertion that could not fail, and renamed the
  traversal row. It left three gaps: the binding sentence lacked the updater's tail and was pinned only by a literal,
  the deleted assertion had nothing in its place, and the new traversal name passed through a directory staging never
  holds. This change closes those three gaps. install.sh and the updater still share no text mechanism: install.sh
  is the bootstrap and sources nothing, so its lines stay copies held equal by the tests.

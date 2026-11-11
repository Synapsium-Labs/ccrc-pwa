# An empty project is born ready for a workspace

The console's **Add project → Empty** (`ccd project-add --empty`) made a project that could never take a workspace. It
was a bare `git init` with no commit and no origin, and `ccd ws-add` bases every workspace on `origin/HEAD`, so it
refused with `no origin/HEAD`. This change makes `--empty` produce a project that `ws-add` accepts with no extra step.

## Deviations found

- **D-8193 (2026-11-10)** — an empty project is born with a local bare origin, an empty commit on `main` and `origin/HEAD`

## What changes

- **ccd, `cmd_project_add --empty`.** It now makes, or adopts, a local bare origin at `<origins>/<name>.git`, seeds it
  with one commit on `main` (the empty tree, no hook, no signing), and clones the project from it. The commit goes
  through ccd's one commit writer, `_ws_reclaim_commit_tree`, with its fixed identity; the pinned caller list in
  `ccd-child-reclaim-pin.test.ts` grows by this one caller. The clone sets `origin`, `origin/HEAD` and `main`'s upstream as a GitHub clone does, so the project
  takes a workspace at once.
- **Where the origins go.** By default this is `$REG/origins`, under ccd's own data directory. The first line of
  `~/.ccrc/project-origins` can name another absolute path. The operator owns that file and nothing writes it. If the
  file exists but does not name an absolute path, ccd refuses and touches nothing; it never falls back to the default.
- **Idempotent, never someone else's.** Ccd adopts an origin only when it is a real bare repository whose local
  config has `ccd.emptyorigin = <name>`. Re-running after the checkout is gone clones the same history again, and an
  origin with no `main` is seeded. Ccd refuses any other file, directory, link or repository at that path before it
  touches anything. The project name rule ("project exists") is unchanged.
- **The console's toast** for an Empty project says it takes sessions and workspaces now, and pull requests once it
  has a GitHub remote. A workspace's branch pushes to the local origin, and `gh` cannot open a pull request against
  that origin.

## Against the add-project spec

The add-project spec (`docs/superpowers/specs/2026-11-04-add-project-from-ui-design.md`) listed this under §7
Rejected ("a fake remote that PRs and the landing train cannot use") and left it as stage 3. D-8193 builds stage 3's
first half anyway. A project with a workspace and no pull request is better than one that can never take a workspace,
and adding a GitHub remote later still works as it did. The clone of an empty GitHub repository (no `origin/HEAD`)
stays as the spec records it.

## Verification

- `server/test/ccd-project-add.test.ts`: `project-add --empty` then `ws-add` succeeds. The tests also cover the
  origin's shape, the `project-origins` file and its refusals, adopting and seeding an origin of ccd's, and refusing
  five kinds of target that are not ccd's.
- `ccd/contexts.tsv` has rows for the four new helpers. `server/test/growth-waivers/D-8193-ccd-ccd.json` records why
  `ccd/ccd` grows past the limit.

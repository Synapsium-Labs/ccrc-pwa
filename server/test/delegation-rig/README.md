# The delegation capture rig

What Claude Code emits for `Agent`, `Workflow` and a raw `git worktree add` — hook payloads, admin records,
subagent metadata — measured per installed binary, so the delegation broker (spec
`docs/superpowers/specs/2026-10-04-delegation-broker-design.md` §8.1-§8.2) builds only on measured fields.

- `mockapi.mjs` — a scripted mock of the Anthropic Messages API (header comment documents the script grammar).
- `rig.sh` — runs one binary against the mock in a PRIVATE tmux server (`tmux -L dlg… -f /dev/null`) and a FIXTURE
  HOME under a `ccrc-dlg-rig.*` root, with ccrc's own hook registered by ccrc's own installer in a session named
  `cc-rig-hookcap`. It never names the real HOME (except to find the binary) or the default tmux server, and
  grants tools through `permissions.allow` — never a permission bypass.
- `scenarios/*.json` — one per measured situation; `covers` names the spec §8.1 questions.
- `sanitize.mjs` — raw run bundles → `server/test/fixtures/delegation/<version>/<scenario>.json`, fail-closed on any
  residue of a real path, user or host.
- `build-matrix.mjs` — the fixtures → `server/test/fixtures/delegation/matrix.json` (derived; never hand-edited).

Re-capture (on a box with the binaries; takes hours, runs in the foreground):

    RAW=$(mktemp -d "${TMPDIR:-/tmp}/ccrc-dlg-raw.XXXXXX")
    bash server/test/delegation-rig/rig.sh all "$RAW" 2>&1 | tee "$RAW/all.log"
    node server/test/delegation-rig/sanitize.mjs "$RAW" server/test/fixtures/delegation
    node server/test/delegation-rig/build-matrix.mjs server/test/fixtures/delegation server/test/delegation-rig/scenarios --write

Run roots live in `${TMPDIR:-/tmp}`, except that a TMPDIR under `$HOME` (a fleet session's is) — by its spelling or
its physical path — falls back to `/tmp`: the root guard refuses anything under `$HOME`, so `rig.sh run-base` names
the directory `run` and `reap` use.

The captures are SYNTHETIC — a mock API, a fixture HOME, a fixture repo — which is why their payloads may be
committed after `sanitize.mjs`. A capture from a REAL fleet lane never leaves the box; only
`deploy/hook-capture-reduce.mjs` output from one is committed.

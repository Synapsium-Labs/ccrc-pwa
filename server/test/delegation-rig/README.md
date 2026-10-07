# The delegation capture rig

What Claude Code emits for `Agent`, `Workflow` and a raw `git worktree add` — hook payloads, admin records,
subagent metadata — measured per installed binary, so the delegation broker (spec
`docs/superpowers/specs/2026-10-04-delegation-broker-design.md` §8.1-§8.2) builds only on measured fields.

- `mockapi.mjs` — a scripted mock of the Anthropic Messages API (header comment documents the script grammar).
- `rig.sh` — runs one binary against the mock in a PRIVATE tmux server (`tmux -L dlg… -f /dev/null`) and a FIXTURE
  HOME under a `ccrc-dlg-rig.*` root, with ccrc's own hook registered by ccrc's own installer in a session named
  `cc-rig-hookcap`. It never names the real HOME (except to find the binary) or the default tmux server, and
  grants tools through `permissions.allow` — never a permission bypass.
- `scenarios/*.json` — one per measured situation; `covers` names the spec §8.1 questions. An `answerDialog` step
  presses Enter, which takes the dialog's default option, once its text is on the pane, and notes
  `dialog answered: <text>`; a dialog whose text does not appear within the step's timeout is a failure note,
  `answerDialog: no dialog: <text>` (nothing is pressed), and the cell builds `unmeasured`. `interrupt-exit` uses it
  after `/exit`: at Claude Code's "Background work is running" dialog the default is "Exit and stop tasks", as read
  from the pane on 2.1.280 and 2.1.289 only (the note names the dialog, never the option). What is measured after
  it: the session ends (SessionEnd `prompt_input_exit`), the agent emits no SubagentStop, and its tree is left,
  locked.
- `recapture.sh` — the corpus's one re-capture script: the steps below, in order (spec §8.2).
- `sanitize.mjs` — raw run bundles → `server/test/fixtures/delegation/<version>/<scenario>.json`, fail-closed on any
  residue of a real path, user or host.
- `build-matrix.mjs` — the fixtures → `server/test/fixtures/delegation/matrix.json` (derived; never hand-edited).

Re-capture (on a box with the binaries; takes hours, runs in the foreground) is one script:

    bash server/test/delegation-rig/recapture.sh --missing      # every installed version the corpus has no directory for
    bash server/test/delegation-rig/recapture.sh                # every installed version: a full re-capture
    bash server/test/delegation-rig/recapture.sh 2.1.292 ...    # exactly these (each must be installed)
    bash server/test/delegation-rig/recapture.sh --dry-run --missing    # print the versions and the steps; make and run nothing

`--missing` is the every-wave case: a version "is in the corpus" when `server/test/fixtures/delegation/<version>/` exists
(`--missing` with named versions is a usage error; a named version that is already in the corpus is captured again). The
versions are resolved ONCE, when the script starts — "installed" is `rig.sh versions`, which `rig.sh all` shares — so a
version installed during the capture waits for the next one; a version that is not `x.y.z` or not installed refuses the
whole run, exit 2, before anything is made. The script then runs, in order, what this section used to be written out as
(`<versions>` is the list it resolved, `$RAW` the raw root it made; `--dry-run` prints exactly this list):

    RAW=$(mktemp -d "${TMPDIR:-/tmp}/ccrc-dlg-raw.XXXXXX")      # with <versions>, one per line, and the UTC start time in $RAW/versions-at-start
    bash server/test/delegation-rig/rig.sh all "$RAW" <versions> 2>&1 | tee "$RAW/all.log"     # and $RAW/.done must exist after it
    node server/test/delegation-rig/sanitize.mjs "$RAW" server/test/fixtures/delegation
    node server/test/delegation-rig/build-matrix.mjs server/test/fixtures/delegation server/test/delegation-rig/scenarios --write
    node server/test/delegation-rig/sanitize.mjs --scan server/test/fixtures/delegation        # the committed corpus's own residue check

A step that fails stops the script with its exit status (the sanitiser fails closed on any residue) and names the raw
root, which it keeps; it never deletes the raw root, on success or on failure. Every path is resolved from the script's
own location, so the working directory does not matter.

Run roots live in `${TMPDIR:-/tmp}`, except that a TMPDIR under `$HOME` (a fleet session's is) — by its spelling or
its physical path — falls back to `/tmp`: the root guard refuses anything under `$HOME`, so `rig.sh run-base` names
the directory `run` and `reap` use.

**The raw capture root** (`$RAW` above): `recapture.sh` makes `ccrc-dlg-raw.*` in `${TMPDIR:-/tmp}` with `mktemp -d`, so its
mode is 0700, and ends by printing its path. (Run by hand, the four commands take any directory outside the source tree:
`rig.sh all` refuses one inside it.) It holds the UNSANITISED bundles: never commit it, never share it, never copy it off
the box. A box's `/tmp` reaper may remove `/tmp/ccrc-dlg-raw.*` after some hours (the fleet box removes unprotected
top-level `/tmp` entries older than 12 h), so a raw root that must outlive that, to re-sanitise the corpus from it after a
sanitiser change, belongs in another directory outside the tree (`TMPDIR=<that directory>` for the script). Otherwise, once its sanitised
corpus is committed and nothing more needs it, remove it:

    rm -rf "$RAW"      # e.g. rm -rf /tmp/ccrc-dlg-raw.<suffix>

A leftover check after a capture looks in both places run roots can be made — `rig.sh run-base` as well as
`${TMPDIR:-/tmp}` — and for raw roots and the rig's private sockets too. With no rig test running (the rig's tests
make and remove `ccrc-dlg-raw.*` fixtures in `${TMPDIR:-/tmp}`), each `ls` prints nothing, except a raw root you
chose to keep:

    bash server/test/delegation-rig/rig.sh reap
    ls -d "$(bash server/test/delegation-rig/rig.sh run-base)"/ccrc-dlg-rig.* "${TMPDIR:-/tmp}"/ccrc-dlg-rig.* 2>/dev/null
    ls -d /tmp/ccrc-dlg-raw.* "${TMPDIR:-/tmp}"/ccrc-dlg-raw.* 2>/dev/null
    ls "${TMUX_TMPDIR:-/tmp}/tmux-$(id -u)/" | grep '^dlg'

The captures are SYNTHETIC — a mock API, a fixture HOME, a fixture repo — which is why their payloads may be
committed after `sanitize.mjs`. A capture from a REAL fleet lane never leaves the box; only
`deploy/hook-capture-reduce.mjs` output from one is committed.

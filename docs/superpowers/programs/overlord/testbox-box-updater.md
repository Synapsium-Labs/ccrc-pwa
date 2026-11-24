# The test box's updater (managed node, PR 2)

A task note for PR 2 of `docs/superpowers/specs/2026-11-22-test-box-managed-node-design.md` (its §9 row "The box
updater, as new files"). The numbers it cites are the plan's
(`docs/superpowers/plans/2026-11-22-test-box-managed-node.md`); it defines none.

## What this pull request does

Nothing calls the new code: no unit, no admin sub and no route starts the updater. Connect, Repair, Apply release
and the tool sync run as they did.

| Piece | Where | Decision |
|---|---|---|
| Characterization of the installer and the tool sync as a library | `server/test/testbox-installer-characterization.test.ts` | D-8903 |
| The installer's steps as functions, moved whole | `deploy/testbox/box-steps` | D-8903 |
| The installer as a caller of those steps | `deploy/testbox/install.sh` | D-8903 |
| The updater: the spine on the box | `deploy/testbox/bin/box-update` | D-8903, D-8913 |
| The gate's `testbox` and `testbox-legacy` arms | `ccd/ccrc#_upd_gate_probe`, `box-update#_tb_gate_probe` | D-8903, D-8917 |
| The act id in the report | `ccd/ccrc#_upd_phase` | D-8905 |
| The drain's two files, the updater's half | `box-update#_tbu_drain` | D-8907 |
| The token placed before the gate | `box-update#_tbu_token` | D-8919 |
| Caps of the box's own | `box-update`, `TBU_CAPS` | D-8901 |

## Order of the work

1. **Characterization first.** `fixtures/testbox-installer-golden.json` was recorded from the installer as it stood on
   `main`: every system call in order and every file left, for a first install, a second run, `--reapply --force`, a
   changed box file, `--unpair` and one refusal. `CCRC_TESTBOX_GOLDEN=write` rewrites it; a move never does.
2. **The move.** The installer's value rules, its `MANIFEST` check, its release placement, its dependency install,
   its phase 5, its firewall load, its service start and the token path rule became the functions of
   `deploy/testbox/box-steps`, byte for byte. The installer calls them in its own order. The record did not change,
   in either round of the move. Five existing tests read the moved code as text and now read it where it is: the
   egress rows in `testbox-box-package.test.ts`, the `k` mutation in `testbox-config-file.test.ts`, the mirror's
   config by file in `testbox-admin-connect-retry.test.ts`, the run root's two directories in the agent's
   `testbox-service.test.ts`, and the one named `MANIFEST` line in the agent's `testbox-tools.test.ts`. The last
   three were red after the first round of the move and no run had shown it: the agent suite and the connect retry
   suite were not run then. The count of that census is still one line: the check is one step both callers use.
3. **The updater**, which calls the same steps with a `put` that writes a file only when its bytes differ.

A suggested commit split, since each behaviour is to be a commit of its own: the characterization and its record;
the move (`box-steps`, `install.sh`, the two repointed tests); the lane's two additions in `ccd/ccrc`; the updater
with its test, driver and census row; this note.

## One departure from the spec's text, stated

The spec's §9 says of PR 2 "the installer and the tool sync are not touched", and Table 15 says the installer becomes
a wrapper in the PR that switches Connect to the act. This pull request's brief asks for the installer as a wrapper
over the same steps now, so that a first install and an update cannot drift. The two were reconciled this way:

- **The tool sync is not touched.** The updater sources it for its functions, as the installer already does.
- **The installer is touched by a move only.** No call, argument, file or sentence of it changed, which the record
  holds. It runs no new code: the updater's spine, node files, gate and restore are reached by nothing.
- **The alternative** was a second copy of the installer's code inside the updater until PR 4. That is the duplicate
  the repository's rules refuse, and a fix to one copy (the release row's asset hosts, in review as its own pull
  request) would not have reached the other.

If the reviewer prefers the spec's order, reverting `install.sh` and keeping `box-steps` as the updater's own gives
it, at the cost of that copy.

What the two callers share, and what stays each caller's own:

| Job | Shared step (`box-steps`) | What differs, and why |
|---|---|---|
| The value rules | `tbs_box_paths`, `tbs_addresses`, `tbs_egress_names`, `tbs_rows`, `tbs_push_key`, `tbs_users_ok`, `tbs_run_root_fs` | Nothing |
| The tree's `MANIFEST` | `tbs_manifest` | Nothing |
| A release tree placed | `tbs_tree_copy`, `tbs_tree_place`, `tbs_tree_owned` | The order. The installer places the tree and then installs its dependencies in place; a re-run runs them again. The updater installs them before the tree takes its release name, so a failed `npm ci` leaves no tree a later act would take as whole |
| The dependencies | `tbs_tree_deps` | The registry. The installer asks the upstream (no firewall is loaded yet). The updater asks the service's proxy and nothing else (O4) |
| The render | `tbs_users`, `tbs_run_root_dirs`, `tbs_push_key_install`, `tbs_rows_install`, `tbs_units`, `tbs_rule_firewall` | `put`. The updater's writes a file only when its bytes differ |
| The firewall's load, the service's start | `tbs_firewall_load`, `tbs_service_start` | When. The installer always reloads the system manager and the firewall. The updater does each only for a changed file, after its report says `firewall` |
| The service token's path | `tbs_token_path` | Nothing |
| A tool set | none | Legitimately different until PR 4. The installer makes the one-link bootstrap set, the tool sync a set of all six versions, and the updater a copy of the current set with node and npm re-pointed, because it moves no other tool yet. PR 4's one comparison and one measurer fold the three |
| The first node | none | The installer's phase 3 only. The updater refuses a box with no installed release |

## What the updater does not do yet, and why

| Left | Why | Needs |
|---|---|---|
| A box with no installed release | The first install stays the installer's. npm for a first install has no proxy to ride | O4, PR 4 |
| The upstream registry when the proxy is down | It is the one widening of the allowlist. The updater defers and says so, with the firewall loaded or not: it never asks the upstream itself | O4 |
| A second verification by the box's own verifier | Under either answer the box checks the `MANIFEST`, and the tarball's digest when the spec names one (a named digest with no tarball is refused). A spec that names none is not compared | O2 |
| Chrome, python3, git and tmux | The one comparison and the one measurer are PR 4's; download-then-install changes the tool sync's functions. The tool sync still moves them | PR 4 |
| Running Chrome to measure it | Its download has no checksum (D-7422), and today root unpacks it and only a run user runs it. The updater reads its version from the directory the tool set's link names. If the spec's "runs each tool, as root" is meant for Chrome too, that belongs in the threat table before PR 4 | PR 4 |
| The service's half of the drain, and the ready file's writer | The service's two files | PR 3 |
| The tools unit, its polkit entry and the `tools-sync` step at the service's start | Removing them changes the units the installer renders, so it is a behaviour change | PR 4 |
| The marker file `<etc>/installed` | The installer's `--reapply` still reads it; the node files replace it at retirement | PR 8 |
| The number of kept releases and the drain's bound as settings | A setting needs its row in the settings table, the examples and the box settings view. They are a constant (3) and a spec line (at most 900 s) | The PR that adds the rows |
| A move down with no operator tap | The updater takes the kind it is given; who may send `rollback` is the planner's rule | O7 |
| Each download's own 4-minute bound | The downloads are the tool sync's functions, which this pull request does not touch. The stage's 12 minutes hold them | PR 4 |
| A report at least every two minutes inside one `npm ci` | The report is written before each part of the stage. The stage's bound, 12 minutes, is inside the server's 15 with no report | PR 4, if it is wanted |

## What PR 3 must match

The updater reads two files the service will write, and one marker in the release tree. Their names and shapes are
this note's until PR 3 fixes them:

- **The marker.** `deploy/testbox/service-ready`, a file in the release tree, shipped with the writer. A tree that
  carries it is gated by the `testbox` arm, which requires the ready file. A tree without it, this pull request's
  own release among them, is gated by the legacy arm: the unit is up and stays up, and node and npm answer. The
  marker is a second predicate, apart from "has a render entry" (`deploy/testbox/box-steps` in the tree).
- **The ready file.** `/run/ccrc-testbox/ready`: `release<TAB><tag>` and `pid<TAB><main pid>`, at most 4096 bytes.
- **The drain.** The request, `/run/ccrc-testbox-drain/request`: `act<TAB><id>` and `deadline<TAB><unix seconds>`.
  The answer, `/run/ccrc-testbox/drain`: `act<TAB><id>`, `state<TAB>idle` and `queued<TAB><n>`, at most 4096 bytes.

## Readings of the spec that the plan may want to fix

- **The report's phases.** The spec names a phase `firewall` and an end `deferred`. The report is the update lane's
  own (`_upd_phase`), whose phases are a closed list every reader checks. So the updater writes `installing` with
  the detail `firewall`, and a deferral as `failed` with a detail that begins `deferred: ` (one constant,
  `TBU_DEFERRED`) and exit 3. PR 4's reader declares that prefix on its side, or the report carries the kind as an
  additive key. The driver's verdict (PR 4) is what the row reads.
- **The gate's arm.** The spec places it in `_upd_gate_probe`. That function now hands the two roles to
  `_tb_gate_probe`, which the updater declares, because the arm reads a system unit and files under the box's own
  root, which `ccd/ccrc` does not name. With no such function the roles are refused as any unknown role is.
- **What a restore flips back to.** The spec says "the previous release and set". The updater records, before it
  flips anything, the release and the tool set the act replaces, with the `previous` it found, in a node file of
  its own (`replaced`). Arm 1 re-links that pair and puts `previous` back. So a tools-only act (the same release,
  another node or npm) is restored to its old set, and an act that fails before it flipped is never moved down a
  release. When that pair is the one whose gate just failed, the release that was `previous` is tried next.
- **`verify` among the caps.** The `installed` file is the other nodes' format: one line for a verified tree, the
  sha and `unsigned` otherwise. Its one reader takes a one-line file as verified only beside a `verify` cap. The
  updater always carries that word, because it writes one line only when the driver said `verified 1`. The sweep
  drops the three core words and keeps this one.
- **A busy lock.** The spec lists a busy lock under `deferred`. The lane's `_upd_lock` dies with exit 1, which this
  file's table reads as `failed`. The updater takes the lock with the lane's other acquirer, `_ver_lock_try`, which
  answers in words, and defers (exit 3) with no report written, because the holder's report is the live one.

## The four retry defects of 2026-11-20 (#3130), and the asset hosts

| Defect | Pinned by |
|---|---|
| The reflink probe's directory is the service user's | The characterization: the run root is root's, `out` is the service user's |
| The token is rewritten over an existing one | The updater's token case: a temp file and a rename, before the service starts |
| A mirror's config is written by file | The characterization and the updater, each run over a mirror a stranger `git` refuses to open |
| No egress probe on a box that holds the release | "The spine run twice": no registry request, no download, no `npm` |
| The release row's asset hosts | The egress names are one function, `tbs_egress_names`; the updater's render is held byte-equal to the installer's |

The asset hosts' own pull request edits lines that this one moved from `install.sh` into `box-steps`. Whichever
lands second re-applies those nine lines inside `tbs_egress_names`; the box package suite's literal list and the
byte-equal case then hold both callers to it.

## The review round

Twenty-two findings from two reviews. Three were one finding seen twice. All were checked against the code and none
was wrong. Four were taken in part, and the part left is in the table of what the updater does not do yet or in the
readings above: `verify` is carried always, not only for a verified act; the report is written before each part of
the stage, not every two minutes inside one; each download's own bound is the tool sync's; and the `deferred: `
prefix is one constant here, with its reader's side left to PR 4. The installer's own copy of the release tag's
pattern is from before this pull request and is left. What changed:

| Finding | Change | Case that holds it |
|---|---|---|
| A stop that failed sent the box down a release | `replaced` is written first; a failed stop with the service up is a deferral | "a stop that fails with the service still up" |
| A tools-only act had no restore | Arm 1 re-links the replaced pair, release and set; the replaced set is kept | "a tools-only act whose gate fails" |
| Settling wrote no node files, and the next prune took the previous tree | Settling writes them; an act that changes nothing rewrites stale ones; the prune never takes the installed, previous or replaced tree | "an act that settles and is then refused", "node files that are not the installed tree's", "the prune never removes" |
| A release with the updater and no ready-file writer failed restore and settling | The arm is chosen by the marker, not by the updater's presence | "a release whose service writes no ready file" (two cases) |
| `installed` was in a format its reader does not know | The other nodes' format, and the `verify` cap | "its node files read through the one reader" |
| "Could not measure" read as "no unit active" in the drain | The system manager's own status; unmeasured waits and defers | "a system manager that does not answer the measurement" |
| A busy lock was exit 1; a grandchild kept the lock after a bound | Exit 3; a bound ends the step's whole process tree | "a second updater while one holds", "a stage whose npm hangs" |
| The managed gate arm took one sample | The second main-pid read in both arms | "a service that binds, writes its ready file and is gone" |
| Three bounds missing | Settling is bounded; the gate's node and npm run under `timeout 10`; the report is written before each part of the stage | "settling has a bound too", "the gate runs node under a bound" |
| Values declared twice | The tool sync's patterns and tool names; `tbs_token_path` | The characterization (`--unpair`) |
| The token's temp file had a fixed name in the service user's directory | A random name made exclusively and one rename, the pair phase's way | "the token: a link planted" |
| Only the tree's ownership was checked | The stage directory, the spec, the tarball and the token are root's alone; the spec is in the stage; the token is one of 64 hex characters | "a stage that is not root's alone", "a staged token that is not" |
| The upstream registry on a box with no firewall loaded | Deferred whenever the proxy does not answer | "a proxy that does not answer" |
| Guards with no red test | A case each | The cases above, and "read as data" (two), "a drain bound beyond 900", "a bound the spec names only makes", "a link where a rendered file belongs", "a kept release tree", "what npm leaves writable", "the lock's directory", "an updater ended in mid-drain", "a switch that runs past its bound", "a restore that runs past its bound" |
| Root ran Chrome | Its version is read from the set's link | "Chrome is never run by the updater" |
| The installer was not a thin wrapper | Placement, dependencies, the firewall's load and the service's start are shared steps; the table above says what stays different | The characterization, unchanged |
| A named digest passed with no tarball | Refused | "a digest the spec names is compared" |
| `UPD_ACT_ID` came from the environment, unredacted | Initialised in the lane's globals; redacted | "the report's act key" |
| A refusal after settling said "nothing was written" | The stage's refusals run before the lock; one after settling says settling came first | "an act that settles and is then refused" |

## Proof

All on fixtures, through the installer's `TB_SYS` seam, with no box and no root
(`server/test/testbox-box-update.test.ts`, `server/test/fixtures/testbox-update-sys-driver.sh`): the spine run twice;
a failed gate flipped back; a dead updater settled by the next act; a legacy layout adopted, and put back by its own
installer when its first move fails; each refusal before any write; the drain's bound, its act id and the updater's
own measurement; each step ended at its bound; a run with no `HOME`; kept releases and the floor; node and npm at
measured versions; and the cases of the review round above.

Each guard of the review round was measured by removing it, in a copy of the tree, and reading that the case that
names it went red: 46 mutations, 46 red, each by the case meant. Two cases did not go red at first (the lock's
descriptor in the drain's wait, and the end of a step's whole process tree) and were made to: the first now asks
the lock at once after the updater is gone, the second times the run.

## Not verified

- No real box, system manager, firewall or root ran any of this. The fixture's service writes the ready file and the
  drain answer that PR 3's service will write.
- That a unit file under `/run/systemd/system` joins the firewall's tools set (the spec's §10). The updater refuses,
  with nothing changed, when its own cgroup is not in the set.
- On a box, systemd ends every process of the unit when the updater exits. The fixtures have no such thing, so the
  bound's own end of the process tree is what the cases measure.
- A stop that fails and leaves the service down goes to arm 1 on the installed pair. No case makes a stop fail that
  way.
- The updater's suite takes about five minutes on a laptop: it installs a fixture box for most cases.
- Linux has not run either new suite. The record was written on macOS, with platform-dependent files left out.
- The agent's `testbox-tools.test.ts` loses one case to its 5-second limit on a laptop, a different case each run,
  and passes whole with a longer limit. The tool sync it tests is not changed here.

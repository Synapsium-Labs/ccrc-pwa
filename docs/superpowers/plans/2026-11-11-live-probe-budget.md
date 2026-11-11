# Live probes run on the test box only, one at a time, within a daily budget

- **D-8290 (2026-11-11)** — live probe budget: a live Claude Code test (a probe) is a test box job kind, `probe.submit`, that the test service takes only on the configured test box (the role read from the box's install config, never a hostname); probes run one at a time through a single-slot queue; each runs pinned to the scratch account's own config directory and its own tmux socket, behind a guard that refuses any write into a fleet account's config directory; and a per-day count from the box's settings is the budget. The queue and the count ride the status answer and show on the console's Test box card.

## Why

The operator ruled (2026-11-10) that live Claude Code tests run only on the rebuilt test box, never on the fleet,
under a scratch Claude account with its own config folder and tmux socket, one test at a time through a queue, and
that the harness programme owns the budget. Nothing in the tree ran one yet, and nothing stopped a harness test from
spending a fleet account or typing into the fleet's tmux server.

## What the test box already had (read first)

- The test service (`agent/src/testbox/`, D-7406) on the test box: its settings come only from the box's
  root-owned install config, `/etc/ccrc-testbox/ccrc.env`, through `_testbox_knobs box` (`ccd/testbox-knobs`), and
  every value arrives as a `KEY<US>default<US>value<US>from` line (D-7451). A node without that file (every fleet
  node) reads every box key `from: default`.
- Runs reach it as `run.submit` frames from the fleet host's wrapper (`ccd/ccrc-test`, `agent/src/testbox/client.ts`)
  and queue in `queue.ts` (first come first served, a pristine build one at a time). Run units have no network
  (`PrivateNetwork=yes`), so a probe, which must reach the model provider, cannot be a run.
- The console's Test box card (`pwa/src/fleet/TestBoxSection.tsx`, `TestBoxManage.tsx`) shows the status answer and
  edits the box keys from `shared/testbox-admin.ts`'s tables (D-8166).
- The D-8270 tmux socket lookup is not merged, so the probe socket is a dedicated `-L` name from config.
- No probe code existed: the `probe` hits in `ccd/`, `agent/` and `deploy/` are the reflink probe, the version probes
  and `ccd-land-probe`, none of them a live Claude Code run.

## Change

1. **The entry point** is a test box job kind: the `probe.submit` frame (`shared/testbox.ts`, with its one reader),
   answered by `probe.state` frames (`refused`, `queued`, `running`, `ended`). The service's `ProbeDesk`
   (`agent/src/testbox/probes.ts`) refuses with a typed `ProbeRefusal` and its sentence:
   - `not-test-box` when the node's install config is not a test box's: no box key was read `from: file`, which is
     every fleet node (`probeRole`). No hostname is read anywhere.
   - `probes-off` when the box names no `CCRC_TESTBOX_PROBE_CONFIG_DIR`.
   - `no-runner` when no probe runner is installed (this PR installs none, below).
   - `config-dir-unsafe`, `config-dir-fleet`, `socket-fleet` from the guard (3).
   - `budget-spent` (4), and `probe-id-used` for an id already queued, running or ended.
2. **One at a time.** `queue.ts` gains the `probe` kind: a probe may start only when no other probe is running. The
   desk keeps its own single-slot queue, so two probes requested at once run one after the other; the waiting
   probes' positions go out on `probe.state`, and the queue (the running probe and the waiting ones, by name) is in
   the status answer's `probes` block.
3. **The pinned environment.** A probe's environment is built from empty: `CLAUDE_CONFIG_DIR` the scratch account's
   config directory (`CCRC_TESTBOX_PROBE_CONFIG_DIR`), `HOME` a probe-owned home under `<CCRC_TESTBOX_ROOT>/probes/`,
   `TMUX_TMPDIR` a probe-owned directory beside it and `CCRC_PROBE_TMUX_SOCKET` the dedicated `-L` name
   (`CCRC_TESTBOX_PROBE_SOCKET`), with no `TMUX` or `TMUX_PANE`, so the probe cannot reach a fleet tmux server. The
   guard (`configDirRefusal`, `writeRefusal`) refuses a config directory that is not a plain absolute path, one that
   resolves (symlinks followed) to, into or around a fleet account's config directory (Claude Code's default
   `.claude` and every roster account's `$HOME/<configDirSuffix>` the box's homes name), any `.claude` path segment,
   and the socket name `default`, which is the fleet's own tmux server. Every file the desk writes goes through
   `writeRefusal` too.
4. **The budget.** `CCRC_TESTBOX_PROBES_PER_DAY` probes per UTC day, counted when a probe is accepted into the queue
   (a waiting probe holds its unit) and kept in `<CCRC_TESTBOX_ROOT>/probes/budget.json`, so a restart does not reset
   it. A probe past the count is refused `budget-spent`. The count (used, per day, the day) is in the `probes` block.
5. **The settings** are three new box keys in the one knob table, so the card edits them like every other box key (a
   new group, "Live probes"): `CCRC_TESTBOX_PROBE_CONFIG_DIR` (a path, unset by default: no probes),
   `CCRC_TESTBOX_PROBE_SOCKET` (a new shape class `socket`, default `ccrc-probe`) and `CCRC_TESTBOX_PROBES_PER_DAY`
   (a count, default 10). The harness programme sets the budget there.
6. **Visible.** The status answer carries an optional `probes` block, sent only when the box names a probe config
   directory (so a box on this release never sends a fleet agent of an older one a field its reader refuses). The
   card shows one line under its cells: the count and the queue, or why probes are off.

## Left for later, on purpose

- **The probe runner.** This PR installs no runner, so on a box every probe is refused `no-runner` and no live
  Claude Code runs anywhere. The runner is the harness programme's next task: a unit of its own (network on, as the
  scratch account's user, the spec `probeSpec` builds), with its own review.
- **The fleet-side sender.** Nothing on the fleet host sends `probe.submit` yet; the harness programme's verb sends it
  over the same authenticated connection the wrapper's runs use.
- **A cancel** of a waiting probe. A waiting probe holds its budget unit until it runs, and one the guard refuses
  when it starts stays counted.
- **The tool sync's takeover** waits for idle runs; with no runner a probe never runs, so the takeover does not wait
  for the desk yet. The runner's task adds the desk to the service's idle check.

## Deviations found

- `queue.ts`'s header named two kinds; it names three, and the `probe` arm is the pristine arm's rule (one at a time).
- The box key counts in the knob tests, the admin contract and the box settings table move from 28 to 31, the shape
  classes from 15 to 16, and `CCRC_SETTINGS` from 98 to 101.

## Tests

`agent/test/testbox-probes.test.ts`: the refusal on a fleet node (every key `from: default`) and with probes off;
two probes requested at once run one after the other, with the second's position and the status block's queue; the
config directory guard (a fleet account's directory, a path inside one, a symlink into one, a `.claude` segment, the
`default` socket, a desk write into a fleet directory); and the budget's exhaustion, its persistence across a new
desk and its roll at the UTC day. Every run is a fake runner: nothing launches Claude Code or tmux.
`server/test/testbox-contract.test.ts` reads the two probe frames and the status answer's block (with it and
without it). `server/test/testbox-knobs.test.ts`, `testbox-admin-contract.test.ts`, `box-settings-table.test.ts`,
`testbox-config-file.test.ts` and `testbox-pins.test.ts` carry the three keys; `pwa/src/fleet/TestBoxSection.test.tsx`
the probe line, and `pwa/browser/testbox-card.browser.test.ts` holds it inside the card at 390, 1280 and 1920 px. The
connect and manage flows (jsdom and browser) count the fifth settings family.

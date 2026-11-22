# The test box as the third managed node: plan

The plan for `docs/superpowers/specs/2026-11-22-test-box-managed-node-design.md`. It records the deviation numbers
the spec names and the order of the work. The task breakdown of each pull request is written when that pull request
is dispatched.

## Delivery

The nine pull requests are the rows of the spec's section 9 ("Delivery and proof"). PR 1, the deadlines and the
lock, needs none of the operator's decisions and is built first.

## Deviations found

Issued by the allocator on 2026-11-22 as one block of 22. The last number of the block is spare and is not defined here.

- **D-8899 (2026-11-22)** — admin-deadlines. Deadlines: One table, enforced by systemd, summed.
- **D-8900 (2026-11-22)** — box-after-fleet. Order: The fleet, then the server and the box apart.
- **D-8901 (2026-11-22)** — box-caps-own-words. Caps: Words of the box's own; the sweep drops core words.
- **D-8902 (2026-11-22)** — box-follows-fleet. Where its target comes from: The fleet node's settled release; no
  intent.
- **D-8903 (2026-11-22)** — box-updater-own-spine. What runs on the box: Its own updater sharing the lane's report,
  lock and gate.
- **D-8904 (2026-11-22)** — carrier-reads-node-files. The measurement path: Root reads the node files; mirrored on the
  fleet host.
- **D-8905 (2026-11-22)** — carrier-report. A second report file: The driver's verdict, matched by act id.
- **D-8906 (2026-11-22)** — deferred-class. Retry: Deferred, bounded retries; nothing waits for a tap.
- **D-8907 (2026-11-22)** — drain-by-file. The drain's channel: Two files; the request is a lease.
- **D-8908 (2026-11-22)** — fleet-update-starts-act. The first caller: The fleet host's own update and rollback.
- **D-8909 (2026-11-22)** — follower-lane. Halt and lease: A follower lane; core never reads it.
- **D-8910 (2026-11-22)** — health-not-convergence. Health and convergence: Apart; one repair per tag and cause.
- **D-8911 (2026-11-22)** — no-box-rollback-door. No manual rollback of the box: It rolls back when the fleet does.
- **D-8912 (2026-11-22)** — no-new-field-on-exact-frames. New wire content: Never on a frame an exact reader reads.
- **D-8913 (2026-11-22)** — no-old-code-in-path. Whose updater runs: The target release's, never the installed one.
- **D-8914 (2026-11-22)** — one-tool-comparison. Which tool difference matters: The one a run falls back on; one
  function.
- **D-8915 (2026-11-22)** — one-tool-measurer. Who measures the tools: One measurer on the fleet host, for every
  caller.
- **D-8916 (2026-11-22)** — operator-acts-first. The operator's acts and the lock: They stop an automatic act.
- **D-8917 (2026-11-22)** — testbox-node-role. What the box is: A third node, role `testbox`, in the one inventory.
- **D-8918 (2026-11-22)** — testbox-ready. The one fact: `testboxReady`, in `server/src/testbox.ts`.
- **D-8919 (2026-11-22)** — token-before-gate. The token and the gate: Placed inside the act, before the gate.

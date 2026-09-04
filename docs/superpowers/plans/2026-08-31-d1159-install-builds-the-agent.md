# D-1159 — a fleet-role install took the fleet's agent down

> **Not a multi-task plan.** This is the ledger record for a single fix, written in plan
> shape because that is where this repo's deviation ledger lives
> (`server/test/deviation-refs.test.ts` derives the high-water from
> `## Deviations found` definition lines under `docs/superpowers/plans/`).

**Goal:** Make the documented install path produce every artifact the install itself
requires, and make any path that does not fail BEFORE it touches a live box.

---

## What happened, measured

`bash install.sh` builds three artifacts — `server/dist`, `server/dist-pwa`, and the
`node_modules` implied by them — then hands off to `ccrc install`. It does not build the
agent. `ccrc install` preflights the first two by name, each with its own remedy
sentence, and refuses without them. It did **not** preflight the agent.

But `_inst_enable` starts `ccrc-agent.service` for every role but `server`, and that
unit's `ExecStart` is `$HOME/ccrc/agent/dist/agent/src/index.js`. So on the reference
fleet, `ccrc install --role fleet` from a source checkout:

1. passed both preflights,
2. placed the tree at `$HOME/ccrc` — with no `agent/dist` in it,
3. restarted a **live fleet's** agent onto that tree,
4. and the agent died with `MODULE_NOT_FOUND`.

The server lost its only path to the fleet box until the agent was built by hand. The
verb reported the failure honestly (`ccrc-agent.service was restarted and did not stay
up`) — but by then it had already half-run, which is the outcome this file's own doctrine
exists to prevent: *"an install that half-ran because argument 2 was a typo is worse than
one that did not start."*

## Deviations found

- **D-1159** (2026-08-31) — `install.sh` did not build `agent/`, and `ccrc install` did
  not refuse without it, so a fleet-role install from source restarted a live fleet's
  agent onto a tree with no entry point. Both halves fixed, because they fail in
  different directions: `install.sh` now builds the agent unconditionally (it cannot know
  the role — `--role` rides on the staged verb, and a source install passes none, so the
  verb's own default `both` applies, which needs an agent), and `_inst_tree` gains a
  THIRD preflight, role-gated on `[ "$INST_ROLE" = server ]`, in the same shape and with
  its own third sentence like the two above it. `install.sh`, `ccd/ccrc` (`_inst_tree`),
  `server/test/ccrc-install.test.ts` (the refusal, its role gate, the fixture stub and
  the pinned build order), `server/test/ccrc-install-graphify.test.ts` (fixture stub),
  `server/test/install-sh.test.ts` (the cross-file guard below).

## The guard that keeps the two lists in step

The two files encode one invariant — *every artifact the verb refuses without is an
artifact the bootstrap builds* — and nothing held them together. They fell out of step
silently, and the cost was a live fleet's agent.

`install-sh.test.ts` now derives BOTH sides and compares them: the preflighted packages
are scanned out of `ccd/ccrc`'s own `[ -f "$src/<pkg>/dist…" ]` lines, the built packages
out of `install.sh`'s own `( cd "$ROOT/<pkg>" … npm run build )` lines, and every
preflighted package must appear in the built set. Each scan carries an anti-vacuity
assertion, so an expression that stops matching reddens instead of passing on an empty
set. Its one stated limit: `server/dist-pwa` is preflighted under `server/` but built in
`pwa/`, so the path cannot name its builder — `pwa` is asserted directly for that reason.

Measured, three mutations, each red:

| mutation | result |
| --- | --- |
| delete the preflight from `ccd/ccrc` | the refusal test reds (`expected +0 to be 1`) |
| drop its `INST_ROLE = server` gate | the server-role test reds — it must not refuse there |
| remove the agent build from `install.sh` | the cross-file guard reds on the build scan |

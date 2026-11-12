# The macOS fleet job runs the agent, and doctor reports the Sigstore trusted root's age

- **D-8388 (2026-11-12)** — Two trust-path items carried past the centralised-update programme's close (#2083): the
  macOS launchd job of a fleet box carries the agent's entry point and env file under the agent's label (R41), and
  `ccrc doctor` gains `sigstore-root`, which WARNs `stale` when the newest validity start in the vendored
  `deploy/sigstore-trusted-root.jsonl` is older than 270 days and `unreadable` when the file cannot be read.

## Why

- **R41.** `_inst_units_darwin` picks the job's label from the role (`app.ccrc.ccrc-agent` on a fleet box), but
  `_inst_plist_server` wrote the server's launch line whatever the role. A macOS fleet box therefore got a job named for
  the agent that sourced `ccrc.env` and `exposure.env` and ran `server/dist/server/src/index.js`. It was measured from a
  fixture only, since no fleet launchd job has been installed or run.
- **The trusted root.** `ccrc update` verifies every release against the Sigstore trusted root vendored in the
  installed tree (D-3119). Sigstore and GitHub rotate their keys, and a root taken before a rotation refuses every
  bundle signed with the new key. `--allow-unsigned` does not apply to a bundle that fails. README said that nothing on
  the box reported the root's age.

## What changed

- `ccd/ccrc`: `_inst_plist_server <label> <log> [<role>]`. For `fleet` the launch line is
  `set -a; . '~/.ccrc/agent.env' || exit 1; set +a; exec /usr/bin/env node '~/ccrc/agent/dist/agent/src/index.js'`,
  where `~` is the job's home. That is `deploy/ccrc-agent.service` translated: its one `EnvironmentFile` has no `-`, so
  it is required, and the job exits rather than start the agent unconfigured. Every other role's line is unchanged.
  `_inst_units_darwin` passes `$INST_ROLE`. The settings census's one allowed sourcing of the box env file is still the
  single `local cmd="…"` line, expanded once as the job's `-c` argument.
- `ccd/ccrc-doctor-checks`: `sigstore-root`, on the table line after `provenance`. It reads every key's
  `validFor.start` with jq, keeps the newest, and compares it with the clock against `DR_SIGSTORE_ROOT_MAX_DAYS=270`.
  The answers:
  - no `deploy/verify-provenance.mjs` in the tree: SKIP, since nothing reads a root;
  - jq or date unusable: SKIP, unmeasured;
  - the root missing, not a readable regular file, not JSON lines, or holding no start it can read: WARN `unreadable`;
  - the root older than the limit: WARN `stale`;
  - otherwise PASS, naming the date and the age.

  Both WARNs have the same remedy: refresh the file from the Sigstore TUF root
  (`gh attestation trusted-root > deploy/sigstore-trusted-root.jsonl`) in a release PR, or point
  `CCRC_SIGSTORE_TRUSTED_ROOT` at a fresh copy for one update. The check never FAILs, for `provenance`'s reason. Paths
  are printed from `~`.
- Tests:
  - `darwin-role-plist.test.ts` runs on every leg. It drives `_inst_units_darwin` for `both`, `server` and `fleet`, and
    reads each job's label, entry point and env files against the shipped Linux unit. It also runs the fleet line
    without `agent.env`. The fleet cases were red before the fix.
  - `ccrc-doctor-sigstore-root.test.ts` covers fresh, the limit's two sides, stale, a fractional-second start, six
    unreadable shapes, no verifier, and the vendored root parsing. Its fixture roots are dated from the moment the case
    runs.
  - `healthy()` plants the verifier and a fresh fixture root, so a healthy box PASSes. The install fixture tree ships no
    verifier, so `FLEET_BOX_CLASSES` reads `sigstore-root` SKIP.
- README's "Two trust roots" paragraph names the check and the refresh.

## Deviations found

- **The limit is 270 days, not the 180 the task suggested.** Since GitHub's own authorities joined the vendored file
  (2023), the newest start of any key in it has moved every 38 to 232 days: from 2025-05-27 to 2025-11-13, for
  example, and from 2025-11-13 to 2026-06-12, 211 days. At 180 days a root refreshed straight after a rotation could
  warn with no remedy that clears it. A test holds the limit above the longest gap of the file's last three years.
- **No refresh script exists.** The by-hand path is D-3119's `gh attestation trusted-root`, and the remedy names it.
- **No case reads the vendored root against the clock.** Doing so would turn every suite red on the day the file
  passes the limit, for a reason no PR could fix. The vendored file is only checked to parse.
- **R41's fleet line no longer reads `ccrc.env` or `exposure.env`.** `ccrc-agent.service` reads neither, so the
  translation follows it.

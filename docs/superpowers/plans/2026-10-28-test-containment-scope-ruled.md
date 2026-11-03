# Test containment: its scope, ruled

- **D-7298 (2026-10-28)** — test containment: ccrctests.slice, the ccrc test wrapper, the fleet-wide heavy-run queue and the routing; good-faith scope ruling (cgroup caps are the backstop)

**D-7298.** Test containment is `ccrctests.slice` (`deploy/systemd/ccrctests.slice`), the `ccrc test` wrapper (`ccd/ccrc-test`), the fleet-wide queue for heavy runs, and the routing that sends tests to the wrapper (the session hook's test-route arm and the worker and coordinator skills). On 2026-10-28 the coordinator ruled its scope: **good faith**.

**The ruling:**
- The sessions are cooperative, not adversaries. Containment is a good-faith guard.
- The real backstop is the cgroup caps already on the fleet box: the session slice's `CPUQuota` and its memory caps.
- The hook's classifier is not hardened any further against deliberately obfuscated spellings. These are accepted and out of scope: a systemd-run inside a command substitution, `prlimit`, `unshare` or `cgexec` prefixes, `find -exec`, Python's `os.system`, and an npm script that wraps the suite.
- Accidental bypasses that a well-behaved session could hit are fixed.

**The accidental bypasses fixed under this ruling:**
1. `--light` is honoured only when the classifier already reads the command as light. Otherwise it is ignored, with a one-line note.
2. `CCRC_TEST_INSIDE` is never trusted from the environment. "Already inside" is read from `/proc/self/cgroup` being under `ccrctests.slice`. Where the run is uncontained, it is read from a held slot's holder being an ancestor of the process.
3. `CCRC_TEST_WIDE_FILES` is read in file mode from `~/.ccrc/ccrc.env`, like the other box-wide keys.
4. The inner command of `ccrc test -- systemd-run …` goes through the same wrapped check, so the hook denies it.

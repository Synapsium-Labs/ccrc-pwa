# Accounts connect: the OA1 box run, as recorded on 2026-11-01

**What this is:** the record of the operator acts OA1a and OA1b from `2026-10-18-accounts-connect.md` (§"OA1a and OA1b: the box runs before W1e and before W2b"). The plan says what each item measures and which task reads it. This file says what was measured, what was not, and what each unmeasured item still gates. The run was made on the fleet box (Linux), on one scratch lane (`<scratch-lane>` below), at ccrc `8cc70b84c` (main, built 2026-11-01T03:59Z) with Claude Code 2.1.312. The operator approved each sign-in. The lane was signed in with an existing account, because no spare account was available, and that is why the logout items below were skipped. No secret, code value or lane name is recorded here.

## Measured

### OA1a: whether the first check creates `.claude.json` (spec §6.2 step 9; recorded under D-5518)

| When | `~/<suffix>/.claude.json` |
|---|---|
| after `ccrc account add --method login` | absent |
| after the sign-in (`ccd-account-auth <scratch-lane> login`, the code relayed through the run FIFO) | **present**, about 60 KB, written by `claude auth login` itself, before any check. An earlier, aborted sign-in attempt had also left a 423-byte file. |
| after the first `ccrc account check` | present; it grew from 60579 to 61166 bytes |

- The first check ran its probe ("the lane answered one turn"). The verdict was `ok`, and the lane state recorded `check: {verdict: ok, at: 2026-11-01T20:40:43Z}`.
- `hasCompletedOnboarding` was **absent** after the sign-in and still **absent** after the probe.

**Ruling for A13 (settled):** for the sign-in method, `.claude.json` exists before the first check, so the seed may follow the probe. The probe never sets `hasCompletedOnboarding`, so the seed writes it itself. No headless first run is needed before the check.

**Not measured:** the paste and setup-token methods, where no `auth login` runs. Those lanes may reach their first check with no `.claude.json`, so A13's seed creates the file when it is absent (D-7731).

### OA1b: the sign-in hosts and the code shapes (spec §3.8; recorded under N2)

| Method | Origin | Path | Query parameters | Code shape |
|---|---|---|---|---|
| `login` | `https://claude.com` | `/cai/oauth/authorize` | `code`, `client_id`, `response_type`, `redirect_uri`, `scope`, `code_challenge`, `code_challenge_method`, `state` | 92 characters: 48 alphanumerics, `#`, then 43 base64url characters (`-` and `_` seen in one of the two samples). Both samples match the spec's regex. |
| `setup-token` | `https://claude.com` | `/cai/oauth/authorize` | the same as `login`, with `client_id` repeated; `scope=user:inference` | **pending**: the operator has not yet approved the setup-token code step |
| Codex device login | not measured | | | not measured: the device-code request was refused with HTTP 530 by the provider on 2026-11-01, and nothing was saved |

## Not run, and why

| Item | Status | Why |
|---|---|---|
| **G23** (OA1a): does `claude auth logout` end the sign-in at Anthropic? | not run | The operator skipped the logout tests. The scratch lane was signed in with a real account, and no spare account was available to log out. |
| **§9** (OA1b): what a live session does after its lane's sign-in is logged out | not run | Skipped for the same reason. |
| **§3.3** (OA1b): does Claude Code strip `CLAUDE_CODE_OAUTH_TOKEN` and `ANTHROPIC_AUTH_TOKEN` from a Bash-tool subprocess? | not measurable on a fleet lane | Generated lanes source `.cc-secrets/<lane>-oauth.env`, which defines `CLAUDE_CODE_OAUTH_TOKEN`, so the parent has the variable. A `-p` probe that runs a Bash command testing whether the names are set returned an empty answer (exit 0) on a fleet lane, while a plain probe answered. The account deny guard (A9) most likely refused the command. The item needs an interactive measurement, or one on a non-fleet machine. |
| setup-token code shape | pending | It waits on the operator's approval of that step. |
| Codex device login host and `userCode` shape | not measured | The provider refused the device-code request (HTTP 530). |
| Cleanup of the scratch lane | pending | |

## What each un-run item still gates

- **G23 gates A16 and A19.** Until G23 runs, A16's `atProvider` ledger row for a sign-in lane, and A19's "Still valid at the provider" line, say the result is **unmeasured**. They must not say "ended at Anthropic", and they must not say "still valid".
- **§9 gates A23.** Until §9 runs, A23's **Sign the old sign-in out** step stays the danger confirm the spec gives when no measurement shows a live session unharmed (spec §9, the sign-in → token row): "N sessions on lane-b still use the sign-in and may fail their next turn".
- **§3.3 gates §3.1's cost line and A10's Step 4.** Both keep the spec's unmeasured wording until an interactive or non-fleet measurement runs.
- **The setup-token code shape and the Codex host and `userCode` shape gate A21's N2 allowlist** for those methods. The `login` row above is measured and can be read now.

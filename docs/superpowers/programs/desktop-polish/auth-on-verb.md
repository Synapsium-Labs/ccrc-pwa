# Wave 181: `ccrc auth on|off` (desktop polish run 3869, D-9105)

The note for wave 181, written by its worker for the coordinator to fold into the ledger. Each claim says whether it was
**measured** (in a test run by this wave, in a browser, or read on the tree) or **inferred**. The design was mailed to the
coordinator before any code and approved with seven additions; this note records what was built against it.

## 1. What the verb does

`ccrc auth on` arms the console's sign-in on a box used only at localhost; `ccrc auth off` disarms it. Both live in
`ccd/ccrc` (`cmd_auth`), and nothing is written before the last refusal:

1. `_ccrc_operator_only`: refuses inside a Claude Code session (`CLAUDECODE` set), without a terminal, and in a fleet
   session's pane (`TMUX_PANE`'s tmux session `cc-*`, read with `tmux display-message`, bounded at 2 s). One function, so
   the next operator-only verb calls it rather than a copy.
2. A server box: no `CCRC_ROLE=fleet`, and `ccrc.service` installed.
3. `~/.ccrc/update.lock` (`_ver_lock_try`), held for the write, the restart and the proof, so an update's health gate
   never measures this unit mid-change; held elsewhere, the verb refuses.
4. Provably loopback-only, through `_box_reach`: the reach list moved out of doctor's `update-exposure` check unchanged
   (its own commit, characterized by the doctor exposure and auth test files, green with no test change).
5. Every key as `ccrc.service` receives it (`_box_unit_env`); an undecidable reading refuses.
6. `on` only: no foreign `CCRC_RP_ID`, `CCRC_ORIGIN` or `CCRC_COOKIE_INSECURE` (named by key, never by value), and a
   usable passphrase (`deploy/gen-auth-hash.mjs --check`, doctor's own question, which prints no byte of the secret).
7. The write: temp file and rename in `~/.ccrc`, the mode kept, every other line byte for byte (a `#` line is a comment
   whatever it names), the pre-edit copy kept 0600 beside the file until the proof passes.
8. `_svc_restart ccrc.service`, then the proof within the update health window (`CCRC_UPDATE_HEALTH_S`, default 90 s):
   the unit active AND `GET /api/auth/status` answering the new mode. On a failed proof the original bytes go back, the
   unit is restarted again and proved back in its old mode, and the verb exits 1.

`on` writes the four lines of `deploy/ccrc.env.example`'s localhost set under one marker comment:
`CCRC_AUTH=on`, `CCRC_RP_ID=localhost`, `CCRC_ORIGIN=http://localhost:<port>`, `CCRC_COOKIE_INSECURE=on`. `off` removes
the marker, the `CCRC_AUTH` line and each other line holding exactly that value; a value it did not write stays, named.
Already in the asked state, either says so and writes and restarts nothing.

## 2. D-9105: the cookie line, measured

The brief named three keys. The fourth is the coordinator's ruling A, from this measurement. A fixture server built
from this tree was armed (rpId `localhost`, origin `http://localhost:<port>`, listening on 127.0.0.1), and real browsers
signed in to it (measured, 2026-11-25):

| browser | cookie Secure | page at | login | then authed? | gated GET | a write |
|---|---|---|---|---|---|---|
| Chromium 153 headless | on (the shipped default) | localhost | 204 | yes | 200 | 204 |
| Chromium 153 headless | off (`CCRC_COOKIE_INSECURE=on`) | localhost | 204 | yes | 200 | 204 |
| WebKit (WPE, Safari 27.2 user agent) | on (the shipped default) | localhost | 204 | **no** | **401** | **401 no-session** |
| WebKit | off (`CCRC_COOKIE_INSECURE=on`) | localhost | 204 | yes | 200 | 204 |
| both | either | 127.0.0.1 | 204 | yes | 200 | **403 foreign-origin** |

WebKit drops the default `Secure` session cookie on plain-http localhost: the login answers 204 and the login screen
comes straight back, which is the shape the server's own boot warning (`cookiePolicyProblem`) describes. Nothing in the
gate, the cookie or the origin check changed; the remedy is the existing key, which the example file's localhost set
already lists. Dropping `Secure` there loses nothing: a cookie is not port-scoped either way, Chromium already sends a
`Secure` cookie over `http://localhost`, and loopback traffic stays on the machine. The verb writes the key only beside
the loopback origin it writes, and `off` removes it.

**Unmeasured:** Firefox. It cannot run on this box (no GTK). Read, not measured: Firefox has treated `http://localhost`
as a secure context since version 75, as Chromium does, so it is expected to keep the cookie either way.

## 3. The guards are speed bumps

`_ccrc_operator_only` stops a session that arms or disarms the gate by accident, never one that sets out to:
`env -u CLAUDECODE`, a terminal made with `script`, an unset `TMUX_PANE`, a script file or another interpreter each run
past it. There is no classifier row (ruling D): a top-level session raises no prompt for one to rule, and a child is
stopped by the session and terminal refusals already; a row would take three layers and change the child deny file's
digest for every child.

## 4. Residuals, stated

- A box behind a TLS-terminating proxy of the operator's own that has not yet set `CCRC_ORIGIN` looks loopback-only to
  the verb. Armed for localhost, it signs in through the proxy and cannot act (the fail-closed direction). The closing
  lines and the README say: `ccrc auth off`, then the hand route.
- That running sessions survive the restart is read, not measured live: sessions run in their own `claude-session@`
  units, and ccd creates the tmux server in its own `ccrc-tmux-server.scope` (`ccd/ccd`), so neither is in
  `ccrc.service`'s cgroup; on a two-box fleet they are on the other box.
- On macOS without `flock` the lock cannot be taken and the verb refuses, as `ccrc coordination-snapshot` does.
- The fleet-pane guard asks tmux through D-8270's socket lookup (`"${_TMX_ARGV[@]}"`), so with a socket setting the pane
  id is asked of the fleet's server. A pane id of the operator's own tmux that collides with a fleet session's pane
  there refuses wrongly. That is the safe direction, and running the verb outside tmux clears it.

## 5. Doctor, install and expose

- `auth`: on a loopback-only server box (`_auth_fits_here`), the dark remedy reads "to arm the gate: ccrc passwd, then
  ccrc auth on", and the passphrase-set dark PASS ends "to arm it: ccrc auth on". Elsewhere unchanged.
- install's gate line names `ccrc auth on` on such a box.
- `expose`'s shadow refusal names `ccrc auth off` when the keys it found are the ones `ccrc auth on` writes.
- install's arming words say the verb "writes the sign-in lines", not "the localhost lines": a remote-mode box's
  transcript names no localhost (`ccrc-install-tree`'s kept-env case).
- Four remedies offered a bare `ccrc expose`, which exits 2 (missing subcommand); wave 180's review named two, and two
  more of the same shape were in doctor's update-exposure check. Install, on a box reached from elsewhere: "ccrc expose
  duckdns, or ccrc expose byo", as expose's own status line words it. doctor's auth check (no passphrase, an exposure
  file it cannot read) and update-exposure's unreadable-file remedy: re-run the arm this box was exposed with, "ccrc
  expose duckdns, ccrc expose byo or ccrc expose ip". update-exposure's reachable-box FAIL: those three, each of which
  writes `CCRC_AUTH=on` and `CCRC_ORIGIN` (and `CCRC_RP_ID` for a name). Each string has a case, measured red first.

## 6. Mutants

Each mutant edited `ccd/ccrc` in place, ran `server/test/ccrc-auth.test.ts` through `ccrc test`, and was restored from
HEAD. The red cases are named per mutant.

| mutant | what it breaks | tests red | red cases |
|---|---|---|---|
| M1-claudecode | the CLAUDECODE refusal never fires | 1 failed | 22 passed (23) | refuses inside a Claude Code session (CLAUDECODE set) |
| M2-tty | the terminal refusal never fires | 1 failed | 22 passed (23) | refuses without a terminal — a pipe is a session tool or a script |
| M3-pane | the cc-* pane refusal never matches | 1 failed | 22 passed (23) | refuses inside a fleet session's pane (tmux session cc-*), and only there |
| M4-fleet-role | the fleet-role refusal never fires | 1 failed | 22 passed (23) | refuses on the fleet role, and on a box with no ccrc.service installed |
| M5-no-unit | the no-ccrc.service refusal never fires | 1 failed | 22 passed (23) | refuses on the fleet role, and on a box with no ccrc.service installed |
| M6-update-lock | a held update lock does not refuse | 1 failed | 22 passed (23) | refuses while an update or rollback holds ~/.ccrc/update.lock |
| M7a-reach-exposure | `_box_reach` ignores the exposure file | 1 failed | 22 passed (23) | refuses a box reached from elsewhere: an exposure file, naming ccrc expose — on and off alike |
| M7b-reach-caddyfile | `_box_reach` ignores the Caddyfile | 1 failed | 22 passed (23) | refuses a box reached from elsewhere: a Caddyfile, naming ccrc expose — on and off alike |
| M7c-reach-ddns | `_box_reach` ignores the ddns unit | 1 failed | 22 passed (23) | refuses a box reached from elsewhere: the ddns timer unit, naming ccrc expose — on and off alike |
| M7d-reach-host | `_box_reach` takes any CCRC_HOST as loopback | 1 failed | 22 passed (23) | refuses a non-loopback CCRC_HOST bind, and an undecidable one |
| M7e-host-undecided | an undecidable CCRC_HOST does not refuse | 1 failed | 22 passed (23) | refuses a non-loopback CCRC_HOST bind, and an undecidable one |
| M7f-off-reach | `off` runs on a box reached from elsewhere | 3 failed | 20 passed (23) | refuses a box reached from elsewhere: an exposure file, naming ccrc expose — on and off alike; refuses a box reached from elsewhere: a Caddyfile, naming ccrc expose — on and off alike; refuses a box reached from elsewhere: the ddns timer unit, naming ccrc expose — on and off alike |
| M8-foreign | a foreign origin or rp id does not refuse | 1 failed | 22 passed (23) | refuses a foreign CCRC_ORIGIN and a foreign CCRC_RP_ID, naming the key and never the value |
| M9a-no-passphrase | no passphrase does not refuse | 1 failed | 22 passed (23) | refuses with no passphrase, and says to run ccrc passwd first |
| M9b-unusable-passphrase | an unusable passphrase does not refuse | 1 failed | 22 passed (23) | refuses a passphrase file the server could not use |
| M10a-comment-is-setting | a comment naming CCRC_AUTH is read as a setting | 2 failed | 21 passed (23) | appends the four lines, keeps every other byte and the file mode, restarts once and proves sign-in on; removes exactly what on wrote — the file is back to its bytes — and proves sign-in off |
| M10b-reserialize | every other line is re-serialized (its CR dropped) | 1 failed | 22 passed (23) | appends the four lines, keeps every other byte and the file mode, restarts once and proves sign-in on |
| M11-mode | the file mode is not kept | 1 failed | 22 passed (23) | appends the four lines, keeps every other byte and the file mode, restarts once and proves sign-in on |
| M12-idempotence | already-on writes and restarts anyway | 1 failed | 22 passed (23) | is idempotent: a second run says so, writes nothing and restarts nothing |
| M13-restore | a failed proof deletes the copy instead of restoring it | 3 failed | 20 passed (23) | puts the file back when the restarted console does not prove sign-in on (down), restarts again, exits 1; puts the file back when the restarted console does not prove sign-in on (off), restarts again, exits 1; puts the file back when the console does not come back off |
| M14-old-mode-is-proof | any answer of the status route counts as proof | 2 failed | 21 passed (23) | puts the file back when the restarted console does not prove sign-in on (off), restarts again, exits 1; puts the file back when the console does not come back off |
| M15-off-flag-only | `off` removes only the flag | 2 failed | 21 passed (23) | removes exactly what on wrote — the file is back to its bytes — and proves sign-in off; leaves a value it did not write, and names it |
| M16-verb-table | `auth` is missing from the verb table | 23 failed (23) | all 23 |
| M17-cookie-value | the cookie line carries another value | 3 failed | 20 passed (23) | appends the four lines, keeps every other byte and the file mode, restarts once and proves sign-in on; replaces a bare KEY= line and CCRC_AUTH=off rather than adding a second line; the four lines mean, to the SERVER, what the verb says they mean |
| M18-origin-value | the origin is written as 127.0.0.1 | 3 failed | 20 passed (23) | appends the four lines, keeps every other byte and the file mode, restarts once and proves sign-in on; replaces a bare KEY= line and CCRC_AUTH=off rather than adding a second line; the four lines mean, to the SERVER, what the verb says they mean |

All 25 killed. Each case is green on the unmutated tree (23 of 23).

The second batch ran the doctor auth, install landing and expose test files (181 cases) per mutant:

| mutant | what it breaks | tests red | red cases |
|---|---|---|---|
| M19-fits-never | `_auth_fits_here` always says no | 3 failed | 166 passed | 12 skipped (181) | wave 181: on a loopback-only server box the dark remedy is ccrc auth on, with or without a passphrase; wave 181: on a loopback-only server box the arming remedy is ccrc passwd, then ccrc auth on; G2b (wave 181): the same on a loopback-only server box — the OFF remedy is ccrc auth on, with no restart line |
| M20-fits-always | `_auth_fits_here` always says yes | 3 failed | 166 passed | 12 skipped (181) | names CCRC_RP_ID and CCRC_ORIGIN in the same breath as CCRC_AUTH; says, in one line, that it wrote no passphrase and what arming the gate takes; G2b: a passphrase file at the default path with the flag OFF — "a PWA passphrase file is at", and the OFF remedy names ccrc.env |
| M21-expose-no-auth-sentence | expose's refusal drops the `ccrc auth off` sentence | 1 failed | 168 passed | 12 skipped (181) | wave 181: when the keys are the lines ccrc auth on wrote, the refusal names ccrc auth off first — and only then |
| M22-expose-no-marker-check | expose names `ccrc auth off` without the marker line | 1 failed | 168 passed | 12 skipped (181) | wave 181: when the keys are the lines ccrc auth on wrote, the refusal names ccrc auth off first — and only then |

All 4 killed.

## 7. Docs, and what is left

- README ("The session gate": the Safari sentence beside the hand route, the verb's paragraph; the verb table's row) and
  the root CLAUDE.md's SAFETY bullet were sent as peer packets against main `9220429c2f` to their holder, who said yes
  as written; applied unchanged.
- `deploy/ccrc.env.example`: one paragraph under the localhost worked set.
- Left for the wave's last step, after wave 180's PR (#3402) merges and the coordinator's mail: the accounts design's
  gate-dark places (its holder asked to wait, since #3402 rewrites both; the swap is "the README's hand route" to
  `ccrc auth on`, and "a verb ccrc never had" becomes "did not have until desktop-polish wave 181"), and the console's
  `LOCAL_ARMING` line in `pwa/src/fleet/accountWords.ts`.
- Growth (D-9105): `ccd/ccrc` grows by the verb, and the waiver
  `server/test/growth-waivers/D-9105-ccd-ccrc.json` carries the measured delta. `passwd`, `expose` and `auth` sit
  inline together and `auth` calls the other two's helpers (`_box_auth_path`, `_box_unit_env`, the shadow-key read), so
  the three are one family: a candidate to leave the file together when `ccd/ccrc` is split, never one alone.
- CI round 1 (fast run on `cdc8e600e0`, red): the D-TBD scan, the growth check, the settings census (C8: `cmd_auth`'s
  `AUTH_KEYS` loops, now a `VAR_KEY_BODIES` row beside `cmd_expose`'s), the tmux socket census (the pane read, now
  through the lookup) and `ccrc-install-tree`'s kept-env case (the word above). All were whole-tree guards not run
  before the first push.
- `shellcheck`: `ccd/ccrc` now reports one SC2034 fewer than its pin (14 of 15). The ratchet prints that as lowerable
  and passes; the baseline file is left alone to avoid a conflict-prone edit.

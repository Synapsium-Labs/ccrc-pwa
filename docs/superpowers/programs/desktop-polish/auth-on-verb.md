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
   never measures this unit mid-change; held elsewhere, the verb refuses. Then no `ccrc.env.auth-restore.*` beside the
   file: a copy a killed run left refuses, named, because which of the two to keep is the operator's (fix round 1).
4. Provably loopback-only, through `_box_reach` (the reach list moved out of doctor's `update-exposure` check unchanged,
   its own commit, characterized by the doctor exposure and auth test files, green with no test change), with loopback
   an address since fix round 1 (`_box_loopback_host`: unset, `localhost`, `::1`, 127.0.0.1 to 127.255.255.254, no
   leading zero), and through `_auth_unit_sources`, the unit's other sources of its environment (section 9).
5. Every key as `ccrc.service` receives it (`_box_unit_env`), the passphrase and session-store path keys too
   (`_box_path_for`'s `unit` mode, fix round 1); an undecidable reading refuses.
6. `on`: `CCRC_HOST` unset, `127.0.0.1` or `localhost` (another loopback bind would make the origin it writes and the
   address it prints false), no foreign `CCRC_RP_ID`, `CCRC_ORIGIN` or `CCRC_COOKIE_INSECURE` (named by key, never by
   value), and a usable passphrase (`deploy/gen-auth-hash.mjs --check`, doctor's own question, which prints no byte of
   the secret). `off`: no foreign `CCRC_RP_ID` or `CCRC_ORIGIN` (the coordinator's ruling on R1, section 9).
7. The write: temp file and rename in `~/.ccrc`, the mode kept, every other line byte for byte (a `#` line is a comment
   whatever it names), and a copy of the original beside the file until the proof passes, made 0600 by an explicit
   mode. (Corrected in fix round 1: this step said "kept 0600" while `cp -p` kept the source's mode; review 3934 F3
   measured a 0644 file's copy at 0644.)
8. `_svc_restart ccrc.service`, then the proof within the update health window (`CCRC_UPDATE_HEALTH_S`, default 90 s):
   the restart command succeeding (a failed one is a failed proof, fix round 1), the unit active AND
   `GET /api/auth/status` answering the new mode. On a failed proof the original bytes go back, the unit is restarted
   again and proved back in its old mode, and the verb exits 1. INT, TERM or HUP from the write on put the original
   bytes back (or, with no file before the run, remove the one it wrote), restart the unit once, say what is on disk and
   that this was not proven, and exit 130 (section 11 has the words since wave 190).

`on` writes the four lines of `deploy/ccrc.env.example`'s localhost set under one marker comment:
`CCRC_AUTH=on`, `CCRC_RP_ID=localhost`, `CCRC_ORIGIN=http://localhost:<port>`, `CCRC_COOKIE_INSECURE=on`. `off` removes
the marker, every `CCRC_AUTH` line and each other line holding exactly that value; a cookie line it did not write stays,
named (a foreign origin or rp id refuses, step 6). Already in the asked state, either says so and writes and restarts
nothing.

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

`_ccrc_operator_only` stops a session that arms or disarms the gate by accident, never one that sets out to. Each of
its three refusals has its way past: `env -u CLAUDECODE` runs past the session refusal, a terminal made with `script`
past the terminal refusal, and an unset `TMUX_PANE` past the pane refusal (wave 190 A12: a script file or another
interpreter alone runs past none, because it inherits all three conditions). There is no classifier row (ruling D): a top-level session raises no prompt for one to rule, and a child is
stopped by the session and terminal refusals already; a row would take three layers and change the child deny file's
digest for every child.

## 4. Residuals, stated

Every residual of the build and of fix rounds 1 and 2. "Read" means read on the tree, not run.

- **A proxy on the box is what the proof still cannot see.** A box behind a TLS-terminating proxy of the operator's own
  that has not yet set `CCRC_ORIGIN` looks loopback-only to the verb. Armed for localhost, it signs in through the proxy
  and cannot act (the fail-closed direction). The closing lines and the README say: `ccrc auth off`, then the hand
  route. Once such a box sets `CCRC_ORIGIN` or `CCRC_RP_ID`, `off` refuses it (fix round 1, the R1 ruling).
- **The path keys have two readings (F1).** `ccrc auth` reads `CCRC_AUTH_SECRET_PATH` and `CCRC_SESSIONS_PATH` as the
  unit receives them (`_box_path_for`'s `unit` mode). `ccrc passwd`, doctor's `auth` check and install's gate line keep
  the plain reader of `ccrc.env`: moving them changes what existing cases mean, measured. Doctor's D4, D4b, D5, D6, E6b,
  E15, E16 and E18 and install's G2g each turned red: an unreadable exposure file, or a file systemd splits or skips
  whole, then answers "not measured" for the path as well as for the flag. So `ccrc auth on` refuses a
  `CCRC_AUTH_SECRET_PATH =/x` line that `passwd` and doctor still read as no line at all. For the coordinator to
  ticket.
- **What the proof reads on Linux, and what it still cannot see (F2, fix round 2's R1).** It reads the unit file and
  its two drop-in directories in the user unit directory on disk, what systemd loaded (`DropInPaths`,
  `EnvironmentFiles`, `Environment`, `PassEnvironment`) and the user manager's environment. Since fix round 2 it also
  requires the installed unit to be the tree's `deploy/ccrc.service` byte for byte, the file `_inst_units` and
  deploy.sh copy unchanged, and systemd to answer `NeedDaemonReload=no` for it; since wave 190 the same read must name
  that file as the one systemd loaded (`FragmentPath`), with no separate source (`SourcePath`), section 11. So every
  hand edit of the unit refuses, on and off alike, naming the file and never the difference, with `ccrc install` (which
  puts the shipped file back and reloads systemd; an update leaves a box already on its version alone) or the README's
  hand route as the way on. That covers an assignment in `ExecStart` (`env CCRC_HOST=0.0.0.0
  node`), which this section used to state as a residual, and the shapes the line reading parses differently from
  systemd: a space around `=`, a continued line, an escape in a name. Each is a red case (section 10). A unit systemd has
  not reloaded since it changed refuses with the reload as the way on, and a systemd that does not say refuses as not
  measured. It still does not see:
  - a drop-in written in another directory of the unit search path (`/etc`, `/run`, `~/.local`) since the last
    daemon-reload: systemd has not loaded it, and the verb reads only the user unit directory on disk. Whether systemd
    then answers `NeedDaemonReload=yes` was not measured: no real user manager was asked, a stub stood in;
  - anything that changes what node runs before the server reads its keys (wave 190 A1: one class, stated once). The
    unit starts node through `/usr/bin/env`, so a `PATH` that finds another `node` first picks the program, and a node
    option such as `NODE_OPTIONS` can `--require` a script that runs before the server (measured with node v24.22.1 on
    this box: a script named that way printed before the main one), which could set the bind before the server reads
    it. Either can come from any source the unit takes its environment from: `ccrc.env`, the exposure file, or the
    service manager's own environment. The verb reads only its own keys from those (read; `ccd/ccrc` never reads
    `NODE_OPTIONS`);
  - a same-user process that edits the unit, a drop-in or an environment file after the reading and before the
    restart (read; the same class as the concurrent runs below).
  Doctor and install ask the compare half since wave 190 (A4), which needs no service manager, so they no longer name
  the verb on a box whose unit is not the installer's file. They do not ask the sources or what systemd loaded,
  because that needs the service manager; so on a box with a drop-in, a unit systemd has not reloaded, or a unit loaded
  from another file of the same name, they may name `ccrc auth on`, which then refuses by name (a dead end, no harm,
  review 3934 A5's class).
- **Signals (F3, fix round 2's R4).** SIGKILL cannot be caught: a run killed outright may leave the copy and the new
  file. The next run then refuses, naming the copy. The handler reads the disk, not the state word alone. It puts a copy
  that is still there back. A copy already gone, with no restore that failed, can in this run only have been moved
  back by its own restore, so it takes the old file to be back and says it takes it so (wave 190 A2); with no file
  before the run, it removes the one the run wrote and names no old file. A restore that failed earlier in the
  run is never reported as back: the handler names the kept copy, says the file still holds this run's lines, and
  restarts nothing. Wherever the old file is back, it restarts once. A signal between the copy and the rename puts the
  same bytes back and restarts once, which changes nothing. A signal during the failed-proof restore's re-proof says the
  box is back on its old file, unproven, and restarts once more. A signal after the proof passed says the change stands.
  The state moves to `proved` before the copy is removed, and an end-to-end case holds that order (section 10).
- **Concurrent runs, read and unmeasured.** Neither `ccrc passwd` nor `ccrc expose` takes `~/.ccrc/update.lock`, so
  either can run during an auth run: `passwd` can replace the passphrase file after the check, and `expose` can write
  the exposure file after the reach proof. A same-uid process could plant a symlink or hard link at the temp or copy
  name before the verb writes there (the env file itself is refused when it is a symlink).
- That running sessions survive the restart is read, not measured live: sessions run in their own `claude-session@`
  units, and ccd creates the tmux server in its own `ccrc-tmux-server.scope` (`ccd/ccd`), so neither is in
  `ccrc.service`'s cgroup; on a two-box fleet they are on the other box.
- **Linux only for now (fix round 2's R1(d), ruling B).** On a Mac the verb refuses before reading the box, and gives
  the hand route; doctor and install offer the hand route there; issue #3475. Its end-to-end cases
  skip on darwin, and its function-level cases (the Mac refusal, the helper, the signal handler) run everywhere
  (R3).
- The fleet-pane guard asks tmux through D-8270's socket lookup (`"${_TMX_ARGV[@]}"`), so with a socket setting the pane
  id is asked of the fleet's server. A pane id of the operator's own tmux that collides with a fleet session's pane
  there refuses wrongly. That is the safe direction, and running the verb outside tmux clears it.

## 5. Doctor, install and expose

- `auth`: on a loopback-only server box (`_auth_fits_here`), the dark remedy reads "to arm the gate: ccrc passwd, then
  ccrc auth on", and the passphrase-set dark PASS ends "to arm it: ccrc auth on". Elsewhere unchanged.
- install's gate line names `ccrc auth on` on such a box.
- `expose`'s shadow refusal names `ccrc auth off` when the keys it found are the ones `ccrc auth on` writes, and since
  fix round 1 (A7) only where `off` would act: `CCRC_AUTH` still `on`, and no origin or rp id but the localhost ones.
- `_auth_fits_here`, the one yes for doctor's and install's words, declines since fix round 1 a box whose `CCRC_ORIGIN`
  or `CCRC_RP_ID` holds anything but what `on` writes (A5), and since wave 190 (A4) a Linux box whose installed
  `ccrc.service` is not the tree's file byte for byte, or whose compare cannot be made. So neither offers the verb where
  one of those refuses it; where the verb refuses for what only the service manager says (a drop-in, the reload, the
  file systemd loaded), both may still name it (section 4).
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

All 25 killed. Each case is green on the unmutated tree (23 of 23). After review 3934's R1 ruling, M8 and M15 are re-measured in section 9.1. M8 is now one of two refusals of a foreign address, with `off`'s own being N4a. M15's case "leaves a value it did not write, and names it" became a refusal; the case that keeps a foreign value is now the cookie line's.

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
  as written (mail 36724). The README part is applied unchanged. In review fix round 1 the verb's paragraph was
  rewritten (R1, A4, A6, F2; section 9) and sent again as a packet against main `aac570d3d1` to its holder, the landing
  order 5k worker, who said yes as written (mail 37702) and measured it applying to main and to their branch.
- The CLAUDE.md SAFETY bullet follows in a pull request of its own, one file, straight after this one merges (a small
  wave the coordinator opens on this workspace). Why: the review judge's `rules-mixed` rule holds that a pull request
  changing a rules file, which the root CLAUDE.md is, changes nothing else, so the bullet left this pull request. No
  test here pins it. The approved text, word for word, to go in SAFETY after the `ccrc history` bullet:

  > - **Turning the console's sign-in on or off with `ccrc auth on|off` is the OPERATOR's, never a session's** (desktop
  >   polish wave 181): it rewrites the server box's `ccrc.env` and restarts `ccrc.service`, from the operator's own
  >   terminal. It refuses inside a Claude Code session (`CLAUDECODE` set), without a terminal and inside a `cc-*` pane
  >   (`_ccrc_operator_only`, `ccd/ccrc`): **speed bumps, not walls** (`env -u CLAUDECODE` defeats the first). Never run
  >   it from a session, and never against the live host from a test.
  Quoted as it lands in #3476: review 4023 corrected the parenthesis, which said a script file or another interpreter
  runs past them (wave 190 A12).
  Re-read after fix round 1 against the final `off` (section 9): unchanged. The bullet says the verb rewrites `ccrc.env`
  and restarts `ccrc.service`, and names the session, terminal and pane refusals as speed bumps, which all still holds.
  It says nothing about what `off` refuses, so the R1 ruling leaves no sentence false.
- `deploy/ccrc.env.example`: one paragraph under the localhost worked set.
- The wave's last step, after wave 180's PR (#3402) merged as `277d443e63`, is section 8.
- Growth (D-9105): `ccd/ccrc` grows by the verb, and the waiver
  `server/test/growth-waivers/D-9105-ccd-ccrc.json` carries the measured delta. `passwd`, `expose` and `auth` sit
  inline together and `auth` calls the other two's helpers (`_box_path_for`, `_box_unit_env`, the shadow-key read), so
  the three are one family: a candidate to leave the file together when `ccd/ccrc` is split, never one alone.
- CI round 1 (fast run on `cdc8e600e0`, red): the D-TBD scan, the growth check, the settings census (C8: `cmd_auth`'s
  `AUTH_KEYS` loops, now a `VAR_KEY_BODIES` row beside `cmd_expose`'s), the tmux socket census (the pane read, now
  through the lookup) and `ccrc-install-tree`'s kept-env case (the word above). All were whole-tree guards not run
  before the first push.
- `shellcheck`: `ccd/ccrc` now reports one SC2034 fewer than its pin (14 of 15). The ratchet prints that as lowerable
  and passes; the baseline file is left alone to avoid a conflict-prone edit.

## 8. The last step (after #3402)

Main absorbed once, `44f2b15a3b` (it carries #3402): the one conflict was the plan's deviation section, where D-9106
and D-9105 both followed D-8749; D-9105 now follows D-9106, as main has it, and no line of main's was dropped. The
coordinator's go (mail 37301) folded the second review of #3402 (run 3901) into this step.

**The console's sentence.** `LOCAL_ARMING` (`pwa/src/fleet/accountWords.ts`), one string literal so the command scan
reads it whole: "once a passphrase is set (ccrc passwd sets it), run ccrc auth on there: it turns sign-in on, restarts
the server and prints the address to open". Only the gate-dark reason says it, as its localhost line. It is prose, not
backticked: a disclosure line renders as plain text, beside `ccrc passwd` there, and after F1 below a verb that needs a
subcommand is checked in prose too ("Then run ccrc auth now." is red). What the swap fixes, in one line: on a localhost
box the hand route could end at a sign-in that bounces in Safari (section 2); the README's Safari sentence is the
answer by hand, and the console's sentence now points at the verb, which writes the cookie key itself.

**The insecure-origin reason** (review run 3901 F3, A5, A8). It does not take `LOCAL_ARMING`: that box is armed with a
plain-HTTP origin that is not localhost, where the verb refuses (a foreign `CCRC_ORIGIN`, and usually a reach reason
too). Its lines are now true there: the origin can come from `ccrc.env`, `exposure.env` (read second, so it wins) or the
unit; `CCRC_COOKIE_INSECURE=on`, which such a box usually has, comes out when the origin becomes https (otherwise the
boot warning's real downgrade); the localhost line is the hand route, keeping the cookie key for Safari. The copy line
reads the four keys from both files, each line with its file, an indented line included:
`grep -sHE '^[[:space:]]*CCRC_(ORIGIN|RP_ID|AUTH|COOKIE_INSECURE)=' ~/.ccrc/ccrc.env ~/.ccrc/exposure.env`.
`server/test/door-origin-read.test.ts` reads that literal from the source and runs it in a fixture HOME: the four keys
from both files, canary secret lines (`CCRC_AUTH_SECRET_PATH`, agent, DDNS and auth tokens) never printed, both files'
bytes unchanged, nothing on stderr with one file or none. The comment that had the files' precedence backwards is
corrected, and so is wave 180's note (4.1).

**The guard** (`server/test/single-definition/offered-commands.test.ts`; review run 3901 F1, F2, F4, A4, A10, carry 3).
Its header is the full statement of what it checks; in short:
- after a verb that needs a subcommand, prose without one is excused only inside a sentence `AFTER_VERB_PROSE` lists for
  that verb ("(ccrc expose writes all three)"), so "Run ccrc expose now to fix it." is red (F1); `writes` left
  `PLAIN_WORDS`, which is 40 words now, all of them in use;
- any white space separates the product name and the word: a tab, U+202F, U+2009 and a line wrap in JSX text (F2);
- anything inside a `<code>`, `<kbd>`, `<pre>` or `<samp>`, at any depth, is a command: a string in an expression and a
  nested element's text (F4);
- a command-like word is excused per hit, only where its listed sentence covers that hit, and "ccrc operator" is an
  exact literal of `pwa/src/lib/passkey.ts` with its reason, not a two-word sentence (A4);
- the CLI reader leaves comment lines out (this wave's own install comment says "missing subcommand", which made the
  reader throw on `ccrc install` at the merged head), is asked of every verb of the dispatch, and throws on a refusal it
  cannot read or a `case` that names no subcommand; it reads `ccrc auth`'s `on` and `off` the way it reads expose's
  (carry 3);
- the positive control's dead arm is gone (A10).
Each new case was red on the guard before the change (7 of 12 cases red; the seventh, "each one the console shows", was
the install comment above). At this head the scan sees 164 hits, 38 naming a verb, at 151 sites over 66 words; the
command-like list's 18 entries cover 23 prose hits of its 15 words at 22 sites (wave 180's note said 25; corrected there,
A7).

**The door's description** (item 4). Narrowed, both forms name the visible reason (`acct-door-reason`) as their
`aria-describedby` again, so focusing the door says why before any press; the tap's one announcement is as it was, and
a press after focus repeats it (accepted). The jsdom cases that asserted no description are changed claims. The browser
file's assert (`pwa/browser/connect-sheet.browser.test.ts`) belongs to the spacing wave's claim: sent as a peer packet
(mail 37311), applied only on its holder's yes.

**Small.** The sign-in-start form of the sign-in-off sentence ends "Nothing was started." again, as its siblings do
(A6). The CLAUDE.md SAFETY bullet left this pull request (section 7). Not this wave's: the stylesheet items A1 to A3 and
A9, which go to the spacing wave.

**Mutants of the last step** (each applied alone, the guarding file run, restored from HEAD):

| Mutant | Caught by |
|---|---|
| G0 `auth)` removed from the CLI's dispatch | the guard's "each one the console shows" (the console's `ccrc auth on` is then no verb) and carry 3 |
| D1 no description on either form of the narrowed door | "one door per width, and it narrows in place" and "a tap or Enter on a narrowed door" (jsdom) |
| D2 no description on the desk form only | "a tap or Enter on a narrowed door" (it walks both widths) |
| O1 the old copy line (`ccrc.env` only, three keys, column 0) | all three cases of `door-origin-read.test.ts` |
| O2 the copy line reads `ccrc.env` only | "is a read" and "shows the four keys from both files" |
| O3 the copy line drops the cookie key | "is a read" and "shows the four keys from both files" |
| L1 `LOCAL_ARMING` says to set it up by hand and restart | the jsdom words case "the localhost route names ccrc auth on" |
| L2 the insecure-origin reason takes `LOCAL_ARMING` again | the same words case |
| A6 the sign-in-start form loses "Nothing was started." | the same words case |
| G1 the separator back to a space or U+00A0 | the guard's F2 case |
| G2 a command-like word excused by its sentence anywhere in the text | the guard's A4 case |
| G3 a code tag read at its own text only | the guard's F4 case |
| G4 comment lines read as the verb's body | "each one the console shows" (`ccrc install` then throws) and carry 3 |
| G5 any plain word after a verb that needs a subcommand excused | the guard's F1 case and carry 3 |
| G6 a `case` that names no subcommand accepted | carry 3's empty-case assert (it survived the first run; the assert was added, then it was caught) |

All 15 caught. Each was applied alone, the guarding file run through `ccrc test`, and the file restored from HEAD.


## 9. Review fix round 1 (review 3934)

Review run 3934 read the PR at `3dbc7cbf9d`. Its findings and the coordinator's rulings (mail 37644) start from the
rule the wave started with: the verb acts only on what it can prove and refuses anything undecidable. Each change below
was red first; the red-first runs are named in 9.2.

1. **One reader for the path keys (F1).** `ccrc auth on` read `CCRC_AUTH_SECRET_PATH` with the plain reader. A line the
   unit reader does not decide (`CCRC_AUTH_SECRET_PATH =/elsewhere`, a space before `=`) read as unset, so the verb
   checked the default passphrase file and armed. It now reads both path keys, and `CCRC_SESSIONS_PATH`, as
   `ccrc.service` receives them: `_box_path_for` takes a `unit` mode, which reads through `_box_unit_env` and answers
   rc 4, unmeasured, where that reader answers rc 2 or 3. `passwd`, doctor and install stay on the plain reader
   (section 4: moving them turned nine existing cases red).
2. **The unit's other sources (F2).** `_auth_unit_sources` is the reading the ruling asked for: on Linux, the unit file
   and its drop-in directories on disk, and what systemd loaded plus the user manager's environment; on macOS, the job
   file and launchd's environment (section 4 has the detail and what it still cannot see). It refuses, `on` and `off`
   alike, on any drop-in, any key of `AUTH_SOURCE_KEYS` named in a source, and any environment file beyond the two. It
   names each source by path and never a value, and treats a source it cannot list as undecidable. Doctor's report is
   unchanged. The one thing the proof still cannot see is a proxy on the box.
3. **`off` on a box armed for another address (R1).** The coordinator ruled against the design: a foreign origin is the
   one evidence the box has that it is reached from elsewhere. `off` now refuses when `CCRC_ORIGIN` or `CCRC_RP_ID`
   holds a value it did not write. It names the keys, says the box looks armed by hand for another address, and says
   turning sign-in off there is a hand edit of `ccrc.env`. There is no flag. A foreign cookie line alone does not
   refuse; it stays and is named. The case that pinned the old behaviour is now a refusal case. Step 6, the README and
   mutants M8 and M15 follow (9.1). The closing sentence of `off` is now true on every box that reaches it.
4. **A signal in the proof window (F3).** From just before the rename, INT, TERM and HUP put the original bytes back,
   with their mode, restart the unit once, remove the copy, say that the box is back on its old file and was not
   proven (ccrc doctor reads it), and exit 130. The copy is made 0600 by an explicit `chmod`, never `cp -p`. It is on
   the exit chain and removed on every exit but a failed restore, which keeps it and names it in full. A copy left by
   a run that was killed outright makes the next run, `on` or `off`, refuse, naming the file and what it is.
5. **Every refusal before the write has a red case (F4):**
   - the symlinked file;
   - the port range;
   - the relative passphrase path;
   - a missing node (PATH rebuilt without it) and a missing checker;
   - the checker's exit 5 and another exit;
   - an unreadable mode, a failed copy and a failed rewrite (a failing `stat`, `cp` or `mv` ahead on PATH).

   Each is reachable in a fixture, so none was removed. Review 3971 (its F1) found five more refusals with no case:
   an undecidable `CCRC_PORT`, an undecidable one of the four keys, no `flock` on PATH, the user manager's environment
   alone not answering, and a lock that cannot be opened. Fix round 2 adds a case for each (section 10), so from that
   round this item holds as written.
6. **The helper doctor and install share (F5, A5).** There is a case in doctor's suite for each of: role, unit and an
   undecidable bind, where the verb is not offered. Install's suite covers role and the undecidable bind. Its unit arm
   cannot be reached there, because install writes `ccrc.service` before its gate line. The helper now also declines
   a foreign `CCRC_ORIGIN` or `CCRC_RP_ID`, with a case in each suite.
7. **A failed restart is a failed proof (A1).** It takes the restore path even when the old server already answers
   the asked mode.
8. **Loopback is an address (A2, A3).** The reach reader now accepts 127.0.0.1 to 127.255.255.254 (dotted, no leading
   zero), `localhost` and `::1`. Doctor's suite gains the cases that begin `127` and are not that. `on` refuses a
   loopback bind other than unset, `127.0.0.1` or `localhost`, naming the hand route.
9. **Words (A4, A6, A7).**
   - The `off` refusal for a bind alone names the bind.
   - The `on` refusal names the three expose arms.
   - The README calls the session, terminal and pane refusals speed bumps and says what runs past them; its sentence
     for a LAN bind no longer offers a bare `ccrc expose`. Both go in by peer packet to the README's holder.
   - Expose's refusal names `ccrc auth off` only where `off` would act.
10. **Evidence gaps (A8, A9, A10).**
    - `on` never leaves a key twice: the bare-line case now carries a cookie line.
    - `off` removes every `CCRC_AUTH` line, and of the other keys only the lines holding its own value (X3, X3b).
    - The `off` restore case asserts both restarts and no leftover file.
    - Section 4 lists every residual of this round.
    - Wave 180's note reads 17 sentences and one literal.

What did not move: the order of refusals before any write, the secret handling, the cookie line beside a loopback origin
only, the guard on offered commands, the door. CLAUDE.md stays out; section 7 records the re-read of its sentence.

### 9.1 Mutants

Each mutant edited `ccd/ccrc` in place from the committed head, ran its suite through `ccrc test`, and was put back from HEAD (scratch `run.sh`). The verb's suite ran whole; the doctor, install, doctor-exposure and expose suites ran filtered to the cases named. The first batch ran at `b627069a90`. There, X3 and N3e survived. X3 survived because the bare-line case's cookie line held `on`, which `off`'s own-value rule drops too, so it now holds an empty value. N3e survived because no case put a signal between the copy and the rename; one now does. The second batch, at `02c0d0c415`, re-ran those two, N2c (its line changed for shellcheck) and the earlier M8 and M15, which follow R1.

| mutant | what it breaks | suite | tests | red cases |
|---|---|---|---|---|
| X1 | the symlinked ccrc.env refusal removed | auth | 1 failed | 61 passed (62) | refuses a ccrc.env that is a symlink (a rename would replace the link with a file), on and off |
| X1b | the CCRC_PORT range refusal removed | auth | 3 failed | 59 passed (62) | refuses CCRC_PORT=0, which is no port number; refuses CCRC_PORT=65536, which is no port number; refuses CCRC_PORT=99999, which is no port number |
| X3 (second batch) | on keeps a CCRC_COOKIE_INSECURE line already there | auth | 1 failed | 62 passed (63) | replaces a bare KEY= line and CCRC_AUTH=off rather than adding a second line |
| X3b | off removes only CCRC_AUTH lines holding on | auth | 1 failed | 61 passed (62) | removes every CCRC_AUTH line whatever it holds, and of the others only those holding its own value (X3b) |
| N1 | F1: the passphrase path read plain | auth | 1 failed | 61 passed (62) | refuses a CCRC_AUTH_SECRET_PATH line the unit reader cannot decide (a space before =) rather than reading it as unset |
| N1b | F1: the session-store path read plain | auth | 1 failed | 61 passed (62) | refuses a CCRC_SESSIONS_PATH line the unit reader cannot decide (a space before =) rather than reading it as unset |
| N2a | F2: the drop-in directories on disk not read | auth | 3 failed | 59 passed (62) | refuses on and off: a drop-in naming an all-interfaces bind, naming the source and never a value; refuses on and off: a drop-in for every user service, naming the source and never a value; refuses a drop-in directory it cannot list, and a service manager it cannot ask, as not measured |
| N2b | F2: the unit file's Environment= not read | auth | 1 failed | 61 passed (62) | refuses on and off: an Environment= line in the unit itself, naming the source and never a value |
| N2c (second batch) | F2: the unit file's PassEnvironment= not read | auth | 1 failed | 62 passed (63) | refuses on and off: a PassEnvironment= line in the unit itself, naming the source and never a value |
| N2d | F2: the unit file's EnvironmentFile= not read | auth | 1 failed | 61 passed (62) | refuses on and off: an environment file beyond the two, naming the source and never a value |
| N2e | F2: systemd's loaded DropInPaths not read | auth | 1 failed | 61 passed (62) | refuses on and off: a drop-in systemd loaded from another directory, naming the source and never a value |
| N2f | F2: systemd's loaded EnvironmentFiles not read | auth | 1 failed | 61 passed (62) | refuses on and off: an environment file systemd loaded beyond the two, naming the source and never a value |
| N2g | F2: systemd's loaded Environment not read | auth | 1 failed | 61 passed (62) | refuses on and off: an Environment= systemd loaded, naming the source and never a value |
| N2h | F2: the user manager's environment not read | auth | 1 failed | 61 passed (62) | refuses on and off: the user manager's own environment, naming the source and never a value |
| N2i | F2: an unlistable drop-in directory read as empty | auth | 1 failed | 61 passed (62) | refuses a drop-in directory it cannot list, and a service manager it cannot ask, as not measured |
| N2j | F2: a service manager that does not answer read as no source | auth | 1 failed | 61 passed (62) | refuses a drop-in directory it cannot list, and a service manager it cannot ask, as not measured |
| N2k | F2: the sources' reasons do not refuse | auth | 9 failed | 53 passed (62) | refuses on and off: a drop-in naming an all-interfaces bind, naming the source and never a value; refuses on and off: a drop-in for every user service, naming the source and never a value; refuses on and off: an Environment= line in the unit itself, naming the source and never a value; refuses on and off: a PassEnvironment= line in the unit itself, naming the source and never a value; refuses on and off: an environment file beyond the two, naming the source and never a value; refuses on and off: a drop-in systemd loaded from another directory, naming the source and never a value; refuses on and off: an Environment= systemd loaded, naming the source and never a value; refuses on and off: an environment file systemd loaded beyond the two, naming the source and never a value; refuses on and off: the user manager's own environment, naming the source and never a value |
| N2l | F2 macOS: the job's EnvironmentVariables not read | auth | 1 failed | 61 passed (62) | names a key in the job's EnvironmentVariables, a third sourced file, and a key in launchd's environment — never a value |
| N2m | F2 macOS: a third sourced file not read | auth | 1 failed | 61 passed (62) | names a key in the job's EnvironmentVariables, a third sourced file, and a key in launchd's environment — never a value |
| N2n | F2 macOS: launchd's environment not read | auth | 1 failed | 61 passed (62) | names a key in the job's EnvironmentVariables, a third sourced file, and a key in launchd's environment — never a value |
| N2o | F2 macOS: a launchctl that does not answer read as no source | auth | 1 failed | 61 passed (62) | a launchctl that does not answer, and a job file it cannot read, are undecidable |
| N3a | F3: no signal handler in the proof window | auth | 3 failed | 59 passed (62) | SIGINT three seconds into the proof puts the old bytes back, restarts once more, leaves no copy and frees the lock; SIGTERM three seconds into the proof puts the old bytes back, restarts once more, leaves no copy and frees the lock; SIGHUP three seconds into the proof puts the old bytes back, restarts once more, leaves no copy and frees the lock |
| N3b | F3: the copy takes the source's mode | auth | 3 failed | 59 passed (62) | SIGINT three seconds into the proof puts the old bytes back, restarts once more, leaves no copy and frees the lock; SIGTERM three seconds into the proof puts the old bytes back, restarts once more, leaves no copy and frees the lock; SIGHUP three seconds into the proof puts the old bytes back, restarts once more, leaves no copy and frees the lock |
| N3c | F3: a copy a killed run left does not refuse | auth | 1 failed | 61 passed (62) | refuses while a copy that a killed run left stands beside ccrc.env, naming it and what it is — on and off |
| N3d | F3: the handler puts the bytes back but does not restart | auth | 3 failed | 59 passed (62) | SIGINT three seconds into the proof puts the old bytes back, restarts once more, leaves no copy and frees the lock; SIGTERM three seconds into the proof puts the old bytes back, restarts once more, leaves no copy and frees the lock; SIGHUP three seconds into the proof puts the old bytes back, restarts once more, leaves no copy and frees the lock |
| N3e (second batch) | F3: the copy is not on the exit chain | auth | 1 failed | 62 passed (63) | a signal after the copy is made and before the write changes nothing, restarts nothing and leaves no copy |
| N4a | R1: off on a hand-armed box does not refuse | auth | 2 failed | 60 passed (62) | refuses a box armed by hand for another address (a CCRC_ORIGIN it did not write), naming the key, never the value; refuses a box armed by hand for another address (a CCRC_RP_ID it did not write), naming the key, never the value |
| N4b | R1: a foreign cookie line alone refuses off | auth | 1 failed | 61 passed (62) | a foreign cookie line alone is no such evidence: off removes its own lines and names the one it left |
| N5 | A1: a failed restart can still read as proved | auth | 1 failed | 61 passed (62) | takes a failed restart as a failed proof: the file goes back, exit 1 |
| N6 | A2: any text beginning 127 is loopback | auth | 4 failed | 58 passed (62) | refuses CCRC_HOST=127.0.0.1.example.com as reached from elsewhere: loopback is 127.0.0.1 to 127.255.255.254, localhost or ::1; refuses CCRC_HOST=127.256.0.1 as reached from elsewhere: loopback is 127.0.0.1 to 127.255.255.254, localhost or ::1; refuses CCRC_HOST=127.0.0.01 as reached from elsewhere: loopback is 127.0.0.1 to 127.255.255.254, localhost or ::1; refuses CCRC_HOST=127.255.255.255 as reached from elsewhere: loopback is 127.0.0.1 to 127.255.255.254, localhost or ::1 |
| N6x | A2, doctor's suite: any text beginning 127 is loopback | doctor exposure, `127` cases | 6 failed | 4 passed | 189 skipped (199) | a bind that only begins 127 (127.0.0.1.example.com) is reachable — a name or no address at all; a bind that only begins 127 (127.example) is reachable — a name or no address at all; a bind that only begins 127 (127.256.0.1) is reachable — a name or no address at all; a bind that only begins 127 (127.0.0.01) is reachable — a name or no address at all; a bind that only begins 127 (127.255.255.255) is reachable — a name or no address at all; a bind that only begins 127 (127.0.0.0) is reachable — a name or no address at all |
| N7 | A3: on accepts any loopback bind | auth | 2 failed | 60 passed (62) | on refuses the loopback bind CCRC_HOST=127.0.0.2, whose address it would write falsely, and names the hand route; on refuses the loopback bind CCRC_HOST=::1, whose address it would write falsely, and names the hand route |
| N8 | A4: off names un-exposing for a bind | auth | 1 failed | 61 passed (62) | refuses a non-loopback CCRC_HOST bind, and an undecidable one |
| N9 | A4: on names a bare ccrc expose | auth | 3 failed | 59 passed (62) | refuses a box reached from elsewhere: an exposure file, naming ccrc expose — on and off alike; refuses a box reached from elsewhere: a Caddyfile, naming ccrc expose — on and off alike; refuses a box reached from elsewhere: the ddns timer unit, naming ccrc expose — on and off alike |
| N12a | F4: the relative passphrase path refusal removed | auth | 1 failed | 61 passed (62) | refuses a RELATIVE CCRC_AUTH_SECRET_PATH, whose file the server and this verb would read in different places |
| N12b | F4: the missing node refusal removed | auth | 1 failed | 61 passed (62) | refuses with no node on PATH, and with the passphrase checker missing |
| N12c | F4: the missing checker refusal removed | auth | 1 failed | 61 passed (62) | refuses with no node on PATH, and with the passphrase checker missing |
| N12d | F4: the checker's exit 5 passes | auth | 1 failed | 61 passed (62) | refuses when the passphrase checker exits 5 |
| N12e | F4: the checker's other exits pass | auth | 1 failed | 61 passed (62) | refuses when the passphrase checker exits 7 |
| N12f | F4: an unreadable mode does not refuse | auth | 1 failed | 61 passed (62) | refuses when the mode of ccrc.env cannot be read, when the copy fails, and when the rewrite fails |
| N12g | F4: a failed copy does not refuse | auth | 1 failed | 61 passed (62) | refuses when the mode of ccrc.env cannot be read, when the copy fails, and when the rewrite fails |
| N12h | F4: a failed rewrite does not refuse | auth | 1 failed | 61 passed (62) | refuses when the mode of ccrc.env cannot be read, when the copy fails, and when the rewrite fails |
| X4 | F5: the helper's role arm removed | doctor + install, `wave 181` cases | 2 failed | 10 passed | 109 skipped (121) | wave 181: where ccrc auth refuses, the dark remedy does not offer it: CCRC_ROLE=fleet in ccrc.env; wave 181: where ccrc auth refuses, the gate line does not offer it: CCRC_ROLE=fleet recorded in ccrc.env |
| X5 | F5: the helper's unit arm removed | doctor + install, `wave 181` cases | 1 failed | 11 passed | 109 skipped (121) | wave 181: where ccrc auth refuses, the dark remedy does not offer it: no ccrc.service installed |
| X6 | F5: the helper's undecidable-bind arm removed | doctor + install, `wave 181` cases | 2 failed | 10 passed | 109 skipped (121) | wave 181: where ccrc auth refuses, the dark remedy does not offer it: a CCRC_HOST the unit reader cannot decide; wave 181: where ccrc auth refuses, the gate line does not offer it: a CCRC_HOST the unit reader cannot decide |
| N10a | A5: the helper's foreign rp id arm removed | doctor + install, `wave 181` cases | 2 failed | 10 passed | 109 skipped (121) | wave 181: where ccrc auth refuses, the dark remedy does not offer it: a foreign CCRC_RP_ID; wave 181: where ccrc auth refuses, the gate line does not offer it: a foreign CCRC_RP_ID |
| N10b | A5: the helper's foreign origin arm removed | doctor + install, `wave 181` cases | 2 failed | 10 passed | 109 skipped (121) | wave 181: where ccrc auth refuses, the dark remedy does not offer it: a foreign CCRC_ORIGIN; wave 181: where ccrc auth refuses, the gate line does not offer it: a foreign CCRC_ORIGIN |
| N11 | A7: expose names auth off whatever CCRC_AUTH holds | expose, `wave 181` cases | 1 failed | 68 skipped (69) | wave 181: when the keys are the lines ccrc auth on wrote, the refusal names ccrc auth off first — and only then |
| M8 (second batch) | M8 re-measured: a foreign origin or rp id does not refuse on | auth | 1 failed | 62 passed (63) | refuses a foreign CCRC_ORIGIN and a foreign CCRC_RP_ID, naming the key and never the value |
| M15 (second batch) | M15 re-measured: off removes only the flag | auth | 3 failed | 60 passed (63) | removes exactly what on wrote — the file is back to its bytes — and proves sign-in off; a foreign cookie line alone is no such evidence: off removes its own lines and names the one it left; removes every CCRC_AUTH line whatever it holds, and of the others only those holding its own value (X3b) |

All 50 killed (none survives the second batch).

### 9.2 Evidence

All runs went through `ccrc test`.

- **Red first.** The new cases were written first and run against the code at the PR head, `3dbc7cbf9d`.
  - The verb's suite: 33 of its then 62 cases were red. Each was a behaviour this round adds; the F4 cases were green
    there, because those refusals already existed, and the mutants hold them.
  - The other suites, run with HEAD's `ccd/ccrc` and `ccrc-doctor-checks` put back in place: 14 new cases were red
    (doctor auth, install landing, doctor exposure, expose; passwd's one case was later withdrawn with the F1 move).
    The role, unit and undecidable-bind cases were green there: the helper already had those arms, and X4 to X6 show
    them red.
- **The touched suites on the code head.** The verb, CLI, doctor auth, doctor exposure, install landing, expose,
  passwd, settings census, tmux socket census and the door's copy line: 10 files, 559 passed, 16 skipped.
- **The F1 move, measured and withdrawn.** With `passwd`, doctor and install on the unit reader, nine existing cases
  turned red (section 4), so they stay on the plain reader.
- **Growth.** `ccd/ccrc` +481 net code lines against the merge base (14351 to 14832), `ccrc-doctor-checks` −14. The
  waiver's `maxDelta` is 481, D-9105, the growth check 100 of 100.
- **Shellcheck 0.11.0, the ratchet's flags.** The first build added two SC1087 and one SC1010. Both are fixed:
  `${k}[[:space:]]`, and a state word that is not `done`. `ccd/ccrc` is now at or under every code's pin, SC2034 at 13
  of 15.
- **The browser suite, every file.** The PR's own fast run never runs browser files, so they ran on a scratch merge of
  the code head with main `aac570d3d1`. pwa is unchanged from the code head to the final head. It was a detached
  scratch worktree with its own `npm ci`, run in ten parts one after another: 126 files. 123 passed in their parts;
  `testbox-card`, `item-wrap` and `accounts-openrouter-card` were red once each, a width, a 20 s wait and a sheet's
  position, and each passed alone (9 of 9, 16 of 16, 16 of 16; `testbox-card`'s first solo run was killed by the test
  slice's memory cap). `connect-sheet`, this PR's door, passed in its part. The per-file list goes with the wave-done.
- **Not run here.** The server tests' typecheck, which the test slice's memory cap killed last round; CI's job measures
  it.

### 9.3 The pushed head's red, and its fix

The fast run on `7ed7ca519f`, this round's first push, was red in two places: the census and CodeQL. The second
push, `010ebf63cb`, cleared the census and one of the two alerts, and was red on the other alert, the ledger guard and
the shellcheck ratchet. The third push answers those.

- **The D-3510 census, one case in server shard 10.** It finds no `chmod <mode> --` in a shipped script. This round's
  F3 code wrote it three times: the copy's `chmod 600` and the two restores of the saved mode. BSD chmod reads that
  `--` as a file and exits 1, so on a Mac the copy would never get its 0600 and the restore would always fail. The
  census was outside the guard set run here. The fix names the mode after `--`. It changes no line count, so growth
  stays +481.
- **CodeQL, two alerts in the verb's test file.** Its 127-text case built a regular expression from a host literal and
  escaped only the dots. A full escape cleared the string-escaping alert but not the hostname one, because CodeQL
  still traced the host literal into the pattern. So the case now matches the message's fixed words with a pattern
  and names the host with a substring check, which needs the exact host and is stricter than the pattern was.
- **The trailer.** The second push's head carried its `Ledger-Edit:` line in a paragraph of its own, so git did not
  read it as a trailer, and the ledger guard was red. The third push's head puts it beside the attribution line.
- **The shellcheck ratchet, server shard 1 of the second push.** The pinned 0.11.0 did not download within its two
  60 s attempts, so the ratchet found the runner's 0.9.0 and failed as designed. That is the runner, not this change.

The second push, `010ebf63cb`, carried the two fixes of the first push's red, by the coordinator's yes. The third,
`c03586ba94`, carried the fixes of the second push's red, listed above. Before the second push, every guard file CI's fast plan selects
(`guardTests`, `.github/ci/fast-plan.mjs`) that names `ccd/` or `deploy/` was run on the fix commit: 122 files in four
parts.

- 119 passed.
- `docs-parity` timed out once under load and passed alone, 82 of 82.
- Two are red on this box the same way on a scratch merge with main, and CI's shards passed them:
  - the census file's own BSD-order shim case;
  - `ccd-tmux-anchor`, 19 cases whose fixture pane never printed its mark.

The shellcheck ratchet was killed again by the test slice's memory cap, so CI measures it. The fix only reorders
chmod's arguments.

## 10. Review fix round 2 (review 3971)

Review 3971 read `c03586ba94`. The coordinator's fix round 2 is the list below, the last round the review cap allows;
anything outside it is mailed first. Each change was red first.

1. **R1: the verb acts only on a service definition that is the installer's.** `_auth_unit_own` runs after the sources
   reading. On Linux the installed `ccrc.service` must be the tree's `deploy/ccrc.service` byte for byte (`cmp`), the
   file `_inst_units` and deploy.sh copy unchanged. Any difference refuses, on and off alike: the words name the file,
   say the verb acts only on its own, and give the ways on (an install or an update puts the shipped file back, or the
   README's hand route). They never print the difference. A tree file or unit that cannot be read, or no `cmp`,
   refuses as not measured. systemd must answer `NeedDaemonReload=no`: `yes` refuses with `systemctl --user
   daemon-reload` as the way on, and no answer refuses as not measured. The existing source reads stay as they were (R1
   c). The sources reading runs first, so a unit that names a key still gets its own reason.
   - **macOS: R1(d), ruled (B).** The job file cannot be reproduced byte for byte. `_inst_plist_server` writes the
     installing process's PATH (`_svc_job_path`) and the `ProcessType` it reads from `~/.ccrc/launchd-class` at
     install time, and the box no longer determines either when the operator later runs the verb. By R1(d) that went
     to the coordinator (mail 38407), who ruled (B) (mail 38411): on a Mac the verb refuses.
     - `cmd_auth` refuses on darwin right after the operator-only checks, before any read of the box, and writes
       nothing. The words say the verb does not act on a Mac yet, and give the hand route as it holds there: for `on`,
       `ccrc passwd`, then the four lines in `ccrc.env`; for `off`, the four lines to remove; then the platform's own
       restart hint from `_svc_restart_hint` (`launchctl kickstart -k …`).
     - `_auth_fits_here` answers no on darwin, so doctor's `auth` line and install's gate line give the hand route
       there. Their wave-181 positive cases now branch on the platform, as the siblings do, so the macOS leg asks the
       hand route of each surface.
     - The macOS arm of `_auth_unit_sources` is removed, with its three function-level cases (the shipped job,
       its EnvironmentVariables, a third sourced file, launchd's environment, an unreadable job), because no macOS
       path reads the job any more. This is a removal by ruling, not a weakening: what those cases held is now a
       refusal before the reading, held by the two Mac cases and by mutant D1.
   - The fixture now plants what the installer writes: the tree's `deploy/ccrc.service` at `<home>/ccrc/deploy/`, and
     the same bytes as the installed unit. A changed claim: the old "shipped shape" case passed a hand-written unit
     with a harmless `Environment=NODE_ENV=production` line. That unit now refuses as not the installer's ("an edit that
     names no key at all" is its case). The case now passes the untouched installed unit, with that key in what
     systemd loaded instead. The F2 cases that edit the unit now add their line to the installed file instead of
     replacing it.
2. **R2: every refusal has a red case.** Five cases are added: an undecidable `CCRC_PORT` (on and off), each of the
   four keys undecidable (one case per key, on and off), no `flock` on PATH, the user manager's environment alone not
   answering (on and off), and `update.lock` as a directory. The reviewer's four survivors are red by case name
   (section 10.1: R4, R5, R6, R8), and so is the lock's rc 3 (L3), which the reviewer read but did not mutate.
3. **R3: the end-to-end cases skip on darwin.** Ten describes take `describe.skipIf(IS_DARWIN)`, the R1 one among
   them. The Mac describe (its two refusals and the helper's two rows) and the handler describe are function-level and
   run everywhere. The `flock` refusal gives the way on.
4. **R4: the handler reads the disk.** The states are `pre`, `written` and `proved`; `restored` is gone. From just
   before the rename to the end of the last proof the state is `written`, and the handler decides from the files:
   - a copy still there is put back;
   - a copy gone is the old file back, and gets one restart;
   - after a restore that failed (`AUTH_KEEP_BAK=1`, now set when a created file cannot be removed too), it names the
     kept copy and restarts nothing.
   `proved` is set before the copy is removed. The failed-proof message no longer says "back as it was" after a
   restore that failed: it says the server answers as before, on this run's lines. Cases H1 to H4 call the handler
   with what each line reaches, and an end-to-end case signals the verb from an `rm` stub as it removes the copy.
5. **R5: words.**
   - A3a: a bind and nothing else gets one sentence on and off that is true of every refused value: "is not a value
     this verb can read as this machine only (127.0.0.1 to 127.255.255.254, localhost or ::1)". `127.1` and `LOCALHOST`
     join the cases, on and off.
   - A5: `on` gives the README's remedy for that box (bind it back to `127.0.0.1`, or arm it by hand), never the three
     expose arms.
   - The leftover copy's sentence says the run did not finish: it was killed, or it could not put the file back and
     kept the copy.
   - A6: section 9.3's line about the second push names both later pushes.

Not in this round, as ticketed by the coordinator: A3c and A4 (auth-verb-remedy-dead-ends), a Mac measurement and a
darwin fixture (issue #3475), the shellcheck pin (A7), and the readers' trailing-whitespace split
(auth-readers-one-reader).

### 10.1 Red first, and the mutants

The suite had 85 cases before ruling (B), against 63 at `c03586ba94`. Run against `c03586ba94`'s `ccd/ccrc`, 20 of
them are red:
- every R1 case;
- H2 to H4;
- the six bind-text cases and the bind case (R5 A3a and A5);
- the `flock` case (its new way on);
- the leftover-copy case (its new sentence);
- the end-to-end signal case: the old handler, finding the copy gone in `written`, says it could not be put back.
The other R2 cases are green there, because those refusals already existed; the mutants below are what hold them.
Ruling (B) then removed three launchd cases and added four. The two Mac refusals are red on `c03586ba94`, whose
darwin run went on into the box. The helper's darwin row is red there too, since that helper had no platform
decline, and its Linux row is the control. That makes 86 cases, 23 of them red on `c03586ba94`.

Each mutant was applied to the new `ccd/ccrc`, the whole suite run, and the file restored and compared (`cmp`).

| Mutant | What it does | Red cases |
|---|---|---|
| R4 | the user manager's environment refusal becomes `\|\| true` | "refuses when only the user manager's environment does not answer" |
| R5 | `true \|\|` before the CCRC_PORT refusal | "refuses a CCRC_PORT line the unit reader cannot decide" |
| R6 | `true \|\|` before the four keys' refusal | the four "refuses a <key> line the unit reader cannot decide" cases |
| R8 | the `flock` refusal becomes `:` | "refuses with no flock on PATH" |
| L3 | the lock's rc 3 refusal becomes `:` | "refuses when the lock cannot be opened (update.lock is a directory)" |
| O1 | `true \|\|` before the installer's-unit refusal | the five edit cases, the reload case, the unreadable tree case (7) |
| O2 | `cmp`'s difference ignored | the five edit cases |
| O3 | `NeedDaemonReload=yes` accepted | "refuses a unit systemd has not reloaded since it changed" |
| O4 | no NeedDaemonReload answer accepted | the same case (its second half) |
| O5 | an unreadable tree file accepted | "refuses as not measured when the tree's own unit file cannot be read" |
| H1 | the handler stops asking whether the copy is there | H2 |
| H2 | the handler ignores a restore that failed | H3 |
| H3 | `proved` falls through to `pre`'s words | H4, and the end-to-end signal case |
| H5 | `proved` set after the copy is removed | "a signal as the proven run removes its copy leaves the change standing" |
| W1 | `on` with a bind alone gets the expose arms again | the six bind-text cases and the bind case (7) |
| D1 | the darwin refusal skipped | the two Mac refusal cases |
| D2 | the helper's darwin decline removed | "the helper that offers the verb, on darwin, answers 1" |

All 17 are red. H5 survived the first batch, which had only the function-level cases. It is red since the end-to-end
signal case was added. D2 survived its first run: the darwin row had only `ccrc.service` in the unit directory, so the
helper declined for want of a job file. Once the row held the job the installer's writer prints, the platform was the
only reason left to decline, and D2 went red.

### 10.2 Notes for the Mac wave (from reading the writer)

- What the box determines in the job file, and so can be proved: the label, the log path, the `bash -c` line with
  the two environment files and the entry, `HOME`, the core limits. What it does not: the `PATH` string (the
  installing process's own, plus the Homebrew directories) and `ProcessType` (`~/.ccrc/launchd-class` as it was then).
- A compare that frees those two fields must still refuse a `PATH` value that could open a new key (no `<`, no `&`, no
  newline), and a binary job file.
- The lock needs a form that works without `flock`, which stock macOS lacks.
- The end-to-end fixture needs a launchd job in `~/Library/LaunchAgents`, a `launchctl` stub and `cp` at `/bin/cp`
  (review 3971 F4).

### 10.3 Evidence

All runs went through `ccrc test`. The code is commit `4c52b239df`; the head adds only this note and the README.

- **The verb's suite:** 86 cases, all passing on the code commit; 23 of them red on `c03586ba94`'s `ccd/ccrc` (10.1).
- **Mutants:** 17, each applied to the final `ccd/ccrc`, the whole suite run, and the file restored and compared; all
  red (10.1).
- **Neighbours:**
  - doctor core-auth, install landing and the verb: 198 passed, 9 skipped, after ruling (B);
  - before it, doctor exposure, expose, passwd, the CLI, the settings census, the tmux socket census, door-origin-read
    and offered-commands with them: 549 passed. Its one red was the census file's BSD-order shim case.
- **The shell-script guards on the code commit:** every guard file CI's fast plan selects that names `ccd/` or
  `deploy/`, 122 files in four parts. 120 files passed. Two are red, the same way as on a scratch merge with main on
  this box, and CI's shards passed them in round 1:
  - the census file's BSD-order shim case;
  - `ccd-tmux-anchor`'s real-tmux cases, 19 of them.
- **Growth:** `ccd/ccrc` +520 net code lines (14351 to 14871) against main `9a21a20715`, whose `ccd/ccrc` is the merge
  base's. Measured with the growth check's own `codeLines`, which gives +481 for `c03586ba94`, the waiver's old
  number. Main `aba5845760` has not changed `ccd/ccrc` since. D-9105's waiver says 520, set in the code commit, and
  `growth-check` and `growth-caps` pass on it.
- **The offered-commands guard on the merge with #3459:** 12 of 12 on a scratch merge of the code commit with main
  `aba5845760`, #3459's own merge. Their entry needed no reshaping.
- **Browser:** review 3971's 14 files, on a scratch merge of the code commit with main `aba5845760` (`fa2b24e5be`),
  in a tree with its own `pwa` and `ui` packages (`npm ci` after main's renderer package change), no symlinked ones:
  14 files, 322 cases, all passing. `docs-mockup-export` started and passed 20 of 20 (it could not start in the review's
  tree). The others: connect-sheet 20, auth-resume 16, reauth-sheet 20, chatgpt-sheet 32, accounts-openrouter-card 16,
  accounts-cards 24, accounts-open 16, account-knob 16, account-pool-unavailable 16, remove-sheet 16, sign-in-sheet 16,
  docs-mockup 23, mockup-parse 71. The same 14 passed on the earlier merge with main `9a21a20715` too (322 of 322).
- **The shellcheck ratchet** cannot run here: the test slice's memory cap kills its run of `ccd/ccrc`. The exact
  head's CI job measures it, named in the wave-done.
- **Merge probe:** clean against main `aba5845760`.

## 11. Wave 190: the third review's carries (desktop polish run 4019)

Wave 190 closes what review 4007 (the third review of #3405) left, and nothing else. The verb's rule holds throughout:
it acts only on what it can prove, refuses anything undecidable, writes nothing before the last refusal and prints no
secret or file value. The order of refusals, the secret handling, what `off` refuses, the Mac refusal itself and the
offered-commands guard did not move; no refusal was loosened and no case removed. Each change below was red first
(11.1). `ccd/ccrc`, the README and the plan were held by other runs: each change went to its holder as a unified diff
against main `6df8f8bb63` first and was applied only on the holder's yes (11.3).

1. **F1: the file systemd loaded.** The compare and the reload answer said nothing about which file systemd loaded, so
   a unit of the same name earlier on the user search path passed both. Measured on this box's systemd 259 (`systemctl
   --user show -p UnitPath`), the control directories (`~/.config/systemd/user.control`, `/run/user/<uid>/systemd/
   user.control`), the runtime transient directory and the early generators come before `~/.config/systemd/user`.
   `_auth_unit_own`'s one `systemctl --user show` read now asks `NeedDaemonReload`, `FragmentPath` and `SourcePath`
   together, and reads each line by its name, because systemd prints the properties in its own order, not the order
   asked: measured, `FragmentPath`, `SourcePath`, `DropInPaths`, `NeedDaemonReload`, and each asked property printed even
   when empty. The verb refuses, on and off alike, unless `FragmentPath` is the user unit directory's own `ccrc.service`
   and `SourcePath` is empty. The refusal names both files, and its way on is to take that unit away, then
   `systemctl --user daemon-reload` (or the README's hand route). An empty `FragmentPath`, which systemd answers for a
   unit it does not know (measured, with rc 0), and no `FragmentPath` line at all refuse as not measured.
   - **The drop-in list stays in the sources read.** Moving `DropInPaths` into this read would make the two answers come
     from one moment, but the existing drop-in refusal runs earlier, in `_auth_unit_sources`, with its own words and
     cases, and a second refusal of the same fact would be a second writer. One read does not close the window either:
     a reload between the last read and the restart is open whatever the reads are, and section 4 states it (a
     same-user process acting after the reading). So the list stays where it is, and the header and the comment now
     say what the code proves.
   - The suite's `systemctl` stub answers every property asked, in systemd's order, one line each (empty as `Name=`).
2. **F2: the Mac cases hold the refusal.** Review 4007's survivor turned both Mac refusals into printed lines and left
   the suite green: with no job file, the "not installed" refusal ended the run with the same checks satisfied. Each
   Mac case now plants the job the installer's writer prints and a leftover copy beside `ccrc.env`, and asserts exit
   1, the Mac words on one line, none of a later refusal's words, and no `update.lock` made. That pins the refusal
   before the lock, the leftover-copy check and the reach read. The survivor is now red by case name, and so are two
   mutants that move the refusal after the lock and after the leftover check (11.1).
3. **A1: one residual class.** Section 4's preload item now states the class once: anything that changes what node
   runs before the server reads its keys. That is a node option such as `NODE_OPTIONS`, or a `PATH` that finds another
   `node` first (the unit starts node through `/usr/bin/env`), from any source the unit takes its environment from:
   `ccrc.env`, the exposure file or the service manager's environment. The README says the same in one sentence.
4. **A2: the handler says what it knows.** A copy gone, with no restore that failed, can in this run only have been
   moved back by its own restore, so the handler now says it takes the old file to be back and why. With no file
   before the run, it removes the one the run wrote and names no old file. The failed-proof restore names a file this
   run created as this run's, never as "the previous" one, and "not on its old file" is said only where there was one.
   The comments say the state word moves to `written` before the rewrite into the temporary file. Which arm restores
   or restarts did not change, and none was found wrong.
5. **A3: the way on.** The installer's-unit refusal and the README give `ccrc install`, which always lands the tree's
   file and reloads systemd (`_inst_units`, `_inst_atomic`). An update leaves a box already on its version alone.
6. **A4: doctor and install ask the compare half.** `_auth_unit_cmp` is the compare `_auth_unit_own` starts with, and
   it needs no service manager. `_auth_fits_here` asks it, so doctor's `auth` line and install's gate line no longer
   offer the verb where the installed unit is not the tree's file or the compare cannot be made. Section 5's sentence is
   now true as written there. The cases: four function-level rows in the verb's suite (edited, tree file missing, `cmp`
   exiting 2, no `cmp`), and three doctor rows (edited, tree file missing, no `cmp`). Install has no row: it lands the
   tree's file before its gate line, so a hand-edited unit cannot reach it there. Doctor's contained PATH has no `cmp`,
   so its unexposed box gets one that runs the real `cmp` (measured: without it the helper declined, as not measured).
7. **A5, A6: the cases asked for.** `cmp` missing, and `cmp` failing with exit 2; the handler's kept-copy arm for a
   file this run created (H6); the failed proof whose removal of a file this run created fails (both restarts fail,
   so no server is asked); and "on this run's lines, not on its old file".
8. **A8, A9, A12.** Issue #3475 stands where the internal slug stood, in the README and here (sections 4 and 10). The
   plan's D-9105 entry describes `on` and `off` with the Mac, sources, installer's-unit and loaded-file refusals. The
   speed-bump sentence in the helper's header, the README and section 3 says which refusal each way past defeats, and
   no longer says a script file or another interpreter does: by itself neither does, since it inherits all three
   conditions. Section 7 quotes the rules-file bullet as it lands in #3476, whose parenthesis review 4023 corrected.

**Residuals, this round.** Section 4 lists them all. New: a box whose unit directory systemd names by a different
spelling (a symlinked `~/.config`, say) refuses, because the compare of `FragmentPath` is literal; that is the safe
direction. Unchanged: doctor and install still cannot see what only the service manager says (a drop-in, the reload,
the file systemd loaded), so there they may name a verb that then refuses by name.

### 11.1 Red first, and the mutants

The new and changed cases were written first and run against `e1994896dc`'s `ccd/ccrc` (main, #3405's merge), through
`ccrc test`. In the verb's suite, 18 of its 100 cases were red there, each a behaviour this round adds:
- the five installer's-unit edit cases (their way on, A3);
- the four F1 cases (two fragments elsewhere, a `SourcePath`, an empty or absent answer) and the passing read, which
  asks for `FragmentPath` in the reload read;
- the four helper rows (A4);
- H2 and H5 (A2);
- the two failed-restore cases. "On this run's lines" was first red for a fixture slip: its home's name held
  `auth-restore`, so the `mv` stub refused the write's own rename. The prefix was renamed, and the case is green on the
  old code, because that sentence already existed; mutant A6b holds it.
The Mac cases, the compare's two unmeasured arms and H6 were green there, because those refusals and words already
existed: the mutants below hold them. In doctor's suite, the two declining rows written then were red. The third row
(no `cmp`) was added once the measurement in item 6 found doctor's PATH has none; mutant A4 holds it.

Each mutant edited `ccd/ccrc` in place from the committed head, ran the whole verb suite (doctor's for A4, filtered to
its wave 190 rows) through `ccrc test`, and was put back from HEAD and compared with it.

| Mutant | What it does | Red cases |
|---|---|---|
| MAC-print | both Mac refusals print instead of exiting (review 4007's survivor) | the two Mac refusal cases |
| MAC-after-lock | the lock is taken before the Mac refusal | the two Mac refusal cases |
| MAC-after-leftover | the leftover-copy check runs before the Mac refusal | the two Mac refusal cases, and the leftover-copy case |
| F1a | any `FragmentPath` accepted | the two fragment-elsewhere cases |
| F1b | any `SourcePath` accepted | "a unit systemd made from another source (SourcePath)" |
| F1c | an empty `FragmentPath` accepted | "refuses as not measured an empty FragmentPath answer, and no FragmentPath line at all" |
| F1d | `FragmentPath` and `SourcePath` not asked (and the user unit file assumed) | the passing read, and the four F1 refusal cases (5) |
| A4 | the helper does not ask the compare | the four helper rows; in doctor's suite, its three wave 190 rows |
| A3 | the old way on ("an install, or an update") | the five edit cases |
| A5a | no `cmp` accepted | the end-to-end `cmp` case and the no-`cmp` helper row |
| A5b | `cmp`'s other exits accepted | the end-to-end `cmp` case and the exit-2 helper row |
| A2a | a copy gone said to be back, byte for byte | H2 |
| A2b | no file before the run, said to be back on its old file | H5 |
| A5c | the created file's kept-copy arm names a copy | H6 |
| A6a | the created file named "the previous" one | the failed removal case |
| A6b | the kept-copy re-proof said "back as it was" | "on this run's lines, not on its old file" |

All 18 are red (17 on the verb's suite, and A4 on doctor's too).

### 11.2 Evidence

All runs went through `ccrc test`, one file or one batch at a time. The code is commit `e2abf378c2`; the head adds
only this note.

- **The touched suites on the code:** the verb's suite 100 of 100, doctor core-auth 73 (8 skipped), install landing
  42 (1 skipped), doctor exposure 195 (4 skipped), expose 66 (3 skipped).
- **The same on a scratch merge with main `f93a521927`** (main has not changed `ccd/ccrc` since `e1994896dc`): those
  five, the offered-commands guard (12), the settings census (22), the tmux socket census (19), the install census
  (76), the raw-spawn census (7) and `ccd-die-containment` (12) all pass.
- **The guards CI's fast plan selects** that name `ccd/` or `deploy/` (`guardTests`, `.github/ci/fast-plan.mjs`): 117
  files in four parts, on the code before the A12 comment hunk. 115 pass. Two are red, the same two as in rounds 1 and
  2, and red the same way on a clean scratch checkout of main `f93a521927`:
  - the census file's BSD-order shim case (`ccd-child-tmpdir`, 1 of 42);
  - `ccd-tmux-anchor`'s real-tmux cases (19 of 35).

  The 48 of them that read `ccd/ccrc` as text, with the anchor, citation, deviation-ref and die-containment guards, ran
  again on `e2abf378c2`: 51 of 52 pass, and the red is `ccd-tmux-anchor`.
- **Growth:** `ccd/ccrc` +23 net code lines against the merge base `e1994896dc` (14490 to 14513), counted with the
  growth check's own rule for bash (the test box does not pass `GROWTH_CHECK` to the run, so its rows skip there). That
  is under the per-PR limit of 40, so no waiver; `growth-check` passes.
- **The shellcheck ratchet** cannot run here (the test slice's memory cap); the exact head's CI job measures it.
- **Merge probe:** clean against main `f93a521927`.

### 11.3 The packets

`ccd/ccrc` (the Docs reader's artifacts run), the README (the Overlord board run) and the plan (the hook cost row run)
were held. Each change went to its holder first, as a unified diff against main `6df8f8bb63`, and was applied byte for
byte only on its holder's yes: `ccd/ccrc` twice (the change, then A12's comment), the README twice (the paragraph, then
A12 and a re-wrap), and the plan once. No holder's lines are shared. The README packet first left one line at about 150
characters, re-wrapped in the second. One shell call was refused by the session hook because a draft's text named the
program the unit starts node through; nothing ran, it was reported word for word, and the coordinator ruled the file
tools right for such text.

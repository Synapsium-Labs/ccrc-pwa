# Wave 193: `ccrc auth on|off` on a Mac, and review 4061's carries (desktop polish run 4078, D-9158)

The note for wave 193, written by its worker for the coordinator to fold into the ledger. It follows the wave-181 note,
`auth-on-verb.md`, whose rule this wave keeps: the verb acts only on what it can prove, refuses anything undecidable,
writes nothing before the last refusal, and prints no secret or file value. Each claim says whether it was **measured**
(a test run by this wave) or **read** (on the tree, not run). Every run went through `ccrc test --local`, one file at a
time, on this box (Linux) unless it says the macOS leg.

Part 1 is review 4061's six follow-ups (tickets `auth-verb-review-4061-carries` and `auth-verb-remedy-dead-ends`), in
commits of their own. Part 2 is the Mac (issue #3475, ticket `auth-verb-on-a-mac`), built on the coordinator's yes to
the step-1 proposal, with the conditions it set (A1 to A4, B1 to B3, F1 to F4, g).

## 1. Part 1: review 4061's follow-ups

1. **C1: a row for `both`.** The printed-role clamp prints `server` or `both`, and only `server` had a row, so the
   reviewer's mutant that drops `both` from the clamp stayed green. Each of the two words now has a row, on `on` and
   `off`, asserting the whole printed line (`--role server`, `--role both`). Mutant C1 (`both` dropped) is red on the
   `both` row.
2. **C2: the bad-role rows on `off`.** The four rows (an unknown word, a shell metacharacter, a control character, a
   3000-character value) run on `off` as well as `on`, each asserting the whole line and no byte of the value.
3. **C3: section 13.1 of the wave-181 note.** It said mutants CL1, CL2 and M1 hold the `server` case and the R2 pin.
   CL1 and CL2 leave the `server` case green (each still prints `server`), so no mutant held it. 13.1 is corrected in
   place (the coordinator's ruling: the false sentence does not stay on main), and mutant S1 (`server` dropped from the
   clamp) is red on the `server` row.
4. **C4: an unreadable `ccrc.env`.** The role was read as empty whenever `ccrc.env` could not be read, so the way on
   said "this box records no role", which nobody had read. `_auth_role` is now the one read of the recorded role for
   both callers (`cmd_auth`, `_auth_fits_here`): empty when the file is absent or names no role, and a newline, which no
   line read can hold (the `SourcePath` idiom), when the file is there and cannot be read. The way on then says
   "`<ccrc.env>` cannot be read, so the role it records was not read, and a bare install takes role both". No refusal
   moved: the newline is not `fleet`, as the empty role was not. Row: on and off, the whole line. Mutants C4a (the
   newline read as empty) and C4b (its arm removed) are red on it.
5. **C5: every file value the verb prints.** `_box_said <value>` prints a value whole only when it is 1 to 1024 bytes of
   letters, digits and `._/@:+,%=~-[]`, read as bytes; anything else prints as `[a value this verb does not print]`. So
   an escape sequence, a newline or a quote in a value never reaches the terminal or a line the operator is told to copy.
   The print sites, each with what holds it:

   | site | value | held by |
   |---|---|---|
   | `_box_reach`'s reason (doctor's `update-exposure` shares it) | `CCRC_HOST` | `_box_said` |
   | `off`'s and `on`'s bind sentence | `CCRC_HOST` | `_box_said` |
   | `on`'s loopback-other refusal | `CCRC_HOST` | the reach check before it: only a loopback address reaches it |
   | the address printed and the `ssh -L` line | the host and the port | the reach check (a loopback address) and the port check (1 to 65535) |
   | `on`'s three passphrase sentences (none yet, unusable, relative) | `CCRC_AUTH_SECRET_PATH` | `_box_said` |
   | the sources read: an `EnvironmentFile=` value in the unit, a drop-in's file name on disk, a drop-in and an environment file systemd loaded | paths from a file or from systemd | `_box_said` |
   | the loaded-file read | `FragmentPath`, `SourcePath` | `_box_said` |
   | the failed proof's sentence | the unit's state word from the service manager | `_box_said` |
   | the way on of the installer's-unit refusal | the recorded role | the clamp (wave 190 fix round 2) |
   | `off`'s port-moved refusal and expose's port-moved hint (C6) | the port in the marker line, and `CCRC_PORT` | the digits regex, then `_box_said` (the coordinator's ruling) |
   | the reasons that name keys, the build version, the auth mode | key names from `AUTH_KEYS` and `AUTH_SOURCE_KEYS`, a version matched `vX.Y.Z`, one of three mode words | closed lists |
   | the pane guard | the tmux session name | `${pane//[![:print:]]/?}` (wave 181) |
   | paths built from `$HOME` and constants (`ccrc.env`, the unit directory, the exposure file, the Caddyfile, the tree's unit) | no file value | — |

   A quote in a `CCRC_HOST` or `CCRC_AUTH_SECRET_PATH` line never reaches a print at all: the unit reader answers any
   quote that is not one whole pair as undecidable (measured: `0.0.0.0'x`, `0.0.0.0"x`, `a'b'c`, `it's` each read rc 2),
   and the refusal names the line, never its value. Three rows pin that; they were green before C5.

   Red first (measured): 18 rows red on main's `ccd/ccrc`, among them an escape sequence in `CCRC_HOST` (alone, and
   beside an exposure file), in the passphrase path in each of its three sentences, in a unit's `EnvironmentFile=`
   value, in a drop-in's name, in what systemd answers for a drop-in, an environment file, `FragmentPath` and
   `SourcePath`, and in the state word; a quote alone in an `EnvironmentFile=` value and in a drop-in's name; a newline
   alone and a space alone in a drop-in's name; and C4's row. The grammar has one mutant per byte class (a space, a
   quote, a control byte let through), each red by its own row.

   A drop-in on disk that systemd also lists as loaded is one source, named once. The de-duplication compared the
   printed words; it now compares the paths, kept in a list of their own. It had no row, and its mutant survived the
   first run; the row "names a drop-in on disk that systemd also loaded once" was added, and the mutant is red on it.
6. **C6: the ways on that led nowhere (both families, the coordinator's ruling).**
   - **The reload arms.** `_auth_unit_own` said "run systemctl --user daemon-reload, then re-run" where systemd gave no
     `NeedDaemonReload` answer and where it named no `FragmentPath`. A reload cannot make a manager print a property
     it leaves out (fix round 2's R3 found it for `SourcePath`). Both now say there is no way on from here and name the
     hand route: "this systemd does not answer NeedDaemonReload, so this verb cannot prove the unit on this box; set
     the keys by hand", and "this systemd names no file it loaded for ccrc.service, and a reload does not make it name
     one, so ...". `NeedDaemonReload=yes` keeps the reload, which cures it.
   - **The port moved after `on`.** `on` writes `CCRC_ORIGIN=http://localhost:<port>` under a marker line naming that
     port. After `CCRC_PORT` changed, `off` read its own origin as foreign and said the box looked armed by hand for
     another address. What `off` refuses is not loosened: it still refuses. Where the only address key it did not
     write is `CCRC_ORIGIN`, holding `http://localhost:<p>`, and the marker line for `<p>` stands in `ccrc.env`, the
     refusal says so, and gives the way on that works: set `CCRC_PORT` back to `<p>`, run `ccrc auth off`, then change
     the port (or remove the lines by hand). The row follows that way on and `off` then acts and proves; the same
     origin without its marker keeps the hand-armed words.
   - **Expose's hint.** On those lines expose said "run ccrc auth off first", which then refused. It now reads
     `CCRC_PORT` (the plain reader its block uses, 7788 when unset, a leading zero read as the same number) and, where
     the origin's port differs, gives `off`'s own way on: the port back, `off`, then the port again. Where they agree
     it says what it said.

### 1.1 Mutants of Part 1

Each mutant replaced one string of `ccd/ccrc` (it must occur once), ran the verb's whole suite through `ccrc test`,
and the file was put back from a saved copy and compared byte for byte. All are red.

| mutant | what it does | red rows |
|---|---|---|
| C1-both | `both` dropped from the role clamp | the `both` row |
| S1-server | `server` dropped from the clamp (C3) | the `server` row |
| C4a | the unreadable file's role read as empty | C4's row |
| C4b | the newline arm removed | C4's row |
| C5a | `_box_said` prints every value | 17 rows: every C5 row |
| C5g-space | a space let through the grammar | the drop-in row with a space |
| C5g-quote | a quote let through | the two quote-alone rows |
| C5g-control | a control byte let through | 12 rows: each escape or newline row |
| C5b | the reach reason prints the host raw | the row beside an exposure file |
| C5c | the bind sentence prints it raw | the bind row |
| C5d | the passphrase path printed raw | its three rows |
| C5e | the unit's `EnvironmentFile=` value raw | its two rows |
| C5f | a drop-in's name on disk raw | its five rows |
| C5h | a loaded drop-in raw | its row |
| C5i | a loaded environment file raw | its row |
| C5j | `FragmentPath` raw | its row |
| C5k | `SourcePath` raw | its row |
| C5l | the state word raw | its row |
| C5m | the drop-in de-duplication removed | the de-duplication row (it survived before that row) |

### 1.2 C6's mutants

The same way, in a scratch worktree (section 4.3), each against its own rows.

| mutant | what it does | red rows |
|---|---|---|
| C6a | the no-`NeedDaemonReload` arm advises the reload again | the reload row's second half |
| C6b | the no-`FragmentPath` arm advises the reload again | the empty and absent `FragmentPath` row |
| C6c | `off`'s port-moved refusal removed | the port-moved row |
| C6d | the marker line not asked (any `http://localhost:<p>` taken as `on`'s) | the port-moved row (its no-marker half) |
| C6e | expose's hint does not compare the ports | expose's wave 193 row |
| C6f | expose reads `CCRC_PORT=07788` as another port than 7788 | expose's wave 193 row (its padded half) |

### 1.3 Evidence

- Red first: the verb's suite had 135 rows at Part 1's end; 21 of them were red on main's `ccd/ccrc` (the 18 of C1 to C5
  that change behaviour, and C6's three), and expose's new row was red there.
- Part 1 alone (its `ccd/ccrc` and its test file, in the scratch worktree): the verb's suite 135 of 135, expose 67 (3
  skipped), doctor core-auth 73 (8 skipped), doctor exposure 195 (4 skipped).
- The settings census (22) and the offered-commands guard (12) pass on Part 1's code.

## 2. Part 2: the Mac

Built on the coordinator's yes (mail 39529) to the step-1 proposal, with its conditions, and the two later rulings
(mail 39576: A3 option 1, B1's one permitted key). Review 3971's ruling B (the Mac refusal) stands wherever the proof
cannot be made; it no longer stands where it can.

### 2.1 The job file (a; A1 to A4)

- **The writer.** `_inst_plist_server <label> <log> [role] [path] [class]`: the two fields that belong to the moment of
  the install are optional arguments, today's `_svc_job_path` and `_launchd_class` when absent. Install's bytes do not
  move: measured, the old and new writer print the same bytes, stdout and stderr, for roles `server`, `both`, `fleet`
  and none, each with no class file, `Interactive`, and an unknown word (12 runs, all equal).
- **The compare** (`_auth_job_cmp`, which `_auth_unit_cmp` calls on darwin, so fits-here asks it too). The verb asks
  the same writer for this home's job with a sentinel in each field and reads the installed job whole: the same number
  of lines, every line byte-equal but the two sentinel lines, and a final newline. Each sentinel line must have the
  exact text around a value of its grammar: `ProcessType` one of `Background`, `Standard`, `Adaptive`, `Interactive`
  (the four literals `_launchd_class` prints, so the field cannot carry a byte of the class file); `PATH` one or more
  `:`-joined entries, each beginning `/`, of printable ASCII (a space allowed: an app bundle's directory) with no `<`,
  `>`, `&`, `"`, `'` or backslash, and no empty entry (a trailing `:` too, which `read -a` would drop). So the field
  cannot open a key, close the string, spell an entity, carry a newline or name a relative directory.
- **Ways on (A1).** A difference (an edit, a re-saved, CRLF or binary plist, a job an older writer wrote, a missing
  final newline, a class outside the four) refuses with `ccrc install --role <the clamped role>`, which re-lands the job
  and boots it in again. A `PATH` outside its grammar is not cured by an install from the same shell, which writes the
  same PATH, so it refuses with "an install puts the PATH of the shell it runs in into the job, so run `ccrc install`
  from a shell whose PATH holds only absolute directories with no <, >, &, quote or backslash in them; or set the keys
  by hand". Neither prints a byte of the job; the field name is all that is named.
- **The home (A2).** The writer puts `$HOME` raw into XML and inside single quotes in the job's shell line, so on a Mac
  `cmd_auth` refuses, right after the operator-only checks and before any read of the box, a home that is not in C5's
  closed form, naming no byte of it; fits-here declines it too. Rows: a quote, an ampersand, a space.
- **A link (A3, option 1).** On a Mac the job file must be a regular file; a link refuses, naming the file, before
  launchd is asked anything (the row asserts no `print` was asked), with the install as the way on (it writes a
  regular file in its place). Linux does not move. **Read, not measured:** on Linux today the compare asks only that
  the installed unit is a readable file (`[ -f ]` and `[ -r ]` follow a link) and `cmp` follows the link, so a link to an
  equal file passes the compare, and only the loaded-file read can refuse it; whether systemd then names the link or its
  target in `FragmentPath` the stub cannot say, so this note claims neither. The coordinator has put "the Linux unit
  file's type is not held" on the verb's follow-up list.
- **The role (A4).** The way on names the role through the same clamp as Linux (`_auth_install_role`, the clamp of wave
  190 moved into one helper that both platforms' ways on call, with C4's unread arm). Rows on the Mac: `server` and
  `both` named, `Server` and `servers` not. A role with a control byte never gets that far on a Mac: the job's reader
  refuses its line as not a plain assignment (B3).

### 2.2 What launchd holds (b; B1, B2)

- **One read**, `launchctl print gui/<uid>/app.ccrc.ccrc`, through `_svc_launchctl` (its guard stands). Its lines of
  one tab are read by name: `path` must be the job file compared; `program` `/bin/bash`; `arguments` exactly the file's
  three (the XML's `&amp;` read as `&`; the replacement is quoted, because bash 5.2's `patsub_replacement` makes an
  unquoted `&` the matched text, which the first build tripped on); the job's own `environment` exactly `PATH` and
  `HOME` holding the file's values, plus, if present, `XPC_SERVICE_NAME` holding the label exactly (the coordinator's
  ruling) and `OSLogRateLimit` holding one to nine digits (fix round 1, ruling 40092). Any other key there refuses,
  named, never its value. The print's other blocks are not read. The four keys and their rules are one table in the
  reader (`_auth_job_env_ok`), whose comment says which were measured on a real launchd, on which hosted image and when.
- **What a real launchd printed** (the first full run, 46033893311, on the hosted image `macos-26-arm64`, 2026-11-27;
  headings and key names only). The job: `arguments`; `inherited environment` (`SSH_AUTH_SOCK`); `default environment`
  (`PATH`); `environment` (`OSLogRateLimit`, `PATH`, `HOME`, `XPC_SERVICE_NAME`); `resource coalition`; `jetsam
  coalition`; `resource limits`. The domain: `security context`; `environment` (`SSH_AUTH_SOCK`); `services`;
  `unmanaged processes`; `endpoints`; `externally-hosted endpoints`; `task-special ports`; `disabled services`.
  `OSLogRateLimit` is the system's logging rate limit, which launchd adds to every job: refusing it would refuse every
  Mac of that system, so the coordinator allowed it by its exact name with a value rule, and the set stays closed. Its
  value was not printed; the second full run prints only its length and whether it is all digits.
- **Why it is needed**: launchd reads a job file at bootstrap only, and `kickstart -k` restarts the definition it
  holds, so an edit of the job file on disk is not what a restart applies. (The env files are re-sourced by the job's
  `bash -c` at every start, so the verb's own edit does apply.)
- **Answers**: launchd's "no such service" (113) refuses with the install as the way on; a failed print, an empty one,
  and one missing the path, the program, the arguments or the environment refuse as not measured, with "this verb
  cannot prove the job on this box without that read; set the keys by hand".
- **The domain** (`_auth_unit_sources`' Mac arm): `launchctl getenv` for each key of `AUTH_SOURCE_KEYS` and for
  `BASH_ENV`, which the job's `bash -c` runs before it sources the env files. A non-zero exit refuses as not measured;
  exit zero with output names the key, never its value; exit zero with nothing is no value there. Measured on the
  hosted Mac (the first full run): `getenv` of an unset key exits 0 with no output, and `getenv` with no key exits 64,
  so a failed read is told apart from an unset key.
- **The inherited and default sections are not read (B2, ruling 40092).** The job's print lists by name what the job
  inherits (`inherited environment`) and launchd's defaults (`default environment`). The reader reads the job's own
  block only. A domain-level setting of a known key is still covered: whatever the domain sets reaches the job through
  launchd's inheritance, and the per-key `getenv` read of the domain refuses any of the verb's keys and `BASH_ENV`
  that the domain sets, before the job is read. A refusing-only read of the inherited list for those keys would be a
  stronger measure (it reads what the job was given, not what the domain says now); it goes on a ticket of its own
  with this measurement, not in this wave.
- **What stays outside (B2), once:** any other variable of the domain (a preload variable, a node option, an exported
  shell function) reaches the job as it reaches the unit on Linux. It is the class the wave-181 note states (anything
  that changes what node runs before the server reads its keys), named here for the Mac: the verb reads only its own
  keys and `BASH_ENV`. On a Mac the job's own `PATH`, which the install writes, is the `PATH` that picks `node`.
- **An empty value.** What the server receives for a key set to an empty value is the empty string, which `config.ts`
  reads with `||` as unset. The Linux arm refuses a key the user manager's environment sets to an empty value (its
  `^KEY=` match takes `KEY=` too). `launchctl getenv` answers an empty value and an unset key the same way (exit 0, no
  output), so the Mac reads both as no value, which is what the server makes of an empty value (ruling 40092, c). The
  job's print does have a section for what it inherits; reading it is the ticket above.

### 2.3 The env files under bash (B3)

On a Mac every key the verb reads goes through the darwin arm of the one reader (`_box_unit_env_shell`), which answers
unmeasured for every key when either readable file is not plain assignments throughout. Rows: the harness logs each key
that arm is asked, and `on` asks all eight (`CCRC_HOST`, `CCRC_PORT`, the four sign-in keys, `CCRC_SESSIONS_PATH`,
`CCRC_AUTH_SECRET_PATH`), `off` the six it uses; for each key the arm answering rc 3 for that key alone refuses, on and
off where both read it, before a write (no change, no kickstart, no leftover). A line that is not a plain assignment
refuses on and off before a write. What the verb's rewrite leaves is plain to that reader, read back after `on` and
after `off`. The lines install, expose and the passphrase verb write (read on the tree, not run): install's `ccrc.env`
seed is two comments, `CCRC_HOST=127.0.0.1`, `CCRC_PORT=7788`, `CCRC_FLEET=local`, `CCRC_PROJECTS_ROOT=$HOME/projects`
and `CCRC_ROLE=<role>`; expose's file is a comment, the origin, the rp id, the flag, the ip arm's mode and address, the
Caddy bind and the DuckDNS provider, domain and token; the passphrase verb writes no env line. Each value is of the
arm's plain characters for a home in A2's closed form (which the verb requires on a Mac anyway) and for a token of
letters, digits and dashes; nothing there is refused by that arm, so neither side changed and nothing was mailed.

### 2.4 The lock (c), the restart (d), BSD tools (e)

- **No new lock**: install refuses a Mac without `flock` ("brew install flock"), so the update lock works there
  unchanged: the same file, the same `flock -n` on one descriptor, the same rc words, Linux untouched. The no-`flock`
  refusal keeps its place, and on darwin its way on is "Install it (brew install flock, as ccrc install asks on a Mac)
  and re-run". The lock-held row runs on the macOS leg with Homebrew's `flock`.
- **The restart** is `launchctl kickstart -k`; a failed one (the job not held at restart time) is a failed restart and
  takes the restore path (row). A job not running has no failed word on a Mac (`_svc_is_active` answers "unanswered"
  rather than guessing), so the failed proof says so there.
- **BSD tools, and what is the macOS leg's alone**: `_plat_mode`'s darwin arm (`stat -f%Mp%Lp`), BSD `cp`, `mv`,
  `chmod` and BWK `awk` on the rewrite, and `/bin/bash` 3.2 sourcing the env files. A simulated darwin on Linux (below)
  runs GNU tools, with a `stat` shim for `_plat_mode`'s one form, so it measures none of these.

### 2.5 Doctor and install (g)

`_auth_fits_here` stops declining on darwin and asks what needs no service manager: the home's form, the role, the job
file present and proved (2.1), the reach read, the port and the address keys, all through the reader of B3, so a file
the verb would refuse there is not offered. It does not ask launchd, as on Linux it does not ask systemd, so where only
launchd can say no (a stale definition, a domain key), doctor and install may name the verb, which then refuses by
name: the wave-181 note's stated class. Rows: in the verb's suite, the darwin helper answers 0 for the installer's job
and 1 for an edited job, a `PATH` entry it does not read, a line that is not plain, a foreign origin and a home with a
space; doctor's two darwin rows (an edited job, a line that is not plain) do not offer the verb; doctor's and install's
wave-181 positive rows now expect the verb on a Mac too (they gave the hand route under ruling B). Those darwin rows run
on the macOS leg only.

### 2.6 The suite on two platforms

The verb's end-to-end describes run on both platforms through `onEach`: on a Mac, darwin with the real BSD tools; on
Linux, linux and a simulated darwin, where `ccrc` is sourced (its dispatch is skipped), `CCD_OS=darwin` and the unit
directory it fixes at load are set after, and `cmd_auth` runs on a pty. The box plants what each platform's installer
lands: the systemd unit and a `systemctl` stub, or the writer's job, launchd's answer for it and a `launchctl` stub. The
describes that read systemd's own answers (the unit's sources, the installer's unit as systemd loaded it, the `cmp` and
user-manager rows, C5's systemd rows) stay Linux only; on a Mac the rows whose Linux reason is one key's shape refuse
at the first key read, with the job reader's words, which those rows assert there. Counts on this box: 284 rows, 269
passed, 15 skipped (the Linux-only rows inside darwin describes).

### 2.7 The real launchd case (f; F1 to F4)

One case bootstraps a real job, on a GitHub-hosted macOS runner only: `GITHUB_ACTIONS=true`, `RUNNER_OS=macOS`,
`RUNNER_ENVIRONMENT=github-hosted` and darwin; a row on every platform proves the gate with each variable missing or
wrong. Before it bootstraps it asks whether `app.ccrc.ccrc` is held already, and stops red touching nothing if so; it
boots out only the job it bootstrapped, by its own file, in a `finally` and an `afterAll`. The guard's allow switch is
set in that case's run only. Its home is temporary and its console a stand-in on loopback at a port it picks, which
answers `/api/auth/status` from its own environment, so the proof reads what launchd's `bash -c` sourced. It prints,
for the coordinator, the section headings and key names (never values) of the job's and the domain's print, and the
exit and output size of `launchctl getenv` for an unset key and with no key. Not run yet: the coordinator starts the
macOS workflow on this branch.

## 3. Unmeasured, in words for the README

The Mac path is measured on a GitHub-hosted macOS runner, through stubs elsewhere: never on a Mac in use. What that
leaves unmeasured: another macOS release, a Homebrew under `/usr/local`, a login session other than a runner's, what a
real operator's `PATH` holds, `launchctl print`'s shape on another release (the reader refuses any shape it does not
know, so a change there refuses, never passes), whether `getenv` tells an empty value from an unset key, and which
`node` the job's `PATH` finds first.

## 4. Mutants of Part 2

### 4.1 The table

Each mutant replaced one string of the scratch worktree's `ccd/ccrc`, ran the verb's suite filtered to the Mac and
helper rows, and the kept copy was put back and its sha256 compared after each (section 4.3). All 32 are red. Three
survived their first run and each got a row: P7 (the empty-entry check: an inner empty entry is also caught by the
absolute-entry check, so only a trailing one, which `read -a` drops, tells them apart), P19 (a failed print accepted:
the row took either "not measured" sentence) and P31 (fits-here's home check: no row had such a home).

| mutant | what it does | red rows |
|---|---|---|
| P1 | the job's fixed lines not compared | the bind in its shell line |
| P2 | the line count not compared | the four role rows, the older writer |
| P3 | the final newline not asked | no newline after its last line |
| P4 | any `ProcessType` word | a class outside the four |
| P5 | `PATH` not held to printable ASCII | a tab, a byte above ASCII |
| P6 | `PATH`'s markup and quotes allowed | a quote, a double quote, a backslash, an entity, a second key |
| P7 | an empty entry allowed | an empty entry at its end |
| P8 | a relative entry allowed | a relative entry; fits-here's `PATH` row |
| P9 | a bad `PATH` gets the install's words | the nine `PATH` rows |
| P10 | a link allowed | the link row |
| P11 | an unreadable job read as empty | the unreadable job |
| P12 | launchd's `path` not compared | from another file |
| P13 | its `program` not compared | another program |
| P14 | its `arguments` not compared | the bind in its arguments |
| P15 | a key of its own ignored | `NODE_OPTIONS`, `XPC_SERVICE_NAME` with another label, a fourth key |
| P16 | `XPC_SERVICE_NAME` with any value | `XPC_SERVICE_NAME` with another label |
| P16b | `XPC_SERVICE_NAME` not permitted | the job launchd also gives `XPC_SERVICE_NAME` |
| P17 | its `PATH` and `HOME` not compared | another `PATH`, another `HOME` |
| P18 | "no such service" read as not measured | the job launchd does not hold |
| P19 | a failed print accepted | a print that fails |
| P20 | a print missing a section accepted | no path line, no environment block |
| P21 | the domain's value ignored | `CCRC_HOST`, `CCRC_ORIGIN`, `BASH_ENV` set there |
| P22 | the domain read's failure ignored | a domain read that does not answer |
| P23 | `BASH_ENV` not asked | `BASH_ENV` set there |
| P24 | the home not held | a quote, an ampersand, a space |
| P25 | the Linux lock words on a Mac | no `flock` on a Mac |
| P26 | the compare not dispatched to the job | 43 rows |
| P27 | the loaded read not dispatched | 18 rows |
| P28 | the domain read not dispatched | 7 rows |
| P29 | the writer ignores its `PATH` argument | 29 rows |
| P30 | `&amp;` unescaped with an unquoted `&` | 11 rows |
| P31 | fits-here's home not held | fits-here's home row |

### 4.2 Red first, and Linux before and after

The Part 2 rows were run against Part 1's `ccd/ccrc` (the Mac refusal still in place), with the final test file: 120
rows red, every one in a darwin describe or the helper's darwin row; every Linux row green there. On the final code,
every row green (269, 15 skipped).

### 4.3 How the mutants ran (the coordinator's five terms)

In a scratch detached worktree of this branch's tip in the temp root, holding copies of this wave's `ccd/ccrc` and test
file and a link to the branch's `server/node_modules`, so the branch's own tree never held a mutant. The script (the
temp root's `run2.py`, written with the file tool) kept a copy of the file and its sha256, put the copy back after each
mutant and on any exit (an `atexit` hook and SIGINT and SIGTERM handlers), compared the sha256 each time and would stop
loudly on a mismatch; none happened. One run at a time through `ccrc test --local`, in the foreground, and nothing else
moved while it ran. After the runs the branch's `ccd/ccrc` and the scratch copy compare equal (`cmp`), and the branch's
diff is the uncommitted work as it stood. Part 1's first 19 mutants ran before the terms, in place, under the same
restore-and-compare; the coordinator ruled that they stand (mail 39574).

### 4.4 On current main

Main moved after this wave's base (`f80f47760b`). Up to `183010ed67` it touched none of this wave's files and the merge
probe answered clean, so the suites ran in the scratch worktree on this branch's tip merged with main there, never on
the branch itself:

- The verb's suite on both platforms (284 rows, 269 passed, 15 skipped), expose (70, 3 skipped), doctor core-auth (83,
  10 skipped), doctor exposure (199, 4 skipped), install landing (43, 1 skipped), the platform suite (145, 11 skipped),
  the settings census (22) and the offered-commands guard (12): 8 files, 814 passed, 44 skipped, none failed.
- Every other server test that names `ccd/ccrc` in its text and reads a file (the fast run leaves that class to the
  queue), 127 files, run on the fleet test box in pieces (its one-hour bound ended the first run after 72 files), the
  last 22 one file at a time. 122 passed. Four failed, each with the same tests on a clean checkout of main at
  `183010ed67`, so they are this test box's and not this wave's: `session-hook` (2, the pane-ownership cases),
  `ccrc-models-advance` (6, the stalled-read cases), `ccrc-codex` (2, `_codex_pid_listens`) and `ccd-tmux-anchor`
  (19). One is unmeasured here: `shellcheck-ratchet` cannot parse `ccd/ccrc` within the test slice's memory cap
  (6G), on main's file as on this wave's, so the pull request's own run of it is the measurement.

### 4.5 After #3478 landed

#3478 changed `ccd/ccrc` on main (`197665f6a0`), the probe then answered a conflict, and this branch absorbed main once
(section 5). On the branch itself, after the absorption and the artifact-tier case's change:

- The eight suites of section 4.4, #3478's three (the artifact tier's expose and doctor suites and its config suite),
  `growth-check`, `deviation-refs` and `anchors`: all passed, the artifact tier's expose suite after its case's change
  (23 of 23; red on its Mac expectation before it).
- The 126 text readers of section 4.4 less `shellcheck-ratchet`, on the fleet test box in four runs: 122 passed, and
  the same four failed with the same tests as on main (`session-hook` 2, `ccrc-models-advance` 6, `ccrc-codex` 2,
  `ccd-tmux-anchor` 19). `shellcheck-ratchet` is still unmeasured here (section 4.4).

### 4.6 Fix round 1: what the first two runs on `05a0859f6b` found

Two reds were this wave's, and both are fixed in one round on the coordinator's word (mail 40018).

- **The shellcheck ratchet** (the PR's fast run, `server 12/12`): `ccd/ccrc: 86 findings, pinned at 62`, SC2178,
  SC2128, SC2190, SC2209 and SC2155. Shellcheck types a variable name across the whole file, and this wave's new
  arrays reused names that are strings elsewhere in `ccd/ccrc` (`seen`, `want`). They and the other new arrays now have
  names used nowhere else in the file (`aus_seen`, `ajc_want`, `ajc_have`, `ajc_parts`, `ajl_args`). Checked by search
  before the push: no old name (`seen`, `want`, `have`, `parts`, `args`) is left in the changed functions
  (`_auth_unit_sources`, `_auth_job_cmp`, `_auth_job_loaded`) but the launchd reader's section word `'args'`, a string,
  while the old names still stand elsewhere in the file as strings; each new name appears only in those three
  functions; and a word-level read of the round's diff shows only the renamed tokens, the quoted section words, the
  split `local` and the length test. That read was needed: the first suite pass of the round was red because two
  file-tool edits had each lost the space at the end of the matched text (`in $BRE_HOSTSRC`, and the `=` of the
  launchd arguments' comparison), found by the suites and put back. The launchd reader's section words are quoted (`sect='env'` read
  as a command name), and the bind sentence's `local` is declared apart from its assignment. The pin is not raised and
  no finding is silenced. The ratchet is measured on CI only: on this box `shellcheck` cannot parse `ccd/ccrc` within
  the test slice's memory cap (6G), on main's file as on this one. Nothing behaves differently, and no code line is added
  or removed (the bound fix below adds one comment line). The growth is 131 code lines, re-measured on the round's
  final tree: 122 before the round, and 9 for `_auth_job_env_ok`, the launchd key table (below).
- **The regex bound** (the full run, `macos / test-macos 8/8`, `ccrc-doctor-exposure`: `CCRC_HOST=127.0.0.0` printed
  as `[a value this verb does not print]`): `_box_said`'s pattern was `^[...]{1,1024}$`. macOS's regex library caps a
  counted bound at RE_DUP_MAX, 255 (glibc allows 32767), so on a real Mac it matched nothing and every value was held
  back. The length is now tested apart from the bytes (`${#v} -le 1024`, then `^[...]+$`). A search of every pattern in
  `ccd/ccrc` (bash matches, grep, sed, awk, jq and any other) for an interval bound over 255 finds only that one, on this
  branch's tip, and none on main. The new describe holds it: a text guard, no interval bound over 255 anywhere in
  `ccd/ccrc`, red on the mutant back to `{1,1024}`; and the length edges (1, 255, 256 and 1024 bytes whole; 1025, empty,
  a space and an escape held), red on the mutant without the length test. Both mutants were run in the scratch
  worktree, and the copy put back and compared.
- **What that bug would have broken on a real Mac, by condition.** It failed closed: no unsafe byte was ever printed,
  but every value was held back and every home failed the form. A2's home check (`cmd_auth`, and the fits-here
  helper's g) asks `_box_said "$HOME"`, so on a real Mac the verb would have refused on every box, `on` and `off`,
  before any proof. So nothing behind that check was reachable there: A1 (the PATH's remedy), A3 (the link), A4 (the
  clamped role), B1 (launchd's job environment), B2 (the domain's environment) and B3 (the plain read-back). Doctor and
  install would never have offered the verb on a Mac either (g). Every refusal sentence that names a file value
  would have shown the held word in its place (C5's prints, and doctor's reach reasons, which is what the shard showed).
  The simulated darwin on Linux uses glibc's regex and could never see it. Only the hosted macOS leg measures it, so
  the second full run with the macOS legs is required before the wave-done, not optional.
- **What else the first full run showed** (46033893311, on `05a0859f6b`; nothing re-run). The real launchd case ran,
  printed (section 2.2) and failed at `on` on the bound. The macOS reds of this wave all show the bound: the verb's
  suite (121), doctor exposure (8), doctor's fleet-box suite (3, the regex error on stderr), doctor's artifacts suite,
  expose, the artifact tier's expose suite and install-tree (1 each), and the "wave 181" rows of doctor core-auth and
  install landing (the fits-here helper's home check fails silently there). Nine rows of the verb's suite asserted
  only an exit code or waited out the proof, so this run cannot show that the bound is their cause; the second run's
  result is read for each:
  - `ccrc auth on: the write, the restart and the proof [darwin]`: "is idempotent", and "the four lines mean, to the
    SERVER, what the verb says they mean";
  - `ccrc auth off [darwin]`: "removes exactly what on wrote";
  - `ccrc auth on a Mac: the job proved (wave 193) [darwin]`: "leaves ccrc.env plain to the Mac's reader after on and
    after off";
  - `ccrc auth: a signal in the proof window (review 3934 F3) [darwin]`: the SIGINT, SIGTERM and SIGHUP rows, "a
    signal after the copy is made and before the write", and "a signal as the proven run removes its copy".
- **macOS reds that are not this wave's**, each red on a daily run of main with the macOS legs (45933630761 on
  `3fda0fc9b1`, 2026-11-27, unless named): `testbox-admin-user-writes` (18), `testbox-admin-key-rotate` (17),
  `ccd-launch-profile` (14), `ccd-route-holddown` (13), `ccd-fresh-pick` (8), `overlord-read` (8),
  `overlord-read-context` (6), `history-quiz-unattended` (2), one row each of `ccd-docs-folder`,
  `ccd-docs-folder-read`, `ccd-hibernate-roll`, `ccd-inflight`, `ccd-route-model-id`, `ccd-tick-budget`,
  `ccrc-doctor-quiz`, `inflight-manifest`, `overlord-read-scope`, `session-hook-precompact-refuse`,
  `testbox-admin-connect-retry`, and of doctor core-auth and install landing; `ccd-route-degrade` and
  `ccd-skill-ensure` red on 45748314113 (2026-11-26). Three are red on neither daily and in no file of this wave:
  two rows of `ccrc-api` (an out-of-range code point), one of `delivery-drive` (a key the Mac adds to an empty
  environment) and one timing row of `session-hook`. Shard 7 was cancelled at the job's 55-minute limit after 28 files,
  as a shard of main's daily of 2026-11-27 was.
- **`OSLogRateLimit` (ruling 40092).** B1's table gains the key by its exact name with a value of one to nine digits.
  The simulated darwin's launchd answer is now the block the real launchd drew (`OSLogRateLimit`, `PATH`, `HOME`,
  `XPC_SERVICE_NAME`), so every darwin row reads that block, and one row says it is accepted. Refused, on and off,
  naming the key: a value that is a word, empty, ten digits or holds a space, and the names `oslogratelimit`,
  `XOSLogRateLimit` and `OSLogRateLimitX`. Three mutants, run in the scratch worktree and the copy put back and
  compared: the table without its fourth row (the measured-block row red, with four more of the Mac describe), the
  key with any value (the four value rows red), and the name matched in any case with a prefix or suffix (the three
  name rows red).
  The real case prints the value's length and whether it is all digits, never the value; a value outside the rule
  there goes to the coordinator, and the rule is not widened here.

### 4.7 Fix round 2: what the runs on `8871ace2a3` found

The PR's fast run (46053756796) was green. The second full run (46053868645, the coordinator's, macOS on) was green on
every Linux leg and red on all eight macOS shards, none cancelled; nothing was re-run.

- **The real launchd case passed** ("on, then off, through launchd", shard 1). The job's own environment block held the
  same four keys as the first run, `OSLogRateLimit`, `PATH`, `HOME` and `XPC_SERVICE_NAME`, and no fifth; the
  `OSLogRateLimit` value was 2 bytes, all digits, inside the rule. The other sections and the two `getenv` answers were
  as in section 2.2.
- **The nine rows of section 4.6:** seven passed (`is idempotent`, `the four lines mean, to the SERVER, ...`, `removes
  exactly what on wrote`, `leaves ccrc.env plain to the Mac's reader ...`, and the SIGINT, SIGTERM and SIGHUP rows). Two
  were red: "a signal after the copy is made and before the write" and "a signal as the proven run removes its copy".
- **Four rows were this wave's, both causes in fixtures.**
  - The two signal rows and "a failed proof whose copy cannot be moved back, with the re-proof passing" plant `cp`, `mv`
    and `rm` stubs that passed through to `/usr/bin/<tool>`, where a Mac has none of the three
    (`/usr/bin/mv: No such file or directory`). The stub lines came from main; they ran on Linux only until this wave
    let the verb act on a Mac. Every stub of the file now reaches its tool through one lookup, `realTool` (`command -v`,
    as the file's other stubs did), in six places: the three that failed, the two `rm` stubs whose cases pass without
    reaching it, and the restart stub's `mv`, which a Mac has at `/bin`. A new case reads the file as text and finds no
    stub that runs a fixed `/bin`, `/usr/bin`, `/sbin` or `/usr/sbin` path with an argument (a shell aside), and a second
    case shows the reader catches the three shapes that went red.
  - Doctor core-auth's "on a loopback-only server box the dark remedy is ccrc auth on" gave the hand route on the Mac.
    Doctor runs under the fixture's contained PATH, and on a Mac the job compare asks the installer's writer,
    `_inst_plist_server`, for the bytes it expects; the writer prints them through `cat`, which that PATH lacks, so the
    compare answered not measured and the verb was not offered (reproduced here on a scratch home with only the stub
    directory on PATH: not measured without `cat`, the verb offered with it). The fixture now stubs `cat` beside its
    `cmp` stub, for the same reason. **A known behaviour, not a defect:** on a box whose PATH lacks `cat`, doctor (and
    install's gate line) cannot print the job the installer writes, so it does not offer the verb and gives the hand
    route; not measured is the safe answer there.
- **Mutants**, in the scratch worktree, the copy put back and compared: `realTool` answering a path that does not exist
  (the Mac's shape for `/usr/bin/<tool>`) reds five rows under both platforms of the suite (ten results): the three the
  Mac showed, and the two whose stubs reach the tool only there, "a failed proof whose removal of the file this run
  created fails, with the re-proof passing" (an `rm` stub) and "puts the file back when the restarted console does not
  prove sign-in on (down)" (the restart stub's `mv`); one stub put back to `exec /usr/bin/mv` reds the text guard,
  naming its line. The `cat` stub's row runs on a Mac only (the fixture
  plants the job there alone); its evidence here is the scratch trace above, and the third full run measures it.
- **The shell ratchet** on the fast run: `ccd/ccrc: 59 findings, pinned at 62` (SC2034 12, where the pin held 15; every
  other code at its pin). The ratchet asks for the entry to come down, and `server/test/shellcheck-baseline.json` was
  unclaimed and is not one of the four gate-code files, so its `ccd/ccrc` entry is now 59, the ratchet's own line.
- **macOS reds that are not this wave's** (coordinator ruling 40277: listed, not chased). Runs: R1 the first full run
  (46033893311, on `05a0859f6b`; its shard 7 was cancelled), R2 the second (46053868645, on `8871ace2a3`), D1 main's
  daily (45933630761, on `3fda0fc9b1`, 2026-11-27), D2 main's daily of 2026-11-26 (45748314113). The reason for every row
  is the same: no file of this wave is named by it, and none of it calls a helper this wave changed.

| File | Rows red in R2 | Runs that showed it red | Not this wave's |
|---|---|---|---|
| `testbox-admin-acts` | 28 | R2, D1 | no file of this wave; its verb sources `ccd/ccrc` but calls none of this wave's helpers |
| `testbox-admin-user-writes` | 18 | R1, R2, D1 | no file of this wave |
| `testbox-admin-key-rotate` | 17 | R1 (16), R2, D1 | no file of this wave |
| `ccd-launch-profile` | 14 | R1, R2, D1 | no file of this wave |
| `ccd-route-holddown` | 13 | R1, R2, D1 | no file of this wave |
| `ccd-fresh-pick` | 8 | R1, R2, D1 | no file of this wave |
| `overlord-read` | 8 | R1, R2, D1 | no file of this wave |
| `overlord-read-context` | 6 | R1, R2, D1 | no file of this wave |
| `history-quiz-unattended` | 2 | R1, R2, D1 | no file of this wave |
| `ccrc-api` | 2 | R1, R2 | no file of this wave (a code point past U+10FFFF) |
| `typecheck-tests` | 2 | R2 | no file of this wave (the pwa typecheck ran out of heap) |
| `ccrc-doctor-core-auth` | 1 | R1, R2, D1 | "a CCRC_HOST the unit reader cannot decide": the Mac's bash reader makes that line not measured, with or without this wave |
| `ccrc-install-landing` | 1 | R1, R2, D1 | the same row, at install's gate line |
| `ccd-route-degrade` | 1 | R1, R2, D2 | no file of this wave |
| `ccd-skill-ensure` | 1 | R1, R2, D2 | no file of this wave |
| `delivery-drive` | 1 | R1, R2 | no file of this wave (a key the Mac adds to an empty environment) |
| `models-probe` | 1 | R2, D1 | no file of this wave |
| `testbox-admin-connect-retry` | 1 | R2, D1 | no file of this wave |
| `ccd-docs-folder`, `ccd-docs-folder-read`, `ccd-hibernate-roll`, `ccd-inflight`, `ccd-route-model-id`, `ccd-tick-budget`, `ccrc-doctor-quiz`, `inflight-manifest`, `overlord-read-scope`, `session-hook-precompact-refuse` | 1 each | R1, R2, D1 | no file of this wave |

  A correction to the mail of the second run: `testbox-admin-acts`, `models-probe` and `testbox-admin-connect-retry` were
  called first measured on a Mac there. They are red on D1 too, the same rows; R1 never reached them, because its shard 7
  was cancelled.

## 5. Notes

- `ccd/ccrc` is held by claim 7531 for #3478. Its holder said yes (mail 39670) to this exact change of the file
  committed here beside that PR (the diff against `87f8aa1449`, sha256 `922349bb…829fc78`). A three-way merge with
  #3478's head `de407ecae1` has one conflict, in `cmd_expose`, where both add a comment line above the same `local`
  line; the agreed resolution keeps both comments and declares `local auth_said="" a_rp a_origin a_port`, and keeps
  #3478's guard that holds back the `auth off` hint when an artifact key is among those found. Whichever lands second
  resolves it that way, and mails the other first if it would resolve it any other way. #3478 landed first
  (`197665f6a0`); this branch's probe then answered a conflict, so it absorbed main once by `git merge`, resolving that
  hunk exactly so (the resolved file's sha256 equals the one the holder agreed, `d23cdfaf…`).
- The holder's test note: #3478's artifact-tier case that asks `ccrc auth` on a forced Darwin expected the old Mac
  refusal (`this verb does not act on a Mac yet`). Measured on the merge, the case now gets the reach refusal on a Mac
  too (`this box is reached from elsewhere`), because the verb asks the reach before it reads the job file or launchd;
  the planted file is never compared and `launchctl` is asked nothing. So the reach refusal there needs no job the
  proof accepts. This branch changes that case's Darwin expectation to the reach refusal (red on the merge before the
  change, as measured), under claim 7602, so the case now shows the Mac reach check is reached.
- Growth: `ccd/ccrc` grows by 131 code lines against the merge-base (26 of them Part 1's, 9 fix round 1's key table),
  past the per-PR limit of 40, under D-9158's waiver (`server/test/growth-waivers/D-9158-ccd-ccrc.json`, its limit
  the measured 131). The nine are the cost of the coordinator's ruling on the fourth key (mail 40092), not growth of
  this wave's own: the table's function, `_auth_job_env_ok`, eight lines, and the one line of the environment loop that
  calls it. The table's comment counts no line. The coordinator accepted 131 as the waiver's figure in mail 40130.
  Fix round 2 changes no line of `ccd/ccrc`.

- One shell call of this wave was refused by the session hook: a Python heredoc rewriting two blocks of this wave's own
  test file, whose text named fixture passphrase file names; no file that guard protects was its target. It was
  reported word for word (mail 39527) and the edit made with the file edit tool, the coordinator's ruling (mail 39535).
- In fix round 1 the session hook refused a second shell call, a read-only check of this round's own diff whose
  pattern named the launchd reader's section word for the environment block as a bare word, as "printing the whole
  environment"; nothing was printed, it was reported word for word (mail 40034), and the act was stopped and not made
  another way.
- `ccrc-install-landing`'s "ends with doctor, and a fresh box ends green" is red on this box on main's code too
  (measured): its doctor reads this box's own processes, and a browser MCP server here makes it WARN. On the fleet test
  box, where `ccrc test` ran it for section 4.4, it is green.

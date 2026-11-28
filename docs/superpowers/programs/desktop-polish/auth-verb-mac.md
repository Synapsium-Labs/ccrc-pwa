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
   | the refusal while a restore copy stands beside `ccrc.env` | the copy's name after `ccrc.env.auth-restore.`, read from the directory | `_box_said` on that suffix (fix round 3, ruling 4c: older than the wave, and C5 says every file value) |
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
  of lines, every line byte-equal but the two sentinel lines, a final newline, and no NUL byte anywhere (the read stops
  at a NUL, so one found is a difference: fix round 3, ruling 4b; before it the installer's bytes, a NUL and anything
  after compared equal). Each sentinel line must have the
  exact text around a value of its grammar: `ProcessType` one of `Background`, `Standard`, `Adaptive`, `Interactive`
  (the four literals `_launchd_class` prints, so the field cannot carry a byte of the class file); `PATH` one or more
  `:`-joined entries, each beginning `/`, of printable ASCII (a space allowed: an app bundle's directory) with no `<`,
  `>`, `&`, `"`, `'` or backslash, and no empty entry (a trailing `:` too, which `read -a` would drop). So the field
  cannot open a key, close the string, spell an entity, carry a newline or name a relative directory.
- **Ways on (A1).** A difference (an edit, a re-saved, CRLF or binary plist, a job an older writer wrote, a missing
  final newline, a class outside the four) refuses with `ccrc install --role <the clamped role>`, which re-lands the job
  and boots it in again. A `PATH` outside its grammar is not cured by an install from the same shell, which writes the
  same PATH, so it refuses with "an install puts the PATH of the shell it runs in into the job, so run `ccrc install`
  from a shell whose PATH holds only absolute directories, in printable ASCII only, with no <, >, &, quote or backslash
  in them; or set the keys
  by hand". Neither prints a byte of the job; the field name is all that is named.
- **The home (A2).** The writer puts `$HOME` raw into XML and inside single quotes in the job's shell line, so on a Mac
  `cmd_auth` refuses, right after the operator-only checks and before any read of the box, a home that is not in C5's
  closed form, naming no byte of it; fits-here declines it too. Rows: a quote, an ampersand, a space.
- **A link (A3, option 1).** On a Mac the job file must be a regular file; a link refuses, naming the file, before
  launchd is asked what it holds (the row asserts no `print` was asked; the domain's per-key `getenv` reads of 2.2 run
  before it), with the install as the way on (it writes a regular file in its place). A link whose target is gone fails
  the earlier check that the job is installed (`[ -f ]` follows the link), so it is told the job is not installed, not
  that it is a link. Linux does not move. **Read, not measured:** on Linux today the compare asks only that
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
  ruling) and `OSLogRateLimit` holding one to nine digits (fix round 1, ruling 40092). Each key is matched by its whole
  name; any other key there refuses, named, never its value (fix round 3, F1: `NODE_PATH`, `DYLD_LIBRARY_PATH`,
  `PYTHONPATH`, `PATHX`, `HOMEX` and `HOMEBREW_PREFIX` beside a valid `PATH` and `HOME` each refuse, a row each). The
  print's other blocks are not read. The four keys and their rules are one table in the reader (`_auth_job_env_ok`),
  whose comment says which were measured on a real launchd, on which hosted image and when.
- **A shape the reader does not know, where it reads (fix round 3, ruling 4a).** These refuse as not measured, naming
  no value, with the hand route:
  - inside the job's own environment block, a line that is not a key (letters, digits and `_`, not starting with a
    digit), ` => ` and a value;
  - inside it too, a second line for any one key (fix round 4, review 4180 F1, ruled for the class in mail 40891): a
    dictionary holds a key once, so a second line can only come from a held value's newline, and before the round the
    last line won and only it was compared. It refuses before anything is taken from the second line, naming the key
    through the key grammar and no value, for `PATH`, `HOME`, `XPC_SERVICE_NAME`, `OSLogRateLimit` and any key alike;
  - a second environment block or arguments block;
  - a second `path` or `program` line;
  - a line of two tabs, or a block's closing line, outside any block, which is what a value holding a newline and a
    closing line leaves;
  - a block still open at the end of the print.

  The job's top-level lines the reader does not use are passed over by name, as before, and so is every line inside
  another block. So the scope is the job's own environment block and the lines the reader takes once; what a print
  holds inside another block (the inherited and default environments among them) is not read, and a value that opened
  a block of another name at the top level after a closing line would be passed over as that block. Before the round,
  a value holding a newline, a closing line and a key after it, a doubled block, a restated path or program, a
  truncated print, a line with no arrow and a line with no key were each read as the job ccrc installs (each a row,
  red on the tip before the round). Whether a real `launchctl print` escapes control bytes in a value is unmeasured;
  that premise, the passed-over block and a stray line inside the arguments block (which the reader passes over, with
  no effect today) are issue #3654.
- **What a real launchd printed** (the first full run, 46033893311, on the hosted image `macos-26-arm64`, 2026-11-27;
  headings and key names only). The four keys printed the same on both builds of that image the four full runs drew:
  20261123.0526.1 (runs 1 and 3) and 20261117.0516.1 (runs 2 and 4). The job: `arguments`; `inherited environment` (`SSH_AUTH_SOCK`); `default environment`
  (`PATH`); `environment` (`OSLogRateLimit`, `PATH`, `HOME`, `XPC_SERVICE_NAME`); `resource coalition`; `jetsam
  coalition`; `resource limits`. The domain: `security context`; `environment` (`SSH_AUTH_SOCK`); `services`;
  `unmanaged processes`; `endpoints`; `externally-hosted endpoints`; `task-special ports`; `disabled services`.
  `OSLogRateLimit` is the system's logging rate limit, which launchd adds to every job: refusing it would refuse every
  Mac of that system, so the coordinator allowed it by its exact name with a value rule, and the set stays closed,
  every key by its whole name. Its
  value was not printed; the second full run prints only its length and whether it is all digits.
- **Why it is needed**: launchd reads a job file at bootstrap only, and `kickstart -k` restarts the definition it
  holds, so an edit of the job file on disk is not what a restart applies. (The env files are re-sourced by the job's
  `bash -c` at every start, so the verb's own edit does apply.)
- **Answers**: launchd's "no such service" (113) refuses with the install as the way on; a failed print, an empty one,
  one missing the path, the program, the arguments or the environment, and one of a shape the reader does not know
  (above) refuse as not measured, with "this verb cannot prove the job on this box without that read; set the keys by
  hand".
- **The domain** (`_auth_unit_sources`' Mac arm): the caller's launchd domain, that is, the domain of the shell the verb
  runs in, through `launchctl getenv` for each key of `AUTH_SOURCE_KEYS` and for
  `BASH_ENV`, which the job's `bash -c` runs before it sources the env files. A non-zero exit refuses as not measured;
  exit zero with output names the key, never its value; exit zero with nothing is no value there. Measured on the
  hosted Mac (the first full run): `getenv` of an unset key exits 0 with no output, and `getenv` with no key exits 64,
  so a failed read is told apart from an unset key.
- **The inherited and default sections are not read (B2, ruling 40092).** The job's print lists by name what the job
  inherits (`inherited environment`) and launchd's defaults (`default environment`). The reader reads the job's own
  block only. A setting of a known key in the caller's launchd domain is covered: the per-key `getenv` read refuses any
  of the verb's keys and `BASH_ENV` that it sets, before the job is read. The read answers for the caller's domain,
  while the job print and the restart name the desktop's domain (`gui/<uid>`), so from a login session other than the
  desktop's (an SSH login, say) a value set in the desktop's domain may read as unset (review 4154 R2, ruling 3). Nobody
  has measured which domain answers there, nor that the job's inherited block shows such a value. The one dangerous key
  is `CCRC_HOST`, on `off`: the others fail shut. Both stronger measures, a read pinned to the desktop's domain and a
  refusing-only read of the job's inherited list, go on issue #3654 (the ticket `auth-verb-mac-inherited-section`)
  with this scenario, not in this wave (ruling 3).
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

Fix round 3 (ruling 2): the wave-181 rows "where ccrc auth refuses ... a CCRC_HOST the unit reader cannot decide" in
doctor core-auth and install landing were red on the Mac in all three full runs and on main's daily. The cause, found
before any edit: on a Mac the fixture's `CCRC_HOST ="127.0.0.1"` is a command to the bash that sources ccrc.env, so the
darwin reader decides no key of the file, `CCRC_AUTH` included, and doctor and install say "line 2 [install: line 1] is
not a plain NAME=value line, and on macOS the launchd job sources both env files with bash, so that line can change what
they set, so whether ... was not measured". The rows expected Linux's answer (systemd decides `CCRC_AUTH`, so the hand
route). The Mac's sentence is the true answer for that file there, so the verb's side is right and `ccd/ccrc` does not
change for it. On darwin each row now asserts that line, and on every platform that the verb is not offered; Linux
asserts what it did. Doctor's two planted darwin rows also assert the line doctor gives (the review's nit): the hand
route for an edited job, and the not-measured line (line 4) for a line that is not plain. So that a Linux run goes red
where a Mac would, each file has a simulated darwin twin. Doctor's runs `_check_auth` alone with `ccrc` and the check
table sourced, then `CCD_OS=darwin` and both unit directories set where a Mac keeps them. Install's cuts the gate line's
block out of `cmd_install` by its first and last lines and runs it the same way. Each twin has a control: a loopback-only
box is offered `ccrc auth on` there.

### 2.6 The suite on two platforms

The verb's end-to-end describes run on both platforms through `onEach`: on a Mac, darwin with the real BSD tools; on
Linux, linux and a simulated darwin, where `ccrc` is sourced (its dispatch is skipped), `CCD_OS=darwin` and the unit
directory it fixes at load are set after, and `cmd_auth` runs on a pty. The box plants what each platform's installer
lands: the systemd unit and a `systemctl` stub, or the writer's job, launchd's answer for it and a `launchctl` stub. The
describes that read systemd's own answers (the unit's sources, the installer's unit as systemd loaded it, the `cmp` and
user-manager rows, C5's systemd rows) stay Linux only; on a Mac the rows whose Linux reason is one key's shape refuse
at the first key read, with the job reader's words, which those rows assert there. Counts on this box at fix round 3:
315 rows, 300 passed, 15 skipped (the Linux-only rows inside darwin describes).

### 2.7 The real launchd case (f; F1 to F4)

One case bootstraps a real job, on a GitHub-hosted macOS runner only: `GITHUB_ACTIONS=true`, `RUNNER_OS=macOS`,
`RUNNER_ENVIRONMENT=github-hosted` and darwin; a row on every platform proves the gate with each variable missing or
wrong. Before it bootstraps it asks whether `app.ccrc.ccrc` is held already, and stops red touching nothing if so; it
boots out only the job it bootstrapped, by its own file, in a `finally` and an `afterAll`. The guard's allow switch is
set in that case's run only. Its home is temporary and its console a stand-in on loopback at a port it picks, which
answers `/api/auth/status` from its own environment, so the proof reads what launchd's `bash -c` sourced. It prints,
for the coordinator, the section headings and key names (never values) of the job's and the domain's print, and the
exit and output size of `launchctl getenv` for an unset key and with no key. It ran in each full run with the macOS legs
(sections 4.6 and 4.7).

## 3. Unmeasured, in words for the README

The Mac path is measured on a GitHub-hosted macOS runner, through stubs elsewhere: never on a Mac in use. What that
leaves unmeasured: another macOS release, a Homebrew under `/usr/local`, a login session other than a runner's (the
domain read answers for the caller's launchd domain, section 2.2), what a real operator's `PATH` holds, `launchctl
print`'s shape on another release (inside the job's own environment block, and for the lines it takes once, the reader
refuses a shape it does not know as not measured, so a change there refuses; lines it does not use, and other blocks,
it passes over, section 2.2), whether `getenv` tells an empty value from an unset key, and which `node` the job's `PATH`
finds first. The reader's limits (the caller's domain, the inherited and default sections, the unmeasured escaping of a
value, and the arguments block) are issue #3654.

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
| `ccrc-doctor-core-auth` | 1 | R1, R2, D1 | "a CCRC_HOST the unit reader cannot decide": the Mac's bash reader makes that line not measured, with or without this wave; fixed here in fix round 3 on the coordinator's ruling 2 (section 2.5) |
| `ccrc-install-landing` | 1 | R1, R2, D1 | the same row, at install's gate line; fixed here in fix round 3 as well |
| `ccd-route-degrade` | 1 | R1, R2, D2 | no file of this wave |
| `ccd-skill-ensure` | 1 | R1, R2, D2 | no file of this wave |
| `delivery-drive` | 1 | R1, R2 | no file of this wave (a key the Mac adds to an empty environment) |
| `models-probe` | 1 | R2, D1 | no file of this wave |
| `testbox-admin-connect-retry` | 1 | R2, D1 | no file of this wave |
| `ccd-docs-folder`, `ccd-docs-folder-read`, `ccd-hibernate-roll`, `ccd-inflight`, `ccd-route-model-id`, `ccd-tick-budget`, `ccrc-doctor-quiz`, `inflight-manifest`, `overlord-read-scope`, `session-hook-precompact-refuse` | 1 each | R1, R2, D1 | no file of this wave |

  A correction to the mail of the second run: `testbox-admin-acts`, `models-probe` and `testbox-admin-connect-retry` were
  called first measured on a Mac there. They are red on D1 too, the same rows; R1 never reached them, because its shard 7
  was cancelled.

### 4.8 Fix round 3: review 4154 of `26bfa9a9ac`

The review found nothing in the shipped behaviour to keep from main and one missing row (F1); the coordinator ruled its
four questions (mail 40529). What the round holds:

- **F1, the key table's exact names.** One table-driven row: `NODE_PATH`, `DYLD_LIBRARY_PATH`, `PYTHONPATH`, `PATHX`,
  `HOMEX` and `HOMEBREW_PREFIX`, each beside a valid `PATH` and `HOME`, refuse on and off, the key named, no value
  printed. The code did not change: the tip refused them all, and nothing proved it.
- **Ruling 1** is one line in D-9158: a `PATH` that fails its grammar is offered an install from a shell whose `PATH`
  holds none, or the hand route, because an install from the same shell writes the same field again.
- **Ruling 2**, the two "cannot decide" rows: section 2.5. The cause was the fixture, not the verb.
- **Ruling 3**, the caller's domain: sections 2.2 and 3 and the README's limits; the stronger reads go on the ticket
  `auth-verb-mac-inherited-section`, now issue #3654.
- **4a, the print reader** (section 2.2): the shapes it now refuses as not measured, with the scope stated. One shape
  more than the ruling listed: an environment line with no key before its arrow. An empty key named nothing the table
  could refuse by name, so on the tip such a job passed.
- **4b, the NUL** (section 2.1). **4c, the copy's name** (the print-site table of section 1).
- **4d, the guards.** The stub guard also takes a flag before the argument (`exec /usr/bin/rm -f "$@"`, `exec /bin/cp -p
  -- "$@"`); the bound guard also takes the open-ended form (`{,300}`). Each guard's reader case carries those near
  misses and a passing control.
- **4e, comments and words.** `_auth_fits_here`'s and `_auth_unit_sources`' comments no longer say the Mac path is dead;
  `cmd_auth`'s order list names the Mac's home check, its job-file proof and its restart; the note's link order, the
  dangling link, D-9158's lock words and state word, and "one to nine digits" for `OSLogRateLimit` are corrected.

**Red first**, measured with the new test file against the tip's `ccd/ccrc` in a scratch worktree: eight rows red.
They were the trailing NUL, the five shapes 4a lists first, and the held copy name on both platforms. The empty key,
the second program line and the second arguments block were added after that run; each is held by its mutant below.
F1's rows pass on the tip, as they should, and are held by the two mutants.

**Mutants**, in a scratch detached worktree under the coordinator's five terms (section 4.3; the runner is the temp
root's `run3.py`, a copy of `run2.py` aimed at this round's scratch tree), the restore compared by sha256 after each one,
every one killed:

| id | mutant | red on |
|---|---|---|
| O1 | `PATH` matched by suffix (`*PATH\|HOME`) | `NODE_PATH`, `DYLD_LIBRARY_PATH`, `PYTHONPATH` beside a valid `PATH` and `HOME` |
| O2 | `PATH` and `HOME` matched by prefix | `PATHX`, `HOMEX`, `HOMEBREW_PREFIX` beside a valid `PATH` and `HOME` |
| R4a-1 | the line outside a block passed over | a value holding a newline, a closing line and a key after it |
| R4a-2 | a second path line taken | a second path line, after one naming another file |
| R4a-3 | a second program line taken | a second program line, after one naming another program |
| R4a-4 | a second arguments block taken | a second arguments block |
| R4a-5 | a second environment block taken | a second environment block, after one with another `PATH` |
| R4a-6 | the key's grammar not asked | an environment line with no key before its arrow |
| R4a-7 | another line in the environment block passed over | an environment line with no arrow |
| R4a-8 | a block open at the end taken | a print that ends inside the environment block |
| R4a-9 | the not-measured answer not acted on | all eight odd rows (this table said six; review 4180 A7 replayed it) |
| R4b | the NUL not asked | the installer's bytes, then a NUL and more after its last line |
| R4c | the copy's name printed raw | a leftover copy whose suffix is not in the closed form, both platforms |
| R4d-1 | the stub guard's regex as before | its reader case (a flag before the argument) |
| R4d-2 | the bound guard's regex as before | its reader case (the open-ended form) |

The note's earlier mutants that touch the compare, the reader or the table were re-run on this round's tree, their
anchors re-taken where fix round 1 renamed the arrays and the table replaced the old XPC arm: P1 to P20 (P16 and P16b on
the table's XPC row), P26, P27 and P30, and the fix round's O4 (`OSLogRateLimit` up to ten digits). All of them were
killed again, on the rows section 4.1 names, plus F1's three for O1 and O2.

**Suites on this round's tree**, each alone through `ccrc test`, in the foreground, all green:
- the verb's suite: 300 passed and 15 skipped of 315;
- doctor core-auth: 77 passed and 10 skipped, the simulated darwin twins and their control included;
- install landing: 44 passed and 1 skipped;
- expose: 67 passed and 3 skipped;
- the expose-artifacts file: 23 passed;
- the offered-commands guard: 12 passed;
- growth-check, armed: 100 passed;
- deviation-refs: 35 passed;
- anchors: 9 passed;
- the 22 census files that read the `ccd` tree, each alone: all passed;
- the 49 files under `server/test/single-definition`, each alone: 1628 passed and 1 skipped.

The ledger guard passes on the head commit's two trailers. The probe against main (`f542bd9c8c`) exits 0; main's only
change to this wave's files since the merge base is a README hunk elsewhere, so nothing is absorbed.

### 4.9 After fix round 3: the harness census's helper list

The PR's fast run on `bf8869cb3e` (46091552104, server 7/12) and the fourth full run (46091620933, server 1/12) were
red on one case each, the same one: `ccd-harness-integrity.test.ts`, "no override names a function nothing ships",
which received `ccrc-install-landing.test.ts:799 _gate`. Fix round 3's simulated Mac twin of install's gate line wraps
the gate block it cuts out of `cmd_install` in a function, `_gate`, because the block uses `local`. No shipped script
defines that name, so the census read it as a stub of nothing. It is a helper the test defines for itself, and the
census has a table for exactly that: `TEST_LOCAL_HELPERS` now lists `_gate` under the install landing file, with a
comment. Nothing in `ccd/ccrc` and nothing in the install test changed. Renaming the wrapper, or spelling it so the
census does not see it, would hide it from the guard, and the coordinator refused both (mail 40702).

Red first: the file alone, without the entry, gives this exact red (1 failed, 12 passed); with it, 13 passed, the
stale-entry case beside it included.

**The class this round missed.** A round that adds a shell function to a test, a stub or a helper alike, also runs
every guard suite that reads the test files as text. This round's list held the suites that read `ccd` and the
shipped sources, but not those. They are: the harness census (`ccd-harness-integrity`), the raw-spawn census,
`ccd-workspaces` (its scan of the `ccd*` test files), `child-reclaim-generation`, `git-env-strip`, `history-touched`,
`skill-size-ratchet`, `topology-clean`, `closeout-claims`, `typecheck-tests`, anchors and citations, and the verb's own
suite, whose stub and bound guards read the test files. Run each alone on this tree, with the install landing suite
and the 22 census files. All are green but one:
- the harness census: 13 passed;
- `ccd-workspaces`: 125 passed;
- `child-reclaim-generation`: 24 passed;
- `git-env-strip`: 7 passed;
- `history-touched`: 79 passed and 1 skipped;
- `skill-size-ratchet`: 32 passed;
- `topology-clean`: 62 passed;
- `closeout-claims`: 8 passed;
- anchors: 9 passed;
- citations: 4 passed;
- the verb's suite: 300 passed and 15 skipped;
- install landing: 44 passed and 1 skipped;
- the 22 census files, the raw-spawn census among them: all passed.

`typecheck-tests` did not run here, so the PR's fast run on the new head is its evidence. The test box's checkout has
no `typescript` under `pwa/`, so the suite stopped at its import, and a direct `tsc` over the server's test project was
killed by the test slice's memory cap while other heavy runs held it.

### 4.10 Fix round 4: review 4180 of `261db2b6e8`

The coordinator's ruling (mail 40891) on review 4180, item by item:
- **F1, a repeated key.** Inside the job's own environment block a key printed a second time refuses as not measured,
  before anything is taken from the second line, naming the key (its grammar already held) and no value: "printed a
  second `<KEY>` line in the job's environment block, a shape this verb does not read". The ruling is for the class,
  so every key alike. Before the round the reader assigned on every matching line, so the last `PATH` or `HOME` won and
  only it was compared: the reviewer drove `on` through the fixture harness with a hostile `PATH` line followed by the
  file's own, and the verb wrote and restarted.
- **A2.** A leftover copy whose suffix the printer holds is described, not named: "a copy beside `<ccrc.env>` whose
  name this verb does not print", since the held word would name a path that does not exist.
- **A3 to A6, rows only.** `path` and `Home` in F1's whole-name row; a key padded with a space, before it or before its
  arrow, in the odd table; a closing line outside any block (the arm's second half); a print cut inside the arguments
  block and inside another block; a `ProcessType` line with no closing tag after its value. Each pins what the tip
  already did.
- **A7.** Section 4.8's R4a-9 row now says all eight odd rows.
- **A8.** The remedy for a job `PATH` outside its grammar, the README and D-9158 add "printable ASCII only".
- **A9.** The README says what section 2.2 says: the scope, the passed-over block, and the unmeasured premise.
- **A10.** The reader's comment and section 2.2 name both hosted image builds the four keys were printed on.
- **A11.** Issue #3654 is cited where the note and the README name these limits.
- Not in this round: A1, a stray line inside the arguments block, limit 4 of #3654.

**Red first.** The new test file against the tip's `ccd/ccrc` (`261db2b6e8`), in a scratch worktree: 11 rows red, 306
passed, 15 skipped. They are the nine repeated-key rows (each key twice, the hostile value first and second, and the
reviewer's X1b shape, `PATH` again through a `HOME` value that holds a newline) and the held copy's description on
both platforms. The A3 to A6 rows pass there, as rows that pin the tip should. On this round's tree: 317 passed, 15
skipped of 332.

**Mutants.** 44, under the coordinator's five terms (mail 39574): a scratch worktree detached at `261db2b6e8` holding
this round's `ccd/ccrc` and test file, the file put back and its sha256 compared after each mutant, nothing committed
or pushed during the run, the script (`run4.py`, section 4.8's `run3.py` pointed at the new scratch) in the temp root.
Every one was killed, and the restored file's sha256 equals the branch's. This round's:

| Mutant | What it does | Red rows |
|---|---|---|
| F1-a | the repeated-key check dropped | the nine repeated-key rows |
| F1-b | the check for `PATH` and `HOME` only | the four rows of `XPC_SERVICE_NAME` and `OSLogRateLimit` |
| A3-a | `path` and `Home` read as `PATH` and `HOME` | F1's rows for `path` and `Home` |
| A3-b | the key trimmed of spaces | the two padded-key rows |
| A4 | the outside-a-block arm cut to its two-tab half | the closing line after the environment block closed |
| A5 | the open-at-the-end check for the environment block only | the print cut inside the arguments block, and inside another block |
| A6 | a sentinel line's closing text not compared | the `ProcessType` line with no closing tag |
| A2 | the held copy named, as before | the held copy's description, both platforms |
| R4c | the copy's name printed raw | the same row |

The 35 earlier mutants that touch the compare, the reader or the key table were re-run on this round's tree, by case
name, each red as before: P1 to P8, P10, P12 to P20 (P16 and P16b), P26, P27, P30, O1, O2, O4, R4b and R4a-1 to R4a-9
(R4a-9 on 22 rows: the eight odd rows of section 4.8, this round's five more and its nine repeated-key rows).

**Suites on this round's tree**, each alone through `ccrc test`, all green:
- the verb's suite: 317 passed and 15 skipped of 332;
- doctor core-auth: 77 passed and 10 skipped;
- install landing: 44 passed and 1 skipped;
- expose: 67 passed and 3 skipped;
- the expose-artifacts file: 23 passed;
- the offered-commands guard: 12 passed;
- the harness census: 13 passed;
- the 22 census files that read the `ccd` tree, the raw-spawn census among them: all passed;
- section 4.9's class, the guard suites that read the test files as text: `ccd-workspaces` 125, `child-reclaim-generation`
  24, `git-env-strip` 7, `history-touched` 79 and 1 skipped, `skill-size-ratchet` 32, `topology-clean` 62,
  `closeout-claims` 8, anchors 9 and citations 4, all passed;
- growth-check, armed, on the commit: 100 passed, with `ccd/ccrc` at 15266 code lines against the merge base's 15126
  (+140, the waiver's limit) by the check's own counter;
- deviation-refs, on the commit: 35 passed.

`typecheck-tests` again could not run here: the test box's checkout has no `typescript` under `pwa/`. A `tsc` over a
project of the verb's test file alone, which extends the server's test project, exits 0. The PR's fast run on the head
is the evidence for the whole suite.

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
- Growth: `ccd/ccrc` grows by 140 code lines against the merge-base (26 of them Part 1's, 9 fix round 1's key table,
  7 fix round 3's, 2 fix round 4's), past the per-PR limit of 40, under D-9158's waiver
  (`server/test/growth-waivers/D-9158-ccd-ccrc.json`, its limit the measured 140, by the growth check's own counter:
  15126 code lines at the merge base, 15266 at this round's tree). The nine are the cost of the coordinator's ruling on the fourth key (mail 40092), not growth of this
  wave's own: the table's function, `_auth_job_env_ok`, eight lines, and the one line of the environment loop that calls
  it. The table's comment counts no line. The coordinator accepted 131 as the waiver's figure in mail 40130, and
  ruled that fix round 3 sets it to the figure measured on the final tip. Fix round 2 changes no line of `ccd/ccrc`.
  Fix round 3's seven are the print reader's new arms (the outside-a-block line, the key's grammar, the other
  environment line, the open block at the end, and the not-measured refusal's two lines) and the held copy name. Fix
  round 4's two are the repeated-key check in the environment arm and the held copy's description (the `||` line);
  its `seen` local joins an existing `local` line.

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

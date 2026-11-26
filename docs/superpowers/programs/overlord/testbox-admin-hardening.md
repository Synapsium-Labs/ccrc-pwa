# Test box admin verb: writes in a less privileged user's place

Overlord wave 239. Two tasks in one pull request:
- the hardening of the test box admin verb's box-side writes, in commits of its own;
- the words review 3789 asked for in the build copy, in a commit of its own, with no behaviour change.

## In short

- Each of the admin verb's own box-side writes named in section 1's table, where a less privileged user of the box has a
  say, is now that user's own act, or it refuses.
- One writer does those writes. It refuses a link, a second name or a wrong kind of file at any name it writes, and its
  rename never follows a link.
- The privilege drop has one definition, `TBA_DROP` in `ccd/testbox-user-write`. The build copy's writer runs under it
  too, and the build copy's two box programs are byte for byte what they were.
- A box in order answers as before, with the differences section 2 names. A box out of order is refused with the closed
  code its step already had.

## 1. The properties

Each property has cases in `server/test/testbox-admin-user-writes.test.ts`. Each reachable arm of each guard has a case
that goes red when that arm alone is removed (section 5). Two arms have no such case:
- the repair walk's not-a-directory arm, which nothing reaches once the folder test before it holds;
- the token step's arm for a folder of homes that cannot be resolved, which is redundant in effect: the next step refuses
  the same state with the same word.

Verb-level cases are in the connect, retry, key-rotate and acts suites.

| | Property | How it holds |
|---|---|---|
| P1 | Each of these writes into a place a less privileged user controls is made with that user's identity, or it refuses: the service token, the access key file's edits, and the repair's copy over the installed tree. | **The service token** is written after a drop to the service user, through `TBA_DROP`. A service user whose user or group resolves to root refuses, as does one that resolves to no user or to a number that is not one.<br>**The access key file** is edited by the login user, with no sudo. For a login user other than root, that step never becomes root. A root login edits root's own file, so the property still holds.<br>**The repair's copy** runs only when three things hold: the tree and every folder above it up to `/` is a real directory of root's; group and other cannot write any of those folders; and every entry of the tree is root's and closed to group and other writes. |
| P2 | A link, a second name or a wrong kind of file at any name the step is about to write, own, mode or rename refuses with words of its own, and nothing is followed. | **The one writer (`tba_put`)** checks the base folder, every folder between it and the file, and the file. Each refusal is one word and exit 5: `put-outside`, `put-base`, `put-dir-link`, `put-dir-kind`, `put-link`, `put-kind`, `put-names`. The rename is `mv -T`, which never treats the name as a directory. The access key edits ask the writer's checks before they read the file.<br>**Root's own walk** refuses `token-path`, `token-user`, `token-home`, `token-dir` or `token-dir-owner`.<br>**The repair copy** refuses `tree-kind`, `tree-owner`, `tree-mode` or `tree-entry` (exit 4). It replaces a link at a destination name rather than writing through it. |
| P3 | For these writes, a check and the act it guards are one step. | Under the drop, the kernel checks permission at the act itself. A name the user swaps after a check can only lead the user's own act to the user's own files.<br>Root's walk checks each folder by standing in it (`cd -P`) and comparing its physical path. The one owner change it can make acts on the folder it stands in (`.`), never on a name, and only on a folder that group and other cannot write.<br>The repair copy's checks read only what no less privileged user can change. |
| P4 | Answers, closed codes and phases are unchanged for a box in order. | Each new refusal uses the exit its caller already mapped:<br>- the token step: `pair-failed`;<br>- the access key edits: `new-key-refused`, `old-line-kept`, `unpair-failed` or `revoked-unpair-failed`;<br>- the repair copy: `install-failed`. Its "other release" stays exit 3.<br>No new closed code, phase or answer field. The box's word goes only to this host's log, through one reader (`_tba_box_word`), which the build copy now uses too. |
| P5 | No fallback to a root write. | The drop uses util-linux's `setpriv`, which the build copy already needs on the box. If it is missing, no step falls back to root: the drop fails and the step ends with its code. |

## 2. What a merge changes

**For a box in order: nothing an operator sees.** Connect, Try again, Repair, Disconnect, key-rotate and key-revoke
answer as before. There are five quiet differences:

- **The service token file** is owned by the service user and that user's group. Before, its group was root's. The mode is
  0600 either way, so no reader changes.
- **A token folder that an earlier pairing made as root** is handed to the service user on the next pairing, if it holds
  nothing but the token (or nothing, after an unpair) and group and other cannot write it. Root does this by changing the
  owner of the folder it stands in. After that, the user writes the token there.
- **The access key file is the login user's after an edit.** It keeps its mode and its modification time: before, an
  edit set the modification time to the time of the edit; now the old time is kept. Its access time is that of the edit's
  own read. A file its owner may only read (0400 or 0444, which sshd accepts) is still edited.
- **An edit of the access key file drops its trailing blank lines and every NUL byte, and ends the last line with a
  newline when it had none** (named differences). The edits read the file through a command substitution. sshd skips
  blank lines, so no login changes there. Only the login user, or root on its own file, can put a NUL in the file, so no
  boundary is crossed; whether sshd skips a line holding a NUL is not measured (section 6).
- **The repair copy replaces a link at a destination name** with the staged file, rather than writing through the link.

**For a box out of order: a refusal with an existing code.**

| What is out of order | Answer |
|---|---|
| The token's path: a link, a second name, a folder or another kind of file where the token goes; a link or a file where a folder goes; a home that is not the service user's real directory; a folder of a third user's; a folder of root's that holds anything else, or that group or other may write; a service user or group of root's | `pair-failed` |
| The access key file or its folder: a link, a second name or another kind of file at the file; a link or a plain file where the key folder goes; a key folder the login user cannot write (one of root's), whether or not it may search it; a folder on the way that it cannot search, where a removal cannot prove the file absent and so refuses rather than answer that the line is gone; a login home that is a link | `new-key-refused` (append), `old-line-kept` (removal after the switch), `unpair-failed` or `revoked-unpair-failed` (Disconnect, key-revoke). A refused rotate's own removal logs the box's word, and its answer stays `new-key-refused`. |
| The installed tree for Repair: a link on the way; a folder above it not root's, or open to group or other writes; an entry not root's, or open to them | `install-failed`, phase `install`, and no installer runs |

## 3. Consolidation

- **One privilege drop.** `TBA_DROP` holds the words of the drop. The build copy's root program uses it in both of its
  places, through the same definition. Its two programs hash the same as on `main`:
  `TBA_BUILD_COPY_SH` sha256 `8b838dd0…b753`, `TBA_BUILD_WRITE_SH` sha256 `3300b7f2…c781`.
- **One writer.** `tba_put` (the `TBA_PUT_FN` string) is carried by the token's writer and by both access key edits. It
  writes the bytes to its own temporary file first, and only then gives that file its mode (or, with `keep`, the old
  file's mode and times). Its `put-outside` refusal is reached by no caller today: each names a file below its base. It
  stays for the function's own contract, with its case.
- **Legitimately different: the build copy's writer stays its own.** It replaces a link at the build's name by design
  (capture runner PR 3b, fix round 1). `tba_put` refuses a link at the name. Folding one into the other would change
  one of the two behaviours.
- **One reader of the box's word.** `_tba_box_word` replaces the build copy's inline check, and serves the new log
  lines too.
- **A new sourced file.** The verb sits at its growth cap, so the new strings went into `ccd/testbox-user-write`, which
  the verb sources before the build copy. The verb's code lines fell by one, to 1,875 against its cap of 1,885.

## 4. Departures, by slug

- **`key-edits-without-root`** (accepted in fix round 1). The access key file's edits run as the login user, without sudo.
  They do not drop from root. The login user owns the file and its folder, so this gives the same property with one less
  step.

  Every state where an edit that worked before now refuses:

  | State | Code |
  |---|---|
  | A key folder the login user cannot write (one of root's), whether or not it may search it; for a removal, also a folder on the way that it cannot search, since the removal cannot then prove the file absent | `new-key-refused` (append), `old-line-kept` (removal after the switch), `unpair-failed` or `revoked-unpair-failed` (Disconnect, key-revoke) |
  | A login home that is a link | the same codes, by edit |
  | A link, a second name or another kind of file at the key file | the same codes, by edit |
  | A link or a plain file where the key folder goes | the same codes, by edit |

  A key file its owner may only read is not one of these states. The writer gives its temporary file the old mode only
  after the bytes are written.
- **`token-folder-handover`** (accepted in fix round 1). A box an earlier build paired holds a token folder of root's. If
  the token were written as the service user alone, that user could not place it there, and Try again would end
  `pair-failed` on a box in order. Root therefore hands over such a folder, under the narrow rule in section 2. A folder
  that group or other may write is never handed over.
- **`tree-check-before-copy`.** The installer's release step leaves the tree and its folders root's. The tool sync and
  later hand changes cannot be proved from the installer's text, so the repair copy checks the property itself before it
  writes. The check is one walk to `/` and one `find`. The copy then replaces a link at a destination name rather than
  writing through it.
- **`macos-scan-pin`.** The new file's box-side region holds three GNU spellings: the writer's `chmod --reference` and
  `mv -T`, and the copy's `--remove-destination`. The macOS scan's table has a row for each. The scan cuts and pins the
  region, as it does for the build copy's region, and its pin counts all three. The verb has one counted line outside its
  own region, a write that runs on the box, so a second such line is a hit. The verb's code is unchanged. In the first
  round the scan's suite was held by another run, which cleared that hunk before it was applied.
- **`test-lane-first-run`.** The first run of the new suite went through the test wrapper's default lane. That lane is
  allowed for fixture-only runs. Every later run was `--local`.
- **`claim-after-edit`.** The retry suite was edited a moment before it was claimed. Its claim was free and was taken
  at once.

### The words of review 3789

The copy's own words are fixed in its commit:
- the header names its one signal window;
- the log lines say what the box's check saw;
- the three test comments are corrected.

The real-tmux cases now skip on a temp root outside the launcher's path set, and one case reads both path-set literals
from their sources and holds them equal (residue E).

What could not go into an existing note, because a later pull request never edits a task note:

- **F2.** Where the capture runner notes say a kill "can leave one empty directory": the stage can hold as much of the
  build as was streamed (up to the 1 GiB bound). It stays root's, mode 0700, in root's temporary folder. The copy's
  header now says so.
- **F3.** The F8 row of `capture-runner-carries.md` says the header, the writer's comment and both notes carry the new
  wording. The PR 2 note never mentions the answer word. The header and both log lines now say what the check saw.
- **Residue B.** The copy's box-root test, `[[ … =~ ^/[A-Za-z0-9._/-]+$ ]]`, is an ASCII set under the C locale. Under a
  UTF-8 locale, bash's bracket ranges can accept more, so the copy could accept a root that the launcher refuses. The
  new case holds the two literals equal. It does not hold the locale.
- **Residue I.** The pane-start reading relies on tmux 3.2 or later quoting a word that holds a space. tmux 3.1c or
  older would print the joined word as two words.
- **F6.** The build copy adapter's suite runs in a full run. A fast pull request run selects it only when the change
  reaches it.

## 5. Mutants

Each mutant removed or weakened one arm of one guard. The case set was run once per mutant, and every file was restored
byte for byte afterwards. Every row on the box programs and the macOS scan was run in fix round 1, against the
user-write suite unless another is named; the rows marked (round 2) were run in fix round 2. The verb-level and
review-words rows are the first round's: their code did not change.

| Guard, and the arm the mutant removes | Result |
|---|---|
| The token written without the drop (`TBA_DROP` taken out of the exec) | red, 1 case |
| The service user's id refused when it is root's (user arm) | red, 1 case |
| The service user's group refused when it is root's (group arm) | red, 1 case |
| The service user's numbers refused when they are not numbers (whole check) | red, 4 cases (round 2) |
| The service user's numbers: the empty group number arm alone | red, 1 case (round 2) |
| The folder of homes that cannot be resolved | red, 1 case, only because the shell then stops with no word; an arm that does nothing stays green (section 1) |
| A token path outside the home | red, 1 case |
| Root's physical-path check of the home | red, 1 case |
| Root's owner check of the home | red, 1 case |
| Root's physical-path check of each folder | red, 2 cases |
| A third user's folder accepted | red, 1 case |
| The hand-over acting on a name, not on `.` | red, 2 cases |
| The hand-over of a folder holding anything | red, 1 case |
| The hand-over of a folder that group or other may write | red, 2 cases |
| The writer's file-outside-its-base refusal | red, 1 case |
| The writer's base refusal (both arms: a link, or not a directory) | red, 2 cases |
| The writer's base refusal, not-a-directory arm alone | red, 1 case |
| The writer's link refusal at a folder | red, 2 cases |
| The writer's plain-file-where-a-folder-goes refusal | red, 1 case |
| The writer's `check` making a folder | red, 1 case |
| The writer's link refusal at the file | red, 3 cases |
| The writer's kind refusal at the file | red, 3 cases |
| The writer's second-name refusal | red, 2 cases |
| The writer's rename without `-T` | red, 1 case (a link planted after the checks) |
| The writer giving the mode before the bytes (the first round's order) | red, 5 cases |
| The writer not copying the old file's times | red, 4 cases |
| The access key edits reading before their checks (append, removal) | red, 3 and 3 cases |
| The removal answering a file absent where it cannot look (its proof of absence taken out) | red, 3 cases (round 2) |
| The repair copy: the owner of the tree and of each folder above it (whole check) | red, 3 cases |
| The repair copy: the mode of the tree and of each folder above it (whole check) | red, 3 cases |
| The repair copy: a folder's other-write arm alone | red, 1 case |
| The repair copy: a link, or not a directory, on the way (whole check) | red, 1 case |
| The repair copy: the folders above the tree (the walk stops at the tree) | red, 6 cases |
| The repair copy: the entries (whole check) | red, 5 cases |
| The repair copy: an entry's owner arm alone | red, 2 cases |
| The repair copy: an entry's other-write arm alone | red, 2 cases |
| The repair copy writing through a link at a destination name | red, 1 case; and the macOS scan's pin, red |
| The macOS scan's `chmod --reference` row taken out | red, 2 cases: the region's pin and the verb's count (round 2) |
| The macOS scan's cut of the verb's one line taken out of its sweep, the row kept | red, 1 case: the verb's sweep (round 2) |
| The region's spellings one fewer (the writer's mode copy taken out), or one more (a second in the repair copy) | red, 1 case each: the region's pin (round 2) |
| The verb's counted line one fewer (its spelling taken out) | red, 1 case: the verb's count (round 2) |
| The verb's counted line one more (the same line twice, or another line with the spelling) | red, 3 cases each: the verb's sweep, its region's outside check and its count (round 2) |
| Each of the four access key edit calls made under sudo (key-rotate suite) | red, each |
| The box word's reader accepting any text (acts suite) | red, 1 case |
| The copy's box-root set widened by one character (agent) | red, 1 case |
| The copy's log line put back (acts suite) | red, 1 case |
| The macOS scan's cut of the new region removed | red, 1 case (the scan finds the region's GNU lines) |

## 6. What only a real box shows

- That `setpriv` drops the user, the group, the supplementary groups and the inheritable capabilities. The cases record
  how it is asked and run what follows as the test's own user.
- Real ownership by root, and a real owner change. An `ls` shim reads folders as root's, a `find` shim reads entries as
  root's (but for one it is told to read as another's), and the `chown` shim records.
- `cd -P` and `pwd -P` over the box's own mounts. A box whose `/var/lib` is reached through a link on the way resolves
  to its physical path first, so it is not refused. That was argued, not run.
- That sshd accepts an access key file that the login user rewrote: the login user's owner, the mode kept, the
  modification time kept.
- Whether sshd skips a line of the access key file that holds a NUL byte. Not measured.
- GNU `find -quit`, `mv -T`, `cp --remove-destination`, `chmod --reference` and `ls -ldn` on the box's userland. They are
  the same tools as the fleet host's.
- **Two exposures of the repair's proof on a box the installer accepted.** The installer proves only the tree and its own
  two folders, so either of these now ends the repair with its existing failure code (`install-failed`):
  - a tools path under a parent folder (or mount point) that is not root's, or that its group or others may write;
  - a tools path reached through a link on the way.

  On a box the installer built at its default path, every folder above the tree is root's and closed, so the proof
  passes. That was read from the installer's steps, not run on a real box.

## Where things stand

- **Agreed:**
  - the brief's five properties, scoped to the writes in section 1's table;
  - the single drop and writer;
  - the refusal codes above;
  - the departures `key-edits-without-root` and `token-folder-handover` (fix round 1).
- **Waiting on you:** nothing.
- **Later:** root's other acts on the box are outside this note's properties; a follow-up holds them separately.

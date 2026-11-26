# Test box admin verb: writes in a less privileged user's place

Overlord wave 239. Two tasks in one pull request: the hardening of the test box admin verb's box-side writes (its own
commits), and the words review 3789 asked for in the build copy (a commit of its own, no behaviour change).

## In short

- Every box-side write the admin verb makes where a less privileged user of the box has a say is now that user's own
  act, or it refuses.
- One writer does those writes. It refuses a link, a second name or a wrong kind of file at any name it writes, and its
  rename never follows a link.
- The privilege drop has one definition, `TBA_DROP` in `ccd/testbox-user-write`. The build copy's writer runs under it
  too, and the build copy's two box programs are byte for byte what they were.
- A box in order answers exactly as before. A box out of order is refused with the closed code its step already had.

## 1. The properties

Each property has cases in `server/test/testbox-admin-user-writes.test.ts` that go red when it is broken (section 5).
Verb-level cases are in the connect, retry, key-rotate and acts suites.

| | Property | How it holds |
|---|---|---|
| P1 | A root-side write into a place a less privileged user controls is made with that user's identity, or it refuses. | The service token is written after a drop to the service user, through `TBA_DROP`. The access key file is edited by the login user itself, and that step never becomes root. The repair's copy over the installed tree runs only when the tree, and every folder above it up to `/`, is a real directory of root's that group and other cannot write, and every entry of the tree is root's and closed to group and other writes. A service user that resolves to root, or to no user, refuses. |
| P2 | A link, a second name or a wrong kind of file at any name the step is about to write, own, mode or rename refuses with words of its own, and nothing is followed. | The one writer (`tba_put`) checks the base folder, every folder between it and the file, and the file. Each refusal is one word and exit 5: `put-outside`, `put-base`, `put-dir-link`, `put-dir-kind`, `put-link`, `put-kind`, `put-names`. The rename is `mv -T`, which never treats the name as a directory. The access key edits ask the writer's checks before they read the file. Root's own walk refuses `token-path`, `token-user`, `token-home`, `token-dir` or `token-dir-owner`, and the repair copy refuses `tree-kind`, `tree-owner`, `tree-mode` or `tree-entry` (exit 4). |
| P3 | A check and the act it guards are one step. | Under the drop, the kernel checks permission at the act itself. A name the user swaps after a check can only lead the user's own act to the user's own files. Root's walk checks each folder by standing in it, `cd -P`, and comparing its physical path. The one owner change it can make acts on the folder it stands in (`.`), never on a name. The repair copy's checks read only what no less privileged user can change. |
| P4 | Answers, closed codes and phases are unchanged for a box in order. | Each new refusal uses the exit its caller already mapped. The token step is `pair-failed`. The access key edits are `new-key-refused`, `old-line-kept`, `unpair-failed` or `revoked-unpair-failed`. The repair copy is `install-failed`. The repair copy's "other release" stays exit 3. No new closed code, phase or answer field. The box's word goes only to this host's log, through one reader (`_tba_box_word`) that the build copy now uses too. |
| P5 | No fallback to a root write. | The drop uses util-linux's `setpriv`, which the build copy already needs on the box. No step falls back to root if it is missing: the drop fails and the step ends with its code. |

## 2. What a merge changes

**For a box in order: nothing an operator sees.** Connect, Try again, Repair, Disconnect, key-rotate and key-revoke
answer as before. Two quiet differences:

- The service token file is owned by the service user and that user's group. Before, its group was root's. The mode is
  0600 either way, so no reader changes.
- A token folder that an earlier pairing made as root, holding nothing but the token (or nothing, after an unpair), is
  handed to the service user on the next pairing. Root does this by changing the owner of the folder it stands in. After
  that the user writes the token there.

**For a box out of order: a refusal with an existing code.**

| What is out of order | Answer |
|---|---|
| The token's path: a link, a second name, a folder or another kind of file where the token goes; a link or a file where a folder goes; a home that is not the service user's real directory; a folder of a third user's; a folder of root's that holds anything else | `pair-failed` |
| The access key file or its folder: a link, a second name or another kind of file; a login home that is a link | `new-key-refused` (append), `old-line-kept` (removal after the switch), `unpair-failed` or `revoked-unpair-failed` (Disconnect, key-revoke) |
| The installed tree for Repair: a link on the way, a folder above it not root's or open to group or other writes, an entry not root's or open to them | `install-failed`, phase `install`, and no installer runs |

## 3. Consolidation

- **One privilege drop.** `TBA_DROP` holds the words of the drop. The build copy's root program uses it in both of its
  places, through the same definition. Its two programs hash the same as on `main`:
  `TBA_BUILD_COPY_SH` sha256 `8b838dd0…b753`, `TBA_BUILD_WRITE_SH` sha256 `3300b7f2…c781`.
- **One writer.** `tba_put` (the `TBA_PUT_FN` string) is carried by the token's writer and by both access key edits.
- **Legitimately different: the build copy's writer stays its own.** It replaces a link at the build's name by design
  (capture runner PR 3b, fix round 1). `tba_put` refuses a link at the name. Folding one into the other would change
  one of the two behaviours.
- **One reader of the box's word.** `_tba_box_word` replaces the build copy's inline check, and serves the new log
  lines too.
- **A new sourced file.** The verb sits at its growth cap, so the new strings went into `ccd/testbox-user-write`, which
  the verb sources before the build copy. The verb's code lines fell by one, to 1,875 against its cap of 1,885.

## 4. Departures, by slug

- **`key-edits-without-root`.** The access key file's edits run as the login user, without sudo. They do not drop from
  root. The login user owns the file and its folder, so this gives the same property with one less step. A box whose
  login user's key folder is root's refuses the edit.
- **`token-folder-handover`.** A box an earlier build paired holds a token folder of root's. Written as the service
  user alone, its next pairing could not place the token there, and Try again would end `pair-failed` on a box in order.
  Root therefore hands over such a folder, under the narrow rule in section 2.
- **`tree-check-before-copy`.** The installer's release step leaves the tree and its folders root's. The tool sync and
  later hand changes cannot be proved from the installer's text, so the repair copy checks the property itself before it
  writes. The check is one walk to `/` and one `find`.
- **`macos-scan-pin`.** The new file's box-side region holds one GNU spelling (`mv -T`), so the macOS scan cuts and
  pins it, as it does for the build copy's region. The scan's suite was held by another run, which cleared this exact
  hunk before it was applied.
- **`test-lane-first-run`.** The first run of the new suite went through the test wrapper's default lane. Every later
  run was `--local`.
- **`claim-after-edit`.** The retry suite was edited a moment before it was claimed. Its claim was free and was taken
  at once.

### The words of review 3789

The copy's own words are fixed in its commit: the header names its one signal window, the log lines say what the box's
check saw, and the three test comments are corrected. The real-tmux cases now skip on a temp root outside the
launcher's path set, and one case reads both path-set literals from their sources and holds them equal (residue E).
What could not go into an existing note, because a task note is never edited by a later pull request:

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

Each mutant removed or weakened one guard. The case set was run once per mutant, and every file was restored byte for
byte afterwards.

| Guard (mutant) | Result |
|---|---|
| The token written without the drop | red, 1 case |
| The writer's link refusal at the file | red, 3 cases |
| The writer's second-name refusal | red, 2 cases |
| The writer's kind refusal | red, 3 cases |
| The writer's link refusal at a folder | red, 2 cases |
| The writer's base refusal | red, 1 case (added after this mutant first survived) |
| The writer's rename without `-T` | red, 1 case (a link planted after the checks) |
| Root's physical-path check of each folder | red, 2 cases |
| Root's physical-path check of the home | red, 1 case |
| Root's owner check of the home | red, 1 case |
| The hand-over acting on a name, not on `.` | red, 2 cases |
| The hand-over of a folder holding anything | red, 1 case |
| A third user's folder accepted | red, 1 case |
| A service user that resolves to root accepted | red, 1 case |
| A token path outside the home accepted | red, 1 case |
| The repair copy: owner, mode, kind, folders above, entries | red, 3, 2, 1, 5 and 1 cases |
| The access key edits reading before their checks (append, removal) | red, 2 and 2 cases |
| Each of the four access key edit calls made under sudo | red, each |
| The box word's reader accepting any text | red, 1 case |
| The copy's box-root set widened by one character | red, 1 case (agent) |
| The copy's log line put back | red, 1 case |
| The macOS scan's cut of the new region removed | red (the scan finds `mv -T`) |

## 6. What only a real box shows

- That `setpriv` drops the user, the group, the supplementary groups and the inheritable capabilities. The cases record
  how it is asked and run what follows as the test's own user.
- Real ownership by root, and a real owner change. An `ls` shim reads folders as root's, and the `chown` shim records.
- `cd -P` and `pwd -P` over the box's own mounts. A box whose `/var/lib` is reached through a link on the way resolves
  to its physical path first, so it is not refused. That was argued, not run.
- That sshd accepts an access key file that the login user rewrote (owner kept by `cp -p`, mode kept).
- GNU `find -quit`, `mv -T` and `ls -ldn` on the box's userland. They are the same tools as the fleet host's.

## Where things stand

- **Agreed:** the brief's five properties, the single drop and writer, and the refusal codes above.
- **Waiting on you:** a ruling on `token-folder-handover` and `key-edits-without-root`, if either should take another
  shape.
- **Later:** nothing filed from this wave.

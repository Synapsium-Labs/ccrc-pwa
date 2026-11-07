# The test box, connected from the console

**Spec** · 2026-11-07 · Status: draft rev 1 · Owner: the coordinator · Related:
`docs/superpowers/specs/2026-10-28-test-box-design.md` (the test box; this is one of its waves),
`docs/superpowers/plans/2026-10-29-test-box.md` (TB12 to TB14, the hand install this replaces),
`docs/superpowers/specs/2026-10-25-box-settings-view-design.md` (its D5, amended here for the test box rows),
`docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md` (rings). Docs only: no code ships with it.

## In short

The operator ruled on 2026-11-07: the test box is not usable until any ccrc installer can point ccrc at a remote box
and set it up entirely from the console, under Settings › Automation › **Test box**. ccrc reaches into the box itself
over SSH, with access the operator gives it. Everything built must work for other installers, so the code holds no
host, address, user or path of anyone's box.

Today the setup is a hand job. A coordinator logs in to the box as root, fetches a release, writes the box's
settings file by hand, runs the box installer, makes a token and copies it to both sides, makes a push key, and edits
four lines of the fleet host's `~/.ccrc/ccrc.env`. Nothing records that it was done or checks that it was done right.

This wave puts all of that behind one card:

- **Connect a test box.** The operator types the box's address. ccrc makes an SSH key pair of its own and shows the
  one line to add on the box. ccrc then checks the box, shows its host key to confirm, installs the test service from
  the fleet host's own verified release, pairs it (it makes the service token and the push key itself, so no secret
  is ever copied by hand) and writes the fleet-side settings.
- **Parity from the card.** The parity check runs from a button. The switch stays disabled until parity passes, and
  the server refuses to arm it without a passing record, whatever the page shows.
- **Settings on the card.** The box's own 28 settings and the fleet host's test box settings are editable on the card.
  Each value is checked by the reader that already checks it, and refused at the console when it does not fit.
- **Disconnect, Replace, Repair.** Each is one control with a confirmation.
- **Upgrades follow the fleet release**, as tool sync already does; installer-level changes are applied the same way.

The server still never reaches the test box. The fleet agent starts one new fixed `ccrc` verb, and that verb runs
SSH on the fleet host. Section 5 lists the choices only the operator can make, each with a recommendation.

## 1. Measured

Measured on `origin/main` at `67db632c2`. Every path is relative to the repository root.

| # | Fact | Where |
|---|---|---|
| M1 | The box installer runs as root from an extracted release tree: `--release <tag> --node <v> --repos <row file>... --distro <ID>-<VERSION_ID> --push-key <public key file>`. All refusals come before any write. | `deploy/testbox/install.sh` `usage()`, phase 1 |
| M2 | The installer checks the staging tree by `MANIFEST` and `build.json` only, not by provenance. Today's first install trusts the transport checksum plus `MANIFEST` (D-7424). | `deploy/testbox/install.sh` phase 1 |
| M3 | A re-run with an unchanged tag and box file does nothing. A different installed tag is refused: "later releases come only through the tool sync". So a repair today is a no-op. | `deploy/testbox/install.sh` `MARK_TAG`/`MARK_SHA`, line 121 |
| M4 | The installer never creates the service token. The service refuses to start with an empty or unreadable token. | `deploy/testbox/install.sh`; `agent/src/testbox/main.ts` `readToken` |
| M5 | The box file is one root-owned file, `/etc/ccrc-testbox/ccrc.env`, read in file mode only, never sourced. It must be a regular file owned by root and not writable by group or other (D-7451, D-7456). | `ccd/testbox-knobs` `TB_BOX_ENV_FILE`, `_tb_box_file_ok` |
| M6 | Every test box value is checked by one shape table. A wrong value keeps its default and is reported as a warning; the installer refuses on any warning. | `ccd/testbox-knobs` `_tb_shape`, `_tb_load` |
| M7 | There are 44 test box keys: 16 on the fleet host in `~/.ccrc/ccrc.env` and 28 on the box. Four of the 16 are the pairing keys: `CCRC_TESTBOX_URL`, `_TOKEN_FILE`, `_GIT_URL_BASE` and `_GIT_KEY`. | README "ccrc's own settings"; `deploy/ccrc.env.example` |
| M8 | No ccrc verb writes `~/.ccrc/ccrc.env`. The closest precedent is `ccrc expose`, which writes its own overlay, `~/.ccrc/exposure.env`, and refuses a key `ccrc.env` already sets. | `ccd/ccrc` `cmd_expose`, `_ccrc_knob` |
| M9 | One file fault (a NUL, a CR, non-ASCII, a quote spanning lines) makes the reader refuse every setting in `ccrc.env` at once. | `ccd/ccrc` `_box_env_unit_whole`, `_box_env_value` |
| M10 | The box-settings spec made the console read-only (its D5) and left the test box's own 28 settings off the card (D11). The four pairing keys show as set or not set only (D19). | `docs/superpowers/specs/2026-10-25-box-settings-view-design.md` §3 |
| M11 | The agent may exec only `tmux` and `ccd`. `ssh`, `scp`, `sftp`, `rsync`, `curl`, `sudo`, `chmod`, `chown` and `systemctl` are never grantable. The agent writes files only under `~/.cc-clips/`. | `agent/src/whitelist.ts` `FORBIDDEN_COMMANDS`; `agent/CLAUDE.md` |
| M12 | Ops outside the exec whitelist are fixed spawn templates with typed fields, each with a source-scan test, offered in `ready.ops`. `account` builds its argv in one shared builder and sends secrets on stdin only. `token-sync` writes its secret through the verb, never the agent. | `agent/src/server.ts` `ready.ops`; `shared/account-argv.ts` `buildAccountArgv`; `agent/src/tokensync.ts` |
| M13 | Account acts pass one gate: auth on, a secure origin, a signed-in session (never the box token), the cap word, and a recent passkey step-up for any act that puts, replaces or deletes a credential. Every act is audited with an actor. | `server/src/accounts/gate.ts`; `server/src/accounts/audit.ts` `account_events` |
| M14 | The switch route takes `{on}` only, from a signed-in session only, and runs `ccd testbox-remote --state on\|off`. It has no parity check. | `server/src/coord/routes.ts` `POST /api/testbox/switch` |
| M15 | Parity is an operator CLI. It needs `gh pr view` and fresh worktrees with `npm ci`, runs each leg twice, and records nothing. | `ccd/testbox-parity` |
| M16 | The status answer carries no settings, so the card cannot show the box's settings today. | `shared/testbox.ts` `StatusAnswer`, `TESTBOX_PROTO` = 1 |
| M17 | The push runs `ssh -i <key> -o IdentitiesOnly=yes -o BatchMode=yes` with no host-key option, so the box's host key must already be in the fleet user's `known_hosts`. Nothing in the tree pins a host key. | `ccd/testbox-snap` line 313 |
| M18 | Lifecycle rows `testbox-token` and `testbox-push-key` say the operator places them and "nothing in the tree writes or removes" them. | `shared/lifecycle.ts` |
| M19 | The only in-tree key maker writes an ed25519 private half at 0600 with a create-only open, and throws rather than replace a key it did not make. | `server/src/coord/approvalsign.ts` `loadOrCreateApprovalSigner` |
| M20 | Releases already follow the fleet: after a gated `ccrc update`, tool sync tells the box to fetch the same release and verify it as `_upd_fetch` does (`SHA256SUMS`, Sigstore provenance through the installed verifier, `MANIFEST`). Box-file changes and installer changes do not follow; they need a root re-run. | `deploy/testbox/bin/tools-sync`; README "Tools in step with the fleet host" |
| M21 | The box's firewall accepts ssh and the service port only on the private-network address. The service has no TLS; its confidentiality is the private network's. | `deploy/testbox/nft/ccrc-testbox.nft`; `agent/src/testbox/main.ts` `listenRefusal` |
| M22 | The service user may start only the named test units through one polkit rule, and has no other root path. | `deploy/testbox/polkit/50-ccrc-testbox.rules` |
| M23 | A long fleet act already has a shape: a detached `systemd-run` unit under a lock, a phase file the sweep reads, and a result learned by measuring again, never from the reply. | `ccd/ccrc` `_upd_detach`, `_upd_phase`; `server/src/update/inventory.ts` |

## 2. Design

### 2.1 Where the work runs

The server stays where it is: it relays and never reaches the box (test box spec §2.7 and §7).

- The **page** sends typed fields to new session-only routes.
- The **server** checks them, gates them as account acts are gated (M13), records the act, and sends one new agent op,
  `testbox-admin`, offered in `ready.ops` like every op.
- The **fleet agent** spawns one fixed template, `$HOME/.local/bin/ccrc testbox-admin <sub> --from agent`, with each
  field as one `--name=value` word from one shared argv builder, and secrets on stdin only. The child gets
  `{HOME, PATH, LANG}`, never the agent's environment. This is a new fixed-template op class with its own source-scan
  test and its own entry in `agent/CLAUDE.md`. `ssh` stays forbidden to the agent.
- The **`ccrc testbox-admin` verb** on the fleet host does the work. It checks every field again, runs `ssh` itself
  with the pinned host key, writes the fleet-side files atomically, and writes a phase file. A long act (connect,
  repair, parity) detaches into a `systemd-run` unit under a lock, as an update does (M23).

The local arm (server and fleet on one box) calls the same verb directly, as the account ops do.

### 2.2 The card, step by step

The card keeps today's switch, state, versions and pristine-install tables. It gains a setup flow when no box is
connected, and a settings panel and three controls when one is.

**Not connected.** One sentence says what a test box is for, then **Connect a test box**.

**Step 1, the address.** Three fields: the box's address (an IP literal or a host name), the SSH port (default 22) and
the login user (default `root`; see C2). The page and the server both check the grammar. Nothing is sent to the box yet.

**Step 2, give ccrc access.** ccrc makes its own key pair on the fleet host (2.3). The card shows the public line to
add to the login user's `authorized_keys`, already restricted to the fleet host's address, with a copy button and one
sentence on where it goes. **I have added it** moves on.

**Step 3, check the box.** ccrc connects once. The card shows the box's host key fingerprint and asks the operator to
confirm it against the provider's console (C9). On confirm, the key is pinned. ccrc then runs the read-only
preflight (2.4) and lists each prerequisite with a pass or the reason it failed, each in plain words. A failure ends
the step with **Check again**; nothing on the box has changed.

**Step 4, the box's settings.** A form of the box's 28 settings, grouped by family as the Box settings card groups
them, filled with their defaults. The address the box was reached on fills `CCRC_TESTBOX_LISTEN`. One row per
repository to run (C15). Each value is checked as the operator types and again by the verb with `_tb_shape`.

**Step 5, install and pair.** **Install** starts the long act. The card shows its phases (verify release, copy, write
settings, install, pair, check) with the time each took, and stays correct across a reload because it reads the phase
file. It ends in **Connected**, or in the failing phase with its reason code and **Try again**.

**Step 6, parity.** **Run parity** (2.7). The switch is visible but disabled, with the sentence "Turns on after the
parity check passes".

**Connected.** The existing card, plus: the address shown as set (never its text, D19), the pinned fingerprint, the
last act from the ledger, **Settings**, **Repair**, **Replace** and **Disconnect**.

**Blocked.** A changed host key, a failed install or a lost access key each show one line with what happened and the
one control that resolves it.

By width (feedback rule: every width):

| Width | Layout |
|---|---|
| Phone | One column. The steps are a numbered list with only the current step open. The public key line wraps inside a monospace block and the copy button is full width under it. The preflight is a list, one prerequisite a line. Settings families are folded `details`. Every button is full width. |
| Laptop | Two columns: the step list on the left, the current step on the right. Settings show as a two-column form. Controls sit at the end of the state line. |
| Wide | Three areas: the steps, the current step, and the ledger's recent acts beside them. Settings and the versions table sit open side by side. |

### 2.3 ccrc's SSH access

ccrc reaches the box with a key pair it makes itself (recommended in C1).

- The verb makes an ed25519 pair, create-only, private half 0600 at `~/.ccrc/testbox-admin.key`. It never replaces a
  key it did not make, as `approvalsign.ts` does not (M19). The private half never leaves the fleet host, never
  crosses the wire and never shows on a page.
- The public line the card shows carries `from="<fleet host address>"`, where the verb reads that address from what
  the fleet host would use to reach the box. So a copied key is useless from anywhere else.
- Host keys are pinned to a ccrc-owned file, `~/.ccrc/testbox-known-hosts`. Every ssh the verb runs uses
  `-o UserKnownHostsFile=<that file> -o StrictHostKeyChecking=yes -o BatchMode=yes -o IdentitiesOnly=yes` and a
  connect deadline. The push (M17) moves to the same file, so the operator no longer edits `known_hosts` by hand.
- A host key that changes blocks every act until the operator confirms the new fingerprint on the card (C9). It is
  never accepted silently.
- ssh's stderr stays on the fleet host. The card gets a closed reason code, as `cmd_rollout`'s role check reports
  ssh's own failures.

If the operator chooses a pasted key or a password instead (C1), it follows the accounts path: step-up, a byte check,
a request-local buffer sent as the op's stdin only, zeroed after, never in argv, a log or an answer.

### 2.4 Install over that access

The verb reuses the root installer unchanged in what it checks. It adds the steps a coordinator does by hand today.

1. **Preflight, read-only.** Over ssh: root or working sudo (C2); `/etc/os-release` equal to the fleet host's
   distribution release; systemd new enough for `NFTSet=`; nftables present; `CCRC_TESTBOX_ROOT`'s parent on XFS with
   `reflink=1`; the private-network address the fleet reached (from the box's own `SSH_CONNECTION`) is an IP literal;
   open egress to the release host and the npm upstream; no installed release with another tag. Each failed check is
   a code with a sentence. ccrc never formats a disk and never joins the box to a private network (C10, C11).
2. **Verify on the fleet host.** The verb fetches the fleet host's own release tag and verifies it with the fleet
   host's installed verifier, exactly as `_upd_fetch` does: `SHA256SUMS`, the Sigstore provenance bundle, then
   `MANIFEST`. This is stronger than today's first install (M2) and changes no box code.
3. **Copy.** The verified tarball goes to a fresh `mktemp` staging directory on the box over the ssh stream. The box
   extracts it and runs `sha256sum -c` against the tarball's `MANIFEST` again, as the installer does.
4. **Write the box file.** The verb renders the box's settings, checks every value with `_tb_shape` and the whole file
   with `_tb_load box` on the fleet host first, then writes it on the box as root, `root:<service group>` 0640, by a
   temp file and a rename. The repository row files are written the same way.
5. **Install.** The verb runs the installer as root with the fleet host's tag and node version, `--distro` from the
   preflight and `--push-key` from step 2.5. Its refusal and failure lines map to codes on the card.

Later releases still come only through tool sync (M20). That rule is kept, not amended.

### 2.5 Pairing

All secrets are made on the fleet host by the verb, never typed and never copied by hand.

- **The service token.** 32 random bytes, written 0600 to `CCRC_TESTBOX_TOKEN_FILE` on the fleet host by a temp file
  and a rename. The same bytes go to the box on ssh stdin, where root writes them to the service user's token file,
  owned by the service user, 0600. Never argv, never a log line.
- **The push key.** An ed25519 pair, create-only, private half 0600 at `CCRC_TESTBOX_GIT_KEY`. Only the public half goes
  to the box, as the installer's `--push-key` file.
- **The fleet-side settings.** The verb writes `CCRC_TESTBOX_URL`, `_TOKEN_FILE`, `_GIT_URL_BASE` and `_GIT_KEY` from
  the box's address, the service port and the push user (2.6). They become ccrc-managed and show as set or not set,
  as D19 already has them.
- **The check.** The verb asks the box's status over the service, as the `testbox` op does, and the card's next poll
  shows the state. The act is done only when that measurement says `ok` or `degraded` with a known reason.

`shared/lifecycle.ts`'s `testbox-token` and `testbox-push-key` rows change in the same work: their writer is this
verb, and Disconnect is their collector. New rows are added for `testbox-admin.key`, `testbox-known-hosts`, the
parity record and the phase file.

### 2.6 The fleet-side settings write path

Writes go through one verb and are checked by the reader that already reads them.

- The route takes typed fields only, checks each against an L0 copy of its key's grammar, and gates as M13 does. The
  box token is never accepted. Step-up applies to acts that put, replace or remove a credential (C14).
- The agent op passes each value as one `--name=value` word through the shared builder. Values starting with `-`,
  `..` segments and C0 or DEL bytes are refused before the spawn.
- The verb checks again with `_tb_shape` and the byte-wise model, writes the target by a temp file in the same
  directory and a rename at 0600, and then runs `ccrc settings --write` so the Box settings card shows the change.
- A write that would leave a file the reader cannot decide is refused before it lands (M9), so a console edit can never
  blank every setting.
- The answer is measured again, never echoed: the route answers from the setting the verb re-reads.
- The snapshot stays a display. No write reads `box-settings.json` as an authority.

The target is a choice (C12). The recommendation is a ccrc-owned overlay, `~/.ccrc/testbox.env`, on the
`exposure.env` precedent: `ccrc.env` stays the operator's file, the verb refuses to write a key `ccrc.env` already
sets, and Disconnect can remove the overlay whole. The one reader, its generated library and the settings census learn
the overlay in the same work.

The four pairing keys are written only by Connect, Replace and Disconnect. The other 12 fleet-side keys are editable
on the card.

### 2.7 The box's own settings

- **Showing them.** The verb reads `ccrc test --testbox-knobs box` on the box over ssh after every act and on a slow
  timer, and writes a fleet-side snapshot the card shows. Each row keeps the display classes of the box-settings spec:
  a path, an address or a list shows as set. This reverses the box-settings spec's "left out" for these 28 rows only
  when a box is connected.
- **Editing them.** The card sends the whole changed set. The verb checks it on the fleet host with `_tb_load box`,
  writes the new box file on the box as root (temp file and rename, `root:<service group>` 0640), and re-runs the
  installed installer so the drop-ins, slices and firewall follow. The service user's polkit rule is not widened: the
  service never writes its own settings or units.
- **When.** An edit applies only when the box has no run in progress (C13). With runs in progress the card offers
  **Apply when idle**, which the verb holds until the box's status shows none running.
- An edit to a setting that shapes runs (workers, memory, tmpfs, run count) marks parity stale (2.8).

The installer needs one change for this: a re-run from the installed tree with the same tag, which applies a changed
box file. Today that path is reached only by a full staging re-run (M3).

### 2.8 Parity from the card, and the switch gate

- **Run parity** starts the parity tool as a detached unit in the tests slice on the fleet host, through the same
  verb. It never runs in the agent, the server or a session slice. Its scope by default is the five most recent merged
  pull requests of each repository row; the operator may name others (C8).
- The verb writes a parity record, `~/.ccrc/testbox-parity.json`: the result, the pull requests and revisions, the
  release, the tools key, the box's host key fingerprint, the box file's sha256 and the time. The `testbox` op's
  answer gains a `parity` field read from it, so the card and the route see the same record.
- **The gate.** `POST /api/testbox/switch` with `{on: true}` is refused with `parity-required` unless the record passed
  and still matches the box's host key and box file. `ccd testbox-remote --state on` checks the same record, so a
  terminal arm is gated too. Turning the switch off is never gated.
- Parity is required again after Connect, Replace and an edit to a setting that shapes runs. A release roll does not
  expire it; a version difference already makes runs fall back (test box spec §2.4).
- Arming stays the operator's act from a signed-in session. A box token and a coordinator still cannot arm.

### 2.9 Disconnect, Replace, Repair and upgrades

- **Disconnect** turns the switch off first, then removes what C6 chooses. The recommendation: on the box, stop and
  disable the service, remove the push key line, the service token and ccrc's access line; on the fleet host, remove
  the token, the push key, the overlay, the host key pin and the parity record. The box is then to be rebuilt, never
  reused (test box spec §2.0).
- **Replace** is Disconnect of the old box followed by Connect of a new address, in one flow. Runs in progress on the
  old box finish or fall back locally. Parity is required again.
- **Repair** re-pushes the installed release, verified again on the fleet host, and re-runs the installer from it
  with the current box file. It never changes the tag.
- **Upgrades.** Releases and tools keep following the fleet through tool sync, automatically after a gated update (M20).
  A release whose installer changes units, drop-ins or the firewall needs a root re-run; C7 chooses whether that runs
  automatically after tool sync or is offered on the card as **Apply release to box**.

### 2.10 The ledger

Every act is recorded in a new `testbox_events` table in coord.db, on the `account_events` precedent: one writer,
closed vocabularies for the act (`connect`, `confirm-host-key`, `install`, `pair`, `settings-fleet`, `settings-box`,
`parity`, `switch`, `repair`, `replace`, `disconnect`), the outcome and the code; the actor from the gate (device label
and a short hash, never an IP); the fleet identity; the host key fingerprint; no free text, no address and no secret.
A failed write is an answer, never a throw. The card shows the last act on a phone and the last ten on a wide screen.

### 2.11 Threat model: what changes

The test box spec's goals stay: no carry-over between runs, no fleet secret on the box, and no reach back from the box.

What ccrc gains is root on the test box, held on the fleet host. Bounds:

- **Direction.** The access is fleet to box only, over the private-network ssh port the ACL already allows. The box
  gets no key, no token and no route back. Goal 3 holds.
- **Secrets on the box.** Only the service token, the push key's public half, ccrc's access key's public half and an
  optional read-only deploy key. The access key's private half, like the push key's, stays on the fleet host. Goal 2
  holds.
- **Who holds it.** The access key is a file of the fleet user, so any session on the fleet host can read it, as it can
  read the push key today. That gives a session root on a box that holds no secrets, is rebuilt rather than reused and
  is not the authority for landing. This is inside the cooperative threat model, and C3 decides whether the key
  outlives Connect.
- **Reach.** The `from=` restriction makes the key useless off the fleet host. The pinned host key stops a swapped box
  from receiving the token.
- **The server.** It still never reaches the box and never holds the token, the push key or the access key.
- **Entry points.** One new op class, a closed sub list, no free argv, secrets on stdin, every route session-only behind
  the account gate.

### 2.12 For other installers

Nothing in code names a host, address, user, distribution or repository. Every value comes from the card or from a
setting with a neutral default. Examples in docs use `testbox.invalid`.

A box a ccrc installer can connect needs, before Connect:

1. A fresh OS from a clean image of the fleet host's distribution release.
2. The box on a private network with the fleet host (C4): the fleet host may reach its ssh port and the service port,
   and the box reaches nothing on that network.
3. Root login by key, or a user with passwordless sudo (C2), and the operator able to add one line to its
   `authorized_keys`.
4. An XFS file system with `reflink=1` mounted where `CCRC_TESTBOX_ROOT` will live.
5. Open egress to the release host and the npm upstream for the first install; the box's firewall closes it after.

The README's "The test box" section gains a "Connecting a test box" part that lists these, walks the card's steps, and
says what each control removes.

## 3. Amendments to earlier specs

- **Box-settings spec D5** is amended for the test box rows only. D5 said: read-only, because "writing a box's file
  from the server needs a new agent op and a new trust argument". This spec gives both. The op is `testbox-admin`
  (2.1). The trust argument: the server never writes a file; it relays typed fields from a gated session to a verb that
  re-checks them with the one reader, writes atomically, and is measured again; secrets never cross the wire; and the
  pairing keys still show as set only (D19). Every other setting stays read-only.
- **Box-settings spec D11** is amended: the box's own 28 settings show when a box is connected, read from the box (2.7).
- **Test box spec §2.7 and §7** ("the server keeps one agent link and never reaches a third box") stay true and gain a
  sentence: the fleet host, not the server, reaches the test box, now also over ssh as root for setup acts (2.11).
- **Test box spec §2.7, the switch**: it is armed only with a passing parity record, checked by the route and by
  `ccd testbox-remote` (2.8).
- **Test box plan TB12 to TB14**: the hand install, pairing and parity are replaced by the card for any installer;
  the hand steps remain the recovery path.

## 4. Decisions

These follow from the ruling and from the code. Section 5 holds the choices only the operator can make.

| # | Decision | Chosen, and why |
|---|---|---|
| T1 | Where ssh runs | In a `ccrc` verb on the fleet host, started by a new fixed-template agent op. `ssh` stays forbidden to the agent and the server never reaches the box |
| T2 | How fields reach argv | One shared builder, one `--name=value` word per field, secrets on stdin, the account op's rules (M12) |
| T3 | Route gate | The account gate (M13): session only, cap word, step-up for credential acts, audited |
| T4 | Host keys | Pinned in a ccrc-owned known-hosts file, confirmed by the operator once; strict checking always; the push uses the same file |
| T5 | First-install trust | Verified on the fleet host with its installed verifier (Sigstore), then `MANIFEST` again on the box; stronger than today |
| T6 | Who makes the token and push key | The verb, on the fleet host; only the token and public halves go to the box |
| T7 | Long acts | Detached unit, lock, phase file, result by measurement (M23) |
| T8 | Values | Checked on the page, at the route, and by the verb with `_tb_shape`; refused, never silently defaulted |
| T9 | Parity gate | A record on the fleet host, carried in the `testbox` op's answer, checked by the route and by `ccd testbox-remote` |
| T10 | The ledger | A closed-vocabulary `testbox_events` table, `account_events` precedent |
| T11 | Machine-neutral | No host, address, user, path, distribution or repository in code; prerequisites in the README |

## 5. Decisions for the operator

| # | Decision | Options | Recommendation |
|---|---|---|---|
| C1 | The credential ccrc uses to reach the box | (a) ccrc makes a key pair and the card shows the one public line to add on the box; (b) the operator pastes an existing private key; (c) a one-time root password, used to install a ccrc key and then discarded | **(a)**: no secret ever enters the browser, the wire or a log, and it works on any provider that allows one line in `authorized_keys` |
| C2 | Root or a sudo user | (a) root, key only; (b) a named user with passwordless sudo; (c) either, chosen on the card | **(c), root by default**: the installer needs full root either way, so passwordless sudo grants no less; some providers forbid root login |
| C3 | Keep SSH access after install | (a) keep the key, restricted with `from=`, removed on Disconnect; (b) remove it after Connect and use only the test service channel, which then needs root-side frames; (c) keep it, with a card control to drop it and re-add it when needed | **(a)**: settings edits, repair, Replace and Disconnect all need root; giving the service a root path would widen what a run-adjacent process can do |
| C4 | How the box is reached | (a) a private network the fleet host shares with the box (a tailnet, a VPN or a provider's private network); (b) the public internet with TLS added to the service | **(a)**: the service has no TLS today (M21) and the firewall and ACL already assume a private network; (b) is a new design |
| C5 | How box settings are written | (a) over ssh as root, re-running the installed installer; (b) a new service frame and a root-side applier on the box | **(a)**: the service stays unprivileged and its polkit rule is not widened |
| C6 | What Disconnect removes | (a) fleet side only; (b) fleet side, plus the box's service, token, push key line and ccrc's access line; (c) (b) plus a wipe of the box's data | **(b)**: nothing paired is left on either side, and the box is rebuilt anyway |
| C7 | Upgrades | (a) automatic: tool sync as today, and an installer re-run after it when the release changes units or the firewall; (b) tool sync automatic, installer re-run offered on the card; (c) both offered | **(b)**: tool sync is already automatic and safe; a root re-run restarts the service and reloads the firewall, so the operator picks the moment |
| C8 | Parity scope and expiry | (a) the five most recent merged PRs per repository, re-required on Connect, Replace and run-shaping edits; (b) the full 20-PR set plus a tmpfs repeat; (c) (a), also expiring on every release | **(a)**: it runs in minutes from a button; a release roll is already caught by the version check |
| C9 | A changed host key | (a) block every act until the operator confirms the new fingerprint; (b) accept it automatically inside a Replace; (c) accept silently on the private network | **(a), with (b) inside Replace**: Replace already shows the fingerprint for confirmation, so nothing is accepted unseen |
| C10 | Preparing the disk | (a) a prerequisite Connect only checks; (b) ccrc formats a named device | **(a)**: formatting is destructive and the device differs per provider |
| C11 | Joining the private network | (a) a prerequisite Connect only checks; (b) ccrc enrolls the box with an auth key the operator gives | **(a)**: the auth key is a secret that must not stay on the box, and enrollment differs per network |
| C12 | Where fleet-side writes land | (a) a ccrc-owned overlay file, refusing a key `ccrc.env` already sets; (b) edit `ccrc.env` in place, keeping the operator's lines | **(a)**: `ccrc.env` stays the operator's file, Disconnect removes the overlay whole, and `exposure.env` is the precedent |
| C13 | Box settings edits during runs | (a) only when no run is in progress, with "Apply when idle"; (b) at once, cancelling runs that fall back locally | **(a)**: no session loses a run to a settings change |
| C14 | Step-up | (a) for Connect, Replace, Disconnect and key acts only; (b) for every test box write | **(a)**: the account gate's split; plain value edits need a signed-in session only |
| C15 | Who supplies the repository row | (a) the operator fills it on the card, with name and fetch URL offered from the fleet's own repositories; (b) a row file in each repository; (c) by hand on the box | **(a)**: ccrc names no repository, and the card can prefill what the fleet already knows |
| C16 | What **Run parity** runs | (a) each repository row's pull-request legs, with its checkout path and test command prefilled from the fleet's own repositories, plus the test box spec §6 fixtures (git state, socket, workers) as required legs; (b) the pull-request legs only | **(a)**: §6 counts the fixtures as part of parity, and dropping them would arm a box on less proof than the hand path asked for. A run needs `gh` signed in on the fleet host; without it, parity refuses with a code |

### 5.1 Calls the author made

These settle questions a builder raised. None changes what the operator sees, and each can be overturned.

- **The `from=` address.** The access line shown at step 2 uses the fleet host's source address for the box's resolved
  address (the route lookup). Step 3 compares it with the box's `SSH_CONNECTION`. If they differ, the card says to
  re-add the line, with the corrected address.
- **Pairing keys already set by hand.** Under C12 (a), Connect refuses with a code that names the keys to remove from
  `ccrc.env`. It does not adopt them.
- **Apply release after tool sync.** If tool sync does not update the installed tree and its tag marker
  (`deploy/testbox/bin/tools-sync`), "Apply release" re-runs the installer from the tool-synced tree with its tag, as an
  extension of the same-tag path. Repair re-pushes the tag recorded on the box.
- **The card's reads in the remote arm.** A read-only `status` sub of `testbox-admin` answers the phase file and the
  box-settings snapshot. If the `testbox` op's answer grows instead, `TESTBOX_PROTO` is bumped.
- **"Apply when idle".** It waits in a detached unit under the same lock, with a 6-hour deadline and a Cancel control.
  It ends with a ledger row whichever way it ends.
- **The box's settings reader.** The verb runs `ccrc test --testbox-knobs box` from the installed tree's path, so root
  on the box never depends on a PATH.
- **Auth off.** The card says sign-in is required instead of showing a button that cannot work (the account gate needs
  auth on, a secure origin and a step-up).

## 6. Acceptance

- An installer with a prepared box (2.12) goes from **Connect a test box** to **Connected** using the card alone, with
  no shell on either box and no secret copied by hand.
- The token, the push key and the access key's private half never appear in a page, a wire frame, argv, a log or the
  ledger. A test greps the server's and the agent's outputs for each.
- The agent's exec whitelist and `FORBIDDEN_COMMANDS` are unchanged. The new op has a source-scan test that reds if it
  reaches an exec path, and is offered in `ready.ops`.
- A changed host key blocks every act until confirmed. No ssh the verb runs lacks strict host checking.
- The first install verifies Sigstore provenance on the fleet host before anything reaches the box.
- A value outside its shape is refused at the route and by the verb; the box file and `ccrc.env` are never left in a
  state their reader refuses.
- `POST /api/testbox/switch {on: true}` and `ccd testbox-remote --state on` both refuse without a matching passing
  parity record. Turning off is never refused.
- Box settings edits apply through the installer, never while a run is in progress, and parity goes stale on a
  run-shaping edit.
- Disconnect leaves no pairing file on the fleet host and, per C6, none on the box. The lifecycle rows name the verb as
  writer and Disconnect as collector.
- Every act has one ledger row with a closed act, outcome and code.
- The card works at phone, laptop and wide widths as 2.2 describes.
- No host, address, user, distribution or repository appears in code.

## 7. What is left to the build plan

- The verb's sub list and each sub's fields, codes and deadlines.
- The installer's same-tag re-run that applies a changed box file (2.7), and its test through the `TB_SYS` seam.
- How the verb streams the tarball and runs the installer under sudo for C2's sudo user.
- The route names, the cap word and the `testbox` op's `parity` field.
- The overlay's place in the one reader, the generated settings library and the settings census (C12).
- The box settings snapshot file's name and its timer.
- The parity tool's new default scope and how it writes the record.
- The ledger's retention and the coord.db migration.
- The README section and the lifecycle rows.

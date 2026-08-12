# A swap carries the whole conversation, a start restores supervision, and a dead row says why it is dead

**Status:** DRAFT 2026-08-12 — written after the 2026-08-11 incident was root-caused and the box
was re-measured. Baseline `176a8a1` on `main`; the deployed `~/ccrc/ccd/ccd` was verified
byte-identical to `ccd/ccd` at that sha on 2026-08-12, so every `ccd:NNNN` anchor below names the
same line the fleet is running. An anchor is a snapshot at spec-writing time, not a live index.
Fleet measurements were taken against the live `~/.cc-sessions` and `~/.claude*` on this box on
2026-08-12; they are reproducible with the commands quoted in §1.

**Inherits:** `2026-08-10-architecture-ddd-clean-solid.md` (rings; cross-cutting rules (a) config
is data, (b) no overloaded null at a seam, and the cross-language fixture-test enforcement idiom)
and `2026-08-11-artifact-lifecycle-policy.md` (§7 below declares this work's artifact lifecycle).

## 0. What this is, in one paragraph

On 2026-08-11 21:32 a supervise-driven auto-rescue moved `claude2-expoAI-assistant` from `claude`
to `claude-dev0` while the session sat on a permission prompt. The swap's transcript copy looked
in one guessed directory, found nothing, wrote one warning line into a log file nobody reads, and
completed anyway; the session resumed on the new account with no history. At 21:39:53 an
agent-surface `stop` removed its boot persistence, so the row went dead-but-listed and the 70MB of
history — intact under `~/.claude` the whole time — read as lost. A second session,
`claude-corp-data-internal`, had been stopped on Aug 7 through the agent surface and then restarted
by a bare `ccd start` on Aug 11, which spawned a tmux pane with **no systemd unit**: it ran
unsupervised for 22 minutes and died with nothing recording that it had. Four defects made that one
incident, and each of them is a different sentence about the same disease — *the fleet's state is
inferred from one guess instead of measured, and a failed inference is silent*. This spec fixes all
four: the swap locates transcripts by uuid instead of by a guessed path (D1); the human start path
goes through the unit instead of around it (D2); a deliberate stop becomes a recorded fact so a
dead row can say which kind of dead it is (D3); and the PWA's transcript resolver stops betting the
whole render on one munged path (D4).

## 1. Measured facts that shaped everything

**M1 — one inode, three names, in production right now.** The manual recovery left the incident
transcript as three hardlinked names under `~/.claude-dev0/projects/`:

```
$ find ~/.claude-dev0/projects -name 'b7001948*.jsonl' -printf '%i %n %s %p\n'
8828232 3 70906385 …/-data-projects-expoAI-assistant/b7001948-….jsonl
8828232 3 70906385 …/-mnt-HC-Volume-105751470-projects-expoAI-assistant/b7001948-….jsonl
8828232 3 70906385 …/-mnt-…-expoAI-assistant--claude-worktrees-converse-loop/b7001948-….jsonl
```

Any locator that copies "every match" without an inode check copies 70MB three times.

**M2 — 17 of 23 registry rows already have transcript residue under 1–4 *other* accounts.** Every
past swap left the source account's copy frozen where it was. The incident uuid alone exists in
five config dirs at five different sizes (`~/.claude` 70,013,580; `~/.claude-dev0` 70,906,385;
`~/.claude-personal` 59,311,017; `~/.claude-corp` 62,368,894; `~/.claude-gpt` 28,856,697). A
cross-account search that is allowed to win over the session's own account would render stale
history for most of the fleet. This is why the foreign-config rung in §5 is last, conditional, and
always bannered.

**M3 — the sidecar directory is the big object, and it is not always beside a `.jsonl`.** The
incident's sidecar `…/b7001948-…/` (holding `subagents`, `tool-results`, `workflows`) measures
188MB under `~/.claude-dev0` and 188MB under `~/.claude`; two more sidecars for the same uuid sit
in project dirs that hold **no** `.jsonl` for it at all. Sidecars must be globbed in their own
right, and they must not be copied byte-for-byte.

**M4 — the registry-munge rung is healthy today; the live-cwd rung is what breaks.** Sweeping all
23 rows, `<configDir>/projects/<munge(realpath(workdir))>/<uuid>.jsonl` exists for **23 of 23**.
The reproduced PWA failure (2026-08-12, screenshots on file) is therefore not a registry-munge
problem: it is a *live* session whose reported cwd had moved into a worktree while Claude Code kept
appending under its startup directory, and `resolveTranscriptFile` has no rung that falls back from
the live cwd to the registry workdir.

**M5 — three units are running without boot persistence at this moment.** `ccrc-pwa-calm-mesa`,
`data-internal-plain-harbor` and `data-internal-still-prairie` appear in
`systemctl --user list-units 'claude-session@*'` but not in
`~/.config/systemd/user/default.target.wants/`. Note precisely what this is and is not: these rows
*have* supervisors — they are active units, so auto-swap and uuid-sync are running for them — they
simply will not come back after a reboot. They are evidence for §3.2's enable-at-startup self-heal,
which fixes them, and **not** evidence for a lifecycle state; §4.2's heartbeat measures whether a
supervisor is watching, which for these three is truthfully "yes". D2 is nonetheless not a
historical defect: it is producing new instances, and this is the residue.

**M6 — the spawn confirmation returns success for a session that never came up.**
`_accept_first_run_prompts` (ccd:6835-6894) loops 450 times over `tmux capture-pane`. If the tmux
session is gone the capture fails, `$pane` is empty, no branch matches — and after ~15 minutes the
`for` loop falls out returning the status of its final `sleep 2`, i.e. **0**. The caller then prints
`started`/`ensured` and sets `started=1`. That is exactly how the 21:32:17 spawn failed quietly.

**M7 — resume-by-uuid searches across projects, but never across accounts.** The box runs Claude
Code 2.1.228 (`~/.local/bin/claude -> …/versions/2.1.228`). Per Claude Code's own sessions
documentation, recent versions resolve `--resume <id>` by looking in the current project and its
worktrees first and then every other project **in that config dir**; older ones searched only the
current project. Config dirs are per-account (`_cfg_dir`, ccd:6526-6534), so under either behavior a
swap that does not physically carry the file cannot be rescued by the CLI's own search.

**M8 — a `/cd` relocates the transcript; a tool-level chdir does not.** Claude Code moves a session
into the new directory's project storage on `/cd` (documented, 2.1.169+), and munges the *physical*
cwd. A subagent or worktree tool that changes the process cwd without `/cd` leaves the transcript
where it started while `<configDir>/sessions/<pid>.json` — the file the server reads for "live cwd"
— reports the new one. Both directions of disagreement are real, which is why §5's ladder tries the
registry workdir *and* the live cwd rather than choosing between them.

**M9 — the registry is the durable channel to the PWA; `/api/notify` is not.** Anything ccd writes
to `$REG/<id>.<field>` is on the fleet wire within one 2s watcher tick (`registry.ts` buildRecord →
`assembleFleet`). `notify.sh` → `POST /api/notify` (server.ts:315-343) emits a live bus `notice`
only: no NotifyLog record, no feed row, no web push. A notice raised at 21:32 with no socket open
is gone. A failure that matters needs both — the banner for whoever is watching, a registry field
for whoever is not.

**M10 — a new `SessionStatus` or `SessionBucket` member crashes older PWA builds.** The live fleet
frame is cast, not revived (`asFleetMsg`), so an unknown bucket reaches `RANK[bucket]` (NaN
comparator), `WORD[bucket]` (renders `undefined`) and `DOT[status]`, where
`dot.className = DOT[status].cls` **throws**. Snapshot revival is stricter still: an unrecognised
status or bucket token rejects the whole cache. The lifecycle vocabulary in §4 is therefore a new
*field*, not a new member of either union.

## 2. D1 — the swap carries the whole conversation

Today `cmd_swap` computes `mdir` once (ccd:7033) as the munge of `readlink -f <registry workdir>`
and copies exactly `$srccfg/projects/$mdir/$uuid.jsonl` (ccd:7037-7039). Claude Code writes under
the munge of *its* cwd, which diverges the moment the session moves (M8). The miss is silent: one
`>&2` line (ccd:7047-7048) that the detached-self-swap path redirects into `$REG/swap.log`
(ccd:7025).

### 2.1 The locator: find by uuid, not by path

A session uuid is globally unique, so the file can be found without guessing a directory. The
locator globs `<srccfg>/projects/*/<uuid>.jsonl` and returns every match. It is deliberately scoped
to the **source config dir only** — never a sweep across accounts (M2 shows what that would drag
in).

Matches are grouped by inode before anything is copied. For each distinct inode the content is
copied **once**; every additional name for that inode becomes a hardlink at the destination. M1 is
the case this exists for: without it, one recovered session costs 210MB per swap.

Distinct inodes are a different thing: they are genuinely different files — an old
startup-directory transcript and the relocated one it was superseded by — and they are kept
wherever keeping them costs nothing. Where two of them compete for one destination address, §2.2's
newest-wins rule decides, and the loser is dropped rather than filed somewhere it was never
written. `nullglob` is what makes "zero matches" a testable state rather than a literal
`*`-containing path that `[[ -f ]]` quietly answers no to; ccd runs under `set -uo pipefail` with
no `-e`, so the zero case must be an explicit branch, not an error that aborts anything.

### 2.2 What lands at the destination

Every match is written to the **same relative project directory** under `<dstcfg>/projects/`, so
the destination mirrors where Claude Code actually had the file. On top of that, the destination
set always includes `<dstcfg>/projects/<mdir>/<uuid>.jsonl`, where `mdir` is today's value: the
munge of the resolved registry workdir, i.e. the directory the resumed process will start in. On
2.1.228 the CLI's cross-project search (M7) makes that redundant; it is one `ln` and it keeps the
swap correct on any older CLI the box might roll back to, so it is cheap insurance rather than a
bet on a version.

**Where two matches want the same destination, the newest wins — and that rule is what makes the
`mdir` slot safe.** Mirroring source directories and always covering `mdir` collide in exactly one
case, and it is not hypothetical: a session that moved has a *stale* transcript still sitting at
its old startup munge, which for many rows **is** `mdir`. Copy both while preserving directories
and the stale one lands at `mdir` — the address the resumed process reads first — and the swap
replays the incident with a full carry. So the rule is stated once, over destinations rather than
over sources: **group the matches by destination path, and at each destination the match with the
newest source mtime wins.** A distinct older inode whose only destination is one a newer match
also claims is not copied at all; it is strictly superseded history for the same session, at the
same address, in an account that is about to hold the newer file.

Copies preserve mtime (`cp -p`). Two of this design's own rules read mtimes — §2.2's newest-wins
and §5.1's rung-5/6 ordering — and a plain `cp` stamps every destination with the time of the
swap, which would make the oldest carried transcript look like the freshest thing in the account
the moment it landed.

**Every destination write unlinks first — `cp -p --remove-destination` and `ln -f` — and this is
the subtlest requirement in D1.** Swapping a session back to an account it lived on before is
ordinary; M2 shows most rows have been round the houses, and a previous swap will have left that
account's destination names **hardlinked to each other** by step 7. Plain `cp` onto such a name
writes *through* the shared inode, so every sibling name changes with it: two sequential copies of
two distinct sources leave both destination names holding the second source (measured on this box,
coreutils 9.4). `ln` onto a name that already exists fails `EEXIST`, and since ccd runs without
`set -e` the script would sail past it and report success. Unlinking first makes each swap
re-establish the destination topology from scratch instead of editing the last swap's, which also
makes step 4's "ensure the `mdir` slot holds the newest" mean *re-point it*, never *leave whatever
residue satisfies the word "exists"*.

The sidecar rule in §2.3 is deliberately the opposite (leave an existing one alone), because a
sidecar is a tree that could be half-merged rather than a single file that can be replaced in one
step.

Order is load-bearing. `_sanitize_anthropic` (ccd:6988-7010) rewrites through
`open(f+".tmp") … os.replace(f+".tmp", f)`, which **breaks hardlinks** — the replaced name gets a
new inode and every sibling name keeps the unsanitized one. So per inode: copy → sanitize (only on
`gpt` → Anthropic, unchanged from today) → link the remaining names to the sanitized file.

| Step | Operation | Why |
|---|---|---|
| 1 | glob `<srccfg>/projects/*/<uuid>.jsonl` under `nullglob` | uuid is unique; paths are not knowable |
| 2 | zero matches → refuse (§2.4) | an empty glob must not read as an empty copy |
| 3 | group by inode (`stat -c %i`) | M1: one inode wore three names |
| 4 | build the destination map: each match's mirrored relative dir, plus `mdir`; newest source mtime wins each slot | the collision rule above |
| 5 | `cp -p --remove-destination` one name per surviving inode | a swap must not alias the source account's file; mtimes are load-bearing; unlink-first or the write goes through a previous swap's shared inode |
| 6 | sanitize that copy when `cur == gpt && target != gpt` | unchanged contract, ccd:7044-7045 |
| 7 | `ln -f` every remaining destination slot for that inode to the copy | 70MB once, not per name; `-f` because a re-swap finds the name already there |

A `cp` across config dirs — never a hardlink from source to destination — is what keeps the two
accounts independent **for the transcript**. The source's copy must stay frozen so a reverted swap
still has it, which is the same reasoning ccd:7053-7055 already gives for the tasks directory, and
it matters most for the one file that is appended to: once the resumed session writes a turn, an
aliased source would grow a conversation that account never had.

### 2.3 Sidecars

The sidecar directory `<projects dir>/<uuid>/` is copied today by nothing at all. It is globbed in
its own right — `<srccfg>/projects/*/<uuid>/` — because M3 found sidecars in project dirs with no
`.jsonl` sibling, and each one lands at **the mirror of its own source directory**,
`<dstcfg>/projects/<same relative dir>/<uuid>/`, which is what makes the brief's "beside each
jsonl" true wherever a jsonl sibling exists and still carries the ones where it does not. It is
carried as a **hardlink tree** (`cp -al`, falling back to `cp -a` if linking fails, e.g. across
devices). At 188MB per sidecar the difference between linking and
copying is the difference between a swap that takes a moment and one that takes minutes and fills
the disk; the contents are write-once artifacts, so sharing inodes between the two accounts is
safe. An existing destination sidecar is left alone rather than merged, and the swap says so — and
the copy is made with the source path stripped of its trailing slash into a destination that does
not yet exist, because `cp -a src/ dst` onto a directory that was half-created by a previous
attempt nests the sidecar inside itself.

**This is the one place a source inode is shared across accounts, and the asymmetry is deliberate.**
§2.2 forbids aliasing the transcript because it is appended to. A sidecar's contents are
write-once artifacts — tool results, subagent transcripts, workflow journals, each written and then
read — so sharing them costs nothing while a copy costs 188MB. The honest limit: this rests on an
observed property of Claude Code's checkpoint layout, not a documented guarantee. If some future
version rewrote a checkpoint in place, both accounts would see the change. What that cannot do is
damage the thing this whole spec is about — the transcript is never aliased — so the failure mode
of being wrong here is a shared checkpoint, not a lost conversation. `cp -a` without `-l` is the
fallback the moment linking fails for any reason, so a cross-device destination degrades to a slow
correct copy rather than to nothing — which is also the whole remedy if the write-once property is
ever disproved: delete one flag, pay 188MB, change nothing else. The swap logs which mode it used,
so the evidence exists if a future defect ever implicates a shared checkpoint.

The task list at `<configdir>/tasks/<uuid>/` (ccd:7056-7060) is **unchanged**, and it is worth
saying why it does not need any of this: it is keyed by uuid rather than by a munged directory, so
it was never subject to D1's defect. It keeps its `cp -r`, and it keeps the copy-don't-move
reasoning already written at ccd:7053-7055.

### 2.4 When nothing is found, the swap does not happen

**The locator runs before anything is torn down.** Today the unit is stopped and the pane killed
(ccd:7034-7036) *before* the copy is attempted, so a miss leaves a dead session as well as a
historyless one. The glob is a read; it moves to the top, where a refusal costs nothing.

One path cannot be refused *to its caller*, and it is the common one. A swap invoked from inside
the session detaches a transient unit and returns immediately (ccd:7022-7028) — the caller is dead
before the real swap starts. There the pre-flight still runs, in the detached process, and its
refusal reaches the operator exactly the way the rest of this section describes: the notify banner
and the `swapblocked` field, not a return code nobody is waiting for. That is the strongest reason
those two channels exist rather than a louder stderr line.

**A swap that cannot carry the conversation is refused, not completed.** A swap exists to move a
conversation; with no conversation found, completing it trades a session's entire history for a
rate-limit reprieve — which is precisely the trade that made the incident. The refusal keeps the
session where it is, on an account that may be throttled but still holds its file, and puts a human
in the loop. `ccd swap --force <id> <target>` performs the old behavior for the case where an
operator has looked and decided there is genuinely nothing to carry.

`--force` is an operator's word and stays one. `_auto_swap_check` never passes it; no `CCD_ARGV`
entry builds it, so no server route can reach it; and `_is_valid_wrapper` already rejects `--force`
as a target, so the flag cannot be smuggled into the positional slots. The agent's whitelist grants
`['swap']` as an argv **prefix**, which does admit a forced swap in principle — that is not a new
hole, because anything that can ask the agent to exec `ccd` can already run `ccd` with any argument
it likes, and it is called out here so the review of this flag is a decision on the record rather
than an oversight.

**The pre-flight is advisory; the authoritative glob runs after the flush.** `cmd_swap` sleeps a
second after killing the pane precisely so Claude Code can write its final entries (ccd:7036), and
a glob taken before the teardown can only be a decision about whether to tear down at all. The copy
re-globs after that sleep, and it is that second answer the swap acts on — otherwise the carried
file would be missing the last thing the session said, which for a session being moved mid-turn is
the most valuable line in it.

The pre-flight can still be overtaken, and the honest race is not the one it looks like. A `/clear`
does not remove the file — it rotates the uuid, and `_sync_uuid` writes the new one into the
registry, so a swap that pre-flighted `uuid-A` can reach its copy step holding `uuid-B`. The
locator therefore re-reads the uuid after the teardown and globs for **that** uuid, which is the
one the resumed session will ask for; a genuinely vanished file (a reaped worktree, a deleted
config dir) is the other, rarer case. Either way the post-teardown refusal **restarts the session
on its original account** — registry `wrapper` is untouched at that point, so
`systemctl --user start claude-session@<id>` puts it back where it was, falling back to
`cmd_ensure` exactly as the successful swap's own tail already does (ccd:7066).

That restart must not masquerade as a swap landing. `_spawn` reads `lastswap` and treats a spawn
within 300 seconds as a swap arrival, answering the big-transcript resume gate with "resume from
summary" — an auto-compaction. A refusal that set `lastswap` would therefore compact the very
history it refused in order to protect. `lastswap` is written only by a swap that completed.

**A refusal is visible in three places, one of which survives nobody watching.** It writes
`$REG/<id>.swapblocked` as `<epoch> <reason>` (M9: the registry is the durable channel, on the wire
within 2s and rendered on the row), it calls `$REG/notify.sh` — the same hook the successful swap
already fires at ccd:7068, so the banner rides a pipeline that is deployed and working — and it
still appends to `swap.log`. The field is cleared by a subsequent successful swap and by any
deliberate revival of that id — `ccd start`, `ccd enable` **and `ccd ensure`**, because `ensure` is
what `POST /api/sessions/:id/ensure` actually sends, and a revive control that leaves the refusal
banner standing on the row it just revived teaches the operator to ignore banners.

**The refusal does not enter the reap protocol's token vocabulary, and that is a decision.**
`server/test/wsaudit.test.ts` greps ccd's source for four literal emission shapes —
`_reap_refuse <token> "…"`, `printf '{"refused":"<token>",…}'`, `printf '"verdict":"<token>"'` and
`'!<token>` — and requires every token it finds to have a sentence in `wsaudit.ts`'s `SENTENCES`
map, in both directions. That contract belongs to the workspace audit/reap protocol, which answers
a machine over a documented refusal vocabulary. A swap refusal answers a human on stderr and a row
in the registry; it is deliberately **not** written in any of those four shapes, so it neither
joins that vocabulary nor breaks its totality. This is written down because the tempting way to
express "refused" in this codebase is `printf '{"refused":"…"}'`, and reaching for it here would
fail `wsaudit.test.ts` for a reason the author would not expect.

**Auto-swap does not retry a refused swap on a five-second heartbeat.** `_auto_swap_check`
(ccd:6728) skips a session whose `swapblocked` stamp is younger than 30 minutes, so one refusal
produces one banner and one field, not 720 of each per hour.

## 3. D2 — the human start path restores supervision instead of routing around it

`cmd_start` (ccd:6951) and `cmd_ensure` (ccd:6971) both call `_spawn` directly. `cmd_stop`
(ccd:7101) is `systemctl --user disable --now`. So stop-then-start yields a tmux pane with no unit:
no supervise loop, therefore no `_sync_uuid`, no `_auto_swap_check`, no `_auto_compact_check`, and
no record when it dies. M5 says three sessions are in that state now.

### 3.1 The unit spawns; the verbs ask the unit to

`ccd start` and `ccd ensure` become `systemctl --user enable --now claude-session@<id>`, and the
unit's `ExecStart` (`ccd supervise %i`) does the spawning it already does. `cmd_enable` keeps its
name and becomes an alias in behavior — it is the same act — but is not removed, because the agent
whitelist and `CCD_ARGV` grant both words separately and layer 3 of `whitelist-subset.test.ts`
fails on a grant no route builds.

When systemd is unavailable (no unit installed, no lingering), the verbs fall back to today's
direct `_spawn` and **say so loudly** on stderr. A start that cannot be supervised is still better
than no start; a start that is silently unsupervised is the defect.

**Delegating the spawn makes it asynchronous, and the verbs still have to answer.** `enable --now`
returns when systemd has *started the unit*, not when a pane exists — but `ccd attach` and
`ccd menu` call `cmd_ensure` and then immediately `exec tmux attach` (ccd:7179-7181, ccd:7204-7206),
which would race a pane that does not exist yet, and §3.3 requires a failed spawn to be reported
rather than assumed. So the start path **waits on observables** rather than returning blind:

- `_spawn` writes its verdict to `$REG/<id>.spawn` as `<epoch> <rc>`, always, before returning.
  This costs nothing — `_spawn` already runs inside the supervisor — and it turns a verdict that
  used to exist only in one process's exit code into a fact the CLI, the tests and the PWA can all
  read.
- `cmd_start`/`cmd_ensure` outside a unit poll for up to 30 seconds for either `_alive` (the pane
  exists — success, exactly as today, since the TUI may still be working through a long resume) or
  a `spawn` stamp newer than the moment they started with a non-zero rc (report that rc). Neither
  within the window is itself a failure worth reporting: "the unit started and no pane appeared".
- A pane appears within about a second of the unit starting, so the 30 seconds is a bound on
  failure reporting, not a cost anybody normally pays. `attach` and `menu` are safe on the far side
  of it.

Before `enable --now`, the start path runs `systemctl --user reset-failed claude-session@<id>`.
§3.3 deliberately creates failed units — that is the point of the start limit — and a unit sitting
in `failed` refuses to start again until its failure is cleared, so without this the very verb this
spec advertises as "what revives it" would not.

### 3.2 The recursion guard is an in-process variable, not `INVOCATION_ID`

`cmd_supervise` calls `cmd_ensure`; if ensure re-entered `systemctl start` on its own unit the
supervisor would be asking systemd to start the thing systemd is currently starting. The obvious
discriminator is wrong: `_dispatch_swap` (ccd:6564) runs `ccd swap` inside its own transient
`systemd-run` unit, and `cmd_swap`'s tail falls back to `cmd_ensure` (ccd:7066) — so
`INVOCATION_ID` is set in a context that genuinely *should* go through systemd. `cmd_supervise`
instead sets an internal shell variable before calling `cmd_ensure` in-process. It cannot be
reached from outside: the agent's exec whitelist matches argv prefixes, so an added argv token
would be permitted, whereas a shell variable set inside one function's own process is not
addressable from the wire at all.

Creating the enable symlink *is* idempotent and safe from inside the unit, so the supervisor does
that once at startup (`systemctl --user enable`, no `--now`). That single line heals M5's three
rows the next time each supervisor restarts, with no fleet-wide scan anywhere.

### 3.3 A spawn reports what actually happened

`_accept_first_run_prompts` gains two verdicts and loses its silent success (M6):

| rc | Meaning | Caller behavior |
|---|---|---|
| 0 | a live marker appeared — the TUI is up | proceed, `started=1` |
| 2 | a login screen (unchanged, ccd:6886-6891) | warn naming id and wrapper; no `/effort` injection |
| 3 | the tmux session vanished mid-poll | fail loudly; do not report success |
| 4 | the window expired with no marker | fail loudly; do not report success |

`_spawn` propagates a non-zero rc **and records it** in `$REG/<id>.spawn` per §3.1, which is how a
verdict raised inside the supervisor reaches a `ccd start` running in another process. rc 3 also
ends the 15-minute wait immediately, which is a bug fix in its own right: today a vanished pane
costs a quarter of an hour of polling a session that is not there.

The unit's `[Service]` gains `StartLimitIntervalSec` and `StartLimitBurst` so a session that dies
instantly becomes a *failed* unit rather than an invisible restart loop. A failed unit has no
supervisor, so it heartbeats nothing and §4.3 classifies it `orphan` — which is the honest answer
to the only question the row has to answer: nothing is bringing this back, and `ccd start <id>`
is what would. §3.1's `reset-failed` is what makes that sentence true rather than aspirational.

### 3.4 One-arg id form, and a start that stops rewriting the account

`ccd start <wrapper> <project>` recomputes the id from its two arguments. A swapped session keeps
the id it was born with (`claude2-expoAI-assistant` stays that even while its `wrapper` field reads
`claude-dev0`), so an operator reading the account off the board and typing it back mints a
*different* id. `cmd_start` and `cmd_enable` gain the one-argument id form `ccd start <id>`, exactly
as `cmd_stop` did and for the reason its comment already records (ccd:7101-7113).

The two-argument form also stops clobbering the account. Today `cmd_start` unconditionally
`_reg_set`s `wrapper` from its argument (ccd:6963), so `ccd start claude2 expoAI-assistant` on a
session living under `claude-dev0` rewrites the registry to an account whose config dir does not
hold the transcript. For an existing row the registry `wrapper` wins and a differing argument is a
warning; `ccd swap` remains the only verb that moves a session between accounts.

## 4. D3 — a stopped session and a dead one stop looking alike

Nothing reconciles registry rows against reality. `ccd ls` prints `ALIVE=no` for a session that was
deliberately stopped, one that died, and one that never started — three different facts, one word.

### 4.1 Stop intent becomes a recorded fact

The stamp is `$REG/<id>.stopped`, containing `<epoch> <surface>` where surface is drawn from the
closed set `cli | pwa | agent | ccd | unknown`. Epoch and surface share one field rather than
taking one each, because the registry is read per-field per-session on a 2s tick: this design adds
four fields to `buildRecord`'s current seventeen — `stopped` and `supervised` here, `swapblocked`
from §2.4, `spawn` from §3.1 — and packing epoch-with-surface is what keeps `stopped` one read
instead of two.

**The surface arrives as an argv flag, because nothing else can carry it.** The obvious mechanism
is an environment variable, and it does not work: the exec seam is
`Runner = (cmd: string, args: string[]) => Promise<ExecResult>` (`server/src/exec.ts:4`), which
takes no env locally, and the agent's wire `ExecReq` carries `{cmd, args, timeoutMs}` and nothing
else. A `CCD_SURFACE` variable would therefore only ever report the server process's own
environment, identically for every caller, and every stop in the fleet would record the same word.
So `cmd_stop` takes `--surface <word>`, and to keep that safe its argument parsing strips flags
**before** applying the arity rule that makes `$# -ge 2` mean wrapper-plus-project — otherwise
`ccd stop <id> --surface pwa` reads as a two-argument stop of a session named `--surface`. The word
is validated against the closed set on arrival and anything else becomes `unknown`, because it is
text from the wire being written into the registry.

It records a **declaration, not an authentication**: `--surface pwa` means the caller said it was
the PWA. A session that shells `ccd stop` from its own Bash tool passes no flag and records `cli`,
which is honest — that is exactly what it looks like from the box.

**Every deliberate unsupervise stamps, in one place.** `_ws_unsupervise` (ccd:216) is already the
single choke point: `ws-rm` (ccd:1289), `ws-archive` (ccd:1814), `ws-reap` (ccd:5681) and `forget`
(ccd:7155) all reach systemd through it, and `cmd_stop` inlines the same two commands rather than
calling it. The stamp goes **inside `_ws_unsupervise`** with an optional surface argument
defaulting to `ccd`, and `cmd_stop` is rewritten to call it with its own `--surface` value. Its
mirror, `_ws_supervise` (ccd:214), **clears** the stamp. That is two one-line changes covering
every path in the file, and it forecloses the failure the alternative invites: `ws-archive`
disables a unit without a stamp, so an archived workspace would classify as `orphan` forever.

The stamp is also cleared by `ccd start`, `ccd enable` and any successful spawn — reviving a
session is an explicit intent that supersedes the earlier stop.

### 4.2 Supervision is measured by a heartbeat, not by asking systemd

The server cannot ask systemd anything: the agent's read whitelist permits `~/.cc-sessions`,
`~/.cc-limits`, `~/.cc-clips`, `~/.claude*` and the projects root, and nothing under
`~/.config/systemd` (`checkPath`, `agent/src/whitelist.ts:64-92`). Rather than widen a security
boundary to learn a fact, the supervisor publishes it: `cmd_supervise` stamps
`$REG/<id>.supervised` with the current epoch, and `_ws_unsupervise` removes it alongside the stop
stamp. A stamp younger than 120 seconds means *a supervisor is watching right now*, which is
strictly more useful than an enable symlink — the symlink promises a start at next boot, the
heartbeat proves that auto-swap, uuid-sync and auto-compact are actually running for this row.
Both ccd and the server read it from a directory both already read, local and remote alike, with no
new grant, no new verb and no systemd introspection.

**The first stamp is written before `cmd_ensure`, not after it.** `cmd_supervise` calls
`cmd_ensure` and only then enters its watch loop (ccd:6980-6986), and `cmd_ensure` can sit inside
`_accept_first_run_prompts` for up to fifteen minutes while a 700k-token resume works through its
gates. A heartbeat that started with the loop would leave every large resume reading
`unsupervised` for those fifteen minutes — the loudest possible false alarm, fired precisely when
the fleet is doing the most work. So the supervisor stamps on entry, then re-stamps every 30
seconds from the loop it already runs on a 5-second tick.

**A swap refreshes the heartbeat while it works.** `cmd_swap` stops the unit, carries the files and
starts it again; between those the row is not alive and, after 120 seconds, would stop looking
watched. A 70MB `cp` does not take 120 seconds, but §2.3's `cp -a` fallback over a 188MB sidecar
can, and "the fleet marked a session abandoned while it was being carefully moved" is the precise
kind of dishonesty this section exists to remove. So the swap re-stamps as it goes, and the window
classifies as `restarting` — which is exactly what it is.

### 4.3 One classification, two implementations, one fixture

The ladder is a pure function of four inputs — pane alive, supervisor-heartbeat freshness, stop
stamp, `started` — and it is evaluated in this order:

| alive | supervisor | stop stamp | `started` | State | Meaning |
|---|---|---|---|---|---|
| yes | fresh | — | — | `running` | supervised and up |
| yes | stale/absent | — | — | `unsupervised` | a pane with no supervisor — what a pre-fix `ccd start` minted: no auto-swap, no auto-compact, no uuid-sync, and nothing to record its death |
| no | — | present | — | `stopped` | somebody stopped it, and the row says who and when |
| no | fresh | absent | — | `restarting` | between `Restart=always` cycles; not a fault |
| no | stale/absent | absent | `1` | `orphan` | it ran and is gone with nothing watching |
| no | stale/absent | absent | not `1` | `never-started` | a registry row that never had a session |
| any input unreadable | | | | `unmeasurable` | the registry could not be read; never inferred as orphan |

`unmeasurable` exists because remote `readFile` collapses "missing", "forbidden" and "agent
disconnected" into one `null` (`remote/io.ts`), and the architecture doc's rule (b) forbids a seam
value that stands for more than one condition. An unreadable registry must not print `orphan`. The
input the classifier takes is therefore three-valued per field — present, absent, unreadable — and
`unmeasurable` is what any unreadable input produces; the discrimination happens in the registry
reader, which already distinguishes measured from unmeasured fields for exactly this reason, not
in the classifier, which is pure.

The stop stamp is checked before the heartbeat in the not-alive branch so that a stop taken within
the heartbeat's 120-second freshness window reads as `stopped` immediately.

**What `orphan` claims, and what it does not.** It says: *nothing is watching this session and
nobody recorded stopping it.* It does not claim the unit file is absent — the server cannot see
systemd at all (§4.2), so a unit that is enabled but `failed` (§3.3's start limit) and one that
was never enabled both land here. That conflation is deliberate and it is safe, because the two
have the same answer: nothing is bringing this session back, and `ccd start <id>` is what would.
The brief asked to distinguish "enabled+inactive" from "no unit"; the heartbeat answers the
question those two were proxies for, and answers it about the thing that actually matters —
whether auto-swap, uuid-sync and auto-compact are running — rather than about a symlink.

An **archived** row never reaches this table. `ws-archive` deliberately unsupervises a workspace,
and §4.1's stamp inside `_ws_unsupervise` is what stops every archived workspace in the fleet from
reading `orphan`; the bucket ladder already routes those rows to `archived`/`cleanup` and the
lifecycle field is not consulted for them.

The function lives in `shared/` as a pure decision (L0/L1: narrow inputs, typed union out), and ccd
carries a bash twin, `_session_state`, for the `ccd ls` STATE column. Two implementations of one
rule is the shape this repo already polices with a **cross-language fixture test** — the
enforcement mechanism the architecture doc names — so the table above ships as a fixture that both
the TypeScript function and the sourced bash function are driven against, row for row.

`unmeasurable` is the one row the bash twin cannot reach: ccd reads `$REG` off local disk, where a
read either works or the file is genuinely absent, so the state exists only on the server's side of
the seam. The fixture marks that row server-only rather than leaving the bash side to fail it, and
says why — a fixture with an unexplained exemption is how a second exemption gets added later.

### 4.4 Where it surfaces, and what revives what

`ccd ls` replaces its `ALIVE` column with `STATE`. The blast radius is zero parsers: nothing in
`server/`, `agent/` or `pwa/` shells `ccd ls`, no test invokes it, and `cmd_menu` formats its own
list. The trailer's `_gpt_status` strings are pinned verbatim by `server/test/ccd-limits.test.ts`
and are not touched.

On the wire, lifecycle is a **new optional field on `FleetSession`**, not a new `SessionStatus` or
`SessionBucket` member (M10: an older PWA throws on an unknown status). Buckets keep their current
ladder exactly; a dead row stays in the `dead` bucket and gains a qualifier — "stopped by pwa, 2d
ago", "orphan — nothing is watching it", "running unsupervised". Snapshot revival treats an absent
lifecycle as `null`, which is what every cached row written before this build will carry.

There is deliberately **no reconciler daemon and no `ccd doctor`**. Repair is the verb that already
means repair: D2 made `ccd start <id>` restore supervision, and `start` is already whitelisted and
already a PWA control. So "what would revive it" is a sentence the row can print and a button the
operator already has, and no automatic process ever restarts a session a human deliberately stopped
— the 21:39:53 stop was deliberate, and a reconciler that could not tell would have fought it.

The revive control needs no enrolment at all, which is worth checking rather than assuming.
`POST /api/sessions` builds `CCD_ARGV.start(wrapper, project, workdir)` (server.ts:562) — the
two-argument form §3.4 shows minting the wrong id for a swapped session — but that route is for
*creating* a session. Reviving an existing row goes through `POST /api/sessions/:id/ensure`
(server.ts:566), which sends `CCD_ARGV.ensure(id)`: already keyed by id, already whitelisted,
already ungated by decision. Because §3.1 makes `ensure` restore supervision, that existing button
becomes the revive button with no new argv, no new grant and no new caps line. The one-argument
`ccd start <id>` in §3.4 is for the operator at a terminal, who is the one who was typing the
wrong id.

## 5. D4 — the resolver stops betting the render on one path

`resolveTranscriptFile` (`server/src/transcript/resolve.ts:55-65`) munges the directory it is
handed — the live cwd for a live session, the registry workdir otherwise — tries the resolved munge
and then the raw munge of *that one directory*, and gives up. It has no rung that crosses from one
directory to the other, which is M4's reproduced failure, and no rung that searches by uuid, which
is what a swapped-away session needs.

### 5.1 The ladder

Existence-first, in order, first hit wins:

1. resolved munge of the directory given (live cwd when live) — today's rung 1;
2. raw munge of the directory given — today's rung 2;
3. resolved munge of the **registry workdir**;
4. raw munge of the registry workdir;
5. `<configDir>/projects/*/<uuid>.jsonl` — newest mtime wins, duplicates collapsed (M1: the fleet
   holds hardlinked duplicates today, and three names for one file must not read as three
   candidates);
6. `<otherConfigDir>/projects/*/<uuid>.jsonl` across the other accounts in the roster — matches
   from all accounts **pooled**, newest mtime winning globally, same collapse — used **only** when
   1-5 all miss, and always rendered with a banner naming the account that holds it. Pooled rather
   than first-account-in-roster-order because M2's five copies of one uuid differ by weeks and the
   newest is the one the operator means; ties break by roster declaration order, then by path, so
   the answer is deterministic and a test can pin it;
7. the raw munge of the directory given, exactly as today, so a tailer pointed at a
   not-yet-existing path keeps working for a session that later writes there.

Rungs 3 and 4 are the fix for the live-session case; rung 5 is the fix for a session whose
transcript moved within its own account; rung 6 is the safety net for history stranded by a swap
that happened before D1 shipped — which, per M2, is 17 of 23 rows' worth of residue sitting on disk
right now. The account list for rung 6 comes from the roster via `configDirFor`, never a literal
list of account names in this module (architecture rule (a)).

**The order is liveness-dependent on purpose.** A live session's rungs 1-2 are the live cwd and its
rungs 3-4 the registry workdir; a dead session's caller passes the registry workdir as `dir`, so
1-2 and 3-4 coincide and four candidates collapse to two. A session with transcripts at both
addresses can therefore render one file while it is alive and the other once it is dead. That is
the correct preference, not a wobble: while the process is up, the cwd it publishes in
`<configDir>/sessions/<pid>.json` is direct evidence about where it is working, and the registry
workdir is only where it was started. When that evidence expires, the ladder falls back to the
durable fact. Stated here so a reader who notices the asymmetry finds an argument rather than a
bug.

**The two sides of this fix dedupe differently, and that is deliberate.** `FleetIO.stat` answers
`{ mtimeMs, size } | null` (`server/src/io.ts:16`) — there is no inode on the seam, and the remote
`stat` op does not carry one either. So the server collapses candidates on `(size, mtimeMs)`:
hardlinked names share both exactly, and two genuinely distinct files agreeing on size to the byte
*and* mtime to the millisecond are, for the purpose of "which of these do I open", the same answer.
Extending the port, the agent protocol and the wire payload to carry an inode would be a
cross-package change earning nothing the pair already earns here. ccd is not on that seam and
**does** use the real inode (`stat -c %i`, §2.1), because there the dedupe decides whether 70MB is
copied three times rather than which of two identical files is displayed.

### 5.2 The answer becomes a typed outcome, not a bare path

Rung 6 has to tell the UI something rung 1 does not, and rung 7 has to be distinguishable from a
hit. A single `string` return cannot carry that, and rule (b) forbids inventing a null that means
two things. `resolveTranscriptFile` returns a discriminated union carrying the path, the rung that
produced it, and — for rung 6 — the account it was found under. `found` versus `fallback` is the
distinction the PWA renders as "stranded history, held by `claude`" instead of today's "No messages
yet" over a file that exists.

The fallback arm carries one more bit, and it is the one rule (b) is really about: **whether the
search was complete**. "I looked everywhere and there is no transcript" and "a `readdir` answered
null so rungs 5 and 6 never ran" are different facts, and §5.5 makes the second one routine in
remote mode. Collapsing them would reproduce the exact defect this spec exists to fix, one seam
further out — an unmeasured absence rendered as a measured one. So the fallback arm is
`{ path, complete: boolean }`, and a `complete: false` fallback renders as "can't read the fleet
host right now", never as "no messages". `SessionStream`'s existing `Resolution` union already
speaks this language with its `unmeasurable` versus `absent` reasons (sessionws.ts:141-148); this
is the same distinction, one layer down.

All three callers (`sessionws.ts:408`, `watch.ts:1238`, `commands.ts:65`) take the path off the
union, and each decides what it will accept — the ladder decides where the file is, the caller
decides whether that is good enough for what it is about to do. Rungs 1-5 are unconditional for all
three: a name, a slash-command list and a chat should all follow a transcript that moved inside its
own account. Rung 6 is asked for only by the session stream, which can show the operator a banner
saying whose history this is. The background name sweep does not ask for it, because a derived name
is written into the row with no banner attached to it, and a name silently taken from another
account's frozen copy is the kind of quiet wrongness this whole spec exists to remove.

### 5.3 An open stream follows the answer when it changes

Today a session's transcript path is a function of `(cwd, uuid)`, and `SessionStream.tick()` leans
on that: it re-points the tailer and resends backlog only when `data.uuid !== this.uuid`
(sessionws.ts:473-478). A ladder makes the path free to change while the uuid stays put — most
usefully when a swap lands and rung 5 starts hitting where rung 1 was missing a moment ago — and
the current code would keep tailing the old address forever.

So the re-point rule becomes explicit: on each tick, when the resolved outcome differs from the one
being tailed, re-point (and resend backlog, with the existing `rotated` frame) if the new answer
comes from a **strictly better rung** or if the file currently being tailed no longer exists.
"Better" is the rung order in §5.1, which is why the rung travels in the union rather than being
recomputed by the caller. A same-rung, same-path answer changes nothing, which is the common case
every tick.

The resume contract needs the same treatment. `since` is `{ uuid, offset }` (sessionws.ts:126) and
is honored when `since.uuid === r.data.uuid` (sessionws.ts:137-139) — an offset into a file the
client never named. Once one uuid can resolve to different files, a reconnect can replay an offset
taken in one file against a different one and render a transcript from its middle. The frames the
client echoes therefore carry the resolved file alongside the uuid, and `sessionws` discards the
offset and resends the full backlog whenever the echo does not match what it is about to tail.
This is strictly a widening of an existing hazard, not a new one — `dir` is the live cwd today, so
a session that moves already changes its own path for a fixed uuid — and it is pinned here because
this work makes it common.

### 5.4 Cost: a cheap common path, and a memo for the expensive one

`SessionStream` resolves on every 2-second poll for the life of every open socket (`POLL_MS`,
sessionws.ts:15, :167, :456), and `watch.ts`'s name sweep resolves per eligible workspace row on
the same 2-second tick. A seven-rung ladder run naively at that cadence would be a real regression,
and it would fall hardest on exactly the sessions this spec is for: the ones where rungs 1-4 miss.

Two mechanisms, in this order.

**The short-circuit is structural.** Rungs 5 and 6 run only when 1-4 have all missed. A healthy
session answers at rung 1 or 2 — one realpath walk and one or two stats, which is what today
already costs — so the common path does not get slower, and only a session with nothing at any
exact path pays for a search.

**The memo bounds the rest.** The resolver keeps its last winning outcome per
`(configDir, uuid, dirGiven)`. A subsequent call re-validates with a single `stat` of that path and
returns it; the full ladder re-runs only when the winner has vanished, the key has changed, or —
for a `fallback` or a rung-6 answer, the two that mean "keep looking" — a back-off timer has
expired. Steady state is therefore **one stat per session per tick**, which is cheaper than today's
found case, and a broken session pays for a full search on a back-off rather than every two
seconds.

The memo is state, so it does not live in the decision function. The ladder stays pure — narrow
deps in, typed union out, testable with no clock — and the memo wraps it at the caller, one
instance per `SessionStream` and one for the watcher's sweep. That is the ring boundary this repo
already draws between deciding and acting, and it is also what keeps the ladder's own tests free of
timing.

### 5.5 Remote degradation, stated rather than accidental

Remote `realpath` answers `null` unconditionally, so rungs 1 and 3 collapse into 2 and 4 — that is
today's documented behavior and it does not change. Rungs 5 and 6 need `readdir` and `stat`, which
the remote io *does* implement and which `checkPath`'s `.claude*` glob permits for exactly these
paths (`agent/src/whitelist.ts`'s `underClaudeGlob`), so the uuid search works remotely with no
change to the read whitelist. Where `readdir` answers `null` the rung is skipped, the ladder
continues, and the outcome is marked incomplete per §5.2 — it is never read as "no transcript
exists". That marking is the whole point: remote `readdir` returns `null` for a missing directory,
a forbidden path and a disconnected agent alike (`remote/io.ts`), and this design refuses to turn
that ambiguity into a confident empty chat.

## 6. Non-goals — rejected here so nobody relitigates them

**No reconciler daemon, no timer unit, no `ccd doctor` verb.** A new gated verb costs a caps line, a
dispatcher arm, a `CCD_ARGV` entry, an agent whitelist grant and four cross-package drift tests. The
brief asked for a pass that restarts `enabled+inactive` rows; what replaces it is threefold and
already specified — §3.2's supervisor self-heal fixes the class M5 measured, §4.3 classifies every
row on evidence the server can actually read, and §4.4 makes `ccd start <id>` the one revive path,
reachable from the CLI and the PWA alike. What is genuinely given up is *unattended* restart of a
row nobody is watching, and that is given up on purpose: the incident's stop was deliberate, and an
unattended restarter is the one component that could have fought it.

**No auto-restart of anything.** Not orphans, not stopped rows, not failed units. The incident's
stop was deliberate and a machine cannot tell that from a crash without the stamp — and with the
stamp, the operator can see it and press the button.

**No explanation of the munge cutover.** The incident's live transcript sat under a worktree munge
whose directory was born Jul 28, with the cutover observed between Aug 10 06:00 and Aug 11 21:32.
The uuid locator makes the mechanism irrelevant by construction; chasing it is not a prerequisite
and this spec does not block on it.

**No move, ever, and no source is destroyed.** Both the swap carry and every resolver rung are reads
and copies; no transcript is deleted or relocated from the account that holds it. §2.2's
unlink-first destination writes are not an exception to this: what they replace is a *destination
name* — residue from an earlier swap onto that same account — with the newer content of the very
same session, which is the whole point of carrying it. Source history is never touched.

**No new `SessionStatus`/`SessionBucket` member, and no bucket-ladder change.** M10 is the reason;
a dead row's *kind* of dead is a qualifier on the row, not a new sorting class.

**No widening of the agent's read whitelist.** §4.2 chose a heartbeat over systemd introspection
precisely so this stayed true.

## 7. Artifact lifecycle declaration

Per `2026-08-11-artifact-lifecycle-policy.md`, this work introduces **no new artifact class**. It
changes the volume of one existing class, the conversation-transcript pool, and it changes it
downward relative to the naive fix: a swap writes one copy per *distinct inode* found under the
source account (M1: without the inode rule, three names would have cost 210MB), and carries
sidecars as hardlinks, whose marginal cost is directory entries rather than the 188MB they measure
(M3). Retention of the transcript pool remains the policy's open question; nothing here presumes an
answer, and nothing here deletes.

The new registry fields — `stopped`, `supervised`, `swapblocked` — are session-scoped, tens of
bytes each, and removed with the row by `_reg_purge` (ccd:110), which `cmd_forget` (ccd:7120) and
the workspace reap already call, exactly as every existing field is.

## 8. Rollout order and dogfood

Rollout follows the house order — **fleet host first, then server, then PWA** — because a PWA that
renders a field the box does not write yet is merely empty, whereas a server that requires a verb
the box lacks is broken:

1. **ccd** (D1 locator and refusal, D2 supervised start and spawn verdicts, D3 stamps and
   `_session_state`, the unit's start limit). Deployable and useful alone: after this step a swap
   carries its history, a start restores its unit, and `ccd ls` tells the truth.

   The deploy already does the two things this step depends on. It copies
   `ccd/claude-session@.service` into `~/.config/systemd/user/` and runs `daemon-reload`
   (`deploy/deploy.sh:205`, `:256`), so the new start limit lands the same way every other unit
   change has. And its supervisor sweep runs `systemctl --user try-restart "claude-session@*"`
   (`deploy/deploy.sh:281`) because a live supervisor otherwise keeps executing the pre-deploy ccd
   for days — which means §3.2's "the supervisor creates its own enable symlink at startup" runs
   fleet-wide on the first deploy, and M5's three unsupervised rows heal without anyone typing
   anything. `KillMode=process` keeps the tmux substrate alive across that restart and
   `cmd_ensure` re-attaches rather than spawning a second session, so the sweep stays a no-op for
   healthy rows — a property §3.1 must not break, since `cmd_ensure`'s in-unit path is exactly
   what the sweep re-enters.
2. **server + shared** (the lifecycle function and its fixture, the four new registry reads, the
   resolver ladder and its outcome union).
3. **PWA** (the lifecycle qualifier on the row, the stranded-history banner).

It is done when: a swap of a session whose transcript sits under a worktree munge lands the file in
the target account and the resumed session shows its history; a swap of a session with no findable
transcript refuses, leaves the session running where it was, and shows a banner **and** a persistent
row marker; `ccd stop` followed by `ccd start` leaves the unit enabled and the supervisor
heartbeating; a session whose pane dies instantly reports failure instead of printing `ensured`; the
three rows named in M5 appear in `~/.config/systemd/user/default.target.wants/` after the first
deploy, without anyone typing anything; a row stopped from the PWA reads `stopped (pwa)` and a row
that died unwatched reads `orphan`, with the revive control naming `ccd start <id>`; and the PWA
renders the chat of a live session whose cwd has moved into a worktree, plus the stranded history of
a pre-fix swapped session under a banner naming the account that holds it.

Each defect owes specific tests, and they are the ones a mutation sweep can actually earn:

| Defect | The tests that must exist |
|---|---|
| D1 | multi-directory uuid glob carries every match; hardlinked source names cost one copy and N links; destination collision resolves to the newest source mtime; sidecars carry, including one with no `.jsonl` sibling; zero matches refuse, leave `wrapper` unchanged, restart the session, and stamp `swapblocked`; a `gpt`→Anthropic swap still sanitizes, and the sanitized file is the one the links point at |
| D2 | `stop` then `start` leaves the unit enabled; `ensure` inside the unit does not re-enter `systemctl start`; `attach` finds a live pane; a vanished pane returns rc 3 without waiting out the window; an exhausted window returns rc 4; a failed unit is revived by `start` (the `reset-failed` path) |
| D3 | the stamp records epoch and a validated surface, and an unknown word normalizes; `_ws_unsupervise` stamps from every call site and `_ws_supervise` clears; the classification table, driven from one fixture through both the TypeScript function and the bash twin; an unreadable field yields `unmeasurable`, never `orphan` |
| D4 | each rung wins in its own fixture; the registry-workdir rungs rescue a live session whose cwd moved; the glob rung dedupes identical `(size, mtimeMs)` candidates; a foreign-config hit is bannered and never reached while an own-account answer exists; a null `readdir` yields an incomplete fallback rather than an absence; the memo re-validates with one stat and re-ladders when its winner disappears |

Every behavior above is proved by a test before it is written, the whole diff is mutation-swept with
literal mutants, and the cross-package drift pins must stay green: `whitelist-subset` (whose
token-for-token `EXPECTED` table gains the `--surface` argv from §4.1, the single enrolment this
whole design costs), `verb-gate`, `single-definition`, and the caps↔dispatcher parity test in
`ccd-archive.test.ts` — this work adds **no new verb**, so any movement in the caps list is a
mistake, not a migration.

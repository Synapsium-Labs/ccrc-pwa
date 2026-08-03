# The branch takes the name the model already wrote

**Status:** design, approved 2026-08-03. Closes a decision the workspace-lifecycle
spec deliberately deferred.

**Depends on `2026-08-03-ccrc-caps-refresh-design.md`, which lands first.** Without
its caps refresh the agent reads `ccd caps` once per process
(`agent/src/server.ts:417`), so a fleet whose ccd gains the new `ws-rename` keeps
refusing it until someone restarts the agent — the fourteen-hour outage that spec
documents.

A workspace is born `soft-prairie` — an adjective and a noun drawn at random from
a 12×12 table (`ccd:757-762`), fixing the session id, the worktree directory, the
tmux session, the systemd unit, the registry key, the claude.ai session name, and
a branch `ws/soft-prairie` (`ccd:898`). The name says nothing about the work.
Measured 2026-08-03: five of the fourteen live sessions on this fleet are two-word
slugs no one can map to a task without opening them — `amber-basin`,
`brisk-prairie`, `clear-mesa`, `still-prairie`, `soft-prairie`. The other nine are
main checkouts with no slug at all.

Meanwhile Claude Code has already written the name. Every transcript carries a
line the model generated from the first prompt:

```json
{"type":"ai-title","aiTitle":"Brainstorm Helix and slide notes integration","sessionId":"5016f833-…"}
```

That is `custom-tools-brisk-prairie`, whose branch reads `ws/brisk-prairie`.
Nothing consumes the title. `transcript/ask.ts:12` lists `ai-title` among the line
types it knows about and skips.

**This spec makes the branch take that name.** No new model call, no API key, no
credits: the name already exists and was already paid for.

## What the lifecycle spec deferred, and why this is that

`2026-07-28-ccrc-workspace-lifecycle-design.md:84-88` built `ws-rename` and then
stopped short:

> **Not in this spec: deciding the name automatically.** Session display names are
> already descriptive … so deriving a branch from them is tempting and probably
> right — but choosing the `type/` prefix is a judgement call, and that belongs
> with Phase 2's agent-authored PR flow.

That spec built the *mechanism* and left the *policy*. This spec is the policy.
It resolves the deferred judgement call by not making it: the automatic name keeps
the `ws/` namespace it was born with.

**The `ws/` prefix stays.** The lifecycle spec chose it so a machine-created branch
is "namespaced, self-describing, sorts together, and matches the `type/slug` shape
every repo already uses" (`:62-64`). A title-derived `feat/` or `docs/` would need
a judgement this spec has no way to make well, and would surrender that property
for nothing. Reclamation does not care either way — `ws-reap` reads the branch
from git's own worktree record and from the registry, never by matching `ws/*`
(`ccd:2472`, `:2504`) — so a human renaming out of the namespace by hand stays
safe. Automatic naming simply never does it.

## The rule

The naming sweep is a new lane on FleetWatcher, `NAME_SWEEP_MS = 10_000`, beside
the existing 2s tick (`watch.ts:79`), the 10s task sweep (`TASK_SWEEP_MS`,
`watch.ts:21`) and the 120s PR sweep. It does not ride the 2s tick: a title that
appears ten seconds late costs nothing, and reading transcripts thirty times a
minute to learn nothing costs real work.

On each sweep, for each session where:

1. `workspace !== null` — a workspace, not a main checkout, and
2. `SessionRecord.branch === 'ws/' + workspace` — the branch is still exactly its
   born name, and
3. the transcript carries an `ai-title`, and
4. this `(id, derived-branch)` pair has not been attempted before,

derive a branch name from the title and rename.

**Condition 2 reads the registry, not the assembled `FleetSession`.** This matters
and is easy to get wrong. `FleetSession.branch` is `sl?.branch ?? r.branch ?? null`
(`fleet.ts:100`) — the tmux statusline wins over the registry, deliberately,
because it is a live pane capture. But `cmd_ws_rename` writes the registry
synchronously (`ccd:1242`) while the statusline only moves when Claude Code
re-renders it, so for some number of ticks after a successful rename the assembled
branch still reads `ws/<slug>`. The sweep therefore calls `readRegistry` itself and
compares `SessionRecord.branch`, matching what `sweepTasks` and `sweepPr` already
do.

**Idempotence needs no new state.** Condition 2 *is* the marker. After a successful
rename the registry branch no longer equals `ws/<workspace>`, so the rule can never
fire twice on the same workspace. There is no registry field to add, no marker file to
write, no migration, and nothing to clean up when a workspace is reaped. A born
name is a fact already on the wire (`FleetSession.workspace`, `FleetSession.branch`),
and the comparison between them is the whole mechanism.

### Deriving the name

Lowercase the title; replace every run of non-alphanumerics with a single `-`;
strip leading and trailing `-`; truncate the slug to at most 40 characters; prefix
`ws/`.

Three details an implementer would otherwise have to guess, stated rather than
implied:

- The 40 counts **the slug only**, not the `ws/` prefix.
- "At a word boundary" means **cut at 40, then drop back to the last `-` at or
  before the cut**, never forward past it.
- If the first 40 characters contain **no `-` at all** — a title like
  `Refactoringtheauthenticationmiddlewarepipeline` slugifies to one 45-character
  word — hard-cut at 40.

`Brainstorm Helix and slide notes integration` slugifies to
`brainstorm-helix-and-slide-notes-integration` (44 characters) and becomes
`ws/brainstorm-helix-and-slide-notes`.

The server does **not** re-implement `_ws_branch_valid` (`ccd:1142-1151`). That
rule has one definition, on the box, and the server learns its verdict from the
refusal token. Two implementations of one rule drift; that is what they do.

A title that slugifies to the empty string, or to the name it already has, is not
a rename — no call is made.

### Reading the title without re-reading the world

The title is read by tailing the transcript's last bytes, the way `ask.ts` already
does. Measured across the 600 transcripts on this box that have one, the last
`ai-title` sits at most 45,996 bytes from EOF (p95 31,177; median 12,687), so the
sweep reads a 256 KB tail — 5.5× headroom, where 64 KB would be 1.4× and too tight.
The constant carries that measurement in its comment, as `TAIL_BYTES` and
`BACKLOG_TAIL_BYTES` both do.

**A transcript with no `ai-title` is a permanent state, not a startup window.**
Nine of the 609 transcripts on this box carry none at all, including some very
large ones. Re-reading those every sweep forever is a real recurring cost the naive
rule does not price — roughly 7.7 MB/min across the agent WS in a steady state
where nothing changes. So the read is stat-gated the way `sessionws.ts:135-150`'s
`claimAskRead` gates the ask reader: unchanged size and mtime means the bytes
cannot have started saying something they did not say last time, and the read is
skipped.

**Inherited limitation, stated rather than fixed.** `<id>.uuid` is written once at
`ccd start` and never refreshed, so after a `/clear` the resolved transcript path
points at the superseded file. The chat stream and `sessionCommands` share this;
the sweep inherits it and does not fix it, and in practice fires minutes after
creation when the uuid is fresh.

### The retry-storm guard

If ccd refuses, the branch stays at its born name and condition 2 matches again on
the next sweep. Forever. Every workspace that cannot be renamed would spawn a ccd
invocation across the wire six times a minute, indefinitely — and on the 2s tick it
would have been thirty.

Condition 4 is the guard: an in-memory set of attempted `<id>:<derived-branch>`
strings — **the derived name, not the born slug**. One attempt per (session,
derived name).

A title that changes *while the branch is still at its born name* earns exactly one
fresh attempt. A title that changes *after a successful rename* earns nothing:
condition 2 has already retired the workspace, and re-deriving a branch from a
drifting title is not what this feature does. A server restart earns exactly one
retry, which is the right amount — the usual reason a rename failed is a condition
a restart does not change, and the one reason it might have (a transient fleet
outage) is worth one more try.

**This is deliberately not durable.** A registry marker would survive restarts, but
it would be state ccd has to own, write, and purge on reap — for a retry budget
whose entire purpose is to be forgotten.

### Ordering against the rest of the fleet

`cmd_ws_rename` takes no `flock`. The only two acquirers in ccd are
`cmd_ws_restore` and `cmd_ws_reap`, both on `$REG/.reap-$id.lock`. The server's
`KeyedQueue` is used by five call sites — `/prompt`, `/dialog`, `/interrupt`,
`POST /pr`, `/workspace/reap` (`inject/send.ts:266,413,447` and
`server.ts:460,541`).

The rename **joins the queue** on the session id, which serialises it against every
other server-originated write on that session; the rename makes six.

**The queue has to be hoisted before the watcher can reach it.** Today it is a
local const inside `buildServer` (`server.ts:234`,
`const sendDeps: SendDeps = { tmux: deps.tmux, queue: new KeyedQueue() };`), never
exported, while `FleetWatcher` is constructed at `index.ts:39` — one line before
`buildServer` is called. The watcher's only existing ccd write, `archiveMerged`
(`watch.ts:316`), calls `this.deps.runCcd` directly and serialises nothing. The
queue moves to `index.ts` and is passed to both, rather than the rename following
that unserialised precedent: the reap it must not race is `POST /workspace/reap`,
which is server-originated and already queued, so joining buys real protection
rather than a formality.

It does **not** serialise against a `ws-reap` or `ws-restore` run by hand on the
box — those take the flock, which `ws-rename` does not. That residue is accepted:
a hand-run reap on a workspace whose first turn is still landing is not a case
worth adding a lock for, and the rename is a `git branch -m` that a reap would
immediately make moot.

## ccd: `ws-rename` joins the new generation

`ws-rename` today is from ccd's older positional generation: `ws-rename <id>
<new-branch>` (`ccd:1153`, dispatch `:5427`), a minimum-arity guard only
(`${1:?}`/`${2:?}` at `ccd:1154-1155`, whose usage refusal is bash's rather than
ccd's) with extra argv silently ignored, twelve refusals as prose on stderr at
exit 1, and one success sentence on stdout (`renamed $id: $old -> $new`,
`ccd:1243`) that `runCcdOr502` discards.

It becomes:

```
ccd ws-rename --session <id> --branch <name>
```

with exact arity, id validation, and a single JSON line on stdout. **A refusal
prints JSON and exits 0** — the shape `ws-reap` established
(`printf '{"refused":"%s","detail":%s,"paths":[]}\n'`, `ccd:3690`) and so far the
only verb that carries it: `pr-open` and `ws-archive` still `die` on stderr at
exit 1. `ws-rename` is the second verb in the new shape, not the fourth.

Success prints `{"renamed":"<id>","old":"<branch>","new":"<branch>"}` in place of
today's sentence.

This is not cosmetics. The agent's exec whitelist matches by **prefix**
(`whitelist.ts:541-605`), so a positional verb can only be granted as the
one-token `['ws-rename']`, which permits `ccd ws-rename <anything> <anything…>`.
With flags the grant becomes `['ws-rename','--session']` and the verb can join
`REQUIRED_VERB_FLAG` (`whitelist.ts:218`, today `{'ws-reap':'--expect'}`), where
losing the flag is both a compile error and a boot refusal.

### Refusals

`cmd_ws_rename` has thirteen `die` calls. Twelve are refusals and each gains a
token; the thirteenth is a genuine fault. In ccd's own evaluation order:

| check | token | ccd |
|---|---|---|
| id fails `^[A-Za-z0-9._-]+$`, or arity is wrong | `bad-args` | new |
| `$REG/<id>.uuid` missing | `no-such-session` | :1156 |
| `.workspace` empty — a main checkout | `not-a-workspace` | :1161 |
| `.project` or `.workdir` empty | `incomplete-registry` | :1162 |
| worktree directory gone | `worktree-missing` | :1169 |
| new name fails `_ws_branch_valid` | `bad-branch` | :1170 |
| no worktree record for the directory | `worktree-unregistered` | :1192 |
| HEAD detached | `detached` | :1195 |
| directory is not a worktree of this repo | `worktree-foreign` | :1210 |
| new name equals old | `unchanged` | :1211 |
| branch has an upstream | `has-upstream` | :1220 |
| name exists locally | `name-taken-local` | :1224 |
| name exists on origin | `name-taken-origin` | :1230 |

**`git branch -m` failing (`ccd:1241`) is the one path that keeps a non-zero exit.**
It is a fault, not a refusal: nothing about the request was wrong.

`has-upstream` is the load-bearing refusal, and it is why this feature is safe to
run unattended: **a branch that has been pushed is never renamed.** The lifecycle
spec made that an enforced precondition rather than a convention (`:70-72`), and
the automatic caller inherits it for free.

`git ls-remote` being unreachable stays a warning, not a refusal
(`ccd:1226-1233`, the warn line at `:1232`).

**No busy guard.** `ws-archive` refuses `session-busy`; `ws-rename` must not. When
the title lands the session is busy by definition — it is answering the first
prompt. A busy guard would refuse the only moment this feature ever fires.

## The server gains one argv entry, one grant and one timeout

- `CCD_ARGV.wsRename: (id, branch) => argv(['ws-rename','--session',id,'--branch',branch])`
  in the table at `ccdargv.ts:56-77`.
- `EXEC_WHITELIST.ccd` gains `['ws-rename','--session']`; `REQUIRED_VERB_FLAG`
  gains `'ws-rename': '--session'`.
- `CCD_VERB_TIMEOUT_MS` gains `'ws-rename': 20_000` (`remote/runner.ts:27-37`).
  It shells out to `git ls-remote` against origin, the same network reach as
  `pr-state`, which was given 20s. Without an entry it silently inherits 90s.
- The watcher call site carries `verbSupported` — `ws-rename` is not in
  `verb-gate.test.ts`'s `UNGATED_BY_DECISION`, and that test parses `server/src`
  for every `CCD_ARGV.<name>(` to enforce it.

Nothing else in the server changes. The rename is a call the watcher makes and a
branch the fleet reports: there is no route to add, no request body to validate,
no client API method, and no state to keep.

## The name types itself in

`pwa/src/fleet/sessionLabel.ts:15` is the single definition of what to call a
session — `name ?? branch ?? workspace ?? id`.

For a workspace session **with no human-chosen name** it resolves to the branch,
because a derived Claude Code handle (`openclawhetzner-42` — cwd basename plus a
counter) is dropped before it reaches the wire:
`name = live.nameSource === 'derived' ? null : live.name`
(`server/src/fleet.ts:82`, comment at `:75-81`). Only the exact string `derived`
rejects, so **a name set by hand still outranks the branch, and such a session's
rename stays invisible in the label.** That is accepted: a human who named a
session has said what to call it, and this feature does not overrule them. Every
live session on the fleet today has `name: null`.

Where the label does resolve to the branch, the rename is already visible with no
wire change — the label simply becomes the new branch on the next frame.

`pwa/src/fleet/TypedLabel.tsx` wraps `sessionLabel(session)` and streams a changed
value in, character by character, with a caret. The name was written by a model;
it arrives the way a model writes.

- Mounted at the fleet line and the session header crumb
  (`session/SessionHeader.tsx:139`).
- First mount never animates — only a change from a previously rendered value.
- The per-character delay is an exported constant the test imports rather than a
  literal it re-guesses.
- `useReducedMotion()` swaps instantly, following `session/ToolCard.tsx:121,210`.
  `framer-motion` is already a dependency and the PWA's CSS already carries eight
  `prefers-reduced-motion` blocks.

**The three slug displays are untouched.** `session/PrSheet.tsx:92`
(`session.workspace ?? session.project`), `session/ReapSheet.tsx:175` and
`screens/ArchiveScreen.tsx:88` keep showing the born slug, because it names a real
and unchanged thing: the directory on disk. A delete confirmation in particular
must name what it will actually remove.

## Error handling

| condition | behaviour |
|---|---|
| no `ai-title` in the transcript | no call; re-checked next sweep |
| title slugifies to empty or to the current name | no call; pair marked attempted |
| ccd refuses (any token) | logged with the token; pair marked attempted; branch keeps its born name |
| `git branch -m` fails (`ccd:1241`) | non-zero exit, ordinary non-ok `CcdResult`; logged; pair marked attempted |
| fleet down / transport failure | ordinary non-ok `CcdResult`; pair marked attempted; one retry after a server restart |
| `verbSupported` says the fleet's ccd lacks the verb | no call, **no attempt recorded** — a verb that arrives later must still fire |
| session has a human-chosen name | rename still happens; the label does not change, by design |

The `verbSupported` row is the one worth stating: a fleet running an older ccd must
not have its workspaces marked attempted, or upgrading ccd would leave every
existing workspace permanently unnamed.

## Testing

**ccd** — extend `ccd-ws-rename.test.ts` (24 cases on `makeCcdHarness`: 5 on
`_ws_branch_valid`, 19 on `ws-rename`): the new argv shape, exact arity, id
validation, one case per refusal token asserting the `{"refused":…}` envelope on
stdout at exit 0, the success object, and `ccd:1241` keeping its non-zero exit.

**Server** — the sweep rule: fires on a born name with a title; does not fire once
renamed; does not fire without a title; does not fire for `workspace === null`;
does not re-fire after a refusal; does not mark attempted when the verb is
unsupported; joins the queue. **Reads the registry branch, not the assembled one**
— a session whose statusline still reports the born branch after a successful
rename must not fire again. **The stat gate holds**: an unchanged transcript is not
re-read, and a grown one is. A title that changes mid-flight is tested
synthetically: measured on a 91 MB transcript, `ai-title` is rewritten once per
turn but the value never changed (1,809 lines, one distinct value), so real data
cannot exercise that branch. Derivation: the 40-character budget excludes `ws/`;
the boundary drops back rather than forward; a single 45-character word hard-cuts.
Plus `whitelist-subset.test.ts`'s compile-enforced `SAMPLES`/`EXPECTED` (a missing
key is TS2741) and the `REQUIRED_VERB_FLAG` audit.

**PWA** — streams on change; silent on first mount; reduced-motion short-circuits;
a session with a human-chosen name does not animate on a branch rename; the three
slug displays keep the born slug after a rename.

**Mutation sweep** over the whole diff, one literal mutant per added construct,
full suite per mutant, per `.superpowers/sdd/<plan>/CONSTRAINTS.md`.

## Out of scope

- **Renaming the workspace identity.** The slug, directory, session id, tmux
  session, systemd unit and claude.ai session name are fixed at creation and stay
  fixed. Changing them means moving a directory, respawning tmux, re-enabling a
  unit, rewriting every registry key and re-homing a live Claude Code process.
- **Naming at creation from the PWA.** `ccd ws-add <project> <slug>` already
  accepts a slug from the terminal; `ccdargv.ts:67` still drops it, and that stays
  dropped. Automatic naming covers the case that motivated it.
- **Choosing a `type/` prefix.** Deferred again, deliberately, and for the same
  reason the lifecycle spec deferred it.
- **A manual rename control in the PWA.** No route is built. If one is ever wanted,
  the argv entry and the grant will already exist.
- **Calling a model to generate the name.** The title exists. Generating a second
  one would cost credits to duplicate work already done.
- **Overruling a human-chosen session name in the label.** Stated above as accepted.

## Definition of done

A workspace created with `+`, given a first prompt, has its branch renamed to the
slugified `ai-title` within one `NAME_SWEEP_MS` of Claude Code writing it — and the
new name types itself into the fleet line. A workspace whose branch has been pushed
keeps its born name permanently, refusing with `has-upstream` in the server log and
surfacing nothing in the PWA. A workspace that refused once is not retried until
its title changes or the server restarts. A fleet running an older ccd is unchanged
and unharmed, and starts naming at the next caps refresh after its ccd is
installed.

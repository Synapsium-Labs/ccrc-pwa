# Board placement and the repo label — design

Status: **approved in dialogue by the operator, 2026-09-16**, section by section.
Measured against `origin/main` at `98236c81`; every `file:line` below was read there.

## 0. What this supersedes, declared

This design **overrides** `docs/superpowers/specs/2026-09-08-crossrepo-programmes-design.md` §F4's ruling
that "the worker stays on its own project's card", and **restores** Task #32 of
`docs/superpowers/specs/2026-08-11-crossrepo-programmes-design.md:330-333`:

> **Task #32 (nest worker workspaces under their programme) extends unchanged:** a foreign-repo worker
> still nests under its programme, not under its project, with the project on the nested row.

That restoration is the warrant, not a reversal. The Sep-08 spec's own supersession clause (`:13-14`)
says: "where they disagree on a rule, the ruling in the older file wins **and this file says so**."
It never says so — searched for `#32`, `Task 32` and `nest`; the only `nest` hits are `nestFleet`
mentions inside its own §F4. The Sep-08 reversal was therefore undeclared and, by its own terms, did
not hold.

This file says so. That is the clause being honoured, and honouring it is why this section exists.

## 1. The problem, measured

The fleet board draws the coordinator→worker bracket only *inside one project card*. `nestFleet`
brackets a worker under its coordinator only when both ends are on that card's session list
(`pwa/src/fleet/nestFleet.ts:107`), and `pwa/src/screens/FleetScreen.tsx:663` hands each card only its
own project's runs. Four mechanisms follow; all four were reproduced, and 22 findings survived
adversarial refutation out of 41.

1. **Cold start renders the whole fleet flat.** Sessions hydrate from `localStorage`; `runs` does not.
   `ProjectCard` cannot distinguish "no runs" from "no frame yet", so every page load paints a
   populated, confidently flat fleet that then jumps into place. Fires on every load.
2. **Cross-repo programmes never nest, structurally.** Reproduced against live run 58
   (`qdrant-consolidation` wave 10: work in `custom-tools`, coordinator `intake-platform-keen-meadow`).
   Both cards render flat; the worker is indistinguishable from an uncoordinated workspace.
3. **The wave boundary.** `pwa/src/fleet/runWords.ts:107` — "between closing wave N and opening wave
   N+1 … every row of the program is terminal". Every worker un-nests in that window.
4. **Archiving the coordinator** silently un-nests every worker it brackets, and whether it does
   depends on the coordinator's PR phase, not on the programme.

The fix is a **grouping** change, not a nesting change, and it is **two** coordinated changes, not
one. Measured both ways:

- Handing every card every run changes nothing — `nestFleet` needs both ends on the card's list.
- Placing the worker's session on the coordinator's card **and routing its run to that same card**
  produces the bracket with `nestFleet` untouched (`d0: coordinator / d1: └─ worker`).
- Moving the session *alone* is a pure regression: the destination card gets the session but not the
  run, so no edge is drawn and the row arrives having lost the `orphanNote` marker and the `/runs`
  door it has today, while its run renders on no card at all.

## 2. Operator rulings (2026-09-15 / 2026-09-16)

| # | Ruling |
|---|---|
| R1 | A coordinated workspace **always** nests under its coordinator. |
| R2 | It **moves** to the coordinator's card. Not mirrored, not ghosted — "only one way to access any given workspace in the UI". |
| R3 | The repository a workspace works in gets a visible label. |
| R4 | `project` stays the organizing noun; repo is a **label, not a structure**. The 1:1 holds. |
| R5 | Project cards become **durable**, rendered from the known-project list rather than from the session list. |
| R6 | Workers must never be scattered by losing a coordinator; and the board does **not** shut sessions down. |

## 3. Why "repo is a label" is the right size

The census of every meaning of `project` across ccd, the wire, the PWA and the docs found **seven**
distinct concepts on one token, and one constraint that governs all of them:

> The project name is not a label. It is a **primary key already spent** in namespaces nothing in this
> system can rewrite — session ids (`ccd/ccd:5138`, `:1934`), tmux names (`:1935`), systemd units
> (`:2547`), every registry filename (`:2106`, `:2185`), the pool tag filename, `$WORKTREES_ROOT/<project>/`,
> four `coord.db` tables, two URL segments and a `localStorage` key. There is no `ccd project-rename` verb.

So a repo concept cannot be introduced by re-keying `project`; it has to ride alongside. Two further
facts bound the design:

- The non-goal on record bans exactly one direction — "No 'cross-repo project' noun. No entity that
  owns several repos" (`2026-08-11…:364-367`, carried at `2026-09-08…:364-366`). It says nothing about a
  repo identity attached to a workspace. This design does not create that noun.
- The 1:1 is real in practice but was never modelled: `_gh_repo_slug` reads the project's main checkout
  "purely by REACH, never by identity" (`2026-07-29-ccrc-pr-lifecycle-design.md:223`). Nothing must be
  retracted to measure a workspace's own repo later — only extended.

## 4. The placement decision

**The new noun is a *board placement*, not an identity.** A session's `project` is untouched: primary
key, registry label, namespace, id component. We add one derived answer to a different question —
*which card does this row render on* — which today is implicit in `session.project`.

**Decided in L1 policy**, as a pure function over facts the server already holds: the coordination
store's `runs` table and the registry. Not in `groupFleet`, not in `ProjectCard`, not in `FleetScreen`.
L4 renders; it does not decide.

**Keyed on** the newest run naming the session as `sessionId` — *including closed runs*, newest meaning
highest `runs.id` — and that run's coordinator.

That the server can ask this question at all is already demonstrated in the tree:
`server/src/coord/store.ts:881` runs `SELECT project FROM runs WHERE sessionId = ? ORDER BY id LIMIT 1`,
and `runs({includeClosed})` exists. **Read that citation precisely** — it is `sessionProject`, and it
returns the *run's* project, not the coordinator's. It is cited here as proof of the query shape and of
the server's reach, not as the value this design needs. The value itself comes from the stamped column
below. The client only ever sees active runs, which is precisely why the decision cannot live there.

**Lifetime: while the workspace is held.** The hold is the durable "this workspace belongs to programme
X" fact, it is already maintained, and releasing it is an explicit act. This needs **no parsing of the
hold reason string**: `held !== null` is the gate and `coord.db` supplies the coordinator, so the
no-parsing rule survives intact.

**The coordinator's project is stamped on the run whenever the coordinator is DECIDED** — at open,
and again on a reclaim — where the server already knows it —
never re-derived from a live read of the coordinator's registry record. This is R6: a worker keeps its
placement when the coordinator is archived, removed or unmeasurable, and stays bracketed under a
coordinator that is visibly dead, which is the truth. One additive column.

**Widened 2026-09-16 (D-2924) — this said "at open time", and that was too narrow.** §7 requires
that a reclaim move every worker of a programme at once, because the programme genuinely has a new
coordinator. An open-time-only stamp cannot deliver it: `reclaimProgram` rewrites `claimedBy` while
the stamp keeps naming the displaced coordinator, so workers stay on a card whose coordinator is gone
until the next wave opens — days, possibly. The two columns on one row would also disagree about who
the coordinator is, which matters directly now that the hop is keyed on `claimedBy`. The stamp is
therefore taken at every point the coordinator is decided, by the same measured read, with absence
leaving it null rather than guessing. This does NOT reach the dead-coordinator case §7 protects: there
nothing decides a new coordinator, so nothing restamps and the placement correctly stays put.

**Transitive, with a bounded resolver — and the hop is SESSION-keyed, not project-keyed.** If C1
coordinates C2 and C2 coordinates W, resolving one hop puts C2 on C1's card while W lands on C2's
card, where its parent is not. Resolution therefore walks to the root coordinator. Nothing
server-side prevents a cycle, so the walk is hop-capped and stops on revisit, falling back to own
project.

**Corrected 2026-09-16 (D-2921) — this paragraph originally said the walk hops from project to
project, and that is not a well-formed question.** "Which project coordinates project P" has no
answer: a project does not have a coordinator, a RUN does, and `runs.project` is the WORKER's project
(it is what `POST /api/runs`' `project-mismatch` rung compares `sessionProject(sessionId)` against).
Keying the hop on it makes `byProject[P] === P` for every project that hosts an ordinary
same-repo programme — which for a busy project is always — and since the resolver seeds its visited
set with `ownProject`, the very first hop then trips the cycle guard and returns `ownProject`. The
cross-repo worker renders flat on its own card: the exact defect §1 measured against live run 58.

The hop is therefore from a SESSION to the session that coordinates it: given a session id, answer
that session's own newest stamp. This also collapses the resolver's two inputs into one lookup — the
first hop and every later hop are the same question asked of a different session — so the run must
carry the coordinator's session id alongside its project, and the visited set ranges over session ids,
where the self-check and the cycle check are exact rather than approximate.

**Every degenerate case lands the row on its own card, never nowhere:** no run, no coordinator, the
coordinator is the session itself, or the resolver bailed.

## 5. The wire and the store

**Three additions in total, and they are of two different kinds** — stated together so a reader counting
them is never left reconciling §4 against §5:

| # | Addition | Kind |
|---|---|---|
| 1 | `FleetSession.boardProject` | wire field, additive |
| 2 | `ProjectRow.repo` | wire field, additive |
| 3 | the coordinator's project, stamped whenever the coordinator is decided (§4) | `coord.db` column + one `user_version` migration |

**`FLEET_PROTO` stays 1** — that is a statement about the two *wire* fields. The third is a schema
migration and is governed by `coord.db`'s own rule: migrations refuse to start rather than open empty.
It is one migration, and the design needs no second.

**`FleetSession.boardProject: string | null`** — the placement. `null` means *this server did not
decide*; the single tolerant reader falls back to `session.project`. Two conditions reach that null —
an older server, and a snapshot revived from a build predating the field — and they collapse
deliberately, because the caller does the identical thing with both. That is a permitted fold: the rule
bans collapsing conditions a caller handles *differently*. "Placed elsewhere" vs "placed home" is **not**
folded — the client reads it off `boardProject !== project`, so no second field is needed.

`reviveFleetSession` returns a literal, so adding this field is a compile error until every construction
path computes it. That is the enforcement; no path can silently omit it.

**`ProjectRow.repo`** — a discriminated value, not a bare nullable string, following the
`ProjectPoolWire` precedent that already refuses to fold this exact shape:

- `named` — measured; carries the `OWNER/NAME` slug
- `absent` — measured; no usable origin
- `unmeasured` — no measurement this pass, or an older server

The label renders only on `named`. `absent` and `unmeasured` both render nothing but stay distinct, so a
future doctor check or warning chip has something true to read. `absent` is deliberately **not** split
into "no origin" and "unrecognized remote": the label treats them identically and
`pwa/src/session/PrKeycap.tsx:78` already owns the operator-facing no-remote sentence.

It lives on `ProjectRow`, not on `FleetSession`, because that is where it is **true** — measured from the
project's main checkout, it is a fact about the project. On a session it would assert something about
that workspace's own clone that nothing measured.

**Source.** `CcdPrLine` already carries `{ project, repo, … }` per workspace. Every workspace that could
ever be a moved row already has its repo measured, because the sweep runs over workspaces — the only
unmeasured projects are ones with no workspaces, which can never contribute a moved row. **No new ccd
verb, no new agent round trip**: retain the `(project → repo)` pairs the sweep already sees.

**The retention seam is `server/src/watch.ts:3227`**, `this.prStates.set(line.id, phaseFor(line))` —
where a `CcdPrLine` carrying `repo` collapses into a `PrState` that has none (verified: `PrState`'s only
occurrence of "repo" is inside a comment). **`server/src/prstate.ts:257` is NOT the seam**: it *keeps*
the repo, landing it on `PrView.facts.repo` for the PR sheet. A change made there has edited the wrong
place and retained nothing.

**`absent` and `unmeasured` are told apart by one reason, not guessed.** The only proof of `absent` is
`CcdPrFailure.reason === 'no-remote'`, which is what `_gh_repo_slug`'s failure produces. Every other
member of `PrReason` — `timeout`, `offline`, `unauthenticated`, `rate-limit`, `unsupported`, `agent-down`,
`error`, `unavailable`, `truncated`, `merge-unproven`, `branch-drift` — is `unmeasured`. The mapping is
derived from `PR_REASON_MAP`, never hand-listed, so a new reason cannot silently become `absent`.

## 6. The board

**Cards come from the project list, not the session list.** `groupFleet` inverts: it takes the known
projects and fills each with the sessions whose `boardProject ?? project` names it. A project with no
rows still renders — name, `+`, pool chip — so the index cannot be destroyed by a workspace moving
(R5). Sessions whose placement names a project not in the list still render on a card of their own
name, so nothing falls off the board if the two reads disagree.

**An emptied card says where its work went** — "2 workspaces under `intake-platform`" — as plain text,
never a link. A tappable route would be the second access path R2 excludes; this is the same reason the
existing `abroad` line is a bare `<span>` with no `onClick` (`pwa/src/fleet/ProjectCard.tsx:496-505`).
The `abroad` line survives but narrows: it must subtract any run whose worker now renders on this card,
or the card states the same run twice.

**Row order: attention-first, then programme order.** One comparator ahead of `programOrder`, scoped to
siblings. `nestFleet.ts:52-58` argues programme order so "a worker does not climb the tree by being
busy" — and that argument is about *busy-ness*. `attention` means blocked on the operator, and
`groupFleet.ts:8-9` already states the overriding principle: folding a project away "can never hide the
one thing this screen exists to surface". An indented row three deep hides it just as effectively.

**The repo label appears where the card stops implying it** — on a row whose repo differs from its
card's project, and nowhere else ("decorate only when it disambiguates", Build 7 §6). In the **session
view** it is unconditional: there is no card context there at all (R3).

That label also resolves a collision this change would otherwise create. Workspace slugs are unique
*per project* (`ccd/ccd:4628`, `local id="$1-$2"`), and the live fleet already reuses `still-river`,
`amber-prairie` and `still-prairie` across projects — `still-river` is currently a live coordinator. Two
rows on one card could otherwise render byte-identical text and byte-identical accessible names. The
repo must therefore sit **inside the row's accessible name**, not merely beside it visually, or a
screen-reader rotor still lists two indistinguishable buttons.

## 7. Motion, degradation and failure

- **Cold start stops teleporting, structurally.** `boardProject` rides on `FleetSession`, which *is*
  hydrated, so the placement arrives with the row. Residual: the first load after upgrade hydrates a
  snapshot without the field and moves once when the live frame lands. One teleport, once, per device.
- **The wave boundary stops bouncing**, because placement keys on the newest run *including closed*
  plus the held gate — not the active-run set the client sees.
- **A lost coordinator does not scatter its workers** (R6, §4): the placement was stamped, so the
  worker stays bracketed under a coordinator that reads as dead.
- **An orphaned worker is shown as orphaned.** The fleet card gains the `coordPresence` signal `/runs`
  already computes (`pwa/src/fleet/coordWords.ts:62`), so the row reads as orphaned and is one tap from
  the reclaim door — instead of the board relocating it or acting on it.
- **The board never shuts a session down** (R6). `coordWords.ts:66-80` records that `assembleFleet`
  collapses a tmux `unknown` into `alive = false` — "a substrate fault reads 'dead' in the PWA — a
  false dead" — and concludes `status === 'dead'` is **not proof** of a dead coordinator. An
  auto-shutdown keyed on that would destroy live work on a misreading, and
  `pwa/src/screens/RunsScreen.tsx:308` records that a dead coordinator is "the ORDINARY end state" for a
  finished wave, so the trigger would fire on healthy programmes. `ws-reap` is human-only by contract.
- **Reclaim moves every worker of a programme at once**, because the programme genuinely has a new
  coordinator. That is correct and is allowed to happen; durable cards give the rows somewhere legible
  to land.
- **Nothing is lost while a coordinator is dead.** A worker's `wave-done` mail carrying a `runId` still
  resolves through that run's `claimedBy`. The work stalls against a session nobody is reading; it does
  not disappear.
- **The spawn window stays as it is.** Between the registry learning a session and the run binding it,
  the coordinator's card shows the pending phantom while the row sits on its own card. Two renderings of
  one spawn, but not two access paths — the phantom carries no session id and opens nothing — so it does
  not breach R2.
- **Chains hit the depth ceiling, and one level is the ruling** (operator, 2026-09-16). `RowDepth = 0 | 1`,
  so on C1's card rule 4 lifts C2 to depth 0 with W beneath it and C1's own bracket to C2 is not drawn.

  How rare is the chain? **Measured over all 64 runs in history: 26 distinct workers, 9 distinct
  coordinators, and ZERO sessions that were ever both.** It has never occurred. The worker skill forbids
  it in its own description — "Never use it to coordinate a program — a worker that starts dispatching
  has become a coordinator without a ledger". But it is a CONTRACT, not a mechanism: no guard in
  `POST /api/runs` refuses a caller that is itself a worker, and `CLAUDE.md:63-65` states that fleet
  identity is "attribution, not authentication" and "Don't assume server-side checks stop a session
  acting directly". Note also that coordinating is not a main-checkout-only role — four workspace-shaped
  sessions coordinate today — so the chain is one skill-clause away from reachable.

  The bounded resolver is therefore kept despite the rarity: resolving one hop and assuming no chain
  would still have to DETECT a chain to avoid silently placing a row on a card whose parent is absent,
  so it costs nearly the same as walking correctly.

## 8. Testing

**Stays green, measured:** `pwa/test/project-card.test.tsx:1151` and `:1170` (D-2581). Both render
`<ProjectCard runs={[]} abroad={[…]}/>` directly by prop and pin only that `abroad` must never reach
`nestFleet`. This design never merges those lists. The second case's own comment endorses the approach:
`nestFleet`'s settled path "never reads the run's own `project`… that invariant, if it holds at all, is a
SERVER fact, and this component may not lean on it".

**Survives, prose only:** `pwa/test/nestFleet.test.ts:117-123`. The orphan state it pins is still
reachable (archived, dead or unmeasured coordinator). Its wording "this project's list" becomes "this
card's list".

**Reds by design:** `pwa/test/groupFleet.test.ts`, which asserts grouping on `s.project`. That is the
rule being changed: deliberate rewrite plus a deviation entry, never a quiet edit.

**The cross-package trap, to be stated in bold in the plan:** two *server*-package suites reach into the
PWA — `server/test/resume-reclaim-l0.test.ts` names `pwa/src/fleet/nestFleet.ts` by hand and asserts a
literal from its header, and `server/test/single-definition.test.ts` text-scans four roots. A worker
following `CLAUDE.md`'s per-package commands runs `cd pwa && npm run test`, sees green, and reds CI in a
package it never opened. The plan must require the server suite too, sharded.

**New pins, one per guard, each measured red under its own mutation** (before/after, not asserted by
comment):

- the placement policy as a pure function: own-project fallback, the coordinator's project,
  transitivity, the cycle guard, the held gate, and that closed runs are included
- absence on the wire falls back to `project` (the revive literal is a *compile-time* pin and is named
  as such, not counted as a test)
- a project with zero rows still renders a card
- `abroad` subtracts runs whose worker renders here
- attention-first ordering among siblings only
- the repo label appears only where the card stops implying it, and is inside the row's accessible name

## 9. Scope note

This is larger than one wave: server policy and a migration, two wire fields, the repo retention, the
grouping inversion, the card and row rendering, and the pin set. It is written as one design because the
pieces are not independently shippable — the grouping inversion without the run routing is the pure
regression §1 measures. Cutting it into waves is the plan's job, not this file's, but the natural seam
is server-and-wire first, board second, with the cold-start fix rideable in either.

## 10. Non-goals

- **No "cross-repo project" noun**, carried verbatim from both crossrepo specs. This design creates no
  entity owning several repos.
- **No re-keying of `project`.** §3's constraint forbids it.
- **No multi-repo workspace.** A workspace remains one worktree in one repo.
- **No session lifecycle action from the board** — no shutdown, no spawn, no reap (R6).
- **No `FLEET_PROTO` bump**; both fields are additive with one tolerant reader each.
- **No second access path to a workspace** (R2).

## 11. Follow-on, not in this design

**Spawning a replacement coordinator for orphaned workers.** The need is real — `reclaim` hands a
programme to a successor that must already exist, so a programme whose coordinator died with no
suitable heir has no door. It is deliberately excluded here because it is a coordination-lifecycle
feature, not a board feature, and it has to decide which account and wrapper the new coordinator gets,
what ledger and plan it reads, and whether it inherits the programme's claims. Its own spec.

## 12. Addendum 2026-09-18 — the chain is refused at the door

**What was reported.** The operator, 2026-09-18 09:42 UTC: a coordinator spawns a workspace, that
workspace spawns another workspace it coordinates, and the child's child renders as an independent,
floating workspace. Two remedies were offered: correct the board, or prevent a child from spawning
workspaces of its own so that only the parent coordinator has that right.

**What was measured, same morning, against the live server and the fleet box's lifecycle journal.**

- Every run in history, closed included: **85 runs, 36 distinct workers, 9 distinct coordinators, and
  zero sessions that were ever both.** No run's `claimedBy` has ever been another run's `sessionId`.
  §7's "it has never occurred" still holds, now over 85 runs rather than 64.
- Every workspace creation in the lifecycle journal: **75, of which 74 came through the agent** —
  `dec.actor = run:<id> dispatch` for a dispatched worker, `surface: none` for the console's `+` — and
  **one** was run from a session pane (2026-08-27, from the ccrc-pwa main checkout's own pane, actor
  `orchestrator: PR #11 review fixes`). No dispatched worker has ever minted a workspace.
- The rows that float are §1's mechanism 2. Reconstructed card by card from `state-cache.json` and the
  active runs: `custom-tools-bright-hollow` (run 85, wave 20) and `data-internal-brisk-river` (run 84,
  wave 19) sit at depth 0 on their own project cards wearing only the rule-3 orphan marker, while their
  coordinator `intake-platform-keen-meadow` — itself a workspace the operator spawned from the console
  on 2026-09-02 — brackets `intake-platform-quiet-prairie` (run 82) on the intake-platform card. Nine of
  that programme's twenty waves have worked in `custom-tools` or `data-internal`; every one rendered
  this way. Wave 1 of this design is merged (`2985b9d1`, PR #137) and **not deployed** (the server box
  reports `53e6a438`); wave 2 was never written, so nothing renders yet.

**The ruling this addendum records.** Both remedies, because each is only honest with the other:

1. **Correct the board — wave 2, §6–§8 as written.** Under §4's resolver those two rows land on the
   intake-platform card under `keen-meadow`, which is the picture the operator asked for.
2. **Make §7's contract a mechanism.** `RowDepth = 0 | 1` is the operator's ruling and stays. But a
   real run-to-run chain would render exactly the reported picture even after wave 2: `nestFleet`'s
   rule 4 lifts the middle session to depth 0 with its own child beneath it and the top coordinator's
   bracket to it is never drawn. The one-level bracket is therefore truthful only if the chain cannot
   form. So `POST /api/runs` **refuses a `claimedBy` that is currently the `sessionId` of a
   non-terminal run** — measured by the store's existing `parentOfSession`, the same read the ask lane
   uses to find a worker's parent — with `409 {ok:false, refused:'claimant-is-a-worker', by:<that
   worker's own coordinator>}`, placed with the other pre-open rungs so a refusal leaves no `planned`
   orphan and places no hold. `POST /api/runs/:id/reclaim` refuses the same heir (`ReclaimOutcome`
   kind `heir-is-a-worker`, `409`, `by:` its coordinator), because a reclaim decides a coordinator too.

**What the guard deliberately does NOT refuse.** A session that was a worker of a programme whose runs
are all terminal — `parentOfSession` answers `null` for it — may coordinate later; the operator reuses
workspaces, and a finished worker is not a worker. A review run's `claimedBy` must already equal the
reviewed run's coordinator, so the guard is reached there only through a claimant it has already
admitted. Restricting coordination to main checkouts was considered and rejected: six of the nine
coordinators in history are workspaces the operator spawned for the purpose.

**What the guard cannot see, stated rather than implied.** A workspace minted by `ccd ws-add` from a
worker's own pane, with no run, is invisible to both the board and this door — `CLAUDE.md`'s
"attribution, not authentication". The lifecycle journal already measures the caller (`obs.cg` is
`pane`/`supervisor` for a session, `agent` for the server), so a ccd-side refusal of `ws-add` from a
held worker's pane is buildable; it is a named follow-on, not part of this wave, because it has
happened zero times in 75 creations and it touches `ccd/` (agent-first deploy) for a door nobody has
walked through. §7's bounded resolver stays as well: it tolerates a chain that predates the guard or
bypasses it, and costs nothing.

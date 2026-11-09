# Coordinators decide by default: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:test-driven-development (red first, then green). One wave,
> one PR. Steps use checkbox (`- [ ]`) syntax for tracking. Re-ground every anchor by its symbol before editing: the
> anchors below were read on `origin/main` at `47007038c`, 2026-11-09.

**Goal:** a coordinator working a programme stops a thread only for an operator-only decision or act, or a physical
block after self-healing. Everything else it works out from the programme's goals, decides, records and carries on in
the same turn. The operator sees only the big calls, and can overturn each one.

**Spec:** `docs/superpowers/specs/2026-11-09-coordinator-autonomy-default-design.md` (rev 3, approved 2026-11-09). Its
build order (§13) is this plan's waves A1 to A10. Section numbers below (§n) and row numbers ("row n") are the spec's.

**Architecture:** every piece extends an owner that already exists (the repository's consolidation rule):
- the Goals pin (`programs` row, `goalsFor` in `server/src/coord/ledgersStore.ts`) gains a stored definition of done,
  and its read (`GET /api/programmes/:slug/goals`) becomes exempt-but-authenticated for the box token, as D-149 did for
  `GET /api/runs`;
- one new table, `coordinator_calls`, with one inserting route, holds the calls coordinators make and the wakes of
  parked threads; big calls are read into Waiting on you, the digest and the run page, and overturned through the
  digest's one correction door (`correctDigestRow`);
- the stall watch's `coord-ball` arm gains a dark rung that mails the coordinator; the idle-compaction nudge counts a
  coordinator's open runs; the dead-dispatch pass takes orphaned spawns at once; ccd's placement skips a lane that
  cannot spawn; a dispatch that measures the worker skill absent installs it on that home;
- the coordinator skill gets clause 21, a decision-procedure reference and §7's dispositions; the session hook's roster
  card and role card carry the rule after compaction.

**Tech stack:** TypeScript, Fastify, `node:sqlite` (server); bash (`ccd/ccd`, `ccd/ccrc-api`, `ccd/session-hook.sh`);
Python 3 (the read-only census under `deploy/`); React, `@ccrc/ui`, vitest + jsdom, vitest browser mode (PWA).

## Decisions and deviations

- **D-8126 (2026-11-09)** — the operator's rulings on coordinator autonomy as the default.
  - **Complaints:** (1) coordinators ask the operator low-level questions and wait, when the answer is easy to work
    out from the programme's goals; (2) a coordinator working a programme must stop for one reason only — a decision
    or act only the operator can make, or being physically blocked — and otherwise never stalls, stops or pauses,
    using maximum autonomy, self-healing recovery and resilience to take the programme to completion.
  - **Rulings:** default and always on, not a time window, superseding the earlier autonomy-window idea. Before
    asking the operator anything, a coordinator works the answer out from the programme's goals and definition of
    done (the Goals pin and the ledgers), decides, records the call and keeps going. Only the operator decides
    irreversible or outward-facing acts (SAFETY-listed destructive or live-box acts, publishing, messaging people),
    spend beyond plan (usage credits, paid services, new accounts), changes to the programme's goals, scope or what
    "done" means, and credentials and access. Physically blocked, a stop allowed only after self-healing was tried:
    no account has room; the box is out of disk or memory after its own cleanup and the memory gate; an external
    service is down after retries with backoff; a repository or tool it cannot use within its rights. Only the big,
    design-level calls reach the operator, each overturnable; routine calls are not surfaced. Everything else is a
    fault to recover from: the coordinator skill's stop-and-report refusals get recovery paths, and the 2026-10-20
    "coordinator does it itself" ruling (fleet-capacity spec §3.5(e), D-6091 to D-6097) is built.
  - **Related, in flight:** D-8125 (coordinators lift review caps themselves), D-8123 (the limit watchdog), D-8124
    (the admin-merge door).
  - **Answers of 2026-11-09 to the spec's §15:** (1) the spec approved as written, with the author's calls R6, R7 and
    C1 to C25 and the words of clause 21; the agent may run the coordinator-skill installer itself where a dispatch
    measures `skillState: absent` (row 38 self-heals; §8.3 item 5 is built). (2) Under the operator's pause,
    non-dispatch work continues (landing already-reviewed PRs, reviews, docs); dispatch, the in-place bind and
    self-work on new waves stay forbidden (clause 4, row 1, the skill's `paused` entry). (3) Comments on other
    people's PRs and issues in public repositories, and tracker writes that mirror to public GitHub, are both routine,
    not operator-only (C2, the O1 line). (4) Not yet answered: whether D-8126 supersedes the 2026-09-22 debugging
    ceiling; row 49 stays as the operator's instruction stands (the third attempt is a rung a human chooses), its
    change is not built, and the question stays open in the spec's §15.

### The plan's own calls (under D-8126; each wave's PR body repeats the ones it builds)

Read while writing this plan against the code. None changes a ruling; each is a reading of the spec where the code
forced a choice. A deviation a builder finds later gets its own number from the ledger allocator
(`ccrc-api ledger allocate`), defined in this file, as any deviation is.

- **P1. Migration slots.** D-8125 takes slot 48. A2's `programs.doneWhen` column needs a slot too (the spec put the
  only migration in A3), so A2 takes the next free slot and A3 the one after. Each PR re-measures with
  `git show origin/main:server/src/coord/schema.ts | grep -c '^  // ── [0-9]*: user_version'` before it opens and
  again before merge, and takes count + 1.
- **P2. `GoalsView` stays lean.** The spec has the goals read answer open items and big calls "from `goalsFor`,
  widened". `GoalsView` is also embedded per programme in `WaitingView.goals` and the `/ws/fleet` frame, where items and
  calls already travel. So `GoalsView` gains only `doneWhen`; the goals route composes `{ goals, openItems, bigCalls }`
  in one builder, `goalsReadOf`, from the existing readers (`goalsFor`, `itemsFor`, and A3's calls reader). One read,
  no second copy of items on the waiting frame.
- **P3. A changed definition of done needs a cited ruling.** `goals modify` with `doneWhen` is refused
  `done-when-needs-ruling` unless it carries `ruling` or `itemId` (O3: the coordinator records only a change the
  operator ruled, §8.1). The verbatim copy for older programmes cites `ruling: "D-8126"`.
- **P4. A `wokenAt` column.** The spec's table has no column for "this wake fired". A condition wake must stop being
  "unexpired" once its condition clears, or `coord-ball`'s mail rung stays silenced for 24 hours after a wake. The table
  gets `wokenAt`, written only by the wake executor (A6). One writer per column: the route inserts every row; the
  operator's Seen door writes `seenAt`; the correction writes `overturnedAt` and `overturnNote`; the wake executor writes
  `wokenAt`. The route also stamps `build`, the server's own build stamp when the call was recorded, so an `update` wake
  can tell that a newer build came up. A row is a live block while `class = 'block' AND wokenAt IS NULL AND expiresAt > now`.
- **P5. The Seen door is a server route, in A3.** "Seen is one tap" (§6) needs a write. It is
  `POST /api/calls/:id/seen`, session-gated (the operator's), registered with the ledger operator routes. A4 is then
  console-only.
- **P6. Big calls count in the digest's totals.** The digest is "what coordinators decided in the operator's name", so
  `totals.decisions` counts big-call lines and the push copy names them ("2 calls made"). Routine calls are never lines
  and never counted (§6).
- **P7. Time and condition wakes ride existing lanes.** No lane mails at a time today. The wakes are served from the
  stall watch's coordinator pass (`judgeStallCoordinator`), which already reads every coordinator that claims an open
  run on its cadence: `time:` when the time has passed; `disk` when the disk alarm's block reads `ok`; `memory` when the
  host-pressure block's memory level reads clear; `update` when the server's build stamp differs from the one the row
  was recorded under; `account-room` when the coordinator has run a turn since the row (the resumed session is the
  wake, §8.2, and no mail is sent). `capacity` is woken by fleet-capacity W1-4's wake-on-free (A8); until A8 ships, a
  `capacity` block lapses at its 24-hour expiry and `coord-ball`'s mail rung picks the coordinator up.
- **P8. The coord-ball mail rungs are rungs 2 and 3.** Rung 1 stays the 30-hour operator push, so the stored detail keys
  (`stall:coord-ball:1:<key>`) of every past episode keep their meaning. Rung 2 is the first mail to the coordinator,
  rung 3 the one 30 minutes later. Rungs 2 and 3 are wave-2 rungs (dark until `stall-watch-w2-live`), while rung 1
  keeps its wave-1 arming: `STALL_ARM_WAVE` becomes per arm and rung for this one arm.
- **P9. "A run at `merging` with its PR queued" reads as any claimed run at `merging`.** The lane cannot see the queue
  without a GitHub read; doubt holds (§8.3: every doubt types nothing).
- **P10. The skill that `skillState` measures is the worker skill.** `readSkillState` at dispatch measures
  `ccrc-worker` on the bound worker's home, and the worker skill reads the coordinator skill's references from beside it.
  So the self-install (§8.3 item 5) runs both installers on that one home, coordinator first (`install-worker-skill.sh`'s
  own ordering note), through one new ccd verb, `skill-ensure --wrapper <id>`, granted on the agent's whitelist. The
  operator's answer ("the coordinator-skill installer") and the measurement are both served.
- **P11. A5 lands after A6 and A7, and leaves two rows to A8.** Clause 21's procedure promises wakes (`block` calls with
  `wakeOn`) that A6 delivers, and rows 36 and 37 rely on A7's placement filter. A5 waits for both, so no skill text
  promises a wake that does not exist. Rows 18 and 27 (`cap-concurrency`, the description) keep today's words in A5;
  fleet-capacity W1-5 (in A8) rewrites them, as that plan already says, so the words never promise a bind before it is
  built.
- **P12. The R7 count is a feed row.** `coord-blocked`'s push "also counts an R7 breach" (§8.3): the lane writes one
  `r7-breach` feed row per episode whose gate is `waiting` through a pending dialog on a programme with a Goals pin,
  keyed once on the episode. M2 reads those rows and the census.
- **P13. The rollout mail is once per claimant per skill revision,** keyed durably on the feed (`hasNotice`, the idle
  nudge's once-only key, D-5860), sent at server start by the build that carries clause 21.

## Global constraints

- **Wire discipline: additive only.** New fields are optional on the shared type where the PWA reads them (`doneWhen?`,
  `calls?`, `callsCleared?`, `bigCalls?`) and always sent by the server. No `FLEET_PROTO` bump. An older server answers
  a 404 or lacks the cap word, and the client and the skill read that as P4 (`wakeOn: update`).
- **Server cap words** gate the two new client rows (`goals-read-v1`, `calls-v1`, in `ServerCap` and `SERVER_CAP_MAP`
  in `shared/api.ts`): `ccrc-api` refuses a row, unsent, when a current cap file lacks its word, and sends on a stale or
  absent file (the `questions-v1` rule, D-7328).
- **Every box-token route** is an `EXEMPT` entry in `server/src/auth/gate.ts` with its reason, and the gate's route
  count sentence is updated. `box-token-census.test.ts`, `auth-gate.test.ts` and `coord-pause-route.test.ts` hold the
  sets.
- **Growth-checked files** (`coord/store.ts`, `coord/routes.ts`, `pwa/src/lib/api.ts`; `GROWTH_LIMIT`,
  `server/test/growthCheck.ts`) stay within +40 net code lines per PR. Logic goes in new files: `coord/coordCalls.ts`
  (L1), `coord/coordCallsStore.ts` (SQL, `ledgersStore.ts`'s idiom), `coord/coordCallsRoute.ts` (L4).
- **Rings.** L1 deciders make no I/O; L4 decides nothing. A new route file joins `server/test/rings/fastify-l4.data.ts`.
  A new table's writers join `server/test/single-definition/writers-map.test.ts`. New kebab words go in
  `shared/refusal.ts`'s tables so `mail-routes.test.ts`'s kebab census admits them.
- **SAFETY.** Nothing here runs a SAFETY-listed verb, touches tmux, units or another session's files, or works round a
  hook deny. Tests use fixture HOMEs (`makeCcdHarness`), neutral names (`prog-a`, `lane-a`, `demo-w1`) and never a live
  `coord.db`. The census (A1, A10) is read-only and run by hand.
- **No deployment-specific value** is introduced. If a task finds one, it becomes a box setting with a neutral default
  in `CCRC_SETTINGS` (`ccd/ccrc`) and `BOX_SETTING_TABLE` (`shared/api.ts`), shown on the console's Box settings card,
  D-8122's `CCRC_WAKE_PRESSURE_GATE` being the model.
- **Public repository.** No tracker ids, hosts, IPs, account, lane or session names, in code, fixtures, commits or PR
  bodies. The census writes its readings only under `--out`, never into the tree. Comments cite symbol names, never line
  numbers.
- **Tests.** Run vitest from inside the package as `./node_modules/.bin/vitest run --maxWorkers=2 <files>`, at most
  about 12 files a command (`npm ci` first in a package with no `node_modules`). Any `pwa/src` change also runs the
  server pins that scan `pwa/src` and `pwa/test/refusal-literal-ratchet.test.ts`; a rendering change runs the browser
  suite from `pwa/` with `CCRC_CHROME` set. Known Mac-only failures (push-copy, mail-sweep, history-replay, the agent's
  deploy-verify D3b to D3e) are not this plan's.
- **Commits** cite D-8126, are authored and committed under the repository owner's identity, and end
  with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. A behaviour change is its own commit, after a
  characterization commit wherever code moves.
- **Review cutoff.** Fix-and-review loops stop at 2 rounds, 3 for a security-sensitive wave (below).

## Security-sensitive waves

| Wave | Sensitive? | Why | Review |
|---|---|---|---|
| A1 | no | a read-only script run by hand | one reviewer |
| A2 | **yes: auth** | opens an operator read to the box token (`EXEMPT`, dual-credential `onRequest`) | two reviewers, one reading only the gate and the read's answer for what a box-token caller learns |
| A3 | **yes: auth** | a new box-token write route, a new session-gated door, and a new arm of the operator's correction door | two reviewers; one reads only attribution, ownership and the correction arm |
| A4 | no | console only (the doors are A3's) | one reviewer, plus the every-width check |
| A5 | **yes: the coordinator skill's pinned text** | rewrites the twenty pinned clauses and adds clause 21 | two reviewers; one reads only the SAFETY constraints (§9.1) and anti-goals A1 to A7 against the text |
| A6 | no (dark) | stall-watch and nudge deciders; the new rung sends nothing until the operator arms it | two reviewers (it acts on live sessions once armed) |
| A7 | **yes: dispatch, ccd placement, the agent whitelist** | the dead-dispatch pass, `decideBind`'s journal, `_ws_least_loaded` and `projectHome`, a new ccd verb granted to the agent | two reviewers; one reads only the whitelist grant and the verb's argument surface |
| A8 | **yes: dispatch** | the fleet-capacity tasks loosen the concurrency cap and build the in-place bind; W1-5 edits the skill | per that plan (band 3, two reviewers each) |
| A9 | **yes: the session hook** | the roster card and the role card in `ccd/session-hook.sh` | two reviewers; one reads only the card budgets and that no server byte reaches the new line |
| A10 | no | measuring; any R7 hook deny it decides on is a later PR, security-sensitive on its own | one reviewer |

## Landing order

```
A1 (baseline) ─┐
A2 (goals read, doneWhen) ── A3 (calls, digest, Seen) ─┬─ A4 (console)
                                                        ├─ A6 (coord-ball rung, nudge, wakes)
A7 (dead dispatch, placement, self-install) ────────────┤
D-8125 merged ──────────────────────────────────────────┴─ A5 (skill) ── A9 (hook, rollout mail)
A8 (fleet-capacity W1-2 … W1-5, under that plan's gates; W1-5 after A5)
A1 … A9 deployed, rollout mail sent + 30 days ── A10 (measure, adjust)
```

Each wave ships on its own: A2 to A4 and A6 add readers and dark acts that nothing depends on until A5's words ask for
them; A7 is independent; A5 lands only once everything its words promise exists (P11); A9 only re-injects A5's rule.
Agent-lane deploys go before server deploys where a wave has both (A7, A9). The waves below are written in this landing
order (A1, A2, A3, A4, A6, A7, A5, A9, A8, A10); their names keep the spec's numbers.

## The operator's acts, per wave

Every deploy and every arming marker is the operator's (O1). Nothing in this plan arms itself.

| Wave | Acts |
|---|---|
| A1 | none (the builder runs the census read-only) |
| A2, A3, A4 | a server deploy each (the console ships with the server) |
| A5 | the coordinator skill install on the fleet box (with the agent-lane deploy) |
| A6 | a server deploy; touching `stall-watch-w2-live` makes the new rung send (it may already be armed: the PR body says what it reads) |
| A7 | the agent lane first, then the server; the dead-dispatch pass's switch in Settings, if it is off |
| A8 | a server deploy per task; OA-F4 after W1-5 (the fleet-capacity plan's acts) |
| A9 | an agent-lane deploy (the hook); the roster card's `coordinator-roster-card-live` marker if it is not armed |
| A10 | none |

## Review focus (the pinned risks)

| # | Risk | Pinned in |
|---|---|---|
| F1 | A box-token caller reads more than the goals of programmes (a secret, an item's answer, another route's data) | A2-4 |
| F2 | A worker, or another programme's coordinator, records a call on a programme | A3-3 |
| F3 | A call text carries a secret | A3-3 (stored masked), A3-6 (masked on every read) |
| F4 | An overturn reaches the wrong coordinator, or overturns a routine or `block` row | A3-5 |
| F5 | A `block` row silences `coord-ball` forever | A3-1 (expiry), A6-5 (wake), A6-1 (rung reads only live blocks) |
| F6 | The new rung mails a coordinator that is working, waiting on the operator, or paused | A6-1, A6-2 |
| F7 | The nudge types into a coordinator whose run waits on a blocking operator item | A6-4 |
| F8 | The dead-dispatch pass binds or abandons a run whose dispatch is still in flight | A7-2 (every existing guard kept; the re-measure inside the serialiser) |
| F9 | ccd placement and the server's `projectHome` disagree | A7-3 (the parity test) |
| F10 | The new ccd verb reaches anything but one home's skill directories | A7-4 |
| F11 | Clause 21 or a rewrite names a SAFETY-listed verb, an operator door, or the substring `review-cap` | A5-3 |
| F12 | A rewritten clause lets a coordinator decide an O1 to O6 question, or relax the pause for dispatch | A5-2, A5-4 |
| F13 | The roster line or role text pushes the card past its budget, or carries server bytes | A9-1, A9-2 |
| F14 | The rollout mail is sent twice, or to a worker | A9-3 |

---

## Wave A1: the baseline (no operator act)

**Builds:** `deploy/measure-autonomy.py`, the committed read-only census of §1.2 and §10, applying §5.1's split rule,
and the first M1, M2, M3, M4 and M6 readings. **Depends on:** nothing. **Lane:** none (a script; nothing ships to a box).

**What was read.** The precedent is `deploy/measure-landing.py` and `deploy/measure-history.py`: Python 3, one file,
subcommands, `--since`/`--until`, `--out DIR` (the only place it writes), `coord.db` opened
`file:<path>?mode=ro` with `uri=True` and a missing store refused, never created (`measure-history.py`'s opener), and a
test per script under `server/test/measure-*.test.ts` that runs subcommands against fixtures. Transcripts are on the
fleet box (`$HOME/.claude*/projects/**/*.jsonl`); `coord.db` is on the server box (`~/.ccrc/coord.db`): two subcommands,
one per box.

### Task A1-1: the transcript census (`transcripts`, the fleet box)

**Files:**
- Create: `deploy/measure-autonomy.py`
- Create: `server/test/measure-autonomy.test.ts`
- Create: `server/test/fixtures/measure-autonomy/` (neutral JSONL fixtures: `coord-a/`, `coord-a-copy/` (a swap copy),
  `worker-a/`, `coord-b/`)

**Interfaces** (the script's own functions; the test reaches them through subcommands, never by import):
- `is_coordinator(rows) -> bool`: a transcript that opened or dispatched a run (a Bash tool use whose command runs
  `ccrc-api runs open` or `runs dispatch`, or a `POST /api/runs` call) AND either loaded the coordinator skill (a Skill
  tool use naming `ccrc-coordinator`) or declared coordinator intent (`ccrc-api coordinators intent set`).
- `dedupe(transcripts) -> rows`: rows keyed on the message id; a swap copy contributes nothing new.
- `question_waits(rows) -> [Wait]`: a finished main-thread turn (assistant `end_turn` then a `stop_hook_summary` or
  `turn_duration` row, `idlenudge.ts`'s `TURN_END_SUBTYPES`) with a `?` in the last 700 characters of its text, counted
  only when the next user row is typed by the operator: not a mail nudge (the mail lane's wake prompt; re-ground its
  shape from `server/src/coord/envelope.ts`), not a system nudge, not `isCompactSummary`, not `isMeta`. Span: the turn's
  end to that prompt.
- `dialog_waits(rows) -> [Wait]`: an `AskUserQuestion` tool use to its `tool_result`.
- `Wait = {session, started, ended, hours, kind: 'typed-reply' | 'dialog', excerpt}`; `excerpt` is the question's last
  300 characters, written only to `--out`.
- Subcommand `transcripts [--since D] [--until D] [--root DIR]... [--out DIR]`: prints the §1.2 table's rows (count,
  over one hour, hours, median, 90th percentile, per kind) and writes `waits.json` and `waits-over-1h.csv` (columns
  `id, kind, hours, excerpt, parts`, `parts` empty, for A1-3's reviewer).

- [ ] **Step 1: Write the failing tests** in `measure-autonomy.test.ts` (`describe('measure-autonomy transcripts')`),
  each running the script with `--root` at the fixture tree and `--out` in a per-run temp dir:
  - `it('counts a coordinator and not a worker')`: `coord-a` counted, `worker-a` (no skill, no run open) not;
  - `it('removes a swap copy by message id')`: with `coord-a-copy` present the totals equal those without it;
  - `it('counts a question-ending turn only when the operator typed the next prompt')`: the fixture has three
    question-ending turns, followed by a typed prompt, a mail wake and a compaction; the answer counts one;
  - `it('times an AskUserQuestion from the dialog to its answer')`: one dialog of 90 minutes reads 1.5 hours;
  - `it('reads the 700-character tail only')`: a `?` 800 characters from the end does not count;
  - `it('writes only under --out')`: the fixture tree's file list and mtimes are unchanged after a run, and every file
    the run created is under `--out`;
  - `it('refuses an --out inside a transcript root')`: exit 2, nothing written.
- [ ] **Step 2: Run, see them fail.** `cd server && ./node_modules/.bin/vitest run --maxWorkers=2 test/measure-autonomy.test.ts`
- [ ] **Step 3: Implement** `transcripts` and its helpers. The module docstring states READ-ONLY, what it reads, where
  it writes, and that no login, host or path is written into the file.
- [ ] **Step 4: Run green.**
- [ ] **Step 5: Commit** `feat(measure): the coordinator wait census over transcripts, read-only (D-8126)`.

### Task A1-2: the server counts (`items`, the server box): M3 and M6

**Files:**
- Modify: `deploy/measure-autonomy.py`
- Modify: `server/test/measure-autonomy.test.ts` (a fixture `coord.db` built in the test from `MIGRATIONS` through
  `openCoordDb` on a temp path, then rows inserted; never a live database)

**Interfaces:**
- `items --db PATH [--since D] [--until D] [--out DIR]`:
  - **M3**, per programme: operator items raised (`operator_items.raisedAt` in the window) plus asks released to the
    operator (`asks.releasedAt` in the window, `releaseReason` or a parent of `operator`, as `askDecision` in
    `server/src/coord/digest.ts` reads it), divided by programme-days with an open run (a day counts when any run of the
    programme was open for any part of it, from `runs.openedAt` and the run's terminal `run_events` row);
  - **M6**, per week: coordinator-hours flagged by `coord-blocked`. Step 0 re-grounds where the arm's run-less verdict is
    recorded (`applyStallSession` in `server/src/watch.ts`: the feed row or the notify log) and reads that one source.
- Every query is a `SELECT`; the connection is `mode=ro`; a missing file exits 2.

- [ ] **Step 0: Re-ground** M6's source as above and name it in the docstring.
- [ ] **Step 1: Write the failing tests** (`describe('measure-autonomy items')`):
  - two programmes, one open for 2 days with 3 items and 1 released ask, one open 1 day with none: M3 reads `2.0` and
    `0.0`, and the all-programme figure `1.33`;
  - an item raised outside the window is not counted;
  - an ask the coordinator answered (`answeredBy` the parent) is not counted;
  - the database's bytes and mtime are unchanged after the run; a missing `--db` exits 2 and creates no file.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement** `items`.
- [ ] **Step 4: Run green.**
- [ ] **Step 5: Commit** `feat(measure): items per programme-day and coord-blocked hours from coord.db, read-only (D-8126)`.

### Task A1-3: the M4 sample and its score, with the split rule

**Files:** Modify `deploy/measure-autonomy.py`, `server/test/measure-autonomy.test.ts`.

**Interfaces:**
- `sample --db PATH --n 30 --seed N [--since D] [--until D] [--out DIR]`: draws `n` operator items (seeded, so a re-run
  draws the same) and writes `sample.csv` with `id, kind, title, why, parts` (`parts` empty).
- `score FILE`: reads a reviewer-filled CSV whose `parts` column holds one class per part, `;`-separated, each one of
  `routine`, `big`, `o1` to `o6`, `p1` to `p4` (§5.1's split rule: a question with several parts is classed per part);
  prints the share of parts classed `routine` or `big` (M4), and refuses a row whose `parts` holds an unknown class or
  is empty.

- [ ] **Step 1: Write the failing tests:** the same seed draws the same ids twice; `score` over a fixture CSV with rows
  `routine`, `o3`, `big;o1` reads 3 of 4 parts = 75%; a row `maybe` exits 2 naming the row.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run green.**
- [ ] **Step 5: Commit** `feat(measure): the M4 sample and its per-part score (D-8126)`.

### Task A1-4: take the baseline

- [ ] **Step 1:** On the fleet box, read-only: copy the script to a temp root, run `transcripts --since <14 days ago>`
  with `--out` in that temp root. On the server box, read-only, run `items` and `sample --n 30 --seed 1`. Nothing is
  written outside `--out`; nothing private leaves the box but the counts.
- [ ] **Step 2:** Class the sample's parts against §3 and §5 (the builder is the reviewer for the baseline; the PR body
  says so), run `score`.
- [ ] **Step 3:** Write the counts (numbers only: no question text, names or slugs) into "Where things stand" below as
  the A1 baseline, beside §10's figures.
- [ ] **Step 4: Commit** `docs(autonomy): the A1 baseline counts (D-8126)`.

**Exit:** the script and its test are on `main`; the baseline is recorded. **Rollback:** nothing ships to a box.

---

## Wave A2: the goals read for coordinators, and a stored definition of done — SECURITY-SENSITIVE (auth)

**Builds:** §8.1. `programs.doneWhen`; `goals pin` and `goals modify` accept it; `GET /api/programmes/:slug/goals`
becomes exempt-but-authenticated (session or box token, D-149's pattern) and answers `{ goals, openItems }`;
`ccrc-api goals show`. **Depends on:** nothing. **Operator act:** a server deploy.

**What was read.**
- `goalsFor(db, program)` (`ledgersStore.ts`) reads `programs.specPath, inShort, inShortAt` and
  `programme_modifications`; `GoalsView` (`shared/ledgers.ts`) is `{program, specPath, inShort, inShortAt,
  modifications}`; `WaitingView.goals` embeds one per programme (`waitingViewOf` in `ledgersRoutes.ts`).
- The pin's write is `POST /api/programmes/:slug/spec` and the modification's `POST /api/programmes/:slug/modifications`
  in `registerLedgerCoordinatorRoutes` (`ledgersRoutes.ts`), in THE ORDER the file's header states: box token, shape,
  attribution, ownership (`owns` over `claimsProgramme`), write, emit, answer. `IN_SHORT_MAX = 1200`; `RULING_MAX = 600`.
- The read `GET /api/programmes/:slug/goals` is registered in `registerLedgerOperatorRoutes` (called from `server.ts`),
  session-gated, with no `onRequest`.
- D-149's pattern: an `EXEMPT` entry naming the route "EXEMPT-BUT-AUTHENTICATED" with its reason, and the route's own
  `onRequest` that, when `cfg.authEnabled`, accepts `sessionAuth(req).reason === 'session'` or
  `checkMailToken(mailToken, req.headers[MAIL_TOKEN_HEADER], route) === 'ok'`, else `refuseRoute(reply,
  'unauthenticated', …)` (`GET /api/runs/:id/record` in `coord/routes.ts` is the nearest copy).
- `ccd/ccrc-api` `ROUTES` holds `goals.pin`, `goals.modify`, `goals.merged`; the row count word is scanned by
  `ccrc-api.test.ts` (D-8125 makes it fifty-nine).

### Task A2-1: the definition of done's shape (L0)

**Files:** Modify `shared/ledgers.ts`; Test `server/test/ledgers-policy.test.ts`.

**Interfaces:**
- `export const DONE_WHEN_MAX_ITEMS = 12; export const DONE_WHEN_ITEM_MAX = 2000;`
- `export function doneWhenOf(raw: unknown): { ok: true; doneWhen: string[] } | { ok: false; detail: string }` — an array
  of 1 to 12 strings, each trimmed to 1 to 2,000 characters; anything else refused with a detail naming both limits.
- `GoalsView` gains `doneWhen?: readonly string[] | null` (optional on the type, always sent by the server; null: none
  stored).

- [ ] **Step 1: Failing tests** (`describe('doneWhenOf (D-8126)')`): `[]`, `[""]`, `["  "]`, 13 items, a 2,001-character
  item, `"one"`, `[1]` refused; `[" a ", "b"]` answers `["a", "b"]`; exactly 12 items of 2,000 characters pass.
- [ ] **Step 2: Run, see them fail.** `cd server && ./node_modules/.bin/vitest run --maxWorkers=2 test/ledgers-policy.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run green**, plus `cd pwa && npx tsc --noEmit` (the shared type).
- [ ] **Step 5: Commit** `feat(goals): the definition of done's shape (D-8126)`.

### Task A2-2: the column and the store

**Files:** Modify `server/src/coord/schema.ts` (the next slot, P1), `server/src/coord/ledgersStore.ts`,
`server/src/coord/store.ts` (delegates only); Test `server/test/ledgers-migration.test.ts`, `server/test/ledgers-store.test.ts`,
`server/test/coord-db.test.ts`.

**Migration** (the file's comment-block form, naming D-8126, the writer and the re-measure recipe):

```sql
ALTER TABLE programs ADD COLUMN doneWhen TEXT;   -- JSON array of strings, or NULL; written by setSpecPin and setDoneWhen only
```

**Interfaces:**
- `setSpecPin(db, program, specPath, inShort, now, doneWhen: readonly string[] | null)`: the sixth parameter required,
  so every caller is visited; `null` leaves a stored list as it is (a re-pin without one keeps it).
- `setDoneWhen(db, program, doneWhen: readonly string[], now): void` — the modification route's writer.
- `goalsFor` reads `doneWhen` and parses it; a stored value that does not parse as `doneWhenOf` accepts reads `null`
  (absence permits; never a throw).

- [ ] **Step 1: Failing tests:** the migration adds the column and nothing else (`PRAGMA table_info(programs)`), a
  database at the previous `user_version` migrates, every earlier entry is byte-identical (the file's frozen-entry pin);
  `setSpecPin(..., ['x'])` then `goalsFor` reads `doneWhen: ['x']`; a re-pin with `null` keeps it; `setDoneWhen` replaces
  it; a hand-corrupted value reads `null`.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement.** Re-measure the slot (P1) first.
- [ ] **Step 4: Run green**, plus `test/ledgers-coordinator-routes.test.ts` (the pin route's caller passes `null` for now).
- [ ] **Step 5: Commit** `feat(goals): programs.doneWhen and its two writers (D-8126)`.

### Task A2-3: the pin and the modification take a definition of done

**Files:** Modify `server/src/coord/ledgersRoutes.ts`, `shared/refusal.ts` (`LEDGER_ROUTE_REFUSALS.badDoneWhen`,
`.doneWhenNeedsRuling`); Test `server/test/ledgers-coordinator-routes.test.ts`.

**Behaviour:**
- `POST /api/programmes/:slug/spec` accepts an optional `doneWhen` (`doneWhenOf`), checked with the other shapes before
  attribution; a bad one is 400 `bad-done-when` and writes nothing.
- `POST /api/programmes/:slug/modifications` accepts an optional `doneWhen`. With it, `ruling` or `itemId` is required,
  else 400 `done-when-needs-ruling` (P3); the modification row and `setDoneWhen` are written in one transaction.

- [ ] **Step 1: Failing tests:** pin with `doneWhen` stores it; pin with a 13-item list is `bad-done-when` and the pin is
  unchanged; modify with `doneWhen` and `ruling: "D-8126"` replaces it and records the modification; modify with
  `doneWhen` and neither `ruling` nor `itemId` is `done-when-needs-ruling` and writes neither; a worker's pair is
  `not-your-programme` before anything is written (the route order).
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run green.**
- [ ] **Step 5: Commit** `feat(goals): the pin and the modification carry the definition of done (D-8126)`.

### Task A2-4: the read opens to the box token (dual credential) and answers open items

**Files:** Modify `server/src/auth/gate.ts` (`EXEMPT`, the route-count sentence), `server/src/coord/ledgersRoutes.ts`
(`registerLedgerOperatorRoutes`'s deps gain `authEnabled`, `sessionAuth`, `mailToken`; the read gets its `onRequest`;
new `goalsReadOf`), `server/src/server.ts` (hands the three in), `shared/ledgers.ts` (`GoalsRead`); Test
`server/test/ledgers-operator-routes.test.ts`, `server/test/auth-gate.test.ts`, `server/test/box-token-census.test.ts`,
`server/test/coord-pause-route.test.ts` (if it lists the read as session-only).

**Interfaces:**
- `export interface GoalsRead { goals: GoalsView; openItems: { id: number; kind: ItemKind; title: string; neededBy: NeededBy }[] }`
  (A3 adds `bigCalls`).
- `export function goalsReadOf(coord: CoordStore, slug: string, now: number): GoalsRead` — the one builder (P2).
- The answer stays `{ ok: true, goals }` for today's PWA reader, plus `openItems`: additive.
- No ownership check on the read (§8.1, C9): a coordinator reads another programme's pin (row 28).

- [ ] **Step 1: Failing tests:**
  - with auth armed: no cookie and no token is 401 `unauthenticated`; a wrong token is 401; the box token alone is 200;
    a session alone is 200; the two answers are deep-equal;
  - with auth off: 200 with neither (today's behaviour);
  - the answer carries only `goals` and `openItems`, and each open item only `id, kind, title, neededBy` (never `why`,
    `how`, `answer`, `note`, `secretSlot` or a secret's state): F1;
  - `auth-gate.test.ts`: the `EXEMPT` key `GET /api/programmes/:slug/goals` exists with a reason that says
    EXEMPT-BUT-AUTHENTICATED, and the count sentence agrees with the registered routes;
  - `box-token-census.test.ts`: the read joins the dual-credential set, and the operator's session-only set loses it.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run green**, plus `test/ledgers-frame.test.ts` (the frame's goals are unchanged).
- [ ] **Step 5: Commit** `feat(goals): the goals read takes a session or the box token, D-149's pattern (D-8126)`.

### Task A2-5: `ccrc-api goals show`

**Files:** Modify `ccd/ccrc-api` (`ROUTES`, the count word in its header and table comment), `shared/api.ts`
(`ServerCap` gains `goals-read-v1`, `SERVER_CAP_MAP`), the server's cap publisher (re-ground: the `SERVER_CAPS`
writer); Test `server/test/ccrc-api.test.ts`, `server/test/ccrc-api-closed.test.ts`.

**Interfaces:** `[goals.show]='GET|/api/programmes/{id}/goals|yes|-'`, gated on `goals-read-v1` the way the claimant rows
are gated on `questions-v1`.

- [ ] **Step 1: Failing tests:** the row exists and the scanned count word matches; against the fake server, `goals show
  prog-a` sends GET with the box token header and prints the body; a current cap file without `goals-read-v1` refuses
  `unsupported` and sends nothing; a stale or absent cap file sends; `goals show ../x` is refused by `SAFE_RE`, unsent.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement**, then `ccrc restamp ccd/ccrc-api` if the generated region moved.
- [ ] **Step 4: Run green.**
- [ ] **Step 5: Commit** `feat(ccrc-api): goals show, behind goals-read-v1 (D-8126)`.

### Task A2-6: docs

- [ ] README's API list names the goals read's two credentials and the `doneWhen` field; this plan's "Where things
  stand" records A2 as built with its migration slot. **Commit** `docs(goals): the read and the definition of done in
  README (D-8126)`.

**Exit:** a coordinator's `ccrc-api goals show <slug>` answers the pin, `doneWhen` and open items; the operator's console
reads the same route unchanged. **Rollback:** `git revert`; the column stays (nullable, unread by the old build).

---

## Wave A3: the coordinator call record, the digest's call line, the Seen door — SECURITY-SENSITIVE (auth)

**Builds:** §8.2 and the server half of §6. `coordinator_calls`; `POST /api/coord/programmes/:slug/calls` and
`ccrc-api calls record`; the digest's `call` row kind and `big-call` line kind and the correction arm that overturns;
`POST /api/calls/:id/seen`; big calls on the waiting view, the goals read and the run record. **Depends on:** A2.
**Operator act:** a server deploy.

**What was read.**
- `buildDigest` lists one line per coordinator decision from `asks` and `approvals`, one predicate per table
  (`askDecision`, `approvalDecision`); `parseDigestCorrectBody` accepts `rowKind` `ask` or `approval`;
  `correctDigestRow` refuses a row its predicate does not name (`not-coordinator`), refuses `duplicate` on outstanding
  mail, then `coord.correctWithMail(rowKind, id, queue)` marks the row `corrected` and queues a `finding` mail from
  `operator`, in one transaction (D-5493). `DIGEST_ROW_KINDS`, `DIGEST_LINE_KINDS`, `DigestLine`, `DigestTotals` are in
  `shared/api.ts`.
- D-8125's door (`reviewRoundsRoute.ts` on its branch) is the route-file pattern: L4, deps handed in
  (`requireMailToken`, `requireAttribution`, `coordMutex`), order not-configured, token, body, attribution, read,
  ownership, write, notice, answer; registered from `registerCoordRoutes`; an `EXEMPT` entry.
- `redactCommand` (`coord/redact.ts`) and `cutWhole` (`coord/reviewcap.ts`).

### Task A3-1: the pure core (`coordCalls.ts`, L1) and its wire types

**Files:** Create `server/src/coord/coordCalls.ts`; Modify `shared/api.ts`; Test create `server/test/coord-calls.test.ts`.

**Interfaces:**
- `shared/api.ts`: `export type CoordCallClass = 'routine' | 'big' | 'block';` with its `Record` map and list (the
  `DIGEST_ROW_KIND_MAP` idiom); `export type CallWake = 'capacity' | 'account-room' | 'disk' | 'memory' | 'update' | \`time:${number}\`;`
  `export interface CallView { id; program; runId: number | null; madeBy; class; question: string | null; options: string[] | null; chosen; why; reversible: boolean; wakeOn: CallWake | null; at; seenAt: number | null; overturnedAt: number | null; overturnNote: string | null }`.
- `coordCalls.ts`:
  - `CALL_TEXT_MAX = 600; CALL_WHY_MAX = 300; CALL_OPTION_MAX = 300; CALL_OPTIONS_MAX = 8; BLOCK_CONDITION_TTL_MS = 24 * 3_600_000; CALL_SEEN_WINDOW_MS = 7 * 86_400_000;`
  - `callBodyOf(raw: unknown, now: number): { ok: true; call: NewCall } | { ok: false; detail: string }` — `class` one of
    the three; for `routine` and `big`: `question` 1 to `CALL_TEXT_MAX`, `options` 2 to 8 strings each 1 to 300, `chosen`
    one of `options`, `wakeOn` absent; for `block`: `question` and `options` absent, `chosen` (what the thread waits on)
    1 to 600, `wakeOn` required, a `time:` wake in the future and at most 7 days out; `why` 1 to 300, one line;
    `reversible` boolean; `runId` a positive safe integer or absent. Every text passes `redactCommand` then `cutWhole`
    (F3); a cut that leaves a text empty is refused.
  - `parseWake(s: string): CallWake | null`.
  - `blockExpiresAt(wake: CallWake, at: number): number` — a time wake at its time; a condition wake at
    `at + BLOCK_CONDITION_TTL_MS` (§8.2).
  - `isLiveBlock(row: CallRow, now: number): boolean` — `class === 'block' && wokenAt === null && expiresAt > now` (P4).
  - `callIsForOperator(row, now): boolean` — `big`, not seen, not overturned, `at > now - CALL_SEEN_WINDOW_MS`.
  - `callClearedAt(row, now): number | null` — when a big call left the operator's group (seen, overturned or aged), or
    null while it is in it.
  - `callDecision(row): { kind: 'big-call'; at: number } | null` — the digest's predicate for the call table: `big` only.

- [ ] **Step 1: Failing tests**, one `it` per rule above, including: a `block` with `question` is refused; a `big` with
  one option is refused; `chosen` not among `options` is refused; `time:` in the past and 8 days out are refused; a `why`
  with a newline is refused; a `why` holding an `sk-` shaped key comes back with no 8-character slice of it
  (`secret-mask.test.ts`'s loop idiom); `blockExpiresAt('disk', 0) === 86_400_000`; `isLiveBlock` false once `wokenAt` is
  set or at `expiresAt`; `callDecision` null for `routine` and `block`.
- [ ] **Step 2: Run, see them fail.** `cd server && ./node_modules/.bin/vitest run --maxWorkers=2 test/coord-calls.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run green.**
- [ ] **Step 5: Commit** `feat(calls): the call record's pure core (D-8126)`.

### Task A3-2: the table and the store (`coordCallsStore.ts`)

**Files:** Modify `server/src/coord/schema.ts` (the next slot, P1); Create `server/src/coord/coordCallsStore.ts`; Modify
`server/src/coord/store.ts` (one-line delegates); Test create `server/test/coord-calls-store.test.ts`, modify
`server/test/coord-db.test.ts`, `server/test/single-definition/writers-map.test.ts`, `server/test/reconstruction-drill.test.ts`.

**Migration:**

```sql
CREATE TABLE coordinator_calls (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  program      TEXT    NOT NULL,
  runId        INTEGER REFERENCES runs(id),
  madeBy       TEXT    NOT NULL,
  class        TEXT    NOT NULL,
  question     TEXT,
  options      TEXT,
  chosen       TEXT    NOT NULL,
  why          TEXT    NOT NULL,
  reversible   INTEGER NOT NULL,
  wakeOn       TEXT,
  expiresAt    INTEGER,
  at           INTEGER NOT NULL,
  seenAt       INTEGER,
  overturnedAt INTEGER,
  overturnNote TEXT,
  wokenAt      INTEGER,
  build        TEXT
);
CREATE INDEX coordinator_calls_by_program ON coordinator_calls(program, class, at);
CREATE INDEX coordinator_calls_by_run ON coordinator_calls(runId);
CREATE INDEX coordinator_calls_live_blocks ON coordinator_calls(madeBy, class, wokenAt, expiresAt);
```

**Interfaces** (functions over `DatabaseSync`, `tx` from `./tx.js`; `CoordStore` delegates of the same names):
- `insertCall(db, program, madeBy, call: NewCall, build: string | null, now): number` — the table's only INSERT; `build`
  is the server's build stamp (re-ground its reader: the one `/health` answers as `version`).
- `callsForRun(db, runId): CallRow[]`; `bigCallsFor(db, program | null, limit): CallRow[]` (newest first);
  `callsForOperator(db, now): { open: CallRow[]; cleared: CallRow[] }` (through `callIsForOperator`/`callClearedAt`);
  `liveBlocksOf(db, madeBy, now): CallRow[]`; `callById(db, id)`.
- `markCallSeen(db, id, now): 'seen' | 'already' | 'unknown' | 'not-big'` — the only writer of `seenAt`.
- `overturnCallTx(db, id, note, now)` — the only writer of `overturnedAt` and `overturnNote`, called inside
  `correctWithMail`'s transaction.
- `markBlockWoken(db, id, now): boolean` — the only writer of `wokenAt` (A6's executor), compare-and-set on `wokenAt IS NULL`.

- [ ] **Step 1: Failing tests:** the migration's shape; a database at the previous version migrates; insert and every
  reader round-trip; `liveBlocksOf` excludes woken and expired rows; `markCallSeen` twice answers `already`, on a
  routine row `not-big`; `markBlockWoken` twice answers true then false; `writers-map` names each column's writer as
  listed above.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement** (re-measure the slot).
- [ ] **Step 4: Run green.**
- [ ] **Step 5: Commit** `feat(calls): coordinator_calls and its store, one writer per column (D-8126)`.

### Task A3-3: the route (`coordCallsRoute.ts`)

**Files:** Create `server/src/coord/coordCallsRoute.ts`; Modify `server/src/coord/routes.ts` (one registration line),
`server/src/auth/gate.ts` (`EXEMPT` entry `POST /api/coord/programmes/:slug/calls`, the count sentence),
`shared/refusal.ts`, `shared/api.ts` (`CallRecordAnswer`); Test create `server/test/coord-calls-route.test.ts`, modify
`server/test/auth-gate.test.ts`, `server/test/box-token-census.test.ts`, `server/test/rings/fastify-l4.data.ts`,
`server/test/coord-routes-single-file.test.ts`.

**Behaviour, in order:** not configured (501); the box token; the slug (`isSlotSlug`); `byId`/`byUuid` non-empty
strings; `callBodyOf`; attribution (`requireAttribution`); ownership (`claimsProgramme(byId, slug)`, a throw is 503
`run-unreadable`, else 403 `not-your-programme`); for a body with `runId`, the run's programme must be the slug, else 403
`not-your-programme`; the insert; for a `big` call, one `record-only` `kind: 'coord'` feed notice; the answer
`{ ok: true, id, class, expiresAt }`.

- [ ] **Step 1: Failing tests:** no token 401; a worker's own pair 403 and nothing written (F2); another programme's
  coordinator 403 (F2); a `runId` of another programme 403; a bad body 400 with the detail; a routine call 200 with no
  notice; a big call 200 with one notice; a block call's `expiresAt` per `blockExpiresAt`; a secret in `why` is stored
  masked (F3); the `EXEMPT` reason names box token, attribution and ownership.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run green.**
- [ ] **Step 5: Commit** `feat(calls): POST /api/coord/programmes/:slug/calls, box token, attribution, ownership (D-8126)`.

### Task A3-4: `ccrc-api calls record`

**Files:** Modify `ccd/ccrc-api` (`[calls.record]='POST|/api/coord/programmes/{id}/calls|yes|-'`, the count word,
identity filled from the calling pane and a body naming `byId` or `byUuid` refused, as D-8125's `runs review-rounds`
does), `shared/api.ts` (`calls-v1`); Test `server/test/ccrc-api.test.ts`, `server/test/ccrc-api-closed.test.ts`.

- [ ] **Step 1: Failing tests:** the row and the count; `calls record prog-a --json -` sends the body with the pane's
  pair added; a body carrying `byId` is refused unsent; the cap-word gate as A2-5.
- [ ] **Step 2: Run, see them fail.** **Step 3: Implement.** **Step 4: Run green.**
- [ ] **Step 5: Commit** `feat(ccrc-api): calls record, behind calls-v1 (D-8126)`.

### Task A3-5: the digest's call line and the overturn

**Files:** Modify `shared/api.ts` (`DigestRowKind` adds `call`, `DIGEST_ROW_KIND_MAP`, `DIGEST_LINE_KINDS` adds
`big-call`, `DigestTotals.calls`), `server/src/coord/digest.ts` (`buildDigest` reads big calls in the window through
`callDecision`; `parseDigestCorrectBody` accepts `call`; `correctDigestRow`'s `call` arm), `server/src/coord/store.ts`
(`correctWithMail` takes `'call'` and calls `overturnCallTx`; `WatcherCoordPort` gains the window read); Test
`server/test/digest.test.ts`, `server/test/digest-routes.test.ts`, `server/test/digest-slots-pin.test.ts`.

**Behaviour:**
- A big call in the window is one line: `rowKind: 'call', kind: 'big-call', coordinator: madeBy, childId: ''`,
  `text` = the redacted question, `answer` = the chosen option, `reason` = `why`, `corrected` = `overturnedAt !== null`.
  Routine and block rows are never lines and never counted (R4).
- `totals.calls` counts them and `decisions` includes them (P6); `digestPushCopy` names "N calls made" when N > 0.
- The correction on a `call` row: unknown is `unknown-call`; a row `callDecision` does not name (routine, block) is
  `not-coordinator` (F4); an outstanding correction is `duplicate`; else the mail to `madeBy` and `overturnCallTx` in one
  transaction. The subject is `digestCorrectionSubject('call', id)`.

- [ ] **Step 1: Failing tests:** a day with one big, one routine and one block row lists one line and `totals.calls ===
  1`; the push copy says `1 call made`; a correction on the big row mails its coordinator and reads `corrected: true`
  after; on the routine row `not-coordinator` and nothing written; a second correction before the first is read is
  `duplicate`; the ask and approval arms are unchanged (the existing cases stay green).
- [ ] **Step 2: Run, see them fail.** **Step 3: Implement.** **Step 4: Run green.**
- [ ] **Step 5: Commit** `feat(digest): big calls are digest lines, overturned through the one correction door (D-8126)`.

### Task A3-6: the Seen door and the three reads

**Files:** Modify `server/src/coord/ledgersRoutes.ts` (`POST /api/calls/:id/seen` in `registerLedgerOperatorRoutes`;
`waitingViewOf` adds `calls` and `callsCleared`; `goalsReadOf` adds `bigCalls`, the last 20), `server/src/coord/routes.ts`
(`GET /api/runs/:id/record` adds `calls: callsForRun(id)`, one line), `shared/ledgers.ts` (`WaitingView.calls?`,
`callsCleared?`; `GoalsRead.bigCalls`), `shared/api.ts` (the run record's `calls?`); Test
`server/test/ledgers-operator-routes.test.ts`, `server/test/ledgers-frame.test.ts`, `server/test/run-record-route.test.ts`
(re-ground the run record's test file), `server/test/box-token-census.test.ts` (the door is session-only).

- [ ] **Step 1: Failing tests:** Seen with a session is 200 and idempotent; on a routine row 409 `not-big`; unknown 404;
  with only the box token 401 (it is the operator's); the waiting view lists the unseen big call, then after Seen lists
  it under `callsCleared`; a call older than 7 days is cleared; the goals read's `bigCalls` holds at most 20, newest
  first; the run record lists every class of call that names the run; every text on every read is masked again on
  egress.
- [ ] **Step 2: Run, see them fail.** **Step 3: Implement.** **Step 4: Run green.**
- [ ] **Step 5: Commit** `feat(calls): the Seen door and big calls on Waiting on you, the goals read and the run record (D-8126)`.

**Exit:** `ccrc-api calls record` stores a call; big calls appear in the digest, the waiting frame and the goals read;
an overturn mails the coordinator. **Rollback:** `git revert`; the table stays, unread.

---

## Wave A4: the console — "Calls made for you", Overturn…, Seen, the run page's Calls

**Builds:** the console half of §6. **Depends on:** A3. **Operator act:** a server deploy. **Every width:** phone, laptop
and wide are judged in the browser suite (the standing preference).

**What was read.** `WaitingScreen` draws one `ListGroup` per programme (`groupByProgramme`, `questionRows` in
`pwa/src/ledgers/ledgerWords.ts`), items then questions in `ItemRows`, and a `ClearedTrail`. `isWaitingView` and
`isGoalsFor` (`waitingView.ts`) guard the frame. `DigestScreen` accepts `rowKind` `ask` or `approval` only and posts
`api.correctDigest`. The run page is `pwa/src/screens/RunDetailScreen.tsx` with words in `pwa/src/fleet/runDetailWords.ts`
(the runs rebuild edits both; re-measure open PRs on them before A4-4).

### Task A4-1: the words and the reader (pure)

**Files:** Create `pwa/src/ledgers/callWords.ts`; Test create `pwa/test/call-words.test.ts`.

**Interfaces:** `callsOf(view: WaitingView, program: string): { open: CallView[]; cleared: CallView[] }` (absent fields
read as none: an older server); `CALLS_GROUP_WORDS(n)` = `Calls made for you (${n})`; `callLine(c, now)` = the question,
the chosen option, the reason and the age; `OVERTURN_WORD = 'Overturn…'`; `SEEN_WORD = 'Seen'`; refusal words for
`not-coordinator`, `duplicate`, `not-big`.

- [ ] **Step 1: Failing tests** for each function, including an older view with no `calls`. **Step 2: red.** **Step 3:
  implement.** **Step 4: green**, plus `pwa/test/refusal-literal-ratchet.test.ts` and the server pins that scan
  `pwa/src`. **Step 5: Commit** `feat(console): the words for calls made for you (D-8126)`.

### Task A4-2: the collapsed group, Seen, and the cleared trail

**Files:** Modify `pwa/src/ledgers/WaitingScreen.tsx` (`ListGroup` draws a `<details>` "Calls made for you (N)" below
the rows, collapsed; each call carries Seen; the cleared calls join `ClearedTrail`), `pwa/src/ledgers/ledgers.css`,
`pwa/src/lib/api.ts` (`markCallSeen(id)`, within the growth limit); Test `pwa/test/waiting-screen.test.tsx`.

- [ ] **Step 1: Failing tests:** a programme with two unseen big calls draws the group collapsed with `(2)` below its
  items; the group never counts toward the blocking badge or the screen's "nothing needs you" line (calls never count as
  blocking); Seen posts once and the row moves to the cleared trail on the next frame; no group is drawn with none.
- [ ] **Step 2: red. Step 3: implement. Step 4: green. Step 5: Commit** `feat(console): calls made for you on Waiting on you, with Seen (D-8126)`.

### Task A4-3: Overturn… with its confirm sheet

**Files:** Create `pwa/src/ledgers/OverturnSheet.tsx`; Modify `WaitingScreen.tsx`; Test create
`pwa/test/overturn-sheet.test.tsx`.

**Behaviour:** one tap opens the sheet: the options the coordinator weighed, the chosen one marked, a note field
(required, 1 to `DIGEST_CORRECTION_MAX_CHARS`); Confirm sends `correctDigest({ rowKind: 'call', id, text: note })`; a
refusal is shown in words on the sheet.

- [ ] **Step 1: Failing tests:** the sheet lists the options with the chosen one marked; Confirm is disabled on an empty
  note; Confirm posts the body exactly; `duplicate` shows its words and keeps the sheet open; success closes it.
- [ ] **Step 2: red. Step 3: implement. Step 4: green. Step 5: Commit** `feat(console): Overturn… on a call, one tap and a confirm (D-8126)`.

### Task A4-4: the digest screen and the run page

**Files:** Modify `pwa/src/screens/DigestScreen.tsx` (accept `call` rows; the line names "call" and shows the chosen
option and the reason), `pwa/src/screens/RunDetailScreen.tsx` (a collapsed "Calls" section from the run record's
`calls`, every class, read only), `pwa/src/fleet/runDetailWords.ts`; Test `pwa/test/digest-screen.test.tsx`,
`pwa/test/run-detail.test.tsx`.

- [ ] **Step 1: Failing tests:** a `call` line renders and its correction posts `rowKind: 'call'`; the run page draws the
  section collapsed with the count and draws nothing for an older record without `calls`.
- [ ] **Step 2: red. Step 3: implement. Step 4: green. Step 5: Commit** `feat(console): call lines in the digest and calls on the run page (D-8126)`.

### Task A4-5: every width

**Files:** Create `pwa/browser/calls-made.browser.test.ts`.

- [ ] **Step 1: Failing test** at 390, 1280 and 1920 px: the group heading, a call line and the Overturn sheet fit
  without horizontal scroll, the sheet's Confirm is reachable, nothing truncates the chosen option. **Step 2: red** (run
  from `pwa/` with `CCRC_CHROME`). **Step 3: fix the CSS. Step 4: green. Step 5: Commit**
  `test(console): calls made for you at phone, laptop and wide (D-8126)`.

**Exit:** the operator sees big calls under each programme, overturns one in a tap and a confirm, marks one seen, and
finds every call on the run page. **Rollback:** `git revert`.

---

## Wave A6: detectors that act — the coord-ball mail rung (dark), the nudge's run holds, block wakes, the R7 count

**Builds:** §8.3 items 1 and 2, §8.2's wakes and lapses (P7, P4), and P12. **Depends on:** A3. **Operator act:** a server
deploy; `stall-watch-w2-live` makes the rung send.

**What was read.**
- `coord-ball` (`server/src/coord/stall.ts`): in the per-run verdict, when `f.ball === 'coordinator'`, coord-deaf first,
  then `capVerdict('coord-ball', key)` at `COORD_BALL_CAP_MS` (30 h), rung 1 to the operator. `STALL_ARM_WAVE` maps the
  arm to wave 1. `STALL_RUNG_RECIPIENTS['coord-ball'] = ['operator']`. `stallNotifyDelivery(arm, to, arming)` keeps a
  wave-2 arm shadow until `w2Live`. `StallRecipient` `worker` is "the session the arm watches" (orphan D's rung 1 mails
  the session itself that way).
- The coordinator-level pass is `judgeStallCoordinator` (`server/src/watch.ts`): it builds a `StallSessionInput` for one
  coordinator (live word, turn marker, its mail and deliveries, arming, the pause) and runs the session arms and
  `stallCoordBlockedStep` (`StallCoordBlockedInput`: the session, its child fact, the active runs it claims, the
  remembered episode). `stallCoordGate` reads `waiting` from a live `waiting` word or a pending dialog.
- The nudge (`server/src/idlenudge.ts`): `decideIdleCompactNudge` holds `tasks-unread`, then `no-open-tasks`, then
  `tasks-stale` (`TASKS_STALE_MS`); the lane is `sweepIdleCompactNudge` in `watch.ts`.

### Task A6-1: the mail rung's decider (L1)

**Files:** Modify `server/src/coord/stall.ts`; Test create `server/test/stall-coord-ball-mail.test.ts`, modify
`server/test/stall-vocabulary.test.ts`, `server/test/stall-verdict.test.ts`.

**Interfaces:**
- `export const COORD_BALL_MAIL_MS = 20 * 60_000; export const COORD_BALL_MAIL_AGAIN_MS = 30 * 60_000;`
- `STALL_RUNG_RECIPIENTS['coord-ball'] = ['operator', 'worker', 'worker']` (P8); the `StallNotify` union gains
  `{ act: 'notify'; arm: 'coord-ball'; rung: 2 | 3; key: number; to: 'worker' }`.
- `stallRungWave(arm, rung)`: `coord-ball` rungs 2 and 3 are wave 2, rung 1 wave 1; every other arm reads
  `STALL_ARM_WAVE`. `stallNotifyDelivery` takes the rung and asks it.
- `export interface StallCoordBallInput { session: StallSessionInput; runs: readonly StallRunRow[] /* every non-terminal run it claims, review runs included */; blockingItem: boolean; liveBlock: boolean; waitSentAt: number | null; ballSince: number | null /* the newest per-run ball-to-coordinator time across its claimed runs */ }`
- `export function stallCoordBallMailStep(input: StallCoordBallInput, now: number): StallVerdict` — none unless: the
  session reads `idle` (`stallSessionLive` word idle), no delivery to it is `queued` (no held mail), it claims at least
  one open run, `ballSince` is at least `COORD_BALL_MAIL_MS` ago, and none of these holds: a claimed run `dispatched` or
  `working`; an open review run it claims; a claimed run at `merging` (P9); `blockingItem`; `liveBlock`; a `wait:` mail
  it sent after `ballSince`; coordination paused. Then rung 2 keyed on `ballSince` if not done; rung 3 when rung 2 was
  done `COORD_BALL_MAIL_AGAIN_MS` ago and the session is still idle with no turn since; never a third mail. Through
  `stallMailDisabledHold`.
- `stallCoordBallMail(n): { subject; body }` — subject `stall:coord-ball:<key>` (so `stallMailClass` reads it as the
  watch's own notice), body "You have open runs and nothing waits on the operator. Continue per coordinator clause 21;
  re-read `runs list` and `goals show`." (§8.3).

- [ ] **Step 1: Failing tests**, one per condition (F6): idle 19 minutes is none; idle 20 minutes with nothing else is
  rung 2 to `worker`; each hold above alone makes it none; a held mail makes it none; rung 2 done 29 minutes ago is none,
  30 minutes ago is rung 3; rung 3 done is none; with `w2Live` false the delivery is shadow and rung 1's delivery is
  unchanged; the 30 h operator push still fires at `COORD_BALL_CAP_MS` in the per-run verdict (the existing cases stay
  green); `isStallKebab` admits nothing new it should not.
- [ ] **Step 2: Run, see them fail.** `cd server && ./node_modules/.bin/vitest run --maxWorkers=2 test/stall-coord-ball-mail.test.ts test/stall-verdict.test.ts test/stall-vocabulary.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run green**, plus `test/stall-session.test.ts test/stall-coord-blocked.test.ts test/stall-bodies.test.ts`.
- [ ] **Step 5: Commit** `feat(stall): coord-ball mails the coordinator before anyone pushes the operator, dark (D-8126)`.

### Task A6-2: the rung's facts and its act, in the coordinator pass

**Files:** Modify `server/src/watch.ts` (`judgeStallCoordinator`), `server/src/coord/ports.ts` (`WatcherCoordPort` gains
`liveBlocksOf`, `programmeHasBlockingItem`, `isPinned`); Test `server/test/stall-sweep.test.ts`.

**Behaviour:** the pass reads, from the store, the coordinator's claimed non-terminal runs, whether any of its
programmes holds a `blocking` open item, its live blocks, its newest `wait:` mail, the newest per-run ball time (the
per-run facts' `lastExchangeAt` where the ball is the coordinator's), and runs `stallCoordBallMailStep`; a mail verdict is
sent through the pass's existing session apply (`applyStallSession`) with `stallCoordBallMail`'s words; a shadow verdict
records its shadow row as every arm does.

- [ ] **Step 1: Failing tests** with a fake store and clock: an idle coordinator with one run at `awaiting-review` 25
  minutes after the worker's done mail gets one mail (live arming) or one shadow row (w2 unarmed); with a blocking item
  nothing; a second sweep a minute later sends nothing more; a paused box sends nothing.
- [ ] **Step 2: red. Step 3: implement. Step 4: green. Step 5: Commit** `feat(stall): the coordinator pass measures and applies the coord-ball mail rung (D-8126)`.

### Task A6-3: the R7 count

**Files:** Modify `server/src/watch.ts` (beside `stallCoordBlockedStep`'s apply), `server/src/coord/stall.ts`
(`stallR7Breach(input: StallCoordBlockedInput, pinned: boolean): boolean` — the episode's gate is `waiting` through
`dialogPending`, and the claimed run's programme is pinned); Test `server/test/stall-coord-blocked.test.ts`.

- [ ] **Step 1: Failing tests:** a coord-blocked episode held by a pending dialog on a pinned programme writes one
  `r7-breach` feed row keyed on the episode (`hasNotice`'s once-only key), a second sweep writes none, a live `waiting`
  word with no dialog writes none, an unpinned programme writes none; the push itself is unchanged.
- [ ] **Step 2: red. Step 3: implement. Step 4: green. Step 5: Commit** `feat(stall): count a dialog on a pinned programme as an R7 breach (D-8126)`.

### Task A6-4: the nudge counts a coordinator's open runs

**Files:** Modify `server/src/idlenudge.ts`, `server/src/watch.ts` (`sweepIdleCompactNudge` gathers the fact); Test
`server/test/idle-compact-nudge.test.ts`, `server/test/idle-compact-nudge-lane.test.ts`.

**Interfaces:** `IdleNudgeFacts` gains `openRun: { readonly ok: true; readonly lastEventAt: number | null; readonly blocked: boolean } | { readonly ok: false } | null`
— `null`: the session claims no non-terminal run. In `decideIdleCompactNudge`, after `background`: when `openRun` is
`{ok: true, blocked: false}`, skip `tasks-unread`, `no-open-tasks` and `tasks-stale`, and hold `tasks-stale` instead when
`lastEventAt === null || now - lastEventAt > TASKS_STALE_MS`; `{ok: true, blocked: true}` holds a new
`run-blocked-on-operator`; `{ok: false}` holds `unmeasured`. Every other hold and its order stay;
`IDLE_NUDGE_HOLD_MAP` gains the one word.

- [ ] **Step 1: Failing tests** (F7): a coordinator with no task list and an open run whose newest event is an hour old
  is nudged; the same with its run's programme holding a blocking item holds `run-blocked-on-operator`; an unreadable
  run read holds `unmeasured`; a run event older than `TASKS_STALE_MS` holds `tasks-stale`; a session with no open run
  keeps every task hold exactly (the existing table stays green); once per compaction still holds.
- [ ] **Step 2: red. Step 3: implement. Step 4: green. Step 5: Commit** `feat(idle-nudge): a coordinator's open run counts as open work (D-8126)`.

### Task A6-5: block wakes and lapses on the existing lanes (P7)

**Files:** Modify `server/src/coord/coordCalls.ts` (`blockWakeDue`), `server/src/watch.ts` (the coordinator pass calls
it per live block and applies it); Test `server/test/coord-calls.test.ts`, `server/test/stall-sweep.test.ts`.

**Interfaces:** `blockWakeDue(row: CallRow, f: { now: number; disk: 'ok' | 'not-ok' | 'unknown'; memory: 'clear' | 'not-clear' | 'unknown'; build: string | null; turnSince: boolean }): 'wake-mail' | 'wake-quiet' | 'none'`
— `time:` at or after its time: `wake-mail`; `disk` when `ok`, `memory` when `clear`: `wake-mail`; `update` when the
running server's build stamp differs from the row's `build` (P4): `wake-mail`; `account-room` when the coordinator ran a turn since the row:
`wake-quiet`; `capacity`: `none` (A8); `unknown` is `none` (doubt waits for the lapse). The executor calls
`markBlockWoken` and, for `wake-mail`, `queueSystemMail` from `operator` to `madeBy` with subject
`wake: call <id> (<wakeOn>)` and a body naming what the thread waited on (`chosen`). The mail lane's wake path keeps the
wake budget (D-5242).

- [ ] **Step 1: Failing tests:** each wake case above; a woken row is no longer a live block and `coord-ball`'s rung may
  fire again (F5); an expired condition row is not mailed; the compare-and-set means two passes send one mail.
- [ ] **Step 2: red. Step 3: implement. Step 4: green. Step 5: Commit** `feat(calls): parked threads wake on the lanes that already watch their condition (D-8126)`.

**Exit:** with `stall-watch-w2-live` absent, the rung records shadow rows only; the nudge reaches coordinators; block
wakes mail. The PR body reports a day of shadow rows from a test box or the fleet's own shadow log once deployed.
**Rollback:** `git revert`; the rung never sent unarmed.

---

## Wave A7: the server owns its faults — orphaned spawns, lanes that cannot spawn, the self-install — SECURITY-SENSITIVE (dispatch, placement, agent whitelist)

**Builds:** §8.3 items 3, 4 and 5 (P10). **Depends on:** nothing of this plan. **Operator acts:** the agent lane first,
then the server; the dead-dispatch pass's switch if it is off.

**What was read.**
- `decideBind` (`server/src/coord/dispatchDecide.ts`): after the `ws-add`, an unreadable or degraded AFTER registry read
  refuses `registry-unmeasurable`; more or fewer than one new candidate refuses `ambiguous-dispatch` (with a
  `dispatch-refused:` event when ccd also failed, none when it did not). `decideBefore`'s `registry-unmeasurable` is
  before any spawn and is not an orphan.
- The pass (`server/src/coord/abandonDeadDispatch.ts`): candidates are `stalledDispatchRunIds(now -
  cfg.dispatchAbandonMs)` (planned, no session, `dispatchStartedAt` at or before the bound); then the switch, the facts,
  `deadDispatchVerdict`, the child bind gate, the re-measure inside the serialiser, the act, the journal, the mail; at
  most `DISPATCH_ABANDON_PER_PASS` a pass.
- Placement: `_ws_least_loaded` in `ccd/ccd` and its server twin `projectHome` (`server/src/limits.ts`), held equal by
  `coord-placement.test.ts` and `ccd-backend-vs-placement.test.ts`. `$REG/<id>.spawn` is `<epoch> <rc>`; rc 2 is
  `login`, rc 5 `blocked` (`spawnVerdict`, `shared/api.ts`); a registry row's `spawn` and its wrapper are read by
  `registry.ts`.
- The skill read at dispatch: `readSkillState` (`server/src/skillstate.ts`) on the bound worker's config dir, recorded as
  `skill-preflight:<state>`; the installers `ccd/install-coordinator-skill.sh` and `ccd/install-worker-skill.sh` take
  `--homes <dir>...` and are deployed to `~/.cc-sessions/`. The agent grants ccd verbs from `ALLOWED.ccd` with
  `REQUIRED_VERB_FLAG` (`agent/src/whitelist.ts`).

### Task A7-1: a dispatch that orphaned its spawn says so in the run's journal

**Files:** Modify `server/src/coord/dispatchDecide.ts`, `shared/dispatch-abandon.ts` (`DISPATCH_ORPHANED_EVENT =
'dispatch-orphaned:'`); Test `server/test/dead-dispatch-characterization.test.ts` (characterization first), the dispatch
decider's test (re-ground its file).

- [ ] **Step 1: Characterize** `decideBind`'s refusals and events as they are (green on `main`); commit
  `test(dispatch): characterize decideBind's after-spawn refusals (D-8126)`.
- [ ] **Step 2: Failing tests:** the AFTER read unlistable (with and without ccd's stderr) carries
  `dispatch-orphaned:registry-unmeasurable`; two candidates carry `dispatch-orphaned:ambiguous-dispatch` whether ccd
  failed or not (the existing `dispatch-refused:` event is kept beside it when ccd failed); zero candidates with ccd
  failed stays `fleetFailed` with no orphan event; `decideBefore`'s refusal carries none.
- [ ] **Step 3: red. Step 4: implement. Step 5: green. Step 6: Commit** `feat(dispatch): an orphaned spawn is journaled on its run (D-8126)`.

### Task A7-2: the pass takes an orphaned spawn at once

**Files:** Modify `server/src/coord/store.ts` (`stalledDispatchRunIds(startedAtOrBefore)` also admits a planned run with
no session whose newest `run_events` row at or after `dispatchStartedAt` begins `dispatch-orphaned:`, whatever its
stamp), `server/src/coord/abandonDeadDispatch.ts` (the mail body names the orphaned refusal);
Test `server/test/dead-dispatch-lane.test.ts`, `server/test/dead-dispatch-policy.test.ts`.

- [ ] **Step 1: Failing tests** (F8): an orphaned run stamped a minute ago is a candidate; with exactly one `.child`
  marker naming it and a live pane it binds (the existing bind path); with none it is abandoned and the coordinator is
  mailed; a run whose dispatch is still in flight (no orphan event, stamp inside the bound) is not a candidate; the
  switch off, the pause, the per-pass cap and the re-measure inside the serialiser all still stop it (the existing cases
  stay green); a later re-dispatch's newer stamp hides an older orphan event.
- [ ] **Step 2: red. Step 3: implement. Step 4: green. Step 5: Commit** `feat(dead-dispatch): registry-unmeasurable and ambiguous dispatches go to the pass at once (D-8126)`.

### Task A7-3: placement skips a lane that cannot spawn (ccd and the server alike)

**Files:** Modify `ccd/ccd` (`_ws_lane_cannot_spawn <wrapper>`: rc 0 when the newest `$REG/*.spawn` among rows whose
wrapper is `<wrapper>` records rc 2 or 5; `_ws_least_loaded` skips such a lane in every tier but the last, the
condemned tier's argument applying), `server/src/limits.ts` (`projectHome` takes the same fact from the registry rows
and skips the same lanes); Test `server/test/coord-placement.test.ts`, `server/test/ccd-backend-vs-placement.test.ts`.

- [ ] **Step 1: Failing tests** (F9), on fixture HOMEs: lane-a's newest spawn rc 2 and lane-b healthy places on lane-b
  in both implementations; a later rc 0 spawn on lane-a makes it placeable again; every lane unable to spawn still
  places (the last tier), and both agree; an unreadable `.spawn` is not a skip (absence permits).
- [ ] **Step 2: red. Step 3: implement. Step 4: green**, plus `test/ccd-ws-add-child.test.ts`. **Step 5: Commit**
  `feat(placement): a lane whose newest spawn needs a sign-in or is blocked takes no new work (D-8126)`.

### Task A7-4: `ccd skill-ensure --wrapper <id>`, granted to the agent

**Files:** Modify `ccd/ccd` (`cmd_skill_ensure`: resolves the wrapper's config dir through the roster, refuses an id
outside `WRAPPER_ID_RE` or the roster, runs `$REG/install-coordinator-skill.sh --homes <dir>` then
`$REG/install-worker-skill.sh --homes <dir>`, prints one JSON line `{"wrapper": …, "result": "installed" | "converged" | "failed", "detail": …}`),
`agent/src/whitelist.ts` (`['skill-ensure', '--wrapper']` and `REQUIRED_VERB_FLAG['skill-ensure'] = '--wrapper'`),
`server/src/ccdargv.ts` (the one builder); Test create `server/test/ccd-skill-ensure.test.ts`, modify
`agent/test/whitelist.test.ts`, `agent/test/whitelist-subset.test.ts`, `agent/test/whitelist-noghosts.test.ts`.

- [ ] **Step 1: Failing tests** (F10), fixture HOME with two homes: the verb installs both skills into lane-a's home and
  touches lane-b's not at all; a converged home answers `converged` and changes no mtime; an unknown wrapper exits 2 and
  writes nothing; a missing source answers `failed` with the installer's refusal; the agent refuses `skill-ensure`
  without `--wrapper` and any second positional; the server builds exactly `['skill-ensure', '--wrapper', id]`.
- [ ] **Step 2: red. Step 3: implement. Step 4: green. Step 5: Commit** `feat(ccd): skill-ensure installs the coordinator and worker skills on one home (D-8126)`.

### Task A7-5: a dispatch that measures the skill absent installs it

**Files:** Modify `server/src/coord/dispatch.ts` (after `readSkillState` answers `absent`, outside the coordination
serialiser — re-ground: if the preflight runs inside it, the install runs after its release — call `skill-ensure` for
the bound worker's wrapper through `RunCcd` with a bounded deadline, record `skill-install:<result>` on the run, and add
`skillInstall: 'installed' | 'converged' | 'failed' | null` to the dispatch answer), `shared/api.ts` (the answer's
field); Test `server/test/dispatch-skillstate.test.ts`.

- [ ] **Step 1: Failing tests:** `absent` runs the verb once and answers `installed` with the event; a failing verb
  answers `failed`, the dispatch still succeeds; `present` and `unmeasurable` run nothing; the run's bind is not delayed
  behind the install (the bind is recorded first).
- [ ] **Step 2: red. Step 3: implement. Step 4: green. Step 5: Commit** `feat(dispatch): the worker skill installs itself where a dispatch finds it absent (D-8126)`.

**Exit:** rows 22, 32, 36, 37 and 38 have their server halves. **Rollback:** `git revert` the server first, then the
agent lane; the verb is inert without the server calling it.

---

## Wave A5: the coordinator skill — clause 21, the decision procedure, §7's dispositions — SECURITY-SENSITIVE (the pinned text)

**Builds:** §9.1. **Depends on:** A2, A3, A6, A7 merged (P11) and D-8125 merged (its step 5 and `wave-lifecycle.md`
edits are the base this wave rewrites). **Operator act:** the skill install on the fleet box with the agent-lane deploy.

**What was read.** `ccd/coordinator-skill/SKILL.md`: "These twenty sentences", clauses 1 to 20, the lifecycle steps, "When
something is wrong"; `server/test/coordinator-skill.test.ts`: `CONTRACT` (the twenty clauses verbatim), `WORDS` up to
`twenty`, `expect(CONTRACT).toHaveLength(20)`, the destructive verbs named only in clause 3, `update-branch` only in
clause 15, the substring `review-cap` forbidden, the operator's doors forbidden; `install-coordinator-skill.sh`'s
`REQUIRED_REFS`; `references/routing-matrix.md`'s 2026-09-22 ceiling.

### Task A5-1: clause 21 and its pin

**Files:** Modify `ccd/coordinator-skill/SKILL.md` (clause 21 exactly as §9.1 quotes it, approved 2026-11-09; "These
twenty-one sentences"), `server/test/coordinator-skill.test.ts` (`CONTRACT` gains it; `WORDS` gains `twenty-one`; the
length pin reads 21), any other skill file that states the count (the test's own scan finds them).

- [ ] **Step 1: Failing test:** add clause 21 to `CONTRACT` and the length pin; run, see "carries all twenty clauses
  verbatim" and the count fail.
- [ ] **Step 2: Implement** the text, character for character (straight quotes, the em dashes as §9.1 has them).
- [ ] **Step 3: Green**, plus `test/worker-skill.test.ts`. **Step 4: Commit** `feat(skill): clause 21, coordinators decide by default (D-8126)`.

### Task A5-2: clauses 4, 11, 19 and 20, rewritten (§9.1, rows 1, 4, 8, 9, 10)

**Files:** Modify `SKILL.md`, `coordinator-skill.test.ts` (the four `CONTRACT` entries; the clause-19 and clause-20 row
pins by name).

**The new words** (the builder drafts each to §9.1's list and the spec's rows; the reviewer reads them against
anti-goals A1 to A7):
- **Clause 4:** the operator's file stays the operator's and the session never unpauses itself; a `paused` dispatch is
  read by cause — the pause file present: no dispatch, no in-place bind and no self-work on new waves, while
  non-dispatch work continues (landing already-reviewed PRs, reviews, docs); absent: the registry was unlistable, a
  fault retried with backoff (row 1).
- **Clause 11:** "Rule only from what you can read: the spec, the plan, the ledger, the branch, the programme's goals
  and definition of done, and your own prior rulings"; working an answer out from the goals is reading; release only
  what clause 21 makes the operator's. The permission-prompt half is unchanged (row 5, D-5299).
- **Clause 19:** a question to the operator is an item, never a turn ending on a question; no AskUserQuestion on a
  pinned programme (R7); before the pin, dialogs are allowed only while no child is active (today's rule).
- **Clause 20:** items are for the operator-only classes and for blocks that need a human act; a big call is a record,
  not a decide item.

- [ ] **Step 1: Failing tests:** the four `CONTRACT` entries replaced; new row pins: clause 4 names "non-dispatch work
  continues" and still says the session never unpauses itself (F12); clause 11 names "definition of done" and still
  forbids typing into another pane; clause 19 forbids AskUserQuestion on a pinned programme; clause 20 still requires the
  recommendation on a `decide` item.
- [ ] **Step 2: red. Step 3: implement. Step 4: green. Step 5: Commit** `feat(skill): clauses 4, 11, 19 and 20 read the goals first (D-8126)`.

### Task A5-3: `references/decision-procedure.md`, and the text constraints

**Files:** Create `ccd/coordinator-skill/references/decision-procedure.md` (§5 whole, with §5.1's split rule, §5.2's
standing operator preferences, §5.3's tie-breakers, §5.4's line and table, §5.7; §3's O1 to O6 with the C2 list and §4's
P1 to P4 healing steps and backoff, in the skill's words, saying "SAFETY-listed verbs" and naming none); Modify
`ccd/install-coordinator-skill.sh` (`REQUIRED_REFS` gains it), `server/src/skillstate.ts` (D-1027's comment, if it
counts the references), `server/test/coordinator-skill.test.ts`, `server/test/install-coordinator-skill.test.ts`.

- [ ] **Step 1: Failing tests** (F11): the file exists and the installer refuses a source without it; no skill file
  names `ws-reap`, `ws-rm` or `ws-gc --prune` outside clause 3; none contains `review-cap`; none names
  `/api/digest/correct`, `/api/programmes/` or `/api/coord/programmes/`; the reference names `ccrc-api goals show` and
  `ccrc-api calls record`; it lists the five standing preferences; it states the split rule once; O1 lists comments on
  others' PRs and issues in public repositories and mirrored tracker writes as routine (the operator's answer 3).
- [ ] **Step 2: red. Step 3: implement. Step 4: green. Step 5: Commit** `feat(skill): the decision procedure as a reference (D-8126)`.

### Task A5-4: "When something is wrong" and the lifecycle steps (§7)

**Files:** Modify `SKILL.md`; Test `coordinator-skill.test.ts`.

**Dispositions written:** `paused` split by cause (row 1); cannot reach the server is P3 with the time-wake backoff, and
when the server itself is down the turn's text says so (row 23); step 4's `unknown-item`/`item-terminal` (row 11); step
5's cap through D-8125's door and §5.7 (rows 12, 13, 62); step 6's ejection, dequeue, advance and different-project rows
(rows 14 to 17); the stale-uuid resend (row 61). **Kept as today:** the `cap-concurrency` entry and the description (rows
18, 27: W1-5 in A8 rewrites them, P11); routing (row 49).

- [ ] **Step 1: Failing tests:** "A program that stalls honestly is recoverable" is gone; the `paused` entry names both
  causes; the unreachable-server entry names backoff and `calls record` with a time wake; a pin that the `cap-concurrency`
  entry is unchanged until W1-5 (it is the fleet-capacity plan's to rewrite).
- [ ] **Step 2: red. Step 3: implement. Step 4: green. Step 5: Commit** `feat(skill): every stop in the skill gets its recovery or its class (D-8126)`.

### Task A5-5: the references move with the skill

**Files:** Modify `references/wave-lifecycle.md` (rows 1, 12 to 45, 56 to 58: each refusal row's "stop and report" becomes
its disposition; row 38's "running the installer is a human act" becomes the self-install the dispatch answer reports as
`skillInstall`), `references/resume.md` (rows 3, 47: the handover through the runs rebuild's Resume door; the thread
parks), `references/peer-protocol.md` (row 50), `references/ledger-template.md` (a "Goals and definition of done"
section), `references/routing-matrix.md` (unchanged); Test `coordinator-skill.test.ts`.

- [ ] **Step 1: Failing tests:** a pin that `routing-matrix.md` still carries "the third attempt is a rung a human
  chooses" (§15 Q4 is open; this wave does not build row 49's change); `wave-lifecycle.md` no longer says "running the
  installer is a human act"; the ledger template carries the new section; each rewritten row names a recovery, a class,
  or a park — not "stop and report" (a scan of the rows' table cells).
- [ ] **Step 2: red. Step 3: implement. Step 4: green**, plus `test/install-coordinator-skill.test.ts
  test/install-worker-skill.test.ts`. **Step 5: Commit** `feat(skill): the references carry the new dispositions (D-8126)`.

**Exit:** the installed skill holds clause 21 and its procedure; no coordinator-facing text says "stop and report" where
§7 gives a recovery. **Rollback:** `git revert`, then the skill installer re-run (the operator's act).

---

## Wave A9: the rule after compaction — the roster line, the role card, the rollout mail — SECURITY-SENSITIVE (the session hook)

**Builds:** §9.2 and §9.3. **Depends on:** A5. **Operator act:** an agent-lane deploy; the roster card's marker if unarmed.

**What was read.** `ccd/session-hook.sh`: `_hook_role_card` sets `CARD_ROLE` (its text ends "your own go to the
operator."); `_hook_roster_card` runs `ROSTER_PROGRAM` (jq) over `ccrc-api runs list` under `ROSTER_CARD_MAX_CHARS`
(2,048) less 64, armed by `$REG/coordinator-roster-card-live`, else a shadow log; `_hook_emit_context` clips the standing
cards to `CARD_MAX_CHARS` and the sum to `CARD_TOTAL_MAX_CHARS`; tests `session-hook-role-card.test.ts`,
`session-hook-roster-card.test.ts`.

### Task A9-1: the roster card's fixed autonomy line

**Files:** Modify `ccd/session-hook.sh` (`ROSTER_AUTONOMY_LINE`, a constant: "ccrc-autonomy: before asking the operator,
read your goals (`ccrc-api goals show <slug>`), decide, record (`ccrc-api calls record`), continue; stop only for an
operator-only act or a physical block (coordinator clause 21)."; `ROSTER_PROGRAM` places it after the header line and
before the run lines, counted inside `$max`); Test `server/test/session-hook-roster-card.test.ts`.

- [ ] **Step 1: Failing tests** (F13): an armed coordinator with two runs gets the line before the first run; with forty
  runs the card is still at most `ROSTER_CARD_MAX_CHARS - 64` and the line survives (runs collapse first); a server
  answer carrying the line's text in a run's field does not duplicate or alter it (the `s` sanitiser); a coordinator with
  no open runs gets no card; a child gets nothing.
- [ ] **Step 2: red. Step 3: implement. Step 4: green. Step 5: Commit** `feat(hook): the roster card carries the autonomy line (D-8126)`.

### Task A9-2: `CARD_ROLE`

**Files:** Modify `ccd/session-hook.sh` (the text: "…your own you work out from the programme's goals first; only
operator-only decisions go to the operator."); Test `server/test/session-hook-role-card.test.ts`, the card-budget pin
(re-ground: the test that sums the structural worst case).

- [ ] **Step 1: Failing tests:** the new text exactly; the structural worst case (graphify + held case A + co-tenant +
  role) is still within `CARD_MAX_CHARS`, or the pin's arithmetic is re-derived in the same commit with the reason.
- [ ] **Step 2: red. Step 3: implement. Step 4: green**, plus `test/session-hook.test.ts` (a known load flake: re-run
  alone before calling it). **Step 5: Commit** `feat(hook): the role card says coordinators work it out first (D-8126)`.

### Task A9-3: the rollout mail

**Files:** Create `server/src/coord/skillRollout.ts` (L1 `rolloutMailsDue(claimants, sent: (id) => boolean, revision)`
and its words; L4 call at server start beside the other start-up passes, re-grounded in `index.ts`/`server.ts`);
`shared/api.ts` (`COORDINATOR_SKILL_REVISION = 'clause-21'`); Test create `server/test/skill-rollout.test.ts`.

**Behaviour:** at start, every session that claims a non-terminal run and is not a child gets one system mail, "The
coordinator skill changed (clause 21). Re-read `ccrc-coordinator`, then `goals show` for your programme.", through
`queueSystemMail`, and a feed row keyed `skill-rollout:<revision>:<session>` (`hasNotice`, P13).

- [ ] **Step 1: Failing tests** (F14): two claimants get one mail each; a restart sends none; a worker (child marker)
  gets none; a later revision constant sends again.
- [ ] **Step 2: red. Step 3: implement. Step 4: green. Step 5: Commit** `feat(coord): one rollout mail per coordinator per skill revision (D-8126)`.

**Exit:** a compacted coordinator's context carries the rule; running coordinators are told once. **Rollback:** `git
revert`; the hook change rides the agent lane.

---

## Wave A8: the do-it-yourself ruling, built — SECURITY-SENSITIVE (dispatch)

**Builds:** §8.4: fleet-capacity W1-2, W1-3, W1-4, W1-4b and W1-5 (D-6093 to D-6097), from
`docs/superpowers/plans/2026-10-20-fleet-capacity-w1.md`, in that plan's order and under its gates, Files, steps and
review routing. This plan adds only the amendments below. **Depends on:** that plan's gates (OA-F2 met; OA-F3 measured
read-only); W1-5 after A5. **Operator acts:** a server deploy per task; OA-F4 after W1-5.

| Task | That plan's task | Amendment from D-8126 |
|---|---|---|
| A8-0 | — | Re-ground that plan against `main` (written 2026-10-20): every anchor by symbol, the consolidation tasks it waits for (C1h, C1f) confirmed on `main`, its gates re-read. Commit the re-ground as a docs change to that plan. |
| A8-1 | W1-2 (D-6093) | none |
| A8-2 | W1-3 (D-6094) | none |
| A8-3 | W1-4 (D-6095) | the wake-on-free also marks the woken coordinator's live `capacity` block calls woken (`markBlockWoken`), so A6's executor and the rung read them as cleared (P7); a failing test: a refused coordinator with a `capacity` block is mailed once and its block reads woken |
| A8-4 | W1-4b (D-6096) | the in-place bind refuses under the operator's pause (D-6096 holds); a test pins that non-dispatch acts (close, advance, landing) are not refused by the pause |
| A8-5 | W1-5 (D-6097) | reason 6 worded to clause 4 (the operator's answer 2); the skill's `cap-concurrency` entry and the description rewritten (rows 18, 27), which A5 left (P11); the pin that A5-4 added is replaced by the new words' pin |

Each task's commit lines are that plan's, citing its own D-number and D-8126.

**Exit:** §3.5(e)'s ruling is built; no coordinator-facing text says "wait to be woken" for a cap. **Rollback:** per
that plan.

---

## Wave A10: measure at 30 days, and adjust

**Builds:** §10's measuring and the two decisions it feeds. **Depends on:** A1 to A9 deployed and 30 days after the
rollout mail. **Operator act:** none (any change it decides on is its own PR).

### Task A10-1: the census reads the call record

**Files:** Modify `deploy/measure-autonomy.py` (`calls --db PATH`: M5, the overturn rate of big calls; M7, the time from
a woken or lapsed `block` row to the coordinator's next call or run event; M8, operator-only acts in the record: a call
whose text names an O1 to O4 act decided as `routine` or `big`, listed for a human to audit beside the hook's deny log;
and `transcripts --pinned-from-server` reading pinned programmes through `ccrc-api goals show` for M2);
Test `server/test/measure-autonomy.test.ts`.

- [ ] **Step 1: Failing tests:** over a fixture database with 10 big calls, 2 overturned, M5 reads 20%; a woken block at
  t and a call at t + 4 minutes reads M7 4 minutes; `--pinned-from-server` reads its list through a recording
  `ccrc-api` stub, `goals show` and `runs list` only (any other verb refused before the client runs).
- [ ] **Step 2: red. Step 3: implement. Step 4: green. Step 5: Commit** `feat(measure): overturns, wake-to-act and the call audit (D-8126)`.

### Task A10-2: take the 30-day readings and decide

- [ ] **Step 1:** Re-run A1-4's procedure and `calls`, read-only, at weekly points and at 30 days.
- [ ] **Step 2:** Record M1 to M8 against §10's targets in "Where things stand".
- [ ] **Step 3: R7's hook deny.** If M2 is above 0 two weeks after the rollout mail, raise the decision as a plan task for
  a later, security-sensitive PR (a `PreToolUse` deny in `ccd/session-hook.sh` on AskUserQuestion for a session that
  claims a run of a pinned programme); it is not built in A10.
- [ ] **Step 4: M5.** If the overturn rate is above 15%, find the kind of call that clusters, and propose the change to
  §5.4's line or §5.3's tie-breakers as a skill-text PR (security-sensitive: the pinned text). Under 15%, record that the
  line stands.
- [ ] **Step 5: Commit** `docs(autonomy): the 30-day readings and what they decide (D-8126)`.

---

## Not in this plan

- **Row 49's change** (§15 Q4, open): the debugging ceiling stays as the operator's instruction stands; A5-5 pins it.
- **A door that enqueues for a coordinator** (row 56): under the spec's "Later".
- **Big calls that push** for a chosen kind; **a server-signed coordinator identity**: the spec's "Later". Every
  coordinator route here is attribution, not authentication (the known limit D-8125 records).
- **The definition of done on the console's Goals panel.** The spec stores and serves it; showing it to the operator is
  a console change the spec does not list. A later PR if the operator asks.

## Where things stand

### Agreed

- The spec, with R6, R7, C1 to C25 and clause 21's words, approved on 2026-11-09; §15 Q1 to Q3 answered the same day.
- This plan's waves A1 to A10 and its calls P1 to P13.

### Built

- Nothing yet. Each wave's PR records here what it built, its migration slot where it has one, and its baseline or
  readings.

**Wave A2 (built, not pushed).** `programs.doneWhen` is migration slot 48 (`ALTER TABLE programs ADD COLUMN doneWhen
TEXT`; re-measure against `origin/main` before the PR, P1). `doneWhenOf` and the two limits are in `shared/ledgers.ts`;
`goals pin` and `goals modify` carry the list (refusals `bad-done-when`, `done-when-needs-ruling`); `GET
/api/programmes/:slug/goals` is exempt-but-authenticated (session or box token) and answers `{ goals, openItems }`;
`ccrc-api goals show` is behind `goals-read-v1` (the `ROUTES` count word is fifty-nine). The README names the read's two
credentials and the `doneWhen` field. The `bigCalls` half of the read waits for A3.

**A1 baseline (taken 2026-11-09; counts only).**
- Transcript census (`transcripts --since 2026-10-26 --until 2026-11-09`, fleet box, read-only, re-run for this
  correction; 17,427 transcripts read, 13 coordinators by `is_coordinator`): typed-reply waits 123 (24 over an hour,
  197.87 h, median 0.04 h, p90 4.07 h); dialogs 44 (11 over an hour, 34.82 h, median 0.24 h, p90 2.54 h); all 167 (35
  over an hour, 232.69 h, median 0.06 h, p90 3.15 h). These are the figures later readings (the monitoring wave's
  Step 1) are compared against.
- **Relation to §10 (not reconciled; stated as measured).** §10's typed-reply and dialog rows give the SAME window (14
  days to 2026-11-09), so the window does not explain the gap. They say 246 coordinator sessions, 137 waits (32 over
  an hour, 680 h) and 611 dialogs (116 over an hour, 539 h); the committed script reads 13, 123 (24, 197.87 h) and 44
  (11, 34.82 h). Only §10's child-mail-held rows come from another window (14 days to 2026-10-25). The committed
  script's coordinator test is the one §1.2 words, and loosening it does not close the gap: counting every transcript
  that changed in the window, with or without the swap-copy removal, reads at most 149 typed-reply waits (29 over an
  hour, 288 h) and 236 dialogs (22 over an hour, 66 h). So the §1.2 figures come from an ad hoc census whose method
  the committed script does not reproduce (its definition of a session, of a span or of the dialog pairing differs),
  and the fleet box holds almost no transcript older than 2026-10-28 (its files date from the 2026-10-27 to
  2026-10-29 move), so the first days of the window are thin. Read M1 and M2's baseline as the committed script's
  figures above; §10's 680 h and 611 stay as the spec's original, differently-taken, reading and are not a
  comparison base.
- **Per-file `is_coordinator` checked and ruled out as the cause (2026-11-09, fleet box, read-only, same window, run
  as the account that owns the transcripts: 17,440 files).** The suspicion was that a coordinator whose skill load or
  run open sits in an earlier file (a restart, a new session id) is judged non-coordinator in its later file. Files
  were grouped by shared message id and uuid (the swap-copy identity, transitively), and a file counted as a
  coordinator when any file of its group is one. That adds 0 files: 15 coordinator files by `is_coordinator`, 15 in
  coordinator groups, 12 groups; the waits are identical (123 typed-reply, 44 dialogs). Loosening the test does not
  close the gap either: the skill or the declared intent alone reads 32 files (127 typed-reply waits, 269.65 h; the
  same 44 dialogs), and run-open or skill or intent reads 41 files with the same figures. Only reading every
  transcript moves the dialog count (208, 11 over an hour, 41.28 h), and that is the worker dialogs the census
  excludes by design. So the per-file test is not why M1 and M2 sit far below §10; the gap stays unreconciled and the
  baseline above stays the committed script's own figures. (An earlier run as a user who cannot read most of the
  files saw 668 of them and the same 123 and 44, so check the reading account's file count against the 17,000-odd
  before trusting a census.)
- M3, M4 and M6 over the coordination database (`items`, `sample --n 30 --seed 1`, `score`): not yet taken. The
  coordination database lives on the server box, which this builder may not reach, and the sample's parts need a
  reviewer's classing against §3 and §5. A task owner with server-box access takes them; A1-4 is not complete
  until they are written here. (Re-checked: the fleet box holds only test-run copies of the database, no live one.)

### Waiting on you

- §15 Q4: does D-8126 supersede the 2026-09-22 debugging ceiling (row 49)? Until it is answered, row 49 keeps the
  operator's instruction and its change is not built.

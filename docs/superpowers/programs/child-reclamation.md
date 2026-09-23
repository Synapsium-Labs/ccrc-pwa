# Program: child-reclamation

Spec: `docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md`
Plans: `docs/superpowers/plans/2026-09-22-child-reclamation-wave{1,2,3,4,5}-*.md`
Contract: `docs/superpowers/programs/child-reclamation-contract.md` (cross-wave names and types; §7–§8 rulings)
Home project: `ccrc-pwa`   Coordinator: `ccrc-pwa-calm-mesa`   Workspace: **a fresh one per wave**
Ticket: CCR-15

**What this program is.** A workspace the coordinator dispatches is a *child*: declared as one by the server
at creation, never tended by a human, used for at most one PR, and reclaimed with its artifacts when its run
closes. Every other workspace — the operator's, the coordinator's, and every workspace that exists before
wave 1 ships — keeps today's human cleanup ceremony exactly. The operator's four rules and four rulings are
quoted in the spec's §1; §3 argues why an automatic collector is safe on this population when the one
removed on 2026-09-10 was not.

## Waves

| # | scope | deploy class | PRs | state |
|---|---|---|---|---|
| 1 | `--child <runId>` on ws-add behind `child-argv-v1`; the `.child` marker; a child's `TMPDIR` under `~/.cc-tmp/<id>` on every spawn; the scratchpad measurement; the pre-policy count | **AGENT-FIRST** | — | **fix round** 2026-09-23 — `ccrc-pwa-keen-hollow` (run 131; Opus·high, Sonnet subagents, workflows off, compact 40); PR #175 |
| 2 | the registry's three-way child reading; the three-valued spent verdict with a live measurement; `workspace-spent` and `spent-unmeasured` at open and at dispatch; dispatch clears a spent binding | server | — | planned |
| 3 | `ws-audit --reclaim` and its token; `ws-reclaim` with its own ladder, pin phase, tail arm and breadcrumb; the `reclaim` journal act; close's fourth act; delivery cancellation | **AGENT-FIRST** | — | planned |
| 4 | the reclaim sweep over marked children; `ccd reclaim-pause` and its route and Runs-screen toggle; the attention list of unreclaimable children in the Runs banner | **AGENT-FIRST** | — | planned |
| 5 | the closed run's reclaim chip and its sentences | server + pwa | — | planned |

**Rule 3 is enforced at the end of wave 2** with no destructive verb in existence: a second bind on a
PR-bearing child refuses. **Wave 3 is the only wave that destroys anything.** Waves 3 and 4 do nothing on a
box whose ccd does not advertise their capability tokens; wave 2 does nothing to a workspace without a
marker, which is every workspace until wave 1 is deployed.

**This programme follows its own rule 3 from wave 1.** Every wave runs on a freshly dispatched workspace and
the coordinator opens wave N+1 without `sessionId`. Nothing enforces that until wave 2 ships; the
coordinator does it anyway, because a programme that builds one-PR-per-child while reusing one workspace
across five PRs would be arguing against itself.

**Deviation block: forty numbers, the first of them 3330** (allocated once at run-open, 2026-09-23; floor now
3370). No number of the block is spelled as a `D-` token here until a plan DEFINES it: `deviation-refs.test.ts`
reds on any tracked `D-` ref above the highest defined one, so an issued-but-undefined number in this file
would turn every commit red. Every wave draws from this block. A worker never calls the allocator (worker
clause 11): it names a departure in its wave-done mail and the coordinator assigns a number from the block.

Run ids: wave 1 = **131**.

## Decisions & deviations

- **2026-09-23 — wave 1's first wave-done, sent back before review for two rulings.** PR #175, tip
  `08442ef4`, re-measured and accepted by the server (`awaiting-review`, 6/6 items). Its report asked
  two rulings, both ruled and sent back in one fix round so the held-out review reads the final tip once:
  (a) `_child_tmpdir` judges the marker with `_child_runid_valid`, not a non-empty test — one run-id
  grammar for every ccd reader of the marker, and a corrupt marker's scratch stays where `ccd-tmp-sweep`
  collects it (a contract change: §1's "non-empty" is superseded); (b) a child's `~/.cc-tmp/<id>` left
  behind by a human verb has no collector — it gets one in wave 4 (a leaf with no registry row,
  twice-observed, only on a clean listing, `reclaim-paused` honoured, never following a link), and the
  interim leak until wave 4 deploys is accepted. Eight numbers of the block are assigned for these two and
  six departures the worker named (probe location; the probe re-run; two test-hygiene fixes from its own
  final review; stopping at Step 6 per the brief; an out-of-scope README anchor repair), defined in the
  wave-1 plan by the fix round. The measurements: the scratchpad **follows** `TMPDIR` (a second,
  quiescent probe; the first was confounded by a concurrent subagent and a probe directory under a path
  containing `/scratchpad/`); a pre-merge snapshot counts 27 workspaces, none marked (5 archived) — the
  shipping figure is owed after rollout. First full suite: red (`failure: unclear`) — a `boot.test.ts`
  load flake, a `typecheck-tests` install-order artifact, and `tmp-sweep.test.ts`'s "FAILS CLOSED" case,
  which the worker measured red on an untouched `aed80210` while CI's test-server leg passed on main:
  box-environment, not this wave's. No routing change: the red is not the worker's.
- **2026-09-23 — documents merged, wave 1 dispatched.** Spec, contract, ledger and plans reached main as
  `aed80210` (#173; the non-required macOS leg was cancelled at its time limit with no test failed). Run 131
  dispatched into a fresh child; `skillState: present`.

- **2026-09-22 — the design, its four rulings, and the accepted spec.** The operator gave four rules, then
  ruled on four questions: pin everything then reap; a PR *opened* spends a child; transcripts are kept;
  kill-switch plus attached-defer. The first form of the design was reviewed adversarially before approval
  (six lenses, 44 findings, three refuters each, 38 survived); the spec's Appendix B records what each
  changed.
- **2026-09-22 — delivery cancellation moves to wave 3.** The spec's §5.6 made it part of the reclaim act
  while its wave table placed it in wave 4. Corrected in the spec before any plan was written: shipping
  reclaim-on-close without it would run the slug-recycling hazard at the new rate for as long as wave 4
  took. Not a deviation — the spec was self-inconsistent and was fixed at the source.
- **2026-09-22 — the artifacts section reconciled with `ccd-tmp-sweep` (#168).** That sweep landed the day the
  spec was written and gives `/tmp/claude-<uid>/` its first collector. Its root and a child's
  `~/.cc-tmp/<id>` are disjoint; the spec's §5.2 states the one consequence (a child under a terminal
  refusal keeps its temp root).

## Carried constraints

Findings every wave's reviewers get, because each is easy to lose between waves:

- **Two authorities, always.** Child-ness is the box marker AND the server's `--child-of` argv, equal. No wave
  may add a path that infers child-ness from anything else — not `--no-rc`, not a dec reason string, not a
  run row alone.
- **No boolean at the child seam.** The registry's reading is three-way (not a child, child with run id,
  unreadable) and the spent verdict is three-way (spent, unspent, unmeasured). An unreadable marker REFUSES
  a bind and DEFERS a reclaim; an unmeasured spent verdict REFUSES a bind. Any wave that collapses either
  is reintroducing the fail-open the spec's Appendix B item 6 exists to prevent.
- **Every new surface is capability-gated and read with `capSupported`**, never `verbSupported`, which
  permits when the box's verb list is absent. Three tokens: `child-argv-v1` (wave 1), `reclaim-v1`
  (wave 3), `reclaim-pause-v1` (wave 4).
- **The pause file is read inside `ws-reclaim`**, on the fresh path and on resume. A server-side check alone
  fails open into deletion.
- **`ws-reclaim` never resumes `ws-reap`'s work and vice versa.** The breadcrumb value is `reclaim:<phase>`;
  a mismatched flavour refuses.
- **Every CITED file pays the citation tax.** An insertion into `ccd/ccd` or `shared/api.ts` (the files the
  README and the frozen compaction-card corpus cite by line) pays S6-R11 in the same task, and edit length
  above the frozen corpus's highest `ccd/ccd` anchor is a decision: prose there stays length-neutral, long
  comments go below it.
- **Another programme holds claims on files waves 2–5 edit.** At run-open (2026-09-23) the
  centralised-update-management workers (runs 128, 129) held claims covering `shared/api.ts`,
  `server/src/coord/schema.ts`, `ccd/ccrc` and `ccd/ccrc-doctor-checks`. Wave 1 touches none of them. From
  wave 2 a worker's `POST /api/claims` may answer 409 naming that holder; the claim protocol (worker clause 11)
  is the answer — mail the holder, work what is uncontested — and a long stall is reported, never forced.
- **A journal line with no `at` is invisible to the generation fence and the attention list** (contract §8
  R22′, D8: the ingest time is never an event time). Two consequences are accepted, not fixed: a terminal
  refusal journaled without `at` keeps its child out of the sweep but off the attention list, and a clockless
  `create` cannot fence a recycled slug. ccd writes `at` from one clock read on every line, so both need a
  corrupt or degraded journal; a reviewer who finds a real producer of clockless lines reopens this.
- **A child's temp root outlives a human verb until wave 4.** `ws-rm`/`ws-reap`/`ws-gc --prune`/`forget` on
  a child drop its marker and keep `~/.cc-tmp/<id>`; wave 4's sweep is its owner (ruled 2026-09-23 on
  wave 1's report). Wave 4's plan gains that task before its dispatch.
- **`tmp-sweep.test.ts`'s "FAILS CLOSED" case reds on the fleet box on an untouched main** (wave 1,
  2026-09-23) and passes in CI. A reviewer who meets it measures it against the base before calling it a
  wave's.
- **Anchors in these plans are snapshots.** Two other programmes (centralised-update-management W2–W5,
  gpt-lane 2b/3) are live against the same files. Every plan locates code by content; its line numbers are
  not addresses. `ccd/ccd` edits re-stamp and pay the citation-corpus tax.

## Next-wave brief

**Wave 1.** Plan: `docs/superpowers/plans/2026-09-22-child-reclamation-wave1-marker-and-containment.md`.
Dispatch fresh. AGENT-FIRST. The wave has two measurements the operator is waiting on and that later
waves size from: where Claude Code's scratchpad lands when `TMPDIR` is set, and how many workspaces exist
with no marker when the ccd ships (the pre-policy stock, which this programme never reclaims). Both are
recorded in this file by the coordinator when the wave closes.

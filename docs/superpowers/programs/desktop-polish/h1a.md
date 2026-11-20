# Task H1a: the task note (desktop polish run 2936, D-8829)

The note for Task H1a, the pure pieces of C49's Helpers section, written by its worker for the coordinator to fold into the
ledger. Each claim says whether it was **measured** (read on the tree, or in a test run by this task) or **inferred**. The plan's
Task H1a section carries the definition of D-8829 and the departures by slug; this note carries the evidence.

## 1. What was built

| Piece | Where | Basis |
|---|---|---|
| `AgentHelperView`, `AgentHelperState` (its list, its final states and its words from one record), `HelpersUnmeasured`, `HELPER_FINISHED_KEEP_MS`, `HELPER_KEPT_MAX`, the bounds of the Agent arm, `WORKFLOW_AGENT_TYPE`, `isHelperId` | `shared/workflows.ts` (L0, K); `shared/api.ts` is untouched | Measured: `helpers-decision.test.ts`; `git diff --stat` shows no other `shared/` file |
| `helperFactsOf(line)`: an Agent launch result and a task notification, masked before they are cut | `server/src/transcript/parse.ts` (L1, C3) | Measured: `helper-facts.test.ts`, 42 cases |
| `decideAgentHelpers`, `foldHelperFacts`, `isFinishedKept`, `capKeptWorkflow`, `frameDue`, `isWorkflowAgentName` | `server/src/workflows/model.ts` (L1, C3) | Measured: `helpers-decision.test.ts`, 120 cases |

No read, no frame, no UI, and nothing calls these pieces yet (**measured**: no importer outside the two new test files). H1b
wires them. `workflowsFrame` and `selectRows` are unchanged, so today's frame and the 30 s workflow eviction are as they were
(**measured**: `workflows-model.test.ts` passes unchanged); H2 moves the workflow keep.

## 2. The decision, as built

- Figure 2 in order: a final notification or a completed launch result; the meta's `finished` marker; a process that is gone;
  a roster that cannot be used (the state is left out, `unmeasured`); a roster that lists the id (`running`); a roster read
  before the launch result (`launched`); a drop this reader saw (`unlisted`); else `unmeasured`. **Measured**: one case per
  branch and per order between two branches.
- The witness of a drop (F13): the roster's continuity plus the process start, both inputs. **Measured** for each part
  (`the LAST listed id dropping…`, `a reset followed by new starts…`, `the process start time is a second witness…`). The
  claim that a SessionStart empties the roster whole is the spec's Table 1 reading of the hook: **inferred**, not re-measured.
- The roster's read time is an input (F6): **measured**, a case moves `now` by an hour and the state does not change.
- The keep has one owner (F5): `isFinishedKept(endedAt, now)`, strictly inside ten minutes; the end time is the
  notification's, the foreground launch's, or the helper transcript's last write for a `finished` row. **Measured** at the
  boundary for each source. A final row with no readable end time is drawn once and then leaves: **measured**.
- The bounds (F9): see the plan section; each is an exported constant and a case pins its value and its effect. **Measured**.

## 3. Facts about the sources

- **Measured** (read on this box's own session transcripts, shapes only): a launch result is a user record whose
  `toolUseResult` has `status: 'async_launched'`, an `agentId`, a `resolvedModel`, a `description` and a `prompt`; a task
  notification is a user record whose content is the `<task-notification>` envelope with `task-id`, `status`, `summary`,
  `result`.
- **Inferred**: the foreground `completed` result's `content` blocks and `totalDurationMs`, from the broker's own fixture of that
  shape (`delegation-spool.test.ts`), not from a transcript; a second notification for a continued agent.
- **Inferred**: that `1e999` in a transcript parses to `Infinity` is measured by a case; that Claude Code ever writes it is not.

## 4. Runs

Every run was `ccrc test -- <command>` from inside the package, one test file per process, `--maxWorkers=2`, and the box's
load average (1 minute) is recorded as it was at the run: between 4 and 29, mostly 12 to 25, because other sessions' suites
shared the box and the test slice. **Measured**.

| Run | Result |
|---|---|
| `helper-facts.test.ts`, `helpers-decision.test.ts` | 42 and 120 passed (load 18) |
| `workflows-model`, `workflows-read`, `transcript-parse`, `transcript-ladder`, `workflow-controls-table`, `continued-in-parity`, `inflight-manifest-parity`, `pane-sgr-guard-characterization`, `single-definition/ask-digest`, `single-definition/vocabularies` | all passed (load 4 to 10) |
| `approvalguard` | first run failed one timing case (316 ms against 250 ms, load 5.5); alone, 1003 passed |
| `w7-compaction-parity` | first run failed for want of `pwa`'s `node_modules` (installed); then 6 passed |
| `secret-mask` | 7 to 9 tests time out at 20 s in the drawer, re-key and review-cap cases, in four runs at load 12 to 29. The same file on an extraction of `origin/main` at load 23 failed 8, and on this branch 7 at load 15: a load flake, not this change (its failing cases are 20 s time-outs in the drawer, re-key and review-cap cases) |
| `rings/*` (host-imports, outward-edges, shared-imports, totality, wire-totality, mjs-node, fastify-l4, held-by-leaf, exemption-age, pwa-rings, pwa-one-owner, watcher-store-port), `coord-policy-rings`, `ownership`, `dtbd`, `ci-ledger-guard`, `citations`, `anchors`, `public-text`, `growth-check`, `growth-caps`, `oss-metadata` | passed. `wire-totality` was red once, for real: the helper states' list was not a `Record<X, true>` map; fixed, then 10 passed. `rings/totality` timed out once under load, then 11 passed |
| `single-definition/*` | 44 of the 46 files passed in the full pass (load 9 to 32). `docs-l0` times out at 20 s in one case (the Python redactor tables scan) on this branch and, with the same case, on an extraction of `origin/main` (load 5): not this change. `advance-switches` timed out at 20 s in one or two scan cases (the pin scan over the test tree; once `every marker row is defined once`) in three runs at load 7 to 12, and passed 52 of 53 each time otherwise; the extraction of `main` is no git tree, so the file could not be compared there: UNMEASURED against main, CI is the arbiter |
| `topology-clean`, `deviation-refs` | UNMEASURED: the test slice's memory cap (6 GiB, shared with other sessions' runs) killed the worker with SIGKILL in each of five runs, at load 11 to 26 (the runner reports 3 to 5 OOM kills in the slice per run). `topology-clean` reached 60 of 61 once, the 61st timing out at 20 s. What this task checked instead: the CLI scan of the whole tracked tree with the canonical matcher and the operator's local list prints nothing and exits 0; `D-8829` is defined once, in the plan's Task H1a, and appears in no other plan or on `origin/main`. CI's run of the two files is the arbiter |
| `tsc --noEmit` for `server` (src and shared) and for `pwa` | clean |
| `server/test/tsconfig.tests.json` (the whole test tree) | UNMEASURED: killed by the same memory cap. The two new test files were typechecked with `src` and `shared` through a scratch config: clean |
| `pwa`: `stores.test.ts`, `workflow-strip.test.tsx` (the two that import `shared/workflows`) | 172 and 32 passed |


## 5. Mutation run

`ccd/coordinator-skill/references/mutation-run.py` mutates Python module text, so each TypeScript file is wrapped as a Python
module holding its text, and the runner's tests function writes a mutant tree (a copy of `server/src` and `shared/` with that one
file replaced) into the runner's own per-mutant temp directory and runs the two new suites against it with vitest. A vitest
exit without a failed test (an out-of-memory kill, a crash) is retried and never counted as a kill; the infra log was empty.
`--no-coverage`, because the runner's trace sees the wrapper, not the TypeScript. **Measured**: 172 mutants, 172 killed (106, 36 and 30).

The first round left 26 alive (13 in the decision, 12 in the fact parser, 1 in the shared types). Each is now killed by a case
added for it: a launch result with a time under an unusable roster; a dropped helper never seen listed; a dropped id that came
back and vanished with no survivor; a description cut inside a surrogate pair; an unknown start evicted first over the cap; the
bounded memory; two launch results of one id; a notification alone is no launch; a record that is not a user record; a record
carrying both; an unclosed notification; a numeric timestamp; an infinite duration; a whitespace-only and an over-cap foreground
report; and the pinned numbers.

After the shared types took the `Record<X, true>` map idiom (`wire-totality` asked for it), the shared list was rebuilt around the two maps (27 became 30 mutants) and re-run with the decision's. Six mutants of the first list were removed, not killed, and each is **measured** or argued:
`F13-drop-ignores-now-listing` (the clause was redundant, the listed branch is decided first: removed from the code);
`keep-nonfinal-has-end` (a non-final row never has an end time: the ternary was removed);
`order-gone-above-unlisted` (equivalent: a gone process decides every non-final row of a reading, so `gone` and `unlisted`
never share one);
`P-array-line` and `P-launch-array-result` (the array tests were redundant with `type !== 'user'` and the `agentId` test:
removed from the code);
`P-notice-includes` (equivalent: the prefix test is a prefilter, and `parseTaskNotification` refuses what it passes).

### `server/src/workflows/model.ts`: 106 mutants, 106 killed

| Mutant | Original | Mutated to | Result |
|---|---|---|---|
| `F2-end-ignored` | `if (endFact !== null) { state = endFact.outcome;` | `if (false) { state = 'done';` | killed |
| `F2-killed-as-failed` | `killed: 'stopped', stopped: 'stopped' } as const;` | `killed: 'failed', stopped: 'stopped' } as const;` | killed |
| `F2-stopped-as-done` | `killed: 'stopped', stopped: 'stopped' } as const;` | `killed: 'stopped', stopped: 'done' } as const;` | killed |
| `F2-failed-as-done` | `failed: 'failed', killed: 'stopped'` | `failed: 'done', killed: 'stopped'` | killed |
| `F2-meta-finished-ignored` | `} else if (m?.finished === true) {` | `} else if (false) {` | killed |
| `F2-finished-end-not-lastwrite` | `state = 'finished'; endedAt = m.lastWriteAt;` | `state = 'finished'; endedAt = null;` | killed |
| `F2-gone-ignored` | `} else if (i.proc.kind === 'gone') state = 'gone';` | `} else if (false) state = 'gone';` | killed |
| `F2-gone-for-unmeasured-proc` | `} else if (i.proc.kind === 'gone') state = 'gone';` | `} else if (i.proc.kind !== 'live') state = 'gone';` | killed |
| `F2-unusable-roster-ignored` | `else if (usable === null) state = 'unmeasured';` | `else if (false) state = 'unmeasured';` | killed |
| `F2-listed-not-running` | `else if (listedIds.has(id)) state = 'running';` | `else if (false) state = 'running';` | killed |
| `F2-launched-le` | `usable.at < launch.at) state = 'launched'` | `usable.at <= launch.at) state = 'launched'` | killed |
| `F2-launched-gt` | `usable.at < launch.at) state = 'launched'` | `usable.at > launch.at) state = 'launched'` | killed |
| `F2-launched-null-time` | `launch !== null && launch.at !== null && usable.at < launch.at` | `launch !== null && usable.at < (launch.at ?? Infinity)` | killed |
| `F2-launched-uses-now` | `usable.at < launch.at) state = 'launched'` | `i.now < launch.at) state = 'launched'` | killed |
| `F2-launched-no-launch` | `else if (launch !== null && launch.at !== null && usable.at < launch.…` | `else if (launch === null \|\| launch.at === null \|\| usable.at < lau…` | killed |
| `F2-launched-above-listed` | `else if (listedIds.has(id)) state = 'running'; else if (launch !== nu…` | `else if (launch !== null && launch.at !== null && usable.at < launch.…` | killed |
| `F2-any-absence-is-a-drop` | `else if (seenDrop(id)) {` | `else if (true) {` | killed |
| `F2-dropped-not-remembered` | `else if (prev.dropped.has(id)) state = 'unlisted';` | `else if (false) state = 'unlisted';` | killed |
| `F2-nothing-left-out` | `else state = 'unmeasured'; if (isFinalHelperState` | `else state = 'unlisted'; if (isFinalHelperState` | killed |
| `F13-no-cap-room-now` | `usable !== null && !listedFull && prev.listed` | `usable !== null && prev.listed` | killed |
| `F13-no-cap-room-before` | `&& !prev.listedFull && !procChanged` | `&& !procChanged` | killed |
| `F13-no-proc-witness` | `&& !procChanged && [...prev.listed]` | `&& [...prev.listed]` | killed |
| `F13-no-survivor` | `&& [...prev.listed].some((x) => listedIds.has(x));` | `&& true;` | killed |
| `F13-no-memory-needed` | `usable !== null && !listedFull && prev.listed !== null && !prev.liste…` | `usable !== null && !listedFull && !prev.listedFull` | killed |
| `F13-proc-eq` | `i.proc.startedAt !== prev.procStartedAt;` | `i.proc.startedAt === prev.procStartedAt;` | killed |
| `F13-proc-null-start-counts` | `i.proc.startedAt !== null && prev.procStartedAt !== null &&` | `prev.procStartedAt !== null &&` | killed |
| `F13-drop-needs-prev-listing` | `=> witnessed && prev.listed!.has(id);` | `=> witnessed;` | killed |
| `mem-listed-kept-when-unusable` | `listed: usable === null ? null : listedIds,` | `listed: listedIds,` | killed |
| `mem-proc-not-kept` | `procStartedAt: i.proc.kind === 'live' ? i.proc.startedAt : null,` | `procStartedAt: null,` | killed |
| `mem-dropped-kept-when-unusable` | `usable === null ? [] : [...prev.dropped, ...droppedNow]` | `[...prev.dropped, ...droppedNow]` | killed |
| `mem-dropped-forgets-new` | `[...prev.dropped, ...droppedNow].filter` | `[...prev.dropped].filter` | killed |
| `mem-dropped-keeps-relisted` | `.filter((id) => !listedIds.has(id) && ids.has(id))` | `.filter((id) => ids.has(id))` | killed |
| `mem-noendshown-not-kept` | `noEndShown: boundedSet([...prev.noEndShown, ...[...shownNoEnd].filter…` | `noEndShown: new Set(),` | killed |
| `mem-full-flag-dropped` | `listedFull: usable !== null && listedFull,` | `listedFull: false,` | killed |
| `mem-bound-off` | `all.length > HELPER_FACTS_MAX ? all.slice(-HELPER_FACTS_MAX) : all` | `all` | killed |
| `excl-launch-not-positive` | `if (i.facts.get(id)?.launch != null) return true;` | `(removed)` | killed |
| `excl-path-ignored` | `m.path !== 'agent' \|\| m.agentType === WORKFLOW_AGENT_TYPE` | `m.agentType === WORKFLOW_AGENT_TYPE` | killed |
| `excl-type-ignored` | `m.path !== 'agent' \|\| m.agentType === WORKFLOW_AGENT_TYPE` | `m.path !== 'agent'` | killed |
| `excl-name-ignored` | `return !(e !== undefined && isWorkflowAgentName(e.name));` | `return true;` | killed |
| `excl-name-predicate` | `name === WORKFLOW_AGENT_TYPE;` | `false;` | killed |
| `excl-meta-less-id-is-row` | `for (const id of i.metas.keys()) if (isHelperId(id) && isAgent(id)) i…` | `for (const id of i.metas.keys()) if (isHelperId(id)) ids.add(id);` | killed |
| `excl-notification-alone-is-row` | `for (const [id, f] of i.facts) if (isHelperId(id) && f.launch !== nul…` | `for (const [id] of i.facts) if (isHelperId(id)) ids.add(id);` | killed |
| `excl-bad-id-is-row` | `if (isHelperId(id) && isAgent(id)) ids.add(id);` | `if (isAgent(id)) ids.add(id);` | killed |
| `excl-known-count` | `known: ids.size,` | `known: agents.length,` | killed |
| `keep-le` | `now - endedAt < HELPER_FINISHED_KEEP_MS` | `now - endedAt <= HELPER_FINISHED_KEEP_MS` | killed |
| `keep-always` | `endedAt !== null && now - endedAt < HELPER_FINISHED_KEEP_MS` | `endedAt !== null` | killed |
| `keep-null-kept` | `endedAt !== null && now - endedAt < HELPER_FINISHED_KEEP_MS` | `endedAt === null \|\| now - endedAt < HELPER_FINISHED_KEEP_MS` | killed |
| `keep-not-asked` | `} else if (!isFinishedKept(endedAt, i.now)) continue;` | `}` | killed |
| `keep-noend-redrawn` | `if (prev.noEndShown.has(id)) continue; // drawn once already: it leav…` | `(removed)` | killed |
| `keep-noend-never-drawn` | `if (prev.noEndShown.has(id)) continue; // drawn once already: it leav…` | `continue;` | killed |
| `keep-noend-not-recorded` | `shownNoEnd.add(id);` | `(removed)` | killed |
| `row-start-foreground-ignored` | `launch.at !== null && launch.durationMs !== null ? launch.at - launch…` | `launch.at` | killed |
| `row-start-launch-not-first` | `startedAt: fromLaunch ?? entryById.get(id)?.startedAt ?? null,` | `startedAt: entryById.get(id)?.startedAt ?? fromLaunch ?? null,` | killed |
| `row-start-no-roster-fallback` | `startedAt: fromLaunch ?? entryById.get(id)?.startedAt ?? null,` | `startedAt: fromLaunch,` | killed |
| `row-model-no-launch-fallback` | `capChars(m?.model ?? launch?.model ?? null, HELPER_LABEL_MAX)` | `capChars(m?.model ?? null, HELPER_LABEL_MAX)` | killed |
| `row-last-activity` | `lastActivityAt: m?.lastWriteAt ?? null,` | `lastActivityAt: null,` | killed |
| `row-tokens` | `tokens: m?.tokens ?? null,` | `tokens: null,` | killed |
| `row-has-report` | `hasReport: endFact?.hasReport ?? false,` | `hasReport: false,` | killed |
| `row-summary` | `summary: capBytes(endFact?.summary ?? null, HELPER_SUMMARY_MAX_BYTES),` | `summary: null,` | killed |
| `F9-description-uncapped` | `capChars(m?.description ?? null, HELPER_DESCRIPTION_MAX)` | `(m?.description ?? null)` | killed |
| `F9-agenttype-uncapped` | `capChars(m?.agentType ?? null, HELPER_LABEL_MAX)` | `(m?.agentType ?? null)` | killed |
| `F9-model-uncapped` | `capChars(m?.model ?? launch?.model ?? null, HELPER_LABEL_MAX)` | `(m?.model ?? launch?.model ?? null)` | killed |
| `F9-effort-uncapped` | `capChars(m?.effort ?? null, HELPER_LABEL_MAX)` | `(m?.effort ?? null)` | killed |
| `F9-summary-uncapped` | `capBytes(endFact?.summary ?? null, HELPER_SUMMARY_MAX_BYTES)` | `(endFact?.summary ?? null)` | killed |
| `F9-summary-cap-chars` | `const n = Buffer.byteLength(ch, 'utf8');` | `const n = 1;` | killed |
| `F9-capchars-splits-pair` | `return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;` | `return cut;` | killed |
| `F9-listed-uncapped` | `r.state === 'running'), HELPER_LISTED_MAX)` | `r.state === 'running'), Infinity)` | killed |
| `F9-nonfinal-uncapped` | `!isFinalHelperState(r.state)), HELPER_NONFINAL_MAX)` | `!isFinalHelperState(r.state)), Infinity)` | killed |
| `F9-kept-uncapped` | `isFinalHelperState(r.state)), HELPER_KEPT_MAX)` | `isFinalHelperState(r.state)), Infinity)` | killed |
| `F9-evicts-newest-started` | `(b.startedAt ?? -Infinity) - (a.startedAt ?? -Infinity)` | `(a.startedAt ?? -Infinity) - (b.startedAt ?? -Infinity)` | killed |
| `F9-null-start-newest` | `(b.startedAt ?? -Infinity) - (a.startedAt ?? -Infinity)` | `(b.startedAt ?? Infinity) - (a.startedAt ?? Infinity)` | killed |
| `F9-evicts-newest-ended` | `(rank(a) === rank(b) ? (a.id < b.id ? -1 : 1) : rank(b) - rank(a))` | `(rank(a) === rank(b) ? (a.id < b.id ? -1 : 1) : rank(a) - rank(b))` | killed |
| `F9-omitted-listed` | `omitted: running.evicted + others.evicted + finals.evicted,` | `omitted: others.evicted + finals.evicted,` | killed |
| `F9-omitted-others` | `omitted: running.evicted + others.evicted + finals.evicted,` | `omitted: running.evicted + finals.evicted,` | killed |
| `F9-omitted-finals` | `omitted: running.evicted + others.evicted + finals.evicted,` | `omitted: running.evicted + others.evicted,` | killed |
| `F9-memory-sets-unbounded` | `return new Set(all.length > HELPER_FACTS_MAX ? all.slice(-HELPER_FACT…` | `return new Set(all);` | killed |
| `F9-facts-evict-ge` | `while (out.size > HELPER_FACTS_MAX)` | `while (out.size >= HELPER_FACTS_MAX)` | killed |
| `F9-facts-no-evict` | `while (out.size > HELPER_FACTS_MAX) out.delete(out.keys().next().valu…` | `(removed)` | killed |
| `F9-facts-evict-newest` | `out.delete(out.keys().next().value as string);` | `out.delete([...out.keys()].at(-1) as string);` | killed |
| `F9-facts-no-touch` | `out.delete(f.id); out.set(f.id, { launch, end });` | `out.set(f.id, { launch, end });` | killed |
| `F9-kept-workflow-uncapped` | `cutAgents(v.agents.map((view, seq) => ({ seq, view })), WORKFLOW_KEPT…` | `cutAgents(v.agents.map((view, seq) => ({ seq, view })))` | killed |
| `F9-kept-workflow-omitted` | `agentsOmitted: v.agentsOmitted + cut.omitted }` | `agentsOmitted: cut.omitted }` | killed |
| `F9-kept-workflow-passthrough` | `if (v.agents.length <= WORKFLOW_KEPT_AGENTS_MAX) return v;` | `return v;` | killed |
| `order-launched-below-unmeasured` | `running: 0, launched: 1, unmeasured: 2,` | `running: 0, launched: 2, unmeasured: 1,` | killed |
| `order-finals-first` | `...running.kept.sort(byStart), ...others.kept.sort((a, b) => STATE_RA…` | `...finals.kept, ...running.kept.sort(byStart), ...others.kept.sort((a…` | killed |
| `unm-always-sent` | `unmeasured: left === 0 ? null :` | `unmeasured: false ? null :` | killed |
| `unm-reason-swapped` | `i.roster.kind === 'unusable' ? i.roster.why : { why: 'unseen', helper…` | `i.roster.kind !== 'unusable' ? { why: 'absent' } : { why: 'unseen', h…` | killed |
| `unm-count-wrong` | `{ why: 'unseen', helpers: left }` | `{ why: 'unseen', helpers: ids.size }` | killed |
| `unm-counts-all-nonfinal` | `const left = agents.filter((r) => r.state === 'unmeasured').length;` | `const left = agents.filter((r) => !isFinalHelperState(r.state)).lengt…` | killed |
| `gate-absent-ignored` | `const neverHad = a.workflows === 'absent' && !a.unreadable && a.known…` | `const neverHad = !a.unreadable && a.knownHelpers === 0;` | killed |
| `gate-unreadable-ignored` | `const neverHad = a.workflows === 'absent' && !a.unreadable && a.known…` | `const neverHad = a.workflows === 'absent' && a.knownHelpers === 0;` | killed |
| `gate-helpers-ignored` | `const neverHad = a.workflows === 'absent' && !a.unreadable && a.known…` | `const neverHad = a.workflows === 'absent' && !a.unreadable;` | killed |
| `gate-sent-before-ignored` | `return !(neverHad && !a.sentBefore);` | `return !neverHad;` | killed |
| `gate-inverted` | `return !(neverHad && !a.sentBefore);` | `return neverHad && !a.sentBefore;` | killed |
| `fold-later-end-wrong-way` | `return b.at >= a.at ? b : a;` | `return b.at <= a.at ? b : a;` | killed |
| `fold-timed-end-loses` | `if (a.at === null) return b; if (b.at === null) return a;` | `if (a.at === null) return a; if (b.at === null) return b;` | killed |
| `fold-null-first-end-kept` | `if (a === null) return b; if (a.at === null) return b;` | `if (a === null) return b; if (a.at === null) return a;` | killed |
| `fold-earlier-launch-wrong-way` | `return b.at !== null && b.at < a.at ? b : a;` | `return b.at !== null && b.at > a.at ? b : a;` | killed |
| `fold-launch-null-time-first` | `if (a.at === null) return b.at === null ? a : b;` | `if (a.at === null) return a;` | killed |
| `fold-async-is-end` | `if (f.status !== 'async_launched') {` | `if (true) {` | killed |
| `fold-launch-source-only` | `if (f.source === 'launch') {` | `if (true) {` | killed |
| `fold-has-report-empty` | `hasReport: f.report !== null && f.report !== '',` | `hasReport: f.report !== null,` | killed |
| `fold-outcome-completed` | `completed: 'done', failed:` | `completed: 'failed', failed:` | killed |
| `fold-foreground-flag` | `async: f.status === 'async_launched',` | `async: true,` | killed |
| `fold-source-lost` | `from: f.source,` | `from: 'notification',` | killed |
| `fold-mutates-prev` | `const out = new Map(prev);` | `const out = prev as Map<string, HelperIdFacts>;` | killed |

### `server/src/transcript/parse.ts`: 36 mutants, 36 killed

| Mutant | Original | Mutated to | Result |
|---|---|---|---|
| `P-sidechain` | `if (r.isSidechain === true \|\| r.type !== 'user') return [];` | `if (r.type !== 'user') return [];` | killed |
| `P-type-user` | `if (r.isSidechain === true \|\| r.type !== 'user') return [];` | `if (r.isSidechain === true) return [];` | killed |
| `P-launch-before-notice` | `launchFact(r.toolUseResult, at) ?? noticeFact(r.message, at)` | `noticeFact(r.message, at) ?? launchFact(r.toolUseResult, at)` | killed |
| `P-time-not-parsed` | `const t = Date.parse(v); return Number.isFinite(t) ? t : null;` | `const t = Date.parse(v); return t;` | killed |
| `P-time-non-string` | `if (typeof v !== 'string') return null; const t` | `const t` | killed |
| `P-launch-id-unchecked` | `if (!isHelperId(t.agentId)) return null;` | `if (typeof t.agentId !== 'string') return null;` | killed |
| `P-launch-async-model` | `model: typeof t.resolvedModel === 'string' ? t.resolvedModel : null, …` | `model: null, durationMs: null,` | killed |
| `P-launch-async-status` | `if (t.status === 'async_launched') {` | `if (t.status !== 'completed') {` | killed |
| `P-launch-other-status` | `if (t.status !== 'completed') return null; const report` | `const report` | killed |
| `P-launch-completed-report-trim` | `const cut = report.trim() === '' ? null : maskedCut(report, HELPER_RE…` | `const cut = maskedCut(report, HELPER_REPORT_MAX_BYTES);` | killed |
| `P-launch-duration` | `durationMs: typeof t.totalDurationMs === 'number' && Number.isFinite(…` | `durationMs: null,` | killed |
| `P-launch-duration-finite` | `typeof t.totalDurationMs === 'number' && Number.isFinite(t.totalDurat…` | `typeof t.totalDurationMs === 'number'` | killed |
| `P-launch-report-cap` | `const cut = report.trim() === '' ? null : maskedCut(report, HELPER_RE…` | `const cut = report.trim() === '' ? null : { text: SHAPE_MASK.maskDeep…` | killed |
| `P-notice-not-string` | `if (typeof content !== 'string' \|\|` | `if (` | killed |
| `P-notice-not-ok` | `if (!parsed.ok) return null;` | `(removed)` | killed |
| `P-notice-id-unchecked` | `if (!isHelperId(id) \|\| status === undefined) return null;` | `if (status === undefined) return null;` | killed |
| `P-notice-status-unchecked` | `if (!isHelperId(id) \|\| status === undefined) return null;` | `if (!isHelperId(id)) return null;` | killed |
| `P-status-completed` | `completed: 'completed', failed: 'failed', killed: 'killed', stopped: …` | `completed: 'failed', failed: 'failed', killed: 'killed', stopped: 'st…` | killed |
| `P-status-failed` | `completed: 'completed', failed: 'failed', killed` | `completed: 'completed', failed: 'killed', killed` | killed |
| `P-status-killed` | `killed: 'killed', stopped: 'stopped' } as const;` | `killed: 'stopped', stopped: 'stopped' } as const;` | killed |
| `P-status-stopped` | `killed: 'killed', stopped: 'stopped' } as const;` | `killed: 'killed', stopped: 'killed' } as const;` | killed |
| `P-status-running-accepted` | `const status = n.status === null ? undefined : (FINAL_NOTICE_STATUS a…` | `const status = (n.status ?? 'completed') as HelperFact['status'];` | killed |
| `P-summary-first-line` | `.split('\n')[0]!.trim();` | `.trim();` | killed |
| `P-summary-masked` | `const summary = line === '' ? null : maskedCut(line, HELPER_SUMMARY_M…` | `const summary = line === '' ? null : line.slice(0, 200);` | killed |
| `P-summary-cap-bytes` | `maskedCut(line, HELPER_SUMMARY_MAX_BYTES).text` | `maskedCut(line, HELPER_REPORT_MAX_BYTES).text` | killed |
| `P-report-empty-is-null` | `const report = result === '' ? null : maskedCut(result, HELPER_REPORT…` | `const report = maskedCut(result, HELPER_REPORT_MAX_BYTES);` | killed |
| `P-report-cap` | `const report = result === '' ? null : maskedCut(result, HELPER_REPORT…` | `const report = result === '' ? null : maskedCut(result, HELPER_REPORT…` | killed |
| `P-report-cut-flag` | `reportCut: report !== null && report.cut };` | `reportCut: false };` | killed |
| `P-launch-cut-flag` | `reportCut: cut !== null && cut.cut,` | `reportCut: false,` | killed |
| `P-cut-before-mask` | `const masked = SHAPE_MASK.maskDeep(value);` | `const masked = value;` | killed |
| `P-cut-le` | `if (Buffer.byteLength(masked, 'utf8') <= maxBytes) return { text: mas…` | `if (Buffer.byteLength(masked, 'utf8') < maxBytes) return { text: mask…` | killed |
| `P-cut-chars-not-bytes` | `if (Buffer.byteLength(masked, 'utf8') <= maxBytes)` | `if (masked.length <= maxBytes)` | killed |
| `P-cut-mid-char` | `while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--;` | `(removed)` | killed |
| `P-cut-no-delimiter` | `text: masked.slice(0, cutAt(masked, chars)), cut: true` | `text: masked.slice(0, chars), cut: true` | killed |
| `P-cut-always-flag` | `return { text: masked, cut: false };` | `return { text: masked, cut: true };` | killed |
| `P-launch-model-for-completed` | `status: 'completed', at, model: typeof t.resolvedModel === 'string' ?…` | `status: 'completed', at, model: null,` | killed |

### `shared/workflows.ts`: 30 mutants, 30 killed

| Mutant | Original | Mutated to | Result |
|---|---|---|---|
| `S-word-unlisted` | `unlisted: 'no longer listed', gone: 'session ended', unmeasured: null,` | `unlisted: 'ended', gone: 'session ended', unmeasured: null,` | killed |
| `S-word-gone` | `unlisted: 'no longer listed', gone: 'session ended', unmeasured: null,` | `unlisted: 'no longer listed', gone: 'ended', unmeasured: null,` | killed |
| `S-word-unmeasured` | `gone: 'session ended', unmeasured: null,` | `gone: 'session ended', unmeasured: 'unmeasured',` | killed |
| `S-keep-ms` | `export const HELPER_FINISHED_KEEP_MS = 600_000;` | `export const HELPER_FINISHED_KEEP_MS = 30_000;` | killed |
| `S-kept-max` | `export const HELPER_KEPT_MAX = 20;` | `export const HELPER_KEPT_MAX = 21;` | killed |
| `S-listed-max` | `export const HELPER_LISTED_MAX = 32;` | `export const HELPER_LISTED_MAX = 33;` | killed |
| `S-nonfinal-max` | `export const HELPER_NONFINAL_MAX = 32;` | `export const HELPER_NONFINAL_MAX = 31;` | killed |
| `S-description-max` | `export const HELPER_DESCRIPTION_MAX = 200;` | `export const HELPER_DESCRIPTION_MAX = 201;` | killed |
| `S-label-max` | `export const HELPER_LABEL_MAX = 64;` | `export const HELPER_LABEL_MAX = 65;` | killed |
| `S-summary-max` | `export const HELPER_SUMMARY_MAX_BYTES = 200;` | `export const HELPER_SUMMARY_MAX_BYTES = 201;` | killed |
| `S-report-max` | `export const HELPER_REPORT_MAX_BYTES = 16_384;` | `export const HELPER_REPORT_MAX_BYTES = 16_385;` | killed |
| `S-facts-max` | `export const HELPER_FACTS_MAX = 256;` | `export const HELPER_FACTS_MAX = 255;` | killed |
| `S-kept-agents-max` | `export const WORKFLOW_KEPT_AGENTS_MAX = 40;` | `export const WORKFLOW_KEPT_AGENTS_MAX = 41;` | killed |
| `S-workflow-agent-type` | `export const WORKFLOW_AGENT_TYPE = 'workflow-subagent';` | `export const WORKFLOW_AGENT_TYPE = 'workflow-agent';` | killed |
| `S-id-length` | `/^[A-Za-z0-9_-]{1,64}$/` | `/^[A-Za-z0-9_-]{1,65}$/` | killed |
| `S-id-empty` | `/^[A-Za-z0-9_-]{1,64}$/` | `/^[A-Za-z0-9_-]{0,64}$/` | killed |
| `S-id-chars` | `/^[A-Za-z0-9_-]{1,64}$/` | `/^[A-Za-z0-9_ -]{1,64}$/` | killed |
| `S-id-type` | `typeof v === 'string' && HELPER_ID_RE.test(v)` | `HELPER_ID_RE.test(String(v))` | killed |
| `S-final-minus-done` | `{ done: true, failed: true, stopped: true, finished: true };` | `{ failed: true, stopped: true, finished: true };` | killed |
| `S-final-minus-failed` | `{ done: true, failed: true, stopped: true, finished: true };` | `{ done: true, stopped: true, finished: true };` | killed |
| `S-final-minus-stopped` | `{ done: true, failed: true, stopped: true, finished: true };` | `{ done: true, failed: true, finished: true };` | killed |
| `S-final-minus-finished` | `{ done: true, failed: true, stopped: true, finished: true };` | `{ done: true, failed: true, stopped: true };` | killed |
| `S-final-plus-launched` | `{ done: true, failed: true, stopped: true, finished: true };` | `{ done: true, failed: true, stopped: true, finished: true, launched: …` | killed |
| `S-final-plus-running` | `{ done: true, failed: true, stopped: true, finished: true };` | `{ done: true, failed: true, stopped: true, finished: true, running: t…` | killed |
| `S-final-plus-unlisted` | `{ done: true, failed: true, stopped: true, finished: true };` | `{ done: true, failed: true, stopped: true, finished: true, unlisted: …` | killed |
| `S-final-plus-gone` | `{ done: true, failed: true, stopped: true, finished: true };` | `{ done: true, failed: true, stopped: true, finished: true, gone: true…` | killed |
| `S-final-plus-unmeasured` | `{ done: true, failed: true, stopped: true, finished: true };` | `{ done: true, failed: true, stopped: true, finished: true, unmeasured…` | killed |
| `S-final-guard-inverted` | `FINAL_AGENT_HELPER_STATES[s] === true;` | `FINAL_AGENT_HELPER_STATES[s] !== true;` | killed |
| `S-list-minus-unmeasured` | `gone: true, unmeasured: true, };` | `gone: true, } as never;` | killed |
| `S-list-minus-launched` | `launched: true, running: true, done: true,` | `running: true, done: true,` | killed |

## 6. Residuals

- The last listed id's Stop cannot be told from a roster reset, so its state is left out and counted `unseen`. Accepted.
- The count of running workflows and the length of a workflow agent's label and phase are not bounded here.
- A continued agent (a second launch for a finished id) stays final: the end ranks above a listing.
- The foreground result's shape is inferred (section 3).

# Task H1b: the task note (desktop polish run 2989, D-8862)

The note for Task H1b, the wiring of C49's Helpers section: H1a's pure decision reaches the session's reads, the helpers go on
the session's `workflows` frame, and the PWA's store accepts them. Written by its worker for the coordinator to fold into the
ledger. Each claim says whether it was **measured** (read on the tree, or in a test run by this task) or **inferred**. The plan's
Task H1b section carries the definition of D-8862 and the departures by slug; this note carries the evidence.

## 1. What was built

| Piece | Where | Basis |
|---|---|---|
| `isAgentId`, the one guard over the one `AGENT_ID_RE`; `isHelperId` is it; `hookstate.ts`'s private rule and `hookReports.ts`'s private guard are gone | `shared/continuity-reports.ts`, `shared/workflows.ts`, `server/src/hookstate.ts`, `server/src/continuity/hookReports.ts` | Measured: `single-definition/vocabularies.test.ts` (two new cases: the pattern's holders, the guard's holder) |
| The roster keeps its optional `id`; a bad one reads as absent; `fleet.ts` strips it | `server/src/hookstate.ts`, `server/src/fleet.ts` | Measured: `hookstate-roster-id.test.ts` |
| `FeedReading.helperHook`, with the read stamp and ordering scoped to the helper roster; the raw hook stays independent | `server/src/sessionFeed.ts`, `server/src/workflows/model.ts#orderHelperHook` | Measured: `session-feed-hook-at.test.ts`, `sessionws-helpers.test.ts` |
| The tailer's `helpers` output and the backlog's facts | `server/src/transcript/tail.ts`; a prefilter in `parse.ts#helperFactsOf` | Measured: `transcript-tail-helper-facts.test.ts` |
| `SessionHelpers` (reads by id, the tier, the rotation, the hold), `SessionWorkflows.readAll`, `lastActivityAt` on workflow rows, the L3 header | `server/src/workflows/read.ts` | Measured: `helpers-read.test.ts`, `sessionws-helpers.test.ts` |
| `rosterInputOf`, `parseHelperMeta`, `lastLineTime`, `isAgentHelper`, `helpersFrame` | `server/src/workflows/model.ts` | Measured: `helpers-frame.test.ts`, and `helpers-decision.test.ts` unchanged in its answers |
| The wiring, the inline gate deleted | `server/src/sessionws.ts` (7 net code lines of its 40) | Measured: `sessionws-helpers.test.ts`, `session-workflows-frame.test.ts` unchanged; the growth count by `growthCheck.ts#codeLines` (504 to 511) |
| The frame member's type | `shared/api.ts`, two existing lines, zero net code lines (5,131 of its cap of 5,140, before and after) | Measured: `codeLines`; the holder's consent by mail, 2026-11-20 |
| The store's three members and its reset sites | `pwa/src/stores/session.ts` | Measured: `session-store-helpers.test.ts` |

## 2. Red first

The branch's first commit holds every new case. Run against `main`'s code (that commit, before the code commit), one file per
process, `ccrc test`, `--maxWorkers=2` (**measured**):

| File | On main | Of which pins (green on main, by design) |
|---|---|---|
| `hookstate-roster-id.test.ts` | 4 failed, 8 passed | the 7 bad-id cases and the "rest of an entry is still checked" case: main drops every id, so "a bad id reads as absent" holds there too; they pin that the new id rule never makes a bad id malformed |
| `session-feed-hook-at.test.ts` | 6 failed | none |
| `transcript-tail-helper-facts.test.ts` | 4 failed, 2 passed | "a window with no fact carries no `helpers` member" and "a chunk with no helper fact emits no `helpers` event" |
| `helpers-frame.test.ts` | 35 failed | none (the characterization table fails on main only because `helpersFrame` does not exist; its `frameDue` half is H1a's) |
| `helpers-read.test.ts` | 19 failed | none |
| `sessionws-helpers.test.ts` | 6 failed, 1 passed | "no workflow and no helper still sends no frame" (today's gate) |
| `single-definition/vocabularies.test.ts` | 2 failed, 158 passed | the 158 are the file's existing cases |
| `helpers-decision.test.ts` (2 new cases), `helper-facts.test.ts` (1 new case) | passed | all three: review 2978 F1 and F2 asked for pins of H1a's code, not for a change |
| `pwa/test/session-store-helpers.test.ts` | 8 failed, 1 passed | "a snapshot built without the members reads as none" |

After the red commit, three fixtures were corrected with the code (**measured**, in the code commit's diff): the feed test
published its hook copy before the feed subscribed to the bus (so the copy was never seen), and lacked a seeded roster; the
reader test named five finished helpers through nothing (an id must come from the roster or a fact to be known; they are now
listed); and the worst-case row sizes were first guesses and now hold the measured values.

## 3. Facts

- **Measured**: the tier stays inside 12 calls. With ten growing helpers and neither step 4 nor 5 due it can refresh six
  per reading, reaching every helper in two. In the fix-round cases (11 quiet or 6 continuously growing), step 5 gets a
  final helper's tail on the first reading it competes with the first due meta cycle. Step 4 stats on that reading, reads
  the saved stat's meta on the next without another stat, and revisits the entire cohort within twice its size in readings
  from the first due reading. **Inferred**: a due meta cohort with no new or changing ids costs at most two readings per
  id (one reserved call per reading, oldest due first), and an already-known final backlog at least one attempt per reading
  while work remains (two reserved calls). New finals discovered after the reserve is made can wait to the next reading to
  join that backlog. The step 3 cursor can still defer a helper under roster churn (review 3014 F11).
- **Measured**: the old illustrative row fixtures still measure 801 bytes (ASCII), 1,585 (3-byte labels), and 1,193
  (supplementary characters). The fix-round row with maximum-width fields, escaped 200-byte summary, 64-byte id, and wide
  numbers measures 1,905 bytes. The 84-row fixture with both qualifiers is below 134,000 bytes. **Inferred bound**: C0/C1
  controls and lone surrogates are removed from display strings. The remaining labels and description cost at most three
  JSON bytes per UTF-16 unit, a summary at most 400 escaped bytes. At 25 bytes per Number, 1,905 is the final-row upper
  bound; at most 1,489 for a non-final row (no summary or end time, but longer state). `20 × 1,905 + 64 × 1,489 + 83` row
  and separator bytes, plus at most 256 for the envelope and Agent qualifiers, is 133,735 bytes. This does not count the
  legacy workflow rows. Reports are not display strings and are not sent on this frame.
- **Measured** (a test): the deleted inline gate and `frameDue` agree on all 16 inputs it had (4 reads, the hook's word, sent
  before or not).
- **Inferred**: the start scan's absence (H1c) costs a reloaded stream the facts older than the backlog's 1 MiB window: such a
  helper is drawn from the roster and its meta alone, as spec §3.1 says for one beyond the scan's bound.
- **Measured**: a `finished` meta whose transcript stat or range read fails is decided without a last write on that
  reading. The row with no end time is drawn once and the terminal read is not retried. The range case stats a real
  nonempty file and refuses every range call. An empty file causes no range request.
- **Measured**: after a five-second backward clock step, the next raw hook publication changes the ask immediately; the
  old-stamped roster does not fabricate a helper drop. The order comparison is L1, and the same `workflowLastActivity`
  calculation is shared between the workflow verdict and row.

## 4. Runs

Every run was `ccrc test -- <command>` from inside the package, one test file per process, `--maxWorkers=2`, with the box's
1-minute load average recorded as it was at the run; other sessions' suites shared the box and the test slice, and the box's
disk was slow that day. **Measured**.

| Run | Result |
|---|---|
| The new suites at the tip: `helpers-frame`, `helpers-read`, `hookstate-roster-id`, `session-feed-hook-at`, `sessionws-helpers`, `transcript-tail-helper-facts`; `helpers-decision`, `helper-facts` | 38, 33, 12, 8, 10, 6; 154, 58 passed (load 7 to 19) |
| Every server test file that imports `hookstate`, `fleet`, `sessionws`, `sessionFeed`, `workflows/read`, `workflows/model`, `transcript/tail`, `transcript/parse`, `continuity/hookReports`, `shared/continuity-reports` or `shared/workflows` (65 test files, found by their import lines) | 62 passed (load 6 to 18); the other three below |
| `session-ladders-characterization` | 1 failed, 61 passed, twice on this branch; the same case fails on an extraction of the branch's base (`23180f749a`, load 10): "gone + a fresh supervisor heartbeat (restarting)", `expected [ 'gone', 'gone' ]` against `[ 'gone', 'unmeasurable' ]`. Not this change: it fails on main's code here (a time- or box-dependent fixture, not investigated further) |
| `mail-sweep` | in the full pass, 7 failed of 186 at load 7 to 11, the run taking 1,375 s: six are 20 s time-outs and the seventh a warn line leaked from a timed-out case before it. Of the changed modules it imports only `HOOKSTATE_FRESH_MS` directly (the watcher and the server it builds reach the rest). Alone (load 10): 12 failed, a different set: seven time-outs (20 s and 10 s), four cases that received a push the test does not expect, which is the watcher's real disk warning ("Fleet disk 86% full"; this box's disk was at 87%), and a log line ordered behind a slow case. The same file on an extraction of the branch's base (`23180f749a`, load 10, 1,570 s): 17 failed, of the same kinds (twelve time-outs, three disk pushes, two leaked log lines). Not this change: the box (its load and its full disk); CI is the arbiter |
| `secret-mask` | in the full pass, 1 failed of 97: a 43 s time-out in the drawer's slow-typing case (the load flake H1a's note records twice). Alone (load 10): 2 failed, both 20 s time-outs in the drawer's echo cases, which touch nothing this task changed; H1a's note measured the same file failing on an extraction of `main`. A load flake; CI is the arbiter |
| `rings/*` (all 12), `coord-policy-rings`, `ownership`, `growth-check`, `growth-caps`, `dtbd`, `ci-ledger-guard`, `anchors`, `citations`, `public-text`, `oss-metadata`, `box-token-census` | passed (load 12 to 19) |
| `single-definition/*` (all 42) | passed (load 18 to 23), after one fix: `advance-switches` counted this task's first holder case, which read `continuity/routes.ts` by path, as a new literal source pin; the case now names the file in its holder list only |
| `topology-clean`, `deviation-refs` (after `git fetch origin main`) | 61 and 34 passed (load 16 to 17) |
| `tsc --noEmit` for `server` (src and shared), `pwa`, and `server/test/tsconfig.tests.json` (the whole test tree) | clean (the test tree's check needed `agent`'s dependencies installed in this worktree first) |
| `pwa`: `stores`, `highlight-store`, `store-unsubscribe`, `waiting-store`, `session-store-helpers`, and every test file that imports `stores/session` or `shared/workflows` (48 files) | all passed: 52 test files (load 8 to 10) |
| CI's fast run at the first push (`2855d929ce`) | `server 6/12` red, for real: `collect-lane-l0.test.ts` pins `shared/api.ts`'s import lines verbatim, and this task's consented edit of the workflows import changed one; `peers-claims-l0.test.ts` pins the same line. Neither was in this task's local list (they read `shared/api.ts` as text and import none of the changed modules). Both pins now carry the new line: 8 and 19 passed (load 12) |
| A merge probe against `origin/main` at `c5cb8538d7` | clean (`git merge-tree` exit 0): no absorption licensed |

The private-name scan (the canonical matcher plus the operator's local list) over the tracked tree and over the PR body prints
nothing and exits 0; the scanner fires on its canary (**measured**).

## 5. Mutation run

`ccd/coordinator-skill/references/mutation-run.py`, through an adapter like H1a's: each TypeScript file is held as a Python
module's text, and the tests function writes the mutant into a scratch copy of the tree (outside the work tree, removed after
the run), runs ONE test file there through `ccrc test` with `--maxWorkers=2`, and writes the original back. A vitest exit with
no failed test is retried and never counted as a kill (the infra log stayed empty). `--no-coverage`: the runner's trace sees
the wrapper, not the TypeScript. **Measured** (initial round): 94 mutants across ten files, 92 killed, one accepted
non-equivalent survivor and one equivalent survivor, each named in its row. The first round left 28 alive: those two and
26 missed cases (4 in `model.ts`, 17 in
`read.ts`, 2 in `sessionFeed.ts`, 3 in `sessionws.ts`). Each of the 26 got a case, committed after that round, and the second
round killed every one. The fleet mutant ran against `hookstate-roster-id.test.ts` only: `fleet.test.ts` needs `ccd/` in the
scratch tree (its baseline failed there).

The reviews' own mutants, re-run at this branch's code (**measured**): review 2978 F1's N4 (an unmeasured process refuses
the continuation) and N3 (an unlisted helper's last write taken as its start) are killed by the two new pins in
`helpers-decision.test.ts`; review 2978 F2's `R1-p-notice-no-tag-check` is killed by the new sibling-first case in
`helper-facts.test.ts`.

#### `server/src/workflows/model.ts`: 27 mutants, 27 killed

| Mutant | Original | Mutated to | Result |
|---|---|---|---|
| `roster-null-usable` | `if (raw === null \|\| at === null) return { kind: 'unusable', why: { …` | `if (raw === null) return { kind: 'unusable', why: { why: 'unreadable'…` | killed |
| `roster-null-absent` | `if (raw === null \|\| at === null) return { kind: 'unusable', why: { …` | `if (raw === null \|\| at === null) return { kind: 'unusable', why: { …` | killed |
| `roster-fail-all-absent` | `raw.reason === 'absent' ? { why: 'absent' } : { why: 'unreadable' }` | `{ why: 'absent' }` | killed |
| `roster-fail-all-unreadable` | `raw.reason === 'absent' ? { why: 'absent' } : { why: 'unreadable' }` | `{ why: 'unreadable' }` | killed |
| `roster-identity-ignored` | `if (raw.identity !== 'current') return { kind: 'unusable', why: { why…` | `(removed)` | killed |
| `roster-identity-foreign-only` | `if (raw.identity !== 'current') return { kind: 'unusable', why: { why…` | `if (raw.identity !== 'current') return { kind: 'unusable', why: { why…` | killed |
| `roster-age-ge` | `if (age > freshMs) return` | `if (age >= freshMs) return` | killed |
| `roster-age-ignored` | `if (age > freshMs) return` | `if (false) return` | killed |
| `roster-age-updated-only` | `const age = now - Math.max(raw.state.updatedAt, raw.aliveAt ?? raw.st…` | `const age = now - raw.state.updatedAt;` | killed |
| `roster-age-before-identity` | `  if (raw.identity !== 'current') return { kind: 'unusable', why: { w…` | `  const age = now - Math.max(raw.state.updatedAt, raw.aliveAt ?? raw.…` | killed |
| `roster-at-updated` | `return { kind: 'usable', at, entries:` | `return { kind: 'usable', at: raw.state.updatedAt, entries:` | killed |
| `roster-id-empty` | `({ id: e.id ?? null, name: e.name, startedAt: e.startedAt })` | `({ id: e.id ?? '', name: e.name, startedAt: e.startedAt })` | killed |
| `meta-finished-truthy` | `finished: r.finished === true };` | `finished: Boolean(r.finished) };` | survived round 1; killed by the case added for it |
| `meta-array-ok` | `if (o === null \|\| typeof o !== 'object' \|\| Array.isArray(o)) retu…` | `if (o === null \|\| typeof o !== 'object') return null;` | survived round 1; killed by the case added for it |
| `meta-empty-kept` | `(typeof v === 'string' && v !== '' ? v : null)` | `(typeof v === 'string' ? v : null)` | survived round 1; killed by the case added for it |
| `lastline-first` | `  for (let i = lines.length - 1; i >= 0; i--) {⏎    const t = lines[i…` | `  for (let i = 0; i < lines.length; i++) {⏎    const t = lines[i]!;⏎ …` | killed |
| `lastline-nan` | `    if (Number.isFinite(ms)) return ms;⏎  }⏎  return null;⏎}` | `    return ms;⏎  }⏎  return null;⏎}` | survived round 1; killed by the case added for it |
| `frame-agents-always` | `...(a.arm.agents.length > 0 ? { agents: a.arm.agents } : {}),` | `agents: a.arm.agents,` | killed |
| `frame-agents-never` | `...(a.arm.agents.length > 0 ? { agents: a.arm.agents } : {}),` | `(removed)` | killed |
| `frame-unmeasured-never` | `...(a.arm.unmeasured !== null ? { agentsUnmeasured: a.arm.unmeasured …` | `(removed)` | killed |
| `frame-readevery-never` | `...(a.readEvery !== null ? { readEvery: a.readEvery } : {}),` | `(removed)` | killed |
| `frame-due-ignores-known` | `knownHelpers: a.arm.known, sentBefore` | `knownHelpers: 0, sentBefore` | killed |
| `frame-due-ignores-sent` | `knownHelpers: a.arm.known, sentBefore: a.sentBefore }` | `knownHelpers: a.arm.known, sentBefore: false }` | killed |
| `frame-unreadable-dropped` | `...(w.unreadable ? { unreadable: true as const } : {}),` | `(removed)` | killed |
| `agent-launch-ignored` | `  if (facts?.launch != null) return true;⏎  if (meta === undefined` | `  if (meta === undefined` | killed |
| `agent-workflow-type-ok` | `if (meta === undefined \|\| meta.path !== 'agent' \|\| meta.agentType…` | `if (meta === undefined \|\| meta.path !== 'agent') return false;` | killed |
| `agent-roster-name-ignored` | `return !(rosterName !== undefined && isWorkflowAgentName(rosterName));` | `return true;` | killed |

#### `server/src/workflows/read.ts`: 36 mutants, 36 killed

| Mutant | Original | Mutated to | Result |
|---|---|---|---|
| `t1-skip-meta-reads` | `      if (!isHelperId(id) \|\| this.cache.has(id)) continue;⏎      aw…` | `      continue;⏎    }⏎    // (2)` | killed |
| `t1-no-budget` | `      if (budget <= 0) break;⏎      if (!isHelperId(id) \|\| this.cac…` | `      if (!isHelperId(id) \|\| this.cache.has(id)) continue;` | killed |
| `t1-workflow-name-read` | `const listed = [...nameOf].filter(([, name]) => !isWorkflowAgentName(…` | `const listed = [...nameOf].map(([id]) => id);` | killed |
| `t1-no-fact-ids` | `for (const id of new Set([...listed, ...launched, ...noticed])) {` | `for (const id of new Set([...listed])) {` | survived round 1; killed by the case added for it |
| `t1-roster-last` | `for (const id of new Set([...listed, ...launched, ...noticed])) {` | `for (const id of new Set([...noticed, ...launched, ...listed])) {` | survived round 1; killed by the case added for it |
| `t2-no-drop-reread` | `      if (!this.cache.has(id) \|\| isFinal(id)) continue;⏎      await…` | `      continue;⏎      await this.readMeta(id);` | killed |
| `t2-after-t3` | `    // (2) the drops this reading saw.⏎    for (const id of seenDrops…` | `    // (2) the drops this reading saw.⏎    for (const id of [] as str…` | killed |
| `t3-final-read-too` | `const open = [...this.cache.keys()].filter((id) => isAgent(id) && !is…` | `const open = [...this.cache.keys()].filter((id) => isAgent(id));` | killed |
| `t3-non-agents-too` | `const open = [...this.cache.keys()].filter((id) => isAgent(id) && !is…` | `const open = [...this.cache.keys()].filter((id) => !isFinal(id));` | survived round 1; killed by the case added for it |
| `t3-no-rotation` | `this.cursor = from + visited;` | `this.cursor = 0;` | killed |
| `t3-read-unchanged` | `if (!st.ok \|\| st.size === c.size) { refreshed++; continue; }` | `if (!st.ok) { refreshed++; continue; }` | survived round 1; killed by the case added for it |
| `t3-read-past-budget` | `      if (budget <= 0) { c.lastWriteKnown = false; visited--; break; …` | `(removed)` | survived round 1; killed by the case added for it |
| `t3-deferred-not-first` | `if (budget <= 0) { c.lastWriteKnown = false; visited--; break; }` | `if (budget <= 0) { c.lastWriteKnown = false; break; }` | survived round 1; killed by the case added for it |
| `t3-deferred-known` | `if (budget <= 0) { c.lastWriteKnown = false; visited--; break; }` | `if (budget <= 0) { visited--; break; }` | survived round 1; killed by the case added for it |
| `final-by-last-ignored` | `      if (was !== undefined) return isFinalHelperState(was);⏎` | `(removed)` | survived round 1; killed by the case added for it |
| `final-meta-ignored` | `return this.facts.get(id)?.end != null \|\| this.cache.get(id)?.meta?…` | `return this.facts.get(id)?.end != null;` | survived round 1; killed by the case added for it |
| `t4-never` | `if (this.tick - c.metaTick < RESTAT_EVERY) continue;` | `continue;` | killed |
| `t4-every` | `if (this.tick - c.metaTick < RESTAT_EVERY) continue;` | `if (false) continue;` | killed |
| `t4-no-change-check` | `if (!st.ok \|\| (c.metaStat !== null && c.metaStat.size === st.size &…` | `if (!st.ok) { c.metaTick = this.tick; continue; }` | survived round 1; killed by the case added for it |
| `t4-stat-not-kept` | `      c.metaStat = { size: st.size, mtimeMs: st.mtimeMs };⏎` | `(removed)` | survived round 1; killed by the case added for it |
| `t5-never` | `if (!isAgent(id) \|\| c.lastWriteKnown \|\| !(isFinal(id) \|\| c.meta…` | `continue;` | killed |
| `t5-budget-one` | `      if (budget < 2) break;⏎      if (!isAgent(id) \|\| c.lastWriteK…` | `      if (budget < 1) break;⏎      if (!isAgent(id) \|\| c.lastWriteK…` | survived round 1; killed by the case added for it |
| `t5-unreadable-holds` | `if (!st.ok) { c.lastWriteKnown = true; continue; } // nothing to wait…` | `if (!st.ok) { continue; } // nothing to wait for` | killed |
| `hold-dropped` | `finished: c.meta.finished && c.lastWriteKnown, // HELD` | `finished: c.meta.finished, // HELD` | killed |
| `budget-13` | `export const HELPER_READS_PER_TICK = 12;` | `export const HELPER_READS_PER_TICK = 13;` | killed |
| `readevery-always` | `return { arm, readEvery: refreshed < open.length ? { refreshed, of: o…` | `return { arm, readEvery: { refreshed, of: open.length } };` | killed |
| `readevery-never` | `return { arm, readEvery: refreshed < open.length ? { refreshed, of: o…` | `return { arm, readEvery: null };` | killed |
| `evict-listed` | `if (!nameOf.has(id) && !this.facts.has(id) && !this.last.has(id)) thi…` | `if (!this.facts.has(id) && !this.last.has(id)) this.cache.delete(id);` | survived round 1; killed by the case added for it |
| `memory-not-kept` | `    this.memory = arm.memory;⏎` | `(removed)` | killed |
| `tail-from-start` | `: Math.max(c.size, size - TAIL_BYTES);` | `: c.size;` | survived round 1; killed by the case added for it |
| `tail-shrink-from-old` | `c.size === null \|\| size < c.size ? Math.max(0, size - TAIL_BYTES)` | `c.size === null ? Math.max(0, size - TAIL_BYTES)` | survived round 1; killed by the case added for it |
| `tail-time-not-kept` | `c.lastWriteAt = lastLineTime(text) ?? c.lastWriteAt;` | `c.lastWriteAt = lastLineTime(text);` | killed |
| `tail-tokens-not-kept` | `c.tokens = lastUsageTokens(text) ?? c.tokens;` | `c.tokens = lastUsageTokens(text);` | killed |
| `meta-unreadable-forgets` | `if (r.ok \|\| r.reason === 'absent') c.meta = meta;` | `c.meta = meta;` | survived round 1; killed by the case added for it |
| `wf-activity-journal-only` | `if (a !== undefined && (at === null \|\| a > at)) at = a;` | `if (false) at = a;` | survived round 1; killed by the case added for it |
| `readall-no-helpers` | `return { workflows, helpers: await this.helpers.read({ ...agents, pro…` | `return { workflows, helpers: { arm: { agents: [], omitted: 0, unmeasu…` | killed |

#### `server/src/sessionFeed.ts`: 6 mutants, 6 killed

| Mutant | Original | Mutated to | Result |
|---|---|---|---|
| `order-none` | `    if (last !== null && last.uuid === h.uuid && h.at < last.at) retu…` | `(removed)` | killed |
| `order-le` | `h.at < last.at) return last;` | `h.at <= last.at) return last;` | killed |
| `order-any-uuid` | `if (last !== null && last.uuid === h.uuid && h.at < last.at) return l…` | `if (last !== null && h.at < last.at) return last;` | survived round 1; killed by the case added for it |
| `order-not-kept` | `    this.lastHook = h;⏎    return h;` | `    return h;` | killed |
| `stamp-start` | `return { at: Date.now(), uuid, raw };` | `return { at: now, uuid, raw };` | survived round 1; killed by the case added for it |
| `hookat-dropped` | `hookAt: hook?.at ?? null, mail };` | `hookAt: null, mail };` | killed |

#### `server/src/hookstate.ts`: 2 mutants, 2 killed

| Mutant | Original | Mutated to | Result |
|---|---|---|---|
| `id-dropped` | `return { ...(isAgentId(id) ? { id } : {}), name: item['name'], starte…` | `return { name: item['name'], startedAt: item['startedAt'] };` | killed |
| `id-unchecked` | `...(isAgentId(id) ? { id } : {})` | `...(typeof id === 'string' ? { id } : {})` | killed |

#### `server/src/fleet.ts`: 1 mutant, 1 killed

| Mutant | Original | Mutated to | Result |
|---|---|---|---|
| `strip-none` | `subagents: hs?.subagents.map(({ name, startedAt }) => ({ name, starte…` | `subagents: hs?.subagents ?? null,` | killed |

#### `server/src/transcript/tail.ts`: 5 mutants, 5 killed

| Mutant | Original | Mutated to | Result |
|---|---|---|---|
| `backlog-no-helpers` | `...(helpers.length > 0 ? { helpers } : {}) };` | `};` | killed |
| `backlog-empty-helpers` | `...(helpers.length > 0 ? { helpers } : {}) };` | `helpers };` | killed |
| `backlog-last-n` | `const helpers = lines.flatMap(helperFactsOf);⏎  return { events: even…` | `const helpers = lines.slice(-lastN).flatMap(helperFactsOf);⏎  return …` | killed |
| `tailer-no-emit` | `    if (helpers.length > 0) this.emit('helpers', helpers);⏎` | `(removed)` | killed |
| `tailer-emit-empty` | `if (helpers.length > 0) this.emit('helpers', helpers);` | `this.emit('helpers', helpers);` | killed |

#### `server/src/transcript/parse.ts`: 3 mutants, 2 killed, 1 accepted

| Mutant | Original | Mutated to | Result |
|---|---|---|---|
| `prefilter-launch-only` | `if (!line.includes('"toolUseResult"') && !line.includes('<task-notifi…` | `if (!line.includes('"toolUseResult"')) return [];` | killed |
| `prefilter-notice-only` | `if (!line.includes('"toolUseResult"') && !line.includes('<task-notifi…` | `if (!line.includes('<task-notification>')) return [];` | killed |
| `prefilter-dropped` | `  if (!line.includes('"toolUseResult"') && !line.includes('<task-noti…` | `(removed)` | survived, accepted: observable on an escaped key or opening `<` (measured by review 3014 F7). The writer's `JSON.stringify` does not emit either escape (inferred). |

#### `server/src/sessionws.ts`: 7 mutants, 7 killed

| Mutant | Original | Mutated to | Result |
|---|---|---|---|
| `ws-no-hook` | `await this.checkWorkflows(at.file, at.proc, reading);` | `await this.checkWorkflows(at.file, at.proc);` | killed |
| `ws-facts-not-taken` | `    this.helperFacts = [];⏎    const roster` | `    const roster` | survived round 1; killed by the case added for it |
| `ws-backlog-facts-dropped` | `    this.helperFacts = helpers ?? [];⏎` | `(removed)` | killed |
| `ws-tail-facts-dropped` | `    t.on('helpers', (facts) => { this.helperFacts = [...this.helperFa…` | `(removed)` | killed |
| `ws-gate-dropped` | `    if (!due) return;⏎` | `(removed)` | killed |
| `ws-gate-before-json` | `    if (json === this.lastWorkflowsJson) return;⏎    this.lastWorkflo…` | `    if (!due) return;⏎    if (json === this.lastWorkflowsJson) return…` | survived round 1; killed by the case added for it |
| `ws-hookat-ignored` | `rosterInputOf(hook?.hook ?? null, hook?.hookAt ?? null, now,` | `rosterInputOf(hook?.hook ?? null, now, now,` | survived round 1; killed by the case added for it |

#### `shared/continuity-reports.ts`: 1 mutant, 1 killed

| Mutant | Original | Mutated to | Result |
|---|---|---|---|
| `guard-loose` | `export const isAgentId = (v: unknown): v is string => typeof v === 's…` | `export const isAgentId = (v: unknown): v is string => typeof v === 's…` | killed |

#### `pwa/src/stores/session.ts`: 6 mutants, 5 killed, 1 equivalent

| Mutant | Original | Mutated to | Result |
|---|---|---|---|
| `st-agents-kept` | `agents: msg.agents ?? [], agentsUnmeasured` | `agents: msg.agents ?? s.agents ?? [], agentsUnmeasured` | killed |
| `st-unmeasured-kept` | `agentsUnmeasured: msg.agentsUnmeasured ?? null,` | `agentsUnmeasured: msg.agentsUnmeasured ?? s.agentsUnmeasured ?? null,` | killed |
| `st-readevery-dropped` | `readEvery: msg.readEvery ?? null,⏎` | `readEvery: null,⏎` | killed |
| `st-backlog-keeps` | `{ workflows: [], workflowsUnreadable: false, ...noHelpers() }` | `{ workflows: [], workflowsUnreadable: false }` | killed |
| `st-snapshot-drops` | `  agents: s.agents,⏎  agentsUnmeasured: s.agentsUnmeasured,⏎  readEve…` | `(removed)` | survived: equivalent: the reducer writes the three members and never reads them, and the store merges its answer over its own state, so a snapshot without them changes no state |
| `st-disconnect-keeps` | `workflows: [], workflowsUnreadable: false,⏎          ...noHelpers(),⏎…` | `workflows: [], workflowsUnreadable: false,⏎        });` | killed |

## 6. Review 3014, fix round 1

F1–F5 are taken. F6 updates the departures and spec-fold list. F7 corrects the prefilter classification above. F8 stays a
comparison to a copy of the old gate, not a test that loads on main; no gate code changes in this round. F9 moves the reducer
comment back to the reducer. F10 puts the ordering and the shared workflow activity calculation in the model. F11 stays
open: changing the cursor under churn is not part of guaranteeing the two lower tiers. F12's clock-step behavior has its own
red and two mutation directions now; the earlier missing-symbol reds and unchanged PWA fallback test remain as recorded.
F13 is a handoff note for H2: absent fields draw nothing, whether no helpers or an older server. No wire change.

**Measured red first:** the two saturated tier cases missed the due meta stat; the persistent range failure stayed running;
two display cases leaked controls/lone surrogates; the clock-step case only delivered the first ask. The unchanged behavior
pins for pending facts, missing metas and zero-length calls were green before the fix and are proved with their own mutants.

**Fix-round mutations (measured, 15/15 killed).** `mutation-run.py` ran one file per process through the test slice, at
1-minute load 8.19–8.47, in a scratch tree; targets were restored from saved copies and compared byte for byte.

| Mutation | Removed or inverted behavior | Killed by |
|---|---|---|
| X1 | Remove the pending facts slice | `sessionws-helpers`, newest 1,024 across two chunks |
| X2 | Skip a listed id whose meta was missing | `helpers-read`, missing meta appears |
| X3 | Read a changed meta after the budget threshold | `helpers-read`, thirteenth-call boundary and final reservation |
| X4 | Leave a terminal range failure held | `helpers-read`, stat succeeds and range always fails |
| X5 | Issue a range for a zero-length tail | `helpers-read`, empty transcript |
| No meta reserve | Allow open reads to consume the meta slot | `helpers-read`, saturated quiet/growing cohorts |
| No final reserve | Allow open reads to consume the final slots | `helpers-read`, saturated quiet/growing cohorts |
| Forget deferred stat | Drop the pending changed stat before the next read | `helpers-read`, no second stat before reading |
| Publish stale end | Do not invalidate last-write knowledge on new `finished` meta | `helpers-read`, two final writes compete for one attempt |
| Newest due first | Reverse the meta order | `helpers-read`, whole cohort within its bound |
| Keep controls | Do not sanitize display text | `helpers-frame`, meta display text |
| Keep launch model controls | Bypass display cleanup on launch-model fallback | `helpers-frame`, launch model and summary |
| Keep summary controls | Bypass display cleanup on summary | `helpers-frame`, launch model and summary |
| Accept older helper roster | Replace the helper ordering result with the latest arrival | `sessionws-helpers`, no fabricated drop at clock step |
| Hold the ask with the roster | Reuse the ordered hook for raw hook consumers | `session-feed-hook-at`, older publication still reaches raw readers; clock-step behavior pinned in `sessionws-helpers` |

**Fix-round local verification (measured).** 28 of 29 server importer and feed/ask/import-pin files passed (load 8.07–9.95).
`ask-pairing-skew` timed out in one of 38 cases at its 60 s limit; the isolated old-client/new-server group passed all 20
selected cases at load 8.39. The two separately run importers still red locally were `session-ladders-characterization`
(61 passed; the same fresh-heartbeat case failed as on the base) and `secret-mask` (95 passed, one skipped; the slow drawer
input timed out at 20 s, the same class measured on main by review 3014). The feed's mail delivery is covered by
`session-stream-readings` and `sessionws`; the separate watcher mail sweep does not consume this reading.

61 of 62 architecture, single-definition and static/ledger files passed in the batch (load 8.50–11.44); the test slice
killed the `docs-l0` worker at its memory cap, and the isolated rerun passed all 155 at load 8.10. `deviation-refs` ran
after a fresh fetch. The 50 PWA store and session-consumer files passed (load 7.22–8.84). Server source, server test tree,
and PWA typechecks passed.

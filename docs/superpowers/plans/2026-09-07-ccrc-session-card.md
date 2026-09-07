# The ccrc session card (R7, tell-only) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a fleet session a read of the registry sitting beside it — the hold's bytes quoted verbatim, and a count of supervised rows naming the same project — emitted as one SessionStart card, with counters that make the effect a number rather than an argument.

**Architecture:** `ccd/session-hook.sh` gains three builders (`_hook_graph_card` refactored to set text instead of emitting, plus `_hook_hold_card` and `_hook_ccrc_card`) and one emit site. Everything is read from `$HOME/.cc-sessions/` with zero forks: no network, no locks, no waiting. Two hookstate counters ride the existing envelope and cost the server nothing. Two prerequisite tasks fix the measurement instruments before the mechanism ships.

**Tech Stack:** bash 5 (`ccd/session-hook.sh`, `ccd/ccrc-api`), TypeScript + vitest (`server/`), `jq`, systemd/cron on the fleet host.

**Spec:** `docs/superpowers/specs/2026-09-07-ccrc-session-card-design.md`

## Global Constraints

- **Branch from `origin/main`.** `ws/clear-river`'s `ccd/session-hook.sh` is 644 lines against origin's 739 — missing R6 and pools 2a. An agent-lane deploy from a stale tree silently reverts both across ~17 live sessions.
- **AGENT-FIRST deploy.** `ccd/` ships to the fleet host before the server lane. Executables land via `install_atomic`.
- **The hook's standing contract** (`session-hook.sh:4-9`): exit 0 on every path, write atomically or not at all, **no network, no locks, no waiting**.
- **Never `2>/dev/null` on a `$(<f)`.** Bash parses it as a null command with redirections and returns the empty string with rc 0 on a perfectly readable file.
- **Never `$(_helper)`.** Command substitution forks a subshell even around a shell function: measured 61.9 ms for one 22-row pass that way against 2.97 ms with a global.
- **No bounded regex repetition (`{m,n}`) inside a per-row loop.** Measured 13.1–18.5 ms over 23 evaluations against 1.4–2.2 ms for `case` plus `${#x}`. `=~` once per event is free.
- **`FLEET_PROTO` stays 1. The hookstate envelope's `v` stays 1.** Both counters are additive; a `v:2` writer deployed agent-first would blind the server to every session on the fleet.
- **No CLAUDE.md is written** (operator ruling 2026-09-02: ccrc never writes files it does not own).
- **No new ccd verb. No account-name list in any shipped source file.**
- **Deviation numbers are ISSUED, never looked up.** When a deviation is found, `POST /api/ledger/deviations` mints exactly the count needed and it is **defined in the same act**. If the allocator is unreachable, write `D-TBD-<slug>` and report. Never take a number from `GET /api/ledger`'s `floor`.
- **Test suites run in the FOREGROUND, timeout ≥600000 ms**, from inside the package: `cd server && ./node_modules/.bin/vitest run test/<file>`. Never bare `npx vitest`.
- **Known load flakes** — re-run in isolation before calling a real break: `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`.

## File Structure

| File | Responsibility | Lane |
|---|---|---|
| `ccd/session-hook.sh` | the emitter clip, three card builders, one emit site, two counters | agent |
| `ccd/ccrc-api` | one word: `claims list` gains the `all` query key | agent |
| `server/test/session-hook.test.ts` | every guard's mutation test | server (test only) |
| `server/src/coord/dispatch.ts` | the hold moves above the `/clear` | server |
| `server/test/dispatch-hold-order.test.ts` | pins that ordering | server (test only) |
| `~/.local/bin/graph-gate-snapshot` | the carrier: the `grep -c` fix, the registry pass, six new roll-ups | none (operator plumbing, outside every checkout) |
| `README.md` | the SessionStart-card section | server |

---

## Task 1: Fix the carrier, and record the pre-deploy baseline

The adoption reading has no instrument until this lands. `grep -c` on a no-match against an existing file prints `0` **and exits 1**, so `|| echo 0` appends a second `0`; the 3-byte `0\n0` is refused by `jq --argjson` and the whole run writes nothing. It fails on exactly the zero-adoption hours the reading exists to record. This must ship **before** the card and run one clean day.

**Files:**
- Modify: `~/.local/bin/graph-gate-snapshot` (operator plumbing — outside every checkout, no repo lane, no vitest)
- Record: the baseline into the plan's `## Baseline recorded` section below

**Interfaces:**
- Produces: `~/.ccrc/graph-gate-readings.jsonl` lines carrying `cp`, `cc`, `held`, `coTenants`, `project` per session and six new roll-ups (`peerRead`, `claimed`, `nullPeerRead`, `heldN`, `coTenantN`, `liveN`). Task 6's counters write the `cp`/`cc` fields this reads; until then they read `null`, which is the signal that the hook has not shipped.

- [ ] **Step 1: Reproduce the defect, both directions**

```bash
LOG="$HOME/.cache/graphify-queries.log"
q=$(grep -c '"ts": "1999-01-01' "$LOG" 2>/dev/null || echo 0)
printf 'value=[%s] bytes=%s\n' "$q" "$(printf '%s' "$q" | wc -c)"
jq -nc --argjson q "${q:-0}" '{q:$q}'
```

Expected: `bytes=3`, then `jq: invalid JSON text passed to --argjson`.

- [ ] **Step 2: Record how many readings were lost**

```bash
jq -r '.ts' ~/.ccrc/graph-gate-readings.jsonl | tail -1
crontab -l | grep graph-gate-snapshot
```

Write both into `## Baseline recorded` below, with the count of cron fires since that timestamp.

- [ ] **Step 3: Back up the current script**

```bash
cp -a ~/.local/bin/graph-gate-snapshot ~/.local/bin/graph-gate-snapshot.bak-$(date -u +%Y%m%d-%H%M%S)
```

- [ ] **Step 4: Replace the broken line**

Replace:

```bash
queries_today=$(grep -c "\"ts\": \"$day" "$LOG" 2>/dev/null || echo 0)
```

with:

```bash
# `grep -c` on a NO-MATCH against an EXISTING file prints `0` and exits 1, so
# the old `|| echo 0` appended a SECOND `0` — a 3-byte `0\n0` that `--argjson`
# refuses, killing the whole run. It failed on exactly the zero-adoption hours
# the reading exists to record. The guard is the hook's own (`^[0-9]+$`,
# spelled as a `case`), and it covers no-match AND missing-file.
queries_today=$(grep -c "\"ts\": \"$day" "$LOG" 2>/dev/null)
case "$queries_today" in ''|*[!0-9]*) queries_today=0 ;; esac
```

and change the final `jq -nc` invocation's `--argjson q "${queries_today:-0}"` to `--argjson q "$queries_today"`.

- [ ] **Step 5: Add the registry pass, before the `sessions=` block**

```bash
# `held` and `coTenants` are REGISTRY facts, not hookstate fields: the hook can
# see them but must not WRITE them (ccrc never writes files it does not own), so
# the carrier measures them here, beside the counters they explain. ONE pass
# with `$(<f)`, not a per-row sweep of `cat` (22x22 forks).
declare -A LIVE_IN=(); declare -A PROJ_OF=(); declare -A IS_LIVE=()
now_s=$(date +%s)
for q in "$REG"/*.uuid; do
  [ -e "$q" ] || continue
  o=$(basename "$q" .uuid)
  pr=""; [ -f "$REG/$o.project" ] && [ -r "$REG/$o.project" ] && pr=$(<"$REG/$o.project")
  pr="${pr#"${pr%%[![:space:]]*}"}"; pr="${pr%"${pr##*[![:space:]]}"}"
  [ -n "$pr" ] || pr="$o"
  PROJ_OF["$o"]="$pr"
  # THE SAME RUNG THE HOOK USES — supervisor heartbeat inside 120 s, never
  # `.archived` (D9: the stamp "decides nothing"). If the carrier counted rows
  # a different way from the card, the reading would not be about the card.
  sv=""; [ -f "$REG/$o.supervised" ] && [ -r "$REG/$o.supervised" ] && sv=$(<"$REG/$o.supervised")
  case "$sv" in ''|*[!0-9]*) continue ;; esac
  (( now_s - sv >= 0 && now_s - sv < 120 )) || continue
  IS_LIVE["$o"]=1
  LIVE_IN["$pr"]=$(( ${LIVE_IN["$pr"]:-0} + 1 ))
done
```

- [ ] **Step 6: Widen the per-session object**

Replace the body of the `sessions=$(...)` loop with:

```bash
  sid=$(basename "$f" .hookstate.json)
  held=false; [ -e "$REG/$sid.hold" ] && held=true
  proj="${PROJ_OF[$sid]:-}"
  # -1 is "not a live row at all", deliberately NOT 0: "alone in its project"
  # and "not supervised" are two conditions the reading handles differently.
  if [ -n "${IS_LIVE[$sid]:-}" ]; then cot=$(( ${LIVE_IN[$proj]:-1} - 1 )); else cot=-1; fi
  jq -c --arg id "$sid" --arg project "$proj" --argjson held "$held" --argjson coTenants "$cot" \
    '{id:$id, project:$project, held:$held, coTenants:$coTenants,
      gq:(.graphQueries // null), gd:(.graphGateDenials // null),
      cp:(.ccrcPeerReads // null), cc:(.ccrcClaims // null),
      event:(.event // null), updatedAt:(.updatedAt // null)}' "$f" 2>/dev/null
```

- [ ] **Step 7: Add the six roll-ups**

Extend the final `jq -nc` object, after `zeroQuery`:

```
    peerRead:([$s[] | select((.cp // 0) >= 1)] | length),
    claimed:([$s[] | select((.cc // 0) >= 1)] | length),
    nullPeerRead:([$s[] | select(.cp == null)] | length),
    heldN:([$s[] | select(.held)] | length),
    coTenantN:([$s[] | select(.coTenants >= 1)] | length),
    liveN:([$s[] | select(.coTenants >= 0)] | length)}
```

- [ ] **Step 8: Verify the fix writes a line on a zero-query day**

```bash
cp -a ~/.ccrc/graph-gate-readings.jsonl /tmp/readings.bak
BEFORE=$(wc -l < ~/.ccrc/graph-gate-readings.jsonl)
mv ~/.cache/graphify-queries.log /tmp/qlog.bak && : > ~/.cache/graphify-queries.log
~/.local/bin/graph-gate-snapshot; echo "rc=$?"
AFTER=$(wc -l < ~/.ccrc/graph-gate-readings.jsonl)
mv /tmp/qlog.bak ~/.cache/graphify-queries.log
echo "lines: $BEFORE -> $AFTER"
tail -1 ~/.ccrc/graph-gate-readings.jsonl | jq -c 'del(.sessions)'
```

Expected: `rc=0`, lines incremented by exactly 1, and `queriesToday:0` in the roll-up. Against the **old** script the same sequence adds 0 lines. Record both numbers below — this reproduction is this task's mutation test, because the file is outside every checkout and no vitest can reach it.

- [ ] **Step 9: Record the baseline**

```bash
tail -1 ~/.ccrc/graph-gate-readings.jsonl | jq -c 'del(.sessions)'
```

Expected shape: `nullPeerRead` equals the total row count and `peerRead`/`claimed` are 0 — that is what proves the hook has not shipped. Paste the line into `## Baseline recorded`.

- [ ] **Step 10: Let it run one full day before Task 9's deploy**

```bash
jq -r 'select(.ts|startswith("'"$(date -u +%F)"'")) | .ts' ~/.ccrc/graph-gate-readings.jsonl | wc -l
```

Expected after 24 h: 24. Do not proceed to Task 9 until this is ≥20; a card deployed against a broken carrier has no baseline.

---

## Task 2: `ccrc-api claims list` gains the `all` query key

The falsification for this whole slice is "0 of 34 claim rows were taken outside a program run", and no shipped surface can read it — the closed client refuses `--all`. One word.

**Files:**
- Modify: `ccd/ccrc-api:110`
- Test: `server/test/ccrc-api-closed.test.ts` (existing — confirm still green)

**Interfaces:**
- Produces: `ccrc-api claims list --all 1` returning the whole claim history, which Task 9's reading and the 7-day effect measurement both consume.

- [ ] **Step 1: Confirm the refusal exists today**

```bash
~/.local/bin/ccrc-api claims list --all 1
```

Expected: `{"ok":false,"error":"unknown-query","detail":"claims list takes no --all"}`

- [ ] **Step 2: Confirm the server side already supports it**

```bash
grep -n "q.all === '1'" server/src/coord/routes.ts
```

Expected: one hit inside the `GET /api/claims` handler. No server change is needed — only the client's declared key list.

- [ ] **Step 3: Make the one-word change**

In `ccd/ccrc-api`, change:

```bash
[claims.list]='GET|/api/claims|no|project'
```

to:

```bash
[claims.list]='GET|/api/claims|no|project,all'
```

- [ ] **Step 4: Confirm no closed-client pin forbids it**

```bash
cd server && ./node_modules/.bin/vitest run test/ccrc-api-closed.test.ts
```

Expected: PASS. Its pins are: no curl in the corpora, the corpora name the client, no URL/host/path/raw argument, one identity flag, the token is never printed, every fragment passes `SAFE_RE`, and `EXEC_COMMANDS` is unchanged. `all=1` passes `SAFE_RE`.

- [ ] **Step 5: Deploy the client to the fleet host and read the baseline**

```bash
bash deploy/deploy.sh agent
~/.local/bin/ccrc-api claims list --all 1 \
  | jq '{rows:(.claims|length), programless:([.claims[]|select(.runId==null)]|length),
         holders:([.claims[].heldBy]|unique|length), projects:([.claims[].project]|unique)}'
```

Expected: `programless: 0`. Record the four numbers in `## Baseline recorded`.

- [ ] **Step 6: Commit**

```bash
git add ccd/ccrc-api
git commit -m "feat(ccrc-api): claims list accepts --all, so the claim history is readable from the fleet host

The 0-of-34 programless-claim baseline is the falsification for the R7 card's
co-tenant subject, and the closed client refused the only query that reads it.
The server arm already exists (routes.ts, \`q.all === '1'\`); this is the client
declaring the key. ccrc-api-closed's seven pins are unaffected — \`all=1\` passes
SAFE_RE and EXEC_COMMANDS is untouched."
```

---

## Task 3: One emit — the clip and the builder refactor

Two SessionStart envelopes make Claude Code's stdout parser throw; the caller returns `{answer:{}}` and **both** cards vanish fleet-wide, silently, with a warning that blames string concatenation. This task makes a second subject structurally impossible to emit separately. It must land before Tasks 4 and 5.

**Files:**
- Modify: `ccd/session-hook.sh` — `_hook_emit_context` (~`:60`), the census emit (`:300`), the card emit (`:327`), the constants block (~`:353`), the SessionStart arm's emit site (`:489`)
- Test: `server/test/session-hook.test.ts`

**Interfaces:**
- Produces: `CARD_GRAPH` (set by `_hook_graph_card`, never emitted), the join-and-emit site in the SessionStart arm, and `CARD_MAX_CHARS`. Tasks 4 and 5 set `CARD_CCRC` and `CARD_HOLD` and rely on this site to print them.

- [ ] **Step 1: Write the failing tests**

Add to `server/test/session-hook.test.ts`, in a new describe:

```ts
describe('the emitter: one line, clipped once', () => {
  it('clips the assembled card at the emitter on the armed-tree arm', () => {
    const tree = path.join(home, 'tree');
    gitTree(tree, 1);
    plantGraph(tree, { built: 'deadbee' });
    const text = card(run({ hook_event_name: 'SessionStart', cwd: tree }));
    expect(text.length).toBeLessThanOrEqual(1800);
  });

  it('a pathological hold cannot delete the card', () => {
    const tree = path.join(home, 'tree');
    gitTree(tree, 1);
    plantGraph(tree, { built: 'deadbee' });
    fs.writeFileSync(path.join(home, '.cc-sessions', 'demo-quiet-basin.hold'),
      `program:${'x'.repeat(200_000)} wave:1/2 run:9`);
    const out = run({ hook_event_name: 'SessionStart', cwd: tree });
    const text = card(out);            // card() asserts exactly one line
    expect(text.length).toBeLessThanOrEqual(1800);
    expect(text).toContain('graphify:');
  });
});
```

- [ ] **Step 2: Run them to verify the second fails**

```bash
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'the emitter'
```

Expected: the clip test PASSES (nothing is long enough yet); `a pathological hold cannot delete the card` PASSES too on origin/main, because no hold is read yet. **This is expected** — the test is a regression guard for Tasks 4 and 5, not a red-first driver. The red-first driver is Step 3's mutation check.

- [ ] **Step 3: Add the clip**

In `_hook_emit_context`, as the **first statement** after `local j=""`:

```bash
  # THE TOTAL CLIP LIVES HERE, at the ONE site every subject passes through.
  # A per-subject clip is one each new subject can forget; this one cannot be.
  # It is also what stands between an operator-controlled field and `jq`'s own
  # MAX_ARG_STRLEN (measured 131072 on this box: at 130442 bytes of card the
  # exec fails, `|| return 0` swallows it, and the hook prints NOTHING —
  # deleting the graphify card for that session too).
  set -- "${1:0:$CARD_MAX_CHARS}"
```

- [ ] **Step 4: Add the constant**

In the constants block, after `GRAPH_GATE_OFF` / `GRAPH_GATE_MAX_BEHIND`:

```bash
# ── R7: the card's bounds and its kill-switch ───────────────────────────
# Same shape as GRAPH_GATE_OFF above and as `$REG/coordinator-paused`: a file
# the operator touches by hand, releasable without a deploy and without a
# token. Measured cost of the test: p50 0.016 ms.
CCRC_CARD_OFF="$HOME/.ccrc/ccrc-card-off"
# THE TOTAL, argued rather than inherited. The `<600` in `session-hook.test.ts`
# is a TAINT bound on ONE repo-controlled field — its own message says so ("an
# unbounded repo-controlled string reached the session") — and it binds the
# census arm alone; it stays exactly as it is. THIS is a different number for a
# different job: the ceiling on the whole assembled card. Measured worst live
# combination is graphify 593 + held 592 + co-tenant 176 + 2 joins = 1363, and
# the neighbour hook on this same compact SessionStart
# (`~/.cc-handoff/restore.sh`) caps its own additionalContext at 24576 bytes —
# so 1800 clears everything this file can emit today by 32% and is 7.3% of the
# scale this event already carries.
CARD_MAX_CHARS=1800
```

- [ ] **Step 5: Turn `_hook_graph_card` into a builder**

Replace its census emit (`:300`):

```bash
-    _hook_emit_context "graphify: this tree has no knowledge graph — the ccrc sweep's last pass says $row. Do not build one here; the sweep owns the write side."
+    CARD_GRAPH="graphify: this tree has no knowledge graph — the ccrc sweep's last pass says $row. Do not build one here; the sweep owns the write side."
```

and its card emit (`:327`):

```bash
-  _hook_emit_context "$line"
+  CARD_GRAPH="$line"
```

- [ ] **Step 6: Replace the SessionStart arm's emit site**

At `:489`, replace `_hook_graph_card || true` with:

```bash
    # ONE EMIT, INDEPENDENT SUBJECTS. Two SessionStart envelopes make the
    # harness's stdout parser throw and the caller returns `{answer:{}}` —
    # which deletes BOTH cards fleet-wide, silently, with a warning that blames
    # a quoting bug that does not exist. So the builders SET text and this is
    # the only site that prints. `_hook_graph_card` returns early for a tree
    # with no cwd and for a tree the sweep left no word about; a registry
    # subject must not inherit either gate, because neither has anything to do
    # with the registry.
    CARD_GRAPH=""; CARD=""
    _hook_graph_card || true
    CARD="$CARD_GRAPH"
    [ -z "$CARD" ] || _hook_emit_context "$CARD"
```

- [ ] **Step 7: Run the whole file — every existing test must stay green**

```bash
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts
```

Expected: PASS, including all 20 existing `card()` assertions and the `<600` census assertion, unchanged. The `beforeEach` creates an empty `.cc-sessions`, so no registry subject fires in any of them.

- [ ] **Step 8: Verify the clip is load-bearing (mutation)**

Delete the `set --` line, re-run `-t 'a pathological hold'`. It will still pass at this point (no hold reader yet); re-run this mutation at the end of Task 5, where it goes RED. Note that in the task's commit body.

- [ ] **Step 9: Commit**

```bash
git add ccd/session-hook.sh server/test/session-hook.test.ts
git commit -m "refactor(hook): the SessionStart card is built then emitted once, and clipped at the emitter

A second _hook_emit_context call would not merely drop the new subject: Claude
Code parses hook stdout beginning with { as ONE document, two envelopes throw,
the multi-document tolerance declines (both lines parse), and the caller returns
{answer:{}} — so the SHIPPED graphify card stops arriving fleet-wide, silently,
with a warning blaming string concatenation. _hook_graph_card now sets
CARD_GRAPH; one site joins and prints.

CARD_MAX_CHARS=1800 clips at the one site every present and future subject
passes through. It is a different number for a different job from the <600 in
session-hook.test.ts, which is a taint bound on the census .reason and stays
exactly as it is."
```

---

## Task 4: The co-tenant subject

**Files:**
- Modify: `ccd/session-hook.sh` — new `_ct_read`, `_ct_probe`, `_hook_ccrc_card` after `_hook_graph_card`; constants; the emit site from Task 3
- Test: `server/test/session-hook.test.ts`

**Interfaces:**
- Consumes: `CARD_MAX_CHARS`, `CCRC_CARD_OFF`, and the emit site from Task 3.
- Produces: `_ct_read <path>` — sets `CT_V`, returns 0 read / 1 absent / 2 unmeasurable. Task 5 calls it. Also `CARD_CCRC`.

- [ ] **Step 1: Write the failing tests**

```ts
// `spawnSync` joins the file's existing `execFileSync` import — the stderr
// assertion below needs a result object on a ZERO exit, which execFileSync
// does not give.
describe('the co-tenant subject', () => {
  const REG = (): string => path.join(home, '.cc-sessions');
  /** Plant a peer row: `.uuid` (the id enumeration), `.project`, `.supervised`. */
  const peer = (id: string, project: string | null, ageS: number | null): void => {
    fs.writeFileSync(path.join(REG(), `${id}.uuid`), `uuid-${id}`);
    if (project !== null) fs.writeFileSync(path.join(REG(), `${id}.project`), project);
    if (ageS !== null) {
      fs.writeFileSync(path.join(REG(), `${id}.supervised`),
        String(Math.floor(Date.now() / 1000) - ageS));
    }
  };
  const plain = (): string => {
    const tree = path.join(home, 'tree');
    gitTree(tree, 1);
    plantGraph(tree, { built: 'deadbee' });
    return card(run({ hook_event_name: 'SessionStart', cwd: tree }));
  };

  it('counts supervised rows naming the same project, and names the route', () => {
    peer('demo-quiet-basin', 'alpha', 5);
    peer('p1', 'alpha', 5);
    peer('p2', 'alpha', 5);
    peer('p3', 'beta', 5);
    const text = plain();
    expect(text).toContain('ccrc: 2 other supervised rows name project `alpha`');
    expect(text).toContain('ccrc-api peers list --of demo-quiet-basin');
    expect(text).toContain('the five peer rules');
  });

  it('says nothing at all when this row is alone in its project', () => {
    peer('demo-quiet-basin', 'alpha', 5);
    peer('p3', 'beta', 5);
    expect(plain()).not.toContain('ccrc:');
  });

  it('uses the singular at one co-tenant', () => {
    peer('demo-quiet-basin', 'alpha', 5);
    peer('p1', 'alpha', 5);
    expect(plain()).toContain('ccrc: 1 other supervised row names project `alpha`');
  });

  it('counts an archived row whose supervisor is still beating — the archive stamp decides nothing (D9)', () => {
    peer('demo-quiet-basin', 'alpha', 5);
    peer('ghost', 'alpha', 5);
    fs.writeFileSync(path.join(REG(), 'ghost.archived'), 'archived=1 reason=merged:#160');
    expect(plain()).toContain('ccrc: 1 other supervised row names project `alpha`');
  });

  it('does not count a row whose heartbeat has stopped', () => {
    peer('demo-quiet-basin', 'alpha', 5);
    peer('stale', 'alpha', 5000);
    expect(plain()).not.toContain('ccrc:');
  });

  it('a trailing space in .project groups exactly as the server does', () => {
    peer('demo-quiet-basin', 'alpha ', 5);
    peer('p1', 'alpha', 5);
    expect(plain()).toContain('ccrc: 1 other supervised row names project `alpha`');
  });

  // `spawnSync`, not `run`/`execFileSync`: this test's whole point is the
  // STDERR channel, and only spawnSync hands it back on a zero exit. A bare
  // `$(<f)` on a mode-000 file writes "Permission denied" to the hook's real
  // stderr, which the harness folds into a user-visible warning on EVERY
  // SessionStart of EVERY co-tenant session.
  it('an unreadable peer .project costs no stderr and is reported, never folded into absence', () => {
    peer('demo-quiet-basin', 'alpha', 5);
    peer('p1', 'alpha', 5);
    peer('p2', 'alpha', 5);
    fs.chmodSync(path.join(REG(), 'p2.project'), 0o000);
    const tree = path.join(home, 'tree');
    gitTree(tree, 1);
    plantGraph(tree, { built: 'deadbee' });
    const r = spawnSync('bash', [HOOK], {
      input: JSON.stringify({ hook_event_name: 'SessionStart', cwd: tree }),
      encoding: 'utf8',
      env: { ...process.env, HOME: home,
        PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
        TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242' },
    });
    expect(r.status, 'the hook must exit 0 on every path').toBe(0);
    expect(r.stderr, 'the hook leaked stderr the harness will surface').toBe('');
    expect(card(r.stdout))
      .toContain('ccrc: at least 1 other supervised row names project `alpha`');
  });

  it('a directory at a registry path is not read', () => {
    peer('demo-quiet-basin', 'alpha', 5);
    peer('p1', 'alpha', 5);
    fs.mkdirSync(path.join(REG(), 'p2.project'), { recursive: true });
    fs.writeFileSync(path.join(REG(), 'p2.uuid'), 'uuid-p2');
    expect(plain()).toContain('at least 1 other supervised row names project `alpha`');
  });

  it('never claims liveness or shared files, and always names the route that can', () => {
    peer('demo-quiet-basin', 'alpha', 5);
    peer('p1', 'alpha', 5);
    const text = plain();
    expect(text).not.toMatch(/\blive\b|\bsessions? share\b|\bsharing\b/i);
    expect(text).toContain('supervised row names project');
    expect(text).toContain('peers list --of');
  });

  it('survives a tree graphify says nothing about', () => {
    peer('demo-quiet-basin', 'alpha', 5);
    peer('p1', 'alpha', 5);
    const out = run({ hook_event_name: 'SessionStart', cwd: path.join(home, 'nograph') });
    const text = card(out);
    expect(text).toContain('ccrc:');
    expect(text).not.toContain('graphify:');
  });

  it('the operator file silences the subject and nothing else', () => {
    fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    fs.writeFileSync(path.join(home, '.ccrc', 'ccrc-card-off'), '');
    peer('demo-quiet-basin', 'alpha', 5);
    peer('p1', 'alpha', 5);
    const text = plain();
    expect(text).not.toContain('ccrc:');
    expect(text).toContain('graphify:');
  });

  it('emits exactly one parseable line when both subjects fire', () => {
    peer('demo-quiet-basin', 'alpha', 5);
    peer('p1', 'alpha', 5);
    fs.writeFileSync(path.join(REG(), 'demo-quiet-basin.hold'),
      'program:account-pools wave:3/6 run:34');
    const tree = path.join(home, 'tree');
    gitTree(tree, 1);
    plantGraph(tree, { built: 'deadbee' });
    const out = run({ hook_event_name: 'SessionStart', cwd: tree });
    expect(out.trim().split('\n')).toHaveLength(1);
    expect(() => JSON.parse(out.trim())).not.toThrow();
  });

  // CCRC_FRESH_S is a THIRD copy of SUPERVISED_FRESH_MS and
  // single-definition.test.ts's roots are shared, server/src, pwa/src and
  // agent/src — it does not scan ccd/, so nothing else would catch the drift.
  // The local copy follows this file's own precedent (_hook_epoch_ms is a
  // deliberate local copy of ccd's _plat_epoch_ms with a test pinning the two
  // bodies identical), because the hook is installed alone into ~/.cc-sessions
  // and can source nothing.
  it('the hook, ccd and shared agree on the supervised-freshness window', () => {
    const hook = fs.readFileSync(path.resolve(__dirname, '../../ccd/session-hook.sh'), 'utf8');
    const ccd = fs.readFileSync(path.resolve(__dirname, '../../ccd/ccd'), 'utf8');
    const api = fs.readFileSync(path.resolve(__dirname, '../../shared/api.ts'), 'utf8');
    const h = /CCRC_FRESH_S=(\d+)/.exec(hook);
    const c = /now - sup >= 0 && now - sup < (\d+)/.exec(ccd);
    const s = /SUPERVISED_FRESH_MS\s*=\s*([\d_]+)/.exec(api);
    expect(h, 'CCRC_FRESH_S not found in the hook').not.toBeNull();
    expect(c, "ccd's supervised-freshness comparison not found").not.toBeNull();
    expect(s, 'SUPERVISED_FRESH_MS not found in shared/api.ts').not.toBeNull();
    expect(Number(h![1]) * 1000, 'the hook and shared disagree on the window')
      .toBe(Number(s![1]!.replace(/_/g, '')));
    expect(Number(c![1]), 'ccd and the hook disagree on the window').toBe(Number(h![1]));
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'the co-tenant subject'
```

Expected: FAIL — every positive assertion, because `ccrc:` is never printed.

- [ ] **Step 3: Add the constants**

Beside `CCRC_CARD_OFF` and `CARD_MAX_CHARS` from Task 3:

```bash
# BOUNDED AND ANCHORED. The project string is registry text that lands verbatim
# in a prompt, so it is gated on a SHAPE rather than clipped to a length: a
# value this refuses is UNSPEAKABLE and the card says nothing, rather than
# quoting bytes it cannot vouch for. The class is `id`'s own plus a length
# bound; it admits no whitespace, so the trailing-space divergence that would
# split the hook's grouping from the server's is refused, not guessed at.
#
# THE SHAPE GATE IS A `case` GLOB PLUS `${#x}`, NOT AN ERE, AND THAT IS A
# BUDGET DECISION MEASURED RATHER THAN ASSUMED. The natural spelling here is
# `[[ $x =~ ^[A-Za-z0-9._-]{1,128}$ ]]`, and the BOUNDED REPETITION is what
# costs: over 23 evaluations, `{1,128}` measures 13.1-18.5 ms and `{1,64}`
# 7.9-13.9 ms, against 1.2-4.1 ms for the same class with `+` and 1.4-2.2 ms
# for `case` plus `${#x}`. `=~` is free where the shipped hook uses it — once
# per event; inside a per-row loop the `{m,n}` expansion was the WHOLE cost of
# this probe (17.4 ms p50 before, 4.5 ms after).
#
# The class is spelled ONCE and the `case` patterns expand it, because a
# variable inside a bracket expression works and costs the same (measured):
# two literal copies would be the second definition `single-definition.test.ts`
# exists to redden.
CCRC_PROJ_CLASS='A-Za-z0-9._-'
CCRC_PROJ_MAX=64
CCRC_ID_MAX=128
# `SUPERVISED_FRESH_MS` (`shared/api.ts`) in seconds — the same 120 s window
# `_session_state`'s bash twin uses, tolerating 4 missed 30 s beats.
CCRC_FRESH_S=120
```

- [ ] **Step 4: Add the reader, the probe and the card**

Immediately after `_hook_graph_card`'s closing brace:

```bash
# ── THE CO-TENANT SUBJECT (R7) ──────────────────────────────────────────
# ONE READ, THREE ANSWERS. `readFileMeasured`'s rule (D-114) in bash: absent
# and unreadable are two conditions a caller handles differently, so they get
# two return codes. `-f` is not decoration — `-r` is TRUE for a DIRECTORY and
# `$(<dir)` is silently empty with rc 0, and ccd names a directory planted at a
# registry path as a real attack shape.
#
# NEVER `2>/dev/null` on a `$(<f)`: bash parses that as a null command with
# redirections, NOT the fork-free read — measured, it returns the EMPTY STRING
# and rc 0 on a perfectly readable file, so the reflex idiom is a silent wrong
# answer. The `[[ -f && -r ]]` guard is what makes stderr silent instead.
#
# IT SETS `CT_V` AND NEVER PRINTS. `v=$(_ct_read f)` would be a command
# SUBSTITUTION, which forks a subshell even around a shell function: measured
# 61.9 ms for one 22-row pass that way against 2.97 ms this way. The whole
# probe forks ZERO times (strace: 0 clone/clone3/vfork over one pass).
#
# The trim reproduces the server's own `field()` (`server/src/registry.ts:333`
# does `content.trim()`), so the hook and the server group rows the same way.
_ct_read() {   # <path> -> CT_V ; rc 0 read, 1 absent, 2 unmeasurable
  CT_V=""
  [[ -e "$1" ]] || return 1
  [[ -f "$1" && -r "$1" ]] || return 2
  CT_V=$(<"$1") || return 2
  CT_V="${CT_V#"${CT_V%%[![:space:]]*}"}"; CT_V="${CT_V%"${CT_V##*[![:space:]]}"}"
  return 0
}

# THE RUNG IS THE SUPERVISOR HEARTBEAT, NOT `.archived` — and that is a ruling
# this repo already made. `server/src/coord/peers.ts` (D9): the peers route
# "does NOT filter on `.archived` ... `archivedAt` is reported verbatim and
# decides nothing", and it ships `archiveContradicted`/`archivedStale` to NAME
# the contradiction. Measured on this box: `data-internal-still-prairie` has
# carried `.archived` for 33 days beside a 4-second-old heartbeat, and the
# server calls it `deliverable:"yes"`. In the other direction a main checkout
# can never be archived at all, so an `.archived` filter over-counts a dead
# main checkout forever with nothing to correct it. The heartbeat is the one
# field a dead row stops writing, and 120 s is `SUPERVISED_FRESH_MS`.
#
# THE PROJECT IS READ, NEVER PARSED OUT OF THE ID. Measured over all 22 rows:
# `${id%-*}` is right 0 times and `${id#*-}` 3 times, because ccd mints ids
# both `<wrapper>-<project>` and `<project>-<slug>` and both halves are
# hyphenated. There is no fallback there, only a wrong answer.
_ct_probe() {   # -> CT_N CT_U CT_PROJ ; rc 1 = nothing may be said
  CT_N=0; CT_U=0; CT_PROJ=""
  local me="" f o rc now
  _ct_read "$REG/$id.project"; rc=$?
  [[ $rc -ne 2 ]] || return 1
  me="$CT_V"; [[ -n $me ]] || me="$id"
  case "$me" in ''|*[!$CCRC_PROJ_CLASS]*) return 1 ;; esac
  (( ${#me} <= CCRC_PROJ_MAX )) || return 1
  now="${EPOCHREALTIME%%[.,]*}"
  # SUFFIX-ANCHORED, never `$REG/$id*` and never bare `$REG/*`: `_reg_purge`
  # records MEASURED id-nesting collisions an unanchored glob matches both
  # sides of, and wave 2a put the project pool tag in a DOTLESS `$REG/pools/`
  # precisely because "every registry glob is SUFFIX-shaped ... so a directory
  # is invisible to all of them". Bare `$REG/*` also costs 3.75 ms against
  # 0.51 ms here — 485 entries, 126 of them leaked `_reg_set` tmp dotfiles.
  #
  # THE ID SET IS `.uuid`, which is the enumeration the SERVER itself uses
  # (`registry.ts` derives the whole fleet id list from
  # `names.filter(n => n.endsWith('.uuid'))`). Globbing `*.project` instead
  # would make a row that carries no `.project` INVISIBLE — but the server
  # gives that row `project ?? id`, so the two sides would enumerate different
  # fleets. `$o` is shape-gated with `$id`'s own class before it is compared or
  # interpolated: with no match at all the glob stays LITERAL, and an ungated
  # `*` reaching a `[[ ]]` comparison is a pattern, not a name.
  for f in "$REG"/*.uuid; do
    o="${f%.uuid}"; o="${o##*/}"
    [[ $o == "$id" ]] && continue
    case "$o" in ''|*[!$CCRC_PROJ_CLASS]*) continue ;; esac
    (( ${#o} <= CCRC_ID_MAX )) || continue
    _ct_read "$REG/$o.project"; rc=$?
    [[ $rc -ne 2 ]] || { CT_U=$(( CT_U + 1 )); continue; }
    [[ -n $CT_V ]] || CT_V="$o"        # the server's own `project ?? id`
    [[ $CT_V == "$me" ]] || continue
    # A ROW WITH NO `.supervised` IS A MEASURED ABSENCE, not an unmeasured row:
    # on this box the 5 rows lacking it are all archived AND stopped. Folding
    # absence into doubt would put "at least" on every card forever.
    _ct_read "$REG/$o.supervised"; rc=$?
    [[ $rc -ne 1 ]] || continue
    if [[ $rc -eq 2 ]]; then CT_U=$(( CT_U + 1 )); continue; fi
    case "$CT_V" in ''|*[!0-9]*) CT_U=$(( CT_U + 1 )); continue ;; esac
    (( now - CT_V >= 0 && now - CT_V < CCRC_FRESH_S )) && CT_N=$(( CT_N + 1 ))
  done
  CT_PROJ="$me"
  return 0
}

# THE CARD SAYS WHAT THE REGISTRY PROVED AND NOTHING MORE. It does not say
# "live" — no local field can. `_swap_beat` re-stamps `.supervised` through a
# whole `cp -a` carry ON PURPOSE, and 6 of 16 rows have been silent over 5 h
# while reading `deliverable:"yes"` to the server. It does not say "share"
# either: the 7 ccrc-pwa rows resolve to 7 distinct workdirs on 6 distinct
# branches — they share a registry string, not a byte on disk. It says
# `supervised rows name project <p>`, which is the literal measurement, and
# hands the session the ONE authority that can answer the rest.
#
# IT PRESCRIBES `peers list`, NOT `claims take`. The 200 that route returns
# carries PEER_ETIQUETTE verbatim, whose rule 0 IS "claim before you edit" — so
# the card points at the authority instead of paraphrasing it. Prescribing the
# claim directly would push every co-tenant at an 8-hour, alarm-invisible wedge
# with no precedence rule (`claimAttempt` never consults `runId`) and no client
# for the release valve. The hook names the CLIENT VERB, never the route, which
# is also what keeps `claims-advisory.test.ts`'s FORBIDDEN scan green.
_hook_ccrc_card() {
  CARD_CCRC=""
  [ -e "$CCRC_CARD_OFF" ] && return 0
  _ct_probe || return 0
  [ "$CT_N" -gt 0 ] || return 0      # SILENCE is the true answer for a lone row
  local n="other supervised rows name" s=""
  [ "$CT_N" -eq 1 ] && n="other supervised row names"
  [ "$CT_U" -eq 0 ] || s="at least "
  CARD_CCRC="ccrc: $s$CT_N $n project \`$CT_PROJ\`; \`~/.local/bin/ccrc-api peers list --of $id\` names them and returns the five peer rules."
  return 0
}
```

- [ ] **Step 5: Join it at the emit site**

Extend Task 3's block:

```bash
    CARD_GRAPH=""; CARD_CCRC=""; CARD=""
    _hook_graph_card || true
    _hook_ccrc_card  || true
    CARD="$CARD_GRAPH"
    [ -z "$CARD_CCRC" ] || CARD="${CARD:+$CARD }$CARD_CCRC"
    [ -z "$CARD" ] || _hook_emit_context "$CARD"
```

- [ ] **Step 6: Run the tests**

```bash
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts
```

Expected: PASS, all of them — including every pre-existing test, unchanged.

- [ ] **Step 7: Run the mutations**

Each of these must turn the named test RED. Apply, run, revert.

| mutation | test that must red |
|---|---|
| swap the heartbeat rung for `[ -e "$REG/$o.archived" ] && continue` | `counts an archived row whose supervisor is still beating` |
| delete the two trim expansions in `_ct_read` | `a trailing space in .project groups exactly as the server does` |
| change `[[ -f "$1" && -r "$1" ]]` to `[[ -r "$1" ]]` | `a directory at a registry path is not read` |
| fold rc 2 into rc 1 (`[[ $rc -ne 2 ]] || continue`) | `an unreadable peer .project ... never folded into absence` |
| delete the `[ -e "$CCRC_CARD_OFF" ]` line | `the operator file silences the subject and nothing else` |
| move `_hook_ccrc_card` inside `_hook_graph_card` | `survives a tree graphify says nothing about` |
| add a second `_hook_emit_context` call for the ccrc subject | `emits exactly one parseable line when both subjects fire` |
| change `CCRC_FRESH_S` to `90` | `the hook, ccd and shared agree on the supervised-freshness window` |

- [ ] **Step 8: Verify zero forks and zero stderr**

```bash
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'costs no stderr'
```

Expected: PASS. The test asserts an empty stderr via `stdio: ['pipe','pipe','pipe']`.

- [ ] **Step 9: Commit**

```bash
git add ccd/session-hook.sh server/test/session-hook.test.ts
git commit -m "feat(hook): the SessionStart card names this project's other supervised rows (R7)

16 of 17 live rows have a co-tenant; 2 have a hold. This is the subject that
reaches the majority, and for the 5 main checkouts — which ccd ws-hold refuses
outright — it is the only thing the card can truthfully say at all.

It says what the registry proved and nothing more. Not 'live': _swap_beat
re-stamps .supervised through a cp -a carry on purpose, and 6 of 16 rows were
silent over 5 h while reading deliverable:yes. Not 'share': 7 rows naming
ccrc-pwa are 7 workdirs on 6 branches. It says 'N other supervised rows name
project <p>' and hands over peers list, whose 200 carries PEER_ETIQUETTE and
whose rule 0 is 'claim before you edit' — pointing at the authority instead of
paraphrasing it, and never prescribing a claim that has no release valve.

The rung is the supervisor heartbeat, never .archived — peers.ts (D9) already
ruled that the stamp decides nothing, and this box has a row carrying it for 33
days beside a 4-second heartbeat.

Zero forks per pass (strace), p50 3.5 ms: the read helper sets a global because
command substitution forks a subshell even around a function (61.9 ms), and the
shape gate is a case glob because bounded regex repetition costs 13-18 ms in a
per-row loop."
```

---

## Task 5: The program (held) subject

**Files:**
- Modify: `ccd/session-hook.sh` — new `_hook_hold_card` after `_hook_ccrc_card`; one constant; the emit site
- Test: `server/test/session-hook.test.ts`

**Interfaces:**
- Consumes: `_ct_read` (Task 4), `CCRC_CARD_OFF` and `CARD_MAX_CHARS` (Task 3), `GM_CWD` (set by `_hook_graph_measure` at `:159`, and already falling back to `$REG/<id>.workdir` at `:156`).
- Produces: `CARD_HOLD`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('the program subject', () => {
  const REG = (): string => path.join(home, '.cc-sessions');
  const hold = (bytes: string): void =>
    fs.writeFileSync(path.join(REG(), 'demo-quiet-basin.hold'), bytes);
  const plain = (): string => {
    const tree = path.join(home, 'tree');
    gitTree(tree, 1);
    plantGraph(tree, { built: 'deadbee' });
    return card(run({ hook_event_name: 'SessionStart', cwd: tree }));
  };

  it('quotes the hold bytes and names the worker skill', () => {
    hold('program:account-pools wave:3/6 run:34');
    const text = plain();
    expect(text).toContain('`program:account-pools wave:3/6 run:34`');
    expect(text).toContain('`ccrc-worker` skill');
    expect(text).toContain('ccrc-api mail list --to demo-quiet-basin');
  });

  it('never narrates the wave or the role', () => {
    hold('program:account-pools wave:3/6 run:34');
    const text = plain();
    expect(text).not.toMatch(/you are on wave|wave 3 of 6|you are the dispatched/i);
  });

  it('says no run placed a suffix-less hold', () => {
    hold('program:account-pools wave:4/6');
    const text = plain();
    expect(text).toContain('names NO run');
    expect(text).not.toContain('mail list --to');
  });

  it('is silent on a free-text operator hold', () => {
    hold('keep — chasing the ccd-session-state flake');
    expect(plain()).not.toContain('ccrc-program:');
  });

  it('is silent on a hold longer than the bound', () => {
    hold(`program:${'x'.repeat(300)} wave:1/2 run:9`);
    expect(plain()).not.toContain('ccrc-program:');
  });

  it('tells unreadable apart from absent', () => {
    hold('program:account-pools wave:3/6 run:34');
    fs.chmodSync(path.join(REG(), 'demo-quiet-basin.hold'), 0o000);
    const text = plain();
    expect(text).toContain('could not be read');
    expect(text).not.toContain('`ccrc-worker` skill');
  });

  it('names an archived row\'s hold as residue, not an assignment', () => {
    hold('program:account-pools wave:3/6 run:34');
    fs.writeFileSync(path.join(REG(), 'demo-quiet-basin.archived'), 'archived=1 reason=merged:#160');
    const text = plain();
    expect(text).toContain('stamped ARCHIVED');
    expect(text).toContain('residue');
    expect(text).not.toContain('Run that skill');
  });

  it('names the workspace by path when the cwd is somewhere else', () => {
    hold('program:account-pools wave:3/6 run:34');
    fs.writeFileSync(path.join(REG(), 'demo-quiet-basin.workdir'), '/elsewhere/tree');
    const text = plain();
    expect(text).toContain('the workspace `demo-quiet-basin`');
    expect(text).not.toContain('this workspace is claimed');
  });

  it('the operator file silences it', () => {
    fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    fs.writeFileSync(path.join(home, '.ccrc', 'ccrc-card-off'), '');
    hold('program:account-pools wave:3/6 run:34');
    expect(plain()).not.toContain('ccrc-program:');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'the program subject'
```

Expected: FAIL on every positive assertion.

- [ ] **Step 3: Add the constant**

Beside `CCRC_FRESH_S`:

```bash
# The hold's own bound. `POST /api/sessions/:id/hold` validates only that the
# reason is a non-blank string and `ccd` only blankness, while `--actor` on the
# same verb IS capped at 512 — so this is the first bound the value meets.
# A hold that fails it is UNSPEAKABLE and the subject is silent.
CCRC_HOLD_MAX=256
```

- [ ] **Step 4: Add the builder**

After `_hook_ccrc_card`:

```bash
# ── THE PROGRAM SUBJECT (R7) ────────────────────────────────────────────
# QUOTE THE BYTES, NEVER NARRATE THE PROGRAM. `rundefs.ts` declares the reason
# string is never parsed back anywhere in this tree; `wave-lifecycle.md` forbids
# inferring a wave from it ("never parse a hold reason to learn what wave you
# are on. Ask `GET /api/runs`") and the coordinator skill forbids inferring a
# role — pinned VERBATIM by `coordinator-skill.test.ts`. So this function
# QUOTES and POINTS: the only thing it derives is WHICH SENTENCE to say.
#
# It is also empirically necessary. One program on this box read 1/5 -> 2/6 ->
# 3/6 -> 4/6 -> 5/7 -> 6/7 -> 7/8 -> 8/9: the denominator was revised upward
# five times, so "wave 3 of 6" would have been wrong five times over.
#
# THE SHAPE GATE IS THE SANITISER TOO. A hold that fails it is unspeakable and
# the subject is silent, which is what closes the ANSI, newline and oversize
# hazards structurally rather than by a clip that a later subject can forget.
# `=~` is affordable here — once per SessionStart, not once per row.
_hook_hold_card() {
  CARD_HOLD=""
  [ -e "$CCRC_CARD_OFF" ] && return 0
  local rc h wd="" subj="this workspace"
  _ct_read "$REG/$id.hold"; rc=$?
  [ "$rc" -eq 1 ] && return 0                      # absent — nothing to say
  if [ "$rc" -eq 2 ]; then                         # unreadable — doubt reads as HELD
    CARD_HOLD="ccrc-program: this workspace is held and the hold's reason could not be read — \`~/.cc-sessions/$id.hold\` exists but is not a readable file. Every other reader on this box treats that as HELD. If a program wave is running here, \`~/.local/bin/ccrc-api runs list\` is the only thing that can say so."
    return 0
  fi
  h="$CT_V"
  (( ${#h} <= CCRC_HOLD_MAX )) || return 0
  [[ "$h" =~ ^program:[A-Za-z0-9._-]+' 'wave:[0-9]+(/[0-9]+)?(' 'run:[0-9]+)?$ ]] || return 0
  # AN ARCHIVE DOES NOT CLEAR A HOLD. `cmd_ws_archive` does no registry rm, and
  # `close.ts`'s failed+archive arm releases nothing, so the bytes outlive the
  # workspace. Live on this box today.
  if [ -e "$REG/$id.archived" ]; then
    CARD_HOLD="ccrc-program: this workspace is stamped ARCHIVED and still carries a claim — \`~/.cc-sessions/$id.hold\` reads \`$h\`. An archive does not clear a hold, so those bytes are the residue of a claim, not an assignment. Take that to the operator rather than starting a wave on it."
    return 0
  fi
  # ONE EMITTED STRING, TWO REFERENTS. The graphify subject measures the
  # payload's cwd; this one measures the tmux session id. A session that cd'd,
  # or a second window opened in `cc-<held-id>`, makes "this workspace" and
  # "this tree" different subjects with no way for the reader to tell — so on
  # disagreement, or when the cwd could not be measured at all, the card names
  # the workspace by path and drops the demonstrative.
  _ct_read "$REG/$id.workdir" && wd="$CT_V"
  if [ -z "${GM_CWD:-}" ] || { [ -n "$wd" ] && [ "$GM_CWD" != "$wd" ]; }; then
    subj="the workspace \`$id\`${wd:+ (\`$wd\`)}"
  fi
  # NO ` run:` SUFFIX means no dispatch placed it: `closeRun`'s non-final arm
  # writes `holdReason(program, wave+1, waveOf, null)` for a run that does not
  # exist yet, and `ledger-template.md` still instructs a hand hold.
  case "$h" in
    *" run:"*) ;;
    *) CARD_HOLD="ccrc-program: $subj is claimed — \`~/.cc-sessions/$id.hold\` reads \`$h\`, which is the \`ccrc-worker\` skill's declared trigger. It names NO run: a close claimed this workspace for a next wave, or a human wrote it by hand — no dispatch placed it. Run \`~/.local/bin/ccrc-api runs list\` before acting on it; whether any run is open, and whether a brief was sent, are answered there and never by this file."
       return 0 ;;
  esac
  CARD_HOLD="ccrc-program: $subj is claimed — \`~/.cc-sessions/$id.hold\` reads \`$h\`, which is the \`ccrc-worker\` skill's declared trigger. Run that skill; its first read is \`~/.local/bin/ccrc-api mail list --to $id\`, and a brief you already acked is not listed again — the plan it named is the durable record. The hold can outlive the run that wrote it: whether that run is still open, and whether any brief was sent, are answered only by \`~/.local/bin/ccrc-api runs list\`, never by this file."
  return 0
}
```

- [ ] **Step 5: Join it at the emit site**

`_hook_graph_card` must run first — it is what sets `GM_CWD`.

```bash
    CARD_GRAPH=""; CARD_HOLD=""; CARD_CCRC=""; CARD=""
    _hook_graph_card || true
    _hook_hold_card  || true
    _hook_ccrc_card  || true
    CARD="$CARD_GRAPH"
    [ -z "$CARD_HOLD" ] || CARD="${CARD:+$CARD }$CARD_HOLD"
    [ -z "$CARD_CCRC" ] || CARD="${CARD:+$CARD }$CARD_CCRC"
    [ -z "$CARD" ] || _hook_emit_context "$CARD"
```

- [ ] **Step 6: Run the tests**

```bash
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts
```

Expected: PASS, all of them.

- [ ] **Step 7: Run the mutations**

| mutation | test that must red |
|---|---|
| delete the `=~` shape gate | `is silent on a free-text operator hold` |
| delete the `${#h} <= CCRC_HOLD_MAX` bound | `is silent on a hold longer than the bound` |
| change `[ "$rc" -eq 2 ]` to fall through to silence | `tells unreadable apart from absent` |
| delete the `.archived` branch | `names an archived row's hold as residue` |
| delete the `GM_CWD`/`wd` comparison | `names the workspace by path when the cwd is somewhere else` |
| make case B fall through to case A | `says no run placed a suffix-less hold` |
| delete `set -- "${1:0:$CARD_MAX_CHARS}"` from Task 3 | `a pathological hold cannot delete the card` — **this is where Task 3 Step 8's deferred mutation finally reds** |

- [ ] **Step 8: Measure the three-subject worst case**

```bash
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'clips the assembled card'
```

Then, by hand, plant a hold **and** two co-tenants in one fixture and print `text.length`. Expected ≤ 1800 with no truncation of the trailing co-tenant sentence — assert the emitted text ends with `peer rules.`

- [ ] **Step 9: Commit**

```bash
git add ccd/session-hook.sh server/test/session-hook.test.ts
git commit -m "feat(hook): the SessionStart card quotes this workspace's hold (R7)

ccd/worker-skill/SKILL.md names \$REG/<id>.hold as its own declared trigger, and
a grep of both skill directories for '.hold' returns zero hits — the corpus
declares a trigger and never says where the file is. This says it.

It QUOTES and never narrates. rundefs.ts declares the reason string is never
parsed back in this tree; wave-lifecycle.md forbids inferring a wave from it and
the coordinator skill forbids inferring a role. The gate decides which sentence
to say and extracts nothing. One program on this box revised its denominator
upward five times, so 'wave 3 of 6' would have been wrong five times over.

Five conditions, five answers: a dispatched shape; a suffix-less hold that names
NO run (closeRun's anticipatory wave+1, or the hand hold ledger-template still
teaches); an unreadable hold, which every other reader on this box treats as
HELD; an archived row whose bytes are residue, not an assignment (live here
today); and a cwd that disagrees with the workspace, where the card drops the
demonstrative rather than let one string carry two referents.

A hold that fails the bounded shape is unspeakable and the subject is silent —
which is what closes the ANSI, newline and oversize hazards structurally, since
neither write door caps the value while --actor on the same verb is capped.

CARRIES TASK 3'S DEFERRED MUTATION. CARD_MAX_CHARS shipped in 23261700 with no
test that reddens when it is deleted, because nothing read a hold yet. The
pathological-hold fixture added here is that test: deleting the clip from
_hook_emit_context now reds `a pathological hold cannot delete the card`. Until
this commit the clip was an unmeasured guard, and that fact lived only in a
session artifact — this is where it enters git."
```

---

## Task 6: The counters

**Files:**
- Modify: `ccd/session-hook.sh` — the regexes (~`:340`), the PostToolUse prefilter (~`:418`), the carry read-back (`:528`), the guards (`:546`), the reset and increments (`:571`), the envelope (`:713`)
- Test: `server/test/session-hook.test.ts`

**Interfaces:**
- Produces: hookstate fields `ccrcPeerReads` and `ccrcClaims`. Task 1's carrier reads them as `cp`/`cc`. `server/src/hookstate.ts` needs **no** change — `readHookStateMeasured` validates named keys and returns an object literal built from those names, with no `Object.keys`, no `additionalProperties` check and no key census, so an unknown key is never looked at. This is the R6 precedent (PR #58 added an emitter and changed no wire field).

- [ ] **Step 1: Write the failing tests**

```ts
describe('the R7 counters', () => {
  const bash = (command: string): void => {
    run({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command } });
  };

  it('counts the spelling the fleet actually uses, not the one it reads', () => {
    run({ hook_event_name: 'SessionStart', source: 'startup' });
    bash('API="$HOME/.local/bin/ccrc-api"; "$API" peers list --of demo');
    expect(readState().ccrcPeerReads).toBe(1);
  });

  it('does not count prose or a lookalike', () => {
    run({ hook_event_name: 'SessionStart', source: 'startup' });
    bash('ls | grep peers');
    bash('echo speers listing');
    expect(readState().ccrcPeerReads).toBe(0);
  });

  it('counts a programless claim apart from a peer read', () => {
    run({ hook_event_name: 'SessionStart', source: 'startup' });
    bash('~/.local/bin/ccrc-api claims take --json -');
    const s = readState();
    expect(s.ccrcClaims).toBe(1);
    expect(s.ccrcPeerReads).toBe(0);
  });

  it('resets on a new context and is kept across resume', () => {
    run({ hook_event_name: 'SessionStart', source: 'startup' });
    bash('ccrc-api peers list --of demo');
    expect(readState().ccrcPeerReads).toBe(1);
    run({ hook_event_name: 'SessionStart', source: 'resume' });
    expect(readState().ccrcPeerReads).toBe(1);
    run({ hook_event_name: 'SessionStart', source: 'clear' });
    expect(readState().ccrcPeerReads).toBe(0);
  });

  it('carries both counters across an ordinary event', () => {
    run({ hook_event_name: 'SessionStart', source: 'startup' });
    bash('ccrc-api peers list --of demo');
    bash('ccrc-api claims take --json -');
    bash('ls');
    const s = readState();
    expect(s.ccrcPeerReads).toBe(1);
    expect(s.ccrcClaims).toBe(1);
  });

  it('survives a non-numeric carried value', () => {
    run({ hook_event_name: 'SessionStart', source: 'startup' });
    const f = stateFile();
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    j.ccrcPeerReads = 'seven';
    fs.writeFileSync(f, JSON.stringify(j));
    bash('ls');
    expect(readState().ccrcPeerReads).toBe(0);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'the R7 counters'
```

Expected: FAIL — `readState().ccrcPeerReads` is `undefined`.

- [ ] **Step 3: Add the regexes**

Beside `GRAPH_QUERY_RE`:

```bash
# ── R7: what counts as ACTING ON THE CARD ───────────────────────────────
# ANCHORED ON THE VERB PAIR, NEVER ON THE CLIENT'S NAME. Both skills teach
# `API="$HOME/.local/bin/ccrc-api"` and then call `"$API" peers list`
# (coordinator-skill/references/peer-protocol.md), and this hook reads the
# UNEXPANDED command text — so a regex anchored on `ccrc-api` scores ZERO on
# every call the fleet actually makes, and looks perfectly healthy doing it.
# The leading class stops `speers list` and prose; the trailing one stops
# `peers listing`.
CCRC_PEERS_RE='(^|[;&|[:space:]])peers[[:space:]]+list([[:space:]]|$)'
CCRC_CLAIMS_RE='(^|[;&|[:space:]])claims[[:space:]]+take([[:space:]]|$)'
```

- [ ] **Step 4: Widen the prefilter on two-word phrases**

```bash
-    if [[ "$payload" == *graphify* ]]; then
+    # R7 adds TWO-WORD phrases, not two words. Measured: a single-word
+    # `*claims*` prefilter costs an extra jq fork on any payload merely
+    # mentioning the word (p50 42 ms vs 33 ms); the phrases cost nothing
+    # measurable. A line that runs them cannot fail to carry them literally.
+    if [[ "$payload" == *graphify* || "$payload" == *"peers list"* \
+       || "$payload" == *"claims take"* ]]; then
```

- [ ] **Step 5: Extend the carry read-back — still ONE fork**

D-1249's positional rule binds: the new fields go in the **middle**, never after `subs`, and `hs_unreadable` still probes `gq` as the first numeric line.

```bash
subs=""; prev_state=""; gq=""; gd=""; cp=""; cc=""
{ read -r prev_state; read -r gq; read -r gd; read -r cp; read -r cc; read -r subs; } < <(jq -r \
  '(.state // ""),
   (if (.graphQueries | type) == "number" then (.graphQueries | floor) else 0 end),
   (if (.graphGateDenials | type) == "number" then (.graphGateDenials | floor) else 0 end),
   (if (.ccrcPeerReads | type) == "number" then (.ccrcPeerReads | floor) else 0 end),
   (if (.ccrcClaims | type) == "number" then (.ccrcClaims | floor) else 0 end),
   (.subagents // [] | tostring)' \
  "$f" 2>/dev/null)
```

- [ ] **Step 6: Add the guards and the increments**

After `[[ "$gd" =~ ^[0-9]+$ ]] || gd=0`:

```bash
[[ "$cp" =~ ^[0-9]+$ ]] || cp=0
[[ "$cc" =~ ^[0-9]+$ ]] || cc=0
```

Extend the reset line and add the two increments:

```bash
# R7's counters reset with R4's and for D-1248's exact reason: the card is
# emitted once per new context, so a counter carried across a `/clear` would
# credit context N+1's card with context N's act.
if [[ "$event" == SessionStart && "$src" != resume ]]; then gq=0; gd=0; cp=0; cc=0; fi
if [[ -n "$gcmd" && "$gcmd" =~ $GRAPH_QUERY_RE ]]; then gq=$((gq + 1)); fi
# THE PROXIMATE ACT and THE DISTAL ONE, counted apart. `peers list` is the act
# the co-tenant card prescribes; `claims take` is what that answer's own rule 0
# prescribes next, and it is the one with a durable server-side arbiter.
if [[ -n "$gcmd" && "$gcmd" =~ $CCRC_PEERS_RE  ]]; then cp=$((cp + 1)); fi
if [[ -n "$gcmd" && "$gcmd" =~ $CCRC_CLAIMS_RE ]]; then cc=$((cc + 1)); fi
```

- [ ] **Step 7: Extend the envelope**

```bash
   --argjson graphGateDenials "$gd" \
+  --argjson ccrcPeerReads "$cp" --argjson ccrcClaims "$cc" \
   '{v:$v, state:$state, event:$event, sessionId:$sessionId, pid:$pid,
     updatedAt:$updatedAt, ask:$ask, subagents:$subagents, graphQueries:$graphQueries,
-    graphGateDenials:$graphGateDenials}
+    graphGateDenials:$graphGateDenials, ccrcPeerReads:$ccrcPeerReads,
+    ccrcClaims:$ccrcClaims}
    + (if $interrupted then {interrupted:true} else {} end)') || exit 0
```

`v` stays `1`. Do not touch it.

- [ ] **Step 8: Run the tests**

```bash
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts
cd server && ./node_modules/.bin/vitest run test/hookstate.test.ts
```

Expected: both PASS. `hookstate.test.ts` must be green **unchanged** — that is the proof the extra keys cost the server nothing.

- [ ] **Step 9: Run the mutations**

| mutation | test that must red |
|---|---|
| change `CCRC_PEERS_RE` to `ccrc-api[[:space:]]+peers` | `counts the spelling the fleet actually uses` |
| drop the leading `(^\|[;&\|[:space:]])` from `CCRC_PEERS_RE` | `does not count prose or a lookalike` |
| move `cp`/`cc` after `subs` in the read-back | `carries both counters across an ordinary event` |
| delete `[[ "$cp" =~ ^[0-9]+$ ]] \|\| cp=0` | `survives a non-numeric carried value` |
| drop `cp=0; cc=0` from the reset line | `resets on a new context and is kept across resume` |

- [ ] **Step 10: Commit**

```bash
git add ccd/session-hook.sh server/test/session-hook.test.ts
git commit -m "feat(hook): count acting on the card, proximate and distal (R7)

Tests pin shape, not effect; a green mutation-proof suite can guard a mechanism
that does nothing. ccrcPeerReads counts the act the co-tenant card prescribes,
ccrcClaims the act that answer's own rule 0 prescribes next — the one with a
durable server-side arbiter and a measured baseline of 0 programless claims in
the whole life of the table.

ANCHORED ON THE VERB PAIR, NEVER THE CLIENT'S NAME. Both skills teach
API=\"\$HOME/.local/bin/ccrc-api\" and then call \"\$API\" peers list, and this
hook reads the UNEXPANDED command text — a regex anchored on ccrc-api scores
ZERO on every call the fleet actually makes and looks healthy doing it.

The prefilter widens on two-word PHRASES, not words: a single-word *claims*
prefilter costs an extra jq fork on any payload merely mentioning it (p50 42 ms
vs 33 ms); the phrases cost nothing measurable.

D-1249's positional rule obeyed — both fields sit in the middle of the carry
read-back, never after subs, and it is still one fork. hookstate.ts needs no
change and hookstate.test.ts is green unchanged: readHookStateMeasured builds an
object literal from named keys and never looks at an unknown one (the R6
precedent). v stays 1."
```

---

## Task 7: Pin the SessionStart arm's cost

The repo's only timing assertion drives PostToolUse — the cheapest arm. The arm this work slows has never been timed, and it was measured at 146 ms under load against a 150 ms allowance.

**Files:**
- Test: `server/test/session-hook.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 3–6.

- [ ] **Step 1: Write the test**

```ts
it('p95 of 20 SessionStart runs stays under the budget with a 200-row registry', () => {
  const reg = path.join(home, '.cc-sessions');
  const now = Math.floor(Date.now() / 1000);
  for (let i = 0; i < 200; i++) {
    const id = `row-${i}`;
    fs.writeFileSync(path.join(reg, `${id}.uuid`), `uuid-${id}`);
    fs.writeFileSync(path.join(reg, `${id}.project`), i < 40 ? 'alpha' : `proj-${i}`);
    fs.writeFileSync(path.join(reg, `${id}.supervised`), String(now - 5));
  }
  // 120 leaked _reg_set-shaped dotfiles: the glob must not see them.
  for (let i = 0; i < 120; i++) fs.writeFileSync(path.join(reg, `.tmp-${i}`), 'x');
  fs.writeFileSync(path.join(reg, 'demo-quiet-basin.uuid'), 'uuid-1');
  fs.writeFileSync(path.join(reg, 'demo-quiet-basin.project'), 'alpha');
  fs.writeFileSync(path.join(reg, 'demo-quiet-basin.supervised'), String(now - 5));

  const tree = path.join(home, 'tree');
  gitTree(tree, 1);
  plantGraph(tree, { built: 'deadbee' });

  const times: number[] = [];
  for (let i = 0; i < 20; i++) {
    const t0 = process.hrtime.bigint();
    run({ hook_event_name: 'SessionStart', cwd: tree, source: 'startup' });
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  times.sort((a, b) => a - b);
  expect(times[Math.floor(times.length * 0.95) - 1]).toBeLessThan(150);
});
```

- [ ] **Step 2: Run it**

```bash
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'p95 of 20 SessionStart'
```

Expected: PASS. If it fails on a loaded box, re-run in isolation before treating it as real — this file is on the known-flake list.

- [ ] **Step 3: Verify it is load-bearing (mutation)**

Replace the two `case` shape gates in `_ct_probe` with `[[ $me =~ ^[A-Za-z0-9._-]{1,64}$ ]]` and `[[ $o =~ ^[A-Za-z0-9._-]{1,128}$ ]]`, re-run.

Expected: the p95 assertion goes RED (bounded repetition over 200 rows). Revert.

- [ ] **Step 4: Commit**

```bash
git add server/test/session-hook.test.ts
git commit -m "test(hook): the SessionStart arm gets its own p95 budget, on a 200-row registry

The file's only timing assertion drove PostToolUse — the cheapest arm, with no
card, no git and no cwd jq. The arm this work slows was unguarded and has been
measured at 146 ms under a load spike against a 150 ms allowance.

The fixture is 200 rows plus 120 leaked _reg_set-shaped dotfiles, because the
probe is O(rows) and the 2-row correctness fixtures cannot see growth. Replacing
either case shape gate with a bounded-repetition ERE reds it — which is the
mutation that made this test worth writing."
```

---

## Task 8: The hold moves above the `/clear`

`dispatch.ts` sends the `/clear` and writes the hold at step 5, so the SessionStart that `/clear` triggers fires **before** the wave's hold exists: wave 1 sees no hold, wave N sees wave N−1's bytes. Operator-ruled (2026-09-07).

**Files:**
- Modify: `server/src/coord/dispatch.ts` (the `sendPrompt('/clear')` call and the step-5 `ws-hold` block)
- Test: `server/test/dispatch-hold-order.test.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks. Independent of the hook.

- [ ] **Step 1: Read the current order**

```bash
grep -n "sendPrompt\|wsHold\|holdArgv\|clearedAt" server/src/coord/dispatch.ts | head -20
```

Confirm: the `/clear` `sendPrompt` precedes the `CCD_ARGV.wsHold` block.

- [ ] **Step 2: Write the failing test**

Create `server/test/dispatch-hold-order.test.ts`:

```ts
// The card R7 emits quotes `$REG/<id>.hold`. dispatch's `/clear` fires a
// SessionStart, so a hold written AFTER it means the card quotes the PREVIOUS
// wave's bytes — wave 1 sees none at all. This pins the order.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '../src/coord/dispatch.ts');

describe('dispatch places the hold before it clears the pane', () => {
  it('the ws-hold call site precedes the /clear sendPrompt', () => {
    const src = fs.readFileSync(SRC, 'utf8');
    const hold = src.indexOf('CCD_ARGV.wsHold');
    const clear = src.indexOf("'/clear'");
    expect(hold, 'no CCD_ARGV.wsHold call site found').toBeGreaterThan(-1);
    expect(clear, "no '/clear' sendPrompt found").toBeGreaterThan(-1);
    expect(hold, 'the hold must be placed before the pane is cleared, so the ' +
      'SessionStart the /clear fires can read this wave\'s bytes').toBeLessThan(clear);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

```bash
cd server && ./node_modules/.bin/vitest run test/dispatch-hold-order.test.ts
```

Expected: FAIL — the hold index is greater than the clear index.

- [ ] **Step 4: Move the hold block**

Move the entire step-5 block — the comment, `const holdArgv = CCD_ARGV.wsHold(...)`, the `verbSupported` guard, and the `runCcd`/`holdRes` check — to sit immediately **before** the `const clearRes = await sendPrompt(...)` line. Renumber the step comments and add:

```ts
  // R7: THE HOLD IS PLACED BEFORE THE PANE IS CLEARED. The `/clear` fires a
  // SessionStart, and the card that SessionStart emits quotes
  // `$REG/<id>.hold` — so a hold written after it would have the card quote
  // the PREVIOUS wave's bytes, and wave 1 would see none at all. The refusal
  // shapes are unchanged and the ordering costs nothing: a failed `ws-hold`
  // already returned before the transaction with the `/clear` sent, so this
  // strictly reduces the window in which that happens.
```

- [ ] **Step 5: Run it to verify it passes**

```bash
cd server && ./node_modules/.bin/vitest run test/dispatch-hold-order.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run the dispatch and run-route suites**

```bash
cd server && ./node_modules/.bin/vitest run test/dispatch.test.ts test/run-routes.test.ts
```

Expected: PASS. If a test asserts on call ORDER through the fleet-act mock, update it to the new order and say so in the commit body.

- [ ] **Step 7: Commit**

```bash
git add server/src/coord/dispatch.ts server/test/dispatch-hold-order.test.ts
git commit -m "fix(dispatch): place the wave's hold before clearing the pane

The /clear fires a SessionStart, and R7's card quotes \$REG/<id>.hold — so with
the hold written afterwards the card quoted the PREVIOUS wave's bytes on every
wave N>=2, and wave 1 saw no hold at all. Under 'quote what you measured' that
is a defect rather than a rounding error.

The ordering costs nothing it did not already cost: a failed ws-hold already
returned before the transaction with the /clear sent, so this strictly reduces
that window. Pinned by dispatch-hold-order, which reds on the old order."
```

---

## Task 9: Docs, deploy agent-first, and verify on the fleet

**Files:**
- Modify: `README.md`
- Deploy: agent lane, then server lane

**Interfaces:**
- Consumes: Tasks 1–8. **Task 1 Step 10 must read ≥20 before starting this task.**

- [ ] **Step 1: Update README**

In the SessionStart-card section, add: both subjects and what each may and may not say; `~/.ccrc/ccrc-card-off`; `CARD_MAX_CHARS`; the two counters and what act each counts; and the `~/.local/bin/graph-gate-snapshot` carrier as the reading's instrument.

- [ ] **Step 2: Run the full server suite**

```bash
cd server && ./node_modules/.bin/vitest run
```

Expected: PASS. Re-run any of the known load flakes in isolation before treating a failure as real.

- [ ] **Step 3: Confirm the branch is current**

```bash
git fetch origin main
git rev-list --count HEAD..origin/main
```

Expected: 0. If not, rebase before deploying — a stale tree reverts R6 and pools 2a on ~17 live sessions.

- [ ] **Step 4: Record the pre-deploy fingerprint**

```bash
diff <(git show origin/main:ccd/session-hook.sh) ~/.cc-sessions/session-hook.sh && echo IDENTICAL
tail -1 ~/.ccrc/graph-gate-readings.jsonl | jq -c 'del(.sessions)'
```

- [ ] **Step 5: Deploy the agent lane first**

```bash
bash deploy/deploy.sh agent
```

- [ ] **Step 6: Verify on the fleet host, read-only**

```bash
diff ccd/session-hook.sh ~/.cc-sessions/session-hook.sh && echo INSTALLED
systemctl --user list-units 'claude-session@*' --no-legend | wc -l
~/.local/bin/ccrc-api claims list --all 1 | jq '.claims|length'
```

Expected: identical; the unit count unchanged from before the deploy; the claims read answers.

- [ ] **Step 7: Deploy the server lane**

```bash
bash deploy/deploy.sh
curl -sS "$(grep -E '^\s*CCRC_SERVER_URL=' ~/.ccrc/agent.env | cut -d= -f2- | tr -d '[:space:]')/health" | jq -c '{sha:.build.sha}'
```

Expected: the sha matches the deployed commit.

- [ ] **Step 8: Watch the first cards land**

```bash
sleep 900
tail -1 ~/.ccrc/graph-gate-readings.jsonl | jq -c 'del(.sessions)'
```

Expected: `nullPeerRead` falling below the row count as sessions take their next SessionStart. That fall — not any counter value — is what proves the hook shipped.

- [ ] **Step 9: Verify the kill-switch works before trusting the card**

```bash
touch ~/.ccrc/ccrc-card-off
# confirm on one session's next SessionStart that no `ccrc:` / `ccrc-program:` subject appears
rm ~/.ccrc/ccrc-card-off
```

- [ ] **Step 10: Commit and open the PR**

```bash
git add README.md
git commit -m "docs(readme): the SessionStart card's two ccrc subjects, its kill-switch and its counters"
```

PR body: the measured baseline from `## Baseline recorded`, the deploy order, and the date the 7-day reading falls due.

---

## Baseline recorded

*(Filled in by Task 1 Step 9, Task 2 Step 5 and Task 9 Step 4 — this section is the plan's own record and travels with it.)*

- Carrier fixed at: **2026-09-07T13:53Z** · readings lost before the fix: **10** (00:07Z-09:07Z on 2026-09-07, every fire before that day's first graphify query)
- Reproduction, old script vs new, on a zero-query day: **old rc=2, jq error, 0 lines added; new rc=0, 1 line added, `queriesToday:0`**
- Pre-deploy roll-up (the reading at **13:53:50Z** — NOT the 13:53:58Z line, which is the Step 8 mutation artifact written with the log emptied):
  `{"ts":"2026-09-07T13:53:50Z","gateOff":false,"queriesToday":66,"denied":5,"zeroQuery":3,"peerRead":0,"claimed":0,"nullPeerRead":23,"heldN":2,"coTenantN":15,"liveN":17}`
  `nullPeerRead:23` = every row, no field: the proof the hook has not shipped. Its fall is the proof it has.
- Claims history: rows **34** · programless **0** · holders **10** · projects **ccrc-pwa, expoAI-assistant, MekWarLive**
  Measured 2026-09-07 pre-deploy by raw HTTP against the live server (`GET /api/claims?all=1`, box token),
  because the installed client predates Task 2's `all` key and still refuses `--all`. Re-take it through
  `ccrc-api claims list --all 1` after the agent-lane deploy; the figures must match or the deploy changed
  something it should not have. **programless 0 is the falsification** — no session has ever coordinated
  outside a program run.
- Fleet census at deploy: rows _(n)_ · archived _(n)_ · live _(n)_ · held _(n)_ · with a co-tenant _(n)_
- Installed-hook fingerprint before deploy: _(IDENTICAL / differs)_

## Deviations found

*(Empty by construction. When a deviation is found during execution, `POST /api/ledger/deviations` mints exactly the count needed and it is DEFINED here in the same act. Never take a number from `GET /api/ledger`'s `floor` — that is what the next POST would mint, not a number you may use. If the allocator is unreachable, write `D-TBD-<slug>` and report it.)*

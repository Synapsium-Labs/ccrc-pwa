# Workspace Holds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A declared hold on a workspace survives PR merges — the merge-gated auto-archive skips it, destructive verbs refuse it, PR lineage accumulates across waves, and every surface shows why.

**Architecture:** One registry file (`$REG/<id>.hold`, the reason string verbatim) written by two new idempotent ccd verbs; `archiveMerged`'s gate becomes *merged AND unheld*; the one existing `prnumber` write chokepoint (pr-state's python) appends the outgoing record to an append-only `<id>.prhistory` before overwriting; `ws-archive` folds that history into its manifest. `held` rides the wire as one additive field; the PWA gets a chip and Hold/Release sheet actions. The program-ledger handoff is a documented convention, not code.

**Tech Stack:** bash + python3 heredoc (ccd), TypeScript ESM (Fastify server, React PWA), vitest. ccd tested via the existing `makeCcdHarness` fixture-HOME harness (`server/test/ccdWsHelpers.ts`).

## Global Constraints (from the spec, verbatim where quoted)

- **Fail-shut polarity:** where present-but-unreadable can be distinguished from absent (ccd's own verbs: `[[ -e ]]` vs readable), an unreadable hold file reads as **held**. Server-side `FleetIO.readFile` cannot distinguish error from absence; absence is *release* (the file is unlinked), so null → unheld is correct there — say so in a comment, honestly, rather than claiming a polarity the IO layer cannot provide.
- **No timeout, no expiry.** "A silent expiry that re-enables auto-archive is exactly the surprise this design exists to prevent."
- **Workspace-only.** A main checkout refuses `ws-hold`: "nothing ever auto-archives it, so a hold there is a lie waiting to confuse someone." Hold on an archived workspace refuses: restore first.
- **The bucket ladder is unchanged.** A held workspace never acquires `archivedAt`, so it never reaches `cleanup`/`archived`. Only `archiveMerged`'s gate changes; nothing re-derives.
- **One chokepoint** writes prhistory — the single place `prnumber` is replaced. No sweep-timing dependence.
- The reason string IS the display. No parsing, anywhere.
- Idempotence: re-hold updates the reason; re-release is a no-op; both exit 0.
- Every refusal is named; sentences live beside their classifiers.
- Zero new agent whitelist grants. The only new argv surface is the two verbs.
- Run ALL verification FOREGROUND in single blocking calls (server suite ~200 s, timeout ≥600000 ms); report REAL printed counts. Never background a suite.
- **Rollout order: agent first** (this ships ccd), then server+PWA.

**Branch:** one PR, `feat/workspace-hold`, from current main. The orchestrator merges and deploys.

---

### Task 1: `ws-hold` / `ws-release` verbs

**Files:**
- Modify: `ccd/ccd` (new `cmd_ws_hold` + `cmd_ws_release` beside `cmd_ws_archive` ~line 1307; dispatch table ~line 6439; usage string ~line 6446; `cmd_caps` verb list ~line 1263)
- Test: `server/test/ccd-hold.test.ts` (new)

**Interfaces:**
- Consumes: `_reg_get`/`_reg_set` (ccd:98-99), `die`, `$REG`.
- Produces: `ccd ws-hold --session <id> --reason <text>` → writes `$REG/<id>.hold`, echoes `held <id>: <text>`; `ccd ws-release --session <id>` → unlinks, echoes `released <id>` (or `not held <id>` when already absent). Both exit 0 on their idempotent paths. Tasks 2–5 rely on the file `$REG/<id>.hold` existing iff held, containing the reason verbatim.

- [ ] **Step 1: Write the failing tests**

Create `server/test/ccd-hold.test.ts`, copying the harness idiom from `server/test/ccd-archive.test.ts` (imports, `beforeEach`/`afterEach`, `shFail`):

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, WS_ADD, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-hold-'); });
afterEach(() => { h.cleanup(); });

const shFail = (snippet: string): { code: number; stderr: string } => {
  try { h.sh(snippet); return { code: 0, stderr: '' }; }
  catch (e) {
    const err = e as { status?: number; stderr?: Buffer };
    return { code: err.status ?? 1, stderr: String(err.stderr ?? '') };
  }
};

describe('ccd ws-hold / ws-release', () => {
  it('holds a workspace: writes the reason verbatim', () => {
    h.sh(`${WS_ADD}; cmd_ws_add demo`);
    const id = h.wsId('demo');
    const out = h.sh(`cmd_ws_hold --session ${id} --reason "program:agent-evals wave:1/4"`);
    expect(out).toContain(`held ${id}`);
    expect(fs.readFileSync(path.join(h.home, '.cc-sessions', `${id}.hold`), 'utf8'))
      .toBe('program:agent-evals wave:1/4');
  });

  it('re-hold updates the reason in place, exit 0', () => {
    h.sh(`${WS_ADD}; cmd_ws_add demo`);
    const id = h.wsId('demo');
    h.sh(`cmd_ws_hold --session ${id} --reason "wave:1/4"`);
    h.sh(`cmd_ws_hold --session ${id} --reason "wave:2/4"`);
    expect(fs.readFileSync(path.join(h.home, '.cc-sessions', `${id}.hold`), 'utf8')).toBe('wave:2/4');
  });

  it('release unlinks; releasing an unheld workspace is a no-op at exit 0', () => {
    h.sh(`${WS_ADD}; cmd_ws_add demo`);
    const id = h.wsId('demo');
    h.sh(`cmd_ws_hold --session ${id} --reason "w"`);
    expect(h.sh(`cmd_ws_release --session ${id}`)).toContain(`released ${id}`);
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', `${id}.hold`))).toBe(false);
    expect(h.sh(`cmd_ws_release --session ${id}`)).toContain(`not held ${id}`);
  });

  it('refuses a main checkout — a hold there is a lie', () => {
    // A registry entry with no `workspace` field is a main checkout.
    h.sh(`mkdir -p "$HOME/.cc-sessions"
      printf u > "$HOME/.cc-sessions/claude-demo.uuid"
      printf claude > "$HOME/.cc-sessions/claude-demo.wrapper"`);
    const r = shFail(`cmd_ws_hold --session claude-demo --reason w`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('not a workspace');
  });

  it('refuses an archived workspace — restore first', () => {
    h.sh(`${WS_ADD}; cmd_ws_add demo`);
    const id = h.wsId('demo');
    h.sh(`printf 1786000000 > "$HOME/.cc-sessions/${id}.archived"`);
    const r = shFail(`cmd_ws_hold --session ${id} --reason w`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('archived');
  });

  it('refuses an empty reason — a hold nobody can explain is an orphan by construction', () => {
    h.sh(`${WS_ADD}; cmd_ws_add demo`);
    const id = h.wsId('demo');
    const r = shFail(`cmd_ws_hold --session ${id} --reason ""`);
    expect(r.code).not.toBe(0);
  });

  it('caps lists both verbs', () => {
    const caps = h.sh('cmd_caps');
    expect(caps).toContain('ws-hold');
    expect(caps).toContain('ws-release');
  });
});
```

Check `ccdWsHelpers.ts` for the exact `wsId`/`WS_ADD` helper names before writing; if `h.wsId` does not exist, derive the id the way `ccd-archive.test.ts` does and use that idiom instead — the harness, not this plan, is the authority on its own API.

- [ ] **Step 2: Run to verify failure**

Run: `cd server && npx vitest run test/ccd-hold.test.ts`
Expected: FAIL — `cmd_ws_hold: command not found` inside the harness shell.

- [ ] **Step 3: Implement the verbs**

In `ccd/ccd`, directly above `cmd_ws_archive` (~line 1307):

```bash
cmd_ws_hold() {   # ccd ws-hold --session <id> --reason <text> — claim a
  # workspace for an active program. The ONE input the merge-gated auto-archive
  # was missing: an idle agent between waves is indistinguishable from a
  # finished one, so the claim is DECLARED, never inferred. Non-destructive and
  # idempotent: re-hold updates the reason. The reason string is the display
  # everywhere — write it verbatim, parse it nowhere.
  [[ $# -eq 4 && $1 == --session && $3 == --reason ]] \
    || die "usage: ccd ws-hold --session <id> --reason <text>"
  local id=$2 reason=$4
  [[ $id =~ ^[A-Za-z0-9._-]+$ ]] || die "bad session id"
  [[ -f "$REG/$id.uuid" ]]       || die "no such session: $id"
  # An empty reason is an orphan hold by construction — nobody could ever say
  # why it exists, and "visible on every surface, reason says why" is the whole
  # deal that makes no-expiry acceptable.
  [[ -n "$reason" ]] || die "empty reason — say which program holds this"
  [[ -n "$(_reg_get "$id" workspace)" ]] \
    || die "$id is not a workspace — nothing ever auto-archives a main checkout, so a hold there is a lie waiting to confuse someone"
  [[ -f "$REG/$id.archived" ]] \
    && die "$id is archived — restore first: a hold cannot protect a pane that is already gone"
  _reg_set "$id" hold "$reason"
  echo "held $id: $reason"
}

cmd_ws_release() {   # ccd ws-release --session <id> — end the program's claim.
  # After this, the very next archiveMerged sweep may archive a merged
  # workspace — the level re-arms itself, no edge to miss. Idempotent.
  [[ $# -eq 2 && $1 == --session ]] || die "usage: ccd ws-release --session <id>"
  local id=$2
  [[ $id =~ ^[A-Za-z0-9._-]+$ ]] || die "bad session id"
  [[ -f "$REG/$id.uuid" ]]       || die "no such session: $id"
  if [[ -e "$REG/$id.hold" ]]; then
    rm -f -- "$REG/$id.hold"
    echo "released $id"
  else
    echo "not held $id"
  fi
}
```

Then three registrations:
1. Dispatch table (~line 6439): `ws-hold) shift; cmd_ws_hold "$@" ;;` and `ws-release) shift; cmd_ws_release "$@" ;;` beside `ws-archive`.
2. Usage string (~line 6446): add `ws-hold|ws-release` into the brace list.
3. `cmd_caps` (~line 1263): add `ws-hold` and `ws-release` lines wherever the sibling ws-verbs are listed.
4. The registry field inventory comment (~ccd:118) gains `hold` in its alphabetical list — that comment is the schema record.

- [ ] **Step 4: Run to verify pass**

Run: `cd server && npx vitest run test/ccd-hold.test.ts`
Expected: PASS, 7/7.

- [ ] **Step 5: Commit**

```bash
git add ccd/ccd server/test/ccd-hold.test.ts
git commit -m "feat(ccd): ws-hold / ws-release — a declared program claim on a workspace"
```

---

### Task 2: `held` refusal rung in `ws-rm` and `ws-reap`

**Files:**
- Modify: `ccd/ccd` (`cmd_ws_rm` ~line 1027, after the workspace/registry checks; `cmd_ws_reap` ~line 4170, as an early rung before any teardown phase)
- Test: `server/test/ccd-hold.test.ts` (extend)

**Interfaces:**
- Consumes: `$REG/<id>.hold` (Task 1).
- Produces: both destructive verbs refuse with the word `held` and the reason in the message. "Destroying a workspace that is by declaration mid-program takes two deliberate acts (release, then reap), not one."

- [ ] **Step 1: Write the failing tests**

Append to `server/test/ccd-hold.test.ts`:

```ts
describe('held is a refusal rung on the destructive verbs', () => {
  it('ws-rm refuses a held workspace, naming the reason', () => {
    h.sh(`${WS_ADD}; cmd_ws_add demo`);
    const id = h.wsId('demo');
    h.sh(`cmd_ws_hold --session ${id} --reason "program:x wave:2/4"`);
    const r = shFail(`cmd_ws_rm ${id}`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('held');
    expect(r.stderr).toContain('program:x wave:2/4');
    // And nothing was torn down: the worktree is still there.
    const workdir = h.sh(`_reg_get ${id} workdir`).trim();
    expect(fs.existsSync(workdir)).toBe(true);
  });

  it('ws-rm proceeds again after release', () => {
    h.sh(`${WS_ADD}; cmd_ws_add demo`);
    const id = h.wsId('demo');
    h.sh(`cmd_ws_hold --session ${id} --reason w`);
    h.sh(`cmd_ws_release --session ${id}`);
    // Whatever ws-rm does next is Task-agnostic — the pin is only that it gets
    // PAST the held rung: the refusal, if any, must not be `held`.
    const r = shFail(`cmd_ws_rm ${id}`);
    expect(r.stderr).not.toContain('held');
  });

  it('ws-reap refuses a held workspace before any phase runs', () => {
    h.sh(`${WS_ADD}; cmd_ws_add demo`);
    const id = h.wsId('demo');
    h.sh(`cmd_ws_hold --session ${id} --reason "program:x"`);
    const r = shFail(`cmd_ws_reap --expect whatever --session ${id}`);
    expect(r.code).not.toBe(0);
    expect(r.stderr + h.lastStdout).toContain('held');
    // No reaping breadcrumb was written — the refusal fired before phase (c).
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', `${id}.reaping`))).toBe(false);
  });
});
```

`h.lastStdout`: `cmd_ws_reap` emits its refusals as JSON on **stdout** (`_reap_refuse`, ccd:3294) — check how `ccd-reap` tests capture refusals and mirror that; if refusals land on stdout, assert there. The harness's existing reap tests (`server/test/ccd-*reap*.test.ts`) are the authority.

- [ ] **Step 2: Run to verify failure**

Run: `cd server && npx vitest run test/ccd-hold.test.ts`
Expected: the three new tests FAIL (no `held` rung yet).

- [ ] **Step 3: Implement the rungs**

In `cmd_ws_rm`, immediately after the `incomplete registry` check (~line 1034):

```bash
  # A hold is a declaration that a program is mid-flight here. Destroying the
  # workspace should take two deliberate acts — release, then remove — never
  # one. The reason is echoed so the operator knows WHICH program refuses.
  if [[ -e "$REG/$id.hold" ]]; then
    die "held: $(cat "$REG/$id.hold" 2>/dev/null || echo '<unreadable — treat as held>') — release first: ccd ws-release --session $id"
  fi
```

In `cmd_ws_reap`, as an early rung before any phase or breadcrumb write (find the first refusal rung in the function and place this above it, matching the surrounding refusal idiom — `_reap_refuse held "<detail>"` if that is the house style there, `die` only if plain refusals in that function use it):

```bash
  # Same rung as ws-rm, same reason: reaping a held workspace must take a
  # release first. `-e` not `-f`: an unreadable-but-present hold still refuses
  # — the fail-shut polarity is that doubt reads as HELD.
  if [[ -e "$REG/$id.hold" ]]; then
    _reap_refuse held "workspace is held ($(cat "$REG/$id.hold" 2>/dev/null || echo 'unreadable')) — release first: ccd ws-release --session $id"
    return 1
  fi
```

**Match the function's own refusal mechanism** — read `cmd_ws_reap`'s existing rungs first; if `_reap_refuse` takes different arguments than shown, follow the real signature. The `-e` (not `-f`, not `-r`) check is the polarity constraint made real: present-but-unreadable refuses.

- [ ] **Step 4: Run to verify pass**

Run: `cd server && npx vitest run test/ccd-hold.test.ts`
Expected: PASS, 10/10.

- [ ] **Step 5: Run the neighbouring ccd suites and commit**

Run: `cd server && npx vitest run test/ccd-archive.test.ts test/ccd-ws-gc.test.ts $(ls test | grep -l reap test/* 2>/dev/null | tr '\n' ' ')` — or simply every `test/ccd-*.test.ts` — foreground.
Expected: green (the new rung must not disturb any existing refusal test).

```bash
git add ccd/ccd server/test/ccd-hold.test.ts
git commit -m "feat(ccd): held is a refusal rung on ws-rm and ws-reap"
```

---

### Task 3: PR lineage — the prhistory chokepoint + manifest fold

**Files:**
- Modify: `ccd/ccd` (the pr-state python heredoc, at `clear('prnumber')` ~line 716; `_ws_archive_manifest` ~line 1412)
- Test: `server/test/ccd-hold.test.ts` (extend) — or a new `server/test/ccd-prhistory.test.ts` if the file is getting long; implementer's choice, say which.

**Interfaces:**
- Consumes: the python heredoc's in-scope vars `id_`, `branch`, `number`, `checked_at`, and its `REG`-file helpers (`put`/`clear` — read the heredoc to see how they resolve paths).
- Produces: `$REG/<id>.prhistory` — JSON Lines, one object per outgoing PR: `{"pr": <int>, "branch": "<str>", "phase": "<str>", "recordedAt": <epoch s int>}`. Appended ONLY when the on-disk `prnumber` exists, parses as an integer, and differs from the incoming `number` (including incoming `None`). The archive manifest gains `"prHistory": [...]` (the parsed lines, oldest first; absent file → `[]`).

- [ ] **Step 1: Write the failing tests**

```ts
describe('prhistory — the one chokepoint', () => {
  const hist = (id: string): unknown[] =>
    fs.existsSync(path.join(h.home, '.cc-sessions', `${id}.prhistory`))
      ? fs.readFileSync(path.join(h.home, '.cc-sessions', `${id}.prhistory`), 'utf8')
          .trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
      : [];

  // Drive the real chokepoint: the python inside pr-state. The harness's
  // existing pr-state tests stub `gh` (see server/test/ccd-* pr tests for the
  // stub idiom) — reuse that stub, varying the PR number it answers with.
  it('appends the outgoing record when prnumber is REPLACED by a different number', () => {
    h.sh(`${WS_ADD}; cmd_ws_add demo`);
    const id = h.wsId('demo');
    // Sweep 1: gh answers PR #591 merged  -> prnumber 591, no history yet.
    runPrStateWithGhAnswering(h, id, { number: 591, state: 'MERGED' });
    expect(hist(id)).toEqual([]);
    // Sweep 2: gh answers PR #601 open   -> 591 retires into history.
    runPrStateWithGhAnswering(h, id, { number: 601, state: 'OPEN' });
    const rows = hist(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ pr: 591, phase: 'merged' });
    expect(typeof (rows[0] as { recordedAt: number }).recordedAt).toBe('number');
  });

  it('does NOT append when the number is unchanged across sweeps', () => {
    h.sh(`${WS_ADD}; cmd_ws_add demo`);
    const id = h.wsId('demo');
    runPrStateWithGhAnswering(h, id, { number: 591, state: 'MERGED' });
    runPrStateWithGhAnswering(h, id, { number: 591, state: 'MERGED' });
    expect(hist(id)).toEqual([]);
  });

  it('appends when a real number gives way to NO number — the between-waves gap must not lose the record', () => {
    h.sh(`${WS_ADD}; cmd_ws_add demo`);
    const id = h.wsId('demo');
    runPrStateWithGhAnswering(h, id, { number: 591, state: 'MERGED' });
    runPrStateWithGhAnswering(h, id, { number: null });   // branch reset for wave 2, PR not yet opened
    expect(hist(id)).toHaveLength(1);
    expect(hist(id)[0]).toMatchObject({ pr: 591 });
    // And the next real PR does not re-append 591:
    runPrStateWithGhAnswering(h, id, { number: 601, state: 'OPEN' });
    expect(hist(id)).toHaveLength(1);
  });

  it('ws-archive folds the history into the manifest', () => {
    h.sh(`${WS_ADD}; cmd_ws_add demo`);
    const id = h.wsId('demo');
    h.sh(`printf '%s\\n' '{"pr":577,"branch":"ws/demo","phase":"merged","recordedAt":1786000000}' > "$HOME/.cc-sessions/${id}.prhistory"`);
    h.sh(`${ARCH_STUBS}; ${writeIdleStatus(id)}; cmd_ws_archive --session ${id}`);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(h.home, '.cc-sessions', `${id}.archivemanifest`), 'utf8'));
    expect(manifest.prHistory).toEqual([{ pr: 577, branch: 'ws/demo', phase: 'merged', recordedAt: 1786000000 }]);
  });

  it('a corrupt prhistory line does not break the manifest — it degrades to [] with the raw file left intact', () => {
    h.sh(`${WS_ADD}; cmd_ws_add demo`);
    const id = h.wsId('demo');
    h.sh(`printf 'not json\\n' > "$HOME/.cc-sessions/${id}.prhistory"`);
    h.sh(`${ARCH_STUBS}; ${writeIdleStatus(id)}; cmd_ws_archive --session ${id}`);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(h.home, '.cc-sessions', `${id}.archivemanifest`), 'utf8'));
    expect(manifest.prHistory).toEqual([]);
    expect(fs.readFileSync(path.join(h.home, '.cc-sessions', `${id}.prhistory`), 'utf8')).toContain('not json');
  });
});
```

`runPrStateWithGhAnswering`, `ARCH_STUBS`, `writeIdleStatus`: build these from the existing pr-state and archive test files' own stub idioms (`ghContainedEnv`, the `ARCH` stub block in `ccd-archive.test.ts`). The existing tests are the authority on how `gh` and tmux/systemd are stubbed in this harness; do not invent a parallel idiom.

- [ ] **Step 2: Run to verify failure** — the new tests FAIL (no history is ever written).

- [ ] **Step 3: Implement**

In the pr-state python heredoc, immediately BEFORE `clear('prnumber')` (~ccd:716):

```python
    # THE prhistory chokepoint. This is the only line in ccd that replaces a
    # persisted prnumber, so it is the only place lineage can be recorded
    # without depending on which sweep or verb caused the replacement. Append
    # the OUTGOING record when a real number is about to become a different
    # answer (another number, or None in the between-waves gap) — never on the
    # steady state, so the sweep's every-120s re-run appends nothing.
    old_raw = get('prnumber')          # use the heredoc's own read helper; if
                                       # none exists, read the file the way
                                       # `clear`/`put` resolve their paths
    old_phase = get('prphase') or ''
    if old_raw is not None:
        try:
            old_num = int(old_raw)
        except ValueError:
            old_num = None
        if old_num is not None and old_num != number:
            import time as _t
            rec = {'pr': old_num, 'branch': branch, 'phase': old_phase,
                   'recordedAt': int(_t.time())}
            with open(reg_path(id_, 'prhistory'), 'a') as f:
                f.write(json.dumps(rec) + '\n')
```

**Adapt names to the heredoc's real helpers** — it has its own way to read/write `$REG/<id>.<field>` (`put`/`clear` exist; find or add the matching read). The behaviourally load-bearing parts are: (a) placed before the `clear`, (b) `old_num != number` with `None` incoming counting as different, (c) append-only, (d) non-numeric old values append nothing.

In `_ws_archive_manifest` (~line 1412): add a `prHistory` field, parsed defensively — read the file if present, parse each line, and on ANY parse failure emit `[]` while leaving the file on disk untouched (the manifest must stay valid JSON; the raw history is still there for a human). Follow the manifest function's existing per-field guard idiom.

- [ ] **Step 4: Run to verify pass** — plus the full ccd family:
`cd server && npx vitest run test/ccd-hold.test.ts && npx vitest run` (full suite, foreground, ≥600000 ms).

- [ ] **Step 5: Commit**

```bash
git add ccd/ccd server/test/ccd-hold.test.ts
git commit -m "feat(ccd): PR lineage — prhistory at the one prnumber chokepoint, folded into the archive manifest"
```

---

### Task 4: server — the gate, the field, the routes, the push copy

**Files:**
- Modify: `server/src/registry.ts` (SessionRecord + read), `server/src/watch.ts` (`archiveMerged` gate + held-merged push), `server/src/ccdargv.ts` (two argv builders), `server/src/server.ts` (two routes beside `/archive`/`/restore` ~line 600)
- Test: `server/test/hold-gate.test.ts` (new), `server/test/routes.test.ts` (extend)

**Interfaces:**
- Consumes: `$REG/<id>.hold` (Task 1).
- Produces: `SessionRecord.held: string | null`; `CCD_ARGV.wsHold(id, reason)` → `['ws-hold','--session',id,'--reason',reason]`, `CCD_ARGV.wsRelease(id)` → `['ws-release','--session',id]`; `POST /api/sessions/:id/hold {reason}` and `POST /api/sessions/:id/release`, both `verbSupported`-gated like `/archive`. Task 5 reads `r.held` in `assembleFleet`.

- [ ] **Step 1: Write the failing tests**

`server/test/hold-gate.test.ts` — copy the harness of the existing `archiveMerged` tests (find them: `grep -rln archiveMerged server/test`); the pins:

```ts
it('merged + held never archives, across many sweeps', async () => {
  // registry seeded with a merged workspace AND an .hold file
  // run tick() three times; assert runCcd was never called with ws-archive,
  // and no push fired with the archive copy.
});

it('merged + released archives on the very next sweep — the level re-arms itself', async () => {
  // same seed; remove the .hold file between sweeps; assert exactly one
  // ws-archive call after the removal.
});

it('the held-merged push fires ONCE, says held, and names nothing destroyed', async () => {
  // seed merged+held; two sweeps; exactly one push; title contains '✓ merged';
  // body contains 'held' and 'nothing archived'; tag `merged-<id>` (the same
  // collapse key as the archive push, so a later real archive push REPLACES
  // this one on the phone rather than stacking).
});

it('the held-merged push latch resets when the PR number changes', async () => {
  // seed merged+held with pr 591 -> push; then pr becomes 601 merged -> a
  // second push. Keyed by id#number, not by id.
});

it('SessionRecord carries held verbatim, null when absent', async () => {
  // readRegistry over a fixture home with and without the file.
});
```

Route tests in `routes.test.ts`, following the `/archive` block's idiom: 404 unknown id, 400 missing/empty `reason` on `/hold`, 409 when `verbSupported` says the fleet ccd predates the verb, 200 passing through ccd's stdout.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

`registry.ts`: add to `SessionRecord`:

```ts
  /** The workspace's program claim — `$REG/<id>.hold`, reason string verbatim,
   *  null when absent. Absence IS release (the verb unlinks), so null → unheld
   *  is the honest mapping here; the ccd-side destructive verbs are where
   *  present-but-unreadable can be (and is) distinguished and read as held. */
  held: string | null;
```

and read it beside the other `field()` calls (`field(io, cfg.registryDir, id, 'hold')`).

`watch.ts`, in `archiveMerged` (~line 448), after the `phase !== 'merged'` gate:

```ts
      if (r.held !== null) {
        // A program claims this workspace: the merge is a WAVE boundary, not
        // the end. Archive nothing; say so once per (workspace, PR) — the
        // in-memory latch means a server restart may repeat the push, which
        // the shared `merged-<id>` collapse tag turns into a replace, not a
        // stack.
        const key = `${r.id}#${pr.number ?? '?'}`;
        if (!this.heldMergedNotified.has(key)) {
          this.heldMergedNotified.add(key);
          this.pushOne({
            kind: 'merged', sessionId: r.id, project: r.project,
            title: `✓ merged › ${r.workspace}`,
            body: `PR #${pr.number ?? '?'} merged — ${r.held}; nothing archived.`,
          }, this.activeProjects);
        }
        continue;
      }
```

with `private heldMergedNotified = new Set<string>();` beside the class's other latches. The body carries the reason verbatim — the reason string is the display.

`ccdargv.ts`: two builders beside `wsArchive`/`wsRestore` (same shape). `server.ts`: two routes beside `/archive`, `verbSupported`-gated, `/hold` validating `reason` is a non-empty string (400 otherwise).

- [ ] **Step 4: Run to verify pass** — `cd server && npx vitest run && npx tsc --noEmit` (foreground, ≥600000 ms). Fix any `SessionRecord` factory the new field breaks (default `held: null`).

- [ ] **Step 5: Commit**

```bash
git add server shared
git commit -m "feat(server): the hold gates archiveMerged; hold/release routes; held-merged push"
```

---

### Task 5: wire + PWA — the held chip, sheet actions, and the program-ledger convention

**Files:**
- Modify: `shared/api.ts` (`FleetSession.held`), `server/src/fleet.ts` (ship it), `pwa/src/fleet/SessionLine.tsx` (chip), `pwa/src/fleet/SessionActionsSheet.tsx` (Hold/Release), `pwa/src/lib/api.ts` (two calls + refusal sentences), `pwa/src/fleet/fleet.css`, `README.md` (a short "Workspace holds & programs" subsection under "How a session's state is known")
- Create: `docs/superpowers/programs/TEMPLATE.md` (the ledger convention, copied from the spec's shape)
- Test: `pwa/test/session-line.test.tsx`, `pwa/test/session-actions.test.tsx` (or the sheet's existing test file — find it), `pwa/test/contrast.test.ts` if any new colour token is introduced (prefer reusing existing tokens so it isn't)

**Interfaces:**
- Consumes: `SessionRecord.held` (Task 4).
- Produces: `FleetSession.held: string | null` (additive; doc comment states the reason string IS the display, no parsing); `api.hold(id, reason)` / `api.release(id)`.

- [ ] **Step 1: Write the failing tests**

```tsx
it('shows the held chip with the reason verbatim', () => {
  render(<SessionLine session={f({ held: 'program:agent-evals wave:2/4' })} onOpen={() => {}} onActions={() => {}} />);
  expect(screen.getByText('program:agent-evals wave:2/4')).toBeInTheDocument();
});

it('shows no chip when unheld — null is the wire default, not a state to render', () => {
  render(<SessionLine session={f({ held: null })} onOpen={() => {}} onActions={() => {}} />);
  expect(screen.queryByText(/program:/)).toBeNull();
});

it('the actions sheet offers Hold on an unheld workspace and Release on a held one, never both', () => {
  const { rerender } = render(<SessionActionsSheet session={f({ held: null })} {...sheetProps} />);
  expect(screen.getByRole('button', { name: /hold/i })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /release/i })).toBeNull();
  rerender(<SessionActionsSheet session={f({ held: 'program:x wave:2/4' })} {...sheetProps} />);
  expect(screen.getByRole('button', { name: /release/i })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^hold/i })).toBeNull();
});

it('Release names its consequence before acting', async () => {
  render(<SessionActionsSheet session={f({ held: 'program:x' })} {...sheetProps} />);
  await userEvent.click(screen.getByRole('button', { name: /release/i }));
  // The confirm (or the control itself, per the sheet's existing idiom) says
  // what release re-enables BEFORE anything is sent:
  expect(screen.getByText(/will archive on the next sweep after its PR merges/)).toBeInTheDocument();
  expect(released).toHaveLength(0);   // nothing sent yet — the copy precedes the act
});

it('Hold refuses to send an empty reason, with the server\'s own sentence', async () => {
  render(<SessionActionsSheet session={f({ held: null })} {...sheetProps} />);
  await userEvent.click(screen.getByRole('button', { name: /hold/i }));
  await userEvent.click(screen.getByRole('button', { name: /confirm|hold/i }));
  expect(heldCalls).toHaveLength(0);
  expect(screen.getByText(/say which program holds this/)).toBeInTheDocument();
});
```

Sheet mechanics (confirm affordances, how actions call `api`, how errors toast) follow `SessionActionsSheet.tsx`'s existing archive/restore actions — read them first; they are the pattern for everything including copy placement.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

- `shared/api.ts`: `held: string | null;` on `FleetSession` with the no-parsing doc comment. `fleet.ts`: `held: r.held,` in the assembled session (and the revival path in `shared/api.ts`'s `reviveFleetSession` — absent → `null`, same degrade-vs-reject decision recorded for `bucket`: absent degrades to null (an old snapshot simply predates holds), any non-string rejects the session).
- Chip in `SessionLine`: render the reason inside the existing meta row idiom (like `sess-acct`), reusing an existing ink token — no new colour, so the contrast registry is untouched. Mark it `data-held` for tests.
- Sheet: Hold (opens the existing prompt/confirm idiom for the reason; empty refuses client-side with the same sentence the server would send) and Release (confirm copy: "released — will archive on the next sweep after its PR merges."). Errors surface via the existing toast path with the server's sentence.
- `README.md`: ~10 lines under the attention section: what a hold is, the two verbs, the archive interaction, the pointer to `docs/superpowers/programs/TEMPLATE.md`.
- `TEMPLATE.md`: the spec's ledger shape verbatim, with one paragraph on the wave-handoff discipline (handoffs are commits; the Next-wave brief is all a fresh session reads).

- [ ] **Step 4: Run to verify pass** — `cd pwa && npx vitest run && npx tsc --noEmit`, then `cd ../server && npx vitest run && npx tsc --noEmit`, then `cd ../agent && npx tsc --noEmit` (all foreground).

- [ ] **Step 5: Commit and open the PR**

```bash
git add -A shared server pwa docs README.md
git commit -m "feat(pwa): held chip, hold/release actions, program-ledger convention"
git push -u origin feat/workspace-hold
gh pr create --title "feat: workspace holds — a program's claim survives its merges" --body "Implements docs/superpowers/specs/2026-08-06-workspace-hold-programs-design.md (Build 2.5)."
```
Do **not** merge; the orchestrator merges.

---

## Deploy gate

This build ships `ccd/` — **agent first**, then server+PWA:

1. `CCRC_SSH_KEY=~/.ssh/<your-key> bash deploy/deploy.sh agent you@<fleet-host>`
2. `CCRC_SSH_KEY=~/.ssh/<your-key> bash deploy/deploy.sh`

The server's routes are `verbSupported`-gated, so a server deployed against a stale ccd refuses politely rather than failing — but the order above makes that window zero.

**Live proof, on clear-cove itself (operator-observed):**
1. Restore `expoAI-assistant-clear-cove` via the PWA (operator action — the runbook's rule stands: session lifecycle through the PWA).
2. Hold it: reason `program:<name> wave:2/…`.
3. `/api/fleet` shows `held` on the record; the card shows the chip; the cleanup bucket does NOT contain it.
4. One `archiveMerged` sweep passes (it is merged:#591): verify NO archive happened and the held-merged push arrived once with the held copy.
5. Release (when wave 2 truly ends — not part of this proof unless the operator chooses).

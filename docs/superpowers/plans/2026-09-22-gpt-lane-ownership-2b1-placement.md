# GPT lane ownership — Plan 2b-1: placement, the censuses, and the lane manifest — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a Codex lane *install*: the four common executables reach `$HOME/.local/bin`, the usage unit pair reaches the unit directory, both uninstall censuses learn the new names behind a guard that derives them rather than trusting a hand-kept list, and `~/.ccrc/codex/<id>/lane.json` gains the writer every later task reads.

**Architecture:** This plan changes the install spine and one materialiser; it starts nothing and enables nothing. `_inst_bins` places four files that Plan 2a already shipped into `ccd/` unreferenced, `_inst_units` places a service/timer pair without enabling it, and `deploy/models-op.mjs` writes `lane.json` beside the model files it already writes, tmp-then-rename. A Codex lane after this plan is *installed and inert*: nothing probes, nothing listens, no runtime exists. Plan 2b-2 makes it run.

**Tech Stack:** bash (`ccd/ccrc`), Node ESM (`deploy/models-op.mjs`, `deploy/gen-wrappers.mjs`), vitest (`server/test`).

**Spec:** `docs/superpowers/specs/2026-09-20-gpt-lane-ownership-design.md` — §5.1 (the four executables and the three declaration lists), §5.4 (generated lane state), and §5's Pins. Read §5 before Task 1.

---

## What Plan 1 already shipped — measured 2026-09-22, do NOT redo

Plan 2a's wave table assigned the launcher grammar to 2b. **The tree disagrees, and the tree wins** (CLAUDE.md: plan anchors are snapshots; trust shipped source). Measured on `4dca80f8`:

| Item | State |
|---|---|
| `TOOLCHAIN_EXECUTABLES` carries `ccgpt`, `ccgpt-runtime` | **done** (`deploy/gen-wrappers.mjs:201-204`, with a comment saying it precedes Plan 2 deliberately) |
| `generateWrapperBody` accepts `codex`, targets `ccgpt` | **done** (`shared/wrapper.mjs:89-99`) |
| `gen-wrappers.mjs` stops protecting codex | **done** — `managed` is `execKind === 'generated' \|\| execKind === 'codex'` (`:331`), and `codexCount` exists (`:422`) |
| `_check_wrappers` expects `ccgpt` for a codex lane | **done** (`ccd/ccrc-doctor-checks:2642-2646`, with its own message) |

**If a task below appears to ask for one of these, stop and report** — it means this section has gone stale and the controller must re-measure before you write anything.

## Global Constraints

- **Node floor `>=22.13.0`**, identical across the three engines. Never lower an `engines` field to make a test green.
- **The repository is PUBLIC (AGPL-3.0).** No real account id, label, email, host, port, credential, OAuth path, session codename, operator username or real model id in any tracked byte. Fixture vocabulary: `codex-a`, `pool-a`/`pool-b`, `gpt-x`.
- **`ccd/ccd` and `ccd/ccrc` are GENERATED and must be re-stamped after any edit.** `server/test/ownership.test.ts` is what catches a missed stamp — run it in every task that touches either file.
- **Fixture HOMEs only.** Never run `ccrc` or `ccd` against the live `$HOME`; `makeCcdHarness` (`server/test/ccdWsHelpers.ts`) and `installFixtureTree` (`server/test/installTreeFixture.ts`) are the harnesses. Never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or any `claude-session@*` unit — ~20 live sessions run on this box.
- **Never run the destructive `ccd` verbs** (`ws-rm`, `ws-reap`, `ws-gc --prune`, `ws-archive`, `ws-restore`) against anything but a fixture.
- **Single source of truth:** runtime lists are derived from the type or from one declaration, never hand-maintained a second time. `server/test/single-definition.test.ts` fails the build on a second copy.
- **Mutation-table discipline:** every guard ships with a case that goes RED when the guard is mutated, measured both ways with counts. If a demanded mutation does not red, **report that it does not red** — never manufacture code to force a bind (D-3152).
- **Deviation numbers are API-issued.** `D-3150`–`D-3163` are already defined in Plan 2a's ledger. Define nothing new; if a task needs a number, say so and the controller allocates it.
- **This plan installs but does not enable.** Nothing here starts a process, enables a timer, or builds a runtime.

### The typecheck instrument — read this, it cost the last wave eighteen errors

**`cd server && tsc --noEmit` does NOT typecheck `server/test/`.** The server's default tsconfig excludes it. Every task in Plan 2a ran that command, reported clean, and was telling the truth while eighteen real errors sat unchecked (D-3163). **When a task writes or edits a file under `server/test/`, its verification step is:**

```bash
cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
```

`tsc --noEmit` remains correct for `server/src` and is still worth running; it is simply not evidence about test files.

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `server/test/installTreeFixture.ts` | the fixture tree every install test builds from; gains the four `ccd/ccgpt*` entries and the unit pair | 1 |
| `ccd/ccrc` `_inst_bins` | places the four executables on PATH, both platform arms | 2 |
| `ccd/ccrc` `_inst_units` | places `ccgpt-usage@.service`/`@.timer`; **does not enable** | 3 |
| `deploy/systemd/ccgpt-usage@.service`, `@.timer` | the per-lane usage instance pair | 3 |
| `ccd/ccrc` `_uninst_tree_bins`, `_uninst_units` | the two removal censuses | 4 |
| `server/test/install-census.test.ts` | **new** — the derived guard the spec asks for, over both censuses | 5 |
| `deploy/models-op.mjs` | writes `~/.ccrc/codex/<id>/lane.json` beside the model files | 6 |
| `deploy/deploy.sh` | the fallback push path carries the new files | 7 |

---

## Task 1: the fixture tree knows the four new files

**Files:**
- Modify: `server/test/installTreeFixture.ts`
- Test: `server/test/ccrc-install.test.ts` (existing cases must stay green)

**Interfaces:**
- Consumes: nothing.
- Produces: `TREE_FILES` entries `ccd/ccgpt`, `ccd/ccgpt-runtime`, `ccd/ccgpt-proxy.py`, `ccd/ccgpt-usage.py`. Tasks 2–5 all assert against a tree built by `installFixtureTree`, so a missing entry there makes a placement test fail *for a fixture reason* rather than a real one.

**Why first:** every later task's test builds this tree. `TREE_FILES`' own comment already says later tasks add lines to it.

**Note:** `ccd/ccgpt` and `ccd/ccgpt-runtime` **do not exist yet** — Plan 2b-2 creates them. This task adds the two that *do* exist (`ccgpt-proxy.py`, `ccgpt-usage.py`) and adds the other two to `TREE_STUBS` as executable placeholders, so Task 2 can place four files without waiting on 2b-2. Say so in the comment.

- [ ] **Step 1: Write the failing test**

In `server/test/ccrc-install.test.ts`, beside the existing fixture-tree cases:

```ts
it('the fixture tree carries the four GPT-lane common executables', () => {
  const home = mkTmp('ccrc-tree-ccgpt-');
  const root = installFixtureTree(home);
  for (const rel of ['ccd/ccgpt', 'ccd/ccgpt-runtime', 'ccd/ccgpt-proxy.py', 'ccd/ccgpt-usage.py']) {
    const p = join(root, rel);
    expect(existsSync(p), `${rel} missing from the fixture tree`).toBe(true);
    // 0o111 — every one of these is exec'd or placed 755 by `_inst_bins`.
    expect(statSync(p).mode & 0o111, `${rel} is not executable`).toBeGreaterThan(0);
  }
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd server && ./node_modules/.bin/vitest run test/ccrc-install.test.ts -t 'four GPT-lane common executables'`
Expected: FAIL — `ccd/ccgpt-proxy.py missing from the fixture tree`.

- [ ] **Step 3: Implement**

In `TREE_FILES`, after the `ccd/ccrc-adopt` entry:

```ts
  // Plan 2b-1 Task 1: the GPT-lane common executables. The two `.py` files
  // ship today (Plan 2a) and are copied from the repository; `ccgpt` and
  // `ccgpt-runtime` do not exist until Plan 2b-2, so they are TREE_STUBS
  // below. `_inst_bins` places all four, so a tree missing any one makes a
  // placement assertion fail for a fixture reason rather than a real one.
  'ccd/ccgpt-proxy.py',
  'ccd/ccgpt-usage.py',
```

In `TREE_STUBS`:

```ts
  // Plan 2b-1 Task 1, removed by Plan 2b-2 when the real files land: stubs so
  // `_inst_bins` can place four names before two of them are written. Each is
  // a valid no-op script, because `installFixtureTree` preserves mode and
  // `cmd_install` may exec what it places.
  'ccd/ccgpt': '#!/usr/bin/env bash\n# fixture stub — Plan 2b-2 writes the real launcher\nexit 0\n',
  'ccd/ccgpt-runtime': '#!/usr/bin/env bash\n# fixture stub — Plan 2b-2 writes the real runtime builder\nexit 0\n',
```

`TREE_STUBS` entries are written by `installFixtureTree`; give the two stubs mode 0755 where it writes them (the existing stub writer uses the default mode — add an explicit `{ mode: 0o755 }` for any stub whose repo-relative path starts `ccd/`, and say why in one line).

- [ ] **Step 4: Run it and watch it pass**

Run: `cd server && ./node_modules/.bin/vitest run test/ccrc-install.test.ts`
Expected: PASS, and the file's existing count is unchanged except for the one new case.

- [ ] **Step 5: Typecheck the test directory**

Run: `cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts`
Expected: PASS. (Not `tsc --noEmit` — see Global Constraints.)

- [ ] **Step 6: Commit**

```bash
git add server/test/installTreeFixture.ts server/test/ccrc-install.test.ts
git commit -m "test(gpt-lane): the fixture tree carries the four common executables"
```

---

## Task 2: `_inst_bins` places the four executables

**Files:**
- Modify: `ccd/ccrc` (`_inst_bins`, ~line 9823; the two summary `echo` lines at ~9901 and ~9903)
- Test: `server/test/ccrc-install.test.ts`

**Interfaces:**
- Consumes: Task 1's fixture entries.
- Produces: four files at `$HOME/.local/bin/{ccgpt,ccgpt-runtime,ccgpt-proxy.py,ccgpt-usage.py}`, mode 755. Task 4's census and Task 5's guard both read this list.

**The platform decision, made here rather than left open.** `_inst_bins` has a Darwin arm that omits the timer-only tools (`ccd-graph-sweep`, `ccd-usage-sweep`, …) because their timers are systemd-only. **All four GPT-lane files go on BOTH arms.** `ccgpt` and `ccgpt-runtime` are commands an operator types, and the two `.py` files are their dependencies rather than timer-only tools — spec §7.3 makes the `nohup` fallback a supported path, so a macOS box with a Codex lane needs all four. The systemd-only artifact is the *timer unit*, and that lives in `_inst_units` (Task 3), which is where the platform split belongs.

- [ ] **Step 1: Write the failing test**

```ts
it('places the four GPT-lane executables on PATH, 755', async () => {
  const home = mkTmp('ccrc-inst-ccgpt-');
  const root = installFixtureTree(home);
  const r = await runInstall(home, root, ['--role', 'fleet']);
  expect(r.status).toBe(0);
  for (const name of ['ccgpt', 'ccgpt-runtime', 'ccgpt-proxy.py', 'ccgpt-usage.py']) {
    const p = join(home, '.local', 'bin', name);
    expect(existsSync(p), `${name} was not placed`).toBe(true);
    expect(statSync(p).mode & 0o777, `${name} mode`).toBe(0o755);
  }
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd server && ./node_modules/.bin/vitest run test/ccrc-install.test.ts -t 'four GPT-lane executables on PATH'`
Expected: FAIL — `ccgpt was not placed`.

- [ ] **Step 3: Implement**

In `_inst_bins`, beside the existing `ccd-usage-sweep` pair (`ccd/ccrc:9877-9878`), on **both** platform arms:

```bash
    # Plan 2b-1 Task 2: the GPT-lane common executables. Both arms, not just
    # the systemd one — `ccgpt` and `ccgpt-runtime` are commands an operator
    # types and the two `.py` files are their dependencies, not timer-only
    # tools (spec §7.3 makes the nohup fallback supported). The systemd-only
    # artifact is `ccgpt-usage@.timer`, and that is `_inst_units`' business.
    _inst_atomic "$tree/ccd/ccgpt"           "$bin/ccgpt"           755
    _inst_atomic "$tree/ccd/ccgpt-runtime"   "$bin/ccgpt-runtime"   755
    _inst_atomic "$tree/ccd/ccgpt-proxy.py"  "$bin/ccgpt-proxy.py"  755
    _inst_atomic "$tree/ccd/ccgpt-usage.py"  "$bin/ccgpt-usage.py"  755
```

Then extend **both** summary `echo` lines (~9901 Darwin, ~9903 systemd) to name the four. **Those two strings are pinned by exact `toEqual` assertions in `ccrc-install.test.ts`** — Plan 2a's Task 12 recorded that this plan must move them. Find them (`grep -n "install: bins:" server/test/ccrc-install.test.ts`), update both to match the new text exactly, and say in the commit body which assertions moved.

- [ ] **Step 4: Run it and watch it pass**

Run: `cd server && ./node_modules/.bin/vitest run test/ccrc-install.test.ts`
Expected: PASS, including the two summary assertions.

- [ ] **Step 5: Re-stamp `ccd/ccrc` and prove it**

`ccd/ccrc` is generated. Re-stamp it, then:

Run: `cd server && ./node_modules/.bin/vitest run test/ownership.test.ts test/typecheck-tests.test.ts`
Expected: PASS. A missed stamp reds `ownership.test.ts`.

- [ ] **Step 6: Mutate**

Delete the `ccgpt` line from the systemd arm only. Expected: the Task 2 case reds naming `ccgpt`, and the Darwin-arm cases stay green. Restore, re-stamp, confirm green. Record both counts.

- [ ] **Step 7: Commit**

```bash
git add ccd/ccrc server/test/ccrc-install.test.ts
git commit -m "feat(gpt-lane): _inst_bins places the four common executables"
```

---

## Task 3: `_inst_units` places the usage unit pair, and enables nothing

**Files:**
- Create: `deploy/systemd/ccgpt-usage@.service`, `deploy/systemd/ccgpt-usage@.timer`
- Modify: `ccd/ccrc` (`_inst_units`), `server/test/installTreeFixture.ts` (`deploy/systemd/` is copied recursively — confirm the new files are picked up without a new entry)
- Test: `server/test/ccrc-install.test.ts`

**Interfaces:**
- Consumes: Task 1's tree.
- Produces: two unit files under the user unit directory. Task 4's `_uninst_units` census and Task 5's guard both read these names.

**Scope boundary, stated because the wave table is ambiguous.** Plan 2a deferred "units" to 2b and "the timer" to Plan 3. The reading this plan takes: **installing the `@.service`/`@.timer` files is 2b-1; enabling or starting an instance per lane is Plan 3.** So this task writes the templates and places them, and asserts that **no instance is enabled**. If a reviewer reads the boundary differently, that is a controller ruling, not an implementation choice.

The service template runs the publisher for one lane:

```ini
[Unit]
Description=ccrc GPT-lane usage window publisher for %i
After=network-online.target

[Service]
Type=oneshot
Environment=CCGPT_ACCOUNT_ID=%i
ExecStart=%h/.local/bin/ccgpt-usage.py
# The publisher reads ~/.ccrc/codex/%i/lane.json for everything else, so no
# path is re-derived here from a naming convention (spec §5.4).
```

The timer:

```ini
[Unit]
Description=periodic usage poll for ccrc GPT lane %i

[Timer]
OnBootSec=2min
OnUnitActiveSec=15min
AccuracySec=1min
Unit=ccgpt-usage@%i.service

[Install]
WantedBy=timers.target
```

- [ ] **Step 1: Write the failing test**

```ts
it('places the ccgpt-usage unit pair and enables no instance', async () => {
  const home = mkTmp('ccrc-inst-units-');
  const root = installFixtureTree(home);
  const r = await runInstall(home, root, ['--role', 'fleet']);
  expect(r.status).toBe(0);
  const units = join(home, '.config', 'systemd', 'user');
  expect(existsSync(join(units, 'ccgpt-usage@.service'))).toBe(true);
  expect(existsSync(join(units, 'ccgpt-usage@.timer'))).toBe(true);
  // Lazy by design (spec §7.1): a rostered lane with no session has no
  // processes, so install places the templates and enables no instance.
  const wants = join(units, 'timers.target.wants');
  const enabled = existsSync(wants) ? readdirSync(wants) : [];
  expect(enabled.filter((f) => f.startsWith('ccgpt-usage@'))).toEqual([]);
});
```

- [ ] **Step 2: Run it and watch it fail** — the unit files do not exist.

- [ ] **Step 3: Implement** the two templates above, then place them in `_inst_units` beside the existing pairs, on the systemd arm only (the Darwin arm has no user manager; spec §7.3 is 2b-2's).

- [ ] **Step 4: Run it and watch it pass**

- [ ] **Step 5: Re-stamp `ccd/ccrc`, then run** `ownership.test.ts` and `typecheck-tests.test.ts`.

- [ ] **Step 6: Mutate** — add an `enable` call for `ccgpt-usage@codex-a.timer`. The `toEqual([])` must red. Restore. Record both counts.

- [ ] **Step 7: Commit**

```bash
git add deploy/systemd/ccgpt-usage@.service deploy/systemd/ccgpt-usage@.timer ccd/ccrc server/test/ccrc-install.test.ts
git commit -m "feat(gpt-lane): install the usage unit pair, enable nothing"
```

---

## Task 4: both uninstall censuses learn the new names

**Files:**
- Modify: `ccd/ccrc` (`_uninst_tree_bins` ~12669, `_uninst_units` ~12419)
- Test: `server/test/ccrc-uninstall.test.ts` (or the existing uninstall suite — locate it with `grep -rln "_uninst_tree_bins\|uninstall" server/test | head`)

**Interfaces:**
- Consumes: Tasks 2 and 3's placed names.
- Produces: censuses that remove all four executables and both unit files. Task 5's guard derives against exactly these.

**Why this is not bookkeeping.** Spec §5.1: these two lists are hand-kept, **have gone stale three separate times** (D-1347, D-2594, and a routing-slice recurrence), and no test derives them. Four new names and a unit pair are exactly the payload they go stale on.

- [ ] **Step 1: Write the failing test** — install into a fixture HOME, uninstall, and assert none of the four binaries and neither unit file survives.

```ts
it('uninstall removes the four GPT-lane executables and the usage unit pair', async () => {
  const home = mkTmp('ccrc-uninst-ccgpt-');
  const root = installFixtureTree(home);
  expect((await runInstall(home, root, ['--role', 'fleet'])).status).toBe(0);
  const r = await runUninstall(home, ['--yes']);
  expect(r.status).toBe(0);
  for (const name of ['ccgpt', 'ccgpt-runtime', 'ccgpt-proxy.py', 'ccgpt-usage.py']) {
    expect(existsSync(join(home, '.local', 'bin', name)), `${name} survived uninstall`).toBe(false);
  }
  const units = join(home, '.config', 'systemd', 'user');
  expect(existsSync(join(units, 'ccgpt-usage@.service'))).toBe(false);
  expect(existsSync(join(units, 'ccgpt-usage@.timer'))).toBe(false);
});
```

If the uninstall verb's flag is not `--yes`, use whatever the existing uninstall cases use — copy their shape rather than inventing one.

- [ ] **Step 2: Run it and watch it fail**

- [ ] **Step 3: Implement** — add the four names to `_uninst_tree_bins`' `rm -f` census and both unit names to `_uninst_units`' two lists.

- [ ] **Step 4: Run it and watch it pass**

- [ ] **Step 5: Re-stamp `ccd/ccrc`**, then `ownership.test.ts` + `typecheck-tests.test.ts`.

- [ ] **Step 6: Mutate** — remove `ccgpt-runtime` from the census. The case reds naming it. Restore. Record counts.

- [ ] **Step 7: Commit**

---

## Task 5: the derived guard the spec asks for

**Files:**
- Create: `server/test/install-census.test.ts`
- Test: itself

**Interfaces:**
- Consumes: Tasks 2–4's lists.
- Produces: a guard that reds when a name placed by `_inst_bins` is missing from `_uninst_tree_bins`, or a unit placed by `_inst_units` is missing from `_uninst_units` — **in both directions**.

**The shape to copy:** `server/test/gen-wrappers.test.ts` already derives `_inst_bins`' list and `TOOLCHAIN_EXECUTABLES` from source and reds when one has an entry the other lacks. Read it first and follow it; do not invent a second parsing idiom.

**What "derived" means here, precisely.** The guard extracts both censuses **from `ccd/ccrc`'s own text** and compares them as sets. It must not carry its own hand-written list of the four names — that would be a third copy, and the defect this guard exists to close is exactly a list that drifts from the code it describes.

- [ ] **Step 1: Write the failing test**

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CCRC = readFileSync(join(__dirname, '..', '..', 'ccd', 'ccrc'), 'utf8');

/** Every `$bin/<name>` `_inst_atomic` places, read out of `_inst_bins`' body. */
function placedBins(src: string): Set<string> { /* extract; see gen-wrappers.test.ts */ }
/** Every name `_uninst_tree_bins` removes. */
function removedBins(src: string): Set<string> { /* extract */ }

it('every binary the install spine places is removed by the uninstall census', () => {
  const placed = placedBins(CCRC);
  const removed = removedBins(CCRC);
  expect(placed.size, 'extractor found no placed bins — it has gone stale').toBeGreaterThan(5);
  expect([...placed].filter((n) => !removed.has(n))).toEqual([]);
});

it('the uninstall census removes nothing the install spine does not place', () => {
  const placed = placedBins(CCRC);
  const removed = removedBins(CCRC);
  expect([...removed].filter((n) => !placed.has(n))).toEqual([]);
});
```

The `toBeGreaterThan(5)` is not decoration: **an extractor that silently matches nothing makes both assertions vacuously true**, which is the failure mode a set-comparison guard has. Write the same floor for the unit extractor.

- [ ] **Step 2: Run it and watch it fail** — write the extractors last; the first run should fail on the floor, proving the floor works.

- [ ] **Step 3: Implement the extractors**, then the same pair of cases for units.

- [ ] **Step 4: Run and watch pass**

- [ ] **Step 5: Mutate, three ways, each restored**

1. Remove one name from `_uninst_tree_bins` → the first case reds naming it.
2. Add a name to `_uninst_tree_bins` that nothing places → the second case reds.
3. **Break the extractor** (make it match nothing) → the floor assertion reds. This is the control that proves the guard is not vacuous; without it a broken extractor reports green.

Record all three counts.

- [ ] **Step 6: Run `typecheck-tests.test.ts`, then commit**

---

## Task 6: `lane.json`'s writer

**Files:**
- Modify: `deploy/models-op.mjs`
- Test: `server/test/ccrc-models.test.ts`

**Interfaces:**
- Consumes: the `codex` class entry already in `models-op.mjs` (~`:78`, `{ probe: 'codex', … }`).
- Produces: `~/.ccrc/codex/<id>/lane.json`, 0644, written tmp-then-rename, with at minimum:

```json
{ "id": "codex-a", "configDir": "…", "authDir": "…", "probeModel": "…", "units": { "litellm": "…", "shim": "…" } }
```

**Three constraints from Plan 2a's ledger, each with its own reason:**

- **`probeModel` must be exactly that key** (D-3158). `ccd/ccgpt-usage.py` already reads it, and its reader is pinned against a fixture Plan 2a wrote — so fixture and reader agree with each other and would agree with a *wrong* producer too. **Derive the value from the `codex` class entry's existing `probe` field rather than writing a second model policy** — that is D-3158's own prescribed remedy.
- **`authDir` must be present** (Plan 2a review I-2). The publisher was made to read it from here precisely so nothing re-derives a credential path from a naming convention — spec §5.4 says so in terms.
- **The write is atomic.** `models-op.mjs` already has a tmp+rename helper (~`:235-244`); use it rather than adding a second.

- [ ] **Step 1: Write the failing test**

```ts
it('writes lane.json with the probe model derived from the codex class entry', async () => {
  const home = mkTmp('ccrc-lane-json-');
  await runModelsOp(home, ['litellm', '--account', 'codex-a']);   // or the verb the suite already uses
  const lane = JSON.parse(readFileSync(join(home, '.ccrc', 'codex', 'codex-a', 'lane.json'), 'utf8'));
  expect(lane.id).toBe('codex-a');
  expect(typeof lane.authDir).toBe('string');
  expect(lane.authDir.length).toBeGreaterThan(0);
  // D-3158: the key name is a cross-plan contract — ccd/ccgpt-usage.py reads
  // exactly `probeModel`, and its own fixture cannot prove the producer agrees.
  expect(lane.probeModel).toBe(CODEX_CLASS_PROBE);   // imported from the one declaration
});
```

- [ ] **Step 2: Run it and watch it fail** — no `lane.json` is written today (measured: `grep -c lane.json deploy/models-op.mjs` → 0).

- [ ] **Step 3: Implement** the writer beside the model-file writes, using the existing tmp+rename helper.

- [ ] **Step 4: Run it and watch it pass**

- [ ] **Step 5: Close D-3158's real gap — a case that reads a fixture the MATERIALISER generated**

Plan 2a's reader is pinned against a hand-written fixture. Add one case in `server/test/ccgpt-usage.test.ts` that runs this materialiser to produce `lane.json` and then runs the publisher against it, so producer and consumer are proven to agree **through the real writer** rather than through two hand-written copies. This is the single most valuable case in this task.

- [ ] **Step 6: Mutate** — rename the emitted key to `probe_model`. The Step 5 case reds; the Step 1 case reds. Restore. Record counts.

- [ ] **Step 7: Run `typecheck-tests.test.ts`, then commit**

---

## Task 7: `deploy/deploy.sh` carries the new files

**Files:**
- Modify: `deploy/deploy.sh`
- Test: `server/test/deploy-coordinates.test.ts`

**Context:** `deploy.sh` is the **fallback**, not the path — `ccrc rollout` is. It still has to carry the new files or a fallback deploy silently ships a tree missing them. Measured: `grep -c ccgpt deploy/deploy.sh` → 0.

- [ ] **Step 1: Write the failing test** asserting `deploy.sh`'s pushed pathspec includes the four `ccd/ccgpt*` files and `deploy/systemd/ccgpt-usage@.*`. Derive the expected names from the same extractor Task 5 wrote where possible; if that is impractical across a shell script, say so and pin the literal list with a comment naming Task 5's guard as the reason it cannot drift silently.

- [ ] **Step 2–4:** fail, implement, pass.

- [ ] **Step 5: Mutate** one name out of the pathspec; the case reds. Restore.

- [ ] **Step 6: Commit**

---

## Task 8: wave bookkeeping

**Files:**
- Modify: this plan (the count table below)

- [ ] **Step 1: Fill the table by measurement**

```bash
cd server && ./node_modules/.bin/vitest run test/ccrc-install.test.ts test/install-census.test.ts \
  test/ccrc-models.test.ts test/ccgpt-usage.test.ts --reporter=verbose | tail -5
```

| Suite | Before (`4dca80f8`) | After |
|---|---|---|
| `ccrc-install.test.ts` | 124 | 132 |
| `install-census.test.ts` | 0 | 11 |
| `ccrc-uninstall.test.ts` | 29 | 30 |
| `models-op.test.ts` | 97 | 106 |
| `ccrc-models.test.ts` | 105 | 106 |
| `ccgpt-usage.test.ts` | 31 | 34 |

Measured 2026-09-23 with `vitest list` against the file at the branch point and at HEAD: cases collected on a
Linux box, so `ccrc-install.test.ts`'s 18 macOS-only cases are skipped here both before and after. 39 new cases in
all. The plan's pre-filled "31" for `ccgpt-usage.test.ts` was right.

- [ ] **Step 2: Record, in the commit body,** whether the Task 3 scope boundary (install the templates, enable nothing) survived review unchanged.

- [ ] **Step 3: Commit**

---

## Wave-close gate

- [ ] **Confirm the cut held.** This plan must have touched none of `ccd/ccd`, `shared/wrapper.mjs`, `ccd/ccrc-doctor-checks`, `deploy/gen-wrappers.mjs` — all four are Plan 1's and already correct:

```bash
git diff --name-only origin/main...HEAD \
  | grep -E '^(ccd/ccd$|shared/wrapper\.mjs$|ccd/ccrc-doctor-checks$|deploy/gen-wrappers\.mjs$)' \
  && echo "SCOPE BREACH — stop and report" || echo "cut held"
```

**The alternatives are anchored with `$` deliberately** — Plan 2a's equivalent check used `ccd/ccrc` unanchored, which matched `ccd/ccrc-models-probe` and every other `ccd/ccrc*` file, producing a false SCOPE BREACH (D-3162).

- [ ] **Fetch main, then the cross-branch deviation guard**

```bash
git fetch origin main && cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts
```

- [ ] **Full server suite as the bounded sequential shard union** — `1/3 3/6 4/6 5/6 6/6`, sequentially, never in parallel. Re-run any failure **in isolation** before calling it a real break, and re-run twice: a failure set that moves without an edit is a load flake (Plan 2a saw this three times, on `boot`, `session-hook` and `ccd-ws-reap`). **Compare branch against main back to back if you need that comparison** — comparing a loaded run against a lighter one reads load as a regression.

- [ ] **Agent and PWA suites**, and `tsc --noEmit` for `server/src`.

- [ ] **Residue scan.** Note that Plan 2a's address-shaped-token grep false-positived on URL userinfo in fixtures (D-3162); enumerate and classify every hit rather than counting them, and treat `topology-clean.test.ts` as the authority.

- [ ] **Check author identity, push, open the PR.** The PR body links the spec by **GitHub blob URL** (never a docserver URL), carries Task 8's table, and states plainly that this plan **installs but enables nothing** — no runtime is built, no timer is enabled, no process starts.

**Do not deploy.** Spec §15: land → release → separately authorised cutover → OpenClaw deletion.

---

## Self-review of this plan

**Spec coverage.** §5.1's four executables → Task 2; its unit pair → Task 3; its "this work adds that derivation" for the two censuses → Tasks 4–5. §5.4's `lane.json` → Task 6. §5's Pins: the `TOOLCHAIN_EXECUTABLES`/`_inst_bins` agreement is **already green** (Plan 1, and `gen-wrappers.test.ts` derives it both directions); the derived census guard → Task 5. **Deliberately out of scope:** every §5.2 row (the isolated runtime), every §7 row (lifecycle, `_svc_run_supervised`, adoption, `_inst_enable`'s restart) and §5.4's `runtime.env` — all Plan 2b-2. `_check_codex`, per-lane `litellm.yaml` and enabling the timer → Plan 3.

**Placeholder scan.** Task 7's Step 1 names a derivation it cannot fully specify across a shell script and says what to do if it is impractical, rather than leaving "add appropriate tests". Task 4's uninstall flag is stated as "copy the existing cases' shape" because the verb's flag was not measured while writing this — that is an instruction to measure, not a TBD. Task 5's extractor bodies are deliberately left as signatures with a named precedent (`gen-wrappers.test.ts`) because transcribing a parser from a file the implementer must read anyway is how transcription errors enter.

**Type consistency.** `probeModel` is spelled identically in Task 6 and in `ccd/ccgpt-usage.py` (D-3158). `authDir` matches spec §5.4's "auth dir" and Plan 2a review I-2. The four executable names are spelled identically in Tasks 1, 2, 4, 5 and 7.

**One risk this plan cannot resolve.** Task 1 creates fixture *stubs* for `ccgpt` and `ccgpt-runtime` because Plan 2b-2 writes the real files. Every placement assertion in Tasks 2–5 therefore proves the spine places *a file at that path*, not that it places a working launcher. That is the honest limit of testing placement before the thing placed exists, and Plan 2b-2's first task must delete those stubs and re-run these suites — if it does not, they keep passing against stubs forever. **Say so in 2b-2's Task 1.**

## Carry-forward to Plan 2b-2 and Plan 3

Every obligation this plan hands on, collected by the final review from the SDD ledger (which is not tracked)
so that it reaches a place the next author reads. Each names its source; nothing here is done in 2b-1.

**Plan 2b-2 — the lane runs**

1. **Placing `ccgpt` IS the cutover.** On the operator's fleet box `~/.local/bin/ccgpt` is OpenClaw's LIVE
   launcher (beside its `ccgpt-proxy` and `ccgpt-usage`, both without `.py`). 2b-2 must not overwrite it silently:
   an ownership check, a distinct name, or an explicitly authorised swap (D-3172 is the same class, measured).
2. Write `ccd/ccgpt` and `ccd/ccgpt-runtime`, and IN THE SAME COMMIT add them to `_inst_bins` (behind spec §11's
   `!= server` gate, as the two `.py` files now are) and both of its echo lines; both bin-directory `toEqual` arrays
   in `ccrc-install.test.ts` and its placement tests; `_uninst_tree_bins`' `rm -f`, prose and echo; and `deploy.sh`'s
   `install_atomic` — BELOW the lines `ccd/ccrc-doctor-checks` cites (D-3170). The census guard and the "every
   installer source is tracked" guard enforce the rest (D-3165).
3. Add both dotless names to `_uninst_wrappers`' exclusion `case` (spec §5.1), implement spec §5 Pin 4's three-list
   derivation in BOTH directions, and correct `TOOLCHAIN_EXECUTABLES` accordingly (D-3173). Add spec §5 Pin 3's
   witness-index pin.
4. The two real bash files join `macos-platform.test.ts`' GNU-spelling corpus automatically: carry no un-shimmed
   GNU call, or add an `unowned` entry naming what they spell.
5. Give `ccgpt-usage@.service` the isolated runtime's interpreter — not a `PATH` line and not the `readlink`
   idiom; the fleet box's `env python3` silently imports a third-party litellm fork (D-3164).
6. `ccgpt` reads `units`, ports and `authDir` from `lane.json` and never re-derives them (spec §5.4).
7. `lane.json`'s trigger set is incomplete: `ccrc models <id> init codex` on an EXISTING registry does not
   materialise, `ccrc wrappers` and `ccrc models litellm` never do, and a hand edit of ports or `authDir` leaves it
   stale until the next registry mutation. `ccgpt` must render `lane.json` itself or refuse naming a verb that works.
   A lane with no class registry gets none until `init codex`.
8. The codex arm of `_acct_remove` must reap `lane.json` (and `runtime.env`); otherwise a re-added id inherits the
   old lane's `authDir` and ports — the wrong-lane-OAuth class. `models-op.mjs`' `rm` comment names this owner.
9. `runtime.env` lands in `~/.ccrc/codex/<id>/`, which the materialiser creates 0700 only when it first makes it; a
   later `mkdir` cannot tighten an existing directory. Write `runtime.env` 0600 itself.
10. `_models_summary` in `ccd/ccrc` never prints `.remedy`, so every `ccrc models` remedy — this plan's
    haiku-unassigned warning and `init`'s — reaches only `--json` callers.
11. The §7 lifecycle: `_svc_run_supervised`, `_inst_enable`'s restart-after-update, the `nohup` fallback; replace the
    OpenClaw suite's stale `nohup` pins rather than copying them (Plan 2a).

**Plan 3 — lifecycle, doctor, cutover**

12. The usage timer's cutover: take over (or rename past) the `ccgpt-usage@` template OpenClaw owns, retire its fixed
    `ccgpt-usage.timer`, and only then place the pair and enable `ccgpt-usage@<id>.timer` per adopted lane with
    `_check_codex` — after `ExecStart` resolves the runtime interpreter (D-3172, D-3164).
13. At cutover, rewrite deliberately — never delete — the install argv census that asserts no `ccgpt-usage` enable,
    and the fixture that proves a foreign `ccgpt-usage@` pair survives install and uninstall.
14. Decide whether uninstall sweeps `ccgpt-usage@<id>` INSTANCES, against the `claude-session@` precedent (D-3167).
15. Amend spec §4.2, give `doctor --fix` a `lane.json` arm, and only then fix the publisher's absent-file remedy,
    which still says `ccrc doctor --fix`.
16. `_check_codex` must catch: a stale `lane.json` after a codex→external flip; a non-codex registry on a codex-kind
    lane; a retired haiku still written as `probeModel`; roster-edit staleness.
17. Per-lane `litellm.yaml`; the probe's `authDir` (Plan 2a); whether macOS gets a launchd equivalent for the timer.

**Unowned, or the operator's**

18. `models-op.mjs` opens its predictable tmp names without `O_EXCL` and writes its files in an order a failure can
    leave out of step — a pre-existing idiom shared with `writeRegistry`.
19. `ccrc-uninstall.test.ts` (~:360-371) is a hand-written absence list that omits the `ccd-usage-sweep` pair.
20. `agent/test/deploy-verify.test.ts` already RUNS `deploy.sh`'s unit chain in a fixture HOME, but its landed list is
    hand-typed and omits the GPT-lane files; deriving it from `_inst_units` is the stronger, execution-level check.
21. `deploy.sh` places `ccrc-api` and `ccrc-models-probe`, which `ccrc install` never places.
22. `ccd/ccrc-doctor-checks` carries two `deploy.sh` line citations that main's #168 had already made stale.

## Deviations found

- **D-3164 — `ccgpt-usage@.service` ships an `ExecStart` that cannot import `litellm`, and the
  remedy is deferred to the plan that defines the runtime.**

`ccd/ccgpt-usage.py:229` does `from litellm.llms.chatgpt.authenticator import Authenticator`.
Its shebang is `#!/usr/bin/env python3`, so the interpreter comes from whatever PATH systemd's
user manager supplies — and `litellm` lives in a venv, not in system site-packages, on the
fleet host. On a box whose `python3` cannot see litellm, an armed instance would `ImportError`. **Corrected by the final
review:** on the operator's fleet box `python3` DOES import a litellm — a third-party fork in user site-packages —
so the failure there is silent, not loud, which is worse.

The remedy is NOT a `Environment=PATH=…` line. Measured: this tree's established idiom for
"python that can import litellm" is `ccd/ccrc-models-probe:159-161`, which derives the venv
interpreter from the `litellm` console script's own real path —

```bash
venv_py="$(dirname "$(readlink -f "$(command -v litellm)" 2>/dev/null)")/python"
[ -x "$venv_py" ] || venv_py="python3"
```

— and whose comment records that this is "`ccgpt-usage`'s own preamble, verbatim in intent".
`%h/.local/bin` holds the `litellm` console script, not a `python`, so a PATH line would not
make `env python3` resolve the venv. `ccrc-models.service:7`'s PATH line solves a different
problem: its `ExecStart` is `ccrc`, a bash script that needs to FIND the `litellm` binary.

**Why it is recorded rather than fixed here.** Plan 2b-2 builds the lane's isolated LiteLLM
runtime, which is precisely where "which interpreter has litellm" is answered. Writing an
interpreter resolution now would hard-code an assumption that deliverable is about to define,
and would have to be rewritten by the task that defines it.

**Why it is safe to ship — as corrected by D-3172.** The first version of this paragraph said the unit was
"inert until Plan 3 arms a lane"; that was false, because an instance of the same NAME was already enabled on
the fleet box (OpenClaw's). Under D-3172 Plan 2b-1 places this pair nowhere, so the unit file is now genuinely
inert: it ships in the tree, referenced by no installer. The original argument was that nothing in Plan 2b-1
enables, starts or `daemon-reload`s an instance of this template — the guard for that is an argv census over the recorded `systemctl`
calls, measured red under mutation. The unit is an inert file until Plan 3 arms a lane.

**Binding, and the owner is split:** Plan 2b-2 builds the isolated runtime and so decides the interpreter;
Plan 3 arms the unit and must not enable any instance before `ExecStart` resolves it. `ExecStart` must resolve
the runtime's interpreter before any instance is enabled. The service file carries this as a comment so the reader who arms it
cannot miss it. Found by the Task 3 review.

- **D-3165 — Task 2 places TWO executables, not the plan's four; the plan's four would have aborted every
  real install.** The plan had `_inst_bins` place `ccgpt`, `ccgpt-runtime`, `ccgpt-proxy.py` and
  `ccgpt-usage.py`. Measured: `ccd/ccgpt` and `ccd/ccgpt-runtime` do not exist in the tree (Plan 2b-2 writes
  them), `_inst_atomic`'s first act is `[ -f "$src" ] || _ccrc_die`, and `_inst_tree` runs immediately
  before `_inst_bins` — so `ccrc install` / `ccrc update` would have died with the box's tree already
  replaced. The suite was green only because Task 1 planted both names as `TREE_STUBS`: the fixture stub is
  what hid it. The plan's own "one risk" sentence ("proves the spine places a file at that path, not a
  working launcher") understated it by a category. Shipped in `56cfdafe`: only the two `.py` files are
  placed; `ccgpt` and `ccgpt-runtime` join `_inst_bins`, both echoes, both census arrays and both uninstall
  censuses in Plan 2b-2, IN THE SAME COMMIT that writes the files. Invariant: every commit on `main` must be
  installable. This REVERSES Plan 2a's "Placement is indivisible" rule ("all four placements live in one plan"),
  and says so: that rule assumed all four sources exist, and an installer that aborts outranks a reviewable diff.
  The final review found the invariant pinned by nothing and the two stubs that hid the defect still planted:
  `13b10598` deletes them and adds a DERIVED guard — every `"$tree/<path>"` source the installers read (and every
  source `deploy.sh` places) must be tracked — measured red under a premature `ccgpt` placement that every other
  suite let through. `b55f82dc` gates the two files `!= server`, which spec §11 requires in terms ("The gate is
  `!= server` … a departure and the plan says so") and this plan never said. Three details of Task 2's text were
  also wrong: the `install: bins:` echoes are guarded by a DERIVED case, not by `toEqual` (the `toEqual` is over the
  bin directory); its mutation assumed a second platform arm that does not exist; and `ccgpt-usage.py` IS
  timer-run, which is why the echo's `.py` filter became a named list. Also shipped: the echo line's derived guard lost its blanket `.py` filter for a named
  exemption list, because `ccgpt-usage.py` has no non-`.py` sibling to carry it. Found by the Task 2 review.

- **D-3166 — Task 3's timer anchors on `OnActiveSec=`, the pair is role-gated, and the plan's "enables
  nothing" assertion was vacuous by construction.** The plan specified `OnBootSec=2min`; three of the eight pre-existing
  timers (`ccd-account-health`, `ccd-telemetry-keepalive`, `ccd-usage-sweep`) use `OnActiveSec=`, the last two for a
  stated reason (a unit first armed on a box up for days), which binds harder for a
  lane armed at adoption — shipped `OnActiveSec=5min` (`22e40836`). The plan was silent on role; every
  account-bearing pair in `_inst_units` is gated `!= server`, and so is this one, tested in both directions.
  The plan's `timers.target.wants` readdir assertion could not fail: the fixture's `systemctl` stub answers
  `enable` with `exit 0` and writes no symlink, so it was deleted (`1b1d9fcc`) and the argv census over the
  recorded `systemctl` calls is the guard. The plan's literal `Unit=ccgpt-usage@%i.service` was omitted: the
  timer's default target carries the instance (`man 5 systemd.timer`; shipped precedent
  `mdadm-last-resort@.timer`). The plan's `After=network-online.target` was removed: that target is absent from the user manager's search
  path, so the line was inert. The plan's scope boundary — install the templates, enable no instance — survived
  every per-task review and was then SUPERSEDED by D-3172: the final review found the templates' name occupied by a
  live, enabled unit on the fleet box, so Plan 2b-1 now installs neither. Found by the Task 3 implementer and review.

- **D-3167 — Task 4 updates THREE copies of the bin census, and removes the template pair by `rm -f` only.**
  The plan named `_uninst_tree_bins`' `rm -f` census alone; the function also carries a prose paragraph
  naming each binary and an `echo "uninstall: tree: …"` summary that `ccrc-uninstall.test.ts` matches by
  binary name, so all three moved (`ddb96faa`, `441415d7`). The `ccgpt-usage@` template pair is removed by
  `rm -f` and deliberately kept OUT of `_uninst_units`' `disable --now` loop. The first comment gave a false
  mechanism ("nothing to disable"); measured on systemd 255, `disable` of a never-enabled unit returns 0
  silently — the failure is `--now`'s stop, which the manager refuses for a bare template name — and the
  shipped comment says so. Sweeping template INSTANCES was left to Plan 3, which writes the `enable`. Under D-3172 the pair is no longer
  removed at all (`090187f8`) — removing it would delete another repository's live unit — so what this entry
  describes for the pair now applies to Plan 3's cutover. The plan's install-then-uninstall snippet also guessed a
  `runUninstall(home, ['--yes'])` harness; the suite's real one is `runVerb(home, 'uninstall', ['--force'])`.
  Found by the Task 4 review.

- **D-3168 — Task 5's census guard resolves variables and fails on any word it cannot read ("no silent
  drops"), where the plan said to follow `gen-wrappers.test.ts` and "not invent a second parsing idiom".**
  `server/test/install-census.test.ts` extracts both censuses from `ccd/ccrc`'s own text, like its
  precedent, but must also resolve `$role_unit`, `${BOX_UNIT_NAMES[n]}` and the graphify symlink's second
  placement source — so it carries a small resolver (ruled by the review a justified extension of the
  idiom, not a second one). It does NOT inherit the precedent's `.filter(n => !n.includes('.'))`, which
  would drop all three `.py` names from both sides. After three adversarial review rounds it installs one
  principle — every word under a scope prefix resolves to a name or FAILS the suite by name — and its header
  lists the shapes it declares out of scope. Its regression control is a 177-row mutation union whose
  verdicts at `d7cc9559` were reproduced by an independent verifier with zero disagreements.
  Commits `5895add7`, `e5f0afd1`, `fbfb4eac`, `d7cc9559`, then `bbeb9998` (the close-check's residuals) and
  `0c46b822`, `13b10598`, `d214684c` (the final fix). One justification in the plan's text is overstated: of the
  three incidents it cites as "gone stale three separate times", D-1347 was list drift, while D-2594 and the
  routing slice were PROSE staleness — the guard's header now says so.

- **D-3169 — Task 6 derives `probeModel` from the lane's class registry, writes `lane.json` 0600 in a 0700
  directory, and gates it on `exec.kind === 'codex'` — three departures from the plan's text.** The plan said
  to derive `probeModel` "from the `codex` class entry's existing `probe` field"; `SEEDS.codex.probe` is the
  string `'codex'`, a probe KIND, and would have put a non-existent model in every usage poll's `body.model`.
  Shipped: the registry's `haiku` class, omitted (not null) when unassigned. The plan said 0644; the house
  rule (`models-op.mjs`'s `writeRegistry` comment) is 0600 for any file another process reads. The plan was
  silent on the gate; today's live Codex lanes are `external` rows with no `authDir` or ports, and the writer
  reads the roster raw, so only a `codex`-kind row gets a manifest — pinned against a LIVE-SHAPED external
  row, because a fixture with the wrong shape let a telemetry- or provider-based gate pass all 240 cases.
  The plan's Step 1 verb (`litellm --account`) never reaches the materialiser. Commits `6345fcd3`,
  `b945daee`, then `bbeb9998` (prose) and `a544ac42` (the publisher's docstrings and its authDir remedy). Found by controller pre-flight and the Task 6 review.

- **D-3170 — Task 7's premise was wrong in shape: `deploy.sh` ships whole trees, and the real gap was its own
  placement census.** The plan asked for a test that `deploy.sh`'s "pushed pathspec" includes the new files.
  `deploy.sh` has no pathspec: it `rsync --delete`s whole directories, so the files already reached the box.
  What it lacked was PLACEMENT — its own `install_atomic … .local/bin/<X>` and `_unit_atomic …` lists, a
  third hand-kept census of the class this plan exists to end. Shipped (`23711f34`): the two `.py` bins and
  the unit pair placed, NOTHING added to its enable chain, and the test in `install-census.test.ts` (not
  `deploy-coordinates.test.ts`) as a derived install-subset-of-deploy case over the union of `deploy.sh`'s
  lanes, red first on exactly the four GPT-lane names. `bbeb9998` moved every insert below the lines two
  `ccd/ccrc-doctor-checks` citations point at (that file is under this plan's cut, so position was the decision), and
  proved every tracked `deploy.sh:<N>` citation that was accurate still is. Under D-3172, `090187f8` then took the
  unit pair back out of `deploy.sh`'s chain, and `d214684c` keeps its enable rule covering every template the repo
  SHIPS, so an instance enable of `ccgpt-usage@` still reds. The reverse direction is deliberately not asserted:
  `deploy.sh` also places `ccrc-api` and `ccrc-models-probe`, which `ccrc install` never places — a
  pre-existing divergence between the two installers, outside this plan.

- **D-3171 — the Global Constraints' "`ccd/ccd` and `ccd/ccrc` are GENERATED and must be re-stamped" is false
  for `ccd/ccrc`.** Measured: `ccd/ccrc` carries no provenance marker (`grep -c '^# ccrc:generated' ccd/ccrc`
  → 0); only `ccd/ccd` does, and `ownership.test.ts` reads only `ccd/ccd`. Tasks 2, 3 and 4 each carried a
  "re-stamp `ccd/ccrc`" step; running `markGenerated` on it would have inserted a provenance line into a
  hand-maintained file that nothing scans. No task re-stamped it; each still ran `ownership.test.ts`. The
  sentence ORIGINATED IN THIS PLAN: the controller wrote it from a context summary that labelled it "verbatim,
  from CLAUDE.md". `CLAUDE.md` contains no such sentence (measured by the final review, `git grep`), so an earlier
  version of this entry — which blamed `CLAUDE.md` and recorded a correction owed there — was itself false. No
  `CLAUDE.md` change is owed.

- **D-3172 — the `ccgpt-usage@` unit pair is NOT placed by Plan 2b-1; its placement is deferred to the plan
  that owns cutover.** Tasks 3, 4 and 7 placed, removed and deployed the pair under the Architecture sentence
  "installs but does not enable … installed and inert". That was true of the installer and false in effect: on the
  operator's fleet box the name is occupied — `~/.config/systemd/user/ccgpt-usage@.service` and `@.timer` belong to
  the OpenClaw repository, and an instance of that template — one of the operator's live Codex lanes — is ENABLED (measured read-only by the
  controller, 2026-09-23). The next rollout would have replaced a live, enabled timer's definition, and
  `ccrc uninstall` would have deleted another repository's live unit — against the standing ruling that ccrc writes
  only what it owns. Every fixture HOME is empty, so no suite and no per-task review could see it; the final
  review's security and fidelity lenses found it independently. Shipped (`090187f8`): `_inst_units`,
  `_uninst_units` and `deploy.sh`'s chain name no `ccgpt-usage@` unit; `deploy/systemd/ccgpt-usage@.{service,timer}`
  still ship, referenced by no installer (Plan 2a's precedent for its `.py` files); a fixture test plants a foreign
  pair plus an enabled-instance link and proves install AND uninstall leave all three byte-identical. Replacing that
  unit IS the cutover (spec §15 step 3, separately authorised): Plan 3 designs it — an ownership check, or a
  rename that makes the swap explicit. The same class, larger: `~/.local/bin/ccgpt` on that box is OpenClaw's live
  launcher, so Plan 2b-2 placing ccrc's `ccgpt` is ALSO the cutover (see the carry-forward section). This entry
  supersedes the placement parts of D-3166, D-3167 and D-3170.

- **D-3173 — the self-review's "the `TOOLCHAIN_EXECUTABLES`/`_inst_bins` agreement is already green (Plan 1, and
  `gen-wrappers.test.ts` derives it both directions)" is false.** Spec §5's Pin 4 asks that `TOOLCHAIN_EXECUTABLES`,
  `_uninst_wrappers`' exclusion `case` and `_inst_bins` agree on the dotless names, derived both directions.
  Measured by the final review: `gen-wrappers.test.ts` (~:394-410) derives ONE direction (every dotless name
  `_inst_bins` places is in `TOOLCHAIN_EXECUTABLES`); `TOOLCHAIN_EXECUTABLES` names `ccgpt` and `ccgpt-runtime`, which
  `_inst_bins` does not place (D-3165); and `_uninst_wrappers`' `case` names neither. The pin comes due when the
  dotless names are placed — Plan 2b-2's first commit, which must implement the three-list derivation in both
  directions. Spec §5's Pin 3 (the witness index still counts a box whose only launchers are Codex lanes) likewise
  has no test and no owner in this plan: Plan 2b-2.

_(Numbers are API-issued — `POST /api/ledger/deviations` — and defined in the same act. D-3150–D-3163 are already defined in Plan 2a; never reuse or guess one.)_

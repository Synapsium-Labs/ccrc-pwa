# Terminal drawer — wave 4: the whole-branch pass, the docs, and the ledger — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the terminal-drawer program by making every operator-facing sentence about it true and holding it there with a mechanism — the README's whitelist rationale, Deploy ordering, the new route and the new wire frame; `CLAUDE.md`'s measured sentence beside SAFETY; the §2 measurements re-run against the shipped comments that quote them; the deviation ledger reconciled; the PR #94 residual reported to its author with its source citation; and one whole-branch review of waves 1–3 together.

**Architecture:** This wave writes **no behaviour**. It CONSUMES everything waves 1–3 shipped (`PaneProbe` and `Tmux.paneProbe`/`Tmux.captureHistory` in `server/src/exec.ts`; `PANE_HISTORY_LINES`, `READER_MIN_COLS`, `STALL_BUDGET_LINES`, `PaneHistoryReply`, `PaneGridReason` and `PaneGridFrame` in `shared/api.ts`; `GET /api/sessions/:id/pane/history`; `ccd win-size --session <id> --mode smallest|canonical` and its `win-size-v1` capability; the `['win-size','--session']` grant and its `REQUIRED_VERB_FLAG` enrolment; `_pane_measurable` in `ccd/ccd`; `fitFloor` in `server/src/pane/fit.ts`; the `WindowSizer` port in `server/src/pane/sizer.ts`; the `grid` frame on `/ws/pty/:id`) and PRODUCES prose, a program ledger, and one new suite that holds the prose to the code it describes. Every assertion in that suite is grounded in the file it describes — `shared/api.ts`'s own exported constants, `server/src/pane/fit.ts`'s own comment, `ccd/ccd` itself — never in a fixed sentence a later edit could silently falsify. The one number this wave writes by hand (`CLAUDE.md`'s README line-count claim) is re-measured, not carried.

**Tech Stack:** Markdown (`README.md`, `CLAUDE.md`, `docs/superpowers/programs/terminal-drawer.md`), TypeScript (vitest — one new suite, `server/test/drawer-prose.test.ts`), bash + tmux 3.4 on a **private socket** for the §2 re-measurement, `gh` for the PR #94 report, `ccd/ccrc-api` for the ledger read.

**Spec:** `docs/superpowers/specs/2026-09-14-terminal-drawer-history-and-fit-design.md` (§8 is this wave; §2 is the measurement table it re-runs)

**Execution base:** fetch `origin/main` and execute from the commit that carries waves 1–3 merged; record that full SHA before Task 1. Branch: `ws/<the workspace the coordinator dispatches into>` — a worker commits on its workspace branch only (worker skill clause 2), never a separate feature branch.

**Deploy class for THIS wave: none.** The spec's wave table (§4) marks wave 4 `—`. This plan's file set touches nothing under `ccd/`, nothing under `session-hook.sh`, and nothing under `ccd/coordinator-skill/` or `ccd/worker-skill/`, so CLAUDE.md's AGENT-FIRST rule does not bind it and there is no agent deploy step. A docs-only outcome ships nothing at all. If Task 2's re-measurement finds a **shipped comment in `ccd/`** that no longer matches its measurement, correcting it is a departure from this plan: allocate a number, record it under `## Deviations found`, and ship that correction AGENT-FIRST (fleet host before server) as CLAUDE.md requires.

---

## Global Constraints

Copied verbatim from `CLAUDE.md` and the spec. Every task's requirements implicitly include this section.

- **Node floor `>=22.13.0`, identical across the three engines**, pinned by `server/test/node-floor.test.ts`. If node-floor's absolute assertion (3) is red while (1–2) are green, **RAISE engines — never lower them to make it green.**
- **No root `package.json`, no root runner.** Four packages, each `"type":"module"`, run cd'd in: `server/` `agent/` `pwa/` `shared/`.
- **Single suite: `./node_modules/.bin/vitest run test/foo.test.ts` from inside the package. NEVER bare `npx vitest`** — it resolves a global copy with no jsdom and falsely reports "no tests". **Run suites in the FOREGROUND, timeout ≥600000ms.**
- **Known load flakes** (re-run IN ISOLATION before calling a real break): `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`.
- **Rings / bounded contexts.** Ring membership is a property of a file's IMPORTS, not its path. L0 `shared/*.ts` imports NOTHING (not even `node:*`); L1 policy = pure decisions, no `fs`/fastify/`reply`; L2 ports = interfaces + failure contracts, declared BY THE CONSUMER; L3 adapters — **an adapter may not narrow a distinction it received**; L4 delivery owns fastify/sockets/timers but is NOT allowed to DECIDE; L5 = `index.ts` only. This wave adds no source file to any ring; its one new file is a test.
- **No overloaded null at a seam** — two conditions a caller handles differently must not collapse to the same value; that's a defect, not style. The prose in this wave must keep `gone` / `unreadable` / `unparseable` apart, and `'ok' | 'unsupported' | 'failed'` apart, exactly as the shipped types do. A sentence that folds them is how the folding gets built next.
- **Wire discipline — additive-only, absence-permits.** `FLEET_PROTO` stays 1 (`FLEET_PROTO_MIN` 1, defined once in `shared/api.ts`); frames are ADDITIVE. This wave changes no wire type, and its prose must not describe a bumped protocol.
- **Single-source-of-truth values are enumerated once and derived.** `server/test/single-definition.test.ts` text-scans four roots (`shared`, `server/src`, `pwa/src`, `agent/src`) and fails the build on a 2nd copy. `server/test` is **not** one of those roots, which is why this plan's local README/`CLAUDE.md` slicing helpers — the same shape `server/test/readme-holds.test.ts:27` already spells locally — are not a second definition of anything the guard governs.
- **Mutation-table discipline:** a new guard ships WITH a test that goes RED when the guard is deleted/mutated (measured before/after, not a comment). Doctrine: "A comment is a request; a red suite is a mechanism." TDD red-first. Every prose correction in this wave ships with an assertion that reds when the paragraph is deleted.
- **In tests, use FIXTURE HOMEs only — never run `ccd` against the live `$HOME`.** No test in this plan runs `ccd`; every assertion is a read of a TRACKED file in this checkout. `ghContainedEnv()`/`makeCcdHarness()` are unused here.
- **NEVER run destructive `ccd` verbs against the live host** (`ws-rm`, `ws-reap`, `ws-gc --prune`, `ws-archive`/`ws-restore`) and **NEVER touch tmux, `~/.cc-sessions`, `~/.cc-limits`, or `claude-session@*.service` directly.** Task 2's mutating measurements run on a **private tmux socket** (`tmux -L ccrc-w4-…`), killed at the end of the step; its live-fleet read is `tmux list-panes -a -F` and nothing else.
- **NEVER print secret file CONTENTS.** Nothing in this plan reads `~/.cc-secrets` or `~/.ccrc/mail.token`. `ccrc-api` is the only path to the box token and it never prints it.
- **No real host, IP, tailnet name, DuckDNS name or fleet-account label anywhere** — source, test, README, ledger, or this document. `server/test/topology-clean.test.ts` scans every tracked file, docs included. Task 2's census is recorded as **counts and distributions only**, never a session name.
- **`EXEC_COMMANDS = ['tmux','ccd']` stays closed; `gh` gets no grant, ever.** Wave 2 added one `ccd` prefix inside the existing `ccd:` array; the key count stays two, and prose implying otherwise is false.
- **Deviation numbers come only from the allocator.** Numbers are ISSUED, never chosen — see `## Deviations found`. `server/test/dtbd.test.ts` reds the tree on any concrete `D-TBD-<slug>`.
- **README is canonical; `CLAUDE.md` is the non-obvious operational rules.** New prose goes to README; `CLAUDE.md` gains exactly two edits in this wave (Task 4), both named there.

---

## File Structure

| File | Change | Task | Responsibility after this wave |
|---|---|---|---|
| `docs/superpowers/programs/terminal-drawer.md` | **Create** (Task 1; appended by Tasks 2 and 5) | 1, 2, 5 | The program's memory: four wave rows with their PRs, the Fable rulings, the **carried constraint** (PR #94's residual with its citation), the re-measurement table, and the ledger reconcile |
| `server/test/drawer-prose.test.ts` | **Create** (Task 1; appended by Tasks 2, 3, 4) | 1, 2, 3, 4 | The ratchet: every sentence this wave writes is held to the code, the constants and the spec it describes |
| `README.md` — new `## The terminal drawer…` section inserted immediately before `## Remote fleet mode` (`:1142`) | Modify | 3 | The whole drawer story: the pinned window, the history route, the `grid` frame and its three reasons, the un-pin verb and its capability gate, and the readers' stand-down |
| `README.md:1288` — inside the **Exec whitelist** bullet, between "…goes through a `ccd` verb instead." and "Anything else comes back" | Modify | 3 | The whitelist rationale gains the sentence that says `win-size` is a **fleet-control** verb, outside the coord-mutation rule, and enrolled in `REQUIRED_VERB_FLAG` |
| `README.md` — Deploy's **Ordering between the two targets** paragraph (`:2577`–`:2586`) | Modify | 3 | `ccd win-size` named as the third AGENT-FIRST case, with its own edge (a capability gate, not a verb gate) |
| `CLAUDE.md` — new bullet at the end of `## SAFETY` (after `:65`, before `## Build / test / deploy` at `:67`) | Modify | 4 | The spec's measured sentence, verbatim |
| `CLAUDE.md:10` | Modify — one number | 4 | The README size claim, re-measured after Task 3's growth |

**Prose pins this wave must not break.** These were measured on the planning snapshot; before each edit, locate the named passage on the execution base and preserve intervening work.

| Suite | What it asserts, and what it means here |
|---|---|
| `server/test/oss-metadata.test.ts:88-102` | `CLAUDE.md`'s `` `README.md` (~N lines) `` claim must be within 10% of the real count. It stands at **~2485 said / 2713 real = 8.4% off on the planning snapshot** — already close, and Task 3 grows README. **Task 4 Step 5 re-measures it; skipping that reds this suite.** |
| `server/test/box-token-census.test.ts` | Three README slices — `'What is gated, and what is not:'` → `'Enrolling a passkey'`, `` '`/api/mail` (and its ack route)' `` → `'Minting the token file matters'`, and `'**Caps and pause.**'` → `'Pause is a'` — each required to carry **no number word at all**. Every edit in this plan lands outside all three (the session-gate section runs `:540`–`:551`; the mail/caps passages sit at `:1655`–`:1685` and `:1691`–`:1705`; Task 3 inserts at `:1142`, `:1288` and `:2577`). |
| `server/test/readme-holds.test.ts:27-45` | `holdsSection()` slices `'### Workspace holds & programs'` (`:1479`) to the next `\n## `, and `lifecycleSection()` slices `'**Run lifecycle**'` to `'**The mail bus and its token.**'`. Both are far from every edit here; both must stay byte-identical. |
| `server/test/ccrc-install-graphify.test.ts:648-668` | Two NEGATIVE scans over the WHOLE README: no present-tense verb (`converges\|writes\|installs\|plants\|puts`) within 140 characters of `block`/`read rule` and `CLAUDE.md`, and none within 140 characters of `always_on/claude-md.md`. **New README prose must not name `CLAUDE.md` at all.** |
| `server/test/worker-skill.test.ts:118-134`, `server/test/coordinator-skill.test.ts` | Every mention of `ccd/worker-skill/SKILL.md` in README or `CLAUDE.md` must state "thirteen clauses" within 160 characters; the coordinator skill likewise pins eleven. **Do not name either skill path in new prose.** |
| `server/test/topology-clean.test.ts` | Every tracked file, docs included: no operator host, address, tailnet or account residue. Task 2's census records counts, never names. |
| `server/test/license.test.ts:105-127`, `server/test/ccrc-update.test.ts:929-930` | README's `## License` section and its `bash ≥ <floor>` claim. Untouched. |
| `server/test/single-definition.test.ts` | Four TS roots — no second copy of a single-source value. Task 2's pins **import** `shared/api.ts`'s constants rather than re-spelling them. |
| `server/test/dtbd.test.ts` | `git grep` over every tracked file: no concrete `D-TBD-<slug>` may land. |
| `server/test/deviation-refs.test.ts` | Compares this branch's plan entries against `origin/main`'s **without merging**; run after `git fetch origin main` (Task 5). |

**Mutation table for this wave.** Each task names the row it discharges and measures it red before/after.

| Row | Guard | Red when |
|---|---|---|
| W4-1 | the program ledger | a wave row loses its PR or its state; the carried constraint loses PR #94's number, the `readstdin` symbol, or the `ccd/ccd-account-auth` citation |
| W4-2 | the §2 comment truth | a falsified "never reflows" phrase reappears anywhere under the four TS roots, in `server/test/pane-history-route.test.ts`, in README or in `CLAUDE.md`; `server/src/pane/fit.ts` loses the alt-exit measurement; `PANE_HISTORY_LINES`/`STALL_BUDGET_LINES` drift off their measured values |
| W4-3 | README's drawer section | the section is deleted or renamed; it stops naming the route, the `grid` frame, all three `PaneGridReason` values, the verb's two modes, `win-size-v1`, or the readers' stand-down; a `PaneGridReason` exists that it does not name |
| W4-4 | README's whitelist rationale and Deploy ordering | the `win-size` sentence is deleted, or stops calling it fleet-control, or stops naming `REQUIRED_VERB_FLAG`; the Deploy paragraph stops naming `win-size` |
| W4-5 | `CLAUDE.md`'s measured sentence | the sentence is deleted, reworded, or stops naming `window-size latest`, `history-limit`, `manual`, `ccd win-size`, `resize-window`, or `set-option window-size smallest\|latest` |
| W4-6 | the whole tree | `topology-clean`, `single-definition`, `dtbd`, `deviation-refs` or `oss-metadata` red after the last edit |

---

### Task 1: The program ledger, and PR #94's residual reported to its author

Discharges W4-1. Spec §8 bullets 1 and 4 (the carried constraint). **Model routing: sonnet@high** — transcription-grade prose from a citation this plan carries; not one of §9's three opus-routed tasks.

**Files:**
- Create: `docs/superpowers/programs/terminal-drawer.md`
- Create: `server/test/drawer-prose.test.ts`
- Test: `server/test/drawer-prose.test.ts` (new)

**Interfaces:**
- Consumes: nothing from waves 1–3 (this task reads only tracked docs).
- Produces: `docs/superpowers/programs/terminal-drawer.md` with the four sections `## Waves`, `## Decisions & deviations`, `## Carried constraints`, `## Next-wave brief` — Task 2 appends `## Measurements` and Task 5 appends `## Ledger reconcile`. `server/test/drawer-prose.test.ts` with the module-level helpers `read(rel: string): string` and `section(text: string, heading: string): string`, both consumed by Tasks 2, 3 and 4.

- [ ] **Step 1: Write the failing test**

Create `server/test/drawer-prose.test.ts`:

```ts
// The terminal-drawer program's prose ratchet (spec §8). Every sentence waves 1-4
// wrote about the drawer is held HERE to the code, the constants and the citation
// it describes — never to a fixed sentence a later edit could quietly falsify.
// `server/test` is not one of `single-definition.test.ts`'s four ROOTS, which is
// why the two local helpers below are not a second definition of anything: the
// same shape `readme-holds.test.ts:27` already spells locally.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string): string => readFileSync(path.join(root, rel), 'utf8');

/** One heading's section alone — from the heading to the next heading at the
 *  SAME level — so a match anywhere else in a 2700-line README cannot satisfy an
 *  assertion about this paragraph. */
const section = (text: string, heading: string): string => {
  const start = text.indexOf(heading);
  expect(start, `heading not found: ${heading}`).toBeGreaterThan(-1);
  const level = /^#+/.exec(heading)![0];
  const end = text.indexOf(`\n${level} `, start + heading.length);
  return text.slice(start, end === -1 ? undefined : end);
};

const LEDGER = 'docs/superpowers/programs/terminal-drawer.md';

describe('the program ledger records the program (W4-1)', () => {
  it('carries the four sections the template names, in order', () => {
    const led = read(LEDGER);
    const order = ['## Waves', '## Decisions & deviations', '## Carried constraints',
      '## Next-wave brief'].map((h) => led.indexOf(h));
    expect(order, 'a section of the template is missing').not.toContain(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('names all four waves with a state, one row each', () => {
    const waves = section(read(LEDGER), '## Waves');
    for (const n of ['1', '2', '3', '4']) {
      expect(waves, `wave ${n} has no row`).toMatch(new RegExp(`^\\| ${n} \\|`, 'm'));
    }
  });

  it('carries PR #94 as a CARRIED CONSTRAINT, with the symbol and the in-tree citation', () => {
    const carried = section(read(LEDGER), '## Carried constraints');
    // The residual is Apple's, but the line that meets it is ours: name both, so a
    // reader can reach the evidence without this file being the evidence.
    expect(carried).toContain('#94');
    expect(carried).toContain('readstdin');
    expect(carried).toContain('script.c');
    expect(carried).toContain('ccd/ccd-account-auth');
    // ...and the statement that this program depends on neither PR (spec §8).
    expect(carried).toMatch(/no dependency|takes no dependency/i);
  });

  it('the scan is looking at something — the ledger is a real file with real rows', () => {
    const led = read(LEDGER);
    expect(led.length).toBeGreaterThan(800);
    expect(led.split('\n').filter((l) => l.startsWith('| ')).length).toBeGreaterThanOrEqual(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && ./node_modules/.bin/vitest run test/drawer-prose.test.ts
```

Expected: FAIL — all four tests error with `ENOENT: no such file or directory, open '.../docs/superpowers/programs/terminal-drawer.md'`.

- [ ] **Step 3: Write the ledger**

Create `docs/superpowers/programs/terminal-drawer.md`. Replace `<wave N PR>` with the real PR number as each wave merges; at this task's own commit, waves 1–3 are merged and their numbers are known from `git log --oneline origin/main | head -20`.

```markdown
# Program: terminal-drawer
Spec: `docs/superpowers/specs/2026-09-14-terminal-drawer-history-and-fit-design.md`
Plans: `docs/superpowers/plans/2026-09-14-drawer-wave{1,2,3,4}-*.md`
Workspace: the workspace the coordinator dispatched each wave into

## Waves

| # | scope | PRs | state |
|---|---|---|---|
| 1 | the latch (`resize-window` before `spawnPty`), the measured `PaneProbe`, `GET /api/sessions/:id/pane/history`, the drawer's history layer with §5.4's corrections | <wave 1 PR> | merged |
| 2 | `ccd win-size --session <id> --mode smallest\|canonical`, the `win-size-v1` capability, the `['win-size','--session']` grant with its `REQUIRED_VERB_FLAG` enrolment and bypass fixture, `_pane_measurable` and the readers' stand-down (AGENT-FIRST) | <wave 2 PR> | merged |
| 3 | `fitFloor` (L1, pure), the `WindowSizer` port, the deliberate un-pin under the fit guard, the `grid` frame, the refcount/ping/boot sweep, the mail lane's `auto-continue-unmeasured` hold | <wave 3 PR> | merged |
| 4 | the whole-branch pass, README, the `CLAUDE.md` sentence, the §2 re-measurement, the ledger reconcile | <this PR> | open |

## Decisions & deviations

The eight Fable rulings are recorded in the spec's §11 and are not restated here. What this
ledger adds is the two that a later reader is most likely to try to undo:

- **`smallest`, never `latest`.** `latest` follows the client that most recently TYPED, so a
  phone and a desktop on one session reflow the history on every keystroke alternation and
  shed it once the reflow exceeds the pane's limit. `smallest` is deterministic, stable under
  keystrokes, and self-heals when the narrow client leaves.
- **The un-pin is gated on `capSupported(state, 'win-size-v1')`, never `verbSupported`.**
  `verbSupported` permits when it has no evidence, which is right for a verb that has always
  existed and wrong for one that never did. An un-upgraded fleet box simply leaves the window
  pinned — wave 1 behaviour, no fallback path and no second mechanism.

Deviation numbers are per-plan and issued by the allocator; each wave's plan carries its own
`## Deviations found`. This design minted none of its own: a deviation is a departure from a
PLAN, and PR #96 was never one.

## Carried constraints

**PR #94's `cat` copier, on the darwin arm only — reported, not fixed here.** PR #94 (the
macOS `script(1)` fix) **MERGED as `fb19772e` on 2026-09-14 at 11:50 UTC, and `main` is green on
every leg including `test-macos`** — the four-week red is over and D-2614 is closed. It repaired
D-2614/D-2734 correctly and carries a residual its own text does not name; because the fix is
merged and green, this residual is a **LIVE finding against shipped code, not a pending one**. On
the darwin arm the mint's stdin is a pipe fed by a `cat` copier (`ccd/ccd-account-auth:442` at
`fb19772e`: `< <(exec 7<&- 9<&-; exec cat <"$AUTH_RUN/in.child")`). If that copier dies while the
mint is still running, Apple's `script.c` — the `readstdin` flag in its main poll loop — clears
`readstdin` on the read that returns EOF and never re-arms it on the non-tty path, so the
descriptor is dropped from the loop for the rest of the run. The mint keeps running and keeps
printing, and the operator's code channel is gone with no error anywhere: `_auth_forward_code`
still writes the code to fd 9, the FIFO still accepts it, and nothing reads the other end. The
failure is silent in both directions, which is why it is worth naming. Reported to the PR's
author with this citation, as a finding against merged code.

This program takes no dependency on #93 or #94: nothing in waves 1–3 reads, calls or imports
`ccd/ccd-account-auth`, and the drawer's own path to a pane is `tmux attach`, not `script(1)`.

## Next-wave brief

None. Wave 4 is the last wave; the program closes with its merge. The two follow-ons the spec
names in §10 — width-proof readers that can match a phrase at 43 columns, and a
`history-limit` raise if a later census contradicts F12 — are each their own spec, not a wave
of this program.
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd server && ./node_modules/.bin/vitest run test/drawer-prose.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Report the residual to PR #94's author**

The report is the deliverable; the ledger paragraph is its record. Post it as a comment on the
merged PR so it reaches the author where the work lives:

```bash
gh pr comment 94 --body-file - <<'EOF'
A residual this PR's own text does not name — carried forward from the terminal-drawer
program's spec (`docs/superpowers/specs/2026-09-14-terminal-drawer-history-and-fit-design.md`,
§8), reported rather than fixed, since nothing in that program depends on this path.

On the darwin arm the mint's stdin is a pipe fed by the `cat` copier at
`ccd/ccd-account-auth:442` (`< <(exec 7<&- 9<&-; exec cat <"$AUTH_RUN/in.child")`). If that
copier dies while the mint is still running, Apple's `script.c` clears its `readstdin` flag on
the read that returns EOF and never re-arms it on the non-tty path — the descriptor leaves the
poll loop for the rest of the run. The mint keeps running and keeps printing, so nothing
surfaces; but `_auth_forward_code` then writes the operator's code to fd 9, the FIFO accepts
it, and no one reads the other end. The code channel is silently gone in both directions.

The Linux arm is unaffected: there is no copier there to die.

Not a blocker for anything currently shipping — filing it so the next person in this file has
the citation rather than the symptom.
EOF
```

If `gh` refuses (no token, no network), do NOT invent a substitute channel: record the refusal
under `## Deviations found` with the exact stderr and hand the body to the operator in the
wave-done report. The ledger paragraph stands either way.

- [ ] **Step 6: Mutation check, then commit**

Temporarily delete the `readstdin` sentence from the ledger's `## Carried constraints` section and re-run:

```bash
cd server && ./node_modules/.bin/vitest run test/drawer-prose.test.ts
```

Expected: the `carries PR #94 as a CARRIED CONSTRAINT, with the symbol and the in-tree citation` test FAILS on `expect(carried).toContain('readstdin')`. Restore the sentence and re-run to green.

```bash
git add docs/superpowers/programs/terminal-drawer.md server/test/drawer-prose.test.ts
git commit -m "docs(program): the terminal-drawer ledger, and PR #94's copier residual reported to its author

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Re-run the §2 measurements; every shipped comment still matches them

Discharges W4-2. Spec §2 (the whole table) and §8's "whole-branch pass". **Model routing: sonnet@high** — the same shape §9 routes the `READER_MIN_COLS` measurement to: a measurement with a fixed procedure and no design judgment.

**Files:**
- Modify: `docs/superpowers/programs/terminal-drawer.md` — append `## Measurements` after `## Decisions & deviations`
- Modify: `server/test/drawer-prose.test.ts` — add one `describe`
- Test: `server/test/drawer-prose.test.ts`

**Interfaces:**
- Consumes: `read`, `section` from Task 1. From `shared/api.ts` (waves 1 and 3): `PANE_HISTORY_LINES: number`, `READER_MIN_COLS: number`, `STALL_BUDGET_LINES: number`.
- Produces: the ledger's `## Measurements` section, consumed by Task 5's reconcile row and by the whole-branch reviewers in Task 6.

- [ ] **Step 1: Run the mutating measurements on a PRIVATE socket**

Never the default server. Every command below is `tmux -L ccrc-w4-remeasure`; the last line kills
that socket. Run it whole, and keep the output — Step 3 records it.

```bash
S=ccrc-w4-remeasure
tmux -L $S kill-server 2>/dev/null

# --- F3: resize-window latches `manual`; set-option un-latches it ------------
tmux -L $S new-session -d -s probe -x 220 -y 50 'bash'; sleep 1
echo "F3 before  : [$(tmux -L $S show-window-options -t probe window-size)]"
tmux -L $S resize-window -t probe -x 100 -y 30
echo "F3 resized : [$(tmux -L $S show-window-options -t probe window-size)]"
tmux -L $S set-option -t probe window-size smallest
echo "F3 unlatch : [$(tmux -L $S show-window-options -t probe window-size)]"

# --- F8: the six per-pane formats read through one list-panes ---------------
echo "F8 : $(tmux -L $S list-panes -t probe \
  -F '#{pane_active} #{history_size} #{history_limit} #{pane_width} #{pane_height} #{alternate_on}')"
tmux -L $S kill-server 2>/dev/null

# --- F7: list-panes lists EVERY pane; row [0] is not always the active one ---
tmux -L $S new-session -d -s probe -x 220 -y 50 'bash'; sleep 1
tmux -L $S split-window -t probe 'bash'; sleep 1
echo "F7 rows    :"; tmux -L $S list-panes -t probe -F '#{pane_active} #{pane_index} #{pane_height}'
echo "F7 active  : $(tmux -L $S list-panes -t probe -F '#{pane_active} #{pane_index}' | grep '^1 ')"
tmux -L $S kill-server 2>/dev/null

# --- F1: narrowing reflows; the next output sheds; restoring does not restore -
tmux -L $S new-session -d -s probe -x 220 -y 50 'bash'; sleep 1
tmux -L $S send-keys -t probe \
  "for i in \$(seq 1 1200); do printf '%s\n' \"\$(printf 'x%.0s' {1..200}) line\$i\"; done" Enter
sleep 5
echo "F1 wide    : $(tmux -L $S list-panes -t probe -F '#{history_size} #{history_limit} #{pane_width}')"
echo "F1 logical : $(tmux -L $S capture-pane -t probe -p -J -S - | wc -l)"
tmux -L $S resize-window -t probe -x 43 -y 50; sleep 1
echo "F1 narrow  : $(tmux -L $S list-panes -t probe -F '#{history_size} #{pane_width}')"
tmux -L $S send-keys -t probe "echo one-line-of-output" Enter; sleep 2
echo "F1 shed    : $(tmux -L $S list-panes -t probe -F '#{history_size}')"
tmux -L $S resize-window -t probe -x 220 -y 50; sleep 1
echo "F1 restored: $(tmux -L $S list-panes -t probe -F '#{history_size}')"
echo "F1 logical2: $(tmux -L $S capture-pane -t probe -p -J -S - | wc -l)"
tmux -L $S kill-server 2>/dev/null

# --- F9: while alternate_on=1 a resize does NOT reflow; the reflow is DEFERRED --
# --- to alt-exit and lands then, at a moment no guard observes ------------------
tmux -L $S new-session -d -s probe -x 220 -y 50 'bash'; sleep 1
tmux -L $S send-keys -t probe \
  "for i in \$(seq 1 1900); do printf '%s\n' \"\$(printf 'x%.0s' {1..200}) line\$i\"; done" Enter
sleep 6
echo "F9 pre-alt   : $(tmux -L $S list-panes -t probe -F '#{history_size} #{alternate_on}')"
tmux -L $S send-keys -t probe "printf '\\033[?1049h'" Enter; sleep 1
echo "F9 alt-on    : $(tmux -L $S list-panes -t probe -F '#{alternate_on}')"
tmux -L $S resize-window -t probe -x 43 -y 50; sleep 1
echo "F9 narrow-alt: $(tmux -L $S list-panes -t probe -F '#{history_size} #{pane_width} #{alternate_on}')"
tmux -L $S send-keys -t probe "printf '\\033[?1049l'" Enter; sleep 1
echo "F9 alt-off   : $(tmux -L $S list-panes -t probe -F '#{history_size} #{alternate_on}')"
tmux -L $S kill-server 2>/dev/null
echo "socket killed"
```

**What must hold** (the integers vary with the box; the relations do not — plan-time values from
2026-09-14 in brackets):

- F3: the option prints **nothing** before any resize (it is global-only at that point), `manual` after `resize-window`, `smallest` after `set-option window-size smallest`.
- F8: exactly six space-separated fields come back, the first being `0` or `1`.
- F7: **two rows**, and row `[0]` carries `pane_active=0` — the active pane is row `[1]` [`0 0 25` / `1 1 24`].
- F1: `narrow` > `wide` (the reflow) [1152 → 5954]; `shed` < `narrow` (the next scrolled line sheds) [5954 → 5357]; `logical2` < `logical` (lines destroyed, not restored) [1202 → 1084, **118 destroyed**].
- F9: `narrow-alt`'s `history_size` equals `pre-alt`'s — no reflow while `alternate_on=1`, even after
  `resize-window` — and `alt-off`'s `history_size` is strictly greater than `narrow-alt`'s: the
  reflow that a resize alone would have produced immediately instead lands in one step the moment
  the alternate screen is left [1852 → 11359].

If any relation fails, STOP: a §2 fact no longer holds on this box and every comment quoting it
is now false. Record it under `## Deviations found` and report (worker clause 11) rather than
editing a comment to match a number nobody understands.

**What this step does not re-run, and why that's acceptable.** F4 and F5 (`latest` follows the
most-recently-typed client and thrashes; `smallest` is deterministic and self-healing) are not
re-measured by hand here — they are exercised by wave 2's own shipped test for `cmd_win_size`
every time the package suite runs, which Task 6 Step 1 does on this exact branch, so a drift
there fails CI rather than sitting unnoticed in a transcript nobody reads twice. F10's own
millisecond figures (59/100 ms at 1951 lines, 300/714 ms at 11951, …) are one box's timing under
whatever load happened to be running at that moment — re-quoting them here would trade a real,
box-independent relation for a noisy one. What Step 3 re-measures and pins instead is the relation
F10 actually backs: `STALL_BUDGET_LINES` still equals the shipped `6000` (the "three shipped
constants" test below), which is the constant the comment quotes, not the ms figures beside it.

The census is complete only if it names the rest, so: **F2** (`history-limit` latches at pane
creation) is not re-run because §6.4 declines the limit raise outright — nothing this program
ships depends on it, and it survives only as the recorded reason a later census would need.
**F6** (the node-pty `tmux attach` is a full tmux client) is not re-run by hand because wave 1's
own pin-ordering test in `server/test/pty.test.ts` re-proves it on every suite run: if that attach
were not a client, the pin would not need to precede it and the ordering assertion would be
vacuous. **F13** (the fit bound must count the visible screen) is not a measurement to re-run at
all — it is arithmetic, pinned by `fitFloor`'s own unit tests in wave 3. That accounts for every
fact in §2: F1, F3, F7, F8, F9 and F12 re-measured here; F11 via the `READER_MIN_COLS` bound
assertion; F14 at Step 5; F4, F5 and F10 by wave 2's suite as argued above; F2, F6 and F13 here.

- [ ] **Step 2: Read the live fleet, READ-ONLY, for F12**

One command. No mutation, no session name in the output, no `ccd` verb:

```bash
tmux list-panes -a -F '#{history_size} #{history_limit} #{pane_width} #{alternate_on} #{window_width}' \
  | awk '{ n++; hs[n]=$1; if ($2!=2000) lim++; if ($4==1) alt++; if ($5!=220) odd++ }
         END { print "panes="n, "not-at-limit-2000="lim+0, "alternate_on=1="alt+0, "window_width!=220="odd+0 }'
tmux list-panes -a -F '#{history_size}' | sort -n | awk '{a[NR]=$1} END {print "history_size min="a[1], "median="a[int(NR/2)+1], "max="a[NR]}'
```

Plan-time (2026-09-14): 31 panes, every one at `history-limit 2000`, every one `alternate_on=1`,
`history_size` max in single digits. **What must hold:** the median `history_size` stays far below
the limit — F12's claim, and the reason §6.4 declines to raise it. A median that has climbed toward
2000 falsifies §6.4 and is a finding, not an edit.

- [ ] **Step 3: Write the failing test**

Append to `server/test/drawer-prose.test.ts`:

```ts
import { PANE_HISTORY_LINES, READER_MIN_COLS, STALL_BUDGET_LINES } from '../../shared/api.js';

// The four roots `single-definition.test.ts` governs, plus the two docs and the one
// route suite that quoted the falsified claim. A comment is a request; this is the
// mechanism.
const TS_ROOTS = ['shared', 'server/src', 'pwa/src', 'agent/src'];
const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const e of readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (e.name.startsWith('__') || e.name === 'node_modules') continue;
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...walk(rel));
    else if (rel.endsWith('.ts') || rel.endsWith('.tsx')) out.push(rel);
  }
  return out;
};

describe('the §2 measurements, and the comments that quote them (W4-2)', () => {
  const scanned = [...TS_ROOTS.flatMap(walk),
    'server/test/pane-history-route.test.ts', 'README.md', 'CLAUDE.md'];

  it('the scan is looking at something', () => {
    // Anti-vacuity: a walk that found nothing would pass the negative below silently.
    expect(scanned.length).toBeGreaterThan(100);
    expect(scanned).toContain('server/src/pane/fit.ts');
    expect(scanned).toContain('server/src/exec.ts');
  });

  it('F1 falsified "tmux never reflows" — no file may assert it again', () => {
    const guilty = scanned.filter((f) => /never\s+reflow/i.test(read(f)));
    expect(guilty, 'F1 measured the reflow: 1152 -> 5954 at 43 columns').toEqual([]);
  });

  it('fit.ts carries F9\'s alt-exit measurement beside the alternate-screen decision', () => {
    // "alt means free" is the wrong reading and it is re-derived by anyone who does not
    // see the number: the reflow is DEFERRED to alt-exit, not absent.
    const fit = read('server/src/pane/fit.ts');
    expect(fit).toContain('1852');
    expect(fit).toContain('11359');
  });

  it('the three shipped constants are the measured values, not drifted ones', () => {
    expect(PANE_HISTORY_LINES).toBe(2000);          // F12: equal to the fleet's history-limit
    expect(STALL_BUDGET_LINES).toBe(6000);          // F10: ~half a second of whole-server stall
    // F11/§6.3: wide enough to keep a 171-column desktop client measurable, narrow
    // enough that every phone falls below it. The exact value is wave 2's measurement.
    expect(READER_MIN_COLS).toBeGreaterThan(43);
    expect(READER_MIN_COLS).toBeLessThanOrEqual(171);
  });

  it('the ledger records the re-measurement, with its date and its relations', () => {
    const m = section(read('docs/superpowers/programs/terminal-drawer.md'), '## Measurements');
    for (const f of ['F1', 'F3', 'F7', 'F8', 'F9', 'F12']) expect(m).toContain(f);
    expect(m).toMatch(/2026-09-\d\d/);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

```bash
cd server && ./node_modules/.bin/vitest run test/drawer-prose.test.ts
```

Expected: FAIL — `the ledger records the re-measurement` fails at `section()`'s own
`expect(start).toBeGreaterThan(-1)` with `heading not found: ## Measurements`. The other four in
this describe must already PASS: they assert waves 1–3's shipped state, and a red one there is a
finding about those waves, not about this test.

- [ ] **Step 5: Record the measurement in the ledger**

Insert a `## Measurements` section into `docs/superpowers/programs/terminal-drawer.md`, immediately
after `## Decisions & deviations` and before `## Carried constraints`. Fill the bracketed values
from YOUR OWN run in Steps 1–2 — not from this plan's numbers, which are the planning snapshot's. `2026-09-<dd>` is one of them: Step 6's `records the re-measurement` test matches `/2026-09-\d\d/` and reds on an unfilled slot.

```markdown
## Measurements

The spec's §2 table re-run on the execution base, 2026-09-<dd>. Mutating measurements on a
private socket (`tmux -L ccrc-w4-remeasure`, killed at the end); the fleet read is
`list-panes -a -F` and nothing else. The integers are this box's; the RELATIONS are the facts,
and every relation held.

| # | relation re-measured | this run |
|---|---|---|
| F1 | narrowing 220 → 43 reflows `history_size` upward; the next scrolled line SHEDS; restoring 220 does not restore the logical lines | <wide> → <narrow>, shed to <shed>; logical <before> → <after> (<n> destroyed) |
| F3 | `window-size` is unset at window level until a resize; `resize-window` latches `manual`; `set-option window-size smallest` un-latches | [empty] → `manual` → `smallest` |
| F7 | `list-panes -t <session>` lists EVERY pane of the current window, and row [0] is not always the active one | 2 rows, active is row [1] |
| F8 | the six per-pane formats come back through one `list-panes -F` | six fields, first is 0/1 |
| F9 | while `alternate_on=1` a resize does not reflow; the reflow is DEFERRED to alt-exit and lands there in one step | pre-alt <a> = narrow-alt <a>; alt-off <b> (<b> > <a>) |
| F12 | the fleet's histories are transient: every pane at `history-limit 2000`, median `history_size` far below it | <n> panes, <k> not at 2000, median <m>, max <x> |

F4, F5 and F10's own millisecond figures are NOT re-run by hand in this table (Task 2 Step 1
says why): F4/F5 are pinned by wave 2's own `cmd_win_size` test, which Task 6 Step 1 re-runs on
this branch; F10's box-timing numbers are noisy by construction, so what is re-pinned instead is
the constant they back, `STALL_BUDGET_LINES = 6000`, asserted directly against `shared/api.ts`.

F14's client half — that a `manual`-latched window is unchanged by a 43-column pty client — is
NOT re-run by hand here. It is re-measured on every run by wave 1's own mechanism,
`server/test/pty.test.ts`'s ordering assertion (the pin precedes the spawn, or the suite is red),
which is a stronger guarantee than one operator's `script` client and is the reason the pin
exists at all.
```

- [ ] **Step 6: Run test to verify it passes**

```bash
cd server && ./node_modules/.bin/vitest run test/drawer-prose.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 7: Mutation check, then commit**

Temporarily add the sentence `// tmux never reflows it` to the top of `server/src/pane/fit.ts` and re-run:

```bash
cd server && ./node_modules/.bin/vitest run test/drawer-prose.test.ts
```

Expected: `F1 falsified "tmux never reflows"` FAILS, listing `server/src/pane/fit.ts`. Remove the line and re-run to green.

```bash
git add docs/superpowers/programs/terminal-drawer.md server/test/drawer-prose.test.ts
git commit -m "docs(program): re-run the §2 measurements, and hold the shipped comments to them

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: README — the drawer, the verb and its grant, the route, the frame, and Deploy's ordering

Discharges W4-3 and W4-4. Spec §8 bullet 2, and §6.2's "the README's whitelist rationale gains the sentence that says so". **Model routing: sonnet@high.**

**Files:**
- Modify: `README.md` — insert a new `## The terminal drawer…` section immediately before `## Remote fleet mode` (`:1142`)
- Modify: `README.md:1288` — one sentence inside the **Exec whitelist** bullet
- Modify: `README.md:2577-2586` — the **Ordering between the two targets** paragraph
- Modify: `server/test/drawer-prose.test.ts` — add one `describe`
- Test: `server/test/drawer-prose.test.ts`

**Interfaces:**
- Consumes: `read`, `section` from Task 1. From `shared/api.ts`: `READER_MIN_COLS: number`, `STALL_BUDGET_LINES: number`, and `PaneGridReason = 'history-too-small' | 'stall-budget' | 'unmeasured'` (a type — its three values are read out of `shared/api.ts`'s TEXT by the test, since a type has no runtime members).
- Produces: nothing later tasks import; Task 4 re-measures the README's line count after this task's growth.

- [ ] **Step 1: Write the failing test**

Append to `server/test/drawer-prose.test.ts`:

```ts
const README_HEADING = '## The terminal drawer: a history a phone can read, and a window that stays honest';

/** The three `PaneGridReason` values, read out of L0's own source rather than
 *  retyped — a fourth reason added there and not documented reds this. */
const gridReasons = (): string[] => {
  const src = read('shared/api.ts');
  const m = /export type PaneGridReason =([^;]+);/.exec(src);
  expect(m, 'PaneGridReason is not declared in shared/api.ts').not.toBeNull();
  return [...m![1].matchAll(/'([a-z-]+)'/g)].map((x) => x[1]!);
};

describe('README states the drawer (W4-3)', () => {
  const sec = (): string => section(read('README.md'), README_HEADING);

  it('names the route, the frame and the verb with both its modes', () => {
    const s = sec();
    expect(s).toContain('GET /api/sessions/:id/pane/history');
    expect(s).toContain('`grid`');
    expect(s).toContain('ccd win-size --session <id> --mode smallest|canonical');
    expect(s).toContain('win-size-v1');
  });

  it('names EVERY grid reason the wire can carry — derived, not retyped', () => {
    const s = sec();
    const reasons = gridReasons();
    expect(reasons.length).toBe(3);
    for (const r of reasons) expect(s, `grid reason not documented: ${r}`).toContain(r);
  });

  it('keeps the probe\'s three failures apart, and the sizer\'s three answers apart', () => {
    // No overloaded null at a seam: prose that folds them is how the folding gets built.
    const s = sec();
    for (const w of ['gone', 'unreadable', 'unparseable']) expect(s).toContain(w);
    for (const w of ['unsupported', 'failed']) expect(s).toContain(w);
  });

  it('states the readers\' stand-down at the width the code actually uses', () => {
    const s = sec();
    expect(s).toContain(String(READER_MIN_COLS));
    expect(s).toContain(String(STALL_BUDGET_LINES));
    expect(s).toMatch(/stands? down/i);
  });

  it('names CLAUDE.md nowhere — the graphify scans read the whole README', () => {
    expect(sec()).not.toContain('CLAUDE.md');
  });
});

describe('README states the grant and the deploy order (W4-4)', () => {
  it('the whitelist rationale calls win-size fleet-control and names its enrolment', () => {
    const bullet = read('README.md');
    const start = bullet.indexOf('- **Exec whitelist**');
    const end = bullet.indexOf('- **Path whitelist**', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const exec = bullet.slice(start, end);
    expect(exec).toContain('win-size');
    expect(exec).toContain('REQUIRED_VERB_FLAG');
    expect(exec).toMatch(/fleet.control/i);
  });

  it('Deploy\'s ordering paragraph names win-size as an agent-first case', () => {
    const readme = read('README.md');
    const start = readme.indexOf('**Ordering between the two targets.**');
    expect(start).toBeGreaterThan(-1);
    const end = readme.indexOf('**Restore**', start);
    expect(end).toBeGreaterThan(start);
    expect(readme.slice(start, end)).toContain('win-size');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && ./node_modules/.bin/vitest run test/drawer-prose.test.ts
```

Expected: FAIL — the five `README states the drawer` tests fail at `section()`'s `heading not found: ## The terminal drawer: …`. This wave is now the SOLE owner of the whitelist sentence — wave 2 carried a duplicate insert of its own, but that duplicate's anchor does not exist in today's README, so it never landed and is being dropped by its own plan's fix rather than by this one. Today's whitelist bullet and Deploy paragraph therefore name `win-size` nowhere at all, so both `README states the grant` tests fail genuinely and for the reason this task exists: the first on `expect(exec).toContain('win-size')`, the second on the Deploy slice's own `expect(...).toContain('win-size')`. Step 4 below is what adds the sentence in both places, so the red obtained here is real red-first, and Step 5 is where it turns green.

- [ ] **Step 3: Insert the README section**

Insert immediately before `## Remote fleet mode` (`README.md:1142`), verbatim. Replace `<READER_MIN_COLS>`
and `<STALL_BUDGET_LINES>` with the shipped values read out of `shared/api.ts` — the test derives
them by import and will red on any other number. The outer fence below is FOUR backticks —
deliberately, because the block itself contains a nested fenced `ccd win-size …` example: a
three-backtick outer fence would be closed early by that nested three-backtick fence, silently
truncating everything a worker copies "verbatim" to the first ~37 lines.

````markdown
## The terminal drawer: a history a phone can read, and a window that stays honest

The drawer attaches a real terminal to a session's tmux window over `/ws/pty/:id`. Two things
make that harder than it looks, and both are about the fleet reading its own panes rather than
about the phone.

**tmux reflows stored lines on a horizontal resize, and sheds the overflow.** A 43-column client
attaching to a window ccd spawned at 220 columns re-wraps every stored line; when the reflowed
count passes the pane's `history-limit` the excess is dropped on the next scrolled line and does
not come back when the window widens again. Measured: 1152 stored lines became 5954 at 43
columns, shed on the next line of output, and came back as 1084 of 1202 logical lines — 118
destroyed. So the server **pins** the window first: `tmux resize-window -t cc-<id> -x 220 -y 50`
runs before the pty is spawned, which latches the window at `manual` and leaves the attaching
client unable to narrow it. The live view stays clipped at that width, exactly as it was before
the drawer existed, and the history survives.

**Scrollback comes from a route, not from the terminal.** tmux attaches on the alternate screen,
where an emulator has no scrollback of its own, so a wheel notch used to type an arrow key into
the pane. `GET /api/sessions/:id/pane/history` answers with the pane's own stored lines instead:
the server measures the active pane first (`list-panes -F`, selecting the row whose
`#{pane_active}` is `1` — `list-panes` lists every pane of the window, and the first row is not
always the active one), sizes the capture from that measurement, and joins wrapped lines so the
reader re-wraps them once at its own width. The read tells its failures apart rather than
answering one null: a pane that is **gone** answers 404, and a tmux that could not be read
(**unreadable**) or answered in a shape the parser did not recognise (**unparseable**) answers
502 with the detail, which the drawer renders as a sentence rather than a wire token. The route
is session-gated when `CCRC_AUTH` is armed and carries no box token: it is fleet control, not
coordination.

**Narrowing the window is deliberate, gated, and reversible.** A phone can ask for a view it can
actually read, and the server grants it only when the pane's history can absorb the reflow. A
pure policy function computes the floor — `(history + height) × ceil(width / W)` must stay under
both the pane's own `history-limit` and a server-wide stall budget of <STALL_BUDGET_LINES> lines,
because tmux is single-threaded for every session it serves and a reflow of that size is roughly
half a second in which nobody else is served. If the floor is at or below the client's own width,
the server un-pins through the fleet box:

```
ccd win-size --session <id> --mode smallest|canonical
```

`smallest` sets `window-size smallest`, so tmux follows the **narrowest** attached client —
deterministic, unmoved by keystrokes, and self-healing the moment that client leaves. `canonical`
re-issues the 220×50 resize and re-latches `manual`. The verb is advertised as `win-size-v1`, and
the server gates the un-pin on that capability rather than on the verb name: a capability that is
absent REFUSES, where an absent verb list permits, and permitting here would mean calling a verb
an older fleet box never had. An un-upgraded box simply keeps the window pinned. The port the
route talks to answers three conditions it handles differently — `ok`, `unsupported` (stay
pinned, say nothing) and `failed` (stay pinned, log it) — never one null.

The client is told what it got. A server→client `grid` frame on the same socket carries the
`cols` and `rows` the window actually has and, when they are not the client's own, the reason:
`history-too-small` (this session's history needs more columns to scroll without loss),
`stall-budget` (the reflow would stall the whole tmux server), or `unmeasured` (the pane could
not be measured, so the view stays at full width) — and `narrowed`, set only when the un-pin
actually happened, which is what the drawer's automation notice below is gated on. Gating that
notice on the client's own width instead would state it against a window that never moved. The
frame is additive; `FLEET_PROTO` does not move for it.

**While a session is narrow, its automation stands down.** ccd decides whether to type into a
live pane — a `/compact`, a redrive, a bare Enter — by matching short phrases against a capture,
and a narrow pane wraps those phrases between words. A reader that cannot see `esc to interrupt`
reads a running turn as an idle one. So every ccd site that would type first asks whether the
active pane is at least <READER_MIN_COLS> columns wide, and stands down when it is not; the one
exception answers *armed* rather than idle when it cannot measure, because that is the only
direction that cannot cancel a continuation Claude Code is already waiting out. The server's mail
lane holds the same way, with its own refusal the sweep backs off on. The hold lasts as long as
the drawer is open and is stated in the drawer itself, so a held nudge is never a surprise: a
session under a human's eye yields automation rather than having automation type over the human.
````

- [ ] **Step 4: Insert the whitelist sentence and the Deploy sentence**

In the **Exec whitelist** bullet, insert between "…the one PR write goes through a `ccd` verb
instead." and "Anything else comes back" (`README.md:1288`):

```
  `win-size` is enrolled in `REQUIRED_VERB_FLAG` with `--session` for the
  same reason `coord-pause` is enrolled with `--state`: its whole argument
  surface is a flag, so a bare `['win-size']` grant would leave the verb's
  entire positional surface open, and enrolment is what makes dropping the
  flag a compile error rather than a silent widening. It is a
  **fleet-control** verb, not a coordination one — the "zero new ccd verbs
  for coordination mutation" rule governs the coord surface (runs, mail,
  claims), which this verb does not touch; it sizes one tmux window.
```

In the Deploy section's **Ordering between the two targets** paragraph, append after the
`ccd ws-rename` sentence that ends "…and zero if the agent ships first." (`README.md:2586` —
`:2588` is `**Restore**`, and appending there would land the new paragraph inside the Restore
block):

```
`ccd win-size` is the same rule with the edge filed off: the server gates it
on the `win-size-v1` **capability** rather than on the verb name, and an
absent capability REFUSES, so a server deployed ahead of its ccd simply
leaves every window pinned instead of firing a call the fleet box cannot
parse. That is a degraded feature, not a failed call — but it is still one
deploy out of order, and the fleet host goes first.
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/drawer-prose.test.ts
cd server && ./node_modules/.bin/vitest run test/box-token-census.test.ts test/readme-holds.test.ts test/ccrc-install-graphify.test.ts test/topology-clean.test.ts test/license.test.ts
```

Expected: `drawer-prose` PASS (16 tests). The five sibling suites must all stay green — they are the README's other pins, and each slices a passage this task did not touch.

- [ ] **Step 6: Mutation check, then commit**

Temporarily delete the word `stall-budget` from the new README section and re-run:

```bash
cd server && ./node_modules/.bin/vitest run test/drawer-prose.test.ts
```

Expected: `names EVERY grid reason the wire can carry` FAILS with `grid reason not documented: stall-budget`. Restore it and re-run to green.

```bash
git add README.md server/test/drawer-prose.test.ts
git commit -m "docs(readme): the terminal drawer, the win-size grant's rationale, and the deploy order

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: CLAUDE.md — the measured sentence beside SAFETY, and the re-measured README size

Discharges W4-5. Spec §8 bullet 3, which gives the sentence verbatim. **Model routing: sonnet@high** — transcription-grade: the sentence is fixed by the spec and is copied, not composed.

**Files:**
- Modify: `CLAUDE.md` — new bullet at the end of `## SAFETY`, after the `Identity on the fleet` bullet (`:63-65`) and before `## Build / test / deploy` (`:67`)
- Modify: `CLAUDE.md:10` — the README line-count claim
- Modify: `server/test/drawer-prose.test.ts` — add one `describe`
- Test: `server/test/drawer-prose.test.ts`, `server/test/oss-metadata.test.ts`

**Interfaces:**
- Consumes: `read`, `section` from Task 1.
- Produces: nothing later tasks import.

- [ ] **Step 1: Write the failing test**

Append to `server/test/drawer-prose.test.ts`:

```ts
describe('CLAUDE.md carries the measured sentence, beside SAFETY (W4-5)', () => {
  // The spec fixes this sentence's wording (§8). It is pinned as SIX claims rather
  // than as one string so a reflow of the bullet cannot red it while a DELETED
  // clause still does — the clauses are the mechanism, the line breaks are not.
  const safety = (): string => section(read('CLAUDE.md'), '## SAFETY — sacred, never violate');

  it('sits inside the SAFETY section, not somewhere else in the file', () => {
    expect(safety()).toContain('window-size latest');
  });

  it('names the cause, the shed, the latch and the only way back', () => {
    const s = safety().replace(/\s+/g, ' ');
    expect(s).toContain('ccd spawns every session `window-size latest`');
    expect(s).toContain("SHEDS it at the pane's `history-limit`");
    expect(s).toContain('latches `manual` at the canonical grid before attaching');
    expect(s).toContain('un-pins only through `ccd win-size` under the fit guard');
    expect(s).toContain('`resize-window` latches `manual`');
    expect(s).toContain('`set-option window-size smallest|latest` un-latches but does not restore');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && ./node_modules/.bin/vitest run test/drawer-prose.test.ts
```

Expected: FAIL — both tests fail, the first on `expect(safety()).toContain('window-size latest')`.

- [ ] **Step 3: Add the bullet**

Append to `CLAUDE.md`'s `## SAFETY` section, as the last bullet before `## Build / test / deploy`. The
quoted sentence is the spec's §8 wording, copied without change:

```markdown
- **NEVER let a pty client narrow a session's tmux window.** ccd spawns every session `window-size latest`,
  so a pty client at a phone's width narrows the window, reflows the history and SHEDS it at the pane's
  `history-limit`; the drawer latches `manual` at the canonical grid before attaching and un-pins only
  through `ccd win-size` under the fit guard. `resize-window` latches `manual`; `set-option window-size
  smallest|latest` un-latches but does not restore. Re-measured 2026-09-14 on a private socket: narrowing
  220 → 43 took 1152 stored lines to 5954, the next line of output shed ~600, and restoring 220 left 1084
  of 1202 logical lines.
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd server && ./node_modules/.bin/vitest run test/drawer-prose.test.ts
```

Expected: PASS, 18 tests.

- [ ] **Step 5: Re-measure the README size claim**

Task 3 grew README; `CLAUDE.md:10` says `~2485 lines` and the tolerance is 10%.

```bash
cd "$(git rev-parse --show-toplevel)" && wc -l README.md
```

Edit `CLAUDE.md:10`, replacing `~2485` with the measured count rounded to the nearest 5, then:

```bash
cd server && ./node_modules/.bin/vitest run test/oss-metadata.test.ts
```

Expected: PASS. If `CLAUDE.md's README size claim is still true` fails, the edit was not made or the number was mistyped — its message prints both numbers.

- [ ] **Step 6: Mutation check, then commit**

Temporarily delete the clause "`resize-window` latches `manual`;" from the new bullet and re-run:

```bash
cd server && ./node_modules/.bin/vitest run test/drawer-prose.test.ts
```

Expected: `names the cause, the shed, the latch and the only way back` FAILS on that clause. Restore it and re-run to green.

```bash
git add CLAUDE.md server/test/drawer-prose.test.ts
git commit -m "docs(claude-md): the window-size sentence beside SAFETY, and the README size re-measured

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The ledger reconcile

Discharges part of W4-6. Spec §8 bullet 4. **Model routing: sonnet@high.**

**Files:**
- Modify: `docs/superpowers/programs/terminal-drawer.md` — append `## Ledger reconcile` at the end
- Test: `server/test/dtbd.test.ts`, `server/test/deviation-refs.test.ts` (both existing; this task runs them, it does not edit them)

**Interfaces:**
- Consumes: the `## Deviations found` sections of all four wave plans under `docs/superpowers/plans/2026-09-14-drawer-wave*.md`.
- Produces: the ledger's `## Ledger reconcile` section — the record of what was issued, what landed, and what was orphaned.

- [ ] **Step 1: Read what the allocator issued for this project**

```bash
ccrc-api ledger list --project ccrc-pwa
```

This is the READ. Its `floor` is **what the next POST would mint, not a number you may take**.
Record the allocations whose `byId` is one of this program's four workspaces.

If `ccrc-api` refuses (`no-agent-env`, `no-server-url`, `no-token`), do not guess: record the exact
refusal code in Step 4's section and report it (worker clause 11). The three file-scan checks below
still run and are the load-bearing half.

- [ ] **Step 2: Scan the four plans for what they DEFINE**

```bash
cd "$(git rev-parse --show-toplevel)"
grep -hoE '^(#{2,4} |- \*\*)D-[0-9]+' docs/superpowers/plans/2026-09-14-drawer-wave*.md \
  | grep -oE 'D-[0-9]+' | sort -u
```

Every number this prints must appear in Step 1's issued list, and every issued number must appear
here. A number DEFINED but never ISSUED is the shape `sweepLedgerReconcile` reports as an orphan and
nothing refuses — it never enters the ledger and it raises this project's floor anyway, sealing its
band forever. A number ISSUED but never defined is a gap, which costs nothing.

- [ ] **Step 3: Run the three scans that refuse**

```bash
cd "$(git rev-parse --show-toplevel)" && git fetch origin main
cd server && ./node_modules/.bin/vitest run test/dtbd.test.ts test/deviation-refs.test.ts test/single-definition.test.ts
```

Expected: PASS, all three. `dtbd` reds on any concrete `D-TBD-<slug>` left behind by a wave that
could not reach the allocator; `deviation-refs` compares this branch's plan entries against
`origin/main`'s **without merging** and reds on any allocator-era number defined in two plans — it
fires before the merge that would otherwise decide it. If either reds, the finding is the
deliverable: record it and report, do not renumber to make it green.

- [ ] **Step 4: Record the reconcile**

Append to `docs/superpowers/programs/terminal-drawer.md`, at the end of the file. Fill the bracketed
values from Steps 1–3.

```markdown
## Ledger reconcile

Run 2026-09-<dd>, on the execution base, before the wave-4 merge.

- **Issued** to this program's four workspaces: <the blocks `ccrc-api ledger list` reported>.
- **Defined** across the four wave plans: <the numbers Step 2 printed>.
- **Orphans** (defined but never issued): <none, or the list>. An orphan never enters the ledger
  and raises the project's floor anyway, so the band between is unissuable for good.
- **Gaps** (issued but never defined): <none, or the list>. A gap costs nothing — recovery is
  `MAX(file, db)`, so a number is skipped, never reissued.
- `dtbd`, `deviation-refs` and `single-definition`: green, after `git fetch origin main`.
```

- [ ] **Step 5: Commit**

There is no new assertion in this task: `dtbd` and `deviation-refs` already ARE the mechanism, and
Task 1's `the scan is looking at something` covers the ledger file's shape. Verify that by deleting
the new section and confirming the suite stays green — then restore it, because the record is the
deliverable even where the mechanism sits elsewhere.

```bash
git add docs/superpowers/programs/terminal-drawer.md
git commit -m "docs(program): reconcile the terminal-drawer ledger against the allocator

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The whole-branch pass across waves 1–3, and the PR

Discharges W4-6. Spec §8 bullet 1 (the coordinator skill's final pass) and §9's routing. **Model routing: the three lenses are opus@high; the exec-grant lens is opus@xhigh (§9: "xhigh for wave 2", and the two untrusted-input lenses are opus regardless of pool level). The refute pass, one per finding, is sonnet@high.**

**Files:**
- Modify: none. This task runs, reviews and opens the PR.
- Test: all three package suites, plus the cross-cutting suites named below.

**Interfaces:**
- Consumes: everything waves 1–3 shipped, plus Tasks 1–5 of this plan.
- Produces: the PR, and the wave-done fingerprint the coordinator re-measures.

- [ ] **Step 1: Run all three package suites, in the foreground**

```bash
cd server && npm ci && npm run test
cd agent  && npm ci && npm run test
cd pwa    && npm ci && npm run test
```

Timeout ≥ 600000 ms each. Expected: PASS. Before calling any of `ccd-ws-gc`, `pr-sweep`,
`session-hook`, `typecheck-tests` or `ccd-session-state` a real break, re-run it IN ISOLATION:

```bash
cd server && ./node_modules/.bin/vitest run test/<name>.test.ts
```

- [ ] **Step 2: Run the cross-cutting suites the whole branch moves**

```bash
cd "$(git rev-parse --show-toplevel)" && git fetch origin main
cd server && ./node_modules/.bin/vitest run \
  test/drawer-prose.test.ts test/auth-gate.test.ts test/whitelist-subset.test.ts \
  test/single-definition.test.ts test/typecheck-tests.test.ts test/node-floor.test.ts \
  test/deviation-refs.test.ts test/dtbd.test.ts test/topology-clean.test.ts \
  test/oss-metadata.test.ts test/box-token-census.test.ts test/readme-holds.test.ts \
  test/coordinator-skill.test.ts test/worker-skill.test.ts test/caps-token-shape.test.ts \
  test/ccd-archive.test.ts test/auto-continue-armed.test.ts test/pty.test.ts \
  test/pane-history-route.test.ts
cd ../agent && ./node_modules/.bin/vitest run \
  test/whitelist.test.ts test/whitelist-structural.test.ts test/whitelist-noghosts.test.ts \
  test/whitelist-prototype.test.ts
```

Expected: PASS. `auth-gate` carries waves 1's re-pinned route counts (48/76/73 and the three
embedded-literal comments); `whitelist-subset` and the four agent suites carry wave 2's grant;
`caps-token-shape`/`ccd-archive` carry `win-size-v1`; `auto-continue-armed` proves the bash and TS
phrase literals are still one.

- [ ] **Step 3: Dispatch the whole-branch review — three lenses, on the merged diff**

The diff under review is `git diff origin/main...HEAD`, waves 1–4 together, not any one wave's PR.
Three reviewers, named with their model in the message that launches them (§9's sizing rule: scale
the fan-out to the diff, and say the agent count and model):

1. **Prose-to-code truth (opus@high).** Every sentence this branch wrote in `README.md`,
   `CLAUDE.md`, `docs/superpowers/programs/terminal-drawer.md` and in every shipped comment that
   quotes a §2 number, checked against the code and the measurement it describes. It re-runs the
   §2 relations from Task 2 Step 1 on its own private socket rather than trusting this plan's
   record of them.
2. **The invariant, end to end (opus@high).** Spec §3's three clauses across waves 1–3 together:
   pinned unless deliberately un-pinned; un-pinned only to a width the history absorbs and only
   through an advertised verb; every reader that would type stands down while narrow and says so.
   It looks for the seam between waves — a path that reaches `spawnPty` without the pin, an
   un-pin that does not pass `fitFloor`, a typing site `_pane_measurable` does not cover.
3. **SECURITY (opus@xhigh, MANDATORY) — the exec grant and the escape replay, whole-branch.**
   This carries §6.5 lens 1 and §5.5 lens 3 across the merged diff: prefix matching leaves every
   token after `['win-size','--session']` unconstrained and the session id arrives off a
   JSON-parsed frame, so ccd's own id-class validation is the whole gate — the lens proves the
   bare shape fails to typecheck and the class is enforced before any `tmux` runs; and
   `capture-pane -e` replays OSC/DCS/CSI from model- and repo-controlled output into a SECOND
   emulator, so the lens confirms the history terminal is opened with the live terminal's
   hardening and that an unterminated DCS or an OSC 52 in the capture cannot act.

Each finding gets ONE refute pass on **sonnet@high** against the concrete claim before it is
accepted. A finding that survives refutation and requires a code change is a departure from this
plan: allocate a number, define it under `## Deviations found`, fix it, and re-run Step 1.

- [ ] **Step 4: Open the PR**

```bash
cd "$(git rev-parse --show-toplevel)"
git push -u origin HEAD
gh pr create --base main \
  --title "Terminal drawer wave 4: the whole-branch pass, the docs, and the ledger" \
  --body-file - <<'EOF'
Closes the terminal-drawer program. No behaviour changes: this wave is prose, a program ledger,
one new prose-ratchet suite, and the whole-branch review of waves 1-3 together.

- **README** gains the drawer's own section — the pin before the attach and why the history
  needs it, the history route and its three distinct failures, the `grid` frame and all three
  of its reasons, `ccd win-size`'s two modes and the capability that gates the un-pin, and the
  readers' stand-down. The exec-whitelist rationale gains the sentence that says `win-size` is a
  fleet-control verb enrolled in `REQUIRED_VERB_FLAG`, outside the coord-mutation rule; Deploy's
  ordering paragraph names it as an agent-first case whose edge is a capability gate rather than
  a verb gate.
- **CLAUDE.md** gains the measured sentence beside SAFETY, and its README line-count claim is
  re-measured after the growth.
- **The spec's §2 measurements were re-run** on a private socket and against a read-only fleet
  census; every relation held, and the numbers are recorded in the program ledger. The shipped
  comments that quote them are now held to them by `server/test/drawer-prose.test.ts` — including
  a negative scan that reds if the falsified "tmux never reflows" claim ever returns.
- **The deviation ledger is reconciled**: issued against defined, orphans and gaps named, with
  `dtbd`, `deviation-refs` (after `git fetch origin main`) and `single-definition` green.
- **Carried constraint, reported not fixed:** PR #94's `cat` copier on the darwin arm. If it dies
  mid-mint, Apple's `script.c` clears `readstdin` on the EOF read and never re-arms it on the
  non-tty path, silently removing the operator's code channel. Reported to the author with the
  citation; this program takes no dependency on #93 or #94.

Three whole-branch lenses ran on the merged diff: prose-to-code truth, the §3 invariant end to
end, and the mandatory security lens (the exec grant plus escape-sequence replay), each with a
refute pass per finding.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

- [ ] **Step 5: Report the wave-done fingerprint**

The coordinator re-measures it, so it must be the workspace branch's real tip:

```bash
cd "$(git rev-parse --show-toplevel)" && git rev-parse HEAD && git status --short
```

`git status --short` must print nothing: the handoff commit IS the branch tip
(`handoffCommit === branchTip`), and a worker commits on its workspace branch only — a separate
feature branch wedges every close with `stale-tip`.

---

## Deviations found

Numbers are ISSUED, never chosen: allocate with `POST /api/ledger/deviations` and DEFINE in the same act. A session that cannot reach the allocator writes `D-TBD-<slug>` and reports (worker clause 11).

---

## Review lenses

Spec §8 gives wave 4 no lens list of its own — it gives it the whole-branch pass, so the lenses
below carry waves 1–3's own lenses (§5.5, §6.5, §7.7) across the merged diff. They are dispatched
in Task 6 Step 3, three reviewers, each named with its model at launch.

1. **Prose-to-code truth** — opus@high. Every sentence this branch wrote, and every shipped
   comment quoting a §2 number, re-measured against the code and the private-socket run it claims.
2. **The invariant, end to end** — opus@high. Spec §3's three clauses across waves 1–3 together,
   looking for the seam between waves rather than inside one.
3. **SECURITY — the exec grant and the escape replay, whole-branch** — opus@**xhigh**, **MANDATORY**.
   This is the wave's mandatory opus security lens. It carries §6.5 lens 1 (the `win-size` grant:
   prefix matching leaves everything after `--session` unconstrained, the id arrives off a
   JSON-parsed frame, ccd's id class is the whole gate) and §5.5 lens 3 (escape-sequence replay:
   `capture-pane -e` replays model- and repo-controlled OSC/DCS/CSI into a second emulator), both
   untrusted-input paths, which §9 routes to opus regardless of pool level.

One refute pass per finding, sonnet@high, against the concrete claim.

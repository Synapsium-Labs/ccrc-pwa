# Workspace lifecycle, wave 1 — the `Released (N)` fold (spec stage 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop released workers littering the fleet board: the server says, per row, which run a workspace was released from (`FleetSession.releasedFrom`), each project card folds those rows into a collapsed `Released (N)` section above `Archived (N)`, grouped by programme, and one confirmed **Archive all (N)** sends a plain archive for each folded row that is not a child. The wave also commits the spec's read-only instrument, `deploy/measure-workspace-lifecycle.py`, so the board's baseline and the stage-3 archive→return measurement exist before later waves ship.

**Architecture:** A pure L1 decision (`server/src/coord/released.ts`: `releasedFrom`, `foldLastRuns`) fed by ONE batched store read per fleet assembly (`CoordStore.lastRunBySession(sessionIds)`), written once in `assembleFleet`'s row literal, carried on the wire as an additive field with ONE L0 reader (`releasedFromOf`) and a tolerant persisted reviver. On the PWA, `groupFleet` splits folded rows out with `inReleasedFold`, `ProjectCard` renders the fold, and `FleetScreen` owns the confirm and a sequential plain-archive loop (`archiveReleased.ts`) that re-reads every row from the newest frame. Nothing archives anything unasked; the archive door, placement and the bucket ladder are unchanged.

**Tech Stack:** TypeScript (node ≥ 22.13, `node:sqlite`), Fastify server, React PWA, vitest 4.1, python 3.12 stdlib (the instrument), git 2.43.

**Spec:** `docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md` — §5.1 (the whole of this wave), §4's wave-1 row and its coordination paragraph, §7 (what is not done), §8's first three failure modes, §9 (the instrument and its first five rows). Programme ledger: `docs/superpowers/programs/workspace-lifecycle.md` (wave 1's row).

## Global Constraints

- **Wire: additive, absence-permits.** `FleetSession.releasedFrom: ReleasedFrom | null` is a new required member of the interface and a new key on the wire; `FLEET_PROTO` is NOT bumped. Its ONE reader is `releasedFromOf(s)` in `shared/api.ts`, which reads `undefined` (a live frame from an older server — the `fleet` frame is cast, not revived) exactly as `null`. A persisted snapshot goes through `reviveFleetSession`, which calls `reviveReleasedFrom`; a present value it cannot read revives as `null` and KEEPS the session (null is the safe direction here: the row renders where it always did). `single-definition.test.ts` pins the one reader.
- **The word.** The wire field is `releasedFrom`, never `released`: `released` already names an `AskState` and a `ClaimState` member. "Released" appears only as the fold's label.
- **Doubt leaves the row where it is.** An unreadable store, an unknown run state, a terminal run with no readable close time: every one answers `null`. `null` collapses "not released", "this server did not decide" and "this server could not decide", deliberately and in the field's own docstring; no reader branches on which.
- **Rings.** `server/src/coord/released.ts` is L1: no `fs`, no clock, no store, no fastify, and its ONE import is L0 `shared/api.ts` (pinned). `shared/api.ts` imports nothing new. The store stays synchronous — never wrap `CoordStore` async.
- **One read per assembly**, under `readCoordPlacements`' failure contract (D-2875): a refusal or a synchronous `node:sqlite` throw is caught inside `assembleFleet`, logged with `console.warn('ccrc-server: …')` (never `req.log`), and makes every row's `releasedFrom` null for that tick.
- **No new route, no new `ccd` verb, no change to `POST /api/sessions/:id/archive`.** "Archive all" calls `api.archive(id)` with the id ALONE — never `force`, never a second argument — one row at a time, and reports every refusal with the server's own reason (`apiErrorText`), in a toast that stays up until dismissed. In this wave a busy refusal arrives as today's generic 502 with `ccd`'s stderr; wave 2 gives it a typed reason.
- **Nothing archives anything on its own** (spec §7). The fold and its button are the operator's; there is no sweep, timer or lane in this wave.
- **Unchanged:** board placement (`boardPlacement`, a released worker renders on its own card), the bucket ladder (`sessionBucket`, M10) and the bucket chips' counts (they still count released rows: folded, not removed), `nestFleet`, the Archived fold's own rules and its grandfathered CSS identity.
- **Children:** "Archive all" skips a row whose `releasedFrom.child` is true — the registry's CCR-15 reading is `child` or `unreadable` — and reads the child flag ONLY there (`archivableReleased`), never `FleetSession.child`: one decision, one field.
- **CSS gates.** Every new colour rule is either measured or REGISTERED in `pwa/design/audit.mjs`'s `INHERITED_GROUNDS`; never widen a selector that is a grandfathered identity (`.proj-archived-toggle` is one — joining it made two new uncovered identities, measured). Every new control carries `min-height: var(--tap-min)`.
- **Cited files pay the citation tax (S6-R11).** `shared/api.ts`, `README.md` and `server/test/single-definition.test.ts` are cited by line by the corpus `server/test/session-hook.test.ts` audits. README is REPAIRED BY CONTENT with `readme-reanchor.py` (Task 1 Step 6), never by adding a delta to a number; the census is NOT edited (its measured movement after the repair is zero). No rule is widened and no D-number is spent.
- **Locate every edit by content.** Line numbers in this plan are hints. Every "Find" block below was generated from, and replayed against, `df4fe069`; if a block is absent or not unique on your base, `main` moved under it: stop and report rather than improvising an anchor.
- **Your scratchpad and your shell.** `<SCRATCH>` below stands for your session's scratchpad directory: write its ABSOLUTE path into every command (the Bash tool keeps neither variables nor a working directory you can rely on between calls). Every command runs from the worktree root; a package command is wrapped in a subshell, `( cd server && … )`, so the next command starts at the root again — a persistent `cd server` once made a repository-relative `git diff` check pass on nothing (measured in review).
- **Test hygiene.** Fixture HOMEs only — never `ccd` against the live `$HOME`. Run a single file as `./node_modules/.bin/vitest run test/<file>` from inside its package, never bare `npx vitest`; suites in the FOREGROUND with a timeout of at least 600000 ms, one Bash call per server shard (the six take about 25 minutes together, and one call is capped at ten). Known reds on the fleet box that are NOT this wave's: `server/test/tmp-sweep.test.ts` "FAILS CLOSED: claude is running…" (red on `main` itself, measured at `147557fb`) and `server/test/boot.test.ts` "a hung ccd … does not delay listen" (a load flake: `3 passed (3)` twice in isolation). Re-run either alone before calling it anything else.
- **Branch discipline.** Commit on your workspace branch, never a separate feature branch. Identity is the noreply address.
- **Deviation numbers.** This plan defines none. A departure found while executing is reported to the coordinator and minted then (`POST /api/ledger/deviations`), never typed.
- **SAFETY.** Never a destructive `ccd` verb against the live host (`ws-rm`, `ws-reap`, `ws-gc --prune`, `ws-archive`/`ws-restore`); never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or `claude-session@*.service` directly; never print secret file contents; `gh` stays off the exec whitelist.

## Review Focus

The five inputs the spec implies that a person using this will meet first, each pinned in the task that owns it:

1. **A folded row starts a turn or asks a question** — it must leave the fold on the next frame, never hide there (Task 5: `never folds %s row` for attention, working, live and dead strands).
2. **A server older than the field** sends rows with no `releasedFrom` key — they must render exactly as today (Task 1: `releasedFromOf` reads `undefined` as `null`; Task 5: `a row from a server older than the field … stays live`).
3. **A row stops being released while "Archive all" is running** — it must be skipped, not archived (Task 6: the loop's re-read; Task 8: `re-reads each row from the NEWEST frame`).
4. **`coord.db` cannot be read this tick** — nothing folds, the tick still resolves, and the operator's log says why (Task 4: the REFUSED and THROWING cases, with their warnings).
5. **A child sits among the released rows** — "Archive all" never sends it, and both the fold and the summary say it was skipped (Task 6: `archivableReleased`; Task 7: the count and the note; Task 8: the loop is handed every folded id and skips the child itself).

## File Structure

| File | Task | Responsibility |
|---|---|---|
| `shared/api.ts` | 1 | `FleetSession.releasedFrom`; `ReleasedFrom`, `releasedFromOf`, `reviveReleasedFrom` at the file's end; one reviver line in `reviveFleetSession` |
| `server/src/fleet.ts` | 1, 4 | the row literal's `releasedFrom` (Task 1 writes `null`; Task 4 computes it); `readReleased`, the guarded batched read |
| 32 test fixture files | 1 | `releasedFrom: null` in every full `FleetSession` literal |
| `README.md` | 1, 8 | Task 1 re-anchors four `shared/api.ts` pointers by content; Task 8 adds the operator paragraph |
| `server/test/single-definition.test.ts` | 1 | the one-reader pin, appended |
| `server/test/released-wire.test.ts` | 1 | the accessor and the reviver |
| `server/src/coord/released.ts` | 2 | the L1 decision and the port fold |
| `server/test/released.test.ts` | 2 | the six conditions, the fold, the purity scan |
| `server/src/coord/store.ts` | 3 | `lastRunBySession(sessionIds)` and `LastRunsResult` |
| `server/test/released-store.test.ts` | 3 | the store read against a real `coord.db` |
| `server/test/fleet-released.test.ts` | 4 | the field on the wire, end to end, and the failure contract |
| `pwa/src/fleet/groupFleet.ts` | 5 | `inReleasedFold`, `FleetGroup.released`, `releasedByProgramme`; folded rows never order a card |
| `pwa/test/groupFleet.test.ts`, `pwa/test/project-card.test.tsx` (its group fixture) | 5 | the split, its exclusions, the ordering |
| `pwa/src/fleet/archiveReleased.ts` | 6 | the plain-archive loop, `archivableReleased`, the summary |
| `pwa/test/archiveReleased.test.ts` | 6 | the loop |
| `pwa/src/fleet/ProjectCard.tsx`, `pwa/src/fleet/fleet.css`, `pwa/design/audit.mjs` | 7 | the fold's markup, its rules, their registered grounds |
| `pwa/test/project-card.test.tsx` | 7 | the fold on the card |
| `pwa/src/screens/FleetScreen.tsx` | 8 | the fold key, the confirm, the loop's wiring, the bucket-chip comment |
| `pwa/test/fleet-screen.test.tsx`, `pwa/test/tap-targets.test.tsx` | 8 | the screen end to end; the tap floor on the rendered controls |
| `deploy/measure-workspace-lifecycle.py`, `server/test/measure-workspace-lifecycle.test.ts` | 9 | the instrument (spec §9) and its test against a real `coord.db` |
| `docs/superpowers/programs/workspace-lifecycle.md` | — | the programme ledger: the coordinator's, on its own PR (not a worker's file) |

**Not modified, deliberately:** `server/src/coord/placement.ts`, `sessionBucket`, `pwa/src/fleet/nestFleet.ts`, `server/src/server.ts` (the archive route), `ccd/*`, the skills, `server/test/session-hook.test.ts` (the census is re-measured, not edited — zero movement).

## Pre-flight findings (measured while planning; not deviations)

Measured 2026-09-26 on a prototype of this plan's exact edits — local branch `proto/wl-wave1` at `397a62d6`, never pushed — over `df4fe069` (`origin/main` `dcac4691` plus the spec). The plan's blocks were then replayed onto a clean `df4fe069` task by task and reproduce the prototype byte for byte, file modes included (by the planner, and independently by the executability reviewer). They are why the tasks look the way they do.

1. **`FleetSession.child` already exists** (CCR-15 wave 2): the registry's three-way `ChildMark`. `ReleasedFrom.child` is derived from it at the single write site, `r.child.kind !== 'none'`, and the PWA reads the child flag only through `releasedFrom`.
2. **Every terminal run on the live box has a close time** — 163 of 163 `done`/`failed` rows of 171 (`ccrc-api runs list --closed 1`, 2026-09-26) — but `runs.closedAt` is nullable, so a NULL or unrepresentable close time is doubt for THAT row only (`LastRun.closedAt: null` → `releasedFrom` null), never a failure of the whole read. The run id stays all-or-failure (D-2545's rule).
3. **The claimant set already has a reader**, `CoordStore.openCoordinatorIds()`; `lastRunBySession` reuses it rather than respelling its predicate, and takes the assembly's session ids (`currentAsksFor(childIds)`'s shape), so its output is bounded by the registry, not by the run history. `EXPLAIN QUERY PLAN` (review round): the subquery reads `COVERING INDEX runs_by_session`, the outer read is a rowid `SEARCH`.
4. **Adding the member breaks the server build** until `assembleFleet`'s literal sets it: `src/fleet.ts: error TS2741: Property 'releasedFrom' is missing … required in type 'FleetSession'`. So Task 1 writes `releasedFrom: null` there and Task 4 replaces it.
5. **The fixture sweep is 32 files.** 33 test files carry `child: { kind: 'none' }` (measured at `5b1c58a8`; 31 and 32 before the worker stall watch added `stall-sweep.test.ts`); 32 are full `FleetSession` literals and `server/test/hold-gate.test.ts`'s is a `SessionRecord` (which has no such member — adding one is an excess-property error). The sweep must be idempotent: a plain `sed` run after a new test file already carried the field doubled its key (measured), so Task 1 uses a `perl` negative lookahead.
6. **The citation tax is README's four anchors, and nothing else.** Task 1's five inserted lines move the purge-refusal vocabulary README points at: `README HAS ITS OWN CENSUS ENTRY` reds (`expected [ 'shared/api.ts:7611-7613', …(3) ] to deeply equal []`) and `CITATION DEBT` reds (`byFile['shared/api.ts']` 1 → 5, the four README sites ENTERED). After the content repair, the census re-measures stated = base = tree for every key, total 195, ENTERED/LEFT empty in all three compositions; Task 8's README paragraph and Task 1's `single-definition` append move nothing.
7. **CCR-15 wave 3 (#187, open) collides on exactly one hunk: README's anchor sentence**, which both waves re-anchor. `git merge-tree` of the prototype with `origin/ws/plain-summit` → rc 1, `README.md` only; with update wave 4 (#181, `origin/ws/keen-meadow`), with `origin/main`, #188 and #180 → rc 0. Resolved by taking EITHER side of that hunk and running `readme-reanchor.py` on the merged tree: the seven citation cases `7 passed | 328 skipped (335)`, this wave's server files green, both `tsc` clean (measured both ways in review). If wave 3 lands FIRST, every Find block here stays unique and every count holds but the two the plan hedges (the anchor lines; 333 → 335); if this wave lands first, wave 3's own re-point `grep`s match no line this wave adds. Wave 3 appends a union member after `'purge-mechanism-absent'`, which moves that line's `;` — so the script keys on member names, never on a line's end (its first version failed exactly there).
8. **The contrast gate refuses a widened grandfathered selector.** Writing `.proj-archived-toggle, .proj-released-toggle` as one rule made two identities the census did not know (`expected [ …(2) ] to deeply equal []`). The fold gets its own rules, registered under `var(--bg-surface)` beside `.proj-crossing` and `.proj-elsewhere-line`.
9. **The instrument runs on the server box alone**, as spec §9 now says: `coord.db` carries the runs and the lifecycle journal the server mirrors from ccd's `$REG/.lifecycle/`, and `state-cache.json` carries every registry fact the rows need, as the board last saw them. Opening a WAL database nobody holds open with `mode=ro` makes SQLite create its `-shm`/`-wal` files, owned by the runner — hence "run it as the server's own user" in its docstring.
10. **A symlinked `pwa/node_modules` reds one case of `typecheck-tests.test.ts`** ("PWA_TSC really is pwa's own installed compiler"): environmental, green on a real `npm ci` — which Task 1 Step 0 does.
11. **The review round** (three independent reviewers — spec fidelity, correctness and tests, executability and merges — 2026-09-26) found no blocker; every finding is applied here. What it changed: the one-reader pin blanks comment LINES (a block-comment regex swallowed 262 lines of `server.ts`, the `/ws/fleet` handler among them, and a planted raw read there stayed green — now row S33); the instrument ends an archive on a removal or a re-creation of its id (a reused slug read as an 8-day "return") and pairs a return with the NEWEST archive; the summary toast carries an action when it holds a refusal, so its reasons stay on screen; the loop is handed every folded id, so "skipped" counts children; the in-flight guard is a ref and is released when the loop ends (a second loop is pinned); the card's rows are ordered and the fold opened by what is visible (a folded `done` row no longer lifts its card; the fold shows itself while it holds the selected row); the button names its card to a screen reader and reads `Archiving…` while it runs; the confirm says how many of the rows still have a live pane; the bucket-chip comment and `unseen`'s docstring say what the chips now count; every setup step below (the install, the scratchpad, the subshells, the corpus check from the root, one call per shard, the right file for the `boot` flake) came from the executability rehearsal.
12. **Accepted, and stated rather than fixed:** (a) "newest" is the highest run id, not the latest bind — `bindSession` can bind an older-id run later, so a rare heading could name the wrong programme (display only); (b) an unreadable `.archived` marker reads as not archived (`registry.ts`'s `numOrNull`, older than this wave), so such a row could fold and be sent a plain archive, which `ccd` answers as it would by hand; (c) on a card with no live row the pin falls back to every member, exactly as on an all-archived card; (d) the ref guard against a double tap covers a phone's closing-sheet window and no test reaches it — under jsdom the sheet unmounts before a second click lands (row P25 measured GREEN, so it is not in the worker's row file).
13. **Suites on the prototype.** PWA: 3010 passed in 98 files at base → 3041 passed in 99 files, no type errors; `npm run build` succeeds. Server, six shards: every file green but the two known reds in Global Constraints (and the symlink artifact of finding 10 where modules are linked).

---

### Task 1: The wire field, its one reader, its reviver, and the citation tax

**Model routing:** `sonnet`, effort `high` — transcription of the blocks below; the tests are the check.

**Files:**
- Modify: `shared/api.ts` (three blocks: the member, the reviver line, the contract at the file's end)
- Modify: `server/src/fleet.ts` (the row literal: `releasedFrom: null`)
- Modify: 32 test fixture files (Step 4)
- Modify: `README.md` (four anchors, Step 6)
- Modify: `server/test/single-definition.test.ts` (appended)
- Create: `server/test/released-wire.test.ts`

**Interfaces:**
- Produces: `export interface ReleasedFrom { readonly runId: number; readonly program: string; readonly programTitle: string | null; readonly claimedBy: string | null; readonly closedAt: number; readonly child: boolean }` (`closedAt` epoch ms); `FleetSession.releasedFrom: ReleasedFrom | null`; `export function releasedFromOf(s: FleetSession): ReleasedFrom | null`. Every later task reads the field only through `releasedFromOf`.

- [ ] **Step 0: Install each package's own modules** (many workspaces carry only `server/node_modules`; a symlinked copy reds a typecheck case — Pre-flight finding 10):

```bash
( cd server && npm ci ) && ( cd pwa && npm ci ) && ( cd agent && npm ci )
```

- [ ] **Step 1: Write the failing tests.** Create `server/test/released-wire.test.ts`:

```ts
// `FleetSession.releasedFrom`'s two read paths (workspace lifecycle spec §5.1): the accessor a cast live frame is
// read through, and the reviver a persisted snapshot goes through.
import { describe, it, expect } from 'vitest';
import { releasedFromOf, reviveFleetSession, type FleetSession, type ReleasedFrom } from '../../shared/api.js';

const REL: ReleasedFrom = {
  runId: 41, program: 'lifecycle', programTitle: 'Workspace lifecycle', claimedBy: 'demo-coordinator',
  closedAt: 1_790_000_000_000, child: false,
};

const session: FleetSession = {
  id: 'demo-amber', wrapper: 'claude', home: '/home/rc', project: 'demo', workdir: '/data/projects/demo',
  workspace: 'amber', name: null, status: 'idle', statusUpdatedAt: null, limits: null,
  dialogPending: false, version: null, model: null, effort: null, ultracode: false,
  branch: null, ctxPct: null, paneCols: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null,
  hookState: null, askSummary: null, subagents: null, graphQueries: null, graphGateDenials: null, held: null, bucket: 'idle', bucketSince: null,
  unmeasured: [], statusUnmeasured: false, lifecycle: null, stoppedBy: null, swapBlocked: null, stranded: null, substrate: null,
  started: true, spawnState: null, ask: null, usage: null, boardProject: null, route: null, child: { kind: 'none' }, releasedFrom: null,
};

/** The session as a persisted snapshot holds it — JSON, with `releasedFrom` replaced or removed. */
const raw = (over: Record<string, unknown> = {}): Record<string, unknown> => {
  const o = JSON.parse(JSON.stringify(session)) as Record<string, unknown>;
  delete o['releasedFrom'];
  return { ...o, ...over };
};

it('CONTROL: the base snapshot revives at all — every case below would pass on a rejected session otherwise', () => {
  expect(reviveFleetSession(raw())).not.toBeNull();
});

describe('releasedFromOf — the one reader', () => {
  it('reads a present value', () => {
    expect(releasedFromOf({ releasedFrom: REL } as FleetSession)).toEqual(REL);
  });

  it('reads a key an older server never sent exactly as null', () => {
    expect(releasedFromOf({} as FleetSession)).toBeNull();
  });
});

describe('reviveFleetSession carries releasedFrom', () => {
  it('round-trips a well-formed value', () => {
    expect(reviveFleetSession(raw({ releasedFrom: REL }))!.releasedFrom).toEqual(REL);
  });

  it('revives an absent key as null — a snapshot from before the field describes nothing released', () => {
    expect(reviveFleetSession(raw())!.releasedFrom).toBeNull();
  });

  it.each([
    ['a string run id', { ...REL, runId: '41' }],
    ['a zero run id', { ...REL, runId: 0 }],
    ['a non-string programme', { ...REL, program: 7 }],
    ['a missing title key', (({ programTitle: _t, ...rest }) => rest)(REL)],
    ['a numeric claimant', { ...REL, claimedBy: 3 }],
    ['a null close time', { ...REL, closedAt: null }],
    ['a zero close time — the server only ever sends a positive safe integer', { ...REL, closedAt: 0 }],
    ['a string child flag', { ...REL, child: 'false' }],
    ['an array', [REL]],
  ] as const)('revives %s as null and KEEPS the session — null is the safe direction here', (_label, bad) => {
    const s = reviveFleetSession(raw({ releasedFrom: bad }));
    expect(s).not.toBeNull();
    expect(s!.releasedFrom).toBeNull();
  });
});
```

At the end of `server/test/single-definition.test.ts` (below every line the corpus cites into that file — measured):

Find:

```ts
    expect(ALL.filter((f) => LITERAL.test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['shared/api.ts']);
  });
});

```

Replace with:

```ts
    expect(ALL.filter((f) => LITERAL.test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['shared/api.ts']);
  });
});

describe('one releasedFromOf (workspace lifecycle wave 1)', () => {
  // `FleetSession.releasedFrom` has ONE reader, `releasedFromOf` in `shared/api.ts`. The live `fleet` frame is
  // CAST, not revived, so a raw property read anywhere else meets `undefined` from a server older than the field,
  // where the accessor answers `null` — the two-readers drift this suite exists to forbid. Comment LINES are
  // blanked first (the field is NAMED in prose across the tree), line by line — `blankComments`' shape above. A
  // block-comment regex is NOT safe here: a `/*` inside a string or a `//` line (`server.ts`'s `.cc-limits/*.json`)
  // opens a "comment" that swallows hundreds of lines of real code, the `/ws/fleet` handler among them (measured).
  const code = (f: string): string => readFileSync(f, 'utf8')
    .split('\n').map((l) => (/^\s*(\*|\/\*|\/\/)/.test(l) ? '' : l)).join('\n');
  const READ = /\.releasedFrom\b/;

  it('is read as a property in exactly one file, and that file is shared/api.ts', () => {
    expect(ALL.filter((f) => READ.test(code(f))).map(rel)).toEqual(['shared/api.ts']);
  });

  it('the scan sees the one read it licenses (a blanker that ate code would pass the pin above vacuously)', () => {
    expect(code(path.join(ccrcRoot, 'shared', 'api.ts'))).toMatch(/return s\.releasedFrom \?\? null;/);
  });
});

```

- [ ] **Step 2: Run them to verify they fail.**

Run: `( cd server && ./node_modules/.bin/vitest run test/released-wire.test.ts test/single-definition.test.ts )`
Expected: `15 failed | 221 passed (236)` — `TypeError: releasedFromOf is not a function`, `AssertionError: expected undefined to be null` on the reviver cases, both new `single-definition` cases red. The CONTROL (`the base snapshot revives at all`) passes: without it, every reviver case could pass on a rejected session.

- [ ] **Step 3: Add the member, the reviver line and the contract to `shared/api.ts`.** Three blocks, top to bottom. The member stays three lines long on purpose — everything below it in this file moves by what it adds, and README cites that far below — so its contract lives at the END of the file, below every cited line.

Find:

````ts
  readonly child: ChildMark;
}
````

Replace with:

````ts
  readonly child: ChildMark;

  /** Where this workspace was RELEASED from, or `null` — `ReleasedFrom`, at the end of this file, carries the
   *  contract; `releasedFromOf` there is the field's one reader. */
  readonly releasedFrom: ReleasedFrom | null;
}
````

Find:

````ts
      child: reviveChildMark(o, 'child'),
    };
````

Replace with:

````ts
      child: reviveChildMark(o, 'child'),
      releasedFrom: reviveReleasedFrom(o, 'releasedFrom'),
    };
````

Find:

````ts
export const UPDATE_GATE_CAP = 'update-gate';

````

Replace with:

````ts
export const UPDATE_GATE_CAP = 'update-gate';

/**
 * `FleetSession.releasedFrom` — the run a WORKSPACE was released from (workspace lifecycle spec §5.1), which is
 * what puts its row in its card's `Released (N)` fold. The server writes it once, in `assembleFleet`'s row
 * literal, from the pure `releasedFrom` decision (`server/src/coord/released.ts`); nothing else computes it.
 *
 * Non-null only when the row is a workspace, carries no hold, is not archived, its NEWEST run as `sessionId` is
 * terminal, no non-terminal run names it as `sessionId`, and no non-terminal run names it as `claimedBy` (a former
 * worker that now coordinates is not released).
 *
 * `null` collapses THREE conditions, deliberately: not released; this server did not decide (an older peer, or a
 * snapshot from a build predating the field); and this server could not decide (its `coord.db` read failed this
 * tick, or the newest run carried no readable close time). A reader does the identical thing with all three —
 * the row renders where it always did — and none may branch on which it was: that distinction is not on the
 * wire. `boardProject` makes the same trade for the same reason.
 *
 * The wire word is not "released": `released` already names an `AskState` and a `ClaimState` with other
 * meanings, so the word appears only as the fold's label.
 *
 *   - `runId`, `program`, `claimedBy`, `closedAt` — the newest run's own columns; `closedAt` is epoch MS.
 *   - `programTitle` — `programs.title`, `null` only if the programme row could not be joined.
 *   - `child` — the registry's CCR-15 child reading (`FleetSession.child`) is `child` or `unreadable`. An
 *     unreadable marker reads as a child, the direction that defers: "Archive all" skips children, which leave
 *     through CCR-15's own reclamation.
 *
 * ADDITIVE; `FLEET_PROTO` is not bumped. The LIVE `fleet` frame is CAST, not revived (`pwa/src/stores/fleet.ts`'s
 * `asFleetMsg`), so a row from an older server has no key at all — read it ONLY through `releasedFromOf`.
 */
export interface ReleasedFrom {
  readonly runId: number;
  readonly program: string;
  readonly programTitle: string | null;
  readonly claimedBy: string | null;
  readonly closedAt: number;
  readonly child: boolean;
}

/** THE ONE READER of `FleetSession.releasedFrom`. `undefined` (a live frame from a server predating the field)
 *  reads exactly as `null`. */
export function releasedFromOf(s: FleetSession): ReleasedFrom | null {
  return s.releasedFrom ?? null;
}

/** `FleetSession.releasedFrom`'s persistence contract: absent or null → `null`. A present value this build cannot
 *  read ALSO revives as `null`, rather than rejecting the whole session the way `child` does — here the
 *  degrade is the safe direction, since `null` leaves the row at the top level of its card, where it rendered
 *  before this field existed. */
function reviveReleasedFrom(o: RawObj, k: string): ReleasedFrom | null {
  const v = o[k];
  if (v === undefined || v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const r = v as RawObj;
  const { runId, program, programTitle, claimedBy, closedAt, child } = r;
  if (!isPositiveDecimalSafeInteger(runId) || typeof program !== 'string') return null;
  if (programTitle !== null && typeof programTitle !== 'string') return null;
  if (claimedBy !== null && typeof claimedBy !== 'string') return null;
  if (!isPositiveDecimalSafeInteger(closedAt) || typeof child !== 'boolean') return null;
  return { runId, program, programTitle, claimedBy, closedAt, child };
}

````

And in `server/src/fleet.ts`, the row literal (Pre-flight finding 4 — without it the server does not compile):

Find:

```ts
      child: r.child,
      bucket: 'idle', bucketSince: null,   // replaced immediately below
```

Replace with:

```ts
      child: r.child,
      releasedFrom: null,   // workspace lifecycle §5.1 — Task 4 computes it; null renders the row as today
      bucket: 'idle', bucketSince: null,   // replaced immediately below
```

- [ ] **Step 4: Sweep the fixtures.** From the worktree root — idempotent, and it never touches `server/test/hold-gate.test.ts`, whose literal is a `SessionRecord`:

```bash
perl -pi -e "s/child: \{ kind: 'none' \}(?!, releasedFrom)/child: { kind: 'none' }, releasedFrom: null/g" \
  $(git grep -l "child: { kind: 'none' }" -- server/test pwa/test | grep -v '^server/test/hold-gate.test.ts$')
git diff --stat -- server/test pwa/test ':!server/test/single-definition.test.ts' | tail -1
```

Expected: `32 files changed, 33 insertions(+), 33 deletions(-)` (measured at `e0a52953`: `stall-sweep.test.ts` carries two literals since #224) (Step 1's new test file already carried the field, so the lookahead leaves it alone; Step 1's `single-definition` append is excluded from the count). The 32: `pwa/test/` accounts-screen, app, archive-screen, fleet-class-chooser, fleet-screen, groupFleet, header, lifecycle-ui, nestFleet, offline, polish, pr-sheet, project-card, reap-sheet, resume-sheet, runs-screen, session-actions-sheet, session-lifecycle, session-line, session-pickers, sortFleet, start-program, stores, substrate-banner, swap-sheet, tap-targets, typed-label; `server/test/` child-reclaim-mark, fleet-health, fleet-wire-route, fleetstate, stall-sweep. If the count differs, a fixture was added or removed on `main` since `5b1c58a8`: every full `FleetSession` literal must carry the field (the typecheck in Step 5 is what proves it), and no `SessionRecord` may.

- [ ] **Step 5: Run the tests and both typechecks.**

```bash
( cd server && ./node_modules/.bin/vitest run test/released-wire.test.ts test/single-definition.test.ts )
( cd server && ./node_modules/.bin/tsc --noEmit -p . && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts )
( cd pwa && ./node_modules/.bin/tsc --noEmit -p . )
```

Expected: `236 passed (236)`; no output from either `tsc`; `12 passed (12)` (the pwa `tsc` is `npm run build`'s first half, so CI's `build-pwa` job runs it too).

- [ ] **Step 6: Pay the citation tax (S6-R11).** Write the repair tool into your scratchpad (never committed). It reads the four lines README quotes off the tree by CONTENT, keyed on member names, and rewrites README's one sentence; it is idempotent (a second run prints `unchanged`) and refuses rather than guesses when the sentence or the three adjacent union arms are not where it expects them. Write `<SCRATCH>/readme-reanchor.py`:

```python
#!/usr/bin/env python3
"""Re-point README's four `shared/api.ts` anchors (the purge-refusal vocabulary) BY CONTENT (S6-R11: README is
REPAIRED, never counted). Reads the lines off the tree; never adds a delta to a number. Run from the worktree root."""
import re
api = open('shared/api.ts', encoding='utf8').read().split('\n')
def line_of(prefix):
    hits = [i + 1 for i, l in enumerate(api) if l.startswith(prefix)]
    assert len(hits) == 1, f'{prefix!r} matched {len(hits)} lines; stop and report'
    return hits[0]
# The union arms by MEMBER NAME, never by what ends the line: CCR-15 wave 3 appends a member after
# 'purge-mechanism-absent', which moves its ';' to that new last arm.
a, b = line_of("  | 'purge-refused'"), line_of("  | 'purge-mechanism-absent'")
assert b == a + 2 and api[a].startswith("  | 'purge-incomplete'"), 'the three arms are no longer adjacent; stop and report'
c, d, e = line_of("  'purge-refused':"), line_of("  'purge-incomplete':"), line_of("  'purge-mechanism-absent':")
t = open('README.md', encoding='utf8').read()
pat = re.compile(r"\(`shared/api\.ts:\d+-\d+`\), each with an operator sentence of its own at `:\d+`,\n`:\d+` and `:\d+`,")
assert len(pat.findall(t)) == 1, 'the README sentence moved or changed; stop and report'
new = f"(`shared/api.ts:{a}-{b}`), each with an operator sentence of its own at `:{c}`,\n`:{d}` and `:{e}`,"
t2 = pat.sub(new, t)
open('README.md', 'w', encoding='utf8').write(t2)
print('unchanged' if t2 == t else f're-anchored: shared/api.ts:{a}-{b}, :{c}, :{d}, :{e}')
```

Then, from the worktree root:

```bash
( cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus' )
python3 <SCRATCH>/readme-reanchor.py
( cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus' )
git fetch origin main && git -C "$(git rev-parse --show-toplevel)" diff --quiet origin/main -- \
  docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md \
  docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md && echo corpus-frozen
```

Expected, in order: `2 failed | 5 passed | 326 skipped (333)` (`README HAS ITS OWN CENSUS ENTRY` and `CITATION DEBT` — Pre-flight finding 6); `re-anchored: shared/api.ts:7616-7618, :7656, :7664, :7677` on a `df4fe069` base; `7 passed | 326 skipped (333)` (on a base that already carries CCR-15 wave 3, `7 passed | 328 skipped (335)`); `corpus-frozen`. If `CITATION DEBT` is still red after the script, your insertion moved a FROZEN-corpus anchor, which this plan measured it does not: stop and report — never edit the census to match.

- [ ] **Step 7: Commit.** Tracked changes by `-u` (never a stray untracked file) and the new file by name:

```bash
git add -u shared/api.ts server/src/fleet.ts README.md server/test pwa/test
git add server/test/released-wire.test.ts
git commit -m "wire: FleetSession.releasedFrom — one reader, a tolerant reviver; fixtures carry it (workspace lifecycle W1)"
```

### Task 2: The decision — `server/src/coord/released.ts` (L1)

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Create: `server/src/coord/released.ts`
- Create: `server/test/released.test.ts`

**Interfaces:**
- Consumes: `ReleasedFrom`, `TERMINAL_RUN_STATES`, `RunState` (L0).
- Produces: `export interface LastRun { sessionId; runId; state: string; program; programTitle: string | null; claimedBy: string | null; closedAt: number | null }`; `export interface SessionRuns { lastRun: LastRun | null; openAsWorker: boolean; openAsClaimant: boolean }`; `export type ReleasedLookup = (sessionId: string) => SessionRuns`; `export interface ReleasedInput extends SessionRuns { workspace: string | null; held: boolean; archived: boolean; child: boolean }`; `export function releasedFrom(input: ReleasedInput): ReleasedFrom | null`; `export function foldLastRuns(last: readonly LastRun[], openWorkers: readonly string[], openClaimants: readonly string[]): ReleasedLookup`. The store (Task 3) imports `LastRun` from here — the consumer declares the port, `placement.ts`'s pattern.

- [ ] **Step 1: Write the failing test.** Create `server/test/released.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { foldLastRuns, releasedFrom, type LastRun, type ReleasedInput } from '../src/coord/released.js';

const run = (over: Partial<LastRun> = {}): LastRun => ({
  sessionId: 'ccrc-pwa-amber-delta', runId: 41, state: 'done', program: 'lifecycle', programTitle: 'Workspace lifecycle',
  claimedBy: 'ccrc-pwa-calm-mesa', closedAt: 1_790_000_000_000, ...over,
});

const input = (over: Partial<ReleasedInput> = {}): ReleasedInput => ({
  workspace: 'amber-delta', held: false, archived: false, child: false,
  lastRun: run(), openAsWorker: false, openAsClaimant: false, ...over,
});

describe('releasedFrom — the six conditions (workspace lifecycle spec §5.1)', () => {
  it('answers the newest run when all six hold', () => {
    expect(releasedFrom(input())).toEqual({
      runId: 41, program: 'lifecycle', programTitle: 'Workspace lifecycle',
      claimedBy: 'ccrc-pwa-calm-mesa', closedAt: 1_790_000_000_000, child: false,
    });
  });

  it('a `failed` run releases too — both members of TERMINAL_RUN_STATES', () => {
    expect(releasedFrom(input({ lastRun: run({ state: 'failed' }) }))?.runId).toBe(41);
  });

  it.each([
    ['a main checkout', { workspace: null }],
    ['a held workspace', { held: true }],
    ['an archived workspace', { archived: true }],
    ['a session no run ever named', { lastRun: null }],
    ['a newest run still working', { lastRun: run({ state: 'working' }) }],
    ['a newest run still planned', { lastRun: run({ state: 'planned' }) }],
    ['a newest run awaiting review', { lastRun: run({ state: 'awaiting-review' }) }],
    ['a state this build cannot name', { lastRun: run({ state: 'escalated' }) }],
    ['a terminal run with no readable close time', { lastRun: run({ closedAt: null }) }],
    ['an older run still open on the session', { openAsWorker: true }],
    ['a session that now coordinates a live run', { openAsClaimant: true }],
  ] as const)('is null for %s', (_label, over) => {
    expect(releasedFrom(input(over as Partial<ReleasedInput>))).toBeNull();
  });

  it('carries the child reading through, and a null title as null', () => {
    expect(releasedFrom(input({ child: true, lastRun: run({ programTitle: null, claimedBy: null }) })))
      .toMatchObject({ child: true, programTitle: null, claimedBy: null });
  });
});

describe('foldLastRuns', () => {
  it('keeps the NEWEST run per session whatever order the rows arrive in', () => {
    const a = run({ runId: 7, state: 'working' });
    const b = run({ runId: 9, state: 'done' });
    for (const rows of [[a, b], [b, a]]) {
      expect(foldLastRuns(rows, [], [])('ccrc-pwa-amber-delta').lastRun?.runId).toBe(9);
    }
  });

  it('answers "no runs" for a session the read never mentions', () => {
    expect(foldLastRuns([run()], [], [])('someone-else')).toEqual({ lastRun: null, openAsWorker: false, openAsClaimant: false });
  });

  it('reads the two open sets by exact id', () => {
    const look = foldLastRuns([], ['w-1'], ['c-1']);
    expect(look('w-1')).toMatchObject({ openAsWorker: true, openAsClaimant: false });
    expect(look('c-1')).toMatchObject({ openAsWorker: false, openAsClaimant: true });
  });
});

describe('released.ts is the pure module its own docstring says it is', () => {
  const SRC = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'coord', 'released.ts'), 'utf8');
  // Comments blanked, positions preserved: the docstring NAMES fs, fastify and coord.db while promising not to use them.
  const code = (): string => SRC
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));

  it('the scan is over real code', () => {
    expect(code()).toContain('export function releasedFrom');
    expect(code()).toContain('export function foldLastRuns');
  });

  it('has no clock, no node builtin, no store', () => {
    expect(code()).not.toMatch(/\bDate\s*\.\s*now\s*\(|\bnew\s+Date\s*\(|performance\s*\.\s*now/);
    expect(code()).not.toMatch(/from\s+'node:|\bfs\s*\.|require\s*\(/);
    expect(code()).not.toMatch(/CoordStore|\bcoord\s*\.|\bstore\s*\.|\breply\b|\bFastify/);
  });

  it('imports only L0', () => {
    const imports = [...code().matchAll(/^\s*import\b[^\n]*/gm)].map((m) => m[0]!.trim());
    expect(imports).toEqual([
      "import { TERMINAL_RUN_STATES, type ReleasedFrom, type RunState } from '../../../shared/api.js';",
    ]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `( cd server && ./node_modules/.bin/vitest run test/released.test.ts )`
Expected: `Error: Cannot find module '../src/coord/released.js'`, `Tests no tests`. (A missing module is a weak red on its own; Step 4's twenty cases and Task 10's rows S1–S8 are what bind each condition.)

- [ ] **Step 3: Write the module.** Create `server/src/coord/released.ts`:

```ts
/**
 * Whether a workspace was RELEASED — its programme is done with it — and from which run (workspace lifecycle
 * spec §5.1). The answer is `FleetSession.releasedFrom`, which puts the row in its card's `Released (N)` fold.
 *
 * PURE (L1): no `fs`, no fastify, no clock, no `coord.db`. The run facts arrive as `ReleasedLookup`, a port
 * declared BY THIS CONSUMER (`placement.ts`'s pattern): the store's narrow read (`lastRunBySession`) imports
 * `LastRun` from here rather than owning it, and `foldLastRuns` below builds the port from that read.
 *
 * DOUBT LEAVES THE ROW WHERE IT IS. Every condition this file cannot decide — an unknown run state, a terminal
 * run with no readable close time — answers `null`, and `null` renders the row exactly as it rendered before
 * this field existed. A false `null` costs a row the fold; a false non-null would fold away a workspace a
 * programme still owns.
 */
import { TERMINAL_RUN_STATES, type ReleasedFrom, type RunState } from '../../../shared/api.js';

/** One session's NEWEST run as `sessionId`, as the store reads it. `state` is the raw column: a token outside
 *  this build's vocabulary is not terminal here, so it never releases anything. `closedAt` is epoch MS, `null`
 *  when the column is NULL or not a positive safe integer — both mean "no close time this build can show". */
export interface LastRun {
  readonly sessionId: string;
  readonly runId: number;
  readonly state: string;
  readonly program: string;
  readonly programTitle: string | null;
  readonly claimedBy: string | null;
  readonly closedAt: number | null;
}

/** What the run table says about ONE session: its newest run (absent when no run ever named it as
 *  `sessionId`), and whether a non-terminal run names it as a worker or as a claimant. */
export interface SessionRuns {
  readonly lastRun: LastRun | null;
  readonly openAsWorker: boolean;
  readonly openAsClaimant: boolean;
}

export type ReleasedLookup = (sessionId: string) => SessionRuns;

export interface ReleasedInput extends SessionRuns {
  /** `SessionRecord.workspace` — a main checkout (`null`) is never released. */
  readonly workspace: string | null;
  /** A hold of any reason keeps the workspace its programme's. */
  readonly held: boolean;
  /** An archived workspace belongs to the `Archived (N)` fold, never to this one. */
  readonly archived: boolean;
  /** The registry's CCR-15 child reading is `child` or `unreadable` (`ReleasedFrom.child`). */
  readonly child: boolean;
}

const isTerminal = (state: string): boolean => (TERMINAL_RUN_STATES as readonly RunState[]).includes(state as RunState);

/** The decision. Non-null only when ALL six hold (spec §5.1): a workspace, no hold, not archived, the newest run
 *  as `sessionId` terminal, no non-terminal run naming the session as `sessionId`, none naming it as `claimedBy`. */
export function releasedFrom(input: ReleasedInput): ReleasedFrom | null {
  const { lastRun } = input;
  if (input.workspace === null || input.held || input.archived) return null;
  if (lastRun === null || !isTerminal(lastRun.state) || lastRun.closedAt === null) return null;
  if (input.openAsWorker || input.openAsClaimant) return null;
  return {
    runId: lastRun.runId, program: lastRun.program, programTitle: lastRun.programTitle,
    claimedBy: lastRun.claimedBy, closedAt: lastRun.closedAt, child: input.child,
  };
}

/** Build the port from the store's three answers. A session the read never mentions answers "no runs": no newest
 *  run, open as nothing. */
export function foldLastRuns(
  last: readonly LastRun[], openWorkers: readonly string[], openClaimants: readonly string[],
): ReleasedLookup {
  const byId = new Map<string, LastRun>();
  for (const r of last) {
    const prev = byId.get(r.sessionId);
    // Newest by id, whatever order the rows arrived in — `foldCoordPlacements`' rule.
    if (prev === undefined || r.runId > prev.runId) byId.set(r.sessionId, r);
  }
  const workers = new Set(openWorkers);
  const claimants = new Set(openClaimants);
  return (sessionId) => ({
    lastRun: byId.get(sessionId) ?? null,
    openAsWorker: workers.has(sessionId),
    openAsClaimant: claimants.has(sessionId),
  });
}
```

- [ ] **Step 4: Run it to verify it passes.**

Run: `( cd server && ./node_modules/.bin/vitest run test/released.test.ts )` → `20 passed (20)`.

- [ ] **Step 5: Commit.**

```bash
git add server/src/coord/released.ts server/test/released.test.ts
git commit -m "coord: releasedFrom — the six conditions, pure (workspace lifecycle W1)"
```

### Task 3: The store read — `CoordStore.lastRunBySession`

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Modify: `server/src/coord/store.ts` (an import, `LastRunsResult` beside `CoordPlacementStampsResult`, the method below `openCoordinatorIds`)
- Create: `server/test/released-store.test.ts`

**Interfaces:**
- Consumes: `LastRun` (Task 2).
- Produces: `export type LastRunsResult = { ok: true; last: LastRun[]; openWorkers: string[]; openClaimants: string[] } | { ok: false; kind: 'run-unreadable'; detail: string }`; `CoordStore.lastRunBySession(sessionIds: readonly string[]): LastRunsResult` — synchronous.

- [ ] **Step 1: Write the failing test.** Create `server/test/released-store.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { mkTmp } from './tmpHelpers.js';

const store = (): CoordStore =>
  new CoordStore(openCoordDb(path.join(mkTmp('ccrc-coord-'), '.ccrc', 'coord.db')));

const open = (s: CoordStore, program: string, wave: number, claimedBy = 'demo-coordinator'): number => {
  const r = s.openRun({ program, title: `${program} title`, project: 'ccrc-pwa', wave, waveOf: 3, claimedBy });
  if (!('id' in r)) throw new Error('openRun refused');
  return r.id;
};

describe('CoordStore.lastRunBySession (workspace lifecycle spec §5.1)', () => {
  it('answers each asked session’s NEWEST run, with the programme title joined', () => {
    const s = store();
    const w1 = open(s, 'lifecycle', 1);
    s.bindSession(w1, 'demo-worker');
    expect(s.advance(w1, 'failed', 'test-close').ok).toBe(true);
    const w2 = open(s, 'lifecycle', 2);
    s.bindSession(w2, 'demo-worker');
    expect(s.advance(w2, 'failed', 'test-close').ok).toBe(true);
    const read = s.lastRunBySession(['demo-worker']);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.last).toHaveLength(1);
    expect(read.last[0]).toMatchObject({
      sessionId: 'demo-worker', runId: w2, state: 'failed', program: 'lifecycle',
      programTitle: 'lifecycle title', claimedBy: 'demo-coordinator',
    });
    expect(typeof read.last[0]!.closedAt).toBe('number');
    // CONTROL for the open set below: every run naming this session is closed, so it is open as nothing.
    expect(read.openWorkers).toEqual([]);
  });

  it('is scoped to the asked ids — a run naming another session is not read', () => {
    const s = store();
    const r = open(s, 'lifecycle', 1);
    s.bindSession(r, 'someone-else');
    const read = s.lastRunBySession(['demo-worker']);
    expect(read).toEqual({ ok: true, last: [], openWorkers: [], openClaimants: ['demo-coordinator'] });
  });

  it('names an asked session a NON-terminal run binds, even when its newest run is terminal', () => {
    const s = store();
    const older = open(s, 'lifecycle', 1);
    s.bindSession(older, 'demo-worker');           // stays `planned`: open
    const newer = open(s, 'lifecycle', 2);
    s.bindSession(newer, 'demo-worker');
    expect(s.advance(newer, 'failed', 'test-close').ok).toBe(true);
    const read = s.lastRunBySession(['demo-worker']);
    expect(read.ok && read.last[0]!.runId).toBe(newer);
    expect(read.ok && read.openWorkers).toEqual(['demo-worker']);
  });

  it('answers every claimant of a non-terminal run, and none of a closed one', () => {
    const s = store();
    open(s, 'live', 1, 'live-coordinator');
    const done = open(s, 'over', 1, 'past-coordinator');
    expect(s.advance(done, 'failed', 'test-close').ok).toBe(true);
    const read = s.lastRunBySession(['anyone']);
    expect(read.ok && read.openClaimants).toEqual(['live-coordinator']);
  });

  it('reads nothing for an empty id list', () => {
    expect(store().lastRunBySession([])).toEqual({ ok: true, last: [], openWorkers: [], openClaimants: [] });
  });

  it('an unreadable close time costs THAT session its close time, and no other row its answer', () => {
    const s = store();
    const a = open(s, 'lifecycle', 1);
    s.bindSession(a, 'demo-a');
    expect(s.advance(a, 'failed', 'test-close').ok).toBe(true);
    const b = open(s, 'lifecycle', 2);
    s.bindSession(b, 'demo-b');
    expect(s.advance(b, 'failed', 'test-close').ok).toBe(true);
    s.db.prepare('UPDATE runs SET closedAt = ? WHERE id = ?').run('not-a-time', a);
    const read = s.lastRunBySession(['demo-a', 'demo-b']);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.last.find((r) => r.sessionId === 'demo-a')!.closedAt).toBeNull();
    expect(typeof read.last.find((r) => r.sessionId === 'demo-b')!.closedAt).toBe('number');
  });

  it('refuses the WHOLE read on an unrepresentable run id, naming the column and no value (D-2545)', () => {
    const s = store();
    const UNSAFE = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
    s.db.prepare('INSERT INTO programs (slug, title, createdAt, state) VALUES (?, ?, ?, ?)')
      .run('wide', 'Wide', Date.now(), 'active');
    s.db.exec('PRAGMA foreign_keys = OFF');
    try {
      s.db.prepare(
        'INSERT INTO runs (id, program, wave, waveOf, project, sessionId, state, claimedBy, openedAt, closedAt) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(UNSAFE, 'wide', 1, 1, 'ccrc-pwa', 'demo-worker', 'done', 'demo-coordinator', Date.now(), Date.now());
    } finally {
      s.db.exec('PRAGMA foreign_keys = ON');
    }
    expect(s.lastRunBySession(['demo-worker'])).toEqual({
      ok: false, kind: 'run-unreadable', detail: 'run id is not a positive safe integer',
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `( cd server && ./node_modules/.bin/vitest run test/released-store.test.ts )`
Expected: `7 failed (7)`, each a `TypeError: … lastRunBySession is not a function` (six read `s.lastRunBySession`, the empty-list case `store(...).lastRunBySession`).

- [ ] **Step 3: Add the read.** Three blocks in `server/src/coord/store.ts`:

Find:

```ts
import type { CoordPlacementStamp } from './placement.js';
```

Replace with:

```ts
import type { CoordPlacementStamp } from './placement.js';
import type { LastRun } from './released.js';
```

Find:

```ts
  | { ok: true; stamps: CoordPlacementStamp[] }
  | { ok: false; kind: 'run-unreadable'; detail: string };
```

Replace with:

```ts
  | { ok: true; stamps: CoordPlacementStamp[] }
  | { ok: false; kind: 'run-unreadable'; detail: string };

/** `lastRunBySession`'s answer (workspace lifecycle spec §5.1): each asked session's newest run as `sessionId`,
 *  the asked sessions a non-terminal run names as `sessionId`, and every `claimedBy` of a non-terminal run. */
export type LastRunsResult =
  | { ok: true; last: LastRun[]; openWorkers: string[]; openClaimants: string[] }
  | { ok: false; kind: 'run-unreadable'; detail: string };
```

Find:

```ts
    ).all() as { claimedBy: string }[]).map((r) => r.claimedBy);
  }
```

Replace with:

```ts
    ).all() as { claimedBy: string }[]).map((r) => r.claimedBy);
  }

  /**
   * The run facts `FleetSession.releasedFrom` is decided from (workspace lifecycle spec §5.1), for the sessions
   * one fleet assembly describes — ONE call per assembly, never one per row, beside `coordPlacementStamps`.
   * That read cannot answer this: it filters to `coordProject IS NOT NULL` and carries no state.
   * `openRunsForSession` is per-session and reserved for destructive decision points.
   *
   * Three statements, one synchronous call: nothing else writes `coord.db` between them. The claimant set is
   * `openCoordinatorIds`' own read, reused rather than respelled.
   *
   * `id` rides CAST to TEXT and proven, ALL-OR-FAILURE (D-2545's rule, `openRunsForSession`'s): a partial list
   * is how a session's newest run could silently read as an older, terminal one. `closedAt` is proven PER ROW
   * instead: an unreadable close time makes that one session's `LastRun.closedAt` null, which `releasedFrom`
   * reads as doubt, and costs no other row its answer.
   */
  lastRunBySession(sessionIds: readonly string[]): LastRunsResult {
    if (sessionIds.length === 0) return { ok: true, last: [], openWorkers: [], openClaimants: [] };
    const ph = placeholders(sessionIds.length);
    const rows = this.db.prepare(
      'SELECT CAST(r.id AS TEXT) AS idText, r.sessionId, r.state, r.program, p.title AS programTitle, ' +
      'r.claimedBy, CAST(r.closedAt AS TEXT) AS closedAtText FROM runs r ' +
      'LEFT JOIN programs p ON p.slug = r.program ' +
      `WHERE r.id IN (SELECT MAX(id) FROM runs WHERE sessionId IN (${ph}) GROUP BY sessionId) ORDER BY r.id`,
    ).all(...sessionIds) as unknown as {
      idText: string; sessionId: string; state: string; program: string; programTitle: string | null;
      claimedBy: string | null; closedAtText: string | null;
    }[];
    const last: LastRun[] = [];
    for (const r of rows) {
      const id = persistedInt(r.idText, 'run id');
      if (!id.ok) return { ok: false, kind: 'run-unreadable', detail: id.detail };
      const closed = r.closedAtText === null ? null : persistedInt(r.closedAtText, 'closedAt');
      last.push({
        sessionId: r.sessionId, runId: id.value, state: r.state, program: r.program,
        programTitle: r.programTitle, claimedBy: r.claimedBy, closedAt: closed !== null && closed.ok ? closed.value : null,
      });
    }
    const openWorkers = (this.db.prepare(
      `SELECT DISTINCT sessionId FROM runs WHERE sessionId IN (${ph}) AND state NOT IN ${TERMINAL_RUN_STATES_SQL}`,
    ).all(...sessionIds) as { sessionId: string }[]).map((r) => r.sessionId);
    return { ok: true, last, openWorkers, openClaimants: this.openCoordinatorIds() };
  }
```

- [ ] **Step 4: Run it, and the store's own suite, to verify they pass.**

Run: `( cd server && ./node_modules/.bin/vitest run test/released-store.test.ts test/coord-store.test.ts )` → `176 passed (176)`.

- [ ] **Step 5: Commit.**

```bash
git add server/src/coord/store.ts server/test/released-store.test.ts
git commit -m "coord: lastRunBySession — one batched run read per fleet assembly (workspace lifecycle W1)"
```

### Task 4: The field on the wire — `assembleFleet`

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Modify: `server/src/fleet.ts` (an import, `readReleased` above `idHomeWrapper`'s docstring, one call beside `readCoordPlacements`, the literal's `releasedFrom`)
- Create: `server/test/fleet-released.test.ts`

**Interfaces:**
- Consumes: `releasedFrom`, `foldLastRuns`, `ReleasedLookup` (Task 2); `CoordStore.lastRunBySession` (Task 3).
- Produces: every assembled `FleetSession` carries the computed `releasedFrom`.

- [ ] **Step 1: Write the failing test.** Create `server/test/fleet-released.test.ts`:

```ts
// `FleetSession.releasedFrom` on the wire (workspace lifecycle spec §5.1): `assembleFleet` reads the run facts
// once, decides per row with the pure `releasedFrom`, and emits null for every row when the read fails.
import { describe, it, expect, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { assembleFleet } from '../src/fleet.js';
import { Tmux } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';

const seedSession = (home: string, id: string, extra: Record<string, string> = {}) => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper: 'claude', project: 'demo', workdir: `/data/projects/${id}`, uuid: '1'.repeat(36), started: '1', ...extra };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};
const mkCoord = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-coord-'), '.ccrc', 'coord.db')));
const dead = new Tmux(async () => ({ code: 1, stdout: '', stderr: '' }));
const NOW_S = 1784600000;

/** One closed run naming `sessionId` as its worker. */
const closedRun = (coord: CoordStore, sessionId: string, claimedBy = 'demo-coordinator'): number => {
  const r = coord.openRun({ program: 'lifecycle', title: 'Workspace lifecycle', project: 'demo', wave: 1, waveOf: 1, claimedBy });
  if (!('id' in r)) throw new Error('openRun refused');
  coord.bindSession(r.id, sessionId);
  expect(coord.advance(r.id, 'failed', 'test-close').ok).toBe(true);
  return r.id;
};

const assemble = (home: string, coord?: CoordStore) => assembleFleet(
  localIO, loadConfig({ CCRC_HOME: home }), dead, NOW_S,
  undefined, undefined, undefined, undefined, undefined, undefined, coord,
);

describe('releasedFrom on the wire', () => {
  it('a workspace whose only run closed is released from that run', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'demo-amber', { workspace: 'amber' });
    const coord = mkCoord();
    const id = closedRun(coord, 'demo-amber');
    const row = (await assemble(home, coord)).find((s) => s.id === 'demo-amber')!;
    expect(row.releasedFrom).toMatchObject({
      runId: id, program: 'lifecycle', programTitle: 'Workspace lifecycle', claimedBy: 'demo-coordinator', child: false,
    });
  });

  it('each registry fact reaches the decision — a hold, an archive, a main checkout, a child marker', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'demo-held', { workspace: 'held', hold: 'program:lifecycle wave:1/1' });
    seedSession(home, 'demo-arch', { workspace: 'arch', archived: String(NOW_S - 60) });
    seedSession(home, 'demo-main');                                    // no workspace: a main checkout
    seedSession(home, 'demo-child', { workspace: 'child', child: '7' });
    seedSession(home, 'demo-garbled', { workspace: 'garbled', child: 'not-a-run' });
    const coord = mkCoord();
    for (const id of ['demo-held', 'demo-arch', 'demo-main', 'demo-child', 'demo-garbled']) closedRun(coord, id);
    const fleet = await assemble(home, coord);
    const rf = (id: string) => fleet.find((s) => s.id === id)!.releasedFrom;
    expect(rf('demo-held')).toBeNull();
    expect(rf('demo-arch')).toBeNull();
    expect(rf('demo-main')).toBeNull();
    expect(rf('demo-child')?.child).toBe(true);
    expect(rf('demo-garbled')?.child).toBe(true);          // unreadable reads as a child: the direction that defers
  });

  it('a former worker that now coordinates a live run is not released', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'demo-amber', { workspace: 'amber' });
    const coord = mkCoord();
    closedRun(coord, 'demo-amber');
    coord.openRun({ program: 'next', title: 'Next', project: 'demo', wave: 1, waveOf: 1, claimedBy: 'demo-amber' });
    expect((await assemble(home, coord)).find((s) => s.id === 'demo-amber')!.releasedFrom).toBeNull();
  });

  it('no coord store (a dark box): every row reads null, and the tick resolves', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'demo-amber', { workspace: 'amber' });
    expect((await assemble(home)).find((s) => s.id === 'demo-amber')!.releasedFrom).toBeNull();
  });

  it('a REFUSED read emits null on every row, never a stale non-null', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'demo-amber', { workspace: 'amber' });
    const coord = mkCoord();
    closedRun(coord, 'demo-amber');
    vi.spyOn(coord, 'lastRunBySession').mockReturnValue({ ok: false, kind: 'run-unreadable', detail: 'closed for the test' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await assemble(home, coord)).find((s) => s.id === 'demo-amber')!.releasedFrom).toBeNull();
    // A refusal and an empty store answer the same null ON THE WIRE, deliberately; the log line is what tells
    // them apart for the operator, and it names the refusal's own detail.
    expect(warn.mock.calls.map((c) => String(c[0]))).toContainEqual(expect.stringMatching(/lastRunBySession refused .* closed for the test/));
    warn.mockRestore();
  });

  it('a THROWING read emits null too, and the tick still resolves', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'demo-amber', { workspace: 'amber' });
    const coord = mkCoord();
    closedRun(coord, 'demo-amber');
    vi.spyOn(coord, 'lastRunBySession').mockImplementation(() => { throw new Error('lock race'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await assemble(home, coord)).find((s) => s.id === 'demo-amber')!.releasedFrom).toBeNull();
    expect(warn.mock.calls.map((c) => String(c[0]))).toContainEqual(expect.stringMatching(/lastRunBySession failed .* lock race/));
    warn.mockRestore();
  });

  it('ONE store read per assembly, whatever the row count', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    for (const id of ['demo-a', 'demo-b', 'demo-c']) seedSession(home, id, { workspace: id });
    const coord = mkCoord();
    const spy = vi.spyOn(coord, 'lastRunBySession');
    await assemble(home, coord);
    expect(spy).toHaveBeenCalledTimes(1);
    expect([...spy.mock.calls[0]![0]].sort()).toEqual(['demo-a', 'demo-b', 'demo-c']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `( cd server && ./node_modules/.bin/vitest run test/fleet-released.test.ts )`
Expected: `5 failed | 2 passed (7)` — the released row reads `null`, the child rows read `null`, no warning is logged, the spy is never called. The two that pass are right for the wrong reason on this tree (every row is `null`): Task 10's row S7 is what makes the former-worker case bite; the dark-box case pins only that a box with no coord store resolves with `null`, which every mutant of its guard also does (a deleted guard throws into the catch) — a regression pin, not a guard's.

- [ ] **Step 3: Compute it.** Four blocks in `server/src/fleet.ts`; the last replaces Task 1's `releasedFrom: null`:

Find:

```ts
import { boardPlacement, foldCoordPlacements, type StampLookup } from './coord/placement.js';
// F2(b): the `held` chip's ceiling, DERIVED from the lane's own two
```

Replace with:

```ts
import { boardPlacement, foldCoordPlacements, type StampLookup } from './coord/placement.js';
import { foldLastRuns, releasedFrom, type ReleasedLookup } from './coord/released.js';
// F2(b): the `held` chip's ceiling, DERIVED from the lane's own two
```

Find:

```ts
    console.warn(`ccrc-server: coordPlacementStamps failed while computing board placement — ${err instanceof Error ? err.message : String(err)} — boardProject reads null this tick`);
    return { ok: false };
```

Replace with:

```ts
    console.warn(`ccrc-server: coordPlacementStamps failed while computing board placement — ${err instanceof Error ? err.message : String(err)} — boardProject reads null this tick`);
    return { ok: false };
  }
}

/** What `readReleased` hands back: the port when the store answered, or `ok: false` when the READ failed —
 *  `CoordPlacementsRead`'s shape and reason (D-2875): a failed read must not look like "nothing released". */
type ReleasedRead = { ok: true; lookup: ReleasedLookup } | { ok: false };

/**
 * `FleetSession.releasedFrom`'s batched, guarded read (workspace lifecycle spec §5.1) — ONE `lastRunBySession`
 * call per assembly, beside `readCoordPlacements` and under the same failure contract: `coord` absent (a dark
 * box, every older test) or an empty registry reads nothing and answers "no runs" for every row; a refusal or a
 * synchronous `node:sqlite` throw is caught, never thrown out of `assembleFleet`, and answers `{ ok: false }`,
 * which makes every row's `releasedFrom` null this tick — doubt leaves every row where it was.
 */
function readReleased(coord: CoordStore | undefined, sessionIds: readonly string[]): ReleasedRead {
  if (!coord || sessionIds.length === 0) return { ok: true, lookup: foldLastRuns([], [], []) };
  try {
    const read = coord.lastRunBySession(sessionIds);
    if (!read.ok) {
      console.warn(`ccrc-server: lastRunBySession refused while computing released rows — ${read.detail} — releasedFrom reads null this tick`);
      return { ok: false };
    }
    return { ok: true, lookup: foldLastRuns(read.last, read.openWorkers, read.openClaimants) };
  } catch (err) {
    console.warn(`ccrc-server: lastRunBySession failed while computing released rows — ${err instanceof Error ? err.message : String(err)} — releasedFrom reads null this tick`);
    return { ok: false };
```

Find:

```ts
  const placements = readCoordPlacements(coord, recs.length);
  const nowMs = now * 1000;
```

Replace with:

```ts
  const placements = readCoordPlacements(coord, recs.length);
  // Workspace lifecycle §5.1: ONE run read for the whole assembly, like the placement read above.
  const released = readReleased(coord, recs.map((r) => r.id));
  const nowMs = now * 1000;
```

Find:

```ts
      child: r.child,
      releasedFrom: null,   // workspace lifecycle §5.1 — Task 4 computes it; null renders the row as today
      bucket: 'idle', bucketSince: null,   // replaced immediately below
```

Replace with:

```ts
      child: r.child,
      // Workspace lifecycle §5.1. `child` here is the registry's reading, `unreadable` counted as a child.
      releasedFrom: released.ok
        ? releasedFrom({
          ...released.lookup(r.id), workspace: r.workspace, held: r.held !== null,
          archived: r.archivedAt !== null, child: r.child.kind !== 'none',
        })
        : null,
      bucket: 'idle', bucketSince: null,   // replaced immediately below
```

- [ ] **Step 4: Run it, and the fleet suite, to verify they pass.**

```bash
( cd server && ./node_modules/.bin/vitest run test/fleet-released.test.ts test/fleet.test.ts )
( cd server && ./node_modules/.bin/tsc --noEmit -p . )
```

Expected: `94 passed (94)`; no output from `tsc`.

- [ ] **Step 5: Commit.**

```bash
git add server/src/fleet.ts server/test/fleet-released.test.ts
git commit -m "fleet: releasedFrom computed once per assembly; a failed read folds nothing (workspace lifecycle W1)"
```

### Task 5: The split — `groupFleet`

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Modify: `pwa/src/fleet/groupFleet.ts` (the import, two docstrings, `FleetGroup.released`, `inReleasedFold` and `releasedByProgramme` above `groupFleet`, visible rows first in the card order, the split, the group literal)
- Modify: `pwa/test/groupFleet.test.ts` (imports; two describe blocks appended)
- Modify: `pwa/test/project-card.test.tsx` (its group fixture gains `released: []` — the type now requires it)

**Interfaces:**
- Consumes: `releasedFromOf`, `ReleasedFrom` (Task 1).
- Produces: `FleetGroup.released: FleetSession[]` (newest close first); `export function inReleasedFold(s: FleetSession): boolean`; `export interface ReleasedProgramme { program: string; title: string | null; sessions: FleetSession[] }`; `export function releasedByProgramme(released: readonly FleetSession[]): ReleasedProgramme[]`. A card's place in the list comes from its first VISIBLE member: folded rows are inserted after every visible one.

- [ ] **Step 1: Write the failing tests.** In `pwa/test/groupFleet.test.ts`:

Find:

```ts
import path from 'node:path';
import { groupFleet } from '../src/fleet/groupFleet';
import type { FleetSession } from '../../shared/api';

```

Replace with:

```ts
import path from 'node:path';
import { groupFleet, releasedByProgramme } from '../src/fleet/groupFleet';
import type { FleetSession, ReleasedFrom } from '../../shared/api';

```

Find:

```ts
    expect(g.find((x) => x.project === 'intake')!.elsewhere).toEqual([]);
  });
});

```

Replace with:

```ts
    expect(g.find((x) => x.project === 'intake')!.elsewhere).toEqual([]);
  });
});

describe('the Released sub-fold (workspace lifecycle spec §5.1)', () => {
  const rel = (runId: number, closedAt: number, program = 'lifecycle', over: Partial<ReleasedFrom> = {}): ReleasedFrom =>
    ({ runId, program, programTitle: 'Workspace lifecycle', claimedBy: 'coord', closedAt, child: false, ...over });

  it('folds a released row out of the live list, into `released`, never dropping it', () => {
    const g = groupFleet([
      s({ id: 'live' }),
      s({ id: 'done', workspace: 'w', releasedFrom: rel(1, 100) }),
    ], [])[0]!;
    expect(g.sessions.map((m) => m.id)).toEqual(['live']);
    expect(g.released.map((m) => m.id)).toEqual(['done']);
  });

  // A DEAD stranded row stays too: the `stranded` count skips it, but a marker the row still carries is the
  // operator's to see, and folding it would hide it a second time.
  it.each([
    ['an attention', { bucket: 'attention' }],
    ['a working', { bucket: 'working' }],
    ['a live stranded', { stranded: { at: 1, reason: 'no lane' } }],
    ['a dead stranded', { status: 'dead', bucket: 'dead', stranded: { at: 1, reason: 'no lane' } }],
  ] as const)('never folds %s row — the fold cannot hide what needs a person', (_label, over) => {
    const g = groupFleet([s({ id: 'r', releasedFrom: rel(1, 100), ...(over as Partial<FleetSession>) })], [])[0]!;
    expect(g.released).toEqual([]);
    expect(g.sessions.map((m) => m.id)).toEqual(['r']);
  });

  it('folds an idle, a done and a dead released row alike', () => {
    const g = groupFleet([
      s({ id: 'a', bucket: 'idle', releasedFrom: rel(1, 100) }),
      s({ id: 'b', bucket: 'done', releasedFrom: rel(2, 200) }),
      s({ id: 'c', status: 'dead', bucket: 'dead', releasedFrom: rel(3, 300) }),
    ], [])[0]!;
    expect(g.released.map((m) => m.id)).toEqual(['c', 'b', 'a']);   // newest close first
    expect(g.sessions).toEqual([]);
  });

  it('an archived row stays in `archived`, never in both folds', () => {
    const g = groupFleet([s({ id: 'x', bucket: 'archived', archivedAt: 5, releasedFrom: rel(1, 100) })], [])[0]!;
    expect(g.archived.map((m) => m.id)).toEqual(['x']);
    expect(g.released).toEqual([]);
  });

  it('a row from a server older than the field (no key at all) stays live', () => {
    const { releasedFrom: _absent, ...old } = s({ id: 'old' });
    const g = groupFleet([old as FleetSession], [])[0]!;
    expect(g.sessions.map((m) => m.id)).toEqual(['old']);
    expect(g.released).toEqual([]);
  });

  it('a folded row never lifts its card: cards order by their first VISIBLE row', () => {
    const g = groupFleet([
      s({ id: 'r', project: 'alpha', bucket: 'done', releasedFrom: rel(1, 100) }),   // done outranks working
      s({ id: 'w', project: 'beta', bucket: 'working' }),
    ], []);
    expect(g.map((x) => x.project)).toEqual(['beta', 'alpha']);
  });

  it('released rows count toward unseen, and toward neither busy nor pin while a live row exists', () => {
    const g = groupFleet([
      s({ id: 'live', home: 'claude2', bucket: 'idle' }),
      s({ id: 'r', home: 'claude-b', bucket: 'done', bucketSince: 50, releasedFrom: rel(1, 100) }),
    ], [])[0]!;
    expect(g.unseen).toBe(1);                                           // the `done` released row
    expect(g.busy).toBe(0);
    expect(g.pin).toEqual({ state: 'shared', home: 'claude2' });
  });
});

describe('releasedByProgramme', () => {
  const rel = (runId: number, closedAt: number, program: string, programTitle: string | null = null): ReleasedFrom =>
    ({ runId, program, programTitle, claimedBy: 'coord', closedAt, child: false });

  it('groups by programme; groups and rows run newest close first', () => {
    const out = releasedByProgramme([
      s({ id: 'a1', releasedFrom: rel(1, 100, 'alpha', 'Alpha') }),
      s({ id: 'b1', releasedFrom: rel(2, 300, 'beta') }),
      s({ id: 'a2', releasedFrom: rel(3, 200, 'alpha', 'Alpha') }),
    ]);
    expect(out.map((g) => [g.program, g.title, g.sessions.map((m) => m.id)])).toEqual([
      ['beta', null, ['b1']],
      ['alpha', 'Alpha', ['a2', 'a1']],
    ]);
  });

  it('takes a title from any row of the programme that knew it', () => {
    const out = releasedByProgramme([
      s({ id: 'a1', releasedFrom: rel(1, 200, 'alpha', null) }),
      s({ id: 'a2', releasedFrom: rel(2, 100, 'alpha', 'Alpha') }),
    ]);
    expect(out[0]!.title).toBe('Alpha');
  });

  it('breaks a close-time tie by session id, so the order is total', () => {
    const out = releasedByProgramme([
      s({ id: 'zz', releasedFrom: rel(1, 100, 'alpha') }),
      s({ id: 'aa', releasedFrom: rel(2, 100, 'alpha') }),
    ]);
    expect(out[0]!.sessions.map((m) => m.id)).toEqual(['aa', 'zz']);
  });
});

```

- [ ] **Step 2: Run them to verify they fail.**

Run: `( cd pwa && ./node_modules/.bin/vitest run test/groupFleet.test.ts )`
Expected: `13 failed | 37 passed (50)` — every new case: `released` is undefined, `releasedByProgramme` is not a function, and a folded `done` row still leads the card order.

- [ ] **Step 3: Split.** Seven blocks in `pwa/src/fleet/groupFleet.ts`:

Find:

```ts
import { boardHome, type FleetSession } from '../../../shared/api';
import { isUnseen, type Acks } from '../lib/seen';
```

Replace with:

```ts
import { boardHome, releasedFromOf, type FleetSession, type ReleasedFrom } from '../../../shared/api';
import { isUnseen, type Acks } from '../lib/seen';
```

Find:

```ts
  /** How many LIVE members this device has not yet acknowledged — `isUnseen`
   *  (pwa/src/lib/seen.ts) run over `sessions`.
   *
```

Replace with:

```ts
  /** How many LIVE members this device has not yet acknowledged — `isUnseen`
   *  (pwa/src/lib/seen.ts) run over `sessions` AND `released` (a released row is
   *  live; folding it must not quiet its count).
   *
```

Find:

```ts
  archived: FleetSession[];
  /** Where this project's OWN workspaces render when it is not here — one
```

Replace with:

```ts
  archived: FleetSession[];
  /** Members in the `Released (N)` fold (workspace lifecycle spec §5.1) — `inReleasedFold` below, newest close
   *  first. The transition zone: a programme is done with them, and they wait here to be archived. Like
   *  `archived`, folded and never dropped; unlike `archived`, they still count toward `unseen`, since a
   *  released row is live. They take no part in `attention`, `busy` or `stranded` — by construction, which is
   *  the fold's own rule — nor in the card's ORDER. They take part in `pin` only on a card with no live row,
   *  where the pin falls back to every member, exactly as it does on a card whose members are all archived. */
  released: FleetSession[];
  /** Where this project's OWN workspaces render when it is not here — one
```

Find:

```ts
  elsewhere: readonly { project: string; count: number }[];
}
```

Replace with:

```ts
  elsewhere: readonly { project: string; count: number }[];
}

/**
 * Whether a row belongs in its card's `Released (N)` fold (workspace lifecycle spec §5.1): the server says it was
 * released, and nothing about it needs a person. Attention, a turn in progress and a strand are never folded —
 * a fold "can never hide the one thing this screen exists to surface" (the `attention` field above) — so such a
 * row stays at the top level, released or not, and folds on the first frame where none of them holds. The
 * strand is read as `(s.stranded ?? null) !== null`, the `stranded` count's own spelling, dead or alive: a
 * marker the row still carries is the operator's to see. `archived` is excluded here too, though `releasedFrom`
 * already is null for an archived row: the two folds must never share a row.
 */
export function inReleasedFold(s: FleetSession): boolean {
  return releasedFromOf(s) !== null && s.bucket !== 'archived' && s.bucket !== 'attention'
    && s.bucket !== 'working' && (s.stranded ?? null) === null;
}

/** One programme's rows inside the `Released (N)` fold. `title` is the programme's title when the server knew it,
 *  else `null` and the card shows the slug alone. */
export interface ReleasedProgramme {
  program: string;
  title: string | null;
  sessions: FleetSession[];
}

const closedAtOf = (s: FleetSession): number => (releasedFromOf(s) as ReleasedFrom).closedAt;

/** The fold's contents grouped by programme (spec §5.1): groups and the rows within them run newest `closedAt`
 *  first, a group ranked by its newest row; ties fall back to the slug, then the session id, so the order is
 *  total. Rows `releasedFromOf` answers null for are not this function's: it takes `FleetGroup.released`. */
export function releasedByProgramme(released: readonly FleetSession[]): ReleasedProgramme[] {
  const by = new Map<string, ReleasedProgramme>();
  const sorted = [...released].filter((s) => releasedFromOf(s) !== null)
    .sort((a, b) => closedAtOf(b) - closedAtOf(a) || a.id.localeCompare(b.id));
  for (const s of sorted) {
    const r = releasedFromOf(s) as ReleasedFrom;
    const g = by.get(r.program);
    if (g) {
      g.sessions.push(s);
      if (g.title === null && r.programTitle !== null) g.title = r.programTitle;
    } else by.set(r.program, { program: r.program, title: r.programTitle, sessions: [s] });
  }
  return [...by.values()].sort((a, b) =>
    closedAtOf(b.sessions[0]!) - closedAtOf(a.sessions[0]!) || a.program.localeCompare(b.program));
}
```

Find:

```ts
  const byProject = new Map<string, FleetSession[]>();
  for (const s of sortFleet(sessions)) {
    const card = boardHome(s);
```

Replace with:

```ts
  const byProject = new Map<string, FleetSession[]>();
  // Released rows LAST (workspace lifecycle §5.1): a card's place comes from its first member, and a folded row must
  // not lift its card above one whose top visible row is more urgent. Stable, so both halves keep the fleet order.
  const sorted = sortFleet(sessions);
  for (const s of [...sorted.filter((m) => !inReleasedFold(m)), ...sorted.filter(inReleasedFold)]) {
    const card = boardHome(s);
```

Find:

```ts
    // `cleanup` member stays in the live list its own chip counts it in.
    const live = members.filter((m) => m.bucket !== 'archived');
    const archived = members.filter((m) => m.bucket === 'archived');
    // `live` can be empty (every workspace of a project archived), so the pin
    // falls back to the whole membership; and the whole membership can be
    // empty (a durable card), which is the union's third state — never an
```

Replace with:

```ts
    // `cleanup` member stays in the live list its own chip counts it in.
    const live = members.filter((m) => m.bucket !== 'archived' && !inReleasedFold(m));
    const archived = members.filter((m) => m.bucket === 'archived');
    // Workspace lifecycle §5.1: newest close first, the fold's own order.
    const released = members.filter(inReleasedFold)
      .sort((a, b) => closedAtOf(b) - closedAtOf(a) || a.id.localeCompare(b.id));
    // `live` can be empty (every workspace of a project archived or released),
    // so the pin falls back to the whole membership; and the whole membership can be
    // empty (a durable card), which is the union's third state — never an
```

Find:

```ts
      archived,
      attention: live.some((m) => m.bucket === 'attention'),
      busy: live.filter((m) => m.bucket === 'working').length,
      unseen: live.filter((m) => isUnseen(m, acks)).length,
      pin,
```

Replace with:

```ts
      archived,
      released,
      attention: live.some((m) => m.bucket === 'attention'),
      busy: live.filter((m) => m.bucket === 'working').length,
      // A released row is live, so it still counts (spec §5.1) — folding it must not quiet its badge.
      unseen: [...live, ...released].filter((m) => isUnseen(m, acks)).length,
      pin,
```

And the card test's group fixture, which the now-required member breaks at typecheck:

Find:

```tsx
  project: 'demo', sessions: [sess()], attention: false, busy: 0, unseen: 0, pin: { state: 'shared', home: 'claude' },
  stranded: 0, archived: [], elsewhere: [], ...over,
});
```

Replace with:

```tsx
  project: 'demo', sessions: [sess()], attention: false, busy: 0, unseen: 0, pin: { state: 'shared', home: 'claude' },
  stranded: 0, archived: [], released: [], elsewhere: [], ...over,
});
```

- [ ] **Step 4: Run them to verify they pass.**

```bash
( cd pwa && ./node_modules/.bin/vitest run test/groupFleet.test.ts test/project-card.test.tsx )
( cd pwa && ./node_modules/.bin/tsc --noEmit -p . )
```

Expected: `148 passed (148)`, `Type Errors no errors`; no output from `tsc`.

- [ ] **Step 5: Commit.**

```bash
git add pwa/src/fleet/groupFleet.ts pwa/test/groupFleet.test.ts pwa/test/project-card.test.tsx
git commit -m "pwa: groupFleet splits released rows into their fold, never attention, work or a strand (workspace lifecycle W1)"
```

### Task 6: "Archive all" — the loop

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Create: `pwa/src/fleet/archiveReleased.ts`
- Create: `pwa/test/archiveReleased.test.ts`

**Interfaces:**
- Consumes: `releasedFromOf` (Task 1); `inReleasedFold` (Task 5).
- Produces: `export interface ArchiveReleasedDeps { current: (id: string) => FleetSession | undefined; archive: (id: string) => Promise<unknown>; errorText: (err: unknown) => string }`; `export interface ArchiveReleasedResult { archived: string[]; skipped: string[]; refused: { id: string; reason: string }[] }`; `export function archivableReleased(s: FleetSession): boolean`; `export async function archiveReleased(ids: readonly string[], deps: ArchiveReleasedDeps): Promise<ArchiveReleasedResult>`; `export function archiveReleasedSummary(r: ArchiveReleasedResult): string`. The caller hands the loop EVERY folded id, children included; the loop skips what it must not send.

- [ ] **Step 1: Write the failing test.** Create `pwa/test/archiveReleased.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { archivableReleased, archiveReleased, archiveReleasedSummary } from '../src/fleet/archiveReleased';
import type { FleetSession, ReleasedFrom } from '../../shared/api';

const rel = (child = false): ReleasedFrom =>
  ({ runId: 1, program: 'lifecycle', programTitle: null, claimedBy: 'coord', closedAt: 100, child });

const s = (over: Partial<FleetSession>): FleetSession => ({
  id: 'x', wrapper: 'claude2', home: 'claude2', project: 'p', workdir: '/p',
  workspace: 'w', name: null, status: 'idle', statusUpdatedAt: 0, limits: null,
  dialogPending: false, version: null, model: null, effort: null,
  ultracode: false, branch: null, ctxPct: null, paneCols: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null,
  hookState: null, askSummary: null, subagents: null, graphQueries: null, graphGateDenials: null, held: null,
  bucket: 'idle', bucketSince: null, unmeasured: [], statusUnmeasured: false,
  lifecycle: null, stoppedBy: null, swapBlocked: null, stranded: null, substrate: null, started: true, spawnState: null, ask: null, usage: null, boardProject: null, route: null, child: { kind: 'none' }, releasedFrom: rel(), ...over,
});

const deps = (rows: FleetSession[], archive: (id: string) => Promise<unknown> = vi.fn(async () => undefined)) => ({
  current: (id: string) => rows.find((r) => r.id === id),
  archive,
  errorText: (err: unknown) => (err instanceof Error ? err.message : String(err)),
});

describe('archivableReleased', () => {
  it('is a folded row that is not a child', () => {
    expect(archivableReleased(s({}))).toBe(true);
    expect(archivableReleased(s({ releasedFrom: rel(true) }))).toBe(false);
    expect(archivableReleased(s({ bucket: 'working' }))).toBe(false);
    expect(archivableReleased(s({ releasedFrom: null }))).toBe(false);
  });

  it('reads the child flag off releasedFrom, not off FleetSession.child — one decision, one field', () => {
    expect(archivableReleased(s({ child: { kind: 'child', runId: 7 } }))).toBe(true);
  });
});

describe('archiveReleased — plain archives, one at a time', () => {
  it('sends each row with its id ALONE — never force, never any option', async () => {
    const archive = vi.fn(async (_id: string): Promise<unknown> => undefined);
    const rows = [s({ id: 'a' }), s({ id: 'b' })];
    const out = await archiveReleased(['a', 'b'], deps(rows, archive));
    expect(archive.mock.calls).toEqual([['a'], ['b']]);
    expect(out).toEqual({ archived: ['a', 'b'], skipped: [], refused: [] });
  });

  it('is sequential — the second request starts only after the first settles', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const archive = vi.fn(async (id: string) => {
      order.push(`start ${id}`);
      if (id === 'a') await gate;
      order.push(`end ${id}`);
    });
    const done = archiveReleased(['a', 'b'], deps([s({ id: 'a' }), s({ id: 'b' })], archive));
    await Promise.resolve();
    expect(order).toEqual(['start a']);
    release();
    await done;
    expect(order).toEqual(['start a', 'end a', 'start b', 'end b']);
  });

  it('skips a child, and a row that left the fold or the fleet before its turn — re-read each time', async () => {
    const rows = [s({ id: 'a' }), s({ id: 'kid', releasedFrom: rel(true) }), s({ id: 'busy' })];
    const archive = vi.fn(async (id: string) => {
      // The first archive lands, and meanwhile `busy` starts a turn: the NEXT read must see it.
      if (id === 'a') rows[2] = s({ id: 'busy', bucket: 'working' });
    });
    const out = await archiveReleased(['a', 'kid', 'busy', 'gone'], deps(rows, archive));
    expect(archive.mock.calls).toEqual([['a']]);
    expect(out).toEqual({ archived: ['a'], skipped: ['kid', 'busy', 'gone'], refused: [] });
  });

  it('a refusal is kept with its reason and does not stop the loop', async () => {
    const archive = vi.fn(async (id: string) => { if (id === 'a') throw new Error('busy: a turn is in progress'); });
    const out = await archiveReleased(['a', 'b'], deps([s({ id: 'a' }), s({ id: 'b' })], archive));
    expect(out).toEqual({ archived: ['b'], skipped: [], refused: [{ id: 'a', reason: 'busy: a turn is in progress' }] });
  });
});

describe('archiveReleasedSummary', () => {
  it('counts, and names every refusal with the server’s reason', () => {
    expect(archiveReleasedSummary({ archived: ['a'], skipped: ['k'], refused: [] }))
      .toBe('Archived 1, skipped 1, refused 0.');
    expect(archiveReleasedSummary({ archived: [], skipped: [], refused: [{ id: 'a', reason: 'busy' }, { id: 'b', reason: 'gone' }] }))
      .toBe('Archived 0, skipped 0, refused 2: a — busy; b — gone');
  });
});
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `( cd pwa && ./node_modules/.bin/vitest run test/archiveReleased.test.ts )`
Expected: `Failed to resolve import "../src/fleet/archiveReleased"`, `Tests no tests`.

- [ ] **Step 3: Write the loop.** Create `pwa/src/fleet/archiveReleased.ts`:

```ts
// "Archive all (N)" inside a card's `Released (N)` fold (workspace lifecycle spec §5.1).
//
// PLAIN archives, one at a time: never `force`, and never any other option — the server's door decides every
// refusal, and this loop only reports it. Children are skipped (CCR-15 reclaims them itself; its spec §5.9
// assumes a child is never archived), and every row is re-read from the CURRENT frame just before its own
// request, because a row can stop being released while the loop is still working through the rows above it.
import { releasedFromOf, type FleetSession } from '../../../shared/api';
import { inReleasedFold } from './groupFleet';

export interface ArchiveReleasedDeps {
  /** The row as the newest frame has it, or `undefined` if it has left the fleet. */
  current: (id: string) => FleetSession | undefined;
  /** `api.archive` with its id alone — the loop never passes a second argument. */
  archive: (id: string) => Promise<unknown>;
  /** `apiErrorText`: ccd's own refusal sentence when there is one. */
  errorText: (err: unknown) => string;
}

export interface ArchiveReleasedResult {
  archived: string[];
  /** Left alone by the loop: a child, or a row no longer in the fold (or gone) when its turn came. The screen hands
   *  the loop EVERY folded id, children included, so this count is the fold's whole remainder. */
  skipped: string[];
  /** Sent, and the server said no — each with the reason it gave. */
  refused: { id: string; reason: string }[];
}

/** Whether "Archive all" would send this row at all — a folded row that is not a child. `releasedFrom.child` is
 *  the one reading used, never `FleetSession.child`: one decision, one field. */
export function archivableReleased(s: FleetSession): boolean {
  return inReleasedFold(s) && releasedFromOf(s)?.child === false;
}

export async function archiveReleased(ids: readonly string[], deps: ArchiveReleasedDeps): Promise<ArchiveReleasedResult> {
  const out: ArchiveReleasedResult = { archived: [], skipped: [], refused: [] };
  for (const id of ids) {
    const row = deps.current(id);
    if (row === undefined || !archivableReleased(row)) {
      out.skipped.push(id);
      continue;
    }
    try {
      await deps.archive(id);
      out.archived.push(id);
    } catch (err) {
      out.refused.push({ id, reason: deps.errorText(err) });
    }
  }
  return out;
}

/** The one summary toast. Counts first, then each refusal with its reason, so nothing the server said is lost. */
export function archiveReleasedSummary(r: ArchiveReleasedResult): string {
  const head = `Archived ${r.archived.length}, skipped ${r.skipped.length}, refused ${r.refused.length}`;
  return r.refused.length === 0 ? `${head}.` : `${head}: ${r.refused.map((x) => `${x.id} — ${x.reason}`).join('; ')}`;
}
```

- [ ] **Step 4: Run it to verify it passes.**

Run: `( cd pwa && ./node_modules/.bin/vitest run test/archiveReleased.test.ts )` → `7 passed (7)`, `Type Errors no errors`.

- [ ] **Step 5: Commit.**

```bash
git add pwa/src/fleet/archiveReleased.ts pwa/test/archiveReleased.test.ts
git commit -m "pwa: Archive all — plain archives, one at a time, each row re-read first (workspace lifecycle W1)"
```

### Task 7: The fold on the card

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Modify: `pwa/src/fleet/ProjectCard.tsx` (imports, three props, three derived values, the fold's markup above `Archived (N)`)
- Modify: `pwa/src/fleet/fleet.css` (the fold's rules, above `.proj-archived-toggle`, which is NOT widened)
- Modify: `pwa/design/audit.mjs` (two `INHERITED_GROUNDS` registrations, above `.mail-chip`'s)
- Modify: `pwa/test/project-card.test.tsx` (a describe block appended)

**Interfaces:**
- Consumes: `releasedByProgramme` (Task 5); `archivableReleased` (Task 6).
- Produces: `ProjectCard` props `releasedOpen?: boolean` (default false), `onArchiveReleased?: (project: string) => void`, `archivingReleased?: boolean` (default false); the toggle fires `onToggle('<project>::released')`; the fold also shows itself while it holds `selectedId`; the button's accessible name is `Archive all N released workspace(s) in <project>` (text `Archive all (N)`), and `Archiving released workspaces in <project>` (text `Archiving…`) while its loop runs; classes `.proj-released`, `.proj-released-toggle`, `.proj-released-body`, `.proj-released-programme`, `.proj-released-heading`, `.proj-released-archive`, `.proj-released-note`.

- [ ] **Step 1: Write the failing test.** At the end of `pwa/test/project-card.test.tsx`:

Find:

```tsx
    expect(screen.getByRole('button', { name: /still-river.*o\/custom-tools/ })).toBeInTheDocument();
  });
});

```

Replace with:

```tsx
    expect(screen.getByRole('button', { name: /still-river.*o\/custom-tools/ })).toBeInTheDocument();
  });
});

describe('the Released (n) fold (workspace lifecycle spec §5.1)', () => {
  const released = (id: string, program: string, closedAt: number, over: Partial<FleetSession> = {}, child = false): FleetSession =>
    sess({
      id, workspace: id.slice(5), bucket: 'done',
      releasedFrom: { runId: closedAt, program, programTitle: program === 'alpha' ? 'Alpha programme' : null, claimedBy: 'coord', closedAt, child },
      ...over,
    });
  const archivedRow = sess({ id: 'demo-old-bay', workspace: 'old-bay', status: 'dead', bucket: 'archived', archivedAt: 1_785_300_000 });

  it('renders nothing when nothing is released', () => {
    render(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}} />);
    expect(document.querySelector('.proj-released')).toBeNull();
  });

  it('is collapsed by default, and sits directly ABOVE the Archived fold', () => {
    const g = grp({ released: [released('demo-amber-delta', 'alpha', 200)], archived: [archivedRow] });
    const { container } = render(<ProjectCard group={g} onOpen={() => {}} onActions={() => {}} />);
    const toggle = screen.getByRole('button', { name: /released \(1\)/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(container.querySelectorAll('.proj-released-body .sess-line')).toHaveLength(0);
    const folds = [...container.querySelectorAll('.proj-released, .proj-archived')].map((e) => e.className);
    expect(folds).toEqual(['proj-released', 'proj-archived']);
  });

  it('hides along with the rest of the card when the card is collapsed', () => {
    render(<ProjectCard collapsed group={grp({ released: [released('demo-amber-delta', 'alpha', 200)] })} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.queryByRole('button', { name: /released/i })).not.toBeInTheDocument();
  });

  it('toggles under its own composite key, and expands to rows grouped by programme that still open', () => {
    const onOpen = vi.fn();
    const onToggle = vi.fn();
    const g = grp({ released: [
      released('demo-amber-delta', 'alpha', 200),
      released('demo-still-cove', 'beta', 300),
      released('demo-quiet-bay', 'alpha', 100),
    ] });
    const { container, rerender } = render(<ProjectCard group={g} onOpen={onOpen} onToggle={onToggle} onActions={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /released \(3\)/i }));
    expect(onToggle).toHaveBeenCalledWith('demo::released');
    rerender(<ProjectCard group={g} onOpen={onOpen} onToggle={onToggle} onActions={() => {}} releasedOpen />);
    const headings = [...container.querySelectorAll('.proj-released-heading')].map((e) => e.textContent);
    expect(headings).toEqual(['beta', 'alpha · Alpha programme']);
    const rows = [...container.querySelectorAll('.proj-released-body .sess-line')].map((e) => e.textContent ?? '');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toContain('amber-delta');
    expect(rows[2]).toContain('quiet-bay');
    fireEvent.click(screen.getByText('amber-delta'));
    expect(onOpen).toHaveBeenCalledWith('demo-amber-delta');
  });

  it('"Archive all" counts only the rows it would send, and names the children it skips', () => {
    const onArchiveReleased = vi.fn();
    const g = grp({ released: [
      released('demo-amber-delta', 'alpha', 200),
      released('demo-kid-one', 'alpha', 150, {}, true),
    ] });
    render(<ProjectCard group={g} onOpen={() => {}} onActions={() => {}} releasedOpen onArchiveReleased={onArchiveReleased} />);
    const button = screen.getByRole('button', { name: 'Archive all 1 released workspace in demo' });
    expect(button).toHaveTextContent('Archive all (1)');
    fireEvent.click(button);
    expect(onArchiveReleased).toHaveBeenCalledWith('demo');
    expect(screen.getByText('Archive all skips 1 child workspace.')).toBeInTheDocument();
  });

  it('no button without a handler, none when every row is a child, and a disabled one while the loop runs', () => {
    const one = grp({ released: [released('demo-amber-delta', 'alpha', 200)] });
    const { rerender } = render(<ProjectCard group={one} onOpen={() => {}} onActions={() => {}} releasedOpen />);
    expect(screen.queryByRole('button', { name: /archive all/i })).not.toBeInTheDocument();
    rerender(<ProjectCard group={grp({ released: [released('demo-kid-one', 'alpha', 150, {}, true)] })}
      onOpen={() => {}} onActions={() => {}} releasedOpen onArchiveReleased={() => {}} />);
    expect(screen.queryByRole('button', { name: /archive all/i })).not.toBeInTheDocument();
    rerender(<ProjectCard group={one} onOpen={() => {}} onActions={() => {}} releasedOpen onArchiveReleased={() => {}} archivingReleased />);
    const running = screen.getByRole('button', { name: 'Archiving released workspaces in demo' });
    expect(running).toBeDisabled();
    expect(running).toHaveTextContent('Archiving…');
  });

  it('shows itself while it holds the selected row — a release is not the operator\u2019s act, so the row being read must not vanish', () => {
    const g = grp({ released: [released('demo-amber-delta', 'alpha', 200)] });
    const { container, rerender } = render(<ProjectCard group={g} onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelectorAll('.proj-released-body .sess-line')).toHaveLength(0);
    rerender(<ProjectCard group={g} onOpen={() => {}} onActions={() => {}} selectedId="demo-amber-delta" />);
    expect(screen.getByRole('button', { name: /released \(1\)/i })).toHaveAttribute('aria-expanded', 'true');
    expect(container.querySelectorAll('.proj-released-body .sess-line')).toHaveLength(1);
  });
});

```

- [ ] **Step 2: Run it to verify it fails.**

Run: `( cd pwa && ./node_modules/.bin/vitest run test/project-card.test.tsx )`
Expected: `5 failed | 100 passed (105)`. The two that pass (`renders nothing when nothing is released`, `hides along with the rest of the card when the card is collapsed`) assert absence, which a card with no fold satisfies; Task 10's row P20 is what makes the second bite.

- [ ] **Step 3: Render the fold.** Five blocks in `pwa/src/fleet/ProjectCard.tsx`:

Find:

```tsx
import { formatElapsed } from './formatReset';
import type { FleetGroup, FleetPin } from './groupFleet';
import { nestFleet, type FleetRow } from './nestFleet';
```

Replace with:

```tsx
import { formatElapsed } from './formatReset';
import { releasedByProgramme, type FleetGroup, type FleetPin } from './groupFleet';
import { archivableReleased } from './archiveReleased';
import { nestFleet, type FleetRow } from './nestFleet';
```

Find:

```tsx
  archivedOpen = false,
  roster = [],
```

Replace with:

```tsx
  archivedOpen = false,
  releasedOpen = false,
  onArchiveReleased,
  archivingReleased = false,
  roster = [],
```

Find:

```tsx
  archivedOpen?: boolean;
  /** The account roster (`stores/fleet.ts`'s `roster`, read by `FleetScreen`
```

Replace with:

```tsx
  archivedOpen?: boolean;
  /** Whether the `Released (n)` sub-fold is expanded — `archivedOpen`'s inversion, under the composite
   *  `<project>::released` key (workspace lifecycle spec §5.1). */
  releasedOpen?: boolean;
  /** "Archive all" in the Released fold. The card only asks: `FleetScreen` confirms, then runs the plain-archive
   *  loop (`archiveReleased.ts`). Without it the fold renders with no button. */
  onArchiveReleased?: (project: string) => void;
  /** That loop is running for this card — the button is disabled rather than queued twice. */
  archivingReleased?: boolean;
  /** The account roster (`stores/fleet.ts`'s `roster`, read by `FleetScreen`
```

Find:

```tsx
  const cardRepo = repoLabel(repoFor(group.project));
  const repoOf = (s: FleetSession): string | null => {
```

Replace with:

```tsx
  const cardRepo = repoLabel(repoFor(group.project));
  // "Archive all" sends only folded rows that are not children (`archiveReleased.ts`); the rest are named.
  const releasedArchivable = group.released.filter(archivableReleased).length;
  const releasedChildren = group.released.length - releasedArchivable;
  // A release is not the operator's own act (an archive is), so the row being READ must not vanish into a closed
  // fold when its run closes: the fold shows itself while it holds the selection.
  const releasedShown = releasedOpen || (selectedId !== null && group.released.some((s) => s.id === selectedId));
  const repoOf = (s: FleetSession): string | null => {
```

Find:

```tsx

      {!collapsed && group.archived.length > 0 && (
```

Replace with:

```tsx

      {!collapsed && group.released.length > 0 && (
        /* Workspace lifecycle spec §5.1: the transition zone. A programme is done with these rows; they wait
           here to be archived. Folded, never hidden, and above `Archived (N)`, which is where they go next. */
        <div className="proj-released">
          <button
            type="button"
            className="proj-released-toggle"
            aria-expanded={releasedShown}
            onClick={() => onToggle?.(`${group.project}::released`)}
          >
            <span className="proj-card-chevron" aria-hidden="true">{releasedShown ? '▾' : '▸'}</span>
            Released ({group.released.length})
          </button>
          {releasedShown && (
            <div className="proj-released-body">
              {releasedByProgramme(group.released).map((p) => (
                <div key={p.program} className="proj-released-programme">
                  <div className="proj-released-heading">
                    {p.title !== null && p.title !== p.program ? `${p.program} · ${p.title}` : p.program}
                  </div>
                  {p.sessions.map((s) => (
                    <SessionLine key={s.id} session={s} onOpen={onOpen} selected={s.id === selectedId} onActions={onActions} roster={roster} projectPool={poolOf(s)} onOpenRun={openRunFor(s)} repo={repoOf(s)} />
                  ))}
                </div>
              ))}
              {onArchiveReleased !== undefined && releasedArchivable > 0 && (
                <button
                  type="button"
                  className="btn-ghost proj-released-archive"
                  disabled={archivingReleased}
                  // Every card carries this button, so its accessible name says WHICH card's rows it archives.
                  aria-label={archivingReleased
                    ? `Archiving released workspaces in ${group.project}`
                    : `Archive all ${releasedArchivable} released ${releasedArchivable === 1 ? 'workspace' : 'workspaces'} in ${group.project}`}
                  onClick={() => onArchiveReleased(group.project)}
                >
                  {archivingReleased ? 'Archiving…' : `Archive all (${releasedArchivable})`}
                </button>
              )}
              {releasedChildren > 0 && (
                <span className="proj-released-note">
                  {`Archive all skips ${releasedChildren} child ${releasedChildren === 1 ? 'workspace' : 'workspaces'}.`}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {!collapsed && group.archived.length > 0 && (
```

The rules, in `pwa/src/fleet/fleet.css` — the toggle is its OWN rule with the Archived toggle's declarations, never a selector added to `.proj-archived-toggle` (Pre-flight finding 8):

Find:

```css
.proj-archived { border-top: 1px solid var(--edge-subtle); margin-top: var(--sp-1); }
.proj-archived-toggle {
```

Replace with:

```css
.proj-archived { border-top: 1px solid var(--edge-subtle); margin-top: var(--sp-1); }
/* Workspace lifecycle §5.1: the Released fold wears the Archived fold's rule and toggle — the same ink on the
   same ground, registered in design/audit.mjs's INHERITED_GROUNDS — but NOT the past-tense ink step below: a
   released row is live. */
.proj-released { border-top: 1px solid var(--edge-subtle); margin-top: var(--sp-1); }
.proj-released-toggle {
  display: flex; align-items: center; gap: var(--sp-1);
  min-height: var(--tap-min); width: 100%; padding: 0;
  background: none; border: 0; cursor: pointer; text-align: left;
  font-family: var(--font-mono); font-size: var(--text-2xs); color: var(--ink-tertiary);
}
.proj-released-heading, .proj-released-note {
  display: block; padding: var(--sp-1) 0 0;
  font-family: var(--font-mono); font-size: var(--text-2xs); color: var(--ink-tertiary);
}
.proj-released-archive { margin-top: var(--sp-1); min-height: var(--tap-min); }
.proj-archived-toggle {
```

And their grounds, in `pwa/design/audit.mjs`:

Find:

```js
  },
  'fleet.css .mail-chip': {
```

Replace with:

```js
  },
  'fleet.css .proj-released-toggle': {
    under: ['var(--bg-surface)'],
    why: "the Released (N) fold's toggle (workspace lifecycle spec §5.1), a sibling of .proj-card-body inside the card, on the card's own ground, with the Archived fold toggle's ink. It sets no background of its own and its selector names no ancestor, so no route could ground it",
  },
  'fleet.css .proj-released-heading, .proj-released-note': {
    under: ['var(--bg-surface)'],
    why: "the Released fold's programme headings and its children note, inside .proj-released-body on the same card ground as the toggle above, same register. A grouped selector names no painted ancestor, so it needs its own registration",
  },
  'fleet.css .mail-chip': {
```

- [ ] **Step 4: Run the card, the contrast gate and the CSS scrapes.**

Run: `( cd pwa && ./node_modules/.bin/vitest run test/project-card.test.tsx test/contrast.test.ts test/fleet-css.test.ts )` → `438 passed (438)`, `Type Errors no errors`.

- [ ] **Step 5: Commit.**

```bash
git add pwa/src/fleet/ProjectCard.tsx pwa/src/fleet/fleet.css pwa/design/audit.mjs pwa/test/project-card.test.tsx
git commit -m "pwa: the Released (N) fold on the project card, grouped by programme (workspace lifecycle W1)"
```

### Task 8: The screen — the fold key, the confirm, the loop; README

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Modify: `pwa/src/screens/FleetScreen.tsx` (three imports, the state, ref and `runArchiveAll` below `reapId`, the bucket-chip comment, three card props, the `QuickConfirm` above `ReapSheet`)
- Modify: `pwa/test/fleet-screen.test.tsx` (a describe block appended)
- Modify: `pwa/test/tap-targets.test.tsx` (a render case; two rules joining the floored-rule loop)
- Modify: `README.md` (the operator paragraph, after the board-placement paragraph that ends "…already renders on that card.")

**Interfaces:**
- Consumes: `archivableReleased`, `archiveReleased`, `archiveReleasedSummary` (Task 6); `inReleasedFold` (Task 5); the card props (Task 7); `QuickConfirm`, `api.archive`, `apiErrorText`, `toast` (existing; an action on a toast keeps it on screen).
- Produces: the fold's state lives under `<project>::released` in `foldState` (presence = expanded, `::archived`'s inversion). Rows are chosen by `boardHome(s)` — the card a row renders on — never `s.project`.

- [ ] **Step 1: Write the failing tests.** At the end of `pwa/test/fleet-screen.test.tsx`:

Find:

```tsx
    warn.mockRestore();
  });
});

```

Replace with:

```tsx
    warn.mockRestore();
  });
});

describe('Archive all in the Released fold (workspace lifecycle spec §5.1)', () => {
  const rel = (closedAt: number, child = false) =>
    ({ runId: closedAt, program: 'lifecycle', programTitle: null, claimedBy: 'coord', closedAt, child });

  it('opens on its own key, confirms once, archives each non-child row with its id alone, and reports in one toast', async () => {
    vi.spyOn(api, 'projects').mockResolvedValue({ roots: [], projects: [] });
    const archive = vi.spyOn(api, 'archive')
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('busy: a turn is in progress'));
    const store = makeStore();
    render(<><FleetScreen store={store} /><ToastHost /></>);
    seed(store, {
      conn: 'open',
      sessions: [
        session({ id: 'a-one', project: 'alpha', workspace: 'one', bucket: 'idle', releasedFrom: rel(300) }),
        session({ id: 'a-two', project: 'alpha', workspace: 'two', bucket: 'idle', releasedFrom: rel(200) }),
        session({ id: 'a-kid', project: 'alpha', workspace: 'kid', bucket: 'idle', releasedFrom: rel(100, true) }),
      ],
    });
    fireEvent.click(await screen.findByRole('button', { name: /released \(3\)/i }));
    expect(window.localStorage.getItem('ccrc.fleet-folded.v1')).toContain('alpha::released');
    fireEvent.click(screen.getByRole('button', { name: 'Archive all 2 released workspaces in alpha' }));
    expect(archive).not.toHaveBeenCalled();                       // the confirm comes first
    expect(await screen.findByText(/2 of them still have a live pane, which is stopped/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Archive 2' }));
    await waitFor(() => expect(archive).toHaveBeenCalledTimes(2));
    expect(archive.mock.calls).toEqual([['a-one'], ['a-two']]);
    // The child was handed to the loop and skipped by it, so "skipped" agrees with the card's own note.
    expect(await screen.findByText('Archived 1, skipped 1, refused 1: a-two — busy: a turn is in progress')).toBeInTheDocument();
    // A refusal's toast carries an action, which keeps it up until it is read.
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
    // And the button comes back: the in-flight mark is cleared when the loop ends. (No frame arrived, so the store
    // still holds both rows the loop sent.)
    expect(await screen.findByRole('button', { name: 'Archive all 2 released workspaces in alpha' })).toBeEnabled();
  });

  it('archives a PLACED row from the card it renders on, and a double tap on the confirm runs ONE loop', async () => {
    vi.spyOn(api, 'projects').mockResolvedValue({ roots: [], projects: [] });
    const archive = vi.spyOn(api, 'archive').mockResolvedValue(undefined);
    const store = makeStore();
    render(<><FleetScreen store={store} /><ToastHost /></>);
    seed(store, {
      conn: 'open',
      sessions: [
        // Rendered on `alpha`'s card, though its own project is `beta`.
        session({ id: 'b-one', project: 'beta', boardProject: 'alpha', workspace: 'one', bucket: 'idle', releasedFrom: rel(300) }),
      ],
    });
    fireEvent.click(await screen.findByRole('button', { name: /released \(1\)/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Archive all 1 released workspace in alpha' }));
    const go = await screen.findByRole('button', { name: 'Archive 1' });
    fireEvent.click(go);
    fireEvent.click(go);
    expect(await screen.findByText('Archived 1, skipped 0, refused 0.')).toBeInTheDocument();
    expect(archive.mock.calls).toEqual([['b-one']]);
    // A SECOND loop on the same card runs: the in-flight guard is released when the first one ends.
    fireEvent.click(await screen.findByRole('button', { name: 'Archive all 1 released workspace in alpha' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Archive 1' }));
    await waitFor(() => expect(archive.mock.calls).toEqual([['b-one'], ['b-one']]));
  });

  it('re-reads each row from the NEWEST frame: a row that starts a turn mid-loop is skipped, not archived', async () => {
    vi.spyOn(api, 'projects').mockResolvedValue({ roots: [], projects: [] });
    const store = makeStore();
    const archive = vi.spyOn(api, 'archive').mockImplementation(async (id: string) => {
      // The first archive lands while `a-two` starts working: the next read must see the new frame.
      if (id === 'a-one') {
        seed(store, { sessions: [
          session({ id: 'a-two', project: 'alpha', workspace: 'two', bucket: 'working', releasedFrom: rel(200) }),
        ] });
      }
    });
    render(<><FleetScreen store={store} /><ToastHost /></>);
    seed(store, {
      conn: 'open',
      sessions: [
        session({ id: 'a-one', project: 'alpha', workspace: 'one', bucket: 'idle', releasedFrom: rel(300) }),
        session({ id: 'a-two', project: 'alpha', workspace: 'two', bucket: 'idle', releasedFrom: rel(200) }),
      ],
    });
    fireEvent.click(await screen.findByRole('button', { name: /released \(2\)/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Archive all 2 released workspaces in alpha' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Archive 2' }));
    expect(await screen.findByText('Archived 1, skipped 1, refused 0.')).toBeInTheDocument();
    expect(archive.mock.calls).toEqual([['a-one']]);
  });
});

```

And in `pwa/test/tap-targets.test.tsx`:

Find:

```tsx

  it('keeps every floored rule on the token, never a bare 44px literal', () => {
```

Replace with:

```tsx

  it('.proj-released-toggle and .proj-released-archive are on the rendered Released (n) sub-fold', () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    const releasedFrom = { runId: 1, program: 'lifecycle', programTitle: null, claimedBy: 'coord', closedAt: 1, child: false };
    act(() => {
      store.setState({ conn: 'open', sessions: [sess({ id: 'r', project: 'alpha', workspace: 'done-one', releasedFrom })] });
    });
    const toggle = screen.getByRole('button', { name: /released \(1\)/i });
    expect(toggle).toHaveClass('proj-released-toggle');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Archive all 1 released workspace in alpha' })).toHaveClass('proj-released-archive');
  });

  it('keeps every floored rule on the token, never a bare 44px literal', () => {
```

Find:

```tsx
      ruleIn(fleetCss, '.caps-input'), ruleIn(fleetCss, '.mail-chip'),
    ]) {
```

Replace with:

```tsx
      ruleIn(fleetCss, '.caps-input'), ruleIn(fleetCss, '.mail-chip'),
      ruleIn(fleetCss, '.proj-released-toggle'), ruleIn(fleetCss, '.proj-released-archive'),
    ]) {
```

- [ ] **Step 2: Run them to verify they fail.**

Run: `( cd pwa && ./node_modules/.bin/vitest run test/fleet-screen.test.tsx test/tap-targets.test.tsx )`
Expected: `4 failed | 132 passed (136)` — the four new rendered cases: the screen does not yet pass `releasedOpen` or `onArchiveReleased`, so the fold never opens and no `Archive all` renders. The floored-rule loop is green already: Task 7 put both rules on the token.

- [ ] **Step 3: Wire the screen.** Six blocks in `pwa/src/screens/FleetScreen.tsx`:

Find:

```tsx
import { Skeleton } from '../components/Skeleton';
import { toast } from '../components/Toast';
```

Replace with:

```tsx
import { Skeleton } from '../components/Skeleton';
import { QuickConfirm } from '../components/QuickConfirm';
import { toast } from '../components/Toast';
```

Find:

```tsx
import { groupFleet } from '../fleet/groupFleet';
import { ProjectCard, poolOfPlacement, type ProjectPlacementRead } from '../fleet/ProjectCard';
```

Replace with:

```tsx
import { groupFleet } from '../fleet/groupFleet';
import { archivableReleased, archiveReleased, archiveReleasedSummary } from '../fleet/archiveReleased';
import { inReleasedFold } from '../fleet/groupFleet';
import { ProjectCard, poolOfPlacement, type ProjectPlacementRead } from '../fleet/ProjectCard';
```

Find:

```tsx
  const [reapId, setReapId] = useState<string | null>(null);

```

Replace with:

```tsx
  const [reapId, setReapId] = useState<string | null>(null);
  // "Archive all" in a card's Released fold (workspace lifecycle spec §5.1): the project whose confirm is open,
  // and the projects whose loop is running — a second call while one runs is refused, not queued. The guard is a
  // REF, not the state beside it: a second call from the same render would read the stale state (the state only
  // drives the button's disabled look). The window it covers is a phone's: the confirm sheet stays tappable while
  // it animates closed. No test reaches it — under jsdom the sheet unmounts before a second click lands.
  const [archiveAllFor, setArchiveAllFor] = useState<string | null>(null);
  const [archivingAll, setArchivingAll] = useState<ReadonlySet<string>>(new Set());
  const archivingAllRef = useRef<Set<string>>(new Set());
  // `boardHome`, the card the row RENDERS on — never `s.project`, which a placed row does not share with its card.
  const archiveAllRows = archiveAllFor === null ? []
    : sessions.filter((s) => boardHome(s) === archiveAllFor && archivableReleased(s));
  const archiveAllCount = archiveAllRows.length;
  const archiveAllLive = archiveAllRows.filter((s) => s.status !== 'dead').length;
  const runArchiveAll = async (project: string): Promise<void> => {
    if (archivingAllRef.current.has(project)) return;
    archivingAllRef.current.add(project);
    // EVERY folded row of this card, children included: the loop skips a child itself, so its summary counts the
    // whole fold — "skipped" then agrees with the card's own "skips N child workspaces".
    const ids = sessions.filter((s) => boardHome(s) === project && inReleasedFold(s)).map((s) => s.id);
    setArchivingAll((prev) => new Set(prev).add(project));
    try {
      const result = await archiveReleased(ids, {
        // The NEWEST frame, never the render-scoped `sessions`: a row can leave the fold mid-loop.
        current: (id) => store.getState().sessions.find((s) => s.id === id),
        archive: (id) => api.archive(id),
        errorText: apiErrorText,
      });
      // A refusal's reason is the only record of it — the refused row stays in the fold with no reason on it — so
      // that toast carries an action, which keeps it on screen until it is read (Toast.tsx).
      if (result.refused.length > 0) {
        toast(archiveReleasedSummary(result), 'error', { label: 'Dismiss', onClick: () => {} });
      } else {
        toast(archiveReleasedSummary(result), 'info');
      }
    } finally {
      archivingAllRef.current.delete(project);
      setArchivingAll((prev) => {
        const next = new Set(prev);
        next.delete(project);
        return next;
      });
    }
  };

```

Find:

```tsx

              Only the `Archived` chip's rows sit behind a fold, and that fold
              states the identical count. The footer below is the wider DISK
              set (everything with an `archivedAt`, merged ones included) and
```

Replace with:

```tsx

              Two folds hold rows a chip counts. `Archived (n)` states its
              chip's identical count. `Released (n)` (workspace lifecycle
              §5.1) holds rows that are still `idle`, `done` or `dead` and
              still counted under those chips: folded, never removed, so a
              chip may count rows that sit inside a card's Released fold. The footer below is the wider DISK
              set (everything with an `archivedAt`, merged ones included) and
```

Find:

```tsx
                archivedOpen={folded.has(`${g.project}::archived`)}
              />
```

Replace with:

```tsx
                archivedOpen={folded.has(`${g.project}::archived`)}
                /* The same inversion, for the Released fold (workspace lifecycle spec §5.1). */
                releasedOpen={folded.has(`${g.project}::released`)}
                onArchiveReleased={setArchiveAllFor}
                archivingReleased={archivingAll.has(g.project)}
              />
```

Find:

```tsx

      <ReapSheet
```

Replace with:

```tsx

      <QuickConfirm
        open={archiveAllFor !== null}
        onClose={() => setArchiveAllFor(null)}
        title="Archive released workspaces?"
        consequence={`Archives ${archiveAllCount} released ${archiveAllCount === 1 ? 'workspace' : 'workspaces'} in ${archiveAllFor ?? ''}, one at a time. ${archiveAllLive} of them ${archiveAllLive === 1 ? 'still has a live pane' : 'still have a live pane'}, which is stopped. Restore brings any of them back. Child workspaces are skipped, and so is any row that stops being released before its turn.`}
        confirmLabel={`Archive ${archiveAllCount}`}
        onConfirm={() => {
          if (archiveAllFor !== null) void runArchiveAll(archiveAllFor);
        }}
      />

      <ReapSheet
```

- [ ] **Step 4: Run them to verify they pass.**

Run: `( cd pwa && ./node_modules/.bin/vitest run test/fleet-screen.test.tsx test/tap-targets.test.tsx )` → `136 passed (136)`, `Type Errors no errors`.

- [ ] **Step 5: README, and the citation check.** The operator paragraph:

Find:

````md

**What a crossing costs.** Caps stay global: one row, whole box, no per-project
````

Replace with:

````md

**Released workspaces** (workspace lifecycle spec §5.1). When a programme is done with a workspace — its newest
run closed, no open run naming it as worker or as coordinator, no hold, not archived — the server says so on the
row (`FleetSession.releasedFrom`: the run, the programme and its title, the coordinator, the close time, and
whether it is a child), and its card folds it into `Released (N)`, collapsed, directly above `Archived (N)`.
Inside, rows sit under their programme, newest close first. A released row that needs you — waiting, working or
stranded — stays at the top level until it no longer does. **Archive all (N)** confirms once, then sends a plain
archive (never `force`) for each folded row that is not a child, one at a time, re-reading each row from the
newest frame before its turn, and reports archived, skipped and refused in one toast, each refusal with the
server's reason; a toast that carries a refusal stays up until dismissed. Children are skipped. A `coord.db`
read that fails folds nothing that tick. The bucket chips above the cards still count released rows under
`Idle`, `Done` and `Dead`: folded, not removed. Placement is unchanged: a released row renders on its own
project's card, since board placement lasts while the workspace is held.

**What a crossing costs.** Caps stay global: one row, whole box, no per-project
````

Then, from the worktree root (`readme-reanchor.py` is the tool Task 1 Step 6 wrote into your scratchpad; if it is not there, write it from that step first):

```bash
python3 <SCRATCH>/readme-reanchor.py
( cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus' )
```

Expected: `unchanged` (the paragraph moves README's own lines, not the `shared/api.ts` lines its anchors name); `7 passed | 326 skipped (333)`.

- [ ] **Step 6: Commit.**

```bash
git add pwa/src/screens/FleetScreen.tsx pwa/test/fleet-screen.test.tsx pwa/test/tap-targets.test.tsx README.md
git commit -m "pwa: Archive all behind one confirm; the fold remembers its own key; README (workspace lifecycle W1)"
```

### Task 9: The instrument — `deploy/measure-workspace-lifecycle.py`

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Create: `deploy/measure-workspace-lifecycle.py` (mode 0755, like the other directly-run scripts in `deploy/`)
- Create: `server/test/measure-workspace-lifecycle.test.ts`

**Interfaces:**
- Consumes: nothing at runtime but `~/.ccrc/coord.db` (read-only) and `~/.ccrc/state-cache.json`; its test builds a real `coord.db` through `openCoordDb` and `CoordStore`, so a schema change it has not followed reds here, and passes `--db`/`--cache` explicitly in every run.
- Produces: the rows of spec §9 this wave can measure (the docstring lists them). Its `TERMINAL` tuple is a second spelling of `TERMINAL_RUN_STATES`, bound to it by the test. An archive pairs with the next return act on its id; a second archive restarts the clock; a removal or a re-creation of the id ends it.

- [ ] **Step 1: Write the failing test.** Create `server/test/measure-workspace-lifecycle.test.ts`:

```ts
// `deploy/measure-workspace-lifecycle.py` (workspace lifecycle spec §9) against a REAL coord.db — built by this
// build's own migrations, so a schema change the instrument has not followed reds here — and a state-cache
// snapshot in the server's own shape.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { TERMINAL_RUN_STATES } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(ROOT, 'deploy', 'measure-workspace-lifecycle.py');
const NOW_S = 1_790_000_000;
const DAY = 86_400;

const run = (args: string[]) => spawnSync('python3', [SCRIPT, ...args], {
  encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, timeout: 60_000,
});
const rows = (stdout: string): Record<string, string> =>
  Object.fromEntries(stdout.split('\n').filter((l) => /^[a-z_0-9]+: /.test(l)).map((l) => l.split(': ', 2) as [string, string]));

/** A snapshot row carrying only what the instrument reads. */
const row = (id: string, over: Record<string, unknown> = {}) =>
  ({ id, workspace: id, held: null, archivedAt: null, bucket: 'idle', stranded: null, ...over });

function fixture() {
  const home = mkTmp('ccrc-measure-');
  const dbPath = path.join(home, '.ccrc', 'coord.db');
  const db = openCoordDb(dbPath);
  const s = new CoordStore(db);
  const closed = (sessionId: string, claimedBy = 'coord') => {
    const r = s.openRun({ program: 'lifecycle', title: 'L', project: 'demo', wave: 1, waveOf: 1, claimedBy });
    if (!('id' in r)) throw new Error('openRun refused');
    s.bindSession(r.id, sessionId);
    expect(s.advance(r.id, 'failed', 'test-close').ok).toBe(true);
  };
  const act = (sessionId: string, name: string, atS: number) => db.prepare(
    'INSERT INTO lifecycle_events (gen, ingestedAt, act, outcome, sessionId, at, raw) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('1'.repeat(19), 1, name, 'done', sessionId, atS * 1000, `${name} ${sessionId} ${atS}`);
  return { home, dbPath, db, s, closed, act };
}

const writeCache = (home: string, sessions: unknown[]) => {
  const p = path.join(home, '.ccrc', 'state-cache.json');
  writeFileSync(p, JSON.stringify({ sessions, savedAt: (NOW_S - 30) * 1000 }));
  return p;
};

describe('measure-workspace-lifecycle.py', () => {
  it('its terminal set is shared/api.ts’s TERMINAL_RUN_STATES — the second spelling is bound to the first', () => {
    const m = /^TERMINAL = \(([^)]*)\)/m.exec(readFileSync(SCRIPT, 'utf8'));
    expect(m).not.toBeNull();
    expect(m![1]!.split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean)).toEqual([...TERMINAL_RUN_STATES]);
  });

  it('counts released rows by the six conditions, splits needs-a-person, and compares with the wire', () => {
    const f = fixture();
    for (const id of ['loose', 'folded', 'busy', 'strand', 'held', 'arch', 'coordnow', 'wireonly']) f.closed(id);
    f.closed('main');                                                   // a main checkout: workspace null below
    f.s.openRun({ program: 'next', title: 'N', project: 'demo', wave: 1, waveOf: 1, claimedBy: 'coordnow' });
    const rel = { runId: 1, program: 'lifecycle', programTitle: 'L', claimedBy: 'coord', closedAt: 1, child: false };
    const cache = writeCache(f.home, [
      row('loose'),
      row('folded', { releasedFrom: rel }),
      row('busy', { bucket: 'working' }),
      row('strand', { stranded: { at: 1, reason: 'no lane' } }),
      row('held', { held: 'program:x wave:1/1' }),
      row('arch', { archivedAt: NOW_S - DAY, bucket: 'archived' }),
      row('coordnow'),
      row('main', { workspace: null }),
      row('neverrun'),
      row('wireonly-x', { releasedFrom: rel }),
    ]);
    const r = run(['--db', f.dbPath, '--cache', cache, '--now', String(NOW_S)]);
    expect(r.status, r.stderr).toBe(0);
    const o = rows(r.stdout);
    expect(o['rows_total']).toBe('10');
    expect(o['snapshot_age_s']).toBe('30');
    expect(o['released_computed']).toBe('4');                           // loose, folded, busy, strand
    expect(o['released_needs_person']).toBe('2');                       // busy, strand
    expect(o['released_top_level']).toBe('1');                          // loose
    expect(r.stdout).toContain('released_top_level: 1\n  loose\n');
    expect(o['released_wire_only']).toBe('1');                          // wireonly-x: no run, yet marked
  });

  it('archived workspaces older than a week, held and unheld; a main checkout never counts', () => {
    const f = fixture();
    const cache = writeCache(f.home, [
      row('old', { archivedAt: NOW_S - 8 * DAY }),
      row('oldheld', { archivedAt: NOW_S - 8 * DAY, held: 'x' }),
      row('young', { archivedAt: NOW_S - 6 * DAY }),
      row('oldmain', { workspace: null, archivedAt: NOW_S - 30 * DAY }),
    ]);
    const o = rows(run(['--db', f.dbPath, '--cache', cache, '--now', String(NOW_S)]).stdout);
    expect(o['archived_over_7d_unheld']).toBe('1');
    expect(o['archived_over_7d_held']).toBe('1');
  });

  it('archive→return delays from the journal: every return act, the 6- and 7-day bands, the horizon', () => {
    const f = fixture();
    f.act('a', 'archive', NOW_S - 20 * DAY);
    f.act('a', 'restore', NOW_S - 19 * DAY);                            // 1 day
    f.act('b', 'archive', NOW_S - 15 * DAY);
    f.act('b', 'start', NOW_S - 15 * DAY + 6 * DAY + 3600);             // 6 d 1 h
    f.act('c', 'archive', NOW_S - 12 * DAY);
    f.act('c', 'swap', NOW_S - 12 * DAY + 8 * DAY);                     // 8 days
    f.act('d', 'archive', NOW_S - 2 * DAY);                             // never returned
    f.act('e', 'ensure', NOW_S - DAY);                                  // a return with no archive before it
    const cache = writeCache(f.home, []);
    const r = run(['--db', f.dbPath, '--cache', cache, '--now', String(NOW_S), '--days', '14']);
    const o = rows(r.stdout);
    expect(o['archive_returns']).toBe('3');
    expect(o['archive_return_max_s']).toBe(String(8 * DAY));
    expect(o['archive_returns_over_6d']).toBe('2');
    expect(o['archive_returns_over_7d']).toBe('1');
    expect(o['journal_horizon_days']).toBe('20.0');
    expect(o['archive_acts_per_day']).toBe('2 over 14 days');          // c and d are inside 14 days; a and b are not
  });

  it('a removal or a re-creation ends an archive: a reused slug is a new workspace, never a late return', () => {
    const f = fixture();
    f.act('reused', 'archive', NOW_S - 20 * DAY);
    f.act('reused', 'destroy', NOW_S - 19 * DAY);
    f.act('reused', 'spawn', NOW_S - 5 * DAY);                          // a new workspace under the old id
    f.act('recreated', 'archive', NOW_S - 20 * DAY);
    f.act('recreated', 'create', NOW_S - 10 * DAY);
    f.act('recreated', 'start', NOW_S - 10 * DAY + 60);
    const o = rows(run(['--db', f.dbPath, '--cache', writeCache(f.home, []), '--now', String(NOW_S)]).stdout);
    expect(o['archive_returns']).toBe('0');
    expect(o['archive_returns_over_7d']).toBe('0');
  });

  it('a second archive restarts the clock: the return pairs with the NEWEST archive', () => {
    const f = fixture();
    f.act('twice', 'archive', NOW_S - 20 * DAY);
    f.act('twice', 'archive', NOW_S - 3 * DAY);
    f.act('twice', 'restore', NOW_S - 2 * DAY);
    const o = rows(run(['--db', f.dbPath, '--cache', writeCache(f.home, []), '--now', String(NOW_S)]).stdout);
    expect(o['archive_returns']).toBe('1');
    expect(o['archive_return_max_s']).toBe(String(DAY));
  });

  it('a terminal run with no close time is doubt, not a release — the server\u2019s rule', () => {
    const f = fixture();
    f.closed('noclose');
    f.db.prepare('UPDATE runs SET closedAt = NULL WHERE sessionId = ?').run('noclose');
    const o = rows(run(['--db', f.dbPath, '--cache', writeCache(f.home, [row('noclose')]), '--now', String(NOW_S)]).stdout);
    expect(o['released_computed']).toBe('0');
  });

  it('refuses a missing database without creating one, and never writes the one it reads', () => {
    const f = fixture();
    const cache = writeCache(f.home, [row('x')]);
    const missing = path.join(f.home, 'nope', 'coord.db');
    const r = run(['--db', missing, '--cache', cache, '--now', String(NOW_S)]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('no coord.db');
    expect(() => statSync(missing)).toThrow();
    const before = readFileSync(f.dbPath);
    expect(run(['--db', f.dbPath, '--cache', cache, '--now', String(NOW_S)]).status).toBe(0);
    expect(readFileSync(f.dbPath).equals(before)).toBe(true);
  });

  it('refuses a snapshot that is not one', () => {
    const f = fixture();
    const bad = path.join(f.home, 'bad.json');
    writeFileSync(bad, JSON.stringify({ nope: true }));
    const r = run(['--db', f.dbPath, '--cache', bad, '--now', String(NOW_S)]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('not a fleet snapshot');
  });
});
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `( cd server && ./node_modules/.bin/vitest run test/measure-workspace-lifecycle.test.ts )`
Expected: `9 failed (9)` — `ENOENT … deploy/measure-workspace-lifecycle.py` and `python3: can't open file`.

- [ ] **Step 3: Write the instrument.** Create `deploy/measure-workspace-lifecycle.py`, then `chmod 0755 deploy/measure-workspace-lifecycle.py`:

```python
#!/usr/bin/env python3
"""The workspace-lifecycle rows (spec 2026-09-24-workspace-lifecycle-design.md §9), measured READ-ONLY.

Run on the SERVER box, which holds both inputs: `~/.ccrc/coord.db` (the runs, and the lifecycle journal the server
mirrors from ccd's `$REG/.lifecycle/`) and `~/.ccrc/state-cache.json` (the server's last assembled fleet — every
registry fact the rows need, as the board saw it). It writes no row and no file of its own: the database is
opened `mode=ro`, and a missing input is refused rather than created. One side effect is SQLite's, not this
script's: opening a WAL database that no process holds open creates its `-shm` and `-wal` files, owned by whoever
runs this — so run it as the server's own user, never under `sudo`.

    python3 deploy/measure-workspace-lifecycle.py [--db PATH] [--cache PATH] [--now EPOCH_S] [--days N]

Rows (one `name: value` per line; detail lines are indented):
  rows_total                  sessions in the snapshot
  snapshot_age_s              how old the snapshot is — a stale one describes a server that stopped
  released_computed           rows this script finds released, by the six conditions of spec §5.1, computed
                              here from the runs and the snapshot, independently of the server
  released_needs_person       of those, rows that stay at the top level by design (attention, working, stranded)
  released_top_level          of those, the rest that the wire did NOT mark released — the rows still loose on a
                              card. Baseline 2026-09-24: 29 of 56. Target after wave 1: 0.
  released_wire_only          rows the wire marks released that this script does not — the server deciding
                              something the rule does not say. Target: 0.
  archived_over_7d_unheld     archived workspaces archived more than 7 days ago, no hold
  archived_over_7d_held       the same, held (listed: stage 3 routes these to attention)
  archive_returns             returns from archive in the journal: an `archive` done, then the next return act
                              done on the same session (start ensure restore swap spawn unarchive); a second
                              archive restarts the clock; a removal or a re-creation (destroy purge reap forget create)
                              ends it
  archive_return_max_s        the longest of them
  archive_returns_over_6d     those later than 6 days — spec §9's kill-rule band
  archive_returns_over_7d     those later than 7 days — any here holds stage 3 until the operator has seen it
  journal_horizon_days        how far back the journal reaches, so a zero above can be read for what it covers
  archive_acts_per_day        `archive` acts done, per UTC day, over --days (every actor)
Exit 0 measured; 2 an input missing or unreadable.
"""
import argparse, collections, datetime, json, os, sqlite3, sys, time

# `shared/api.ts`'s TERMINAL_RUN_STATES — a second spelling, bound to the first by
# measure-workspace-lifecycle.test.ts, which reds when they differ.
TERMINAL = ('done', 'failed')
# ccd's `_LC_ACTS` members that bring an archived workspace back (spec §3).
RETURN_ACTS = ('start', 'ensure', 'restore', 'swap', 'spawn', 'unarchive')
# ccd's `_LC_ACTS` members that END an archive without returning from it: a removal, or a new workspace created
# under the same id (a reused slug). What follows either is a new workspace's life, never a return.
ENDS_THE_ARCHIVE = ('destroy', 'purge', 'reap', 'forget', 'create')
WEEK_S = 7 * 86400
# Rows that stay at the top level of a card, released or not (spec §5.1).
NEEDS_PERSON = ('attention', 'working')


def fail(msg):
    print(f'measure-workspace-lifecycle: {msg}', file=sys.stderr)
    sys.exit(2)


def load_snapshot(path):
    try:
        with open(path, encoding='utf8') as f:
            snap = json.load(f)
    except (OSError, ValueError) as e:
        fail(f'cannot read the state cache {path}: {e}')
    if not isinstance(snap, dict) or not isinstance(snap.get('sessions'), list):
        fail(f'{path} is not a fleet snapshot (no sessions list)')
    return snap


def open_db(path):
    if not os.path.isfile(path):
        fail(f'no coord.db at {path}')
    try:
        return sqlite3.connect(f'file:{path}?mode=ro', uri=True)
    except sqlite3.Error as e:
        fail(f'cannot open {path} read-only: {e}')


def released_computed(sessions, runs):
    """The six conditions of spec §5.1, from the runs and the snapshot's registry facts."""
    newest, open_workers, open_claimants = {}, set(), set()
    for rid, sid, state, claimed, closed in runs:
        if sid is not None and (sid not in newest or rid > newest[sid][0]):
            newest[sid] = (rid, state, closed)
        if state not in TERMINAL:
            if sid is not None:
                open_workers.add(sid)
            if claimed is not None:
                open_claimants.add(claimed)
    out = set()
    for s in sessions:
        sid = s.get('id')
        if s.get('workspace') is None or s.get('held') is not None or s.get('archivedAt') is not None:
            continue
        last = newest.get(sid)
        if last is None or last[1] not in TERMINAL or last[2] is None:
            continue
        if sid in open_workers or sid in open_claimants:
            continue
        out.add(sid)
    return out


def main():
    home = os.path.expanduser('~')
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', default=os.path.join(home, '.ccrc', 'coord.db'))
    ap.add_argument('--cache', default=os.path.join(home, '.ccrc', 'state-cache.json'))
    ap.add_argument('--now', type=int, default=None)
    ap.add_argument('--days', type=int, default=14)
    a = ap.parse_args()
    now = a.now if a.now is not None else int(time.time())

    snap = load_snapshot(a.cache)
    sessions = [s for s in snap['sessions'] if isinstance(s, dict)]
    db = open_db(a.db)
    try:
        runs = db.execute('SELECT id, sessionId, state, claimedBy, closedAt FROM runs').fetchall()
        journal = db.execute(
            'SELECT sessionId, act, outcome, at FROM lifecycle_events '
            "WHERE outcome = 'done' AND sessionId IS NOT NULL ORDER BY at, id").fetchall()
        untimed = db.execute(
            "SELECT count(*) FROM lifecycle_events WHERE outcome = 'done' AND at IS NULL").fetchone()[0]
    except sqlite3.Error as e:
        fail(f'cannot read {a.db}: {e}')
    finally:
        db.close()

    print(f'rows_total: {len(sessions)}')
    saved = snap.get('savedAt')
    print(f"snapshot_age_s: {now - saved // 1000 if isinstance(saved, int) else 'unknown'}")

    computed = released_computed(sessions, runs)
    by_id = {s.get('id'): s for s in sessions}
    needs = {i for i in computed if by_id[i].get('bucket') in NEEDS_PERSON or by_id[i].get('stranded') is not None}
    wire = {s.get('id') for s in sessions if s.get('releasedFrom') is not None}
    top = sorted(i for i in computed - needs if i not in wire)
    print(f'released_computed: {len(computed)}')
    print(f'released_needs_person: {len(needs)}')
    print(f'released_top_level: {len(top)}')
    for i in top:
        print(f'  {i}')
    wire_only = sorted(wire - computed)
    print(f'released_wire_only: {len(wire_only)}')
    for i in wire_only:
        print(f'  {i}')

    old = [s for s in sessions if s.get('workspace') is not None and isinstance(s.get('archivedAt'), (int, float))
           and now - s['archivedAt'] > WEEK_S]
    unheld = sorted(s['id'] for s in old if s.get('held') is None)
    held = sorted(s['id'] for s in old if s.get('held') is not None)
    print(f'archived_over_7d_unheld: {len(unheld)}')
    for i in unheld:
        print(f'  {i}')
    print(f'archived_over_7d_held: {len(held)}')
    for i in held:
        print(f'  {i}')

    pending, delays = {}, []
    for sid, act, _outcome, at in journal:
        if at is None:
            continue
        if act == 'archive':
            pending[sid] = at                       # a second archive restarts the clock: the NEWEST one pairs
        elif act in ENDS_THE_ARCHIVE:
            pending.pop(sid, None)
        elif act in RETURN_ACTS and sid in pending:
            delays.append((sid, (at - pending.pop(sid)) // 1000))
    over6 = sorted((d, sid) for sid, d in delays if d > 6 * 86400)
    over7 = [(d, sid) for d, sid in over6 if d > WEEK_S]
    print(f'archive_returns: {len(delays)}')
    print(f"archive_return_max_s: {max((d for _s, d in delays), default=0)}")
    print(f'archive_returns_over_6d: {len(over6)}')
    for d, sid in over6:
        print(f'  {sid} {d}')
    print(f'archive_returns_over_7d: {len(over7)}')
    timed = [at for _s, _a, _o, at in journal if at is not None]
    print(f"journal_horizon_days: {round((now * 1000 - min(timed)) / 86400000, 1) if timed else 0}")
    if untimed:
        print(f'  ({untimed} done rows carry no time and are not counted)')

    since = (now - a.days * 86400) * 1000
    per_day = collections.Counter(
        datetime.datetime.fromtimestamp(at / 1000, datetime.timezone.utc).strftime('%Y-%m-%d')
        for _s, act, _o, at in journal if act == 'archive' and at is not None and at >= since)
    print(f'archive_acts_per_day: {sum(per_day.values())} over {a.days} days')
    for day in sorted(per_day):
        print(f'  {day} {per_day[day]}')


if __name__ == '__main__':
    main()
```

- [ ] **Step 4: Run it to verify it passes.**

Run: `( cd server && ./node_modules/.bin/vitest run test/measure-workspace-lifecycle.test.ts )` → `9 passed (9)`.

- [ ] **Step 5: Commit.**

```bash
git add deploy/measure-workspace-lifecycle.py server/test/measure-workspace-lifecycle.test.ts
git commit -m "deploy: measure-workspace-lifecycle.py — the spec §9 rows, read-only (workspace lifecycle W1)"
```

The measurement itself runs after the deploy, on the server box (the ledger's next-wave brief): it is not a worker's step, because the worker's box is the fleet box.

### Task 10: The whole branch — the mutation table, the suites, the census, the PR

**Model routing:** `sonnet`, effort `high`; the PR body is the worker's, the review is the review run's.

- [ ] **Step 1: The mutation table.** Write the runner to `<SCRATCH>/mutate.py` (never committed). It copies the file aside into its own directory (never `git checkout --`, which restores to HEAD and eats uncommitted work), applies one exact replacement, runs the named files, restores and asserts byte-equality:

```python
#!/usr/bin/env python3
"""Mutation runner for workspace-lifecycle wave 1. Run from the worktree root; never committed.

usage: mutate.py <rows.json> [ID ...]
rows.json: [{"id": "S1", "file": "rel/path", "old": "...", "new": "...", "tests": ["test/x.test.ts"], "pkg": "server"}]
Each row: copy the file ASIDE into this script's directory (a copy, never `git checkout --`, which restores to
HEAD and eats uncommitted work), replace exactly one occurrence of `old` with `new` (a row whose `old` is absent
or not unique is SKIPPED and says so), run vitest on the named files from `pkg` (default `server`), print the
totals and the failing titles, restore the copy, and assert byte-equality after the restore.
"""
import json, os, re, shutil, subprocess, sys

ROOT = os.getcwd()
spec = json.load(open(sys.argv[1]))
only = set(sys.argv[2:])
for row in spec:
    if only and row['id'] not in only:
        continue
    path = os.path.join(ROOT, row['file'])
    backup = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mutbak-' + row['id'])
    shutil.copy2(path, backup)
    orig = open(path, 'rb').read()
    try:
        text = orig.decode('utf8')
        n = text.count(row['old'])
        if n != 1:
            print(f"== {row['id']}: SKIPPED — `old` occurs {n} times in {row['file']}")
            continue
        open(path, 'w', encoding='utf8').write(text.replace(row['old'], row['new'], 1))
        r = subprocess.run(['./node_modules/.bin/vitest', 'run', '--maxWorkers=2', *row['tests']],
                           cwd=os.path.join(ROOT, row.get('pkg', 'server')), capture_output=True, text=True, timeout=590)
        out = re.sub(r'\x1b\[[0-9;]*m', '', r.stdout + r.stderr)
        fails = [l.strip() for l in out.splitlines() if l.strip().startswith('FAIL ')]
        tot = [l.strip() for l in out.splitlines() if l.strip().startswith('Tests ')]
        print(f"== {row['id']}: {row['file']}  rc={r.returncode}  {tot[-1] if tot else 'NO TOTALS — read the output'}")
        for f in fails[:6]:
            print('   ', f[:240])
    finally:
        shutil.copy2(backup, path)
        os.remove(backup)
        assert open(path, 'rb').read() == orig, f'{path} was not restored byte-for-byte'
print('all restored')
```

Write the rows below to `<SCRATCH>/rows.json`, then from the worktree root run them in batches that fit one Bash call (about twenty rows each):

```bash
python3 <SCRATCH>/mutate.py <SCRATCH>/rows.json S1 S2 S3 S4 S5 S6 S7 S8 S9 S10 S11 S12 S13 S14 S15 S16 S17 S18 S19 S20
python3 <SCRATCH>/mutate.py <SCRATCH>/rows.json S21 S22 S23 S24 S25 S26 S27 S28 S29 S30 S31 S32 S33 S34 S35 S36 S37 S38
python3 <SCRATCH>/mutate.py <SCRATCH>/rows.json P1 P2 P3 P4 P5 P6 P7 P8 P9 P10 P11 P12 P13 P14 P15 P16 P17
python3 <SCRATCH>/mutate.py <SCRATCH>/rows.json P18 P19 P20 P21 P22 P23 P24 P26 P27 P28 P29 P30 P31 P32 P33 P34 P35 P36 P37 P38
```

Every row must print a non-zero `rc` and a `failed` count; `all restored` must end each batch; `git status --short` must show nothing afterwards. A row that prints `SKIPPED` means its `old` text is not in your tree exactly once: find out why before going on (your transcription differs from the plan's, or `main` moved). A row that stays GREEN is a guard nothing pins: stop and report it with the row id.

Measured on the prototype (`rc=1` on every row; the owning task in brackets; a count is at least what you should see):

| Row | Guard mutated | Measured |
|---|---|---|
| S1–S3 | [2] `workspace === null`, `held`, `archived` each dropped | 2 failed \| 25 passed (27) each |
| S4 | [2] the terminal check dropped | 4 failed \| 16 passed (20) |
| S5 | [2] the close-time doubt dropped | 1 failed \| 19 passed (20) |
| S6, S7 | [2] `openAsWorker`, `openAsClaimant` each dropped | 1 \| 26 (27); 2 \| 25 (27) |
| S8 | [2] newest-by-id → last-wins | 1 failed \| 19 passed (20) |
| S9 | [3] `MAX(id)` → `MIN(id)` | 2 failed \| 5 passed (7) |
| S10 | [3] open workers → terminal workers | 1 failed \| 6 passed (7) |
| S11 | [3] an unreadable close time → `0` | 1 failed \| 6 passed (7) |
| S12 | [3] the claimant set emptied | 3 failed \| 11 passed (14) |
| S13 | [3] an unrepresentable id skipped instead of refusing | 1 failed \| 6 passed (7) |
| S14–S17 | [4] `held`, `archived`, the child reading, `workspace` wired wrong | 1 failed \| 6 passed (7) each |
| S18 | [4] the refusal branch deleted — pins the operator's LOG LINE: the wire answers null either way, by design | 1 failed \| 6 passed (7) |
| S19 | [4] the catch rethrows | 1 failed \| 6 passed (7) |
| S20 | [4] the read asked for no ids | 5 failed \| 2 passed (7) |
| S21 | [1] `?? null` dropped from the accessor | 1 failed \| 13 passed (14) |
| S22 | [1] the reviver not called | 1 failed \| 13 passed (14) |
| S23, S24 | [1] the reviver's `child` and `runId` checks dropped | 1 \| 13 (14); 2 \| 12 (14) |
| S25–S28 | [9] the terminal set, the open-run exclusion, the wire comparison, the return acts | 1 failed \| 8 passed (9) each |
| S29 | [9] the missing-db refusal deleted — pins the MESSAGE: `mode=ro` alone already refuses a missing file and creates nothing | 1 failed \| 8 passed (9) |
| S30 | [9] the held split | 1 failed \| 8 passed (9) |
| S31 | [1] a raw `.releasedFrom` read in the PWA | 1 failed \| 221 passed (222) |
| S32 | [1] the accessor's read respelled (the scan's own control) | 2 failed \| 220 passed (222) |
| S33 | [1] a raw read inside `server.ts`'s `/ws/fleet` handler (where a block-comment blanker went blind) | 1 failed \| 221 passed (222) |
| S34 | [1] the reviver accepts any number as a close time | 1 failed \| 13 passed (14) |
| S35, S36 | [9] a removal no longer ends an archive; a re-creation no longer does | 1 failed \| 8 passed (9) each |
| S37 | [9] a return pairs with the FIRST of two archives | 1 failed \| 8 passed (9) |
| S38 | [9] the instrument's close-time doubt dropped | 1 failed \| 8 passed (9) |
| P1–P5 | [5] `attention`, `working`, the strand, the dead-strand, `archived` exclusions | 1 failed \| 49 passed (50) each (P3: 2 \| 48) |
| P6 | [5] released rows dropped from `unseen` | 1 failed \| 49 passed (50) |
| P7 | [5] released rows left in the live list | 3 failed \| 47 passed (50) |
| P8, P9 | [5] the programme order inverted; the late title dropped | 1 failed \| 49 passed (50) each |
| P10 | [6] children made archivable | 5 failed \| 203 passed (208) |
| P11 | [6] the per-row re-read dropped | 3 failed \| 100 passed (103) |
| P12 | [6] the server's reason replaced | 2 failed \| 101 passed (103) |
| P13 | [8] `force: true` sent | 3 failed \| 93 passed (96) |
| P14 | [8] the render-scoped list instead of the newest frame | 1 failed \| 95 passed (96) |
| P15 | [8] the fold read under `::archived` | 4 failed \| 132 passed (136) |
| P16 | [8] the confirm does nothing | 3 failed \| 93 passed (96) |
| P17 | [7] the toggle writes `::archived` | 4 failed \| 197 passed (201) |
| P18 | [7] the count includes children | 3 failed \| 198 passed (201) |
| P19–P21 | [7] the disabled state, the collapse guard, the title heading | 1 failed \| 104 passed (105) each |
| P22 | [7] the toggle's ground unregistered | 6 failed \| 250 passed (256) |
| P23, P24 | [7] the toggle's tap floor; its class | 1 failed \| 39 passed (40) each |
| P25 | [8] the double-tap ref guard — GREEN under jsdom through the real sheet (Pre-flight finding 12 (d)); pinned since D-3783 by `pwa/test/archive-all-guard.test.tsx`'s double-firing stub | 1 failed (1) |
| P26, P27 | [8] the in-flight ref never released; the in-flight state never released | 1 \| 95 (96); 2 \| 94 (96) |
| P28 | [8] rows chosen by `s.project` instead of the card they render on | 1 failed \| 95 passed (96) |
| P29 | [8] the refusal toast loses its action (and its reasons vanish in 4.2 s) | 1 failed \| 95 passed (96) |
| P30 | [7] the selected row no longer opens the fold | 1 failed \| 106 passed (107) |
| P31 | [5] folded rows order their card again (the whole concatenation replaced by the fleet order) | 2 failed \| 52 passed (54) |
| P32 | [8] the confirm's live-pane count | 1 failed \| 95 passed (96) |
| P33 | [8] the loop handed only archivable ids (so "skipped" never counts children) | 1 failed \| 95 passed (96) |
| P34 | [7] no `Archiving…` while the loop runs | 1 failed \| 104 passed (105) |
| P35 | [7] the toggle's `disabled` follows the fold being shown, not the selection holding it (review 229 A1) | 1 failed \| 106 passed (107) |
| P36 | [5] unfolded dead rows lifted past archived (the three-part concatenation; review 229 A2) | 2 failed \| 52 passed (54) |
| P37 | [5] released rows re-sorted together with archived ones, so a released DEAD row sinks below archived (the escaping form; review 229 A3) | 1 failed \| 53 passed (54) |
| P38 | [5] the panel's remedy: `unfoldedDead` spelt `releasedFromOf(m) === null`, so a STRANDED released dead row (not in the fold) is lifted past archived (review 231 F1) | 1 failed \| 53 passed (54) |

The rows (`<SCRATCH>/rows.json`):

```json
[
 {
  "id": "S1",
  "file": "server/src/coord/released.ts",
  "old": "if (input.workspace === null || input.held || input.archived) return null;",
  "new": "if (input.held || input.archived) return null;",
  "tests": [
   "test/released.test.ts",
   "test/fleet-released.test.ts"
  ]
 },
 {
  "id": "S2",
  "file": "server/src/coord/released.ts",
  "old": "if (input.workspace === null || input.held || input.archived) return null;",
  "new": "if (input.workspace === null || input.archived) return null;",
  "tests": [
   "test/released.test.ts",
   "test/fleet-released.test.ts"
  ]
 },
 {
  "id": "S3",
  "file": "server/src/coord/released.ts",
  "old": "if (input.workspace === null || input.held || input.archived) return null;",
  "new": "if (input.workspace === null || input.held) return null;",
  "tests": [
   "test/released.test.ts",
   "test/fleet-released.test.ts"
  ]
 },
 {
  "id": "S4",
  "file": "server/src/coord/released.ts",
  "old": "if (lastRun === null || !isTerminal(lastRun.state) || lastRun.closedAt === null) return null;",
  "new": "if (lastRun === null || lastRun.closedAt === null) return null;",
  "tests": [
   "test/released.test.ts"
  ]
 },
 {
  "id": "S5",
  "file": "server/src/coord/released.ts",
  "old": "if (lastRun === null || !isTerminal(lastRun.state) || lastRun.closedAt === null) return null;",
  "new": "if (lastRun === null || !isTerminal(lastRun.state)) return null;",
  "tests": [
   "test/released.test.ts"
  ]
 },
 {
  "id": "S6",
  "file": "server/src/coord/released.ts",
  "old": "if (input.openAsWorker || input.openAsClaimant) return null;",
  "new": "if (input.openAsClaimant) return null;",
  "tests": [
   "test/released.test.ts",
   "test/released-store.test.ts"
  ]
 },
 {
  "id": "S7",
  "file": "server/src/coord/released.ts",
  "old": "if (input.openAsWorker || input.openAsClaimant) return null;",
  "new": "if (input.openAsWorker) return null;",
  "tests": [
   "test/released.test.ts",
   "test/fleet-released.test.ts"
  ]
 },
 {
  "id": "S8",
  "file": "server/src/coord/released.ts",
  "old": "if (prev === undefined || r.runId > prev.runId) byId.set(r.sessionId, r);",
  "new": "byId.set(r.sessionId, r);",
  "tests": [
   "test/released.test.ts"
  ]
 },
 {
  "id": "S9",
  "file": "server/src/coord/store.ts",
  "old": "WHERE r.id IN (SELECT MAX(id) FROM runs WHERE sessionId IN (${ph}) GROUP BY sessionId)",
  "new": "WHERE r.id IN (SELECT MIN(id) FROM runs WHERE sessionId IN (${ph}) GROUP BY sessionId)",
  "tests": [
   "test/released-store.test.ts"
  ]
 },
 {
  "id": "S10",
  "file": "server/src/coord/store.ts",
  "old": "`SELECT DISTINCT sessionId FROM runs WHERE sessionId IN (${ph}) AND state NOT IN ${TERMINAL_RUN_STATES_SQL}`,",
  "new": "`SELECT DISTINCT sessionId FROM runs WHERE sessionId IN (${ph}) AND state IN ${TERMINAL_RUN_STATES_SQL}`,",
  "tests": [
   "test/released-store.test.ts"
  ]
 },
 {
  "id": "S11",
  "file": "server/src/coord/store.ts",
  "old": "closedAt: closed !== null && closed.ok ? closed.value : null,",
  "new": "closedAt: closed !== null && closed.ok ? closed.value : 0,",
  "tests": [
   "test/released-store.test.ts"
  ]
 },
 {
  "id": "S12",
  "file": "server/src/coord/store.ts",
  "old": "return { ok: true, last, openWorkers, openClaimants: this.openCoordinatorIds() };",
  "new": "return { ok: true, last, openWorkers, openClaimants: [] };",
  "tests": [
   "test/released-store.test.ts",
   "test/fleet-released.test.ts"
  ]
 },
 {
  "id": "S13",
  "file": "server/src/coord/store.ts",
  "old": "if (!id.ok) return { ok: false, kind: 'run-unreadable', detail: id.detail };\n      const closed",
  "new": "if (!id.ok) continue;\n      const closed",
  "tests": [
   "test/released-store.test.ts"
  ]
 },
 {
  "id": "S14",
  "file": "server/src/fleet.ts",
  "old": "...released.lookup(r.id), workspace: r.workspace, held: r.held !== null,",
  "new": "...released.lookup(r.id), workspace: r.workspace, held: false,",
  "tests": [
   "test/fleet-released.test.ts"
  ]
 },
 {
  "id": "S15",
  "file": "server/src/fleet.ts",
  "old": "archived: r.archivedAt !== null, child: r.child.kind !== 'none',",
  "new": "archived: false, child: r.child.kind !== 'none',",
  "tests": [
   "test/fleet-released.test.ts"
  ]
 },
 {
  "id": "S16",
  "file": "server/src/fleet.ts",
  "old": "archived: r.archivedAt !== null, child: r.child.kind !== 'none',",
  "new": "archived: r.archivedAt !== null, child: r.child.kind === 'child',",
  "tests": [
   "test/fleet-released.test.ts"
  ]
 },
 {
  "id": "S17",
  "file": "server/src/fleet.ts",
  "old": "...released.lookup(r.id), workspace: r.workspace,",
  "new": "...released.lookup(r.id), workspace: 'x',",
  "tests": [
   "test/fleet-released.test.ts"
  ]
 },
 {
  "id": "S18",
  "file": "server/src/fleet.ts",
  "old": "    if (!read.ok) {\n      console.warn(`ccrc-server: lastRunBySession refused while computing released rows — ${read.detail} — releasedFrom reads null this tick`);\n      return { ok: false };\n    }\n",
  "new": "",
  "tests": [
   "test/fleet-released.test.ts"
  ]
 },
 {
  "id": "S19",
  "file": "server/src/fleet.ts",
  "old": "releasedFrom reads null this tick`);\n    return { ok: false };\n  }\n}",
  "new": "releasedFrom reads null this tick`);\n    throw err;\n  }\n}",
  "tests": [
   "test/fleet-released.test.ts"
  ]
 },
 {
  "id": "S20",
  "file": "server/src/fleet.ts",
  "old": "const released = readReleased(coord, recs.map((r) => r.id));",
  "new": "const released = readReleased(coord, []);",
  "tests": [
   "test/fleet-released.test.ts"
  ]
 },
 {
  "id": "S21",
  "file": "shared/api.ts",
  "old": "  return s.releasedFrom ?? null;",
  "new": "  return s.releasedFrom;",
  "tests": [
   "test/released-wire.test.ts"
  ]
 },
 {
  "id": "S22",
  "file": "shared/api.ts",
  "old": "      releasedFrom: reviveReleasedFrom(o, 'releasedFrom'),",
  "new": "      releasedFrom: null,",
  "tests": [
   "test/released-wire.test.ts"
  ]
 },
 {
  "id": "S23",
  "file": "shared/api.ts",
  "old": "  if (!isPositiveDecimalSafeInteger(closedAt) || typeof child !== 'boolean') return null;",
  "new": "  if (!isPositiveDecimalSafeInteger(closedAt)) return null;",
  "tests": [
   "test/released-wire.test.ts"
  ]
 },
 {
  "id": "S24",
  "file": "shared/api.ts",
  "old": "if (!isPositiveDecimalSafeInteger(runId) || typeof program !== 'string') return null;",
  "new": "if (typeof program !== 'string') return null;",
  "tests": [
   "test/released-wire.test.ts"
  ]
 },
 {
  "id": "S25",
  "file": "deploy/measure-workspace-lifecycle.py",
  "old": "TERMINAL = ('done', 'failed')",
  "new": "TERMINAL = ('done', 'failed', 'closed')",
  "tests": [
   "test/measure-workspace-lifecycle.test.ts"
  ]
 },
 {
  "id": "S26",
  "file": "deploy/measure-workspace-lifecycle.py",
  "old": "        if sid in open_workers or sid in open_claimants:\n            continue\n",
  "new": "",
  "tests": [
   "test/measure-workspace-lifecycle.test.ts"
  ]
 },
 {
  "id": "S27",
  "file": "deploy/measure-workspace-lifecycle.py",
  "old": "    top = sorted(i for i in computed - needs if i not in wire)",
  "new": "    top = sorted(i for i in computed - needs)",
  "tests": [
   "test/measure-workspace-lifecycle.test.ts"
  ]
 },
 {
  "id": "S28",
  "file": "deploy/measure-workspace-lifecycle.py",
  "old": "        elif act in RETURN_ACTS and sid in pending:",
  "new": "        elif act == 'restore' and sid in pending:",
  "tests": [
   "test/measure-workspace-lifecycle.test.ts"
  ]
 },
 {
  "id": "S29",
  "file": "deploy/measure-workspace-lifecycle.py",
  "old": "    if not os.path.isfile(path):\n        fail(f'no coord.db at {path}')\n",
  "new": "",
  "tests": [
   "test/measure-workspace-lifecycle.test.ts"
  ]
 },
 {
  "id": "S30",
  "file": "deploy/measure-workspace-lifecycle.py",
  "old": "    unheld = sorted(s['id'] for s in old if s.get('held') is None)",
  "new": "    unheld = sorted(s['id'] for s in old)",
  "tests": [
   "test/measure-workspace-lifecycle.test.ts"
  ]
 },
 {
  "id": "S31",
  "file": "pwa/src/fleet/archiveReleased.ts",
  "old": "  return inReleasedFold(s) && releasedFromOf(s)?.child === false;",
  "new": "  return inReleasedFold(s) && s.releasedFrom?.child === false;",
  "tests": [
   "test/single-definition.test.ts"
  ]
 },
 {
  "id": "S32",
  "file": "shared/api.ts",
  "old": "  return s.releasedFrom ?? null;",
  "new": "  return s['releasedFrom'] ?? null;",
  "tests": [
   "test/single-definition.test.ts"
  ]
 },
 {
  "id": "P1",
  "pkg": "pwa",
  "file": "pwa/src/fleet/groupFleet.ts",
  "old": "  return releasedFromOf(s) !== null && s.bucket !== 'archived' && s.bucket !== 'attention'\n    && s.bucket !== 'working' && (s.stranded ?? null) === null;",
  "new": "  return releasedFromOf(s) !== null && s.bucket !== 'archived'\n    && s.bucket !== 'working' && (s.stranded ?? null) === null;",
  "tests": [
   "test/groupFleet.test.ts"
  ]
 },
 {
  "id": "P2",
  "pkg": "pwa",
  "file": "pwa/src/fleet/groupFleet.ts",
  "old": "    && s.bucket !== 'working' && (s.stranded ?? null) === null;",
  "new": "    && (s.stranded ?? null) === null;",
  "tests": [
   "test/groupFleet.test.ts"
  ]
 },
 {
  "id": "P3",
  "pkg": "pwa",
  "file": "pwa/src/fleet/groupFleet.ts",
  "old": "    && s.bucket !== 'working' && (s.stranded ?? null) === null;",
  "new": "    && s.bucket !== 'working';",
  "tests": [
   "test/groupFleet.test.ts"
  ]
 },
 {
  "id": "P4",
  "pkg": "pwa",
  "file": "pwa/src/fleet/groupFleet.ts",
  "old": "    && s.bucket !== 'working' && (s.stranded ?? null) === null;",
  "new": "    && s.bucket !== 'working' && (s.status === 'dead' || (s.stranded ?? null) === null);",
  "tests": [
   "test/groupFleet.test.ts"
  ]
 },
 {
  "id": "P5",
  "pkg": "pwa",
  "file": "pwa/src/fleet/groupFleet.ts",
  "old": "  return releasedFromOf(s) !== null && s.bucket !== 'archived' && s.bucket !== 'attention'",
  "new": "  return releasedFromOf(s) !== null && s.bucket !== 'attention'",
  "tests": [
   "test/groupFleet.test.ts"
  ]
 },
 {
  "id": "P6",
  "pkg": "pwa",
  "file": "pwa/src/fleet/groupFleet.ts",
  "old": "      unseen: [...live, ...released].filter((m) => isUnseen(m, acks)).length,",
  "new": "      unseen: live.filter((m) => isUnseen(m, acks)).length,",
  "tests": [
   "test/groupFleet.test.ts"
  ]
 },
 {
  "id": "P7",
  "pkg": "pwa",
  "file": "pwa/src/fleet/groupFleet.ts",
  "old": "    const live = members.filter((m) => m.bucket !== 'archived' && !inReleasedFold(m));",
  "new": "    const live = members.filter((m) => m.bucket !== 'archived');",
  "tests": [
   "test/groupFleet.test.ts"
  ]
 },
 {
  "id": "P8",
  "pkg": "pwa",
  "file": "pwa/src/fleet/groupFleet.ts",
  "old": "    closedAtOf(b.sessions[0]!) - closedAtOf(a.sessions[0]!) || a.program.localeCompare(b.program));",
  "new": "    closedAtOf(a.sessions[0]!) - closedAtOf(b.sessions[0]!) || a.program.localeCompare(b.program));",
  "tests": [
   "test/groupFleet.test.ts"
  ]
 },
 {
  "id": "P9",
  "pkg": "pwa",
  "file": "pwa/src/fleet/groupFleet.ts",
  "old": "      if (g.title === null && r.programTitle !== null) g.title = r.programTitle;",
  "new": "",
  "tests": [
   "test/groupFleet.test.ts"
  ]
 },
 {
  "id": "P10",
  "pkg": "pwa",
  "file": "pwa/src/fleet/archiveReleased.ts",
  "old": "  return inReleasedFold(s) && releasedFromOf(s)?.child === false;",
  "new": "  return inReleasedFold(s);",
  "tests": [
   "test/archiveReleased.test.ts",
   "test/project-card.test.tsx",
   "test/fleet-screen.test.tsx"
  ]
 },
 {
  "id": "P11",
  "pkg": "pwa",
  "file": "pwa/src/fleet/archiveReleased.ts",
  "old": "    if (row === undefined || !archivableReleased(row)) {",
  "new": "    if (row === undefined) {",
  "tests": [
   "test/archiveReleased.test.ts",
   "test/fleet-screen.test.tsx"
  ]
 },
 {
  "id": "P12",
  "pkg": "pwa",
  "file": "pwa/src/fleet/archiveReleased.ts",
  "old": "      out.refused.push({ id, reason: deps.errorText(err) });",
  "new": "      out.refused.push({ id, reason: 'refused' });",
  "tests": [
   "test/archiveReleased.test.ts",
   "test/fleet-screen.test.tsx"
  ]
 },
 {
  "id": "P13",
  "pkg": "pwa",
  "file": "pwa/src/screens/FleetScreen.tsx",
  "old": "        archive: (id) => api.archive(id),",
  "new": "        archive: (id) => api.archive(id, { force: true }),",
  "tests": [
   "test/fleet-screen.test.tsx"
  ]
 },
 {
  "id": "P14",
  "pkg": "pwa",
  "file": "pwa/src/screens/FleetScreen.tsx",
  "old": "        current: (id) => store.getState().sessions.find((s) => s.id === id),",
  "new": "        current: (id) => sessions.find((s) => s.id === id),",
  "tests": [
   "test/fleet-screen.test.tsx"
  ]
 },
 {
  "id": "P15",
  "pkg": "pwa",
  "file": "pwa/src/screens/FleetScreen.tsx",
  "old": "                releasedOpen={folded.has(`${g.project}::released`)}",
  "new": "                releasedOpen={folded.has(`${g.project}::archived`)}",
  "tests": [
   "test/fleet-screen.test.tsx",
   "test/tap-targets.test.tsx"
  ]
 },
 {
  "id": "P16",
  "pkg": "pwa",
  "file": "pwa/src/screens/FleetScreen.tsx",
  "old": "          if (archiveAllFor !== null) void runArchiveAll(archiveAllFor);",
  "new": "",
  "tests": [
   "test/fleet-screen.test.tsx"
  ]
 },
 {
  "id": "P17",
  "pkg": "pwa",
  "file": "pwa/src/fleet/ProjectCard.tsx",
  "old": "            onClick={() => onToggle?.(`${group.project}::released`)}",
  "new": "            onClick={() => onToggle?.(`${group.project}::archived`)}",
  "tests": [
   "test/project-card.test.tsx",
   "test/fleet-screen.test.tsx"
  ]
 },
 {
  "id": "P18",
  "pkg": "pwa",
  "file": "pwa/src/fleet/ProjectCard.tsx",
  "old": "  const releasedArchivable = group.released.filter(archivableReleased).length;",
  "new": "  const releasedArchivable = group.released.length;",
  "tests": [
   "test/project-card.test.tsx",
   "test/fleet-screen.test.tsx"
  ]
 },
 {
  "id": "P19",
  "pkg": "pwa",
  "file": "pwa/src/fleet/ProjectCard.tsx",
  "old": "                  disabled={archivingReleased}",
  "new": "",
  "tests": [
   "test/project-card.test.tsx"
  ]
 },
 {
  "id": "P20",
  "pkg": "pwa",
  "file": "pwa/src/fleet/ProjectCard.tsx",
  "old": "      {!collapsed && group.released.length > 0 && (",
  "new": "      {group.released.length > 0 && (",
  "tests": [
   "test/project-card.test.tsx"
  ]
 },
 {
  "id": "P21",
  "pkg": "pwa",
  "file": "pwa/src/fleet/ProjectCard.tsx",
  "old": "                    {p.title !== null && p.title !== p.program ? `${p.program} · ${p.title}` : p.program}",
  "new": "                    {p.program}",
  "tests": [
   "test/project-card.test.tsx"
  ]
 },
 {
  "id": "P22",
  "pkg": "pwa",
  "file": "pwa/design/audit.mjs",
  "old": "  'fleet.css .proj-released-toggle': {\n    under: ['var(--bg-surface)'],",
  "new": "  'fleet.css .proj-released-toggle-gone': {\n    under: ['var(--bg-surface)'],",
  "tests": [
   "test/contrast.test.ts"
  ]
 },
 {
  "id": "P23",
  "pkg": "pwa",
  "file": "pwa/src/fleet/fleet.css",
  "old": ".proj-released-toggle {\n  display: flex; align-items: center; gap: var(--sp-1);\n  min-height: var(--tap-min); width: 100%; padding: 0;",
  "new": ".proj-released-toggle {\n  display: flex; align-items: center; gap: var(--sp-1);\n  width: 100%; padding: 0;",
  "tests": [
   "test/tap-targets.test.tsx"
  ]
 },
 {
  "id": "P24",
  "pkg": "pwa",
  "file": "pwa/src/fleet/ProjectCard.tsx",
  "old": "            className=\"proj-released-toggle\"",
  "new": "            className=\"proj-archived-toggle\"",
  "tests": [
   "test/tap-targets.test.tsx"
  ]
 },
 {
  "id": "S33",
  "file": "server/src/server.ts",
  "old": "    // The dormant protocol handshake (Rider E): sent SYNCHRONOUSLY, before the\n",
  "new": "    const leak = (s: { releasedFrom?: unknown }) => s.releasedFrom; void leak;\n    // The dormant protocol handshake (Rider E): sent SYNCHRONOUSLY, before the\n",
  "tests": [
   "test/single-definition.test.ts"
  ]
 },
 {
  "id": "S34",
  "file": "shared/api.ts",
  "old": "  if (!isPositiveDecimalSafeInteger(closedAt) || typeof child !== 'boolean') return null;",
  "new": "  if (typeof closedAt !== 'number' || typeof child !== 'boolean') return null;",
  "tests": [
   "test/released-wire.test.ts"
  ]
 },
 {
  "id": "S35",
  "file": "deploy/measure-workspace-lifecycle.py",
  "old": "        elif act in ENDS_THE_ARCHIVE:\n            pending.pop(sid, None)\n",
  "new": "",
  "tests": [
   "test/measure-workspace-lifecycle.test.ts"
  ]
 },
 {
  "id": "S36",
  "file": "deploy/measure-workspace-lifecycle.py",
  "old": "ENDS_THE_ARCHIVE = ('destroy', 'purge', 'reap', 'forget', 'create')",
  "new": "ENDS_THE_ARCHIVE = ('destroy', 'purge', 'reap', 'forget')",
  "tests": [
   "test/measure-workspace-lifecycle.test.ts"
  ]
 },
 {
  "id": "S37",
  "file": "deploy/measure-workspace-lifecycle.py",
  "old": "            pending[sid] = at                       # a second archive restarts the clock: the NEWEST one pairs",
  "new": "            pending.setdefault(sid, at)",
  "tests": [
   "test/measure-workspace-lifecycle.test.ts"
  ]
 },
 {
  "id": "S38",
  "file": "deploy/measure-workspace-lifecycle.py",
  "old": "        if last is None or last[1] not in TERMINAL or last[2] is None:",
  "new": "        if last is None or last[1] not in TERMINAL:",
  "tests": [
   "test/measure-workspace-lifecycle.test.ts"
  ]
 },
 {
  "id": "P26",
  "pkg": "pwa",
  "file": "pwa/src/screens/FleetScreen.tsx",
  "old": "      archivingAllRef.current.delete(project);\n",
  "new": "",
  "tests": [
   "test/fleet-screen.test.tsx"
  ]
 },
 {
  "id": "P27",
  "pkg": "pwa",
  "file": "pwa/src/screens/FleetScreen.tsx",
  "old": "      setArchivingAll((prev) => {\n        const next = new Set(prev);\n        next.delete(project);\n",
  "new": "      setArchivingAll((prev) => {\n        const next = new Set(prev);\n",
  "tests": [
   "test/fleet-screen.test.tsx"
  ]
 },
 {
  "id": "P28",
  "pkg": "pwa",
  "file": "pwa/src/screens/FleetScreen.tsx",
  "old": "    const ids = sessions.filter((s) => boardHome(s) === project && inReleasedFold(s)).map((s) => s.id);",
  "new": "    const ids = sessions.filter((s) => s.project === project && inReleasedFold(s)).map((s) => s.id);",
  "tests": [
   "test/fleet-screen.test.tsx"
  ]
 },
 {
  "id": "P29",
  "pkg": "pwa",
  "file": "pwa/src/screens/FleetScreen.tsx",
  "old": "        toast(archiveReleasedSummary(result), 'error', { label: 'Dismiss', onClick: () => {} });",
  "new": "        toast(archiveReleasedSummary(result), 'error');",
  "tests": [
   "test/fleet-screen.test.tsx"
  ]
 },
 {
  "id": "P30",
  "pkg": "pwa",
  "file": "pwa/src/fleet/ProjectCard.tsx",
  "old": "  const releasedShown = releasedOpen || selectionInReleased;",
  "new": "  const releasedShown = releasedOpen;",
  "tests": [
   "test/project-card.test.tsx"
  ]
 },
 {
  "id": "P31",
  "pkg": "pwa",
  "file": "pwa/src/fleet/groupFleet.ts",
  "old": "  for (const s of [\n    ...sorted.filter((m) => !inReleasedFold(m) && !archivedRow(m) && !unfoldedDead(m)),\n    ...sorted.filter(inReleasedFold),\n    ...sorted.filter(archivedRow),\n    ...sorted.filter(unfoldedDead),\n  ]) {",
  "new": "  for (const s of sorted) {",
  "tests": [
   "test/groupFleet.test.ts"
  ]
 },
 {
  "id": "P32",
  "pkg": "pwa",
  "file": "pwa/src/screens/FleetScreen.tsx",
  "old": "  const archiveAllLive = archiveAllRows.filter((s) => s.status !== 'dead').length;",
  "new": "  const archiveAllLive = 0;",
  "tests": [
   "test/fleet-screen.test.tsx"
  ]
 },
 {
  "id": "P33",
  "pkg": "pwa",
  "file": "pwa/src/screens/FleetScreen.tsx",
  "old": "    const ids = sessions.filter((s) => boardHome(s) === project && inReleasedFold(s)).map((s) => s.id);",
  "new": "    const ids = sessions.filter((s) => boardHome(s) === project && archivableReleased(s)).map((s) => s.id);",
  "tests": [
   "test/fleet-screen.test.tsx"
  ]
 },
 {
  "id": "P34",
  "pkg": "pwa",
  "file": "pwa/src/fleet/ProjectCard.tsx",
  "old": "                  {archivingReleased ? 'Archiving…' : `Archive all (${releasedArchivable})`}",
  "new": "                  {`Archive all (${releasedArchivable})`}",
  "tests": [
   "test/project-card.test.tsx"
  ]
 },
 {
  "id": "P35",
  "pkg": "pwa",
  "file": "pwa/src/fleet/ProjectCard.tsx",
  "old": "            disabled={selectionInReleased}",
  "new": "            disabled={releasedShown}",
  "tests": [
   "test/project-card.test.tsx"
  ]
 },
 {
  "id": "P36",
  "pkg": "pwa",
  "file": "pwa/src/fleet/groupFleet.ts",
  "old": "  for (const s of [\n    ...sorted.filter((m) => !inReleasedFold(m) && !archivedRow(m) && !unfoldedDead(m)),\n    ...sorted.filter(inReleasedFold),\n    ...sorted.filter(archivedRow),\n    ...sorted.filter(unfoldedDead),\n  ]) {",
  "new": "  for (const s of [\n    ...sorted.filter((m) => !inReleasedFold(m) && !archivedRow(m)),\n    ...sorted.filter(inReleasedFold),\n    ...sorted.filter(archivedRow),\n  ]) {",
  "tests": [
   "test/groupFleet.test.ts"
  ]
 },
 {
  "id": "P37",
  "pkg": "pwa",
  "file": "pwa/src/fleet/groupFleet.ts",
  "old": "  for (const s of [\n    ...sorted.filter((m) => !inReleasedFold(m) && !archivedRow(m) && !unfoldedDead(m)),\n    ...sorted.filter(inReleasedFold),\n    ...sorted.filter(archivedRow),\n    ...sorted.filter(unfoldedDead),\n  ]) {",
  "new": "  for (const s of [\n    ...sorted.filter((m) => !inReleasedFold(m) && !archivedRow(m) && !unfoldedDead(m)),\n    ...sortFleet(sorted.filter((m) => inReleasedFold(m) || archivedRow(m))),\n    ...sorted.filter(unfoldedDead),\n  ]) {",
  "tests": [
   "test/groupFleet.test.ts"
  ]
 },
 {
  "id": "P38",
  "pkg": "pwa",
  "file": "pwa/src/fleet/groupFleet.ts",
  "old": "  const unfoldedDead = (m: FleetSession): boolean => m.bucket === 'dead' && !inReleasedFold(m);",
  "new": "  const unfoldedDead = (m: FleetSession): boolean => m.bucket === 'dead' && releasedFromOf(m) === null;",
  "tests": [
   "test/groupFleet.test.ts"
  ]
 }
]
```

- [ ] **Step 2: The full suites, in the foreground — one Bash call per line.**

```bash
( cd pwa && ./node_modules/.bin/vitest run )
( cd agent && ./node_modules/.bin/vitest run )
( cd server && ./node_modules/.bin/vitest run --shard=1/6 )
( cd server && ./node_modules/.bin/vitest run --shard=2/6 )
( cd server && ./node_modules/.bin/vitest run --shard=3/6 )
( cd server && ./node_modules/.bin/vitest run --shard=4/6 )
( cd server && ./node_modules/.bin/vitest run --shard=5/6 )
( cd server && ./node_modules/.bin/vitest run --shard=6/6 )
( cd pwa && npm run build )
```

Expected: PWA `3041 passed` in 99 files, no type errors; the agent suite green; every server file green except the two known reds in Global Constraints — re-run either alone and report it by name; the build succeeds.

- [ ] **Step 3: The census and the deviation refs, against `origin/main`.**

```bash
python3 <SCRATCH>/readme-reanchor.py
( cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus' )
git fetch origin main && git -C "$(git rev-parse --show-toplevel)" diff --quiet origin/main -- \
  docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md \
  docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md && echo corpus-frozen
( cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts )
```

Expected: `unchanged`; `7 passed`; `corpus-frozen`; both guards green (this plan defines no number).

- [ ] **Step 4: If `main` moved, merge it — and if CCR-15 wave 3 is on it, the README sentence conflicts.** `git merge origin/main`. On a conflict in README's one anchor sentence (`purge-mechanism-absent` … `each with an operator sentence of its own at`), take EITHER side of that hunk only, then run `readme-reanchor.py`: it derives the right lines for the merged `shared/api.ts` whichever side you took (Pre-flight finding 7). Any other conflict: resolve it as the source it is, then re-run Steps 1–3. Never take a whole file's side.

- [ ] **Step 5: Open the PR** from the workspace branch: title `Workspace lifecycle wave 1: the Released (N) fold`, body naming the spec, this plan, the ledger, the deploy class (server + PWA — a normal `ccrc rollout`; nothing changes on the fleet box, and the instrument ships in `deploy/` and runs nowhere until someone runs it), the counts from Step 2, and that no D-number was minted. A red `test-macos` leg is not yet this branch's: recent PRs (#181, #186, #187) and `main`'s own push runs show the same leg failing or cancelled at its time cap — compare with `main`'s same leg before chasing it.

---

## Deviations found

None at planning. Numbers are minted per wave, at run-open, by the coordinator; a departure found while executing is reported with its evidence and minted then.

- **D-3778** (Task 1 Step 4, run 220) — the fixture sweep's stated `32 files changed, 33 insertions(+), 33 deletions(-)` is one line too many. `server/test/stall-sweep.test.ts` carries two `child: { kind: 'none' }` literals, but only the first (its `FleetSession`) is a full fleet row; the second, `regRow`, is a `SessionRecord`, which has no `releasedFrom` member — the perl sweep added the key there and the tests-inclusive typecheck (`typecheck-tests.test.ts`) refused it as an excess property, the same reason `hold-gate.test.ts` is excluded. That one line was reverted: measured `32 files changed, 32 insertions(+), 32 deletions(-)`. The `stall-sweep` count in Step 4's note ("carries two literals since #224") counted matches, not `FleetSession` literals.
- **D-3779** (Task 1 Step 1, run 220) — the `single-definition.test.ts` Find block (`…toEqual(['shared/api.ts']);\n  });\n});`) still matches once but no longer sits at the file's END: the worker stall watch appended four `describe` blocks after it (#216, #224). The append was placed after the file's last `describe`, as the step's own "At the end of" and the file's APPENDED-never-inserted rule require, not at the Find block. Consequence for Steps 2 and 5's counts: `15 failed | 260 passed (275)` red and `275 passed (275)` green, not `…(236)`; the 15 failures are the plan's. The citation cases stay `7 passed | 328 skipped (335)` after `readme-reanchor.py` (which printed `shared/api.ts:7641-7643, :7683, :7691, :7704`), and the corpus is frozen.
- **D-3780** (Task 3 Step 4, run 220) — the stated `176 passed (176)` for `released-store.test.ts` + `coord-store.test.ts` measures `177 passed (177)`: `coord-store.test.ts` carries 170 cases on `6ca3d163`, one more than when the plan was measured. The seven new cases are the plan's (red: `7 failed (7)`, each `lastRunBySession is not a function`); no code or anchor was adapted — every `store.ts` Find matched once.
- **D-3781** (Task 4 Step 4, run 220) — the stated `94 passed (94)` for `fleet-released.test.ts` + `fleet.test.ts` measures `101 passed (101)`: `fleet.test.ts` carries 94 cases on `6ca3d163` (87 when the plan was measured), and the seven new cases are the plan's (red: `5 failed | 2 passed (7)`, as stated). No code or anchor was adapted.
- **D-3782** (Task 8 Steps 1–4, run 220) — three adaptations, no behaviour changed. (a) Counts: `fleet-screen.test.tsx` + `tap-targets.test.tsx` measure `4 failed | 133 passed (137)` red and `137 passed (137)` green, not `…132 passed (136)` / `136 passed (136)` — one more pre-existing case on `6ca3d163`; the four red cases are the plan's. (b) Step 1 says "At the end of `pwa/test/fleet-screen.test.tsx`", but its Find block (`warn.mockRestore(); }); });`) matches once MID-file, before the "centralised-update programme wave 5" describe that landed after the plan was measured; the Find was followed, so the new describe sits there (older plans cite this file by line, but the audited citation cases stay `7 passed | 328 skipped (335)` after it, so the corpus `session-hook.test.ts` audits did not move). (c) Step 3's import of `inReleasedFold` from `../fleet/groupFleet` was merged into the existing `groupFleet` import line rather than added as a second import from the same module.
- **D-3783** (Task 8, Pre-flight finding 12 (d) and Task 10 row P25, run 220) — the double-tap in-flight ref guard was accepted at planning as unpinned ("no test reaches it — under jsdom the sheet unmounts before a second click lands"); the task review raised it as a guard with no red-on-deletion test, against this repository's mutation-table rule, and the worker ruled to pin it. `pwa/test/archive-all-guard.test.tsx` mocks `QuickConfirm` (file-wide, hence its own file) with a stub whose one handler calls `onConfirm()` twice: with the guard line deleted it reds `1 failed (1)` (two loops, two summary toasts); restored, `138 passed (138)` across it, `fleet-screen` and `tap-targets`. The existing double-tap case is unchanged; `FleetScreen.tsx`'s comment now names the new file. Row P25 is therefore pinned, no longer NOT RUN.
- **D-3784** (final whole-branch review, run 220; ruled in review 225's F1) — no task of this plan touches `ProjectCard`'s `holdsSelection`, but this wave moved a released row out of `group.sessions`, so a COLLAPSED card stopped marking that it holds the selection when the selected row was released — a regression the wave itself introduced. Commit `798120433` widens `holdsSelection` to `group.sessions` and `group.released` (never `group.archived`, whose identical gap predates this wave), pinned by `project-card.test.tsx:1461` at `eb632e605` — `:1478` once D-3785's case was inserted above it — (`a COLLAPSED card still marks the selection when the selected row sits only in Released`): red `1 failed | 105 passed (106)` before the fix, and review 225's mutation H1 (reverted to `group.sessions` only) measured the same `1 failed | 105 passed (106)`. The change stays.
- **D-3785** (review 225's F2) — D-3784's sibling in the same card: while the selected row sits in `group.released`, `ProjectCard` forces the Released fold open (`releasedShown`), yet its toggle still called `onToggle('<project>::released')`, so a tap on an `aria-expanded="true"` toggle did nothing visible and silently inverted the stored key. Ruled: the toggle takes `disabled` while the selection lives in the fold, so a screen reader announces it unavailable and a tap cannot invert the stored key (a sighted operator sees the same toggle, ink and all); otherwise unchanged. The predicate is one named const, `selectionInReleased`, read by both `releasedShown` and the toggle. Review 229 completed it in three ways. The one CSS rule is `.proj-released-toggle:disabled { cursor: default; }`, nothing else, so the pointer no longer offers a tap that does nothing (the contrast, fleet-css and tap-targets suites needed no registration). The comment at `ProjectCard.tsx`'s `holdsSelection` that called it "the only place the card itself reads selectedId" is made true: `selectionInReleased` and `releasedShown` read it too, so it now names the card's own mark as the one read of that kind (comment only). And the control gains a third render, `releasedOpen` true with the selection elsewhere, asserting the toggle is enabled and a click reaches `onToggle` once. Pinned by `project-card.test.tsx` (`the toggle is disabled while the selected row holds the fold open, and live otherwise`, whose control asserts the toggle is enabled and calls `onToggle` with a selection elsewhere, and, in its third render, with the fold operator-opened): red `1 failed | 106 passed (107)` with the `disabled` wiring removed, green `107 passed (107)`; the third render alone reds `1 failed | 106 passed (107)` under `disabled={releasedShown}`, a mutation the first two renders left green, which Task 10 now carries as row P35. Row P30 is re-anchored to `releasedShown = releasedOpen || selectionInReleased`, as `ProjectCard.tsx` now reads.
- **D-3786** (review 225's F3) — D-3783 pinned the double-tap in-flight guard in `archive-all-guard.test.tsx`, but the case in `fleet-screen.test.tsx` that carried the double-tap in its title could not red for it: under jsdom the real sheet unmounts after the first click, so the second click never reaches the guard (`FleetScreen.tsx` says as much). Title and comment only, no assertion dropped: the case is retitled `archives a PLACED row from the card it renders on; a second tap after the sheet closes starts no second loop`, and a one-line comment points at `archive-all-guard.test.tsx` for the in-flight guard (review 225 measured deleting it as `1 failed (1)` there). No red measured, by ruling: nothing but a name changed; `fleet-screen.test.tsx` green at `97 passed (97)`. Review 229 found that retitle half-true: its second clause named something the case cannot red for. Once the real sheet has unmounted, the second `fireEvent.click(go)` lands on a detached node (jsdom's detachment, not ccrc code), so deleting the in-flight guard leaves the case green (`1 passed` under `-t`), and review 229 recorded the measurement, with `-t` on that case: the in-flight guard deleted alone (`FleetScreen.tsx:486`) leaves the case green, `1 passed`; the sheet's `onClose` made a no-op alone (the sheet stays open) reds it, at the re-open of the sheet (`Unable to find role="button" … Archive all 1 …`); the two together red it at the summary toast (`Found multiple elements with the text: Archived 1, skipped 0, refused 0.`). Ruled: the second `fireEvent.click(go)` is dropped and the title is `archives a PLACED row from the card it renders on`, and the comment still points at `archive-all-guard.test.tsx` for the in-flight guard. Review 231 (F2) corrected what the case then claims: it pins TWO things, not one. First, the placed row is archived exactly once (the `archive.mock.calls` assertion at `fleet-screen.test.tsx:2847`). Second, a second loop on the same card runs once the first ends: the last assertion (`:2851`, `[['b-one'], ['b-one']]`) is the in-flight ref's release, and row P26 (the in-flight ref never released) reds exactly there. The assertions that remain are unchanged and the file stays at `97 passed (97)`.
- **D-3787** (review 225's F5) — Task 5's `groupFleet` reorder put folded Released rows after EVERY other row, archived ones included, so a card holding only archived rows now outranked a card holding only released rows — the opposite of the order before the fold, and against the reorder's own stated reason. Ruled: the concatenation is three parts, live rows (neither in the released fold nor `bucket === 'archived'`), then `inReleasedFold` rows, then archived rows, each stable in the fleet order, and the comment now says that a folded row must not lift its card above a visible one while released rows still rank above archived ones. Pinned by `groupFleet.test.ts` (`a released-only card still ranks above an archived-only card`); the existing `a folded row never lifts its card` case stays green: red `1 failed | 50 passed (51)` with the two-part concatenation restored, green `51 passed (51)`. Review 229 completed it in four ways. (A2) That three-part form also lifted UNRELEASED `dead` rows past archived ones, because its first part took every row neither folded nor archived, and `sortFleet`'s `RANK` puts archived (5) above dead (6); F5's ruling lifts RELEASED rows only. The concatenation is now four parts, each stable: rows that are neither folded, archived nor unfolded `dead` (dead and not in the Released fold); folded (released); archived; unfolded `dead`. Pinned by `groupFleet.test.ts` (`an UNRELEASED dead row keeps its rank below archived: the lift is for released rows only`: card `dead-card` holding one `bucket: 'dead'` row with no `releasedFrom`, card `arch-card` holding one archived row, ordered `[arch-card, dead-card]`): red `1 failed | 52 passed (53)` under the three-part form (row P36; `2 failed | 52 passed (54)` once review 231's stranded pin joined the file, the new case reds there too), green `53 passed (53)`. Review 231 (F1) found the word "unreleased" wrong for what the code does: the predicate, renamed `unfoldedDead`, is `bucket === 'dead' && !inReleasedFold(m)`, so a RELEASED dead row that carries a strand marker (`inReleasedFold` is false for it, so it is not folded and stays visible in `sessions`) is in part 4 too and keeps `RANK`'s place below archived, which is where it ranked before the fold. Ruled, option (a): the behaviour is kept, because a row that is not folded must not move relative to `RANK`, and the const, the order comment and the `released` docstring now say "unfolded" where they mean it. Option (b), the panel's `releasedFromOf(m) === null`, would lift an unfolded, visible row past archived and is not taken. Pinned by `groupFleet.test.ts` (`a STRANDED released dead row is not in the fold, so its card keeps RANK's place below an archived-only card`: card `A` holding only a `bucket: 'dead'` row with a strand marker and a `releasedFrom`, card `B` holding only an archived row, ordered `[B, A]`): red `1 failed | 53 passed (54)` under the panel's remedy (row P38), green `54 passed (54)`. (A3) The order comment names a released DEAD row, which the first pin (a released `done` row, already above archived in `sortFleet`) did not exercise; `groupFleet.test.ts` gains `a released DEAD-only card ranks above an archived-only card, though sortFleet alone ranks dead below archived` (a `bucket: 'dead'` row with a `releasedFrom` against an archived-only card), red `1 failed | 52 passed (53)` under `[...live, ...sortFleet([...released, ...archived])]` adapted to the code's names (row P37; `1 failed | 53 passed (54)` at the file's 54 cases), a mutation both earlier cases left green. (A6) The `released` field's docstring no longer says released rows take no part in the card's ORDER: they do, after every live row except an unfolded `dead` one, and before those and before archived rows (review 231 F4 made this sentence match the docstring: unfolded `dead` rows are live, `group.sessions`, and part 2 precedes them). Row P31 is re-anchored to the four-part form (its mutation, the plain fleet order, reds `2 failed | 51 passed (53)`, `2 failed | 52 passed (54)` at the file's 54 cases), and rows P36 and P37 carry the two parts that P31's wholesale replacement cannot tell apart; row P38 carries the stranded released dead row (review 231 F1). Rows P31, P36 and P37 are re-anchored to the renamed `unfoldedDead`.

# Board placement — wave 2 (the board) and the door refusal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render what wave 1 measured — a coordinated workspace moves to its coordinator's card and brackets under it whatever repo it works in, with the repo labelled where the card stops implying it — and close the one door that could make the one-level bracket lie: a dispatched worker may no longer open or inherit a programme.

**Architecture:** Two independent slices on one branch. The BOARD slice is a grouping change in the PWA: `groupFleet` inverts to a durable card set filled by one L0 reader (`boardHome`), `FleetScreen` routes each run to the card its worker now renders on and narrows the `abroad` line, `nestFleet` gains one additive ordering key, and the repo label rides `ProjectRow.repo` through one L0 renderer (`repoLabel`). The DOOR slice is server-only: `POST /api/runs` answers `409 claimant-is-a-worker` and `POST /api/runs/:id/reclaim` answers `409 heir-is-a-worker`, both off the store's existing `parentOfSession` read. Nothing under `ccd/ccd` changes; the coordinator skill's reference table gains one row.

**Tech Stack:** TypeScript (ESM, `"type":"module"`), Node `>=22.13.0`, React 18 + `@testing-library/react` under jsdom (pwa), Fastify + `node:sqlite` `DatabaseSync` (server), vitest.

**Spec:** `docs/superpowers/specs/2026-09-16-board-placement-and-repo-label-design.md` — §6–§8 for the board, §12 (addendum 2026-09-18) for the door. Wave 1's plan and ledger: `docs/superpowers/plans/2026-09-16-board-placement-wave1-server-wire.md`.

**Measured against** this worktree at `origin/main` = `7a6220f6`. Every `file:line` below was read there; the spec's own anchors were measured at `98236c81` and have drifted (its `ProjectCard.tsx:496-505` is `:514-521` here). Re-derive, never retype.

## Global Constraints

- **Node floor `>=22.13.0`**, identical across `server/`, `pwa/`, `agent/`. Never lower an engine to make a test green — raise it.
- **Run suites from inside the package, in the FOREGROUND, timeout ≥ 600000 ms:** `cd pwa && ./node_modules/.bin/vitest run test/<file>` / `cd server && ./node_modules/.bin/vitest run test/<file>`. **NEVER bare `npx vitest`.**
- **THE CROSS-PACKAGE TRAP (spec §8), in bold because a worker WILL fall into it:** two SERVER suites reach into `pwa/src` — `server/test/single-definition.test.ts` text-scans `shared/`, `server/src`, `pwa/src`, `agent/src`, and `server/test/resume-reclaim-l0.test.ts` names `pwa/src/fleet/nestFleet.ts` by hand, asserts the literal ``THE EDGE IS `run.claimedBy` -> `run.sessionId`.`` from its header, and reds on three FALSIFIED strings anywhere in the tree. A green `cd pwa && npm run test` proves nothing about either. Every task that touches `pwa/src` or `shared/` ends by running BOTH of those server suites.
- **The full server suite is 320 files and overruns one foreground run.** Run it as shards `1/3, 2/3, 5/6, 6/6` sequentially; their union is the whole list.
- **Additive wire only. Do NOT bump `FLEET_PROTO` (=1).** One reader per field; absence permits. The live `fleet` frame is CAST, not revived (`pwa/src/stores/fleet.ts`'s `asFleetMsg`), so an older server's row has NO KEY at runtime — every reader spells `??`, never `=== null`.
- **No overloaded null at a seam:** two conditions a caller handles differently must not collapse to one value. (This is why `FleetGroup.pin` becomes a three-state union in Task 3.)
- **Rings:** L0 `shared/*.ts` imports NOTHING; L1 policy is pure; L4 delivery (fastify, React) renders and does not decide.
- **Single-source-of-truth:** `boardProject ?? project` is spelled ONCE (`boardHome`, Task 1) and `repo.state === 'named'` ONCE (`repoLabel`, Task 1); Task 1 adds the two scans that red a second copy. `sessionLabel.ts` is a pinned holder (`single-definition.test.ts`, "one sessionLabel") — never widen it.
- **Mutation-table discipline:** every new guard ships WITH a test that goes RED when the guard is deleted or mutated — measured before/after, not asserted by comment. TDD red-first. A green mutation is ambiguous: ship a CONTROL case beside it.
- **`nestFleet`'s five rules do not change; `RowDepth = 0 | 1` is the operator's ruling.** Task 5 adds an ordering KEY inside rule 2 and declares it (D-3008). Do not touch the header comment block (lines 1–35) at all.
- **`coord.db` is synchronous.** Never `await` inside `tx()`; `parentOfSession` is a synchronous read and is used as one.
- **Deviations:** when you depart from this plan, allocate a number with `printf '%s' '{"project":"ccrc-pwa","title":"<one line>","count":<n>}' | ccrc-api ledger allocate --json -` **at that moment** and DEFINE it in `## Deviations found` in the same commit. Never guess a number, never pre-mint a block, never spell a block as a range.
- **Commit on this workspace's own branch (`ws/warm-hollow`).** Never a separate feature branch. Read `git branch --show-current` before the first commit.
- **`ccd/coordinator-skill/` is touched (one table row, one sentence) — that makes this wave AGENT-FIRST on deploy** by `CLAUDE.md`'s rule, prose or not. The deploy is the operator's act and is NOT part of this plan; the gate says what to check.

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `shared/api.ts` | modify | `boardHome`, `repoLabel` (L0 readers); `claimant-is-a-worker` in `RunRefuseCode`; `heir-is-a-worker` in `ReclaimRefuseCode`; the `boardProject` docstring's third producer of null. |
| `server/src/fleet.ts` | modify | D-2875: `readCoordPlacements` says whether it READ; a failed read emits `boardProject: null`. |
| `pwa/src/fleet/groupFleet.ts` | modify | Cards from the project list ∪ placements ∪ own projects, keyed on `boardHome`; `FleetPin` union; `elsewhere` per card. |
| `pwa/src/fleet/runWords.ts` | modify | `runCard(run, cardOf)` — the two-armed run→card predicate. |
| `pwa/src/screens/FleetScreen.tsx` | modify | Threads the project names, `cardOf`, `repoFor`, `coordOf`, `frameSeen` into the cards; writes the project rows into the store. |
| `pwa/src/fleet/ProjectCard.tsx` | modify | Pin chip off the union; `.proj-elsewhere` lines; repo-label DECISION per row; presence-aware orphan marker. |
| `pwa/src/fleet/SessionLine.tsx` | modify | COMPOSES the repo into the row button's accessible name (`.sess-repo`). |
| `pwa/src/fleet/nestFleet.ts` | modify | `attentionFirst` ordering key ahead of `programOrder`, siblings only. |
| `pwa/src/stores/fleet.ts` | modify | `projects: readonly ProjectRow[] \| null` + `setProjects` — NOT persisted. |
| `pwa/src/screens/SessionScreen.tsx`, `pwa/src/session/SessionHeader.tsx` | modify | The unconditional repo label in the session view. |
| `pwa/src/fleet/fleet.css`, `pwa/src/session/chat.css` | modify | `.proj-elsewhere*`, `.sess-repo`, `.chip--repo`. |
| `server/src/coord/routes.ts` | modify | The `claimant-is-a-worker` rung; the reclaim switch's `heir-is-a-worker` arm. |
| `server/src/coord/reclaim.ts` | modify | `ReclaimOutcome` member + the heir rung inside `if (to !== from)`. |
| `ccd/coordinator-skill/references/wave-lifecycle.md`, `ccd/coordinator-skill/SKILL.md` | modify | The new open-refusal row and its mention. |
| `README.md` | modify | "The board says which repo" paragraph; the door. |
| `server/test/single-definition.test.ts` | modify | Two new holders scans (`boardProject ??`, `.state === 'named'`). |
| `server/test/resume-reclaim-l0.test.ts` | modify | The two exact-equality pins on `RECLAIM_REFUSE_CODES` — reds by design. |
| tests | modify/create | `server/test/fleetstate.test.ts`, `server/test/fleet.test.ts`, `server/test/run-routes.test.ts`, `server/test/coord-reclaim.test.ts`, `server/test/reclaim-route.test.ts`, `pwa/test/groupFleet.test.ts` (rewrite, reds by design), `pwa/test/runCard.test.ts` (create), `pwa/test/nestFleet.test.ts`, `pwa/test/project-card.test.tsx`, `pwa/test/session-line.test.tsx`, `pwa/test/fleet-screen.test.tsx`, `pwa/test/header.test.tsx`. |

**Order that matters (the critic's ruling, carried):** Task 1 before everything (both readers). Task 3 (card source) before Task 4, and Task 4's three edits — the `boardHome` key, the run→card routing, the `abroad` subtraction — land in ONE commit, or an intermediate tree is spec §1's "pure regression" (a moved row with no edge, no marker, no `/runs` door). Tasks 5–8 are independent of each other and of 9–10. Tasks 9–10 (the door) are independent of the board entirely.

---

### Task 1: The two L0 readers, and the scans that keep them single

**Files:**
- Modify: `shared/api.ts` (after `reviveFleetSession`'s `boardProject: optStr(o, 'boardProject')` at `:2871`, near the other exported readers such as `sessionAsk` at `:591`)
- Modify: `server/test/single-definition.test.ts` (append two `describe` blocks after `'one sessionLabel'`, `:358-374`)
- Test: `server/test/fleetstate.test.ts` (append after `'reviveFleetSession carries boardProject …'`, `:759`)

**Interfaces:**
- Produces: `boardHome(s: { project: string; boardProject?: string | null }): string` and `repoLabel(repo: ProjectRepoWire | undefined): string | null`, both exported from `shared/api.ts`. Every later task imports these; none re-spells them.

- [ ] **Step 1: Write the failing reader tests**

Append to `server/test/fleetstate.test.ts` (the file already imports from `'../../shared/api.js'`; add `boardHome, repoLabel` to that import):

```ts
describe('boardHome — the ONE reader of FleetSession.boardProject (board-placement wave 2, Task 1)', () => {
  it('reads the placement when the server decided one', () => {
    expect(boardHome({ project: 'custom-tools', boardProject: 'intake-platform' })).toBe('intake-platform');
  });
  it('falls back to the project on null — an older server, an older snapshot, or a failed read (D-2875)', () => {
    expect(boardHome({ project: 'custom-tools', boardProject: null })).toBe('custom-tools');
  });
  it('falls back on an ABSENT key — the live frame is cast, not revived', () => {
    // No `boardProject` key at all, the runtime shape of a row from a server
    // that predates the field. `??` reads it as null; `=== null` would not.
    expect(boardHome({ project: 'custom-tools' })).toBe('custom-tools');
  });
});

describe('repoLabel — the ONE renderer decision for ProjectRepoWire (Task 1)', () => {
  it('is the slug on `named`', () => {
    expect(repoLabel({ state: 'named', slug: 'Synapsium-Labs/ccrc-pwa' })).toBe('Synapsium-Labs/ccrc-pwa');
  });
  it('is null on `absent`, on `unmeasured`, and on an absent key — three conditions, one render, stated', () => {
    expect(repoLabel({ state: 'absent' })).toBeNull();
    expect(repoLabel({ state: 'unmeasured' })).toBeNull();
    expect(repoLabel(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run them, expect failure**

Run: `cd server && ./node_modules/.bin/vitest run test/fleetstate.test.ts`
Expected: FAIL — `boardHome`/`repoLabel` are not exported.

- [ ] **Step 3: Add the readers to `shared/api.ts`**

Directly below `reviveFleetSession`'s closing brace (the function that ends with `route: reviveRoute(o, 'route'), };`), add:

```ts
/**
 * WHICH CARD a session's row renders on — the ONE reader of
 * `FleetSession.boardProject`, and the only place `boardProject ?? project`
 * is spelled (`server/test/single-definition.test.ts` scans for a second).
 *
 * `??`, never `=== null`: the live `fleet` frame is CAST on arrival
 * (`pwa/src/stores/fleet.ts`'s `asFleetMsg`), so a row from a server that
 * predates the field has NO KEY at runtime, and an older snapshot revives it
 * as `null`. Both, and a failed server-side read (D-2875, wave 2), fall back to
 * the session's own project — the identical thing, which is why the field's
 * docstring lets the three collapse. NO reader may branch on
 * `boardProject === null` to tell them apart; that distinction is not on the
 * wire and the fold is deliberate.
 */
export function boardHome(s: { project: string; boardProject?: string | null }): string {
  return s.boardProject ?? s.project;
}

/**
 * The repo label a renderer may show for a `ProjectRow.repo` cell — the ONE
 * place `state === 'named'` is asked of `ProjectRepoWire`, so the card row and
 * the session view cannot drift onto two different readings of the three
 * states. The slug on `named`; `null` for `absent`, `unmeasured` AND an absent
 * key (an older server). Three conditions, one render, and that fold is
 * deliberate: the label is the only affordance behind this field, and none of
 * the three is something the label can say. `absent` still means only "no
 * usable origin AT THE PATH THE SWEEP LOOKED AT" (the type's own leading
 * sentence, D-2923) — this function renders nothing for it and claims nothing.
 */
export function repoLabel(repo: ProjectRepoWire | undefined): string | null {
  return repo !== undefined && repo.state === 'named' ? repo.slug : null;
}
```

- [ ] **Step 4: Run the reader tests, expect pass**

Run: `cd server && ./node_modules/.bin/vitest run test/fleetstate.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the two single-definition scans (red first)**

Append to `server/test/single-definition.test.ts`, after the `'one sessionLabel'` describe (it uses the file's own `ALL` and `rel` helpers, exactly as that block does):

```ts
describe('one boardHome (board-placement wave 2, Task 1)', () => {
  // `boardProject ?? project` is the wire's ONE fallback (`shared/api.ts`,
  // `FleetSession.boardProject`'s docstring). A second spelling in any
  // consumer is the two-readers drift this suite exists to forbid.
  const CHAIN = /boardProject\s*\?\?/;

  it('is spelled in exactly one file, and that file is shared/api.ts', () => {
    const holders = ALL.filter((f) => CHAIN.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['shared/api.ts']);
  });
});

describe('one repoLabel (board-placement wave 2, Task 1)', () => {
  // The three-state `ProjectRepoWire` switch. The card row and the session
  // view both render it; a second `state === 'named'` is a second renderer.
  const SWITCH = /\.state === 'named'/;

  it('is asked in exactly one file, and that file is shared/api.ts', () => {
    const holders = ALL.filter((f) => SWITCH.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['shared/api.ts']);
  });
});
```

Then measure, before touching anything else:

```bash
cd <repo root> && grep -rn "boardProject ??" shared server/src pwa/src agent/src; grep -rn "\.state === 'named'" shared server/src pwa/src agent/src
```

Expected today: the first grep hits `shared/api.ts` twice (the function and the revive-site comment at `:2869` that says "the single reader (`boardProject ?? project`)"), the second hits `shared/api.ts` once. Both holders lists therefore read `['shared/api.ts']` and the scans are green on arrival — that is fine ONLY because each scan is also proven red by Step 6.

- [ ] **Step 6: Prove each scan reds under its mutation, then restore**

Temporarily add `const x = s.boardProject ?? s.project;` to `pwa/src/fleet/groupFleet.ts` and `const y = repo.state === 'named';` to `pwa/src/fleet/ProjectCard.tsx` (any reachable line). Run: `cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts`. Expected: the two new cases FAIL, naming the pwa files. Remove both lines; re-run; expected PASS. Record the red/green in the commit body.

- [ ] **Step 7: Run the cross-package pair and commit**

```bash
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts test/resume-reclaim-l0.test.ts test/fleetstate.test.ts
cd ../pwa && ./node_modules/.bin/vitest run
git add shared/api.ts server/test/fleetstate.test.ts server/test/single-definition.test.ts
git commit -m "feat(api): boardHome and repoLabel — the one reader of each wave-1 wire field, scanned single (board-placement wave 2, Task 1)"
```

---

### Task 2: D-2875 — a failed placement read emits `null`, and the docstring says so

**Files:**
- Modify: `server/src/fleet.ts` (`readCoordPlacements`, `:222-236`; its ONE call site, found by `grep -n "readCoordPlacements(" server/src/fleet.ts`; the row literal's `boardProject:` at `:618-621`)
- Modify: `shared/api.ts` (`FleetSession.boardProject` docstring, `:358-381`)
- Test: `server/test/fleet.test.ts` (append inside `describe('board placement on the wire …')`, `:1118`)

**Interfaces:**
- Consumes: `boardPlacement`, `foldCoordPlacements`, `StampLookup` (`server/src/coord/placement.ts`, wave 1).
- Produces: `boardProject: null` on the wire for EVERY row of an assembly whose `coordPlacementStamps` read refused or threw. Nothing else changes: `coord` absent, or an empty registry, still answers `ownProject` (a real measurement — nothing was stamped).

- [ ] **Step 1: Write the failing wire tests**

Append inside the `'board placement on the wire'` describe in `server/test/fleet.test.ts` (it already has `mkCoord`, `dead`, `NOW_S`, `seedRoster`, `seedSession`, `localIO`, `loadConfig`, `assembleFleet`, and `vi` imported at `:1`):

```ts
  it('a REFUSED placement read emits null on every row — never a non-null that reads as "placed at home" (D-2875)', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'demo-worker5', 'claude', { hold: 'program:agent-evals wave:1/1' });
    const coord = mkCoord();
    vi.spyOn(coord, 'coordPlacementStamps').mockReturnValue({ ok: false, kind: 'run-unreadable', detail: 'closed for the test' });
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), dead, NOW_S,
      undefined, undefined, undefined, undefined, undefined, undefined, coord,
    );
    expect(fleet.find((x) => x.id === 'demo-worker5')!.boardProject).toBeNull();
  });

  it('a THROWING placement read emits null too, and the tick still resolves', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'demo-worker6', 'claude');
    const coord = mkCoord();
    vi.spyOn(coord, 'coordPlacementStamps').mockImplementation(() => { throw new Error('lock race'); });
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), dead, NOW_S,
      undefined, undefined, undefined, undefined, undefined, undefined, coord,
    );
    expect(fleet.find((x) => x.id === 'demo-worker6')!.boardProject).toBeNull();
  });

  it('CONTROL: a readable store with nothing stamped still answers the OWN project, not null', async () => {
    // "Nothing stamped" is a measurement; "could not read" is not. The two
    // must not fold — this is the case the null must NOT reach.
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'demo-worker7', 'claude', { project: 'demo-worker7-project' });
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), dead, NOW_S,
      undefined, undefined, undefined, undefined, undefined, undefined, mkCoord(),
    );
    expect(fleet.find((x) => x.id === 'demo-worker7')!.boardProject).toBe('demo-worker7-project');
  });
```

The refusal literal IS `CoordPlacementStampsResult`'s failure arm (`server/src/coord/store.ts:289-291`: `{ ok: false; kind: 'run-unreadable'; detail: string }`) — measured, not a cast.

- [ ] **Step 2: Run, expect the first two to fail**

Run: `cd server && ./node_modules/.bin/vitest run test/fleet.test.ts -t "placement read"`
Expected: FAIL on both (today they read the session's own project); CONTROL passes.

- [ ] **Step 3: Make the read say whether it read**

In `server/src/fleet.ts`, replace `readCoordPlacements` with:

```ts
/** What `readCoordPlacements` hands back: the port when the store answered
 *  (including "nothing stamped" — an empty port is a measurement), or `ok:
 *  false` when the READ itself failed. The two used to fold to one empty
 *  port, so every row of a broken box read `boardProject === project` as if
 *  measured (D-2875; the field's own docstring carried the gap as prose). */
type CoordPlacementsRead = { ok: true; stampOf: StampLookup } | { ok: false };

function readCoordPlacements(coord: CoordStore | undefined, sessionCount: number): CoordPlacementsRead {
  if (!coord || sessionCount === 0) return { ok: true, stampOf: emptyCoordPlacements() };
  try {
    const read = coord.coordPlacementStamps();
    if (!read.ok) {
      console.warn(`ccrc-server: coordPlacementStamps refused while computing board placement — ${read.detail} — boardProject reads null this tick`);
      return { ok: false };
    }
    return { ok: true, stampOf: foldCoordPlacements(read.stamps) };
  } catch (err) {
    console.warn(`ccrc-server: coordPlacementStamps failed while computing board placement — ${err instanceof Error ? err.message : String(err)} — boardProject reads null this tick`);
    return { ok: false };
  }
}
```

Keep the function's existing docstring above it (it is cited by wave 1's ledger); append one sentence to it: "Since wave 2 (D-2875) a failed read is `ok: false`, and the row literal emits `boardProject: null` for it — the wire's own word for 'this server did not decide'."

At the call site (`const stampOf = readCoordPlacements(coord, …)` — rename to `const placements = …`), and in the row literal:

```ts
      boardProject: placements.ok
        ? boardPlacement({ sessionId: r.id, ownProject: r.project, held: r.held !== null, stampOf: placements.stampOf })
        : null,
```

Keep the Task 3 comment above that field; add: `// D-2875: a failed read is the wire's null, never a non-null that reads as measured.`

- [ ] **Step 4: Re-edit the wire docstring (same commit, or D-2923's argument applies to the new text)**

In `shared/api.ts`, `FleetSession.boardProject`'s docstring: replace the paragraph beginning `A THIRD condition exists and does NOT reach this field as \`null\`` through `…(D-2923).` with:

```
   *  THREE conditions reach `null`, and they collapse deliberately: an older
   *  peer, a snapshot revived from a build predating the field, and — since
   *  wave 2 (D-2875) — a server whose placement read failed this tick
   *  (`coordPlacementStamps` refusing, or `node:sqlite` throwing on a closed
   *  connection or a lock race; `readCoordPlacements`, `server/src/fleet.ts`).
   *  The single reader (`boardHome`, below) does the identical thing with all
   *  three, and no reader may branch on `=== null` to tell them apart — that
   *  distinction is not on the wire. What IS distinct: "nothing stamped" is
   *  NOT a failure and answers the session's own project, a measurement.
```

- [ ] **Step 5: Run, expect pass; run the wave-1 pins too**

Run: `cd server && ./node_modules/.bin/vitest run test/fleet.test.ts test/fleetstate.test.ts test/push-copy.test.ts test/fleetws.test.ts`
Expected: PASS — `push-copy.test.ts`'s "a broken coord.db degrades, never crashes the poll" and `fleetws.test.ts`'s cold-start case still pass (the try/catch is intact).

- [ ] **Step 6: Mutation: restore the fold, expect red**

Temporarily make both failure arms `return { ok: true, stampOf: emptyCoordPlacements() };`. Run `-t "placement read"`. Expected: the two new cases FAIL. Restore. Commit:

```bash
git add server/src/fleet.ts shared/api.ts server/test/fleet.test.ts
git commit -m "fix(fleet): a failed placement read emits boardProject null, the wire's own word for it (D-2875; board-placement wave 2, Task 2)"
```

---

### Task 3: Cards from the project list — durable, ordered, and honest when empty

**Files:**
- Modify: `pwa/src/fleet/groupFleet.ts` (whole `groupFleet` function, `:94-139`; the `FleetGroup.pin` field and docstring, `:47-53`)
- Modify: `pwa/src/fleet/ProjectCard.tsx` (the pin chip, `:426-434`)
- Modify: `pwa/src/screens/FleetScreen.tsx` (the `groupFleet(sessions, acks)` call, `:696`)
- Test: `pwa/test/groupFleet.test.ts` (REWRITE — spec §8 "reds by design": every call gains the project-list argument; the `pin` describe reads the union), `pwa/test/project-card.test.tsx` (the `grp` fixture's `pin`), `pwa/test/fleet-screen.test.tsx`

**Interfaces:**
- Consumes: nothing new (Task 4 will switch the grouping KEY to `boardHome`; this task keeps `s.project` so its commit alone changes no row's card).
- Produces: `groupFleet(sessions: FleetSession[], projects: readonly string[], acks: Acks = {}): FleetGroup[]` — the second parameter is REQUIRED (D-3010: an optional one that falls back to session-derived cards is an overloaded seam; a forgotten call site must be a compile error). `export type FleetPin = { state: 'shared'; home: string } | { state: 'mixed' } | { state: 'empty' }`; `FleetGroup.pin: FleetPin`.

**The rulings this task carries (D-3010, defined in full at the end of this plan):** the card set is the UNION of the known project list, every session's rendered card, and every session's OWN project (so an emptied card exists even before the list lands); populated cards keep `sortFleet`'s urgency order; zero-row cards follow in the list's own order; the list is deduped by name (`listProjects` keys rows by workdir and CAN emit two rows with one name — `server/src/lifecycle.ts:147-149`'s workdir tiebreak exists for exactly that); an empty group's `pin` is `{ state: 'empty' }` because `[].every(...)` is `true` and today's `forPin[0]!.home` THROWS on an empty group (`groupFleet.ts:118-121`).

- [ ] **Step 1: Rewrite `pwa/test/groupFleet.test.ts` — red first**

Change EVERY `groupFleet(sessions, acks)` / `groupFleet(sessions)` call to `groupFleet(sessions, [], acks)` / `groupFleet(sessions, [])` (the second argument is the known-project list; `[]` keeps each existing case's card set exactly what its sessions imply). Replace the `describe('pin', …)` block's three expectations with the union — `expect(g.pin).toEqual({ state: 'shared', home: 'claude' })`, `toEqual({ state: 'mixed' })` — and ADD these cases:

```ts
describe('durable cards (R5, D-3010)', () => {
  it('renders a known project with zero sessions as a group with no members', () => {
    const g = groupFleet([s({ id: 'a', project: 'alpha' })], ['alpha', 'ghost']);
    expect(g.map((x) => x.project)).toEqual(['alpha', 'ghost']);
    const ghost = g[1]!;
    expect(ghost.sessions).toEqual([]);
    expect(ghost.archived).toEqual([]);
    expect(ghost.attention).toBe(false);
    expect(ghost.busy).toBe(0);
    expect(ghost.unseen).toBe(0);
    expect(ghost.stranded).toBe(0);
    expect(ghost.pin).toEqual({ state: 'empty' });   // not `mixed`: nothing disagrees
  });

  it('keeps the populated cards in urgency order and appends the empty ones in list order', () => {
    // `zeta` is more urgent than `alpha`; `ghost-b`/`ghost-a` are empty and
    // arrive in the list's order, which is the server's alphabetical one.
    const g = groupFleet([
      s({ id: 'a', project: 'alpha', bucket: 'working' }),
      s({ id: 'z', project: 'zeta', bucket: 'attention' }),
    ], ['alpha', 'ghost-b', 'ghost-a', 'zeta']);
    expect(g.map((x) => x.project)).toEqual(['zeta', 'alpha', 'ghost-b', 'ghost-a']);
  });

  it('dedupes a project the list names twice — one card, one key', () => {
    const g = groupFleet([], ['twice', 'twice']);
    expect(g.map((x) => x.project)).toEqual(['twice']);
  });

  it('a project absent from the list still renders a card for its own sessions', () => {
    // `listProjects` skips linked worktrees, so a workspace-only project is
    // NOT in the list; the fallback is load-bearing, not decorative.
    const g = groupFleet([s({ id: 'w', project: 'worktree-only' })], ['other']);
    expect(g.map((x) => x.project)).toEqual(['worktree-only', 'other']);
  });
});
```

- [ ] **Step 2: Run, expect a compile-level failure**

Run: `cd pwa && ./node_modules/.bin/vitest run test/groupFleet.test.ts`
Expected: FAIL — the second argument is not accepted; `pin` shapes mismatch.

- [ ] **Step 3: Implement**

In `pwa/src/fleet/groupFleet.ts`, replace the `pin` field and the function. The `unseen` field's docstring is scanned by `groupFleet.test.ts`'s `'the unseen field's doc'` block — leave every other field's docstring byte-identical.

```ts
/** The account a card's members call home — or why there is no one answer.
 *  `shared` when every member (live ones; all of them when every member is
 *  archived) carries the same `home`. `mixed` when they DISAGREE — a header
 *  asserting one account while two lines show two different ones would be a
 *  lie, and divergent pins across one project is worth noticing. `empty` when
 *  the card has NO member at all: a durable card (R5, D-3010) rendered from the
 *  project list rather than from its sessions. The third state exists because
 *  the old `string | null` had no honest value for it — `null` meant
 *  disagreement, and "nobody is here" is not a disagreement. */
export type FleetPin =
  | { state: 'shared'; home: string }
  | { state: 'mixed' }
  | { state: 'empty' };
```

…and in `FleetGroup`, `pin: FleetPin;` (replace the old `pin: string | null;` and its docstring with the one line — the union's docstring is above). Then:

```ts
/**
 * Group the fleet by CARD, preserving the flat list's urgency ordering: the
 * populated groups sort by their most urgent member (members sort by the
 * fleet rule), and every KNOWN project renders a card whether or not
 * anything is on it (R5) — those follow, in the list's own order, because a
 * card with nothing on it has no urgency to sort by. The card set is the
 * union of `projects`, every session's rendered card and every session's own
 * project, so a card can never be destroyed by a workspace leaving it and a
 * project the list does not know (a workspace-only checkout — `listProjects`
 * skips linked worktrees) still renders under its own name. Deduped by name:
 * `listProjects` keys rows by workdir and can emit two rows with one name.
 * `acks` defaults to `{}` so callers that don't care about the unseen count
 * don't have to pass it. Pure — returns new arrays.
 */
export function groupFleet(
  sessions: FleetSession[], projects: readonly string[], acks: Acks = {},
): FleetGroup[] {
  const byProject = new Map<string, FleetSession[]>();
  for (const s of sortFleet(sessions)) {
    const card = s.project;              // Task 4 makes this `boardHome(s)`
    const list = byProject.get(card);
    if (list) list.push(s);
    else byProject.set(card, [s]);
  }
  // Durable cards AFTER the populated ones: Map insertion order is the group
  // order, and the first session of each populated group IS its most urgent
  // member, so the populated cards keep their order with no second comparator
  // to drift. A known project nobody is on, and a session's OWN project that
  // it no longer renders on (Task 4), each get an empty group here.
  for (const s of sessions) if (!byProject.has(s.project)) byProject.set(s.project, []);
  for (const p of projects) if (!byProject.has(p)) byProject.set(p, []);

  const groups: FleetGroup[] = [];
  for (const [project, members] of byProject) {
    // See the `archived` field's doc: the split is on the BUCKET, so a
    // `cleanup` member stays in the live list its own chip counts it in.
    const live = members.filter((m) => m.bucket !== 'archived');
    const archived = members.filter((m) => m.bucket === 'archived');
    // `live` can be empty (every workspace of a project archived), so the pin
    // falls back to the whole membership; and the whole membership can be
    // empty (a durable card), which is the union's third state — never an
    // indexed read of an empty array.
    const forPin = live.length > 0 ? live : members;
    const first = forPin[0];
    const pin: FleetPin =
      first === undefined ? { state: 'empty' }
      : forPin.every((m) => m.home === first.home) ? { state: 'shared', home: first.home }
      : { state: 'mixed' };
    groups.push({
      project,
      sessions: live,
      archived,
      attention: live.some((m) => m.bucket === 'attention'),
      busy: live.filter((m) => m.bucket === 'working').length,
      unseen: live.filter((m) => isUnseen(m, acks)).length,
      pin,
      // `(m.stranded ?? null) !== null`, never a truthiness test and never a
      // read of `m.stranded.at` — see this field's own docstring for the two
      // producible reasons.
      stranded: live.filter(
        (m) => m.status !== 'dead' && (m.stranded ?? null) !== null,
      ).length,
    });
  }
  return groups;
}
```

- [ ] **Step 4: The pin chip reads the union**

In `pwa/src/fleet/ProjectCard.tsx`, import `type FleetPin` beside `FleetGroup`, and replace the `<span className="proj-card-pin" …>` block (`:426-434`) with a call to a small renderer defined above `ProjectCard`:

```tsx
/** The header's pin chip. Nothing at all on an empty card: `mixed` is a claim
 *  about disagreement, and zero sessions do not disagree (D-3010). */
function PinChip({ pin, roster }: { pin: FleetPin; roster: readonly RosterWire[] }): ReactNode {
  if (pin.state === 'empty') return null;
  if (pin.state === 'mixed') {
    return (
      <span className="proj-card-pin" data-mixed aria-label="pinned accounts differ">mixed</span>
    );
  }
  return (
    <span
      className="proj-card-pin"
      aria-label={`pinned to ${accountLabel(roster, pin.home)}`}
      style={{ color: `var(${accountColorVar(roster, pin.home)})` }}
    >
      {accountLabel(roster, pin.home)}
    </span>
  );
}
```

…and at the old site: `<PinChip pin={group.pin} roster={roster} />`. Keep the comment that was above the span.

- [ ] **Step 5: The call site and the fixtures**

`pwa/src/screens/FleetScreen.tsx:696`: `groupFleet(sessions, knownProjects, acks)` where, just above the `return`, add:

```ts
  // R5 (D-3010): the card set is seeded from the known-project list once it
  // lands. Before it lands — `legacy`, `pending`, `failed` — the cards are
  // session-derived exactly as before, and the set only ever GROWS when the
  // read arrives: a card cannot be destroyed by a read this device has not
  // made yet. Not hydrated and not persisted, for `pools`' own reason.
  const knownProjects = projectRows.kind === 'ready' ? projectRows.rows.map((r) => r.name) : [];
```

In `pwa/test/project-card.test.tsx`, the `grp` fixture: `pin: { state: 'shared', home: 'claude' }`; every `pin: null` override becomes `pin: { state: 'mixed' }` (grep `pin:` in that file). Add one case under `'uniform shape'`:

```tsx
  it('renders NO pin chip on an empty card — nothing is pinned and nothing disagrees', () => {
    const { container } = render(
      <ProjectCard group={grp({ sessions: [], pin: { state: 'empty' } })} onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelector('.proj-card-pin')).toBeNull();
    expect(screen.getByText('demo')).toBeInTheDocument();
  });
```

In `pwa/test/fleet-screen.test.tsx`, add (it already spies `api.projects`, see `:192` and `:391`):

```tsx
  it('renders a card for a known project with no session on it, once /api/projects lands (R5)', async () => {
    vi.spyOn(api, 'projects').mockResolvedValue({ roots: [], projects: [
      { name: 'OpenClawHetzner', workdir: '/home/rc/projects/OpenClawHetzner' },
      { name: 'ghost', workdir: '/home/rc/projects/ghost' },
    ] });
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, { conn: 'open', sessions: [session()], pools: { listed: true, byProject: {}, enforcement: 'enforced' } });
    await waitFor(() => {
      const names = [...document.querySelectorAll('.proj-card-name')].map((n) => n.textContent);
      expect(names).toEqual(['OpenClawHetzner', 'ghost']);
    });
  });
```

The `pools` literal is the shape `fleet-screen.test.tsx:402` already seeds; a non-null `pools` is what fires `refreshProjects` (`FleetScreen.tsx:250-256`).

- [ ] **Step 6: Run and reconcile**

Run: `cd pwa && ./node_modules/.bin/vitest run`
Expected: `groupFleet.test.ts`, `project-card.test.tsx`, `fleet-screen.test.tsx` PASS. **Any OTHER fleet-screen case that now renders an extra card** (its `api.projects` mock names a project no session is on) is R5 working: fix the expectation, never the rule, and list each in the commit body.

- [ ] **Step 7: Mutations, then commit**

(a) Remove the `for (const p of projects)` loop → the durable-cards cases red. (b) Change `first === undefined ? { state: 'empty' }` to fall through → the empty case throws (`TypeError`). (c) Reverse the two seeding loops' position with the populated fill → the ordering case reds. Restore each. Then:

```bash
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts test/resume-reclaim-l0.test.ts
git add pwa/src/fleet/groupFleet.ts pwa/src/fleet/ProjectCard.tsx pwa/src/screens/FleetScreen.tsx pwa/test/groupFleet.test.ts pwa/test/project-card.test.tsx pwa/test/fleet-screen.test.tsx
git commit -m "feat(board): cards come from the project list — durable, urgency-ordered, and honest when empty (R5, D-3010; board-placement wave 2, Task 3)"
```

---

### Task 4: The move — grouping key, run routing and the narrowed `abroad`, in ONE commit

**Files:**
- Modify: `pwa/src/fleet/groupFleet.ts` (the `const card = s.project` line from Task 3; a new `elsewhere` field on `FleetGroup`)
- Modify: `pwa/src/fleet/runWords.ts` (new `runCard`, beside `runForSession` at `:257`)
- Modify: `pwa/src/screens/FleetScreen.tsx` (`runs=` at `:723`, `abroad=` at `:752-753`)
- Modify: `pwa/src/fleet/ProjectCard.tsx` (`.proj-elsewhere` block beside `.proj-abroad` at `:514-521`; the `orphanNote` comment at `:320-336`)
- Modify: `pwa/src/fleet/fleet.css` (after `.proj-abroad-glyph`, `:1951`)
- Test: `pwa/test/runCard.test.ts` (create), `pwa/test/groupFleet.test.ts`, `pwa/test/fleet-screen.test.tsx`, `pwa/test/project-card.test.tsx`

**Interfaces:**
- Consumes: `boardHome` (Task 1); `groupFleet(sessions, projects, acks)` and `FleetPin` (Task 3).
- Produces: `runCard(run: { sessionId: string | null; claimedBy: string | null; project: string }, cardOf: ReadonlyMap<string, string>): string` in `runWords.ts` — the `claimedBy` parameter is D-3029's widening, carried here so this line names the SHIPPED signature; `FleetGroup.elsewhere: readonly { project: string; count: number }[]`.

**Why one commit.** `groupFleet` keyed on `boardHome` alone moves the SESSION and leaves the RUN on the old card: `nestFleet` sees one end, draws no edge, `runForSession` answers null, and the row loses its orphan marker and its `/runs` door — spec §1's measured "pure regression". The key, the routing and the `abroad` subtraction land together, or not at all.

**The predicate (critic's ruling, carried; the null arm re-ruled at the final fix round, D-3029):** a run's card is the card the session it is ABOUT renders on. A BOUND run asks its WORKER — `boardHome` of `run.sessionId`. A PENDING SPAWN has no worker and asks its COORDINATOR — `boardHome` of `run.claimedBy` — because that is where the worker is about to render, and routing it by `run.project` (this plan's original text) put a cross-repo wave's phantom on the WAVE's card until the worker bound and then moved it. `run.project` is the LAST answer, taken only when nothing routable exists: no session and no claimant (a reconstructed, ownerless row), or a session/claimant the fleet list does not carry this pass (reaped, unmeasured, an older snapshot). Without that last answer a run whose worker was reaped renders on no card at all.

- [ ] **Step 1: `runCard` — red first**

Create `pwa/test/runCard.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { runCard } from '../src/fleet/runWords';

describe('runCard — which card a run renders on (board-placement wave 2, Task 4)', () => {
  const cardOf = new Map([['w1', 'coord-project'], ['w2', 'beta']]);

  it('is the WORKER session\'s card when the run is bound to a session on the list', () => {
    expect(runCard({ sessionId: 'w1', project: 'beta' }, cardOf)).toBe('coord-project');
  });
  it('falls back to the run\'s own project for a pending spawn — no session exists yet (rule 5)', () => {
    expect(runCard({ sessionId: null, project: 'beta' }, cardOf)).toBe('beta');
  });
  it('falls back to the run\'s own project when the bound session is not on the list this pass', () => {
    // Reaped, unmeasured, or an older snapshot: the run must not vanish.
    expect(runCard({ sessionId: 'gone', project: 'beta' }, cardOf)).toBe('beta');
  });
});
```

Run: `cd pwa && ./node_modules/.bin/vitest run test/runCard.test.ts` — expected FAIL (no export).

- [ ] **Step 2: Implement `runCard` in `pwa/src/fleet/runWords.ts`** (after `runForSession`):

```ts
/**
 * Which card a run's rows belong on: the card its WORKER renders on. Wave 2
 * of board placement moves a coordinated workspace to its coordinator's card,
 * and `nestFleet` can only draw the edge when the run reaches THAT card — a
 * run left on `run.project`'s card is spec §1's pure regression (no edge, no
 * marker, no `/runs` door).
 *
 * A BOUND run asks its WORKER; a PENDING SPAWN has no worker and asks its
 * COORDINATOR (D-3029), which is where the bound worker is about to render.
 * `run.project` is the LAST answer, never the first: no session and no
 * claimant, or a session/claimant the fleet list does not carry this pass
 * (reaped, unmeasured, an older snapshot). Without it an orphaned run renders
 * on no card at all.
 *
 * `cardOf` is built ONCE per render by the caller from `boardHome` over the
 * whole session list — never inside a card, which sees only its own rows.
 */
export function runCard(
  run: { sessionId: string | null; claimedBy: string | null; project: string },
  cardOf: ReadonlyMap<string, string>,
): string {
  if (run.sessionId === null) {
    return run.claimedBy === null ? run.project : cardOf.get(run.claimedBy) ?? run.project;
  }
  return cardOf.get(run.sessionId) ?? run.project;
}
```

(The shipped docstring is longer than this block — it argues the cross-repo failure the original arm produced. Read the file, not this excerpt.)

Run the test — expected PASS.

- [ ] **Step 3: The grouping key and `elsewhere` — red first**

Add to `pwa/test/groupFleet.test.ts`:

```ts
describe('the grouping key is boardHome (spec §6, Task 4)', () => {
  it('places a session on its boardProject card, not its own project\'s', () => {
    const g = groupFleet([
      s({ id: 'coord', project: 'intake' }),
      s({ id: 'w', project: 'custom-tools', boardProject: 'intake' }),
    ], []);
    expect(g.map((x) => x.project)).toEqual(['intake', 'custom-tools']);
    expect(g[0]!.sessions.map((x) => x.id)).toEqual(['coord', 'w']);
    expect(g[1]!.sessions).toEqual([]);                          // the own-project card survives, empty
  });

  it('counts on the DESTINATION card — attention, busy, unseen, stranded and the archived split follow the row', () => {
    const g = groupFleet([
      s({ id: 'coord', project: 'intake' }),
      s({ id: 'w', project: 'custom-tools', boardProject: 'intake', bucket: 'attention', bucketSince: 10 }),
      s({ id: 'a', project: 'custom-tools', boardProject: 'intake', bucket: 'archived', archivedAt: 5 }),
    ], []);
    const intake = g.find((x) => x.project === 'intake')!;
    expect(intake.attention).toBe(true);
    expect(intake.unseen).toBe(1);
    expect(intake.archived.map((x) => x.id)).toEqual(['a']);
    const own = g.find((x) => x.project === 'custom-tools')!;
    expect(own.attention).toBe(false);
    expect(own.archived).toEqual([]);
  });

  it('a placement naming a project nobody knows still renders — on a card of that name', () => {
    const g = groupFleet([s({ id: 'w', project: 'custom-tools', boardProject: 'nowhere' })], ['custom-tools']);
    expect(g.map((x) => x.project)).toEqual(['nowhere', 'custom-tools']);
  });

  it('the emptied card says where its work went, per destination, live rows only', () => {
    const g = groupFleet([
      s({ id: 'w1', project: 'custom-tools', boardProject: 'intake' }),
      s({ id: 'w2', project: 'custom-tools', boardProject: 'intake' }),
      s({ id: 'w3', project: 'custom-tools', boardProject: 'data' }),
      s({ id: 'a', project: 'custom-tools', boardProject: 'intake', bucket: 'archived', archivedAt: 5 }),
      s({ id: 'home', project: 'custom-tools' }),
    ], []);
    const own = g.find((x) => x.project === 'custom-tools')!;
    expect(own.elsewhere).toEqual([{ project: 'intake', count: 2 }, { project: 'data', count: 1 }]);
    expect(g.find((x) => x.project === 'intake')!.elsewhere).toEqual([]);
  });
});
```

Run — expected FAIL.

- [ ] **Step 4: Implement the key and `elsewhere`**

In `groupFleet.ts`: import `boardHome` from `'../../../shared/api'`; change `const card = s.project;` to `const card = boardHome(s);` and delete its Task-4 comment. Add to `FleetGroup`:

```ts
  /** Where this project's OWN workspaces render when it is not here — one
   *  entry per destination card, live rows only, most first. Spec §6: "an
   *  emptied card says where its work went", as PLAIN TEXT, never a link — a
   *  tappable route would be the second access path R2 excludes. Empty on a
   *  card that has lost nothing. */
  elsewhere: readonly { project: string; count: number }[];
```

…and before `groups.push`, inside the loop:

```ts
    const away = new Map<string, number>();
    for (const s of sessions) {
      if (s.project !== project || s.bucket === 'archived') continue;
      const dest = boardHome(s);
      if (dest === project) continue;
      away.set(dest, (away.get(dest) ?? 0) + 1);
    }
    const elsewhere = [...away.entries()].map(([dest, count]) => ({ project: dest, count }))
      .sort((a, b) => b.count - a.count || a.project.localeCompare(b.project));
```

…with `elsewhere,` in the pushed literal. Run `groupFleet.test.ts` — expected PASS.

- [ ] **Step 5: The routing and the subtraction — red first**

Add to `pwa/test/fleet-screen.test.tsx`, beside the two existing run-scoping cases (`:2262`, `:2415`):

```tsx
  it('brackets a cross-repo worker under its coordinator ON THE COORDINATOR\'S CARD — the run follows the row (Task 4)', () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      sessions: [
        session({ id: 'claude:coord', project: 'alpha', workspace: 'quiet-mesa' }),
        session({ id: 'claude:worker', project: 'beta', workspace: 'still-cove', boardProject: 'alpha' }),
      ],
      runs: [runRow({ id: 40, project: 'beta', homeProject: 'alpha', sessionId: 'claude:worker', claimedBy: 'claude:coord' })],
      runsFrameSeen: true,
    });
    const cards = [...document.querySelectorAll('.proj-card')];
    const alpha = cards.find((c) => c.querySelector('.proj-card-name')?.textContent === 'alpha')!;
    const beta = cards.find((c) => c.querySelector('.proj-card-name')?.textContent === 'beta')!;
    // The edge is drawn on alpha…
    expect(alpha.querySelectorAll('.proj-nest')).toHaveLength(1);
    expect(alpha.querySelector('.proj-nest .sess-label')?.textContent).toBe('still-cove');
    // …with no orphan marker (the coordinator IS on this card) and NO abroad
    // line (the worker renders here — stating the run twice is the defect §6 names)…
    expect(alpha.querySelector('.proj-crossing')).toBeNull();
    expect(alpha.querySelector('.proj-abroad')).toBeNull();
    // …and beta, emptied, says where its work went, as text with no control.
    expect(beta.querySelector('.sess-line')).toBeNull();
    const line = beta.querySelector('.proj-elsewhere-line')!;
    expect(line.textContent).toBe('1 workspace under alpha');
    expect(line.closest('button, a')).toBeNull();
    expect(line.querySelector('button, a')).toBeNull();
  });

  it('a pending spawn still reaches its coordinator\'s card — the null-session arm of runCard', () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      sessions: [session({ id: 'claude:coord', project: 'alpha', workspace: 'quiet-mesa' })],
      runs: [runRow({ id: 41, project: 'alpha', state: 'planned', dispatchStartedAt: RUN_FROZEN - 1_000, sessionId: null, claimedBy: 'claude:coord' })],
      runsFrameSeen: true,
    });
    expect(document.querySelector('.proj-pending')).not.toBeNull();
  });
```

Run — expected FAIL on the first (the bracket renders on beta today; alpha carries an abroad line).

- [ ] **Step 6: Implement the routing, the subtraction and the elsewhere lines**

`pwa/src/screens/FleetScreen.tsx`: import `boardHome` from `'../../../shared/api'` and `runCard` from `'../fleet/runWords'`; above the `return`, beside `knownProjects`:

```ts
  // Task 4: which card each run belongs on — the card its WORKER renders on.
  // Built ONCE here from the whole session list, because a card sees only
  // its own rows and cannot answer it (`runCard`'s docstring has the two
  // fallbacks and why each is load-bearing).
  const cardOf = new Map(sessions.map((s) => [s.id, boardHome(s)] as const));
```

Replace the `runs=` filter and its comment:

```tsx
                /* Task 4 (wave 2): THIS card's runs are the runs whose WORKER
                   renders here — `runCard`, never `r.project`. A run kept on
                   its worker's OWN project's card after the row moved would be
                   spec §1's pure regression: one end on each card, no edge. */
                runs={activeRuns.filter((r) => runCard(r, cardOf) === g.project)}
```

Replace the `abroad=` filter's LAST clause (keep its long comment; append one sentence to it: "Since wave 2 it also SUBTRACTS a run whose worker now renders on this very card — that run is a bracketed row here, and a second line for it would state the same wave twice (spec §6)."):

```tsx
                abroad={activeRuns.filter(
                  (r) => runHomeProject(r) === g.project && r.project !== g.project
                    && runCard(r, cardOf) !== g.project)}
```

`pwa/src/fleet/ProjectCard.tsx`: after the `abroad` block inside `.proj-card-body`:

```tsx
          {group.elsewhere.length > 0 && (
            /* Spec §6: an emptied card says where its work went, as PLAIN TEXT —
               never a link. A tappable route here would be the second access
               path R2 excludes, the same reason the abroad line above is a bare
               span with no onClick. */
            <div className="proj-elsewhere">
              {group.elsewhere.map((e) => (
                <span key={e.project} className="proj-elsewhere-line">
                  {`${e.count} ${e.count === 1 ? 'workspace' : 'workspaces'} under ${e.project}`}
                </span>
              ))}
            </div>
          )}
```

Also correct the `orphanNote` comment paragraph that begins `asked against THIS CARD's project, \`group.project\`, not \`run.project\`` — replace `(D-2576): the two agree today only because …` through `… a DIFFERENT project.` with: `(D-2576, re-read for wave 2): \`group.project\` is now the card this row was PLACED on, which for a moved worker is its COORDINATOR's project. The question the home clause asks is therefore "is this programme homed somewhere other than the card the reader is looking at", which is still the right question for a sentence printed on that card; \`run.project\` would ask about a card the row is not on.`

`pwa/src/fleet/fleet.css`, after `.proj-abroad-glyph`:

```css
/* Wave 2 (board placement): the emptied card's sentence about where its own
   workspaces render now. Same register and ground as `.proj-abroad` — about
   rows that are NOT on this card — and never a tap surface (R2). */
.proj-elsewhere {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  margin-top: var(--sp-1);
  padding-top: var(--sp-1);
  border-top: 1px solid var(--edge-subtle);
}
.proj-elsewhere-line {
  min-width: 0;
  font-size: var(--text-2xs);
  color: var(--ink-tertiary);
}
```

`pwa/test/project-card.test.tsx`: the `grp` fixture gains `elsewhere: []`; add under the abroad describe:

```tsx
  it('renders the elsewhere lines as text with no control, and nothing when nothing moved', () => {
    const { container, rerender } = render(
      <ProjectCard group={grp({ sessions: [], pin: { state: 'empty' }, elsewhere: [{ project: 'intake', count: 2 }] })}
                   onOpen={() => {}} onActions={() => {}} />);
    const line = container.querySelector('.proj-elsewhere-line')!;
    expect(line.textContent).toBe('2 workspaces under intake');
    expect(container.querySelectorAll('.proj-elsewhere button, .proj-elsewhere a')).toHaveLength(0);
    rerender(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelector('.proj-elsewhere')).toBeNull();
  });
```

- [ ] **Step 7: Run everything that could see it**

```bash
cd pwa && ./node_modules/.bin/vitest run
cd ../server && ./node_modules/.bin/vitest run test/single-definition.test.ts test/resume-reclaim-l0.test.ts
```

Expected: PASS. The existing `'scopes each card to its OWN project's runs'` and `'gives each card the runs whose HOME is that project'` cases (`fleet-screen.test.tsx:2262`, `:2415`) stay green — their fixtures never set `boardProject`, so `boardHome` is the project and `runCard` is `r.project`; they are the CONTROL that an unmoved fleet renders as before. Say so in the commit body.

- [ ] **Step 8: Mutations, then ONE commit**

(a) `runs={activeRuns.filter((r) => r.project === g.project)}` restored → the cross-repo case reds (no `.proj-nest` on alpha). (b) Drop `&& runCard(r, cardOf) !== g.project` → reds (alpha has `.proj-abroad`). (c) `runCard` returns `run.project` unconditionally → the first `runCard.test.ts` case reds. (d) Drop the `sessionId === null` arm → GREEN by structure at the time of writing: `cardOf.get(null as never)` is undefined and `??` covered it, so the arm was pinned by another case's premise rather than by its own return value. **No longer true since D-3029:** the arm now returns the COORDINATOR's card, so reverting it to `run.project` reds `runCard.test.ts`'s pending case and `fleet-screen.test.tsx`'s two-card pending case (measured, 2 failed | 90 passed). Restore all. Then:

```bash
git add pwa/src/fleet/groupFleet.ts pwa/src/fleet/runWords.ts pwa/src/screens/FleetScreen.tsx pwa/src/fleet/ProjectCard.tsx pwa/src/fleet/fleet.css pwa/test/runCard.test.ts pwa/test/groupFleet.test.ts pwa/test/fleet-screen.test.tsx pwa/test/project-card.test.tsx
git commit -m "feat(board): a coordinated workspace moves to its coordinator's card, its run follows, and the emptied card says where it went (spec §6; board-placement wave 2, Task 4)"
```

---

### Task 5: Attention first among siblings — one ordering key inside rule 2

**Files:**
- Modify: `pwa/src/fleet/nestFleet.ts` (`programOrder` at `:53-59`; the `settled` sort at `:107-110`; rule 2's line in the `nestFleet` docstring at `:78-79`)
- Test: `pwa/test/nestFleet.test.ts` (rule 2's describe, `:94-113`; its `sess` helper at `:5-15`)

**Interfaces:**
- Consumes: `FleetSession.bucket`.
- Produces: no new export. Rule 2 becomes "attention first, then programme order, among the children of ONE parent".

**D-3008, carried:** spec §1 says the bracket appears "with `nestFleet` untouched" and §6 says "one comparator ahead of `programOrder`, scoped to siblings". Both are true of THIS edit: rules 1–5 and the header comment are unmodified; the ordering key inside rule 2 is additive. Say exactly that in the commit body. **Do not edit lines 1–35** — `server/test/resume-reclaim-l0.test.ts:297-303` scans that block verbatim.

**Why siblings-only costs nothing here (critic's ruling):** `settled` is sorted ONCE, globally, and then distributed into per-parent `kids` lists in that order (`:128-132`), and the top level is the caller's array verbatim (`:154-159`). A stable global sort with the new key IS a per-sibling ordering; a top-level row cannot climb because the top level is never re-sorted.

- [ ] **Step 1: The control and the case — red first**

In `pwa/test/nestFleet.test.ts`, inside `describe('nestFleet — rule 2 …')`:

```ts
  it('puts a sibling that is waiting on the operator FIRST, ahead of programme order', () => {
    // `later` is wave 2 and would sort after `earlier` by programme order
    // alone; it is blocked on the operator, and an indented row three deep
    // hides that just as well as a fold does (spec §6).
    const sessions = [sess('coord'), sess('earlier'), sess('later', { bucket: 'attention' })];
    const rows = nestFleet(sessions, [
      run({ id: 20, wave: 1, sessionId: 'earlier', claimedBy: 'coord' }),
      run({ id: 21, wave: 2, sessionId: 'later', claimedBy: 'coord' }),
    ]);
    expect(shape(rows)).toEqual([['coord', 0], ['later', 1], ['earlier', 1]]);
  });

  it('CONTROL: with no attention sibling the order is programme order exactly as before', () => {
    // The existing rule-2 cases hard-code `bucket: 'idle'` on every fixture, so
    // an attention-first key is a no-op on them and they cannot pin it. This
    // case states that premise; the case above is the pin.
    const sessions = [sess('coord'), sess('earlier'), sess('later')];
    const rows = nestFleet(sessions, [
      run({ id: 21, wave: 2, sessionId: 'later', claimedBy: 'coord' }),
      run({ id: 20, wave: 1, sessionId: 'earlier', claimedBy: 'coord' }),
    ]);
    expect(shape(rows)).toEqual([['coord', 0], ['earlier', 1], ['later', 1]]);
  });

  it('never lifts a waiting row above its PARENT — the key is scoped to siblings', () => {
    const sessions = [sess('other'), sess('coord'), sess('kid', { bucket: 'attention' })];
    const rows = nestFleet(sessions, [run({ id: 20, wave: 1, sessionId: 'kid', claimedBy: 'coord' })]);
    // Top level is the caller's order, verbatim: `other`, then `coord` with its child.
    expect(shape(rows)).toEqual([['other', 0], ['coord', 0], ['kid', 1]]);
  });
```

Run: `cd pwa && ./node_modules/.bin/vitest run test/nestFleet.test.ts` — expected: the first case FAILS, the other two pass.

- [ ] **Step 2: Implement**

In `nestFleet.ts`, replace `programOrder`'s docstring sentence `PROGRAMME ORDER, and the only comparator in this file:` with `PROGRAMME ORDER, the base comparator — \`attentionFirst\` below puts ONE key ahead of it (spec §6, wave 2; D-3008):` and add below `programOrder`:

```ts
/** ATTENTION FIRST, then programme order — the one key ahead of
 *  {@link programOrder}, and scoped to siblings by construction: `settled` is
 *  sorted once and handed out per parent in that order, and the top level is
 *  never re-sorted, so a waiting child rises among its siblings and never
 *  above its parent. `attention` means blocked on the operator, which is the
 *  one thing this screen exists to surface (`groupFleet.ts`'s own principle);
 *  `programOrder`'s "a worker does not climb the tree by being busy" is about
 *  busy-ness, and this is not that. A pending spawn has no session and so no
 *  bucket; it keeps programme order (rule 5). */
const attentionFirst =
  (byId: ReadonlyMap<string, FleetSession>) =>
  (a: RunSummary, b: RunSummary): number => {
    const waiting = (r: RunSummary): 0 | 1 =>
      r.sessionId !== null && byId.get(r.sessionId)?.bucket === 'attention' ? 0 : 1;
    return waiting(a) - waiting(b) || programOrder(a, b);
  };
```

…and change the `settled` sort to `.sort(attentionFirst(byId))`. Leave `pending`'s sort as `programOrder`. In the `nestFleet` docstring, rule 2 becomes: `2. Children read attention-first, then in programme order ({@link programOrder}), never in the list's own — and the attention key never crosses a parent (D-3008).`

- [ ] **Step 3: Run, mutate, commit**

Run `nestFleet.test.ts` — PASS. Mutation: `.sort(programOrder)` restored → the first new case reds; restore. Then:

```bash
cd server && ./node_modules/.bin/vitest run test/resume-reclaim-l0.test.ts test/single-definition.test.ts
cd ../pwa && ./node_modules/.bin/vitest run test/nestFleet.test.ts test/project-card.test.tsx test/fleet-screen.test.tsx
git add pwa/src/fleet/nestFleet.ts pwa/test/nestFleet.test.ts
git commit -m "feat(board): a waiting child sorts first among its siblings — one key ahead of programme order, rules untouched (spec §6, D-3008; board-placement wave 2, Task 5)"
```

---

### Task 6: The repo label on the card — decided in the card, composed into the row's name

**Files:**
- Modify: `pwa/src/screens/FleetScreen.tsx` (a `repoFor` beside `placementFor`, `:269-277`; the `<ProjectCard …>` props at `:697-760`)
- Modify: `pwa/src/fleet/ProjectCard.tsx` (props `:141-233`; `rowBody` at `:385-397`; the archived rows at `:544`)
- Modify: `pwa/src/fleet/SessionLine.tsx` (props `:140-176`; the `.sess-open` button at `:437-445`)
- Modify: `pwa/src/fleet/fleet.css`
- Test: `pwa/test/session-line.test.tsx`, `pwa/test/project-card.test.tsx`

**Interfaces:**
- Consumes: `repoLabel` (Task 1); `ProjectRow.repo` (wave 1).
- Produces: `ProjectCard` prop `repoFor?: (project: string) => ProjectRepoWire | undefined` (default `() => undefined`); `SessionLine` prop `repo?: string | null` (default `null`).

**The rulings, carried from the critic:** the predicate is at the REPO grain — `repoLabel(repoFor(row.session.project))` against `repoLabel(repoFor(group.project))`, both non-null and unequal — not a project-NAME comparison, because two projects can share one repo (a worktree-shaped project beside its parent checkout) and the label would then be noise. `ProjectCard` DECIDES (it holds both the card's project and the lookup); `SessionLine` COMPOSES the slug INTO the row button's accessible name; `sessionLabel` is not widened (its holder is pinned). `repoFor` uses `placementFor`'s `Object.hasOwn` idiom so a key-absent row (older server) yields `undefined` and renders nothing. `ProjectRow.repo` is RETAINED sweep data, minutes old at most — the same freshness the pool chip already carries; the label states a slug, not a timestamp.

- [ ] **Step 1: The row composes — red first**

In `pwa/test/session-line.test.tsx`, add:

```tsx
describe('the repo label (board-placement wave 2, Task 6)', () => {
  it('sits INSIDE the row button\'s accessible name, so two same-slug rows are two names', () => {
    render(<SessionLine session={s()} repo="Synapsium-Labs/custom-tools" onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByRole('button', { name: /quiet-mesa.*Synapsium-Labs\/custom-tools/ })).toBeInTheDocument();
    expect(document.querySelector('.sess-repo')?.textContent).toBe('Synapsium-Labs/custom-tools');
  });
  it('renders nothing when the card already implies the repo', () => {
    render(<SessionLine session={s()} onOpen={() => {}} onActions={() => {}} />);
    expect(document.querySelector('.sess-repo')).toBeNull();
    expect(screen.getByRole('button', { name: 'quiet-mesa' })).toBeInTheDocument();
  });
});
```

Run: `cd pwa && ./node_modules/.bin/vitest run test/session-line.test.tsx` — expected FAIL.

- [ ] **Step 2: `SessionLine` composes**

Add the prop (docstring included) and render it inside the `.sess-open` button, AFTER `<TypedLabel …/>`:

```tsx
  /** The repository this row works in, when the CARD it renders on would
   *  otherwise imply another (spec §6, R3) — decided by `ProjectCard`, never
   *  here: this row does not know which card it is on. Rendered INSIDE the
   *  row button so it is part of the accessible name: workspace slugs are
   *  unique per project only, and `still-river` is live on two projects
   *  today — two rows on one card would otherwise be two identical buttons
   *  in a screen-reader rotor. `null` renders nothing. */
  repo?: string | null;
```

```tsx
          <TypedLabel className="sess-label" text={label} />
          {repo !== null && <span className="sess-repo">{repo}</span>}
```

…with `repo = null` in the destructuring defaults. CSS, next to `.sess-held`'s block: `.sess-repo { margin-left: var(--sp-1); font-family: var(--font-mono); font-size: var(--text-2xs); color: var(--ink-tertiary); white-space: nowrap; }`. Run the test — PASS.

- [ ] **Step 3: The card decides — red first**

In `pwa/test/project-card.test.tsx`:

```tsx
describe('the repo label appears only where the card stops implying it (spec §6, Task 6)', () => {
  const repos: Record<string, ProjectRepoWire> = {
    demo: { state: 'named', slug: 'o/demo' },
    'custom-tools': { state: 'named', slug: 'o/custom-tools' },
    twin: { state: 'named', slug: 'o/demo' },          // a second project on the SAME repo
    dark: { state: 'unmeasured' },
  };
  const repoFor = (p: string): ProjectRepoWire | undefined => repos[p];
  const moved = sess({ id: 'custom-tools-still-river', project: 'custom-tools', workspace: 'still-river', boardProject: 'demo' });

  it('labels a row whose OWN project\'s repo differs from the card\'s', () => {
    render(<ProjectCard group={grp({ sessions: [sess(), moved] })} repoFor={repoFor} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByRole('button', { name: /still-river.*o\/custom-tools/ })).toBeInTheDocument();
    expect(document.querySelectorAll('.sess-repo')).toHaveLength(1);
  });
  it('does NOT label a moved row whose repo equals the card\'s — the name differs, the repo does not', () => {
    const twinRow = sess({ id: 'twin-still-river', project: 'twin', workspace: 'still-river', boardProject: 'demo' });
    render(<ProjectCard group={grp({ sessions: [sess(), twinRow] })} repoFor={repoFor} onOpen={() => {}} onActions={() => {}} />);
    expect(document.querySelector('.sess-repo')).toBeNull();
  });
  it('does NOT label when either side is unmeasured or absent — no claim over a timeout', () => {
    const darkRow = sess({ id: 'dark-still-river', project: 'dark', workspace: 'still-river', boardProject: 'demo' });
    render(<ProjectCard group={grp({ sessions: [sess(), darkRow] })} repoFor={repoFor} onOpen={() => {}} onActions={() => {}} />);
    expect(document.querySelector('.sess-repo')).toBeNull();
    cleanup();
    render(<ProjectCard group={grp({ sessions: [sess(), moved] })} onOpen={() => {}} onActions={() => {}} />);   // no repoFor: an older server
    expect(document.querySelector('.sess-repo')).toBeNull();
  });
  it('two colliding slugs on one card are two distinct accessible names', () => {
    const own = sess({ id: 'demo-still-river', workspace: 'still-river' });
    render(<ProjectCard group={grp({ sessions: [own, moved] })} repoFor={repoFor} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByRole('button', { name: 'still-river' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /still-river.*o\/custom-tools/ })).toBeInTheDocument();
  });
});
```

Import `type ProjectRepoWire` from `'../../shared/api'`. Run — expected FAIL (no `repoFor` prop).

- [ ] **Step 4: Implement the decision in `ProjectCard`**

Import `repoLabel` and `type ProjectRepoWire` from `'../../../shared/api'`. Add the prop:

```tsx
  /** The repository a project's main checkout was last measured to be, by
   *  name — `FleetScreen`'s lookup over the same `/api/projects` rows that
   *  feed `placement`, absent-key-aware (an older server yields `undefined`).
   *  A displaced row needs ITS OWN project's repo, which is by construction a
   *  different project from this card's, so a one-project `placement` read is
   *  the wrong shape and this is a lookup. Defaults to "nothing measured". */
  repoFor?: (project: string) => ProjectRepoWire | undefined;
```

…with `repoFor = () => undefined` in the defaults, and before `rowBody`:

```tsx
  // Spec §6: the repo label appears where the card stops implying it — on a
  // row whose repo DIFFERS from this card's, both measured, and nowhere else.
  // At the REPO grain, not the project name: two projects can resolve to one
  // repo (a worktree-shaped project beside its parent), and a label there is
  // noise. Decided HERE, the one level that holds both the card's project and
  // the lookup; `SessionLine` composes it into the row's name and knows no card.
  const cardRepo = repoLabel(repoFor(group.project));
  const repoOf = (s: FleetSession): string | null => {
    if (s.project === group.project) return null;
    const own = repoLabel(repoFor(s.project));
    return own !== null && cardRepo !== null && own !== cardRepo ? own : null;
  };
```

Pass `repo={repoOf(row.session)}` in `rowBody`'s `<SessionLine …/>` and `repo={repoOf(s)}` on the archived rows' `<SessionLine …/>`.

- [ ] **Step 5: `FleetScreen` threads the lookup**

Beside `placementFor`:

```ts
  const repoFor = useCallback((project: string): ProjectRepoWire | undefined => {
    if (projectRows.kind !== 'ready') return undefined;
    const row = projectRows.rows.find((candidate) => candidate.name === project);
    // `Object.hasOwn`: the key ABSENT is an older server and must read as
    // "nothing measured", never as `{state:'unmeasured'}` (ProjectRow's doc).
    return row !== undefined && Object.hasOwn(row, 'repo') ? row.repo : undefined;
  }, [projectRows]);
```

…import `type ProjectRepoWire` beside `ProjectRow`, and pass `repoFor={repoFor}` to `<ProjectCard>`.

- [ ] **Step 6: Run, mutate, commit**

```bash
cd pwa && ./node_modules/.bin/vitest run test/session-line.test.tsx test/project-card.test.tsx test/fleet-screen.test.tsx
cd ../server && ./node_modules/.bin/vitest run test/single-definition.test.ts test/resume-reclaim-l0.test.ts
```

Mutations: (a) `repoOf` compares `s.project !== group.project` alone (name grain) → the `twin` case reds; (b) drop `cardRepo !== null` → the `dark` case still passes? — `own` for `dark` is null already, so mutate the OTHER side: make the card `dark` (`grp({ project: 'dark', … })`) in a throwaway run and confirm a label appears only with the guard removed; note it. Restore. Commit:

```bash
git add pwa/src/fleet/ProjectCard.tsx pwa/src/fleet/SessionLine.tsx pwa/src/screens/FleetScreen.tsx pwa/src/fleet/fleet.css pwa/test/session-line.test.tsx pwa/test/project-card.test.tsx
git commit -m "feat(board): the repo label, inside the row's name, only where the card stops implying it (spec §6 R3; board-placement wave 2, Task 6)"
```

---

### Task 7: The session view's repo label — unconditional, off the project rows in the store

**Files:**
- Modify: `pwa/src/stores/fleet.ts` (`FleetState` at `:17`; the initial state at `:258-273`)
- Modify: `pwa/src/screens/FleetScreen.tsx` (`refreshProjects`, `:226-249`)
- Modify: `pwa/src/screens/SessionScreen.tsx` (`live` at `:76`; the `<SessionHeader …/>` at `~:460-468`)
- Modify: `pwa/src/session/SessionHeader.tsx` (props `:28-61`; the `.chat-meta` block, `:262-300`); `pwa/src/session/chat.css`
- Test: `pwa/test/header.test.tsx`, `pwa/test/offline.test.ts` (one absence pin)

**Interfaces:**
- Consumes: `repoLabel` (Task 1).
- Produces: `FleetState.projects: readonly ProjectRow[] | null` and `setProjects(rows: readonly ProjectRow[]): void`; `SessionHeaderProps.repo?: string | null`.

**D-3013, carried:** R3 says the session view's label is unconditional — meaning not conditioned on a card's context. The project rows live only in `FleetScreen`'s component state today (one agent round trip per project, no timer), so wave 2 lifts the LAST successful read into the fleet store, not persisted (a stale repo slug is a claim about a checkout this device cannot stand behind — `pools`' own argument), and the session view reads it from there. On a deep link before the fleet screen has ever fetched, it renders nothing. That is the residual, stated.

- [ ] **Step 1: Red — the header renders the label it is given**

In `pwa/test/header.test.tsx` (use the file's own render helper for `SessionHeader` — find it with `grep -n "SessionHeader " pwa/test/header.test.tsx | head`; if it builds props by hand, copy the nearest case):

```tsx
describe('the repo label in the session view (board-placement wave 2, Task 7, R3)', () => {
  it('renders the repo unconditionally when it is known', () => {
    renderHeader({ repo: 'Synapsium-Labs/custom-tools' });
    expect(screen.getByText('Synapsium-Labs/custom-tools')).toBeInTheDocument();
    expect(document.querySelector('.chip--repo')).not.toBeNull();
  });
  it('renders nothing when it is not — an older server, or a deep link before any fleet read (D-3013)', () => {
    renderHeader({});
    expect(document.querySelector('.chip--repo')).toBeNull();
  });
});
```

Run: `cd pwa && ./node_modules/.bin/vitest run test/header.test.tsx` — expected FAIL.

- [ ] **Step 2: `SessionHeader` renders it**

Add `repo?: string | null;` to `SessionHeaderProps` (docstring: "The repository this session's project was last measured to be — R3: shown whenever known, there is no card here to imply it. `null`/absent renders nothing."), default `repo = null`, and in `.chat-meta` directly after the `chip--active` account chip:

```tsx
          {repo !== null && (
            <span className="chip chip--repo" title="repository">
              {repo}
            </span>
          )}
```

`chat.css`: `.chip--repo { font-family: var(--font-mono); }` beside `.chip--archived`. Run — PASS.

- [ ] **Step 3: Red — the store carries the rows**

In `pwa/test/offline.test.ts` (or `pwa/test/fleet-store.test.ts` if it exists — `ls pwa/test | grep -i store`), add:

```ts
it('projects start null and are NOT part of the persisted snapshot (Task 7)', () => {
  const store = createFleetStore({ makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close() {} }) as unknown as WebSocket });
  expect(store.getState().projects).toBeNull();
  store.getState().setProjects([{ name: 'demo', workdir: '/w/demo', repo: { state: 'named', slug: 'o/demo' } }]);
  expect(store.getState().projects?.[0]?.name).toBe('demo');
  expect(JSON.stringify(loadFleetSnapshot() ?? {})).not.toContain('"projects"');
});
```

- [ ] **Step 4: The store and the writer**

`pwa/src/stores/fleet.ts`, in `FleetState` after `pools`:

```ts
  /** The LAST successful `/api/projects` read, as `FleetScreen` made it —
   *  lifted here so the session view can label a repo (R3) without a second
   *  agent round trip per project on every mount. `null` = no read yet on
   *  this store instance. DELIBERATELY NOT HYDRATED and not written by
   *  `saveFleetSnapshot`, for `pools`' own reason: a stale repo slug is a
   *  claim about a checkout this device cannot stand behind. `FleetSnapshot`
   *  has no field for it (D-3013). */
  projects: readonly ProjectRow[] | null;
  setProjects(rows: readonly ProjectRow[]): void;
```

…initial `projects: null,` beside `pools: null,`, and `setProjects(rows) { set({ projects: rows }); },` beside `dismissNotice`. Import `type ProjectRow`. In `FleetScreen.refreshProjects`, after `setProjectRows({ kind: 'ready', rows: response.projects })`: `useStore.getState().setProjects(response.projects);` (`useStore` IS the store; `getState()` avoids a render subscription).

- [ ] **Step 5: The session screen reads it**

`SessionScreen.tsx`: `const projects = useFleet((s) => s.projects);` beside `live`; `const repo = repoLabel(projects?.find((r) => r.name === project)?.repo);` after `project` is derived (`:170`); pass `repo={repo}` to `<SessionHeader …/>`. Import `repoLabel` from `'../../../shared/api'`.

- [ ] **Step 6: Run, commit**

```bash
cd pwa && ./node_modules/.bin/vitest run test/header.test.tsx test/offline.test.ts test/fleet-screen.test.tsx
cd ../server && ./node_modules/.bin/vitest run test/single-definition.test.ts
git add pwa/src/stores/fleet.ts pwa/src/screens/FleetScreen.tsx pwa/src/screens/SessionScreen.tsx pwa/src/session/SessionHeader.tsx pwa/src/session/chat.css pwa/test/header.test.tsx pwa/test/offline.test.ts
git commit -m "feat(session): the repo label in the session view, off the fleet store's last project read (R3, D-3013; board-placement wave 2, Task 7)"
```

---

### Task 8: The orphan marker says whether the coordinator is DEAD, and points at the door that already exists

**Files:**
- Modify: `pwa/src/fleet/ProjectCard.tsx` (props; `orphanNote` at `:369-383`; the marker render at `:500-505`)
- Modify: `pwa/src/screens/FleetScreen.tsx` (`<ProjectCard …/>` props)
- Test: `pwa/test/project-card.test.tsx` (the orphan describe, `:929-1016`)

**Interfaces:**
- Consumes: `coordPresence` (`pwa/src/fleet/coordWords.ts:86`); `FleetState.fleetFrameSeen`.
- Produces: `ProjectCard` props `coordOf?: (id: string) => FleetSession | null` (default `() => null`) and `frameSeen?: boolean` (default `false`); `.proj-crossing[data-presence]`.

**D-3009, carried:** spec §7 says the orphaned row is "one tap from the reclaim door". There is no per-run route in this tree — `openRunFor` navigates to `/runs` unfocused, and the reclaim door is `POST /api/runs/:id/reclaim` reached from that board. The tap that exists is the row's held cell (`.sess-held[data-open]`, `SessionLine.tsx:539-552`), which Task 4's routing keeps alive for a moved row. This task therefore adds NO tap surface (the marker stays the sibling `div` `project-card.test.tsx:1017-1037` pins) and changes only what the marker SAYS, off the same `coordPresence` the runs board uses. `coordPresence` needs the coordinator's session FLEET-WIDE (it may be on another card, archived, or absent) and `fleetFrameSeen` — neither reaches the card today, so both are threaded down.

- [ ] **Step 1: Red**

In the orphan describe of `pwa/test/project-card.test.tsx`:

```tsx
  it('says the coordinator is GONE when the fleet measures it dead, and names the run board', () => {
    const g = grp({ sessions: [sess(), sess({ id: 'demo-still-cove', workspace: 'still-cove' })] });
    const deadCoord = sess({ id: 'off-card-coordinator', project: 'elsewhere', status: 'dead', bucket: 'dead', lifecycle: 'orphan' });
    const { container } = render(
      <ProjectCard group={g} runs={[orphanRun]} nowMs={FROZEN} frameSeen
                   coordOf={(id) => (id === 'off-card-coordinator' ? deadCoord : null)}
                   onOpen={() => {}} onActions={() => {}} />);
    const marker = container.querySelector('.proj-crossing')!;
    expect(marker.getAttribute('data-presence')).toBe('dead');
    expect(marker.getAttribute('title')).toContain('reclaim');
    expect(marker.tagName).toBe('DIV');                       // still a sibling, still not a control
  });

  it('claims nothing about a coordinator the frame has not measured', () => {
    const g = grp({ sessions: [sess(), sess({ id: 'demo-still-cove', workspace: 'still-cove' })] });
    const { container } = render(
      <ProjectCard group={g} runs={[orphanRun]} nowMs={FROZEN}
                   onOpen={() => {}} onActions={() => {}} />);
    const marker = container.querySelector('.proj-crossing')!;
    expect(marker.getAttribute('data-presence')).toBe('unknown');
    expect(marker.getAttribute('title')).not.toContain('reclaim');
  });
```

If `lifecycle: 'orphan'` is not a member of the lifecycle union, read `lifecycleIsDead`'s list (`grep -n "LIFECYCLE_DEAD" pwa/src/fleet/lifecycleWords.ts shared/api.ts`) and use a member it calls dead. Run — expected FAIL.

- [ ] **Step 2: Implement**

Import `coordPresence` from `'./coordWords'`. Props:

```tsx
  /** The coordinator session by id, looked up FLEET-WIDE — it may sit on
   *  another card, in an archive fold, or nowhere this pass. Feeds
   *  `coordPresence`, the same three-answer read the runs board uses (D-1129);
   *  `null` there reads as `unknown`, never as dead. Default: nothing known. */
  coordOf?: (id: string) => FleetSession | null;
  /** `stores/fleet.ts`'s `fleetFrameSeen`: without it a coordinator absent from
   *  a STALE array would read as gone (D-1138). Default false = unknown. */
  frameSeen?: boolean;
```

…defaults `coordOf = () => null, frameSeen = false`. `orphanNote` returns `{ text; title; presence }`; where it builds `title`, compute `const presence = coordPresence(parent, coordOf(parent), frameSeen);` and:

```ts
    const where = presence === 'dead'
      ? `coordinator ${parent} is gone — reclaim this programme from the run board (the held cell opens it)`
      : `this worker's coordinator is not among this card's live sessions`;
```

…using `where` in place of the literal in both branches, and render `data-presence={note.presence}` on the marker `div`. `FleetScreen`: `const fleetFrameSeen = useStore((s) => s.fleetFrameSeen);` and pass `coordOf={(id) => sessions.find((s) => s.id === id) ?? null} frameSeen={fleetFrameSeen}`.

- [ ] **Step 3: Run, mutate, commit**

`cd pwa && ./node_modules/.bin/vitest run test/project-card.test.tsx test/fleet-screen.test.tsx`. Mutation: hard-code `presence = 'unknown'` → the first case reds. Restore. Commit:

```bash
git add pwa/src/fleet/ProjectCard.tsx pwa/src/screens/FleetScreen.tsx pwa/test/project-card.test.tsx
git commit -m "feat(board): the orphan marker says when the coordinator is measured gone, off coordPresence (spec §7, D-3009; board-placement wave 2, Task 8)"
```

---

### Task 9: The door — `POST /api/runs` refuses a claimant that is a live worker

**Files:**
- Modify: `shared/api.ts` (`RunRefuseCode` union and `RUN_REFUSE_CODE_MAP`, `:5197-5210`; the docstring's `Eighteen codes exist below today; the next new one would be the nineteenth, not the ninth.` at `:5144`)
- Modify: `server/src/coord/routes.ts` (`POST /api/runs`: after the F2 `required` refusal at `~:1304`, before `fieldMeasured` at `~:1320`)
- Modify: `ccd/coordinator-skill/references/wave-lifecycle.md` (the "Open the run" refusal table, `:22-26`)
- Modify: `ccd/coordinator-skill/SKILL.md` (the sentence at `:173-179`, "The refusals you will actually meet are …")
- Test: `server/test/run-routes.test.ts` (beside the F1 case at `:318`), `server/test/coordinator-skill.test.ts` (unchanged — its two censuses at `:365-397` and `:399-433` are the pins)

**Interfaces:**
- Consumes: `CoordStore.parentOfSession(childId): string | null` (`server/src/coord/store.ts:4848`) — the claimant of the NEWEST NON-TERMINAL run naming the session as `sessionId`, `null` when there is none OR when that run records no claimant.
- Produces: `409 {ok:false, refused:'claimant-is-a-worker', by:<that worker's coordinator>}` — the OPEN route's `refused`/`by` shape (never `reject`, which is the advance route's).

**The predicate, exactly (spec §12, corrected by the critic and carried as D-3012):**

```
const workerOf = coord.parentOfSession(claimedBy);
if (workerOf !== null && workerOf !== claimedBy) refuse
```

- `workerOf !== claimedBy`: a SELF-claimed run (`sessionId === claimedBy`, which `openRun` permits and `nestFleet.test.ts` renders) must not read as "you are your own worker". This is exactly how the read's only other caller guards it (`server/src/watch.ts:3673-3674`).
- An OWNERLESS open run — a `reconstruct`ed row whose `claimedBy` is NULL (D-12, `store.ts:1012`) — answers `null` from this read and is ADMITTED. Deliberate (D-3012): there is no `by` to name, and `by` is what this refusal is for. Named in a test so nobody reads it as an oversight.
- Scope is WIDER than the name: `TERMINAL_RUN_STATES` is `done`/`failed` only, so a worker whose run is `planned`, `awaiting-review`, `merging`, `closing` or `unknown` is refused too. Right, and stated: a finished worker is not a worker; an idle one still is.
- Placement: after F2, before the awaited registry read and `openRun` — synchronous and DB-only, cheapest-first, and pre-open so a refusal leaves no `planned` orphan and places no hold (F1's own reason).
- A review run's `claimedBy` is forced to equal the reviewed run's coordinator, so this rung is reached there through a claimant it already admitted at the work open. If a coordinator becomes a worker between its work open and its review open, the review open is refused and that wave cannot be reviewed until the coordinator's own run closes — one sentence, not an exemption.

- [ ] **Step 1: Red — five cases in `server/test/run-routes.test.ts`**

Directly after the F1 case (`'refuses a reused sessionId bound to another project — before anything is opened'`):

```ts
  it('refuses a claimedBy that is currently a WORKER of an open run — before anything is opened (spec §12)', async () => {
    const home = mkTmp('ccrc-runs-');
    seed(home, 'demo-existing');
    const { run, calls } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    // wave 1 binds demo-existing as CLAIMED_BY's worker; the run is `planned` — non-terminal.
    expect((await postOpen(app, { ...OPEN_BODY, sessionId: 'demo-existing' })).statusCode).toBe(200);
    const runsBefore = okRuns(w.coord.runs()).length;
    const holdsBefore = calls.filter((c) => c[0] === 'ws-hold').length;
    const res = await postOpen(app, { ...OPEN_BODY, program: 'build5', title: 'A worker coordinating',
      claimedBy: 'demo-existing' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, refused: 'claimant-is-a-worker', by: CLAIMED_BY });
    expect(okRuns(w.coord.runs()).length, 'a refused open left a planned orphan behind').toBe(runsBefore);
    expect(calls.filter((c) => c[0] === 'ws-hold')).toHaveLength(holdsBefore);
  });

  it('admits that same session once its run is TERMINAL — a finished worker is not a worker', async () => {
    const home = mkTmp('ccrc-runs-');
    seed(home, 'demo-existing');
    const { run } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const first = await postOpen(app, { ...OPEN_BODY, sessionId: 'demo-existing' });
    tx(w.coord.db, () => { w.coord.db.prepare("UPDATE runs SET state = 'done' WHERE id = ?").run(first.json().id); });
    const res = await postOpen(app, { ...OPEN_BODY, program: 'build5', title: 'Later', claimedBy: 'demo-existing' });
    expect(res.statusCode).toBe(200);
  });

  it('admits a SELF-claimed run\'s session — it is its own worker, not somebody\'s', async () => {
    const home = mkTmp('ccrc-runs-');
    seed(home, 'demo-self');
    const { run } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    expect((await postOpen(app, { ...OPEN_BODY, claimedBy: 'demo-self', sessionId: 'demo-self' })).statusCode).toBe(200);
    const res = await postOpen(app, { ...OPEN_BODY, program: 'build5', title: 'Self', claimedBy: 'demo-self' });
    expect(res.statusCode).toBe(200);
  });

  it('admits the session of an OWNERLESS open run — there is no `by` to name (D-3012)', async () => {
    const home = mkTmp('ccrc-runs-');
    seed(home, 'demo-orphaned');
    const { run } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const first = await postOpen(app, { ...OPEN_BODY, sessionId: 'demo-orphaned' });
    // A reconstructed row's shape: `claimedBy` NULL stays NULL (D-12).
    tx(w.coord.db, () => { w.coord.db.prepare('UPDATE runs SET claimedBy = NULL WHERE id = ?').run(first.json().id); });
    const res = await postOpen(app, { ...OPEN_BODY, program: 'build5', title: 'Orphan', claimedBy: 'demo-orphaned' });
    expect(res.statusCode).toBe(200);
  });

  it('CONTROL: a claimant that was never any run\'s worker opens as it always did', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    expect((await postOpen(app)).statusCode).toBe(200);
  });
```

`tx` is already imported at `:8`. Run: `cd server && ./node_modules/.bin/vitest run test/run-routes.test.ts -t "worker"` — expected: the first case FAILS (200 today), the rest pass.

- [ ] **Step 2: The vocabulary**

`shared/api.ts`: add `'claimant-is-a-worker'` as the last member of `RunRefuseCode` and of `RUN_REFUSE_CODE_MAP`; change the docstring sentence to `Nineteen codes exist below today; the next new one would be the twentieth, not the ninth.`; and add, after the `hold-invalid` paragraph in that docstring:

```
 * `claimant-is-a-worker` (spec 2026-09-16 §12) refuses `POST /api/runs` when
 * `claimedBy` is the `sessionId` of a NON-TERMINAL run claimed by somebody
 * else — a dispatched worker may not coordinate, because the board draws
 * ONE level of bracket and a real chain would render its middle session
 * detached (the operator's own report). `by` names that worker's
 * coordinator. A self-claimed run and an ownerless open run are both
 * admitted (D-3012); a finished worker is not a worker.
```

- [ ] **Step 3: The rung**

`server/src/coord/routes.ts`, after the F2 block's `required` return and BEFORE the `// The coordinator's project, from the REGISTRY` comment:

```ts
    // §12 (spec 2026-09-16, addendum 2026-09-18) — a dispatched worker may not
    // coordinate. `parentOfSession` is the ask lane's own read of "who
    // coordinates this session": the claimant of its newest NON-terminal run.
    // Self-claim excluded exactly as `watch.ts`'s caller excludes it; an
    // ownerless open run (a reconstructed row, `claimedBy` NULL) answers null
    // and is ADMITTED — there is no `by` to name (D-3012). Scope is any open
    // run, `planned` through `closing`, not only `dispatched`: a finished
    // worker is not a worker, an idle one still is. HERE, synchronous and
    // DB-only, ahead of the awaited registry read and of `openRun`, so a
    // refusal leaves no `planned` orphan and places no hold — F1's reason.
    const workerOf = coord.parentOfSession(claimedBy);
    if (workerOf !== null && workerOf !== claimedBy) {
      return reply.code(409).send({ ok: false, refused: 'claimant-is-a-worker', by: workerOf });
    }
```

- [ ] **Step 4: The corpus row — same commit, or `coordinator-skill.test.ts:399-433` reds**

`ccd/coordinator-skill/references/wave-lifecycle.md`, a new row directly under `home-mismatch`'s:

```
| `claimant-is-a-worker` | the `claimedBy` you sent is itself the WORKER of an open run; `by` names that worker's coordinator | stop and report. A dispatched worker never opens a run — the board brackets one level and a chain would render its middle detached. This session is a worker until its own run is closed; nothing was opened and nothing was held |
```

`ccd/coordinator-skill/SKILL.md`, in the sentence at `:173-179`, insert `` `claimant-is-a-worker`, `` after `` `home-mismatch`, ``. (`coordinator-skill.test.ts` pins the fourteen CLAUSES verbatim, not this sentence; its harvest test only requires every code named here to be real and explained in `wave-lifecycle.md`.)

- [ ] **Step 5: Run the pins, mutate, commit**

```bash
cd server && ./node_modules/.bin/vitest run test/run-routes.test.ts test/coordinator-skill.test.ts test/mail-routes.test.ts test/single-definition.test.ts test/resume-reclaim-l0.test.ts
```

Mutations: (a) delete the rung → the refusal case reds; (b) drop `&& workerOf !== claimedBy` → the self-claim case reds; (c) drop `'claimant-is-a-worker'` from the map → TS2741 in `typecheck-tests` and `coordinator-skill.test.ts` reds. Restore. Commit:

```bash
git add shared/api.ts server/src/coord/routes.ts ccd/coordinator-skill/references/wave-lifecycle.md ccd/coordinator-skill/SKILL.md server/test/run-routes.test.ts
git commit -m "feat(coord): a dispatched worker may not open a run — claimant-is-a-worker, before anything is opened (spec §12, D-3012; board-placement wave 2, Task 9)"
```

---

### Task 10: The reclaim door refuses an heir that is a live worker

**Files:**
- Modify: `shared/api.ts` (`ReclaimRefuseCode`, `RECLAIM_REFUSE_CODE_MAP` and the docstring above them, `:5322-5333`)
- Modify: `server/src/coord/reclaim.ts` (`ReclaimOutcome`, `:225-233`; `reclaimRun`, `:296-312`)
- Modify: `server/src/coord/routes.ts` (the reclaim `switch`, `:1571-1595`)
- Modify: `server/test/resume-reclaim-l0.test.ts` (`:50` and `:58` — exact-equality pins, **reds by design**, their own deviation entry)
- Test: `server/test/coord-reclaim.test.ts`, `server/test/reclaim-route.test.ts`

**Interfaces:**
- Consumes: `parentOfSession` (as Task 9).
- Produces: `ReclaimOutcome` member `{ ok: false; kind: 'heir-is-a-worker'; by: string }`; `409 {ok:false, refused:'heir-is-a-worker', by}`; `ReclaimRefuseCode` gains `'heir-is-a-worker'` — in THIS union and never in `RunRefuseCode`: `coordinator-skill.test.ts:1490-1496` forbids the coordinator corpus from naming the reclaim door at all (D-1127), and `mail-routes.test.ts`'s kebab scanner admits the token through `isReclaimRefuseCode` once it is in the map.

**D-3011, carried:** the rung sits INSIDE `if (to !== from)`, after rung 3 (the heir's registry row exists — existence-first, the ladder's own order) and before rung 4 (`measureClaimant`, the expensive tmux read). Inside the branch because D-1136 deliberately lets the operator re-type the id the board already shows as a no-op; a heir check outside it would 409 that no-op whenever the sitting claimant happens to be somebody's worker.

- [ ] **Step 1: Red — the policy**

In `server/test/coord-reclaim.test.ts`, inside the `reclaimRun` describe (the one holding `'unknown-session when the INCOMING coordinator has no registry row'`):

```ts
  it('heir-is-a-worker when the INCOMING coordinator is a live worker of another run — and NOTHING is written (spec §12, D-3011)', async () => {
    const home = mkTmp('ccrc-reclaim-');
    const s = store(home);
    const id = seedRun(s, DEAD);
    seedRow(home, DEAD); seedRow(home, LIVE);
    // LIVE is somebody else's worker on an OPEN run.
    const other = s.openRun({ program: 'other', title: 'w', project: 'demo', wave: 1, waveOf: 1, claimedBy: 'demo-other-coordinator' }) as { id: number };
    s.bindSession(other.id, LIVE);
    const w = watchCommit(s);
    const r = await reclaimRun(depsFor(home, s, GONE), id, LIVE);
    expect(r).toEqual({ ok: false, kind: 'heir-is-a-worker', by: 'demo-other-coordinator' });
    expect(w.calls).toBe(0);                      // `watchCommit` counts `reclaimProgram` calls
    expect(okRun(s.run(id))!.claimedBy).toBe(DEAD);
  });

  it('a re-typed sitting claimant stays a no-op even when that claimant is somebody\'s worker — the rung is INSIDE `to !== from` (D-1136, D-3011)', async () => {
    const home = mkTmp('ccrc-reclaim-');
    const s = store(home);
    const id = seedRun(s, DEAD);
    seedRow(home, DEAD);
    const other = s.openRun({ program: 'other', title: 'w', project: 'demo', wave: 1, waveOf: 1, claimedBy: 'demo-other-coordinator' }) as { id: number };
    s.bindSession(other.id, DEAD);
    const r = await reclaimRun(depsFor(home, s, ALIVE), id, DEAD);
    expect(r).toMatchObject({ ok: true, to: DEAD });
  });

  it('the heir rung sits AFTER the registry-existence rung — an unseeded heir is still unknown-session', async () => {
    const home = mkTmp('ccrc-reclaim-');
    const s = store(home);
    const id = seedRun(s, DEAD);
    seedRow(home, DEAD);                        // LIVE has no row AND is a worker
    const other = s.openRun({ program: 'other', title: 'w', project: 'demo', wave: 1, waveOf: 1, claimedBy: 'demo-other-coordinator' }) as { id: number };
    s.bindSession(other.id, LIVE);
    const r = await reclaimRun(depsFor(home, s, GONE), id, LIVE);
    expect(r).toEqual({ ok: false, kind: 'unknown-session' });
  });
```

`watchCommit(s)` (`coord-reclaim.test.ts:257-265`) returns `{ calls }`, counting `reclaimProgram` calls. If `openRun` needs `homeProject` in this store's generation, pass `homeProject: 'demo'`. Run: `cd server && ./node_modules/.bin/vitest run test/coord-reclaim.test.ts -t "heir"` — expected: the first FAILS (today: `ok: true`), the other two pass.

- [ ] **Step 2: Red — the route**

In `server/test/reclaim-route.test.ts`, beside `'409 claimant-alive names the holder …'`:

```ts
  it('409 heir-is-a-worker names the heir\'s own coordinator', async () => {
    const home = mkTmp('ccrc-reclaim-');
    const { run } = makeRunner();
    const w = await openApp(home, run); app = w.app;
    const id = openWave(w.coord, 1);
    seed(home, DEAD); seed(home, HEIR);
    const other = w.coord.openRun({ program: 'other', title: 'w', project: PROJECT, wave: 1, waveOf: 1, claimedBy: 'demo-other-coordinator' }) as { id: number };
    w.coord.bindSession(other.id, HEIR);
    const res = await post(app, id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, refused: 'heir-is-a-worker', by: 'demo-other-coordinator' });
  });
```

- [ ] **Step 3: Implement**

`shared/api.ts`: `export type ReclaimRefuseCode = 'claimant-alive' | 'no-claimant' | 'heir-is-a-worker';`, the map `{ 'claimant-alive': true, 'no-claimant': true, 'heir-is-a-worker': true }`, and a docstring bullet after `no-claimant`'s:

```
 *    heir-is-a-worker — the NEW claimant is the worker of somebody else's open
 *                     run (spec §12): a worker may not inherit a programme
 *                     any more than open one. 409, `by` names its coordinator.
 *                     A finished worker is not a worker; a self-claimed one is
 *                     admitted (D-3012)
```

`server/src/coord/reclaim.ts`: add `| { ok: false; kind: 'heir-is-a-worker'; by: string }` to `ReclaimOutcome` (comment: `// the NEW claimant is a live worker of another run (spec §12)`), and in `reclaimRun`, as the first statement inside `if (to !== from) {`:

```ts
    // §12 / D-3011: a worker may not inherit a programme. INSIDE this branch,
    // so an operator re-typing the id the board already shows stays the
    // no-op D-1136 made it; AFTER rung 3 (the heir's row exists) and BEFORE
    // rung 4 (the tmux measurement it would otherwise pay for). Same read and
    // same two admissions as `POST /api/runs`' rung (Task 9).
    const heirWorkerOf = deps.coord.parentOfSession(to);
    if (heirWorkerOf !== null && heirWorkerOf !== to) {
      return { ok: false, kind: 'heir-is-a-worker', by: heirWorkerOf };
    }
```

`server/src/coord/routes.ts`, in the reclaim switch, before `default`: `case 'heir-is-a-worker': return reply.code(409).send({ ok: false, refused: 'heir-is-a-worker', by: r.by });` (the `never` default makes its absence a compile error — that is the pin for this arm).

`server/test/resume-reclaim-l0.test.ts:50`: `expect(RECLAIM_REFUSE_CODES).toEqual(['claimant-alive', 'no-claimant', 'heir-is-a-worker']);` and `:58`'s `total` literal gains `'heir-is-a-worker': true`. Allocate ONE deviation number for this reds-by-design edit and define it in `## Deviations found` in this commit (the pin was built to red exactly when this union grows; the edit is the plan's, not an improvisation).

- [ ] **Step 4: Run, mutate, commit**

```bash
cd server && ./node_modules/.bin/vitest run test/coord-reclaim.test.ts test/reclaim-route.test.ts test/resume-reclaim-l0.test.ts test/mail-routes.test.ts test/coordinator-skill.test.ts test/single-definition.test.ts
```

Mutations: (a) delete the rung → the first policy case and the route case red; (b) move the rung ABOVE `if (to !== from)` → the re-type case reds; (c) move it ABOVE rung 3 → the ordering case reds. Restore. Commit:

```bash
git add shared/api.ts server/src/coord/reclaim.ts server/src/coord/routes.ts server/test/resume-reclaim-l0.test.ts server/test/coord-reclaim.test.ts server/test/reclaim-route.test.ts docs/superpowers/plans/2026-09-18-board-placement-wave2-board.md
git commit -m "feat(coord): the reclaim door refuses an heir that is a live worker — heir-is-a-worker, inside the successor branch (spec §12, D-3011; board-placement wave 2, Task 10)"
```

---

### Task 11: The words — README and the ledger

**Files:**
- Modify: `README.md` (`:1770-1778`, the paragraph "**The board says which repo.**"; a new short paragraph after the two-refusals list at `:1693-1712`)
- Modify: this plan's `## Deviations found` (final reconcile)

- [ ] **Step 1: README — the board**

Replace the sentence run from `On the fleet board a worker stays on its own project's card` through `("\`<program>\` wave 2/3 in \`<other project>\`").` with:

```
On the fleet board a coordinated workspace renders on its COORDINATOR's card,
bracketed under it, whatever repo it works in (spec 2026-09-16, restoring the
Aug-11 rule the Sep-08 spec had silently reversed): the placement is a server
decision (`FleetSession.boardProject`, keyed on the newest run naming the
session and walked to the root coordinator, held while the workspace is
held), and the run follows the row so the bracket, the orphan marker and the
held cell's `/runs` door all stay on the card the row is on. A row whose repo
differs from its card's carries the repo slug inside its name; the session
view shows the slug whenever it is known. The project's own card stays on the
board with nothing on it and says `N workspaces under <project>` — text, never
a link. When a coordinator is NOT on the card (archived, or on another
card the placement could not reach), the row stays flat with the marker
`<program> wave n/N`, `· home <project>` appended only when the measured home
differs, and the marker says when the coordinator is measured gone. The home
project's card gains an `abroad` line, one sentence per wave working
elsewhere ("`<program>` wave 2/3 in `<other project>`"), minus any wave whose
worker already renders on that card.
```

- [ ] **Step 2: README — the door**

After the `home-mismatch` bullet's paragraph (before `**What a crossing costs.**` at `~:1780`), add:

```
**A third refusal guards the tree's depth.** `claimant-is-a-worker` — **409**,
`{"ok":false,"refused":"claimant-is-a-worker","by":"<that worker's coordinator>"}`
— fires at `POST /api/runs` when `claimedBy` is itself the worker of an open
run, and `heir-is-a-worker` fires the same way at `POST /api/runs/:id/reclaim`
for a successor. A session that is another coordinator's worker on any open run
may not open or inherit a programme: the board brackets ONE level, and a real
chain would render its middle session detached from the coordinator above it.
EVERY open run naming that session is read, not just the newest one — a session
can be the worker of several at once, because the coordinator protocol opens
wave N+1 before closing wave N. Three admissions, not two. A finished worker is
not a worker; a self-claimed run is admitted (the plan's ruling D-3012; spec
2026-09-16 §12 for the door itself); and at the RECLAIM door only, an heir every
one of whose open runs is claimed by the claimant being replaced may inherit —
the programme's own live worker is the likeliest successor to a dead coordinator,
and the run it takes over is self-claimed, which the board never brackets, so the
one level stays honest. An heir a THIRD coordinator's open run still binds is
refused however new the dying coordinator's own binding is, and a claimant that
measures alive is still refused ahead of any of this.
```

- [ ] **Step 3: Commit**

```bash
cd server && ./node_modules/.bin/vitest run test/readme*.test.ts test/single-definition.test.ts 2>/dev/null || true   # only if such a suite exists
git add README.md
git commit -m "docs(readme): the board's placement rule and the door that keeps its one level honest (board-placement wave 2, Task 11)"
```

## Whole-wave gate

- [ ] `cd pwa && ./node_modules/.bin/vitest run` and `cd agent && ./node_modules/.bin/vitest run`.
- [ ] Server suite, **sharded** (the union is the whole list):

```bash
cd server && ./node_modules/.bin/vitest run --shard=1/3
cd server && ./node_modules/.bin/vitest run --shard=2/3
cd server && ./node_modules/.bin/vitest run --shard=5/6
cd server && ./node_modules/.bin/vitest run --shard=6/6
```

- [ ] **The cross-package pair, by name, once more:** `cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts test/resume-reclaim-l0.test.ts test/coordinator-skill.test.ts test/deviation-refs.test.ts` — the last after `git fetch origin main` (it compares this branch's D-numbers against `origin/main`'s without merging).
- [ ] Re-run the known load flakes **in isolation** before calling any a real break: `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`, `ccd-bounded-reads`.
- [ ] `git diff --name-only origin/main...HEAD | grep '^ccd/'` — expect ONLY `ccd/coordinator-skill/SKILL.md` and `ccd/coordinator-skill/references/wave-lifecycle.md`. That makes the wave **AGENT-FIRST** by `CLAUDE.md`'s rule (the skill installs from the agent lane). Neither lane is deployed by this plan; the operator's act, in this order: read `ccd version` on the fleet host and `/health` on the server box over ssh first (`ccrc-deploy-topology`), agent lane, then server lane. The server lane carries wave 1 (`2985b9d1`, a `coord.db` migration to `user_version` 12) AND this wave together; nothing renders until it lands.
- [ ] The plan renders on the operator's docserver at `?ref=<this branch>` (the link convention lives in the operator's global CLAUDE.md, never in this tree) — verify by grepping the response for this plan's own title, never by status code.

## Plan-level rulings (issued 2026-09-18, six numbers, floor now 3014)

Issued by `POST /api/ledger/deviations` to this plan's author at plan-writing time and DEFINED here in the same act. These are decisions where the spec is silent or its letter cannot be built as written; each is cited from the task that carries it.

- **D-3008 — `nestFleet` gains an ordering key, and §1's "untouched" is reconciled.** Spec §1 says the bracket appears "with `nestFleet` untouched"; §6 requires "one comparator ahead of `programOrder`, scoped to siblings". Both hold of Task 5's edit: the five bracketing rules, the header comment and `RowDepth` are unmodified; `attentionFirst` is an additive key inside rule 2's ordering, and it is per-sibling by construction because the settled list is sorted once and handed out per parent while the top level is never re-sorted. The docstring sentence "the only comparator in this file" is corrected in the same commit.
- **D-3009 — "one tap from the reclaim door" is the door that exists.** Spec §7 promises the orphaned row is one tap from reclaim. The tree has no per-run route: `openRunFor` navigates to `/runs` unfocused and reclaim is that board's own act. Task 8 adds no tap surface (the marker stays the sibling `div` `project-card.test.tsx:1017-1037` pins); the row's held cell — kept alive for a moved row by Task 4's routing — IS the tap, and the marker now says, off `coordPresence` (the runs board's own three-answer read, threaded fleet-wide with `fleetFrameSeen`), when the coordinator is measured gone.
- **D-3010 — the card set, its order, and `pin`'s third state.** Spec §6 is silent on order and on an empty card's chips. Ruled: cards are the UNION of the known project list, every session's rendered card and every session's own project, deduped by name (`listProjects` keys by workdir and can emit two rows with one name); populated cards keep `sortFleet`'s urgency order; zero-row cards follow in list order; `groupFleet`'s project-list parameter is REQUIRED (an optional fallback is an overloaded seam). `FleetGroup.pin` becomes `{shared, home} | {mixed} | {empty}` because today's `forPin[0]!.home` THROWS on an empty group and `null` already means "they disagree", which zero sessions do not; the chip renders nothing on `empty`. Before `/api/projects` lands, cards are session-derived and the set only grows when it does — R5 is a property of a known list, and the list is not hydrated (stated residual: the first paint after a cold start can gain cards a second later).
- **D-3011 — the heir rung's placement.** Spec §12 names `heir-is-a-worker` and not where it sits. Ruled: inside `if (to !== from)`, after the heir's registry-existence rung and before `measureClaimant`. Inside the branch so the operator's re-type of the sitting claimant stays the no-op D-1136 made it; existence-first because that is the ladder's own argument; before the tmux read because it is synchronous and cheaper.
- **D-3012 — what `claimant-is-a-worker` admits.** Spec §12 says "the `sessionId` of a non-terminal run". `parentOfSession` answers the CLAIMANT of that run, so a self-claimed run would refuse its own coordinator with `by` naming itself, and an ownerless open run (a reconstructed row, `claimedBy` NULL) answers `null`. Ruled: self-claim is excluded (`workerOf !== claimedBy`, the read's other caller's own guard) and an ownerless run is ADMITTED — there is no `by` to name, and `by` is what this refusal is for. Both are pinned by name. Scope is every non-terminal state, wider than the word "dispatched", and said so.
- **D-3013 — the session view's label depends on a read the session view does not make.** R3's "unconditional" means "not conditioned on card context". The rows come from `/api/projects`, one agent round trip per project, fetched by the fleet screen only; Task 7 lifts the last successful read into the fleet store (not persisted, `pools`' reason) and the session view reads it there. On a deep link before the fleet screen has ever fetched, the label renders nothing. Not a fetch from the session view: that would double the per-project round trips on the screen opened most.

## Deviations found

Numbers here are ISSUED at the moment of the departure (`ccrc-api ledger allocate`), never taken from a floor and never pre-minted. Add each as `- **D-<n> — <title>.** <what departed, why, what shipped instead>`.

- **D-3024 — Task 10: `resume-reclaim-l0.test.ts` exact-equality pins updated for `heir-is-a-worker`.** `RECLAIM_REFUSE_CODES` and `resume-reclaim-l0.test.ts`'s `total` literal were both built to red the moment `ReclaimRefuseCode` gains a member — Task 10 is exactly that growth. Both pins (`:50`, `:58`) updated to include `'heir-is-a-worker'` in the same commit as the union/map edit that reddened them; the edit is the plan's own reds-by-design mechanism firing, not an improvisation on top of it.
- **D-3026 — Task 10 fix round 1: `ResumeSheet` learns `heir-is-a-worker`.** What departed: Tasks 9–10 scoped the door slice server-only, so the only operator surface for the reclaim door (`pwa/src/fleet/ResumeSheet.tsx`) kept a hand-written `RECLAIM_COPY` union and a `reclaimErrorText` 409 branch that only knew `no-claimant`/`claimant-alive` — `heir-is-a-worker` fell through to `RECLAIM_COPY.unknown` and `by` never reached the operator, an L4 adapter narrowing a distinction it received. Why: shipping a refusal the console renders as "does not recognise" violates the ring rule even though the plan never scoped the console. What shipped instead: a `'heir-is-a-worker'` entry in `RECLAIM_COPY` and a 409 branch mirroring `claimant-alive`'s shape (a condition sentence, `by` appended the same way `detail` is), plus a `resume-sheet.test.tsx` case pinning that both the sentence and `by` render and the fallback never fires.
- **D-3028 — the reclaim door ADMITS the dead claimant's own worker as heir.** What departed: Task 10's heir rung mirrored the open door's predicate exactly (`heirWorkerOf !== null && heirWorkerOf !== to`, D-3011/D-3012), and `parentOfSession(to)` answers the CLAIMANT of the heir's newest open run — which on a dead-coordinator programme is `from`, the very claimant being replaced. So the rung refused the programme's OWN live worker: the likeliest successor in the one scenario the reclaim door exists for. Why: a door whose whole purpose is rescuing a programme from a corpse must not refuse the session sitting beside it; the two doors ask the same read but not the same question — the open door has no `from`. What shipped: the predicate gains `&& heirWorkerOf !== from`, so an heir whose only coordinator IS the outgoing claimant is admitted. The run that results is SELF-CLAIMED, which the open door already admits (D-3012) and which `nestFleet` never brackets (`r.claimedBy !== r.sessionId`), so §12's one-level rationale is untouched and no chain can form out of it; a worker of somebody ELSE's open run is still refused, and rung 4 still refuses a `from` that measures alive. Pinned by a new `coord-reclaim.test.ts` case (RED when `&& heirWorkerOf !== from` is dropped, measured) beside the existing refusal case (RED when the rung is deleted, measured). The same exception is written into `shared/api.ts`'s `heir-is-a-worker` bullet, spec §12's reclaim sentence, README's door paragraph and `ResumeSheet`'s copy. **Second fix round, D-3054:** the READ this entry argues over was widened, because "no chain can form out of it" was a claim the one-row read could not make. `parentOfSession` is `LIMIT 1`, so every sentence above was measured against the heir's NEWEST open run alone — an heir that is a THIRD coordinator's live worker on an older open run and the dying coordinator's on a newer one was ADMITTED by the `!== from` arm, still bound to that third coordinator, which is exactly the chain §12 exists to prevent. The predicate now reads every open claimant of the heir (`openClaimantsOf`) and refuses any that is neither `to` nor `from`, so this entry's own sentence is now what the code proves rather than what it hoped.
- **D-3029 — a pending spawn routes by its COORDINATOR's card, not by the wave's project.** What departed: Task 4's ruled predicate gave `runCard`'s null-session arm a flat fallback to `run.project`, and the plan's own mutation note (d) recorded that arm as unpinnable by return value. Measured on a CROSS-REPO wave that is exactly this programme's subject, the arm is wrong: a coordinator on card A opening a wave in project B puts the phantom on card B at depth 0 as an orphan spawn, and the row then JUMPS to card A the moment the worker binds — a row moving between cards as a side effect of a dispatch completing, which is spec §1's own complaint one rung down. Why the fix is not a wider one: the phantom is ABOUT its coordinator (nothing else about it exists yet), so asking `cardOf` for `run.claimedBy` is the same question the bound arm asks about `run.sessionId`, not a new rule. What shipped: `run.sessionId === null ? (run.claimedBy === null ? run.project : cardOf.get(run.claimedBy) ?? run.project) : (cardOf.get(run.sessionId) ?? run.project)`, the parameter type widened by `claimedBy: string | null`, and `run.project` demoted to the LAST answer — taken only when nothing routable exists (an ownerless reconstructed row, or a claimant the fleet list does not carry this pass). The bound arm deliberately does NOT fall back to the coordinator: a bound run is about its worker, and an edge to a row the board cannot see is worse than a flat row. Pinned by three new/changed `runCard.test.ts` cases and by a `fleet-screen.test.tsx` case that is now TWO-CARD — one card cannot tell the two rules apart, which is why the old fixture (`project: 'alpha'`, coordinator on alpha) was blind to this. Reverting the null arm to `run.project` reds both (measured, 2 failed | 90 passed).
- **D-3054 — both §12 doors read EVERY open claimant of a session, not the newest one.** What departed: Tasks 9 and 10 both built their rung on `CoordStore.parentOfSession`, which the plan named ("both off the store's existing `parentOfSession` read") and which the spec named too — and that read is `ORDER BY id DESC LIMIT 1`. It answers about ONE run, so both doors' prose claimed a guarantee the code did not give: `shared/api.ts`'s bullets, spec §12, README's door paragraph, D-3028's "no chain can form out of it" and `reclaim.ts`'s rung comment all speak of "its ONE coordinator" / "the worker of any open run", while `runs_by_session` is a NON-UNIQUE index and two shipped paths put several open runs on one session (the coordinator protocol opens wave N+1 before closing wave N; a session can also be a second programme's worker). Two admissions followed: at the reclaim door, an heir that is X's live worker on open run 100 and the dying coordinator's on newer run 105 passed the `!== from` arm while still bound to X — the chain §12 exists to prevent; at the open door, a session self-claimed on its newest run and still X's worker on an older open one passed the self-claim admission. Why widen the read rather than soften the prose (controller's ruling): the sentences are the design — the one-level bracket is only honest if the chain cannot form — so the guarantee is what must be made true. What shipped: ONE new store read, `CoordStore.openClaimantsOf(sessionId): string[]` — the DISTINCT non-null `claimedBy` of every non-terminal run naming the session, newest first, beside `parentOfSession` and leaving it untouched because the ask lane's question really is about the newest run. Both rungs now take the first claimant that is not admitted (`!== claimedBy` at the open door; `!== to && !== from` at the reclaim door) and `by` names it, so `by` is the newest offender. D-3012's admissions are unchanged and one of them moved INTO the read: an ownerless row contributes no entry at all (`claimedBy IS NOT NULL` in the query), and `[]` is a finished worker. Pinned by four `coord-store.test.ts` cases on the read itself and by one new case at each door (`run-routes.test.ts`: self-claimed newest + somebody's worker on an older open run → 409 `by` that somebody; `coord-reclaim.test.ts`: `demo-other-coordinator`'s worker on the older run, DEAD's on the newer → `heir-is-a-worker`). Both measured RED against a temporary revert to `parentOfSession` and green after restore (1 failed | 12 passed, and 1 failed | 29 passed), with every pre-existing case of both doors still green in the same run. All five prose sites were corrected to say exactly what the widened read proves.


## Follow-ons, recorded and not built

- **A ccd-side refusal of `ws-add` from a held worker's pane** (spec §12's last paragraph). The lifecycle journal already measures the caller's cgroup (`obs.cg`); the door is buildable and has been walked zero times in 75 creations. Touches `ccd/ccd` (generated, re-stamped) and is agent-first. Its own plan.
- **A hydrated project list**, if the cold-start card gain (D-3010's residual) is ever visible in practice: a `FleetSnapshot.projects` field with the same "stale is honest" argument `sessions` carries, and D-3013's session-view residual closes with it.
- **The three readers of "which run is this session's"** — `runForSession` (highest id), `nestFleet`'s dedupe (first in programme order), the server's stamp (newest run) — can disagree for a session that is a worker of one run and the reviewer of a later one. Review runs always spawn fresh (`sessionId` is refused on a review open), so the collision needs a reviewer workspace later reused as a worker. Stated; not pinned; not built.

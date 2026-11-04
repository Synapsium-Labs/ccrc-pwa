# Delegation visibility (first release) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the fleet console say only what the delegation broker recorded (no row, chip or title says "running") and make every recorded delegation entry reachable from a row, the session header or a region at the foot of the fleet list. This is a change to the PWA only.

**Architecture:** The words, the per-liveness qualifier table and the entry list's rows are decided once in the L1 words module (`pwa/src/fleet/delegationWords.ts`). Placement stays in `nestFleet`/`fleetTree`, and the one selection of unlisted entries is `fleetTree#unplacedActivities`. The card and header facts and the card-within-header rule stay in `sessionFacts`. The L4 components (`SessionMeta`, `SessionDetails`, `ProjectCard`, `FleetCards`, `SessionScreen`, and a new shared `WorkLine`) only draw what those modules decide. Two of them are not in spec §3's owner table and join the L4 drawing owners here: `SessionDetails.tsx` holds the header disclosure's open state beside the subagent list it already owns, and `WorkLine.tsx` is the one spelling of a row's markup for the card, the region and the header. Neither names a broker word in code (their words arrive from `sessionFacts` and the words module), so the closed scope census's `W4_PWA_FILES` stays unchanged. No server, wire, durable-format, timer or storage change ships, and `shared/api.ts` changes in two comments only.

**Tech Stack:** TypeScript ESM; the React 19 PWA on `@ccrc/ui` tokens; Vitest with Testing Library on jsdom; Node.js `>=22.16.0`.

**Spec:** `docs/superpowers/specs/2026-11-02-delegation-visibility-design.md` (all sections; acceptance in §9). The operator agreed the staged delivery on 2026-11-02 and approved this plan together with the spec on 2026-11-04. The coordinator ruled the two departures from the wave-4 rules this release needs (D-7781, D-7782, below).

**Shape:** one pull request by one worker, four tasks in order. Every task's commit is green on its own: the tests that task names pass, and the PWA typecheck passes.

## Global Constraints

- **Public repository.** Code, fixtures, commit messages, the branch name, the PR body and comments are public. Use neutral stand-ins (`project-a`, `coord-a`, `worker-a`, `lane-a`, `the fleet box`). Write no private project, host, address, absolute home path, account or lane name, person's name, private repository, docserver link or private tracker ID. Refer to ccrc work by its GitHub `#n`. Scan the diff and the PR body for these before every push and before posting.
- **Node floor.** `>=22.16.0`, unchanged: no `engines` edit.
- **Rings.** L0 `shared/api.ts`: comments only, and it imports nothing. L1 (decide, no I/O): `delegationWords.ts`, `fleetTree.ts`, `nestFleet.ts`, `sessionFacts.ts`. L4 (draw, never decide): `WorkLine.tsx`, `SessionMeta.tsx`, `SessionDetails.tsx`, `ProjectCard.tsx`, `FleetCards.tsx`, `SessionScreen.tsx`. `delegationWords.ts` imports only `shared/api` and `lib/wire`, and never `./fleetTree` or `./nestFleet` (both import from it).
- **No wire change.** `FLEET_PROTO` and `FLEET_PROTO_MIN` stay 1. There is no new frame, field, `FleetSession` key or `reviveFleetSession` change. The store's `delegation` slot is read as it is.
- **Copy lives once.** Every new visible string and title is defined in `delegationWords.ts`. No exported string there contains `running`, nor any stem W4-U10 forbids (`lease`, `adopt`, `retain`, `clean`, `spool`). Never show `N active`, `N running`, `N recent`, `0 recent`, "no recent news", "couldn't check" or "check deferred".
- **Closed scope census.** `server/test/delegation-wave3.integration.test.ts` §8 (`W4_PWA_FILES`) and its mirror in `server/test/fleet-health.test.ts` stay unchanged. Code that names `delegation` (the census regex is `/delegation/i`, comments stripped) or `lease` goes only into files already on that list. `WorkLine.tsx` and `SessionDetails.tsx` are not on it, so their code never names either word: they use `delegated…` identifiers and receive their words from `sessionFacts`. New class names avoid the stems (`delegat`, `lease`, `spool`, `carrier`, `adopt`, `retain`, `dispos`, `cleanup`). If a file must join the list after all, add it to both tests in this PR and record the reason in the note.
- **No new storage owner.** The header's entry disclosure and the fleet foot's region keep transient React state (`useState`). No `localStorage` key and no `foldState` key are added, and `pwa/test/w7-storage-keys.test.ts` and `server/test/census-w7/pwa.test.ts` stay green unedited.
- **CSS.** Two new rules, and no existing rule changes. `.chat-facts .sess-entries { flex-basis: 100%; min-width: 0; }` in `pwa/src/session/chat.css` (Task 2) and `.fleet-unlisted { min-width: 0; }` in `pwa/src/fleet/fleet.css` (Task 3). Each is the floor `.proj-card` already carries: the region is a grid item of `.fleet-list` (`display: grid`) and the header list a flex item of `.chat-facts`, so without `min-width: 0` one long row (`.proj-work-parts` is `white-space: nowrap`) widens its track and scrolls the pane sideways. Both are pinned in `pwa/test/fleet-css.test.ts` (VIS-CSS1, VIS-CSS2) and, for the region, in `pwa/browser/delegation-rows.browser.test.ts` at 390. Tokens only, and no edit to `ui/src/styles/tokens.css`.
- **Older server, byte for byte.** With no frame, the screen renders what it renders today (W4-U27, `pwa/test/older-server-render.test.tsx`). Nothing new mounts without entries, and no component that the older-server world renders gains a `useId` call (React's client id counter would renumber later ids).
- **Tests.** Run from inside the package as `ccrc test -- ./node_modules/.bin/vitest run test/<file>`, one file per run, in the foreground, with a tool timeout of at least 600000 ms. Never bare `npx vitest`, and never your own `systemd-run`. A known load flake (repo `CLAUDE.md`) is re-run alone before you call it a break.
- **Typecheck.** `cd pwa && ccrc test -- ./node_modules/.bin/tsc --noEmit` (the typecheck half of `pwa/package.json`'s `build` script).
- **Fixture data only.** These are pure PWA tests on fixture builders (`pwa/test/delegationFixture.ts`, `pwa/test/fleetFixture.ts`). Never run `ccd`, and never read `~/.ccrc`, `~/.cc-secrets`, `~/.cc-sessions`, `coord.db`, any delegation spool, journal or checkpoint, or a transcript.
- **Branch.** Commit on this workspace's own branch, cut from `main`. One PR, never a separate feature branch. To take a newer `main`, merge it in: never rebase, never `update-branch`.
- **Ledger route.** No commit edits an existing file under `docs/superpowers/plans/` or `docs/superpowers/programs/` (`.github/ci/ledger-guard.mjs`). A departure from this plan goes in a NEW note, `docs/superpowers/plans/2026-11-02-delegation-visibility/pr.md`, and is mailed to the coordinator.
- **D-numbers.** D-7781 and D-7782 are the coordinator's rulings, defined below. Code comments cite them where the rule is implemented. This plan reaches `main` before dispatch, so `server/test/deviation-refs.test.ts` finds them defined. The worker's spare numbers are listed in "Deviations found".
- **Mutation discipline.** Every new guard ships with a test that goes red when the guard is mutated. Measure it: save a copy and its sha, apply one mutant, run the named test file, then restore from the copy and check the sha (`sha256sum -c`). Never restore with `git checkout`. One mutant at a time (Task 4).
- **Citations.** Cite code as `path#symbol` or `path#@anchor`, never `path:line`.
- **Claims and mail.** Claim each task's files before its first edit. List mail before every push and before the wave-done report.

## Review Focus

Five input classes the tests could miss. Each is pinned by a test added in its owning task.

1. **A dead or restarted parent.** Its entries read `stop not seen`, never `not confirmed` or `running`, and its row keeps its chip. Pinned by Task 1's VIS-W1 (the words for each liveness) and W4-U8 (every liveness counts), and Task 2's W4-U34 (a dead row keeps its chip). Mutants VIS-M1, VIS-M2 and VIS-M9.
2. **A parent gone from the fleet list, against one that is listed but archived or released.** The first goes to the fleet foot's region. The second stays in its card's offline group with `from <its label>`, and is never in the region. Pinned by Task 3's VIS-T1, VIS-U1, VIS-U3 and VIS-P1. Mutants VIS-M3, VIS-M5 and VIS-M6.
3. **An older server, a withdrawn frame, a reconnect, an unchanged frame re-sent, and a parent that leaves the fleet.** With no frame, or a withdrawn one, nothing draws a chip, a header list or a region. A reconnect clears the store's slot before any new frame (W4-U3, `stores.test.ts`, unchanged), so the screen then draws what VIS-U2's withdrawn case draws. An unchanged frame re-sent changes no word and no banner, and a parent that leaves the fleet list takes its entries from its card into the region. Pinned by Task 3's VIS-U2 (no region for zero entries, a withdrawn frame or an unavailable one), VIS-U4 (the re-sent frame and the departing parent) and W4-U27, which stays byte for byte green unedited (Task 4).
4. **A newer server's word.** An unknown liveness is re-filed `unmeasured` by `readDelegation`, and a line handed one directly reads `unmeasured` too (`qualifierOf`'s own fallback); neither is drawn as `not confirmed` or `running`. Pinned by Task 1's VIS-W1 (its two future-word cases) and W4-U7c in `fleet-screen.test.tsx`. Mutant VIS-M10.
5. **A session with attached and row-placed entries.** The header counts more than the card, the superset rule holds by count (and refuses a fact with no count), and each entry appears in the header list exactly once. Pinned by Task 2's VIS-C1, VIS-H1 and VIS-S1 (the real `SessionScreen` wiring). Mutants VIS-M4, VIS-M7, VIS-M8, VIS-M11 and VIS-M13.

## Deviations found

The allocator issued D-7781 and D-7782 for the coordinator's rulings, both defined here, and four further numbers for the worker.

- **D-7781** — `chip-counts-every-attached-entry-on-live-and-dead-rows` (coordinator ruling 2026-11-02; spec §5, §8 "Chip population"). A session's `N delegated` chip counts every attached entry it is handed, of every liveness (`live`, `stale`, `unmeasured`), on live and dead rows alike. This reverses wave 4 PR2's live-only chip (`delegatedChip`, pinned by W4-U8 and W4-U33) and W4-U34's "a dead worker carries no chip". The chip keeps the noun `delegated`, which claims no execution, and its title says the count is of recorded entries, not current agents. Implemented by Task 1 (`delegationWords.ts#delegatedChip`) and Task 2 (the dead shortcut in `sessionFacts.ts#sessionFacts` removed).
- **D-7782** — `card-within-header-compares-delegated-by-count` (coordinator ruling 2026-11-02; spec §5 "Header superset, by count"; amends D-5545's prefix rule for one key). `sessionFacts.ts#cardWithinHeader` compares the `delegated` fact by count, not by text prefix: the header's count (every entry the session started) must be at least the card's (its attached entries). Every other key keeps the prefix rule. Without this, the prefix rule reports a missing fact whenever a session has both attached and row-placed entries, because `3 delegated` does not begin with `1 delegated`. Implemented by Task 2.
- 7783 to 7786, the worker's, spare until a departure takes one. Take them in order and only for an actual departure from this plan, defined in the note `docs/superpowers/plans/2026-11-02-delegation-visibility/pr.md`. Never write a number that was not issued.

---

## Task 1: Words — the qualifier table, honest row parts and titles, the chip's copy, and one name that does not say live

**Files:**
- Modify: `pwa/src/fleet/delegationWords.ts` (whole file below).
- Modify: `pwa/src/fleet/nestFleet.ts`: import `byOpened` from the words module, and delete the local copy.
- Modify: `pwa/src/screens/SessionScreen.tsx`: the rename `liveActivitiesOf` → `activitiesStartedBy` (import and call).
- Modify: `shared/api.ts`: two comments (`DelegationLiveness`, `DelegationActivityWire.upstreamId`).
- Test: `pwa/test/delegation-words.test.ts`, `pwa/test/card-header-facts.test.tsx`, `pwa/test/fleet-screen.test.tsx`.

**Interfaces.**
- Consumes: `shared/api` `DelegationActivityWire`, `DelegationLeaseWire`, `DelegationLiveness`, `DelegationProjectionWire`, `DELEGATION_LIVENESS`; `lib/wire#isRecord`.
- Produces (exact; consumed by Tasks 2 and 3):
  ```ts
  export const LIVENESS_QUALIFIER: Readonly<Record<DelegationLiveness, { readonly word: string; readonly title: string }>>;
  export const ENTRIES_NOTE: string;
  export const UNLISTED_WORDS: { readonly label: string; readonly title: string };
  export function unlistedToggle(n: number): string;
  export function fromPart(label: string): string;
  export const byOpened: (a: DelegationActivityWire, b: DelegationActivityWire) => number;
  export interface EntryRow { readonly key: string; readonly parts: readonly string[]; readonly title: string }
  export interface DelegatedSummary extends Chip { readonly count: number; readonly note: string; readonly rows: readonly EntryRow[] }
  export function activityLine(a: DelegationActivityWire, fromLabel?: string | null): { parts: readonly string[]; title: string };
  export function worktreeLine(l: DelegationLeaseWire, viaLabel: string | null, sourceProject: string | null, fromLabel?: string | null): { parts: readonly string[]; title: string; sourceProject: string | null };
  export function delegatedChip(activities: readonly DelegationActivityWire[]): DelegatedSummary | null;
  export function activitiesStartedBy(id: string, w: DelegationProjectionWire): readonly DelegationActivityWire[];
  ```
- Removed: `LIVENESS_WORD` (replaced by `LIVENESS_QUALIFIER`) and `liveActivitiesOf` (renamed `activitiesStartedBy`). Their only readers are this module, `SessionScreen.tsx` and `delegation-words.test.ts`.
- Visible copy changed beside the qualifier table, by design:
  - `GROUP_WORDS['offline-coordinator'].title` loses its "running". Old: `'work whose session is not running as the one that started it, or is not on this card'`. New: `'work whose session is no longer the one that started it, or is not on this card'`. VIS-W1 collects every exported string, so the old title would red it. No test pins this title's text today.
  - A liveness this build cannot name, handed to `activityLine` or `worktreeLine` directly, now reads `unmeasured` (`qualifierOf`'s fallback, as `readDelegation` re-files it). Before, `wordOf(LIVENESS_WORD, …)` drew `unrecognised`. VIS-W1's direct case pins the new word.

**Pins changed by design in this task.**
- `delegation-words.test.ts` W4-U8. Old: `expect(chip.title).toContain('map the tree');` … `expect(delegatedChip([...two, activity({ activityId: 'a3', liveness: 'stale' }), activity({ activityId: 'a4', liveness: 'unmeasured' })])!.text).toBe('2 delegated');` and `expect(delegatedChip([activity({ liveness: 'stale' }), activity({ liveness: 'unmeasured' })])).toBeNull();`. New: Step 1's W4-U8 (every liveness counts; the title is the recorded-entries sentence).
- `delegation-words.test.ts` W4-U9. Old: `expect(plain.title).toBe(l.canonicalPath);`. New: ``expect(plain.title).toBe(`${l.canonicalPath}; ${LIVENESS_QUALIFIER.live.title}`);``.
- `delegation-words.test.ts` W4-U10. Old: `expect(Object.keys(LIVENESS_WORD).sort()).toEqual([...DELEGATION_LIVENESS].sort());`. New: `expect(Object.keys(LIVENESS_QUALIFIER).sort()).toEqual([...DELEGATION_LIVENESS].sort());`.
- `delegation-words.test.ts` "liveActivitiesOf selects every activity a session started, whatever its placement". Becomes VIS-W3 on `activitiesStartedBy`, with a stale entry added.
- `card-header-facts.test.tsx` W4-U33. Old: `expect(card.delegated?.title).toContain('map the tree');` and `expect(cardFacts(sessionFacts({ session: worker, now: NOW, delegated: [activity({ liveness: 'stale' })] })).delegated).toBeNull();`. New: `expect(card.delegated?.title).toBe('2 recorded delegation entries, not a current agent count; execution not confirmed');` and `expect(cardFacts(sessionFacts({ session: worker, now: NOW, delegated: [activity({ liveness: 'stale' })] })).delegated?.text).toBe('1 delegated');`. The comment above that second assertion, `// Only live work counts: a stale or unmeasured activity is no chip.`, becomes `// Every attached entry counts, of every liveness (D-7781): a stale one is a chip too.`.
- `card-header-facts.test.tsx` W4-U35. Old: `expect(chip?.getAttribute('title')).toContain('read the plan');`. New: `expect(chip?.getAttribute('title')).toBe('2 recorded delegation entries, not a current agent count; execution not confirmed');`. Its title `'W4-U35: the row draws the chip when handed live work, and is byte-identical without it'` becomes `'W4-U35: the row draws the chip when handed attached entries, and is byte-identical without it'`.
- `card-header-facts.test.tsx`, the R9 describe. Its title `'the R9 chip: a worker\'s live delegated work (delegation broker wave 4)'` becomes `'the R9 chip: a worker\'s attached delegation entries (delegation broker wave 4; D-7781)'`, and the two comment lines above it become `// Delegation broker wave 4, PR2 Task 2.8, and delegation visibility: a programme worker's attached delegation entries` / `// are ONE chip on its row (R9), every liveness counted (D-7781); the session header lists every entry it started.`. Only comments and titles change here; the assertions are the ones named above.
- `fleet-screen.test.tsx` W4-U7c. Old rows `['agent worktree', 'agent-a2', 'running', 'unmeasured']` and `['agent', 'regroup', 'running']`. New: `['agent worktree', 'agent-a2', 'not confirmed', 'unmeasured']` and `['agent', 'regroup', 'not confirmed']`. Task 3 changes this pin again. W4-U7c also gains a scan of the drawn titles (spec §9, "No running claim"): after `expect(card().textContent).not.toContain('unrecognised');` add
  ```ts
    // No delegation row, toggle or chip says running in its title either: the page's titles, read off the DOM.
    const titles = [...card().querySelectorAll('.proj-work[title], .proj-group-toggle[title], .proj-children-toggle[title], .sess-meta-chip[title]')]
      .map((e) => e.getAttribute('title') ?? '');
    expect(titles.length).toBeGreaterThan(0);
    for (const t of titles) expect(t, t).not.toMatch(/running/i);
  ```

- [ ] **Step 1: Write the failing tests** in `pwa/test/delegation-words.test.ts`.

  Replace the two import statements from `../../shared/api` and `../src/fleet/delegationWords` (top of file) with:

  ```ts
  import {
    DELEGATION_ACTIVITY_PLACEMENTS, DELEGATION_LEASE_SOURCE_KINDS, DELEGATION_LIVENESS, DELEGATION_ROW_GROUPS,
    DELEGATION_WORKSPACE_STATES, type DelegationActivityWire, type DelegationLeaseWire,
  } from '../../shared/api';
  import * as words from '../src/fleet/delegationWords';
  import {
    ACTIVITY_WORD, ENTRIES_NOTE, GROUP_WORDS, LIVENESS_QUALIFIER, UNRECOGNISED_WORD, VERDICT_WORD, WORKSPACE_WORD,
    WORKTREE_WORD, activitiesStartedBy, activityLine, creatorChip, delegatedChip, delegationParts, fromPart, inferredChip,
    readDelegation, unlistedToggle, worktreeLine,
  } from '../src/fleet/delegationWords';
  ```

  Replace the whole `it('W4-U8: …')` block with:

  ```ts
  it('W4-U8 (D-7781): the chip counts every entry of every liveness, says none is confirmed, and is null with none', () => {
    const three = [
      activity({ activityId: 'a3', displayName: 'check the build', liveness: 'unmeasured', openedAt: '2026-10-26T10:02:00.000Z' }),
      activity({ activityId: 'a1', displayName: 'map the tree' }),
      activity({ activityId: 'a2', displayName: null, liveness: 'stale', openedAt: '2026-10-26T10:01:00.000Z' }),
    ];
    const chip = delegatedChip(three)!;
    expect(chip.text).toBe('3 delegated');
    expect(chip.count).toBe(3);
    expect(chip.title).toBe('3 recorded delegation entries, not a current agent count; execution not confirmed');
    expect(chip.note).toBe(ENTRIES_NOTE);
    expect(chip.rows.map((r) => r.key)).toEqual(['a1', 'a2', 'a3']);
    expect(chip.rows.map((r) => r.parts)).toEqual([
      ['agent', 'map the tree', 'not confirmed'], ['agent', 'stop not seen'], ['agent', 'check the build', 'unmeasured'],
    ]);
    expect(delegatedChip([activity({ liveness: 'stale' })])!.title)
      .toBe('1 recorded delegation entry, not a current agent count; execution not confirmed');
    expect(delegatedChip([])).toBeNull();
  });
  ```

  In `it('W4-U9: …')` replace `expect(plain.title).toBe(l.canonicalPath);` with:

  ```ts
  expect(plain.title).toBe(`${l.canonicalPath}; ${LIVENESS_QUALIFIER.live.title}`);
  ```

  In `it('W4-U10: …')` replace `expect(Object.keys(LIVENESS_WORD).sort()).toEqual([...DELEGATION_LIVENESS].sort());` with:

  ```ts
  expect(Object.keys(LIVENESS_QUALIFIER).sort()).toEqual([...DELEGATION_LIVENESS].sort());
  ```

  Replace the last `it('liveActivitiesOf selects …')` block with VIS-W3, and add VIS-W1 and VIS-W2 after it:

  ```ts
  it('VIS-W3: activitiesStartedBy selects every entry a session started, whatever its placement or liveness', () => {
    const w = frame({ activities: [activity({ activityId: 'a1', parentId: 'worker-a', placement: 'chip' }),
      activity({ activityId: 'a2', parentId: 'worker-a', placement: 'row', liveness: 'stale' }),
      activity({ activityId: 'a3', parentId: 'coord-a' })] });
    expect(activitiesStartedBy('worker-a', w).map((a) => a.activityId)).toEqual(['a1', 'a2']);
  });

  it('VIS-W1: no delegation word says running; live, stale and unmeasured read apart; the qualifier is total', () => {
    const strings: string[] = [];
    const collect = (v: unknown): void => {
      if (typeof v === 'string') strings.push(v);
      else if (typeof v === 'object' && v !== null) for (const x of Object.values(v)) collect(x);
    };
    collect(Object.fromEntries(Object.entries(words).filter(([, v]) => typeof v !== 'function')));
    for (const liveness of DELEGATION_LIVENESS) {
      collect(worktreeLine(lease({ liveness }), 'worker-a', 'project-b', 'coord-a'));
      if (liveness !== 'ended') collect(activityLine(activity({ liveness }), 'coord-a'));
    }
    collect(delegatedChip([activity(), activity({ activityId: 'a2', liveness: 'stale' })]));
    collect(unlistedToggle(3));
    expect(strings.length).toBeGreaterThan(30);
    // Spec §9's "No running claim", and §4's forbidden totals and phrases.
    for (const s of strings) expect(s, s).not.toMatch(/running|\bactive\b|recent|couldn't check|check deferred/i);
    expect(Object.keys(LIVENESS_QUALIFIER).sort()).toEqual([...DELEGATION_LIVENESS].sort());
    for (const l of DELEGATION_LIVENESS) {
      expect(LIVENESS_QUALIFIER[l].word.length, l).toBeGreaterThan(0);
      expect(LIVENESS_QUALIFIER[l].title.length, l).toBeGreaterThan(20);
    }
    const word = (liveness: DelegationActivityWire['liveness']): string =>
      activityLine(activity({ liveness, displayName: null })).parts[1]!;
    expect((['live', 'stale', 'unmeasured'] as const).map(word)).toEqual(['not confirmed', 'stop not seen', 'unmeasured']);
    expect(worktreeLine(lease({ liveness: 'ended' }), null, null).parts[2]).toBe('end recorded');
    // A newer server's liveness word is re-filed unmeasured by the reader, never drawn as live.
    const future = readDelegation(frame({ activities: [activity({ liveness: 'future-word' as never })] })).activities[0]!;
    expect(activityLine(future).parts).toContain('unmeasured');
    expect(activityLine(future).parts).not.toContain('not confirmed');
    // The line's own fallback, with no reader in front of it (`qualifierOf`; VIS-M10): still unmeasured, never live.
    const direct = activityLine(activity({ liveness: 'future-word' as never, displayName: null }));
    expect(direct.parts).toEqual(['agent', 'unmeasured']);
    expect(direct.title).toContain(LIVENESS_QUALIFIER.unmeasured.title);
    const directTree = worktreeLine(lease({ liveness: 'future-word' as never }), null, null);
    expect(directTree.parts).toEqual(['agent worktree', 'agent-a1', 'unmeasured']);
    expect(directTree.title).toBe(`${lease().canonicalPath}; ${LIVENESS_QUALIFIER.unmeasured.title}`);
  });

  it('VIS-W2: titles name the qualifier and hook events; a from part names the session, last', () => {
    const a = activityLine(activity());
    expect(a.title).toBe(`agent agent-a1: ${LIVENESS_QUALIFIER.live.title}; opened 2026-10-26T10:00:00.000Z, `
      + 'last recorded hook event 2026-10-26T10:05:00.000Z');
    expect(a.title).not.toMatch(/last event/);
    expect(a.parts).toEqual(['agent', 'explore the tree', 'not confirmed']);
    expect(activityLine(activity(), 'coord-a').parts).toEqual(['agent', 'explore the tree', 'not confirmed', 'from coord-a']);
    expect(worktreeLine(lease({ workspace: 'unmeasured' }), 'worker-a', null, 'coord-gone').parts)
      .toEqual(['agent worktree', 'agent-a1', 'not confirmed', 'via worker-a', 'unmeasured', 'from coord-gone']);
    expect(fromPart('coord-a')).toBe('from coord-a');
    expect(unlistedToggle(2)).toBe('Delegated work, session not listed (2)');
  });
  ```

  Replace the file's first two comment lines with these three: `// Delegation broker wave 4, PR2 Task 2.2, and delegation visibility Task 1: the delegation rows' words` / `// (`fleet/delegationWords.ts`). D-6999's inferred chip, member tolerance, words that never say running (spec §4),` / `// and a chip that counts every attached entry (D-7781).` (three lines in all).

  In `pwa/test/card-header-facts.test.tsx`, make the W4-U33 and W4-U35 edits named under "Pins changed by design". In `pwa/test/fleet-screen.test.tsx` W4-U7c, make the two row edits named there.

- [ ] **Step 2: Run them and watch them fail.**

  ```
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/delegation-words.test.ts
  ```

  Expected: FAIL. W4-U8, W4-U9, W4-U10, VIS-W1, VIS-W2 and VIS-W3 fail: `LIVENESS_QUALIFIER`, `ENTRIES_NOTE`, `fromPart`, `unlistedToggle` and `activitiesStartedBy` are not exported (undefined), the chip still counts live entries only, and the rows still say `running`.

  ```
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/card-header-facts.test.tsx
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/fleet-screen.test.tsx
  ```

  Expected: FAIL. In the first, W4-U33 and W4-U35 fail on the title and the stale chip. In the second, W4-U7c fails on `running`.

- [ ] **Step 3: Implement.** Write `pwa/src/fleet/delegationWords.ts` as:

  ```ts
  // THE DELEGATION ROWS' WORDS (delegation broker wave 4, spec §5.8; D-6999, D-7002; delegation visibility). L1:
  // one module for every label a delegation row, group, chip, the session header's entry list or the fleet foot's region
  // draws, so no component spells one. The server decides every word on the wire
  // (`server/src/coord/delegation-projection.ts`): liveness, the group, an activity's placement, and which worktree is
  // `inferred`. This module names those words and tolerates a word this build has never heard of.
  //
  // THE WORDS SAY WHAT THE BROKER RECORDED (delegation visibility, spec §4). The wire's `live` means only that an entry's
  // session is live in the run that started it: nothing measures the helper itself. So no word here says "running", and
  // none claims recency. Each liveness has a short visible word and a title (`LIVENESS_QUALIFIER`); a count of entries
  // keeps the noun "delegated", which claims no execution.
  //
  // THE OPERATOR'S WORD IS "worktree". The wire's lease is never called that on the page.
  //
  // D-6999: a rung-4 (`raw`) worktree rests on negative evidence (no other session's listing window overlapped the Bash
  // call that made it), so it ALWAYS wears the "inferred" chip and a chip naming that call, wherever it is drawn, and
  // nothing on the page acts on it. `inferredChip` keys on `sourceKind === 'raw'` as well as on `inferred`, so a raw row
  // whose marker went missing still says so.
  //
  // Imports only `shared/api` and `lib/wire` (never `./fleetTree` or `./nestFleet`, which import from here: a cycle).
  import {
    DELEGATION_ACTIVITY_PLACEMENTS, DELEGATION_LIVENESS, DELEGATION_ROW_GROUPS,
    type DelegationActivityWire, type DelegationLeaseSourceKind, type DelegationLeaseWire, type DelegationLiveness,
    type DelegationProjectionWire, type DelegationUnownedWire,
  } from '../../../shared/api';
  import { isRecord } from '../lib/wire';

  /** The chip every raw worktree wears (D-6999). */
  export const INFERRED_WORD = 'inferred';
  /** The word for a value this build cannot name: drawn, never dropped and never read as a known word. */
  export const UNRECOGNISED_WORD = 'unrecognised';

  export interface Chip { readonly text: string; readonly title: string }

  /** The two group headers of a card (rules 9 and 10 of `nestFleet`). */
  export const GROUP_WORDS: Readonly<Record<'offline-coordinator' | 'unowned', { label: string; title: string }>> = {
    'offline-coordinator': {
      label: 'Offline coordinator',
      title: 'work whose session is no longer the one that started it, or is not on this card',
    },
    unowned: {
      label: 'Unowned work',
      title: 'worktrees no session could be tied to; being listed here never makes one eligible for removal',
    },
  };

  export const ACTIVITY_WORD: Readonly<Record<DelegationActivityWire['sourceKind'], string>> = {
    agent: 'agent',
    workflow: 'workflow',
  };

  export const WORKTREE_WORD: Readonly<Record<DelegationLeaseSourceKind, string>> = {
    agent: 'agent worktree',
    workflow: 'workflow worktree',
    raw: 'worktree',
    attached: 'attached worktree',
  };

  /** What the broker RECORDED about an entry, never a claim that a helper is executing (delegation visibility, spec §4).
   *  The visible word is short for a 360 px row; the title adds the sentence, but is never the only carrier, because a
   *  phone shows no titles. Keyed by `DelegationLiveness`, so the totality rows (W4-U10, VIS-W1) cover it. */
  export const LIVENESS_QUALIFIER: Readonly<Record<DelegationLiveness, { readonly word: string; readonly title: string }>> = {
    live: {
      word: 'not confirmed',
      title: 'Execution not confirmed: its session is live in the run that started it, but nothing shows the helper itself is still working',
    },
    stale: {
      word: 'stop not seen',
      title: "Its session is gone, dead or has restarted since, and the helper's stop was never recorded",
    },
    ended: { word: 'end recorded', title: 'The broker recorded its end; the worktree is still listed' },
    unmeasured: {
      word: 'unmeasured',
      title: "Its execution state, or its session's incarnation, could not be measured",
    },
  };

  /** A present worktree says nothing; an unmeasured one says so. */
  export const WORKSPACE_WORD: Readonly<Record<DelegationLeaseWire['workspace'], string | null>> = {
    present: null,
    unmeasured: 'unmeasured',
  };

  export const VERDICT_WORD: Readonly<Record<DelegationUnownedWire['verdict'], string>> = {
    unresolved: 'no owner found',
    conflicting: 'two owners claimed it',
  };

  /** The session header's description of its entry list (spec §5). */
  export const ENTRIES_NOTE = 'Recorded entries, not a current agent count. Execution is not confirmed for any of them.';

  /** The fleet foot's region: entries whose session the fleet list no longer carries (spec §5). */
  export const UNLISTED_WORDS = {
    label: 'Delegated work, session not listed',
    title: 'recorded delegation entries whose session is not in the fleet list; not a current agent count, and execution is not confirmed',
  } as const;

  /** The region's toggle: its label and its count. */
  export function unlistedToggle(n: number): string {
    return `${UNLISTED_WORDS.label} (${n})`;
  }

  /** The session an entry came from, on a row that is not under that session (an offline-group row, an unlisted row):
   *  its listed label, or its raw id when the fleet does not carry it. Display only: never a join key, never an
   *  ownership claim (spec §5). */
  export function fromPart(label: string): string {
    return `from ${label}`;
  }

  /** A table's word for `key`, or the unrecognised word when the table has none (a newer server's word). */
  const wordOf = (table: Readonly<Record<string, string>>, key: string): string =>
    Object.hasOwn(table, key) ? table[key]! : UNRECOGNISED_WORD;

  /** A liveness's qualifier. A word this build cannot name reads `unmeasured`, as `readDelegation` re-files it: never live. */
  const qualifierOf = (l: string): { readonly word: string; readonly title: string } =>
    Object.hasOwn(LIVENESS_QUALIFIER, l) ? LIVENESS_QUALIFIER[l as DelegationLiveness] : LIVENESS_QUALIFIER.unmeasured;

  const groupOf = (g: unknown): DelegationActivityWire['group'] =>
    (DELEGATION_ROW_GROUPS as readonly unknown[]).includes(g) ? g as DelegationActivityWire['group'] : 'offline-coordinator';
  const placementOf = (p: unknown): DelegationActivityWire['placement'] =>
    (DELEGATION_ACTIVITY_PLACEMENTS as readonly unknown[]).includes(p) ? p as DelegationActivityWire['placement'] : 'row';
  const livenessOf = (l: unknown): DelegationLiveness =>
    (DELEGATION_LIVENESS as readonly unknown[]).includes(l) ? l as DelegationLiveness : 'unmeasured';
  const workspaceOf = (w: unknown): DelegationLeaseWire['workspace'] =>
    Object.hasOwn(WORKSPACE_WORD, String(w)) ? w as DelegationLeaseWire['workspace'] : 'unmeasured';
  /** A marker this build cannot read is still a marker: it keeps the chip, with an unmeasured creator. */
  const inferredOf = (i: unknown): DelegationLeaseWire['inferred'] => {
    if (i === null || i === undefined) return null;
    const c = isRecord(i) ? i.creator : undefined;
    if (isRecord(c) && c.kind === 'bash-call' && typeof c.toolUseId === 'string') return { creator: { kind: 'bash-call', toolUseId: c.toolUseId } };
    return { creator: { kind: 'unmeasured' } };
  };

  /**
   * Member tolerance: a member carrying a word this build cannot name is KEPT. An unknown group is re-filed
   * `offline-coordinator`, an unknown placement `row`, an unknown liveness or workspace `unmeasured`; any other unknown
   * word renders with the `unrecognised` word. Never dropped, never drawn as live. (A member that is not an object at
   * all carries nothing to draw and no key, and is the one thing left out.)
   */
  export function readDelegation(w: DelegationProjectionWire): DelegationProjectionWire {
    const activities = w.activities.filter(isRecord).map((a): DelegationActivityWire => {
      const liveness = livenessOf(a.liveness);
      return {
        ...a, group: groupOf(a.group), placement: placementOf(a.placement),
        // An `ended` activity is never on the wire; one that arrives anyway is not drawn as a known state.
        liveness: liveness === 'ended' ? 'unmeasured' : liveness,
      };
    });
    const leases = w.leases.filter(isRecord).map((l): DelegationLeaseWire => ({
      ...l, group: groupOf(l.group), liveness: livenessOf(l.liveness), workspace: workspaceOf(l.workspace),
      via: typeof l.via === 'string' ? l.via : null, inferred: inferredOf(l.inferred),
    }));
    const unowned = w.unowned.filter(isRecord).map((u): DelegationUnownedWire => ({ ...u, workspace: workspaceOf(u.workspace) }));
    return { ...w, activities, leases, unowned };
  }

  const creatorOf = (l: DelegationLeaseWire): string | null =>
    l.inferred !== null && l.inferred.creator.kind === 'bash-call' ? l.inferred.creator.toolUseId : null;

  /** D-6999: non-null for every raw worktree and every worktree the server marked, whatever its group or fold. */
  export function inferredChip(l: DelegationLeaseWire): Chip | null {
    if (l.sourceKind !== 'raw' && l.inferred === null) return null;
    const id = creatorOf(l);
    const call = id === null ? 'a Bash call whose id was not recorded' : `Bash call ${id}`;
    return {
      text: INFERRED_WORD,
      title: `linked by the worktree listing taken before and after ${call}, with no other session's listing overlapping it; `
        + 'no upstream id confirms it, and nothing acts on it automatically',
    };
  }

  /** The Bash call that created an inferred worktree: its id's last eight characters, the whole id in the title. */
  export function creatorChip(l: DelegationLeaseWire): Chip | null {
    if (inferredChip(l) === null) return null;
    const id = creatorOf(l);
    if (id === null) {
      return { text: 'Bash call (id not recorded)', title: 'the Bash call that created this worktree was not recorded' };
    }
    return { text: `Bash call …${id.slice(-8)}`, title: `the Bash call that created this worktree: ${id}` };
  }

  /** A worktree's row. `viaLabel` is the worker the server's R9 names (already resolved to a label by the caller);
   *  `sourceProject` is `workingOnCard`'s answer for the row's own project, handed back for the caller's folder icon;
   *  `fromLabel` names the session it came from, on a row that is not under that session. An ended worktree reads
   *  `end recorded`, and its workspace word alone says whether its presence was measured. */
  export function worktreeLine(
    l: DelegationLeaseWire, viaLabel: string | null, sourceProject: string | null, fromLabel: string | null = null,
  ): { parts: readonly string[]; title: string; sourceProject: string | null } {
    const q = qualifierOf(l.liveness);
    const parts = [wordOf(WORKTREE_WORD, l.sourceKind), l.adminRecord, q.word];
    if (viaLabel !== null) parts.push(`via ${viaLabel}`);
    const ws = Object.hasOwn(WORKSPACE_WORD, l.workspace) ? WORKSPACE_WORD[l.workspace] : UNRECOGNISED_WORD;
    if (ws !== null) parts.push(ws);
    if (fromLabel !== null) parts.push(fromPart(fromLabel));
    return { parts, title: `${l.canonicalPath}; ${q.title}`, sourceProject };
  }

  /** A delegated agent's or workflow's row. Its times are the hook events the broker recorded, never helper activity. */
  export function activityLine(
    a: DelegationActivityWire, fromLabel: string | null = null,
  ): { parts: readonly string[]; title: string } {
    const word = wordOf(ACTIVITY_WORD, a.sourceKind);
    const q = qualifierOf(a.liveness);
    const parts = [
      word, ...(a.displayName !== null && a.displayName !== '' ? [a.displayName] : []), q.word,
      ...(fromLabel === null ? [] : [fromPart(fromLabel)]),
    ];
    return { parts, title: `${word} ${a.upstreamId}: ${q.title}; opened ${a.openedAt}, last recorded hook event ${a.lastEventAt}` };
  }

  /** An unowned tree's row. */
  export function unownedLine(u: DelegationUnownedWire): { parts: readonly string[]; title: string } {
    const parts = [u.adminRecord, wordOf(VERDICT_WORD, u.verdict)];
    const ws = Object.hasOwn(WORKSPACE_WORD, u.workspace) ? WORKSPACE_WORD[u.workspace] : UNRECOGNISED_WORD;
    if (ws !== null) parts.push(ws);
    return { parts, title: `${u.canonicalPath ?? u.adminRecord}: ${u.reason}` };
  }

  /** Entries in the order they opened, then by id: the one order of every list of them (`nestFleet`'s rows, the
   *  fleet foot's region, the session header's list). */
  export const byOpened = (a: DelegationActivityWire, b: DelegationActivityWire): number =>
    a.openedAt.localeCompare(b.openedAt) || a.activityId.localeCompare(b.activityId);

  /** One line of the session header's entry list, in an activity row's words. */
  export interface EntryRow { readonly key: string; readonly parts: readonly string[]; readonly title: string }

  /** A session's recorded entries: the chip (`N delegated`), their count, the header's description and its list. */
  export interface DelegatedSummary extends Chip {
    readonly count: number;
    readonly note: string;
    readonly rows: readonly EntryRow[];
  }

  /** D-7781: the chip counts EVERY entry it is handed, of every liveness. The card hands it a row's attached entries,
   *  and the header every entry the session started, so the count is of recorded entries, never of running helpers.
   *  `null` when handed none. */
  export function delegatedChip(activities: readonly DelegationActivityWire[]): DelegatedSummary | null {
    if (activities.length === 0) return null;
    const n = activities.length;
    const rows = [...activities].sort(byOpened).map((a): EntryRow => ({ key: a.activityId, ...activityLine(a) }));
    return {
      text: `${n} delegated`,
      title: `${n} recorded delegation ${n === 1 ? 'entry' : 'entries'}, not a current agent count; execution not confirmed`,
      count: n, note: ENTRIES_NOTE, rows,
    };
  }

  /** Every entry a session started, whatever its placement or liveness: the session header lists them all. */
  export function activitiesStartedBy(id: string, w: DelegationProjectionWire): readonly DelegationActivityWire[] {
    return w.activities.filter((a) => a.parentId === id);
  }

  /** A coordinator's summary counts for its delegation children: `n delegated`, `n worktree(s)`; zero counts say nothing. */
  export function delegationParts(rows: readonly { kind: 'activity' | 'lease' }[]): { readonly n: number; readonly word: string }[] {
    const acts = rows.filter((r) => r.kind === 'activity').length;
    const trees = rows.filter((r) => r.kind === 'lease').length;
    return [
      ...(acts > 0 ? [{ n: acts, word: 'delegated' }] : []),
      ...(trees > 0 ? [{ n: trees, word: trees === 1 ? 'worktree' : 'worktrees' }] : []),
    ];
  }
  ```

  In `pwa/src/fleet/nestFleet.ts`, after `import { isDispatchPending, workerOf } from './runWords';` add:

  ```ts
  import { byOpened } from './delegationWords';
  ```

  and delete these two lines (the local copy, now the words module's):

  ```ts
  const byOpened = (a: DelegationActivityWire, b: DelegationActivityWire): number =>
    a.openedAt.localeCompare(b.openedAt) || a.activityId.localeCompare(b.activityId);
  ```

  In `pwa/src/screens/SessionScreen.tsx`, replace `import { liveActivitiesOf, readDelegation } from '../fleet/delegationWords';` with `import { activitiesStartedBy, readDelegation } from '../fleet/delegationWords';`. Replace `// Delegation broker wave 4 (R9): the header's chip reads the same activities as the card's.` with `// Delegation visibility (spec §5): the header lists every entry this session started, whatever its placement.` Replace `delegated: delegation === null ? null : liveActivitiesOf(live.id, readDelegation(delegation)),` with `delegated: delegation === null ? null : activitiesStartedBy(live.id, readDelegation(delegation)),`.

  In `shared/api.ts` (comments only), replace the `DelegationLiveness` docstring with:

  ```ts
  /** What the broker RECORDED about delegated work, decided at projection time and never stored. None of these words
   *  measures the helper itself (delegation visibility, spec §1), so no reader draws one as "running" or "recent".
   *  `live`: its end is not recorded and its parent is live in the incarnation that started it; execution is NOT
   *  confirmed. `stale`: its end is not recorded, and its parent is gone, dead or in another incarnation (its stop was
   *  not seen). `ended`: its terminal evidence was seen. `unmeasured`: its execution state is `unknown`, or its parent's
   *  incarnation was not measured. */
  ```

  and the `upstreamId` comment in `DelegationActivityWire` with:

  ```ts
    /** The agent id, or the workflow run id. Display text only: its spelling (a workflow worker's reads
     *  `<runId>-<index>`) is no membership, run or worker-composition key, and no reader groups by it (delegation
     *  visibility, spec §2). */
  ```

- [ ] **Step 4: Run them and watch them pass**, one file per run:

  ```
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/delegation-words.test.ts
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/card-header-facts.test.tsx
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/fleet-screen.test.tsx
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/nestFleet.test.ts
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/project-card.test.tsx
  cd pwa && ccrc test -- ./node_modules/.bin/tsc --noEmit
  ```

  Expected: PASS for each. In `nestFleet.test.ts`, W4-U0's fingerprints are unchanged, because the ordering moved and did not change.

- [ ] **Step 5: Commit.**

  ```
  git add pwa/src/fleet/delegationWords.ts pwa/src/fleet/nestFleet.ts pwa/src/screens/SessionScreen.tsx shared/api.ts \
    pwa/test/delegation-words.test.ts pwa/test/card-header-facts.test.tsx pwa/test/fleet-screen.test.tsx
  git commit -m "feat(pwa): delegation rows say what the broker recorded, never running (delegation visibility spec §4), and the chip counts every entry (D-7781)"
  ```

  End the message with the attribution trailer your session's instructions require.

## Task 2: Chips and header — every attached entry on live and dead rows, the header's full list, and the count rule

**Files:**
- Create: `pwa/src/fleet/WorkLine.tsx` (L4; names no broker word).
- Modify: `pwa/src/fleet/sessionFacts.ts` (`Fact`, `FactInput.delegated`'s comment, `SessionFactSet.delegated`, `sessionFacts`, `cardFacts`, `headerFacts`, `cardWithinHeader`).
- Modify: `pwa/src/fleet/SessionMeta.tsx` (props; header mode's chip becomes a disclosure).
- Modify: `pwa/src/session/SessionDetails.tsx` (the disclosure's state and its list; names no broker word).
- Modify: `pwa/src/fleet/ProjectCard.tsx` (`workLine` draws `WorkLine`).
- Modify: `pwa/src/session/chat.css` (one new rule, `.chat-facts .sess-entries`; no existing rule changes).
- Modify: `pwa/test/control-census.test.ts` (the `sess-subagents` entry's text).
- Test: `pwa/test/card-header-facts.test.tsx`, `pwa/test/session-lifecycle.test.tsx` (VIS-S1, the real `SessionScreen` wiring), `pwa/test/fleet-css.test.ts` (VIS-CSS2).

**Interfaces.**
- Consumes: Task 1's `delegatedChip`, `DelegatedSummary`, `EntryRow`.
- Produces:
  ```ts
  // WorkLine.tsx
  export function WorkLine(props: { parts: readonly string[]; title: string; children?: ReactNode }): ReactNode;
  // sessionFacts.ts
  export interface Fact { readonly key: FactKey; readonly text: string; readonly short?: string; readonly title?: string; readonly count?: number }
  // SessionFactSet.delegated: DelegatedSummary | null   (was Chip | null; never nulled by a dead row)
  // SessionMeta.tsx, SessionMetaProps adds:
  delegatedOpen?: boolean; delegatedId?: string; onToggleDelegated?: () => void;
  ```

**Pins changed by design in this task.**
- `card-header-facts.test.tsx` W4-U34. Old: `it('W4-U34: a dead worker carries no chip', …)` with `expect(cardFacts(f).delegated).toBeNull();` and `expect(headerFacts(f).some((h) => h.key === 'delegated')).toBe(false);`. New: Step 1's W4-U34 (a dead row keeps its chip, `3 delegated`, on the card and in the header).
- W4-U35 stays as Task 1 left it: the card keeps its `.sess-meta-chip` span.
- `control-census.test.ts`'s entry `'fleet/SessionMeta.tsx <button> sess-subagents'` keeps its key and its TOKEN claim. Only its text changes, because a second button now shares the class.

- [ ] **Step 1: Write the failing tests** in `pwa/test/card-header-facts.test.tsx`.

  Add after the `@testing-library/react` import line:

  ```ts
  import userEvent from '@testing-library/user-event';
  ```

  and after `import { activity } from './delegationFixture';`:

  ```ts
  import { ENTRIES_NOTE } from '../src/fleet/delegationWords';
  ```

  Replace the whole `it('W4-U34: a dead worker carries no chip', …)` block with these three cases:

  ```ts
  it('W4-U34 (D-7781): a dead worker keeps its chip, every liveness counted, on the card and in the header', () => {
    const dead = s({ ...worker, status: 'dead', bucket: 'dead' });
    const entries = [...two, activity({ activityId: 'a3', parentId: worker.id, liveness: 'stale' })];
    const f = sessionFacts({ session: dead, now: NOW, delegated: entries });
    expect(cardFacts(f).delegated?.text).toBe('3 delegated');
    expect(headerFacts(f).find((h) => h.key === 'delegated')?.text).toBe('3 delegated');
    const { container } = render(<SessionLine session={dead} onOpen={() => {}} onActions={() => {}} now={NOW} delegated={entries} />);
    expect(container.querySelector('.sess-meta .sess-meta-chip')?.textContent).toBe('3 delegated');
    // A row handed no attached entries has no chip.
    expect(cardFacts(sessionFacts({ session: worker, now: NOW })).delegated).toBeNull();
    expect(cardFacts(sessionFacts({ session: worker, now: NOW, delegated: [] })).delegated).toBeNull();
  });

  it('VIS-C1 (D-7782): the header holds the card\'s count of attached entries though its own count is larger', () => {
    const dead = s({ ...worker, status: 'dead', bucket: 'dead' });
    const attached = activity({ activityId: 'a1', parentId: worker.id, placement: 'chip', liveness: 'stale' });
    const placed = [activity({ activityId: 'a2', parentId: worker.id, placement: 'row' }),
      activity({ activityId: 'a3', parentId: worker.id, placement: 'row', liveness: 'unmeasured' })];
    const card = cardFacts(sessionFacts({ session: dead, now: NOW, delegated: [attached] }));
    const header = headerFacts(sessionFacts({ session: dead, now: NOW, delegated: [attached, ...placed] }));
    expect(card.delegated).toMatchObject({ key: 'delegated', text: '1 delegated', count: 1 });
    expect(header.find((h) => h.key === 'delegated')).toMatchObject({ text: '3 delegated', count: 3 });
    expect(cardWithinHeader(card, header)).toEqual([]);
    // It still catches a card fact the header lacks, or holds with a smaller count, and every other key keeps its prefix rule.
    expect(cardWithinHeader(card, header.filter((h) => h.key !== 'delegated'))).toEqual([card.delegated]);
    const wide = cardFacts(sessionFacts({ session: dead, now: NOW, delegated: [attached, ...placed] }));
    const narrow = headerFacts(sessionFacts({ session: dead, now: NOW, delegated: [attached] }));
    expect(cardWithinHeader(wide, narrow)).toEqual([wide.delegated]);
    expect(cardWithinHeader(card, header.filter((h) => h.key !== 'status'))).toEqual([card.status]);
    // A `delegated` fact with no count holds nothing, on either side (VIS-M13): the count is the comparison.
    const countless = { ...card, delegated: { key: card.delegated!.key, text: card.delegated!.text } };
    expect(cardWithinHeader(countless, header)).toEqual([countless.delegated]);
    const headerCountless = header.map((h) => (h.key === 'delegated' ? { key: h.key, text: h.text } : h));
    expect(cardWithinHeader(card, headerCountless)).toEqual([card.delegated]);
  });

  it('VIS-H1: the header lists every entry the session started, once each, behind a disclosure that does not navigate', async () => {
    const entries = [
      activity({ activityId: 'a1', parentId: worker.id, placement: 'chip', displayName: 'map the tree' }),
      activity({ activityId: 'a2', parentId: worker.id, placement: 'row', displayName: 'read the plan', liveness: 'stale',
        openedAt: '2026-10-26T10:01:00.000Z' }),
      activity({ activityId: 'a3', parentId: worker.id, placement: 'row', displayName: 'check the build', liveness: 'unmeasured',
        openedAt: '2026-10-26T10:02:00.000Z' }),
    ];
    const f = sessionFacts({ session: worker, now: NOW, childRun: child(RUN), delegated: entries });
    render(<SessionHeaderHost {...headerProps({ session: worker, status: worker.status, facts: f })} />);
    const details = screen.queryByRole('button', { name: /details/i });
    if (details !== null && details.getAttribute('aria-expanded') === 'false') fireEvent.click(details);
    const door = screen.getByRole('button', { name: '3 delegated' });
    expect(door.getAttribute('aria-expanded')).toBe('false');
    expect(door.hasAttribute('aria-controls')).toBe(false);
    expect(document.body.textContent).not.toContain(ENTRIES_NOTE);
    const path = location.pathname;
    // Keyboard: Enter on the focused button opens it.
    door.focus();
    await userEvent.keyboard('{Enter}');
    expect(door.getAttribute('aria-expanded')).toBe('true');
    const list = document.getElementById(door.getAttribute('aria-controls')!);
    if (list === null) throw new Error('aria-controls names no element');
    expect(list.textContent).toContain(ENTRIES_NOTE);
    const rows = [...list.querySelectorAll('.proj-work')].map((r) => [...r.querySelectorAll('.proj-work-part')].map((p) => p.textContent));
    expect(rows).toEqual([
      ['agent', 'map the tree', 'not confirmed'], ['agent', 'read the plan', 'stop not seen'], ['agent', 'check the build', 'unmeasured'],
    ]);
    expect(location.pathname).toBe(path);
    // Touch: a tap closes it, and the list and its aria-controls go together.
    fireEvent.click(door);
    expect(door.getAttribute('aria-expanded')).toBe('false');
    expect(door.hasAttribute('aria-controls')).toBe(false);
    expect(document.body.textContent).not.toContain(ENTRIES_NOTE);
    expect(location.pathname).toBe(path);
  });
  ```

  In `pwa/test/session-lifecycle.test.tsx`, add after `import { TEST_ROSTER } from './rosterFixture';`:

  ```ts
  import { activity, frame } from './delegationFixture';
  ```

  and add at the end of the file (it reuses the file's `react-virtuoso` stand-in, `fetch` stub, `makeStore` and `makeFleet`):

  ```tsx
  // Delegation visibility (spec §9, "Header list"): the REAL screen's wiring, store to header. The session header counts
  // and lists every entry the open session started, attached (`placement: 'chip'`) and row-placed alike, and no other
  // session's (VIS-M11 narrows the screen's selection and must red this).
  describe('the session header lists every entry the session started (delegation visibility)', () => {
    it('VIS-S1: one attached and one row-placed entry read "2 delegated", and the list holds both, in opening order', () => {
      const id = 'project-a-worker';
      const store = makeStore(id);
      const fleet = makeFleet();
      act(() => {
        fleet.setState({
          sessions: [fleetSession({ id, project: 'project-a', workspace: 'worker', workdir: '/w/project-a/worker' })],
          delegation: frame({ activities: [
            activity({ activityId: 'a1', parentId: id, placement: 'chip', displayName: 'map the tree' }),
            activity({ activityId: 'a2', parentId: id, placement: 'row', displayName: 'read the plan', liveness: 'stale',
              openedAt: '2026-10-26T10:01:00.000Z' }),
            activity({ activityId: 'a3', parentId: 'coord-a', displayName: 'not this session' }),
          ] }),
        });
      });
      render(<SessionScreen id={id} store={store} fleet={fleet} />);
      const details = screen.queryByRole('button', { name: 'Session details' });
      if (details !== null && details.getAttribute('aria-expanded') === 'false') fireEvent.click(details);
      const door = screen.getByRole('button', { name: '2 delegated' });
      fireEvent.click(door);
      const list = document.getElementById(door.getAttribute('aria-controls') ?? '');
      if (list === null) throw new Error('aria-controls names no element');
      const rows = [...list.querySelectorAll('.proj-work')].map((r) => [...r.querySelectorAll('.proj-work-part')].map((p) => p.textContent));
      expect(rows).toEqual([['agent', 'map the tree', 'not confirmed'], ['agent', 'read the plan', 'stop not seen']]);
    });
  });
  ```

  In `pwa/test/fleet-css.test.ts`, add at the end of the file:

  ```ts
  // Delegation visibility (the plan's Global Constraints, "CSS"): the two new list surfaces take the floor `.proj-card`
  // takes. Each is an item of a grid or flex container whose automatic minimum is its min-content width, and its rows'
  // words are `white-space: nowrap`, so without `min-width: 0` one long row widens the track and scrolls the pane.
  describe('the fleet foot\'s region and the header\'s entry list shrink below their rows (delegation visibility)', () => {
    const chatCss = readFileSync(path.join(import.meta.dirname, '..', 'src', 'session', 'chat.css'), 'utf8');

    it('VIS-CSS2: the header\'s entry list is a full-width flex item of .chat-facts with a min-width of 0', () => {
      const rule = ruleIn(chatCss, '.chat-facts .sess-entries');
      expect(declValue(rule, 'flex-basis')).toBe('100%');
      expect(declValue(rule, 'min-width')).toBe('0');
    });
  });
  ```

- [ ] **Step 2: Run it and watch it fail.**

  ```
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/card-header-facts.test.tsx
  ```

  Expected: FAIL. W4-U34 fails because the dead row has no chip (`dead ? null : …`). VIS-C1 fails first for the same reason: its row is dead, so `card.delegated` is `null` and its first `toMatchObject` fails on that. With the shortcut gone, it would next fail on the missing `count` and on the prefix rule, which reports `1 delegated` missing from a header reading `3 delegated` (VIS-M4 measures that arm in Task 4). VIS-H1 fails because the header draws a `<span>`, so no button is named `3 delegated`.

  ```
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/session-lifecycle.test.tsx
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/fleet-css.test.ts
  ```

  Expected: FAIL. VIS-S1 fails because the header draws `2 delegated` as a `<span>`, so no button has that name. VIS-CSS2 fails with `no rule for .chat-facts .sess-entries`.

- [ ] **Step 3: Implement.**

  Create `pwa/src/fleet/WorkLine.tsx`:

  ```tsx
  // One line of words, each a cell, its detail in `title`: the row a project card draws for work it holds, the fleet
  // foot's region draws for work whose session is not listed, and the session header draws for each recorded entry.
  // ONE spelling of that markup, so the three surfaces cannot drift apart. The words are the caller's, decided by the
  // words module; this file draws them and decides nothing.
  import type { ReactNode } from 'react';
  import './fleet.css';

  export function WorkLine({ parts, title, children = null }: {
    parts: readonly string[];
    title: string;
    /** Chips drawn after the words (a worktree's markers), or nothing. */
    children?: ReactNode;
  }): ReactNode {
    return (
      <div className="proj-work" title={title}>
        <span className="proj-work-parts">
          {parts.map((p, i) => <span key={i} className="proj-work-part">{p}</span>)}
        </span>
        {children}
      </div>
    );
  }
  ```

  In `pwa/src/fleet/ProjectCard.tsx`, add `import { WorkLine } from './WorkLine';` after `import { sessionLabel } from './sessionLabel';`, and replace the body of `workLine`:

  ```tsx
  const workLine = (parts: readonly string[], title: string, tail: ReactNode = null): ReactNode => (
    <WorkLine parts={parts} title={title}>{tail}</WorkLine>
  );
  ```

  In `pwa/src/fleet/sessionFacts.ts`:
  - Replace `import { delegatedChip, type Chip } from './delegationWords';` with `import { delegatedChip, type DelegatedSummary } from './delegationWords';`.
  - In `interface Fact`, after `readonly title?: string;`, add:
    ```ts
      /** The count the subset rule compares instead of the text: the `delegated` fact only (D-7782). */
      readonly count?: number;
    ```
  - Replace `FactInput.delegated`'s comment with `/** The delegation entries this session started: on the card, the ones `nestFleet` attached to its row; in the header, every one (`activitiesStartedBy`). Absent or `null` = none known. */`.
  - Replace `SessionFactSet.delegated`'s comment and type with:
    ```ts
      /** The session's recorded delegation entries as one chip and the header's list (`delegatedChip`): every entry it is
       *  handed, of every liveness, on a live row and a dead one alike (D-7781); `null` when handed none. */
      readonly delegated: DelegatedSummary | null;
    ```
  - In `sessionFacts`, replace `delegated: dead ? null : delegatedChip(delegated ?? []),` with:
    ```ts
        // D-7781: no dead shortcut. A dead worker's entries stay one tap from its row.
        delegated: delegatedChip(delegated ?? []),
    ```
  - Replace `CardFacts.delegated`'s comment with `/** The row's attached delegation entries, every liveness (D-7781). */`, and in `cardFacts` replace the `delegated:` line with:
    ```ts
        delegated: f.delegated === null ? null
          : { key: 'delegated', text: f.delegated.text, title: f.delegated.title, count: f.delegated.count },
    ```
  - In `headerFacts`, replace `if (f.delegated !== null) out.push({ key: 'delegated', text: f.delegated.text, title: f.delegated.title });` with:
    ```ts
      if (f.delegated !== null) out.push({ key: 'delegated', text: f.delegated.text, title: f.delegated.title, count: f.delegated.count });
    ```
  - Replace `cardWithinHeader` with:
    ```ts
    /** The subset rule, as a predicate the test and the harness both call: every card fact has a header fact under its
     *  key carrying its FULL text, or, for `delegated`, at least its count. */
    export function cardWithinHeader(card: CardFacts, header: readonly Fact[]): Fact[] {
      const shown = [card.name, card.status, card.context, card.marker, card.workingOn, card.delegated]
        .filter((x): x is Fact => x !== null);
      // The header's form BEGINS with the card's: the same words, the header adding what the glance leaves out
      // (`waiting` → `waiting on you`, `idle` → `idle · 2m ago`, `held` → `held: <the verbatim hold>`).
      // D-7782: `delegated` is compared by COUNT. The card counts a row's attached entries and the header every entry
      // the session started, a superset, so `3 delegated` holds the card's `1 delegated` though neither text begins the other.
      const holds = (c: Fact, h: Fact): boolean => h.key === c.key && (c.key === 'delegated'
        ? c.count !== undefined && h.count !== undefined && h.count >= c.count
        : h.text.startsWith(c.text));
      return shown.filter((c) => !header.some((h) => holds(c, h)));
    }
    ```

  In `pwa/src/fleet/SessionMeta.tsx`:
  - In `SessionMetaProps`, after `onToggleSubagents?: () => void;`, add:
    ```ts
      /** The delegated-entries disclosure's state (header mode; `SessionDetails` draws the list beside the row). */
      delegatedOpen?: boolean;
      delegatedId?: string;
      onToggleDelegated?: () => void;
    ```
  - Change the destructuring to `facts: f, mode, onOpenRun, subagentsOpen = false, subagentsId, onToggleSubagents, delegatedOpen = false, delegatedId, onToggleDelegated,`.
  - In card mode, replace the comment `{/* R9 (delegation broker wave 4): a programme worker's live delegated work, one chip after the marker. */}` with `{/* R9: the row's attached delegation entries, every liveness, on a live or dead row (D-7781): one chip after the marker. */}`.
  - In header mode, replace:
    ```tsx
      {/* R9 (delegation broker wave 4): the card's chip, the same text, so the header stays a superset (D-5545). */}
      {f.delegated !== null && <span className="sess-meta-chip" title={f.delegated.title}>{f.delegated.text}</span>}
    ```
    with:
    ```tsx
      {/* Delegation visibility (spec §5): every entry this session started, a disclosure in the subagent toggle's shape: a
          REAL `<button>`, `aria-controls` only while the list exists (`SessionDetails` draws it). Its count is never
          smaller than the card's chip, which counts only the attached entries (D-7782). */}
      {f.delegated !== null && (
        <button
          type="button"
          className="sess-subagents"
          aria-expanded={delegatedOpen}
          aria-controls={delegatedOpen ? delegatedId : undefined}
          title={f.delegated.title}
          onClick={onToggleDelegated}
        >
          {f.delegated.text}
        </button>
      )}
    ```

  In `pwa/src/session/SessionDetails.tsx`:
  - Add `import { WorkLine } from '../fleet/WorkLine';` after `import { SessionMeta } from '../fleet/SessionMeta';`.
  - After `const subagentsId = useId();` add:
    ```tsx
      const [delegatedOpen, setDelegatedOpen] = useState(false);
      // Derived from the subagent list's id, never a `useId` of its own, so the header calls no hook it did not call.
      const delegatedId = `${subagentsId}-entries`;
    ```
  - Add three props to the `<SessionMeta … />` call, after `onToggleSubagents={() => setSubagentsOpen((v) => !v)}`:
    ```tsx
          delegatedOpen={delegatedOpen}
          delegatedId={delegatedId}
          onToggleDelegated={() => setDelegatedOpen((v) => !v)}
    ```
  - After the subagent list's `{subagentsOpen && … }` block, add:
    ```tsx
        {/* The recorded entries this session started, each in its row's words, under the description the words module
            gives (`facts.delegated.note`). Drawn only while the disclosure is open. */}
        {delegatedOpen && facts.delegated !== null && (
          <div id={delegatedId} className="sess-entries">
            <span className="chat-fact sess-entries-note">{facts.delegated.note}</span>
            {facts.delegated.rows.map((r) => <WorkLine key={r.key} parts={r.parts} title={r.title} />)}
          </div>
        )}
    ```

  In `pwa/src/session/chat.css`, leave `.chat-facts .sess-subagent-list { flex-basis: 100%; }` as it is, and add after it:

  ```css
  /* The header's list of recorded entries: a full-width flex item of .chat-facts, whose automatic minimum would be its
     min-content width. Its rows' words are white-space: nowrap (.proj-work-parts), so without min-width: 0 one long
     row would push the header past the screen's edge; with it, the row ends in an ellipsis. */
  .chat-facts .sess-entries { flex-basis: 100%; min-width: 0; }
  ```

  In `pwa/test/control-census.test.ts`, replace `'fleet/SessionMeta.tsx <button> sess-subagents': 'TOKEN. The subagent toggle, a real un-nested button.',` with:

  ```ts
    'fleet/SessionMeta.tsx <button> sess-subagents':
      'TOKEN. The subagent toggle and, beside it in the header, the delegated-entries toggle (delegation visibility): '
      + 'real un-nested buttons in one shape.',
  ```

- [ ] **Step 4: Run them and watch them pass**, one file per run:

  ```
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/card-header-facts.test.tsx
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/session-lifecycle.test.tsx
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/fleet-css.test.ts
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/project-card.test.tsx
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/fleet-screen.test.tsx
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/control-census.test.ts
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/markup-census.test.ts
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/shape-census.test.ts
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/session-line.test.tsx
  cd pwa && ccrc test -- ./node_modules/.bin/tsc --noEmit
  ```

  Expected: PASS for each. The card-header-facts cases over `CASES`, which carry no delegated input, are unchanged. `project-card.test.tsx`'s R9 row still reads `['1 delegated']`, because its one attached entry is live. `fleet-screen.test.tsx` passes as Task 1 left it: `WorkLine` draws the `.proj-work` markup W4-U7c reads, byte for byte.

- [ ] **Step 5: Commit.**

  ```
  git add pwa/src/fleet/WorkLine.tsx pwa/src/fleet/sessionFacts.ts pwa/src/fleet/SessionMeta.tsx pwa/src/session/SessionDetails.tsx \
    pwa/src/fleet/ProjectCard.tsx pwa/src/session/chat.css pwa/test/control-census.test.ts pwa/test/card-header-facts.test.tsx \
    pwa/test/session-lifecycle.test.tsx pwa/test/fleet-css.test.ts
  git commit -m "feat(pwa): a session's chip counts every attached entry, and its header lists every entry it started (D-7781, D-7782)"
  ```

  End the message with the attribution trailer.

## Task 3: The unlisted region and parent names

**Files:**
- Modify: `pwa/src/fleet/fleetTree.ts` (`unplacedActivities` returns the entries).
- Modify: `pwa/src/fleet/FleetCards.tsx` (the region after the cards; the attribute derives from the same list).
- Modify: `pwa/src/fleet/ProjectCard.tsx` (`viaLabel` → `labelOf`; offline-group rows carry `from <label>`).
- Modify: `pwa/src/fleet/fleet.css` (one new rule, `.fleet-unlisted { min-width: 0; }`).
- Test: `pwa/test/fleetTree.test.ts`, `pwa/test/project-card.test.tsx`, `pwa/test/fleet-screen.test.tsx`, `pwa/test/fleet-css.test.ts` (VIS-CSS1), `pwa/browser/delegation-rows.browser.test.ts` (the region at 390, 1280 and 1920).

**Interfaces.**
- Consumes: Task 1's `activityLine(a, fromLabel)`, `worktreeLine(…, fromLabel)`, `byOpened`, `UNLISTED_WORDS`, `unlistedToggle`; Task 2's `WorkLine`.
- Produces:
  ```ts
  // fleetTree.ts (was `: number`)
  export function unplacedActivities(sessions: readonly FleetSession[], delegation: DelegationProjectionWire | null): readonly DelegationActivityWire[];
  ```

**Pins changed by design in this task.**
- `fleetTree.test.ts` W4-U36. Old: `expect(unplacedActivities([coordA, mainB], w)).toBe(1);`, `expect(unplacedActivities([coordA, mainB], null)).toBe(0);` and `expect(unplacedActivities([coordA], frame({ activities: [activity({ parentId: 'coord-a' })] }))).toBe(0);`. New: `expect(unplacedActivities([coordA, mainB], w).map((a) => a.activityId)).toEqual(['a-gone']);`, `expect(unplacedActivities([coordA, mainB], null)).toEqual([]);` and `expect(unplacedActivities([coordA], frame({ activities: [activity({ parentId: 'coord-a' })] }))).toEqual([]);`.
- `fleet-screen.test.tsx` W4-U7c, as Task 1 left it. Old: `['worktree', 'agent-a1', 'unmeasured', 'unmeasured'],` and `['agent', 'regroup', 'not confirmed'],`. New: `['worktree', 'agent-a1', 'unmeasured', 'unmeasured', 'from coord-a'],` and `['agent', 'regroup', 'not confirmed', 'from coord-a'],`. Both are offline-group rows, and their parent `coord-a` is listed with no name, so its label is its id.
- `fleet-screen.test.tsx` "a measured frame marks the list measured, and counts an activity no card can draw" stays unchanged: `data-delegation-unplaced` still reads `1`. VIS-U1 adds the visible text beside it.

- [ ] **Step 1: Write the failing tests.**

  In `pwa/test/fleetTree.test.ts`, inside `describe('fleetTree — delegation rows land on their parent\'s card …')`, make the W4-U36 edits above and add:

  ```ts
  it('VIS-T1: the unlisted selection returns the entries in opening order; an archived or released parent keeps its own on its card', () => {
    const arch = fleetSession({ id: 'coord-arch', project: 'project-a', workspace: null, archivedAt: 1_800_000_000_000 });
    const rel = fleetSession({ id: 'w-rel', project: 'project-a', workspace: 'w-rel',
      releasedFrom: { runId: 9, program: 'port-api', programTitle: null, claimedBy: 'coord-a', closedAt: 1, child: true } });
    const w = frame({ activities: [
      activity({ activityId: 'a-late', parentId: 'coord-gone', openedAt: '2026-10-26T10:03:00.000Z' }),
      activity({ activityId: 'a-early', parentId: 'other-gone', openedAt: '2026-10-26T09:00:00.000Z' }),
      activity({ activityId: 'a-arch', parentId: 'coord-arch' }),
      activity({ activityId: 'a-rel', parentId: 'w-rel' }),
    ] });
    expect(unplacedActivities([coordA, arch, rel], w).map((a) => a.activityId)).toEqual(['a-early', 'a-late']);
    const off = fleetTreeOf([coordA, arch, rel], [], [], {}, w).flatMap((g) => g.rows)
      .flatMap((r) => (r.kind === 'activity' && r.group === 'offline-coordinator' ? [r.activity.activityId] : []));
    expect(off).toEqual(['a-arch', 'a-rel']);
  });
  ```

  In `pwa/test/project-card.test.tsx`, inside `describe('delegation rows on a project card …')`, add:

  ```ts
  it('VIS-P1: an offline-group row names the session it came from: its listed label, else its raw id', () => {
    const arch = fleetSession({ id: 'coord-arch', project: 'project-a', workspace: null, name: 'old coordinator', archivedAt: 1_800_000_000_000 });
    const w = frame({
      activities: [activity({ activityId: 'a-arch', parentId: 'coord-arch', displayName: 'old work' })],
      leases: [lease({ leaseId: 'l-gone', parentId: 'coord-gone', adminRecord: 'agent-o1', canonicalPath: '/work/project-a/.claude/worktrees/agent-o1' })],
    });
    const parts = (root: HTMLElement): (string | null)[][] =>
      [...root.querySelectorAll('.proj-work')].map((r) => [...r.querySelectorAll('.proj-work-part')].map((p) => p.textContent));
    const off = render(<ProjectCard group={cardFor(w, [coordA, arch])} onOpen={() => {}} onActions={() => {}}
      coordOf={(id) => (id === arch.id ? arch : null)} offlineOpen />);
    expect(parts(off.container)).toEqual([
      ['agent worktree', 'agent-o1', 'not confirmed', 'from coord-gone'],
      ['agent', 'old work', 'not confirmed', 'from old coordinator'],
    ]);
    off.unmount();
    // A row under its own session names no parent.
    const nested = render(<ProjectCard group={cardFor(frame({ activities: [activity({ parentId: 'coord-a' })] }))}
      onOpen={() => {}} onActions={() => {}} />);
    expect(parts(nested.container)).toEqual([['agent', 'explore the tree', 'not confirmed']]);
  });
  ```

  In `pwa/test/fleet-screen.test.tsx`, make the W4-U7c edit above, and add inside `describe('the fleet list\'s delegation marks …')`:

  ```ts
  const cardIn = (project: string): HTMLElement => {
    const c = [...document.querySelectorAll<HTMLElement>('.proj-card')].find((el) => el.querySelector('.proj-card-name')?.textContent === project);
    if (c === undefined) throw new Error(`no ${project} card`);
    return c;
  };
  const cellsOf = (root: Element): (string | null)[][] =>
    [...root.querySelectorAll('.proj-work')].map((r) => [...r.querySelectorAll('.proj-work-part')].map((p) => p.textContent));

  it('VIS-U1: an entry whose session is not listed is drawn once, in a closed region after the cards, from its raw id', () => {
    const store = makeLiveStore();
    renderFleet(<FleetScreen store={store} />);
    act(() => {
      const s = latestFleetSocket();
      s.open();
      s.message({ type: 'fleet', sessions: [session({ id: 'coord-a', project: 'project-a', workdir: '/work/project-a', status: 'busy', bucket: 'working' })] });
      s.message({ type: 'delegation', delegation: frame({ activities: [
        activity({ activityId: 'a-gone', parentId: 'coord-gone', displayName: 'map the tree', liveness: 'stale' }),
        activity({ activityId: 'a-here', parentId: 'coord-a', displayName: 'read the plan' }),
      ] }) });
    });
    const list = document.querySelector<HTMLElement>('.fleet-list')!;
    const toggle = within(list).getByRole('button', { name: 'Delegated work, session not listed (1)' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.hasAttribute('aria-controls')).toBe(false);
    expect(within(list).queryByText('map the tree')).toBeNull();
    const cards = list.querySelectorAll('.proj-card');
    expect(cards[cards.length - 1]!.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING, 'after every card').not.toBe(0);
    // A list region, not a card: never inside one, and its wrapper is a direct child of the list.
    expect(toggle.closest('.proj-card'), 'inside no card').toBeNull();
    expect(toggle.closest('.fleet-unlisted')?.parentElement, 'a child of the list').toBe(list);
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const body = document.getElementById(toggle.getAttribute('aria-controls')!);
    if (body === null) throw new Error('aria-controls names no element');
    expect(cellsOf(body)).toEqual([['agent', 'map the tree', 'stop not seen', 'from coord-gone']]);
    expect(within(list).getAllByText('map the tree')).toHaveLength(1);
    expect(Number(list.getAttribute('data-delegation-unplaced'))).toBe(cellsOf(body).length);
    // Spec §9, "No running claim": no delegation row, toggle or chip on the list says running in its title.
    const titles = [...list.querySelectorAll('.proj-work[title], .proj-group-toggle[title], .proj-children-toggle[title], .sess-meta-chip[title]')]
      .map((e) => e.getAttribute('title') ?? '');
    expect(titles.length).toBeGreaterThan(1);
    for (const t of titles) expect(t, t).not.toMatch(/running/i);
  });

  it('VIS-U2: no region when every parent is listed, nor once the frame is withdrawn', () => {
    const store = makeLiveStore();
    renderFleet(<FleetScreen store={store} />);
    act(() => {
      const s = latestFleetSocket();
      s.open();
      s.message({ type: 'fleet', sessions: [session({ id: 'coord-a', project: 'project-a', status: 'busy', bucket: 'working' })] });
      s.message({ type: 'delegation', delegation: frame({ activities: [activity({ parentId: 'coord-a' })] }) });
    });
    const list = (): HTMLElement => document.querySelector<HTMLElement>('.fleet-list')!;
    expect(within(list()).queryByRole('button', { name: /session not listed/ })).toBeNull();
    expect(list().hasAttribute('data-delegation-unplaced')).toBe(false);
    act(() => latestFleetSocket().message({ type: 'delegation', delegation: frame({ activities: [activity({ parentId: 'coord-gone' })] }) }));
    expect(within(list()).getByRole('button', { name: 'Delegated work, session not listed (1)' })).toBeTruthy();
    act(() => latestFleetSocket().message({ type: 'delegation', delegation: null }));
    expect(list().getAttribute('data-delegation')).toBe('unavailable');
    expect(within(list()).queryByRole('button', { name: /session not listed/ })).toBeNull();
    expect(list().hasAttribute('data-delegation-unplaced')).toBe(false);
  });

  it('VIS-U3: an archived or released parent is still listed: its entries stay in its card\'s offline group, from its label, never in the region', () => {
    const store = makeLiveStore();
    renderFleet(<FleetScreen store={store} />);
    act(() => {
      const s = latestFleetSocket();
      s.open();
      s.message({ type: 'fleet', sessions: [
        session({ id: 'coord-a', project: 'project-a', workdir: '/work/project-a', status: 'busy', bucket: 'working' }),
        session({ id: 'coord-arch', project: 'project-a', workdir: '/work/project-a-old', name: 'old coordinator', archivedAt: Date.now() - 60 * MIN }),
        session({ id: 'w-rel', project: 'project-a', workspace: 'w-rel', workdir: '/work/project-a/.ws/w-rel',
          releasedFrom: { runId: 9, program: 'port-api', programTitle: null, claimedBy: 'coord-a', closedAt: Date.now() - MIN, child: true } }),
      ] });
      s.message({ type: 'delegation', delegation: frame({ activities: [
        activity({ activityId: 'a-arch', parentId: 'coord-arch', displayName: 'old work' }),
        activity({ activityId: 'a-rel', parentId: 'w-rel', displayName: 'released work' }),
      ] }) });
    });
    const list = document.querySelector<HTMLElement>('.fleet-list')!;
    expect(list.hasAttribute('data-delegation-unplaced')).toBe(false);
    expect(within(list).queryByRole('button', { name: /session not listed/ })).toBeNull();
    fireEvent.click(within(cardIn('project-a')).getByRole('button', { name: /Offline coordinator \(2\)/ }));
    expect(cellsOf(cardIn('project-a'))).toEqual([
      ['agent', 'old work', 'not confirmed', 'from old coordinator'],
      ['agent', 'released work', 'not confirmed', 'from w-rel'],
    ]);
  });

  it('VIS-U4: an unchanged frame re-sent changes no word, and a parent that leaves the fleet takes its entries to the region', () => {
    const store = makeLiveStore();
    renderFleet(<FleetScreen store={store} />);
    const coordA = session({ id: 'coord-a', project: 'project-a', workdir: '/work/project-a', status: 'busy', bucket: 'working' });
    const coordB = session({ id: 'coord-b', project: 'project-a', workdir: '/work/project-a-b', status: 'busy', bucket: 'working' });
    const w = frame({ activities: [
      activity({ activityId: 'a-gone', parentId: 'coord-gone', displayName: 'map the tree', liveness: 'stale' }),
      activity({ activityId: 'a-b', parentId: 'coord-b', displayName: 'read the plan' }),
    ] });
    act(() => {
      const s = latestFleetSocket();
      s.open();
      s.message({ type: 'fleet', sessions: [coordA, coordB] });
      s.message({ type: 'delegation', delegation: w });
    });
    const list = (): HTMLElement => document.querySelector<HTMLElement>('.fleet-list')!;
    const toggle = (): HTMLElement => within(list()).getByRole('button', { name: /^Delegated work, session not listed/ });
    const region = (): (string | null)[][] => {
      const body = document.getElementById(toggle().getAttribute('aria-controls') ?? '');
      if (body === null) throw new Error('aria-controls names no element');
      return cellsOf(body);
    };
    fireEvent.click(toggle());
    expect(region()).toEqual([['agent', 'map the tree', 'stop not seen', 'from coord-gone']]);
    const before = list().innerHTML;
    const banners = document.querySelectorAll('.banner, .halt-banner').length;
    // The same frame again: the same words, the region still open, and no banner.
    act(() => latestFleetSocket().message({ type: 'delegation', delegation: w }));
    expect(list().innerHTML).toBe(before);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelectorAll('.banner, .halt-banner')).toHaveLength(banners);
    // coord-b leaves the fleet list: its entry leaves its card and joins the region, from its raw id, drawn once.
    act(() => latestFleetSocket().message({ type: 'fleet', sessions: [coordA] }));
    expect(toggle().textContent).toContain('Delegated work, session not listed (2)');
    expect(region()).toEqual([
      ['agent', 'read the plan', 'not confirmed', 'from coord-b'],
      ['agent', 'map the tree', 'stop not seen', 'from coord-gone'],
    ]);
    expect(within(list()).getAllByText('read the plan')).toHaveLength(1);
    expect(list().getAttribute('data-delegation-unplaced')).toBe('2');
  });
  ```

  The region's two rows share an `openedAt`, so `byOpened` orders them by id (`a-b` before `a-gone`).

  In `pwa/test/fleet-css.test.ts`, inside the describe Task 2 added at the end of the file, add:

  ```ts
    it('VIS-CSS1: the fleet foot\'s region is a grid item of .fleet-list with the card\'s floor, a min-width of 0', () => {
      expect(declValue(ruleFor('.fleet-unlisted'), 'min-width')).toBe('0');
    });
  ```

  In `pwa/browser/delegation-rows.browser.test.ts` (the real-Chrome fit check; jsdom applies no stylesheet):
  - In the header comment, after the sentence that ends `a worktree whose parent is gone and one unowned tree.`, add: `One activity's session is in no fleet list, so the fleet foot's region draws it, with a long name and a long raw session id; the region is opened too.`
  - In `DELEGATION.activities`, after the `a-chip` entry, add:
    ```ts
      activity({ activityId: 'a-unlisted', parentId: 'gone-session-from-an-earlier-run-with-a-long-identifier-of-its-own',
        displayName: 'reconcile every reader of the projection frame across the server, the agent and the PWA trees' }),
    ```
  - In `open`, after the `for (const name of ['Offline coordinator', 'Unowned work'])` loop, add:
    ```ts
      await opened.page.locator('.fleet-unlisted .proj-group-toggle').click();
    ```
  - In `measureRows`, replace `document.querySelectorAll<HTMLElement>('.proj-work')` with `document.querySelectorAll<HTMLElement>('.proj-card .proj-work')`, and its doc comment's first words `Every delegation row on the page` with `Every delegation row on a card`, so a region row (in no card) is measured by `measureUnlisted` instead and `row.closest('.proj-card')!` never meets one.
  - After `measureRows`, add:
    ```ts
    /** The fleet foot's region and each of its rows: inside the fleet list's box, and nothing overflowing its own box. A
     *  region without its `min-width: 0` widens the list's one grid track past the list, which this sees at every width,
     *  the desk sidebar's included (where the page itself does not scroll). */
    const measureUnlisted = (): { text: string; inList: boolean; overflow: number }[] => {
      const list = document.querySelector<HTMLElement>('.fleet-list')!.getBoundingClientRect();
      const within = (a: DOMRect, b: DOMRect): boolean => a.left >= b.left - 0.5 && a.right <= b.right + 0.5;
      return [...document.querySelectorAll<HTMLElement>('.fleet-unlisted, .fleet-unlisted .proj-work')].map((el) => ({
        text: el.textContent ?? '', inList: within(el.getBoundingClientRect(), list), overflow: el.scrollWidth - el.clientWidth,
      }));
    };
    ```
  - In the test body, after the `for (const row of rows) { … }` loop, add:
    ```ts
          const unlisted = await page.evaluate(measureUnlisted);
          expect(unlisted, 'the region and its one row').toHaveLength(2);
          for (const u of unlisted) {
            expect(u.inList, `${u.text}: inside the fleet list`).toBe(true);
            expect(u.overflow, `${u.text}: nothing overflows it`).toBeLessThanOrEqual(1);
          }
    ```

- [ ] **Step 2: Run them and watch them fail.**

  ```
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/fleetTree.test.ts
  ```

  Expected: FAIL. W4-U36 and VIS-T1 fail because `unplacedActivities` returns a number (`.map` is not a function, and `toEqual([])` meets `0`).

  ```
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/project-card.test.tsx
  ```

  Expected: FAIL. VIS-P1's offline rows have no `from` part.

  ```
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/fleet-screen.test.tsx
  ```

  Expected: FAIL. VIS-U1, VIS-U2 and VIS-U4 find no region button, VIS-U3's rows have no `from` part, and W4-U7c's offline rows have no `from` part.

  ```
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/fleet-css.test.ts
  ```

  Expected: FAIL. VIS-CSS1 fails with `no rule for .fleet-unlisted`.

- [ ] **Step 3: Implement.**

  In `pwa/src/fleet/fleetTree.ts`, change `import { readDelegation } from './delegationWords';` to `import { byOpened, readDelegation } from './delegationWords';`, and replace `unplacedActivities` and its docstring with:

  ```ts
  /** Delegation visibility (spec §5): the frame's activities no card draws (`delegationSlices`' card rule: their parent
   *  is not in the fleet list, and an activity carries no project of its own), in opening order. THE ONE SELECTION: the
   *  fleet foot's region lists exactly these, and `data-delegation-unplaced` is their count. A parent the list carries,
   *  archived or released included, keeps its entries on its card (its offline group). Empty when the projection is
   *  unavailable. */
  export function unplacedActivities(
    sessions: readonly FleetSession[], delegation: DelegationProjectionWire | null,
  ): readonly DelegationActivityWire[] {
    if (delegation === null) return [];
    const ids = new Set(sessions.map((s) => s.id));
    return readDelegation(delegation).activities.filter((a) => !ids.has(a.parentId)).sort(byOpened);
  }
  ```

  In `pwa/src/fleet/FleetCards.tsx`:
  - Change the React import to `import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';`.
  - Add after `import { acksSnapshot, subscribeAcks } from '../lib/seen';`:
    ```tsx
    import { BareRow } from '@ccrc/ui';
    import { UNLISTED_WORDS, activityLine, unlistedToggle } from './delegationWords';
    import { WorkLine } from './WorkLine';
    ```
  - Change `import type { FleetSession } from '../../../shared/api';` to `import type { DelegationActivityWire, FleetSession } from '../../../shared/api';`.
  - Replace `data-delegation-unplaced={unplaced > 0 ? unplaced : undefined}` with `data-delegation-unplaced={unplaced.length > 0 ? unplaced.length : undefined}`.
  - After the `{tree.map((g) => ( … ))}` block, before the closing `</div>`, add:
    ```tsx
        {/* Delegation visibility (spec §5): entries whose session the list does not carry, after every card. Mounted only
            with entries, so a fleet with none, an older server's included, renders what it rendered before (W4-U27) and
            calls no hook it did not call. */}
        {unplaced.length > 0 && <UnlistedWork entries={unplaced} />}
    ```
  - Add at the end of the file:
    ```tsx
    /** The fleet foot's region (delegation visibility, spec §5): closed by default, its open state this mount's own (no
     *  stored key, so no new storage owner). Each row names its session by raw id, since no listed session can name it.
     *  It draws what the words module spells and decides nothing. */
    function UnlistedWork({ entries }: { entries: readonly DelegationActivityWire[] }): ReactNode {
      const [open, setOpen] = useState(false);
      const bodyId = useId();
      return (
        <div className="fleet-unlisted">
          <BareRow
            className="proj-group-toggle"
            aria-expanded={open}
            aria-controls={open ? bodyId : undefined}
            title={UNLISTED_WORDS.title}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="proj-card-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
            {unlistedToggle(entries.length)}
          </BareRow>
          {open && (
            <div id={bodyId} className="fleet-unlisted-body">
              {entries.map((a) => {
                const line = activityLine(a, a.parentId);
                return <WorkLine key={a.activityId} parts={line.parts} title={line.title} />;
              })}
            </div>
          )}
        </div>
      );
    }
    ```

  In `pwa/src/fleet/fleet.css`, directly after the `.fleet-list { … }` rule, add:

  ```css
  /* The fleet foot's region of work whose session is not listed: a grid item of .fleet-list, like .proj-card, so it
     takes the card's floor. A grid item's automatic minimum is its min-content width, and its rows' words are
     white-space: nowrap (.proj-work-parts), so without this one long row widens the list's one track and scrolls the
     pane sideways. */
  .fleet-unlisted { min-width: 0; }
  ```

  In `pwa/src/fleet/ProjectCard.tsx`, replace:

  ```ts
  // A worktree's `via` worker by its display name, or its raw id when the fleet does not carry it.
  const viaLabel = (id: string | null): string | null => {
    if (id === null) return null;
    const s = coordOf(id);
    return s === null ? id : sessionLabel(s);
  };
  ```

  with:

  ```ts
  // A session by its display name, or its raw id when the fleet does not carry it: a worktree's `via` worker, and the
  // session an offline-group row came from (delegation visibility, spec §5). Display only, never a join key.
  const labelOf = (id: string | null): string | null => {
    if (id === null) return null;
    const s = coordOf(id);
    return s === null ? id : sessionLabel(s);
  };
  /** The `from` label of a row in the offline group. A row under its own session names none. */
  const fromOf = (rowGroup: DelegationGroupKind | null, parentId: string): string | null =>
    rowGroup === 'offline-coordinator' ? labelOf(parentId) : null;
  ```

  and in `rowBody` replace `const a = activityLine(row.activity);` with `const a = activityLine(row.activity, fromOf(row.group, row.activity.parentId));`, and `const w = worktreeLine(row.lease, viaLabel(row.via), workingOnCard({ project: row.lease.project }, group.project));` with:

  ```ts
      const w = worktreeLine(row.lease, labelOf(row.via), workingOnCard({ project: row.lease.project }, group.project),
        fromOf(row.group, row.lease.parentId));
  ```

- [ ] **Step 4: Run them and watch them pass**, one file per run:

  ```
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/fleetTree.test.ts
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/project-card.test.tsx
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/fleet-screen.test.tsx
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/older-server-render.test.tsx
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/fleet-css.test.ts
  cd pwa && ccrc test -- ./node_modules/.bin/tsc --noEmit
  ```

  Expected: PASS for each. `older-server-render.test.tsx` (W4-U27) passes unedited and byte for byte: with no frame, `unplaced` is empty and `UnlistedWork` never mounts.

  The browser file runs only where a Chrome binary is on the box. If `CCRC_CHROME` is set in your environment, run it from `pwa/`:

  ```
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run --config vitest.browser.config.ts --maxWorkers=2 browser/delegation-rows.browser.test.ts
  ```

  Expected: PASS at 390, 1280 and 1920 in both skins and both palettes. If no Chrome is on the box, say so in the wave-done report: the PR's `browser (pwa)` leg is then the arbiter (Task 4, Step 6).

- [ ] **Step 5: Commit.**

  ```
  git add pwa/src/fleet/fleetTree.ts pwa/src/fleet/FleetCards.tsx pwa/src/fleet/ProjectCard.tsx pwa/src/fleet/fleet.css \
    pwa/test/fleetTree.test.ts pwa/test/project-card.test.tsx pwa/test/fleet-screen.test.tsx pwa/test/fleet-css.test.ts \
    pwa/browser/delegation-rows.browser.test.ts
  git commit -m "feat(pwa): entries whose session is not listed get a region at the fleet's foot, and off-row entries name their session"
  ```

  End the message with the attribution trailer.

## Task 4: Verification and hand-off

**Files:** none changed, unless a step below finds a defect. A defect fix is its own commit, and a departure from this plan goes in `docs/superpowers/plans/2026-11-02-delegation-visibility/pr.md`.

**Interfaces.** Consumes everything above and produces the PR and the wave-done report.

- [ ] **Step 1: Mutants (spec §9, and each new guard).** Apply one mutant at a time to the named file, using this procedure (shown for VIS-M1). Shell variables do not survive between tool calls, so each command below is its own call, run from the worktree root, and each spells its scratch path in full: `${TMPDIR:-/tmp}/vis-mutants/<the mutant's id, lower case>`, outside the tree. The edit itself is an Edit tool call between the first command and the second.

  ```
  mkdir -p "${TMPDIR:-/tmp}/vis-mutants/vis-m1" && cp pwa/src/fleet/delegationWords.ts "${TMPDIR:-/tmp}/vis-mutants/vis-m1/orig" && sha256sum pwa/src/fleet/delegationWords.ts > "${TMPDIR:-/tmp}/vis-mutants/vis-m1/sum"
  ```

  Apply the mutant's one edit with the Edit tool. Then:

  ```
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/delegation-words.test.ts
  ```

  Expected: FAIL on the named rows. Then restore from the copy and check its sha:

  ```
  cp "${TMPDIR:-/tmp}/vis-mutants/vis-m1/orig" pwa/src/fleet/delegationWords.ts && sha256sum -c "${TMPDIR:-/tmp}/vis-mutants/vis-m1/sum"
  ```

  Expected: `pwa/src/fleet/delegationWords.ts: OK`. For a CSS mutant, the file is `pwa/src/fleet/fleet.css` or `pwa/src/session/chat.css` and the test file is `test/fleet-css.test.ts`.

  | Mutant | File | The one edit | Must go red |
  |---|---|---|---|
  | VIS-M1 | `pwa/src/fleet/delegationWords.ts` | `word: 'not confirmed',` → `word: 'running',` | VIS-W1 and VIS-W2 (`delegation-words.test.ts`); W4-U7c (`fleet-screen.test.tsx`) |
  | VIS-M2 | `pwa/src/fleet/sessionFacts.ts` | `delegated: delegatedChip(delegated ?? []),` → `delegated: dead ? null : delegatedChip(delegated ?? []),` | W4-U34 (`card-header-facts.test.tsx`) |
  | VIS-M3 | `pwa/src/fleet/FleetCards.tsx` | delete `{unplaced.length > 0 && <UnlistedWork entries={unplaced} />}` | VIS-U1, VIS-U2 (`fleet-screen.test.tsx`) |
  | VIS-M4 | `pwa/src/fleet/sessionFacts.ts` | in `holds`, replace the whole body after `=>` with `h.key === c.key && h.text.startsWith(c.text)` | VIS-C1 (`card-header-facts.test.tsx`) |
  | VIS-M5 | `pwa/src/fleet/fleetTree.ts` | `const ids = new Set(sessions.map((s) => s.id));` → `const ids = new Set(sessions.filter((s) => s.bucket !== 'archived' && s.releasedFrom === null).map((s) => s.id));` | VIS-T1 (`fleetTree.test.ts`); VIS-U3 (`fleet-screen.test.tsx`) |
  | VIS-M6 | `pwa/src/fleet/ProjectCard.tsx` | `rowGroup === 'offline-coordinator' ? labelOf(parentId) : null` → `null` | VIS-P1 (`project-card.test.tsx`); VIS-U3 |
  | VIS-M7 | `pwa/src/fleet/delegationWords.ts` | in `activitiesStartedBy`, `a.parentId === id` → `a.parentId === id && a.placement === 'chip'` | VIS-W3 (`delegation-words.test.ts`) |
  | VIS-M8 | `pwa/src/fleet/SessionMeta.tsx` | `aria-controls={delegatedOpen ? delegatedId : undefined}` → `aria-controls={delegatedId}` | VIS-H1 (`card-header-facts.test.tsx`) |
  | VIS-M9 | `pwa/src/fleet/delegationWords.ts` | in `delegatedChip`, `const n = activities.length;` → `const n = activities.filter((a) => a.liveness === 'live').length;` | W4-U8 (`delegation-words.test.ts`) |
  | VIS-M10 | `pwa/src/fleet/delegationWords.ts` | in `qualifierOf`, `: LIVENESS_QUALIFIER.unmeasured;` → `: LIVENESS_QUALIFIER.live;` | VIS-W1 (`delegation-words.test.ts`), its direct case |
  | VIS-M11 | `pwa/src/screens/SessionScreen.tsx` | `activitiesStartedBy(live.id, readDelegation(delegation)),` → `activitiesStartedBy(live.id, readDelegation(delegation)).filter((a) => a.placement === 'chip'),` | VIS-S1 (`session-lifecycle.test.tsx`) |
  | VIS-M12 | `pwa/src/fleet/fleet.css` | delete the declaration `min-width: 0;` from `.fleet-unlisted { min-width: 0; }`, leaving `.fleet-unlisted { }` | VIS-CSS1 (`fleet-css.test.ts`); where Chrome is on the box, `delegation-rows.browser.test.ts` at 390 too |
  | VIS-M13 | `pwa/src/fleet/sessionFacts.ts` | in `holds`, `c.count !== undefined && h.count !== undefined && h.count >= c.count` → `(h.count ?? 0) >= (c.count ?? 0)` | VIS-C1 (`card-header-facts.test.tsx`), its count-less cases |
  | VIS-M14 | `pwa/src/session/chat.css` | in `.chat-facts .sess-entries`, delete ` min-width: 0;` | VIS-CSS2 (`fleet-css.test.ts`) |

  Run each "must go red" file. For a mutant that names two files, run each file. Record every result (red rows, then green after the restore) for the PR body. A mutant that stays green is a defect in the test: fix the test in a commit of its own, and measure again.

- [ ] **Step 2: Every changed and census suite, one file per run, from `pwa/`:**

  ```
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/delegation-words.test.ts
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/card-header-facts.test.tsx
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/fleet-screen.test.tsx
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/fleetTree.test.ts
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/project-card.test.tsx
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/nestFleet.test.ts
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/rollup.test.ts
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/fleet-rollup-render.test.tsx
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/older-server-render.test.tsx
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/stores.test.ts
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/session-line.test.tsx
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/session-lifecycle.test.tsx
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/session-header-view.test.ts
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/programme-box.test.ts
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/programme-box-card.test.tsx
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/hook-class-collision.test.ts
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/build-and-spend.test.ts
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/shell-css.test.ts
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/control-census.test.ts
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/literal-census.test.ts
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/markup-census.test.ts
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/shape-census.test.ts
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/role-census.test.ts
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/w7-storage-keys.test.ts
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/fleet-css.test.ts
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/css-vars.test.ts
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/tap-targets.test.tsx
  cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/contrast.test.ts
  cd pwa && ccrc test -- ./node_modules/.bin/tsc --noEmit
  ```

  Expected: PASS for each. The fold is unchanged (spec §6): `rollup.test.ts`, `fleet-rollup-render.test.tsx` and `project-card.test.tsx`'s "folds three delegated activities into one line" pass unedited, and so do the programme box footer totals (`programme-box.test.ts`, `programme-box-card.test.tsx`; spec §9 "Fold unchanged"). `older-server-render.test.tsx` (W4-U27) passes unedited. `hook-class-collision.test.ts` passes with `BareRow` wearing `proj-group-toggle` in a second file (`FleetCards.tsx`), because it is the same `@ccrc/ui` component in both. `build-and-spend.test.ts` and `shell-css.test.ts` read `SessionDetails.tsx` and pass with its new state and list.

- [ ] **Step 3: The server-side censuses and rings, one file per run, from `server/`:**

  ```
  cd server && ccrc test -- ./node_modules/.bin/vitest run test/delegation-wave3.integration.test.ts
  cd server && ccrc test -- ./node_modules/.bin/vitest run test/fleet-health.test.ts
  cd server && ccrc test -- ./node_modules/.bin/vitest run test/rings/pwa-rings.test.ts
  cd server && ccrc test -- ./node_modules/.bin/vitest run test/rings/totality.test.ts
  cd server && ccrc test -- ./node_modules/.bin/vitest run test/rings/pwa-one-owner.test.ts
  cd server && ccrc test -- ./node_modules/.bin/vitest run test/census-w7/pwa.test.ts
  cd server && ccrc test -- ./node_modules/.bin/vitest run test/citations.test.ts
  cd server && ccrc test -- ./node_modules/.bin/vitest run test/anchors.test.ts
  ```

  Then run each file listed by `ls server/test/single-definition/*.test.ts`, one run per file. Then `git fetch origin main`, followed by `cd server && ccrc test -- ./node_modules/.bin/vitest run test/deviation-refs.test.ts`.

  Expected: PASS for each, with `W4_PWA_FILES` unchanged. If §8 of the closed scope census names `pwa/src/fleet/WorkLine.tsx` or `pwa/src/session/SessionDetails.tsx`, one of them names `delegation` or `lease` in its code. Prefer removing the word, since neither file needs it (their words arrive from `sessionFacts` and the words module). If a file must join the list after all, add it to both tests (`delegation-wave3.integration.test.ts` §8 and its `fleet-health.test.ts` mirror) in this PR, record the reason in the note `docs/superpowers/plans/2026-11-02-delegation-visibility/pr.md` with a number from 7783 to 7786, and say so in the PR body (spec §3).

- [ ] **Step 4: Measure the footprint (read-only).** Check that `git diff --stat origin/main...HEAD` lists only the files these tasks name. Check that `git diff origin/main...HEAD -- shared/api.ts` changes comment lines only. Check that no file under `docs/superpowers/plans/` or `docs/superpowers/programs/` other than this plan's new `pr.md` note (if one exists) appears in the diff.

- [ ] **Step 5: Push and open the PR.** List mail first. Push this workspace's branch, then open the PR. Its title is `feat(pwa): honest delegation words, every recorded entry reachable (delegation visibility)`, and its body is the text below, completed with the measured table. Scan the title and body for private names before posting.

  ```markdown
  Delegation visibility, first release (spec `docs/superpowers/specs/2026-11-02-delegation-visibility-design.md`,
  plan `docs/superpowers/plans/2026-11-02-delegation-visibility.md`). A change to the PWA only: no server, wire,
  durable-format, timer or storage change. `shared/api.ts` changes in two comments.

  ## What changes
  - No delegation row, chip or title says "running". Rows show what the broker recorded: `not confirmed`,
    `stop not seen`, `unmeasured`, `end recorded`. Titles say "last recorded hook event", never helper activity.
    The "Offline coordinator" group's title loses its "running" too ("…is no longer the one that started it…").
  - A session's `N delegated` chip counts every attached entry, of every liveness, on live and dead rows (D-7781).
  - The session header lists every entry the session started, behind a disclosure in the subagent toggle's pattern.
    The card-within-header rule compares the `delegated` fact by count (D-7782).
  - Entries whose session the fleet list no longer carries get a closed-by-default region at the foot of the list.
    Offline-group and unlisted rows say which session they came from (display only). The region and the header's
    list each take `min-width: 0`, the floor a project card already has, so a long row never scrolls sideways.

  ## What this release does not do
  - It makes no claim about which helpers did useful work recently. No recent counts, no "quiet" claims.
  - It records no ends. Entries whose stop was never seen keep accumulating until automatic repair exists; the
    existing fold is the only compaction, unchanged.

  ## Pins changed by design
  W4-U8, W4-U9, W4-U10 (`delegation-words.test.ts`); W4-U33, W4-U34, W4-U35 (`card-header-facts.test.tsx`);
  W4-U7c (`fleet-screen.test.tsx`; its rows, and a new scan of its titles); W4-U36 (`fleetTree.test.ts`);
  `delegation-rows.browser.test.ts` (a region row added and measured). W4-U27 is unchanged and green byte for byte.

  ## Mutants (measured)
  | Mutant | Edit | Red rows | Restored, green |
  |---|---|---|---|
  | VIS-M1 … VIS-M14 | (from the plan's Task 4) | (measured) | (measured) |
  ```

  End the body with the attribution line your session's instructions require.

- [ ] **Step 6: Wave-done.** Wait for the PR's selected CI run on the exact tip, and check its `select tests` summary lists the changed test files. The `browser (pwa)` leg must be green on that tip, and a green leg on a pull request can be a skip: open its log and check that `browser/delegation-rows.browser.test.ts` ran. Its rows changed in this PR (the offline row gains `not confirmed` and `from coord-gone`, and the region is new), so a skipped leg is not evidence; if it was skipped, start the full mode on the branch (`gh workflow run ci.yml --ref "$(git branch --show-current)" -f mode=full`) and wait for its `browser (pwa)` leg before reporting. Then list mail again, and report wave-done to the coordinator as the `ccrc-worker` skill describes. The report carries the PR number, the handoff commit (`git rev-parse HEAD`, equal to the pushed branch tip), the green CI run on that tip, the mutant table, and any departure note with the numbers it took from 7783 to 7786.

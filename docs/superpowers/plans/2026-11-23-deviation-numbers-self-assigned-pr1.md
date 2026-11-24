# Deviation numbers self-assigned, PR 1 (the rule) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anyone can number a deviation with no server: a helper prints the next numbers, the collision guard is
widened for the new range, every instruction says so, and the allocator answers 410.

**Architecture:** One pure decider in `server/src/coord/ledger.ts` (L1) computes the next numbers from definitions;
one git reader in a new `server/scripts/next-deviation.ts` feeds it from `origin/main` and is reused by
`deviation-refs.test.ts`. The allocator route is switched off in place, and the two ledger sweeps are no longer
dispatched; their code is deleted in PR 2.

**Tech Stack:** TypeScript, vitest, tsx (already a server devDependency), git plumbing.

**Spec:** `docs/superpowers/specs/2026-11-23-deviation-numbers-self-assigned-design.md`

## Global Constraints

- The next number is `max(highest D-N defined on origin/main + 1, 10000)`; a block of k takes consecutive numbers.
- Definitions are read from `docs/superpowers/plans/`, `docs/superpowers/programs/` and `docs/superpowers/specs/`,
  with `definitionsIn` (fenced blocks skipped). The helper never calls the network or the server.
- `SELF_ASSIGNED_ERA = 10000`, exported once from `server/src/coord/ledger.ts`; nothing else spells 10000.
- Below 10000 every existing guard behaves exactly as on `main`; the grandfathered sets are not edited.
- A concrete `D-TBD-` placeholder still never lands (`dtbd.test.ts` unchanged except its message).
- Public repo: no private names in fixtures or text. Fixtures use neutral file names.
- No new `D-N` is allocated by this plan; if a deviation is found, record it in this plan's ledger with a number from
  Task 1's helper, which is the rule this plan ships.

## Review Focus

1. A branch based on an old `main` runs the helper → it must read `origin/main` (after `git fetch`), not `HEAD`; the
   helper prints the ref and its short sha so a stale base is visible. Pinned in Task 1.
2. `origin/main` missing (a fork with only `upstream`) → the helper measures `upstream/main` by itself (one
   resolver with the guard); with no base at all it exits non-zero naming both remotes and the `--ref` flag, never
   prints a number from an empty scan. Pinned in Task 1.
3. Two task notes in different programmes with the same basename (`task-1.md`) → paths must stay repo-relative in
   the widened scan, or two unrelated notes collide. Pinned in Task 2.
4. The same file on both trees defining the same new number once → not a collision (every unmerged note is on both
   sides of a rebased branch). Pinned in Task 2.
5. A self-assigned number restated inside a fenced quotation in another file → not a definition. Covered by
   `definitionsIn`'s existing fence tests; Task 2 adds one fixture at ≥ 10000.

---

### Task 1: The next numbers, computed and printed

**Files:**
- Modify: `server/src/coord/ledger.ts` (beside `crossTreeCollisions`)
- Create: `server/scripts/next-deviation.ts`
- Modify: `server/package.json` (script `"next-deviation": "tsx scripts/next-deviation.ts"`)
- Test: `server/test/next-deviation.test.ts`

**Interfaces:**
- Produces: `export const SELF_ASSIGNED_ERA = 10000;`
- Produces: `export function nextDeviationNumbers(defs: readonly Definition[], count: number): number[]` — pure;
  `count` an integer 1..`LEDGER_ALLOC_MAX`, else throws `RangeError`.
- Produces (script): `export const DEFINITION_DIRS = ['docs/superpowers/plans/', 'docs/superpowers/programs/', 'docs/superpowers/specs/'] as const;`
  and `export function readDefinitionFilesAt(root: string, ref: string): { path: string; text: string }[]` —
  repo-relative paths, `.md` only, one `ls-tree` plus `cat-file` per file (the shape of `readPlansAt` today).
- CLI: `npm run next-deviation -- [count] [--ref <ref>]`, default count 1, default ref `origin/main`. Prints
  `measured <ref> at <short sha>` on stderr, then one `D-<n>` per line on stdout. Exit 2 on a bad argument or an
  unresolvable ref, with a message naming `git fetch origin main` and `--ref`.

- [ ] **Step 1: Write the failing tests** in `server/test/next-deviation.test.ts`:

```ts
const d = (n: number, file = 'docs/superpowers/plans/a.md') => ({ file, n });
it('starts at the era when everything is below it', () => {
  expect(nextDeviationNumbers([d(8966)], 3)).toEqual([10000, 10001, 10002]);
});
it('continues past the highest at or above the era', () => {
  expect(nextDeviationNumbers([d(8966), d(10004), d(10001)], 2)).toEqual([10005, 10006]);
});
it('an empty tree starts at the era', () => {
  expect(nextDeviationNumbers([], 1)).toEqual([10000]);
});
it('refuses a count outside 1..LEDGER_ALLOC_MAX', () => {
  for (const bad of [0, -1, 1.5, LEDGER_ALLOC_MAX + 1]) expect(() => nextDeviationNumbers([], bad)).toThrow(RangeError);
});
it('the CLI prints the numbers for a fixture repo and names the ref it measured', () => { /* a temp git repo
  (tmpHelpers), one commit with docs/superpowers/programs/p/task-1.md defining D-10003, a ref named origin/main;
  run tsx scripts/next-deviation.ts 2 --ref origin/main with cwd at the repo; expect stdout 'D-10004\nD-10005\n'
  and stderr to contain 'origin/main at' */ });
it('the CLI exits 2 and names --ref when the ref does not resolve', () => { /* same repo, --ref nope:
  status 2, stderr contains '--ref' and 'git fetch origin main', stdout empty */ });
```

- [ ] **Step 2: Run** `cd server && ./node_modules/.bin/vitest run test/next-deviation.test.ts` — expect FAIL
  (`nextDeviationNumbers` is not exported).
- [ ] **Step 3: Implement** the constant and the decider in `ledger.ts`, then the script. The script resolves the
  repo root with `git rev-parse --show-toplevel` from its cwd, so it works from `server/` or the root.
- [ ] **Step 4: Run** the same command — expect PASS. Then from the repo root on this branch:
  `cd server && npm run next-deviation -- 3` prints three numbers from `D-10000` up.
- [ ] **Step 5: Commit** `feat(ledger): the next deviation numbers, computed from origin/main with no server`.

### Task 2: The collision guard, widened for the new range

**Files:**
- Modify: `server/src/coord/ledger.ts`
- Modify: `server/test/deviation-refs.test.ts`
- Test: `server/test/ledger-crosstree.test.ts` (fixtures)

**Interfaces:**
- Consumes: `SELF_ASSIGNED_ERA`, `readDefinitionFilesAt`, `DEFINITION_DIRS` (Task 1).
- Produces: `export function selfAssignedCollisions(branch: Files, base: Files): CrossTreeCollision[]` where
  `Files = readonly { readonly path: string; readonly text: string }[]`. For n ≥ `SELF_ASSIGNED_ERA` only: a
  collision when n is defined in two distinct paths across both trees, or twice in one path within one tree. The
  same path defining n once in each tree is not a collision. `files` lists each path once per defining line, sorted,
  so a same-file double shows the path twice.

- [ ] **Step 1: Write the failing fixtures** in `ledger-crosstree.test.ts` (`selfAssignedCollisions`):
  - two paths, one per tree, both defining D-10007 → `[{ n: 10007, files: [pathA, pathB] }]`;
  - one path defining D-10007 on two lines in the branch → `[{ n: 10007, files: [p, p] }]`;
  - the same path on both trees, one definition each → `[]`;
  - `docs/superpowers/programs/x/task-1.md` and `docs/superpowers/programs/y/task-1.md` each defining D-10009 → one
    collision naming both full paths (Review Focus 3);
  - D-10011 defined in one file and quoted inside a fenced block in another → `[]` (Review Focus 5);
  - D-8000 defined twice in one file and in two files → `[]` (below the era: left to the old rule).
- [ ] **Step 2: Run** `./node_modules/.bin/vitest run test/ledger-crosstree.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** `selfAssignedCollisions` in `ledger.ts` beside `crossTreeCollisions`.
- [ ] **Step 4: Wire it** into `deviation-refs.test.ts`'s cross-tree block: a new `it('no self-assigned D-<n> is
  defined twice across this branch and its base')` reading both trees with `readDefinitionFilesAt(ROOT, ref)` for
  `HEAD` and `LEDGER_BASE`; its failure message names `npm run next-deviation` and says to renumber the entry and
  every reference to it. `readPlansAt` and the old rule stay as they are. Replace the two messages that say
  "allocate through POST /api/ledger/deviations" (the subject scanner's and the cross-tree one's) and `dtbd.test.ts`'s
  message with the helper's command.
- [ ] **Step 5: Run** `./node_modules/.bin/vitest run test/ledger-crosstree.test.ts test/deviation-refs.test.ts test/dtbd.test.ts`
  after `git fetch origin main` — expect PASS. Delete `selfAssignedCollisions`'s two-tree union line and rerun to see
  the first fixture go red; restore.
- [ ] **Step 6: Commit** `feat(ledger): self-assigned numbers collide loudly across plans, notes and specs`.

### Task 3: The allocator switched off

**Files:**
- Modify: `server/src/coord/routes.ts` (`POST /api/ledger/deviations`)
- Modify: `server/src/watch.ts` (the tick's two `void this.sweepLedger…` lines)
- Modify: the route's and sweeps' tests: `server/test/ledger-routes.test.ts`, `ledger-race.test.ts`,
  `ledger-sweep.test.ts`, `ledgerseed.test.ts`, `ccrc-api.test.ts` as each needs

**Interfaces:**
- The route keeps its path and its box-token check (the EXEMPT row and census stay true until PR 2), then answers
  `410` with `{ ok: false, error: 'retired', detail: 'deviation numbers are self-assigned: cd server && npm run next-deviation -- <count>' }`.
  It writes nothing: no floor seed, no allocation row, no log line.
- `GET /api/ledger` is unchanged (a read of history).
- The tick no longer dispatches `sweepLedgerFloor` or `sweepLedgerReconcile`; the methods stay for PR 2 to delete.

- [ ] **Step 1: Write the failing test** in `ledger-routes.test.ts`: a valid, box-token-carrying allocation request
  answers 410 with `error: 'retired'` and a `detail` containing `next-deviation`; afterwards `GET /api/ledger`
  shows the same allocations and floor as before the call. Without the token it is still 401.
- [ ] **Step 2: Run** `./node_modules/.bin/vitest run test/ledger-routes.test.ts` — expect FAIL (200).
- [ ] **Step 3: Implement** the 410 in place of the handler body after `requireMailToken`; remove the two dispatch
  lines from the tick with a one-line comment naming this plan.
- [ ] **Step 4: Run** every ledger suite: `./node_modules/.bin/vitest run test/ledger test/ledgerlog.test.ts test/ledgerseed.test.ts test/ccrc-api.test.ts test/journal-log-first.test.ts test/coord-db.test.ts`.
  Cases that drive the route to allocate move to calling `allocateDeviations`/the store directly where they test
  the store; cases that only test the route's allocation answer are deleted with the route's behaviour. Cases that
  assert the tick calls the sweeps are inverted. Expect PASS.
- [ ] **Step 5: Commit** `feat(ledger): the allocator answers 410 and the ledger sweeps stop`.

### Task 4: The words

**Files:**
- Modify: `CLAUDE.md` (the **Deviation ledger (D-N)** bullet), `CONTRIBUTING.md` (the ledger paragraph),
  `README.md` (the allocator section and the `ledger list|allocate` verb line), `shared/api.ts` (the sentence
  "Never invent a deviation number…")
- Modify: `ccd/coordinator-skill/SKILL.md` clause 10, `ccd/worker-skill/SKILL.md` clause 11's last sentence,
  `ccd/reviewer-skill/SKILL.md` clause 6 (drop `POST /api/ledger/deviations` from the list it never calls),
  `ccd/coordinator-skill/references/{peer-protocol,decision-procedure,cross-project,wave-lifecycle-run-care}.md`
- Test: `server/test/ledger-instruction.test.ts`, `coordinator-skill.test.ts`, `worker-skill.test.ts`,
  `reviewer-skill.test.ts`

**The text (exact where it is pinned):**
- Coordinator clause 10 opens: "This session takes the program's deviation numbers with `npm run next-deviation`
  (in `server/`) when a wave records one, and names them in the brief; a worker takes its own the same way." The
  rest of the clause is unchanged.
- Worker clause 11's last sentence: "Never invent a deviation number by hand: take it with `npm run next-deviation`
  (in `server/`), after `git fetch origin main`, and if two branches took the same one, the one that lands second
  renumbers."
- `shared/api.ts`: "Take a deviation number with npm run next-deviation in server/, after git fetch origin main; a
  collision is caught at merge and the second to land renumbers."
- CLAUDE.md and CONTRIBUTING.md say: the number is self-assigned with the helper, the rule
  (`max(highest + 1, 10000)`), where definitions live (the three directories), that the cross-tree check plus the
  merge queue catch a collision, and that the allocator retired on this date. CLAUDE.md drops the floor paragraph
  ("WHAT THE FLOOR IS") down to one sentence of history.

- [ ] **Step 1: Rewrite the pins first.** In `ledger-instruction.test.ts` the CLAUDE.md and CONTRIBUTING.md cases
  now assert each passage contains `next-deviation` and `10000`, and does not contain `POST /api/ledger/deviations`
  as an instruction (it may appear once in a sentence containing `retired`). `BY_SCANNING` is retired with its
  liveness case: reading `origin/main` is now the rule, through the helper. The account-provisioning spec case
  stays. In the three skill tests, replace the pinned clause strings with the text above.
- [ ] **Step 2: Run** `./node_modules/.bin/vitest run test/ledger-instruction.test.ts test/coordinator-skill.test.ts test/worker-skill.test.ts test/reviewer-skill.test.ts`
  — expect FAIL on every changed pin.
- [ ] **Step 3: Edit the words** in every file listed above.
- [ ] **Step 4: Run** the same command, then the tree guards: `./node_modules/.bin/vitest run test/dtbd.test.ts test/deviation-refs.test.ts test/topology-clean.test.ts test/anchors.test.ts test/box-token-census.test.ts`
  — expect PASS. `cd ../pwa && npm test` only if `shared/api.ts`'s change reaches a pwa test (`git grep` the old sentence there first).
- [ ] **Step 5: Commit** `docs: deviation numbers are self-assigned; the skills and CLAUDE.md say how`.

### Task 5: Prove it on a real change

- [ ] **Step 1:** `cd server && npm run next-deviation -- 1` on this branch and record the number it prints as this
  plan's first ledger entry only if a deviation was found during Tasks 1 to 4; otherwise leave the section empty.
- [ ] **Step 2:** `git fetch origin main && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts test/ledger-crosstree.test.ts test/next-deviation.test.ts` — PASS.
- [ ] **Step 3:** Push once, open the PR against `main` with the spec and this plan named, and the note that the
  owner's sign-off is required because it changes a CLAUDE.md rule.

## Deviations found

- **D-10000** — The spec and this plan said `npm run next-deviation` (in `server/`) in the coordinator and worker skills and in `PEER_ETIQUETTE`, which works only in ccrc: the skills install into every rostered home, and `PEER_ETIQUETTE` is served to sessions in any project. They now state the project-generic rule (the highest `D-N` defined in the project's plans, notes and specs on `origin/main`, plus one, from 10000) and name the helper as how ccrc computes it (Task 4 fix round 1).
- **D-10002** — `ProjectReadiness.floor` came off the wire (`ReadinessFacts`, `READINESS_CELL`, `FloorState` and its map, Task 3), a removal where wire discipline is additive-only. Kept, because a precondition with no writer must not block a project: nothing seeds the floor once the allocator retires, so every new project would read `not-seeded` and blocked for good. The cost is cosmetic and lasts one rollout: an old PWA against a new server shows an empty floor phrase (`undefined`) in the readiness tooltip, and a new PWA against an old server ignores the floor cell, so a project the old server blocks on `not-seeded` reads "not ready" over "all program preconditions hold". No reader is added: the new PWA reads no `floor` key, so an old server's key is ignored silently. Recorded in the PR body (council cycle 1, F6).

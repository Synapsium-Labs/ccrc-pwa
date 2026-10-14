# Stall watch settings wave 4: R51's follow-ups, and a save that confirms nothing reads unconfirmed — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILLS: dispatched as a wave, `ccrc-worker`; to execute,
> `superpowers:subagent-driven-development` with `superpowers:test-driven-development` for every test step. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Programme:** `stall-watch-settings`, **wave 4 of 4** (ledger `docs/superpowers/programs/stall-watch-settings.md`,
R52). On 2026-10-13 the operator asked for every item of ledger R51's follow-up list in a single PR. Deploy class:
**server** (it serves the PWA). The hook's edits are comments, so the hook changes no behaviour when an update carries
it to the fleet box. One PR from a fresh child workspace. This plan file rides in that PR: its first commit adds it,
unchanged, from the coordinator's branch (R38's rule for wave 3, kept by R52).

The coordinator's rulings for this wave (summarised in ledger R52). "Ruling N" below means this list:
1. `shared/stall-watch.ts` is a new L0 file. It holds `StallWatchRefusal`, `STALL_WATCH_REFUSALS`, `isStallWatchRefusal`
   and `stallDurationText`, and no text line. The new line is `STALL_CONFIRM_TEXT.unconfirmed` in `shared/api.ts`,
   where the P6 device-word row reads it, and the file's line count is unchanged. If a scan pins `STALL_*` words to a
   file, stop and ask rather than edit that scan's rule.
2. `shared/api.ts` gets that one value line and its docstring line (Task 4), and the `MAIL_REPLAY_MS` docstring
   (Task 6). It gets nothing else.
3. The refusal list is the POST route's own codes: `bad-request`, `not-configured` and `confirm-required`. The auth
   gate's 401 and 403 and the server's 404 are not added.
4. The section's unconfirmed toast is plain, not an error toast.
5. The fold change defines D-4045 in this plan's Deviations. Shipped comments cite D-4045. No other number is defined.
6. `server/src/coord/routes.ts` is read only.
7. `box-token-card.test.tsx`: the header only. Lines :52-53 are left, because #384 rewrites :52-54.
8. The source-`default` row: fix the fixture (add a fallback), not the title.
9. Amend the stall-watch settings spec. The W2 plan's fold text is a dated record: it gets one pointer sentence only.
10. `stall-settings-readme.test.ts`'s `duration` copy moves to `stallDurationText`, together with the README pin's
    device words.
11. The W3 plan: words first, and the rewrap is the last task. Rewrap prose only, never a heading, table row, code
    fence or mutation row. The ledger's line citations into that plan are dated snapshots.
12. The W3 plan's Task 1 snippet stays as it is (R43). Only its note changes.
13. `ccd/session-hook.sh`: comments only, the same line count, inside wave 3's carry block, and nothing above :2900.

**Goal:** close R51's follow-up list, (a) to (h). Only (d) changes what a user sees.
- (a) Pin the fractional-stamp behaviour, and say "non-negative" where the hook and the W3 plan say "fractional"
  (Task 1).
- (b) Raise `session-hook-merge-deny.test.ts`'s jq-program floor to 52 and name #392's program (Task 2).
- (c) Bound `stall-settings-route.test.ts`'s POST slice at the handler's own closing brace (Task 3).
- (d) A save whose answer carries none of the route's refusal codes says "Not confirmed — the choice may or may not
  have been saved", never "Nothing was changed" (Task 4, D-4045).
- (e) `restampAsk`'s docstring and the `SAME DIALOG, STILL PAINTED` comment stop describing the old re-stamp as current
  (Task 6).
- (f) README's "a write older than 30 minutes" names the aged door's real clock (Task 6).
- (g) Words: the hook's "~650 lines up", the `ask-instance-guard.test.ts` header, and the W3 plan's stale note and long
  lines (Tasks 1 and 8).
- (h) R37's list: one duration formatter in L0, the README pin's device words, the `MAIL_REPLAY_MS` docstring, the box
  token card's header, the W2 plan's snapshots and the source-`default` fixture (Tasks 5, 6 and 7).

**Architecture:**
- One new L0 file, `shared/stall-watch.ts` (ruling 1). It holds the save's refusal codes (`StallWatchRefusal`, the
  derived `STALL_WATCH_REFUSALS` and `isStallWatchRefusal`) and the one duration formatter `stallDurationText`, and no
  text line. Its one import is `import type { StallConfirmRequired } from './api.js'`.
- The new line is `STALL_CONFIRM_TEXT.unconfirmed` in `shared/api.ts` (the amendment to ruling 1), so the P6
  device-word row, which reads that file's exports, covers it. It replaces the comment line above `unanswered`, and
  the block's docstring gains its slot in one reworded line, so the file's line count is unchanged. Run 400 holds the
  file, and #384 also appends at its foot; Task 6's `MAIL_REPLAY_MS` docstring is its only other edit (ruling 2).
- The PWA's fold, `stallWriteRefusal`, reads `refused` only when the body's `error` is one of the route's own codes.
  Any other `ApiError` is `unconfirmed` with a detail, and a rejection that is not an `ApiError` is `unconfirmed` with
  detail `null`. The section toasts the refusal (an error toast), the new unconfirmed line (plain) or the existing
  unanswered line (plain), then re-reads.
- A server census holds the codes the POST handler sends equal to `STALL_WATCH_REFUSALS`. It reads the handler through
  `postHandler`, which Task 3 bounds at the handler's closing brace.
- `quietText` (PWA) and `stallQuietWords` (server, L1) both become `stallDurationText`, and `single-definition.test.ts`
  holds its hours-and-minutes template to the new file.
- Everything else is comments, prose, test titles and one test fixture.

**Tech Stack:** TypeScript (L0, PWA, L1 and tests), vitest, bash and jq (the hook gains comments; its code is mutated
only out of tree, for a row), Markdown.

**Spec:** `docs/superpowers/specs/2026-10-05-stall-watch-settings-design.md` is authoritative for the save and the PWA
items: §12's table of L0 strings ("Every other string, by name"), §13 step 5 (the refusal toast, amended in Task 4) and
§15's conflict row. `docs/superpowers/specs/2026-09-29-worker-stall-watch-design.md` governs the hook items: §3.3 (the
hook file is shared with subagents), with the W3 plan's D-4041 for the fresh read and the kept stamp.

## Global Constraints

- **Anchors.** Every line number below is at `f515cdfd4` (wave 3's merge, where this wave's research measured them)
  unless a step says otherwise. The source as you find it wins where an anchor moved: find the quoted text, not the
  number. Where an earlier task of this wave shifts a file, the step names the shift.
- **Claims and held paths.** See the Precondition. A held path is edited only after the coordinator's mail relays its
  holder's agreement, under consent 4468's terms: each side edits only its own lines, and whoever lands second merges
  `main`, never rebases, and keeps the other's lines. Until a relay arrives, do the other tasks.
- **Nothing lands above `ccd/session-hook.sh:2900`** (README anchors that line). The hook's edits are comments only, at
  the same line count (3956 at `f515cdfd4`), inside wave 3's carry block (:3822-:3911) (ruling 13).
- **`shared/api.ts` gets only Task 4's `STALL_CONFIRM_TEXT.unconfirmed` and Task 6's `MAIL_REPLAY_MS` docstring**,
  line count unchanged (9806): Task 4's line replaces a comment line and its docstring line is reworded in place (the
  amendment to ruling 1); Task 6's edit is comment-only (ruling 2). Every other new L0 value goes in
  `shared/stall-watch.ts`. If a scan pins `STALL_*` words to `shared/api.ts`, stop and ask the coordinator rather than
  editing that scan's rule (ruling 1). The one this plan found, P6, reads the new line where it stands (Task 4 Step 9).
- **Read only:** `server/src/coord/routes.ts` (ruling 6) and `server/test/session-hook.test.ts`. A mutation row that
  edits either runs out of tree.
- **The programme ledger is the coordinator's.** Never edit it. Its line citations into the W3 plan are dated snapshots
  and are not chased (ruling 11).
- **The citation instrument** reads the same before (the Precondition) and after (the whole-wave checks). From
  `server/`:

  ```bash
  ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'
  ```

- **Mutation-table discipline.** Every new guard ships with a row measured red when it is removed or broken, before and
  after. Mutations run out of tree (a `git archive` of a commit that already holds the task's code and tests: commit
  the task's code and test steps first, measure at that commit, then record the rows and any plan edit in a follow-up
  commit named for the task), one at a time, each restored and `cmp`-checked. Record each as
  `<mutation> → <n> failed (<titles>)`. Every count and title below is a prediction unless it says it was measured:
  measure it.
- `stall.ts` and `stallsettings.ts` stay L1: pure, no clock, no I/O, no marker name. `stallsettings.ts` gains one L0
  value import, which M19b's `ALLOWED` names (Task 5). No marker gains a writer. No migration. Arming stays the
  operator's.
- Fixture HOMEs only: the hook suites run `ccd/session-hook.sh` in their own `mkTmp` HOME, never against the live
  `$HOME`.
- Suites in the foreground, one file per command, timeout at least 600000 ms, as
  `./node_modules/.bin/vitest run test/<file>` from inside the package, never a bare `npx vitest`. A known load flake
  (`session-hook`, `typecheck-tests`) is re-run alone before it is called a break. macOS CI legs gate nothing.
- Never `pkill` or `killall`. Stop only a process you started, by its recorded PID.
- `deviation-refs`, `dtbd`, `topology-clean`, `single-definition` and `typecheck-tests` are green at the end.
- **Deviation numbers.** This plan defines one number, D-4045 (ruling 5), the programme's last reserve number. Shipped
  comments and test titles cite D-4045, never "R51 (d)". Never call the allocator, and never write another number, a
  range of numbers or a placeholder number. A new departure is named by its slug and reported in the wave-done.
- **This repo is public.** No private project, host, lane, account or person names, no absolute home paths, and no
  links other than repo-relative paths or this repository's github.com URLs. Refer to other work by GitHub `#n`.
- Plan and spec prose stays at most 120 characters a line (headings, table rows, code and mutation rows exempt). No
  edit wraps a mutation row.
- Commit on the workspace's own branch, never a separate feature branch.

## Review Focus

Five inputs a real user can send through what this wave changes, the most likely first:

1. **A proxy's 502 or 504 after the save reached the server.** The server sits behind a TLS proxy. A server that
   restarts under an update, or stalls past the proxy's timeout, leaves the proxy to answer, and the write may have
   landed. Before this wave the screen said "Nothing was changed". Now it says the choice may or may not have been
   saved, in a plain toast, and re-reads. Task 4 pins it: the fold's "D-4045: a gateway 502 or 504 is unconfirmed…"
   and the section's 502 row (rows U1 and U6).
2. **A network drop mid-POST** (a phone changing networks). No answer arrives. The fold now returns `detail: null`, and
   the section must still show `STALL_CONFIRM_TEXT.unanswered`, never the new line with an empty slot. Task 4 pins it:
   the fold's network row and the section's existing "a write whose answer never arrived…" row (row U4).
3. **A 500 after the store committed.** Any throw after `coord.setStallSettings` (`routes.ts` ≈:2721) reaches the
   client as Fastify's 500, and the feed actor's read (≈:2729) sits outside the `try`. The route's own two 500s write
   nothing; they now read unconfirmed, with their message ("… nothing written …") as the detail. Task 4 pins it: the
   fold's 500 row and the section's 500 row (row U1).
4. **A jq that prints a fractional stamp.** A foreign or corrupt `hookstate.json` whose `updatedAt` is 12.7, 0.5 or
   -0.5: the carry keeps a non-negative value's floor and refuses a negative one. The hook's code does not change; the
   two new cases make the W3 plan's "Pinned by" claim true. Task 1 pins it (rows FS1, FS2 and FS3).
5. **A duration off the 30-minute grid.** 3 570 000 ms read "1 h" on the screen and "60 min" in the feed body.
   `isStallQuietMs` admits only 30-minute steps today, so nothing visible changes, and every existing feed-body row
   must stay green with its expected text unchanged. Task 5 pins the one formatter (rows SD1, SD2 and SD3).

## File Structure

| File | Change | Task |
|---|---|---|
| `docs/superpowers/plans/2026-10-14-stall-watch-settings-w4-residue.md` | this plan, committed first, unchanged; its Measured rows and Deviations found sections are the only parts a worker edits | first commit |
| `server/test/session-hook-subagent-ask.test.ts` | two fractional-stamp cases after :235 | 1 |
| `ccd/session-hook.sh` | comments only, four lines for four (:3831-3832, :3860-3861); **held, run 354** | 1 |
| `server/test/ask-instance-guard.test.ts` | header :10-11, two lines for two | 1 |
| `docs/superpowers/plans/2026-10-12-stall-watch-settings-w3-hidden-ask.md` | Task 1: the floor words, the Pinned-by bullet, two rename sentences, :458, four measured rows; Task 2: the floor note; Task 8: the Task 1 note, the placement sentence, the File Structure row, then the rewrap | 1, 2, 8 |
| `server/test/session-hook-merge-deny.test.ts` | the floor at 52 and its composition comment, seven lines for seven | 2 |
| `server/test/stall-settings-route.test.ts` | the bounded `sliceTo` and its CONTROL row; the refusal-code census and one import | 3, 4 |
| `shared/stall-watch.ts` | **new**: the refusal codes (Task 4); `stallDurationText` (Task 5); no text line | 4, 5 |
| `pwa/src/fleet/useStallWatchView.ts` | one import, the fold and its two docstrings; **held, run 400** | 4 |
| `pwa/src/screens/StallWatchSection.tsx` | the write handler's comment and toasts (Task 4); one import, and `quietText` becomes the L0 formatter (Task 5) | 4, 5 |
| `pwa/test/use-stall-watch-view.test.tsx` | the fold's rows, the header bullet, one import | 4 |
| `pwa/test/settings-screen.test.tsx` | the 500 row, a 502 row (Task 4); the source-`default` fixture (Task 7); **held, run 400** | 4, 7 |
| `docs/superpowers/specs/2026-10-05-stall-watch-settings-design.md` | §12's heading, §13 step 5, the `STALL_CONFIRM_TEXT` row's tail, two L0 rows, §15's conflict row | 4 |
| `docs/superpowers/plans/2026-10-05-stall-watch-settings-w2-pwa.md` | Task 4: one pointer sentence; Task 5: one line cite; Task 7: R37's snapshots | 4, 5, 7 |
| `server/src/coord/stallsettings.ts` | one L0 import, the L1 docstring's import list, `stallQuietWords` becomes the L0 formatter | 5 |
| `server/test/stall-settings.test.ts` | the M19 control and M19b's `ALLOWED` name the new file | 5 |
| `server/test/stall-settings-readme.test.ts` | the device words read from the PWA's scan; `duration` is the L0 formatter | 5 |
| `server/test/single-definition.test.ts` | one describe after :4160; **held, run 400** | 5 |
| `server/src/coord/store.ts` | `restampAsk`'s docstring, 13 lines for 13; **held, run 400** | 6 |
| `server/src/watch.ts` | the SAME DIALOG comment, six lines for six; **held, run 400** | 6 |
| `README.md` | two lines for two in "How a session's state is known"; **held, run 354** | 6 |
| `shared/api.ts` | `STALL_CONFIRM_TEXT.unconfirmed` in place of the comment line above `unanswered`, and its docstring's `{detail}` line, four lines for four (Task 4); `MAIL_REPLAY_MS`'s docstring, two lines for two (Task 6); **held, run 400** | 4, 6 |
| `pwa/test/box-token-card.test.tsx` | the header :6-8, three lines for three; **held, run 400** | 7 |
| `server/src/coord/routes.ts`, `server/test/session-hook.test.ts` | read only | — |

## Precondition: claims and the base measurements

- [ ] **Claim, as ONE all-or-nothing claim,** the paths no other run held at 2026-10-14 00:10Z:
  `server/test/session-hook-subagent-ask.test.ts`, `server/test/ask-instance-guard.test.ts`,
  `server/test/session-hook-merge-deny.test.ts`, `server/test/stall-settings-route.test.ts`,
  `server/test/stall-settings.test.ts`, `server/test/stall-settings-readme.test.ts`,
  `server/src/coord/stallsettings.ts`, `shared/stall-watch.ts`, `pwa/src/screens/StallWatchSection.tsx`,
  `pwa/test/use-stall-watch-view.test.tsx`, `docs/superpowers/specs/2026-10-05-stall-watch-settings-design.md`,
  `docs/superpowers/plans/2026-10-05-stall-watch-settings-w2-pwa.md`,
  `docs/superpowers/plans/2026-10-12-stall-watch-settings-w3-hidden-ask.md` and this plan. If the claim is refused,
  report the holder to the coordinator; do not split the claim.
- [ ] **Do not claim the held paths.** Edit each only after the coordinator's mail relays its holder's agreement:
  - run 354, comment or sentence edits only: `ccd/session-hook.sh` (first needed by Task 1 Step 5) and `README.md`
    (Task 6 Step 2);
  - run 400, code edits each measured clear of #384's hunks: `pwa/src/fleet/useStallWatchView.ts` and
    `pwa/test/settings-screen.test.tsx` (first needed by Task 4 Part B; the second again by Task 7 Step 7),
    `shared/api.ts`'s value edit, `STALL_CONFIRM_TEXT.unconfirmed` with its docstring line (Task 4 Step 7, about 180
    lines above #384's only hunk there, its foot append; the amendment to ruling 1, asked of run 400's coordinator by
    mail), and `server/test/single-definition.test.ts` (Task 5 Step 1);
  - run 400, comment only: `server/src/coord/store.ts`, `server/src/watch.ts` and `shared/api.ts`'s `MAIL_REPLAY_MS`
    docstring (Task 6), and `pwa/test/box-token-card.test.tsx` (Task 7 Step 6).

  When a task reaches a held path whose relay has not arrived, commit that task's other steps, go on, and land the
  held steps in their own commit, named for the task, once the relay arrives.
- [ ] **Measure on the base, before any edit,** and keep the output for the whole-wave checks:
  - the citation instrument (Global Constraints): its `Tests` line;
  - `wc -l ccd/session-hook.sh shared/api.ts README.md server/src/coord/store.ts server/src/watch.ts`;
  - the merge-deny suite's jq-program count (Task 2 Step 1).

---

### Task 1: the fractional-stamp cases and the hook's words (R51 (a), (g))

**Files:**
- Modify: `server/test/session-hook-subagent-ask.test.ts` (two cases after :235)
- Modify: `ccd/session-hook.sh` (comments :3831-3832 and :3860-3861; held, run 354)
- Modify: `server/test/ask-instance-guard.test.ts` (header :10-11)
- Modify: `docs/superpowers/plans/2026-10-12-stall-watch-settings-w3-hidden-ask.md` (:371, :458, :473-474, :502-503,
  :522, and four rows after :546)

**Interfaces:**
- Consumes: the test file's harness (`run` :36-37, `SUB` :45, `askViaPermission` :46, `Q`, `stateFile`, `readState`);
  the hook's fresh read of `updatedAt` (:3850, `if type == "number" then floor | tostring else "" end`) and
  `_hook_keep_stamp`'s `^[0-9]+$` test (:3864), both read only.
- Produces: 30 cases in the file (22 in its first describe). The hook's code is unchanged.

Measured in this wave's research (jq 1.7, the fresh read's exact expression): 12.7 prints `12` and is kept as 12,
with `aliveAt` and the stored event; 0.5 prints `0` and is kept as 0; -0.5 floors to `-1`, fails `^[0-9]+$`, and the
carry still runs (`waiting`, the ask carried) but with a fresh `updatedAt`, the current event and no `aliveAt`.

- [ ] **Step 1: Write the two cases**

Insert after line 235 (the blank line after the `it('an updatedAt that is negative, …` case's `});`, before
`it('the kept event is cut to letters…`), so the ledger's citation of :220 stays true:

```ts
  it('a non-negative fractional updatedAt is kept as its floor and writes aliveAt (12.7 is kept as 12, 0.5 as 0)', () => {
    for (const [raw, kept] of [['12.7', 12], ['0.5', 0]] as const) {
      askViaPermission();
      const text = fs.readFileSync(stateFile(), 'utf8').replace(/"updatedAt":\d+/, `"updatedAt":${raw}`);
      expect(text, raw).toContain(`"updatedAt":${raw}`);
      fs.writeFileSync(stateFile(), text);
      const before = Date.now();
      run({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: '/x' }, ...SUB });
      const s = readState();
      expect(s, raw).toMatchObject({ state: 'waiting', event: 'PermissionRequest', updatedAt: kept, ask: { questions: Q.questions } });
      expect(s['aliveAt'] as number, raw).toBeGreaterThanOrEqual(before);
    }
  });

  it('a negative fractional updatedAt is refused: -0.5 floors to -1, so the carry keeps no stamp, takes the current event and writes no aliveAt', () => {
    askViaPermission();
    const text = fs.readFileSync(stateFile(), 'utf8').replace(/"updatedAt":\d+/, '"updatedAt":-0.5');
    expect(text).toContain('"updatedAt":-0.5');
    fs.writeFileSync(stateFile(), text);
    const before = Date.now();
    run({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: '/x' }, ...SUB });
    const s = readState();
    expect(s).toMatchObject({ state: 'waiting', event: 'PostToolUse', ask: { questions: Q.questions } });
    expect(s).not.toHaveProperty('aliveAt');
    expect(s['updatedAt'] as number).toBeGreaterThanOrEqual(before);
    expect(s['updatedAt'] as number).toBeLessThan(1e14);
  });

```

- [ ] **Step 2: Run them**

From `server/`: `./node_modules/.bin/vitest run test/session-hook-subagent-ask.test.ts` — Expected: 30 passed. Both new
cases pass against the shipped hook, because the behaviour exists and R51 (a) asks only for the pin. Their red-first is
the mutation in Step 3.

- [ ] **Step 3: Measure the rows (red-first by mutation)**

First commit this task's code and test edits so far (the commit step below then commits only what remains). Out
of tree, one at a time, on the hook's two read-only lines:
- FS1 (`floor | tostring` → `tostring` at :3850; 12.7 prints `12.7` and 0.5 prints `0.5`, and both fail `^[0-9]+$`) → 1 failed (a non-negative fractional updatedAt is kept as its floor and writes aliveAt (12.7 is kept as 12, 0.5 as 0)) — predicted; measure.
- FS2 (`floor` → `ceil` at :3850; 12.7 → 13, 0.5 → 1, and -0.5 → `-0`, still refused) → 1 failed (the same case) — predicted; measure.
- FS3 (`^[0-9]+$` → `^-?[0-9]+$` at :3864; -0.5 → `-1` is kept, and `aliveAt` is written) → 2 failed (an updatedAt that is negative, non-numeric or printed by jq in exponent form keeps no stamp and writes no aliveAt (a fractional one keeps its floor); a negative fractional updatedAt is refused: -0.5 floors to -1, so the carry keeps no stamp, takes the current event and writes no aliveAt) — predicted; measure.
- N2 (drop `&& "$fr_upd" =~ ^[0-9]+$` at :3864, now over 30 cases; wave 3 measured 1 over 28) → 2 failed (the same two titles as FS3) — predicted; measure.

Measure FS1 once more on the file without the two cases: review 404 measured that at 28 passed of 28, the hole the
cases close. Record all four rows in this plan's Measured rows, and FS1, FS2 and FS3 in the W3 plan (Step 6).

- [ ] **Step 4: The `ask-instance-guard.test.ts` header**

Replace lines 10-11 with these two (78 and 79 characters; the header's widest line is 80):

```ts
// HISTORY. This suite once MEASURED A DEFECT (D-2403 is the bump it measured,
// D-2404 corrected which line kept the ask, the suite closed D-2406): the hook
```

Line 12 continues the sentence unchanged, and line 30 ("This supersedes the bump D-2403 describes") stays consistent.
The plan that defines the three numbers is `docs/superpowers/plans/2026-09-09-ask-preemption-lane.md` (:49, :50, :52).

- [ ] **Step 5: The hook's two comments (held, run 354: wait for the relay)**

In `ccd/session-hook.sh`, comment lines only. Lines 3860-3861 become (117 and 117 characters):

```bash
# A non-negative fractional value keeps its floor (a negative one floors to a negative and fails that test): the hook
# writes integer milliseconds only, so one is a foreign or corrupt file, and the floor moves the stamp by under 1 ms.
```

Lines 3831-3832 become (114 and 120 characters). `read -r prev_state` occurs once in the hook (:3127), and "its note"
is the prefilter's, named on the line above:

```bash
# stands NOW, not of `prev_state`, which the prefilter's `read -r prev_state` took far above: a main-thread answer
# landing in between must not be overwritten by a `waiting` decided from the old read. Lines, not `@tsv` (see its note).
```

Then: `bash -n ccd/session-hook.sh` is clean; `wc -l ccd/session-hook.sh` is unchanged (3956); and
`git diff -U0 -- ccd/session-hook.sh` shows four removed and four added lines, every one a `#` line, in hunks at or
after :3822. No file cites a hook line at or after :3822 (the highest citation in the tree is :3626).

- [ ] **Step 6: The W3 plan's words and rows**

In `docs/superpowers/plans/2026-10-12-stall-watch-settings-w3-hidden-ask.md`, line for line except (6). These lines
grow past 120 characters; Task 8 rewraps them last (ruling 11).

(1) Line 473: replace `A fractional value keeps its floor (the hook writes integer` with
`A non-negative fractional value keeps its floor (the hook writes integer`. Line 474 becomes:

```markdown
    milliseconds only, so one is a foreign or corrupt file, and the floor moves the stamp by under 1 ms); a negative one, such as -0.5, floors to -1 and is refused.
```

(2) Lines 502 and 503 become:

```markdown
  - `server/test/session-hook-subagent-ask.test.ts` (28 cases, layout under D-4039, and two fractional-stamp cases added after the merge): the "stamp" cases, the defensive
    cuts of the fresh read (an `updatedAt` that is negative, non-numeric or printed by jq in exponent form keeps no stamp, a non-negative fractional one keeps its floor, and -0.5 is refused; the kept `event` is letters only;
```

(3) Line 371, the one rename sentence for the claim at :369-371, becomes:

```markdown
  28 of 28. (M1 and M13 below quote one failing title as fix round 3 renamed it after this measurement, R45 item 7; their counts are unchanged.) The carry now reads the file once, fresh (D-4041), so the conditions below are the ones the code holds today,
```

(4) Line 522, the one rename sentence for the claim at :521-522, becomes:

```markdown
    mutation at a time, each restored and `cmp`-checked, with identical counts and titles to the `ed7537045` measurement (S3, N2 and N6 quote one title as fix round 3 renamed it after both, R45 item 7: no count moved, and review 404 re-measured N2 red with the new title);
```

(5) Line 458 (R51 (g)): replace `which the prefilter read ~650 lines earlier` with
`which the prefilter read much earlier`.

(6) Insert four lines between :546 (the A5 row) and :547 (the "N3 is gone" bullet). Fill `<tip>` with the commit that
holds the two cases, which Step 3 measured at, and replace each count and title with the measured one:

```markdown
  - The two fractional-stamp cases were added after the merge (programme ledger R51, follow-up (a)); every row above was measured on the 28 cases before them. Measured at `<tip>`, out of tree, one mutation at a time, each restored and `cmp`-checked:
  FS1 (`floor | tostring` → `tostring` on the fresh read's `updatedAt` line) → 1 failed (a non-negative fractional updatedAt is kept as its floor and writes aliveAt (12.7 is kept as 12, 0.5 as 0));
  FS2 (`floor` → `ceil` on that line) → 1 failed (the same case);
  FS3 (`^[0-9]+$` → `^-?[0-9]+$` in `_hook_keep_stamp`) → 2 failed (an updatedAt that is negative, non-numeric or printed by jq in exponent form keeps no stamp and writes no aliveAt (a fractional one keeps its floor); a negative fractional updatedAt is refused: -0.5 floors to -1, so the carry keeps no stamp, takes the current event and writes no aliveAt).
```

Do not reuse the ids F1 to F4 for rows: review 404 already uses them. The earlier rows were measured on 28 cases and
are not re-measured here; over 30 cases several would rise (this wave's research predicts M1, M13, S1, S2, S3, S5, N2
and N6).

- [ ] **Step 7: Run**

From `server/`, one per command: `test/session-hook-subagent-ask.test.ts` (30 passed),
`test/ask-instance-guard.test.ts`, `test/session-hook-merge-deny.test.ts`, and the citation instrument (its `Tests`
line equal to the Precondition's).

- [ ] **Step 8: Commit**

```bash
git add server/test/session-hook-subagent-ask.test.ts server/test/ask-instance-guard.test.ts ccd/session-hook.sh \
  docs/superpowers/plans/2026-10-12-stall-watch-settings-w3-hidden-ask.md
git commit -m "test(hook): pin the fractional stamp; the hook's floor and prefilter words (R51 (a), (g))"
```

Without run 354's relay, leave `ccd/session-hook.sh` out, and commit Step 5 alone when the relay arrives.

### Task 2: the merge-deny jq-program floor (R51 (b))

**Files:**
- Modify: `server/test/session-hook-merge-deny.test.ts` (:837-843)
- Modify: `docs/superpowers/plans/2026-10-12-stall-watch-settings-w3-hidden-ask.md` (:518-520)
- Read only: `ccd/session-hook.sh` (mutated out of tree for the row)

**Interfaces:**
- Consumes: `jqPrograms` (:755-785), which counts a single-quoted span when its line starts `NAME='` or holds a
  standalone `jq`; `HOOK` (:21), a fixed path, so the row's mutation runs in an out-of-tree copy of the whole tree.
- Produces: the floor at 52, with a composition comment that names #392's program.

What this wave's research measured at `f515cdfd4`, with a line-for-line port of the extractor: 52 programs and 33
`as $` bindings. #392 added one program (the role-skill deny's read of the skill's name, :3802, D-4934) and never
touched this test. Wave 3's branch was net minus one and set the floor to its own 51; the squash landed on #392 at 52,
so the floor is one loose, and deleting any one jq call stays green.

- [ ] **Step 1: Measure the count**

Change the `51` in :843's `toBeGreaterThanOrEqual(51)` to `999`, run
`./node_modules/.bin/vitest run test/session-hook-merge-deny.test.ts`, read `expected <n> to be greater than or equal
to 999`, and restore the line (`git diff --quiet -- server/test/session-hook-merge-deny.test.ts`). Expected: 52. If
`<n>` is not 52, a branch landed a jq call first: use the measured count in Steps 3 and 5 and say so in the wave-done.

- [ ] **Step 2: The hole, before**

Out of tree, at the current floor 51, replace this exact text at :3869 with `name="subagent"`:

```bash
name=$(jq -r '.agent_name // .subagent_name // .agent_type // "subagent"' <<<"$payload" 2>/dev/null) || name="subagent"
```

It removes one counted span and no `as $`, so the bindings checks and `MERGE_STRIP_JQ` are untouched:
- JF1 (the :3869 read → `name="subagent"`, floor 51) → 0 failed (51 >= 51: the hole review 422 measured) — measure.

- [ ] **Step 3: Raise the floor**

Replace :837-843 with these seven lines (:835-836 unchanged, so the floor stays on :843, which the ledger cites). The
dropped clause ("which answers state, who raised the wait, …, together") is said by the hook's own comment
(:3828-3833):

```ts
    // FLOOR 52, composition (the extractor's count, measured at each ref): 52 at the base of the stall-watch work
    // (the Start/Stop arm read the file with `.ask // null` and `.interrupted == true`); 54 after D-4039 added two
    // programs (the arm's `.waitBy` read and the tool-event carry's own three-field read); 51 after D-4041 removed
    // four (those three Start/Stop reads and the carry's read) and added one, the shared `_hook_fresh_read`; 52 once
    // merged, since the role-skill deny (D-4934, #392) had added one on `main` first, its read of the skill's name
    // (`main` stood at 53 against a floor of 52). The 33 `as $` bindings below were 33 at every ref.
    expect(programs.length, 'jq programs found').toBeGreaterThanOrEqual(52);
```

- [ ] **Step 4: The row, after**

First commit this task's code and test edits so far (the commit step below then commits only what remains).

- JF1 (the same mutation, floor 52) → 1 failed (no jq program in ccd/session-hook.sh binds `as` to a binary chain), with `jq programs found: expected 51 to be greater than or equal to 52` — predicted; measure.

The unmutated file is green (52 >= 52). An optional second row is noisier, because it also reds
`session-hook-role-skill-deny.test.ts`:
- JF2 (:3802-3810's `rsk=$(jq -r '…' <<<"$payload" 2>/dev/null) || rsk=""` → `rsk=""`, floor 52) → 1 failed (the same title) here — predicted; measure.

- [ ] **Step 5: The W3 plan's floor note**

Replace :518-520 with these three lines (three for three, so :521-522, which R51 (a) cites, do not move):

```markdown
  - `server/test/session-hook-merge-deny.test.ts`'s jq-program floor: 51 at this wave's tip, 52 since wave 4 (R51 (b)).
    The extractor's count at each ref: 52 at the base, 54 after D-4039 (two added), 51 after D-4041 (four removed, the
    shared fresh read added), 52 merged onto #392's skill-name read (D-4934). The `as $` bindings were 33 throughout.
```

- [ ] **Step 6: Run and commit**

`./node_modules/.bin/vitest run test/session-hook-merge-deny.test.ts` — Expected: all pass.

```bash
git add server/test/session-hook-merge-deny.test.ts docs/superpowers/plans/2026-10-12-stall-watch-settings-w3-hidden-ask.md
git commit -m "test(hook): the merge-deny jq-program floor is 52, with #392's skill-name read (R51 (b))"
```

Not in this wave: the research's optional sentence for `docs/superpowers/plans/2026-10-13-subagent-role-skill-guard.md`
:26. That plan is not in this wave's claim, and R51 (b) asks only for the test and the W3 note.

### Task 3: bound the POST slice at the handler's closing brace (R51 (c))

**Files:**
- Modify: `server/test/stall-settings-route.test.ts` (`sliceTo` :589-596; a CONTROL row after :611)
- Read only: `server/src/coord/routes.ts`

**Interfaces:**
- Consumes: `blankCommentsAndStrings` (:546, a hoisted function declaration, so the `const` at :590 can call it; it
  blanks comment, string and template bodies and keeps positions), `ROUTES_SRC`, `POST_DECL`, `stripComments`.
- Produces: `sliceTo(raw, from, decl)` ends at the closing brace of the handler `decl` registers. `postHandler` (:597)
  and `stallWatchBlock` (:598-602) are unchanged and inherit the bound. `stallWatchBlock` still starts at the
  docstring anchor and still holds the GET, which sits above the POST.

Why: on `f515cdfd4` the POST handler runs :2698-2742 of `routes.ts`, and the next registration is `app.get('/api/runs'`
at :2837, so today's slice also takes in `composeChildReclaim` and the GET /api/runs docstring. #384 puts the
collector's helpers straight after the stall POST. The M29 and M16b counts are right today only because nothing in the
overrun spells `deviceActor(`, `setStallSettings(` or a bare `device`.

- [ ] **Step 1: Write the CONTROL row first**

Insert after :611 (the `});` that ends "CONTROL: the POST slice is the handler, …"), inside the M29 describe:

```ts

  it('CONTROL (R51 (c)): the slice ends at the handler\'s own closing brace, never on into what follows it', () => {
    const planted = "app.get('/api/coord/stall-watch', a);\napp.post('/api/coord/stall-watch', async () => {\n"
      + "  const s = '}';\n  // }\n  if (x) { w(); }\n});\nconst below = () => s.setStallSettings(r);\napp.get('/api/runs', b);\n";
    expect(postHandler(planted), 'a brace in a string or a comment, or a helper below, moved the end')
      .toBe("app.post('/api/coord/stall-watch', async () => {\n  const s = '}';\n  // }\n  if (x) { w(); }\n}");
    const real = postHandler(ROUTES_SRC());
    expect(real, 'the real slice ends at the handler\'s last statement and its brace')
      .toMatch(/return reply\.code\(200\)\.send\(\{ ok: true, \.\.\.stallWatchView\([^\n]*\);\n\s*\}$/);
    expect(real.slice(POST_DECL.length), 'the real slice holds no later registration')
      .not.toMatch(/app\.(?:get|post)\('/);
  });
```

The `toMatch` row tells the two slices apart on the real tree: the old slice ends after the GET /api/runs docstring,
just before its registration (after the collector's helpers once #384 lands), never at `});`. The
no-later-registration row also holds for the old slice, which stopped just before the next registration, so it is a
floor, not the discriminator.

- [ ] **Step 2: Run it red**

From `server/`: `./node_modules/.bin/vitest run test/stall-settings-route.test.ts` — Expected: the new row FAILS at
its first `toBe`, because the old `sliceTo` returns the planted text up to `app.get('/api/runs'`, which holds
`const below = () => s.setStallSettings(r);`. Every other row passes.

- [ ] **Step 3: Bound the slice**

Replace :589-596 with:

```ts
/** From `from` to the closing brace of the handler `decl` registers, never on to the next registration: a helper
 *  declared between the two (`composeChildReclaim`, or another route's helpers) is not the handler. Braces are
 *  counted on `blankCommentsAndStrings` of the text from `decl` on, so a brace in a comment or a string never moves
 *  the end. Fails loudly on a missing anchor or a body that never closes. */
const sliceTo = (raw: string, from: number, decl: string): string => {
  const at = raw.indexOf(decl);
  expect(at, `${decl} is gone — this scan is over nothing`).toBeGreaterThan(-1);
  expect(from, 'the slice starts after the registration it must cover').toBeLessThanOrEqual(at);
  const flat = blankCommentsAndStrings(raw.slice(at));
  let depth = 0;
  let end = -1;
  for (let i = flat.indexOf('{'); i >= 0 && i < flat.length && end < 0; i++) {
    if (flat[i] === '{') depth += 1;
    else if (flat[i] === '}' && --depth === 0) end = i;
  }
  expect(end, `${decl}'s handler never closes — the slice would run on`).toBeGreaterThan(-1);
  return raw.slice(from, at + end + 1);
};
```

The blanking runs on `raw.slice(at)`, not on the whole file, on purpose: `blankCommentsAndStrings` has no
regex-literal arm, so a quote inside a regex above the handler could flip its string parity. The handler holds no
regex literal and no nested template.

- [ ] **Step 4: Run it green**

The same command — Expected: all pass, the new row included, and these four unchanged rows with it: "CONTROL: the POST
slice is the handler, and it hands the label to deviceActor exactly once" (the handler is about 2.4 KB, over the row's
400), "with that one call removed, no device token is left in the POST handler", "the stall-watch block, docstring
included, and stallsettings.ts hold no device word", and "setStallSettings( is spelled on a code line only at its
definition and inside the POST handler".

- [ ] **Step 5: The row**

First commit this task's code and test edits so far (the commit step below then commits only what remains).

- BS1 (`--depth === 0` → `--depth === -1` in the new `sliceTo`) → at least 1 failed (CONTROL (R51 (c)): the slice ends at the handler's own closing brace, never on into what follows it), at its `expect(end, …)` — predicted; measure, and record every title that reds: on the real file the end moves to the enclosing function's brace, so other M29 rows may red too.

- [ ] **Step 6: Commit**

```bash
git add server/test/stall-settings-route.test.ts
git commit -m "test(stall): the POST slice ends at the handler's closing brace (R51 (c))"
```

### Task 4: a save whose answer carries no refusal code reads unconfirmed (R51 (d), D-4045)

**Files:**
- Create: `shared/stall-watch.ts`
- Modify: `shared/api.ts` (:9599; :9626-9628, three lines for three) — **held, run 400**
- Modify: `server/test/stall-settings-route.test.ts` (an import after :26; a census at the end of the file)
- Modify: `docs/superpowers/specs/2026-10-05-stall-watch-settings-design.md` (:1068, :1147, :1321-1323, :1555)
- Modify: `docs/superpowers/plans/2026-10-05-stall-watch-settings-w2-pwa.md` (:204-205)
- Modify: `pwa/src/fleet/useStallWatchView.ts` (an import after :11; :161-163; :169-199) — **held, run 400**
- Modify: `pwa/src/screens/StallWatchSection.tsx` (:297-303; :323-324)
- Modify: `pwa/test/use-stall-watch-view.test.tsx` (:9-10; an import after :17; :262; :282-308)
- Modify: `pwa/test/settings-screen.test.tsx` (:2576-2584; one row after it) — **held, run 400**
- Read only: `server/src/coord/routes.ts` (the route's codes: 400 `bad-request` at :2702, 409 `confirm-required` at
  :2718, and 501 `not-configured` through `notConfigured`, :526 and :2699)

**Interfaces:**
- Produces, in `shared/stall-watch.ts`: `type StallWatchRefusal`, `STALL_WATCH_REFUSALS: readonly StallWatchRefusal[]`,
  and `isStallWatchRefusal(v: unknown): v is StallWatchRefusal`; in `shared/api.ts`, `STALL_CONFIRM_TEXT.unconfirmed`
  (one `{detail}` slot).
- Changes: `StallWriteRefusal`'s `unconfirmed` arm becomes `{ kind: 'unconfirmed'; detail: string | null }`. Its only
  readers are `StallWatchSection.tsx` (≈:318) and the tests.
- Consumes: `StallConfirmRequired` (a type, `shared/api.ts` :9523), `ApiError` and `apiErrorText`
  (`pwa/src/lib/api.ts`), `fillStallText` and `toast`.

Part A touches no held path. Part B waits for run 400's relay, for its three held files: the new L0 line, the fold and
their rows land together, red first.

**Part A: L0, the server census, the spec and the W2 pointer**

- [ ] **Step 1: Create `shared/stall-watch.ts`**

```ts
// The stall watch's L0 values that live outside `shared/api.ts` (stall watch settings, design 2026-10-05 §12 and §13;
// programme stall-watch-settings, wave 4). `shared/api.ts` is cited by line from the spec and plan corpus, and other
// programmes append at its foot, so these sit in a file of their own. L0: the PWA bundles `shared/`, so this file
// takes no value import and no `node:` module. Its one import is a type from `./api.js`, erased at build.
//
// What lives here, once:
// - `StallWatchRefusal`, `STALL_WATCH_REFUSALS` and `isStallWatchRefusal`: the codes `POST /api/coord/stall-watch`
//   refuses with. `stall-settings-route.test.ts` holds the list equal to the codes the POST handler sends.
// The line for an answer that carries none of those codes is `STALL_CONFIRM_TEXT.unconfirmed`, in `shared/api.ts`
// with the section's other words, where the PWA's device-word scan reads it.
import type { StallConfirmRequired } from './api.js';

/** Every refusal code `POST /api/coord/stall-watch` answers with (stall-watch settings §10, §13): spelled once, as a
 *  total table's keys, and the runtime list derived. An answer carrying any other code confirms nothing about the
 *  write (`an-answer-without-a-refusal-code-reads-unconfirmed` (D-4045)). */
export type StallWatchRefusal = 'bad-request' | 'not-configured' | StallConfirmRequired['error'];
const STALL_WATCH_REFUSAL_TABLE: Readonly<Record<StallWatchRefusal, true>> = {
  'bad-request': true, 'not-configured': true, 'confirm-required': true,
};
export const STALL_WATCH_REFUSALS: readonly StallWatchRefusal[] =
  Object.keys(STALL_WATCH_REFUSAL_TABLE) as StallWatchRefusal[];
/** The refusal guard: the `includes` form, never `in`, so an inherited key such as `constructor` is never a code. */
export function isStallWatchRefusal(v: unknown): v is StallWatchRefusal {
  return typeof v === 'string' && (STALL_WATCH_REFUSALS as readonly string[]).includes(v);
}
```

The list is the route's own codes only, as #384's collector list is (ruling 3). The auth gate's 401 and 403 and the
server's 404 are not in it; D-4045's Not done says why.

- [ ] **Step 2: The server census**

In `server/test/stall-settings-route.test.ts` (Task 3 moved the end of the file down by 22 lines), add after line 26:

```ts
import { STALL_WATCH_REFUSALS } from '../../shared/stall-watch.js';
```

and append at the end of the file:

```ts

describe('D-4045: the POST answers exactly the refusal codes L0 lists', () => {
  it('the codes the POST handler sends, notConfigured\'s included, are STALL_WATCH_REFUSALS, no more and no fewer', () => {
    const raw = ROUTES_SRC();
    expect(raw, 'notConfigured no longer answers not-configured').toContain(
      "const notConfigured = (reply: FastifyReply) => reply.code(501).send({ ok: false, error: 'not-configured' });");
    const handler = stripComments(postHandler(raw));
    const codes = new Set([...handler.matchAll(/\berror: '([a-z-]+)'/g)].map((m) => m[1]));
    if (/\bnotConfigured\(reply\)/.test(handler)) codes.add('not-configured');
    expect(codes.size, 'CONTROL: the scan found codes in the handler').toBeGreaterThan(1);
    expect([...codes].sort()).toEqual([...STALL_WATCH_REFUSALS].sort());
  });
});
```

Run `./node_modules/.bin/vitest run test/stall-settings-route.test.ts` — Expected: all pass; the census is green on the
shipped route. Its red-first is by mutation. First commit this task's code and test edits so far (the commit step
below then commits only what remains). Measure each row and record it under D-4045:
- RC1 (`routes.ts` :2702, `error: 'bad-request'` → `error: 'bad-body'`) → at least 1 failed (the codes the POST handler sends, notConfigured's included, are STALL_WATCH_REFUSALS, no more and no fewer), plus any route row that expects `bad-request` — predicted; measure.
- RC2 (delete `'bad-request': true,` from `STALL_WATCH_REFUSAL_TABLE` and `'bad-request' |` from the union, so `tsc` passes) → 1 failed (the same census title) here, and, once Part B lands, about 4 failed in `pwa/`, both files run (D-4045: only the route's own codes are refusals, and the list is L0's; takes the server's detail when it sends one; P2: a refused write toasts the server's detail, re-reads, and leaves the stored radio checked; P2: a cancelled or refused quiet write leaves the select on the stored value, never the tap) — predicted; measure.
- RC3 (Task 3's `sliceTo` reverted, and `void { ok: false, error: 'teapot' };` added as the first statement of `composeChildReclaim` in `routes.ts`) → 2 failed (the same census title; CONTROL (R51 (c)): the slice ends at the handler's own closing brace, never on into what follows it); with the bounded `sliceTo` and the same added line, 0 failed, which shows Task 3 carries the census — predicted; measure.

Deleting only the table's key, with the union kept, fails `tsc` (the `Record` is total): that is the type-level half.

- [ ] **Step 3: Amend the spec (ruling 9)**

In `docs/superpowers/specs/2026-10-05-stall-watch-settings-design.md`, edit from the bottom up, so each anchor holds.

(1) In §15's conflict row (:1555), replace the last cell `A fresh sheet, a settled write, or the refusal toast. |`
with:

```markdown
A fresh sheet, a settled write, or, on the second conflict's 500, the unconfirmed toast with the route's own message, which says nothing was written (§13 step 5). |
```

(2) Replace §13 step 5 (:1321-1323, three lines) with these ten:

```markdown
5. A refusal whose body's `error` is one of the route's own codes, `STALL_WATCH_REFUSALS` (`bad-request`,
   `confirm-required`, `not-configured`), gives `toast(STALL_CONFIRM_TEXT.refused, 'error')`, "Nothing was changed:
   <detail>", then `reload()`. Any other answer confirms nothing about the write
   (`an-answer-without-a-refusal-code-reads-unconfirmed`, D-4045): a gateway's 502 or 504 can follow a POST that
   reached the server, and a 500 can follow a store that committed. It gives a plain
   `toast(STALL_CONFIRM_TEXT.unconfirmed)`, "Not confirmed — the choice may or may not have been saved (<detail>); the
   screen will re-check.", then `reload()`. A POST with no answer at all gives `STALL_CONFIRM_TEXT.unanswered`
   (departure `unanswered-write-has-its-own-l0-line`), then `reload()`. The detail is the server's `detail`, else
   Fastify's `message`, else the error's text, else the HTTP status. Because the controls render from the server's
   answer, they show the stored value again.
```

(3) In the `STALL_CONFIRM_TEXT` row of §12's table (:1147), replace the row's tail

```markdown
`unknown`, and the refusal toast `refused` |
```

with:

```markdown
`unknown`, the refusal toast `refused`, and `unanswered`, the toast for a POST with no answer (departure `unanswered-write-has-its-own-l0-line`) |
```

and insert these two rows directly after it:

```markdown
| `STALL_CONFIRM_TEXT.unconfirmed` | a key of `STALL_CONFIRM_TEXT` in `shared/api.ts` (wave 4): "Not confirmed — the choice may or may not have been saved ({detail}); the screen will re-check.", the toast for an answer that carries none of the route's refusal codes (D-4045) |
| `STALL_WATCH_REFUSALS` | in `shared/stall-watch.ts` (wave 4): the POST's refusal codes, `bad-request`, `confirm-required` and `not-configured`, the keys of a total table over the `StallWatchRefusal` union, with the guard `isStallWatchRefusal` (D-4045) |
```

(4) Last, after the bottom-up edits above (it sits above every other anchor, and is line for line): in §12's heading
(:1068), replace ``(L0, `shared/api.ts`, additive, imports nothing)`` with
``(L0, `shared/api.ts` and, since wave 4, `shared/stall-watch.ts`, additive, type imports only)``, because the new
file's one import is a type from `./api.js`.

The spec grows by nine lines. Nothing cites it by line. Its review-finding notes (:1850-1851, :1866) are a dated record
and stay as written.

- [ ] **Step 4: The W2 plan's pointer (ruling 9)**

The W2 plan's fold text is a dated execution record and stays, except for one sentence at its first statement of the
refusal rule (:203-205, "Any other refusal gives `STALL_CONFIRM_TEXT.refused` …"; the Architecture bullet at :33-34
only names the function and is left as written), which a reader acting on the rule finds first. Replace :204-205
(two lines) with these four:

```markdown
  detail (the server's `detail`, else the 500 body's `message`, else the error's own text), then `reload()`. Wave 4
  narrows this to the route's own codes and reads any other answer as unconfirmed (D-4045 in
  `docs/superpowers/plans/2026-10-14-stall-watch-settings-w4-residue.md`). The controls are locked while a write is in
  flight or its sheet is open.
```

Every later W2 plan anchor in this plan moves down by two lines.

- [ ] **Step 5: Run and commit Part A**

From `server/`, one per command: `test/stall-settings-route.test.ts`, `test/single-definition.test.ts` (its walk now
includes the new file), `test/topology-clean.test.ts`; then `./node_modules/.bin/tsc --noEmit -p .` and
`./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json`.

```bash
git add shared/stall-watch.ts server/test/stall-settings-route.test.ts \
  docs/superpowers/specs/2026-10-05-stall-watch-settings-design.md docs/superpowers/plans/2026-10-05-stall-watch-settings-w2-pwa.md
git commit -m "feat(l0): the stall POST's refusal codes, with the server census (D-4045)"
```

**Part B: the L0 line, the fold, the section and the PWA rows (held: wait for run 400's relay)**

- [ ] **Step 6: Write the fold's rows**

In `pwa/test/use-stall-watch-view.test.tsx`, line for line:

Lines 9-10 become:

```ts
//  • stallWriteRefusal: a write's rejection read as a confirm to show, a refusal (only on the route's own codes,
//    L0's STALL_WATCH_REFUSALS) whose detail is never empty, or an unconfirmed write (any other answer, or none).
```

Keep line 17 and insert after it:

```ts
import { STALL_WATCH_REFUSALS } from '../../shared/stall-watch';
```

Line 262 (the describe's title; one lower after the import, as is everything below it) becomes:

```ts
describe('stallWriteRefusal — a confirm to show, a refusal only on the route\'s own code, or an unconfirmed write', () => {
```

Replace :282-308 (the four `it`s from "takes Fastify's message…" to the network row) with these six. The rows at
:263-280 (the confirm, the confirm body on a 400, the unreadable 409 and the server's detail) stay unchanged and stay
green, because their codes are the route's:

```ts
  it('D-4045: only the route\'s own codes are refusals, and the list is L0\'s', () => {
    expect([...STALL_WATCH_REFUSALS].sort()).toEqual(['bad-request', 'confirm-required', 'not-configured']);
    const both = new ApiError(400, { ok: false, error: 'bad-request', detail: 'unknown key: loudness', message: 'other' });
    expect(stallWriteRefusal(both)).toEqual({ kind: 'refused', detail: 'unknown key: loudness' });
    const blank = new ApiError(400, { ok: false, error: 'bad-request', detail: '   ' });
    expect(stallWriteRefusal(blank)).toEqual({ kind: 'refused', detail: 'bad-request' });
    expect(stallWriteRefusal(new ApiError(501, { ok: false, error: 'not-configured' })).kind).toBe('refused');
  });

  it('D-4045: a 500 is unconfirmed, never a refusal: the store may have committed before the throw', () => {
    const cause = 'stall settings unreadable, nothing written: disk gone';
    const fastify500 = new ApiError(500, { statusCode: 500, error: 'Internal Server Error', message: cause });
    expect(stallWriteRefusal(fastify500), 'Fastify\'s message is the detail').toEqual({ kind: 'unconfirmed', detail: cause });
    const bare500 = new ApiError(500, { statusCode: 500, error: 'Internal Server Error', message: '  ' });
    expect(stallWriteRefusal(bare500), 'then the error\'s own text').toEqual({ kind: 'unconfirmed', detail: 'Internal Server Error' });
  });

  it('D-4045: a gateway 502 or 504 is unconfirmed, never a refusal: the POST may have reached the server', () => {
    expect(stallWriteRefusal(new ApiError(502, 'Bad Gateway')))
      .toEqual({ kind: 'unconfirmed', detail: 'request failed (502)' });
    expect(stallWriteRefusal(new ApiError(502, { error: 'Bad Gateway' })))
      .toEqual({ kind: 'unconfirmed', detail: 'Bad Gateway' });
    expect(stallWriteRefusal(new ApiError(504, null)))
      .toEqual({ kind: 'unconfirmed', detail: 'request failed (504)' });
  });

  it('D-4045: a code this build does not know is unconfirmed, on any status, a 409 included', () => {
    expect(stallWriteRefusal(new ApiError(409, { ok: false, error: 'conflict', detail: 'changed twice' })))
      .toEqual({ kind: 'unconfirmed', detail: 'changed twice' });
    expect(stallWriteRefusal(new ApiError(400, { ok: false, detail: 'no code' })))
      .toEqual({ kind: 'unconfirmed', detail: 'no code' });
    expect(stallWriteRefusal(new ApiError(400, { ok: false, error: 'constructor' })).kind, 'an inherited key is no code')
      .toBe('unconfirmed');
  });

  it('never leaves either detail blank: a body whose only text is empty or whitespace names the HTTP status', () => {
    expect(stallWriteRefusal(new ApiError(400, { error: '' })), 'an empty error code')
      .toEqual({ kind: 'unconfirmed', detail: 'HTTP 400' });
    expect(stallWriteRefusal(new ApiError(503, { error: '   ' })), 'a whitespace-only error code')
      .toEqual({ kind: 'unconfirmed', detail: 'HTTP 503' });
    expect(stallWriteRefusal(new ApiError(422, { error: '', detail: '', message: ' ' })), 'every slot blank')
      .toEqual({ kind: 'unconfirmed', detail: 'HTTP 422' });
  });

  it('reads a rejection that is not an ApiError as unconfirmed with no detail, never a refusal: the POST may have landed', () => {
    expect(stallWriteRefusal(new TypeError('Failed to fetch'))).toEqual({ kind: 'unconfirmed', detail: null });
    expect(stallWriteRefusal(new Error('aborted'))).toEqual({ kind: 'unconfirmed', detail: null });
  });
```

The `constructor` row asserts `.kind` only: its detail is `HTTP 400`, because `API_ERROR_TEXT['constructor']` (a plain
`Record`) yields Object's constructor function, which `nonBlank` drops. That predates this wave and is not pinned.

- [ ] **Step 7: The new L0 line, and the section's rows**

In `shared/api.ts`, inside `STALL_CONFIRM_TEXT`, edit line for line, so the file stays at 9806 lines and nothing below
:9628 moves (the amendment to ruling 1; #384's only hunk in this file is its foot append, about 180 lines below).
Line 9599, the last line of the block's docstring, becomes:

```ts
 *  stage's, `{detail}` the server's detail, for a refusal or for an answer that confirms nothing. */
```

and :9626-9628 (the two-line D-4043 comment and `unanswered`) become these three:

```ts
  // No answer at all: unanswered-write-has-its-own-l0-line (D-4043). An answer with no refusal code: D-4045.
  unanswered: 'Not confirmed — the server did not answer; the screen will re-check.',
  unconfirmed: 'Not confirmed — the choice may or may not have been saved ({detail}); the screen will re-check.',
```

The dropped sentence ("The 2xx-unreadable arm keeps the PWA's shared UNCONFIRMED_TEXT.") lives on in the section's
comment (Step 11), which says the same. `unanswered` is unchanged.

`pwa/test/settings-screen.test.tsx` already imports `STALL_CONFIRM_TEXT` from `../../shared/api` (:39), so it gains no
import. Replace the 500 row (:2576-2584) line for line:

```ts
  it('P2 (D-4045): a 500 says the choice may or may not have been saved, with the cause the server named, and re-reads', async () => {
    const { read } = await mount(swView());
    const cause = 'stall settings unreadable, nothing written: disk gone';
    vi.spyOn(api, 'setStallWatch').mockRejectedValue(
      new ApiError(500, { statusCode: 500, error: 'Internal Server Error', message: cause }));
    fireEvent.click(radio(STALL_LEVEL_TEXT.log.label));
    expect(await screen.findByText(fillStallText(STALL_CONFIRM_TEXT.unconfirmed, { detail: cause }))).toBeInTheDocument();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  });
```

and insert directly after it (it pins the gateway arm, and ruling 4's plain toast, in the section):

```ts

  it('P2 (D-4045): a gateway 502 says the choice may or may not have been saved, plain, never "Nothing was changed", and re-reads', async () => {
    const { read } = await mount(swView());
    vi.spyOn(api, 'setStallWatch').mockRejectedValue(new ApiError(502, 'Bad Gateway'));
    fireEvent.click(radio(STALL_LEVEL_TEXT.log.label));
    const t = await screen.findByText(fillStallText(STALL_CONFIRM_TEXT.unconfirmed, { detail: 'request failed (502)' }), { selector: '.toast' });
    expect(t, 'a plain toast, as the unanswered line').not.toHaveClass('toast--error');
    expect(screen.queryByText(/^Nothing was changed/)).toBeNull();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(radio(STALL_LEVEL_TEXT.log.label)).not.toBeChecked();
  });
```

`fillStallText`, `ApiError`, `mount`, `swView`, `radio`, `STALL_CONFIRM_TEXT` and `STALL_LEVEL_TEXT` are already in
scope. These edits sit
between #384's hunks in this file (@@ -2279 and @@ -2636), with no shared context. If run 400's agreement covers the
500 row only, drop the 502 row and U6, and say in the wave-done that nothing then pins the plain toast; the fold's 502
row still pins the arm.

- [ ] **Step 8: Run them red**

From `pwa/`, one per command: `./node_modules/.bin/vitest run test/use-stall-watch-view.test.tsx` — Expected: 5
failed (D-4045: a 500 is unconfirmed…; D-4045: a gateway 502 or 504…; D-4045: a code this build does not know…; never
leaves either detail blank…; reads a rejection that is not an ApiError as unconfirmed with no detail…), each received
as `refused` or without `detail`; "D-4045: only the route's own codes are refusals…" passes before and after, the guard
against over-correcting. `./node_modules/.bin/vitest run test/settings-screen.test.tsx` — Expected: 2 failed (the two
"P2 (D-4045)" rows, which find "Nothing was changed: …" instead). Predicted; measure.

- [ ] **Step 9: The P6 scan covers the new line (the amendment to ruling 1)**

`settings-screen.test.tsx`'s "P6: no L0 STALL_* string names a device, and the Notifications row says push" (:2646 at
`f515cdfd4`) reads `import * as L0 from '../../shared/api'` (:37), takes every `STALL_*` export and walks each
object's values. `STALL_CONFIRM_TEXT` is an export of `shared/api.ts` and `unconfirmed` one of its values, so the row
now covers the new line with no edit to the row, which would sit beside #384's own P6 hunk (@@ -2636). Check it, out
of tree, and record it under D-4045:
- U7 (plant a device word in `STALL_CONFIRM_TEXT.unconfirmed`: `may not have been saved` → `may not have been saved on your phone`) → 1 failed (P6: no L0 STALL_* string names a device, and the Notifications row says push) — predicted; measure.

Measure it at the commit Step 13 makes first, with U1 to U6: red, then restore `shared/api.ts`, `cmp`-check it, and
re-run the row green. A red here proves the scan reads the line; a green would mean the line is outside it, and then
stop and tell the coordinator rather than widening the row.

- [ ] **Step 10: The fold**

In `pwa/src/fleet/useStallWatchView.ts`, insert after line 11 (`import { useCallback, … } from 'react';`), clear of
#384's import hunk after :17:

```ts
import { isStallWatchRefusal } from '../../../shared/stall-watch';
```

Lines 161-163 (one lower after the import, as is everything below it; `asStallConfirm`'s docstring, whose "Anything
else is an ordinary refusal" is no longer true) become:

```ts
/** The 409 body's guard: `error: 'confirm-required'`, a string `effectKey`, and an effect readable WHOLE. Nothing is
 *  dropped here: a sheet built from part of an effect would understate what the write does. Anything else is not a
 *  confirm: `stallWriteRefusal` reads it as a refusal on a known code and as unconfirmed otherwise. */
```

Lines 169-199 become these (line 200's `}` and everything below stay as they are; do not touch :17-26, :200-213 or
:236-240, the `f515cdfd4` lines #384 changes):

```ts
/** A write's rejection, read: the confirm the sheet shows, a refusal whose `detail` fills `STALL_CONFIRM_TEXT.refused`,
 *  or an answer that confirms nothing, which may have stored the write and so is never called a refusal. Its `detail`
 *  fills `STALL_CONFIRM_TEXT.unconfirmed`, and is null when no answer arrived (`STALL_CONFIRM_TEXT.unanswered`). */
export type StallWriteRefusal =
  | { kind: 'confirm'; confirm: StallConfirmRequired }
  | { kind: 'refused'; detail: string }
  | { kind: 'unconfirmed'; detail: string | null };

/** A string with something in it, trimmed; anything else is null. */
const nonBlank = (v: unknown): string | null => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : null);

/**
 * A confirm needs BOTH the 409 status and a body `asStallConfirm` reads, as not-configured needs both its status and
 * its code. An `ApiError` whose body's `error` is one of the route's own codes (`isStallWatchRefusal`, L0's
 * `STALL_WATCH_REFUSALS`) is a refusal: the route answered it before any write. Every other `ApiError` is
 * `unconfirmed` (`an-answer-without-a-refusal-code-reads-unconfirmed` (D-4045)): a gateway's 502 or 504 can follow a
 * POST that reached the server, and a 500 can follow a store that committed, so its answer proves nothing about the
 * write. Either detail is the first non-blank of the server's own `detail` (a 400 naming an unknown key), the body's
 * `message` (Fastify's 500 carries the cause the route threw there), the error's own text through `apiErrorText` (a
 * non-JSON body), and last the HTTP status (an `{ error: '' }` body leaves that text empty), so neither line renders
 * with an empty slot. The status text is not an L0 line: it fills the server-answer detail slot, not section copy.
 *
 * A rejection that is not an `ApiError` is a network failure, and the POST may have left before it: the write may
 * have landed. It is `unconfirmed` with no detail, never a refusal, so the section never says "Nothing was changed"
 * about it.
 */
export function stallWriteRefusal(err: unknown): StallWriteRefusal {
  if (!(err instanceof ApiError)) return { kind: 'unconfirmed', detail: null };
  const confirm = err.status === 409 ? asStallConfirm(err.body) : null;
  if (confirm !== null) return { kind: 'confirm', confirm };
  const body = isObject(err.body) ? err.body : {};
  const detail = nonBlank(body.detail) ?? nonBlank(body.message) ?? nonBlank(apiErrorText(err)) ?? `HTTP ${err.status}`;
  return isStallWatchRefusal(body.error) ? { kind: 'refused', detail } : { kind: 'unconfirmed', detail };
```

The `refused` arm carries no `code` (#384's does, because its words table keys on it). The section shows one refusal
line, so a field would only churn every `toEqual`. A 409 that carries `confirm-required` but fails the guard stays
`refused`, because the route sent that code before writing.

- [ ] **Step 11: The section**

`pwa/src/screens/StallWatchSection.tsx` already imports `STALL_CONFIRM_TEXT` from `shared/api` (:23-30), so it gains
no import here. Lines 297-303 become, seven for seven:

```ts
  // Only the field moved, and `confirm` only as the key the server sent. Every answer is the server's: a reply
  // that reads is settled, a 2xx the guard cannot read was answered and may have landed (UNCONFIRMED_TEXT, the
  // shared "Saved — the answer could not be read" line, then a re-read), a 409 the guard reads opens the sheet, and
  // a refusal carrying one of the route's own codes is toasted with the server's detail before a re-read. Any other
  // answer (a gateway's 502, a 500 after the store committed) confirms nothing: STALL_CONFIRM_TEXT.unconfirmed, with
  // its detail (`an-answer-without-a-refusal-code-reads-unconfirmed` (D-4045)). No answer at all (a network failure)
  // is STALL_CONFIRM_TEXT.unanswered (D-4043). Neither says "Saved" or "Nothing was changed"; both re-read.
```

Lines 323-324 become these four; `reload()` on the next line runs after every arm, unchanged:

```ts
          if (refusal.kind === 'refused') {
            toast(fillStallText(STALL_CONFIRM_TEXT.refused, { detail: refusal.detail }), 'error');
          } else if (refusal.detail === null) toast(STALL_CONFIRM_TEXT.unanswered);
          else toast(fillStallText(STALL_CONFIRM_TEXT.unconfirmed, { detail: refusal.detail }));
```

The words a user sees:
- a known refusal, unchanged: "Nothing was changed: <detail>", an error toast;
- an answer with no known code, new and plain (ruling 4): "Not confirmed — the choice may or may not have been saved
  (<detail>); the screen will re-check.";
- no answer, unchanged and plain: "Not confirmed — the server did not answer; the screen will re-check.";
- a 2xx that cannot be read, unchanged: `UNCONFIRMED_TEXT`.

The file's rule at :17-20 holds: every word is an L0 `STALL_*` constant filled by `fillStallText`, apart from
`UNCONFIRMED_TEXT`.

- [ ] **Step 12: Run them green**

From `pwa/`, one per command: `test/use-stall-watch-view.test.tsx` and `test/settings-screen.test.tsx` — Expected: all
pass, these unchanged rows included: "P2: a refused write toasts the server's detail, re-reads, and leaves the stored
radio checked" (a 400 `bad-request`), "a write whose answer never arrived says it was not confirmed, never "Saved" or
"Nothing was changed", and re-reads" (a `TypeError`, so `unanswered`), and "P2: a cancelled or refused quiet write
leaves the select on the stored value, never the tap". Then `./node_modules/.bin/tsc --noEmit -p .` (a `pwa/` checkout
needs its own `npm ci`).

- [ ] **Step 13: The rows**

First commit this task's code and test edits so far (the commit step below then commits only what remains).
Out of tree, one at a time, both PWA files run for each; record each under D-4045:
- U1 (the fold's last line → `return { kind: 'refused', detail };`) → 6 failed (D-4045: a 500 is unconfirmed, never a refusal: the store may have committed before the throw; D-4045: a gateway 502 or 504 is unconfirmed, never a refusal: the POST may have reached the server; D-4045: a code this build does not know is unconfirmed, on any status, a 409 included; never leaves either detail blank: a body whose only text is empty or whitespace names the HTTP status; P2 (D-4045): a 500 says the choice may or may not have been saved, with the cause the server named, and re-reads; P2 (D-4045): a gateway 502 says the choice may or may not have been saved, plain, never "Nothing was changed", and re-reads) — predicted; measure.
- U2 (the fold's last line → `return { kind: 'unconfirmed', detail };`) → about 6 failed (D-4045: only the route's own codes are refusals, and the list is L0's; reads a confirm body on any other status as a refusal: the status and the code must both match; reads a 409 whose body is not a readable confirm as a refusal that still names something; takes the server's detail when it sends one; P2: a refused write toasts the server's detail, re-reads, and leaves the stored radio checked; P2: a cancelled or refused quiet write leaves the select on the stored value, never the tap) — predicted; measure.
- U3 (`.includes(v)` → `v in STALL_WATCH_REFUSAL_TABLE` in `isStallWatchRefusal`) → 1 failed (D-4045: a code this build does not know is unconfirmed, on any status, a 409 included), at its `constructor` row — predicted; measure.
- U4 (the fold's network arm, `detail: null` → `detail: String(err)`) → 2 failed (reads a rejection that is not an ApiError as unconfirmed with no detail, never a refusal: the POST may have landed; a write whose answer never arrived says it was not confirmed, never "Saved" or "Nothing was changed", and re-reads) — predicted; measure.
- U5 (the section's two unconfirmed arms → one `else toast(STALL_CONFIRM_TEXT.unanswered);`) → 2 failed (the two "P2 (D-4045)" rows) — predicted; measure.
- U6 (the section's unconfirmed toast given `'error'`) → 1 failed (P2 (D-4045): a gateway 502 says the choice may or may not have been saved, plain, never "Nothing was changed", and re-reads), at `not.toHaveClass('toast--error')` — predicted; measure.

Re-run RC2 now that Part B has landed, run both PWA files, and record its `pwa/` half.

- [ ] **Step 14: Commit Part B**

```bash
git add shared/api.ts pwa/src/fleet/useStallWatchView.ts pwa/src/screens/StallWatchSection.tsx \
  pwa/test/use-stall-watch-view.test.tsx pwa/test/settings-screen.test.tsx
git commit -m "fix(pwa): a stall-watch save whose answer carries no refusal code reads unconfirmed (D-4045)"
```

### Task 5: one duration formatter in L0, and the README pin's derived words (R37, rulings 1 and 10)

**Files:**
- Modify: `shared/stall-watch.ts` (the header's list; `stallDurationText` at the end)
- Modify: `pwa/src/screens/StallWatchSection.tsx` (an import after :30; `quietText`, :46-54, one lower after it)
- Modify: `server/src/coord/stallsettings.ts` (an import after :11; :15; :465-470)
- Modify: `server/test/stall-settings.test.ts` (:809, :812, :828)
- Modify: `server/test/stall-settings-readme.test.ts` (an import after :22; :48-50; :52-57; :93)
- Modify: `server/test/single-definition.test.ts` (one describe after :4160) — **held, run 400**
- Modify: `docs/superpowers/plans/2026-10-05-stall-watch-settings-w2-pwa.md` (:3266, two lower after Task 4)
- Read only: `pwa/test/settings-screen.test.tsx` (its one `DEVICE_WORD` line, :2633 at `f515cdfd4`)

**Interfaces:**
- Produces: `stallDurationText(ms: number): string`, rounding to the minute first: "30 min", "2 h", "1 h 30 min".
  `quietText` (PWA) and `stallQuietWords` (L1) become it, and their callers do not change.
- Consumes: `stallCode`, `ALL`, `rel` and `ccrcRoot` in `single-definition.test.ts`; `here`, `readFileSync` and
  `path` in `stall-settings-readme.test.ts`.

Why: the two copies disagree off the minute grid (3 570 000 ms is "1 h" in `quietText`, which rounds the minutes first,
and "60 min" in `stallQuietWords`, which floors the hours first). The PWA's algorithm is kept. The README pin's
`DEVICE_WORD` is a byte-identical copy of the PWA scan's list, and `single-definition.test.ts` scans no test file, so
the pin reads the PWA's literal the way it already reads README.

The single-definition describe is the formatter's red-first guard, so Steps 1 and 3 to 6 and the `duration` half of
Step 7 wait for run 400's relay. Step 2 and the device-word half of Step 7 do not; commit them alone if the relay is
late.

- [ ] **Step 1: The single-definition describe, red first (held, run 400)**

Insert after :4160 (the `});` that closes "worker stall watch: the wave-done subject is spelled once…"; below the :4088
line that nothing above may move, below every cited line, and above #384's hunks at :5654 and the end of the file):

```ts

describe('the stall watch words a duration once, in shared/stall-watch.ts (stall-watch-settings R37 follow-up)', () => {
  // The Settings section's `quietText` and the feed body's `stallQuietWords` were two copies of one formatter, and they
  // disagreed off the minute grid (3 570 000 ms read "1 h" in one and "60 min" in the other). The fingerprint is the
  // formatter's last arm, the hours-and-minutes template, on a code line. KNOWN WIDTH: a copy that builds the string
  // another way is not seen.
  const HOURS_AND_MINUTES = /`\$\{\w+\} h \$\{\w+\} min`/;
  it('CONTROL: the fingerprint sees the template and not another shape', () => {
    expect(HOURS_AND_MINUTES.test('return m === 0 ? `${h} h` : `${h} h ${m} min`;')).toBe(true);
    expect(HOURS_AND_MINUTES.test('return `${h}h${m}m`;')).toBe(false);
  });
  it('the template is spelled on a code line in shared/stall-watch.ts alone', () => {
    expect(ALL.filter((f) => HOURS_AND_MINUTES.test(stallCode(f))).map(rel).sort()).toEqual(['shared/stall-watch.ts']);
  });
  it('the section and the feed body import it from L0', () => {
    for (const r of ['pwa/src/screens/StallWatchSection.tsx', 'server/src/coord/stallsettings.ts']) {
      expect(stallCode(path.join(ccrcRoot, r)), r)
        .toMatch(/import\s*\{[^}]*\bstallDurationText\b[^}]*\}\s*from\s*'(?:\.\.\/)+shared\/stall-watch(?:\.js)?'/);
    }
  });
});
```

Run `./node_modules/.bin/vitest run test/single-definition.test.ts -t 'words a duration once'` — Expected: 2 failed
("the template is spelled … alone", with holders `pwa/src/screens/StallWatchSection.tsx` and
`server/src/coord/stallsettings.ts`; "the section and the feed body import it from L0", for both readers); the CONTROL
passes. Predicted; measure.

- [ ] **Step 2: The device-word hole, before**

Out of tree, with `stall-settings-readme.test.ts` as it is:
- DW1 (add `|kiosks?` to the PWA's `DEVICE_WORD` in `settings-screen.test.tsx`, found by its text, and plant ` on a kiosk` in README's Settings paragraph) → 0 failed: the server's copy lacks the word, the hole — predicted; measure.

- [ ] **Step 3: The formatter in `shared/stall-watch.ts`**

Add a second item to the header's list, after the refusal codes' item (above the line that names
`STALL_CONFIRM_TEXT.unconfirmed`'s home):

```ts
// - `stallDurationText`, the one duration formatter: the Settings section writes every duration it shows with it (the
//   quiet bounds, step and built-in, the counts window), and the server's feed body writes a quiet-time change with
//   it, so one value is never worded two ways. `single-definition.test.ts` holds the hours-and-minutes template here.
```

and append at the end of the file:

```ts

/** A span in hours and minutes, rounded to the minute first: "30 min", "2 h", "1 h 30 min". */
export function stallDurationText(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
```

- [ ] **Step 4: The section's `quietText`**

In `pwa/src/screens/StallWatchSection.tsx`, insert after line 30 (`} from '../../../shared/api';`; the research said
:29, and the text decides):

```ts
import { stallDurationText } from '../../../shared/stall-watch';
```

and `quietText`'s docstring and body (:46-54, one lower after the import) become:

```ts
/** A span in hours and minutes, "30 min", "2 h", "1 h 30 min": every duration the section shows comes off the
 *  wire (the quiet bounds, step and built-in, the counts window) and is written by L0's one formatter,
 *  `stallDurationText` (`shared/stall-watch.ts`), which the server's feed body uses too. The name stays for the
 *  section's callers and its tests. */
export const quietText: (ms: number) => string = stallDurationText;
```

Every `quietText(` call site and `settings-screen.test.tsx`'s import of it stay unchanged.

- [ ] **Step 5: The feed body's `stallQuietWords`**

In `server/src/coord/stallsettings.ts`, insert after line 11 (`import type { MailTurnMode } from '../turnidle.js';`):

```ts
import { stallDurationText } from '../../../shared/stall-watch.js';
```

Line 15 (one lower) becomes:

```ts
 * idiom: value imports come only from L0 (`shared/api.ts`, `shared/stall-watch.ts`), `./stall.js` and `../turnidle.js`.
```

and :465-470 (one lower) become:

```ts
/** A quiet time as the feed body writes it: `30 min`, `2 h`, `2 h 30 min`, by L0's one formatter, the one the Settings
 *  section writes every duration with. */
const stallQuietWords = stallDurationText;
```

The two calls at :477-478 stay unchanged; they run inside functions, after the module has loaded. The file stays L1:
no clock, no I/O, no marker name. Its kebab scan (`stall-settings.test.ts`, M18) sees no new quoted kebab word, because
an import path starts with `.`.

- [ ] **Step 6: M19 and M19b name the new file**

In `server/test/stall-settings.test.ts`, line for line, :809, :812 and :828 become, in that order:

```ts
  it('finds shared/api.ts, shared/stall-watch.ts and server/src/coord/stallsettings.ts', () => {
```

```ts
    for (const f of ['shared/api.ts', 'shared/stall-watch.ts', 'server/src/coord/stallsettings.ts']) expect(all, f).toContain(f);
```

```ts
  const ALLOWED = ['../../../shared/api.js', '../../../shared/stall-watch.js', './stall.js', '../turnidle.js'];
```

This widens M19b's guard by one L0 path, the only route in for the new import. Record it in the wave-done.

- [ ] **Step 7: The README pin**

In `server/test/stall-settings-readme.test.ts`, the device-word half (R37's README pin item) replaces :48-50, three
lines for three:

```ts
/** The device words the PWA's own P6 scan refuses, read from that scan's one `DEVICE_WORD` literal in `pwa/test/settings-screen.test.tsx`: a server test cannot import a PWA test file, so the list is derived, never spelled twice. */
const PWA_DEVICE_WORD = [...readFileSync(path.resolve(here, '..', '..', 'pwa', 'test', 'settings-screen.test.tsx'), 'utf8').matchAll(/^\s*const DEVICE_WORD = \/(.+)\/([a-z]*);$/gm)];
const deviceWord = (): RegExp => { expect(PWA_DEVICE_WORD, 'the PWA scan spells DEVICE_WORD once').toHaveLength(1); return new RegExp(PWA_DEVICE_WORD[0]![1]!, PWA_DEVICE_WORD[0]![2]); };
```

and :93 becomes these two lines:

```ts
    expect(deviceWord().test('shown on a phone'), 'CONTROL: the derived list sees a device').toBe(true);
    expect(settingsParagraph()).not.toMatch(deviceWord());
```

The `duration` half (ruling 10) inserts after :22:

```ts
import { stallDurationText } from '../../shared/stall-watch.js';
```

and replaces :52-57 (one lower) with:

```ts
/** A duration the way the section writes one: L0's one formatter (`shared/stall-watch.ts`). */
const duration = stallDurationText;
```

The header's "The only text this file copies is its anchor words" (:6-7) is now true. `stall-settings-route.test.ts`
keeps its own, different `/phone/i` (server prose), untouched. A change to the PWA's list selects this pin in CI only
once the selection map is rebuilt (a traced read); the daily and stable full runs catch it until then.

- [ ] **Step 8: The W2 plan's cite (ruling 10)**

In the W2 plan, :3266 (two lower after Task 4), replace `stall-settings-readme.test.ts:90` with the line the device
row's `it(` stands on after Step 7 (`grep -n "names no device" server/test/stall-settings-readme.test.ts`). Predicted:
:89 with both halves of Step 7, :92 with the device-word half alone.

- [ ] **Step 9: Run them green**

From `server/`, one per command: `test/single-definition.test.ts`, `test/stall-settings.test.ts`,
`test/stall-settings-readme.test.ts`, `test/stall-settings-route.test.ts`, `test/mail-routes.test.ts` (its kebab scan
reads `coord/`), and both `tsc` runs (`-p .` and `-p test/tsconfig.tests.json`). Every feed-body row in
`stall-settings.test.ts` stays green with its expected text unchanged, because every server quiet value is on the
30-minute grid. From `pwa/`: `test/settings-screen.test.tsx` (its `quietText` rows) and `tsc --noEmit -p .`.

- [ ] **Step 10: The rows**

First commit this task's code and test edits so far (the commit step below then commits only what remains).
Out of tree, one at a time:
- SD1 (the old `stallQuietWords` function body pasted back into `stallsettings.ts` in place of the alias) → 1 failed (the template is spelled on a code line in shared/stall-watch.ts alone) — predicted; measure.
- SD2 (`'../../../shared/stall-watch.js'` dropped from M19b's `ALLOWED`) → 1 failed (takes value imports only from L0, stall.ts and turnidle.ts; anything else is a type import) — predicted; measure.
- SD3 (`quietText`'s own body restored in `StallWatchSection.tsx`, and its `stallDurationText` import line deleted) → 2 failed (the template is spelled on a code line in shared/stall-watch.ts alone; the section and the feed body import it from L0) — predicted; measure.
- DW1 (as in Step 2, after Step 7) → 1 failed (the Settings paragraph names no device, as the section itself names none (§2, 2026-10-05)) — predicted; measure.
- DW2 (the PWA's `DEVICE_WORD` line duplicated) → 1 failed (the same title, at "the PWA scan spells DEVICE_WORD once") — predicted; measure.
- DW3 (control, as at R35: README's "the push bell" → "the phone-push bell") → 1 failed (the same title) — predicted; measure.

Record them in this plan's Measured rows.

- [ ] **Step 11: Commit**

```bash
git add shared/stall-watch.ts pwa/src/screens/StallWatchSection.tsx server/src/coord/stallsettings.ts \
  server/test/stall-settings.test.ts server/test/stall-settings-readme.test.ts server/test/single-definition.test.ts \
  docs/superpowers/plans/2026-10-05-stall-watch-settings-w2-pwa.md
git commit -m "refactor(stall): one duration formatter in L0, and the README pin reads the PWA's device words (R37)"
```

### Task 6: the stale comments and README (R51 (e), (f); R37's `MAIL_REPLAY_MS` item)

**Files (all held; wait for each relay):**
- Modify: `server/src/coord/store.ts` (:7279-7291, `restampAsk`'s docstring) — run 400
- Modify: `server/src/watch.ts` (:7747-7752, the SAME DIALOG comment in `detectDialogs`) — run 400
- Modify: `README.md` (:5458-5459, in "How a session's state is known") — run 354
- Modify: `shared/api.ts` (:9413-9414, `MAIL_REPLAY_MS`'s docstring) — run 400

**Interfaces:** none. Comments and one README sentence; every file keeps its line count.

Why: since D-4041 a subagent event over a MAIN-thread wait keeps `updatedAt` and writes `aliveAt` (`_hook_fresh_read`
and `_hook_keep_stamp`, `ccd/session-hook.sh` :3842-3866). The bump survives only for a wait a subagent raised
(`waitBy:"subagent"`, which `ask-instance-guard.test.ts`'s last describe pins) and for any other bump: a stored stamp
the carry cannot keep, or a main-thread write that re-sends the same question. The aged door reads
`max(updatedAt, aliveAt)` (`server/src/hookstate.ts` :353-360). `asks-mint.test.ts`, `ask-instance-guard.test.ts` and
`registry.ts`'s `freshAskAt` docstring were scoped in wave 3 and need no edit.

- [ ] **Step 1: `restampAsk` and the SAME DIALOG comment, together**

Land these two in one commit: the watch.ts comment defers to the store.ts docstring for the list of bumps.

In `server/src/coord/store.ts`, replace :7279-7291 (13 lines) with these 13. The `:1227` and `:1233` anchors are kept,
marked "then", because they are D-2404's history; no instrument audits `store.ts` anchors:

```ts
   *  instance 2. What it does not say is that `updatedAt` moves for reasons
   *  that have nothing to do with the dialog: `ccd/session-hook.sh` stamped it
   *  on EVERY write, and its `SubagentStart`/`SubagentStop` arm re-read `.ask`
   *  straight back off the file (`:1227` then — D-2404: that re-read, NOT the
   *  `:1233` ask-clear exemption two reviewers named, since `state` is `waiting`
   *  on this path) and restored `prev_state`, so a subagent event on a session
   *  blocked at a dialog rewrote the identical envelope under a fresh number.
   *  Since D-4041 a MAIN-thread wait keeps its `updatedAt` and gains `aliveAt`,
   *  so that bump survives only for a wait a SUBAGENT raised (`waitBy:"subagent"`,
   *  not carried) and for any other bump. Nothing re-stamped the row, so ONE
   *  such bump refused every parent answer for the row's whole life and the lane
   *  degraded, silently and greenly, to the pre-feature behaviour. Measured in
   *  `server/test/ask-instance-guard.test.ts` (its last describe: the stamp that still moves).
```

In `server/src/watch.ts`, replace :7747-7752 (six lines) with these six; :7741-7746 and :7753
(`this.restampHeldAsk(r.id, dialog.id);`) are unchanged:

```ts
          // over a bump nobody made — see `restampAsk`'s own docstring for
          // the writers that still do this (since D-4041 a subagent event over
          // a MAIN-thread wait keeps `updatedAt`; one over a wait a subagent
          // raised, and any other bump, still moves it) and for why
          // re-stamping is not a weakening. Runs BEFORE the amendment gate, and
          // independent of it, whether or not the notification is replaced.
```

Both edits sit far from #384's hunks (`store.ts` :29 and :7941 onward; `watch.ts` at or below :4631).

- [ ] **Step 2: README's aged door (held, run 354)**

Replace README.md :5458-5459 (two lines) with these two; :5454-5457 and :5460-5464 are unchanged:

```markdown
check it against, or a file whose `updatedAt`, and `aliveAt` when it has one, are both over 30 minutes old (D-4041: a
subagent event over a main-thread wait keeps the wait's start in `updatedAt` and writes `aliveAt` = now). `null` therefore means *no fresh hook data* — never a fourth state. That folded read, `readHookState`, has
```

The second line carries :5459's words, so :5460 ("a measured sibling, `readHookStateMeasured`, …") continues the
sentence unchanged. Check: `git diff -U0 -- README.md` shows two lines removed and two added, `fresh hook data*` and
`That folded read` each still occur once in the paragraph, and `sed -n 5460p README.md` still begins
`a measured sibling`. The new lines carry no `:<digit>` token, so the README instrument's resolved count (7) does
not move, and no test pins the sentence's text, so only this check catches a lost line.

- [ ] **Step 3: `MAIL_REPLAY_MS`'s docstring (held, run 400)**

Replace `shared/api.ts` :9413-9414 with these two lines (comment only; the constant stands at :9415 of 9806 lines, and
the stall block's own lead at :9418 already says it was appended below it):

```ts
 *  It was APPENDED where this file then ended, not beside `MAIL_MAX_ATTEMPTS`: README and the compaction card cite this
 *  file by line, and an insertion above those lines moves every anchor under it. Later blocks follow it. */
```

- [ ] **Step 4: Check and commit**

`wc -l` of all four files equals the Precondition's. From `server/`: `./node_modules/.bin/tsc --noEmit -p .` and the
citation instrument (its `Tests` line equal to the Precondition's). The diff against `origin/main` of `store.ts` and
`watch.ts` changes comment lines only, and of `shared/api.ts` comment lines only apart from Task 4's `unconfirmed:`
line, once Task 4 Part B has landed.

```bash
git add server/src/coord/store.ts server/src/watch.ts README.md shared/api.ts
git commit -m "docs(stall): restampAsk, the SAME DIALOG comment and README name the kept stamp (R51 (e), (f))"
```

Commit each file alone if its relay arrives alone, keeping `store.ts` and `watch.ts` together.

### Task 7: R37's plan and test items (rulings 7 and 8)

**Files:**
- Modify: `docs/superpowers/plans/2026-10-05-stall-watch-settings-w2-pwa.md` (X table, Task 4, File Structure, row L,
  the absorb note, post-merge step 3)
- Modify: `pwa/test/box-token-card.test.tsx` (header :6-8) — **held, run 400**
- Modify: `pwa/test/settings-screen.test.tsx` (:2412, the source-`default` row's fixture) — **held, run 400**

**Interfaces:** none; prose, one comment and one fixture.

In the W2 plan, every anchor below is at `f515cdfd4`; Task 4 moved them down by two lines. Edit from the bottom up
(Steps 1 to 5 run in that order), so each anchor holds. No tracked file cites W2 plan lines. The X rows' counts are
copied from the review reports (review 340: X37 3, X38 2, X41 4 and X59 1, of 187; review 392: X43 27 of 188). The 500
row title these rows quote is the one wave 2 shipped; Task 4 renames that row, and the W2 table, a dated record, keeps
the name it was measured under.

- [ ] **Step 1: The absorb note and post-merge step 3**

:3934 becomes:

```markdown
   - the **Stall watch** section sits after Notifications (the fourth `<h2>` once the updates poll lands);
```

:3909-3912 become (four for four):

```markdown
  > Review 390 then found the Stall watch lead's ordinal false: `main`'s Box token card is a section on screen, so
  > Stall watch is the fourth `<h2>` once the updates poll lands (the third while it loads). The R35 fix round moved
  > the Stall watch lead to `Settings then has a further section, **Stall watch**` and renamed `THIRD` to `STALL_LEAD`.
  > Rows, messages and the header docstring follow it (commit `5756b3b29`). The history above is left as written.
```

The tests already pin both states ("LOADING state (…)" and "LANDED state (…)" in `settings-screen.test.tsx`); no test
changes.

- [ ] **Step 2: Row L's runner**

:3549-3551 become these five lines:

```markdown
> section itself names none (§2, 2026-10-05)" reds (1 failed). Both were measured at R35, README restored and checked
> with `cmp`, by `fr4-mut-f1.py`: a runner kept outside the tree by design (Step 6's `$INSTR`) and never committed, so
> this plan names it but cannot re-run it, and the anchors it quotes wrap across README lines, so collapse whitespace
> first, as the pin's `settingsParagraph` does. Row G's appended sentence and the `Settings has a third section` wording
> in rows A and G are first-cut text. The same rename applies, and the shipped lead is the one to append.
```

- [ ] **Step 3: Task 4's first-cut counts**

:3524 becomes:

```markdown
| A | The third section is stated | README as at `README_BASE` (the sentence absent) | stall-settings-readme | 5 failed (5): all five first-cut rows (six rows ship; this row was not re-run on them) |
```

:3446-3447 become these two, where each `<TAB>` is the literal tab character the line holds now:

```markdown
Expected (measured): `17<TAB>1<TAB>README.md`; Step 1's count plus 16 (5700 on the prototype); `Tests  5 passed (5)` on the
five-row first cut (`6 passed (6)` as shipped); `Tests  7 passed | 328 skipped (335)`, unchanged.
```

:3397-3399 become these four:

```markdown
Expected (measured on the prototype's five-row first cut; six rows ship): `Tests  5 failed (5)`. Row 1 fails
`expected -1 to be greater than 1257` (the offset of the Notifications sentence in the joined paragraph; the number
moves if the paragraph's earlier text moves); rows 2–5 fail `the Settings paragraph names no third section: expected
-1 to be greater than -1`.
```

"6 passed (6)" is measured (reviews 340, 390 and 392). Row A against the six-row pin is not measured, so the text does
not state its count.

- [ ] **Step 4: The X table**

Line for line, each row staying one line. In :3215, replace the sentence `All are counted out of 187.` with:

```markdown
X48, X60 and X61 to X66 are counted out of 187, as are X37, X38, X41 and X59 as review 340 re-measured them; X43, as review 392 re-measured it, out of 188; every other row out of 183.
```

:3206 becomes:

```markdown
| X59 | Task 1's 500 `message` arm, seen in the section | H: ``nonBlank(body.detail) ?? nonBlank(body.message) ?? nonBlank(apiErrorText(err)) ?? `HTTP ${err.status}` `` → ``nonBlank(body.detail) ?? nonBlank(apiErrorText(err)) ?? `HTTP ${err.status}` `` | `1 failed` of 187 (re-measured on the shipped line by review 340): "P2: a 500 toasts the cause the server named in its message, and re-reads" |
```

:3191 becomes:

```markdown
| X43 | the section is mounted | `SettingsScreen.tsx`: delete the line `      <StallWatchSection />` | `27 failed` of 188 (re-measured by review 392 at R35): every case of the describe "SettingsScreen — stall watch: the section (design 2026-10-05 §13)", all 27: the 22 first listed here (two now under new titles, "LOADING state (…)" and "a write whose answer never arrived says it was not confirmed…"), the "LANDED state (…)" case R35 added, and the four pinned built-in rows of fix rounds 2 and 3 |
```

:3189 becomes:

```markdown
| X41 | a refused or unconfirmed rejection re-reads | SWS: delete the `          reload();` after the rejection arm's `else toast(…, 'error');` line | `4 failed` of 187 (re-measured by review 340): "P2: a 500 toasts the cause the server named in its message, and re-reads"; "P2: a cancelled or refused quiet write leaves the select on the stored value, never the tap"; "P2: a refused write toasts the server's detail, re-reads, and leaves the stored radio checked"; "a write whose answer never arrived says it was not confirmed, never "Saved" or "Nothing was changed", and re-reads" |
```

:3186 becomes:

```markdown
| X38 | the select shows no value it does not hold | SWS: delete the line `          {quietValue === QUIET_NONE && <option value={QUIET_NONE} disabled hidden />}` | `2 failed` of 187 (re-measured by review 340): "a stored quiet time equal to the built-in as a number is a pinned choice, shown as its own option labelled plain like every step; one off the list (the server cannot send it today) selects none"; "an absent or unreadable stored level checks no radio, and the quiet select shows no built-in it does not hold" |
```

:3185 becomes:

```markdown
| X37 | the built-in appears once | SWS: `if (ms !== builtInMs) choices.push` → `if (true) choices.push` | `3 failed` of 187 (re-measured by review 340): "a stored quiet time equal to the built-in as a number is a pinned choice, shown as its own option labelled plain like every step; one off the list (the server cannot send it today) selects none"; "quietChoices: the built-in first, then every step from min to max except the built-in, which appears once"; "renders the Now block, the Next step, the quiet time and the counts from the view" |
```

:3147 becomes:

```markdown
| # | Guard | Mutation | Red (measured failing count, test names; out of 183 unless the row says 187 or 188) |
```

The X59 anchor (`nonBlank(body.detail) ?? nonBlank(body.message) ?? nonBlank(apiErrorText(err)) ?? …`) still occurs
exactly once in `useStallWatchView.ts` after Task 4, on the `const detail` line. X37's third title is review 340's
attribution, not a listing: if the coordinator wants it measured, re-run X37, X38 and X43 once on the final tree.

- [ ] **Step 5: The File Structure rows**

The `shared/api.ts` row is :323 at `f515cdfd4` (the research said :321; the row's text decides). It becomes:

```markdown
| `shared/api.ts` | one key, `STALL_CONFIRM_TEXT.unanswered`, inside W1's stall-watch block (`unanswered-write-has-its-own-l0-line`), and, in fix round 2, the two-line D-4043 comment above that key (no string changed); the review's item 5 edit to the block's header comment is the coordinator's (ledger R20, R21); and, at R35 (its R1, `2f82b1ff8`), the block's lead comment, line for line, which now says the block was "APPENDED below `MAIL_REPLAY_MS` (later blocks follow it)" | fix round 1, R35 |
```

and this row is inserted after it:

```markdown
| `pwa/test/box-token-card.test.tsx` | `main`'s file, licensed by R35 (review 390's F4): `spyStallWatch` and its two calls (+7 lines), so no card case fetches `/api/coord/stall-watch` live (`082cc2131`); the screen's banner still fetches `/api/auth/status` | R35 |
```

- [ ] **Step 6: The box token card's header (held, run 400)**

In `pwa/test/box-token-card.test.tsx`, :6-8 become (three for three):

```ts
// The idiom is settings-screen.test.tsx's: the full afterEach (cleanup, restoreAllMocks, the route back
// to '/', the fleet store reset) and `api` spied. One live fetch is left: the screen's unarmed-exposure
// banner reads GET /api/auth/status through `readAuthStatus`, a global `fetch` this file does not stub.
```

Lines :52-53 are left as they are, because #384 rewrites :52-54 and their fix rides in #384's own text (ruling 7).
Review 392 measured the banner's fetch: 30 live `/api/auth/status` fetches over the file's 61 cases.

- [ ] **Step 7: The source-`default` row's fixture (held, run 400; ruling 8)**

First measure X65 on the current fixture, out of tree:
- X65, before (`StallWatchSection.tsx`, the pinned option's `label: quietText(pinnedBuiltIn)` → `label: fillStallText(STALL_SECTION_TEXT.chosenHere, { value: quietText(pinnedBuiltIn) })`) → 2 failed (a stored quiet time equal to the built-in as a number is a pinned choice, shown as its own option labelled plain like every step; one off the list (the server cannot send it today) selects none; a pinned built-in number reads plain "2 h" in the select whatever the quiet line says: under a fallback (source default) the line reads built-in and the option still reads plain) — measured by wave 2; measure again.

Then in `pwa/test/settings-screen.test.tsx`, :2412 (find it by its text) becomes, giving the row the fallback its
title names (the shape the row at :2093 already uses):

```ts
    await mount(swView({ chosen: swChosen({ quietMs: builtIn }), quiet: { ...swView().quiet, effectiveMs: builtIn, source: 'default' }, fallback: { at: 5, reason: 'the resolver threw' } }));
```

Commit the fixture first (Step 8's commit then holds only what remains), and measure at that commit:
- X65, after (the same mutation) → 2 failed (the same two titles) — predicted; measure.

The fallback renders `STALL_FALLBACK_TEXT` in the section; the row's three assertions look for other nodes, and a
reviewer's probe found it green with a real fallback (wave 2, fix round 3). The title is not changed, so the W2 plan's
citations of it (:3209-3212, :3737-3738) stay true.

- [ ] **Step 8: Run and commit**

From `pwa/`, one per command: `test/settings-screen.test.tsx`, `test/box-token-card.test.tsx`. The W2 plan's prose
lines that Steps 1 to 3 wrote are at most 120 characters.

```bash
git add docs/superpowers/plans/2026-10-05-stall-watch-settings-w2-pwa.md pwa/test/box-token-card.test.tsx \
  pwa/test/settings-screen.test.tsx
git commit -m "docs(stall): R37's W2 plan snapshots, the box token card header and the source-default fixture"
```

### Task 8: the W3 plan's stale note, then the rewrap (R51 (g), rulings 11 and 12)

**Files:**
- Modify: `docs/superpowers/plans/2026-10-12-stall-watch-settings-w3-hidden-ask.md` (:37, :39, :88, :97-98; then the
  rewrap)

**Interfaces:** none; prose.

What is still false against the shipped hook: the Task 1 note (:97-98) says D-4041 supersedes the snippet only
"wherever it handles the stamp", but the shipped carry also decides from one fresh read, carries a main-thread wait
only and resets `waitby`; and :37-39 and :88 say the change sits "directly after" the SubagentStart/SubagentStop block,
while the fresh read and `_hook_keep_stamp` sit before it and the block itself was edited. The snippet, the steps and
the retired case stay as the first round's text (R43, ruling 12); only the note changes.

- [ ] **Step 1: The words, line count unchanged**

(1) :97-98 become (116 and 116 characters):

```markdown
> **D-4041 and `carry-only-a-main-thread-wait` supersede this task's snippet, Produces line and steps:** the shipped
> carry keeps the stamp, writes `aliveAt`, carries a main-thread wait only, and decides from one fresh read (below).
```

(2) On :37, replace `The change in Task 1 sits directly after the` with `Task 1's carry block sits directly after the`.
:38 stays. :39 becomes:

```markdown
  ask" line; the fix rounds put its fresh read and `_hook_keep_stamp` just before that block, and edited the block.
```

(3) :88 becomes:

```markdown
| `ccd/session-hook.sh` | Task 1: one block after the SubagentStart/SubagentStop block; the fix rounds add the fresh read and `_hook_keep_stamp` before that block and edit it |
```

Commit:

```bash
git add docs/superpowers/plans/2026-10-12-stall-watch-settings-w3-hidden-ask.md
git commit -m "docs(stall): the W3 plan's Task 1 note and placement name the shipped carry (R51 (g))"
```

- [ ] **Step 2: Rewrap, last (ruling 11)**

List the prose lines over 120 characters at this commit:

```bash
P=docs/superpowers/plans/2026-10-12-stall-watch-settings-w3-hidden-ask.md
LC_ALL=C.UTF-8 awk '/^```/ { fence = !fence; next }
  !fence && length($0) > 120 && $0 !~ /^#/ && $0 !~ /^ *\|/ && $0 !~ /^ *(- )?[A-Z]+[0-9]+ \(/ { print NR ": " length($0) }' "$P"
```

Rewrap only wrappable prose: list items and paragraphs, keeping each list item's indentation and each blockquote
line's `> `. Leave alone the H1 (:1), the one backticked command (:51), every table row, indented or not (the rows at
:557-563 and :568-578 at `f515cdfd4`, four lower after Task 1, are indented two spaces), everything inside a code
fence (the Task 1 snippet included, R43), and every mutation row (one row per line is the plan's own format). At
`f515cdfd4` the wrappable lines were :11, :21, :97-98, :199, :322, :350, :356, :371, :384, :405, :418, :420, :422,
:450, :469, :473, :475, :485, :490, :499, :503, :521-522, :525, :552, :555 and :586; Tasks 1 and 2 lengthened some of
them, added the long first line of the fractional-stamp note, and moved the lines after :546 down by four. The list
the command prints decides. Wrap at 120 or fewer.

- [ ] **Step 3: Check the rewrap and commit**

The words are unchanged, and no exempt line moved:

```bash
norm() { sed -E 's/^ *(> )?//' | tr -s ' \n' '  '; }
diff <(git show HEAD:"$P" | norm) <(norm < "$P") && echo same-words
git diff -U0 HEAD -- "$P" | grep -E '^[-+]' | grep -vE '^(\+\+\+|---) ' | grep -E '^[-+](#| *\|| *```| *(- )?[A-Z]+[0-9]+ \()'
```

The first prints `same-words`; the second prints nothing. Re-run the listing command: what it prints is only the
lines Step 2 says to leave.

```bash
git add "$P"
git commit -m "docs(stall): rewrap the W3 plan's long prose lines, words unchanged (R51 (g))"
```

### Whole-wave checks (before wave-done)

From `server/`, one file per command, in the foreground:
- the citation instrument: its `Tests` line equal to the Precondition's;
- `git fetch origin main`, then `test/deviation-refs.test.ts`; then `test/dtbd.test.ts`, `test/topology-clean.test.ts`,
  `test/single-definition.test.ts` and `test/typecheck-tests.test.ts`;
- the wave's suites: `test/session-hook-subagent-ask.test.ts`, `test/ask-instance-guard.test.ts`,
  `test/session-hook-merge-deny.test.ts`, `test/stall-settings-route.test.ts`, `test/stall-settings.test.ts`,
  `test/stall-settings-readme.test.ts`, `test/stall-settings-prose.test.ts` and `test/mail-routes.test.ts`;
- `./node_modules/.bin/tsc --noEmit -p .` and `./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json`.

From `pwa/`: `test/use-stall-watch-view.test.tsx`, `test/settings-screen.test.tsx`, `test/box-token-card.test.tsx`,
and `./node_modules/.bin/tsc --noEmit -p .`.

From the tree's root:
- `bash -n ccd/session-hook.sh`; `wc -l` of `ccd/session-hook.sh`, `shared/api.ts`, `README.md`,
  `server/src/coord/store.ts` and `server/src/watch.ts` equal to the Precondition's;
- `git diff -U0 origin/main -- ccd/session-hook.sh | grep '^@@'`: every hunk at or after :3822, so nothing above :2900;
  and `git diff -U0 origin/main -- ccd/session-hook.sh | grep -E '^[-+][^-+]' | grep -vE '^[-+]#'` prints nothing;
- the diff against `origin/main` of `server/src/coord/store.ts`, `server/src/watch.ts` and
  `pwa/test/box-token-card.test.tsx` changes comment lines only, and of `shared/api.ts` comment lines only apart from
  one added code line, `STALL_CONFIRM_TEXT`'s `unconfirmed:` (Task 4 Step 7);
- `git merge-tree --write-tree HEAD origin/main` is clean;
- with #384's head fetched (`git fetch origin pull/384/head`), `git merge-tree --write-tree HEAD FETCH_HEAD`: report any
  conflict to the coordinator rather than resolving it, because consent 4468 decides who merges;
- `grep -oE 'D-[0-9]+' docs/superpowers/plans/2026-10-14-stall-watch-settings-w4-residue.md | sort -u` lists D-4045
  and numbers already defined on `main` only, and this plan's Measured rows and D-4045's Pinned by hold measurements,
  not predictions;
- before the push, scan every added line for private names, absolute home paths and links outside this repository
  (`git diff origin/main -U0 | grep '^+' | grep -nE '/home/|/Users/|linear\.app'` prints nothing, and read the rest).

## Measured rows

The worker fills this section in. Each row is `<mutation> → <n> failed (<titles>)`, measured out of tree, one mutation
at a time, each restored and `cmp`-checked, at the commit named in its heading. D-4045's rows go under its entry below.

### Task 1 (at `a8e769f47`)

FS1, FS2, FS3 and N2 (Task 1 Step 3), and FS1 on the file without the two cases.

- FS1 (`floor | tostring` → `tostring` at :3850) → 1 failed (a non-negative fractional updatedAt is kept as its floor and writes aliveAt (12.7 is kept as 12, 0.5 as 0))
- FS2 (`floor` → `ceil` at :3850) → 1 failed (a non-negative fractional updatedAt is kept as its floor and writes aliveAt (12.7 is kept as 12, 0.5 as 0))
- FS3 (`^[0-9]+$` → `^-?[0-9]+$` at :3864) → 2 failed (an updatedAt that is negative, non-numeric or printed by jq in exponent form keeps no stamp and writes no aliveAt (a fractional one keeps its floor); a negative fractional updatedAt is refused: -0.5 floors to -1, so the carry keeps no stamp, takes the current event and writes no aliveAt)
- N2 (drop `&& "$fr_upd" =~ ^[0-9]+$` at :3864) → 2 failed (an updatedAt that is negative, non-numeric or printed by jq in exponent form keeps no stamp and writes no aliveAt (a fractional one keeps its floor); a negative fractional updatedAt is refused: -0.5 floors to -1, so the carry keeps no stamp, takes the current event and writes no aliveAt)
- FS1 on the 28-case file (`dca1566ac`'s test file, same mutation as FS1) → 0 failed (28 passed of 28)

### Task 2 (at `22260db29`)

JF1 at floor 51 and at floor 52, and JF2 if taken (Task 2 Steps 2 and 4).

- JF1 at floor 51 (`session-hook.sh` :3869's `name=$(jq -r '.agent_name // …' …) || name="subagent"` → `name="subagent"`, floor 51, at the base `5144136a0`) → 0 failed (123 passed of 123; 51 >= 51: the hole review 422 measured)
- JF1 at floor 52 (the same mutation, at `22260db29`) → 1 failed (no jq program in ccd/session-hook.sh binds `as` to a binary chain; `AssertionError: jq programs found: expected 51 to be greater than or equal to 52`)
- JF2 (`session-hook.sh` :3802-3810's `rsk=$(jq -r '…' <<<"$payload" 2>/dev/null) || rsk=""` → `rsk=""`, floor 52, at `22260db29`) → 1 failed (no jq program in ccd/session-hook.sh binds `as` to a binary chain; `AssertionError: jq programs found: expected 51 to be greater than or equal to 52`) in `session-hook-merge-deny.test.ts`; the same mutation also reds `session-hook-role-skill-deny.test.ts` → 9 failed of 19 (10 passed)

### Task 3 (at `<commit>`)

BS1 (Task 3 Step 5).

### Task 5 (at `<commit>`)

The red-first run (Step 1), DW1 before (Step 2), and SD1, SD2, SD3, DW1, DW2 and DW3 (Step 10).

### Task 7 (at `<commit>`)

X65 before and after the fixture (Step 7).

## Deviations found

One number is defined here. D-4045 was issued to this programme in its 2026-10-05 block and held in reserve (the W3
plan's Deviations: "one number of the block remains in reserve"); the coordinator's ruling R52 assigns it to this
wave. Every other departure is named by its slug.

### D-4045 `an-answer-without-a-refusal-code-reads-unconfirmed`

- **Departs from:** the stall-watch settings spec's §13 step 5 as approved and as wave 2 built it (ledger R49): "Any
  other refusal gives `toast(STALL_CONFIRM_TEXT.refused, 'error')`, "Nothing was changed: <detail>"". The PWA's
  `stallWriteRefusal` read every `ApiError` that was not a readable 409 confirm as `refused`.
- **What W4 does:**
  - `stallWriteRefusal` reads `refused` only when the body's `error` is one of the route's own codes,
    `STALL_WATCH_REFUSALS` (`bad-request`, `confirm-required`, `not-configured`), declared once in
    `shared/stall-watch.ts`.
  - Any other `ApiError` is `unconfirmed` with a detail: the server's `detail`, else Fastify's `message`, else the
    error's own text, else the HTTP status. The section toasts `STALL_CONFIRM_TEXT.unconfirmed` in a plain toast,
    "Not confirmed — the choice may or may not have been saved (<detail>); the screen will re-check.", then re-reads.
    The line is a key of `STALL_CONFIRM_TEXT` in `shared/api.ts`, in place of a comment line, so the file keeps its
    line count and the P6 device-word scan reads it.
  - A rejection that is not an `ApiError` is `unconfirmed` with detail `null`, and the section keeps
    `STALL_CONFIRM_TEXT.unanswered` (D-4043).
  - A census in `stall-settings-route.test.ts` holds the L0 list equal to the codes the POST handler sends, over the
    slice Task 3 bounds.
  - The spec's §13 step 5, its §12 table and its §15 conflict row say so. The W2 plan gains one pointer sentence.
- **Why:** an answer that carries none of the route's codes proves nothing about the write. A proxy's 502 or 504 can
  follow a POST that reached the server, and a 500 can follow a store that committed: any throw after
  `coord.setStallSettings`, such as the feed actor's read, which sits outside the `try`. "Nothing was changed" there
  was a claim nobody measured, and an operator who believes it may not look again at a level they have just raised.
  The collector switch in #384 reads its own POST the same way.
- **Not done:**
  - The auth gate's 401 `unauthenticated` and 403 `foreign-origin` and the server's 404 `not-found` are not in the list
    (ruling 3), so they now read unconfirmed, though each proves nothing was written. A 401 raises the login screen
    anyway. Adding them is a one-line widening, if the coordinator rules it.
  - `API_ERROR_TEXT['not-configured']` (`pwa/src/lib/api.ts`) is a kickoff sentence, so a 501 with no detail on this
    POST toasts "Nothing was changed: This box does not run coordination — there is no mail store to queue a kickoff
    into." It predates this wave and is rare, because a GET 501 replaces the section first. Record only.
  - The `refused` arm carries no `code` field (#384's does, because its words table keys on it).
  - The W2 plan's fold text is a dated execution record and stays, apart from the pointer.
- **Pinned by:** the six rows Task 4 Step 6 writes in `pwa/test/use-stall-watch-view.test.tsx` (four titled D-4045),
  the two "P2 (D-4045)" rows of `pwa/test/settings-screen.test.tsx`, its unchanged P6 device-word row for the new
  line's words, and the census in `server/test/stall-settings-route.test.ts`. The rows below are the predictions of
  Task 4 Steps 2, 9 and 13. Replace each with its measurement, and name the commit:
  U1 (the fold's last line → `return { kind: 'refused', detail };`) → 6 failed (the fold's 500, gateway, unknown-code and never-blank rows; both "P2 (D-4045)" rows) — predicted; measure;
  U2 (the fold's last line → `return { kind: 'unconfirmed', detail };`) → about 6 failed (D-4045: only the route's own codes are refusals, and the list is L0's; the three known-code rows at :263-280; P2: a refused write toasts the server's detail, re-reads, and leaves the stored radio checked; P2: a cancelled or refused quiet write leaves the select on the stored value, never the tap) — predicted; measure;
  U3 (`.includes(v)` → `v in STALL_WATCH_REFUSAL_TABLE`) → 1 failed (D-4045: a code this build does not know is unconfirmed, on any status, a 409 included) — predicted; measure;
  U4 (the network arm's `detail: null` → `detail: String(err)`) → 2 failed (reads a rejection that is not an ApiError as unconfirmed with no detail, never a refusal: the POST may have landed; a write whose answer never arrived says it was not confirmed, never "Saved" or "Nothing was changed", and re-reads) — predicted; measure;
  U5 (the section's two unconfirmed arms → one `else toast(STALL_CONFIRM_TEXT.unanswered);`) → 2 failed (both "P2 (D-4045)" rows) — predicted; measure;
  U6 (the section's unconfirmed toast given `'error'`) → 1 failed (P2 (D-4045): a gateway 502 says the choice may or may not have been saved, plain, never "Nothing was changed", and re-reads) — predicted; measure;
  U7 (`STALL_CONFIRM_TEXT.unconfirmed`'s `may not have been saved` → `may not have been saved on your phone`) → 1 failed (P6: no L0 STALL_* string names a device, and the Notifications row says push) — predicted; measure;
  RC1 (`routes.ts` :2702 `'bad-request'` → `'bad-body'`) → at least 1 failed (the codes the POST handler sends, notConfigured's included, are STALL_WATCH_REFUSALS, no more and no fewer) — predicted; measure;
  RC2 (`'bad-request'` deleted from the table and the union) → 1 failed in `server/` (the same census title) and about 4 failed in `pwa/`, both files run (D-4045: only the route's own codes are refusals, and the list is L0's; takes the server's detail when it sends one; P2: a refused write toasts the server's detail, re-reads, and leaves the stored radio checked; P2: a cancelled or refused quiet write leaves the select on the stored value, never the tap) — predicted; measure;
  RC3 (Task 3's `sliceTo` reverted, and `void { ok: false, error: 'teapot' };` added to `composeChildReclaim`) → 2 failed (the census title and Task 3's CONTROL (R51 (c)) row); 0 with the bounded slice — predicted; measure.
- **Cost if wrong:**
  - A refusal whose body lacks a route code, where "Nothing was changed" was in fact true, now says "may or may not
    have been saved": the route's own two 500s (an unreadable row, a second conflict), whose message says "nothing
    written" in the detail slot, and the gate's 401 and 403 and the server's 404. The words stay true, only less
    certain, and the screen re-reads either way.
  - A proxy that forwards a body whose `error` happens to be one of the route's codes would read as a refusal. That is
    acceptable, because those codes come from this route.

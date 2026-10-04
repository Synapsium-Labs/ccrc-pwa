# Stall watch wave 7: the `wait:` clause amendment and the stop clause's wake-list scans — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILLS: dispatched as a wave, `ccrc-worker`; to execute,
> `superpowers:executing-plans` (or `superpowers:subagent-driven-development`) with `superpowers:test-driven-development`
> for every test step. Steps use checkbox (`- [ ]`) syntax for tracking.

**Programme:** `stall-watch`, **wave 7** (ledger `docs/superpowers/programs/stall-watch.md`; rulings R2, R12, R17 F1/F2,
R21 F1). Deploy class: **skills** (they reach homes through `ccrc update`'s `_inst_skills`). One PR from a fresh child
workspace.

**Goal:** Ship the operator's 2026-10-04 approval of "the amendments" (ledger R2 and R17 F1) as ONE amendment to
coordinator clause 16, and close the two parked residues on the worker clause's pins (R17 F2, R21 F1):
- **Widen.** The coordinator sends a `wait:` mail not only in answer to a `stall:` mail, but whenever it tells a
  `working` worker to wait, behind another run or programme or until a time. That is the shadow review's
  "coordinator park expressed in prose" class (3 episodes): the producer was missing, and the server already reads a
  coordinator's `wait:` as the ball passing to it. How far that ball carries is bounded by the ball rule below: it lasts
  until the worker's next ordinary mail, and worker clause 17 prompts that mail at every turn end. So the widening helps
  mainly when the worker stays silent after the `wait:` (see "Not in this wave" for the residue).
- **State the ball truthfully.** Clause 16 says the watch reads `wait:` "as the run waiting on you until your next
  mail". The server's ball rule (`ballToCoordinator` / `stallFacts` in `server/src/coord/stall.ts`; spec
  `docs/superpowers/specs/2026-09-29-worker-stall-watch-design.md` §4.2) hands the ball back at the next mail to or from
  the worker, the watch's own notices aside, unless that mail passes the ball again: another coordinator `wait:`, or
  from the worker a `question`, an exact `wave-done`/`review-done` claim, or a reply beginning
  `re stall-check: waiting`. The worker's next ordinary mail hands it back. The amended clause says so. **No server
  change:** the spec chose that rule.
- **The worker clause's pins read the wake list itself.** Today the S3 row scans for three words (`shell`, `bash`,
  `monitor`) and the S4 row pins one sentence. Two new rows: a positive allowlist of the wake list's members, tied to
  `stall.ts`'s `STALL_RESUMING_KINDS`, and a `resume` scan of the list. No worker SKILL.md text changes.

- **Wave 6's review residue (Task 4).** Review 257 of PR #241 left six comment and test-hygiene items that the
  coordinator accepted for this wave (ledger R32): comment and docstring wording in `stall.ts` and `shared/api.ts`, one
  test constant imported instead of copied, and one comment word. No behaviour changes and no number is owed.

**Architecture:** Prose and pins only.
- Coordinator clause 16 stays ONE numbered line, edited in place. The clause count stays **sixteen**, so no count word
  moves anywhere (SKILL.md, CLAUDE.md, README.md, the suite's titles and comments).
- `CONTRACT[15]` in `server/test/coordinator-skill.test.ts` takes the new literal. Three rows are appended to the
  existing stall describe at its foot, where its `stallClause()` helper is in scope.
- Two rows are appended to the existing stop-clause describe at the foot of `server/test/worker-skill.test.ts`, where
  its `stopClause()` helper is in scope.
- README's one live description of clause 16 is amended in place (13 lines for 13). The stall spec records the
  amendment in §6.1 and §11 decision 13 without rewriting the 2026-09-29 record.
- No server behaviour, agent, `ccd`, installer, wire, migration or marker change.

**Tech Stack:** Markdown skills; TypeScript tests on vitest (`server/test/`), node `>=22.13.0`; python3 for the scratch
mutation runner, never committed.

**Spec:** `docs/superpowers/specs/2026-09-29-worker-stall-watch-design.md` rev 3.1 — §4.2 (the ball), §6.1 (the
coordinator clause), §6.2 (the worker clause), §11 decision 13 (clause texts approved 2026-09-29). This wave amends
§6.1's clause by operator decision (2026-10-04 17:00 UTC), recorded in the spec by Task 3.

**Measured at `origin/main` `22f7931af`** (2026-10-04; it is `c9ada6543` plus #242, which touched README.md and CLAUDE.md
only). Every line number below is a HINT at that commit. Each edit quotes the exact text it replaces, and each quoted
text occurs exactly once in its file (measured), so find it by content. The prototype of every edit below was built in a
scratch worktree of `22f7931af` and measured there, then removed; the red and green counts and the mutation tables are
MEASURED, not derived. The prototype's diff against `main`: `README.md` 13/13, `ccd/coordinator-skill/SKILL.md` 1/1, the
spec 38/1, `server/test/coordinator-skill.test.ts` 49/4, `server/test/worker-skill.test.ts` 51/0.

## Preconditions (check before the baseline; stop and report if one fails)

1. **This plan is on `origin/main`.** `git ls-tree origin/main docs/superpowers/plans/2026-10-04-stall-watch-w7-wait-clause-amendment.md`
   prints one line. This plan alone defines D-3805 and D-3806, and Tasks 1–3 write both into tracked comments and the
   spec. (The ledger's definition-derived high-water on `main` is D-3884, measured, so `deviation-refs`' floor row stays
   green either way; the precondition is the ledger discipline, not that row.)
2. **Clause 16 on `main` is the 2026-09-29 text.** `git show origin/main:ccd/coordinator-skill/SKILL.md | grep -c 'which the watch reads as the run waiting on you until your next mail'`
   prints `1`. If it prints `0`, someone has already edited the clause: stop and report.
3. **The counts.** `git show origin/main:ccd/coordinator-skill/SKILL.md | awk '/^## The contract$/{f=1;next} /^## /{f=0} f && /^[0-9]+\. /' | wc -l`
   prints `16`, and `git show origin/main:ccd/worker-skill/SKILL.md | grep -cE '^[0-9]+\. '` prints `17`. If either
   differs, another programme's clause landed: this wave still edits clause 16 by content (it is found by its opening
   words), and no count word moves, but say so in the wave-done mail.
4. **PR #241 (stall watch wave 6) is merged.** `git log origin/main --oneline -1 -- server/src/coord/stall.ts` names a
   commit whose `git show` carries `replayed-deaf-from-first-delivery-estimate`. Task 4 edits that wave's text.
5. This workspace's branch starts from current `origin/main` (a fresh child does). Absorb `main` later only on worker
   clause 16's measured triggers, always with `git merge`, never a rebase. Then take the baseline.

## Global Constraints

- **The amended clause bytes are exactly this plan's** (Task 1 Step 4). Typographic `’` (U+2019) and `‘…’`
  (U+2018/U+2019), as the clause is typed today. No straight apostrophe and no `"` anywhere in the clause (measured:
  none). Its `CONTRACT` literal stays single-quoted. A brief, or a recollection of R2, never changes the bytes you pin.
- **The clause is ONE line, edited in place.** `ccd/coordinator-skill/SKILL.md` keeps its line count (`git diff
  --numstat` reads `1 1`), so no later SKILL.md line moves and **no citation sweep is needed** (stated, and re-proved by
  Task 1 Step 6). The stall describe finds the clause by its opening words, `A mail from `operator` whose subject begins
  `, never by its number.
- **The edit stays inside its lanes** (PR #215 also edits both skills and both suites; see "If this PR is overtaken"):
  - `ccd/coordinator-skill/SKILL.md`: the clause-16 line only.
  - `server/test/coordinator-skill.test.ts`: the `stall.js` import line (in place), the `shared/api.js` import's last
    member line (in place), the comment line above `CONTRACT[15]` (in place), `CONTRACT[15]` (in place), and three rows
    appended inside the stall describe directly before its closing `});` at EOF.
  - `server/test/worker-skill.test.ts`: two rows (and their two helpers) appended inside the stop-clause describe
    directly before its closing `});` at EOF. No other line.
  - `ccd/worker-skill/SKILL.md`: **unchanged**.
- **README is in the citation corpus.** Its edit is in place, 13 lines for 13; no line is added or removed. The
  citation instrument stays `7 passed | 328 skipped`, measured before and after:
  `./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'`.
- **Mutation-table discipline.** Every new row ships with a mutation measured red when its guarded text or server
  constant is deleted or changed. The tables below were measured on the prototype; re-measure them on the real branch
  and paste the runner's output into the wave-done mail. A row is judged by its `failed` count and the NAMES of the
  failing rows; a row whose red differs from the table is a finding.
- **Tests run from `server/`** (every block starts with `cd "$(git rev-parse --show-toplevel)/server"`), in the
  FOREGROUND, timeout at least 600000 ms, ONE FILE PER COMMAND: `./node_modules/.bin/vitest run test/<file>.test.ts`.
  Never bare `npx vitest`. A red in a known load flake (`session-hook`, `typecheck-tests`, `pr-sweep`, `ccd-ws-gc`,
  `ccd-session-state`, `ccd-bounded-reads`) is re-run in isolation before it is called a break.
- **Deviation numbers: exactly two, issued by the coordinator**, defined under "Deviations found": D-3805 and D-3806.
  Code comments and the spec cite each by slug and number. Never write any other number, never a range, never a
  placeholder (`dtbd.test.ts` reds one). Name any further departure in the wave-done mail by slug; the coordinator
  assigns its number.
- **Commit on this workspace's own branch (`ws/<slug>`)**, never a separate feature branch. Absorb `origin/main` only
  on worker clause 16's measured triggers, with `git merge`; never rebase.
- **Public repo:** no account label, host name, live session id, real pool name or docserver URL in code, tests,
  commits or this plan's edits.
- **Skills reach homes only through `ccrc update`'s `_inst_skills`.** No `ccd/install-*-skill.sh`, `ccd/ccd` or
  `ccd/ccrc` edit, so no re-stamp.
- **Out of scope:** any `server/src` change; arming any marker; the worker SKILL.md text; the stall watch's thresholds
  (see "Not in this wave").
- **Measurement instruments live outside the tree** (the worker's scratchpad or the gitignored
  `.superpowers/sdd/2026-10-04-stall-watch-w7-wait-clause-amendment/`), never committed. `INSTR` below is that absolute
  path.

## Review Focus

1. **The ball sentence is true against `stall.ts` as shipped, and stays true.** Read `ballToCoordinator` and
   `stallFacts`: the ball is the coordinator's iff the newest relevant mail (to or from the worker, the watch's own
   check/report/self-wake notices excluded) is a coordinator `wait:`, or the worker's `question`, exact
   `WAVE_DONE_SUBJECT`/`REVIEW_DONE_SUBJECT` status, or `re stall-check: waiting` reply. The clause's last sentence must
   say exactly that. Pinned by row "states the ball as stall.ts reads it" (C4, C5, C6) and the closed-world row (C5,
   C6, C8). What the true sentence implies is recorded, not cured: worker clause 17 ends every turn with an ordinary
   mail to the coordinator, which hands a `wait:`'s ball straight back (ledger R17 F1). The residue is in "Not in this
   wave", for an operator ruling.
2. **The widening survives a co-edit.** A rewording that drops "Send that `wait:` mail unasked" from SKILL.md AND the
   `CONTRACT` literal passes the verbatim pin. Expected: red anyway (C3).
3. **A new backticked token in the clause.** A later edit that quotes a token outside the clause's relied-on constants
   (C7 `busy`, C8 `finding`, C9 a non-active run state) must red: the closed-world row's allowlist is the set of
   constants the clause relies on, derived from `stall.ts` and `shared/api.ts`, never hand-kept. It is not "tokens the
   server does not spell": `stall.ts` spells `busy` and `question` too. Quoting `question` reds the same row by design;
   its message says to add the constant to the row or unquote it.
4. **The wake-list allowlist (R21 F1).** The reviewer's example, "a background task you launched", and the plural
   `shells` both pass the existing S3 row on `main` — measured: W1–W8 are all `48 passed` against `main`'s rows. They
   must red after this wave (W1–W8 each `1 failed` or `2 failed`). The allowlist's vocabulary is tied to
   `STALL_RESUMING_KINDS` in both directions (W7 removes a kind, W8 adds one). Kinds inside one background member are
   joined by `or`/`and` only; a comma between kinds splits the member and reds on purpose (stated in the row comment).
5. **The `resume` scan (R17 F2).** A rewording that adds "an agent that says it may resume on its own" as a wake reds
   (W6, both rows), and so does a resume clause hidden inside the background member with no comma (W5, the scan alone).
6. **Interplay with wave 6 (PR #241).** Wave 6's G1 makes mail to the role `worker` on the run count as mail to the
   worker (`stallToWorker`). The clause's "mail to or from the worker" is true before and after #241; it names no
   addressing. Measured: `git merge-tree` of this wave's prototype against #241's head `b29aba143` exits 0.
7. **A home where `_inst_skills` has not run** keeps the 2026-09-29 clause. The watch does not depend on the clause
   (its r2 body carries its own protocol, pinned in `stall-bodies.test.ts`), and doctor's `skills` check names the
   stale home.

## Deviations found

Issued by the coordinator, one per slug; a departure found during execution is named by slug in the wave-done mail.

- **D-3805** — `coordinator-wait-widened-ball-truthful` (Tasks 1 and 3): spec §6.1's clause text, approved 2026-09-29
  (§11 decision 13), is amended by the operator's 2026-10-04 decision on ledger R2 and R17 F1, as ONE edit to
  coordinator clause 16:
  - it drops "which the watch reads as the run waiting on you until your next mail", which §4.2's ball rule falsifies;
  - it adds "Send that `wait:` mail unasked as well, whenever you tell a `working` worker to wait, behind another run
    or programme or until a time." (R2; the shadow review's three prose parks were "for another programme to merge, or
    until a time"). `working` is the run state; a parked `dispatched` worker is not named;
  - it adds the ball sentence, naming the hand-back exceptions as `stall.ts` and `shared/api.ts` spell them.
  - Three rows hold what the verbatim pin cannot, in the shape D-3791 set: the widening sentence quotes
    `STALL_WAIT_PREFIX` and an `ACTIVE_RUN_STATES` member; the ball sentence never says "until your next mail" and
    quotes `STALL_REPLY_WAITING_PREFIX`, `WAVE_DONE_SUBJECT` and `REVIEW_DONE_SUBJECT`; and every backticked token in
    the clause is one of the constants it relies on: `STALL_SENDER`, `STALL_REPORT_PREFIX`, `STALL_WAIT_PREFIX`,
    `STALL_REPLY_WAITING_PREFIX`, `WAVE_DONE_SUBJECT`, `REVIEW_DONE_SUBJECT` or an `ACTIVE_RUN_STATES` member.
  - Task 3 amends README's live description of the clause and records the amendment in spec §6.1 and §11 decision 13,
    leaving the 2026-09-29 quoted text in place as the record, and says what the amendment does not cure (the worker's
    turn-end mail hands the ball back).
  - The clause count stays sixteen and no server code changes.
- **D-3806** — `stop-clause-wake-list-allowlist` (Task 2): ledger R21 F1 and R17 F2, parked "for the next wave that edits
  `worker-skill.test.ts`". D-3792's S3 row guards the wake list on three words and its S4 row pins one sentence. Two rows
  read the wake list's members instead:
  - an allowlist: each member is exactly one of a mail that asks, a structured ask, or "a background <kinds> you/that/which
    …" whose kinds, joined by `or`/`and`, map one for one, through a test-local word map, to `STALL_RESUMING_KINDS`;
  - a scan: no form of "resum" appears in the wake list.
  - No worker SKILL.md text changes; the existing S3 and S4 rows stay as they are.

## File Structure

| File | Change | Task |
|---|---|---|
| `ccd/coordinator-skill/SKILL.md` | clause 16, one line edited in place (≈85) | 1 |
| `server/test/coordinator-skill.test.ts` | `stall.js` import (≈25) and `shared/api.js` member line (≈30), in place; the comment above `CONTRACT[15]` (≈126), in place; `CONTRACT[15]` (≈128), in place; three rows before the stall describe's closing `});` (EOF, ≈2590) | 1 |
| `server/test/worker-skill.test.ts` | two helpers and two rows before the stop-clause describe's closing `});` (EOF, ≈709) | 2 |
| `README.md` | **What the skills do with the watch's mail.** paragraph, 13 lines for 13 (≈4049-4061) | 3 |
| `server/src/coord/stall.ts` | comments and docstrings only: the mail-stuck gloss, `stallDeafMail`'s docstring and one comment above its return, `stallIdleStart`'s docstring lead | 4 |
| `shared/api.ts` | `MAIL_REPLAY_MS`'s docstring, one sentence (end of file, below every cited line) | 4 |
| `server/src/watch.ts` | `MAIL_REPLAY_MS`'s meaning docstring, its first line, in place | 4 |
| `server/test/stall-sweep.test.ts` | the `shared/api.js` import line; the coord-deaf replay row's `REPLAY_MS` copy; one comment word | 4 |
| `server/test/stall-verdict.test.ts` | one comment line above the "estimate never precedes the queue" row | 4 |
| `docs/superpowers/specs/2026-09-29-worker-stall-watch-design.md` | status line (:3, in place); an amendment block after §6.1's pin-impact paragraph (after ≈685, 34 lines); a note under §11 decision 13 (after ≈921 before the block, ≈955 after; 3 lines) | 3 |

**Deliberately unchanged** (every tracked site that quotes clause 16 or its "until your next mail" phrase, measured with
`git grep -n -E 'until your next mail|as the run waiting on you|whose subject begins .stall:.|told it to wait'` and a
`wait:` sweep over README, CLAUDE.md, `ccd/`, `server/src`, `shared`):
- `docs/superpowers/plans/2026-10-02-worker-stall-watch-w3.md` (:377, :457, :529–534): the wave-4 plan's pinned text and
  mutation rows. A dated plan is a snapshot (CLAUDE.md "Anchors in plans are snapshots"; ledger R6).
- `docs/superpowers/programs/stall-watch.md` (:223, :233): the ledger's R17 F1 quotes the old phrase as the finding.
  The coordinator's own document; the coordinator records this wave's ruling there.
- The spec's §6.1 quote (:674–680) stays as the 2026-09-29 approved text; Task 3 adds the amendment beside it. The
  spec's §4.2 ball text (:290–302) is already accurate.
- README :3986–3991 (the ball, in **The stall watch.**) is already accurate: "the coordinator's after the worker's
  `question` … and after a coordinator mail whose subject begins `wait:`; the worker's otherwise".
- CLAUDE.md quotes no clause text (its stall bullet, ≈301–316, and its coordinator bullet name the count only, which is
  unchanged).
- `ccd/coordinator-skill/references/*` and the worker and reviewer skills: no quote of clause 16 (measured).
- `server/src/coord/stall.ts`'s r2 body (≈1243) and the mail-stuck body (≈1840) say "mail it a subject beginning
  `wait:`", which stays true; no server change.
- `server/test/coordinator-skill.test.ts`'s existing stall describe header comment (≈2549–2558) and its two rows stay:
  the first row's `/a subject beginning `([^`]+)`/` still finds `wait:` first (the new sentences say "a reply
  beginning", never "a subject beginning").

## Baseline (the step before Task 1)

```bash
cd "$(git rev-parse --show-toplevel)/server"
./node_modules/.bin/vitest run test/coordinator-skill.test.ts | grep -E '^ +Tests '
./node_modules/.bin/vitest run test/worker-skill.test.ts | grep -E '^ +Tests '
./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus' | grep -E '^ +Tests '
```

Expected (measured at `22f7931af`): `coordinator-skill` `Tests 156 passed (156)`, `worker-skill` `Tests 48 passed (48)`,
the instrument `Tests 7 passed | 328 skipped (335)`. Record all three in the wave-done mail. (If #215 or another PR has
landed rows in either skill suite since, the totals here are `main`'s, and every total below rises by the same amount.)

Write the mutation runner once. It is the wave-4 plan's runner, byte for byte:

```bash
mkdir -p "$INSTR"
git show origin/main:docs/superpowers/plans/2026-10-02-worker-stall-watch-w3.md \
  | awk '/^`\$INSTR\/mutate.py`:/{f=1;next} f&&/^```python/{g=1;next} g&&/^```/{exit} g' > "$INSTR/mutate.py"
head -3 "$INSTR/mutate.py"; wc -l < "$INSTR/mutate.py"
```

Expected: the first line is `#!/usr/bin/env python3`, the third begins `Usage: python3 mutate.py`, and the file has 33
lines. It applies each row's edits (every `old` must occur exactly once), runs the row's tests, restores from `HEAD` and
asserts the tree is clean, so run it only on a COMMITTED tree.

---

## Tasks

### Task 1: Coordinator clause 16, amended, and its three rows

**Model routing:** `sonnet`, effort `high`: transcription of pinned bytes plus tests and a mutation table.

**Files:**
- Modify: `ccd/coordinator-skill/SKILL.md` (the clause-16 line, ≈85).
- Modify: `server/test/coordinator-skill.test.ts` (≈25, ≈30, ≈126, ≈128, EOF).
- Test: `server/test/coordinator-skill.test.ts`.

**Interfaces:**
- Consumes, from `server/src/coord/stall.ts`: `STALL_REPORT_PREFIX = 'stall:'` (≈29), `STALL_WAIT_PREFIX = 'wait:'` (≈31),
  `STALL_REPLY_WAITING_PREFIX = 're stall-check: waiting'` (≈27), and the module-private `STALL_SENDER = 'operator'`
  (≈45), read as source text as the existing row does.
- Consumes, from `shared/api.ts`: `WAVE_DONE_SUBJECT = 'wave-done'` (≈5159), `REVIEW_DONE_SUBJECT = 'review-done'`
  (≈8947), `ACTIVE_RUN_STATES` (≈4280: `dispatched`, `working`, `unknown`).
- Produces: clause 16's amended text, `CONTRACT[15]` equal to it, and three rows.

- [ ] **Step 1: Re-anchor**

```bash
cd "$(git rev-parse --show-toplevel)"
grep -c 'which the watch reads as the run waiting on you until your next mail' ccd/coordinator-skill/SKILL.md server/test/coordinator-skill.test.ts
grep -n "^import { STALL_REPORT_PREFIX, STALL_WAIT_PREFIX } from '../src/coord/stall.js';$" server/test/coordinator-skill.test.ts
grep -n "^  isPrPhase, isRunRefuseCode, SUITE_WORDS, FAILURE_KINDS, SPAWN_VERDICTS,$" server/test/coordinator-skill.test.ts
grep -n "^  // Worker stall watch, wave 3 (spec 2026-09-29 §6.1). Typographic apostrophes$" server/test/coordinator-skill.test.ts
tail -3 server/test/coordinator-skill.test.ts
```

Expected: `1` for each file; one line each for the three `grep -n` (≈25, ≈30, ≈126); the tail ends with
`      .toContain(`\n## ${named}\n`);`, `  });`, `});`. If any differs, `main` moved: find the text by content and say so.

- [ ] **Step 2: Write the failing tests**

All edits are in `server/test/coordinator-skill.test.ts`, each in place except (e).

(a) ≈25:
`import { STALL_REPORT_PREFIX, STALL_WAIT_PREFIX } from '../src/coord/stall.js';` →
`import { STALL_REPLY_WAITING_PREFIX, STALL_REPORT_PREFIX, STALL_WAIT_PREFIX } from '../src/coord/stall.js';`

(b) ≈30, the last member line of the `shared/api.js` import:
`  isPrPhase, isRunRefuseCode, SUITE_WORDS, FAILURE_KINDS, SPAWN_VERDICTS,` →
`  isPrPhase, isRunRefuseCode, SUITE_WORDS, FAILURE_KINDS, SPAWN_VERDICTS, ACTIVE_RUN_STATES, REVIEW_DONE_SUBJECT, WAVE_DONE_SUBJECT,`

(c) ≈126:
`  // Worker stall watch, wave 3 (spec 2026-09-29 §6.1). Typographic apostrophes` →
`  // Worker stall watch, wave 3 (spec 2026-09-29 §6.1), amended by wave 7 (D-3805). Typographic apostrophes`

(d) ≈128, `CONTRACT[15]`: replace the whole single-quoted literal that begins `  'A mail from `operator` whose subject
begins` with this ONE line (the array's last entry, so the next line stays `];`):

```ts
  'A mail from `operator` whose subject begins `stall:` is the server’s stall watch reporting your worker, not the worker itself; it wakes you, and answering it is not polling. Ack it, re-measure the run and the worker’s last mail, then act once: mail the worker a resume that names its last mail and what it owes; or, if the silence is yours because you told it to wait, mail it a subject beginning `wait:` that names what it waits for; or, if the worker is dead or cannot be woken, re-dispatch a dead one as ‘When something is wrong’ says and say which in this turn’s text for the operator. A stall mail never licenses re-dispatching a live worker. Send that `wait:` mail unasked as well, whenever you tell a `working` worker to wait, behind another run or programme or until a time. The watch reads a `wait:` as the run waiting on you only until the next mail to or from the worker, its own notices aside: that mail hands the run back to the worker unless it is another `wait:` from you or, from the worker, a question, an exact `wave-done` or `review-done` claim, or a reply beginning `re stall-check: waiting`.',
```

(e) At the foot of the file, the stall describe ends with its second row's `  });` and then `});`. Between those two
lines, insert this block (it begins with one blank line):

```ts

  // Stall watch wave 7, the operator's 2026-10-04 amendment
  // (`coordinator-wait-widened-ball-truthful` (D-3805)). The clause now sends
  // `wait:` past a stall mail, and states the ball as `stallFacts` reads it: a
  // `wait:` holds the run only until the next mail to or from the worker,
  // unless that mail passes the ball again. The verbatim pin holds the bytes;
  // these three rows hold what a co-edit of SKILL.md and CONTRACT could lose.
  it('sends wait: past a stall mail too, for a worker in a state the watch reads', () => {
    const line = stallClause();
    expect(line, 'no contract clause opens "A mail from `…` whose subject begins `…`"').toBeDefined();
    const tail = line!.slice(line!.indexOf('A stall mail never licenses re-dispatching a live worker.'));
    expect(tail, 'the clause lost its last-but-two sentence').toMatch(/^A stall mail never licenses/);
    expect(/ `([^`]+)` mail unasked/.exec(tail)?.[1],
      'the clause sends wait: only in answer to a stall mail (ledger R2, approved 2026-10-04)').toBe(STALL_WAIT_PREFIX);
    const state = /tell a `([^`]+)` worker to wait/.exec(tail)?.[1];
    expect((ACTIVE_RUN_STATES as readonly string[]).includes(state ?? ''),
      `the clause names a worker in run state ${state}, which the watch never reads`).toBe(true);
  });

  it('states the ball as stall.ts reads it: only until the next mail, past the hand-backs it exempts', () => {
    const line = stallClause();
    expect(line, 'no contract clause opens "A mail from `…` whose subject begins `…`"').toBeDefined();
    expect(line, 'the clause says a wait: holds the run until your next mail; the worker’s next ordinary mail hands it back too')
      .not.toMatch(/until your next mail/);
    expect(line).toContain('only until the next mail to or from the worker');
    expect(/a reply beginning `([^`]+)`/.exec(line!)?.[1],
      'the clause names a waiting reply the stall watch does not read').toBe(STALL_REPLY_WAITING_PREFIX);
    expect(/an exact `([^`]+)` or `([^`]+)` claim/.exec(line!)?.slice(1),
      'the clause names done claims the stall watch does not read').toEqual([WAVE_DONE_SUBJECT, REVIEW_DONE_SUBJECT]);
  });

  it('quotes only the constants the clause relies on', () => {
    const line = stallClause();
    expect(line, 'no contract clause opens "A mail from `…` whose subject begins `…`"').toBeDefined();
    const src = readFileSync(path.join(root, 'server/src/coord/stall.ts'), 'utf8');
    const sender = /^(?:export )?const STALL_SENDER = '([^']+)';$/m.exec(src)?.[1];
    const reliedOn = new Set<string>([sender ?? '', STALL_REPORT_PREFIX, STALL_WAIT_PREFIX, STALL_REPLY_WAITING_PREFIX,
      WAVE_DONE_SUBJECT, REVIEW_DONE_SUBJECT, ...ACTIVE_RUN_STATES]);
    const quoted = [...new Set([...line!.matchAll(/`([^`]+)`/g)].map((m) => m[1]!))];
    expect(quoted.length, 'the scan read no quoted token').toBeGreaterThan(0);
    for (const q of quoted) {
      expect(reliedOn.has(q),
        `the clause quotes `${q}`, which is outside the constants it relies on: add the constant here, or unquote it`).toBe(true);
    }
  });
```

- [ ] **Step 3: Run the suite to verify it fails**

Run: `cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts`

Expected (measured on the prototype): `Tests 3 failed | 156 passed (159)`. The three:
- `carries all sixteen clauses verbatim` (`missing contract clause: A mail from `operator` whose subject begins `sta…`);
- `sends wait: past a stall mail too, for a worker in a state the watch reads`;
- `states the ball as stall.ts reads it: only until the next mail, past the hand-backs it exempts`.

`quotes only the constants the clause relies on` is GREEN here, by design: every token the 2026-09-29 clause quotes is
already one of them. Its reds are C1, C5, C6, C7, C8 and C9 below.

- [ ] **Step 4: Amend the clause**

In `ccd/coordinator-skill/SKILL.md`, replace the whole line that begins `16. A mail from `operator` whose subject
begins `stall:`` (≈85) with this ONE line. Copy it exactly: curly `’`, `‘` and `’`, no straight apostrophe.

```
16. A mail from `operator` whose subject begins `stall:` is the server’s stall watch reporting your worker, not the worker itself; it wakes you, and answering it is not polling. Ack it, re-measure the run and the worker’s last mail, then act once: mail the worker a resume that names its last mail and what it owes; or, if the silence is yours because you told it to wait, mail it a subject beginning `wait:` that names what it waits for; or, if the worker is dead or cannot be woken, re-dispatch a dead one as ‘When something is wrong’ says and say which in this turn’s text for the operator. A stall mail never licenses re-dispatching a live worker. Send that `wait:` mail unasked as well, whenever you tell a `working` worker to wait, behind another run or programme or until a time. The watch reads a `wait:` as the run waiting on you only until the next mail to or from the worker, its own notices aside: that mail hands the run back to the worker unless it is another `wait:` from you or, from the worker, a question, an exact `wave-done` or `review-done` claim, or a reply beginning `re stall-check: waiting`.
```

The count word `These sixteen sentences` (≈67) does not change. Nothing in CLAUDE.md or README.md's count words changes.

- [ ] **Step 5: Run the suites to verify they pass**

```bash
cd "$(git rev-parse --show-toplevel)/server"
./node_modules/.bin/vitest run test/coordinator-skill.test.ts | grep -E '^ +Tests '
./node_modules/.bin/vitest run test/install-coordinator-skill.test.ts | grep -E '^ +Tests '
```

Expected (measured): `Tests 159 passed (159)` and `Tests 16 passed (16)`.

- [ ] **Step 6: Line-neutrality, the byte check, and the README instrument**

```bash
cd "$(git rev-parse --show-toplevel)"
git diff --numstat HEAD -- ccd/coordinator-skill/SKILL.md server/test/coordinator-skill.test.ts
grep -c "'" <(grep -E '^16\. A mail from' ccd/coordinator-skill/SKILL.md)
grep -c '"' <(grep -E '^16\. A mail from' ccd/coordinator-skill/SKILL.md)
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus' | grep -E '^ +Tests '
```

Expected: `1	1	ccd/coordinator-skill/SKILL.md` (no line moved, so no SKILL.md citation shifts and no sweep runs) and
`49	4	server/test/coordinator-skill.test.ts`; `0` and `0` (no straight apostrophe, no `"`);
`Tests 7 passed | 328 skipped (335)`.

- [ ] **Step 7: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add ccd/coordinator-skill/SKILL.md server/test/coordinator-skill.test.ts
git commit -m "$(cat <<'MSG'
feat(skills): coordinator clause 16 sends wait: past a stall mail, and states the ball truthfully

The operator's 2026-10-04 decision on stall-watch ledger R2 and R17 F1,
one amendment to clause 16 (coordinator-wait-widened-ball-truthful
(D-3805)). The coordinator sends a wait: mail unasked whenever it tells a
working worker to wait, behind another run or programme or until a time,
not only in answer to a stall: mail. And the clause no longer says a
wait: holds the run "until your next mail": as stallFacts reads it, the
next mail to or from the worker hands the run back unless it passes the
ball again (another wait:, or the worker's question, exact wave-done or
review-done claim, or re stall-check: waiting reply). No server change;
spec 2026-09-29 §4.2 chose that rule. The count stays sixteen.

Three rows hold what the verbatim pin cannot: the widening quotes
STALL_WAIT_PREFIX and an active run state; the ball sentence names the
hand-backs as stall.ts and shared/api.ts spell them and never says
"until your next mail"; and every token the clause quotes is one of the
constants it relies on.
MSG
)"
```

- [ ] **Step 8: The mutation table, on the committed tree**

Write `$INSTR/mut-task1.json`, then run
`cd "$(git rev-parse --show-toplevel)" && python3 "$INSTR/mutate.py" . "$INSTR/mut-task1.json"`.

```json
[
 {"id":"C1","edits":[{"file":"ccd/coordinator-skill/SKILL.md","old":"\n16. A mail from `operator` whose subject begins `stall:` is the server’s stall watch reporting your worker, not the worker itself; it wakes you, and answering it is not polling. Ack it, re-measure the run and the worker’s last mail, then act once: mail the worker a resume that names its last mail and what it owes; or, if the silence is yours because you told it to wait, mail it a subject beginning `wait:` that names what it waits for; or, if the worker is dead or cannot be woken, re-dispatch a dead one as ‘When something is wrong’ says and say which in this turn’s text for the operator. A stall mail never licenses re-dispatching a live worker. Send that `wait:` mail unasked as well, whenever you tell a `working` worker to wait, behind another run or programme or until a time. The watch reads a `wait:` as the run waiting on you only until the next mail to or from the worker, its own notices aside: that mail hands the run back to the worker unless it is another `wait:` from you or, from the worker, a question, an exact `wave-done` or `review-done` claim, or a reply beginning `re stall-check: waiting`.\n","new":"\n"}],"tests":["test/coordinator-skill.test.ts"]},
 {"id":"C2","edits":[{"file":"ccd/coordinator-skill/SKILL.md","old":"\n16. A mail from `operator` whose subject begins `stall:` is the server’s stall watch reporting your worker, not the worker itself; it wakes you, and answering it is not polling. Ack it, re-measure the run and the worker’s last mail, then act once: mail the worker a resume that names its last mail and what it owes; or, if the silence is yours because you told it to wait, mail it a subject beginning `wait:` that names what it waits for; or, if the worker is dead or cannot be woken, re-dispatch a dead one as ‘When something is wrong’ says and say which in this turn’s text for the operator. A stall mail never licenses re-dispatching a live worker. Send that `wait:` mail unasked as well, whenever you tell a `working` worker to wait, behind another run or programme or until a time. The watch reads a `wait:` as the run waiting on you only until the next mail to or from the worker, its own notices aside: that mail hands the run back to the worker unless it is another `wait:` from you or, from the worker, a question, an exact `wave-done` or `review-done` claim, or a reply beginning `re stall-check: waiting`.\n","new":"\n16. A mail from `operator` whose subject begins `stall:` is the server’s stall watch reporting your worker, not the worker itself; it wakes you, and answering it is not polling. Ack it, re-measure the run and the worker’s last mail, then act once: mail the worker a resume that names its last mail and what it owes; or, if the silence is yours because you told it to wait, mail it a subject beginning `wait:` that names what it waits for, which the watch reads as the run waiting on you until your next mail; or, if the worker is dead or cannot be woken, re-dispatch a dead one as ‘When something is wrong’ says and say which in this turn’s text for the operator. A stall mail never licenses re-dispatching a live worker.\n"}],"tests":["test/coordinator-skill.test.ts"]},
 {"id":"C3","edits":[{"file":"ccd/coordinator-skill/SKILL.md","old":" Send that `wait:` mail unasked as well, whenever you tell a `working` worker to wait, behind another run or programme or until a time.","new":""},{"file":"server/test/coordinator-skill.test.ts","old":" Send that `wait:` mail unasked as well, whenever you tell a `working` worker to wait, behind another run or programme or until a time.","new":""}],"tests":["test/coordinator-skill.test.ts"]},
 {"id":"C4","edits":[{"file":"ccd/coordinator-skill/SKILL.md","old":"as the run waiting on you only until the next mail to or from the worker, its own notices aside","new":"as the run waiting on you until your next mail, its own notices aside"},{"file":"server/test/coordinator-skill.test.ts","old":"as the run waiting on you only until the next mail to or from the worker, its own notices aside","new":"as the run waiting on you until your next mail, its own notices aside"}],"tests":["test/coordinator-skill.test.ts"]},
 {"id":"C5","edits":[{"file":"server/src/coord/stall.ts","old":"export const STALL_REPLY_WAITING_PREFIX = 're stall-check: waiting';","new":"export const STALL_REPLY_WAITING_PREFIX = 're stall-check: blocked';"}],"tests":["test/coordinator-skill.test.ts"]},
 {"id":"C6","edits":[{"file":"ccd/coordinator-skill/SKILL.md","old":"an exact `wave-done` or `review-done` claim","new":"an exact `wave-done` or `reviewed` claim"},{"file":"server/test/coordinator-skill.test.ts","old":"an exact `wave-done` or `review-done` claim","new":"an exact `wave-done` or `reviewed` claim"}],"tests":["test/coordinator-skill.test.ts"]},
 {"id":"C7","edits":[{"file":"ccd/coordinator-skill/SKILL.md","old":"whenever you tell a `working` worker to wait","new":"whenever you tell a `busy` worker to wait"},{"file":"server/test/coordinator-skill.test.ts","old":"whenever you tell a `working` worker to wait","new":"whenever you tell a `busy` worker to wait"}],"tests":["test/coordinator-skill.test.ts"]},
 {"id":"C8","edits":[{"file":"ccd/coordinator-skill/SKILL.md","old":"from the worker, a question, an exact","new":"from the worker, a `finding`, an exact"},{"file":"server/test/coordinator-skill.test.ts","old":"from the worker, a question, an exact","new":"from the worker, a `finding`, an exact"}],"tests":["test/coordinator-skill.test.ts"]},
 {"id":"C9","edits":[{"file":"ccd/coordinator-skill/SKILL.md","old":"whenever you tell a `working` worker to wait","new":"whenever you tell a `awaiting-review` worker to wait"},{"file":"server/test/coordinator-skill.test.ts","old":"whenever you tell a `working` worker to wait","new":"whenever you tell a `awaiting-review` worker to wait"}],"tests":["test/coordinator-skill.test.ts"]},
 {"id":"C10","edits":[{"file":"ccd/coordinator-skill/SKILL.md","old":"Send that `wait:` mail unasked as well,","new":"Send that `wait:` mail unasked too,"}],"tests":["test/coordinator-skill.test.ts"]}
]
```

The control is Step 5's green: 159 passed on the unmutated commit. "Widen" is `sends wait: past a stall mail too…`,
"ball" is `states the ball as stall.ts reads it…`, "closed" is `quotes only the constants the clause relies on`, "row
1"/"row 2" are the two wave-4 stall rows, "numbering" is `numbers exactly as many clauses…`.

| # | What it breaks | Expected (measured) |
|---|---|---|
| C1 | the clause line deleted | `7 failed`: verbatim, numbering, row 1, row 2, widen, ball, closed |
| C2 | SKILL.md reverted to the 2026-09-29 clause (pin not) | `3 failed`: verbatim, widen, ball |
| C3 | the widening sentence dropped from SKILL.md AND `CONTRACT` | `1 failed`: widen |
| C4 | "until your next mail" restored in SKILL.md AND `CONTRACT` | `1 failed`: ball |
| C5 | `STALL_REPLY_WAITING_PREFIX` renamed in `stall.ts` | `2 failed`: ball, closed |
| C6 | `review-done` respelt in SKILL.md AND `CONTRACT` | `2 failed`: ball, closed |
| C7 | `working` → `busy` (a live word, not a run state) in both | `2 failed`: widen, closed |
| C8 | a new quoted token outside the clause's relied-on constants, `finding`, in both | `1 failed`: closed |
| C9 | `working` → `awaiting-review` (a run state, not an active one) in both | `2 failed`: widen, closed |
| C10 | one word of the new text changed in SKILL.md only | `1 failed`: verbatim |

The runner must end with `tree clean after restore`. Paste its output into the wave-done mail.

---

### Task 2: The stop clause's wake list, read as a list (worker-skill.test.ts only)

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Modify: `server/test/worker-skill.test.ts` (EOF, inside the stop-clause describe).
- Test: `server/test/worker-skill.test.ts`.
- **Not modified:** `ccd/worker-skill/SKILL.md`.

**Interfaces:**
- Consumes: `STALL_RESUMING_KINDS` (already imported at ≈26; today `['subagent', 'workflow']`, derived from
  `STALL_BG_KIND_MAP` in `stall.ts` ≈370) and the describe's own `stopClause()` helper (≈684).
- Produces: two rows. No new import.

- [ ] **Step 1: Measure the gap first (red-first, as a measurement)**

The two residues are guard gaps, so the failing test is a mutation the current rows miss. On the unedited branch, after
the Baseline's runner exists, write `$INSTR/mut-task2.json` (Step 5's table) and run it **before** writing the rows:

```bash
cd "$(git rev-parse --show-toplevel)" && python3 "$INSTR/mutate.py" . "$INSTR/mut-task2.json"
```

Expected (measured against `main`'s rows): W1–W8 each `Tests 48 passed (48)` — the gap: a background task, the plural
`shells`, an unlisted `sleep`, a `job` joined by `or`, a resume clause, an agent that may resume on its own, and either
direction of a `STALL_RESUMING_KINDS` change all pass today. W9 and W10 each `1 failed | 47 passed (48)` (W9 the
verbatim pin, W10 the existing S3 row). Paste this output into the wave-done mail as the "before" column.

- [ ] **Step 2: Write the rows**

At the foot of `server/test/worker-skill.test.ts`, the stop-clause describe ends with the S4 row's `  });` and then
`});`. Between those two lines, insert this block (it begins with one blank line):

```ts

  // Stall watch wave 7 (`stop-clause-wake-list-allowlist` (D-3806)): ledger R21
  // F1 and R17 F2. The S3 row above scans for three words, so a rewording that
  // names a background task, job or command, or says `shells`, passes it; the
  // S4 row pins one sentence and never reads the list. These two read the wake
  // list itself. The first is an allowlist: every member must be a mail that
  // asks, a structured ask, or a background kind whose words map, one for one,
  // to `stall.ts`'s STALL_RESUMING_KINDS. The second scans the list for any
  // form of resume, the word S4's interim completion used.
  // The list splits on every comma, so kinds inside one background member are
  // joined by `or` or `and` only: "a background agent, workflow or teammate"
  // leaves a bare "a background agent" that matches no member shape, and reds
  // on purpose.
  const wakeMembers = (line: string): string[] => {
    const colon = line.indexOf(': ');
    const list = line.slice(colon + 2, line.indexOf('. ', colon));
    return list.split(/,\s+(?:or\s+)?|\s+or\s+(?=an?\s)/);
  };
  /** The word the clause uses for each kind `stall.ts` says resumes the session on its own. */
  const RESUMING_WORD: Record<string, string> = { subagent: 'agent', workflow: 'workflow' };

  it('admits only a mail that asks, a structured ask, or a kind stall.ts says resumes the session (S3, allowlist)', () => {
    const line = stopClause();
    expect(line, 'no contract clause opens "End a turn only on a wake you can name:"').toBeDefined();
    expect(Object.keys(RESUMING_WORD).sort(),
      'stall.ts changed the kinds that resume a session: name the word the clause uses for each, or drop it')
      .toEqual([...STALL_RESUMING_KINDS].sort());
    const allowed = new Set(Object.values(RESUMING_WORD));
    const members = wakeMembers(line!);
    expect(members.length, 'the wake list split into nothing').toBeGreaterThan(1);
    for (const m of members) {
      const mail = /^an? mail\b.*\basks?\b/i.test(m);
      const ask = /^an? structured ask$/i.test(m);
      const bg = /^an? background ((?:[a-z]+(?: or | and ))*[a-z]+) (?:you|that|which)\b/i.exec(m);
      expect([mail, ask, bg !== null].filter(Boolean).length,
        `the wake list member "${m}" is not a mail that asks, a structured ask, or a background kind`).toBe(1);
      for (const k of bg ? bg[1]!.split(/ or | and /) : []) {
        expect(allowed.has(k.toLowerCase()),
          `the wake list counts a background ${k}, which stall.ts never reads as resuming the session`).toBe(true);
      }
    }
  });

  it('names nothing that may resume on its own among its wakes (S4, scan)', () => {
    const line = stopClause();
    expect(line, 'no contract clause opens "End a turn only on a wake you can name:"').toBeDefined();
    const wakes = wakeMembers(line!).join(', ');
    const said = /\bresum\w*/i.exec(wakes)?.[0];
    expect(said, `the wake list says ${said}: an agent that may resume on its own has reported, and is no wake`)
      .toBeUndefined();
  });
```

Notes for the implementer:
- On today's clause, `wakeMembers` reads three members: `a mail you sent that asks for an answer`, `a background agent
  or workflow you launched from your main thread yourself that has not yet reported`, `a structured ask` (measured).
- The split is on a comma (with an optional `or`), or on ` or ` followed by an article, so "agent or workflow" stays one
  member and "an answer or a background job" becomes two (W4). Because every comma splits, the kinds regex and its
  split carry no comma arm: a comma between kinds is refused on purpose (the row comment says so).
- `RESUMING_WORD` is an object, never a bracketed list of kind names (the comment above `STALL_BG_KIND_MAP` explains why
  a bracketed pair reads as a route-field copy to a scan; tests are outside that scan's roots, but the shape is kept).

- [ ] **Step 3: Run the suites to verify they pass**

```bash
cd "$(git rev-parse --show-toplevel)/server"
./node_modules/.bin/vitest run test/worker-skill.test.ts | grep -E '^ +Tests '
./node_modules/.bin/vitest run test/install-worker-skill.test.ts | grep -E '^ +Tests '
```

Expected (measured): `Tests 50 passed (50)` and `Tests 11 passed (11)`. `git diff --numstat HEAD` reads
`51	0	server/test/worker-skill.test.ts`.

- [ ] **Step 4: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add server/test/worker-skill.test.ts
git commit -m "$(cat <<'MSG'
test(skills): the worker stop clause's wake list is read as a list, not scanned for three words

Stall-watch ledger R21 F1 and R17 F2, parked for the next wave that edits
worker-skill.test.ts (stop-clause-wake-list-allowlist (D-3806)). The S3 row
guarded the wake list on shell|bash|monitor only, so "a background task you
launched" or the plural "shells" passed it; the S4 row pinned one sentence
and never read the list. Two rows read the list's members: an allowlist
(a mail that asks, a structured ask, or a background kind whose words map
one for one to stall.ts's STALL_RESUMING_KINDS) and a scan for any form of
"resume". No SKILL.md text changes.
MSG
)"
```

- [ ] **Step 5: The mutation table, on the committed tree**

Run the same `$INSTR/mut-task2.json` again:
`cd "$(git rev-parse --show-toplevel)" && python3 "$INSTR/mutate.py" . "$INSTR/mut-task2.json"`.

```json
[
 {"id":"W1","edits":[{"file":"ccd/worker-skill/SKILL.md","old":"a background agent or workflow you launched","new":"a background task you launched"},{"file":"server/test/worker-skill.test.ts","old":"a background agent or workflow you launched","new":"a background task you launched"}],"tests":["test/worker-skill.test.ts"]},
 {"id":"W2","edits":[{"file":"ccd/worker-skill/SKILL.md","old":"a background agent or workflow you launched","new":"a background agent or shells you launched"},{"file":"server/test/worker-skill.test.ts","old":"a background agent or workflow you launched","new":"a background agent or shells you launched"}],"tests":["test/worker-skill.test.ts"]},
 {"id":"W3","edits":[{"file":"ccd/worker-skill/SKILL.md","old":"or a structured ask. A background shell","new":"a sleep you started, or a structured ask. A background shell"},{"file":"server/test/worker-skill.test.ts","old":"or a structured ask. A background shell","new":"a sleep you started, or a structured ask. A background shell"}],"tests":["test/worker-skill.test.ts"]},
 {"id":"W4","edits":[{"file":"ccd/worker-skill/SKILL.md","old":"asks for an answer, a background agent","new":"asks for an answer or a background job you started, a background agent"},{"file":"server/test/worker-skill.test.ts","old":"asks for an answer, a background agent","new":"asks for an answer or a background job you started, a background agent"}],"tests":["test/worker-skill.test.ts"]},
 {"id":"W5","edits":[{"file":"ccd/worker-skill/SKILL.md","old":"that has not yet reported, or a structured ask.","new":"that has not yet reported or says it may resume on its own, or a structured ask."},{"file":"server/test/worker-skill.test.ts","old":"that has not yet reported, or a structured ask.","new":"that has not yet reported or says it may resume on its own, or a structured ask."}],"tests":["test/worker-skill.test.ts"]},
 {"id":"W6","edits":[{"file":"ccd/worker-skill/SKILL.md","old":"or a structured ask. A background shell","new":"an agent that says it may resume on its own, or a structured ask. A background shell"},{"file":"server/test/worker-skill.test.ts","old":"or a structured ask. A background shell","new":"an agent that says it may resume on its own, or a structured ask. A background shell"}],"tests":["test/worker-skill.test.ts"]},
 {"id":"W7","edits":[{"file":"server/src/coord/stall.ts","old":"workflow: 'resumes', shell: 'wakes' }","new":"workflow: 'wakes', shell: 'wakes' }"}],"tests":["test/worker-skill.test.ts"]},
 {"id":"W8","edits":[{"file":"server/src/coord/stall.ts","old":"workflow: 'resumes', shell: 'wakes' }","new":"workflow: 'resumes', shell: 'wakes', teammate: 'resumes' }"}],"tests":["test/worker-skill.test.ts"]},
 {"id":"W9","edits":[{"file":"ccd/worker-skill/SKILL.md","old":"a background agent or workflow you launched","new":"a background task you launched"}],"tests":["test/worker-skill.test.ts"]},
 {"id":"W10","edits":[{"file":"ccd/worker-skill/SKILL.md","old":"or a structured ask. A background shell","new":"a background shell you started, or a structured ask. A background shell"},{"file":"server/test/worker-skill.test.ts","old":"or a structured ask. A background shell","new":"a background shell you started, or a structured ask. A background shell"}],"tests":["test/worker-skill.test.ts"]}
]
```

The control is Step 3's green: 50 passed. "Allowlist" and "scan" are the two new rows; "S3" is the wave-4 row `lists no
background shell, Bash or Monitor among its wakes…`.

| # | What it breaks (W1–W8, W10 edit SKILL.md AND `CONTRACT`; W9 SKILL.md only) | Before (Step 1, `main`'s rows) | After (measured) |
|---|---|---|---|
| W1 | "a background task you launched" (R21 F1's own example) | `48 passed` | `1 failed`: allowlist |
| W2 | the plural `shells` among the kinds, no comma ("a background agent or shells you launched") | `48 passed` | `1 failed`: allowlist (message: `counts a background shells`) |
| W3 | an unlisted wake, "a sleep you started" | `48 passed` | `1 failed`: allowlist |
| W4 | "or a background job" joined by `or`, no comma | `48 passed` | `1 failed`: allowlist |
| W5 | "or says it may resume on its own" inside the agent member | `48 passed` | `1 failed`: scan |
| W6 | "an agent that says it may resume on its own" as a wake (R17 F2's shape) | `48 passed` | `2 failed`: allowlist, scan |
| W7 | `stall.ts` stops reading `workflow` as resuming | `48 passed` | `1 failed`: allowlist |
| W8 | `stall.ts` adds a resuming kind | `48 passed` | `1 failed`: allowlist |
| W9 | W1's edit in SKILL.md only | `1 failed`: verbatim | `2 failed`: verbatim, allowlist |
| W10 | "a background shell you started" (both files) | `1 failed`: S3 | `2 failed`: S3, allowlist |

The runner must end with `tree clean after restore`. Paste both runs' output (Step 1 and Step 5) into the wave-done
mail.

---

### Task 3: README and the spec record the amendment, and the whole gate

**Model routing:** `sonnet`, effort `medium`: prose in place, then the gate.

**Files:**
- Modify: `README.md` (≈4049-4061, 13 lines for 13).
- Modify: `docs/superpowers/specs/2026-09-29-worker-stall-watch-design.md` (:3 in place; after ≈685; after ≈921).

- [ ] **Step 1: README's live description of clause 16, in place**

Replace these 13 lines (≈4049-4061; the first begins `**What the skills do with the watch's mail.**`, the last ends
`The `ccrc-worker` skill's clause 17: a`):

```
**What the skills do with the watch's mail.** The `ccrc-coordinator` skill's
clause 16: a mail from `operator` whose subject begins `stall:` is the watch
reporting the worker, not the worker itself; it wakes the coordinator, and
answering it is not polling. The coordinator acks it, re-measures the run and
the worker's last mail, then acts once: it mails the worker a resume that names
the worker's last mail and what the worker owes; or, when the silence is its own
because it told the worker to wait, it mails the worker a subject beginning
`wait:` that names what it waits for, which the watch reads as the ball passing
to the coordinator (above); or, when the worker is dead or cannot be woken, it
re-dispatches only a dead one and says in its turn's text for the operator which
case it found. A stall mail never licenses re-dispatching a live worker. r2's
own body carries the same instruction, as r1's carries the reply protocol, so
neither waits on a skill reaching a home. The `ccrc-worker` skill's clause 17: a
```

with these 13 (widest 101 columns, the width of the neighbouring section's widest line, measured):

```
**What the skills do with the watch's mail.** The `ccrc-coordinator` skill's clause 16: a mail from
`operator` whose subject begins `stall:` is the watch reporting the worker, not the worker itself; it
wakes the coordinator, and answering it is not polling. The coordinator acks it, re-measures the run
and the worker's last mail, then acts once: it mails the worker a resume that names the worker's last
mail and what the worker owes; or, when the silence is its own because it told the worker to wait, it
mails the worker a subject beginning `wait:` that names what it waits for; or, when the worker is
dead or cannot be woken, it re-dispatches only a dead one and says in its turn's text for the
operator which case it found. A stall mail never licenses re-dispatching a live worker. It sends that
`wait:` unasked too, whenever it tells a `working` worker to wait, behind another run or programme or
until a time. The ball that `wait:` passes (above) is the coordinator's only until the next mail to
or from the worker: any but another coordinator `wait:`, or the worker's `question`, exact done claim
or waiting reply, hands it back. r2's own body carries the same instruction, as r1's carries the
reply protocol, so neither waits on a skill reaching a home. The `ccrc-worker` skill's clause 17: a
```

No backtick span is split across lines (measured: every line carries an even number of backticks). The line after
(`worker ends a turn only on a wake it can name — …`) is unchanged.

- [ ] **Step 2: The spec records the amendment (D-3805), beside the 2026-09-29 record**

(a) Line 3, in place:
`**Status:** rev 3.1, APPROVED by the operator 2026-09-29 11:58 UTC (§11 records the rulings). Wave 1 is being planned.`
→
`**Status:** rev 3.1, APPROVED by the operator 2026-09-29 11:58 UTC (§11 records the rulings). Wave 1 is being planned. Amended by the operator 2026-10-04: §6.1's coordinator clause only (§11 decision 13).`

It stays one line, so lines 1–685 do not move (the ledger's and briefs' citations of §4.2 at :299-300 stay exact).

(b) After §6.1's pin-impact paragraph, which ends
`same commit. It is numbered after landing-order's and continuity's clauses if those land first (§10).`, and before the
blank line and `### 6.2 The next free worker clause (pinned)`, insert (it begins with one blank line; 34 lines):

```

**Amended 2026-10-04 (the operator; ledger R2 and R17 F1; `coordinator-wait-widened-ball-truthful` (D-3805)).** The
text above shipped as coordinator clause 16. Two things in it needed changing. Its "until your next mail" was false
against §4.2's ball rule, which this spec chose: the worker's own next ordinary mail hands the ball back too. And the
shadow review (2026-10-02) found three episodes where a coordinator told a `working` worker to wait, behind another
programme or until a time, in an ordinary mail with no `wait:` subject, so the ball stayed with the worker. The
operator approved one amendment, and the clause ships as:

> A mail from `operator` whose subject begins `stall:` is the server’s stall watch reporting your worker, not the
> worker itself; it wakes you, and answering it is not polling. Ack it, re-measure the run and the worker’s last mail,
> then act once: mail the worker a resume that names its last mail and what it owes; or, if the silence is yours
> because you told it to wait, mail it a subject beginning `wait:` that names what it waits for; or, if the worker is
> dead or cannot be woken, re-dispatch a dead one as ‘When something is wrong’ says and say which in this turn’s text
> for the operator. A stall mail never licenses re-dispatching a live worker. Send that `wait:` mail unasked as well,
> whenever you tell a `working` worker to wait, behind another run or programme or until a time. The watch reads a
> `wait:` as the run waiting on you only until the next mail to or from the worker, its own notices aside: that mail
> hands the run back to the worker unless it is another `wait:` from you or, from the worker, a question, an exact
> `wave-done` or `review-done` claim, or a reply beginning `re stall-check: waiting`.

What this holds and what it does not. The ball sentence is now true. The widening gives every park a `wait:`, but by
the same §4.2 rule the ball it passes lasts only until the worker's next ordinary mail, and §6.2's clause ends by
prompting exactly that mail ("mail the coordinator what you did and what wakes you next before the turn ends"). So a
worker that answers a `wait:` with an ordinary `status` mail hands the ball straight back, as in the three episodes
above (which predate §6.2's clause). The widening holds mainly when the worker stays silent after the `wait:`; if r1
reaches it anyway, its `re stall-check: waiting` reply passes the ball (ledger R12). Keeping the ball through the
worker's turn-end mail is a separate operator ruling, not part of this amendment. Two words are read narrowly:
`working` is the run state (an idle pane on a `working` run is the case the widening exists for), so a parked
`dispatched` worker is not named; and "a question" is a mail of kind `question`, as §4.2 reads it, while a structured
ask is the separate `ask` hold and passes no ball.

The clause count, its number and the server are unchanged. The verbatim pin moves with the text, and three new rows
hold what a co-edit of SKILL.md and the pin could lose: the `wait:` sent past a stall mail, the ball's hand-back
exceptions as `stall.ts` and `shared/api.ts` spell them, and every quoted token being one of the constants the clause
relies on.
```

(c) Directly after the line `13. **Clause texts** in §6.1 and §6.2.` (≈921 before (b); ≈955 after), insert:

```
    **Amended 2026-10-04:** the operator approved one amendment to §6.1's clause (ledger R2 and R17 F1): it sends
    `wait:` past a stall mail, and states the ball as §4.2 reads it. §6.1 carries the amended text. The 2026-09-29
    approval of §6.2's text stands unchanged.
```

Notes:
- No test reads this spec, and no LIVE file cites a line of it (measured: `git grep` finds no
  `worker-stall-watch-design.md:<n>` and no `spec :<n>` citation of it outside dated `docs/superpowers` documents). The
  37 added lines (34 + 3) shift only lines after §6.1; the dated citations of those (ledger R17 F4's ":947") are
  snapshots (ledger R6). `git diff --numstat` for the spec reads `38	1`.
- The only D-number the new text carries is D-3805, which this plan defines.

- [ ] **Step 3: Run the whole gate, each file alone, in the foreground**

```bash
cd "$(git rev-parse --show-toplevel)"
git fetch origin main
cd server
for f in coordinator-skill worker-skill reviewer-skill routing-references box-token-census single-definition \
         topology-clean deviation-refs dtbd stall-vocabulary stall-bodies crossrepo-prose readme-holds \
         install-coordinator-skill install-worker-skill child-reclaim-prose child-reclaim-refusals ccrc-api; do
  printf '%s: ' "$f"; ./node_modules/.bin/vitest run "test/$f.test.ts" 2>&1 | grep -E '^ +Tests '
done
./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus' | grep -E '^ +Tests '
```

Then, as a separate foreground command with its own 600000 ms timeout (it compiles the server, agent and pwa test
projects; about 50 s here; it needs `pwa/` and `agent/` `node_modules` installed):

```bash
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts | grep -E '^ +Tests '
```

Expected (measured on the prototype carrying all three tasks):

| Suite | After this wave |
|---|---|
| coordinator-skill | 159 passed (baseline 156) |
| worker-skill | 50 passed (baseline 48) |
| reviewer-skill | 13 |
| routing-references | 11 |
| box-token-census | 23 |
| single-definition | 272 |
| topology-clean | 55 |
| deviation-refs | 31 |
| dtbd | 1 |
| stall-vocabulary | 179 |
| stall-bodies | 159 |
| crossrepo-prose | 17 |
| readme-holds | 17 |
| install-coordinator-skill | 16 |
| install-worker-skill | 11 |
| child-reclaim-prose | 4 |
| child-reclaim-refusals | 20 |
| ccrc-api | 96 |
| typecheck-tests | 12 (the prototype read 11 of 12: its one red, `PWA_TSC really is pwa's own installed compiler`, is an artifact of the scratch copy's symlinked `pwa/node_modules`, as wave 4 recorded; its server-tests project, which compiles all five new rows, was clean) |
| session-hook (filtered) | 7 passed, 328 skipped (335), unchanged |

Only the two skill suites gain tests; every other count is unchanged by this wave (they read the files it edits, or
`stall.ts`, whose exports the two suites import). A red file is re-run alone first.

- [ ] **Step 4: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add README.md docs/superpowers/specs/2026-09-29-worker-stall-watch-design.md
git commit -m "$(cat <<'MSG'
docs(stall): README and the stall spec record the 2026-10-04 amendment to coordinator clause 16

README's live description of clause 16 says the coordinator sends wait:
unasked whenever it tells a working worker to wait, and that the ball a
wait: passes lasts only until the next mail to or from the worker that
does not pass it again (13 lines for 13; the citation corpus is
unchanged). The stall spec keeps §6.1's 2026-09-29 text as the record
and adds the amendment beside it, with what it does not cure (the
worker's turn-end mail still hands the ball back) and a note under §11
decision 13 (coordinator-wait-widened-ball-truthful (D-3805)).
MSG
)"
```

Then `git status --porcelain` prints nothing, and `git log --oneline origin/main..HEAD` lists this wave's three commits,
plus a merge commit only if the Preconditions absorbed `main`.

---

### Task 4: Wave 6's review residue (review 257; ledger R32)

Comment, docstring and test-hygiene edits only. No assertion moves, no guard changes, so no mutation row is owed, and
the suite counts stay exactly as `main` has them after #241. Each edit is found by CONTENT (the quoted old text occurs
once); line numbers are wave 6's tip `b29aba143` and drift.

**Files:** `server/src/coord/stall.ts`, `shared/api.ts`, `server/src/watch.ts`, `server/test/stall-sweep.test.ts`,
`server/test/stall-verdict.test.ts`. Claim them first (wave 6's claims lapse with its run).

- [ ] **Step 1: F2, the gate wording under the strict mode.** `stallIdleStart` reads a live idle or shell word as idle
  in every mode. The strict mode's gate refuses a live `shell`, and R19 accepted that residual. Two texts still say the
  clock follows "the mail gate in force".
  - In `STALL_ARM_MAP`'s `'mail-stuck'` gloss (≈:63), replace `after its main loop went idle as the mail gate in force
    reads it (the `busy` mode delivers on a live busy only while the strict mode is absent)` with `after its main loop
    went idle (a live idle or shell word in every mode, the strict mode included, an accepted residual; or a finished
    turn under a live busy, which the `busy` mode delivers on only while the strict mode is absent)`.
  - In `stallIdleStart`'s docstring (≈:1719), replace `When the recipient's main loop went idle, as the mail gate in
    force can deliver to it (§5.2;` with `When the recipient's main loop went idle (§5.2;`, and replace `the live stamp
    under idle or shell; else` with `the live stamp under idle or shell, in every mode (the strict mode's refusal of a
    live shell is an accepted residual, R19); else`.
  - Spell no marker name (D-3607): "the `busy` mode" and "the strict mode" only. If a suite pins the gloss text,
    update that pin in place and say so in the wave-done.
- [ ] **Step 2: F3, the queue floor is defensive.** Keep `Math.max(passed.at, …)` in `stallDeafMail`.
  - Insert one comment line directly above its `return`: `// The queue floor is defensive: no state the store writes
    puts the estimate before the queue; it binds only on a backward clock step.`
  - In `stall-verdict.test.ts`, insert one comment line directly above the row titled `the estimate never precedes the
    queue: …`: `// Unreachable from the store (five replays need 50 min or more after the first delivery); a valid L1
    input that pins the defensive floor.`
- [ ] **Step 3: F5, the estimate's assumption.** In `stallDeafMail`'s docstring, after `Its error is lateness only,
  bounded by the replay ceiling;` (wrapped across two lines in the file), add: ` it assumes one send per row per replay interval, so the mail lane's
  overlapping-sweep double send (two sends about 30 s apart) can make it early by up to MAIL_REPLAY_MS less 30 s, a
  residual of that race, to which the estimate adds nothing;` and drop the now-duplicated `;` so the bullet still ends
  in one `;`.
- [ ] **Step 4: F6, where the meaning lives.** In `shared/api.ts`'s `MAIL_REPLAY_MS` docstring, replace `What it MEANS
  lives in `watch.ts`'s docstring beside the replay sweep that enforces it.` with `What it MEANS lives in
  `watch.ts`'s docstring in that file's constants block.` In `watch.ts`'s own docstring, replace `WHAT
  `MAIL_REPLAY_MS` MEANS, kept beside the code that enforces it:` with `WHAT `MAIL_REPLAY_MS` MEANS:`. Both edits are
  line-neutral; `shared/api.ts`'s edit sits below every line the README or the compaction card cites.
- [ ] **Step 5: F4, import the replay interval.** In `stall-sweep.test.ts`, add `MAIL_REPLAY_MS` to the existing
  `../../shared/api.js` import (≈:31). In the coord-deaf replay row (≈:2082), delete the `const REPLAY_MS = 10 *
  60_000; …` line and use `MAIL_REPLAY_MS` wherever that row used `REPLAY_MS`.
- [ ] **Step 6: F7, one word.** In the comment above that describe (≈:2075), replace `so its newest `deliveredAt` is
  never 10 min old` with `so its newest `deliveredAt` is at most 10 min old`.
- [ ] **Step 7: Gate.** From `server/`, foreground, one file at a time: stall-verdict, stall-bodies, stall-session,
  stall-sweep, stall-store, stall-vocabulary, single-definition, topology-clean, typecheck-tests; the README citation
  instrument; `npx tsc --noEmit -p .` and the test project; in `pwa/`, `npm run build`. Every count equals `main`'s.
  Grep the added `server/src` and `shared` lines for `stall-watch-`, `mail-gate-` and `mail-disabled`: none.
- [ ] **Step 8: Commit.** `git add server/src/coord/stall.ts shared/api.ts server/src/watch.ts
  server/test/stall-sweep.test.ts server/test/stall-verdict.test.ts && git commit -m "docs(stall): wave 6 review
  residue: gate wording under strict, the defensive queue floor, the estimate's assumption, MAIL_REPLAY_MS imported in
  the sweep row"`.

Left as it is, by ruling: `stallDeafBody` prints the queue time with its age and the newest `deliveredAt`, never the
D-3803 estimate. Everything it prints is true, and the plan of wave 6 left it unedited deliberately (R32).

## If this PR is overtaken before it merges

**PR #215 (child-reclamation wave 4, run 174) edits the same four skill files.** Measured at its head `6138030ec`
(merge-base `0087a0450`, which predates clauses 16/17 and both stall describes):
- `ccd/coordinator-skill/SKILL.md`: clause 3 (≈72) and the lifecycle prose (≈371-379). **Not clause 16** (its tree has
  no `16. ` line; the count word there reads `fifteen`).
- `server/test/coordinator-skill.test.ts`: `CONTRACT[2]` (≈111), the childReclaim length (≈244), the coord-routes list
  (≈520) and one new peer-protocol row (≈1562). **Not `CONTRACT[15]`** (its diff against `main` carries no `A mail from
  `operator`` line), not the imports this wave edits, not the stall describe.
- `ccd/worker-skill/SKILL.md`: the reporting section's "This workspace ends…" sentence (≈261). Not clause 17.
- `server/test/worker-skill.test.ts`: the "this workspace ends" row (≈171) and one row appended inside the routing
  describe (≈666), which on `main` is followed by the stop-clause describe. Not the stop-clause describe.
- `git merge-tree` of this wave's prototype against #215 names exactly the four files #215 already conflicts on against
  `main` (README.md, `server/src/coord/schema.ts`, `server/test/asks-store.test.ts`, `server/test/coord-db.test.ts`),
  with the same single README conflict region (≈3886-3999 in the merged text, ending before this wave's paragraph). This
  wave adds no conflicted file and no conflict region.

**The second-lander rule.** Whichever of this PR and #215 merges second, if its probe then measures a conflict (worker
clause 16), merges `origin/main` into its own branch with `git merge origin/main` (never a rebase, never a force-push), keeps BOTH sides (this wave's clause 16, `CONTRACT[15]`,
imports and appended rows; #215's clause 3, `CONTRACT[2]` and its rows), and then re-runs:
- `coordinator-skill` and `worker-skill` (each alone, foreground). If #215 lands first, their totals rise by #215's rows
  (one each by its head today, so 160 and 51); measure them on `main` before the merge and expect `main`'s count plus
  this wave's three and two;
- the README citation instrument, which must read `7 passed | 328 skipped (335)` (or the count #215's merge leaves on
  `main`, if #215 lands first and changes it: then the expected number is `main`'s, measured on `main` before the
  merge);
- this wave's two mutation tables (C1–C10, W1–W10). Judge each row by its `failed` count and the names of its failing
  rows, which do not move; the `passed (N)` totals shift by #215's rows and are not a finding.

**Any other overtaking.** Another programme's clause can land while this PR is open. This wave's edits are found by
content, so a renumber moves nothing here: clause 16 is edited where its opening words are, and the appended rows find
their clauses by opening words. If a landed change edits clause 16 itself or the stop clause's wake list, stop and name
the conflict by slug in the wave-done mail (for example `clause-16-co-edit`), quoting both texts. Never resolve two
edits of the same clause mechanically; the coordinator rules on the text first.

**Wave 6 (PR #241, head `b29aba143`)** edits `stall.ts`, its tests and README's stall sections. Measured: `git merge-tree`
of this wave's prototype against it exits 0. If #241 lands first, merge `main` and re-run Task 3 Step 3; nothing in this
wave's text depends on it.

## Not in this wave (recorded so nothing is lost)

- **The ball through the worker's turn-end mail (ledger R17 F1's residue), for an operator ruling.** The amended clause
  is true, and by that truth a `wait:` keeps the ball only until the worker's next ordinary mail. Worker clause 17 ends
  every turn with exactly such a mail ("mail the coordinator what you did and what wakes you next"), so a worker that
  acknowledges a `wait:` hands the ball straight back, the same result as the prose parks the widening replaces. One
  possible cure: a worker-clause sentence saying the turn-end mail after a `wait:` uses a subject beginning
  `re stall-check: waiting`, which already passes the ball (`startsWith`, unbound to a check). That needs the operator,
  a worker SKILL.md change (a clause-17 edit and its pins) and a D-number from the coordinator. Not here.
- **A parked `dispatched` worker.** The widening names a `working` worker (the run state, R2's wording). A worker parked
  while its run still reads `dispatched` (the ledger's 2026-10-03 true stall was one) is not named. The widen row
  already accepts any `ACTIVE_RUN_STATES` member, so a later wording that covers it changes text, not the row's logic.
- **Configurable stall-watch parameters.** The operator asked on 2026-10-04 whether any of the watch's parameters
  should be configurable. Every threshold is a compiled constant in `server/src/coord/stall.ts` (≈297-344: the quiet
  ladder `STALL_QUIET_MS` 2 h, `STALL_ESCALATE_MS` and `STALL_OPERATOR_MS` 1 h each, `COORD_BALL_CAP_MS` 30 h,
  `LIMIT_HOLD_CAP_MS` 12.5 h, `DELEGATE_CAP_MS` 4 h, `COORD_DEAF_MS` 1 h, `MAIL_STUCK_MS` 72 min, `ORPHAN_D_IDLE_MS`
  15 min, and others; most marked *chosen* in the spec), and arming is by marker files only. Making any of them
  configurable is a design question (where the value lives, who may write it, whether a box token or the session gate
  guards it, how the PWA shows it), so it is a spec of its own, not a rider on a skills wave. No task here touches it.
- R18's arming order and every marker: the operator's hand, unchanged.

## After the merge (orchestrator, read-only)

The release lane carries the skills: `ccrc update`'s `_inst_skills`, on every rostered home. Nothing rolls a box by hand.
1. Wait until the fleet box's `ccrc version` names a release containing this wave's merge commit.
2. On that box, run `ccrc doctor` (never `--fix` from here). Its `skills` line reads `N/N homes carry the shipped
   ccrc-coordinator, ccrc-worker and ccrc-reviewer`. A FAIL names the stale homes; curing them is the operator's call.
3. Until every home passes, a coordinator that parks a worker may send the `wait:` mail on its own initiative anyway:
   the server has read a coordinator's `wait:` as the ball passing since wave 1.

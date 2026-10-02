# Worker stall watch — wave 4: the two skill clauses and the continuity amendment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Wave numbering:** this is the programme's run-tracked wave 4; the spec's §6 "Wave 3" section is its scope, and the filename keeps `w3`.

**Goal:** Programme wave 4 ships the stall watch's two approved skill clauses with their pins, and amends the
session-continuity spec's "nothing types" sentence to state the orphan arm as shipped:
- **The coordinator clause** reads a `stall:` mail from `operator` as the watch reporting a worker, and says how to
  answer it once.
- **The worker clause** ends a turn only on a wake that can wake the session. A background shell or Monitor is never
  that wake, and neither is an agent that says it may resume on its own.
- **The pins.** Each clause has a verbatim pin, a derived count word in SKILL.md, CLAUDE.md and README.md, and a row
  that ties it to `server/src/coord/stall.ts`.
- **The coordinator clause is this plan's text at the dispatched `planSha`.** The coordinator settles the operator's
  ruling R2 before dispatch, and amends this plan if R2 is approved (Global Constraints).

**Architecture:** Prose and pins only.
- Each clause is ONE numbered line appended to its skill's contract. It is mirrored as the last entry of its suite's
  verbatim `CONTRACT` array.
- Each suite's count word is derived from `CONTRACT.length` and checked in SKILL.md, CLAUDE.md and every README
  mention of the skill's path.
- Each clause gets an appended `describe`. It holds what a verbatim pin cannot: the coordinator clause's quoted
  prefixes and sender equal `stall.ts`'s, and the worker clause's wake list excludes a shell, as `stall.ts`'s kind map
  does.
- No server behaviour, agent, `ccd`, installer, wire or migration change. Skills reach homes through `ccrc update`'s
  `_inst_skills`, as they already do.

**Tech Stack:** Markdown skills (`ccd/*-skill/SKILL.md`); TypeScript tests on vitest (`server/test/`), node
`>=22.13.0`; python3 for two scratch measurement instruments that are never committed.

**Spec:** `docs/superpowers/specs/2026-09-29-worker-stall-watch-design.md`, rev 3.1:
- §6 is the scope.
- §10, Order and Relations: "whichever programme lands second moves the count words and pins in the same commit".
- §11 decision 13: the clause texts were approved with the design, as written in §6.1 and §6.2.
- Waves 1 and 2 are merged (#216, #220, #224).

**Measured at `61b280fb`.** Its tree equals `origin/main` `0db98707`. Every line number below is a hint at that
commit. Each edit names the exact text it replaces, so find it by content.

**§6.3's second and third bullets are already done.** Verified by reading at `61b280fb`; this plan adds nothing for
them:
- **Bullet 2, wave 1's docstrings:**
  - `server/src/livestate.ts` glosses `shell` as "an IDLE main loop, relabelled while a background shell or Monitor
    task runs" (:34-35).
  - Its `LiveStateRead` note says the mail gate "delivers only on an affirmative `idle` or `shell`" (:127).
  - `readLiveState`'s census says "Its three callers" (:196).
  - `sweepMail`'s conjunct 5 in `server/src/watch.ts` is "the SOLE turn-idle authority", with the `shell` tripwire
    (≈3683-3687).
  - `turnStall`'s docstring in `shared/api.ts` reads a `busy` row's age as "a turn's age, OR how long an idle main loop
    has waited on background agents" (≈1540-1541).
  - The 2026-08-17 spec's `shell` reading is corrected at :79-83.
- **Bullet 3, README and CLAUDE.md:**
  - README's mail-gate paragraph (≈2394-2435, `mail-gate-strict` and the two busy markers).
  - README's watcher sections, **The stall watch.** (≈2530) and **The stall watch, wave 2.** (≈2587).
  - CLAUDE.md's coordination invariants carry "The mail gate's idle includes `shell`, and a stall watch backs it"
    (:292).

**Spec line numbers re-measured.** §6.2 names README's worker-skill mentions at `:1769`, `:2123` and `:2487`, measured
2026-09-29. At `61b280fb` they are at :1861, :2215 and :2778.

## Global Constraints

- **Clause numbers are the next free ones on `main` at execution** (spec §10, and a coordinator ruling):
  - Today that is coordinator clause **15** and worker clause **16**.
  - Two unmerged programmes claim the same numbers. Landing-order wave 1
    (`docs/superpowers/plans/2026-09-24-landing-order-wave1-absorb-rules-and-advisory.md`) plans coordinator 15 and
    worker 16. Session-continuity's stage 5 adds one clause to each of the three skills.
  - Task 1 Step 1 re-measures and renumbers. The pins added here find each clause by its opening words, never by its
    number or `CONTRACT` index, so a renumber touches only the tokens Task 1 Step 1 lists.
- **The coordinator clause is gated on ruling R2, which is settled before dispatch.**
  - The text you pin is the one this plan carries at the dispatched `planSha`, and nothing else.
  - The operator's ruling R2 would widen §6.1 to send `wait:` whenever a coordinator parks a working worker or rules
    a timed action. The coordinator settles R2 BEFORE dispatch, and amends this plan first if R2 is approved.
  - This plan carries no alternative clause. A brief, or a recollection of R2, never changes the bytes you pin.
- **Clause bytes are verbatim from spec §6.1 and §6.2. Each clause is ONE line in its SKILL.md**, because both suites
  read `^\d+\. ` as the clause numbering.
  - **Coordinator clause:** typographic `’` (U+2019) and `‘…’` (U+2018/U+2019), as clauses 3–12 are typed. It has
    no straight apostrophe and no `"`. Its `CONTRACT` literal is single-quoted.
  - **Worker clause:** ASCII only. It has no apostrophe of either kind and no `"` (the D-104 note in the worker
    SKILL.md). Its `CONTRACT` literal is double-quoted.
- **Count words are in-place word swaps.** Never re-wrap a README or CLAUDE.md line that carries one:
  - `worker-skill.test.ts` matches `<word> clauses` with ONE literal space.
  - `coordinator-skill.test.ts` matches across whitespace. README's coordinator mention keeps its count word at the end
    of a line, with "clauses" on the next.
- **Mutation-table discipline.** Every new pin ships with a row that goes RED when its guarded text is deleted or
  mutated, measured before and after. The tables below were measured on a scratch copy of `61b280fb` carrying this
  plan's exact edits. Re-measure them on the real branch and record the output.
- **The README citation instrument stays green.** From `server/`:
  `./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'`
  measured `Tests 7 passed | 328 skipped (335)` before this wave and must read the same after.
- **The SKILL.md citation sweep.** Each insertion shifts every later line of its SKILL.md. A LIVE citation of a
  shifted line is repaired in the same commit. "LIVE" means any tracked file other than a dated
  `docs/superpowers/{plans,specs,programs}` document. CLAUDE.md says "Anchors in plans are snapshots", so those are
  history and are left as written.
- **Tests run from `server/`**, as `./node_modules/.bin/vitest run test/<file>.test.ts`:
  - in the FOREGROUND, with a timeout of at least 600000 ms;
  - never with bare `npx vitest`.
  - `session-hook` is a known load flake: re-run it in isolation before calling a red real.
- **Deviation numbers** were issued by the coordinator at run-open and are written in under "Deviations found"
  (one issued number per slug). Any other departure you find is named in your
  wave-done mail by slug, and the coordinator assigns its number. A block of numbers is never written as a range.
- **Commit on this workspace's own branch (`ws/<slug>`), never a separate feature branch.**
- **This repo is public.** No account labels, hostnames, session ids, real pool names or docserver URLs, in code,
  tests, commits or this plan's own edits.
- **Skills reach homes only through `ccrc update`'s `_inst_skills`.** This wave changes no installer:
  - no `ccd/install-*-skill.sh` edit;
  - no `ccd/ccd` edit, so no re-stamp;
  - no `ccd/ccrc` edit.
- **Edits outside the skills, their two suites, CLAUDE.md, README.md and the continuity spec:**
  - The only one allowed is the contingency edit to `server/src/coord/stall.ts`'s two comments that cite "clause 16"
    (≈368, ≈374). It is made ONLY if the worker clause's number is not 16.
  - Nothing in `server/src` changes behaviour.
- **Measurement instruments live outside the tree.** They go in the worker's scratchpad, or in the gitignored
  `.superpowers/sdd/2026-10-02-worker-stall-watch-w3/`. They are never committed.

## Review Focus

1. **Another programme's clauses land first, or land while this PR is open.** Expected: this wave's clauses take the
   next free numbers, and every count word and pin moves in the same commit. Task 1 Step 1 measures and renumbers.
   "If this PR is overtaken" (after Task 3) covers a merge that lands later. Rows C3 and W3 show a wrong number reds.
2. **The server renames a prefix or its sender, or the skill renames the section the clause defers to.** The clause
   would stay byte-exact and send the coordinator the wrong way: it would not see a `stall:` mail for what it is, its
   `wait:` would not move the ball, or it would follow a dead pointer. Expected: a red suite naming the drift. Task 1's
   rows hold it (C7–C10).
3. **A later rewording re-admits a background shell, Bash or Monitor as a wake (S3), or an interim agent completion
   (S4).** A co-edit of SKILL.md and the `CONTRACT` literal passes the verbatim pin. Expected: red anyway. S3 is held by
   W5, W8 and W16–W20 (W18 is a lowercase `monitor`); S4 by W7 and W21.
4. **Quote style is normalized by an editor or a copy-paste:** curly to straight in the coordinator clause, or a curly
   one into the worker clause. Expected: a red verbatim pin that names the clause. Row C11 measures it. The worker
   clause carries no apostrophe at all, so there is nothing to normalize.
5. **A home where `_inst_skills` has not run** still carries the old skills, so its coordinator reads a `stall:` mail
   without the clause. Expected: the watch's own mail bodies carry their protocol (spec §11 decision 3). The r2 body's
   instruction is already pinned verbatim at `server/test/stall-bodies.test.ts` ≈228, and doctor's `skills` check
   names the stale home. Task 3 runs `stall-bodies`; the post-merge check reads doctor.

## Deviations found

Issued by the coordinator at run-open, one per slug; a departure found during execution is named by slug in the
wave-done mail.

- **D-3791** `coordinator-stall-row-widened` (Task 1) — spec §6.1's new row "pins that the quoted `stall:` and `wait:` equal
  the constants exported from `stall.ts`". This plan's appended describe pins those two, and two more facts the clause
  states:
  - Its sender `operator` equals `stall.ts`'s module-private `STALL_SENDER`, read from source because it is not
    exported. No `server/src` edit.
  - The section it defers to, ‘When something is wrong’, is still a `## ` heading of the coordinator SKILL.md.
- **D-3792** `stop-clause-property-rows` (Task 2) — spec §6.2's pin impact is the verbatim array and the count word. This plan
  adds two rows that hold S3 and S4 through a later rewording:
  - The wake list names no shell, Bash or Monitor, in any letter case, and `stall.ts`'s kind map agrees that a shell can wake a session but
    never resumes it.
  - The interim-completion sentence stays.
- **D-3790** `snapshot-citations-left` (Tasks 1–2) — §6.1 says "the citation sweep re-proves each" shifted SKILL.md citation
  "in the same commit". Measured at `61b280fb`, every citation of a shifted line lives in a dated
  `docs/superpowers/{plans,specs,programs}` document. Each already pointed at text that has since moved:
  - coordinator: 13 citations;
  - worker: 1 citation;
  - LIVE files: none.
  This plan is itself a dated plan, and its own text is worded so the sweep's pattern never matches it: once it is
  tracked, the two counts stay 13 and 1.
  The sweep re-proves this by measurement and repairs nothing, because rewriting a dated snapshot falsifies its record.
  A LIVE hit at execution is repaired, and is not covered by this departure.
- **D-3793** `continuity-amendment-states-the-arm` (Task 3, ruling R5) — spec §6.3 prescribes "… and nothing types at spawn.
  If the restart orphaned in-flight work (the marker's `lostBg`), the server's stall watch mails the session itself
  once, 15 minutes after the restart." That misdescribes the spec's own orphan-D arm as it shipped in wave 2
  (`stallOrphanDInner` in `server/src/coord/stall.ts`):
  - The arm counts 15 minutes of an unchanged `idle` or `shell` live status (`ORPHAN_D_IDLE_MS` against the status's
    `statusUpdatedAt`), not 15 minutes from the restart.
  - It fires only while the current marker still reads `done` from before the restart, so a session that has run a
    turn since is never mailed.
  - It gives up 24 hours after the restart (`BACKLOG_HORIZON_MS`).
  - Its rung 2 pushes the operator once if the mail is still unacked 30 minutes after delivery, or undelivered 30
    minutes after queueing (`ORPHAN_PUSH_MS`). That push also needs `stall-watch-escalate`. The spec's sentence does
    not mention it.
  - It sends nothing at all unless `stall-watch-live` and `stall-watch-w2-live` are both present. Wave 2 shipped the
    arm dark: without them it records only shadow (a `stall-shadow:` row on a run, one `ccrc-server: stall-watch
    shadow` log line for a session on no run).
  The continuity spec is read as the contract for what a restart does, so the amendment states the arm as shipped
  rather than the spec's shorthand, whose "15 minutes after the restart" would be false for every session that
  restarts busy, runs a turn, or sits on an unarmed box.

## File structure

| File | Change | Task |
|---|---|---|
| `ccd/coordinator-skill/SKILL.md` | one clause line after clause 14 (≈83); the count word (≈67) | 1 |
| `server/test/coordinator-skill.test.ts` | import (≈24); `CONTRACT` entry (before `];` ≈121); five count words (≈3, ≈94, ≈124, ≈146, ≈181); appended describe (EOF ≈2432) | 1 |
| `ccd/worker-skill/SKILL.md` | one clause line after clause 15 (≈75); two count words (≈52, ≈55) | 2 |
| `server/test/worker-skill.test.ts` | import (≈25); `CONTRACT` entry (before `];` ≈70); two count words (≈37, ≈77); appended describe (EOF ≈630) | 2 |
| `CLAUDE.md` | coordinator count word (≈316) | 1 |
| `CLAUDE.md` | worker count word (≈322) | 2 |
| `README.md` | coordinator count word (≈2212) | 1 |
| `README.md` | worker count words (≈1861, ≈2215, ≈2778, the last with its parenthetical) | 2 |
| `docs/superpowers/specs/2026-09-23-session-continuity-design.md` | §5 "Not-stalled restarts" sentence (≈351-354) | 3 |
| `server/src/coord/stall.ts` | comments ≈368, ≈374, ONLY under the renumber contingency | 2 |

**Deliberately unchanged:**
- In `worker-skill.test.ts`, the comments that record earlier counts as history: ≈89 ("thirteen"), ≈114-115
  ("thirteen"), ≈161 ("the count stays fifteen", child reclamation's own wave).
- Every `docs/superpowers` snapshot anchor.
- `coord-routes-single-file.test.ts:1` and `resume-reclaim-l0.test.ts:21,44,97` cite `coordinator-skill.test.ts` by
  line. Measured: all four already point at moved text, and the `CONTRACT` insertion only moves them further.
- `ccd/coordinator-skill/references/*`. No reference cites a SKILL.md line.

## The two measurement instruments (write once, never commit)

`INSTR` below is the worker's scratchpad or `.superpowers/sdd/2026-10-02-worker-stall-watch-w3/`, an absolute path.

`$INSTR/mutate.py`:

```python
#!/usr/bin/env python3
"""Mutation-table runner — a measurement instrument, never committed.
Usage: python3 mutate.py <repo-root> <rows.json>
A row is {"id", "edits": [{"file", "old", "new"}, ...], "tests": [...]}; every
`old` must occur exactly once in its file, or the row is SKIPPED and says so.
Applies the row's edits, runs its tests from server/ in the foreground, prints
the vitest summary and each failing test's name, then restores every edited
file from HEAD. Run it only on a COMMITTED tree: the restore is a checkout."""
import json, subprocess, sys, pathlib
root = pathlib.Path(sys.argv[1]).resolve()
for r in json.load(open(sys.argv[2], encoding='utf-8')):
    texts = {}
    for e in r['edits']:
        f = root / e['file']
        t = texts.get(e['file'], f.read_text(encoding='utf-8'))
        if t.count(e['old']) != 1:
            texts = None
            print(f"{r['id']}: SKIPPED — {e['file']}: old string occurs {t.count(e['old'])} times"); break
        texts[e['file']] = t.replace(e['old'], e['new'])
    if texts is None: continue
    for name, t in texts.items(): (root / name).write_text(t, encoding='utf-8')
    try:
        out = subprocess.run(['./node_modules/.bin/vitest', 'run', *r['tests']], cwd=root / 'server',
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=600).stdout
    finally:
        subprocess.run(['git', 'checkout', 'HEAD', '--', *texts], cwd=root, check=True)
    summary = [l.strip() for l in out.splitlines() if l.strip().startswith('Tests ')]
    fails = sorted({l.split('>', 1)[1].strip() for l in out.splitlines()
                    if l.strip().startswith('FAIL ') and '>' in l})
    print(f"{r['id']}: {summary[-1] if summary else 'NO SUMMARY — an import-time crash is a false red'}")
    for x in fails: print(f"    {x}")
dirty = subprocess.run(['git', 'status', '--porcelain'], cwd=root, capture_output=True, text=True).stdout
print('tree clean after restore' if not dirty.strip() else 'TREE DIRTY:\n' + dirty)
```

`$INSTR/cite-sweep.py`:

```python
#!/usr/bin/env python3
"""Which tracked line citations of a skill's SKILL.md does an insertion shift?
Usage (anywhere in the repo): python3 cite-sweep.py <coordinator|worker> <first shifted line>
A measurement instrument, never committed. Prints every citation whose cited
line (or range end) is at or past <first shifted line>, tagged SNAPSHOT when it
lives in a dated docs/superpowers plan, spec or programme ledger and LIVE
otherwise. A bare `SKILL.md:<n>` (no skill directory) in a LIVE file prints as
AMBIGUOUS for a human to attribute. Exits 1 when any LIVE or AMBIGUOUS line printed."""
import re, subprocess, sys
skill, first = sys.argv[1], int(sys.argv[2])
top = subprocess.run(['git', 'rev-parse', '--show-toplevel'], capture_output=True, text=True, check=True).stdout.strip()
out = subprocess.run(['git', 'grep', '-n', '-I', '-E', r'SKILL\.md`?:[0-9]'],
                     capture_output=True, text=True, cwd=top).stdout
SNAP = re.compile(r'^docs/superpowers/(plans|specs|programs)/')
CITE = re.compile(r'(?:(coordinator|worker|reviewer)-skill/)?SKILL\.md`?:(\d+)(?:[-–](\d+))?')
bad = 0
for row in out.splitlines():
    path, ln, text = row.split(':', 2)
    for m in CITE.finditer(text):
        who, a, b = m.group(1), int(m.group(2)), int(m.group(3) or m.group(2))
        if b < first: continue
        snap = bool(SNAP.match(path))
        if who == skill:
            tag = 'SNAPSHOT' if snap else 'LIVE'
        elif who is None and not snap:
            tag = 'AMBIGUOUS'
        else:
            continue
        bad += tag != 'SNAPSHOT'
        print(f'{tag:9} {path}:{ln}  {m.group(0)}')
sys.exit(1 if bad else 0)
```

---

## Tasks

### Task 1: The coordinator's stall clause, its pins, and the renumber measurement

**Model routing:** `sonnet`, effort `high`: transcription of pinned bytes plus tests and a mutation table.

**Files:**
- Modify: `ccd/coordinator-skill/SKILL.md`: the count word (≈67) and one clause line after clause 14 (≈83).
- Modify: `server/test/coordinator-skill.test.ts`: an import (≈24), five count words (≈3, ≈94, ≈124, ≈146, ≈181),
  the `CONTRACT` entry (≈121), and a describe appended at EOF.
- Modify: `CLAUDE.md` ≈316 and `README.md` ≈2212 (count words, in place).
- Test: `server/test/coordinator-skill.test.ts`.

**Interfaces:**
- Consumes, from `server/src/coord/stall.ts`:
  - `export const STALL_REPORT_PREFIX = 'stall:';` (≈29);
  - `export const STALL_WAIT_PREFIX = 'wait:';` (≈31);
  - the module-private `const STALL_SENDER = 'operator';` (≈45), read as source text, not imported.
- Produces:
  - coordinator clause `N_c` (15 unless Step 1 says otherwise), the LAST entry of the coordinator `CONTRACT`;
  - the count word `word(N_c)` in SKILL.md, CLAUDE.md and README.md;
  - `N_c` and `N_w`, which Task 2 consumes.

- [ ] **Step 1: Re-measure the clause counts on the base, and fix this wave's numbers**

```bash
cd "$(git rev-parse --show-toplevel)"
git fetch origin
cc() { awk '/^## The contract$/{f=1;next} /^## /{f=0} f && /^[0-9]+\. /' | wc -l; }
echo "coordinator HEAD=$(cc < ccd/coordinator-skill/SKILL.md) main=$(git show origin/main:ccd/coordinator-skill/SKILL.md | cc)"
echo "worker HEAD=$(grep -cE '^[0-9]+\. ' ccd/worker-skill/SKILL.md) main=$(git show origin/main:ccd/worker-skill/SKILL.md | grep -cE '^[0-9]+\. ')"
```

Expected (measured at `61b280fb`): `coordinator HEAD=14 main=14` and `worker HEAD=15 main=15`.

Read the output as follows:
- **Both pairs read as measured.** Then `N_c = 15` and `N_w = 16`, and every step below applies as written.
- **`main` is greater than `HEAD` for either skill.** Another programme's clause merged after this workspace was cut.
  Absorb `origin/main` with `git merge origin/main`, under the absorb rules the worker skill on your base states: a
  merge, never a rebase or a force-push. Then run the commands again.
- **Read every clause that landed.** One that tells workers to wait with the Monitor tool contradicts this wave's
  worker clause. Stop as "If this PR is overtaken" says.
- **After that, `HEAD` reads `C` for the coordinator and `W` for the worker, other than 14 and 15.** Then
  `N_c = C + 1` and `N_w = W + 1`. `word(n)` is the English number word (15 `fifteen`, 16 `sixteen`, 17 `seventeen`,
  18 `eighteen`, 19 `nineteen`; both suites' `WORDS` arrays end at `twenty`). Make exactly these substitutions,
  everywhere this plan's text shows the 15/16 form:

| Site | As written here | Under the renumber |
|---|---|---|
| coordinator SKILL.md, the new line's prefix | `15. ` | `<N_c>. ` |
| the new line's place in the coordinator SKILL.md | after the line beginning `14. ` | after the line beginning `<C>. ` |
| coordinator count words: SKILL.md `These … sentences`, CLAUDE.md `its … clauses are pinned VERBATIM`, README `and its …` (line end) | `fourteen` → `fifteen` | `word(C)` → `word(N_c)` |
| `coordinator-skill.test.ts` count words: every comment or title that states the coordinator contract's size (Step 2 (a), (c), (e), (f), (g); the grep below finds them) | `fourteen` → `fifteen` | the word each states → `word(N_c)` |
| worker SKILL.md, the new line's prefix | `16. ` | `<N_w>. ` |
| the new line's place in the worker SKILL.md | after the line beginning `15. ` | after the line beginning `<W>. ` |
| worker count words: SKILL.md `These … clauses` and `these … lines`; CLAUDE.md `… clauses pinned by`; README ≈1861, ≈2215, ≈2778 | `fifteen` → `sixteen` | `word(W)` → `word(N_w)` |
| README ≈2778's parenthetical | gains `, the stall watch added 16` before its `)` | gains `, the stall watch added <N_w>` before its `)`; the rest of the parenthetical stays as the base has it |
| `worker-skill.test.ts` count words (Task 2 Step 2 (b), (d)) | `fifteen` → `sixteen` | `word(W)` → `word(N_w)` |
| `server/src/coord/stall.ts` comments ≈368 (`a shell, clause 16`) and ≈374 (`A shell does not (clause 16)`) | unchanged | `clause 16` → `clause <N_w>` |
| mutation rows C1–C3, C13–C15 and W1–W3, W10–W15 | the 15/16 numbers and words | the same substitutions |

The count words in `coordinator-skill.test.ts` are found with
`grep -nwE 'fourteen|fifteen|sixteen|seventeen|eighteen' server/test/coordinator-skill.test.ts`. Change only the hits
that state the size of the coordinator contract.

Write the two measured numbers and `N_c`/`N_w` into the wave-done mail.
- Two things do NOT move: the new describes' titles, and the `CONTRACT` comment lines. Both are number-free by design.
- The `CONTRACT` entry is always the array's LAST entry, directly before its `];`. That holds even when another
  programme's code follows the `];`, such as a `const` bound to its own entry by index.

- [ ] **Step 2: Write the failing tests**

All edits are in `server/test/coordinator-skill.test.ts`:

(a) Line ≈3: `// fourteen contract clauses, the routes it names, the refusal codes it promises,` →
`// fifteen contract clauses, the routes it names, the refusal codes it promises,`

(b) Directly after line ≈24, `import { WORKER_KICKOFF_PREFIX } from '../src/coord/dispatch.js';`, add:

```ts
import { STALL_REPORT_PREFIX, STALL_WAIT_PREFIX } from '../src/coord/stall.js';
```

(c) Line ≈94: `// The fourteen clauses, verbatim. Kept as a literal array rather than a regex per` →
`// The fifteen clauses, verbatim. Kept as a literal array rather than a regex per`

(d) In `CONTRACT`, the last entry ends `…and no wave is accepted on a reading this session made alone.",`, followed by
`];` (≈121). Between the two, add these three lines:

```ts
  // Worker stall watch, wave 3 (spec 2026-09-29 §6.1). Typographic apostrophes
  // and quotes, as clauses 3–12 are typed; no straight apostrophe at all.
  'A mail from `operator` whose subject begins `stall:` is the server’s stall watch reporting your worker, not the worker itself; it wakes you, and answering it is not polling. Ack it, re-measure the run and the worker’s last mail, then act once: mail the worker a resume that names its last mail and what it owes; or, if the silence is yours because you told it to wait, mail it a subject beginning `wait:` that names what it waits for, which the watch reads as the run waiting on you until your next mail; or, if the worker is dead or cannot be woken, re-dispatch a dead one as ‘When something is wrong’ says and say which in this turn’s text for the operator. A stall mail never licenses re-dispatching a live worker.',
```

(e) Line ≈124: `  it('carries all fourteen clauses verbatim', () => {` →
`  it('carries all fifteen clauses verbatim', () => {`

(f) Line ≈146: `  // "These fourteen sentences" (SKILL.md:67), not "clauses"/"lines" as the` →
`  // "These fifteen sentences" (SKILL.md:67), not "clauses"/"lines" as the`. Line 67 does not move: the insertion is
below it.

(g) Line ≈181: `    // SKILL.md states it once in its own words ("These fourteen sentences").` →
`    // SKILL.md states it once in its own words ("These fifteen sentences").`

(h) Append at the end of the file, after the last line (`});`):

```ts

// ── Worker stall watch, wave 3 (spec 2026-09-29 §6.1) ────────────────────────
// APPENDED at the foot: the CONTRACT entry is this wave's only insertion into
// the body of the file. The stall clause quotes three things the server owns:
// the report prefix the watch SENDS (`stall:`), the prefix it READS as the run
// waiting on the coordinator (`wait:`), and the sender it mails from
// (`operator`). It also names one section of this skill. The verbatim pin above
// holds the clause's bytes and none of those four relations: a prefix renamed in
// `stall.ts`, or this section renamed, would leave the clause byte-exact and
// wrong. The clause is read from SKILL.md, the shipped text, and found by its
// opening words, never by its number, which §10 assigns at merge.
describe('the stall clause quotes what the stall watch sends and reads (stall watch spec §6.1)', () => {
  const stallClause = (): string | undefined => {
    const at = skill.indexOf('## The contract');
    const section = skill.slice(at, skill.indexOf('\n## ', at + 1));
    return section.split('\n').find((l) => /^\d+\. A mail from `[^`]+` whose subject begins `/.test(l));
  };

  it('quotes STALL_REPORT_PREFIX and STALL_WAIT_PREFIX byte for byte', () => {
    const line = stallClause();
    expect(line, 'no contract clause opens "A mail from `…` whose subject begins `…`"').toBeDefined();
    expect(/whose subject begins `([^`]+)`/.exec(line!)?.[1],
      'the clause quotes a report prefix the stall watch does not send').toBe(STALL_REPORT_PREFIX);
    expect(/a subject beginning `([^`]+)`/.exec(line!)?.[1],
      'the clause quotes a wait prefix the stall watch does not read').toBe(STALL_WAIT_PREFIX);
  });

  it('names the sender the watch mails from, and a section this skill still has', () => {
    const line = stallClause();
    expect(line, 'no contract clause opens "A mail from `…` whose subject begins `…`"').toBeDefined();
    // `STALL_SENDER` is module-private, so its ONE definition line is read from
    // source rather than imported; a reshaped definition reds here and says so.
    const src = readFileSync(path.join(root, 'server/src/coord/stall.ts'), 'utf8');
    const sender = /^(?:export )?const STALL_SENDER = '([^']+)';$/m.exec(src)?.[1];
    expect(sender, 'stall.ts no longer defines STALL_SENDER as one quoted literal — re-derive this pin').toBeDefined();
    expect(/^\d+\. A mail from `([^`]+)`/.exec(line!)?.[1],
      'the clause names a sender the stall watch does not mail from').toBe(sender);
    const named = /as ‘([^’]+)’ says/.exec(line!)?.[1];
    expect(named, 'the clause no longer names the section it defers to').toBeDefined();
    expect(skill, `the clause defers to ‘${named}’, and SKILL.md has no such section`)
      .toContain(`\n## ${named}\n`);
  });
});
```

- [ ] **Step 3: Run the suite to verify it fails**

Run: `cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts`

Expected: `Tests 5 failed | 147 passed (152)`, measured on the prototype. The five:
- `carries all fifteen clauses verbatim`: `missing contract clause: A mail from \`operator\` whose subject begins \`sta…`.
- `numbers exactly as many clauses as the CONTRACT pins, 1..N with no gaps`.
- `spells that same count, as one derived word, everywhere prose states it`: `SKILL.md says fourteen where the
  CONTRACT pins 15`.
- Both new rows: `no contract clause opens "A mail from \`…\` whose subject begins \`…\`"`.

- [ ] **Step 4: Add the clause and move the count words**

In `ccd/coordinator-skill/SKILL.md`:
- Line ≈67: `These fourteen sentences are the boundary` → `These fifteen sentences are the boundary`.
- Directly after the line beginning `14. The review brief names the held-out panel` (≈83), and before the blank line
  that follows it, add this ONE line. Copy it exactly: curly `’`, `‘` and `’`, no straight apostrophe.

```
15. A mail from `operator` whose subject begins `stall:` is the server’s stall watch reporting your worker, not the worker itself; it wakes you, and answering it is not polling. Ack it, re-measure the run and the worker’s last mail, then act once: mail the worker a resume that names its last mail and what it owes; or, if the silence is yours because you told it to wait, mail it a subject beginning `wait:` that names what it waits for, which the watch reads as the run waiting on you until your next mail; or, if the worker is dead or cannot be woken, re-dispatch a dead one as ‘When something is wrong’ says and say which in this turn’s text for the operator. A stall mail never licenses re-dispatching a live worker.
```

In `CLAUDE.md` (≈316): `its fourteen clauses are pinned VERBATIM by` → `its fifteen clauses are pinned VERBATIM by`.

In `README.md` (≈2212): `), and its fourteen` → `), and its fifteen`. Each string is unique in its file, measured.
The word stays at the end of the line, and `clauses` stays at the start of the next.

- [ ] **Step 5: Run the suites to verify they pass**

```bash
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts
./node_modules/.bin/vitest run test/install-coordinator-skill.test.ts
```

Expected: `coordinator-skill` `Tests 152 passed (152)` and `install-coordinator-skill` `Tests 16 passed (16)`.
Baselines at `61b280fb` were 150 and 16.

- [ ] **Step 6: The citation sweep, and the README instrument**

```bash
cd "$(git rev-parse --show-toplevel)"
python3 "$INSTR/cite-sweep.py" coordinator 84; echo "exit $?"
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'
```

Use 84, the first line the insertion moves, at `61b280fb`. Under the renumber it is the new clause's own line number.

Expected:
- **The sweep prints 13 `SNAPSHOT` lines and `exit 0`.** They are in `plans/2026-08-26-ccrc-api.md`,
  `plans/2026-09-08-crossrepo-wave1-server.md`, `plans/2026-09-08-crossrepo-wave2-skills-pwa.md`,
  `plans/2026-09-08-crossrepo-wave3-docs-flip.md`, `programs/home-project-flip.md` (three),
  `specs/2026-08-18-ccrc-worker-skill-design.md`, `specs/2026-08-28-program-leverage-design.md`,
  `specs/2026-09-08-crossrepo-programmes-design.md` (two) and `specs/2026-09-14-review-runs-design.md` (two).
- Each of those already pointed at moved text before this wave (`snapshot-citations-left` (D-3790)).
- The instrument prints `Tests 7 passed | 328 skipped (335)`.
- A `LIVE` or `AMBIGUOUS` line means `main` moved. Open the cited line at the base and at the tip, and repair the
  citation in this task's commit, or attribute an `AMBIGUOUS` one to the other skill and say so in the wave-done mail.

- [ ] **Step 7: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add ccd/coordinator-skill/SKILL.md server/test/coordinator-skill.test.ts CLAUDE.md README.md
git commit -m "$(cat <<'MSG'
feat(skills): coordinator clause 15 — a stall: mail is the watch reporting your worker

Stall watch spec 2026-09-29 §6.1, text as approved (§11 decision 13). A mail
from operator whose subject begins stall: wakes the coordinator, is not
polling, and is answered once: a resume that names the worker's last mail, a
wait: subject the watch reads as the run waiting on the coordinator, or a
re-dispatch of a dead worker. It never licenses re-dispatching a live one.

Pinned verbatim; the count word moves 14 -> 15 in SKILL.md, CLAUDE.md and
README.md in this commit. An appended describe holds what the verbatim pin
cannot: the quoted stall: and wait: equal STALL_REPORT_PREFIX and
STALL_WAIT_PREFIX, the sender equals stall.ts's STALL_SENDER, and the
section the clause defers to still exists. The clause is found by its
opening words, so a renumber at merge (spec §10) moves no pin.
MSG
)"
```

Under the renumber, write `<N_c>` and `<C> -> <N_c>` in the subject and body.

- [ ] **Step 8: The mutation table, on the committed tree**

Write `$INSTR/mut-task1.json`, then run `cd "$(git rev-parse --show-toplevel)" && python3 "$INSTR/mutate.py" . "$INSTR/mut-task1.json"`.

```json
[
 {"id":"C1","edits":[{"file":"ccd/coordinator-skill/SKILL.md","old":"\n15. A mail from `operator` whose subject begins `stall:` is the server’s stall watch reporting your worker, not the worker itself; it wakes you, and answering it is not polling. Ack it, re-measure the run and the worker’s last mail, then act once: mail the worker a resume that names its last mail and what it owes; or, if the silence is yours because you told it to wait, mail it a subject beginning `wait:` that names what it waits for, which the watch reads as the run waiting on you until your next mail; or, if the worker is dead or cannot be woken, re-dispatch a dead one as ‘When something is wrong’ says and say which in this turn’s text for the operator. A stall mail never licenses re-dispatching a live worker.\n","new":"\n"}],"tests":["test/coordinator-skill.test.ts"]},
 {"id":"C2","edits":[{"file":"ccd/coordinator-skill/SKILL.md","old":"\n15. A mail from `operator`","new":"\nA mail from `operator`"}],"tests":["test/coordinator-skill.test.ts"]},
 {"id":"C3","edits":[{"file":"ccd/coordinator-skill/SKILL.md","old":"\n15. A mail from `operator`","new":"\n16. A mail from `operator`"}],"tests":["test/coordinator-skill.test.ts"]},
 {"id":"C4","edits":[{"file":"ccd/coordinator-skill/SKILL.md","old":"whose subject begins `stall:` is","new":"whose subject begins `stalled:` is"}],"tests":["test/coordinator-skill.test.ts"]},
 {"id":"C5","edits":[{"file":"ccd/coordinator-skill/SKILL.md","old":"a subject beginning `wait:` that","new":"a subject beginning `hold:` that"}],"tests":["test/coordinator-skill.test.ts"]},
 {"id":"C6","edits":[{"file":"ccd/coordinator-skill/SKILL.md","old":"whose subject begins `stall:` is","new":"whose subject begins `stalled:` is"},{"file":"server/test/coordinator-skill.test.ts","old":"whose subject begins `stall:` is","new":"whose subject begins `stalled:` is"}],"tests":["test/coordinator-skill.test.ts"]},
 {"id":"C7","edits":[{"file":"server/src/coord/stall.ts","old":"export const STALL_REPORT_PREFIX = 'stall:';","new":"export const STALL_REPORT_PREFIX = 'stall-report:';"}],"tests":["test/coordinator-skill.test.ts"]},
 {"id":"C8","edits":[{"file":"server/src/coord/stall.ts","old":"export const STALL_WAIT_PREFIX = 'wait:';","new":"export const STALL_WAIT_PREFIX = 'hold:';"}],"tests":["test/coordinator-skill.test.ts"]},
 {"id":"C9","edits":[{"file":"server/src/coord/stall.ts","old":"const STALL_SENDER = 'operator';","new":"const STALL_SENDER = 'stall-watch';"}],"tests":["test/coordinator-skill.test.ts"]},
 {"id":"C10","edits":[{"file":"ccd/coordinator-skill/SKILL.md","old":"\n## When something is wrong\n","new":"\n## When a wave goes wrong\n"}],"tests":["test/coordinator-skill.test.ts"]},
 {"id":"C11","edits":[{"file":"ccd/coordinator-skill/SKILL.md","old":"is the server’s stall watch","new":"is the server's stall watch"}],"tests":["test/coordinator-skill.test.ts"]},
 {"id":"C12","edits":[{"file":"ccd/coordinator-skill/SKILL.md","old":" A stall mail never licenses re-dispatching a live worker.\n","new":"\n"}],"tests":["test/coordinator-skill.test.ts"]},
 {"id":"C13","edits":[{"file":"ccd/coordinator-skill/SKILL.md","old":"These fifteen sentences are the boundary","new":"These fourteen sentences are the boundary"}],"tests":["test/coordinator-skill.test.ts"]},
 {"id":"C14","edits":[{"file":"CLAUDE.md","old":"its fifteen clauses are pinned VERBATIM by","new":"its fourteen clauses are pinned VERBATIM by"}],"tests":["test/coordinator-skill.test.ts"]},
 {"id":"C15","edits":[{"file":"README.md","old":"(`ccd/coordinator-skill/SKILL.md`), and its fifteen\n","new":"(`ccd/coordinator-skill/SKILL.md`), and its fourteen\n"}],"tests":["test/coordinator-skill.test.ts"]}
]
```

The control is Step 5's green: 152 passed on the unmutated commit.

Expected reds, measured on the prototype. "Row 1" is `quotes STALL_REPORT_PREFIX and STALL_WAIT_PREFIX byte for
byte` and "row 2" is `names the sender the watch mails from, and a section this skill still has`.

| # | What it breaks | Expected (measured) |
|---|---|---|
| C1 | the clause line deleted | `4 failed`: verbatim, numbering, row 1, row 2 |
| C2 | the clause unnumbered | `3 failed`: numbering, row 1, row 2 |
| C3 | the clause numbered 16 | `1 failed`: numbering |
| C4 | SKILL.md's `stall:` changed | `2 failed`: verbatim, row 1 |
| C5 | SKILL.md's `wait:` changed | `2 failed`: verbatim, row 1 |
| C6 | `stall:` changed in SKILL.md AND the `CONTRACT` literal (verbatim stays green) | `1 failed`: row 1 |
| C7 | `STALL_REPORT_PREFIX` renamed in `stall.ts` | `1 failed`: row 1 |
| C8 | `STALL_WAIT_PREFIX` renamed in `stall.ts` | `1 failed`: row 1 |
| C9 | `STALL_SENDER` renamed in `stall.ts` | `1 failed`: row 2 |
| C10 | the ‘When something is wrong’ section renamed | `1 failed`: row 2 |
| C11 | one curly apostrophe made straight | `1 failed`: verbatim |
| C12 | the clause's last sentence dropped | `1 failed`: verbatim |
| C13 | SKILL.md's count word reverted | `1 failed`: count word |
| C14 | CLAUDE.md's count word reverted | `1 failed`: count word |
| C15 | README's count word reverted | `1 failed`: count word |

The runner must end with `tree clean after restore`. Paste its output into the wave-done mail. A row whose red differs
from the table is a finding: fix the pin in a new commit and re-run the whole table.

---

### Task 2: The worker's stop clause and its pins

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Modify: `ccd/worker-skill/SKILL.md`: two count words (≈52, ≈55) and one clause line after clause 15 (≈75).
- Modify: `server/test/worker-skill.test.ts`: an import (≈25), two count words (≈37, ≈77), the `CONTRACT` entry (≈70),
  and a describe appended at EOF.
- Modify: `CLAUDE.md` ≈322 and `README.md` ≈1861, ≈2215, ≈2778 (count words, in place; ≈2778 also gains its
  parenthetical).
- Modify, ONLY if `N_w ≠ 16`: `server/src/coord/stall.ts` ≈368 and ≈374, comments only.
- Test: `server/test/worker-skill.test.ts`.

**Interfaces:**
- Consumes:
  - `N_w` from Task 1 Step 1.
  - From `server/src/coord/stall.ts`: `export const STALL_WAKE_KINDS: readonly string[]` (≈372; today
    `['subagent', 'workflow', 'shell']`) and `export const STALL_RESUMING_KINDS: readonly string[]` (≈375; today
    `['subagent', 'workflow']`). Both are derived from `STALL_BG_KIND_MAP` (≈370).
- Produces: worker clause `N_w`, the LAST entry of the worker `CONTRACT`, and the count word `word(N_w)` everywhere it
  is checked.

- [ ] **Step 1: Confirm the worker number**

```bash
cd "$(git rev-parse --show-toplevel)"
echo "worker HEAD=$(grep -cE '^[0-9]+\. ' ccd/worker-skill/SKILL.md)"
```

Expected: `worker HEAD=15`, the `W` Task 1 Step 1 recorded, so `N_w = 16`. If it differs from Task 1's `W`, stop:
`main` was merged in between. Redo Task 1 Step 1's reading before continuing.

- [ ] **Step 2: Write the failing tests**

All edits are in `server/test/worker-skill.test.ts`:

(a) Directly after line ≈25, `import { SUBAGENT_CLASSES } from '../../shared/models.mjs';`, add:

```ts
import { STALL_RESUMING_KINDS, STALL_WAKE_KINDS } from '../src/coord/stall.js';
```

(b) Line ≈37: `// The fifteen clauses, verbatim. Every entry is DOUBLE-quoted on purpose: clause 3` →
`// The sixteen clauses, verbatim. Every entry is DOUBLE-quoted on purpose: clause 3`

(c) In `CONTRACT`, the last entry ends `…unclear otherwise. The suite line is never omitted.",`, followed by `];`
(≈70). Between the two, add these two lines:

```ts
  // Worker stall watch, wave 3 (spec 2026-09-29 §6.2): ASCII only, no apostrophe.
  "End a turn only on a wake you can name: a mail you sent that asks for an answer, a background agent or workflow you launched from your main thread yourself that has not yet reported, or a structured ask. A background shell or Monitor is never that wake: it has no deadline and may never report. A task a subagent started reports to that subagent, so an agent whose completion says it may resume on its own has reported, and is not that wake either. A restart kills every background task. When none of those holds, mail the coordinator what you did and what wakes you next before the turn ends.",
```

(d) Line ≈77: `  it('carries all fifteen clauses verbatim', () => {` →
`  it('carries all sixteen clauses verbatim', () => {`

(e) Append at the end of the file, after the last line (`});`):

```ts

// ── Worker stall watch, wave 3 (spec 2026-09-29 §6.2) ────────────────────────
// APPENDED at the foot. The stop clause exists for two measured stalls: S3, a
// worker that ended its turn on a background shell that never reported, and S4,
// one that counted an agent's interim completion as a wake. The verbatim pin
// holds today's bytes; these rows hold the two properties through any later
// rewording. They read SKILL.md and find the clause by its opening words, never
// by its number, which §10 assigns at merge. The server half is `stall.ts`'s
// kind map, whose comments cite this clause: a shell can wake a session and
// never resumes one.
describe('the stop clause names only wakes that wake (stall watch spec §6.2)', () => {
  const stopClause = (): string | undefined =>
    skill.split('\n').find((l) => /^\d+\. End a turn only on a wake you can name: /.test(l));

  it('lists no background shell, Bash or Monitor among its wakes, and says a shell never is one (S3)', () => {
    const line = stopClause();
    expect(line, 'no contract clause opens "End a turn only on a wake you can name:"').toBeDefined();
    // The wake list is the first sentence after the colon.
    const wakes = line!.slice(0, line!.indexOf('. ', line!.indexOf(': ')) + 1);
    expect(wakes, 'the wake list lost its last member').toContain('or a structured ask.');
    // Case-insensitive, on word boundaries: a lowercase `monitor` or `bash` is the same dead wait.
    const named = /\b(shell|bash|monitor)\b/i.exec(wakes)?.[1];
    expect(named, `the wake list names ${named}: the wait S3 never woke from`).toBeUndefined();
    expect(line).toContain('A background shell or Monitor is never that wake');
    expect(STALL_WAKE_KINDS, 'stall.ts no longer counts a shell among the kinds that can wake a session')
      .toContain('shell');
    expect(STALL_RESUMING_KINDS, 'stall.ts now reads a shell as resuming the session, which the clause denies')
      .not.toContain('shell');
  });

  it('does not count an agent that may resume on its own as a wake (S4)', () => {
    const line = stopClause();
    expect(line, 'no contract clause opens "End a turn only on a wake you can name:"').toBeDefined();
    expect(line).toContain(
      'an agent whose completion says it may resume on its own has reported, and is not that wake either');
  });
});
```

- [ ] **Step 3: Run the suite to verify it fails**

Run: `cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/worker-skill.test.ts`

Expected: `Tests 6 failed | 40 passed (46)`, measured on the prototype. The six:
- `carries all sixteen clauses verbatim`.
- `numbers exactly as many clauses as the CONTRACT pins, 1..N with no gaps`.
- `spells that same count, as one derived word, everywhere prose states it`: `SKILL.md says fifteen where the CONTRACT
  pins 16`.
- `adds no new clause and no second numbered list`.
- Both new rows: `no contract clause opens "End a turn only on a wake you can name:"`.

- [ ] **Step 4: Add the clause and move the count words**

In `ccd/worker-skill/SKILL.md`:
- Line ≈52: `These fifteen clauses are the boundary` → `These sixteen clauses are the boundary`.
- Line ≈55: `these fifteen lines are pinned verbatim by` → `these sixteen lines are pinned verbatim by`.
- Directly after the line beginning `15. Your wave-done body opens with two signal lines` (≈75), and before the blank
  line that follows it, add this ONE line. It is ASCII only: no apostrophe, no `"`.

```
16. End a turn only on a wake you can name: a mail you sent that asks for an answer, a background agent or workflow you launched from your main thread yourself that has not yet reported, or a structured ask. A background shell or Monitor is never that wake: it has no deadline and may never report. A task a subagent started reports to that subagent, so an agent whose completion says it may resume on its own has reported, and is not that wake either. A restart kills every background task. When none of those holds, mail the coordinator what you did and what wakes you next before the turn ends.
```

In `CLAUDE.md` (≈322): `fifteen clauses pinned by` → `sixteen clauses pinned by`.

In `README.md`, each edit is an in-place swap. No line is added or removed, and each old string is unique in the file
(measured):
- ≈1861: `fifteen clauses pinned by` → `sixteen clauses pinned by`.
- ≈2215: `), fifteen clauses,` → `), sixteen clauses,`.
- ≈2778, the dated R2 changelog line:
  `now carries fifteen clauses (thirteen at R2; routing slice 2 added 14 and 15), pinned verbatim`
  → `now carries sixteen clauses (thirteen at R2; routing slice 2 added 14 and 15, the stall watch added 16), pinned verbatim`.
  Only the count word and the parenthetical's tail change. The rest of that dated line stays as written.

`server/src/coord/stall.ts` is touched ONLY if `N_w ≠ 16`. Then the comment at ≈368
(`or only could have woken it (§5.2 E; a shell, clause 16).`) and the one at ≈374
(`A shell does not (clause 16).`) take `clause <N_w>`.

- [ ] **Step 5: Run the suites to verify they pass**

```bash
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/worker-skill.test.ts
./node_modules/.bin/vitest run test/install-worker-skill.test.ts
./node_modules/.bin/vitest run test/coordinator-skill.test.ts
```

Expected:
- `worker-skill` `Tests 46 passed (46)`; the baseline at `61b280fb` was 44.
- `install-worker-skill` `Tests 11 passed (11)`.
- `coordinator-skill` `Tests 152 passed (152)`. It re-runs because it reads README and CLAUDE.md too.

- [ ] **Step 6: The citation sweep, and the README instrument**

```bash
cd "$(git rev-parse --show-toplevel)"
python3 "$INSTR/cite-sweep.py" worker 76; echo "exit $?"
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'
```

Use 76, the first line the insertion moves, at `61b280fb`. Under the renumber it is the new clause's own line number.

Expected:
- The sweep prints one `SNAPSHOT` line and `exit 0`. The line is
  `docs/superpowers/plans/2026-09-08-crossrepo-wave2-skills-pwa.md:774`, which cites the worker SKILL.md's lines 82 to
  90. That citation was already stale before this wave.
- The instrument prints `Tests 7 passed | 328 skipped (335)`.
- A `LIVE` or `AMBIGUOUS` line is handled as in Task 1 Step 6.

- [ ] **Step 7: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add ccd/worker-skill/SKILL.md server/test/worker-skill.test.ts CLAUDE.md README.md
git commit -m "$(cat <<'MSG'
feat(skills): worker clause 16 — end a turn only on a wake you can name

Stall watch spec 2026-09-29 §6.2, text as approved (§11 decision 13). A
worker ends a turn only on a mail that asks for an answer, a background
agent or workflow it launched from its main thread that has not reported,
or a structured ask. A background shell or Monitor is never that wake (S3),
an agent whose completion says it may resume on its own has reported (S4),
and with no wake it mails the coordinator before the turn ends.

Pinned verbatim; the count word moves 15 -> 16 in SKILL.md (both
statements), CLAUDE.md and README.md's three mentions, and the dated R2
line's parenthetical gains "the stall watch added 16". Two appended rows
hold S3 and S4 through a later rewording, and tie the shell's place to
stall.ts's kind map: it can wake a session and never resumes one.
MSG
)"
```

If the renumber applied, also `git add server/src/coord/stall.ts` and write `<N_w>`/`<W> -> <N_w>`.

- [ ] **Step 8: The mutation table, on the committed tree**

Write `$INSTR/mut-task2.json`, then run `cd "$(git rev-parse --show-toplevel)" && python3 "$INSTR/mutate.py" . "$INSTR/mut-task2.json"`.

```json
[
 {"id":"W1","edits":[{"file":"ccd/worker-skill/SKILL.md","old":"\n16. End a turn only on a wake you can name: a mail you sent that asks for an answer, a background agent or workflow you launched from your main thread yourself that has not yet reported, or a structured ask. A background shell or Monitor is never that wake: it has no deadline and may never report. A task a subagent started reports to that subagent, so an agent whose completion says it may resume on its own has reported, and is not that wake either. A restart kills every background task. When none of those holds, mail the coordinator what you did and what wakes you next before the turn ends.\n","new":"\n"}],"tests":["test/worker-skill.test.ts"]},
 {"id":"W2","edits":[{"file":"ccd/worker-skill/SKILL.md","old":"\n16. End a turn","new":"\nEnd a turn"}],"tests":["test/worker-skill.test.ts"]},
 {"id":"W3","edits":[{"file":"ccd/worker-skill/SKILL.md","old":"\n16. End a turn","new":"\n17. End a turn"}],"tests":["test/worker-skill.test.ts"]},
 {"id":"W4","edits":[{"file":"ccd/worker-skill/SKILL.md","old":"or a structured ask. A background shell","new":"a background shell you started, or a structured ask. A background shell"}],"tests":["test/worker-skill.test.ts"]},
 {"id":"W5","edits":[{"file":"ccd/worker-skill/SKILL.md","old":"or a structured ask. A background shell","new":"a background shell you started, or a structured ask. A background shell"},{"file":"server/test/worker-skill.test.ts","old":"or a structured ask. A background shell","new":"a background shell you started, or a structured ask. A background shell"}],"tests":["test/worker-skill.test.ts"]},
 {"id":"W6","edits":[{"file":"ccd/worker-skill/SKILL.md","old":"A background shell or Monitor is never that wake: it has no deadline and may never report. ","new":""}],"tests":["test/worker-skill.test.ts"]},
 {"id":"W7","edits":[{"file":"ccd/worker-skill/SKILL.md","old":" so an agent whose completion says it may resume on its own has reported, and is not that wake either.","new":" so wait for it."}],"tests":["test/worker-skill.test.ts"]},
 {"id":"W8","edits":[{"file":"server/src/coord/stall.ts","old":"workflow: 'resumes', shell: 'wakes' }","new":"workflow: 'resumes', shell: 'resumes' }"}],"tests":["test/worker-skill.test.ts"]},
 {"id":"W9","edits":[{"file":"ccd/worker-skill/SKILL.md","old":"what wakes you next before the turn ends.\n","new":"what wakes you next before the turn ends\n"}],"tests":["test/worker-skill.test.ts"]},
 {"id":"W10","edits":[{"file":"ccd/worker-skill/SKILL.md","old":"These sixteen clauses are the boundary","new":"These fifteen clauses are the boundary"}],"tests":["test/worker-skill.test.ts"]},
 {"id":"W11","edits":[{"file":"ccd/worker-skill/SKILL.md","old":"these sixteen lines are pinned verbatim by","new":"these fifteen lines are pinned verbatim by"}],"tests":["test/worker-skill.test.ts"]},
 {"id":"W12","edits":[{"file":"CLAUDE.md","old":"`ccrc-worker`, sixteen clauses pinned by","new":"`ccrc-worker`, fifteen clauses pinned by"}],"tests":["test/worker-skill.test.ts"]},
 {"id":"W13","edits":[{"file":"README.md","old":"(`ccd/worker-skill/SKILL.md`, sixteen clauses pinned by","new":"(`ccd/worker-skill/SKILL.md`, fifteen clauses pinned by"}],"tests":["test/worker-skill.test.ts"]},
 {"id":"W14","edits":[{"file":"README.md","old":"(`ccd/worker-skill/SKILL.md`), sixteen clauses,","new":"(`ccd/worker-skill/SKILL.md`), fifteen clauses,"}],"tests":["test/worker-skill.test.ts"]},
 {"id":"W15","edits":[{"file":"README.md","old":"`ccd/worker-skill/SKILL.md` now carries sixteen clauses (","new":"`ccd/worker-skill/SKILL.md` now carries fifteen clauses ("}],"tests":["test/worker-skill.test.ts"]},
 {"id":"W16","edits":[{"file":"ccd/worker-skill/SKILL.md","old":"or a structured ask. A background shell","new":"a Bash you backgrounded, or a structured ask. A background shell"},{"file":"server/test/worker-skill.test.ts","old":"or a structured ask. A background shell","new":"a Bash you backgrounded, or a structured ask. A background shell"}],"tests":["test/worker-skill.test.ts"]},
 {"id":"W17","edits":[{"file":"ccd/worker-skill/SKILL.md","old":"or a structured ask. A background shell","new":"a Monitor you armed, or a structured ask. A background shell"},{"file":"server/test/worker-skill.test.ts","old":"or a structured ask. A background shell","new":"a Monitor you armed, or a structured ask. A background shell"}],"tests":["test/worker-skill.test.ts"]},
 {"id":"W18","edits":[{"file":"ccd/worker-skill/SKILL.md","old":"or a structured ask. A background shell","new":"a monitor you armed, or a structured ask. A background shell"},{"file":"server/test/worker-skill.test.ts","old":"or a structured ask. A background shell","new":"a monitor you armed, or a structured ask. A background shell"}],"tests":["test/worker-skill.test.ts"]},
 {"id":"W19","edits":[{"file":"server/src/coord/stall.ts","old":"export const STALL_WAKE_KINDS: readonly string[] = Object.keys(STALL_BG_KIND_MAP);","new":"export const STALL_WAKE_KINDS: readonly string[] = Object.keys(STALL_BG_KIND_MAP).filter((k) => k !== 'shell');"}],"tests":["test/worker-skill.test.ts"]},
 {"id":"W20","edits":[{"file":"ccd/worker-skill/SKILL.md","old":"a mail you sent that asks for an answer, a background agent","new":"a mail you sent that asks for an answer. Also a background agent"},{"file":"server/test/worker-skill.test.ts","old":"a mail you sent that asks for an answer, a background agent","new":"a mail you sent that asks for an answer. Also a background agent"}],"tests":["test/worker-skill.test.ts"]},
 {"id":"W21","edits":[{"file":"ccd/worker-skill/SKILL.md","old":" so an agent whose completion says it may resume on its own has reported, and is not that wake either.","new":" so wait for it."},{"file":"server/test/worker-skill.test.ts","old":" so an agent whose completion says it may resume on its own has reported, and is not that wake either.","new":" so wait for it."}],"tests":["test/worker-skill.test.ts"]}
]
```

The control is Step 5's green: 46 passed on the unmutated commit.

Expected reds, measured on the prototype. "S3" and "S4" are the two new rows, "no-new" is `adds no new clause and no
second numbered list`, and "numbering" is `numbers exactly as many clauses…`.

| # | What it breaks | Expected (measured) |
|---|---|---|
| W1 | the clause line deleted | `5 failed`: verbatim, numbering, no-new, S3, S4 |
| W2 | the clause unnumbered | `4 failed`: numbering, no-new, S3, S4 |
| W3 | the clause numbered 17 | `2 failed`: numbering, no-new |
| W4 | a background shell added to the wake list in SKILL.md | `2 failed`: verbatim, S3 |
| W5 | the same, in SKILL.md AND the `CONTRACT` literal (verbatim stays green) | `1 failed`: S3 |
| W6 | the "never that wake" sentence dropped | `2 failed`: verbatim, S3 |
| W7 | the S4 sentence reduced to "so wait for it" | `2 failed`: verbatim, S4 |
| W8 | `stall.ts` makes a shell resuming | `1 failed`: S3 |
| W9 | the clause's final period dropped | `1 failed`: verbatim |
| W10 | `These … clauses` reverted | `1 failed`: count word |
| W11 | `these … lines` reverted | `1 failed`: count word |
| W12 | CLAUDE.md reverted | `1 failed`: count word |
| W13 | README ≈1861 reverted | `1 failed`: count word |
| W14 | README ≈2215 reverted | `1 failed`: count word |
| W15 | README ≈2778's count word reverted | `1 failed`: count word |
| W16 | a `Bash` added to the wake list in SKILL.md AND the `CONTRACT` literal | `1 failed`: S3 |
| W17 | a `Monitor` added the same way | `1 failed`: S3 |
| W18 | a lowercase `monitor` added the same way (the case-insensitive match) | `1 failed`: S3 |
| W19 | `stall.ts`'s `STALL_WAKE_KINDS` stops counting a shell | `1 failed`: S3 |
| W20 | the wake list's sentence broken early, in both files, so the scan would read a fragment | `1 failed`: S3 (the `or a structured ask.` boundary) |
| W21 | the S4 sentence reduced to "so wait for it", in both files | `1 failed`: S4 |

The runner must end with `tree clean after restore`. Paste its output into the wave-done mail.

---

### Task 3: The continuity amendment, and the whole gate

**Model routing:** `sonnet`, effort `medium`: one sentence of spec prose, then the gate.

**Files:**
- Modify: `docs/superpowers/specs/2026-09-23-session-continuity-design.md` §5.3, the **Not-stalled restarts**
  paragraph (≈351-354).

**Interfaces:**
- Consumes: Tasks 1–2's commits.
- Produces: the amended paragraph and the measured gate for the wave-done mail.

- [ ] **Step 1: Amend the sentence (spec §6.3, restated as shipped: ruling R5, `continuity-amendment-states-the-arm` (D-3793))**

Replace these two lines (≈353-354):

```
turn, the counts reach the phone (stage 5), and nothing types. §9 counts stalled and not-stalled restarts with a
non-empty manifest separately.
```

with these six:

```
turn, the counts reach the phone (stage 5), and nothing types at spawn. If the restart orphaned in-flight work (the
marker's `lostBg`) and no turn has run since, the server's stall watch mails the session itself once, after its live
status has read idle (or `shell`, idle over a background shell) unchanged for 15 minutes, within 24 hours of the
restart; that mail needs `stall-watch-live` and `stall-watch-w2-live` both armed. If it is still unacked 30 minutes
after its delivery (or still undelivered 30 minutes after it was queued), the operator is pushed once, which also
needs `stall-watch-escalate`. §9 counts stalled and not-stalled restarts with a non-empty manifest separately.
```

The paragraph keeps its two earlier lines. The new lines are 115, 116, 112, 115, 113 and 110 columns, inside the file's ≈118-column wrap. Each clause is measured against `server/src/coord/stall.ts` at `61b280fb`:
- "no turn has run since": `stallOrphanDCandidate` requires the current marker to read `done` with
  `restartAt > stopAt`.
- "once": rung 1 is keyed on `restartAt`.
- "idle (or `shell`) unchanged for 15 minutes": `isIdleWord`, and `now - live.since >= ORPHAN_D_IDLE_MS`, where
  `since` is the live file's `statusUpdatedAt`, so an `idle`↔`shell` flip restarts the clock.
- "within 24 hours": `now - restartAt > BACKLOG_HORIZON_MS` answers none.
- "both armed": `stallNotifyDelivery` makes a wave-2 arm shadow without `w2Live`, then `stallDelivery('worker')` needs
  `live`.
- "still unacked 30 minutes after its delivery (or still undelivered 30 minutes after it was queued)": rung 2 reads the
  session's newest delivery of that mail, answers none when it is acked, and fires at
  `now - (deliveredAt ?? queuedAt) >= ORPHAN_PUSH_MS` (30 min).
- "pushed once": a run worker's rung 2 is recorded on its run. A run-less session's push is latched in memory as
  `orphaned-<toId>-<restartAt>`, so a server restart inside the window may push once more, under the same collapsing
  tag.
- "also needs `stall-watch-escalate`": `stallDelivery('operator')` needs `live` and `escalate`, behind the same `w2Live`
  gate. `mail-disabled` holds the mail, but not the push.
- No test reads this file: measured, `git grep` finds no `session-continuity-design.md:<n>` citation and no suite that
  opens it.
- The four added lines shift nothing anyone cites.
- The new text carries no `D-<n>` token, so it cannot raise the ledger floor.

- [ ] **Step 2: Run the whole gate, each file alone, in the foreground**

```bash
cd "$(git rev-parse --show-toplevel)"
git fetch origin main
cd server
for f in coordinator-skill worker-skill reviewer-skill routing-references box-token-census single-definition \
         topology-clean deviation-refs stall-vocabulary stall-bodies crossrepo-prose readme-holds \
         install-coordinator-skill install-worker-skill child-reclaim-prose child-reclaim-refusals ccrc-api; do
  printf '%s: ' "$f"; ./node_modules/.bin/vitest run "test/$f.test.ts" 2>&1 | grep -E '^ +Tests '
done
./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus' | grep -E '^ +Tests '
```

Then run `typecheck-tests` on its own, as a separate foreground command with its own 600000 ms timeout. It spawns `tsc`
over the server, agent and pwa test projects and took about 3 minutes here; it is a known load flake.

```bash
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts | grep -E '^ +Tests '
```

Expected:

| Suite | Before (`61b280fb`) | After this wave |
|---|---|---|
| coordinator-skill | 150 passed | 152 passed |
| worker-skill | 44 passed | 46 passed |
| reviewer-skill | 13 | 13 |
| routing-references | 11 | 11 |
| box-token-census | 23 | 23 |
| single-definition | 259 | 259 |
| topology-clean | 55 | 55 |
| deviation-refs | 31 | 31 |
| stall-vocabulary | 178 | 178 |
| stall-bodies | 152 | 152 |
| crossrepo-prose | 17 | 17 |
| readme-holds | 16 | 16 |
| install-coordinator-skill | 16 | 16 |
| install-worker-skill | 11 | 11 |
| child-reclaim-prose | 4 | 4 |
| child-reclaim-refusals | 20 | 20 |
| ccrc-api | 96 | 96 |
| typecheck-tests | 12 | 12 |
| session-hook (filtered) | 7 passed, 328 skipped (335) | 7 passed, 328 skipped (335) |

Notes on these suites:
- **They read README.md or CLAUDE.md, or pin a skill:** `reviewer-skill` (the same path-and-count scan),
  `box-token-census` (CLAUDE.md's coordination bullets and README's auth, mail-bus and caps paragraphs; none contains a
  line this wave edits), `crossrepo-prose`, `readme-holds` and `topology-clean` (the whole tracked tree).
- **`child-reclaim-prose`** reads CLAUDE.md's SAFETY bullet and a README paragraph. **`child-reclaim-refusals`**
  reads the coordinator SKILL.md's step 6. **`ccrc-api`** extracts the identity block from both SKILL.md files.
- **`typecheck-tests`** is the only gate that compiles the two new describes.
- **They read `stall.ts`, whose exports two of this wave's suites now import:** `single-definition`,
  `stall-vocabulary` and `stall-bodies` (the r2 body's own protocol).
- **`deviation-refs`** compares this branch's plan ledgers against `origin/main`, so it needs the fetch above.
- **A red file is re-run alone first.** The rest were measured on a scratch copy carrying all three tasks' edits. Two
  exceptions:
  - `deviation-refs` was measured on the real tree alone, because it reads git history the copy does not have.
  - `typecheck-tests` read 11 of 12 on the copy. Its one red is `PWA_TSC really is pwa's own installed compiler`, an
    artifact of the copy's symlinked `pwa/node_modules`. Its server-tests project, which compiles both new describes,
    was clean. On the real tree it reads 12 passed.

- [ ] **Step 3: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add docs/superpowers/specs/2026-09-23-session-continuity-design.md
git commit -m "$(cat <<'MSG'
docs(continuity): a not-stalled restart that orphaned work draws one stall-watch mail

Stall watch spec 2026-09-29 §6.3, restated as shipped: the session-continuity
spec's §5 "Not-stalled restarts" said "nothing types". Nothing types at
spawn; when the restart orphaned in-flight work (the turn marker's lostBg)
and no turn has run since, the stall watch mails the session itself once,
after its live status has read idle or shell unchanged for 15 minutes,
within 24 hours of the restart, and only with stall-watch-live and
stall-watch-w2-live both armed. If that mail stays unacked 30 minutes after
delivery, the operator is pushed once, which also needs stall-watch-escalate.
MSG
)"
```

Then `git status --porcelain` prints nothing, and `git log --oneline origin/main..HEAD` lists this wave's three
commits, plus a merge commit only if Task 1 Step 1 absorbed `main`.

---

## If this PR is overtaken before it merges

Another programme can merge a coordinator or worker clause after this wave's commits. Then this PR conflicts at the
same insertion points: the line after the last numbered clause, and the `CONTRACT` array's `];`. Resolve it with
`git merge origin/main`, never a rebase:
- Keep the other programme's clause.
- Place this wave's clause after it.
- Apply Task 1 Step 1's renumber table in the merge commit, the stall.ts comment row included. This is spec §10's
  "whichever programme lands second moves the count words and pins in the same commit".
- Re-run Task 1 Step 5, Task 2 Step 5 and Task 3 Step 2.

**A clause that landed first can contradict this wave's.** Session-continuity's planned stage-5 worker clause tells
workers to wait on CI or a deploy with the Monitor tool, while this wave's worker clause says a Monitor is never a wake
to end a turn on. If a clause that landed first, whether found here or at Task 1 Step 1, tells workers to wait with the
Monitor tool:
- stop before renumbering;
- name the conflict by slug in the wave-done mail, for example `monitor-wait-conflict`, quoting both clauses;
- never ship two contradictory clauses by mechanical renumbering. The coordinator rules on the text first.

## After the merge (orchestrator, read-only)

The release lane carries the skills: `ccrc update`'s `_inst_skills`, on every rostered home. Nothing in this wave
rolls a box by hand.
1. Wait until the fleet box's `ccrc version` names a release that contains this wave's merge commit.
2. On that box, run `ccrc doctor`, never `--fix` from here. Its `skills` line reads `N/N homes carry the shipped
   ccrc-coordinator, ccrc-worker and ccrc-reviewer`.
3. A FAIL there names the stale homes, and curing them is the operator's call.
4. Until every home passes, a coordinator may repeat the worker clause's first sentence in its briefs. That is spec
   §6.2's branch-discipline precedent. The watch does not depend on either clause, because its mail bodies carry their
   own protocol.

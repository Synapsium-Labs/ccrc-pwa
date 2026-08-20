# The worker protocol becomes a mechanism — `ccrc-worker` skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dispatched program worker loads its standing protocol from a shipped, verbatim-pinned skill (`ccrc-worker`) instead of per-brief prose — the branch discipline, mail etiquette, ask envelopes, fingerprint rules and destructive-verb ban become a mechanism the dispatch path invokes by name — while the coordinator's brief shrinks to wave specifics.

**Architecture:** `ccd/worker-skill/SKILL.md` mirrors the coordinator skill's exact shape (two-key frontmatter, an identity recipe, a numbered CONTRACT of clauses pinned verbatim by `server/test/worker-skill.test.ts` with the census-equality rule over five destructive verbs). It ships the coordinator's way — deploy stages to `~/.cc-sessions/worker-skill/`, `ccd/install-worker-skill.sh` converges it into every rostered account's `<config dir>/skills/ccrc-worker/` (skills resolve per CLAUDE_CONFIG_DIR; the account drifts on swap, the id does not). The dispatch route composes a SERVER-SIDE PREFIX onto the wave-brief mail body — `Run the ccrc-worker skill; it is your standing protocol. Your wave brief follows.` — because dispatch writes nothing to a wave-1 pane (the brief travels as mail; `run-routes.test.ts:606` pins zero send-keys on wave 1) and skills are invoked BY NAME (the PWA coordinator kickoff at `StartProgramSheet.tsx:65-68` is the idiom). The 8KiB `oversize` check moves to measure the COMPOSED body. `ccrc install` gains `_inst_skills` (both skills — the coordinator skill is deploy-only today, an asymmetry this slice closes) after `_inst_dirs`, running the INSTALLED installers with `CCRC_SKILL_SRC` pointed at the ~/.cc-sessions staging copy (the box's own bytes; pointing it at the placed tree is exactly the mutation the installed-copy pin reds). The coordinator's re-typed protocol paragraphs trim LAST (SKILL.md step-2 template + wave-lifecycle.md:122-137's "The brief must say" block), so older-style briefs stay self-sufficient throughout the transition.

**Tech Stack:** markdown skill + bash installer, TypeScript (dispatch prefix), vitest.

## Global Constraints

- **ZERO `ccd/ccd` edits.** Per-worker RC (orchestrator task #37) stays OPEN — a clause states the current per-box behavior and names the open ruling; no spawn-path mechanism ships here.
- **Verbatim-pin discipline:** the worker CONTRACT is a literal string array; the census rule is exact equality per destructive verb (`ws-rm`, `ws-reap`, `ws-gc`, `ws-archive`, `ws-restore`) between the whole skill corpus and the forbidding clause's own count — copy `coordinator-skill.test.ts:56-95`'s mechanics, including the no-weaker-duplicate-census doctrine.
- **Dispatch-path pins that must stay green:** zero send-keys on wave 1 (`run-routes.test.ts:606`); exactly ONE due delivery per dispatch (:608-615 — the prefix rides the SAME mail, never a second); `briefQueued:false` suppression (:553-586 — no prefix mail when /clear was refused); the wave-≥2 sequence (:532-551). The composed-body oversize accounting gets its own red-first test (a brief within 8KiB whose composed form exceeds it → `oversize`).
- **Installer parity:** `install-worker-skill.sh` copies `install-coordinator-skill.sh`'s fail-closed guards (REQUIRED_REFS per its own reference set — or an explicit empty list with the reason), inode convergence, backup+rollback, per-home isolation. Its test copies `install-coordinator-skill.test.ts`'s shape (byte equality with the repo tree, absent-home stays absent, broken-home continues).
- **Deploy text pins:** the new deploy block mirrors deploy.sh:482-485; `install-coordinator-skill.test.ts` locates the coordinator rsync by the FIRST line containing `coordinator-skill/` — the worker block's token is `worker-skill/` and no comment may spell either token above its real line; the "FIFTH artifact" count comment updates.
- **`ccrc install` spine pin:** `server/test/ccrc-install.test.ts:1442-1481` pins the step list — `_inst_skills` is a pinned-list edit in the same commit; it sits AFTER `_inst_dirs` (the installers skip absent homes) and runs the INSTALLED copies from `~/.cc-sessions/` (the `_inst_hooks` doctrine).
- **Trim-last ordering:** the coordinator-skill trim is the FINAL task; every earlier task leaves the coordinator's own pinned strings untouched (`coordinator-skill.test.ts` pins "frozen for the life of the claim" :110-118, "fixed at dispatch" :352, ledger-template byte-identity :355-361 — the trim edits around them or updates the pins in the same commit).
- Fixture HOMEs only; red-first with measured mutations; foreground vitest, never npx, never backgrounded; all three suites green before done.

## The CONTRACT (draft — Task 1 finalizes wording; content locked here)

1. Identity: derive `fromId` from `tmux display-message -p '#S'` (`cc-<id>`) and `fromUuid` from `$REG/<id>.uuid` on EVERY call — `/clear` rotates the uuid, and dispatch /clears you on every wave ≥ 2; a cached uuid is guaranteed stale.
2. Commit on THIS workspace's own branch (`ws/<slug>`), never a new feature branch — the done-fingerprint re-measures the workspace branch tip; a feature branch wedges every close `stale-tip` forever (F5; the server's own `stale-tip` detail says so — fingerprint.ts:218-230).
3. Ack before acting, by DELIVERY id, never the mail row's id — an unacked nudge replays; the budget is 6 attempts and then your brief parks unread. Reply to the coordinator through mail (`toId:'coordinator'`), never by typing into your own pane.
4. Keep your input box empty — a half-typed draft makes the delivery lane refuse `draft-present`; only you can clear your own text, and a parked delivery means your brief was never read.
5. Operator questions ride the AskUserQuestion tool (the structured ask the hook captures and the PWA surfaces), not free text.
6. Your requirements are the brief plus the plan file it names, including its deviation ledger; the plan's text governs over your recollection of the spec. Invoke the execution skill the brief names rather than improvising.
7. Large payloads travel as files + an absolute path in the mail's `artifacts` (relative paths refuse `bad-kind`) — never ask for content to be pasted into your pane (F7).
8. Never run `ws-rm`, `ws-reap`, `ws-gc`, `ws-archive` or `ws-restore` — your workspace's lifecycle belongs to ccd and the human.
9. A done-claim's fingerprint is measured ONCE and sent ONCE: `handoffCommit` must equal the branch tip you measured, `prPhase` is one of the eight enum words, and after `wave-done` you stop pushing — new commits under your own claim make it stale. Never re-assert a rejected claim without new commits and a fresh measurement.
10. Remote-control: your pane's RC state is the BOX's (`~/.ccrc/remote-control`), not yours to change; the per-worker ruling (task #37) is open — do not toggle the box flag.

## File structure

- Create: `ccd/worker-skill/SKILL.md`, `ccd/install-worker-skill.sh`, `server/test/worker-skill.test.ts`, `server/test/install-worker-skill.test.ts`
- Modify: `server/src/coord/dispatch.ts` (+ its tests), `deploy/deploy.sh`, `ccd/ccrc` (`_inst_skills`), `server/test/ccrc-install.test.ts` (spine pin), `ccd/coordinator-skill/SKILL.md` + `references/wave-lifecycle.md` + `server/test/coordinator-skill.test.ts` (the trim, LAST), `docs/superpowers/specs/2026-08-19-stage2-vm-gate-runbook.md` (skills step), `CLAUDE.md`, `README.md`

---

### Task 1: The skill and its verbatim pin

**Files:** Create `ccd/worker-skill/SKILL.md`, `server/test/worker-skill.test.ts`.

**Decision locked:** NO `references/` directory of its own — the skill POINTS (by relative-path prose, the coordinator idiom) at `../ccrc-coordinator/references/wave-lifecycle.md` and `mail-envelope.md` for the deep protocol, because both skills install side by side under `<cfg>/skills/` and duplicating 35KB of references would create an untested second copy of pinned content. The installer guard (Task 2) checks SKILL.md alone.

- [ ] **Step 1: RED** — write `worker-skill.test.ts` first, copying `coordinator-skill.test.ts:56-95`'s mechanics: `CONTRACT` literal array holding the ten clauses from this plan's CONTRACT section (Task 1 finalizes exact sentences; the semantic content of each clause is LOCKED above — a reviewer judges wording, not content); the frontmatter triple (`name: ccrc-worker`, a description whose anti-use sentence is "Never use it to coordinate a program — a worker that starts dispatching has become a coordinator without a ledger", pinned lowercase-contains); the id-recipe pin (`tmux display-message -p '#S'`); the census equality over ALL FIVE destructive verbs (`ws-rm`, `ws-reap`, `ws-gc`, `ws-archive`, `ws-restore`) against the forbidding clause's own counts, corpus = SKILL.md alone. Red: the file does not exist.
- [ ] **Step 2: GREEN** — write SKILL.md: frontmatter; "you are a dispatched wave worker" identity + the id/uuid recipe (adapted from coordinator SKILL.md:27-48, noting /clear rotates the uuid); the CONTRACT clauses; a short "how to call the API" section REUSING the coordinator's rules by pointer (`../ccrc-coordinator/references/…` — read before your first mail); the wave-done fingerprint mini-table (branchTip/prNumber/prPhase-enum/handoffCommit with the eight prPhase words spelled); "when something is wrong" bullets (parked delivery, stale-tip on close, dialog stuck).
- [ ] **Step 3: Mutations** — plant an extra `ws-reap` mention in a prose paragraph → census red; paraphrase clause 2 → its pin red. Record both; restore.
- [ ] **Step 4: Commit** `feat(skill): ccrc-worker — the worker protocol is a mechanism, pinned verbatim`

### Task 2: The installer and its test

**Files:** Create `ccd/install-worker-skill.sh`, `server/test/install-worker-skill.test.ts`.

- [ ] **Step 1: RED** — test first, copying `install-coordinator-skill.test.ts`'s shape: installed tree byte-equal to the repo's `ccd/worker-skill/`; inode-stable on re-run; absent home stays absent; one broken home does not stop the rest; `CCRC_SKILL_SRC` override honored.
- [ ] **Step 2: GREEN** — clone `install-coordinator-skill.sh` with `NAME=ccrc-worker`, `SRC="${CCRC_SKILL_SRC:-$HOME/.cc-sessions/worker-skill}"`, `REQUIRED_REFS=()` REPLACED by a `REQUIRED_FILES=(SKILL.md)` guard (comment: this skill carries no references of its own — it points at the coordinator's; an empty-refs clone of the coordinator guard would be a lie about why). Everything else parity: fail-closed, diff -r -q converge, backup+rollback, per-home rc=1-continue.
- [ ] **Step 3: Mutation** — break one home's skills dir permissions → that home fails, the next still converges (the per-home test); record. Commit `feat(skill): install-worker-skill converges every rostered home, coordinator-style`

### Task 3: The dispatch prefix

**Files:** Modify `server/src/coord/dispatch.ts`; tests in `server/test/run-routes.test.ts` (+ the oversize accounting case wherever the oversize test lives today).

- [ ] **Step 1: RED** — three tests: (a) the ONE due delivery's envelope body begins with the kickoff prefix and still contains the coordinator's brief verbatim after it; (b) a brief that fits 8KiB alone but whose COMPOSED body exceeds it → `oversize` (red today: the check measures the raw brief at dispatch.ts:119); (c) the briefQueued:false path queues NO mail (existing pin — assert it still holds with the prefix code present, i.e. the prefix never becomes its own mail).
- [ ] **Step 2: GREEN** —
```ts
// The worker kickoff rides the brief mail itself: dispatch writes nothing to a
// wave-1 pane (the zero-send-keys pin), and skills are invoked BY NAME (the
// coordinator kickoff idiom, StartProgramSheet.kickoff). One constant, one place.
export const WORKER_KICKOFF_PREFIX =
  "Run the ccrc-worker skill — it is your standing protocol; read it before acting on anything below.\n\n";
```
  Compose `const body = WORKER_KICKOFF_PREFIX + brief;` immediately after the brief-shape validation; MOVE the `Buffer.byteLength` oversize check onto `body` (the refusal's `detail` still reports the operator-meaningful numbers: brief bytes + prefix bytes vs the cap); `queueSystemMail(..., body)`. The zero-send-keys and one-delivery pins stay green untouched.
- [ ] **Step 3: Mutations** — drop the prefix from composition → test (a) red; restore the oversize check to raw `brief` → test (b) red. Record. Commit `feat(coord): dispatch hands every worker its protocol by name, inside the brief mail`

### Task 4: Ship it — deploy and `ccrc install`

**Files:** Modify `deploy/deploy.sh`, `ccd/ccrc`, `server/test/ccrc-install.test.ts`, `agent/test/deploy-verify.test.ts` (or the skill-installer test for the ordering pin), `docs/superpowers/specs/2026-08-19-stage2-vm-gate-runbook.md`.

- [ ] **Step 1: RED+GREEN, deploy** — mirror deploy.sh:482-485 with `worker-skill` tokens (mkdir staging, rsync --delete, install_atomic the installer, run it), placed immediately after the coordinator block; update the artifact-count comment at :471-476. Pin: a new test (in `install-worker-skill.test.ts`, the coordinator suite's :207-228 idiom) locating the rsync by the FIRST line containing `worker-skill/` and requiring `--delete` + ordering after the coordinator run. NO comment may spell either skill-dir token above its real line.
- [ ] **Step 2: RED+GREEN, install** — `_inst_skills` in `ccd/ccrc`, wired AFTER `_inst_dirs`, BEFORE `_inst_hooks`... placement decision: beside `_inst_hooks` (both run installed converge scripts). It: places both skill trees into `~/.cc-sessions/{coordinator-skill,worker-skill}` from `$BOX_TREE_DIR/ccd/` (cp -a via a small `_inst_tree_copy` helper — `_inst_atomic` is single-file), places both installers 755, then runs each INSTALLED installer (`_inst_hooks` doctrine). This closes the asymmetry: a self-installed box now has BOTH skills. Spine pin at ccrc-install.test.ts:1442-1481 updated in the same commit; new tests: both skills land per rostered config dir on a fresh box; re-run inode-stable; runbook gains the skills step + the preflight `ls` line (README:451-452's form, now naming both).
- [ ] **Step 3: Mutations** — remove `_inst_skills` from the spine → pinned-list red; move the deploy worker block above the coordinator's → ordering red. Record. Commit `feat(install,deploy): both skills ship both ways — the coordinator-only asymmetry closes`

### Task 5: The coordinator trim (LAST, deliberately)

**Files:** Modify `ccd/coordinator-skill/SKILL.md` (step-2 template), `ccd/coordinator-skill/references/wave-lifecycle.md` (:122-137), `server/test/coordinator-skill.test.ts` (pins for the edited region), `CLAUDE.md` + `README.md` (the coordinator paragraphs + preflight).

- [x] **Step 1** — rewrite the "The brief must say" block: the standing protocol now loads mechanically (dispatch's prefix + the ccrc-worker skill); the brief carries WAVE SPECIFICS (plan path, task range, interfaces, deviations); the branch-discipline sentence REMAINS as one line ("the skill says it; say it again — it is the one sentence that keeps the wave closeable") — belt and braces, not deletion, because pre-skill workers may still exist mid-transition. Reconcile clause 5's wording. Preserve the pinned strings ("frozen for the life of the claim", "fixed at dispatch", ledger-template byte-identity) or update their pins in the same commit.
- [x] **Step 2** — CLAUDE.md's coordinator bullet gains the worker-skill sentence; README's program section + preflight updated (both skills). Run the full coordinator-skill + worker-skill suites; mutation: restore the old re-typed paragraph → the updated pin red (the test must pin the NEW delegating sentence). Commit `feat(skill): the coordinator delegates the standing protocol and keeps the one load-bearing sentence`

### Task 6: Close-out

- [x] Ledger (D-10x entries as found); the per-worker-RC note (still open, now with its destination existing — a clause states the box-level fact); full three suites foreground; commit `docs(skill): worker-skill slice closes — the protocol is a mechanism`


### Follow-ups from the whole-branch final review (2026-08-20, verdict CLEAN)

- **Pending live proof (honesty):** no program has RUN with the worker skill — the first real
  dispatch is this branch's analogue of the install runbook's VM gate. Not claimed; the first
  coordinated program after this merges is the measurement.
- **-> next skill-suite touch:** clause 2's re-measure claim gets a source harvest (the doctrine:
  a verbatim pin guards drift, not wrongness); the eight-code "every mail-route refusal" list gets
  a union scan against MAIL_REJECT_CODES' ingress subset (a ninth code makes "every" silently false).
- **-> next install-lane slice:** the T4 stray-temp comment claims a sweep that does not exist
  (_inst_atomic's is file-scoped; kill-mid-copy strays under <cfg>/skills/ swept by nothing —
  same exposure predates this branch in the coordinator installer); comment fix + glob sweeps.
- **-> coordinator-suite hygiene:** the list-window pin's end-marker fallback silently widens to
  EOF (slice(start,-1)); one-line end > start guard.

## Deviations found

(Next free number at plan time: D-103.)

**D-103 — the census corpus ("SKILL.md alone") ships as a GUARD, and two pins are DERIVED from the source of truth rather than from the plan's own list.** (Task 1, `server/test/worker-skill.test.ts`.)

The plan's Step 1 named four pins (CONTRACT array, frontmatter triple, id recipe, five-verb census) and stated "corpus = SKILL.md alone" as a property of the decision above it — a sentence, not a mechanism. Three additions shipped, each because the thing it guards is invisible to the four:

- **`carries no references of its own`** — `readdirSync(ccd/worker-skill)` must equal exactly `['SKILL.md']`, plus both `../ccrc-coordinator/references/*.md` pointers must resolve to real files in the repo. Without it, the day someone adds a `references/` directory here the census quietly stops covering part of the skill it claims to cover, and the locked no-duplicate-references decision becomes a comment in a plan nobody re-reads. It is also the assertion Task 2's `REQUIRED_FILES=(SKILL.md)` installer guard is honest about. *Measured: planting `references/wave-lifecycle.md` → red.*
- **the eight `PrPhase` words, derived from `Record<PrPhase,true>`** (`prphase.test.ts`'s idiom — `PR_PHASES` stays module-private). NOT a weaker duplicate of the clause-9 literal: the literal can only red for an edit a human is already making to that sentence, while this reds when the UNION grows and the skill still promises eight. *Measured: a planted ninth phase → red on the count, and on the word once the count is relaxed.*
- **the delivery budget, derived from `MAIL_MAX_ATTEMPTS`** rather than typed as a 6. *Measured: `MAIL_MAX_ATTEMPTS = 8` → red naming clause 3's "6 attempts".*

The two plan-mandated mutations were measured as specified: an extra `ws-reap` in a "when something is wrong" bullet → census red (`ws-reap appears 2×; only the forbidding clause may name it`); clause 2 paraphrased ("Always commit on this workspace's very own branch…") → `carries all ten clauses verbatim` red. Suite: 7 tests, green.

**D-104 — the worker skill is written with STRAIGHT apostrophes, and its CONTRACT literals are double-quoted.** (Task 1, `ccd/worker-skill/SKILL.md` + its test.)

`coordinator-skill.test.ts`'s literals carry curly apostrophes (`operator’s`, `session’s`) because its prose does; a straight/curly mismatch between the two files is a verbatim-pin failure that reads like a mystery, and it is one an editor introduces by typing normally. The mirror suite avoids the class rather than documenting it: SKILL.md uses `'` everywhere, so no clause literal needs an escape for it. The literals are then double-quoted (the sibling's are single-quoted) because clause 1 quotes `tmux display-message -p '#S'` and clause 3 quotes `toId:'coordinator'` — with single-quoted TS strings, the two clauses most worth copy-pasting out of SKILL.md would be the two that need hand-escaping. Consequence for every later task: **no clause in this skill may contain a `"` character**, and a curly apostrophe pasted into SKILL.md reds the CONTRACT pin without looking like a change.

**D-105 — clause 3's locked content conflated the two delivery lanes: the 6 is the PRE-DELIVERY budget, and a delivered-but-unacked nudge has a ceiling of its own.** (Task 1 fix round 1, review finding F-1; `ccd/worker-skill/SKILL.md` clause 3 + `server/test/worker-skill.test.ts`.)

This plan's CONTRACT (`:26`) locked clause 3 as *"an unacked nudge replays; the budget is 6 attempts and then your brief parks unread"*, and Task 1 shipped it verbatim as instructed. The number is real — `MAIL_MAX_ATTEMPTS = 6`, `shared/api.ts:2442` — but it is attached to the wrong lane, and the review measured it in the delivery code:

- `MAIL_MAX_ATTEMPTS` is the **pre-delivery** budget only. Its own docstring says so at length (`server/src/watch.ts:160-176`: *"applies ONLY while a delivery's own `deliveredAt` is still null"*), and the park is gated on `d.deliveredAt === null` (`watch.ts:2042`). That is the `draft-present` lane — a row the lane could never type into anyone's box.
- A delivery that DID land and is merely never acked replays against a **separate** counter, `MAIL_REPLAY_MAX_ATTEMPTS = 20` (`watch.ts:207`; park at `:1981-1983`), roughly three hours at `MAIL_REPLAY_MS` spacing. The two counters exist separately on purpose — the same docstring records that before the second one existed, an unacked delivery replayed unbounded.
- So both halves of the locked sentence were wrong for the lane it describes: the budget is 20, not 6, and the brief was **read**, not "parked unread".

Harm was low and conservative (it under-states the ack window, so a worker following it acks sooner), but a skill whose whole thesis is that its facts check out cannot carry a fact that does not. Note the two references the worker is pointed at deliberately give this path **no number at all** ("a bounded number of attempts" — `mail-envelope.md:34-42`, `wave-lifecycle.md:196-204`); this skill is the only place in the corpus that puts figures on it, which is why both figures are now pinned rather than merely stated.

**What shipped:** clause 3's first sentence now carries both lanes in one breath and names the constant that owns each number — *"a brief that never landed retries `MAIL_MAX_ATTEMPTS` (6) times and then parks unread, while a delivered nudge you leave unacked replays `MAIL_REPLAY_MAX_ATTEMPTS` (20) times and then parks read-but-unanswered."* The worker instruction is unchanged in spirit: ack promptly, by DELIVERY id. The `draft-present` troubleshooting bullet keeps its "after 6 attempts" untouched — that lane is never-delivered, so 6 is correct there, and it is what still satisfies the `MAIL_MAX_ATTEMPTS`-derived pin.

**Both numbers are now mechanisms, not prose.** A new test (`names BOTH delivery ceilings…`) requires the literal `` `MAIL_MAX_ATTEMPTS` (6) `` and `` `MAIL_REPLAY_MAX_ATTEMPTS` (20) `` forms, with 6 taken from the exported constant and 20 HARVESTED from `watch.ts`'s source text — that constant is module-private and re-exporting it for a test's convenience is the hole `PR_PHASES`' docstring warns about, so the harvest throws at module scope if it is ever renamed rather than passing vacuously. Two further tests BIND each ceiling to its own lane — the citation must sit inside that lane's own window (`never landed … `MAIL_MAX_ATTEMPTS` (6) … parks unread`; `delivered … unacked … replays … `MAIL_REPLAY_MAX_ATTEMPTS` (20)`), both patterns built from the live constants so a rename or a re-value moves the assertion with them.

**Fix round 2 (re-review) is why they are BOUND and not merely adjacent.** The first form of these two guards matched the lane PHRASES only and left the numbers to the two literal checks above, which do not care where in the file a citation sits. The re-review swapped the two citations between the lanes — both numbers present, both correctly formatted, each on the wrong lane, i.e. D-105's own error with the words rearranged — and the whole suite stayed GREEN. **The verbatim CONTRACT pin cannot cover that, structurally:** the pin forces its literal to be updated by whoever edits the clause, so an author who "corrects" the sentence wrongly updates the literal in the same breath and the pin follows them. Only an assertion that knows which number belongs to which lane can disagree with that author. The two guards are separate `it`s because a failing `expect` throws — one test would report the first lane and never evaluate the second, while the swap breaks both. *Measured: clause 3 reverted to the conflated form → 2 red (`carries all ten clauses verbatim`, and the new ceilings test naming `` `MAIL_MAX_ATTEMPTS` (6) ``); restored.*

**Also in this fix (review F-8):** D-103 and D-104 now carry `D-N` refs in the shipped source, per the house convention that source-file D-refs are authoritative history — `D-103` tags the corpus guard's test name, and D-104's operative constraint (**no clause may contain a `"` character**; a curly apostrophe reds the pin invisibly) is stated both beside the `CONTRACT` array and in SKILL.md's own contract section, where an editor of the prose will see it.

**D-106 — the `cmp` half of the "undoctored by-name dependency" pickup is not the same class as `rsync`/`diff`, and the README now says which is which.** (Task 5, README's Stage-2d install paragraph.)

The ledgered pickup (T4 nit) read *"README:840-843 names only rsync as the undoctored install dependency; diff/cmp joined the class in Task 4"*. Measured against the shipped source, that is true of `diff` and NOT of `cmp`:

- **`rsync`** — `cmd_install` refuses BY NAME without it (`ccd/ccrc:1916`, `_ccrc_die "rsync is required to place the tree…"`). Doctor has no check for it. Unchanged by this branch.
- **`diff`** — joined in Task 4 and behaves the same way where it matters: both skill installers refuse by name (`command -v diff … exit 1`, `install-{coordinator,worker}-skill.sh`) and `_inst_skills` treats a refusal as **fatal** to the whole verb, so a box without diffutils cannot finish `ccrc install`. (`_inst_tree_copy`'s own unguarded `diff -r -q` degrades safely; the refusal comes from the installers it then runs.)
- **`cmp`** — predates this branch (`_inst_atomic`, `_inst_keep_aside`) and **never refuses**. Both call sites leave the comparison unguarded on purpose, and their own comments say why: *"A missing `cmp` makes every destination look different, so the file is rewritten with identical bytes: the safe direction."*

Lumping all three together would have put a hard-refusal claim on a dependency that degrades — the same overclaim class `readme-holds.test.ts` exists to catch, one file over. The paragraph names `rsync` and `diff` as the two hard by-name dependencies with no doctor check, and `cmp` as the third of the class with the milder failure mode, stating the degradation rather than implying a refusal.

**Also decided in Task 5, recorded so the choice is not re-litigated:** the T3-⚠2 drift pin (the stated brief ceiling must equal `MAIL_BODY_MAX_BYTES − byteLength(WORKER_KICKOFF_PREFIX)`) lives in **`server/test/coordinator-skill.test.ts`**, not the worker suite — the corpus it guards is the coordinator's prose, and that file already owns every other assertion about it. It imports `WORKER_KICKOFF_PREFIX` from `dispatch.ts` and `MAIL_BODY_MAX_BYTES` from `shared/api.ts` and parses the three numbers out of the sentence, so the arithmetic is mechanical: *measured — cap raised to `16 * 1024` → red; the drifted "the wave brief itself exceeds" sentence restored → 2 red.*

**And one addition beyond the brief:** the worker skill points at `wave-lifecycle.md` **§3**, while the new worked fingerprint (F-2) belongs in **§4**. §3's send paragraph now carries a one-sentence pointer to it, so a worker sent to §3 by its own skill actually reaches the block — a reference nobody's pointer reaches is the same defect as no reference.

**D-107 — the mid-transition trade is durable: after this slice, everything except the branch-discipline sentence is skill-only, and a worker home whose installer has not run gets a short brief and no protocol.** (Task 5's trim, recorded at close-out per its own report's residual note.)

Task 5's Step 1 rewrote the coordinator's "the brief must say" block so the standing protocol loads mechanically — dispatch's prefix names `ccrc-worker` by skill, and the skill itself carries the ten clauses — while the brief shrinks to wave specifics. Exactly one line of the old prose SURVIVES the trim: the branch-discipline sentence, kept deliberately because a pre-skill worker may still exist mid-transition ("the skill says it; say it again — it is the one sentence that keeps the wave closeable"). Everything else the brief used to carry — ack-by-delivery-id, the uuid re-read, AskUserQuestion, the fingerprint's shape, the destructive-verb ban — is now **skill-only**. A worker dispatched onto a rostered home whose skill installer has never run gets that short wave-specifics brief and no protocol at all, and the failure is silent: nothing announces "you have no protocol" — the model improvises one, in the same words `_inst_skills`'s own comment uses for exactly this failure mode.

This is an accepted trade, not an oversight. The reasoning: per-brief re-typing was the measured fragility — **F7** in the design spec (`docs/superpowers/specs/2026-08-18-ccrc-worker-skill-design.md:20-22`), live in Build 4: a ~3KB multi-line brief typed per-wave over tmux is fragile (echo-verify flake + self-blocking draft), and every byte of standing protocol carried per-brief made that payload bigger. Collapsing the protocol into a shipped, verbatim-pinned skill removes that fragility at the cost of the mechanism now depending on the skill actually being installed on the home it dispatches to — a dependency that did not exist when the protocol was prose typed fresh into every brief.

**The mitigation already existed and needed no new code for this trade specifically:** README's preflight step 2, `ls ~/.claude*/skills/ccrc-{coordinator,worker}/SKILL.md`, checks for TWO skills paths per rostered config dir (Task 5 Step 2's README update). An operator who runs preflight before dispatching a wave sees a missing worker skill before any brief goes out; the window this deviation names closes when both paths are confirmed present on every rostered home, not before.

**Deploy order when this branch merges (AGENT-FIRST) — the 2e plan's `:165`-ish precedent, applied here.** This branch touches `ccd/ccrc` (`_inst_skills`), `ccd/coordinator-skill/` (the Task 5 trim) and `deploy/deploy.sh`'s agent arm (the Task 4 worker-skill rsync block) — the standing rule applies without a new argument: `bash deploy/deploy.sh agent <host>` ships to the fleet host BEFORE `bash deploy/deploy.sh` ships the server. Unlike Stage 2e's D-99/D-100 window, there is **no ordering hazard between the worker skill and the dispatch prefix themselves** — `ccd/worker-skill/`'s installer and `dispatch.ts`'s `WORKER_KICKOFF_PREFIX` ship in the SAME tree, in the SAME merge, so no commit-level window exists where one lands without the other in source. The hazard this note exists to name is cross-lane, not intra-branch: `WORKER_KICKOFF_PREFIX` is **server-side**, and every wave-1 dispatch composes it into the brief mail unconditionally, by name, the moment the server lane starts running the new `dispatch.ts`. If the server deployed first, dispatch would start naming `ccrc-worker` in every kickoff before the fleet host's homes carry that skill (`_inst_skills` is agent-lane work), and a worker reading its own brief would be told to run a skill it does not have — the same silent-no-protocol failure D-107 above describes, but induced by deploy order rather than a never-run installer. Deploying the agent lane first, as the standing AGENT-FIRST rule already requires for any `ccd/` change, closes that window before it opens.

**The per-worker-RC ruling stays OPEN — this slice gave it a destination, not a mechanism.** Orchestrator task #37 (a per-session form of `--remote-control`) was out of scope from plan time (Global Constraints: "ZERO `ccd/ccd` edits… no spawn-path mechanism ships here"), and nothing across Tasks 1–6 changed that. What shipped is `ccd/worker-skill/SKILL.md` clause 10, stating the box-level fact as fact: RC is the box's setting (`~/.ccrc/remote-control`), never the session's to toggle, and task #37 is named by number as the open ruling that would change this. The clause is pinned verbatim by `worker-skill.test.ts`, so when #37 lands, clause 10 is the sentence to revise and the pin will not let a reviser drift past it silently. The mechanism itself remains future work; this slice's contribution is that the open question now has one durable, verbatim-pinned home in the corpus instead of being absent from it.

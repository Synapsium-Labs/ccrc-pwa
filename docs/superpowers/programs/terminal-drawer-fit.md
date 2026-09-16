# Program: terminal-drawer-fit

Spec: `docs/superpowers/specs/2026-09-14-terminal-drawer-history-and-fit-design.md`
Plans: `docs/superpowers/plans/2026-09-14-drawer-wave{1,2,3,4}-*.md`
Home project: `ccrc-pwa`   Coordinator: `ccrc-pwa-brisk-mesa`   Workspace: per-wave (wave 1 spawns)

**What this program is.** The console drawer gets a history a phone can read, and a window that fits
the phone without lying to the fleet. It replaces PR #96, which was measured to destroy the very
scrollback it exists to render.

## Waves

| # | scope | deploy class | PRs | state |
|---|---|---|---|---|
| 1 | the latch (pin before every attach) + the salvaged reader, with nine corrections | server | [#106](https://github.com/Synapsium-Labs/ccrc-pwa/pull/106) → `6d46bab7` | **MERGED 2026-09-15** |
| 2 | `ccd win-size` verb + grant + the fleet-box readers standing down | **AGENT-FIRST** | — | **dispatched 2026-09-15** (run 62, 6 items) |
| 3 | the deliberate un-pin under a measured fit guard | server | — | planned |
| 4 | whole-branch pass, README, the CLAUDE.md sentence, ledger reconcile | docs | — | planned |

Wave 1 is independently valuable and safe with nothing after it. Wave 3 may merge in any order but
DOES nothing until wave 2 is on the fleet box: it un-pins only through a verb gated on
`capSupported(state,'win-size-v1')`, which answers false on no evidence.

**Deviation block: sixteen numbers from `D-2766`** (allocated at run-open 2026-09-14), **extended
2026-09-16 by eight more starting at 2859** (the floor was 2859 and is now 2867; numbers written bare
here for the reason the next paragraph gives). Of the extension, four are assigned — 2859 the grant
rationale's falsified id-provenance, 2860 rc 6 joined at the four call sites that test the set by
value, 2861 the wide-pane fixture arm across ~50 stubs in 14 suites, 2862 the `pty.ts` reversal above
— and four run unassigned to 2866.

**The under-sizing was a coordinator estimate error, and it is a ruling, not a deviation.** Sixteen
was a guess: wave 1 spent nine and wave 2 spent seven before task 5 even began. A deviation records a
departure from a plan or brief, and no plan instructed a block size — so this is recorded here rather
than burning a number on it. The lesson for waves 3 and 4: **mint per RUN at run-open** (clause 10's
actual shape) rather than once per programme, and size against the measured ~10-per-wave, not against
a feeling. Extending mid-wave is the coordinator's act — never the worker's, whatever the worker can
reach; a worker that mints is the D-2338 shape. A number is NAMED here only once it is assigned and defined in a plan — the unassigned tail
is deliberately not spelled as a `D-` token, because `deviation-refs.test.ts` requires every tracked
ref to be ledgered and an unspent one would red it for the life of the programme. Every wave draws from this block and defines each number in the same act as using it. A worker
never calls the allocator mid-wave (coordinator clause 10); it names the departure in its wave-done
mail and the coordinator assigns from the block. **Wave 1 owes none as planned** — both departures an
earlier draft carried were ruled into the spec instead (§11 rulings 9 and 10).

Run ids: wave 1 = **51** (closed `done`, `final:false`), wave 2 = **62**.

**The spec, the four plans and this ledger merged as [#102](https://github.com/Synapsium-Labs/ccrc-pwa/pull/102)
→ `7a91bcf1`, 2026-09-15.** That is what retires D-2772's constraint: the plans are on `main`, so a
worker from wave 2 on CAN carry an inline `D-N` comment in source and have
`deviation-refs.test.ts` find its definition in the same tree. Wave 1's two numbers that live only
in commit messages (D-2771, D-2773) stay where they are — reconciling them is wave 4's item.

## Wave 1 review — what the fan-out found (2026-09-14)

Handoff `8919c41f`, 19 files, +4218/−54, scope clean. Eleven opus lenses — five verifying the
worker's claimed departures by re-running the mutations on isolated worktrees at its own tip, six
reading the branch — then **two independent opus refuters per finding**: 67 raised, **43 refuted**,
24 survived. The refutations did the heaviest measuring of the whole review, and three of them
overturned findings that would otherwise have cost a round trip.

**All four claimed departures confirmed, and the addition ruled in scope.** Three of the plan's
mutation tables did not mutate — a defect in the plan this session wrote, caught only because the
worker ran them instead of reading them. The plan also told the worker to call the deviation
allocator (Task 17 Step 4), contradicting the brief, this ledger and worker clause 11; the worker
refused and reported. That refusal is the protocol working against a bad instruction.

### Deviations — DEFINED HERE, drawn from the block

- **D-2766** — Plan Task 4 Step 3's own replacement comment for `exec.ts` refutes the false "tmux
  never reflows" claim *by quoting it*, and Step 1's regex has no word boundary after `reflow`, so
  the refutation scans identically to the assertion. Step 4's "Expected: PASS everywhere" is
  unreachable; measured RED. Reworded to refute without restating. The regex was deliberately NOT
  loosened — that would readmit the real claim and break the same task's Step 5 mutation.
- **D-2767** — Plan Task 11's second test cannot fail. React double-invokes an effect only on a
  component's INITIAL mount; that effect's body returns early until `hist` flips later, so
  StrictMode never reaches it. Guard deleted, suite green at 57 passed. Its Step 5 mutation 2 is
  unfalsifiable by construction — both statements run in one synchronous block and the parse
  callback fires strictly after. Replaced with the race that is real.
- **D-2768** — Plan Task 12's two tests both resolve fresh-first, the one order in which the
  pre-existing state check already suffices; both plan mutations stayed green. The plan also
  **mis-states the defect**: the stale answer is not appended after the fresh one — the fresh read
  is DISCARDED ENTIRELY (measured `['STALE-A']` against `['FRESH-B']`). Flipped to stale-first.
- **D-2769** — `pwa/design/audit.mjs` edited though outside the plan's file table: PR #96's
  `.term-histbar-word` sets a colour with no recoverable ground and entered the census D-2689
  freezes. Grounded by measurement (`INHERITED_GROUNDS`, 12.32 dark / 10.41 light against a 4.5
  floor), not grandfathered; a first attempt using `GROUNDS` was correctly refused by the gate.
- **D-2770** — `pwa/test/history-term-viewport.test.tsx`, the fake-`Terminal` wiring half of spec
  §11 ruling 11. Plan Task 16 silently substituted a source scan for it and recorded "Departures:
  None". **Ruled IN scope.** The verifier proved rather than accepted both load-bearing claims: the
  `vi.mock` isolation is necessary (the same control is RED against the real xterm and GREEN with
  the mock prepended) and the fake is faithful (xterm 6.0.0's `BufferService.scrollLines` is
  byte-for-byte the fake's clamp). It is complementary, not redundant — deleting
  `smoothScrollDuration: 0` reds the scan and leaves the fake green.

### The squash that dropped a co-author (2026-09-15) — a coordinator defect, not a wave defect

**Wave 1 merged as `6d46bab7` and `main` credits one co-author where it should credit two.**

The mechanism. `gh pr merge --squash --body-file <f>` **REPLACES** GitHub's generated squash body; it
does not append to it. The generated body is the only thing that aggregates the `Co-authored-by:`
trailers of the squashed commits. All 35 commits on #106 carried one; my hand-written body carried
only Claude's. So the trailer for **Oleksandr Zakharov**, author of the twelve salvaged PR #96
commits, is absent from `main`.

The irony is the point, and it is this programme's own defect class one level up. The whole wave
protected that authorship on purpose — it is why the worker was sent to MERGE and not rebase (a
rebase would have rewritten the twelve cherry-picks and silently re-authored them), and why the
merged tip was verified at 12 commits / 12 cherry-pick lines / authorship intact. The attribution
then died at the last step, inside the act of being careful about the body. And the body I wrote says
*"their original authorship intact"* — **a comment asserting what the tree measures false, written by
the session that spent three fix rounds red-lining exactly that**.

What survives, measured: GitHub retains all 35 of #106's commits and serves them by SHA
(`1a7e2615` still reads `Oleksandr Zakharov`), so the provenance is recoverable; what is lost is the
credit in `main`'s own history, and `main` is protected, so no amend reaches it. Recorded as a
comment on the PR — [#106 comment 5683785506](https://github.com/Synapsium-Labs/ccrc-pwa/pull/106#issuecomment-5683785506).
**Operator ruling 2026-09-15: the PR comment is the remedy.** A follow-up commit to `main` carrying
the trailer, or a `.mailmap` entry, were both considered and declined — cosmetic, and they put a
second claim about authorship in a second place.

**THE RULE, and it now binds every merge this programme makes.** A hand-written squash body is still
correct — it is what keeps the merge commits on `main` readable. But hand-writing it **takes over
responsibility for the trailers**, so derive them rather than remembering them:

```bash
gh api repos/<org>/<repo>/pulls/<N>/commits --paginate -q '.[].commit.message' \
  | grep -iE '^co-authored-by:' | sort -u
```

Every line that comes back belongs in the body. Applied to **#102** before merging it: the query
returned exactly `Co-Authored-By: Claude Opus 5`, the prepared body already carried it, and the
merge commit `7a91bcf1` was verified to carry it after the fact. Verify AFTER too — the body is only
a claim until `git log -1 origin/main` is read back.

### The merge that four false counts survived — and the guard that caught them (2026-09-15)

Wave 1 sat fourteen hours waiting for an approval, and `main` moved seven commits underneath it. The
branch acquired a conflict; the interesting part is what the conflict did **not** show.

```
base fb19772e :  47 + 28 = 75      toBe(75)
origin/main   :  47 + 29 = 76      toBe(76)   ← #105 added an EXEMPT route
ws/plain-basin:  48 + 28 = 76      toBe(76)   ← this wave's NON-exempt pane/history route
merged        :  48 + 29 = 77
```

Both parents reach 76 by **different arithmetic**. Git sees the identical `75→76` edit on both sides,
auto-merges the assertion to 76 **with no marker**, and puts the marker on the prose above it — so the
one line actually false on the merged tree is the one git will not show you.

**Three further counts were falsified with no conflict at all**, because both parents said the same
number and only the merge made it wrong: `auth-gate.test.ts:778` (73→74 HTTP routes), `:372`
(76→77 scanned) and `auth/gate.ts:8` (73→74). Nobody found those by reading. **`auth-gate.test.ts`'s
own D-1223 mechanism found them** — a block that scans this file's prose against counts derived at
runtime, written two builds ago for an unrelated reason. The coordinator re-proved it by mutation:
break one count and it reds naming the derived value beside the claimed one.

**The lesson, and it generalises past this repo:** a merge is a tree neither author ran, so a number
measured correctly on each parent can be false on the merge — and the conflict marker lands where the
*prose* differs, not where the *assertion* is wrong. Identical edits on both sides are exactly the
ones git will not flag. The only thing that catches this class is a guard that derives the number
and checks the prose against it. On this merge, one such guard stood between the tree and four false
counts.

**Merged, never rebased.** A rebase would have rewritten the twelve cherry-picked commits and
silently re-authored work belonging to PR #96's author. Verified at the merged tip: 12 commits still
carry Oleksandr Zakharov as Author and 12 still carry their `cherry picked from commit` lines.

Guards at the merged tip: 7 files / 359 tests green (auth-gate, box-token-census, single-definition,
deviation-refs, pane-history-route, pty, dtbd). CI **six of six green** at `9b472a20` (run 34979756360), `test-macos` included — the independent answer to the local flakes above.

**The flake surface is wider than CLAUDE.md's five, measured not guessed.** At load 39.8→47.6 on 16
cores the first full server run failed 7 files (six were 20–30 s *timeouts*, not assertions) and the
first full pwa run failed 10; all passed in isolation and on re-run. New names for wave 4's list:
`boot`, `ccd-ws-audit`, `ccd-ws-reap`, `ccrc-account`, `ccrc-doctor`, `ccrc-install-graphify`,
`ccrc-install`, and pwa's `contrast` — eight, against a documented five.

### Wave 1: review COMPLETE, 2026-09-14

Tip `2e6547a6`. **All six CI legs pass**, `test-macos` included; PR #106 measures `MERGEABLE` and is
blocked only on a non-author approval. Run 51 is at `merging`, items 17/17. Three fix rounds,
**D-2766–D-2774**, ten mutants re-run by hand in the last round and all ten red.

**What this wave actually taught the programme.** Every defect that mattered was in the PLAN this
session wrote, not in the execution, and each surfaced because the worker ran something rather than
read it. It corrected the coordinator twice, both times with measurements rather than argument —
reversing the F4 wire-widening ruling outright, and refusing the G3 remedy that would have redded a
file which never carried the false claim. The three defect classes worth carrying into waves 2–4:

1. **"Deleting the guard reds" is weaker than "a wrong guard reds."** Three guards passed the first
   and failed the second. Ask every mutation table for the wrong implementation, not the absent one.
2. **A comment and its test written in one sitting drift apart.** Five instances on one branch,
   the fifth inside the comment written to fix the fourth. A regex over prose cannot be completed —
   cap it, and make it state what it cannot catch.
3. **A fixture can red for the wrong reason** (D-2774), which is a guard that cannot fail one level
   up. One fixture per token, each isolating exactly one absence.

### Fix round 3, verified by hand — ten mutants, ten reds (2026-09-14)

Test-only, 223 lines across two files. The coordinator ran the mutation tables itself rather than
delegating, and every one reds with the tree clean after each:

| mutant | result |
|---|---|
| history terminal: `disableStdin` re-enabled | RED |
| history terminal: a second addon loaded | RED |
| history terminal: a `linkHandler` added | RED |
| `MEASUREMENT`: drop `1853` / `43` / `history_size` / `resize-window`, each alone | RED ×4 |
| `FALSIFIED`: drop the `does not` half of the alternation | RED |
| `ROOTS`: drop `agent/src` | RED |
| `EXTRA`: drop `ccd/ccd` | RED |

**Spec §5.5's mandatory lens now has a mechanism** (`pwa/test/history-term-hardening.test.tsx`): a
behavioural half against a recording fake — `disableStdin`, exactly one addon and it an instance of
`FitAddon`, no `allowProposedApi`, no `linkHandler` — plus two source scans, because the behavioural
half sees one constructor. The addon scan is **derived**: the set of `@xterm/addon-*` packages
imported anywhere in the app must equal `['@xterm/addon-fit']`, since a denylist would only catch the
addons someone thought to forbid. Its comment says plainly that this is a claim about *this
terminal's configuration*, not about xterm's parser.

**D-2774 — the worker found a third weakness while pinning the first two.** Its first repair used two
fixtures, and dropping the `1853` clause alone stayed GREEN: both fixtures rejected the loosened
regex for the wrong reason, neither carrying `resize-window` at all. Replaced with one fixture per
token. A fixture that reds for the wrong reason is the same defect class as a guard that cannot
fail, one level up — and it was found by the worker pinning its own repair, not by review.

The worker also reported an unnamed flake honestly: the first of three full server runs showed
`1 failed | 9290 passed` with the file name lost to a tail, and the two runs after it were green.
Reported rather than smoothed over. CI is the arbiter.

### Fix round 2, verified — and the limit of a regex over prose (2026-09-14)

The fresh-eyes gate, the one verifier with no prior position on the branch, answered **MERGE**: it
re-derived the core invariant against *wrong* guards rather than deleted ones (pin deleted, pin moved
after the attach, pin at the CLIENT's grid, refit restored — all four RED), proved the dropped design
absent in substance, found all five wave-3 interfaces correctly shaped, and confirmed `resizeWindow`
is defined once and called exactly twice, both inside the one route, with the agent whitelist
granting no second path to un-latch `manual`.

**The comment guard was found weaker than its own comment for the third round running, and this
time the false claim landed inside the comment written to fix it.** Seven paraphrases of the
falsified claim escape `FALSIFIED`, including `tmux 3.4 never reflows a stored line` — a spelling
this tree's own prose invites — and the branch's own paraphrase of the claim. Two wrong-but-passing
guards exist, and the commit message's "dropping a root reds" is measurably false for one root.

**Ruling: stop widening the regex.** A regex over prose cannot be made complete, and each widening
has bought a fresh false claim about the widening. Round 3 pins the wrong guards with two fixtures,
fixes the false claims, and makes the guard's comment state what it catches and what it cannot.

**D-2773: the worker departed from a coordinator ruling and was right**, proved on a nine-case
corpus rather than argued. The coordinator's own remedy would have redded a correct file.

**The mandatory security lens shipped no mechanism.** Spec §5.5 named escape-sequence replay as the
one mandatory lens; it ran as a *review* lens and found the threat largely closed, but nothing in
the tree pins it — no mention of OSC or DCS anywhere, which is the signature of a lens listed and
not run. The property holds today by reading; round 3 ships the guard. **That is the coordinator's
omission: the brief named the lens and then the review read the code instead of asking for a test.**

### Fix round 1, verified (2026-09-14)

Four opus verifiers on isolated worktrees at `2e14ffbb`, each re-running the round's claimed
mutations and then attempting a **wrong-but-passing** implementation of the guard it owns; two
refuters per finding, each required to answer *"if this holds, what is the right fix?"* — the field
the previous round lacked. 22 raised, 7 refuted, 15 survived.

Every claim the worker made reproduces, both halves of every red-now/green-before pair included.
**F5 is genuinely pinned** — no reachable wrong-but-passing variant exists. The F4 reversal is
byte-clean. But the wrong-but-passing battery earned its place twice over:

- **F6 pins the frame it sends, not the resize arm.** The one frame is `{cols: 43}` — the same cols
  the socket attached with — so four wrong refits pass, including the realistic
  `if (m.cols !== cols)`, which is invisible across the entire 9346-test server suite. A verifier
  measured the remedy: send a width-CHANGING frame first, and W1/W2/W4/W5 all red.
- **The reflow guard still pins a token, not its subject.** `prose()` flattens `//` but not JSDoc —
  and `TerminalDrawer.tsx`, the file the correction was about, carries it as JSDoc. And the
  anti-vacuity demand is still pointer-satisfiable: `See F1 (1853 -> 9460).` passes all 18 tests,
  the exact failure it was written to close, while the test's own comment claims otherwise.
- **The union test hand-names three tokens** while its comment says it walks the union.

**The lesson that generalises: "deleting the guard reds" is a weaker property than "a wrong guard
reds", and only the second is what a mutation table is for.** Three of these guards passed the first
and failed the second. Ask for the wrong implementation, not just the absent one.

**D-2771** was assigned during fix round 1, when the worker disagreed with a coordinator ruling and
was right (below). **Ten of the sixteen remain unspent.**

### The one ruling this session got wrong, and how it was caught

Fix round 1's item F4 ordered the probe's `detail` carried through to the wire. The worker replied
with a `finding` **before doing the work**, as the round invited, and disagreed with the remedy while
agreeing the defect was real. All five of its measurements verified:

1. The coordinator's own parenthetical — "the type already has `detail?`" — was false. `detail?` is
   on `PaneHistoryReply`'s `ok:false` arm only; carrying it through meant widening the wire.
2. Two red-first tests pin the exact body with `toEqual`; the change would have edited tests to match
   a change rather than the reverse.
3. Plan line 1391 forbids exactly that re-decision.
4. **Both of this session's own refuters had named the docstring fix as the remedy** — one wrote "do
   NOT give probe failures a status path or a wire `detail`". The coordinator carried the finding
   forward because it survived refutation, and did not carry the refuters' remedy with it. That is
   the failure the refute pass exists to prevent, committed by the session running it.
5. The load-bearing half of the ruling — "wave 3 is told to build on that contract" — is false. Spec
   §7.1 is `probe = paneProbe(id)` then `fitFloor(probe, clientCols)`: wave 3 consumes the
   `PaneProbe` VALUE server-side, where all four arms are intact, and never reads
   `PaneHistoryReply`.

F4 was reversed to the worker's proposal and dropped from major to minor. **A survived finding
carries its refuters' remedy, not just its claim** — the review harness had the right answer and the
coordinator read only half of it.

### The pattern worth carrying

**Three shipped comments on this branch assert mechanisms the tree measures false** — the dangling
pointer at `TerminalDrawer.tsx:292` (whose single surviving word `reflow` is the only thing keeping
the anti-vacuity guard green), the StrictMode attribution at `:820`, and the latch block's "the
client that attaches an instant later cannot move the window at all". That last one two refuters
raced against real tmux: 45/45 held in one harness, **2/40 inverted** in a tighter one, transients
0.47 ms and 4.28 ms. The pin FORKS first, which is a bias, not a barrier.
This is the exact class Task 4 exists to remove, recurring three times in the branch that removes it.

**No `await` on the latch** (ruled): in remote mode it is a WS round trip in front of every drawer
open, and the narrow→wide round trip was measured lossless at 3.7× over `history-limit` — 1452
stored / 1502 logical at 220 cols, to 43 (history_size 7463), back to 220, returning 1452 / 1502.
tmux 3.4 does not collect history during reflow, so the loss needs a scrolled line *inside* a
~1 ms window.

## Decisions & deviations (why, not just what)

The spec's §11 carries fifteen numbered rulings; these are the ones a reviewer most needs the *why* for.

- **PR #96 is closed, not continued.** A program worker commits on its own workspace branch (worker
  clause 2), so `fix/terminal-scrollback` is off the table. Twelve of its fourteen commits are
  cherry-picked with `-x` and the author's trailer; `df82702d` and `1dee05ab` — the window-follow —
  are dropped. Wave 1 Task 17 Step 6 closes #96 with a comment saying exactly that.
- **`window-size smallest`, never `latest`.** `latest` follows whoever TYPED last, so a phone and a
  desktop on one session reflow the window on every keystroke alternation: +6 MB tmux RSS per flip,
  never returned, and from ~flip 17 it sheds 50 history lines per flip. `smallest` is deterministic,
  keystroke-stable, and self-heals when the narrow client leaves.
- **The window is pinned before every attach and un-pinned only deliberately.** Measured end to end
  (spec F14): unpinned, a 43-column attach to a pane holding 1203 logical lines leaves 1046 — 157
  destroyed. Pinned first, the window never leaves 220 and nothing is lost.
- **No `history-limit` raise.** The census (F12) found 25 of 31 live panes at zero stored history,
  max 11 — every pane passes the 43-column fit at today's 2000. A raise would cost tmux memory and
  whole-server stall for a case that does not occur. The lever, if a later census disagrees, is one
  line in `ccd/tmux.conf` (§6.4).
- **The readers are not rewritten; they stand down.** `-J` cannot rescue them: at a narrow width Ink
  re-lays-out and emits its OWN newlines, so there is no tmux wrap to rejoin. Below
  `READER_MIN_COLS` every ccd site that would TYPE stands down, and the mail lane holds. A narrow
  pane is *unmeasured*, not idle.
- **`gone` is `not-alive`, checked BEFORE the width** (ruling 13). Folding it into the held token
  would retry a dead session's mail every five minutes forever, because that hold counts no attempt
  by design.
- **The automation-paused notice is gated on `narrowed === true`** (rulings 14/15), never on the
  client's width — `cols` is the pty's width and says nothing about whether the window followed it.
  Gating on `cols` alone would make wave 3 visibly non-inert before wave 2 deploys.

## Carried constraints (reviewers get these)

- **A pre-existing crash on `main`, surfaced by this review and NOT owned by this programme.**
  `/ws/pty/:id` validates no session id on either ref; node's `execFile` throws
  `ERR_INVALID_ARG_VALUE` synchronously on a NUL argument inside `realRunner`'s Promise executor;
  `server/` installs no `unhandledRejection` handler (only `agent/src/index.ts:8` has one). One
  `ws://…/ws/pty/a%00b` exits the process in **local** mode. Both refuters reproduced it and both
  proved `main` dies too — node-pty accepts a NUL in argv, so main's close handler fires the
  identical stack. **The live box runs `CCRC_FLEET=remote`, whose `createRunner` catches every
  failure, so the live server is unaffected on both refs.** Its own item against main.
- **Anchored tmux targeting, `=cc-${id}:`** (`exec.ts:74`, and the sites below) — **RULING REVERSED
  2026-09-16, deviation 2862 (written bare: its entry lands in wave 2's plan on the worker's branch,
  and `deviation-refs.test.ts` reds any tracked `D-` ref whose definition is not in THIS tree —
  wave 4's reconcile converts it). This is a DEFECT, not hardening, and wave 3 owns it as its first
  item.**
  What this bullet said until now: *"No confused deputy exists today — the only caller encodes a
  registry id, and an operator who can hand-write `cc-*` already has `POST /api/sessions/:id/send`
  — so this is hardening, not a defect."* The premise is measured false. `/ws/pty/:id` takes its id
  from `req.params` (`server.ts:1515`) and **validates it nowhere** before `spawnPty(id, cols,
  rows)` — so the "caller encodes a registry id" guarantee lived entirely in a caller that does not
  provide it. `pty.ts:18` then spawns `tmux attach -t cc-<id>` unanchored. `tmux attach` is a full
  interactive terminal with keystroke injection, which makes it the worst of these sites, not a
  peer of `send`.
  **CORRECTION 2026-09-16, and it sharpens the hazard rather than dissolving it.** The sentence
  that stood here — *"`cc-ccrc-pwa` prefix-matches at least three live sessions today,
  nondeterministically"* — is measured FALSE, and D-2780 on the wave-2 branch already had it right
  while this entry, written the same day, did not. Measured on a private tmux 3.4 socket:

  | target | result |
  |---|---|
  | unique prefix (`cc-al` → only `cc-alpha-one`) | **rc 0, resolves silently to the wrong session** |
  | ambiguous prefix (`cc-beta` → two matches) | `can't find session`, **rc 1 — it REFUSES** |
  | fnmatch (`cc-*-two`) | **rc 0, the pattern is INTERPRETED** |
  | anchored (`=cc-al`) | refused — the anchor defeats both |

  So `cc-ccrc-pwa` against three live `cc-ccrc-pwa-*` sessions **refuses**; there is no
  nondeterminism anywhere in this mechanism. The two live vectors are (a) an id that is a UNIQUE
  prefix of exactly one live session, which resolves silently, and (b) an id containing `*` or `?`.
  **(b) is the sharper one and it is caller-controlled rather than accidental** — and
  `server/src/clip.ts`'s `isSafeSessionId`, which wave 3's plan pins as the remedy for
  `/ws/pty/:id`, rejects only empty/`.`/`..`/`/`/`\`/NUL and **permits `*` and `?`**. It is a path
  validator standing where a tmux-target validator is needed. `agent/src/pty.ts`'s
  `/^[A-Za-z0-9_-]+$/` is the shape that actually closes it.
  **This is the programme's own defect class, committed by the coordinator in the act of reversing a
  ruling** — a sentence whose claim the tree measures false. It is recorded rather than quietly
  edited, for the same reason the reversal above is.

  **SECOND CORRECTION, 2026-09-16: the FIX this bullet named was also wrong.** `=cc-${id}` — the
  spelling this entry carried, and the one the next-wave brief ordered wave 3 to ship — does not
  work. `=` anchors only the SESSION component of a target, and tmux's verbs take three different
  target kinds. Measured on a private tmux 3.4 socket, sessions `cc-alpha-one` + `cc-beta-two`,
  prefix `cc-al`:

  | verb | target kind | `cc-al` (today) | `=cc-al` | `=cc-al:` | `=cc-alpha-one` | `=cc-alpha-one:` |
  |---|---|---|---|---|---|---|
  | `has-session` | session | rc0 **wrong** | rc1 | rc1 | rc0 | rc0 |
  | `list-panes` | window | rc0 **wrong** | rc0 **STILL WRONG** | rc1 | rc0 | rc0 |
  | `resize-window` | window | rc0 **wrong** | rc0 **STILL WRONG** | rc1 | rc0 | rc0 |
  | `capture-pane` | pane | rc0 **wrong** | rc1 | rc1 | **rc1 BREAKS** | rc0 |
  | `send-keys` | pane | rc0 **wrong** | rc1 | rc1 | **rc1 BREAKS** | rc0 |

  So shipping `=cc-${id}` would have left `list-panes` and `resize-window` **silently vulnerable**
  while taking `capture-pane` and `send-keys` — the pane reader and the keystroke sender, which is
  the whole drawer and the whole answer path — to rc1 on **every** session. Every suite would have
  stayed green, because they all stub the runner.

  **The only spelling that anchors all five is `=cc-${id}:`** — the anchor plus the empty
  window/pane component that forces tmux to parse the session part. Controls run, because a
  narrowing must not change the hit: it accepts the exact id on all five verbs (rc0), a bogus id
  refuses on all five (no silent fallback to "current"), and in a split, multi-window session
  `list-panes -t '=cc-alpha-one:'` returns the byte-identical pane set and the same ACTIVE pane as
  today's bare form. It is a pure narrowing.

  **AND ANCHORING IS NOT SUFFICIENT — it is one of two mechanisms.** Measured: an id of
  `alpha-one:1` resolves under BOTH `cc-alpha-one:1` and `=cc-alpha-one:1` (rc0 both), because the
  `:` makes it a target-WINDOW before the anchor is consulted. `isSafeSessionId` permits `:`, `*`
  and `?`. So the target spelling closes the PREFIX vector and an ingress predicate closes the
  METACHARACTER vector; neither closes the other, and a plan naming only one is half a fix.

  **`_tmux()` is an overloaded seam and must be SPLIT, not edited.** `ccd/ccd`'s
  `_tmux() { echo "cc-$1"; }` has ~24 uses, but two of them are NAMES, not targets — it feeds
  `new-session -s "$tname"`, and it is compared against `display-message -p '#S'`. Anchoring the
  function wholesale would create sessions literally named `=cc-x:` and silently flip a swap
  branch. One function means both "the name" and "the target"; correcting the claim means splitting
  it (`_tmux` = name, `_tmux_t` = anchored target).
  **Scope of the reversal, stated so it is not over-read:** the live box is armed, so the upgrade is
  authenticated, and no shipped PWA path passes a non-session id — today's blast radius is an
  operator hand-typing a truncated id into the wrong terminal. It becomes an authorization defect
  in the team edition, and it is a footgun now. **Why wave 2 did not fix it:** its ledger was fixed
  at dispatch, and the honest repair is the systemic one D-2781 declared — all eight sites plus a
  guard that reds on a bare `-t cc-` target. One site patched would leave seven and no guard, which
  is correcting the instance instead of the claim.
  **How it was caught:** the wave-2 worker measured it and reported it unprompted, after declaring
  D-2781's class and then looking for further instances. That is the second time this programme's
  worker has overturned its coordinator with a measurement (the first was the F4 reversal).
- **No byte cap and no compression on the pane/history response.** `-S -N` is a START OFFSET, not
  a size cap, so `PANE_HISTORY_LINES` never was a byte bound (measured: `-S -1951`, `-S -2000` and
  `-S -100000` return byte-identical payloads). A real cap must bound the RESPONSE. This wave moves
  bytes strictly DOWN. Wave 3 or 4.
- **`server/test/boot.test.ts`'s "a hung ccd does not delay listen"** is a wall-clock assertion that
  loses to CPU contention — green alone at 5.52 s, red at load 32+. Not on CLAUDE.md's documented
  five. Wave 4 owns that line.
- **Plan Task 17 Step 4 must be deleted**: it tells the worker to call the deviation allocator,
  which the brief, this ledger and worker clause 11 all forbid. Wave 4 amends the plan.

- **PR #94's residual, against merged code.** #94 merged as `fb19772e` (2026-09-14 11:50 UTC) and
  `main` is green on every leg including `test-macos`; D-2614 is closed. Its text does not name this:
  on the non-tty path Apple's `script.c` handles stdin EOF by writing VEOF and setting
  `readstdin = 0`, and the re-arm at `:318` is guarded by `ttyflg`, which that path never sets — so
  if the `cat` copier dies, the operator's code channel is removed silently while `script` runs on to
  its deadline. To be reported to #94's author. **This program takes no dependency on it.**
- **The width-sensitive readers are a defect about those readers**, not about this program. Making
  automation run *at* 43 columns needs a real Ink capture at phone width and a two-box phrase sweep;
  it is later work with its own spec (spec §10), not a prerequisite.
- **`resize-window` latches `window-size manual`, and `set-option window-size smallest|latest`
  un-latches but does not restore.** This is the fact every wave turns on and it is nowhere in
  `CLAUDE.md` yet; wave 4 puts it there, beside SAFETY.
- **Three "mutation tests" in an earlier draft of wave 3 did not mutate** (a `clearInterval` behind a
  `closed` short-circuit, a `<=`→`===` with no falling-floor case, a half-deleted `onPong`). Every
  mutation table in these plans was re-derived after that; reviewers should still run them rather
  than read them.

## Next-wave brief

**Wave 1 is DONE and merged** (`6d46bab7`), and so are the spec and plans (`7a91bcf1`). Both gates
wave 2 waited on are gone. Wave 1's plan was
`docs/superpowers/plans/2026-09-14-drawer-wave1-latch-and-reader.md`, all 17 tasks, and it owed no
deviation numbers as planned (both departures an earlier draft carried were ruled into the spec
instead — §11 rulings 9 and 10); the nine it ended up owing are D-2766..D-2774, every one a defect in
the plan this session wrote rather than in the execution.

**The remaining sequence, and the order is not negotiable: open wave 2's run BEFORE closing wave
1's.** Wave 2 stays in `ccrc-pwa`, so `POST /api/runs` names `sessionId: ccrc-pwa-plain-basin` to
reclaim wave 1's workspace, and wave 1 then closes with `final:false`. Close-first leaves zero open
runs, the server retires the programme, and every `toId:'coordinator'` mail that carries no `runId`
stops resolving.

**Operator rulings, 2026-09-15.** (a) The exec-whitelist grant is NOT escalated for separate
operator sign-off: **the mandatory `opus@xhigh` security lens IS its review**, and the grant is seen
at PR review like any other change. The lens therefore carries the whole weight — its brief says so
explicitly. (b) Wave 1's merge goes through the ruleset's admin bypass rather than a non-author
review; that is the operator's call and this session does not take it.

**Wave 3's FIRST item is now fixed, before its plan is touched: the systemic `=cc-<id>` targeting
fix.** All eight sites, plus a guard that reds on a bare `-t cc-` target, plus id validation at
`/ws/pty/:id` — which today validates nothing, and is what falsified the ruling above. Do not let
wave 3 patch `pty.ts` alone: one site of eight with no guard is correcting the instance instead of
the claim. Wave 3's plan currently says nothing about this; amend it at run-open, and mint wave 3's
block in that same act.

Wave 2 is the AGENT-FIRST one: it ships to the fleet host before any server that calls it, and its
first task is the `READER_MIN_COLS` measurement (wrap-ansi over Claude Code's status-line shapes at
40–220 columns, no live session). Its brief must name the three tasks routed to `opus@high` — the
`win-size` verb body, the whitelist entry plus `REQUIRED_VERB_FLAG` and its bypass fixtures, and
`_pane_measurable` with its sweep over every typing site — and its mandatory security lens is the
exec grant.

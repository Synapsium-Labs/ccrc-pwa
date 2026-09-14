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
| 1 | the latch (pin before every attach) + the salvaged reader, with nine corrections | server | [#106](https://github.com/Synapsium-Labs/ccrc-pwa/pull/106) — 6/6 CI green | **fix round 1** |
| 2 | `ccd win-size` verb + grant + the fleet-box readers standing down | **AGENT-FIRST** | — | planned |
| 3 | the deliberate un-pin under a measured fit guard | server | — | planned |
| 4 | whole-branch pass, README, the CLAUDE.md sentence, ledger reconcile | docs | — | planned |

Wave 1 is independently valuable and safe with nothing after it. Wave 3 may merge in any order but
DOES nothing until wave 2 is on the fleet box: it un-pins only through a verb gated on
`capSupported(state,'win-size-v1')`, which answers false on no evidence.

**Deviation block: sixteen numbers from `D-2766`** (allocated once at run-open 2026-09-14; floor now
2782). A number is NAMED here only once it is assigned and defined in a plan — the unassigned tail
is deliberately not spelled as a `D-` token, because `deviation-refs.test.ts` requires every tracked
ref to be ledgered and an unspent one would red it for the life of the programme. Every wave draws from this block and defines each number in the same act as using it. A worker
never calls the allocator mid-wave (coordinator clause 10); it names the departure in its wave-done
mail and the coordinator assigns from the block. **Wave 1 owes none as planned** — both departures an
earlier draft carried were ruled into the spec instead (§11 rulings 9 and 10).

Run ids: wave 1 = **51**.

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
- **`=cc-${id}` exact-match targeting** (`exec.ts:74`) would close tmux target-pattern matching
  across eight pre-existing call sites for one character. No confused deputy exists today — the
  only caller encodes a registry id, and an operator who can hand-write `cc-*` already has
  `POST /api/sessions/:id/send` — so this is hardening, not a defect. A later wave.
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

**Wave 1 is in fix round 1** (mail 1179, nine items, artifact
`…/scratchpad/wave1-review/fix-round-1.md`). Wave 2 does not open until wave 1's PR #106 merges.

**Wave 1 was dispatched.** Its plan is `docs/superpowers/plans/2026-09-14-drawer-wave1-latch-and-reader.md`,
all 17 tasks, and it owes no deviation numbers as planned (both departures an earlier draft carried
were ruled into the spec instead — §11 rulings 9 and 10).

When wave 1's `wave-done` arrives: re-measure the fingerprint, advance, settle the items read from
`GET /api/runs/:id/items`, review the handoff commit, then **open wave 2's run BEFORE closing wave
1's** — wave 2 stays in `ccrc-pwa`, so it reclaims wave 1's `sessionId` and closes wave 1 with
`final:false`.

Wave 2 is the AGENT-FIRST one: it ships to the fleet host before any server that calls it, and its
first task is the `READER_MIN_COLS` measurement (wrap-ansi over Claude Code's status-line shapes at
40–220 columns, no live session). Its brief must name the three tasks routed to `opus@high` — the
`win-size` verb body, the whitelist entry plus `REQUIRED_VERB_FLAG` and its bypass fixtures, and
`_pane_measurable` with its sweep over every typing site — and its mandatory security lens is the
exec grant.

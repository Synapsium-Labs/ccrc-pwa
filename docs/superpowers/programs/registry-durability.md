# Program: registry-durability

Spec: none — two carried Build-8 tickets (`docs/superpowers/plans/2026-08-15-fleet-robustness-build8.md`,
"Carried"); scope is stated per wave in this ledger, and each wave's worker commits its own plan.
Plan: per-wave, committed by the worker on the workspace branch (wave 1: `docs/superpowers/plans/2026-08-20-fleetio-measured-read.md`)
Workspace: `ccrc-pwa-plain-ridge` (wrapper `claude2`, branch `ws/plain-ridge`) — spawned by wave-1 dispatch, run 6
Coordinator: claude-ccrc-pwa (Fable tier — operator-set for this session)

**The first program driven through the `ccrc-worker` skill** (build4 predates it; its briefs
carried the whole protocol inline). The program's purpose is double, and deliberately so: retire
the two carried registry-durability tickets, and prove the worker-skill dispatch machinery live —
the pending proof the worker-skill slice named.

## Waves

| # | scope | PRs | state |
|---|---|---|---|
| 1 | The `FleetIO.readFile` null collapse: a result-returning read (absent vs unreadable) at the seam, local + remote halves, `field()` consumes it | run 6, PR #71 (merged e4da1dd) | done 2026-08-20 21:13 UTC — deployed both boxes, fleet agreed/agreed |
| 2 | `_reg_set` atomic writes (tmp+rename, same dir/filesystem); `_substrate_mark` rides the same helper | — | planned |

## Decisions & deviations

- **F-1 (2026-08-20, pre-dispatch — the program's first finding, found before its first call
  succeeded):** both skills taught `TOKEN=$(cat ~/.cc-secrets/ccrc-mail.token)` against the
  example-shaped token file (a `#`-comment preamble above one value line), so every coordination
  write answered a bare 400 before any route logic ran — the coordinator's own opening `GET` found
  it; a worker following its skill verbatim would have wedged on its first ack with no refusal
  code anywhere. Fixed in PR #70 (both skills + the wave-lifecycle reference now carry
  `deploy/notify.sh`'s exact extraction pipeline; a pin reddens on regression) and deployed
  agent-first before this program opened.
- **Wave 1 verdict (2026-08-20 21:08 UTC):** wave-done fingerprint `7c5072ca` verified by the
  server's own re-measurement (advance `working` -> `awaiting-review` -> `merging`, all ok);
  coordinator review ran four lenses (older-agent compat expression-by-expression, D-112/D-113
  premises against ccd source, wire/single-definition discipline, test honesty) with adversarial
  verification — ZERO blocking/major findings. Four minors, all carried as wave-2 items: (m1) the
  new single-definition pair guard matches only the `'absent' | 'unreadable'` ordering, and
  `server/test/` is outside its scanned roots; (m2) a dangling symlink ENOENTs and reads
  measured-absent — a listed name whose read answers `absent`, the one errno-semantics crack in
  D-112's "proven ENOENT" (exotic: no ccd verb writes symlinks); (m3) `watch.ts` ~:1840's comment
  overclaims "only `_reg_purge`" for listed-then-ENOENT identity reads — registry-dir loss
  mid-pass is a second producer, one-pass window, mass-parks where it used to stall degraded;
  (m4) `push-copy.test.ts`'s D-118 vacuous double is documented only in the plan — the test site's
  own comment still describes the degrade as live.
- **F-2 (2026-08-20, wave-1 settle):** work-item ids are not exposed over HTTP — the dispatch
  response omits them and there is no GET items route, so `POST /api/runs/:id/items` cannot be
  called from the API surface alone (`unknown-item` on guessed ids; they are one global
  autoincrement across runs). Settled by reading `~/.ccrc/coord.db` read-only on the server box.
  Roadmap candidate: return `{id,title}[]` from dispatch, or add `GET /api/runs/:id/items`.
- **D-108/D-109 (worker-reported, wave 1):** the ledger lives only on
  `origin/docs/registry-durability-ledger` until program close — a worker must fetch that ref to
  read it; and the worker's own first coordination call reproduced F-1's `cat` reflex one layer
  down (the skills were fixed; the failure still has no error code anywhere). Wave 1's full
  deviation ledger D-108..D-120 is in the plan, now on main:
  `docs/superpowers/plans/2026-08-20-fleetio-measured-read.md`.
- Wave order is dependency-free; sequential anyway (one workspace, and wave 2's ccd surface wants
  wave 1's registry semantics settled).

## Carried constraints

- Wave 1 must not regress the registry ladder's listed-vs-readable call sites — `.hold`,
  `.substrate` and the identity triple read presence off `RegistryRead.names` DELIBERATELY
  (`HOLD_UNREADABLE`/`SUBSTRATE_UNREADABLE`); migrate a call site only where semantics are
  provably identical, and say which in the plan.
- Older-agent tolerance is fail-shut: a frame omitting the new distinction reads `unreadable`,
  never `absent` (absence-permits, single reader).
- Wave 2 touches `ccd/ccd`: provenance re-stamp in every commit; agent-first deploy.

## Next-wave brief

Program `registry-durability`, wave 2 of 2 — the final wave. Ledger:
`docs/superpowers/programs/registry-durability.md` on `origin/docs/registry-durability-ledger`
(fetch that ref to read it; it is not on main until program close). Wave 1 merged as PR #71; its
deviation ledger is `docs/superpowers/plans/2026-08-20-fleetio-measured-read.md` on main.

GOAL — make `_reg_set` atomic. Today it truncates-then-writes in place
(`printf '%s' "$3" > "$REG/$1.$2"` in `ccd/ccd`), so a reader can catch a half-written or empty
field mid-write; the registry's whole read side (including wave 1's measured reads) deserves a
write side that never exposes a torn state. Settled shape (do not redesign): write to a tmp file
IN THE SAME DIRECTORY (`$REG`), same filesystem, then `mv -f` (rename(2), atomic replace) into
place. THE INVARIANT D-112 RELIES ON MUST SURVIVE AND THE PLAN MUST SAY SO EXPLICITLY: today the
name never disappears because `_reg_set` truncates and never unlinks; with tmp+rename the name
still never disappears because rename atomically replaces — there is NO ENOENT window at any
point. Choose a tmp naming scheme that (a) cannot collide across concurrent supervisors
(`$$`/mktemp), (b) is invisible to registry LISTING consumers — check every reader of `$REG`'s
directory listing (server `readRegistryMeasured`/`RegistryRead.names`, ccd's own globs, doctor
checks) and either name tmps so no glob matches (e.g. leading dot) or prove each reader ignores
them; state which in the plan. `_substrate_mark` writes through the same helper — its
FIRST-WRITE-WINS check (existence test before write) must stay correct under the new scheme, and
`_reg_set`'s other callers (supervisor heartbeat stamps every tick) must not regress in cost or
semantics. Survey every `_reg_set` call site and every direct `> "$REG/..."` write that bypasses
it; migrate bypassers onto the helper where semantics allow, or document why not, per site.

CARRIED FROM WAVE-1 REVIEW (four minors, all small, do them after the main work): (m1)
`server/test/single-definition.test.ts`'s absent/unreadable pair guard: make it order-insensitive
(`'unreadable' | 'absent'` must also trip it); (m2) the dangling-symlink residual — a symlinked
`$REG` marker whose target is gone ENOENTs and reads measured-absent though listed; do NOT build
an lstat ladder, just state the residual honestly in `server/src/io.ts`'s and
`agent/src/fileops.ts`'s contract comments where 'absent' is specified; (m3)
`server/src/watch.ts` ~:1840 — the absence-route comment claims `_reg_purge` is the only
listed-then-ENOENT producer; registry-directory loss mid-pass is a second one (fleet-wide,
one-pass window) — fix the sentence; (m4) `server/test/push-copy.test.ts`'s second
"blocking review finding 2" test — add a site comment stating the degrade double is currently
dead (plan D-118) so its reader does not mistake it for live coverage.

CONSTRAINTS. `ccd/ccd` is agent-side bash: every commit touching it re-stamps the provenance
marker IN THAT COMMIT — from repo root:
`node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"`.
Deploy is agent-first but is NOT yours (out of scope). ccd tests run ONLY against fixture HOMEs
(`makeCcdHarness`, `server/test/ccdWsHelpers.ts`) — never the live `$HOME`; suites from inside
each package as `./node_modules/.bin/vitest run` (never bare `npx vitest`), foreground. TDD
red-first; every new guard mutation-measured with before/after counts in the plan's deviations.
Known load-flaky suites (`ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`,
`ccd-session-state`): re-run in isolation before calling a real break.

FIRST TASK: survey (call sites of `_reg_set`, direct `$REG` writes, tmp-visibility across
listing readers) and commit a short plan
(`docs/superpowers/plans/2026-08-20-regset-atomic-write.md`) ON THIS WORKSPACE'S BRANCH, then
execute it with `superpowers:subagent-driven-development` — the execution skill this brief names.

Commit on this workspace's own branch; do not create or switch to a separate feature branch.

DONE = PR open from the workspace branch against main, CI green, `wave-done` mail whose body
carries the JSON fingerprint `{branchTip, prNumber, prPhase: "open", handoffCommit}` with
`branchTip === handoffCommit ===` the branch tip's 40-hex sha.

OUT OF SCOPE: merging, deploying (the coordinator's, agent-first); any new ccd verbs; any
registry read-side semantic change beyond the comment fixes named above.

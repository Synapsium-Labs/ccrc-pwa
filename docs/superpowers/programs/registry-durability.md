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
| 2 | `_reg_set` atomic writes (tmp+rename, same dir/filesystem); `_substrate_mark` rides the same helper | run 7, PR #73 (merged ba30ddf) | done 2026-08-21 02:20 UTC — deployed both boxes, fleet agreed/agreed |

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
- **Wave 2 verdict (2026-08-21):** first wave-done (`daff8831`) verified and reviewed — four
  lenses, adversarially checked, NO correctness defects; three review findings sent back for one
  fix round (the designed `awaiting-review` -> `working` path, its first live use): R-1 the
  cmd_ws_hold guard comment still described the pre-wave `printf > file` body (three lenses found
  it independently); R-2 the pr-state lock comment overstated the unlocked-CAS widening (an
  existing 0664 lock file opens under a 0555 $REG); R-3 a dot-leading PROJECT id aliases ccd's own
  dotfile locks in `_reg_purge`'s glob (`.prstate-`, and the pre-existing `.reap-`/`.ws-add-`
  pair). Worker fixed all three — taking R-3's authorized hardening: `_ws_project_valid` refuses a
  leading dot at the two creation sites only, mutation-measured — plus a five-item self-audit.
  Final fingerprint `fceee24a` re-verified, merged, closed `released:true`. Wave-2 deviations
  D-121..D-138 in `docs/superpowers/plans/2026-08-20-regset-atomic-write.md`.
- **Residuals recorded, deliberately not fixed:** `server/test/` stays outside
  single-definition's scanned ROOTS (D-128); tree-wide `ccd:<N>` line-citation drift is systemic
  and pre-dates the program (~500 cited lines; CI anchor check is the roadmap candidate,
  D-129/D-137); registry file modes carry no invariant (D-122/D-135's two disclosed edge flips).

## Program closed

Both waves merged (PR #71, PR #73), deployed agent-first then server, fleet agreed/agreed on
`ba30ddf`. Run 7 closed `final:true`, `released:true` — the workspace claim is handed to the
ordinary sweep. This was the FIRST program driven end-to-end through the `ccrc-worker` skill:
both wave briefs were read, acked and executed by the skill's protocol; the review-fix round
exercised `awaiting-review -> working` live; findings F-1 (skill token read, fixed pre-open in
PR #70) and F-2 (work-item ids unexposed over HTTP) are the coordination-surface yield.

## Carried constraints

- Wave 1 must not regress the registry ladder's listed-vs-readable call sites — `.hold`,
  `.substrate` and the identity triple read presence off `RegistryRead.names` DELIBERATELY
  (`HOLD_UNREADABLE`/`SUBSTRATE_UNREADABLE`); migrate a call site only where semantics are
  provably identical, and say which in the plan.
- Older-agent tolerance is fail-shut: a frame omitting the new distinction reads `unreadable`,
  never `absent` (absence-permits, single reader).
- Wave 2 touches `ccd/ccd`: provenance re-stamp in every commit; agent-first deploy.

## Next-wave brief

None — the program is closed.

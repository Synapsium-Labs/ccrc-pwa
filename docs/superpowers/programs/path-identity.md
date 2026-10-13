# Program: path-identity

Spec: `docs/superpowers/specs/2026-10-12-path-identity-design.md` (W0; merged as #360 = `837a099c0`, 2026-10-12 18:48)
Plans: `docs/superpowers/plans/2026-10-12-path-identity-w1a-server-id-gate.md` (W1a), `docs/superpowers/plans/2026-10-12-path-identity-w1b-ccd-id-hardening.md` (W1b); W2 and W3 plans later
Contract: `docs/superpowers/programs/child-reclamation-contract.md` (this programme continues CCR-15's contract; its rulings land in a new section)
Home project: `ccrc-pwa`   Coordinator: `ccrc-pwa-calm-mesa`   Workspace: **a fresh child per wave**
Parent programme: `child-reclamation` (CCR-15). Its contract R71 names this follow-up.

**What this programme is.** CCR-15's destructive verbs compare a spelling where their safety argument needs an
identity: an id string where it needs the session the id means, and a path string where it needs the inode the
path reaches. This programme replaces each such comparison with an identity check, or holds when identity cannot
be measured. Every change refuses or holds more at the verb it touches. The spec's section 7 lists all 41 carried
items, each with its wave and its decision.

## Waves

Run-level wave numbers map onto the spec's wave names as below. W0 (the spec) needed no run. W4 is not scheduled
(PG1 B); the collector's Settings switch is CCR-15's wave 10, not a wave here (SW6 A).

| # | spec name | scope | deploy class | PRs | state |
|---|---|---|---|---|---|
| — | W0 | the spec, this ledger, and the contract's rulings section | docs | #360 | **merged** `837a099c0` (2026-10-12 18:48); the contract section rides the first plan's docs PR |
| 1 | W1a | the server's id gate (spec 2.3): `isRegistryId`, `readSessionRecord.kind`, `RegistryRead.refused`, the split of the 12 `readRegistry` callers, `knownId`, `POST /api/runs`, every stored-row argv seam and the two executor seams, and the stop builders' order | server | — | **planned** — run **399**; block of 24 issued (listed in the 18:53 entry); plan written 2026-10-12 23:40, lands in the docs PR |
| 2 | W1b | ccd's id fix (spec 2.4 to 2.6): the decision-flag loops, the predicates, the composed-id cap, the reap-lock order, the dot-leading entry rule, and the real-binary parity pins | **ccd/ccd** | — | not opened; plan written 2026-10-12 23:40; waits for #351 (workspace-lifecycle W6) to merge |
| 3 | W2 | absences and mounts (spec section 3) | ccd/ccd + server | — | not opened; after W1b; needs workspace-lifecycle's consent |
| 4 | W3 | worktree path identity (spec section 4) | ccd/ccd | — | not opened; after W2; needs workspace-lifecycle's consent |

## Decisions & deviations

- **2026-10-12 23:40 — W1A'S AND W1B'S PLANS ARE WRITTEN** (beside CCR-15 wave 10's, by the same process: grounding, an architect/critic/reviser frame, one Opus drafter per task, a sliced two-lens review with Sonnet refuters, and a convergence review).
  - **W1a** (`2026-10-12-path-identity-w1a-server-id-gate.md`, 18 tasks, server only). Rulings beyond the spec, all in the plan:
    - `isRegistryId` sits at the foot of `shared/api.ts`, and `TMPROOT_ID_MAX_CHARS` becomes its derived alias until after #351;
    - a refused id is omitted, never retained, and is logged once;
    - abandon closes a run whose stored id fails the predicate as `failed` with no fleet act;
    - the reclaim door answers `bad-session` for a bad heir or a bad stored claimant;
    - `/ensure` and the cross-pool swap gain a route-head check;
    - `POST /api/runs` also refuses a dash- or dot-leading work-run `project`;
    - `childGateAtClose` is exported for its own pin;
    - stop's pair form refuses a flag-shaped registry field before composing (`stop-pair-fields-refused-at-composition`).
  - **W1b** (`2026-10-12-path-identity-w1b-ccd-id-hardening.md`, 14 tasks, `ccd/ccd`). Rulings beyond the spec:
    - **The composed-id cap is 128** (R27, option a), not the spec's 222. The session hook already skips an id longer than 128, so a longer id would be a session that silently loses its hook card. Nothing on the fleet comes near it: the longest id is 31. This was reported to the operator and is reversible before W1b dispatches.
    - `enable`'s two-argument form checks its wrapper (cmd_start's own check and words) before any journal line or lock.
    - The collector's pre-lock pass proves its registry listing by measurement.
  - **Carried, owner this ledger:** `abandon-sheet-misreads-an-omitted-fleet-act`, `reclaim-sheet-drops-the-bad-session-detail` (both PWA, placed with the next wave that edits `pwa/`) and `work-run-project-reaches-ws-add-unchecked` (closed by W1b's ws-add loop).

- **2026-10-12 18:53 — WAVE 1 (W1a) IS RUN 399, `planned`.** It was opened at 18:52 beside CCR-15's run 400, before run 380 closed. Its block is 24 numbers, issued by the allocator: 4860, 4861, 4862, 4863, 4864, 4865, 4866, 4867, 4868, 4869, 4870, 4871, 4872, 4873, 4874, 4875, 4876, 4877, 4878, 4879, 4880, 4881, 4882, 4883.

- **2026-10-12 18:51 — THE PROGRAMME OPENS. The operator merged the W0 spec (#360, 18:48:11Z) and wrote "360 merged", naming no exception.**
  - **How I read the merge.** It approves the design with its recommendations. Each row marked Operator takes its recommended option as the working ruling. Each row marked Coordinator stands as proposed. The operator can change any of them before the wave that builds it dispatches; a change after dispatch becomes a fix round.
  - **SECURITY:** SEC1 D (all eight `--session` loops, plus stop and ws-add's loop), SEC2 B (registry readers, `knownId`, `POST /api/runs`, every stored-row argv seam and the two executor seams; no builder brand or builder assertion now), SEC3 C (both predicates and loops), SEC4 A (tighten `_ws_project_valid` after a Task 0 re-count), SEC5 C (cap the composed id at 222 at every mint site), SEC6 A (the no-dot-leading entry rule at ws-reclaim and ws-expire), SEC7 A (pure checks before the collect reap lock), SEC8 A (W1a now, W1b after #351).
  - **Temp roots and mounts:** TR1 A, TR2 A, TR3 A, TR4 A, TR5 C, TR6 A, TR7 A, TR8 A, TR9 C, TR10 C, TR11 C (W4 does not run), TR12 B.
  - **Worktree identity:** PI1 B, PI2 L1, PI3 B, PI4 D, PI5 A, PI6 M4, PI7 P1 (P2 where the field is valid), PI8 B2, PI9 K1, PI10 O2.
  - **Programme:** PG1 B (W4 is not scheduled; its residuals stand), PG2 A (workspace-lifecycle's consent per wave, for W2 and W3).
  - **The switch (SW1 to SW7) is CCR-15's wave 10** and is recorded in that ledger.
  - **Sign-in is armed on the server box** (measured 18:5x from anonymous reads: `GET /api/auth/status` answers `mode: "passphrase"`; a protected read without a session answers 401).
  - **The order.** W1a ships first, in parallel with CCR-15's wave 10. W1b waits for #351. W2 and W3 follow in series, because every `ccd/ccd` edit is serial.

## Carried constraints

- **Every `ccd/ccd` edit waits for workspace-lifecycle W6 (#351) to merge, and the ccd waves then go in series** (W1b, W2, W3). W1a and CCR-15's wave 10 edit no `ccd/ccd`.
- **Anything shared with ws-expire needs the consent of workspace-lifecycle's coordinator, per wave** (PG2 A). That covers W2's tail and step 4, and W3's ladder, tail and ws-expire's probe.
- **Review 388's carries:** the wave-9 lane-case title over-claims order (item 38), the contract's Task 5 line counts three indents where there are two (item 39), and `collectBoxProbesAtArrival` says "latest change" at four sites (item 40). Items 38 and 40 ride CCR-15's wave 10 if it touches those files, otherwise W2; item 39 rides the contract section.
- **Comment carries that need a `ccd/ccd` restamp** (items 29 to 31) ride the first wave that restamps `ccd/ccd`, which is W1b. They are worded line-neutrally, because the collector header sits under the frozen citation-corpus anchors.
- **The macOS purge-refused red** (item 37) is a stated residual; reopen it only if it recurs.

## Next-wave brief

**Wave 1 is W1a, run 399, `planned`: the server's id gate.** Its plan is
`docs/superpowers/plans/2026-10-12-path-identity-w1a-server-id-gate.md`, binding with contract §17 and spec section 2.
It reaches `main` in the same docs PR as CCR-15 wave 10's plan, and the brief names that PR's squash commit as `planSha`.

Before dispatch, re-read `GET /api/claims?project=ccrc-pwa` and record each overlap's agreement in the brief (R56: the
second lander merges `main` and re-points by content): CCR-15 wave 10 (run 400) shares the `shared/api.ts` foot,
`watch.ts`, `coord/routes.ts`, the `single-definition.test.ts` foot and the `mail-routes.test.ts` kebab census;
workspace-lifecycle wave 6 (#351, run 358) edits `coord/expireArchived.ts` and `watch.ts`.

Then dispatch one fresh child. **Route:** `{class:'opus', effort:'xhigh', subagent:'sonnet', workflow:'on',
compact:'40'}`. **Execution skill:** `superpowers:subagent-driven-development`, with
`superpowers:test-driven-development`. **Lenses:** the plan's mandatory SECURITY lens beside the held-out panel.

**Wave 2 is W1b.** Open its run only after #351 merges; allocate its block then. Before dispatch: workspace-lifecycle's
coordinator's consent to its three `ws-expire` edits; the server box's ls-only counts, `max-id-len` included (Task 0).

# Program: path-identity

Spec: `docs/superpowers/specs/2026-10-12-path-identity-design.md` (W0; merged as #360 = `837a099c0`, 2026-10-12 18:48)
Plans: `docs/superpowers/plans/2026-10-12-path-identity-w1a-server-id-gate.md`, `docs/superpowers/plans/2026-10-12-path-identity-w1b-ccd-id-hardening.md` (to be written); W2 and W3 plans later
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
| 1 | W1a | the server's id gate (spec 2.3): `isRegistryId`, `readSessionRecord.kind`, `RegistryRead.refused`, the split of the 12 `readRegistry` callers, `knownId`, `POST /api/runs`, every stored-row argv seam and the two executor seams, and the stop builders' order | server | — | **planned** — plan to be written |
| 2 | W1b | ccd's id fix (spec 2.4 to 2.6): the decision-flag loops, the predicates, the composed-id cap, the reap-lock order, the dot-leading entry rule, and the real-binary parity pins | **ccd/ccd** | — | not opened; waits for #351 (workspace-lifecycle W6) to merge |
| 3 | W2 | absences and mounts (spec section 3) | ccd/ccd + server | — | not opened; after W1b; needs workspace-lifecycle's consent |
| 4 | W3 | worktree path identity (spec section 4) | ccd/ccd | — | not opened; after W2; needs workspace-lifecycle's consent |

## Decisions & deviations

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

**Wave 1 is W1a, the server's id gate.** It is server-only and edits no `ccd/ccd`. Its plan is
`docs/superpowers/plans/2026-10-12-path-identity-w1a-server-id-gate.md`, to be written from spec section 2.3 and
section 2.8's server rows, under SEC2 B and SEC8 A. It reaches `main` in one docs PR before dispatch, and the
brief names that PR's squash commit as `planSha`.

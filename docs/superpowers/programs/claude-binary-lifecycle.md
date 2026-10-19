# Program: claude-binary-lifecycle

Spec: `docs/superpowers/specs/2026-10-18-claude-binary-lifecycle-design.md` (rev 3.1, approved by the operator 2026-10-19; rev 3.1 applies two reviews without changing a ruling)
Plans: `docs/superpowers/plans/2026-10-19-claude-binary-lifecycle-w1-observe.md` (wave 1, CB1a to CB1h),
`docs/superpowers/plans/2026-10-19-claude-binary-lifecycle-w2-roll.md` (wave 2 and W2a, CB2a to CB2h, OA-2 and OA-3),
`docs/superpowers/plans/2026-10-19-claude-binary-lifecycle-w3-install.md` (wave 3, CB3a to CB3j, OA-4 and OA-5),
`docs/superpowers/plans/2026-10-19-claude-binary-lifecycle-w4-self-update-off.md` (wave 4, CB4a),
`docs/superpowers/plans/2026-10-19-claude-binary-lifecycle-w5-auto-roll.md` (wave 5, CB5a to CB5c, OA-6)
Home project: `ccrc-pwa`   Brief: CCRCP-32 (GitHub #218)   Workspace: **a fresh child per wave**
**Status: approved; wave 1 in progress** (R2, 2026-10-19; CB1a landed as #726). The spec's rev 3, the five plans and this ledger land in one docs PR.

**What this program is.** ccrc owns Claude Code releases on the fleet.
- **Observe** (W1): every session's running build against its (node, lane kind) target, on the card, in the facts and on Settings → Updates.
- **Roll** (W2): `ccd roll`, a same-account restart in place that shares hibernation's gate, resumes strictly and runs its act detached; the operator's **Restart onto 2.1.x**; the first canary is the operator's (W2a).
- **Install** (W3): one ccrc-owned installer per node, verified by signature and checksum, publishing a candidate that only a canary runs; a passed canary approves the build for its pair; the launcher, adopted, serves the approved target to every spawn; the upstream token on a descriptor.
- **Self-update off** (W4): each account's own updater off once the installer is proven, reversible.
- **Auto-roll** (W5): a serial, memory-aware, budget-sharing scheduler, shadow first, halts that pin nothing.

## Waves

| # | scope | deploy class | tasks | PRs | state |
|---|---|---|---|---|---|
| 1 | observe: lexicon, deny rules, switches and `_mem_headroom`, installer in measure mode, the tenth node file, `FleetSession.claude`, chip and facts, the Settings card read-only | AGENT-FIRST (fleet), then server; PWA after S7a, S16, R2b1, R2b2 | CB1a to CB1h | #726 (CB1a) | in progress |
| 2 | the roll: strict resume, the spawn carrier, `ccd roll` gate, act, canary health; the server's argv, holds, token and route; Restart onto | AGENT-FIRST (fleet), then server; PWA after S2d | CB2a to CB2h | — | not started |
| 2a | the first manual canary, per (node, lane kind) | operator act | OA-2, OA-3 | — | not started |
| 3 | install: intent and projection, pull, routes, canary approval, installer live, launcher adopted, descriptor, prune, bootstrap, Settings controls | AGENT-FIRST (the launcher is every lane's exec path), deployed by OA-4 | CB3a to CB3j | — | not started |
| 4 | each account's own updater off once proven | FLEET, self-gated | CB4a | — | not started |
| 5 | auto-roll: scheduler, halts, retreat, Settings controls; then shadow and live per node | server, PWA, then operator act | CB5a to CB5c, OA-6 | — | not started |

## Gates (between waves, and against the PRs open on 2026-10-19 at `f82d0c015`)

| Gate | Holds | Tasks it gates |
|---|---|---|
| #435 (session continuity wave 4b; `ccd/ccd`, `ccdWsHelpers.ts`, the doctor checks, the spawn and resume tests) | open | CB1c, CB1d, CB2a to CB2e, CB3f, CB3g, CB4a |
| #397 (path identity W1a; `fleet.ts`, `server.ts`, `ccdargv.ts`, `shared/api.ts`, `single-definition`, `whitelist-subset`) | open, `CONFLICTING` | CB1b, CB1f, CB2f, CB2g, CB3c, CB5a, CB5b |
| #700 (a coordinator names its child; `ccdargv.ts`, `coord/routes.ts`, `shared/api.ts`) | open | CB1b, CB1f, CB2f, CB2g, CB3c |
| skins W2 S7a, S16 | unbuilt | CB1g |
| skins W2 S2d | unbuilt | CB2h |
| Settings R2b1, R2b2 | unbuilt | CB1h, CB3j, CB5c |
| OA-1 (M1) | not run | CB1f |
| OA-2 (M2) | not run | OA-3 |
| OA-3 passed on at least one pair; W1's node file green 24 h; per node, every (node, kind) pair with live sessions has a passed canary or takes the adoption's seeded target | — | OA-4 |
| M4, M5 (development fixtures) | not run | CB3g, CB3e (their Step 0) |
| M3 (development fixture) | not run | CB5a (its Step 0) |
| hibernation Task 19's shadow week and first armed day | not started | automatic rolls (held as `hibernation-arming` in the act path); OA-6 (never during them). **When Task 19's shadow week starts, the operator runs `ccd claude shadow-week on` on every fleet node, and `off` when it ends.** |

## Operator acts

- **OA-1, M1 (before CB1f).** Read-only on the fleet node: `FleetSession.version` against `/proc/<pid>/exe` per session, and the source of "2.1.9x". Names the SAFETY rule; touches nothing.
- **OA-2, M2 (before OA-3).** Read-only on the fleet node: how many behind sessions carry `crons` in their turn marker.
- **OA-3, W2a: the first manual canary** (decisions 3 and 8), per (node, lane kind), `anthropic` first, `codex` its own run: the operator names one idle behind session and taps Restart onto <candidate>. The one allowed live roll during development; the ask names that SAFETY exception.
- **OA-4, the W3 adoption** (AGENT-FIRST, gated): fleet lane first; `ccrc install` on each `fleet`/`both` node, confirming the kept-aside launcher's token-file reference becoming the roster's `exec.secretsFile` and the seeded target it prints for each kind with no approved target; the adoption marker, written last, turns install mode and the prune on; doctor green before the server lane. Rollback: `ccrc install --restore-launcher`, which works with sessions live.
- **OA-5, the bootstrap** (decision 15): once, by the operator, in `ccrc install`, only for a node with no Claude Code build.
- **OA-6, per node, the automatic roll** (decisions 3 and 13), in this order: a reviewed shadow week (the shadow runs while the node is still `manual`, once its first canary passed), then mode `auto`, then `ccd claude roll-live on`; never during hibernation Task 19's shadow week or first armed day, which the act path also enforces (`hibernation-arming`).

## Decisions & deviations

- **R1 (2026-10-18)**, the spec's rev 2 (#642), after three reviews.
- **R2 (2026-10-19)**, approval and the rulings. The operator answered the spec's sixteen decisions through the superpowers visual companion, in their words "all cards accepted/answered": every card at its recommended option A, U1 clicked explicitly. In short: U1 `latest`; U2 90 min; U3 `auto` per node after its first manual canary and one shadow week, `manual` until then; U4 a new `.no-roll`; U5 self-update off once proven, visible, reversible; U6 3 GiB headroom only, swap shown; U7 the manual Restart skips only the quiet window; U8 canary per (node, kind); U9 resume only on Ack, a newer build never blocked by an older; U10 halt only, no pin-back; U11 the descriptor, the launcher reads no secret; U12 notify with a one-tap pin; U13 no automatic rolls during hibernation's shadow week, roll restarts tagged; U14 the card on Settings → Updates, the mode under Automation; U15 the operator's one-time bootstrap; U16 arming hibernation stays Task 19's. The spec's §13 records each with its alternatives not taken; its rev 3 carries them through the body.
- **R3 (2026-10-19)**, the swap ruling reaches this design. The operator's ruling of the same day on the Accounts design (account switching and the auto-swap are never blocked) contradicted rev 2's `cmd_swap` refusing a live `.rolling`, and its 15 min canary soak inside the record. Rev 3: a roll yields (`swapping` hold); a swap waits at most the act's deadline and is never refused; the soak runs after the record in `.claude-canary`, and a swap during it is `inconclusive`.
- **R4 (2026-10-19)**, two items move to W1: the deny rules of the spec's §7.6 (CB1b) and every operator switch verb (CB1c), so no verb or act lands before its guard.
- **R5, the numbers.** The allocator issued D-5695 to D-5724, thirty numbers, one per task. Each is defined once in its wave plan's §Deviations and decisions: W1 D-5695 to D-5702; W2 D-5703 to D-5710; W3 D-5711 to D-5720; W4 D-5721; W5 D-5722 to D-5724. The spec's twelve decision slugs carry D-5699, D-5700, D-5703, D-5704, D-5705, D-5709, D-5711, D-5715, D-5716, D-5721, D-5722 and D-5723 (its §14). There is no spare: a departure found during a wave is named by slug in the wave-done mail, and the coordinator asks the allocator for a new number at wave-done.
  - **Issued and unused:** none.
  - **Note:** the spec's PR (#642) named, in its title, a range starting at 5533, but no number from that range was ever defined or cited for this programme; the coordinator reconciles that with the allocator (open item 1).

- **R6 (2026-10-19)**, rev 3.1: two reviews of rev 3 and the plans, both NEEDS REVISION; every finding was checked against `origin/main` `bd363a76b` and applied, none rejected, no ruling changed and no number added. In short: headroom is the minimum over levels of each level's own `max − anon` (the user tree binds today); a manual canary onto a newer candidate in every wave; an upstream retreat is its own record and halts are scoped, so neither downgrades; install mode and the prune gated on the adoption marker; the upstream descriptor opened inside the pane by a ccrc helper; `roll-in-flight` under a node lock and a spawn-start stamp; a seeded target so no pair exits 127 after the adoption; `.claude-build` dropped on a halted build and a failed soak restored; `hibernation-arming` in the act path with `ccd claude shadow-week on/off`; `ccrc install --restore-launcher`; `ccd claude mem`; the install lock taken inside the act; the fingerprint twins; the swap wait in the detached re-run only, 270 s, with a yield marker; shadow before `auto`; the instrument skips `cause=roll`; stale records recovered at once; own-pid OOM fails a canary; restore on any criterion; per-wave rollbacks; route mappings and notify from W2. Each plan's §Review log lists its rows.

## Rollback, per wave

- **W1:** server lane first, then disable and remove the installer's timer and units on the fleet node; the deny rules stay.
- **W2:** `ccd claude roll-disable`; wait until no `.rolling` and no unjudged `.claude-canary` remains; server lane back first, then the fleet lane; keep the unit drop-in until no `.rolling` exists.
- **W3:** `ccrc install --restore-launcher` per node first (installer and prune fall back to measure), then `ccd`, then the server lane.
- **W4:** `ccd claude self-update keep`.
- **W5:** `ccd claude roll-live off` (or `roll-disable`), mode `manual`, then the server lane.

## Carried constraints

- **Public repository**: neutral names only (`lane-a`, `upstream-a`, `the fleet node`); no hosts, IPs, tailnet names, account or lane names, absolute home paths or emails.
- **SAFETY**: no session runs `ws-expire`, `ws-reclaim` or `ws-reap`, or touches tmux, a unit or a registry directly; every `ccd` test runs in a fixture HOME; measurements on the fleet node are operator acts, read-only.
- **AGENT-FIRST** deploys: the fleet agent's lane before the server's, from a fresh `origin/main` worktree as a detached unit, verified from its log.
- **No herd**: one roll per node at a time, behind the memory gate and the 120 s `recent-spawn` hold (74 of 194 measured OOM kills came within 120 s of a restart).
- **The operator's account switching and the auto-swap are never blocked** (2026-10-19).
- **UI** is checked at 360, 390, 1280 and 1920 × Refined and Instrument × dark and light; Settings tasks also at the Settings plan's 438, 900, 1024 and 1440.
- **Band 3, two reviewers** for anything that installs binaries, restarts sessions, selects what a launcher runs, or touches credentials or deny rules.

## Open items

1. The range starting at 5533 named in #642's title: never defined in the tree; the coordinator confirms with the allocator that nothing is owed against it.
2. CB1d's Step 0: if no published fingerprint for the release signing key can be found, the keyring is not committed and the question returns to the operator.
3. CB3g's Step 0 (M4): if no descriptor variable fits the upstream token kind, or Claude Code leaves the descriptor or the variable to its tool children, the question returns to the operator (decision 11's alternatives were not taken).
4. The Settings plan's C5 is answered in that plan (2026-10-19); R2b2 builds the ordered list the card is inserted into.

## Next-wave brief

**Wave 1** (CB1a to CB1h; `…-w1-observe.md`). Start with CB1a (lands now) and CB1b (after #397 and #700). CB1c and CB1d wait for #435. Ask the operator for OA-1 (M1, read-only) before CB1f. CB1g waits for skins S7a and S16; CB1h for Settings R2b1 and R2b2. Every task's red list, mutation table and verify commands are in the plan; numbers D-5695 to D-5702 are defined there and are not to be redefined. Deploy the fleet half AGENT-FIRST.

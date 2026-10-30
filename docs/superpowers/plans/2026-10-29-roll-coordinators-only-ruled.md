# Automatic rolls take idle coordinators only, ruled

- **D-7443 (2026-10-29)** — automatic rolls take idle coordinators only; every other session picks up a new build when it next starts

**Superseded in part, the same day.** The operator's later rulings built the roll's release half and removed `all`. See `2026-10-29-auto-roll-release-ruled.md` (D-7452 to D-7454). The setting is now `coordinators | off`, and it lives on its own Settings › Automation row ("Roll idle sessions"), stored in `roll_settings`. `rollTargetVerdict` is the setting-and-role filter inside `autoRollVerdict`, whose caller is the sleep executor's roll row. The rest of this file describes the predicate as first written. Where it says `all`, or that nothing calls the predicate, the later file is the record.

**The ruling.** The operator, 2026-10-29: "Always auto-roll all coordinators when they go idle, but never auto-roll any non-coordinators." Their reason: many idle non-coordinator sessions will never do real work again, and a useful one may be working constantly, so rolling either one is waste or disruption. A coordinator should follow the new rules (a new release, a new binary, new skill text) as soon as it is idle. A non-coordinator picks up the new release or binary only when it next starts for another reason.

**What ships here.**

- `shared/claudeVersion.ts`: `CLAUDE_ROLL_TARGETS` (`coordinators`, `all`) and `CLAUDE_ROLL_TARGETS_DEFAULT` = `coordinators`. This is the setting's vocabulary, with the rule as its default.
- `server/src/coord/rollTarget.ts#rollTargetVerdict`: the one predicate every automatic roll picker calls. Its input is the session's role and whether the roll verdict found it idle. Its answer is `take`, or a named skip: `role-unknown`, `not-coordinator` or `busy`, tested in that order (`ROLL_TARGET_SKIPS`).
- `server/test/roll-target.test.ts`, red first. The rows: an idle coordinator is rolled; an idle worker is not; a worker with an unreadable marker is not; a busy coordinator is not; a busy worker is skipped as `not-coordinator`, not `busy`; an unknown role is never rolled under either setting; under `all` an idle worker is rolled and a busy one is not.

| Mutant | Expected red | Measured |
|---|---|---|
| the role check removed | "an idle worker is not rolled" | red (3 rows) |
| the idle check removed | "a busy coordinator is not rolled" | red (2 rows) |
| an unknown role passes | "a row whose role is unknown is never rolled" | red (2 rows) |
| busy tested before the role | "a busy worker is named for its role" | red (1 row) |
| the default set to `all` | "the rule is the default" | red (3 rows) |
| the setting ignored | "under `all`, an idle worker is rolled" | red (2 rows) |

**Why the predicate has no caller yet.** Nothing in the tree today restarts a running Claude Code process onto a new ccrc release or a new Claude Code binary, so there is no existing picker to filter. Measured on 2026-10-29:

- `ccrc update`'s sweep (`_upd_sweep`, `ccd/ccrc`) runs `systemctl --user try-restart` over every `claude-session@*` unit. That unit runs only `ccd supervise` with `KillMode=process`, and `cmd_ensure` re-attaches to the live pane. On the fleet node, the 07:07 update restarted 31 supervisors and started no Claude Code process and no MCP sidecar. The sweep picks up new `ccd` code, not a new binary or new start-time context, so it is not a roll and this ruling leaves it alone.
- The auto-swap (`_auto_swap_check`, `ccd/ccd`) restarts a session for limit or home-account reasons, never for a release or a build. The swap is never blocked (the ruling of 2026-10-19), and this ruling does not touch it. A swapped session starts on the current release and binary as a side effect, which is the "next starts for another reason" the ruling names.
- Hibernation and its wake (`server/src/sleepLane.ts`, `ccd ensure`) stop and start sessions. A woken session starts on the current release and binary, so a worker already gets the new build when it next starts.
- The automatic roll is the binary-lifecycle programme's wave 5 (`2026-10-19-claude-binary-lifecycle-w5-auto-roll.md`, CB5a to CB5c), and it is not built. Only wave 1's deny rules have landed.

**What binds wave 5.** The merged spec and wave plans are append-only, so this file and the programme ledger's R8 are the record. CB5a and CB5c build on it:

1. **CB5a's candidate step** calls `rollTargetVerdict(targets, { role: FleetSession.role, idle })` before it spends a slot, where `idle` is `rollVerdict`'s answer (the 90 min quiet window and the holds of spec §7.2). A skip is a hold like any other. The shadow logs it by name at most once per id per hour, and `/api/fleet/health` counts it. CB5a's red rows gain: "an idle child is never dispatched and is counted `not-coordinator`"; "a row with no role is counted `role-unknown`"; "an idle coordinator is the sweep's first candidate".
2. **Manual rolls never call it.** The operator's Restart onto 2.1.x (spec §7.5) and `ccd roll` itself take any session the gate passes. The operator chose the session.
3. **The setting.** CB5c adds a row under Settings → Automation, beside the roll mode (decision 14 puts the mode there): "Automatic rolls take: coordinators only (default) / every idle session", stored as `targets` on the Claude Code intent. It is a Settings row rather than a `ccrc.env` key because every other roll control lives in Settings. Until CB5c lands, the default is the only value anything passes.

**The role.** It is the fleet's one derivation, `sessionRoleOf` (`shared/api.ts`): a session with no `.child` marker is a `coordinator`, and only a dispatch writes `.child`. The fleet has no third role. Every session the operator creates is its project's coordinator (D-5301), so an idle operator-made session is rolled. Leaving operator-made sessions out would need a new marker and is not built. A row whose role is unknown (an older build's snapshot) is never rolled.

**Open item.** The ruling also asks that a coordinator follow new skill text and a new ccrc release. Spec §7 rolls only a session whose Claude Code build is behind. A coordinator already on the current build that started before the node's current ccrc release is behind on the rules but not on the build, and the spec's route answers `not-behind` for it. Whether CB5a rolls such a coordinator onto its own build needs a measurement first: does `ccd roll`'s gate (CB2c) accept `--to` equal to the running build, and does the node file record when the current release was installed? CB5a's reviewers decide it, and it does not change this predicate.

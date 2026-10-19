# Claude Code binary lifecycle, wave 4: each account's own updater, turned off once the installer is proven — Implementation Plan

> **For agentic workers:** one PR, Task CB4a. REQUIRED SUB-SKILL: superpowers:subagent-driven-development, with superpowers:test-driven-development for the red-first step. Band 3 (it changes the environment every session is spawned with), written and reviewed natively, never handed off, **two reviewers**. Workers do not edit §Deviations and decisions.

**Spec:** `docs/superpowers/specs/2026-10-18-claude-binary-lifecycle-design.md` (rev 3, approved by the operator 2026-10-19: "all cards accepted/answered"), §8.2 and §11 (W4).

**Status:** rev 0 (2026-10-19), written with the spec's rev 3, the other wave plans and the ledger.

**Inputs.** The spec's §8.2; the operator's ruling 5 (automatic once the installer is proven, visible in Settings, reversible); W1's CB1c (`ccd claude self-update keep | release`, the keep marker's only writer) and CB1d to CB1h (the node file's `selfUpdateOff` and `switches.selfUpdateKept`, the card that shows them); W3's CB3e (the proven marker's only writer); W1's §Global constraints, binding here in full.

**Base:** `origin/main` `f82d0c015` (#701). `_spawn_start` ≈:22885, its spawn line ≈:23299 (the `exec env` line every lane's spawn passes); `shared/wrapper.mjs` (`generateWrapperBody`, not touched: `_wrap_parse_shape` matches every line byte for byte); `ccd/ccrc-codex` ≈:180 (Codex lanes already off).

**Deploy class.** FLEET, SELF-GATED: `ccd`'s spawn line, deployed AGENT-FIRST like any `ccd` change, inert on a node until `~/.ccrc/claude-installer-proven` exists there. No session is restarted to apply it: each session picks it up at its next spawn.

## Gates

| Task | #435 | Earlier waves | Other |
|---|---|---|---|
| CB4a self-update off | yes, if still open (`ccd/ccd`; W2 waited for it) | CB1c (the keep marker), CB3e (the proven marker), CB3f (the launcher serves only smoked, approved builds) | none |

No open PR at `f82d0c015` other than #435 holds `ccd/ccd`.

## Global constraints

W1's §Global constraints bind here in full. In addition: `DISABLE_AUTOUPDATER=1`, never `DISABLE_UPDATES` (a hand `claude update` stays the operator's escape hatch, and the installer's scrubbed environment is unaffected); `autoUpdates: false` is never used (a no-op on a native install); no generated wrapper is edited.

## Review focus

1. **Off before proven.** The variable is added only while the proven marker exists and the keep marker does not.
2. **Not reversible.** The operator's `self-update keep` must win over the proven marker at the next spawn, and `release` must restore the automatic state.
3. **The wrong variable.** `DISABLE_UPDATES` would block the installer's own path and the operator's escape hatch.

## Tasks

### Task CB4a: `DISABLE_AUTOUPDATER` on the spawn line, once proven, reversible (D-5721; spec §8.2, decision 5) — GATED: after CB3e and CB3f

**Routing:** band 3, **two reviewers**. **Lane:** FLEET, self-gated. **Needs:** CB1c, CB3e, CB3f.

**Files:**
- Modify `ccd/ccd` `_spawn_start` (≈:22885): the `exec env` line (≈:23299, and the one retry's ≈:23360) adds `DISABLE_AUTOUPDATER=1` while `~/.ccrc/claude-installer-proven` exists and `$REG/claude-self-update-kept` does not.
- Modify `ccd/ccrc-claude-install`: `claude.json`'s `selfUpdateOff` reports the same predicate, so Settings shows exactly what the next spawn will do.
- Create `server/test/ccd-self-update-off.test.ts`.

- [ ] **Step 0: Re-ground.** Read the spawn line as #435 and W2 left it; confirm `_wrap_parse_shape` is untouched by a change to `_spawn_start`.
- [ ] **Step 1: Red.** "no proven marker: no variable"; "proven: `DISABLE_AUTOUPDATER=1` on the spawn line and on the retry line"; "proven and kept: no variable"; "`self-update release` after `keep`: the variable returns at the next spawn"; "never `DISABLE_UPDATES`"; "the generated wrappers are byte-identical before and after"; "`selfUpdateOff` in `claude.json` equals the predicate".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | the keep marker ignored | ccd-self-update-off | "proven and kept: no variable" |
  | `DISABLE_UPDATES=1` instead | ccd-self-update-off | "never `DISABLE_UPDATES`" |
  | added without the proven marker | ccd-self-update-off | "no proven marker" |
  | the retry line missed | ccd-self-update-off | "and on the retry line" |

- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/ccd-self-update-off.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccd-route-spawn.test.ts --maxWorkers=2
      bash -n ccd/ccd ccd/ccrc-claude-install

## Operator acts

None is required: the switch is automatic once proven (decision 5). The operator may reverse it on any node at any time with `ccd claude self-update keep` and undo that with `release`; Settings shows the state.

## Deviations and decisions

### Issued for this work and defined here

From this programme's block, D-5695 to D-5724, this plan defines D-5721, which the spec's §14 cites.

- **D-5721** — `lane-self-update-off` (Task CB4a; spec slug): once a node's installer is proven (it has itself installed and promoted one build it resolved, no failed run in 24 h, 72 h live), ccd's spawn line adds `DISABLE_AUTOUPDATER=1` for every lane, unless the operator has kept the lanes' own updaters with `ccd claude self-update keep`; the node file reports the predicate and Settings shows it; generated wrappers are not touched (decision 5, spec §8.2).

## Out of scope

Codex lanes (already off through `ccrc-codex`); any wrapper edit; any session restart to apply it.

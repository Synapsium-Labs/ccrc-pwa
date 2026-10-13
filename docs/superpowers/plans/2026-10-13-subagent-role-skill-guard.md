# Subagent role-skill guard — Implementation Plan

> Executed in one controller session on 2026-10-13, on the operator's ruling "guard against those 3". One task, dispatched to a native subagent, with the controller reviewing the diff. This file records what the task did, and it is the home of the one deviation number the guard needed.

**Goal:** a subagent can never load `ccrc-worker`, `ccrc-reviewer` or `ccrc-coordinator`, on any lane, while every other skill stays open to it.

**Architecture:** one more gate in the PreToolUse tail of `ccd/session-hook.sh`, beside the worker merge deny and in its style. The hook already runs on every PreToolUse (`install-session-hooks.sh` registers it under matcher `*`), already tells a subagent's event apart by a non-empty `agent_id` (the payload parse's `paid` flag), and already has the deny emitter `_hook_deny_json`. Nothing outside the hook changes.

**Spec:** none defines this deny. The two specs that define a PreToolUse deny each define one deny of their own: `2026-09-23-landing-order-and-main-churn-design.md` §5.2 the worker merge deny, and `2026-09-02-graphify-read-side-ccrc-level-design.md` R5 the search gate. Neither describes the hook's denies as a family or touches skills, so neither is amended. D-4934 below is the record.

## Evidence

- **What the three skills do.** Each makes whoever loads it act as the session: ack mail, take claims, send wave-done or review-done, open or dispatch runs, all under the session's identity. A subagent cannot be the session.
- **An incident.** A subagent that loaded the worker skill once sent a false wave-done as its worker.
- **Wording was not enough.** Each skill's description already says "Never use it inside a subagent". A subagent on a Codex lane loaded the reviewer skill as its first action, after that wording shipped.

## Task A: the gate (D-4934)

Files: `ccd/session-hook.sh`, `server/test/session-hook-role-skill-deny.test.ts`, `README.md`, this plan.

- **The gate.** It sits after the worker merge deny and before the `SubagentStart` arm, at about line 3750, below README's `:2900` anchor, so nothing above that line moved. It fires on a PreToolUse whose `tool_name` is `Skill`, with `paid` set, when `.tool_input.skill` is one of three names exactly or behind one `<namespace>:` prefix (`x:ccrc-worker`). It then builds the deny through `_hook_deny_json`. The reason starts `ccrc: `, names the matched skill, says the call comes from a subagent and what a subagent never does, and tells it to do its task and return its report to its parent.
- **The three names are written once**, as `ROLE_SKILLS="ccrc-worker ccrc-reviewer ccrc-coordinator"` just above the gate. The new suite pins the list against the `name:` frontmatter of the three `SKILL.md` files, so a rename turns it red. `single-definition.test.ts` scans only `.ts` and `.tsx` under four source roots and holds no enumeration of these names, so it needed no exemption and no derived list.
- **Hot-path cost.** The condition is bash builtins only. A non-Skill event and the main thread's Skill call pay no fork, and a subagent's Skill call pays one `jq`, for the skill's name. A shim `jq` in the suite counts the reads: 1 for a subagent's Skill call, 0 for the main thread's, for a Bash call and for any other tool.
- **Fail-open.** A `jq` that cannot read the payload (including a `tool_input` that is no object) denies nothing, and a `_hook_deny_json` that cannot build the envelope leaves `pre_json` as it was.
- **A deny already set is kept.** The condition carries the merge deny's own `!= *'"permissionDecision":"deny"'*` guard. That combination cannot occur in one payload today: `tool_name` is one value, and every other deny here (the search gate on Grep, Glob, Read and Bash; the merge deny on Bash) fires on another tool. So it is pinned structurally, by reading the gate's condition out of the hook, the way the merge-deny suite pins its jq structure.
- **Nothing generated.** `ccd/session-hook.sh` carries no `ccrc:generated` stamp, `ccd/ccd` only mentions it in comments, and no test pins its line count or size. The only README anchor, `ccd/session-hook.sh:2900` with `:97` and `:103-105`, is above the gate.
- **README.** The paragraph under the graph card that lists the hook's PreToolUse outputs gains the role-skill deny and its test. A new paragraph after the three-skills paragraph says none of the three is a subagent's to load and that the hook now enforces it.
- **The tests.** `session-hook-role-skill-deny.test.ts`, modelled on `session-hook-merge-deny.test.ts` (a fixture HOME, a stub `tmux`, the real hook, the payload on stdin): the deny envelope for each of the three, naming its own skill only; the namespaced forms; the main thread, an empty `agent_id` and a null one untouched; other skills; the near misses `ccrc-workers`, `my-ccrc-worker` and `ccrc-worker:x`, and six more; payloads with no readable skill name; a subagent's Bash call and other tools carrying a `skill` field; the fork count; the hookstate write still landing; the three structural pins; the names-match-frontmatter pin.
- **Red first.** Against the unchanged hook, 10 of the first 15 cases failed: every case that expects a deny, and the structural and names pins. The five that passed are the cases that expect silence, which a missing gate satisfies; the mutations below are what keep them honest.

## Mutations, measured

Each applied alone to `ccd/session-hook.sh` (G10: to `ccd/worker-skill/SKILL.md`), the new suite run whole, and the file restored from the index and checked with `git diff --quiet`.

| # | Mutation | Cases red | The named case, and its red line |
|---|---|---|---|
| G1 | the gate removed (the `if` block deleted, `ROLE_SKILLS` kept) | 9 | "refuses a subagent's load of each of the three…": `a subagent loaded ccrc-worker: expected null not to be null` |
| G2 | the `paid` condition dropped | 4 | "never touches the main thread…": `the main thread's ccrc-worker was answered` |
| G3 | widened to every skill (`-n "$rsk"`) | 6 | "leaves every other skill alone…": `a subagent's superpowers:test-driven-development was answered` |
| G4 | the exact match loosened to a substring | 1 | "the near misses pass…": `a near miss was denied: "ccrc-workers"` |
| G5 | the deny-already-set guard removed | 1 | "the gate's condition carries the merge deny's own…": `the gate would replace a deny already set` |
| G6 | the `tool_name == Skill` condition dropped | 5 | "only a `Skill` call is asked…": a subagent's Bash call was answered; and the fork count, `a subagent's Bash call: expected 1 to be +0` |
| G7 | the one-prefix strip dropped | 1 | "refuses the same three behind one `<namespace>:` prefix…": `a subagent loaded x:ccrc-worker` |
| G8 | `ccrc-coordinator` dropped from `ROLE_SKILLS` | 4 | "refuses a subagent's load of each of the three…": `a subagent loaded ccrc-coordinator`; and the frontmatter pin |
| G9 | the skill read hoisted above the condition (a fork on every event) | 1 | "costs one jq…": `a subagent's Skill call: expected 2 to be 1` |
| G10 | `name: ccrc-worker2` in the worker skill's frontmatter | 1 | "the list is exactly the `name:` frontmatter…": the two sorted lists differ |

## Verification

Every run was in the foreground, one file at a time with `--maxWorkers=2`, against fixture HOMEs only. The box was loaded throughout (load average 50 to 80).

| Suite | Result |
|---|---|
| `session-hook-role-skill-deny.test.ts` | 16 passed |
| `session-hook-merge-deny.test.ts` | a first run alone, 122 of 123 (one case failed under load); a second run alone, 123 passed |
| `session-hook.test.ts` | a first run 449 of 450: one compaction-card case hit its 20 s timeout under load; that case alone passed (1 of 1) |
| `session-hook-turnmark.test.ts` | 59 passed |
| `install-session-hooks.test.ts` | 16 passed |
| `single-definition.test.ts` | 537 passed |
| `macos-platform.test.ts` | 101 passed, 11 skipped |
| `typecheck-tests.test.ts` | 11 of 12; see below |
| `dtbd.test.ts` | 1 passed |
| `deviation-refs.test.ts`, with the plan staged | 31 passed (D-4934 defined once, here; against the local `origin/main` ref, with no fetch, since the run had no network) |

`typecheck-tests.test.ts` needs `agent/` and `pwa/` installs this worktree lacks, so they were linked to another checkout's. The one failing case asserts that pwa's compiler resolves under this worktree's own `pwa/`, which a link cannot satisfy; the other 11, including the typecheck of every server test, passed.

## Deviations found

D-4934 was issued by the allocator on 2026-10-13 and is defined once, here.

- **D-4934** — `role-skill-load-refused-to-a-subagent`: the rule "never use it inside a subagent", which each of the `ccrc-worker`, `ccrc-reviewer` and `ccrc-coordinator` skills carried only as prose in its description, is now a mechanism. `ccd/session-hook.sh`'s PreToolUse arm gains a third deny, beside the search gate (D-1613) and the worker merge deny (landing-order R5): it refuses a `Skill` call whose payload carries a non-empty `agent_id` and whose skill is one of the three, exactly or behind one `<namespace>:` prefix. It is the first deny in the hook keyed on the caller being a subagent and not on a session's hold, marker or graph. Every other skill, and the main thread, pass. A subagent had sent a false wave-done as its worker after loading the worker skill, and one on a Codex lane loaded the reviewer skill as its first action after the wording shipped. Like the merge deny it is a speed bump and not a wall: the `SKILL.md` files stay readable. It fails open, and a deny already set is never replaced. `server/test/session-hook-role-skill-deny.test.ts` pins the three names against the skills' `name:` frontmatter. No spec is amended; see the head of this plan.

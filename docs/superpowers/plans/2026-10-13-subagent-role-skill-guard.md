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

- **The gate.** It sits after the worker merge deny and before the `SubagentStart` arm, at about line 3750, below README's `:2900` anchor, so nothing above that line moved. It fires on a PreToolUse whose `tool_name` is `Skill`, with `paid` set, when `.tool_input.skill`, read the way Claude Code reads it (trimmed, one leading `/` stripped: fix round 1, below), is one of three names exactly or behind one `<namespace>:` prefix (`x:ccrc-worker`). It then builds the deny through `_hook_deny_json`. The reason starts `ccrc: `, names the matched skill, says the call comes from a subagent and what a subagent never does, and tells it to do its task and return its report to its parent.
- **The three names are written once**, as `ROLE_SKILLS="ccrc-worker ccrc-reviewer ccrc-coordinator"` just above the gate. The new suite pins the list against the `name:` frontmatter of the three `SKILL.md` files, so a rename turns it red. `single-definition.test.ts` scans only `.ts` and `.tsx` under four source roots and holds no enumeration of these names, so it needed no exemption and no derived list.
- **Hot-path cost.** The condition is bash builtins only. A non-Skill event and the main thread's Skill call pay no fork, and a subagent's Skill call pays one `jq`, for the skill's name. A shim `jq` in the suite counts the reads: 1 for a subagent's Skill call, 0 for the main thread's, for a Bash call and for any other tool.
- **Fail-open.** A `jq` that cannot read the payload (including a `tool_input` that is no object) denies nothing, and a `_hook_deny_json` that cannot build the envelope leaves `pre_json` as it was.
- **A deny already set is kept.** The condition carries the merge deny's own `!= *'"permissionDecision":"deny"'*` guard. That combination cannot occur in one payload today: `tool_name` is one value, and every other deny here (the search gate on Grep, Glob, Read and Bash; the merge deny on Bash) fires on another tool. So it is pinned structurally, by reading the gate's condition out of the hook, the way the merge-deny suite pins its jq structure.
- **Nothing generated.** `ccd/session-hook.sh` carries no `ccrc:generated` stamp, `ccd/ccd` only mentions it in comments, and no test pins its line count or size. The only README anchor, `ccd/session-hook.sh:2900` with `:97` and `:103-105`, is above the gate.
- **README.** The paragraph under the graph card that lists the hook's PreToolUse outputs gains the role-skill deny and its test. A new paragraph after the three-skills paragraph says none of the three is a subagent's to load and that the hook now enforces it.
- **The tests.** `session-hook-role-skill-deny.test.ts`, modelled on `session-hook-merge-deny.test.ts` (a fixture HOME, a stub `tmux`, the real hook, the payload on stdin): the deny envelope for each of the three, naming its own skill only; the namespaced forms; the main thread, an empty `agent_id` and a null one untouched; other skills; the near misses `ccrc-workers`, `my-ccrc-worker` and `ccrc-worker:x`, and eleven more (among them `a:b:ccrc-worker` and `//ccrc-worker`, after fix round 1); payloads with no readable skill name; a subagent's Bash call and other tools carrying a `skill` field; the fork count; the hookstate write still landing; the three structural pins; the names-match-frontmatter pin.
- **Red first.** Against the unchanged hook, 10 of the first 15 cases failed: every case that expects a deny, and the structural and names pins. The five that passed are the cases that expect silence, which a missing gate satisfies; the mutations below are what keep them honest.

## Fix round 1 (the review's rulings N1 to N4)

One commit on top of the first, with no push. The first commit's gate matched `.tool_input.skill` as given; Claude Code does not read it that way.

- **N1, the name is read as Claude Code reads it.** Its Skill tool trims the `skill` string and strips ONE leading `/` before it resolves the skill, so ` ccrc-worker`, `ccrc-worker<tab>` and `/ccrc-worker` each load the worker skill, and each passed the first commit's gate. Verified read-only, in the installed 2.1.296 binary's text (nothing was run, no network): the tool's input validation does `skill.trim()` and then `startsWith("/") ? substring(1)`, and the helper that builds the permission prompt's display name does the same; the lookup after that is an exact `name ===` match, and a bare name that only matches a `<plugin>:<name>` skill gets a suggestion and never a load. The `jq` that already reads the field now does both, in that order, with `explode` and `implode` and no regex builtin, since the hook must work with a `jq` built without Oniguruma: it trims JavaScript's `String.prototype.trim` set (U+0009-000D, U+0020, U+00A0, U+1680, U+2000-200A, U+2028, U+2029, U+202F, U+205F, U+3000 and U+FEFF) from both ends, strips one leading `/`, and the match is unchanged (exactly, or after one `<namespace>:` prefix). No new fork. It trims once and before the slash, as Claude Code does, so `/ ccrc-worker` is not the worker skill. The hook is stricter than Claude Code in one spelling: `//x:ccrc-worker` is denied (its namespace reads as `/x`), though Claude Code would find no such skill; denying a spelling that never loads a role skill costs nothing.
- **N2, the tests.** `'ccrc-worker '` leaves the near-miss list, since it is now a denied spelling. Each of the three names is denied as `/<name>`, ` <name>`, `<name> `, `<tab><name>`, U+00A0 `<name>`, `<name>` U+FEFF and `/x:<name>` (and three combined spellings). One added case runs every character of the trim set at both ends (50 hook runs), because nothing else pins the set; one case passes the spellings that Claude Code trims once and strips once (`/ ccrc-worker`, `x:/ccrc-worker`, `x: ccrc-worker` and two more). `a:b:ccrc-worker`, `x:y:ccrc-reviewer`, `x:y:ccrc-coordinator`, `//ccrc-worker`, `//ccrc-reviewer` and `//ccrc-coordinator` join the near misses that pass. The two heavy cases carry a 60 s timeout, since 30 and 50 real hook runs can outrun the 20 s default on a loaded box. The suite is 19 cases (16 before).
- **N3, the G6 row names the assertion that goes red.** The first commit's row said a subagent's Bash call was answered, and it is not: a Bash payload has no `skill` field. With the `Skill` condition dropped, what goes red is the `Task` call that carries `skill: 'ccrc-worker'`. The four expects of that case now carry messages, and the row quotes that one, with the fork-count line.
- **N4, the table.** G11 to G20 are new, and every earlier row was measured again against the 19-case suite, so its count is the current one.
- **Red first.** Against the first commit's hook, 2 of the 19 cases failed: the case for the spellings Claude Code resolves, and the full trim-set case. The other new cases (the near misses, trim once and strip once) are cases of silence, which the first commit's hook also satisfies; G15 and G16 are what keep them honest.

## Mutations, measured

Each applied alone to `ccd/session-hook.sh` (G10: to `ccd/worker-skill/SKILL.md`), the new suite run whole, and the file restored from the index and checked with `git diff --quiet`. G1 to G10 were measured on the first commit and measured again, with G11 to G20, on the 19-case suite of fix round 1; the counts below are the second measure.

| # | Mutation | Cases red | The named case, and its red line |
|---|---|---|---|
| G1 | the gate removed (the `if` block deleted, `ROLE_SKILLS` kept) | 11 | "refuses a subagent's load of each of the three…": `a subagent loaded ccrc-worker: expected null not to be null` |
| G2 | the `paid` condition dropped | 4 | "never touches the main thread…": `the main thread's ccrc-worker was answered` |
| G3 | widened to every skill (`-n "$rsk"`) | 8 | "leaves every other skill alone…": `a subagent's superpowers:test-driven-development was answered` |
| G4 | the exact match loosened to a substring | 2 | "the near misses pass…": `a near miss was denied: "ccrc-workers"` |
| G5 | the deny-already-set guard removed | 1 | "the gate's condition carries the merge deny's own…": `the gate would replace a deny already set` |
| G6 | the `tool_name == Skill` condition dropped | 5 | "only a `Skill` call is asked…": the `Task` call that carries `skill: 'ccrc-worker'`, `a subagent's Task call carrying skill: 'ccrc-worker' was answered — the gate does not require tool_name Skill`; and the fork count, `a subagent's Bash call: expected 1 to be +0` |
| G7 | the one-prefix strip dropped | 2 | "refuses the same three behind one `<namespace>:` prefix…": `a subagent loaded x:ccrc-worker` |
| G8 | `ccrc-coordinator` dropped from `ROLE_SKILLS` | 5 | "refuses a subagent's load of each of the three…": `a subagent loaded ccrc-coordinator`; and the frontmatter pin |
| G9 | the skill read hoisted above the condition (a fork on every event) | 1 | "costs one jq…": `a subagent's Skill call: expected 2 to be 1` |
| G10 | `name: ccrc-worker2` in the worker skill's frontmatter | 1 | "the list is exactly the `name:` frontmatter…": the two sorted lists differ |
| G11 | the trim removed (both `until` lines) | 2 | "reads the name the way Claude Code reads it…": `a subagent loaded " ccrc-worker": expected null not to be null`; and "trims exactly the characters…": `a leading U+0009 was not trimmed` |
| G12 | the leading trim removed | 2 | the same two cases, the same two lines |
| G13 | the trailing trim removed | 2 | "reads the name the way Claude Code reads it…": `a subagent loaded "ccrc-worker ": expected null not to be null`; and "trims exactly the characters…": `a trailing U+0009 was not trimmed` |
| G14 | the one leading `/` strip removed | 1 | "reads the name the way Claude Code reads it…": `a subagent loaded "/ccrc-worker": expected null not to be null` |
| G15 | every prefix stripped (`rbare=${rsk##*:}`) | 1 | "the near misses pass…": `a near miss was denied: "a:b:ccrc-worker"` |
| G16 | every leading slash stripped (`until(.[0] != 47; .[1:])`) | 1 | "the near misses pass…": `a near miss was denied: "//ccrc-worker"` |
| G17 | U+3000 dropped from the trim set | 1 | "trims exactly the characters…": `a leading U+3000 was not trimmed` |
| G18 | U+FEFF dropped from the trim set | 2 | "reads the name the way Claude Code reads it…" (the `<name>` U+FEFF spelling); and "trims exactly the characters…": `a leading U+FEFF was not trimmed` |
| G19 | U+00A0 dropped from the trim set | 2 | "reads the name the way Claude Code reads it…": `a subagent loaded` the U+00A0 spelling; and "trims exactly the characters…": `a leading U+00A0 was not trimmed` |
| G20 | the U+2000-200A range cut short at U+2009 | 1 | "trims exactly the characters…": `a leading U+200A was not trimmed` |

## Verification

Every run was in the foreground, one file at a time with `--maxWorkers=2`, against fixture HOMEs only. The box was loaded throughout (load average 33 to 80). The first column of results is the first commit's; the second is fix round 1's, run at its tip, with the files its brief named.

| Suite | First commit | Fix round 1 |
|---|---|---|
| `session-hook-role-skill-deny.test.ts` | 16 passed | 19 passed |
| `session-hook-merge-deny.test.ts` | a first run alone, 122 of 123 (one case failed under load); a second run alone, 123 passed | 123 passed |
| `session-hook.test.ts` | a first run 449 of 450: one compaction-card case hit its 20 s timeout under load; that case alone passed (1 of 1) | not run again |
| `session-hook-turnmark.test.ts` | 59 passed | not run again |
| `install-session-hooks.test.ts` | 16 passed | not run again |
| `single-definition.test.ts` | 537 passed | 537 passed |
| `macos-platform.test.ts` | 101 passed, 11 skipped | 101 passed, 11 skipped |
| `typecheck-tests.test.ts` | 11 of 12; see below | not run again; the compiler it spawns, run by hand on `test/tsconfig.tests.json`, reports nothing outside `agent/` |
| `dtbd.test.ts` | 1 passed | 1 passed |
| `deviation-refs.test.ts`, with the plan staged | 31 passed (D-4934 defined once, here; against the local `origin/main` ref, with no fetch, since the run had no network) | 31 passed (the same, again with no fetch) |

`typecheck-tests.test.ts` needs `agent/` and `pwa/` installs this worktree lacks, so they were linked to another checkout's. The one failing case asserts that pwa's compiler resolves under this worktree's own `pwa/`, which a link cannot satisfy; the other 11, including the typecheck of every server test, passed.

## Deviations found

D-4934 was issued by the allocator on 2026-10-13 and is defined once, here.

- **D-4934** — `role-skill-load-refused-to-a-subagent`: the rule "never use it inside a subagent", which each of the `ccrc-worker`, `ccrc-reviewer` and `ccrc-coordinator` skills carried only as prose in its description, is now a mechanism. `ccd/session-hook.sh`'s PreToolUse arm gains a third deny, beside the search gate (D-1613) and the worker merge deny (landing-order R5): it refuses a `Skill` call whose payload carries a non-empty `agent_id` and whose skill is one of the three, exactly or behind one `<namespace>:` prefix. It is the first deny in the hook keyed on the caller being a subagent and not on a session's hold, marker or graph. Every other skill, and the main thread, pass. A subagent had sent a false wave-done as its worker after loading the worker skill, and one on a Codex lane loaded the reviewer skill as its first action after the wording shipped. Like the merge deny it is a speed bump and not a wall: the `SKILL.md` files stay readable. It fails open, and a deny already set is never replaced. `server/test/session-hook-role-skill-deny.test.ts` pins the three names against the skills' `name:` frontmatter. The skill's name is read the way Claude Code reads it (fix round 1): trimmed of JavaScript's `trim` set and stripped of one leading `/`, since its Skill tool does both before it resolves a name, so ` ccrc-worker` and `/ccrc-worker` load the worker skill. No spec is amended; see the head of this plan.

# The shapes that still raise a prompt under bypass — the literal-path rule every brief carries

Every lens, refuter, scout and implementer brief a coordinator, worker or reviewer writes carries the two
sentences below, word for word. Subagents never read a skill, and they raise almost every permission prompt, so a
rule that lives only in a skill never reaches the session that needs it. The reviewer skill's clause 9 carries the
rule and the worker skill's clause 5 carries its first half, and `review-panel.md` and
`review-brief.md` carry both in the text they hand on.

**The rule.** Remove only literal paths you have written out, never a path held in a variable or built by a command, a glob after a `cd`, or a path inside `bash -c`. Leave temporary directories to the reaper, or name them in full.

**The prose-names line.** The approval surface's deny matches names in plain prose, not only commands, so a note, a heredoc or a mail never names the approval files (the verifier script, the signing keys, the approval client verb or the approvals route): describe them in words.

A planning or review child is the one most often caught by the second sentence: its note or heredoc names a file
in passing, and the deny refuses the whole call. It describes the file in words instead.

## Table 3d. What Claude Code still prompts for under `bypassPermissions`

Measured on 2026-11-18 from the permission-modes page of the Claude Code documentation and the text of build
2.1.327 (approvals plan §3.8). Every "Yes" is a removal Claude Code cannot resolve statically, or a prompt the user
configured.

| Shape | Prompts under bypass? | Source |
|---|---|---|
| `rm` or `rmdir` whose target is a shell variable (`rm -rf $L/x`) | Yes | Measured (the trigger prompt, 2.1.327). The build's own message: "Dangerous rm operation on possibly-empty variable path" |
| `rm` whose target is a command substitution's output | Yes | 2.1.327: "requires explicit approval and cannot be auto-allowed by permission rules" |
| `rm` inside `bash -c` or `sh -c` with a target built at run time | Yes | 2.1.327: "Pass a literal path, or guard the value with ${NAME:?}" |
| `rm` with a relative glob after a `cd` in the same command | Yes | 2.1.327: "the relative glob target cannot be statically resolved" |
| `rm` of a target that cannot be resolved, or a glob over directories that cannot be listed | Yes | 2.1.327 |
| `rm` of a critical system directory, the working directory or a parent of it | Yes | The documentation ("critical-path removals") and 2.1.327 |
| A tool an explicit ask rule matches, `AskUserQuestion`, a tool marked as needing the user | Yes | The documentation |
| Recognised file-reading Bash commands outside the working directories, only when `blockReadsOutsideWorkingDirectories` is set | Yes | The documentation |
| `rm` of a literal, resolvable path inside the working directory | Unmeasured | No source says it prompts |
| `sed` with "potentially dangerous operations", and the build's generic "This command requires approval" | Unmeasured | 2.1.327 has the strings, but they do not say whether bypass skips them |
| Writes to `.git`, `.claude`, `.vscode` or `.idea` | No | The documentation's protected-path table: allowed under bypass |

*Table 3d. The shapes that still prompt under bypass.*

A "Yes" row is a prompt the operator answers, so the cheapest fix is the one in the rule: write the literal path
out, or leave the directory to the reaper. An "Unmeasured" row is not licensed either way; do not rely on it.

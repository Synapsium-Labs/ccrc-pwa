# The shapes that still raise a prompt under bypass — the literal-path rule every brief carries

Every lens, refuter, scout and implementer brief a coordinator, worker or reviewer writes carries the two
sentences below, word for word. Subagents never read a skill, and they raise almost every permission prompt, so a
rule that lives only in a skill never reaches the session that needs it. The reviewer skill's clause 9 and the worker
skill's clause 5 carry the rule, `review-panel.md` and `review-brief.md` carry both sentences in the text they hand
on, and `routing-matrix.md`, `wave-lifecycle-2-dispatch.md`, `wave-lifecycle-5-boundary.md` and `wave-steps.md` each
point a coordinator's own briefs here.

**The rule.** Remove only literal paths you have written out, never a path held in a variable or built by a command, a glob after a `cd`, or a path inside `bash -c`. Leave temporary directories to the reaper, or name them in full.

**The prose-names line.** The approval surface's deny matches names in plain prose, not only commands, so a note, a heredoc or a mail never names the approval files (the verifier script, the signing keys, the approval client verb or the approvals route): describe them in words.

A planning or review child is the one most often caught by the second sentence: its note or heredoc names a file
in passing, and the deny refuses the whole call. It describes the file in words instead.

The rule is wider than the table below on purpose: it also forbids an absolute glob after a `cd`, and any path built
inside `bash -c`, literal or not, so that a brief never has to judge which of those Claude Code can resolve.

## Table 3d. What Claude Code still prompts for under `bypassPermissions`

The rows come from three kinds of evidence, and the Source column says which, row by row (approvals plan §3.8,
sources read on 2026-11-18):

- **Observed:** row 1 only. The trigger prompt was seen under bypass, on build 2.1.327.
- **A string present in build 2.1.327:** rows 2 to 5. The quoted text was found in the build. Presence of a string
  does not say whether bypass skips it, so these rows rest on x, not on an observed prompt.
- **The Claude Code documentation:** rows 6 to 8 and the "No" row.
- **Unmeasured:** the two rows marked so. Nothing licenses them either way.

Rows 1 to 6 are removals the rule keeps a brief from writing. Rows 7 and 8 are prompts a configuration or the tool
itself raises; no brief wording prevents them.

| Shape | Prompts under bypass? | Source |
|---|---|---|
| `rm` or `rmdir` whose target is a shell variable (`rm -rf $L/x`) | Yes | Observed (the trigger prompt, 2.1.327). The message the prompt showed: "Dangerous rm operation on possibly-empty variable path". That wording is what the prompt showed, not a string found in the build |
| `rm` whose target is a command substitution's output | Yes | String present in 2.1.327: "requires explicit approval and cannot be auto-allowed by permission rules" |
| `rm` inside `bash -c` or `sh -c` with a target built at run time | Yes | String present in 2.1.327: "Pass a literal path, or guard the value with ${NAME:?}" |
| `rm` with a relative glob after a `cd` in the same command | Yes | String present in 2.1.327: "the relative glob target cannot be statically resolved" |
| `rm` of a target that cannot be resolved, or a glob over directories that cannot be listed | Yes | String present in 2.1.327, wording not quoted here |
| `rm` of a critical system directory, the working directory or a parent of it | Yes | The documentation ("critical-path removals") and 2.1.327 |
| A tool an explicit ask rule matches, `AskUserQuestion`, a tool marked as needing the user | Yes | The documentation |
| Recognised file-reading Bash commands outside the working directories, only when `blockReadsOutsideWorkingDirectories` is set | Yes | The documentation |
| `rm` of a literal, resolvable path inside the working directory | Unmeasured | No source says it prompts |
| `sed` with "potentially dangerous operations", and the build's generic "This command requires approval" | Unmeasured | 2.1.327 has the strings, but they do not say whether bypass skips them |
| Writes to `.git`, `.claude`, `.vscode` or `.idea` | No | The documentation's protected-path table: allowed under bypass |

*Table 3d. The shapes that still prompt under bypass.*

For rows 1 to 6 the cheapest fix is the rule above: write the literal path out, or leave the directory to the
reaper. Rows 7 and 8 are not removals, and no wording fixes them: a question still rides `AskUserQuestion`. An
"Unmeasured" row is not licensed either way; do not rely on it.

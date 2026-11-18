// Approvals PR P (plan 2026-11-18, section 3.8, Task P.1): the literal-path rule and the prose-names line are
// carried, word for word, into every lens and subagent brief the skills tell a session to write. Subagents
// never read a skill and raise almost every permission prompt, so the sentences must sit in the text the
// briefs are copied from. The reviewer skill pins the rule in its clause 9
// (reviewer-skill.test.ts); this file pins the coordinator skill's references. The coordinator skill's twenty
// clauses are untouched and stay pinned by coordinator-skill.test.ts.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const refs = path.join(root, 'ccd/coordinator-skill/references');
const read = (name: string) => readFileSync(path.join(refs, name), 'utf8');

const RULE = 'Remove only literal paths you have written out, never a path held in a variable or built by a command, a glob after a `cd`, or a path inside `bash -c`. Leave temporary directories to the reaper, or name them in full.';
const PROSE = "The approval surface's deny matches names in plain prose, not only commands, so a note, a heredoc or a mail never names the approval files (the verifier script, the signing keys, the approval client verb or the approvals route): describe them in words.";

const TABLE_3D = [
  '| `rm` or `rmdir` whose target is a shell variable (`rm -rf $L/x`) | Yes | Observed (the trigger prompt, 2.1.327). The message the prompt showed: "Dangerous rm operation on possibly-empty variable path". That wording is what the prompt showed, not a string found in the build |',
  '| `rm` whose target is a command substitution\'s output | Yes | String present in 2.1.327: "requires explicit approval and cannot be auto-allowed by permission rules" |',
  '| `rm` inside `bash -c` or `sh -c` with a target built at run time | Yes | String present in 2.1.327: "Pass a literal path, or guard the value with ${NAME:?}" |',
  '| `rm` with a relative glob after a `cd` in the same command | Yes | String present in 2.1.327: "the relative glob target cannot be statically resolved" |',
  '| `rm` of a target that cannot be resolved, or a glob over directories that cannot be listed | Yes | String present in 2.1.327, wording not quoted here |',
  '| `rm` of a critical system directory, the working directory or a parent of it | Yes | The documentation ("critical-path removals") and 2.1.327 |',
  '| A tool an explicit ask rule matches, `AskUserQuestion`, a tool marked as needing the user | Yes | The documentation |',
  '| Recognised file-reading Bash commands outside the working directories, only when `blockReadsOutsideWorkingDirectories` is set | Yes | The documentation |',
  '| `rm` of a literal, resolvable path inside the working directory | Unmeasured | No source says it prompts |',
  '| `sed` with "potentially dangerous operations", and the build\'s generic "This command requires approval" | Unmeasured | 2.1.327 has the strings, but they do not say whether bypass skips them |',
  '| Writes to `.git`, `.claude`, `.vscode` or `.idea` | No | The documentation\'s protected-path table: allowed under bypass |',
];

// Every reference that tells a coordinator how to write a brief for an Agent-tool subagent, a workflow agent()
// call or an implementer points at approval-prompts.md with this one sentence (the coordinator skill's own
// twenty clauses carry none of it and stay untouched).
const POINTER = 'Every brief for an Agent-tool subagent, a workflow `agent()` call or an implementer carries both sentences of `references/approval-prompts.md`, word for word.';

describe('the literal-path rule in the coordinator skill\'s brief text', () => {
  it.each(['routing-matrix.md', 'wave-lifecycle-2-dispatch.md', 'wave-lifecycle-5-boundary.md', 'wave-steps.md'])(
    '%s points a coordinator\'s own briefs at approval-prompts.md', (name) => {
      expect(read(name), `${name} lost the pointer to approval-prompts.md`).toContain(POINTER);
    });


  it('approval-prompts.md carries the rule and the prose-names line word for word', () => {
    const text = read('approval-prompts.md');
    expect(text, 'the literal-path rule is gone or softened').toContain(RULE);
    expect(text, 'the prose-names line is gone or softened').toContain(PROSE);
  });

  // The whole of Table 3d, every row and every cell (the Source column too), so changing "Unmeasured" to "Yes",
  // editing a source claim or dropping a row reds by name.
  it('approval-prompts.md holds Table 3d whole: every row, every cell', () => {
    const text = read('approval-prompts.md');
    const rows = text.split('\n').filter((l) => l.startsWith('| ')).slice(1); // after the header (the rule line starts with a dash, not a space)
    expect(rows).toEqual(TABLE_3D);
    expect(text).toContain('*Table 3d. The shapes that still prompt under bypass.*');
  });

  it('approval-prompts.md says which rows are observed, present in the build, documented and unmeasured', () => {
    const text = read('approval-prompts.md');
    expect(text).toContain('- **Observed:** row 1 only.');
    expect(text).toContain('- **A string present in build 2.1.327:** rows 2 to 5.');
    expect(text).toContain('- **The Claude Code documentation:** rows 6 to 8 and the "No" row.');
    expect(text).toContain('- **Unmeasured:** the two rows marked so.');
    expect(text).toContain('That wording is what the prompt showed, not a string found in the build');
  });

  it('the review panel puts both sentences into every lens and refuter prompt', () => {
    const text = read('review-panel.md');
    expect(text, 'the panel script no longer holds the rule').toContain(`const RULE = '${RULE}'`);
    expect(text, 'the panel script no longer holds the prose-names line').toContain(`const PROSE = "${PROSE}"`);
    // READ_ONLY heads the three lens prompts and the refuter prompt, so the splice is what carries both.
    expect(text).toMatch(/const READ_ONLY = `[^`\n]*\$\{RULE\} \$\{PROSE\}`/);
    expect((text.match(/\$\{READ_ONLY\}/g) ?? []).length, 'a lens or refuter prompt no longer starts from READ_ONLY').toBe(4);
  });

  it('the review brief template points at the reference for both sentences', () => {
    const text = read('review-brief.md');
    expect(text).toContain('`../ccrc-coordinator/references/approval-prompts.md` word for word (the literal-path rule and the prose-names line)');
  });

  it('the reviewer skill carries the rule in clause 9', () => {
    const skill = readFileSync(path.join(root, 'ccd/reviewer-skill/SKILL.md'), 'utf8');
    const line = skill.split('\n').find((l) => l.startsWith('9. '));
    expect(line).toContain(RULE);
    expect(line).toContain('carries the rule above and the prose-names line of `../ccrc-coordinator/references/approval-prompts.md`');
  });
});

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

describe('the literal-path rule in the coordinator skill\'s brief text', () => {
  it('approval-prompts.md carries the rule and the prose-names line word for word', () => {
    const text = read('approval-prompts.md');
    expect(text, 'the literal-path rule is gone or softened').toContain(RULE);
    expect(text, 'the prose-names line is gone or softened').toContain(PROSE);
  });

  it('approval-prompts.md holds Table 3d: the shapes that still prompt under bypass', () => {
    const text = read('approval-prompts.md');
    expect(text).toContain('*Table 3d. The shapes that still prompt under bypass.*');
    expect(text).toContain('| `rm` or `rmdir` whose target is a shell variable (`rm -rf $L/x`) | Yes |');
    expect(text).toContain('| `rm` inside `bash -c` or `sh -c` with a target built at run time | Yes |');
    expect(text).toContain('| `rm` with a relative glob after a `cd` in the same command | Yes |');
  });

  it('the review panel puts both sentences into every lens and refuter prompt', () => {
    const text = read('review-panel.md');
    expect(text, 'the panel script no longer holds the rule').toContain(`const RULE = '${RULE}'`);
    expect(text, 'the panel script no longer holds the prose-names line').toContain(`const PROSE = "${PROSE}"`);
    // READ_ONLY heads the three lens prompts and the refuter prompt, so the splice is what carries both.
    expect(text).toMatch(/const READ_ONLY = `[^`\n]*\$\{RULE\} \$\{PROSE\}`/);
    for (const use of text.match(/\$\{READ_ONLY\}/g) ?? []) expect(use).toBe('${READ_ONLY}');
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
  });
});

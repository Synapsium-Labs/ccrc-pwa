// The texts that move with the expiry lane (workspace lifecycle spec 2026-09-24 §5.3 "The contracts that move", §6
// item 1; wave 3b). They land in the SAME commit as the lane's live arm or after it, never before, so no text claims
// a cleanup that does not run (the coordinator's ruling (F)). Each is pinned by what it must SAY, so a later edit
// that drops the claim reds here rather than leaving the docs behind the code.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..', '..');
const read = (p: string): string => readFileSync(path.join(root, p), 'utf8');
/** Whitespace folded, so a re-wrapped paragraph still matches. */
const flat = (p: string): string => read(p).replace(/\s+/g, ' ');

describe('README: what happens to an archived workspace now', () => {
  const readme = flat('README.md');
  it('says it is cleaned up seven days after its archive, shadowed until the operator arms it, under the one switch', () => {
    const at = readme.indexOf('**Archived workspaces are cleaned up after seven days**');
    expect(at, 'the paragraph is gone').toBeGreaterThan(-1);
    const para = readme.slice(at, at + 3200);
    // The ARMING CONDITION is the paragraph's first claim, not its footnote (the coordinator's ruling): true before and after.
    expect(para).toContain('once the operator has armed the lane with `$REG/expire-lane-live`; until then the lane only records what it would expire');
    expect(para).toContain('`$REG/expire-lane-live`');
    expect(para).toContain('would expire');
    expect(para).toContain('`$REG/reclaim-paused` is the fleet’s one cleanup switch');
    expect(para).toContain('never kills');
  });
  it('the coordinator’s own workspace: by a human — or, with no child marker, by the server seven days after its archive', () => {
    expect(readme).toContain('a coordinator\'s own workspace is still cleaned up by a human — or, when it carries no child marker, by the server seven days after it is archived, once the operator has armed the expiry lane with `$REG/expire-lane-live` (until then the lane only records what it would expire)');
  });
  it('every other passage that names the switch says it stops the expiry too, and calls the row the cleanup row', () => {
    expect(readme).toContain('The cleanup row beneath it keeps the same discipline for `$REG/reclaim-paused`, the fleet\'s one cleanup switch');
    expect(readme).toContain('it pauses every reclamation and every expiry fleet-wide');
    expect(readme).toContain('and the expiry of archived workspaces stops too');
    expect(readme).toContain('raise / lower the cleanup pause (`$REG/reclaim-paused`: child reclamation and the expiry of archived workspaces)');
    expect(readme, 'the row is not the reclaim row any more').not.toContain('reclaim row on `/runs`');
  });
});

describe('the coordinator’s reference, §6', () => {
  it('a child that has coordinated stays a human’s; an unmarked workspace is the server’s seven days after its archive', () => {
    const s = flat('ccd/coordinator-skill/references/wave-lifecycle.md');
    // `has-coordinated` keeps its `.child` marker, and neither lane ever expires a marked child (CCR-15; spec §5.3).
    expect(s).toContain('`has-coordinated` means the child has coordinated a run, so its workspace is cleaned up by a human. No');
    expect(s).toContain('it stays until a human cleans it up, or — when it carries no child marker — until the server cleans it up seven days after it is archived, once the operator has armed the server’s expiry lane (until then the lane only records what it would expire)');
  });
  it('clause 3 says it too: the cleanup follows the archive once the operator has armed the lane', () => {
    const clause = flat('ccd/coordinator-skill/SKILL.md');
    expect(clause).toContain('this session’s own workspace is cleaned up by a human, or by the server seven days after it is archived once the operator has armed the server’s expiry lane (until then the lane only records what it would expire).');
  });
  it('no skill file names the lane’s live switch — a session told about the dial could arm a deletion', () => {
    const skills = ['ccd/coordinator-skill', 'ccd/worker-skill', 'ccd/reviewer-skill'];
    const files = skills.flatMap((d) => readdirSync(path.join(root, d), { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.md')).map((f) => path.join(d, f)));
    expect(files.length, 'an empty corpus would pass vacuously').toBeGreaterThan(3);
    for (const f of files) expect(read(f), f).not.toContain('expire-lane-live');
  });
});

describe('the specs', () => {
  it('CCR-15 §5.8: the pause is the fleet’s one cleanup switch now — the expiry stops with it', () => {
    const s = flat('docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md');
    expect(s).not.toContain('Pausing stops reclamation fleet-wide and nothing else;');
    expect(s).toContain('Pausing stops reclamation fleet-wide, and — since workspace lifecycle wave 3b — the expiry of archived workspaces too');
  });
  it('the lifecycle design §5.3 records the shadowed lane, and §6 item 1 as amended', () => {
    const s = flat('docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md');
    expect(s).toContain('**As wave 3b builds the lane**');
    expect(s).toContain('`$REG/expire-lane-live`');
    expect(s).toContain('Amended by this design’s wave 3b');
    // The words carry the arming condition (the coordinator's ruling), and the two spec places that quote clause 3 say so.
    expect(s).toContain('**The words carry the arming condition**');
    expect(s).toContain('Coordinator clause 3\'s closing sentence (§5.3). Amended by this design’s wave 3b');
  });
});

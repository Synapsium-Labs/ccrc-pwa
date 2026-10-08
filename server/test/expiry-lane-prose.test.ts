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
  it('says a kept leaf is listed, an older ccd’s silence is the feed row’s, and a day of resumable failures slows the asking (wave 5)', () => {
    const at = readme.indexOf('**Archived workspaces are cleaned up after seven days**');
    const para = readme.slice(at, at + 4200);
    expect(para).toContain('is listed, saying what was kept and why, until the server restarts');
    expect(para).toContain('a fleet box whose ccd predates that report says so in the feed row only');
    expect(para).toContain('is retried, backing off, for a day;');
    expect(para).toContain('and asked again every four hours, never stopping.');
    expect(para).toContain('The entry stays through a hold, a shadow audit or any other answer that ends no attempt, until an attempt completes, finds that none had begun or stops for good, or the workspace is archived again');
    expect(para).not.toContain('stops asking for that archive');
  });
  it('the coordinator’s own workspace: by a human — or, with no child marker, by the server seven days after its archive', () => {
    expect(readme).toContain('a coordinator\'s own workspace is still cleaned up by a human — or, when it carries no child marker, by the server seven days after it is archived, once the operator has armed the expiry lane with `$REG/expire-lane-live` (until then the lane only records what it would expire)');
  });
  it('every other passage that names the switch says it stops the expiry too, and calls the row the cleanup row', () => {
    expect(readme).toContain('The cleanup row beneath it keeps the same discipline for `$REG/reclaim-paused`, the fleet\'s one cleanup switch');
    expect(readme).toContain('it pauses every reclamation, every expiry and the dead-coordinator lane fleet-wide');
    expect(readme).toContain('and the expiry of archived workspaces stops too');
    expect(readme).toContain('raise / lower the cleanup pause (`$REG/reclaim-paused`: child reclamation, the expiry of archived workspaces and the dead-coordinator lane)');
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
  it('clause 3 says it too: the cleanup follows the archive once the operator has armed the lane — never for a child', () => {
    // A nested coordinator's own workspace is a CHILD, CCR-15's, never expired (review 313, parked item 3).
    const clause = flat('ccd/coordinator-skill/SKILL.md');
    expect(clause).toContain('this session’s own workspace is cleaned up by a human, or — when it carries no child marker — by the server seven days after it is archived once the operator has armed the server’s expiry lane (until then the lane only records what it would expire).');
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
    // Review 313's residue, closed by wave 4: each of its departures reaches §5.3's list, so the spec says what shipped.
    expect(s).toContain("**Review 313's residue, closed by wave 4**");
    for (const said of ['backs off on the failure ladder and is listed', 'learn slots go in `nextAskAt` order',
      'listed at once and never asked again for that archive', 'ends the row\'s would-expire, in-use and held reports',
      // The residue sentence is exact about a hold (final review of wave 4, B-F1): the box's verdicts stand on a sighting
      // that is NOT held; a hold replaces a non-final report and the row is re-audited once it is due after the release.
      'the verdicts the box itself gave (refused, failing, no evidence) stand on a sighting that is not held',
      'a hold replaces a non-final report (a would-expire, an in-use or a retryable failing one) and the row is re-audited as soon as it is due again after the release',
      'a hold never replaces a report whose row the lane has stopped asking',
      'reads no archive from a ccd that prints the instant',
      'is a row that moved', 'names its instant (`due <instant>`), never a period']) expect(s).toContain(said);
    // An ineligible sighting does NOT clear every report: the box's own verdicts stand (review of wave 4's Task 4, I1).
    expect(s).not.toContain('clears every report');
  });
  it('§5.3 records wave 5’s follow-ups: the consent binds the branch, a failed state-changed is audited afresh, a kept leaf, a day of failures', () => {
    const s = flat('docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md');
    expect(s).toContain("**As wave 5 closes the lane's follow-ups**");
    for (const item of ['**The consent binds the branch.**', '**A `failed` `state-changed` is audited afresh.**', '**A kept leaf is listed.**',
      '**A day of resumable failures slows the asking.**', 'A branch already absent when the token was minted reads absent twice and expires with its work in the attic',
      'An absent key (an older ccd) is recorded in the feed row as unmeasured and lists nothing',
      'mints a fresh token over what stands', 'The lane asks again every four hours, never stopping',
      'No answer that ends no attempt replaces the entry or resets its run', 'finds that none had begun']) expect(s).toContain(item);
    for (const gone of ['is final.**', 'stops the asking.**', 'The lane does not ask again until the archive changes']) expect(s).not.toContain(gone);
  });
});

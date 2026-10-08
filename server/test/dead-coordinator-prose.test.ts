// The texts that move with the dead-coordinator lane (workspace lifecycle spec 2026-09-24 §5.4, §6 item 5; wave 4).
// Each is pinned by what it must SAY: the arming condition stated before the act, the one cleanup switch widened
// wherever it names what it stops, and the departures recorded in the spec — so a later edit that drops a claim reds
// here rather than leaving the docs behind the code. The skill corpora NEVER name the live file (ruling B).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..', '..');
const read = (p: string): string => readFileSync(path.join(root, p), 'utf8');
/** Whitespace folded, so a re-wrapped paragraph still matches. */
const flat = (p: string): string => read(p).replace(/\s+/g, ' ');

describe('README: a coordinator that crashed', () => {
  const readme = flat('README.md');
  it('says what an armed lane ends and when — and that until the operator arms it, the lane only records', () => {
    const at = readme.indexOf('**A coordinator that crashed is ended after an hour**');
    expect(at, 'the paragraph is gone').toBeGreaterThan(-1);
    const para = readme.slice(at, at + 5200);
    expect(para).toContain('once the operator has armed the lane with `$REG/dead-coordinator-lane-live`; until then the lane only records what it would end');
    expect(para).toContain('**The lane ships shadowed**');
    expect(para).toContain('A stopped coordinator is never ended');
    expect(para).toContain('circuit breaker');
    expect(para).toContain('`$REG/reclaim-paused` stops this lane too, shadow included');
    expect(para).toContain('It never pushes');
    // The revisions of the plan's review: a journal it cannot trust, the re-measure inside the arm and its residual,
    // the breaker's memory and its fleet-wide arm, shadow's whole list, and the incident the stall watch notifies.
    expect(para).toContain('A coordinator whose journal the server cannot trust to hold every deliberate act');
    expect(para).toContain('a pass decides nothing at all');
    expect(para).toContain('immediately before each run\'s fleet act and again before its commit');
    expect(para).toContain('all but a revive that lands inside that last round trip');
    expect(para).toContain('stays held through a pass that cannot measure it');
    expect(para).toContain('in shadow every due one is recorded');
    expect(para).toContain('one per worker, each naming the coordinator');
  });
  it('every passage that names what the one cleanup switch stops names this lane too', () => {
    expect(readme).toContain('pauses every reclamation, every expiry and the dead-coordinator lane fleet-wide');
    expect(readme).toContain('and the expiry of archived workspaces stops too, as does the dead-coordinator lane');
    expect(readme).toContain('raise / lower the cleanup pause (`$REG/reclaim-paused`: child reclamation, the expiry of archived workspaces and the dead-coordinator lane)');
  });
});

describe('the skill corpora', () => {
  it('the coordinator’s resume runbook says, in WORDS, what an armed lane does to a programme whose coordinator stays dead', () => {
    const r = flat('ccd/coordinator-skill/references/resume.md');
    expect(r).toContain('Once the operator has armed the server\'s dead-coordinator lane');
    expect(r).toContain('has stayed dead an hour has its open runs closed `failed`');
    expect(r).toContain('Until the operator arms it, the lane only records what it would end.');
    expect(r).toContain('A revive within the hour keeps the program either way.');
  });

  it('no skill file names the lane’s live switch — a session told about the dial could arm the end of a programme', () => {
    const skills = ['ccd/coordinator-skill', 'ccd/worker-skill', 'ccd/reviewer-skill'];
    const files = skills.flatMap((d) => readdirSync(path.join(root, d), { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.md')).map((f) => path.join(d, f)));
    expect(files.length, 'an empty corpus would pass vacuously').toBeGreaterThan(3);
    for (const f of files) expect(read(f), f).not.toContain('dead-coordinator-lane-live');
  });
});

describe('the specs', () => {
  it('the lifecycle design §5.4 records the lane as wave 4 builds it, and §6 item 5 as amended', () => {
    const s = flat('docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md');
    expect(s).toContain('**As wave 4 builds the lane**');
    expect(s).toContain('`$REG/dead-coordinator-lane-live`');
    expect(s).toContain('`closeRun`\'s `causedBy` vocabulary gains `\'sweep\'` (§5.4). Amended by this design’s wave 4');
    for (const item of ['**A journal that may have lost the act is unreadable.**', '**A never-started row with no successful spawn never ran.**',
      '**The breaker remembers.**', '**The re-measure runs inside the arm.**', 'in shadow every due claimant is recorded']) {
      expect(s).toContain(item);
    }
  });
  it('CCR-15 §5.8: the one cleanup switch stops the dead-coordinator lane too', () => {
    expect(flat('docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md'))
      .toContain('the expiry of archived workspaces too, and — since wave 4 — the dead-coordinator lane');
  });
  it('the build-4 design, where the causedBy vocabulary is written, names the third word', () => {
    expect(flat('docs/superpowers/specs/2026-08-11-build4-conversation-and-controls-design.md'))
      .toContain("carry `causedBy ∈ {'coordinator','operator',<session id>}` — and, since workspace lifecycle wave 4, `'sweep'`");
  });
});

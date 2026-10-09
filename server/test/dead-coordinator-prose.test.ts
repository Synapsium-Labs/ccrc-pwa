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
  it('is exact about which mirror states LIST a coordinator and which make a pass decide nothing (final review, B-F2)', () => {
    const at = readme.indexOf('**A coordinator that crashed is ended after an hour**');
    const para = readme.slice(at, at + 6200);
    expect(para, '`unavailable` lists it unmeasured').toContain('the lifecycle mirror `unavailable` (the fleet\'s ccd does not journal)');
    expect(para, 'no such state as "not current" — it blurred the two').not.toContain('mirror not current');
    expect(para).toContain('while the mirror has not swept since a restart, or has gone stale, a pass decides nothing at all');
  });
  it('says the breaker trips after a lane gap of over ten minutes, and that the hour starts afresh then (final review, A-I3)', () => {
    const at = readme.indexOf('**A coordinator that crashed is ended after an hour**');
    const para = readme.slice(at, at + 6200);
    expect(para).toContain('A lane gap of more than ten minutes (a restart, a pause, a stale mirror) starts the hour afresh');
    expect(para).toContain('and trips the breaker when two or more coordinators were crashed');
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

  it('the runbook does not overstate it: runs closed `failed`, marked workers reclaimed and unmarked ones released, the program can be opened again, and a vanished registry row is a cause (final review, B-F3)', () => {
    const r = flat('ccd/coordinator-skill/references/resume.md');
    expect(r).not.toContain('retired for good');
    expect(r).not.toContain('its workers cleaned up');
    expect(r).toContain('each child-marked worker is reclaimed and each unmarked worker is released');
    expect(r).toContain('can open it again with a new `POST /api/runs` naming the program');
    expect(r).toContain('or its registry row is gone');
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
  it('§5.4 says both measured facts of an abandoned programme, records wave 5’s corrections and the accepted abstention (review 339, F5)', () => {
    const s = flat('docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md');
    expect(s, 'the old absolute is gone').not.toContain('The programme retires as `abandoned`, permanently.');
    expect(s).toContain('while that run is open the programme row still reads `abandoned`');
    expect(s).toContain('The row is rewritten only when a later close ends the programme\'s last open run');
    expect(s).toContain('**As wave 5 corrects the lane**');
    for (const item of ['**A second crash is a second record.**', '**A release and a re-hold are two acts.**',
      '**Every thrown act is recorded.**', '**A generation the mirror could not read is not a successful sweep.**',
      '**A mirror gone stale at the act is a hold.**', '**An accepted abstention.**']) expect(s).toContain(item);
  });
  it('README says a stale mirror at the act keeps the hour, and every failed act is recorded (wave 5)', () => {
    expect(flat('README.md')).toContain('A mirror that goes stale between the pass and the act stops the act and keeps the hour, and every act that fails writes a feed row, whatever it had done.');
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

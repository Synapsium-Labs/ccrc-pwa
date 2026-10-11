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

describe('the spec says what a restart does to the dead-coordinator lane (review 381, F1)', () => {
  const spec = flat('docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md');
  it('§5.4: the breaker\'s hold survives, the run of passes restarts, an unreadable record seeds a fallback and the ways a restart can act sooner are named without a count (review 382, R2, R3)', () => {
    const at = spec.indexOf('- **The attention list is the lane\'s own memory** (the expiry lane\'s shape)');
    expect(at, '§5.4\'s attention-list bullet is there').toBeGreaterThan(-1);
    const para = spec.slice(at, spec.indexOf('- **The lane never pushes.**', at));
    expect(para.length, 'the bullet is bounded').toBeGreaterThan(100);
    expect(para).not.toContain('never cause one');
    expect(para, 'an unreadable record no longer stops the lane (review 382, R2)').not.toContain('a record it cannot read makes that pass act on nothing');
    expect(para).not.toContain('the next pass tries again');
    expect(para, 'the fallback is flagged, not an instant (review 382, R2)').not.toContain('at that pass\'s instant');
    expect(para, 'the lost backoff is no longer called the one thing (review 382, R3)').not.toContain('the one thing that can bring an act sooner');
    expect(para, 'the lost backoff is not the one way (review 382, fix round 3)').not.toContain('the one way a restarted lane can act sooner');
    for (const item of ['A restart keeps the lane\'s first-dead anchor (a gap of more than ten minutes re-anchors it, as above)', 'and the breaker\'s hold (the record above, read back at the first pass',
      'a record it cannot read makes the lane hold every claimant that pass does not release, each flagged, and write a fresh record, with a warn line and a feed row saying so',
      'a flagged claimant clusters with any other crashed or held claimant, whatever the instants, until evidence releases it, so every claimant a readable record would hold is held too, at the cost that while one stands a claimant that crashes is swept into the hold and is flagged itself, until evidence releases it or fewer than two stand',
      'restarts the run of crashed passes, which delays an act', 'drops the backoff after a stuck or thrown act, which can bring an abandon back sooner',
      'A restart that lands while a held-set write is failing seeds the older record, which can hold less than the process did: another, narrow way to act sooner, which needs a store whose writes keep failing at that moment',
      'The lane composes no act on a pass whose held-set record did not land, so the record never lags an act',
      're-measure before and after the fleet act']) expect(para, item).toContain(item);
  });
  it('§5.4\'s breaker bullet names the record: a run_events observation row, written when the set changes, shadow included, no migration', () => {
    const at = spec.indexOf('- **The breaker remembers.**');
    expect(at).toBeGreaterThan(-1);
    const para = spec.slice(at, spec.indexOf('- **One claimant a pass**', at));
    for (const item of ['a `run_events` observation row', 'written whenever the held set changes, in shadow too', 'no new table or column',
      'first-dead instants', 'ids percent-escaped, so any claimant id is carried',
      // Review 384, F1: the clustering is monotone, and its cost.
      'Its clustering is monotone: a member keeps its remembered first-dead instant and, while it is also crashed, clusters at its current anchor too, and two entries cluster when any instant of one is within the window of any instant of the other',
      'so a held instant never replaces a re-anchored one, and a restarted lane\'s breaker stands wherever an unrestarted lane\'s does',
      'the cost is that a member held at an old instant that crashes anew also clusters near its new instant']) expect(para, item).toContain(item);
    expect(para, 'the held instant no longer wins over a re-anchored one').not.toContain('held wins');
  });
  it('§12 says it per lane: the anchor and the hold survive, an unreadable record seeds a fallback and is logged, no act waits on an unrecorded hold, and the lost backoff can bring an abandon sooner', () => {
    const at = spec.indexOf('- **Their memory is in memory.**');
    expect(at, '§12\'s memory bullet is there').toBeGreaterThan(-1);
    const para = spec.slice(at, spec.indexOf('- **`$REG/reclaim-paused` stops both lanes at once**', at));
    expect(para).not.toContain('never cause one');
    expect(para, 'the anchor survives a restart too (§5.4)').not.toContain('is the one thing a restart keeps');
    expect(para, 'the lead sentence no longer claims every instant is re-learned').not.toContain('re-learns every instant');
    expect(para, 'an unreadable record no longer stops the lane (review 382, R2)').not.toContain('stops the lane for that pass');
    expect(para, 'the fallback is a wildcard, not an instant (review 382, R2)').not.toContain('which can only hold more than a readable record would');
    expect(para).not.toContain('each at that pass\'s instant');
    expect(para, 'the lost backoff is not the only way, now it is (review 382, R3)').not.toContain('the one way a restart can bring an act forward, still behind');
    expect(para, 'two ways, not one (review 382, fix round 3)').not.toContain('the one way a restart can bring an act forward');
    expect(para, 'no count of the ways (review 384, F1)').not.toContain('those are the two ways a restart can bring an act forward');
    expect(para, 'no released build reads the record (review 384, F2)').not.toContain('an older build reads the flagged record as unreadable and stops');
    for (const item of ['The dead-coordinator lane keeps two things across a restart',
      'One is its first-dead anchor (`dead_claimants`), which is re-anchored only after a gap of more than ten minutes (`DEAD_COORDINATOR_GAP_MS`) in which no pass measured the claimant crashed, so a restart shorter than that keeps the hour',
      'The other is the breaker\'s hold: its held set is a `run_events` row in `coord.db`, written when the set changes (in shadow too) and read back at the lane\'s first pass',
      'A record the lane cannot read does not stop it: for that pass the lane holds every claimant the pass does not release, each flagged in the new record (a `*` after its instant), and writes that record over the bad one, so the bad row is never read again',
      'A flagged claimant clusters with any other crashed or held claimant, whatever the instants, until evidence releases it, so every claimant a readable record would hold is held too; the cost is that while one stands a coordinator that crashes is swept into the hold and is flagged itself, until evidence releases it or fewer than two entries stand',
      'The server logs a `ccrc-server: sweepDeadCoordinators could not read the breaker\'s record of its hold` warning, once per bad row, and writes one feed row, "dead coordinator: breaker record unreadable", which is the operator\'s sign',
      'releases on what releases it without a restart', 'the run of crashed passes starts again, which delays an act',
      'a restarted lane can ask for that abandon SOONER than an unrestarted one would, and a server that restarts while a held-set write is failing seeds the older record, which can hold less than the process did, which needs a store whose writes keep failing at that moment',
      'The breaker\'s clustering is monotone (§5.4), so after a restart its breaker stands wherever an unrestarted lane\'s does, but for one open corner: a claimant the unrestarted lane already ended can come back under a new run while the restarted lane, its act delayed by the lost backoff, still holds the old one at an older instant',

      'The lane composes no act on a pass whose held-set record did not land, so the record never lags an act, and every act is still behind the claimant\'s re-measure before and after the fleet act']) {
      expect(para, item).toContain(item);
    }
  });
});

describe('§12 says the ledger\'s consequence of an abandoned programme\'s row (review 381, §12 observation on (f))', () => {
  it('mail to the coordinator with no runId is refused while nothing else is active, and goes to ANOTHER programme\'s coordinator when exactly one other is', () => {
    const spec = flat('docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md');
    const b = spec.slice(spec.indexOf('## 12. Before arming'));
    expect(b).toContain('The consequence: `toId:\'coordinator\'` mail that carries no `runId` is refused while nothing else is active, and goes to ANOTHER programme\'s coordinator when exactly one other programme is active; mail naming a `runId` still resolves.');
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
  it('§5.4 records wave 6: the journal’s trust read again after the claimant’s measure, and a hold after the fleet act', () => {
    const s = flat('docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md');
    const w6 = s.slice(s.indexOf('**As wave 6 closes the lane** (each a departure named in the wave-6 plan', s.indexOf('### 5.4 Stage 4')),
      s.indexOf('## 6. What this changes outside itself'));
    for (const item of ['**The journal\'s trust is read again after the claimant\'s measure.**',
      'with nothing awaited between that read and the commit, so the revive window stays the measure\'s own round trip',
      'a failure counted during the measure where the early read saw none makes it unknown, and the claimant unmeasured',
      'A further failure on top of one already counted is not seen before the commit.', '**A hold met after the fleet act is recorded.**'])
      expect(w6).toContain(item);
  });
  it('§12 says what to know before arming the dead-coordinator lane: the early reads, the residuals, the stale mirror', () => {
    const s = flat('docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md');
    const b = s.slice(s.indexOf('## 12. Before arming'));
    for (const item of ['**The dead-coordinator lane (`$REG/dead-coordinator-lane-live`).**',
      '**Arm it after the expiry lane**, once its own shadow list is read and any breaker trip is worked through.',
      '**The three early reads, and what wave 6 closes.**', 'One thing stays early', 'is not seen before the commit',
      '**The journal-gap trade.**', 'stays listed as unmeasured, never ended, until it spawns again', 'Ageing a gap out is carried',
      '**Two residuals stand.**', 'A lane gap of over ten minutes re-anchors every crashed coordinator on the same pass',
      'sub-second to one agent round trip, can still lose its runs', '**A permanently unreadable generation pins the mirror `stale`**',
      // Review 384, F2: a rollback fails open.
      '**Roll back below this release only with the lane disarmed.**',
      'No released build before this one reads the breaker\'s held-set record, so a rollback below it (`ccrc rollback`, or the unattended update watchdog) starts with no hold',
      'arm the lane only on a release that carries the reader, and before rolling back below it remove `$REG/dead-coordinator-lane-live`: the lane then only records, and never acts',
      '(f) Should a new run under an abandoned programme return its row to active?',
      '(g) A stale mirror at the act keeps the run of crashed passes']) expect(b).toContain(item);
    // Review 384, F1: R5's corner is closed by the monotone breaker, so it is no residual.
    expect(b).not.toContain('**Three residuals stand.**');
    expect(b).not.toContain('A third, a breaker corner');
    expect(b).not.toContain('the breaker\'s hold wins over a re-anchored instant, and that can keep a fresh cluster from forming');
    expect(b).not.toContain('**One breaker corner predates the restart fix.**');
    expect(b).not.toContain('any other crashed claimant is held with it');
  });
  it('README says the act reads the mirror again after it measures the coordinator (wave 6)', () => {
    expect(flat('README.md')).toContain('A mirror gone stale, or a gap recorded, while the act measures the coordinator stops it too: the act reads both again after it.');
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

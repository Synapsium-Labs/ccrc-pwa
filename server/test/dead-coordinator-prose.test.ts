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
    expect(para, 'the older record is no longer seeded (D-4857)').not.toContain('seeds the older record');
    expect(para, 'every unreleased claimant is no longer said to be held (review 401, F3)').not.toContain('makes the lane hold every claimant that pass does not release');
    expect(para, '(7) is closed by the seal, not a dirty mark that failed (D-4916)').not.toContain('unless the dirty mark itself failed');
    expect(para, 'a clean state is no longer trusted at a start (D-4916)').not.toContain('under a clean state the first pass still flags');
    expect(para, 'a restart over a state that is not sealed is no longer a dirty-only case (D-4916)').not.toContain('the first pass over a dirty, absent or unreadable state restarts every crashed claimant\'s hour');
    for (const item of ['A restart keeps the lane\'s first-dead anchor (a gap of more than ten minutes re-anchors it, as above)', 'and the breaker\'s hold (the typed state above, read back at the first pass',
      'and trusted only when it reads `sealed`, which a clean shutdown writes (D-4916)',
      'a state that is clean but not sealed, dirty, absent or cannot be read makes the lane flag every claimant that pass does not release, beside every member, instant and flag it can still read, and write an exact record, with a warn line and a feed row saying so',
      'a flagged claimant clusters with any other crashed or held claimant, whatever the instants, until evidence releases it, so every claimant a readable record would hold is held too, but only when two or more stand unreleased (one alone holds nothing and only has its hour restarted, and a flagged pair dissolves when evidence releases one of the two), at the cost that while one stands a claimant that crashes is swept into the hold and is flagged itself, until evidence releases it or fewer than two stand',
      'restarts the run of crashed passes, which delays an act', 'drops the backoff after a stuck or thrown act, which can bring an abandon back sooner',
      'Every pass that changes an anchor or the held set first marks the state dirty, alone, then writes the exact snapshot, every anchor change and the state clean in one transaction; a mark or a commit that fails, or a statement that throws between them, keeps the changes pending and the new hold in memory and acts on nothing, so a restart finds the last complete state, a dirty one or the new complete one, and a state no start trusts unless a clean shutdown sealed it (D-4857, D-4916; §12\'s residual (7) is closed by the seal)',
      'the server\'s shutdown handler (SIGTERM and SIGINT, `index.ts`) stops the lane and seals within a bound of five seconds when nothing is pending, warns once on a refusal, never throws and re-raises the signal, and the first pass of a process that read `sealed` unseals it before it can change state or act',
      'an unclean exit starts conservatively, which is a cost: each crashed claimant\'s hour restarts, and two or more unreleased claimants hold the lane, flagged, until evidence releases one',
      'under a sealed state the first pass still flags every claimant whose durable anchor began after the snapshot was written (D-4826)',
      'The lane composes no act on a pass whose commit did not land, so the durable state never lags an act',
      're-measure before and after the fleet act']) expect(para, item).toContain(item);
  });
  it('§5.4\'s breaker bullet names the typed state (D-4857) and the run_events record beside it, written when the set changes, shadow included', () => {
    const at = spec.indexOf('- **The breaker remembers.**');
    expect(at).toBeGreaterThan(-1);
    const para = spec.slice(at, spec.indexOf('- **One claimant a pass**', at));
    expect(para, 'a typed table now (D-4857)').not.toContain('no new table or column');
    for (const item of ['a `run_events` observation row', 'whenever the held set changes, in shadow too',
      'kept in `coord.db`\'s typed breaker state, `dead_coordinator_breaker_state`',
      'first-dead instants', 'ids percent-escaped by a total encoding (a lone surrogate is `%u` and four hex digits), so any claimant id is carried',
      // Review 384, F1: the clustering is monotone, and its cost.
      'Its clustering is monotone: a member keeps every first-dead instant it has carried while held, adds its current anchor each time it is crashed and anchored, and clusters at all of them, and two entries cluster when any instant of one is within the window of any instant of the other',
      'so a held instant never replaces a re-anchored one, and, for the passes and evidence both lanes share, a restarted lane\'s breaker stands wherever an unrestarted lane\'s does, under the conditions §12 names; anchors and releases are pass-sampled (review 384, F1; review 385, F3)',
      'the cost is that a member held at an old instant that crashes anew also clusters near its new instant, and a held member\'s instants, and its record, grow by one per re-anchor while it is held',
      '(several instants of one member are `+`-joined; a member the fallback below holds carries a `*` after the list)']) expect(para, item).toContain(item);
    expect(para, 'a member no longer keeps only its first instant (review 384, F1-N1)').not.toContain('keeps its remembered first-dead instant and, while it is also crashed');
    expect(para, 'the returning-id corner is closed, not left open (D-4825)').not.toContain('but for the open corner named in §12');
    expect(para, 'the comparison is for shared anchors only (review 384, G1)').not.toContain('and a restarted lane\'s breaker stands wherever an unrestarted lane\'s does, under');
  });
  it('§5.4\'s anchor bullet: a heartbeat later than the anchor starts a fresh anchor, a new episode (D-4825)', () => {
    const at = spec.indexOf('- **The anchor restarts after a gap nobody measured.**');
    expect(at).toBeGreaterThan(-1);
    const para = spec.slice(at, spec.indexOf('- **The breaker holds the whole lane**', at));
    for (const item of ['A claimant crashed with evidence of a later life later than its anchor starts a fresh anchor, as a first crash does, and the hour counts from it',
      'a supervisor heartbeat (supervision evidence: re-stamped every 30 seconds, at every supervisor start and by a swap, so it also shows a supervisor\'s restart) or the trusted journal\'s newest successful spawn (which covers an unsupervised fallback that stamps none), either later than the anchor and not after now',
      'the breaker adds that instant to every instant it remembers', 'a lane that skipped the pass that saw it alive no longer keeps the old episode alone (D-4825, D-4827)',
      'A later life that leaves neither is not seen, and in remote mode a fleet clock running behind the server\'s can hide one; neither is permissive']) expect(para, item).toContain(item);
    expect(para, 'a heartbeat is supervision evidence, not spawn evidence (D-4827)').not.toContain('has been supervised again since the anchor began');
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
    expect(para, 'the death window is closed, not unarmed (D-4826)').not.toContain('doubted on that very pass');
    expect(para).not.toContain('no act runs under it');
    expect(para).not.toContain('which needs a store whose writes keep failing at that moment');
    expect(para).not.toContain('That rests on the heartbeat: a return that stamps none is not seen');
    expect(para, 'the checkpoint ends the quiet-system over-hold (D-4826)').not.toContain('The cost is safe over-holding: after a restart two crashed claimants whose anchors began after the last record');
    expect(para, 'an arming blocker, not a question pending a ruling (H1)').not.toContain('pending a ruling');
    expect(para, 'the write-failure class is open, not closed by D-4826 (H1)').not.toContain('also closes R3');
    expect(para, 'no unconditional comparison (review 384, G1)').not.toContain('when both read the same anchors and the restarted lane');
    expect(para, 'the returning-id corner is closed, not open (D-4825)').not.toContain('One case is open, not argued, and not claimed to be the only one');
    expect(para, 'no released build reads the record (review 384, F2)').not.toContain('an older build reads the flagged record as unreadable and stops');
    expect(para, 'the write-failure class is closed (D-4857)').not.toContain('ARMING BLOCKER');
    expect(para, 'no older record is seeded (D-4857)').not.toContain('seeds the older record');
    expect(para, 'a failed commit withholds the act (D-4857)').not.toContain('a failed checkpoint of an unchanged set withholds no act');
    expect(para, 'a later mark no longer counts in place of the unseal (R1.5)').not.toContain('no act and no `unchanged` shortcut happens until a write of this process has landed');
    expect(para, 'a mark that failed is no longer a way to find a clean state missing a hold (D-4916)').not.toContain('which is the one way a restart can still find a clean state missing a hold');
    expect(para, 'a clean state is no longer trusted at a start (D-4916)').not.toContain('Under a clean state the first pass also flags');
    expect(para, 'the conservative seed is a cost on an unclean exit, and holds only for two or more (review 401, F3)').not.toContain('after a restart over a dirty, absent or unreadable state, every claimant the pass does not release is held, flagged');
    for (const item of ['The dead-coordinator lane keeps two things across a restart',
      'One is its first-dead anchor (`dead_claimants`), which is re-anchored after a gap of more than ten minutes (`DEAD_COORDINATOR_GAP_MS`) in which no pass measured the claimant crashed, or when evidence of a later life shows (D-4825, D-4827), so a restart shorter than that keeps the hour',
      'The other is the breaker\'s hold: its typed state in `coord.db` (`dead_coordinator_breaker_state`: `sealed` or `clean`, each with the exact held snapshot, or `dirty`), written by every pass that changes an anchor or the held set (in shadow too), with a `run_events` record of each change, and read back at the lane\'s first pass, where only a `sealed` state is trusted as it reads (D-4916, below)',
      'A state the lane finds dirty, clean (not sealed), absent or unreadable does not stop it: for that pass the lane flags every claimant the pass does not release, each flagged in the new record (a `*` after its complete `+` list of instants), beside every member, instant and flag it can still read, and writes an exact record before the state is clean or anything acts',
      'A flagged claimant clusters with any other crashed or held claimant, whatever the instants, until evidence releases it, so every claimant a readable record would hold is held too; the cost is that while one stands a coordinator that crashes is swept into the hold and is flagged itself, until evidence releases it or fewer than two entries stand',
      'The flags HOLD only when two or more claimants stand unreleased: a single one holds nothing and only has its hour restarted, which is a delay, and a flagged pair dissolves when evidence releases one of the two',
      'The server logs one warning and writes one feed row saying which, the operator\'s sign: "dead coordinator: no breaker state yet" when there is no state, "dead coordinator: breaker state left dirty", "dead coordinator: breaker state not sealed" when the state reads clean but no clean shutdown sealed it, or, with a `ccrc-server: sweepDeadCoordinators could not read the breaker\'s record of its hold` warning, "dead coordinator: breaker record unreadable"',
      'releases on what releases it without a restart', 'the run of crashed passes starts again, which delays an act',
      'a restarted lane can ask for that abandon SOONER than an unrestarted one would',
      'Every pass that changes an anchor or the held set marks the state dirty first, alone, and then commits the exact snapshot, every anchor change and the state clean in one transaction. A mark or a commit that fails changes no durable anchor and acts on nothing; its anchor changes stay pending in memory, laid over the durable anchors and re-sent by the next commit, and the in-memory hold moves to that pass\'s before the first statement that can throw, and a throw anywhere between the mark and the commit\'s result (the carrier read included) is the commit-failed path, so a failed write or a thrown statement never forgets a trip or a doubt in the process that saw it. A commit that fails leaves the state dirty, so a restart is conservative; a mark that fails leaves the state as the last write left it, which is `clean` and never `sealed`, because the first pass of every process unseals (D-4857, D-4916)',
      'A start trusts the stored snapshot ONLY when the state reads `sealed`; `clean`, `dirty`, absent, unreadable and malformed all seed conservatively',
      'on SIGTERM or SIGINT it stops the watcher, asks the lane to seal within one bound of five seconds (well inside systemd\'s default stop timeout of ninety, which the unit leaves alone',
      'logs one `ccrc-server: shutdown:` warn line when the seal is refused or fails, never throws, and re-raises the same signal',
      'only when no pass is in flight (a pass is awaited within the bound), a write of this process has landed, no anchor change is pending, the state is durably clean and the held set\'s key is the one the last commit wrote; otherwise it writes nothing and says which. A seal attempt stops the lane: no pass runs after it',
      'The first pass of a process that read `sealed` writes `clean` back, before any step can change state or act (eagerly, not at the first change',
      'until that unseal has landed a sealed start writes nothing else (a later mark or commit does not count in its place) and acts on nothing, and takes no `unchanged` shortcut; a conservative seed\'s permission is its first landed commit',
      'Under a sealed state the first pass also flags, at its anchor instant, every claimant of the population whose durable anchor began after the snapshot was written (D-4826); since every anchor change of this release commits with its snapshot, that is only an older build\'s anchor, written after a rollback',
      'Anchors and releases are pass-sampled: an anchor sits on its lane\'s own pass, up to one cadence after the crash, evidence that releases a hold is seen only at a pass, and a restart moves the pass grid as any start does, so a pair near the ten-minute window\'s edge can cluster or release in one lane and not in the other, the lane with more passes may act sooner, and the comparison below is claimed only for the passes and evidence both lanes share',
      'The breaker\'s clustering is monotone (§5.4), so for the passes, anchors and evidence both lanes share a restarted lane\'s breaker stands wherever an unrestarted lane\'s does when the restarted lane\'s population differs only by claimants the unrestarted lane has already ended. A claimant the unrestarted lane ended that returns under a new run is covered by the episode boundary: a supervisor heartbeat later than its durable anchor starts a fresh anchor at its next crash, so the restarted lane carries the new instant beside every one it remembers (D-4825). That rests on a heartbeat or a journaled successful spawn (D-4827): a return that leaves neither is not seen, in remote mode a fleet clock behind the server\'s can hide one, and no claim is made that no other corner exists',
      'The lost backoff has a knock-on: if the unrestarted lane backs off a stuck claimant while the restarted lane, its backoff lost, ends it, the unrestarted lane keeps that claimant as an extra entry that can cluster with a new crash, so the restarted lane can end a third claimant the unrestarted lane holds',
      'The class mail 4266 measured, and residual (7) after it, are CLOSED, not accepted (D-4857, D-4916): a held instant that lived only in memory because held-set writes failed while anchor writes landed, its anchor deleted by a doubt before a restart, cannot arise, because no anchor change lands without the snapshot that holds it, a commit that fails leaves the state dirty, which a restart reads as fail-shut, and every claimant id, a lone surrogate included, has a spelling; the same loss through a mark that fails is closed by the seal, because a state that was not sealed by a clean shutdown is never trusted',
      'The snapshot is written with the write-time clock of the commit that carries the pass\'s anchor changes, so an anchor of that pass is not flagged. The cost is the conservative seed\'s, and it is a COST, not a residual: after an unclean exit (a kill, an OOM kill, a crash, or a stop that outlives systemd\'s timeout) or over a dirty, absent or unreadable state, every claimant the pass does not release is flagged, and held when two or more stand unreleased, until evidence releases it, and no durable anchor is taken as continuing, so each crashed claimant\'s hour restarts at that pass (an hour\'s delay for each, the deploy\'s first pass included); a clean shutdown pays none of it; while the breaker\'s writes keep failing nothing acts. The limit: a server clock that steps backwards across a restart can make a later anchor read earlier than the snapshot',
      'The lane composes no act on a pass whose commit did not land, so the durable state never lags an act, and every act is still behind the claimant\'s re-measure before and after the fleet act']) {
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
      '**Its wave-5 arming blockers are closed**', '**The accepted residuals, every one of them**',
      '(1) A lane gap of over ten minutes re-anchors every crashed coordinator on the same pass',
      '(2) A revive of the same id inside the act\'s last re-measure window, sub-second to one agent round trip, can still lose its runs',
      '(3) Anchors and releases are pass-sampled', 'the lane with more passes may act sooner',
      '(4) A restart drops the in-memory backoff and retry population (`nextAskAt`, `attempts`), so a restarted lane can let another claimant proceed sooner',
      'it still re-audits, waits its durable hour, re-measures before and after the act, and is blocked by the durable breaker hold',
      '(5) A later life that leaves neither a supervisor heartbeat nor a journaled successful spawn is not seen, and in remote mode a fleet clock running behind the server\'s can hide one',
      '(6) A start over a state that is not `sealed` (an unclean exit: a kill, an OOM kill, a crash, or a stop that outlived systemd\'s timeout; a dirty, absent or unreadable state; the deploy that creates the table is one such start) flags every claimant its first pass does not release and restarts every crashed claimant\'s hour at that pass, which is a COST of the seal\'s design, paid only on an unclean exit',
      'It HOLDS only when two or more claimants stand unreleased, and then until evidence releases one of them (a flagged pair dissolves when evidence releases one of the two); a single unreleased claimant holds nothing and only has its hour restarted, a delay; while the breaker\'s writes keep failing nothing acts',
      '(7) is CLOSED, not accepted (D-4916, the operator\'s choice of 2026-10-13)',
      'because only a state a clean shutdown sealed is trusted and the first pass of every process unseals it',
      'What stands is the floor any durable design has, named so it is not mistaken for a hole: a process none of whose writes lands, from its first pass to its death, leaves no trace, so the next start trusts the older seal and the trip, doubt or release that process held in memory is lost with it',
      'it needs the store to refuse every write for a process\'s whole life and then recover for the next, and it is not the class mail 4266 measured',
      'The class mail 4266 measured is not on this list because it is closed, not accepted (D-4857)',
      'Each of (1), (2), (5) and (6) only delays an act or holds more; (3) and (4), and the floor named in (7), can bring an act sooner',
      '**The deploy that creates the breaker\'s table starts conservatively, once.**',
      'It HOLDS only when two or more such coordinators stand unreleased; one alone has its hour restarted, a delay, and a flagged pair dissolves when evidence releases one of the two',
      'What lasts, while both lanes are shadowed, is that flagged hold, only for two or more: an operator arming later should expect it while they are still crashed, and it releases through the doors that already exist: revive, reclaim or abandon',
      'a clean shutdown (SIGTERM or SIGINT, handled in `index.ts`) seals the state and the next start pays none of it (D-4916)',
      'an older build neither reads nor writes `dead_coordinator_breaker_state`',
      'so on rolling forward again the state reads as this release left it (sealed, trusted, when it stopped cleanly; clean, seeded conservatively, when it did not)',
      '**A permanently unreadable generation pins the mirror `stale`**',
      // Review 384, F2: a rollback fails open.
      '**Roll back below this release only with the lane disarmed.**',
      'No released build before this one reads the breaker\'s held-set record, so a rollback below it (`ccrc rollback`, or the unattended update watchdog) starts with no hold',
      'arm the lane only on a release that carries the reader, and before rolling back below it remove `$REG/dead-coordinator-lane-live`: the lane then only records, and never acts',
      '(f) Should a new run under an abandoned programme return its row to active?',
      '(g) A stale mirror at the act keeps the run of crashed passes']) expect(b).toContain(item);
    // Review 384, F1: R5's corner is closed by the monotone breaker, so it is no residual.
    expect(b).not.toContain('**Three residuals stand.**');
    expect(b, 'H1 is an arming blocker, not a question pending a ruling').not.toContain('pending a ruling');
    expect(b, 'and the blocker is closed (D-4857)').not.toContain('unresolved ARMING BLOCKER');
    expect(b, 'the in-process hour is not lost to a failed write (review of D-4857)').not.toContain('an hour counts only from a committed anchor');
    expect(b, 'a failed mark can bring an act sooner after a restart (review of D-4857)').not.toContain('(3) and (4) can bring an act sooner');
    expect(b, 'the window ends at a landed mark, not a commit (re-review of D-4857, W1)').not.toContain('before any later commit lands');
    expect(b, 'the window ends at a landed mark, not a commit (re-review of D-4857, W1)').not.toContain('as the last commit wrote it');
    expect(b, 'no count, no blanket closure (review 385, G2)').not.toContain('**Two residuals stand.**');
    expect(b, 'the ten-minute bound was false for a trip (review 401, F1)').not.toContain('it can bring an act sooner only when the restarted lane\'s first crashed pass falls within ten minutes');
    expect(b, '(7) is closed, no longer a restart after a mark that failed that acts sooner (D-4916)').not.toContain('(3), (4) and (7) can bring an act sooner');
    expect(b, 'a conservative start holds only for two or more (review 401, F3)').not.toContain('holds every claimant its first pass does not release, flagged, until evidence releases each');
    expect(b, 'the deploy bullet no longer says the first pass holds every coordinator (review 401, F3)').not.toContain('its first pass holds every coordinator it does not see alive');
    expect(b, 'the deploy bullet is not "one conservative pass" (review 401, F4)').not.toContain('That is one conservative pass');
    expect(b, 'the deploy bullet\'s old title').not.toContain('holds once, conservatively');
    expect(b).not.toContain('**Its arming blockers are closed** (wave 5)');
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

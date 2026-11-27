// The box frames recipe's capture lane (Desktop polish wave 187; plan docs/superpowers/plans/2026-11-26-box-frames-recipe.md
// sections 5.3 and 6; `buildCaptureLane.ts#framesPass`): the third job of a pass, sent only when the pass sent no trust job and
// no delivery job; its result is checked AGAIN here (`checkReducedFrame` beside the live masker) and lands in
// `claude_build_frames` with its text only when that check is clear; recording sets aside the texts of the builds past the newest
// four. It NEVER touches a trust row or a delivery row. The transport and the masker are FAKES: nothing reaches a test box.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { NotifyLog } from '../src/notifylog.js';
import { BUILD_CAPTURE_SWEEP_MS, BuildCaptureLane, type BuildCaptureAnswer, type BuildCaptureLaneDeps, type BuildCaptureTransport } from '../src/buildCaptureLane.js';
import { BUILD_CAPTURE_RETRY_MS, buildTrustOf, type BuildCaptureJob } from '../../shared/claudeBuildTrust.js';
import { DELIVERY_PART_COUNT } from '../../shared/deliveryResult.js';
import { FRAMES_RECIPE_VERSION } from '../../shared/framesCapture.js';
import { FRAMES_STATUS_TEXT } from '../../shared/framesReduce.js';
import { FRAMES_KEEP_BUILDS } from '../../shared/framesLane.js';
import { FRAMES_PARTS, frameSize, type FramesCaptureResult } from '../../shared/framesResult.js';
import { deliveryResultFor } from './deliveryLaneHelpers.js';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';

// ONE migrated coord.db for the file (the delivery capture test's way): each case copies a template migrated once, a fresh warn
// spy per case, and every pass a case started is settled before the case ends.
let template = '';
const opened: CoordStore[] = [];
const started: Promise<unknown>[] = [];
beforeAll(() => {
  template = path.join(mkTmp('ccrc-frames-lane-template-'), 'coord.db');
  openCoordDb(template).close();
});
removeTmpFixturesEachTest(); // the template, made in beforeAll, is older than any case's mark and stays until the file ends
beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(async () => {
  await Promise.allSettled(started.splice(0));
  for (const o of opened.splice(0)) { try { o.db.close(); } catch { /* already closed */ } }
  vi.restoreAllMocks();
});
function freshStore(home: string): CoordStore {
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  copyFileSync(template, path.join(home, '.ccrc', 'coord.db'));
  const c = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  opened.push(c);
  return c;
}

type Answer = BuildCaptureAnswer | Promise<BuildCaptureAnswer>;
/** A fake transport: records every full job, answers what the row hands it. */
function fake(answer: (job: BuildCaptureJob) => Answer): BuildCaptureTransport & { jobs: BuildCaptureJob[] } {
  const jobs: BuildCaptureJob[] = [];
  return { jobs, capture: async (job) => { jobs.push(job); return answer(job); } };
}

const RULE = '─'.repeat(60);
/** A frame the reducer's check leaves as it is: two rule rows, a draft row and a footer row, none of them private. */
// The capture's status row sits directly under the box's lower rule (rule 8, review 4069's F3).
const STATUS = `  ${FRAMES_STATUS_TEXT}`;
const TEXT = [RULE, '❯ frames row 001 of 003 abcdefghij', RULE, STATUS, '  ? for shortcuts'].join('\n') + '\n';

/** A well-formed frames result for `build` and `part`: drawn with `text`, or, with null text, a frame the box's reducer refused. */
function resultFor(build: string, part: number, text: string | null = TEXT, version: string = FRAMES_RECIPE_VERSION): FramesCaptureResult {
  const p = FRAMES_PARTS[part]!;
  const size = frameSize(text ?? TEXT);
  return {
    recipe: 'frames', version, build, part, case: p.case, pane: p.pane, release: 'v0.0.1500', unmeasured: [], word: text === null ? 'gaps' : 'framed',
    sends: [{ step: 'send', send: 'ok' }], turns: 1, sideRequests: 0,
    frame: text === null
      ? { outcome: 'refused', refusal: 'private-name', ...size, cursor: null, replaced: null, text: null }
      : { outcome: 'drawn', refusal: null, ...size, cursor: [2, 1], replaced: { cwd: 0, path: 1, model: 0, account: 0 }, text },
  };
}

const trustPass = (job: BuildCaptureJob): BuildCaptureAnswer => ({ kind: 'answered', result: { build: job.build, pass: true, cwd: true, output: 'replay: 40 passed' } });
/** Every recipe answered well: a frames job gets `text`'s frame. */
const answering = (text: string | null = TEXT) => (job: BuildCaptureJob): BuildCaptureAnswer =>
  job.recipe === 'frames' ? { kind: 'answered', result: resultFor(job.build, job.part!, text) }
    : job.recipe === 'delivery' ? { kind: 'answered', result: deliveryResultFor(job.build, job.part!) } : trustPass(job);

/** The fake's text arm; the notices' `maskDeep` rides it unchanged, as the wired masker carries both. */
async function setup(transport: BuildCaptureTransport, text?: { maskText(t: string, o?: { rows?: boolean }): string }) {
  const home = mkTmp('ccrc-frames-lane-');
  const coord = freshStore(home);
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  let clock = 1_000_000_000_000;
  const masker: BuildCaptureLaneDeps['masker'] = text === undefined ? undefined
    : { maskDeep: <T>(v: T): T => v, maskText: (t, o) => text.maskText(t, o) };
  const lane = new BuildCaptureLane(() => ({ coord, notifyLog, buildCapture: transport, masker }), () => clock);
  const pass = (versions: (string | null)[] = []): Promise<void> => {
    clock += BUILD_CAPTURE_SWEEP_MS;
    const run = lane.sweep(versions);
    started.push(run);
    return run;
  };
  return { coord, lane, pass, tick: (ms: number) => { clock += ms; }, now: () => clock };
}
type Rig = Awaited<ReturnType<typeof setup>>;
/** Every delivery part of `build` already measured, so the delivery pass has nothing to send and a pass goes on to frames. */
function deliveriesDone(s: Rig, build: string): void {
  for (let p = 0; p < DELIVERY_PART_COUNT; p++) s.coord.recordDelivery(deliveryResultFor(build, p), 1);
}
const warned = (): string[] => (console.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));
// The rig's newest passed build; a fresh store trusts it, so a pass with no live build sends a job for it.
const RIG = '2.1.302';
const jobsOf = (t: { jobs: BuildCaptureJob[] }, recipe: 'frames' | 'delivery' | undefined) => t.jobs.filter((j) => j.recipe === recipe);

describe('the lane sends one frames job, after the trust part and the delivery part', () => {
  it('trust first, then every delivery part, then frames: never a frames job on a pass that sent another', async () => {
    const t = fake(answering());
    const s = await setup(t);
    await s.pass(['2.1.320']);
    expect(t.jobs).toEqual([{ build: '2.1.320' }]);
    for (let i = 0; i < DELIVERY_PART_COUNT; i++) {
      await s.pass(['2.1.320']);
      expect(t.jobs.at(-1), `pass ${i + 2}`).toEqual({ build: '2.1.320', recipe: 'delivery', part: i });
    }
    expect(jobsOf(t, 'frames'), 'no frames job while a trust or a delivery job went out').toEqual([]);
    expect(s.coord.claudeBuildFrames()).toEqual([]);
    await s.pass(['2.1.320']);
    expect(t.jobs.at(-1)).toEqual({ build: '2.1.320', recipe: 'frames', part: 0 });
  });

  it('a pass where delivery sent nothing: the newest trusted build\'s first missing part goes out with recipe frames', async () => {
    const t = fake(answering());
    const s = await setup(t);
    deliveriesDone(s, RIG);
    await s.pass();
    expect(t.jobs).toEqual([{ build: RIG, recipe: 'frames', part: 0 }]);
    s.coord.recordFrames(resultFor(RIG, 0), 'clear', 1, []);
    s.coord.markFramesAttempt(RIG, 1, 1, 'sent');
    s.coord.recordFrames(resultFor(RIG, 1), 'clear', 1, []);
    await s.pass();
    expect(t.jobs.at(-1), 'the first part with no current row').toEqual({ build: RIG, recipe: 'frames', part: 2 });
  });

  it('an undone delivery part holds frames back: the delivery job goes out, no frames job', async () => {
    const t = fake(answering());
    const s = await setup(t);
    await s.pass();
    expect(t.jobs).toEqual([{ build: RIG, recipe: 'delivery', part: 0 }]);
    expect(s.coord.claudeBuildFrames()).toEqual([]);
  });

  it('a queued build that is due takes the pass: the trust job goes out and no frames job with it', async () => {
    const t = fake((job) => (job.recipe === undefined ? { kind: 'unavailable', why: 'unanswered' } : answering()(job)));
    const s = await setup(t);
    deliveriesDone(s, RIG);
    await s.pass(['2.1.320']);
    expect(t.jobs).toEqual([{ build: '2.1.320' }]);
    // The trust job came back unanswered, so the queued build is not due for the hour: the next pass sends the frames job.
    await s.pass(['2.1.320']);
    expect(t.jobs).toEqual([{ build: '2.1.320' }, { build: RIG, recipe: 'frames', part: 0 }]);
    // Due again: the trust job takes the pass, and no frames job goes out with it.
    s.tick(BUILD_CAPTURE_RETRY_MS);
    await s.pass(['2.1.320']);
    expect(t.jobs).toHaveLength(3);
    expect(t.jobs[2]).toEqual({ build: '2.1.320' });
  });

  it('at most one frames capture a pass, the parts in order', async () => {
    const t = fake(answering());
    const s = await setup(t);
    deliveriesDone(s, RIG);
    for (let i = 0; i < 4; i++) await s.pass();
    expect(t.jobs).toEqual([0, 1, 2, 3].map((part) => ({ build: RIG, recipe: 'frames', part })));
    expect(s.coord.claudeBuildFrames().map((r) => `${r.part}:${r.word}:${r.attempts}`)).toEqual(['0:framed:1', '1:framed:1', '2:framed:1', '3:framed:1']);
  });

  it('at most one frames capture in flight for a box: a sweep while one is out sends nothing', async () => {
    let release: () => void = () => undefined;
    const t = fake((job) => new Promise((r) => { release = () => r(answering()(job)); }));
    const s = await setup(t);
    deliveriesDone(s, RIG);
    const first = s.pass();
    try {
      await s.pass();
      await s.pass();
      expect(t.jobs).toHaveLength(1);
    } finally {
      release();
    }
    await first;
    expect(s.coord.claudeBuildFrames()).toHaveLength(1);
  });

  it('a frames result never touches a trust row or a delivery row', async () => {
    const s = await setup(fake(answering()));
    deliveriesDone(s, RIG);
    const trust = JSON.stringify(s.coord.claudeBuilds());
    const deliveries = JSON.stringify(s.coord.claudeBuildDeliveries());
    await s.pass();
    expect(s.coord.claudeBuildFrames()).toHaveLength(1);
    expect(JSON.stringify(s.coord.claudeBuilds())).toBe(trust);
    expect(JSON.stringify(s.coord.claudeBuildDeliveries())).toBe(deliveries);
    expect(buildTrustOf(s.coord.claudeBuilds(), RIG)).toEqual({ kind: 'trusted', cwd: true });
  });
});

describe('the receiver\'s check: what is stored with the text', () => {
  it('a drawn frame whose text passes the check is recorded clear, with its text', async () => {
    const s = await setup(fake(answering()), { maskText: (t) => t });
    deliveriesDone(s, RIG);
    await s.pass();
    const row = s.coord.claudeBuildFrames()[0]!;
    expect(row).toMatchObject({ build: RIG, part: 0, version: FRAMES_RECIPE_VERSION, word: 'framed', checked: 'clear', text: TEXT, attempts: 1, notSent: null });
    expect(row.record!.frame.text, 'the record carries no text').toBeNull();
    expect(warned()).toEqual([]);
  });

  it('no masker given: the reducer\'s own shapes alone still clear a clean frame', async () => {
    const s = await setup(fake(answering()));
    deliveriesDone(s, RIG);
    await s.pass();
    expect(s.coord.claudeBuildFrames()[0]).toMatchObject({ checked: 'clear', text: TEXT });
  });

  it('a frame the box\'s reducer refused carries no text: recorded as gaps, clear, with no text, and nothing to check', async () => {
    const s = await setup(fake(answering(null)), { maskText: (t) => t });
    deliveriesDone(s, RIG);
    await s.pass();
    expect(s.coord.claudeBuildFrames()[0]).toMatchObject({ word: 'gaps', checked: 'clear', text: null, attempts: 1 });
    expect(s.coord.claudeBuildFrames()[0]!.record!.frame).toMatchObject({ outcome: 'refused', refusal: 'private-name', text: null });
  });

  it('a frame holding a path-like row, which the reducer\'s own rules would still replace, is recorded with its refusal word and NO text', async () => {
    const text = [RULE, '  cwd /work/project-a/src/main', RULE, STATUS, '  ? for shortcuts'].join('\n') + '\n';
    const s = await setup(fake(answering(text)), { maskText: (t) => t });
    deliveriesDone(s, RIG);
    await s.pass();
    const row = s.coord.claudeBuildFrames()[0]!;
    expect(row).toMatchObject({ word: 'framed', checked: 'private-shape', text: null, attempts: 1 });
    expect(row.record).not.toBeNull();
    expect(s.coord.db.prepare('SELECT text AS v FROM claude_build_frames WHERE build = ? AND part = 0').get(RIG)).toEqual({ v: null });
    expect(warned()).toEqual([expect.stringMatching(/^ccrc-server: frames capture: 2\.1\.302 frame 0 refused by the server's check \(private-shape\); its text is not stored$/)]);
  });

  it('a frame an address in it gives away is refused the same way: an email-shaped run', async () => {
    const text = [RULE, '  contact lane-a@example.com', RULE, STATUS].join('\n') + '\n';
    const s = await setup(fake(answering(text)), { maskText: (t) => t });
    deliveriesDone(s, RIG);
    await s.pass();
    expect(s.coord.claudeBuildFrames()[0]).toMatchObject({ checked: 'private-shape', text: null });
  });

  it('a frame the live masker would change is recorded masked, with NO text, and the masker is asked with rows on', async () => {
    const maskText = vi.fn((t: string, _o?: { rows?: boolean }) => t.replace('shortcuts', '*********'));
    const s = await setup(fake(answering()), { maskText });
    deliveriesDone(s, RIG);
    await s.pass();
    expect(s.coord.claudeBuildFrames()[0]).toMatchObject({ word: 'framed', checked: 'masked', text: null });
    expect(maskText).toHaveBeenCalledWith(expect.any(String), { rows: true });
    expect(warned()).toEqual([expect.stringMatching(/refused by the server's check \(masked\)/)]);
  });

  it('a refused frame still counts: its part is measured and the lane moves on to the next part', async () => {
    const t = fake(answering());
    const s = await setup(t, { maskText: (x) => x.replace('shortcuts', '*********') });
    deliveriesDone(s, RIG);
    await s.pass();
    await s.pass();
    expect(t.jobs.map((j) => j.part)).toEqual([0, 1]);
    expect(s.coord.claudeBuildFrames().map((r) => r.checked)).toEqual(['masked', 'masked']);
  });
});

describe('recording sets aside the texts beyond the newest four framed builds', () => {
  const OLD = ['2.1.290', '2.1.291', '2.1.292', '2.1.293', '2.1.294'];
  it('the incoming build counts as one of the four: the two oldest texts go, their records stay', async () => {
    const s = await setup(fake(answering()));
    deliveriesDone(s, RIG);
    for (const b of OLD) s.coord.recordFrames(resultFor(b, 0), 'clear', 1, []);
    const record = vi.spyOn(s.coord, 'recordFrames');
    expect(FRAMES_KEEP_BUILDS).toBe(4);
    await s.pass();
    expect(record).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ build: RIG, part: 0 }), 'clear', expect.any(Number), ['2.1.291', '2.1.290']);
    const rows = s.coord.claudeBuildFrames();
    const textOf = (b: string) => rows.find((r) => r.build === b)!.text;
    expect([RIG, '2.1.294', '2.1.293', '2.1.292'].map(textOf)).toEqual([TEXT, TEXT, TEXT, TEXT]);
    expect(['2.1.291', '2.1.290'].map(textOf)).toEqual([null, null]);
    for (const b of ['2.1.291', '2.1.290']) expect(rows.find((r) => r.build === b), b).toMatchObject({ word: 'framed', checked: 'clear', at: 1 });
    expect(rows).toHaveLength(OLD.length + 1);
  });

  it('a refused frame names the drops too, and keeps none of its own text', async () => {
    const s = await setup(fake(answering()), { maskText: (t) => t.replace('shortcuts', '*********') });
    deliveriesDone(s, RIG);
    for (const b of OLD) s.coord.recordFrames(resultFor(b, 0), 'clear', 1, []);
    await s.pass();
    const rows = s.coord.claudeBuildFrames();
    expect(rows.find((r) => r.build === RIG)).toMatchObject({ checked: 'masked', text: null });
    expect(rows.filter((r) => r.text !== null).map((r) => r.build).sort()).toEqual(['2.1.292', '2.1.293', '2.1.294']);
  });

  it('with four framed builds already holding text and the incoming a fifth, only the oldest goes', async () => {
    const s = await setup(fake(answering()));
    deliveriesDone(s, RIG);
    for (const b of OLD.slice(1)) s.coord.recordFrames(resultFor(b, 0), 'clear', 1, []);
    await s.pass();
    const withText = s.coord.claudeBuildFrames().filter((r) => r.text !== null).map((r) => r.build).sort();
    expect(withText).toEqual(['2.1.292', '2.1.293', '2.1.294', RIG]);
    expect(s.coord.claudeBuildFrames().find((r) => r.build === '2.1.291')).toMatchObject({ text: null, word: 'framed' });
  });
});

describe('what each other answer comes to', () => {
  it('an unavailable answer marks the attempt with its why: no attempt counted, no result', async () => {
    const s = await setup(fake(() => ({ kind: 'unavailable', why: 'busy' })));
    deliveriesDone(s, RIG);
    await s.pass();
    expect(s.coord.claudeBuildFrames()).toHaveLength(1);
    expect(s.coord.claudeBuildFrames()[0]).toMatchObject({ build: RIG, part: 0, attempts: 0, notSent: 'busy', word: null, record: null, text: null, checked: null });
    expect(s.coord.claudeBuildFrames()[0]!.lastAttemptAt).not.toBeNull();
  });

  it('a recipe-not-run answer is one log line, no attempt counted, the why recorded', async () => {
    const s = await setup(fake(() => ({ kind: 'unavailable', why: 'recipe-not-run', detail: 'the box refused the frame' })));
    deliveriesDone(s, RIG);
    await s.pass();
    expect(s.coord.claudeBuildFrames()[0]).toMatchObject({ attempts: 0, notSent: 'recipe-not-run' });
    expect(warned()).toEqual([expect.stringMatching(/^ccrc-server: frames capture: 2\.1\.302 part 0: not sent: the box refused the frame; /)]);
  });

  it('unanswered, and a throw: one counted attempt, spaced by the hour', async () => {
    for (const answer of [(): Answer => ({ kind: 'unavailable', why: 'unanswered' }), (): Answer => Promise.reject(new Error('boom'))]) {
      const t = fake(answer);
      const s = await setup(t);
      deliveriesDone(s, RIG);
      await s.pass();
      expect(s.coord.claudeBuildFrames()[0]).toMatchObject({ attempts: 1, notSent: null, record: null });
      await s.pass();
      expect(t.jobs, 'within the spacing').toHaveLength(1);
      s.tick(BUILD_CAPTURE_RETRY_MS);
      await s.pass();
      expect(t.jobs).toHaveLength(2);
      expect(t.jobs[1]).toEqual({ build: RIG, recipe: 'frames', part: 0 });
    }
  });

  it('a refused attempt stamp ends the pass before anything is recorded', async () => {
    const s = await setup(fake(answering()));
    deliveriesDone(s, RIG);
    vi.spyOn(s.coord, 'markFramesAttempt').mockReturnValue(false);
    const record = vi.spyOn(s.coord, 'recordFrames');
    await s.pass();
    expect(record).not.toHaveBeenCalled();
    expect(s.coord.claudeBuildFrames()).toEqual([]);
  });

  it('a refused record is one log line', async () => {
    const s = await setup(fake(answering()));
    deliveriesDone(s, RIG);
    vi.spyOn(s.coord, 'recordFrames').mockReturnValue(false);
    await s.pass();
    expect(warned()).toEqual([expect.stringMatching(/^ccrc-server: frames capture: the result for 2\.1\.302 part 0 could not be stored/)]);
  });

  it('another recipe\'s version: the attempt is stamped, no row, asked again after the spacing', async () => {
    const t = fake((job) => ({ kind: 'answered', result: resultFor(job.build, job.part!, TEXT, '0123456789abcdef') }));
    const s = await setup(t);
    deliveriesDone(s, RIG);
    await s.pass();
    expect(s.coord.claudeBuildFrames()[0]).toMatchObject({ part: 0, attempts: 1, word: null, record: null, text: null });
    await s.pass();
    expect(t.jobs, 'within the spacing').toHaveLength(1);
    s.tick(BUILD_CAPTURE_RETRY_MS);
    await s.pass();
    expect(t.jobs).toHaveLength(2);
    expect(t.jobs[1]).toMatchObject({ part: 0 });
  });

  it('an answer off the result\'s shape, and a trust-shaped one: one line, the attempt counted, no row', async () => {
    for (const result of [{ recipe: 'frames' }, { build: RIG, pass: true, cwd: true, output: 'ok' }]) {
      const s = await setup(fake(() => ({ kind: 'answered', result })));
      deliveriesDone(s, RIG);
      await s.pass();
      expect(s.coord.claudeBuildFrames()[0]).toMatchObject({ attempts: 1, record: null, text: null });
      expect(warned().filter((l) => /^ccrc-server: frames capture: the answer for 2\.1\.302 part 0 is not a frames result/.test(l))).toHaveLength(1);
      vi.mocked(console.warn).mockClear();
    }
  });

  it('a result for another part than the one asked is no result', async () => {
    const s = await setup(fake((job) => ({ kind: 'answered', result: resultFor(job.build, job.part! + 1) })));
    deliveriesDone(s, RIG);
    await s.pass();
    expect(s.coord.claudeBuildFrames()[0]).toMatchObject({ part: 0, attempts: 1, record: null });
  });
});

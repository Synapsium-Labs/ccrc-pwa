/**
 * The untrusted-build item (approvals plan 2026-11-18, §3.2.2 and Task 2.2; narrowed by slug item-only-when-given-up,
 * `docs/superpowers/programs/overlord/claude-release-unattended.md`). A child's prompt on an untrusted build is refused
 * `version-unverified` at mint, as on main (slug routing-reverted-until-capture), and the refusal raises NOTHING on Waiting on
 * you: the build's capture is ccrc's own work. Only a build ccrc has given up on (its capture failed at the ceiling) raises
 * ONE Waiting on you item, keyed by the build, from the capture lane; every other open item settles on the lane's next pass,
 * those raised before this change included.
 *
 * The deciders run case by case (`untrustedBuildItemCases.ts`, also the mutation floors' suite); the rest drives the real
 * questions owner's `raiseApproval` and the real capture lane over a fixture coordination store.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as mod from '../src/coord/untrustedBuildItem.js';
import { UNTRUSTED_BUILD_ITEM_CASES } from './untrustedBuildItemCases.js';
import { createQuestions, type ApprovalRaiseDeps, type ApprovalRaiseRequest } from '../src/coord/questions.js';
import { heldFor } from '../src/coord/heldFor.js';
import { rulingsAllowedHere } from '../src/coord/approvalsign.js';
import { SHAPE_ONLY_MASKER } from '../src/accounts/mask.js';
import { BuildCaptureLane, BUILD_CAPTURE_SWEEP_MS, type BuildCaptureTransport } from '../src/buildCaptureLane.js';
import { BUILD_CAPTURE_FAIL_CEILING, captureRetryAfterMs } from '../../shared/claudeBuildTrust.js';
import { CHILD, hookInput, requestBody, standardFixture, approvalCount, type Approvals } from './approvalsHarness.js';

describe('the deciders, case by case', () => {
  it.each(UNTRUSTED_BUILD_ITEM_CASES.map((c) => [c.name, c] as const))('%s', (_n, c) => c.run(mod));
});

let f: Approvals | undefined;
afterEach(async () => { if (f) await f.close(); f = undefined; });

const NOW = Date.now();
const req = (command = 'rm -rf build'): ApprovalRaiseRequest => {
  const b = requestBody(hookInput({ command }), CHILD);
  return { sessionId: CHILD, digest: b.digest, nonce: b.nonce, canonical: b.canonical };
};
const raiseDeps = (fx: Approvals, version: string | null): ApprovalRaiseDeps => ({
  coord: fx.coord, io: fx.deps.io, cfg: fx.deps.cfg, tmux: fx.deps.tmux, masker: SHAPE_ONLY_MASKER,
  signerFor: () => ({}) as never, rulingsAllowedHere, heldFor,
  denyStanding: async () => 'current' as const, liveVersionOf: async () => version, journalDigestMismatch: () => {},
});
const buildItems = (fx: Approvals, now = NOW) =>
  fx.coord.itemsFor(mod.UNTRUSTED_BUILD_ITEM_PROGRAMME, now).open.flatMap((i) => (i.action?.verb === 'untrusted-build' ? [i] : []));
/** An item as the approvals plan's PR 2 raised it from a refusal, before this change: what is open on the fleet now. */
const plantOldItem = (fx: Approvals, build: string): void => {
  fx.coord.raiseItem({
    program: mod.UNTRUSTED_BUILD_ITEM_PROGRAMME, runId: null, raisedBy: 'ccrc', kind: 'do',
    title: `Children on Claude Code ${build} cannot route permission prompts until it is captured`, why: 'w', how: ['h'],
    options: null, neededBy: 'soon', soonLabel: null, secretSlot: null, action: { verb: 'untrusted-build', build },
  }, NOW, 'ccrc');
};
const lane = (fx: Approvals, clock: () => number, transport?: BuildCaptureTransport) =>
  new BuildCaptureLane(() => ({ coord: fx.coord, feedEpoch: '', notifyLog: { record: (e: unknown) => e } as never, ...(transport ? { buildCapture: transport } : {}) }) as never, clock);

describe('a prompt on an untrusted build is refused at mint, and the refusal raises nothing on Waiting on you', () => {
  it('no row, queued, failed below the ceiling, and given up: each refused with its reason, nothing minted, no item', async () => {
    f = await standardFixture();
    const q = createQuestions({ coord: f.coord });
    f.coord.noteClaudeBuildsSeen(['2.1.331', '2.1.332', '2.1.333'], NOW);
    f.coord.recordClaudeBuildVerdict({ build: '2.1.332', pass: false, cwd: false, output: 'red' }, NOW);
    for (let k = 0; k < BUILD_CAPTURE_FAIL_CEILING; k++) {
      if (k > 0) f.coord.requeueClaudeBuild('2.1.333', { keepLadder: true });
      f.coord.recordClaudeBuildVerdict({ build: '2.1.333', pass: false, cwd: false, output: 'red' }, NOW);
    }
    const cases: [string, string, string][] = [
      ['2.1.330', 'rm -rf one', 'not-captured'], ['2.1.331', 'rm -rf two', 'capture-queued'],
      ['2.1.332', 'rm -rf three', 'capture-failed'], ['2.1.333', 'rm -rf four', 'capture-failed'],
    ];
    for (const [build, command, trust] of cases) {
      expect(await q.raiseApproval(req(command), raiseDeps(f, build), NOW + 1), build).toMatchObject({ kind: 'version-unverified', trust });
    }
    expect(approvalCount(f.coord)).toBe(0);
    expect(buildItems(f)).toEqual([]);
  });
  it('a build that could not be read is refused as before, and raises none', async () => {
    f = await standardFixture();
    expect((await createQuestions({ coord: f.coord }).raiseApproval(req(), raiseDeps(f, null), NOW)).kind).toBe('version-unverified');
    expect(buildItems(f)).toEqual([]);
  });
});

describe('the capture lane raises the item only when it gives up, and settles every other', () => {
  it('ON LANDING: the open items raised for builds ccrc is still handling settle on the first pass, with the handled note; a captured build\'s with its own', async () => {
    f = await standardFixture();
    for (const b of ['2.1.328', '2.1.329', '2.1.330']) plantOldItem(f, b);
    f.coord.noteClaudeBuildsSeen(['2.1.328', '2.1.329', '2.1.330'], NOW);
    f.coord.recordClaudeBuildVerdict({ build: '2.1.330', pass: true, cwd: true, output: 'ok' }, NOW);
    const t = NOW + 10;
    await lane(f, () => t).sweep([]);
    expect(buildItems(f, t)).toEqual([]);
    const cleared = f.coord.itemsFor(mod.UNTRUSTED_BUILD_ITEM_PROGRAMME, t).cleared.filter((i) => i.action?.verb === 'untrusted-build');
    expect(cleared.map((i) => i.state)).toEqual(['done', 'done', 'done']);
  });

  it('three failed captures, spaced: nothing is raised until the third; then one item, and a later pass raises no second', async () => {
    f = await standardFixture();
    const jobs: string[] = [];
    const failing: BuildCaptureTransport = { capture: async (job) => { if (job.recipe === 'delivery') return { kind: 'unavailable', why: 'no-runner' }; jobs.push(job.build); return { kind: 'answered', result: { build: job.build, pass: false, cwd: false, output: 'replay: 1 failed' } }; } };
    let t = NOW;
    const l = lane(f, () => t, failing);
    await l.sweep(['2.1.330']);
    for (let k = 1; k < BUILD_CAPTURE_FAIL_CEILING; k++) {
      expect(jobs).toHaveLength(k);
      expect(buildItems(f, t), `after failure ${k}`).toEqual([]);
      t += captureRetryAfterMs(k);
      await l.sweep(['2.1.330']);
    }
    expect(jobs).toHaveLength(BUILD_CAPTURE_FAIL_CEILING);
    expect(buildItems(f, t).map((i) => i.action)).toEqual([{ verb: 'untrusted-build', build: '2.1.330' }]);
    expect(buildItems(f, t)[0]!.title).toBe('Claude Code 2.1.330 failed its capture 3 times, and ccrc has stopped retrying');
    t += 100 * BUILD_CAPTURE_SWEEP_MS;
    await l.sweep(['2.1.330']);
    expect(jobs, 'given up: nothing is sent again by itself').toHaveLength(BUILD_CAPTURE_FAIL_CEILING);
    expect(buildItems(f, t)).toHaveLength(1);
    // The operator's Capture again puts it back in ccrc's hands: its item settles on the next pass.
    expect(f.coord.requeueClaudeBuild('2.1.330')).toBe('queued');
    t += BUILD_CAPTURE_SWEEP_MS;
    f.coord.recordClaudeBuildVerdict({ build: '2.1.330', pass: true, cwd: true, output: 'ok' }, t);
    t += BUILD_CAPTURE_SWEEP_MS;
    await l.sweep(['2.1.330']);
    expect(buildItems(f, t)).toEqual([]);
  });
});

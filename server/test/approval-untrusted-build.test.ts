/**
 * The untrusted-build item (approvals plan 2026-11-18, §3.2.2 and Task 2.2). A `version-unverified` refusal (Table 2a,
 * path 2) raises ONE Waiting on you item per untrusted build, keyed by the build: two refusals for one build raise one
 * item. When the record says the build passed its capture (D-8289's queue), the capture lane's pass settles it.
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
import { BuildCaptureLane } from '../src/buildCaptureLane.js';
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

describe('a version-unverified refusal raises the build\'s one item', () => {
  it('two refusals for one build raise one item, keyed by the build; a third build raises its own', async () => {
    f = await standardFixture();
    const q = createQuestions({ coord: f.coord });
    expect((await q.raiseApproval(req('rm -rf one'), raiseDeps(f, '2.1.330'), NOW)).kind).toBe('version-unverified');
    expect((await q.raiseApproval(req('rm -rf two'), raiseDeps(f, '2.1.330'), NOW + 1)).kind).toBe('version-unverified');
    expect(approvalCount(f.coord), 'nothing is minted').toBe(0);
    expect(buildItems(f).map((i) => i.action)).toEqual([{ verb: 'untrusted-build', build: '2.1.330' }]);
    expect(buildItems(f)[0]!.title).toBe('Children on Claude Code 2.1.330 cannot route permission prompts until it is captured');
    await q.raiseApproval(req('rm -rf three'), raiseDeps(f, '2.1.331'), NOW + 2);
    expect(buildItems(f).map((i) => i.action)).toEqual([
      { verb: 'untrusted-build', build: '2.1.330' }, { verb: 'untrusted-build', build: '2.1.331' },
    ]);
  });
  it('two refusals from two questions owners (a restart between them) still raise one: the key is the store\'s open item', async () => {
    f = await standardFixture();
    await createQuestions({ coord: f.coord }).raiseApproval(req(), raiseDeps(f, '2.1.330'), NOW);
    await createQuestions({ coord: f.coord }).raiseApproval(req(), raiseDeps(f, '2.1.330'), NOW + 1);
    expect(buildItems(f)).toHaveLength(1);
  });
  it('a build that could not be read raises none, and the refusal stands', async () => {
    f = await standardFixture();
    expect((await createQuestions({ coord: f.coord }).raiseApproval(req(), raiseDeps(f, null), NOW)).kind).toBe('version-unverified');
    expect(buildItems(f)).toEqual([]);
  });
  it('a trusted build raises none', async () => {
    f = await standardFixture();
    await createQuestions({ coord: f.coord }).raiseApproval(req(), raiseDeps(f, '2.1.302'), NOW);
    expect(buildItems(f)).toEqual([]);
  });
});

describe('a captured build settles its item', () => {
  it('the capture lane\'s next pass settles the item once the record says pass; another build\'s stays', async () => {
    f = await standardFixture();
    const q = createQuestions({ coord: f.coord });
    await q.raiseApproval(req(), raiseDeps(f, '2.1.330'), NOW);
    await q.raiseApproval(req(), raiseDeps(f, '2.1.331'), NOW);
    f.coord.noteClaudeBuildsSeen(['2.1.330', '2.1.331'], NOW);
    let t = NOW + 10;
    const lane = new BuildCaptureLane(() => ({ coord: f!.coord, feedEpoch: '', notifyLog: () => {} }) as never, () => t);
    await lane.sweep([]);
    expect(buildItems(f, t).map((i) => i.action), 'still queued: nothing settles').toHaveLength(2);
    expect(f.coord.recordClaudeBuildVerdict({ build: '2.1.330', pass: true, cwd: true, output: 'ok' }, t)).toBe(true);
    t += 120_000;
    await lane.sweep([]);
    expect(buildItems(f, t).map((i) => i.action)).toEqual([{ verb: 'untrusted-build', build: '2.1.331' }]);
    const settled = f.coord.itemsFor(mod.UNTRUSTED_BUILD_ITEM_PROGRAMME, t).cleared.find((i) => i.action?.verb === 'untrusted-build');
    expect(settled?.state).toBe('done');
  });
  it('a failed verdict settles nothing', async () => {
    f = await standardFixture();
    await createQuestions({ coord: f.coord }).raiseApproval(req(), raiseDeps(f, '2.1.330'), NOW);
    f.coord.noteClaudeBuildsSeen(['2.1.330'], NOW);
    f.coord.recordClaudeBuildVerdict({ build: '2.1.330', pass: false, cwd: false, output: 'red' }, NOW + 1);
    let t = NOW + 10;
    const lane = new BuildCaptureLane(() => ({ coord: f!.coord, feedEpoch: '', notifyLog: () => {} }) as never, () => t);
    await lane.sweep([]);
    t += 1;
    expect(buildItems(f, t)).toHaveLength(1);
  });
});

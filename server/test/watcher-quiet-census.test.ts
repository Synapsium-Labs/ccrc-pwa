// D-8140 (C17 item 1, the teardown flake): a ratchet over every server test file that builds a FleetWatcher.
//
// `FleetWatcher.tick()` fires writers it never awaits (the server-caps beat, the inventory run, a delegation pass). A
// test that ticks and ends without draining them leaves them running, and they `console.warn` after the file's last
// test: vitest's worker sends each console write over its rpc, and one that lands while the worker closes fails a
// shard whose every test passed ("EnvironmentTeardownError: Closing rpc while onUserConsoleLog was pending"). The
// remedy is `quietAtTestEnd` (or `quietWatcher`, or `drainWatcher` in the file's own teardown) in `laneQuiet.ts`.
//
// WHAT THIS PINS: a file whose text builds a watcher also names one of the TEARDOWN forms (`QUIETS`, or a
// `watcherTeardown()` whose `remove(` it calls, which quiets through `quietWatcher`), or stands on
// `EXEMPT` with its reason. `EXEMPT` may only shrink: its size is pinned, an entry whose file no longer builds a watcher
// or now quiets one goes red until it is removed, and a new builder that quiets nothing goes red until it does.
// `closeDelegation()` and `drainTick()` are not teardown forms: each is partial (the first leaves the server-caps beat
// and the inventory run, the second the delegation lane), and either can sit in the middle of one case, so a file that
// names only them is exempt as a partial quiet (review 1724 F1: such a mid-test call passed `asks-sweep.test.ts` at
// `df772b392` while no case quieted its fixture's watcher, the second cause CI found).
// WHAT IT CANNOT SEE: whether every watcher in a file is quieted (one named form passes the file), whether the form
// runs at a test's end (a `drainWatcher` call can sit mid-test too), and a watcher built in a rig file another file
// imports (the rig file is the one that must quiet it). Text, not parse: a comment that names a quieting call would
// pass a file, which review sees.
//
// The exemptions are the files a recorder run found writing nothing to the console after their last test on
// 2026-11-09 (C17's note, `docs/superpowers/plans/2026-10-22-desktop-polish/c17.md`, has the method and the counts).
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_ROOT = path.dirname(fileURLToPath(import.meta.url));
/** Spelled in two halves so this file is not a builder by its own needle. */
const BUILDS = new RegExp(['new Fleet', 'Watcher\\('].join(''));
/** The teardown forms (see the header): `closeDelegation(` and `drainTick(` are partial, so they are not here. */
const QUIETS = /\b(quietAtTestEnd|quietWatcher|drainWatcher)\(/;
/** `watcherTeardown()` (`watcherTeardown.ts`, D-6179) quiets what it tracks, through `quietWatcher`, in its `remove`:
 *  a file that registers it counts only when the name it is bound to calls that `remove(` (review 1724 F2), never for
 *  another `.remove(` in the file (review 1733 F1; D-8150). */
const TEARDOWN_REGISTERED = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*watcherTeardown\(/g;
const teardownRemoved = (src: string): boolean =>
  [...src.matchAll(TEARDOWN_REGISTERED)].some(([, name]) => new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}\\.remove\\(`).test(src));
const quiets = (src: string): boolean => QUIETS.test(src) || teardownRemoved(src);

/** Every `.ts` file under `server/test`, relative to it, sorted. `node_modules` and fixture trees are not entered. */
function testFiles(): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'fixtures' || e.name.startsWith('__')) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) visit(abs);
      else if (e.name.endsWith('.ts')) out.push(path.relative(TEST_ROOT, abs).split(path.sep).join('/'));
    }
  };
  visit(TEST_ROOT);
  return out.sort();
}

const MEASURED = 'builds a watcher and wrote nothing after its last test in the 2026-11-09 recorder run';
const RIG = 'a rig: every test file that imports it wrote nothing after its last test in the 2026-11-09 recorder run';
const HELD = MEASURED + '; held by another programme\'s claim when C17 ran, so not edited';
/** Review 1724 F1: the file names only a partial quiet, which the census counted until fix round 1. Not measured late. */
const PARTIAL = (call: string): string => `partial quiet: ${call}`;

/** Files that build a watcher and quiet none, each with why that is allowed today. May only shrink. */
const EXEMPT: Record<string, string> = {
  'approvals-routes.test.ts': MEASURED,
  'approvalsHarness.ts': RIG,
  'archived-expiry-child.test.ts': MEASURED,
  'archived-expiry-lane.test.ts': MEASURED,
  'ask-restart.test.ts': MEASURED,
  'asks-mint.test.ts': MEASURED,
  'asks-routes.test.ts': MEASURED,
  'backup-health.test.ts': MEASURED,
  'box-settings-read.test.ts': MEASURED,
  'brief-landed.test.ts': MEASURED,
  'caps-refresh.test.ts': MEASURED,
  'ccd-land-lineage-accept.test.ts': MEASURED,
  'change-latch-sites.test.ts': MEASURED,
  'child-reclaim-done-at.test.ts': MEASURED,
  'child-reclaim-generation-lane.test.ts': MEASURED,
  'child-reclaim-runs-route.test.ts': MEASURED,
  'child-reclaim-stale.test.ts': MEASURED,
  'child-reclaim-sweep.test.ts': MEASURED,
  'child-reclaim-watch-view.test.ts': MEASURED,
  'childReclaimGenerationFixture.ts': RIG,
  'claim-sweep.test.ts': MEASURED,
  'claimantClientFixture.ts': RIG,
  'claims-no-hold.test.ts': MEASURED,
  'collectLaneFixture.ts': PARTIAL('drainTick(), in a rig'),
  'coord-abandon.test.ts': MEASURED + '; it registers watcherTeardown() but never calls its remove(), so it quiets nothing',
  'coordinator-intent-route.test.ts': PARTIAL('closeDelegation()'),
  'ctx-pressure.test.ts': MEASURED,
  'dead-coordinator-lane.test.ts': MEASURED,
  'dead-dispatch-characterization.test.ts': MEASURED,
  'dead-dispatch-lane.test.ts': MEASURED,
  'delegation-adoption-corpus.test.ts': PARTIAL('closeDelegation()'),
  'delegation-adoption-lane.test.ts': PARTIAL('closeDelegation()'),
  'delegation-carrier-lane.test.ts': PARTIAL('closeDelegation()'),
  'delegation-compaction-lane.test.ts': PARTIAL('closeDelegation()'),
  'delegation-frame.test.ts': PARTIAL('closeDelegation()'),
  'delegation-pass-timing.test.ts': PARTIAL('closeDelegation()'),
  'delegation-sweep-clock.test.ts': PARTIAL('closeDelegation()'),
  'delegation-watch.test.ts': PARTIAL('closeDelegation()'),
  'delegation-wave3.integration.test.ts': PARTIAL('closeDelegation(); held by another programme\'s claim, so not edited'),
  'deliverability-parity.test.ts': MEASURED,
  'deps-shed-watcher.test.ts': MEASURED,
  'dialog.test.ts': MEASURED,
  'digest.test.ts': MEASURED,
  'disk-notice.test.ts': MEASURED,
  'disk-retention-beats.test.ts': MEASURED,
  'disk-sweep.test.ts': MEASURED,
  'divergence-sweep.test.ts': MEASURED,
  'feed-writers-pin.test.ts': MEASURED,
  'finished-push.test.ts': MEASURED,
  'fleet-health.test.ts': MEASURED,
  'fleet-identity-composition.test.ts': MEASURED,
  'fleetListingFixture.ts': RIG,
  'hibernate-census.test.ts': MEASURED,
  'host-pressure.test.ts': MEASURED,
  'idle-compact-nudge-lane.test.ts': MEASURED,
  'landing-checks-lane.test.ts': MEASURED,
  'lane-beats-characterization.test.ts': MEASURED,
  'lane-draft-never-blocks.test.ts': MEASURED,
  'lane-sweeps-characterization.test.ts': MEASURED,
  'ledger-sweep.test.ts': MEASURED,
  'lifecycle-sweep.test.ts': MEASURED,
  'mail-delivery-characterization.test.ts': MEASURED,
  'mail-sweep.test.ts': MEASURED,
  'name-sweep.test.ts': MEASURED,
  'orphan-tree-beat-ready.test.ts': PARTIAL('closeDelegation()'),
  'pr-sweep.test.ts': MEASURED,
  'projects-route-cache.test.ts': MEASURED,
  'push-copy.test.ts': PARTIAL('closeDelegation()'),
  'questions-clock-pin.test.ts': MEASURED,
  'questions-instances.test.ts': MEASURED,
  'questions-sequence-pin.test.ts': MEASURED,
  'radar-lane.test.ts': MEASURED,
  'readiness-sweep.test.ts': MEASURED,
  'reclaim-pause-pin.test.ts': MEASURED,
  'registry-migrated-callers.test.ts': MEASURED,
  'registry-refused-callers.test.ts': MEASURED,
  'registry-retained-callers.test.ts': MEASURED,
  'retire-executors-pin.test.ts': MEASURED,
  'roll-wake-admission.test.ts': MEASURED,
  'run-find.test.ts': MEASURED,
  'run-record.test.ts': MEASURED,
  'runs-page.test.ts': MEASURED,
  'served-account-acts.test.ts': MEASURED,
  'served-routes.test.ts': MEASURED,
  'server-caps.test.ts': MEASURED,
  'session-ladders-characterization.test.ts': MEASURED,
  'single-read-bad-id.test.ts': MEASURED,
  'sleep-lanes-pin.test.ts': MEASURED,
  'stop-done-sweep.test.ts': MEASURED,
  'sweep-close.test.ts': MEASURED,
  'tick-characterization.test.ts': MEASURED,
  'tick-concurrency.test.ts': MEASURED,
  'tick-refused-lanes.test.ts': MEASURED,
  'tickListingHarness.ts': RIG,
  'transcript-work.test.ts': MEASURED,
  'update-apply-routes.test.ts': MEASURED,
  'update-auto-dispatch.test.ts': MEASURED,
  'update-converge.test.ts': MEASURED,
  'update-inventory.test.ts': MEASURED,
  'update-projection.test.ts': MEASURED,
  'update-rollout-follow.test.ts': MEASURED,
  'update-routes.test.ts': MEASURED,
  'usage-sweep-lane.test.ts': MEASURED,
};
/** The pinned size of `EXEMPT`: lower it when an entry goes; raising it is a decision a reviewer sees. Raised once, from
 *  95 by the 13 partial quiets (fix round 1 of C17, review 1724 F1): a correction of what the census measured, not a
 *  new loud builder. It only falls from here: to 103 when `watcherTeardown` came to quiet through `quietWatcher` (F2). */
const EXEMPT_CEILING = 103;

describe('every test that builds a FleetWatcher quiets it, or is exempt with its reason (D-8140)', () => {
  const files = testFiles();
  const text = new Map(files.map((f) => [f, readFileSync(path.join(TEST_ROOT, f), 'utf8')] as const));
  const builders = files.filter((f) => BUILDS.test(text.get(f)!));

  it('CONTROL: the walk finds the builders, and the quieting helper is where the census says', () => {
    expect(builders.length, 'guards the guard: an empty walk passes everything').toBeGreaterThan(100);
    expect(text.get('laneQuiet.ts'), 'laneQuiet.ts exports the helpers this census names').toMatch(/export const quietAtTestEnd\b/);
  });

  it('a builder quiets its watcher, or stands on EXEMPT', () => {
    const loud = builders.filter((f) => !quiets(text.get(f)!) && !(f in EXEMPT));
    expect(loud, 'build a watcher, quiet none, and are not exempt: register quietAtTestEnd (laneQuiet.ts)').toEqual([]);
  });

  it('a partial or mid-test call does not quiet a file; a teardown form does (review 1724 F1, F2)', () => {
    const build = 'const w = new Fleet' + 'Watcher(deps, bus, 10_000);';
    const midTest = `it('x', async () => { ${build} await w.tick(); await w.closeDelegation(); });`;
    expect(BUILDS.test(midTest), 'the sample builds a watcher').toBe(true);
    expect(quiets(midTest), 'a mid-test closeDelegation() alone').toBe(false);
    expect(quiets(midTest.replace('w.closeDelegation()', 'drainTick(w)')), 'a drainTick() alone').toBe(false);
    expect(quiets(`afterEach(() => w.closeDelegation()); ${midTest}`), 'closeDelegation() in afterEach').toBe(false);
    expect(quiets(midTest.replace(build, `const w = quietAtTestEnd(${build.slice(10, -1)});`)), 'quietAtTestEnd').toBe(true);
    const tracked = midTest.replace(build, `const w = t.track(${build.slice(10, -1)});`);
    expect(quiets(`const t = watcherTeardown(); ${tracked}`), 'watcherTeardown() never removed').toBe(false);
    expect(quiets(`const t = watcherTeardown(); afterEach(() => t.remove(home)); ${tracked}`), 'watcherTeardown() removed').toBe(true);
    // Review 1733 F1: only the registered teardown's own remove counts, never another `.remove(` in the file.
    expect(quiets(`const t = watcherTeardown(); el.classList.remove('x'); ${tracked}`), 'an unrelated .remove(').toBe(false);
    expect(quiets(`const t = watcherTeardown(); afterEach(() => list.remove(home)); ${tracked}`), 'another handle removed, whose name ends in the teardown\'s').toBe(false);
    expect(quiets(`let teardown = watcherTeardown(); afterEach(() => teardown.remove(home)); ${tracked}`), 'a let binding removed').toBe(true);
  });

  it('EXEMPT only shrinks: every entry still builds a watcher and still quiets none, and its size is pinned', () => {
    const stale = Object.keys(EXEMPT).filter((f) => !builders.includes(f) || quiets(text.get(f)!));
    expect(stale, 'no longer need their exemption: remove them and lower EXEMPT_CEILING').toEqual([]);
    expect(Object.keys(EXEMPT).length).toBe(EXEMPT_CEILING);
    for (const [f, why] of Object.entries(EXEMPT)) expect(why.length, `${f}: an exemption names its reason`).toBeGreaterThan(10);
  });
});

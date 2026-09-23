// The projection (design 2026-09-20 §9): the rendered document, its SECONDS,
// both desireds, the server-role writer (tmp-then-rename, 0600, whole or
// nothing), resolveAndProject over a real coord.db on a fixture home, and the
// inventory run that calls it. Fixture HOMEs only (mkTmp); nothing here reads
// the live $HOME.
import { describe, it, expect, vi } from 'vitest';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import {
  CoordStore, type NodeMeasurement, type ReleaseListingRow,
} from '../src/coord/store.js';
import { UpdateIntentLog, defaultUpdateIntentLogPath } from '../src/coord/updateintentlog.js';
import { FLEET_LABEL, SERVER_LABEL } from '../src/update/inventory.js';
import { PROJECTION_LEASE_S, RESOLVE_DETAIL, renderProjection, type Resolution } from '../src/update/resolve.js';
import {
  PROJECTION_FILE_MODE, resolveAndProject, resolveInputFor, writeOwnProjection, type ProjectStore,
} from '../src/update/project.js';
import { FleetWatcher } from '../src/watch.js';
import type { Deps } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { NODE_FILES } from '../../shared/agent-protocol.js';
import type { NodeRole, UpdateChannel } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';
import { testDeps } from './helpers.js';

// THE PROJECTION'S GRAMMAR, restated in python on purpose: the reader that will
// consume this file on a node is not TypeScript, so the pin must not be either.
// It copies `ccd/ccd-pool-sync`'s discipline — a WHOLE-DOCUMENT pass over the
// exact bytes, with the 65536-byte cap and the `end` terminator as the
// torn-write detectors — and adds the two facts this document carries that
// pool-epoch's does not: lease = issued + 900 s, and `issued` is unix SECONDS
// near python's own clock (the C1 lesson recorded at GET /api/pools/epoch in
// server.ts). W4's real `ccd/ccd-update-sync` renderer TAKES THIS PIN OVER when
// it lands: the cross-side test then feeds GET /api/updates/intent/:nodeId
// through that file (the pool-accounts-route.test.ts shape) and this embedded
// copy is deleted with it.
const VALIDATOR = String.raw`
import re, sys, time
NUM = r"(?:0|[1-9][0-9]*)"
TAG = r"v[0-9]+\.[0-9]+\.[0-9]+"
GRAMMAR = [
    ("epoch", re.compile(r"epoch (%s)" % NUM)),
    ("issued", re.compile(r"issued (%s)" % NUM)),
    ("lease", re.compile(r"lease (%s)" % NUM)),
    ("channel", re.compile(r"channel (stable|dev)")),
    ("desired", re.compile(r"desired (%s|none)" % TAG)),
    ("desired-stable", re.compile(r"desired-stable (%s|none)" % TAG)),
    ("desired-dev", re.compile(r"desired-dev (%s|none)" % TAG)),
    ("auto", re.compile(r"auto (off|stable|channel)")),
]
def check(raw):
    if len(raw) >= 65536:
        raise ValueError("document is %d bytes, at or over the 65536-byte cap" % len(raw))
    doc = raw.decode("utf-8")
    if not doc.endswith("\n"):
        raise ValueError("document does not end in a newline")
    lines = doc[:-1].split("\n")
    if lines[-1] != "end":
        raise ValueError("last line is not exactly end")
    body = lines[:-1]
    if len(body) != len(GRAMMAR):
        raise ValueError("expected %d lines before end, got %d" % (len(GRAMMAR), len(body)))
    v = {}
    for (name, rx), ln in zip(GRAMMAR, body):
        m = rx.fullmatch(ln)
        if not m:
            raise ValueError("off-grammar line for %s: %r" % (name, ln[:200]))
        v[name] = m.group(1)
    issued, lease = int(v["issued"]), int(v["lease"])
    if lease - issued != 900:
        raise ValueError("lease is not issued + 900 s")
    if abs(issued - int(time.time())) > 86400:
        raise ValueError("issued %d is not unix seconds near now" % issued)
    want = v["desired-stable"] if v["channel"] == "stable" else v["desired-dev"]
    if v["desired"] != want:
        raise ValueError("desired disagrees with desired-%s" % v["channel"])
try:
    check(sys.stdin.buffer.read())
    sys.stdout.write("ok\n")
except Exception as ex:
    sys.stderr.write(str(ex) + "\n")
    sys.exit(1)
`;

function validate(doc: string): { ok: boolean; err: string } {
  const r = spawnSync('python3', ['-c', VALIDATOR], { input: doc, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C.UTF-8' } });
  return { ok: r.status === 0 && r.stdout === 'ok\n', err: r.stderr };
}

const FLEET_ID = '0123abcd-0000-4000-8000-000000000001';
const NOW = Date.UTC(2026, 8, 22, 12, 0, 0);
const NOW_S = Math.floor(NOW / 1000);

const resolution = (o: Partial<Resolution> = {}): Resolution => ({
  channel: 'stable', desiredTag: 'v0.0.11', resolveDetail: null, desiredStable: 'v0.0.11', desiredDev: 'v0.0.12', auto: 'off', ...o,
});
const listed = (tag: string, channel: UpdateChannel = 'stable'): ReleaseListingRow => ({
  tag, channel, publishedAt: NOW, commitSha: null, tarballUrl: `https://releases.example/ccrc-${tag}.tar.gz`,
  bundleListed: true, notes: null, draft: false,
});
const meas = (o: Partial<NodeMeasurement> & Pick<NodeMeasurement, 'nodeId' | 'label' | 'role'>): NodeMeasurement => ({
  currentVersion: 'v0.0.9', currentSha: 'a'.repeat(40), currentRef: 'main', currentBuiltAt: '2026-09-22T00:00:00Z',
  currentDirty: false, stampRead: 'ok', installState: 'complete', provenance: 'verified', caps: ['verify', 'node-id', 'floor'],
  agentOps: null, highestVersion: 'v0.0.9', previousVersion: null, floorRead: 'measured', previousRead: 'absent',
  os: 'linux', measuredAt: NOW, report: null, ...o,
});

/** A coord.db on a fixture home holding the server row (floor v0.0.9), the fleet row (floor v0.0.10) and
 *  a catalogue of v0.0.10 + v0.0.11 on stable and v0.0.12 on dev. */
function fixture(role: NodeRole = 'both', rows: 'both' | 'fleet-only' = 'both') {
  const home = mkTmp('ccrc-update-projection-');
  const ccrcDir = path.join(home, '.ccrc');
  const db = openCoordDb(path.join(ccrcDir, 'coord.db'));
  const store = new CoordStore(db);
  const log = new UpdateIntentLog(defaultUpdateIntentLogPath(ccrcDir));
  if (rows === 'both') {
    expect(store.upsertNodeMeasurement(meas({ nodeId: SERVER_LABEL, label: SERVER_LABEL, role }))).toMatchObject({ ok: true });
  }
  expect(store.upsertNodeMeasurement(meas({
    nodeId: FLEET_ID, label: FLEET_LABEL, role: 'fleet', currentVersion: 'v0.0.10', highestVersion: 'v0.0.10', agentOps: [],
  }))).toMatchObject({ ok: true });
  expect(store.applyReleaseListing([listed('v0.0.12', 'dev'), listed('v0.0.11'), listed('v0.0.10')], NOW, 'complete'))
    .toMatchObject({ ok: true });
  return { home, ccrcDir, db, store, log, deps: { store, role, ccrcDir } };
}
const projectionPath = (ccrcDir: string): string => path.join(ccrcDir, NODE_FILES.projection);
const tmpResidue = (dir: string): string[] => readdirSync(dir).filter((n) => n.endsWith('.tmp'));

describe('renderProjection — the §9 document', () => {
  it('renders the nine lines in order, seconds, both desireds, `end` last', () => {
    const r = renderProjection(resolution({ auto: 'stable' }), 7, NOW_S);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toBe(
      `epoch 7\nissued ${NOW_S}\nlease ${NOW_S + 900}\nchannel stable\ndesired v0.0.11\n`
      + 'desired-stable v0.0.11\ndesired-dev v0.0.12\nauto stable\nend\n',
    );
    expect(r.doc).toEqual({
      epoch: 7, issued: NOW_S, lease: NOW_S + PROJECTION_LEASE_S, channel: 'stable',
      desired: 'v0.0.11', desiredStable: 'v0.0.11', desiredDev: 'v0.0.12', auto: 'stable',
    });
    expect(PROJECTION_LEASE_S).toBe(900);
  });

  it('a NULL desired renders `none`', () => {
    const r = renderProjection(resolution({ desiredTag: null, desiredStable: null, desiredDev: null, resolveDetail: RESOLVE_DETAIL.noFloor() }), 0, NOW_S);
    expect(r.ok && r.text).toContain('desired none\ndesired-stable none\ndesired-dev none\n');
  });

  it('a ms issuedAt is refused, never rendered (§18 "the projection is seconds")', () => {
    expect(() => renderProjection(resolution(), 1, NOW)).toThrow(RangeError);
    expect(() => renderProjection(resolution(), 1, -1)).toThrow(RangeError);
    expect(() => renderProjection(resolution(), 1.5, NOW_S)).toThrow(RangeError);
    expect(() => renderProjection(resolution({ desiredDev: '0.0.12' }), 1, NOW_S)).toThrow(RangeError);
  });

  it('no channel → no document, with the resolver\'s reason', () => {
    const r = renderProjection(resolution({ channel: null, desiredTag: null, resolveDetail: RESOLVE_DETAIL.unknownChannel() }), 1, NOW_S);
    expect(r).toEqual({ ok: false, why: 'no-channel', detail: RESOLVE_DETAIL.unknownChannel() });
  });
});

describe('the embedded validator (W4\'s ccd-update-sync takes this pin over)', () => {
  const nowS = (): number => Math.floor(Date.now() / 1000);
  const good = (): string => {
    const r = renderProjection(resolution(), 3, nowS());
    if (!r.ok) throw new Error('fixture render refused');
    return r.text;
  };

  it('accepts the renderer\'s own output', () => {
    const v = validate(good());
    expect(v.ok, v.err).toBe(true);
  });

  it('refuses a document with no `end` (a torn write)', () => {
    const v = validate(good().replace(/end\n$/, ''));
    expect(v.ok).toBe(false);
    expect(v.err).toMatch(/end/);
  });

  it('refuses a document at the 65536-byte cap', () => {
    const v = validate(good().replace('end\n', `${'x'.repeat(65536)}\nend\n`));
    expect(v.ok).toBe(false);
    expect(v.err).toMatch(/65536/);
  });

  it('refuses ms in issued/lease', () => {
    const s = nowS();
    const doc = good().replace(/^issued \d+$/m, `issued ${s * 1000}`).replace(/^lease \d+$/m, `lease ${s * 1000 + 900}`);
    const v = validate(doc);
    expect(v.ok).toBe(false);
    expect(v.err).toMatch(/unix seconds/);
  });

  it('refuses a desired that disagrees with its channel\'s desired-* line', () => {
    const v = validate(good().replace('desired v0.0.11\n', 'desired v0.0.12\n'));
    expect(v.ok).toBe(false);
    expect(v.err).toMatch(/disagrees/);
  });
});

describe('writeOwnProjection — tmp then rename, 0600, whole or nothing', () => {
  it('writes the text at ~/.ccrc/update-intent with mode 0600 and leaves no tmp behind', async () => {
    const ccrcDir = path.join(mkTmp('ccrc-update-write-'), '.ccrc');
    const r = await writeOwnProjection(ccrcDir, 'epoch 1\nend\n');
    expect(r).toEqual({ ok: true, path: projectionPath(ccrcDir) });
    expect(readFileSync(projectionPath(ccrcDir), 'utf8')).toBe('epoch 1\nend\n');
    expect(statSync(projectionPath(ccrcDir)).mode & 0o777).toBe(PROJECTION_FILE_MODE);
    expect(tmpResidue(ccrcDir)).toEqual([]);
  });

  it('replaces an existing file whole, and a 0644 predecessor becomes 0600', async () => {
    const ccrcDir = path.join(mkTmp('ccrc-update-write-'), '.ccrc');
    mkdirSync(ccrcDir, { recursive: true });
    writeFileSync(projectionPath(ccrcDir), 'old\n', { mode: 0o644 });
    expect((await writeOwnProjection(ccrcDir, 'new\n')).ok).toBe(true);
    expect(readFileSync(projectionPath(ccrcDir), 'utf8')).toBe('new\n');
    expect(statSync(projectionPath(ccrcDir)).mode & 0o777).toBe(0o600);
  });

  it('replaces a symlink at the path — never writes through it', async () => {
    const home = mkTmp('ccrc-update-write-');
    const ccrcDir = path.join(home, '.ccrc');
    mkdirSync(ccrcDir, { recursive: true });
    const elsewhere = path.join(home, 'elsewhere');
    writeFileSync(elsewhere, 'keep\n');
    symlinkSync(elsewhere, projectionPath(ccrcDir));
    expect((await writeOwnProjection(ccrcDir, 'new\n')).ok).toBe(true);
    expect(lstatSync(projectionPath(ccrcDir)).isFile()).toBe(true);
    expect(readFileSync(elsewhere, 'utf8')).toBe('keep\n');
  });

  it('a directory at the path → unwritable, the directory untouched, no tmp left', async () => {
    const ccrcDir = path.join(mkTmp('ccrc-update-write-'), '.ccrc');
    mkdirSync(projectionPath(ccrcDir), { recursive: true });
    const r = await writeOwnProjection(ccrcDir, 'new\n');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.why).toBe('unwritable');
    expect(statSync(projectionPath(ccrcDir)).isDirectory()).toBe(true);
    expect(tmpResidue(ccrcDir)).toEqual([]);
  });
});

describe('resolveAndProject — every live node resolved and stored; the server row projected', () => {
  it('stores each node\'s resolution and writes the server row\'s document, which the validator accepts', async () => {
    const f = fixture('both');
    const now = Date.now();
    const run = await resolveAndProject(f.deps, now);
    expect(run.resolved).toBe(2);
    expect(run.refused).toEqual([]);
    expect(run.projection).toEqual({ ok: true, path: projectionPath(f.ccrcDir) });
    expect(f.store.node(SERVER_LABEL)).toMatchObject({ channel: 'stable', desiredTag: 'v0.0.11', resolveDetail: null });
    expect(f.store.node(FLEET_ID)).toMatchObject({ channel: 'stable', desiredTag: 'v0.0.11', resolveDetail: null });
    const text = readFileSync(projectionPath(f.ccrcDir), 'utf8');
    expect(text).toContain('channel stable\ndesired v0.0.11\ndesired-stable v0.0.11\ndesired-dev v0.0.12\nauto off\nend\n');
    // SECONDS: the file's issued is the call's own clock in seconds, and its lease is 900 s later.
    const issued = Math.floor(now / 1000);
    expect(text).toMatch(new RegExp(`^issued ${issued}\\nlease ${issued + 900}$`, 'm'));
    expect(text).toMatch(new RegExp(`^epoch ${f.store.updateEpoch().epoch}$`, 'm'));
    expect(statSync(projectionPath(f.ccrcDir)).mode & 0o777).toBe(0o600);
    const v = validate(text);
    expect(v.ok, v.err).toBe(true);
  });

  it('a never-reached node (markUnreachable\'s placeholder) resolves with the floorUnmeasured sentence, never noFloor (fix round 1, m-2)', async () => {
    const f = fixture('both');
    expect(f.store.markUnreachable('never-connected', 'fleet', NOW)).toMatchObject({ ok: true, created: true });
    await resolveAndProject(f.deps, Date.now());
    expect(f.store.node('never-connected')).toMatchObject({
      desiredTag: null, resolveDetail: RESOLVE_DETAIL.floorUnmeasured(),
    });
  });

  it('a refusal by ANOTHER node never blocks this one; this node\'s own does (decision 16)', async () => {
    const f = fixture('both');
    expect(f.store.refuseRelease(FLEET_ID, 'v0.0.11', NOW, 'provenance: fixture')).toMatchObject({ ok: true });
    expect(resolveInputFor(f.store, f.store.node(SERVER_LABEL)!).refusedByThisNode.size).toBe(0);
    expect([...resolveInputFor(f.store, f.store.node(FLEET_ID)!).refusedByThisNode]).toEqual(['v0.0.11']);
    await resolveAndProject(f.deps, Date.now());
    expect(f.store.node(SERVER_LABEL)!.desiredTag).toBe('v0.0.11');
    expect(f.store.node(FLEET_ID)).toMatchObject({
      desiredTag: null, resolveDetail: RESOLVE_DETAIL.notNewerThanFloor('v0.0.10', 'v0.0.10'),
    });
  });

  it('a node-scope intent decides for that node only', async () => {
    const f = fixture('both');
    expect(f.store.setIntent(FLEET_ID, { channel: 'dev' }, f.log, NOW)).toMatchObject({ ok: true });
    await resolveAndProject(f.deps, Date.now());
    expect(f.store.node(FLEET_ID)).toMatchObject({ channel: 'dev', desiredTag: 'v0.0.12' });
    expect(f.store.node(SERVER_LABEL)).toMatchObject({ channel: 'stable', desiredTag: 'v0.0.11' });
  });

  it('a stale stamp is not a version: currentVersion reads only from an ok stamp', async () => {
    const f = fixture('both');
    expect(f.store.upsertNodeMeasurement(meas({
      nodeId: SERVER_LABEL, label: SERVER_LABEL, role: 'both', stampRead: 'malformed', highestVersion: null, currentVersion: 'v0.0.9',
    }))).toMatchObject({ ok: true });
    expect(resolveInputFor(f.store, f.store.node(SERVER_LABEL)!).currentVersion).toBeNull();
    await resolveAndProject(f.deps, Date.now());
    expect(f.store.node(SERVER_LABEL)).toMatchObject({ desiredTag: null, resolveDetail: RESOLVE_DETAIL.noFloor() });
  });

  it('a fleet-role server resolves every node and writes no file', async () => {
    const f = fixture('fleet');
    const run = await resolveAndProject(f.deps, Date.now());
    expect(run.resolved).toBe(2);
    expect(run.projection).toEqual({ ok: false, why: 'not-server-role' });
    expect(existsSync(projectionPath(f.ccrcDir))).toBe(false);
  });

  it('no server row → no-server-row, no file', async () => {
    const f = fixture('both', 'fleet-only');
    const run = await resolveAndProject(f.deps, Date.now());
    expect(run.resolved).toBe(1);
    expect(run.projection).toEqual({ ok: false, why: 'no-server-row' });
    expect(existsSync(projectionPath(f.ccrcDir))).toBe(false);
  });

  it('an unknown channel token writes NOTHING — the previous document stays byte-identical', async () => {
    const f = fixture('both');
    expect((await resolveAndProject(f.deps, Date.now())).projection.ok).toBe(true);
    const before = readFileSync(projectionPath(f.ccrcDir), 'utf8');
    // A newer build's token, planted the only way one can arrive: a row this build did not write.
    f.db.prepare("UPDATE update_intent SET channel = 'nightly' WHERE scope = '*'").run();
    const run = await resolveAndProject(f.deps, Date.now() + 60_000);
    expect(run.projection).toEqual({ ok: false, why: 'no-channel', detail: RESOLVE_DETAIL.unknownChannel() });
    expect(readFileSync(projectionPath(f.ccrcDir), 'utf8')).toBe(before);
    expect(f.store.node(SERVER_LABEL)).toMatchObject({ channel: null, desiredTag: null, resolveDetail: RESOLVE_DETAIL.unknownChannel() });
  });

  it('one run at a time per ~/.ccrc: a run called while another is writing reads the store only after that write landed', async () => {
    // The inventory run and the routes' reproject (Task 13) both call resolveAndProject, with no lock
    // between them. Unqueued, B's first store read would run synchronously, while A's mkdir/write/rename is
    // still in flight, so B would see NO file here. Queued, B starts after A has renamed, so it sees A's
    // whole document. That ordering is what keeps the file from stepping back to an older epoch.
    const f = fixture('both');
    const dest = projectionPath(f.ccrcDir);
    expect(existsSync(dest), 'the fixture must start with no projection').toBe(false);
    let seenByB: string | null = null;
    const s = f.store;
    const observing: ProjectStore = {
      nodes: () => {
        if (seenByB === null) seenByB = existsSync(dest) ? readFileSync(dest, 'utf8') : '(absent)';
        return s.nodes();
      },
      releases: () => s.releases(), refusalsFor: (id) => s.refusalsFor(id), intentFor: (scope) => s.intentFor(scope),
      updateEpoch: () => s.updateEpoch(), resolveNode: (id, r) => s.resolveNode(id, r),
    };
    const a = resolveAndProject(f.deps, Date.now());
    // Not a race: this write is synchronous and lands before A's queued snapshot has even run (the
    // `Promise.resolve().then(once)` inside resolveAndProject is a microtask away). What this case proves is
    // the QUEUE, not timing — B's own read (`observing.nodes`, below) is the one that has to wait for A's
    // write to land, and `seenByB` is the assertion that it did.
    expect(s.setIntent('*', { channel: 'dev' }, f.log, NOW)).toMatchObject({ ok: true });
    const b = resolveAndProject({ ...f.deps, store: observing }, Date.now());
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.projection.ok && rb.projection.ok, JSON.stringify([ra.projection, rb.projection])).toBe(true);
    expect(seenByB, 'B read the store while A was still writing — the runs interleaved').toMatch(/^epoch \d+\n[\s\S]*\nend\n$/);
    const text = readFileSync(dest, 'utf8');
    expect(text).toMatch(new RegExp(`^epoch ${s.updateEpoch().epoch}$`, 'm'));
    expect(text).toContain('channel dev\n');
    expect(tmpResidue(f.ccrcDir)).toEqual([]);
  });
});

describe('the inventory run resolves and projects (§9: "at every resolution AND on every inventory sweep")', () => {
  it('inventoryNow() on a local-mode server leaves the server row resolved and its projection written', async () => {
    const home = mkTmp('ccrc-update-watch-');
    const base = testDeps(home);
    const coord = new CoordStore(openCoordDb(base.cfg.coordDbPath));
    expect(coord.applyReleaseListing([listed('v0.0.10')], NOW, 'complete')).toMatchObject({ ok: true });
    mkdirSync(base.cfg.ccrcDir, { recursive: true });
    writeFileSync(path.join(base.cfg.ccrcDir, NODE_FILES.floor), 'v0.0.9\n');
    // The fourth argument keeps the watcher's state cache on the fixture home — the constructor's
    // default is the live one (`defaultCachePath()`), Task 11's watcher cases pass it the same way.
    const w = new FleetWatcher({ ...base, coord }, new Bus(), 2000, path.join(home, 'state-cache.json'));
    await w.inventoryNow();
    expect(coord.nodeByLabel(SERVER_LABEL)).toMatchObject({ channel: 'stable', desiredTag: 'v0.0.10' });
    const text = readFileSync(projectionPath(base.cfg.ccrcDir), 'utf8');
    expect(text).toContain('channel stable\ndesired v0.0.10\n');
    const v = validate(text);
    expect(v.ok, v.err).toBe(true);
  });

  it('C1 (final fix wave): a throw on the server row\'s apply still measures the fleet row and still writes the projection', async () => {
    const home = mkTmp('ccrc-update-watch-isolate-');
    const base = testDeps(home);
    const coord = new CoordStore(openCoordDb(base.cfg.coordDbPath));
    expect(coord.applyReleaseListing([listed('v0.0.10')], NOW, 'complete')).toMatchObject({ ok: true });
    mkdirSync(base.cfg.ccrcDir, { recursive: true });
    writeFileSync(path.join(base.cfg.ccrcDir, NODE_FILES.floor), 'v0.0.9\n');
    // A same-box "fleet" connection over localIO, reading the same ccrcDir —
    // the same shape update-inventory.test.ts's D-3211 collision case uses to
    // exercise both rows without a real agent.
    const deps: Deps = {
      ...base, coord, cfg: { ...base.cfg, fleetMode: 'remote' },
      fleetState: { connected: true, downSince: null, ccdVerbs: null, rosterFp: null, build: null },
    };
    const w = new FleetWatcher(deps, new Bus(), 2000, path.join(home, 'state-cache.json'));
    // First sweep, clean: both rows exist and the projection is written.
    await w.inventoryNow();
    expect(coord.nodeByLabel(SERVER_LABEL)).not.toBeNull();
    expect(coord.nodeByLabel(FLEET_LABEL)).not.toBeNull();
    expect(readFileSync(projectionPath(base.cfg.ccrcDir), 'utf8').length).toBeGreaterThan(0);
    // Second sweep: the server row's OWN apply throws (a locked coord.db,
    // say) — the fleet row must still be measured this sweep, and
    // resolveAndProject must still run and still write the projection
    // (off the server row's still-live, if stale, columns).
    const original = coord.upsertNodeMeasurement.bind(coord);
    coord.upsertNodeMeasurement = (m) => {
      if (m.label === SERVER_LABEL) throw new Error('boom: coord.db locked');
      return original(m);
    };
    const fleetMeasuredBefore = coord.nodeByLabel(FLEET_LABEL)!.measuredAt;
    // Re-review finding 2 (final fix wave): the FIRST sweep already wrote
    // this file (:400), so a bare "it exists and is non-empty" assertion
    // would stay green even if a mutation skipped resolveAndProject after an
    // errored row entirely — deleting it here and requiring it back proves
    // THIS sweep is what wrote it.
    rmSync(projectionPath(base.cfg.ccrcDir));
    await w.inventoryNow();
    expect(coord.nodeByLabel(FLEET_LABEL)!.measuredAt).not.toBe(fleetMeasuredBefore);
    expect(readFileSync(projectionPath(base.cfg.ccrcDir), 'utf8').length).toBeGreaterThan(0);
  });
});

// Fix round 1, finding 1: the dedupe must compare a STABLE key (`why` + errno `code`), never the message —
// an fs failure's message embeds `writeOwnProjection`'s tmp path, which carries `process.pid` and
// `Date.now()`, so two failures of the SAME condition never produced the same string and the "once per
// change of reason" guard never actually deduped anything for the case it exists for.
describe('the projection warning dedupes on a stable key, never the message (fix round 1, finding 1)', () => {
  const runningAsRoot = typeof process.getuid === 'function' && process.getuid() === 0;

  // Root bypasses directory write permissions entirely, so the EACCES this case measures cannot occur —
  // skipped rather than false-green under a root test runner.
  it.skipIf(runningAsRoot)(
    'two sweeps against an unwritable ~/.ccrc warn ONCE; writable then unwritable again warns again',
    async () => {
      const home = mkTmp('ccrc-update-warn-');
      const base = testDeps(home);
      const coord = new CoordStore(openCoordDb(base.cfg.coordDbPath));
      // A directory of its own, separate from base.cfg.ccrcDir (which also holds coord.db): chmod-ing the
      // real ~/.ccrc would risk starving sqlite's own WAL writes, which this case has no interest in.
      const unwritable = path.join(home, 'no-write-here');
      mkdirSync(unwritable, { recursive: true });
      const cfg = { ...base.cfg, ccrcDir: unwritable };
      const w = new FleetWatcher({ ...base, cfg, coord }, new Bus(), 2000, path.join(home, 'state-cache.json'));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        chmodSync(unwritable, 0o500);
        await w.inventoryNow();
        await w.inventoryNow();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]?.[0])).toMatch(/unwritable: .*EACCES/);

        chmodSync(unwritable, 0o700);
        warn.mockClear();
        await w.inventoryNow();
        expect(warn).not.toHaveBeenCalled();
        expect(existsSync(projectionPath(unwritable))).toBe(true);

        // A DIFFERENT failure (the dir is unwritable again) after a success in between: the key changed
        // (null, because the write succeeded) so this warns again — deduping is "once per change", not "once
        // ever".
        chmodSync(unwritable, 0o500);
        await w.inventoryNow();
        expect(warn).toHaveBeenCalledTimes(1);
      } finally {
        chmodSync(unwritable, 0o700);
        warn.mockRestore();
      }
    },
  );

  it('a planted throw inside the resolve/project step still returns the sweep\'s outcomes', async () => {
    const home = mkTmp('ccrc-update-warn-throw-');
    const base = testDeps(home);
    const coord = new CoordStore(openCoordDb(base.cfg.coordDbPath));
    mkdirSync(base.cfg.ccrcDir, { recursive: true });
    writeFileSync(path.join(base.cfg.ccrcDir, NODE_FILES.floor), 'v0.0.9\n');
    const w = new FleetWatcher({ ...base, coord }, new Bus(), 2000, path.join(home, 'state-cache.json'));
    const originalNodes = coord.nodes.bind(coord);
    let threw = false;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- deliberately shadowing the instance method
    (coord as unknown as { nodes: () => unknown }).nodes = () => {
      threw = true;
      throw new Error('planted: resolve step boom');
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const outcomes = await w.inventoryNow();
      expect(threw).toBe(true);
      // The sweep's own outcomes (the server row's measurement) came back even though the resolve step
      // that runs after it threw — a resolve failure never loses what the sweep already measured.
      expect(outcomes.length).toBeGreaterThan(0);
      expect(outcomes.every((o) => o.label === SERVER_LABEL)).toBe(true);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toMatch(/the resolve run threw: planted: resolve step boom/);
    } finally {
      (coord as unknown as { nodes: () => unknown }).nodes = originalNodes;
      warn.mockRestore();
    }
  });
});

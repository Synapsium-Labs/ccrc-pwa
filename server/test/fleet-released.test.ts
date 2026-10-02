// `FleetSession.releasedFrom` on the wire (workspace lifecycle spec §5.1): `assembleFleet` reads the run facts
// once, decides per row with the pure `releasedFrom`, and emits null for every row when the read fails.
import { describe, it, expect, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { assembleFleet } from '../src/fleet.js';
import { Tmux } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';

const seedSession = (home: string, id: string, extra: Record<string, string> = {}) => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper: 'claude', project: 'demo', workdir: `/data/projects/${id}`, uuid: '1'.repeat(36), started: '1', ...extra };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};
const mkCoord = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-coord-'), '.ccrc', 'coord.db')));
const dead = new Tmux(async () => ({ code: 1, stdout: '', stderr: '' }));
const NOW_S = 1784600000;

/** One closed run naming `sessionId` as its worker. */
const closedRun = (coord: CoordStore, sessionId: string, claimedBy = 'demo-coordinator'): number => {
  const r = coord.openRun({ program: 'lifecycle', title: 'Workspace lifecycle', project: 'demo', wave: 1, waveOf: 1, claimedBy });
  if (!('id' in r)) throw new Error('openRun refused');
  coord.bindSession(r.id, sessionId);
  expect(coord.advance(r.id, 'failed', 'test-close').ok).toBe(true);
  return r.id;
};

const assemble = (home: string, coord?: CoordStore) => assembleFleet(
  localIO, loadConfig({ CCRC_HOME: home }), dead, NOW_S,
  undefined, undefined, undefined, undefined, undefined, undefined, coord,
);

describe('releasedFrom on the wire', () => {
  it('a workspace whose only run closed is released from that run', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'demo-amber', { workspace: 'amber' });
    const coord = mkCoord();
    const id = closedRun(coord, 'demo-amber');
    const row = (await assemble(home, coord)).find((s) => s.id === 'demo-amber')!;
    expect(row.releasedFrom).toMatchObject({
      runId: id, program: 'lifecycle', programTitle: 'Workspace lifecycle', claimedBy: 'demo-coordinator', child: false,
    });
  });

  it('each registry fact reaches the decision — a hold, an archive, a main checkout, a child marker', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'demo-held', { workspace: 'held', hold: 'program:lifecycle wave:1/1' });
    seedSession(home, 'demo-arch', { workspace: 'arch', archived: String(NOW_S - 60) });
    seedSession(home, 'demo-main');                                    // no workspace: a main checkout
    seedSession(home, 'demo-child', { workspace: 'child', child: '7' });
    seedSession(home, 'demo-garbled', { workspace: 'garbled', child: 'not-a-run' });
    const coord = mkCoord();
    for (const id of ['demo-held', 'demo-arch', 'demo-main', 'demo-child', 'demo-garbled']) closedRun(coord, id);
    const fleet = await assemble(home, coord);
    const rf = (id: string) => fleet.find((s) => s.id === id)!.releasedFrom;
    expect(rf('demo-held')).toBeNull();
    expect(rf('demo-arch')).toBeNull();
    expect(rf('demo-main')).toBeNull();
    expect(rf('demo-child')?.child).toBe(true);
    expect(rf('demo-garbled')?.child).toBe(true);          // unreadable reads as a child: the direction that defers
  });

  it('a former worker that now coordinates a live run is not released', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'demo-amber', { workspace: 'amber' });
    const coord = mkCoord();
    closedRun(coord, 'demo-amber');
    coord.openRun({ program: 'next', title: 'Next', project: 'demo', wave: 1, waveOf: 1, claimedBy: 'demo-amber' });
    expect((await assemble(home, coord)).find((s) => s.id === 'demo-amber')!.releasedFrom).toBeNull();
  });

  it('no coord store (a dark box): every row reads null, and the tick resolves', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'demo-amber', { workspace: 'amber' });
    expect((await assemble(home)).find((s) => s.id === 'demo-amber')!.releasedFrom).toBeNull();
  });

  it('a REFUSED read emits null on every row, never a stale non-null', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'demo-amber', { workspace: 'amber' });
    const coord = mkCoord();
    closedRun(coord, 'demo-amber');
    vi.spyOn(coord, 'lastRunBySession').mockReturnValue({ ok: false, kind: 'run-unreadable', detail: 'closed for the test' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await assemble(home, coord)).find((s) => s.id === 'demo-amber')!.releasedFrom).toBeNull();
    // A refusal and an empty store answer the same null ON THE WIRE, deliberately; the log line is what tells
    // them apart for the operator, and it names the refusal's own detail.
    expect(warn.mock.calls.map((c) => String(c[0]))).toContainEqual(expect.stringMatching(/lastRunBySession refused .* closed for the test/));
    warn.mockRestore();
  });

  it('a THROWING read emits null too, and the tick still resolves', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'demo-amber', { workspace: 'amber' });
    const coord = mkCoord();
    closedRun(coord, 'demo-amber');
    vi.spyOn(coord, 'lastRunBySession').mockImplementation(() => { throw new Error('lock race'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await assemble(home, coord)).find((s) => s.id === 'demo-amber')!.releasedFrom).toBeNull();
    expect(warn.mock.calls.map((c) => String(c[0]))).toContainEqual(expect.stringMatching(/lastRunBySession failed .* lock race/));
    warn.mockRestore();
  });

  it('ONE store read per assembly, whatever the row count', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    for (const id of ['demo-a', 'demo-b', 'demo-c']) seedSession(home, id, { workspace: id });
    const coord = mkCoord();
    const spy = vi.spyOn(coord, 'lastRunBySession');
    await assemble(home, coord);
    expect(spy).toHaveBeenCalledTimes(1);
    expect([...spy.mock.calls[0]![0]].sort()).toEqual(['demo-a', 'demo-b', 'demo-c']);
  });
});

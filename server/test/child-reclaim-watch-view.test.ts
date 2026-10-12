// Child-reclamation wave 5, Task 4: the registry answer GET /api/runs reads to
// compose a run's reclaim chip. It is IN MEMORY, off the registry listing the
// 2 s tick already made. A route-time `readRegistry` would cost ~721 agent-WS
// operations per board load in remote mode.
import { describe, it, expect } from 'vitest';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { localIO, type FleetIO } from '../src/io.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

/** A full registry row, the field set `run-routes.test.ts`'s `seed` writes, plus
 *  whatever `over` adds (here: the `.child` marker wave 1 writes). */
const seed = (home: string, id: string, over: Record<string, string> = {}): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const slug = id.replace(/^demo-/, '');
  const fields: Record<string, string> = {
    wrapper: 'claude', project: 'demo', workdir: `/w/${id}`, uuid: `u-${id}`, started: '1',
    workspace: slug, branch: `ws/${slug}`, base: 'origin/main', ...over,
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};
const unseed = (home: string, id: string): void => {
  const reg = path.join(home, '.cc-sessions');
  for (const f of readdirSync(reg)) if (f.startsWith(`${id}.`)) rmSync(path.join(reg, f));
};

const watcher = (home: string, io: FleetIO = { ...localIO }): FleetWatcher =>
  new FleetWatcher({ ...testDeps(home), io }, new Bus());

describe('FleetWatcher.currentChildMarks (wave 5)', () => {
  it('is null before any tick has listed the registry — never a fabricated empty map', () => {
    expect(watcher(mkTmp('ccrc-cr-view-')).currentChildMarks()).toBeNull();
  });

  it('records each listed row’s ChildMark, all three answers', async () => {
    const home = mkTmp('ccrc-cr-view-');
    seed(home, 'demo-quiet-mesa', { child: '41' });
    seed(home, 'demo-clear-cove');
    seed(home, 'demo-calm-reef', { child: 'x7' });
    const w = watcher(home);
    await w.tick();
    const marks = w.currentChildMarks();
    expect(marks?.get('demo-quiet-mesa')).toEqual({ kind: 'child', runId: 41 });
    expect(marks?.get('demo-clear-cove')).toEqual({ kind: 'none' });
    expect(marks?.get('demo-calm-reef')).toEqual({ kind: 'unreadable' });
  });

  it('keeps the last LISTED marks through an unlistable tick — retain, don’t erase', async () => {
    const home = mkTmp('ccrc-cr-view-');
    seed(home, 'demo-quiet-mesa', { child: '41' });
    const io: FleetIO = { ...localIO };
    const w = watcher(home, io);
    await w.tick();
    io.readdir = async () => null;          // the whole-fleet listing now fails
    await w.tick();
    expect(w.currentChildMarks()?.get('demo-quiet-mesa')).toEqual({ kind: 'child', runId: 41 });
  });

  it('drops a row the next listing no longer carries', async () => {
    const home = mkTmp('ccrc-cr-view-');
    seed(home, 'demo-quiet-mesa', { child: '41' });
    const w = watcher(home);
    await w.tick();
    unseed(home, 'demo-quiet-mesa');
    await w.tick();
    expect(w.currentChildMarks()?.has('demo-quiet-mesa')).toBe(false);
  });
});

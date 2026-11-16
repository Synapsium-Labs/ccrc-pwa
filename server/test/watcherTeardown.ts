import { rmSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { FleetWatcher } from '../src/watch.js';
import { quietWatcher } from './laneQuiet.js';

/** A fixture home's teardown for a file whose cases build `FleetWatcher`s (D-6179). `track` every watcher a case
 *  builds; `remove` closes the server (if any), quiets each tracked watcher and only then removes the home. A bare
 *  watcher has no server whose close would wait for it, and a server's close waits for the server-caps write alone, so
 *  nothing else orders those writes before the removal. With that order kept, the removal needs no retry.
 *  The quiet is `quietWatcher(w, { lanes: false })` (`laneQuiet.ts`, D-8140, review 1724 F2): it stops the watcher,
 *  awaits its in-flight writers (`FleetWatcher.settled`), and closes the delegation lane, which `settled()` never
 *  covered. `lanes: false` keeps what this teardown always awaited: it does not wait on the lane rows. */
export function watcherTeardown() {
  const live: FleetWatcher[] = [];
  return {
    track(w: FleetWatcher): FleetWatcher {
      live.push(w);
      return w;
    },
    async remove(home: string, app?: FastifyInstance): Promise<void> {
      if (app) await app.close();
      for (const w of live.splice(0)) await quietWatcher(w, { lanes: false });
      rmSync(home, { recursive: true, force: true });
    },
  };
}

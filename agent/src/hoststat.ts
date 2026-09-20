// The agent's binding of the shared host sampler: node:fs for the two /proc
// files, node's clock, node's sleep. No algorithm lives here — that is
// `shared/hoststat.ts`, so this box and a local-mode server compute the same
// numbers from the same text and cannot drift.
//
// The two paths are FIXED (`<procRoot>/stat`, `<procRoot>/meminfo`) and never
// come off a request: the `hostStat` frame carries no path, so nothing a caller
// sends can steer this read. `procRoot` exists for fixtures only — `startAgent`
// leaves it at `/proc`.
import { setTimeout as sleep } from 'node:timers/promises';
import { createHostSampler, type HostStat } from '../../shared/hoststat.js';
import { readWholeMeasured } from './fileops.js';

/** One sampler per agent PROCESS, not per connection: it carries the previous
 *  `/proc/stat` reading, and that is what lets an ordinary poll cost one read
 *  and report over the poll's own interval instead of a 400ms burst. */
export function createAgentHostSampler(procRoot?: string): () => Promise<HostStat> {
  return createHostSampler(
    {
      read: readWholeMeasured,
      now: () => Date.now(),
      sleep: async (ms) => { await sleep(ms); },
    },
    procRoot === undefined ? {} : { procRoot },
  );
}

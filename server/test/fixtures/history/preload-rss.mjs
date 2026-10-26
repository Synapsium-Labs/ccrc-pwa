// preload-rss.mjs — TEST-ONLY, never shipped (spec §10.1, history-test-seams-not-env). Loaded
// into a spawned sweep through NODE_OPTIONS=--import, it prints the process's peak resident set
// size on stderr when the process exits. O20 and DM47 can then bound the real sweep's memory,
// SQLite's page cache included, and never the test runner's.
// It reads VmHWM from /proc/self/status, the process's OWN peak, and falls back to maxRSS only where that is unreadable:
// on Linux `process.resourceUsage().maxRSS` is inherited from the spawning parent across fork+exec, so it measured the
// test runner's size, not the sweep's (D-6964). The reader is rss-peak.mjs (D-6965 names this one static import).
import { readFileSync } from 'node:fs';
import { ownPeakKiB } from './rss-peak.mjs';

process.once('exit', () => {
  try {
    const r = ownPeakKiB(() => readFileSync('/proc/self/status', 'utf8'), () => process.resourceUsage().maxRSS);
    process.stderr.write(`history-test-maxrss-kib=${r.kib}\nhistory-test-rss-source=${r.source}\n`);
  } catch {
    // an exit hook never throws; a failed write prints nothing
  }
});

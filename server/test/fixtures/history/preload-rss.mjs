// preload-rss.mjs — TEST-ONLY, never shipped (spec §10.1, history-test-seams-not-env). Loaded
// into a spawned sweep through NODE_OPTIONS=--import, it prints the process's peak resident set
// size on stderr when the process exits. O20 and DM47 can then bound the real sweep's memory,
// SQLite's page cache included, and never the test runner's.
process.once('exit', () => {
  process.stderr.write(`history-test-maxrss-kib=${process.resourceUsage().maxRSS}\n`);
});

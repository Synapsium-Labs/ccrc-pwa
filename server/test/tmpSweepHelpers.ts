// Shared by tmp-sweep.test.ts and tmp-sweep-live.test.ts.
import fs from 'node:fs';
import path from 'node:path';

/** A stand-in for `df` (`CCD_TMP_SWEEP_DF`) that reports FAKE_DF_PCT percent used (default 10) of bytes and inodes for
 *  any path. The sweep measures pressure itself (DR-8, spec 2.5.1), so a fixture must never read the filesystem the
 *  suite happens to run on: a nearly full CI disk would shorten every age and fail cases that are not about pressure. */
export function fakeDf(dir: string): string {
  const f = path.join(dir, 'fake-df');
  fs.writeFileSync(f, '#!/bin/sh\np=${FAKE_DF_PCT:-10}\n'
    + 'echo "Filesystem 1024-blocks Used Available Capacity Mounted on"\n'
    + 'echo "fake 100000 $((p * 1000)) $((100000 - p * 1000)) ${p}% /"\n', { mode: 0o755 });
  return f;
}

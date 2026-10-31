// A `date` that answers `+%s` from a fixture file, for the rows that pin a verdict one second inside and one second
// past a bound (W8 Task C8b, D-7054; ARCH-69 (#804)). A real clock can tick between a fixture's write and the
// check's read, and a boundary row would then flake; this clock does not move. Every other argv runs the real `date`.
import { rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const realDate = ((): string => {
  const p = spawnSync('bash', ['-c', 'command -v date'], { encoding: 'utf8' }).stdout.trim();
  if (!p) throw new Error('this box has no date — the fixed clock needs one to pass every other argv to');
  return p;
})();

/** Plants `<binDir>/date`, answering `+%s` with `now` (read from `<home>/fixture-now`, so a row may move it). The
 *  entry is REMOVED first: a fixture's `date` is often a symlink to the real binary, and a write through it would
 *  overwrite the real one. */
export function fixClock(home: string, binDir: string, now: number): void {
  mkdirSync(binDir, { recursive: true });
  const at = join(binDir, 'date');
  rmSync(at, { force: true });
  writeFileSync(join(home, 'fixture-now'), `${now}\n`);
  writeFileSync(at, [
    '#!/bin/sh',
    'if [ "$#" -eq 1 ] && [ "$1" = +%s ]; then IFS= read -r n < "$HOME/fixture-now"; printf \'%s\\n\' "$n"; exit 0; fi',
    `exec '${realDate}' "$@"`,
    '',
  ].join('\n'), { mode: 0o755 });
}

/** A whole-second instant to fix the clock at. */
export const fixedNow = (): number => Math.floor(Date.now() / 1000);

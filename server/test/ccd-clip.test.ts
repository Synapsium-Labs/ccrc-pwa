// The Mac hotkey lane. `ccd clip` still types the path — correct for a terminal —
// but it used to name every destination .png regardless of the real format, and
// its one-second stamp let two clips in the same second overwrite each other.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const CCD = path.resolve(__dirname, '../../../ccrc-portability/ccd');
const dest = (src: string): string =>
  execFileSync('bash', ['-c', `source "${CCD}"; _clip_dest /tmp/clips "${src}"`],
    { encoding: 'utf8' }).trim();

describe('_clip_dest', () => {
  it('keeps the source extension instead of calling everything .png', () => {
    expect(dest('/tmp/photo.jpg')).toMatch(/\.jpg$/);
    expect(dest('/tmp/shot.PNG')).toMatch(/\.png$/);
  });

  it('does not collide for two clips filed in the same second', () => {
    expect(dest('/tmp/a.png')).not.toBe(dest('/tmp/a.png'));
  });
});

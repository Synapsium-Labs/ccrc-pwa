// The fleet box's half of "nothing runs because it was uploaded" (wave 172,
// any file attaches). On a remote fleet the server stages a clip through the
// agent's `writeB64`, so the file a session is told about is the one this
// writes: it must arrive byte for byte, and with no execute bit for anyone,
// whatever its name says it is.
import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { writeB64 } from '../src/fileops.js';
import { mkTmp } from './tmpHelpers.js';

describe('writeB64, the clip store on the fleet box', () => {
  it('writes a script, a program and an archive with no execute bit, bytes intact', async () => {
    const dir = path.join(mkTmp('ccrc-clipmode-'), '.cc-clips', 'lane-a-project-a');
    const bytes = Buffer.from([0x23, 0x21, 0x2f, 0x62, 0x69, 0x6e, 0x2f, 0x73, 0x68, 0x0a, 0x00, 0x80, 0xff]);
    for (const name of ['clip-20261124-120000-a1b2c3d4-run.sh', 'clip-20261124-120000-a1b2c3d4-tool.exe',
                        'clip-20261124-120000-a1b2c3d4-bundle.zip']) {
      const file = path.join(dir, name);
      expect(await writeB64(file, bytes.toString('base64')), name).toEqual({ ok: true });
      expect(statSync(file).mode & 0o111, name).toBe(0);
      expect(Buffer.compare(readFileSync(file), bytes), name).toBe(0);
    }
  });
});

// `ccd/ccrc#_box_build_fields`' sixth field, `BOX_BUILD[5]` (the Overlord W1 pool set, plan Task 8): the stamp's
// `ccdCaps` as a FIELD-LEVEL answer. `<absent>` for a missing key, the tokens joined by one space for an array of
// capability tokens (empty for `[]`), `<malformed>` for anything else; and whatever the key holds, the rc and fields 0..4
// are what they were, so `shared/buildinfo.ts#parseBuildInfo` and the bash parser still agree on every stamp.
// Fixture HOMEs only; the function runs alone, sourced.
import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseBuildInfo } from '../../shared/buildinfo.js';
import { spawnSyncGroup } from './spawnGroup.js';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';
import { BASH, CCRC_SRC, shq } from './ccrc-doctorFixture.js';

removeTmpFixturesEachTest();

const BASE = { sha: '1f2e3d4c5b6a79881f2e3d4c5b6a79881f2e3d4c', ref: 'main', builtAt: '2026-11-14T10:00:00Z', dirty: false, version: 'v1.2.3' };
const HEAD5 = [BASE.sha, BASE.ref, BASE.builtAt, 'false', 'v1.2.3'];

function run(stampText: string): { rc: number; fields: string[]; stderr: string } {
  const home = mkTmp('ccrc-box-build-caps-');
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  const stamp = join(home, 'stamp.json');
  writeFileSync(stamp, stampText);
  const script = `set -uo pipefail\n. ${shq(CCRC_SRC)}\n_box_build_fields ${shq(stamp)}; rc=$?\nprintf 'RC=%s\\n' "$rc"\n`
    + `for f in "\${BOX_BUILD[@]}"; do printf 'F=[%s]\\n' "$f"; done\n`;
  const r = spawnSyncGroup(BASH, ['-c', script], { env: { HOME: home, PATH: process.env.PATH ?? '', LC_ALL: 'C' }, encoding: 'utf8', timeout: 30_000 });
  const lines = (r.stdout ?? '').split('\n');
  const rc = Number(lines.find((l) => l.startsWith('RC='))?.slice(3));
  const fields = lines.filter((l) => l.startsWith('F=[')).map((l) => l.slice(3, -1));
  return { rc, fields, stderr: r.stderr ?? '' };
}
const stampWith = (extra: string): string => `${JSON.stringify(BASE).slice(0, -1)}${extra}}`;

describe('_box_build_fields: the ccdCaps field answer (BOX_BUILD[5])', () => {
  it('a missing ccdCaps reads <absent>, and the stamp parses', () => {
    const r = run(JSON.stringify(BASE));
    expect(r.rc).toBe(0);
    expect(r.fields).toEqual([...HEAD5, '<absent>']);
  });

  it('[] reads as the empty field', () => {
    const r = run(stampWith(',"ccdCaps":[]'));
    expect(r.rc).toBe(0);
    expect(r.fields).toEqual([...HEAD5, '']);
  });

  it('tokens are joined by one space', () => {
    const r = run(stampWith(',"ccdCaps":["ws-add","pool-set"]'));
    expect(r.rc).toBe(0);
    expect(r.fields).toEqual([...HEAD5, 'ws-add pool-set']);
  });

  const MALFORMED: Array<[string, string]> = [
    ['a string', '"x"'],
    ['an object', '{}'],
    ['a number', '1'],
    ['null', 'null'],
    ['a number inside an array', '[1]'],
    ['a capital letter', '["Pool"]'],
    ['a space inside a token', '["a b"]'],
    ['a leading digit', '["1a"]'],
    ['a control byte', '["a\\u0007b"]'],
    ['a newline', '["a\\nb"]'],
    // F2: jq's `$` matches before a final newline, so the token's end is `\z`; with `$` this stamp failed WHOLE (rc 6).
    ['a trailing newline', '["pool-set\\n"]'],
  ];
  for (const [name, json] of MALFORMED) {
    it(`${name} reads <malformed>, never failing the stamp`, () => {
      const text = stampWith(`,"ccdCaps":${json}`);
      const r = run(text);
      expect(r.rc, r.stderr).toBe(0);
      expect(r.fields).toEqual([...HEAD5, '<malformed>']);
      expect(parseBuildInfo(text), 'the server-side parser agrees the stamp is well-formed').not.toBeNull();
    });
  }

  it('parseBuildInfo accepts the well-formed ccdCaps stamps too', () => {
    for (const j of ['', ',"ccdCaps":[]', ',"ccdCaps":["ws-add","pool-set"]']) expect(parseBuildInfo(stampWith(j))).not.toBeNull();
  });

  it('a stamp without version still answers its sixth field', () => {
    const { version: _v, ...noVersion } = BASE;
    const r = run(JSON.stringify({ ...noVersion, ccdCaps: ['pool-set'] }));
    expect(r.rc).toBe(0);
    expect(r.fields).toEqual([BASE.sha, BASE.ref, BASE.builtAt, 'false', '', 'pool-set']);
    expect(run(JSON.stringify(noVersion)).fields[5]).toBe('<absent>');
  });
});

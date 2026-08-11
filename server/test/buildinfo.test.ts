// The stamp reader refuses to invent: absent file, unreadable file, invalid
// JSON, wrong shape — all null, never a throw and never a partial object.
// /health is the deploy's own verification gate; a stamp problem must not
// take the route down with it.
import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { readBuildInfo } from '../src/buildinfo.js';
import { mkTmp } from './tmpHelpers.js';

const put = (content: string): string => {
  const dir = mkTmp('ccrc-buildinfo-');
  const f = path.join(dir, 'build.json');
  writeFileSync(f, content);
  return f;
};

describe('readBuildInfo', () => {
  it('reads a complete stamp', () => {
    const stamp = JSON.stringify({ sha: 'a'.repeat(40), ref: 'main', builtAt: '2026-08-11T11:00:00Z', dirty: false });
    expect(readBuildInfo(put(stamp))).toEqual(JSON.parse(stamp));
  });

  it('a missing file is null', () => {
    expect(readBuildInfo(path.join(mkTmp('ccrc-buildinfo-'), 'nope.json'))).toBeNull();
  });

  it('invalid JSON is null, not a throw', () => {
    expect(readBuildInfo(put('{half a stamp'))).toBeNull();
  });

  it('a wrong shape is null — a stamp with no sha is not a stamp', () => {
    expect(readBuildInfo(put('{"ref":"main","builtAt":"2026-08-11T11:00:00Z","dirty":false}'))).toBeNull();
    expect(readBuildInfo(put('{"sha":42,"ref":"main","builtAt":"x","dirty":false}'))).toBeNull();
  });
});

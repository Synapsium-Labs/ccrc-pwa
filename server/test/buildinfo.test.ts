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

  it('an EMPTY sha is null — the malformed value that fails safe-looking', () => {
    // A `typeof`-only check accepts this file as a stamp, and it is the one
    // bad value that does not announce itself downstream: two boxes both
    // reporting `sha: ''` compare EQUAL, so the cross-box skew check would
    // report "the builds agree" from two files neither box could read.
    // "Nothing is known" and "they match" must not be the same value —
    // rejecting the stamp keeps them apart, because absence is already a
    // distinct condition every consumer handles.
    expect(readBuildInfo(put('{"sha":"","ref":"main","builtAt":"x","dirty":false}'))).toBeNull();
    // Whole or not at all: `stamp_build` writes these three from `git
    // rev-parse`, `git rev-parse --abbrev-ref` and `date -u`, none of which
    // can emit an empty string, so an empty one anywhere means the file was
    // not written by a deploy. Accepting a `ref: ''` would hand every consumer
    // a field it has to re-check for itself.
    expect(readBuildInfo(put('{"sha":"abc","ref":"","builtAt":"x","dirty":false}'))).toBeNull();
    expect(readBuildInfo(put('{"sha":"abc","ref":"main","builtAt":"","dirty":false}'))).toBeNull();
    // ...and the same stamp with all three present is still read, so the guard
    // above is rejecting emptiness rather than the shape.
    expect(readBuildInfo(put('{"sha":"abc","ref":"main","builtAt":"x","dirty":true}')))
      .toEqual({ sha: 'abc', ref: 'main', builtAt: 'x', dirty: true });
  });
});

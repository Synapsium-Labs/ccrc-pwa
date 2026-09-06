// The pool vocabulary is spelled once per LANGUAGE and the spellings are held
// equal HERE, because they cannot be held equal structurally: `ccd/ccd` sources
// nothing from this repository, and `ccd/ccrc-doctor-checks` is sourced under
// `set -u` by things that are not `ccrc` (`ccrc-doctor.test.ts`'s `tableNames()`
// does exactly that), so neither can import a TypeScript constant. This is the
// `CCRC_RC_FILE` mechanism from `single-definition.test.ts`, applied to the two
// values the pool design puts in two languages: the NAME GRAMMAR and the
// DIRECTORY NAME.
//
// The precedent this improves on is `ccd/ccrc-wrapper-shape:67`, which holds a
// hand-written bash copy of `shared/roster.ts`'s `ID_RE` and discloses that
// nothing pins it. These two are pinned.
//
// EXACTLY ONE occurrence each, not "at least one": a second assignment in the
// same file is the drift this exists to refuse, and a scan that took the first
// match would not see it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { POOL_NAME_RE } from '../../shared/roster.js';
import { POOLS_DIR_NAME } from '../src/pools.js';
import { CCD } from './ccdWsHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ccrcRoot = path.resolve(here, '..', '..');
const ccdSrc = readFileSync(CCD, 'utf8');

/** The single capture, with the count asserted first — a helper rather than a
 *  repeated three-line block, because this file makes the same claim about
 *  three literals in two files. */
const exactlyOne = (src: string, re: RegExp, what: string): string => {
  const all = [...src.matchAll(re)];
  expect(all.length, `${what}: expected exactly one occurrence, found ${all.length}`).toBe(1);
  return all[0]![1]!;
};

describe('the pool-name grammar is one grammar in two languages', () => {
  it('guards the guard: the TypeScript regex is the anchored shape it claims to be', () => {
    // A `POOL_NAME_RE` that had become `//` would make every comparison below
    // pass against an empty bash literal.
    expect(POOL_NAME_RE.source.startsWith('^')).toBe(true);
    expect(POOL_NAME_RE.source.endsWith('$')).toBe(true);
    expect(POOL_NAME_RE.source.length).toBeGreaterThan(8);
  });

  it('ccd/ccd holds exactly one POOL_NAME_RE, byte-equal to shared/roster.ts', () => {
    const bash = exactlyOne(ccdSrc, /^POOL_NAME_RE='([^']*)'$/gm, 'ccd/ccd POOL_NAME_RE');
    expect(bash).toBe(POOL_NAME_RE.source);
  });
});

describe('the pools directory is one name in two languages', () => {
  it('ccd/ccd holds exactly one POOLS_DIR, and its tail is POOLS_DIR_NAME', () => {
    const tail = exactlyOne(ccdSrc, /^POOLS_DIR="\$REG\/([^"]*)"$/gm, 'ccd/ccd POOLS_DIR');
    expect(tail).toBe(POOLS_DIR_NAME);
  });

  it('guards the guard: POOLS_DIR_NAME is a plain dotless segment', () => {
    // A dot-leading directory would land inside ccd's own private namespace
    // (spec §4), and a name with a slash would not be one directory at all.
    expect(POOLS_DIR_NAME).toMatch(/^[a-z][a-z0-9-]*$/);
  });
});

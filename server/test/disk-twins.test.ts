// D-6618 (plan docs/superpowers/plans/2026-10-23-fleet-disk-retention.md, Task DR-6; spec 2026-10-23 §2.5.1, §2.5.2):
// the bash twins of L0's disk vocabulary. `ccd/ccrc-doctor-checks` (and, as they land, the tmp sweep and `ccd`)
// spell the thresholds and the work-root table again in bash, because a box-side check cannot import TypeScript.
// This test READS the bash and requires each constant equal to `shared/disk.ts`'s, so a twin cannot drift.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DISK_CRITICAL_PCT, DISK_WARN_PCT, DISK_WORK_ROOTS } from '../../shared/disk.js';
import { REPO } from './rings/walkSrc.js';

const read = (rel: string): string => readFileSync(join(REPO, rel), 'utf8');

/** `NAME=123` at the start of a line (a top-level assignment); the number, or null when absent. */
const bashInt = (src: string, name: string): number | null => {
  const m = new RegExp(`^${name}=(\\d+)\\s*(?:#.*)?$`, 'm').exec(src);
  return m ? Number(m[1]) : null;
};

/** The bash table: one `label|template|template` string per quoted element of `NAME=( ... )`. */
const bashTable = (src: string, name: string): string[][] | null => {
  const m = new RegExp(`^${name}=\\(([^)]*)\\)`, 'm').exec(src);
  if (!m) return null;
  return [...m[1]!.matchAll(/'([^']*)'/g)].map((e) => e[1]!.split('|'));
};

describe('the bash twins of shared/disk.ts', () => {
  const doctor = read('ccd/ccrc-doctor-checks');

  it('doctor spells the warn and critical percents as L0 does', () => {
    expect(bashInt(doctor, '_DR_DISK_WARN_PCT')).toBe(DISK_WARN_PCT);
    expect(bashInt(doctor, '_DR_DISK_CRITICAL_PCT')).toBe(DISK_CRITICAL_PCT);
  });

  it('doctor spells the work-root table as L0 does, label and templates in order', () => {
    expect(bashTable(doctor, '_DR_DISK_WORK_ROOTS')).toEqual(DISK_WORK_ROOTS.map((r) => [r.label, ...r.templates]));
  });
});

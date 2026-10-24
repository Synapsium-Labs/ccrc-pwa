// D-6618 (plan docs/superpowers/plans/2026-10-23-fleet-disk-retention.md, Task DR-6; spec 2026-10-23 §2.5.1, §2.5.2):
// the bash twins of L0's disk vocabulary. `ccd/ccrc-doctor-checks`, `ccd/ccd-tmp-sweep` (DR-8, D-6620) and, as it
// lands, `ccd` spell the thresholds, the work-root table and the pressure ages again in bash, because a box-side check
// cannot import TypeScript. This test READS the bash and requires each constant equal to `shared/disk.ts`'s, so a twin
// cannot drift. A comment is a request; a red suite is a mechanism.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DISK_CRITICAL_PCT, DISK_PRESSURE_AGES, DISK_WARN_PCT, DISK_WORK_ROOTS } from '../../shared/disk.js';
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

/** Non-comment lines only: a sentence ABOUT a constant is not its definition. */
const code = (t: string): string => t.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

describe('the bash twins of shared/disk.ts', () => {
  const doctor = read('ccd/ccrc-doctor-checks');

  it('doctor spells the warn and critical percents as L0 does', () => {
    expect(bashInt(doctor, '_DR_DISK_WARN_PCT')).toBe(DISK_WARN_PCT);
    expect(bashInt(doctor, '_DR_DISK_CRITICAL_PCT')).toBe(DISK_CRITICAL_PCT);
  });

  it('ccd\'s loose arm spells the critical percent as L0 does (D-6625)', () => {
    expect(bashInt(read('ccd/ccd'), '_DISK_CRITICAL_PCT')).toBe(DISK_CRITICAL_PCT);
  });

  it('doctor spells the work-root table as L0 does, label and templates in order', () => {
    expect(bashTable(doctor, '_DR_DISK_WORK_ROOTS')).toEqual(DISK_WORK_ROOTS.map((r) => [r.label, ...r.templates]));
  });
});

describe('ccd-tmp-sweep twins L0\'s pressure vocabulary (DR-8, D-6620)', () => {
  const SWEEP = read('ccd/ccd-tmp-sweep');

  it('CONTROL: the reader finds the constants it is about to compare', () => {
    expect(code(SWEEP)).toMatch(/^TS_PRESSURE_PCT=\d+$/m);
    expect(code(SWEEP).match(/^TS_AGES_[A-Z_]+="\d+ \d+"$/gm)?.length).toBeGreaterThan(0);
  });

  it('its pressure threshold is DISK_CRITICAL_PCT', () => {
    const m = /^TS_PRESSURE_PCT=(\d+)$/m.exec(code(SWEEP));
    expect(Number(m?.[1])).toBe(DISK_CRITICAL_PCT);
  });

  it('its age pairs are DISK_PRESSURE_AGES\' tmp-sweep rows, normal then pressure, and no more', () => {
    const bash = [...code(SWEEP).matchAll(/^TS_AGES_([A-Z_]+)="(\d+) (\d+)"$/gm)]
      .map((m) => ({ sweep: `tmp-sweep-${m[1]!.toLowerCase().replace(/_/g, '-')}`, normalS: Number(m[2]), pressureS: Number(m[3]) }));
    const l0 = DISK_PRESSURE_AGES.filter((a) => a.sweep.startsWith('tmp-sweep-'));
    expect(bash.sort((a, b) => a.sweep.localeCompare(b.sweep))).toEqual([...l0].sort((a, b) => a.sweep.localeCompare(b.sweep)));
  });
});

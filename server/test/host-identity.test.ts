// The one host measurer (Overlord W1, plan `w1-isolation.md` Task 1, question 13): synthetic trees under the run's temp
// root only. No test reads or prints the live host's ids.
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { hostDigest, hostReportOf, readHostIds } from '../../shared/host-identity.mjs';
import { HOST_DIGEST_RE, readHostReport } from '../../shared/isolation.js';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';

removeTmpFixturesEachTest();

const MACHINE = 'a'.repeat(32);
const BOOT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function tree(opts: { machine?: string | null; boot?: string | null } = {}): { procRoot: string; etcRoot: string } {
  const root = mkTmp('ccrc-hostids-');
  const etcRoot = path.join(root, 'etc');
  const procRoot = path.join(root, 'proc');
  mkdirSync(etcRoot, { recursive: true });
  mkdirSync(path.join(procRoot, 'sys/kernel/random'), { recursive: true });
  const machine = opts.machine === undefined ? `${MACHINE}\n` : opts.machine;
  const boot = opts.boot === undefined ? `${BOOT}\n` : opts.boot;
  if (machine !== null) writeFileSync(path.join(etcRoot, 'machine-id'), machine);
  if (boot !== null) writeFileSync(path.join(procRoot, 'sys/kernel/random/boot_id'), boot);
  return { procRoot, etcRoot };
}
const linux = (t: { procRoot: string; etcRoot: string }) => ({ ...t, platform: 'linux' });

describe('readHostIds', () => {
  it('reads both well-formed ids', () => {
    expect(readHostIds(linux(tree()))).toEqual({ machine: MACHINE, boot: BOOT });
  });

  for (const [name, value] of [['missing', null], ['empty', ''], ['malformed', 'not-an-id\n']] as const) {
    it(`reads a ${name} machine id as unmeasured, the boot id still measured`, () => {
      expect(readHostIds(linux(tree({ machine: value })))).toEqual({ machine: 'unmeasured', boot: BOOT });
    });
    it(`reads a ${name} boot id as unmeasured, the machine id still measured`, () => {
      expect(readHostIds(linux(tree({ boot: value })))).toEqual({ machine: MACHINE, boot: 'unmeasured' });
    });
  }

  it('reads an upper-case machine id and a 32-hex boot id as unmeasured', () => {
    expect(readHostIds(linux(tree({ machine: 'A'.repeat(32), boot: 'a'.repeat(32) })))).toEqual({ machine: 'unmeasured', boot: 'unmeasured' });
  });

  it('reads an over-long file as unmeasured', () => {
    expect(readHostIds(linux(tree({ machine: `${MACHINE}\n${'x'.repeat(200)}` }))).machine).toBe('unmeasured');
  });

  it.skipIf(process.getuid?.() === 0)('reads an unreadable file as unmeasured (mode 000)', () => {
    const t = tree();
    chmodSync(path.join(t.etcRoot, 'machine-id'), 0o000);
    expect(readHostIds(linux(t))).toEqual({ machine: 'unmeasured', boot: BOOT });
  });

  it('reads both as unmeasured off Linux', () => {
    expect(readHostIds({ ...tree(), platform: 'darwin' })).toEqual({ machine: 'unmeasured', boot: 'unmeasured' });
  });
});

describe('hostDigest', () => {
  it('matches HOST_DIGEST_RE', () => { expect(hostDigest('k', 'machine', MACHINE)).toMatch(HOST_DIGEST_RE); });
  it('two kinds of one value differ', () => { expect(hostDigest('k', 'machine', MACHINE)).not.toBe(hostDigest('k', 'boot', MACHINE)); });
  it('two keys of one value differ', () => { expect(hostDigest('k1', 'machine', MACHINE)).not.toBe(hostDigest('k2', 'machine', MACHINE)); });
  it('the same key, kind and value agree', () => { expect(hostDigest('k', 'boot', BOOT)).toBe(hostDigest('k', 'boot', BOOT)); });
  it('is keyed: it is not the plain hash of the value', () => {
    expect(hostDigest('k', 'machine', MACHINE)).not.toBe(hostDigest('', 'machine', MACHINE));
  });
});

describe('hostReportOf', () => {
  it('digests each id under the key, and keeps the uid', () => {
    const r = hostReportOf({ machine: MACHINE, boot: BOOT }, 2000, 'bearer');
    expect(r).toEqual({ uid: 2000, machine: hostDigest('bearer', 'machine', MACHINE), boot: hostDigest('bearer', 'boot', BOOT) });
    expect(readHostReport(r)).toEqual(r);
  });
  it('reads an undefined uid as unmeasured', () => {
    expect(hostReportOf({ machine: MACHINE, boot: BOOT }, undefined, 'k').uid).toBe('unmeasured');
  });
  it('keeps an unmeasured id unmeasured', () => {
    expect(hostReportOf({ machine: 'unmeasured', boot: BOOT }, 0, 'k').machine).toBe('unmeasured');
    expect(hostReportOf({ machine: MACHINE, boot: 'unmeasured' }, 0, 'k').boot).toBe('unmeasured');
  });
  it('the JSON of the report never holds a fixture id', () => {
    const json = JSON.stringify(hostReportOf({ machine: MACHINE, boot: BOOT }, 2000, 'k'));
    expect(json).not.toContain(MACHINE);
    expect(json).not.toContain(BOOT);
  });
});

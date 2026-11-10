// TC14 (D-8166; spec 2026-11-07 §2.5, §6): the lifecycle rows for the files `ccrc testbox-admin` writes on the fleet
// host. The two old operator-placed rows now name the verb as writer and collector, and each new file has one row.
import { describe, it, expect } from 'vitest';
import { LIFECYCLE } from '../../shared/lifecycle.js';

const by = (n: string) => LIFECYCLE.find((x) => x.name === n);
const NEW_ROWS = [
  'testbox-admin-key', 'testbox-known-hosts', 'testbox-overlay', 'testbox-admin-state', 'testbox-box-settings',
  'testbox-parity', 'testbox-admin-lock', 'testbox-admin-log',
] as const;

describe('the test box connect lifecycle rows (D-8166)', () => {
  it('testbox-token and testbox-push-key name ccrc testbox-admin connect as writer and disconnect as collector', () => {
    for (const n of ['testbox-token', 'testbox-push-key']) {
      const c = by(n);
      expect(c, `no ${n} row`).toBeTruthy();
      expect(c!.creators.join(' ')).toContain('ccrc testbox-admin connect');
      expect(c!.collector).toContain('ccrc testbox-admin disconnect');
      expect(c!.ruling, `${n} needs no ruling now`).toBeNull();
      expect(JSON.stringify(c)).not.toContain('nothing in the tree writes or removes it');
    }
  });
  it('testbox-admin-key, testbox-known-hosts, testbox-overlay, testbox-admin-state, testbox-box-settings, testbox-parity and testbox-admin-lock each have one row', () => {
    for (const n of NEW_ROWS) expect(LIFECYCLE.filter((x) => x.name === n), `${n}`).toHaveLength(1);
    expect(by('testbox-admin-key')!.root).toContain('testbox-admin.key');
    expect(by('testbox-known-hosts')!.root).toContain('testbox-known-hosts');
    expect(by('testbox-overlay')!.root).toContain('testbox.env');
    expect(by('testbox-admin-state')!.root).toContain('testbox-admin.state');
    expect(by('testbox-box-settings')!.root).toContain('testbox-box-settings.json');
    expect(by('testbox-parity')!.root).toContain('testbox-parity.json');
    expect(by('testbox-admin-lock')!.root).toContain('testbox-admin.lock');
  });
  it('the access key row says Disconnect keeps it and the operator removes it with the box\'s retirement', () => {
    const k = by('testbox-admin-key')!;
    expect(k.collector).toBeNull();
    expect(k.ruling).toContain('Disconnect keeps');
    expect(k.ruling).toContain('retire');
  });
  it('every new row names ccrc testbox-admin as its writer and has a collector or a ruling', () => {
    for (const n of NEW_ROWS) {
      const c = by(n)!;
      expect(c.creators.join(' '), n).toContain('ccrc testbox-admin');
      expect(Boolean(c.collector) !== Boolean(c.ruling), `${n} has exactly one of collector and ruling`).toBe(true);
    }
  });
  it('no row names a host, an address or a user', () => {
    for (const n of ['testbox-token', 'testbox-push-key', ...NEW_ROWS]) {
      const text = JSON.stringify(by(n));
      expect(text, n).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
      expect(text, n).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i);
      expect(text, n).not.toMatch(/\/(home|Users)\/[a-z]/i);
    }
  });
});

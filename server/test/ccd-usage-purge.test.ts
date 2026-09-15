import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-usage-purge-'); });
afterEach(() => { h.cleanup(); });

const usage = (rel: string): string => path.join(h.home, '.cc-sessions', 'usage', rel);
const seed = (id: string): void => {
  h.sh(`_reg_set ${id} wrapper claude; _reg_set ${id} uuid 00000000-0000-0000-0000-000000000000`);
  fs.mkdirSync(usage(`${id}.agents`), { recursive: true });
  fs.writeFileSync(usage(`${id}.json`), '{"ts":1}\n');
  fs.writeFileSync(usage(`${id}.agents/scout.json`), '{"ts":1,"agent":"scout"}\n');
};

describe('_reg_purge reaps the usage sidecar so a reused id never inherits a dead reading (routing spec §6)', () => {
  it('removes the main row and the agents directory of the purged id, and ONLY that id', () => {
    seed('demo-a'); seed('demo-ab');
    h.sh('_reg_purge demo-a');
    expect(fs.existsSync(usage('demo-a.json'))).toBe(false);
    expect(fs.existsSync(usage('demo-a.agents'))).toBe(false);
    // `_reg_purge`'s own unanchored-glob hazard, applied here: demo-a must not take demo-ab with it
    expect(fs.existsSync(usage('demo-ab.json'))).toBe(true);
    expect(fs.existsSync(usage('demo-ab.agents/scout.json'))).toBe(true);
    expect(h.reg('demo-ab', 'uuid')).not.toBeNull();
  });

  it('is a silent no-op for an id with no sidecar', () => {
    h.sh('_reg_set demo-b wrapper claude');
    expect(h.sh('_reg_purge demo-b; echo rc=$?')).toContain('rc=0');
  });

  it('_usage_purge on its own returns 0 whether or not anything existed', () => {
    seed('demo-c');
    expect(h.sh('_usage_purge demo-c; echo rc=$?')).toContain('rc=0');
    expect(h.sh('_usage_purge demo-never; echo rc=$?')).toContain('rc=0');
    expect(fs.existsSync(usage('demo-c.json'))).toBe(false);
  });

  it('cleans up leaked tmp files for the purged id only', () => {
    fs.mkdirSync(usage('.'), { recursive: true });
    // Create leaked tmp files for demo-a and demo-ab
    fs.writeFileSync(usage('.demo-a.123.tmp'), '{}');
    fs.writeFileSync(usage('.demo-ab.123.tmp'), '{}');
    h.sh('_usage_purge demo-a');
    expect(fs.existsSync(usage('.demo-a.123.tmp'))).toBe(false);
    expect(fs.existsSync(usage('.demo-ab.123.tmp'))).toBe(true);
  });
});

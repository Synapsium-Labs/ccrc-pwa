import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { localIO } from '../src/io.js';
import { readLimits } from '../src/limits.js';
import { rolloverCases } from './fixtures/rollover.js';

describe('readLimits', () => {
  it('reads fresh values and decays stale ones per ccd rules', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'ccrc-'));
    const dir = path.join(home, '.cc-limits');
    mkdirSync(dir, { recursive: true });
    const now = 1784600000;
    writeFileSync(path.join(dir, 'claude.json'), JSON.stringify({ five: 42, seven: 61, ts: now - 60, fiveResetAt: now + 3600, sevenResetAt: now + 86400 }));
    writeFileSync(path.join(dir, 'claude2.json'), JSON.stringify({ five: 99, seven: 80, ts: now - 20000 }));  // 5h window rolled
    writeFileSync(path.join(dir, 'claude-corp.json'), JSON.stringify({ five: 94, seven: 94, ts: now - 700000 })); // both rolled
    writeFileSync(path.join(dir, 'gpt.json'), 'not json');

    const l = await readLimits(localIO, loadConfig({ CCRC_HOME: home }), now);
    expect(l['claude']).toEqual({ five: 42, seven: 61, ts: now - 60, fiveResetAt: now + 3600, sevenResetAt: now + 86400, fiveRolledOver: false, sevenRolledOver: false });
    expect(l['claude2'].five).toBe(0);
    expect(l['claude2'].seven).toBe(80);
    expect(l['claude-corp']).toMatchObject({ five: 0, seven: 0 });
    expect(l['gpt']).toEqual({ five: null, seven: null, ts: null, fiveResetAt: null, sevenResetAt: null, fiveRolledOver: false, sevenRolledOver: false });
  });
});

describe('readLimits — a window that has rolled over', () => {
  it('reports every rollover case exactly', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'ccrc-'));
    const dir = path.join(home, '.cc-limits');
    mkdirSync(dir, { recursive: true });
    const now = 1785231736;
    const cases = rolloverCases(now);
    for (const c of cases) writeFileSync(path.join(dir, c.file), c.content);

    const l = await readLimits(localIO, loadConfig({ CCRC_HOME: home }), now);
    for (const c of cases) {
      const wrapper = c.file.slice(0, -'.json'.length);
      expect(l[wrapper], `${c.file}: ${c.why}`).toMatchObject(c.expect);
    }
  });

  it('a rolled-over zero is distinguishable from a measured zero', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'ccrc-'));
    const dir = path.join(home, '.cc-limits');
    mkdirSync(dir, { recursive: true });
    const now = 1785231736;
    writeFileSync(path.join(dir, 'measured.json'),
      JSON.stringify({ five: 0, seven: 0, ts: now - 60, fiveResetAt: now + 3600, sevenResetAt: now + 86400 }));
    writeFileSync(path.join(dir, 'inferred.json'),
      JSON.stringify({ five: 55, seven: 55, ts: now - 60, fiveResetAt: now - 1, sevenResetAt: now - 1 }));

    const l = await readLimits(localIO, loadConfig({ CCRC_HOME: home }), now);
    expect(l['measured']).toMatchObject({ five: 0, fiveRolledOver: false });
    expect(l['inferred']).toMatchObject({ five: 0, fiveRolledOver: true });
  });
});

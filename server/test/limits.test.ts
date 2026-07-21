import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { readLimits } from '../src/limits.js';

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

    const l = await readLimits(loadConfig({ CCRC_HOME: home }), now);
    expect(l['claude']).toEqual({ five: 42, seven: 61, ts: now - 60, fiveResetAt: now + 3600, sevenResetAt: now + 86400 });
    expect(l['claude2'].five).toBe(0);
    expect(l['claude2'].seven).toBe(80);
    expect(l['claude-corp']).toMatchObject({ five: 0, seven: 0 });
    expect(l['gpt']).toEqual({ five: null, seven: null, ts: null, fiveResetAt: null, sevenResetAt: null });
  });
});

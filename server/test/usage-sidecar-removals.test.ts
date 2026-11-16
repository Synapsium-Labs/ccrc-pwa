// D-7080 (ARCH-72, W5 plan 2026-10-27-consolidation-w5-ccd-helpers.md Task C5k; OA-C13 ruled (b) 2026-10-27). The
// usage sidecars have two deleters, both kept (their names are pinned in `single-definition/late-census.test.ts`):
// ccd's `_usage_purge` and the usage sweep's `reap_orphans`, which runs in another process. This file pins, side by
// side, WHAT each one removes for one orphan both would reap (no `$REG/<id>.uuid`, a readable `ts` more than a day
// old), so a later change to either one's removals is a visible diff here. Spec K16's "only by `_usage_purge`" is not
// applied (D-7080). Each deleter runs in its own fixture HOME (`makeCcdHarness`), never a live one.
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { FAMILY_TOKENS } from '../../shared/models.mjs';

const SWEEP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../ccd/ccd-usage-sweep.py');
/** The sweep's clock (`--now`); the orphan's `ts` is two days before it. */
const NOW = 1_800_000_000;
const ID = 'orphan-a';

let harnesses: CcdHarness[] = [];
afterEach(() => { for (const h of harnesses) h.cleanup(); harnesses = []; });

/** A fixture HOME holding one orphan's whole sidecar: the row, two staged temps and an agents directory with one
 *  file. No `$REG/<id>.uuid` is written, so the id has no registry row. */
function seeded(): { h: CcdHarness; usage: string } {
  const h = makeCcdHarness('ccrc-usage-sidecar-removals-');
  harnesses.push(h);
  const usage = path.join(h.home, '.cc-sessions', 'usage');
  fs.mkdirSync(path.join(usage, `${ID}.agents`), { recursive: true });
  fs.writeFileSync(path.join(usage, `${ID}.json`), JSON.stringify({ ts: NOW - 2 * 86400 }) + '\n');
  fs.writeFileSync(path.join(usage, `.${ID}.123.tmp`), '{}');
  fs.writeFileSync(path.join(usage, `.${ID}.456.tmp`), '{}');
  fs.writeFileSync(path.join(usage, `${ID}.agents`, 'scout.json'), JSON.stringify({ ts: NOW - 2 * 86400, agent: 'scout' }) + '\n');
  expect(fs.existsSync(path.join(h.home, '.cc-sessions', `${ID}.uuid`)), 'CONTROL: the id has no registry row').toBe(false);
  return { h, usage };
}

/** Every path under `dir`, relative to it, sorted. */
function tree(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string, pre: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = pre ? `${pre}/${e.name}` : e.name;
      out.push(r);
      if (e.isDirectory()) walk(path.join(d, e.name), r);
    }
  };
  if (fs.existsSync(dir)) walk(dir, '');
  return out.sort();
}

/** The sorted set of paths `run` removed from `usage`. */
function removedBy(usage: string, run: () => void): string[] {
  const before = tree(usage);
  run();
  const after = new Set(tree(usage));
  return before.filter((p) => !after.has(p));
}

describe('what each usage-sidecar deleter removes for one orphan, side by side (D-7080; OA-C13 ruled (b))', () => {
  it('_usage_purge removes the row, the .<id>.*.tmp temps and <id>.agents/; reap_orphans removes the row and <id>.agents/, never the temps', () => {
    const purge = seeded();
    const byPurge = removedBy(purge.usage, () => { purge.h.sh(`_usage_purge ${ID}`); });

    const sweep = seeded();
    let reaped: unknown = null;
    const byReap = removedBy(sweep.usage, () => {
      const out = path.join(sweep.h.home, 'sweep.json');
      const r = spawnSync('python3', [SWEEP, '--dirs', '{}', '--class-tokens', JSON.stringify(FAMILY_TOKENS),
        '--registry', path.join(sweep.h.home, '.cc-sessions'), '--limits', path.join(sweep.h.home, '.cc-limits'),
        '--out', out, '--now', String(NOW), '--reap-orphans'], { encoding: 'utf8', env: sweep.h.env() });
      expect(r.status, r.stderr).toBe(0);
      reaped = (JSON.parse(fs.readFileSync(out, 'utf8')) as Record<string, unknown>)['orphansReaped'];
    });
    expect(reaped, 'CONTROL: the sweep reaped the orphan').toEqual([ID]);

    expect({ _usage_purge: byPurge, reap_orphans: byReap }).toEqual({
      _usage_purge: ['.orphan-a.123.tmp', '.orphan-a.456.tmp', 'orphan-a.agents', 'orphan-a.agents/scout.json', 'orphan-a.json'],
      reap_orphans: ['orphan-a.agents', 'orphan-a.agents/scout.json', 'orphan-a.json'],
    });
  });
});

// FLEET DISK RETENTION DR-18 (D-6630; spec 2026-10-23 section 5). The three orphan-lane builders compose exactly the argv
// ccd's `ws-audit --orphans`, `ws-audit --orphan-hex` and `ws-orphan` parse, and nothing else: the path travels as hex
// only, `--rescue` rides only when asked, the dec trails, and `--force` is never composed.
import { describe, it, expect } from 'vitest';
import { CCD_ARGV, ORPHAN_CAP } from '../src/ccdargv.js';
import type { OrphanToken } from '../../shared/api.js';

const TOK = 'a'.repeat(64) as OrphanToken;
const HEX = '2f70726f6a2f77742e61';

describe('the orphan lane\'s argv builders (D-6630)', () => {
  it('the cap token is spelled once, as ccd echoes it', () => {
    expect(ORPHAN_CAP).toBe('orphan-v1');
  });

  it('the census and the audit are read-only ws-audit modes', () => {
    expect([...CCD_ARGV.wsOrphanCensus()]).toEqual(['ws-audit', '--orphans']);
    expect([...CCD_ARGV.wsOrphanAudit(HEX)]).toEqual(['ws-audit', '--orphan-hex', HEX]);
  });

  it('the act leads with its token, names the tree as hex, and rescues only when told to', () => {
    expect([...CCD_ARGV.wsOrphan(TOK, HEX, false, null)]).toEqual(['ws-orphan', '--expect', TOK, '--tree-hex', HEX]);
    expect([...CCD_ARGV.wsOrphan(TOK, HEX, true, null)]).toEqual(['ws-orphan', '--expect', TOK, '--tree-hex', HEX, '--rescue']);
  });

  it('the dec trails the rescue flag, and no builder ever composes --force', () => {
    const dec = { surface: 'agent', actor: 'orphan sweep', reason: 'orphan' } as const;
    const a = [...CCD_ARGV.wsOrphan(TOK, HEX, true, dec)];
    expect(a.slice(0, 6)).toEqual(['ws-orphan', '--expect', TOK, '--tree-hex', HEX, '--rescue']);
    expect(a.slice(6)).toEqual(['--surface', 'agent', '--actor', 'orphan sweep', '--reason', 'orphan']);
    expect(a).not.toContain('--force');
  });

  it.each(['', 'abc', '2F61', '/tmp/tree', '--rescue', '2f 61', '-1'])('refuses %j as a tree: only even-length lowercase hex travels', (bad) => {
    expect(() => CCD_ARGV.wsOrphanAudit(bad)).toThrow(/hex/);
    expect(() => CCD_ARGV.wsOrphan(TOK, bad, false, null)).toThrow(/hex/);
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string): string => readFileSync(path.join(root, rel), 'utf8');
const count = (s: string, needle: string): number => s.split(needle).length - 1;
const under = (dir: string, ext: string): string[] =>
  readdirSync(path.join(root, dir), { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith(ext))
    .map((e) => path.relative(root, path.join(e.parentPath, e.name)));

describe('routing env census (routing spec 2026-09-14 §5.2, §8)', () => {
  it('CLAUDE_CODE_EFFORT_LEVEL is set NOWHERE — the only shipped mention is the doctor check that refuses it', () => {
    const shipped = ['ccd/ccd', 'ccd/ccrc', 'ccd/session-hook.sh', 'ccd/statusline-command.sh', 'ccd/ccd-usage-sweep',
      ...under('shared', '.mjs'), ...under('shared', '.ts'), ...under('deploy', '.mjs'), ...under('server/src', '.ts'), ...under('agent/src', '.ts')]
      .filter((f) => existsSync(path.join(root, f)));
    expect(shipped.length, 'the census must have a corpus').toBeGreaterThan(20);   // vacuity control
    const holders = shipped.filter((f) => count(read(f), 'CLAUDE_CODE_EFFORT_LEVEL') > 0);
    expect(holders).toEqual([]);
    expect(count(read('ccd/ccrc-doctor-checks'), 'CLAUDE_CODE_EFFORT_LEVEL'), 'the doctor check names it').toBeGreaterThan(0);
  });
  it('ccd composes CLAUDE_CODE_SUBAGENT_MODEL in exactly one place, from the routing record', () => {
    const ccd = read('ccd/ccd');
    expect(count(ccd, 'CLAUDE_CODE_SUBAGENT_MODEL=')).toBe(1);
    expect(ccd).toContain('routeenv="CLAUDE_CODE_SUBAGENT_MODEL=$rsub"');
  });
});

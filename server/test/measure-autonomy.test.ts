// `deploy/measure-autonomy.py` (coordinator-autonomy spec §1.2 and §10) against neutral transcript fixtures under
// `test/fixtures/measure-autonomy/`. The script is run as a subprocess; its functions are reached through its
// subcommands, never by import.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IDLE_COMPACT_NUDGE_PROMPT, RESUME_PROMPT_PREFIX, MAIL_ENVELOPE_FENCE } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(ROOT, 'deploy', 'measure-autonomy.py');
const FIXTURES = path.join(ROOT, 'server', 'test', 'fixtures', 'measure-autonomy');

const run = (args: string[]) => spawnSync('python3', ['-I', SCRIPT, ...args], {
  encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, timeout: 60_000,
});
const rows = (stdout: string): Record<string, string> =>
  Object.fromEntries(stdout.split('\n').filter((l) => /^[a-z0-9_-]+: /.test(l)).map((l) => l.split(': ', 2) as [string, string]));

interface Wait { id: string; session: string; kind: string; hours: number; excerpt: string }
const waitsOf = (out: string): Wait[] => JSON.parse(readFileSync(path.join(out, 'waits.json'), 'utf8')) as Wait[];

/** A fixture tree with only the named subdirectories, copied so a test may add to it. */
function tree(...names: string[]): string {
  const dir = mkTmp('ccrc-autonomy-fx-');
  for (const n of names) cpSync(path.join(FIXTURES, n), path.join(dir, n), { recursive: true });
  return dir;
}
const census = (root: string, extra: string[] = []) => {
  const out = mkTmp('ccrc-autonomy-out-');
  const r = run(['transcripts', '--root', root, '--out', out, ...extra]);
  expect(r.status, r.stderr).toBe(0);
  return { out, r, table: rows(r.stdout), waits: waitsOf(out) };
};
const listing = (dir: string): string[] => readdirSync(dir, { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile()).map((e) => {
    const p = path.join(e.parentPath, e.name);
    return `${p}:${statSync(p).mtimeMs}:${statSync(p).size}`;
  }).sort();

describe('measure-autonomy transcripts', () => {
  it('its second spellings are bound to shared/api.ts’s', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    expect(src).toContain(JSON.stringify(IDLE_COMPACT_NUDGE_PROMPT).slice(1, -1).replace(/\\"/g, '"'));
    expect(src).toContain(RESUME_PROMPT_PREFIX);
    expect(src).toContain(`MAIL_FENCE = '${MAIL_ENVELOPE_FENCE}'`);
  });

  it('counts a coordinator and not a worker', () => {
    const a = census(tree('coord-a'));
    expect(a.table['coordinators']).toBe('1');
    const both = census(tree('coord-a', 'worker-a'));
    expect(both.table['coordinators']).toBe('1');
    expect(both.table['transcripts']).toBe('2');
    expect(both.waits.map((w) => w.session)).not.toContain('session-w');
    expect(census(tree('worker-a')).table['coordinators']).toBe('0');
  });

  it('counts a coordinator by intent as well as by the skill, and one that loaded the skill but opened no run not at all', () => {
    const b = census(tree('coord-b'));
    expect(b.table['coordinators']).toBe('1');
  });

  it('removes a swap copy by message id', () => {
    const solo = census(tree('coord-a'));
    const withCopy = census(tree('coord-a', 'coord-a-copy'));
    expect(withCopy.table['coordinators']).toBe(solo.table['coordinators']);
    expect(withCopy.table['typed-reply']).toBe(solo.table['typed-reply']);
    expect(withCopy.table['all']).toBe(solo.table['all']);
    expect(withCopy.waits.map((w) => [w.kind, w.hours])).toEqual(solo.waits.map((w) => [w.kind, w.hours]));
  });

  it('counts a question-ending turn only when the operator typed the next prompt', () => {
    const { waits, table } = census(tree('coord-a'));
    const typed = waits.filter((w) => w.kind === 'typed-reply');
    expect(typed).toHaveLength(1);
    expect(typed[0]!.hours).toBe(0.5);
    expect(typed[0]!.excerpt).toContain('Which of the two layouts');
    expect(table['typed-reply']).toMatch(/^count=1 /);
  });

  it('does not count a question followed by the idle-compaction nudge', () => {
    const { waits } = census(tree('coord-b'));
    expect(waits.filter((w) => w.kind === 'typed-reply')).toHaveLength(0);
  });

  it('times an AskUserQuestion from the dialog to its answer', () => {
    const { waits, table } = census(tree('coord-b'));
    const dialog = waits.filter((w) => w.kind === 'dialog');
    expect(dialog).toHaveLength(1);
    expect(dialog[0]!.hours).toBe(1.5);
    expect(dialog[0]!.excerpt).toContain('Merge the demo branch now?');
    expect(table['dialog']).toMatch(/^count=1 over_1h=1 /);
  });

  it('reads the 700-character tail only', () => {
    // coord-b's question-ending turn has its `?` 800 characters from the end and a typed prompt after it.
    const { waits } = census(tree('coord-b'));
    expect(waits.filter((w) => w.kind === 'typed-reply')).toHaveLength(0);
  });

  it('keeps the excerpt to 300 characters and out of stdout', () => {
    const { waits, r } = census(tree('coord-a', 'coord-b'));
    for (const w of waits) expect(w.excerpt.length).toBeLessThanOrEqual(300);
    expect(r.stdout).not.toContain('Which of the two layouts');
  });

  it('writes waits.json and waits-over-1h.csv under --out', () => {
    const { out } = census(tree('coord-a', 'coord-b'));
    const csv = readFileSync(path.join(out, 'waits-over-1h.csv'), 'utf8').trim().split('\n');
    expect(csv[0]).toBe('id,kind,hours,excerpt,parts');
    expect(csv).toHaveLength(2);
    expect(csv[1]).toMatch(/,dialog,1\.5,/);
    expect(csv[1]!.endsWith(',')).toBe(true);
  });

  it('keeps a wait out of a window it did not start in', () => {
    const { waits } = census(tree('coord-a', 'coord-b'), ['--since', '2026-11-03']);
    expect(waits).toHaveLength(0);
    const inside = census(tree('coord-a', 'coord-b'), ['--since', '2026-11-02', '--until', '2026-11-03']);
    expect(inside.waits).toHaveLength(2);
  });

  it('writes only under --out', () => {
    const root = tree('coord-a', 'coord-b', 'worker-a');
    const before = listing(root);
    const out = mkTmp('ccrc-autonomy-out-');
    const created = new Set<string>();
    const r = run(['transcripts', '--root', root, '--out', path.join(out, 'nested')]);
    expect(r.status, r.stderr).toBe(0);
    expect(listing(root)).toEqual(before);
    for (const f of readdirSync(out, { recursive: true })) created.add(String(f));
    expect([...created].sort()).toEqual(['nested', 'nested/waits-over-1h.csv', 'nested/waits.json']);
  });

  it('refuses an --out inside a transcript root', () => {
    const root = tree('coord-a');
    const before = listing(root);
    const r = run(['transcripts', '--root', root, '--out', path.join(root, 'coord-a', 'out')]);
    expect(r.status).toBe(2);
    expect(existsSync(path.join(root, 'coord-a', 'out'))).toBe(false);
    expect(listing(root)).toEqual(before);
  });

  it('refuses a root that does not exist, and creates nothing', () => {
    const out = mkTmp('ccrc-autonomy-out-');
    const gone = path.join(out, 'no-such-root');
    const r = run(['transcripts', '--root', gone, '--out', path.join(out, 'o')]);
    expect(r.status).toBe(2);
    expect(existsSync(gone)).toBe(false);
    expect(existsSync(path.join(out, 'o'))).toBe(false);
  });
});

// server/test/usage-sweep.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, readFileSync, utimesSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import { FAMILY_TOKENS } from '../../shared/models.mjs';

afterEach(removeTmpFixtures);
const SCANNER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../ccd/ccd-usage-sweep.py');
/** The clock the scanner is told (`--now`). EVERY fixture transcript's mtime is
 *  stamped relative to it, because the scanner's first gate is mtime against
 *  `now - days`, and a file written with the real wall clock would sit outside a
 *  window anchored on a constant. */
const NOW = 1_800_000_000;
const iso = (s: number): string => new Date(s * 1000).toISOString();
const stamp = (f: string, at: number): void => { utimesSync(f, at, at); };

function line(over: Record<string, unknown>): string {
  const base = {
    type: 'assistant', timestamp: iso(NOW - 3600), sessionId: 'sess-1', effort: 'high',
    message: { id: 'msg-1', model: 'claude-opus-5', usage: { input_tokens: 10, output_tokens: 100, cache_creation_input_tokens: 1000, cache_read_input_tokens: 10_000 } },
  };
  const merged = { ...base, ...over, message: { ...base.message, ...((over['message'] as object) ?? {}) } };
  return JSON.stringify(merged) + '\n';
}

function fixture(): { home: string; dirs: Record<string, string> } {
  const home = mkTmp('ccrc-usage-sweep-');
  const a = path.join(home, '.claude'); const b = path.join(home, '.claude-two');
  const proj = (d: string, slug: string): string => { const p = path.join(d, 'projects', slug); mkdirSync(p, { recursive: true }); return p; };
  // dir A: a main transcript (with one truncated assistant line that carries the
  // prefilter token but is not JSON), a subagent transcript, one old file
  const main = path.join(proj(a, '-w-demo'), 'sess-1.jsonl');
  writeFileSync(main,
    line({ message: { id: 'msg-1' } })
    + line({ message: { id: 'msg-2', model: 'claude-fable-5-1', usage: { input_tokens: 0, output_tokens: 1000, cache_creation_input_tokens: 0, cache_read_input_tokens: 100_000 } }, effort: 'xhigh' })
    + '{"type":"user","timestamp":"' + iso(NOW - 3600) + '"}\n'
    + '{"type":"assistant","message":{\n');
  stamp(main, NOW - 3600);
  const subDir = path.join(proj(a, '-w-demo'), 'sess-1', 'subagents'); mkdirSync(subDir, { recursive: true });
  const sub = path.join(subDir, 'agent-x.jsonl');
  writeFileSync(sub, line({ message: { id: 'msg-3', model: 'claude-sonnet-5' }, isSidechain: true, effort: 'medium' }));
  stamp(sub, NOW - 3600);
  const old = path.join(proj(a, '-w-demo'), 'old.jsonl');
  writeFileSync(old, line({ message: { id: 'msg-old' }, timestamp: iso(NOW - 30 * 86400) }));
  stamp(old, NOW - 30 * 86400);
  // dir B: the SAME msg-1 carried across by a swap (must dedupe), plus its own message
  const carried = path.join(proj(b, '-w-demo'), 'sess-2.jsonl');
  writeFileSync(carried,
    line({ message: { id: 'msg-1' }, sessionId: 'sess-2' })
    + line({ message: { id: 'msg-4', model: 'claude-haiku-4-5-20251001' }, sessionId: 'sess-2', effort: undefined }));
  stamp(carried, NOW - 3600);
  // limits + registry
  mkdirSync(path.join(home, '.cc-limits'), { recursive: true });
  writeFileSync(path.join(home, '.cc-limits', 'claude.json'), JSON.stringify({ five: 10, seven: 40, ts: NOW - 60, fiveResetAt: null, sevenResetAt: null }));
  mkdirSync(path.join(home, '.cc-sessions', 'usage', 'stale-id.agents'), { recursive: true });
  writeFileSync(path.join(home, '.cc-sessions', 'demo-live.uuid'), 'sess-1');
  writeFileSync(path.join(home, '.cc-sessions', 'usage', 'stale-id.json'), JSON.stringify({ ts: NOW - 2 * 86400 }));
  writeFileSync(path.join(home, '.cc-sessions', 'usage', 'fresh-orphan.json'), JSON.stringify({ ts: NOW - 60 }));
  writeFileSync(path.join(home, '.cc-sessions', 'usage', 'demo-live.json'), JSON.stringify({ ts: NOW - 60 }));
  return { home, dirs: { [a]: 'claude', [b]: 'two' } };
}

function runSweep(f: { home: string; dirs: Record<string, string> }, extra: string[] = []): Record<string, unknown> {
  const out = path.join(f.home, 'sweep.json');
  const r = spawnSync('python3', [SCANNER, '--dirs', JSON.stringify(f.dirs), '--class-tokens', JSON.stringify(FAMILY_TOKENS),
    '--registry', path.join(f.home, '.cc-sessions'), '--limits', path.join(f.home, '.cc-limits'), '--out', out,
    '--days', '7', '--now', String(NOW), ...extra], { encoding: 'utf8' });
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse(readFileSync(out, 'utf8')) as Record<string, unknown>;
}

describe('ccd-usage-sweep.py', () => {
  it('dedupes by message id across config dirs, skips the old file by mtime, counts the truncated line as a parse error', () => {
    const f = fixture(); const s = runSweep(f);
    expect(s['scan']).toMatchObject({ records: 4, duplicatesRemoved: 1, parseErrors: 1, filesInWindow: 3, files: 4 });
    const perModel = s['perModel'] as Record<string, Record<string, number>>;
    expect(perModel['claude-opus-5']).toMatchObject({ n: 1, output: 100, cacheRead: 10_000, cacheWrite: 1000 });
    expect(perModel['claude-fable-5-1']).toMatchObject({ n: 1, output: 1000 });
    expect(perModel['claude-sonnet-5']).toMatchObject({ n: 1 });
    expect(perModel['claude-haiku-4-5-20251001']).toMatchObject({ n: 1 });
    expect(s['perClass']).toMatchObject({ opus: { n: 1 }, fable: { n: 1 }, sonnet: { n: 1 }, haiku: { n: 1 } });
    const perSession = s['perSession'] as Record<string, Record<string, unknown>>;
    expect(perSession['sess-1']).toMatchObject({ ccdId: 'demo-live', account: 'claude', n: 3, subagentN: 1, efforts: { high: 1, xhigh: 1, medium: 1 } });
    expect(perSession['sess-2']).toMatchObject({ ccdId: null, account: 'two', n: 1, efforts: { none: 1 } });
    expect(s['perEffort']).toMatchObject({ high: { n: 1 }, xhigh: { n: 1 }, medium: { n: 1 }, none: { n: 1 } });
  });

  it('attribution of a carried record does not depend on the order --dirs is written in, and is counted', () => {
    const f = fixture();
    const forward = runSweep(f);
    const reversed = runSweep({ home: f.home, dirs: Object.fromEntries(Object.entries(f.dirs).reverse()) });
    expect(reversed['perAccount']).toEqual(forward['perAccount']);
    const acct = (forward['perAccount'] as Record<string, Record<string, unknown>>);
    expect(acct['claude']).toMatchObject({ carriedAcrossDirs: 1 });   // msg-1 lives in both dirs; .claude sorts first
    expect(acct['two']).toMatchObject({ carriedAcrossDirs: 0 });
    expect(forward['attribution']).toContain('sorts first');
  });

  it('classifies with the tokens it was given and refuses to run without them', () => {
    const f = fixture();
    const out = path.join(f.home, 'x.json');
    const r = spawnSync('python3', [SCANNER, '--dirs', JSON.stringify(f.dirs), '--registry', path.join(f.home, '.cc-sessions'),
      '--limits', path.join(f.home, '.cc-limits'), '--out', out, '--now', String(NOW)], { encoding: 'utf8' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('--class-tokens');
    expect(existsSync(out)).toBe(false);
  });

  it('estimates the Fable share per account as fable apiUsd over all apiUsd, joined to the seven-day figure, labelled', () => {
    const f = fixture(); const s = runSweep(f);
    const acct = (s['perAccount'] as Record<string, Record<string, unknown>>)['claude']!;
    const share = acct['fableShare'] as Record<string, unknown>;
    expect(share['estimate']).toBeGreaterThan(0); expect(share['estimate']).toBeLessThan(1);
    expect(share).toMatchObject({ sevenPct: 40, sevenTs: NOW - 60, carriedAcrossDirs: 1, basis: expect.stringContaining('fable apiUsd') });
    const two = (s['perAccount'] as Record<string, Record<string, unknown>>)['two']!;
    expect((two['fableShare'] as Record<string, unknown>)['estimate']).toBe(0);
    expect((two['fableShare'] as Record<string, unknown>)['sevenPct']).toBeNull();
    expect((s['rates'] as Record<string, unknown>)['label']).toContain('PROXY');
  });

  it('--reap-orphans removes a sidecar with no registry row older than a day, and nothing else', () => {
    const f = fixture(); const s = runSweep(f, ['--reap-orphans']);
    expect(s['orphansReaped']).toEqual(['stale-id']);
    const u = (rel: string): boolean => existsSync(path.join(f.home, '.cc-sessions', 'usage', rel));
    expect(u('stale-id.json')).toBe(false); expect(u('stale-id.agents')).toBe(false);
    expect(u('fresh-orphan.json')).toBe(true); expect(u('demo-live.json')).toBe(true);
  });

  it('without --reap-orphans nothing is removed', () => {
    const f = fixture(); runSweep(f);
    expect(existsSync(path.join(f.home, '.cc-sessions', 'usage', 'stale-id.json'))).toBe(true);
  });
});

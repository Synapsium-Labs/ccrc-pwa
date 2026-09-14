import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import { generateAccountsSh } from '../../shared/generate.mjs';
import { parseRoster } from '../../shared/roster.js';

afterEach(removeTmpFixtures);
const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '../..');
const RUNNER = path.join(REPO, 'ccd', 'ccd-usage-sweep');
const SCANNER = path.join(REPO, 'ccd', 'ccd-usage-sweep.py');
const ROSTER = { version: 1, accounts: [
  { id: 'claude', label: 'team·max', configDirSuffix: '.claude', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
  { id: 'gpt', label: 'gpt', configDirSuffix: '.gpt-cfg', exec: { kind: 'external' }, homeAble: false, hue: 'magenta', telemetry: 'none' },
] };

function home(): string {
  const h = mkTmp('ccrc-usage-runner-');
  mkdirSync(path.join(h, '.ccrc'), { recursive: true });
  writeFileSync(path.join(h, '.ccrc', 'accounts.sh'), generateAccountsSh(parseRoster(ROSTER)));
  mkdirSync(path.join(h, '.cc-sessions'), { recursive: true });
  mkdirSync(path.join(h, '.cc-limits'), { recursive: true });
  mkdirSync(path.join(h, '.local', 'bin'), { recursive: true });
  writeFileSync(path.join(h, '.local', 'bin', 'ccd-usage-sweep.py'), readFileSync(SCANNER));
  mkdirSync(path.join(h, '.claude', 'projects', '-w-demo'), { recursive: true });
  writeFileSync(path.join(h, '.claude', 'projects', '-w-demo', 's.jsonl'),
    JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), sessionId: 's', effort: 'high',
      message: { id: 'm1', model: 'claude-opus-5', usage: { input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: 3, cache_read_input_tokens: 4 } } }) + '\n');
  return h;
}
/** `CCRC_TREE` points the runner's `node` read of FAMILY_TOKENS at THIS checkout,
 *  where `~/ccrc` would be on a deployed box. */
const run = (h: string, env: Record<string, string> = {}): { code: number; out: string; err: string } => {
  const r = spawnSync('bash', [RUNNER], { encoding: 'utf8', env: { ...process.env, HOME: h, CCRC_TREE: REPO,
    PATH: `${path.join(h, '.local', 'bin')}:${process.env['PATH'] ?? ''}`, ...env } });
  return { code: r.status ?? -1, out: r.stdout ?? '', err: r.stderr ?? '' };
};

describe('ccd-usage-sweep (the runner)', () => {
  it('maps every roster account to its config dir, hands the scanner the class tokens, writes latest.json and a census pass', () => {
    const h = home(); const r = run(h);
    expect(r.code, r.err).toBe(0);
    const latest = JSON.parse(readFileSync(path.join(h, '.cc-sessions', 'usage', 'sweep', 'latest.json'), 'utf8')) as Record<string, unknown>;
    expect((latest['perAccount'] as Record<string, unknown>)['claude']).toBeDefined();
    expect((latest['perAccount'] as Record<string, unknown>)['gpt']).toBeDefined();   // every account, even an unmeasured one
    expect((latest['perClass'] as Record<string, unknown>)['opus']).toMatchObject({ n: 1 });   // classified — the tokens arrived
    const census = JSON.parse(readFileSync(path.join(h, '.ccrc', 'usage-sweep.json'), 'utf8')) as { passes: Record<string, unknown>[] };
    expect(census.passes).toHaveLength(1);
    expect(census.passes[0]).toMatchObject({ status: 'ok', records: 1 });
  });
  it('keeps the last ten passes only', () => {
    const h = home();
    for (let i = 0; i < 12; i += 1) expect(run(h).code).toBe(0);
    const census = JSON.parse(readFileSync(path.join(h, '.ccrc', 'usage-sweep.json'), 'utf8')) as { passes: unknown[] };
    expect(census.passes).toHaveLength(10);
  });
  it('a missing roster projection is a refusal (rc 1) with no latest.json', () => {
    const h = home(); writeFileSync(path.join(h, '.ccrc', 'accounts.sh'), '');
    const r = run(h);
    expect(r.code).toBe(1);
    expect(r.err).toContain('accounts.sh');
    expect(existsSync(path.join(h, '.cc-sessions', 'usage', 'sweep', 'latest.json'))).toBe(false);
  });
  it('a tree with no shared/models.mjs is a refusal (rc 1): the class table is read, never guessed', () => {
    const h = home();
    const r = run(h, { CCRC_TREE: path.join(h, 'no-such-tree') });
    expect(r.code).toBe(1);
    expect(r.err).toContain('models.mjs');
    expect(existsSync(path.join(h, '.cc-sessions', 'usage', 'sweep', 'latest.json'))).toBe(false);
  });
  it('a pause file skips the pass and says so', () => {
    const h = home(); writeFileSync(path.join(h, '.ccrc', 'usage-sweep-paused'), '');
    const r = run(h);
    expect(r.code).toBe(0); expect(r.out).toContain('paused');
    expect(existsSync(path.join(h, '.cc-sessions', 'usage', 'sweep', 'latest.json'))).toBe(false);
  });
});

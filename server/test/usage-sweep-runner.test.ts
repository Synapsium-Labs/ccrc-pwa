import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, readFileSync, symlinkSync } from 'node:fs';
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
/** The sweep settings `_ccrc_knob` reads (wave 29): a shell export of one must not move a row, so none is inherited. */
const SWEEP_SETTINGS = ['CCRC_GRAPH_BUDGET', 'CCRC_GRAPH_MAX_WORKERS', 'CCRC_KEEPALIVE_MODEL', 'CCRC_KEEPALIVE_PROMPT',
  'CCRC_KEEPALIVE_FRESH', 'CCRC_USAGE_SWEEP_DAYS'];
const inherited = (): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  for (const k of SWEEP_SETTINGS) delete env[k];
  return env;
};
const run = (h: string, env: Record<string, string> = {}): { code: number; out: string; err: string } => {
  const r = spawnSync('bash', [RUNNER], { encoding: 'utf8', env: { ...inherited(), HOME: h, CCRC_TREE: REPO,
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

// ── wave 29 (D-6981): the runner reads its days from ~/.ccrc/ccrc.env through ccrc's reader ─────────────────────
// `env -i` models the user manager after a reboot: no CCRC_ name, so the tree is found where the install puts it
// (`~/ccrc`, a link to this checkout) and the days can only arrive from the file. The scanner is a shim that records
// its argv and writes a latest.json, so a row reads what the runner handed it.
describe('W29: the usage sweep reads its days from ~/.ccrc/ccrc.env through ccrc\'s reader', () => {
  const rebootHome = (): string => {
    const h = home();
    symlinkSync(REPO, path.join(h, 'ccrc'));
    mkdirSync(path.join(h, 'tmp'), { recursive: true });
    writeFileSync(path.join(h, '.local', 'bin', 'ccd-usage-sweep.py'), [
      'import json, sys, os',
      'a = sys.argv[1:]',
      'open(os.path.join(os.environ["HOME"], "scanner-argv"), "w").write("\\n".join(a) + "\\n")',
      'json.dump({"scan": {"records": 0}}, open(a[a.index("--out") + 1], "w"))',
    ].join('\n') + '\n');
    return h;
  };
  const reboot = (h: string) => {
    const r = spawnSync('bash', [RUNNER], { encoding: 'utf8',
      env: { HOME: h, PATH: `${path.join(h, '.local', 'bin')}:${process.env['PATH'] ?? ''}`, TMPDIR: path.join(h, 'tmp') } });
    return { code: r.status ?? -1, out: r.stdout ?? '', err: r.stderr ?? '' };
  };
  const ccrcEnv = (h: string, text: string): void => writeFileSync(path.join(h, '.ccrc', 'ccrc.env'), text, { mode: 0o600 });
  const daysHanded = (h: string): string | undefined => {
    const argv = readFileSync(path.join(h, 'scanner-argv'), 'utf8').split('\n');
    return argv[argv.indexOf('--days') + 1];
  };

  it('W29-U1: days written only in ccrc.env reach the scanner (the reboot case)', () => {
    const h = rebootHome();
    ccrcEnv(h, 'CCRC_USAGE_SWEEP_DAYS=3\n');
    const r = reboot(h);
    expect(r.code, r.err).toBe(0);
    expect(daysHanded(h)).toBe('3');
    expect(r.out).toContain('in the last 3 days');
  });

  it('W29-U2: no ccrc.env reads the default', () => {
    const h = rebootHome();
    expect(reboot(h).code).toBe(0);
    expect(daysHanded(h)).toBe('7');
  });

  it('W29-U3: a ccrc.env that is a dangling link stops the pass before the scanner runs', () => {
    const h = rebootHome();
    symlinkSync(path.join(h, 'nowhere'), path.join(h, '.ccrc', 'ccrc.env'));
    const r = reboot(h);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/^usage-sweep: CCRC_USAGE_SWEEP_DAYS cannot be measured: ~\/\.ccrc\/ccrc\.env is there but cannot be read — nothing was swept$/m);
    expect(existsSync(path.join(h, 'scanner-argv')), 'the scanner ran').toBe(false);
  });

  it('W29-U4: a paused sweep stays paused, exit 0, even when ccrc.env is faulted (the pause check comes first)', () => {
    const h = rebootHome();
    symlinkSync(path.join(h, 'nowhere'), path.join(h, '.ccrc', 'ccrc.env'));
    writeFileSync(path.join(h, '.ccrc', 'usage-sweep-paused'), '');
    const r = reboot(h);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain('paused');
    expect(r.err).toBe('');
    expect(existsSync(path.join(h, 'scanner-argv'))).toBe(false);
  });

  it('W29-U5: days that are not a whole number from 1 to 999 stop the pass, naming where they came from', () => {
    const h = rebootHome();
    ccrcEnv(h, 'CCRC_USAGE_SWEEP_DAYS=0\n');
    const r = reboot(h);
    expect(r.code).toBe(1);
    expect(r.err).toContain("usage-sweep: CCRC_USAGE_SWEEP_DAYS must be a whole number from 1 to 999 — got '0', as set in ~/.ccrc/ccrc.env; nothing was swept");
    expect(existsSync(path.join(h, 'scanner-argv'))).toBe(false);
  });
});


// D-8120, end to end: the row the statusline WRITER marks is the row its
// READERS rank. The writer (`ccd/statusline-command.sh`) is the only party that
// states "this lane has no 5h window" (`fiveWindowMinutes: 0`), and ccd's
// `_limit_score` and the server's `/api/accounts` only read it. Each side has
// its own tests over hand-written rows; this file feeds the readers the exact
// bytes the real writer produced, so a renamed key, a string where a number
// belongs, or a marker the readers stop recognising goes red here even while
// both sides' own fixtures stay green.
import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AccountsResponse } from '../../shared/api.js';
import { buildServer } from '../src/server.js';
import { testDeps } from './helpers.js';
import { CCD, ghContainedEnv, seedAccountsSh } from './ccdWsHelpers.js';
import { mkTmp } from './tmpHelpers.js';

const SCRIPT = path.resolve(__dirname, '../../ccd/statusline-command.sh');
const LANE = 'claude-b';
const nowS = (): number => Math.floor(Date.now() / 1000);

/** A render whose payload carries the weekly window and no `five_hour` block. */
function render(home: string, seven: number): void {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: path.join(home, `.${LANE}`) };
  delete env['TMUX_PANE'];
  const input = JSON.stringify({
    model: { display_name: 'Opus 5' },
    workspace: { current_dir: '/nonexistent-for-this-test' },
    rate_limits: { seven_day: { used_percentage: seven, resets_at: nowS() + 400_000 } },
  });
  const r = spawnSync('bash', [SCRIPT], { input, encoding: 'utf8', env });
  expect(r.status).toBe(0);
}

const rowPath = (home: string): string => path.join(home, '.cc-limits', `${LANE}.json`);

const ccdScore = (home: string): string =>
  execFileSync('bash', ['-c', `source "${CCD}"; _limit_score ${LANE}`],
    { encoding: 'utf8', env: ghContainedEnv(home, { ...process.env, HOME: home }, { systemd: true, tmux: true }) }).trim();

async function accounts(home: string): Promise<AccountsResponse> {
  const app = await buildServer(testDeps(home));
  try {
    const res = await app.inject({ method: 'GET', url: '/api/accounts' });
    expect(res.statusCode).toBe(200);
    return res.json() as AccountsResponse;
  } finally {
    await app.close();
  }
}

describe('D-8120: the row the statusline writer marks is the row ccd and the server rank', () => {
  it('unmarked, the writer\'s five-less row is unmeasured to both readers; marked, both rank it on its week', async () => {
    // One HOME for all three, so the readers open the very file the writer
    // left: the test roster's ids are its wrapper names, and every one of
    // them is measured (`telemetry: 'anthropic'`) except `gpt`.
    const home = mkTmp('ccrc-five-less-e2e-');
    seedAccountsSh(home);

    // First five-less render: the run starts, no marker yet.
    render(home, 15);
    const first = JSON.parse(readFileSync(rowPath(home), 'utf8')) as Record<string, unknown>;
    expect(first).toMatchObject({ five: null, seven: 15 });
    expect(typeof first['fiveAbsentSince']).toBe('number');
    expect(first).not.toHaveProperty('fiveWindowMinutes');
    expect(ccdScore(home)).toBe('');
    const before = (await accounts(home)).accounts.find((a) => a.wrapper === LANE);
    expect(before).toMatchObject({ five: null, seven: 15 });
    expect(before).not.toHaveProperty('fiveWindowMinutes');

    // Move the run's start a whole 5h window back — the clock, not the shape:
    // every other byte stays the writer's — and let the writer render again.
    writeFileSync(rowPath(home), `${JSON.stringify({ ...first, fiveAbsentSince: nowS() - 18_001 })}\n`);
    render(home, 16);
    const marked = readFileSync(rowPath(home), 'utf8');
    const row = JSON.parse(marked) as Record<string, unknown>;
    expect(row).toMatchObject({ five: null, seven: 16, fiveWindowMinutes: 0 });

    // The readers get that exact row, untouched.
    expect(readFileSync(rowPath(home), 'utf8')).toBe(marked);
    expect(ccdScore(home)).toBe('16');
    const payload = await accounts(home);
    const lane = payload.accounts.find((a) => a.wrapper === LANE);
    expect(lane).toMatchObject({ five: null, seven: 16, fiveWindowMinutes: 0 });
    expect(lane).not.toHaveProperty('fiveAbsentSince');
    expect(payload.projected).toEqual({ wrapper: LANE, score: 16 });
  });
});

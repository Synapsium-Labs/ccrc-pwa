// GET /api/accounts is the only path by which the accounts strip learns that a
// zero was INFERRED from a reset timestamp rather than measured. The handler
// rebuilds each AccountUsage field by field, so a field it forgets to copy is
// not a type error anywhere the strip can see — the wire just loses it and the
// strip renders "0%" where it should render "reset". These tests drive the real
// Fastify handler over a real ~/.cc-limits so a dropped field goes red.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AccountUsage, ProjectedHome } from '../../shared/api.js';
import { buildServer } from '../src/server.js';
import { testDeps } from './helpers.js';

/** The route calls readLimits without a clock, so fixtures live against real now. */
const now = (): number => Math.floor(Date.now() / 1000);

function seedLimits(files: Record<string, unknown>): string {
  const home = mkdtempSync(path.join(tmpdir(), 'ccrc-accounts-'));
  const dir = path.join(home, '.cc-limits');
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(body));
  }
  return home;
}

async function getPayload(home: string): Promise<{ accounts: AccountUsage[]; projected: ProjectedHome }> {
  const app = await buildServer(testDeps(home));
  try {
    const res = await app.inject({ method: 'GET', url: '/api/accounts' });
    expect(res.statusCode).toBe(200);
    return res.json() as { accounts: AccountUsage[]; projected: ProjectedHome };
  } finally {
    await app.close();
  }
}

async function getAccounts(home: string): Promise<AccountUsage[]> {
  return (await getPayload(home)).accounts;
}

describe('GET /api/accounts', () => {
  it('carries the rollover flags of a reset window onto the wire', async () => {
    const t = now();
    const home = seedLimits({
      // 5h window ended 1m ago, 7d window still running: the five 55 is stale
      // history, the seven 93 is current.
      claude: { five: 55, seven: 93, ts: t - 120, fiveResetAt: t - 60, sevenResetAt: t + 200000 },
      // Nothing has rolled over; the zero here was really measured.
      claude2: { five: 0, seven: 12, ts: t - 60, fiveResetAt: t + 9000, sevenResetAt: t + 400000 },
    });

    const accounts = await getAccounts(home);
    const byWrapper = Object.fromEntries(accounts.map((a) => [a.wrapper, a]));

    expect(byWrapper['claude']).toEqual({
      wrapper: 'claude', five: 0, seven: 93, ts: t - 120,
      fiveResetAt: t - 60, sevenResetAt: t + 200000,
      fiveRolledOver: true, sevenRolledOver: false,
    });
    expect(byWrapper['claude2']).toEqual({
      wrapper: 'claude2', five: 0, seven: 12, ts: t - 60,
      fiveResetAt: t + 9000, sevenResetAt: t + 400000,
      fiveRolledOver: false, sevenRolledOver: false,
    });
    // The whole point: two accounts both reading five=0, told apart only by
    // the flag. If the map drops it, these two become indistinguishable.
    expect(byWrapper['claude'].fiveRolledOver).not.toBe(byWrapper['claude2'].fiveRolledOver);
  });

  it('reports a rolled-over 7d window too', async () => {
    const t = now();
    const home = seedLimits({
      claude: { five: 3, seven: 98, ts: t - 60, fiveResetAt: t + 9000, sevenResetAt: t - 50000 },
    });

    const [a] = await getAccounts(home);
    expect(a).toMatchObject({ seven: 0, sevenRolledOver: true, five: 3, fiveRolledOver: false });
  });

  it('carries the projected workspace home, so the + can name it before the tap', async () => {
    // The PWA must not compute this — a third copy of ccd's routing rule would
    // drift from the two that already exist. The wire carries the answer.
    const t = now();
    const fresh = (five: number, seven: number) =>
      ({ five, seven, ts: t - 60, fiveResetAt: t + 9000, sevenResetAt: t + 400000 });
    const home = seedLimits({
      claude: fresh(80, 40), claude2: fresh(5, 3), 'claude-corp': fresh(90, 95),
    });

    const { projected } = await getPayload(home);
    expect(projected).toEqual({ wrapper: 'claude2', score: 5 });
  });

  it('projects an exhausted account rather than hiding it', async () => {
    // ccd's rule has no availability filter, so a pinned fleet still gets an
    // answer — and that answer is exactly what the affordance has to show.
    const t = now();
    const pinned = (five: number, seven: number) =>
      ({ five, seven, ts: t - 60, fiveResetAt: t + 9000, sevenResetAt: t + 400000 });
    const home = seedLimits({
      claude: pinned(100, 100), claude2: pinned(99, 100), 'claude-corp': pinned(98, 99),
    });

    const { projected } = await getPayload(home);
    expect(projected).toEqual({ wrapper: 'claude-corp', score: 99 });
  });

  it('orders accounts claude, claude2, claude-corp, gpt', async () => {
    const t = now();
    const body = { five: 1, seven: 1, ts: t - 60, fiveResetAt: t + 9000, sevenResetAt: t + 400000 };
    const home = seedLimits({ gpt: body, 'claude-corp': body, claude2: body, claude: body });

    const accounts = await getAccounts(home);
    expect(accounts.map((a) => a.wrapper)).toEqual(['claude', 'claude2', 'claude-corp', 'gpt']);
  });
});

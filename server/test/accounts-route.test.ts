// GET /api/accounts is the only path by which the accounts strip learns that a
// zero was INFERRED from a reset timestamp rather than measured. The handler
// rebuilds each AccountUsage field by field, so a field it forgets to copy is
// not a type error anywhere the strip can see — the wire just loses it and the
// strip renders "0%" where it should render "reset". These tests drive the real
// Fastify handler over a real ~/.cc-limits so a dropped field goes red.
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AccountsResponse, AccountUsage } from '../../shared/api.js';
import { buildServer } from '../src/server.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

/** The route calls readLimits without a clock, so fixtures live against real now. */
const now = (): number => Math.floor(Date.now() / 1000);

function seedLimits(files: Record<string, unknown>): string {
  const home = mkTmp('ccrc-accounts-');
  const dir = path.join(home, '.cc-limits');
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(body));
  }
  return home;
}

/** `AccountsResponse`, not a fourth hand-written copy of the same object shape
 *  — the wire type is the contract, and a field the handler forgets is then a
 *  compile error here rather than a value that silently never arrives. */
async function getPayload(home: string): Promise<AccountsResponse> {
  const app = await buildServer(testDeps(home));
  try {
    const res = await app.inject({ method: 'GET', url: '/api/accounts' });
    expect(res.statusCode).toBe(200);
    return res.json() as AccountsResponse;
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
      fiveRolledOver: true, sevenRolledOver: false, disabled: false,
    });
    expect(byWrapper['claude2']).toEqual({
      wrapper: 'claude2', five: 0, seven: 12, ts: t - 60,
      fiveResetAt: t + 9000, sevenResetAt: t + 400000,
      fiveRolledOver: false, sevenRolledOver: false, disabled: false,
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
      'claude-dev0': fresh(85, 45),
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
      'claude-dev0': pinned(100, 100),
    });

    const { projected } = await getPayload(home);
    expect(projected).toEqual({ wrapper: 'claude-corp', score: 99 });
  });

  it('orders accounts claude, claude2, claude-corp, gpt, claude-dev0', async () => {
    const t = now();
    const body = { five: 1, seven: 1, ts: t - 60, fiveResetAt: t + 9000, sevenResetAt: t + 400000 };
    const home = seedLimits({
      gpt: body, 'claude-corp': body, claude2: body, claude: body, 'claude-dev0': body,
    });

    const accounts = await getAccounts(home);
    expect(accounts.map((a) => a.wrapper)).toEqual(['claude', 'claude2', 'claude-corp', 'gpt', 'claude-dev0']);
  });

  // `rank()`'s unknown-wrapper fallback (`i < 0 ? 99`), which is load-bearing
  // and easy to lose when the ranking is rebuilt: the roster is runtime data
  // now, so a `.cc-limits/*.json` naming an account this box's roster does not
  // have is an ordinary occurrence — a lane removed from accounts.json whose
  // telemetry file outlives it, or a box mid-rollout. It must sort LAST and
  // still be REPORTED: the accounts screen showing a stale lane is a diagnosis;
  // silently dropping it is a mystery.
  it('sorts a wrapper the roster does not have last, rather than dropping it', async () => {
    const t = now();
    const body = { five: 1, seven: 1, ts: t - 60, fiveResetAt: t + 9000, sevenResetAt: t + 400000 };
    const home = seedLimits({ zzz: body, 'claude-dev0': body, ghost: body, claude: body });

    const accounts = await getAccounts(home);
    // Roster order first (claude, then claude-dev0), then the two unrostered
    // names — which tie at rank 99 and fall back to alphabetical, so the order
    // among them is defined rather than whatever readdir returned.
    expect(accounts.map((a) => a.wrapper)).toEqual(['claude', 'claude-dev0', 'ghost', 'zzz']);
  });

  // The fourth field of the wire contract (Stage 2a): the roster itself. Without
  // it the PWA has no way to label or colour an account that telemetry has never
  // mentioned — `accounts` above is built from `.cc-limits/*.json`, so an
  // account nothing has ever run on has no row there at all.
  //
  // `claude2` carries a label that is NOT its id (`alt·max`, its real one in
  // `deploy/accounts.migration.json`) — see `DEFAULT_TEST_ROSTER`. Every
  // fixture account used to label itself with its own id, which made this
  // assertion unable to fail on the very confusion it exists to catch: a
  // handler emitting `a.id` into `label` passed it byte for byte, and `label`
  // is what the PWA actually renders.
  it('carries the roster, including accounts telemetry has never mentioned', async () => {
    const home = seedLimits({ claude: { five: 2, seven: 3 } });
    const { accounts, roster } = await getPayload(home);

    expect(accounts.map((a) => a.wrapper)).toEqual(['claude']);
    expect(roster).toEqual([
      { id: 'claude', label: 'claude', hue: 'cyan', homeAble: true },
      { id: 'claude2', label: 'alt·max', hue: 'violet', homeAble: true },
      { id: 'claude-corp', label: 'claude-corp', hue: 'blue', homeAble: true },
      { id: 'gpt', label: 'gpt', hue: 'magenta', homeAble: false },
      { id: 'claude-dev0', label: 'claude-dev0', hue: 'green', homeAble: true },
    ]);
  });

  // The server's half of the roster's own secret-keeping: `configDirSuffix`,
  // `exec` (which carries a `~/.cc-secrets` path for a generated account) and
  // `telemetry` describe how the SERVER launches and measures an account. A
  // browser has no use for any of them, and `RosterWire` is where that line is
  // drawn — this asserts the line is real on the wire, not just in the type.
  it('ships no launch or secrets detail to the browser', async () => {
    const { roster } = await getPayload(seedLimits({ claude: { five: 2, seven: 3 } }));
    for (const entry of roster) {
      expect(Object.keys(entry).sort()).toEqual(['homeAble', 'hue', 'id', 'label']);
    }
  });

  // The handler rebuilds each AccountUsage field by field, so a field it forgets
  // to copy is a silent wire loss, not a type error — which is this whole file's
  // reason to exist. `disabled` is exactly that shape of field.
  it('carries the disabled flag onto the wire', async () => {
    const home = seedLimits({ gpt: { five: 1, seven: 1 }, claude: { five: 2, seven: 3 } });
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    writeFileSync(path.join(home, '.cc-sessions', 'gpt-disabled'), '');
    const accounts = await getAccounts(home);
    expect(accounts.find((a) => a.wrapper === 'gpt')!.disabled).toBe(true);
    expect(accounts.find((a) => a.wrapper === 'claude')!.disabled).toBe(false);
  });

  // Wire-contract defect: `.cc-sessions` holds `-disabled` markers that name
  // no account at all — ccd ships `autocompact-disabled` there (a fleet-wide
  // proactive-/compact kill switch, ccd:22). Before the readLimits fix, this
  // file alone fabricated a phantom `{"wrapper":"autocompact",...}` row, and
  // the accounts screen (which deliberately renders every disabled lane it is
  // told about) would have shown a fake "autocompact" account.
  it('never invents an account row from a non-wrapper marker in .cc-sessions', async () => {
    const home = seedLimits({ claude: { five: 2, seven: 3 } });
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    writeFileSync(path.join(home, '.cc-sessions', 'autocompact-disabled'), '');
    const accounts = await getAccounts(home);
    expect(accounts.map((a) => a.wrapper)).toEqual(['claude']);
    expect(accounts.find((a) => a.wrapper === 'autocompact')).toBeUndefined();
  });
});

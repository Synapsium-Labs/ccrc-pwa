/**
 * `ccd-telemetry-keepalive` — the executable that keeps an IDLE measured
 * account's `~/.cc-limits` row from going stale.
 *
 * Harness idiom copied from `graph-sweep.test.ts`: a throwaway `mkTmp` HOME,
 * the real script run under it, and every collaborator planted as a fixture.
 * HOME is the isolation boundary the whole ccd suite relies on — nothing here
 * may ever run against a real $HOME, and nothing here runs `ccd`.
 *
 * NOTHING HERE MAKES A REAL API CALL, and that is structural rather than
 * careful: the script invokes `$HOME/.local/bin/<account>` by absolute path,
 * so the only "Claude Code" any case can reach is the fixture bash script
 * `plantWrapper` writes inside the throwaway home. A case that forgot to plant
 * one gets the `no wrapper` skip, not a credentialed turn. No case plants a
 * real credential either — the one token fixture is the literal string
 * `sk-ant-oat-fixture`, and the assertion it exists for is that the census
 * NEVER contains it.
 *
 * Linux-only, the same carve-out `ccd-cap-scopes` and `ccd-graph-sweep` have:
 * the script leans on GNU `date +%s%3N`, `flock(1)` and `jq`, and its timer
 * never installs on the Darwin arm.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { seedAccountsSh } from './ccdWsHelpers.js';

beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });

const KEEPALIVE = path.resolve(__dirname, '../../ccd/ccd-telemetry-keepalive');
let home: string;
const j = (...p: string[]) => path.join(home, ...p);

beforeEach(() => {
  home = mkTmp('keepalive');
  fs.mkdirSync(j('.cc-sessions'), { recursive: true });
  fs.mkdirSync(j('.ccrc'), { recursive: true });
  seedAccountsSh(home);
});

function run(env: Record<string, string> = {}) {
  return spawnSync('bash', [KEEPALIVE], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, CCRC_KEEPALIVE_TURN_TIMEOUT: '20', ...env },
  });
}

/** The last pass appended to the census. */
function lastPass(): any {
  const doc = JSON.parse(fs.readFileSync(j('.ccrc', 'keepalive.json'), 'utf8'));
  return doc.passes[doc.passes.length - 1];
}
function row(account: string): any {
  return lastPass().accounts.find((r: any) => r.account === account);
}
/** What the fake wrappers recorded, one line per invocation. */
function turns(): string[] {
  if (!fs.existsSync(j('turn-calls'))) return [];
  return fs.readFileSync(j('turn-calls'), 'utf8').trim().split('\n').filter(Boolean);
}

/** A fake account wrapper. It records the environment it was handed — never
 *  the token itself, only whether one arrived — and optionally does what a
 *  real render would do. */
function plantWrapper(id: string, body = ''): void {
  const bin = j('.local', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, id), `#!/usr/bin/env bash
echo "turn ${id} cfg=\${CLAUDE_CONFIG_DIR:-none} tok=\${CLAUDE_CODE_OAUTH_TOKEN:+set} argv=$*" >> "$HOME/turn-calls"
${body}
printf '{"type":"result","total_cost_usd":0.0021}'
exit 0
`, { mode: 0o755 });
}

/** The body that makes a fake wrapper behave like a real render: it writes the
 *  account's limits row with a fresh `ts`, exactly as
 *  `ccd/statusline-command.sh:249-251` does. */
const renders = (id: string, five = 7) => `
mkdir -p "$HOME/.cc-limits"
printf '{"five":${five},"seven":3,"ts":%s,"fiveResetAt":null,"sevenResetAt":null}' "$(date +%s)" \\
  > "$HOME/.cc-limits/${id}.json"
`;

function plantLimits(id: string, five: number, ageSecs: number): void {
  fs.mkdirSync(j('.cc-limits'), { recursive: true });
  const ts = Math.floor(Date.now() / 1000) - ageSecs;
  fs.writeFileSync(j('.cc-limits', `${id}.json`),
    JSON.stringify({ five, seven: 3, ts, fiveResetAt: null, sevenResetAt: null }));
}

describe('eligibility is roster-derived and nothing else', () => {
  it('walks CCRC_MEASURED and never the telemetry-less account', () => {
    for (const id of ['claude', 'claude-a', 'claude-b', 'claude-d', 'gpt']) plantWrapper(id);
    const r = run();
    expect(r.status, `stderr:\n${r.stderr}`).toBe(0);
    const seen = lastPass().accounts.map((a: any) => a.account).sort();
    expect(seen).toEqual(['claude', 'claude-a', 'claude-b', 'claude-d']);
    expect(turns().some((l) => l.startsWith('turn gpt ')),
      'a keepalive turn was taken on an account whose roster telemetry is "none"').toBe(false);
  });

  it('refuses rather than selecting nobody when the projection predates CCRC_MEASURED', () => {
    fs.writeFileSync(j('.ccrc', 'accounts.sh'),
      '#!/usr/bin/env bash\nCCRC_ACCOUNTS=(claude)\nCCRC_UPSTREAM=claude\n');
    const r = run();
    expect(r.status).toBe(1);
    expect(lastPass().status).toBe('no-measured-set');
    expect(turns()).toEqual([]);
  });
});

describe('the three skips — a keepalive is for the idle case only', () => {
  it('skips an account that reported inside CCRC_KEEPALIVE_FRESH', () => {
    plantWrapper('claude-a');
    plantLimits('claude-a', 41, 60);
    run();
    expect(row('claude-a').outcome).toBe('skipped');
    expect(row('claude-a').reason).toContain('CCRC_KEEPALIVE_FRESH');
    // …and the fresh number is still reported, so a skip is not a blind spot.
    expect(row('claude-a').fiveBefore).toBe(41);
    expect(turns().some((l) => l.startsWith('turn claude-a '))).toBe(false);
  });

  it('skips an account carrying the -authdead marker', () => {
    plantWrapper('claude-a', renders('claude-a'));
    plantLimits('claude-a', 41, 9999);
    fs.writeFileSync(j('.cc-sessions', 'claude-a-authdead'),
      `${Math.floor(Date.now() / 1000)} auth-401\n`);
    run();
    expect(row('claude-a').outcome).toBe('skipped');
    expect(row('claude-a').reason).toContain('authdead');
    expect(turns().some((l) => l.startsWith('turn claude-a '))).toBe(false);
  });

  it('does NOT skip on a marker whose first field is not digits', () => {
    // `ccd`'s swapblocked rule (ccd/ccd:11909): the epoch is VALIDATED, not
    // trusted. A hand-edited or half-written marker must not decide a spend.
    plantWrapper('claude-a', renders('claude-a'));
    plantLimits('claude-a', 41, 9999);
    fs.writeFileSync(j('.cc-sessions', 'claude-a-authdead'), 'garbage auth-401\n');
    run();
    expect(row('claude-a').outcome).toBe('refreshed');
  });

  it('skips an account a registered session is sitting on', () => {
    plantWrapper('claude-a', renders('claude-a'));
    plantLimits('claude-a', 41, 9999);
    fs.writeFileSync(j('.cc-sessions', 'claude-a-demo.wrapper'), 'claude-a\n');
    run();
    expect(row('claude-a').outcome).toBe('skipped');
    expect(row('claude-a').reason).toContain('claude-a-demo');
    expect(turns().some((l) => l.startsWith('turn claude-a '))).toBe(false);
  });

  it('skips an account with no wrapper on this box, and says which path', () => {
    run();
    expect(row('claude-a').outcome).toBe('skipped');
    expect(row('claude-a').reason).toContain('.local/bin/claude-a');
  });
});

describe('the turn, and the re-measurement that judges it', () => {
  it('refreshes a stale account and reports the price on both sides', () => {
    plantWrapper('claude-a', renders('claude-a', 12));
    plantLimits('claude-a', 9, 9999);
    run();
    const r = row('claude-a');
    expect(r.outcome).toBe('refreshed');
    expect(r.fiveBefore).toBe(9);
    expect(r.fiveAfter).toBe(12);
    expect(r.costUsd).toBe(0.0021);
  });

  it('records no-render when the turn exits 0 and the telemetry does not advance', () => {
    // THE CENTRAL GUARD. `claude -p` may not render a statusline at all; if it
    // does not, this row is how the fleet finds out — loudly, per account, per
    // pass — instead of a silent no-op that looks like success.
    plantWrapper('claude-a');           // exits 0, writes nothing
    plantLimits('claude-a', 9, 9999);
    run();
    expect(row('claude-a').outcome).toBe('no-render');
    expect(row('claude-a').fiveAfter, 'an unmeasured percentage must be null, never 0')
      .toBeNull();
  });

  it('records failed, not no-render, when the turn itself exits non-zero', () => {
    plantWrapper('claude-a', 'exit 3');
    plantLimits('claude-a', 9, 9999);
    run();
    expect(row('claude-a').outcome).toBe('failed');
    expect(row('claude-a').reason).toContain('exit 3');
  });

  it('hands the child its own config dir and its credential, and never logs the token', () => {
    fs.mkdirSync(j('.cc-secrets'), { recursive: true });
    // The shape the real files have. `ccrc-wrappers.test.ts:492-493` models the
    // live upstream launcher as `CLAUDE_CODE_OAUTH_TOKEN="$(cat …)"` followed by
    // `export CLAUDE_CODE_OAUTH_TOKEN`, and `shared/wrapper.mjs:143` emits only
    // the `.` line — the exporting is the sourced file's job. MEASURED: a bare
    // assignment does NOT survive the script's `exec`, so a fixture without
    // `export` would assert nothing at all.
    fs.writeFileSync(j('.cc-secrets', 'claude-a-oauth.env'),
      'export CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat-fixture\n', { mode: 0o600 });
    plantWrapper('claude-a', renders('claude-a'));
    plantLimits('claude-a', 9, 9999);
    run({ CCRC_KEEPALIVE_MODEL: 'haiku' });
    const line = turns().find((l) => l.startsWith('turn claude-a '))!;
    expect(line).toContain(`cfg=${j('.claude-a')}`);
    expect(line).toContain('tok=set');
    expect(line).toContain('--model haiku');
    const census = fs.readFileSync(j('.ccrc', 'keepalive.json'), 'utf8');
    expect(census, 'the credential reached the census').not.toContain('sk-ant-oat-fixture');
  });
});

describe('the pass-level switches', () => {
  it('does nothing at all while the pause file is present', () => {
    plantWrapper('claude-a', renders('claude-a'));
    plantLimits('claude-a', 9, 9999);
    fs.writeFileSync(j('.ccrc', 'keepalive-paused'), '');
    const r = run();
    expect(r.status).toBe(0);
    expect(lastPass().status).toBe('paused');
    expect(lastPass().accounts).toEqual([]);
    expect(turns()).toEqual([]);
  });
});

describe('the id grammar gate — an id becomes an exec path here', () => {
  // The sibling probe (`ccd-account-health`) gates its ids because they come
  // out of raw `accounts.json`. This script's ids come out of `accounts.sh`,
  // which it SOURCES — so the gate is emphatically NOT a trust boundary, and
  // the script's own header says so. What it buys is the other half: a
  // malformed projection must not turn an id into an exec path, because
  // `$HOME/.local/bin/$acct` is RUN.
  it('runs nothing for an id outside the grammar, and still serves the legal one', () => {
    plantWrapper('claude-a', renders('claude-a'));
    // The thing `$HOME/.local/bin/../evil` resolves to. Planted executable, so
    // the ONLY reason it is not run is the gate.
    fs.mkdirSync(j('.local', 'bin'), { recursive: true });
    fs.writeFileSync(j('.local', 'evil'),
      '#!/usr/bin/env bash\necho "turn EVIL argv=$*" >> "$HOME/turn-calls"\nexit 0\n',
      { mode: 0o755 });
    fs.writeFileSync(j('.ccrc', 'accounts.sh'),
      "#!/usr/bin/env bash\nCCRC_MEASURED=('claude-a' '../evil')\nCCRC_UPSTREAM=claude\n");
    const r = run();
    expect(r.status, `stderr:\n${r.stderr}`).toBe(0);
    expect(turns().some((l) => l.startsWith('turn EVIL')),
      'an id outside the grammar was pasted into an exec path and run').toBe(false);
    expect(r.stderr).toContain('not a legal account id');
    // No row either: the row's own key is the thing that is not an account.
    expect(lastPass().accounts.map((a: any) => a.account)).toEqual(['claude-a']);
    expect(row('claude-a').outcome).toBe('refreshed');
  });

  it('spells the same account-id grammar as ccrc-wrapper-shape', () => {
    // `shared/roster.ts`'s ID_RE is module-private, and this is its FOURTH
    // bash spelling. The tree's answer to a value that cannot be shared is to
    // MEASURE the agreement (`account-health.test.ts`'s shape), never to trust
    // a comment claiming the copies match.
    const literal = (file: string, name: string): string => {
      const m = new RegExp(`^${name}='([^']+)'$`, 'm').exec(fs.readFileSync(file, 'utf8'));
      expect(m, `${file} declares no bare ${name}= literal — this pin went blind`).not.toBeNull();
      return m![1]!;
    };
    const shape = path.resolve(__dirname, '../../ccd/ccrc-wrapper-shape');
    expect(literal(KEEPALIVE, 'KA_ID_RE')).toBe(literal(shape, 'WRAPPER_ID_RE'));
  });
});

describe('the preflight and the lock — the two ways a pass can retire in silence', () => {
  /** A bin directory holding ONLY `needed`, so everything else is genuinely
   *  absent. The way to test a preflight is to take the tool away, not to mock
   *  the check (`account-health.test.ts`'s idiom). */
  const thinBin = (needed: string[]): string => {
    const dir = j('.thin-bin');
    fs.mkdirSync(dir, { recursive: true });
    for (const n of needed) {
      const real = (process.env['PATH'] ?? '').split(':')
        .map((d) => path.join(d, n)).find((p) => fs.existsSync(p));
      expect(real, `${n} is not on the harness PATH — this fixture cannot be built`).toBeTruthy();
      fs.symlinkSync(real!, path.join(dir, n));
    }
    return dir;
  };
  /** Everything the script needs before its preflight runs, and nothing after. */
  const BASE = ['bash', 'date', 'mkdir'];

  it('a lock it cannot OPEN is loud — not the quiet exit that means "someone else holds it"', () => {
    // Two conditions that must not collapse. A held lock is the healthy overlap
    // and records `pass-locked`; a lock that cannot be opened at all is a broken
    // box and must say so. Collapsed, the keepalive no-ops on every timer tick
    // forever while the census records a contention that never happened.
    plantWrapper('claude-a', renders('claude-a'));
    plantLimits('claude-a', 9, 9999);
    fs.mkdirSync(j('.ccrc', 'keepalive.lock'));   // EISDIR on `exec 9>`
    const r = run();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/keepalive: cannot open the lock/);
    expect(turns()).toEqual([]);
  });

  it('a box with no flock refuses LOUDLY — it never takes the quiet contention exit', () => {
    // The preflight's whole reason for existing, one door up from the split
    // above: `flock -n 9` on a box without flock fails exactly as a HELD lock
    // does, so the `pass-locked` arm would retire the pass on every tick and the
    // census would say the fleet was merely busy.
    plantWrapper('claude-a', renders('claude-a'));
    plantLimits('claude-a', 9, 9999);
    const r = run({ PATH: thinBin([...BASE, 'jq']) });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/flock is not on PATH — nothing was measured/);
    expect(turns()).toEqual([]);
  });

  it('a box with no timeout refuses too — an unbounded turn is not a turn this script takes', () => {
    // `timeout` is the ONLY bound on a spend. Without the preflight the turn
    // execs a missing binary, every account records `failed exit 127`, and the
    // real fault — a broken box — reads as N broken credentials.
    plantWrapper('claude-a', renders('claude-a'));
    plantLimits('claude-a', 9, 9999);
    // `mktemp` is here so that DELETING the preflight entry produces the
    // failure this case is about (`exec timeout` → 127 on every account) rather
    // than an unrelated collapse further down — a mutation whose red is caused
    // by the wrong thing pins nothing.
    const r = run({ PATH: thinBin([...BASE, 'jq', 'flock', 'mktemp']) });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/timeout is not on PATH — nothing was measured/);
    expect(turns()).toEqual([]);
  });
});

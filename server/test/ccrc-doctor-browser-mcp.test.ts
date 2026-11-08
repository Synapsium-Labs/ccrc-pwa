// Doctor's `browser-mcp` check (D-8121): the Claude Code processes that run a configured browser MCP server against the
// registry rows whose last spawn applied `browser on` (`~/.cc-sessions/<id>.browsermcp`). Fixture HOMEs only
// (`healthy()`); the check runs alone, sourced, with its process table planted through the `_dr_bmcp_ps` seam, so no
// real process is read. The pair at the edge: USING equal to ON is a PASS, one more is a WARN.
import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { removeTmpFixturesEachTest } from './tmpHelpers.js';
import { spawnSyncGroup } from './spawnGroup.js';
import { BASH, CCRC_SRC, CHECKS_SRC, anyVerdictFor, doctorEnv, healthy, installDoctorHooks, runDoctor, shq } from './ccrc-doctorFixture.js';

removeTmpFixturesEachTest();
installDoctorHooks();

interface Box { home: string; reg: string }
function box(prefix: string, o: { on?: string[]; off?: string[]; env?: string[] } = {}): Box {
  const home = healthy(prefix);
  const reg = join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  for (const id of o.on ?? []) writeFileSync(join(reg, `${id}.browsermcp`), 'on\n');
  for (const id of o.off ?? []) writeFileSync(join(reg, `${id}.browsermcp`), 'off\n');
  if (o.env) appendFileSync(join(home, '.ccrc', 'ccrc.env'), o.env.map((l) => `${l}\n`).join(''));
  return { home, reg };
}
/** One Claude Code process (`pid`) and the measured process tree of the servers it runs. */
const session = (pid: number, servers: Array<'playwright' | 'devtools'>): string[] => servers.flatMap((s, i) => {
  const l = pid + 10 * (i + 1);
  return s === 'playwright'
    ? [`${l} ${pid} npm exec @playwright/mcp@latest`, `${l + 1} ${l} node /h/.npm/_npx/9833/node_modules/.bin/playwright-mcp`]
    : [`${l} ${pid} npm exec chrome-devtools-mcp@1.11.0`, `${l + 1} ${l} node /h/.npm/_npx/053a/node_modules/.bin/chrome-devtools-mcp`,
      `${l + 2} ${l + 1} node /h/.npm/_npx/053a/node_modules/chrome-devtools-mcp/build/src/telemetry/watchdog/main.js --parent-pid=${l + 1}`];
});
function check(b: Box, ps: string[]): { line: string; remedy: string; code: number } {
  const table = ps.join('\n');
  const r = spawnSyncGroup(BASH, ['-c', `set -uo pipefail\n. ${shq(CCRC_SRC)}\n. ${shq(CHECKS_SRC)}\n_dr_bmcp_ps() { printf '%s\\n' "$PS_TABLE"; }\n_check_browser-mcp`],
    { env: { ...doctorEnv(b.home), PS_TABLE: table }, encoding: 'utf8', timeout: 30_000 });
  const lines = (r.stdout ?? '').split('\n');
  const i = lines.findIndex((l) => /^(PASS|WARN|FAIL|SKIP) browser-mcp: /.test(l));
  expect(i, `a browser-mcp line: ${r.stdout}${r.stderr}`).toBeGreaterThanOrEqual(0);
  return { line: lines[i]!, remedy: lines[i + 1] ?? '', code: r.status ?? -1 };
}
const OTHER = ['1 0 /sbin/init', '200 1 tmux', '300 200 claude --resume x', '301 300 npx playwright test', '302 300 node vitest'];

describe('browser-mcp: where there is nothing to count (D-8121)', () => {
  it('SKIP in a full doctor run on a box with no session registry (the healthy fixture)', () => {
    const home = healthy('ccrc-doctor-bmcp-noreg-');
    expect(anyVerdictFor(runDoctor(home).stdout, 'browser-mcp')).toBe('SKIP browser-mcp: no session registry at ~/.cc-sessions, so no session runs a browser server');
  });

  it('SKIP on a server-role box', () => {
    const b = box('ccrc-doctor-bmcp-server-', { env: ['CCRC_ROLE=server'] });
    expect(check(b, [])).toMatchObject({ line: 'SKIP browser-mcp: this box records CCRC_ROLE=server, so it runs no session', code: 3 });
  });
});

describe('browser-mcp: USING against ON (D-8121)', () => {
  it('PASS when no session runs a browser server and none asked for one; a `playwright test` run is not a server', () => {
    const b = box('ccrc-doctor-bmcp-none-', { off: ['a', 'b'] });
    expect(check(b, OTHER)).toMatchObject({
      line: 'PASS browser-mcp: 0 Claude Code processes run a browser MCP server (0 processes in all); 0 sessions last spawned with browser on', code: 0,
    });
  });

  it('PASS at the edge: two sessions run both servers and two records say on; the server tree counts once per session', () => {
    const b = box('ccrc-doctor-bmcp-edge-', { on: ['a', 'b'], off: ['c'] });
    expect(check(b, [...OTHER, ...session(1000, ['playwright', 'devtools']), ...session(2000, ['devtools'])])).toMatchObject({
      line: 'PASS browser-mcp: 2 Claude Code processes run a browser MCP server (8 processes in all); 2 sessions last spawned with browser on', code: 0,
    });
  });

  it('WARN one past the edge, naming the list and the remedy', () => {
    const b = box('ccrc-doctor-bmcp-warn-', { on: ['a'], off: ['b', 'c'] });
    const r = check(b, [...OTHER, ...session(1000, ['playwright']), ...session(2000, ['playwright', 'devtools'])]);
    expect(r.code).toBe(2);
    expect(r.line).toBe('WARN browser-mcp: 2 Claude Code processes run a browser MCP server (7 processes in all); 1 session last spawned with browser on — the rest were spawned before the default turned off, or run a server CCRC_BROWSER_MCP_SERVERS (plugin:playwright:playwright,plugin:chrome-devtools-mcp:chrome-devtools) does not name');
    expect(r.remedy).toMatch(/restart the idle ones/);
    expect(r.remedy).toMatch(/Stop leftovers/);
  });

  it('the configured list decides what counts: a list naming only playwright does not count the devtools tree', () => {
    const b = box('ccrc-doctor-bmcp-list-', { on: ['a'], env: ['CCRC_BROWSER_MCP_SERVERS=plugin:playwright:playwright'] });
    expect(check(b, [...session(1000, ['playwright']), ...session(2000, ['devtools'])]).line)
      .toBe('PASS browser-mcp: 1 Claude Code process runs a browser MCP server (2 processes in all); 1 session last spawned with browser on');
  });
});

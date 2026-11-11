// server/test/ccd-browser-spawn.test.ts
//
// D-8121: browser MCP servers are off by default in fleet sessions. Every spawn (`_spawn_start`, which start, ensure, a
// swap's restart and a roll's wake all reach) composes the effective value — the session's own `browser` route field, else
// the box default `CCRC_BROWSER_MCP_DEFAULT` (off) — and, when it is off, merges
// `{"deniedMcpServers":[{"serverName":…},…]}` for `CCRC_BROWSER_MCP_SERVERS` into the row's ONE `--settings` (D-5391), next
// to the route's workflow keys, the child's deny file and the account deny file. `$REG/<id>.browsermcp` records what the
// spawn applied. The harness pins the default to `on` for the older argv suites (`ccdWsHelpers.ts`); every case here
// unsets it (an empty exported value is unset, `_ccrc_knob`) so the box's own default decides. The spawn substrate is
// `ccd-spawn-account-settings.test.ts`'s, so both spawn lines (the `--resume` primary and the `--session-id` retry) are read.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, ghContainedEnv, CCD, type CcdHarness } from './ccdWsHelpers.js';
import { ACCOUNT_DENY_RULES, BROWSER_MCP_SERVERS_DEFAULT, CHILD_DENY_RULES } from '../../shared/api.js';

const INSTALLER = path.resolve(__dirname, '../../ccd/install-session-hooks.sh');

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-browser-'); });
afterEach(() => { h.cleanup(); });

const RESUME_DIES = `sleep() { :; };
    tmux() {
      echo "tmux $*" >> "$HOME/ccd-calls"
      case "$1" in
        new-session)  case "$*" in *--session-id*) : > "$HOME/pane-up" ;; esac ;;
        has-session)  [[ -e "$HOME/pane-up" ]] ;;
        list-sessions) return 0 ;;
      esac
    };`;
const UUID = 'deadbeef-0000-4000-8000-000000000000';
const TOP = 'project-a-calm-mesa';
const CHILD = 'project-a-quiet-basin';
/** The box default unset: the harness's `on` pin is removed, so ccrc.env (or the default) decides. */
const BOX = { CCRC_BROWSER_MCP_DEFAULT: '' };
const acctFile = (): string => path.join(h.home, '.cc-sessions', 'account-deny.settings.json');
const childFile = (): string => path.join(h.home, '.cc-sessions', 'child-deny.settings.json');
const sha = (p: string): string => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const install = (): void => {
  execFileSync('bash', [INSTALLER, '--homes'], { env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }) });
};
const seed = (id: string, child = false): void => {
  h.sh(`_reg_set ${id} wrapper claude
        _reg_set ${id} workdir '${h.home}'
        _reg_set ${id} uuid ${UUID}${child ? `\n        _reg_set ${id} child 17` : ''}`);
};
const ccrcEnv = (text: string): void => {
  fs.mkdirSync(path.join(h.home, '.ccrc'), { recursive: true });
  fs.writeFileSync(path.join(h.home, '.ccrc', 'ccrc.env'), text);
};
/** Both spawn lines of `_spawn_start <id> resume`, what it said on stderr and its rc. */
const spawnBoth = (id: string, extra: NodeJS.ProcessEnv = BOX, src = CCD): { lines: string[]; err: string; code: number } => {
  h.sh(`rm -f "$HOME/ccd-calls" "$HOME/pane-up"`);
  const r = spawnSync('bash', ['-c', 'a_src=$A_SRC a_snip=$A_SNIP; unset A_SRC A_SNIP; source "$a_src"; FLEET_SPAWN_PINS=; eval "$a_snip"'], {
    env: ghContainedEnv(h.home, { ...h.env(extra), A_SRC: src, A_SNIP: `${RESUME_DIES} _spawn_start ${id} resume` },
      { systemd: true, tmux: true, net: true }),
    cwd: h.home, encoding: 'utf8',
  });
  const lines = h.calls().filter((c) => c.startsWith('tmux new-session'));
  return { lines, err: r.stderr ?? '', code: r.status ?? -1 };
};
const settingsOf = (l: string): string[] => [...l.matchAll(/--settings '([^']*)'/g)].map((m) => m[1] as string);
/** The one `--settings` of a spawn line, parsed (a path is read). */
const theSettings = (l: string): Record<string, unknown> => {
  const s = settingsOf(l);
  expect(s, l).toHaveLength(1);
  const v = s[0]!;
  return JSON.parse(v.startsWith('{') ? v : fs.readFileSync(v, 'utf8')) as Record<string, unknown>;
};
const denied = (l: string): unknown => theSettings(l).deniedMcpServers;
const named = (names: readonly string[]): Array<{ serverName: string }> => names.map((serverName) => ({ serverName }));
const DEFAULT_NAMES = BROWSER_MCP_SERVERS_DEFAULT.split(',');

describe('the box default is off (D-8121)', () => {
  it('a top-level row with no browser field spawns with both measured browser servers denied in its one --settings, beside every account rule, on both spawn lines', () => {
    install(); seed(TOP);
    const { lines, code, err } = spawnBoth(TOP);
    expect(code, err).toBe(0);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain(`--resume '${UUID}'`);
    expect(lines[1]).toContain(`--session-id '${UUID}'`);
    for (const l of lines) {
      expect(denied(l)).toEqual(named(DEFAULT_NAMES));
      const deny = (theSettings(l).permissions as { deny: string[] }).deny;
      for (const r of ACCOUNT_DENY_RULES) expect(deny, r).toContain(r);
    }
    expect(h.reg(TOP, 'browsermcp')).toBe('off');
    expect(err).not.toMatch(/browser MCP|CCRC_BROWSER/);
  });

  it('the default names are the two measured serverNames, and ccrc\'s default list is that same string', () => {
    expect(DEFAULT_NAMES).toEqual(['plugin:playwright:playwright', 'plugin:chrome-devtools-mcp:chrome-devtools']);
    const lib = path.resolve(__dirname, '../../ccd/lib/ccrc-settings.sh');
    expect(h.sh(`. '${lib}'; _browser_mcp_servers_default`)).toBe(BROWSER_MCP_SERVERS_DEFAULT);
  });

  it('a row with no account file and no route still gets the denial as its own inline --settings', () => {
    seed(TOP);
    const { lines } = spawnBoth(TOP);
    for (const l of lines) {
      expect(settingsOf(l)).toEqual([JSON.stringify({ deniedMcpServers: named(DEFAULT_NAMES) })]);
    }
    expect(h.reg(TOP, 'browsermcp')).toBe('off');
  });

  it('a routed row (workflow keys) keeps every workflow key in the same one --settings', () => {
    install(); seed(TOP);
    h.sh(`_reg_set ${TOP} class opus; _reg_set ${TOP} workflow on`);
    for (const l of spawnBoth(TOP).lines) {
      const s = theSettings(l);
      expect(s.enableWorkflows).toBe(true);
      expect(s.deniedMcpServers).toEqual(named(DEFAULT_NAMES));
      expect(l).toContain('--model opus --settings ');
    }
  });

  it('a child row merges route, child deny, browser denial and account deny into one --settings, and `.deny-settings` stays the child file\'s digest', () => {
    install(); seed(CHILD, true);
    for (const l of spawnBoth(CHILD).lines) {
      const s = theSettings(l);
      expect(s.deniedMcpServers).toEqual(named(DEFAULT_NAMES));
      expect((s.permissions as { deny: string[] }).deny).toEqual(expect.arrayContaining([...CHILD_DENY_RULES, ...ACCOUNT_DENY_RULES]));
    }
    expect(h.reg(CHILD, 'deny-settings')).toBe(sha(childFile()));
    expect(h.reg(CHILD, 'browsermcp')).toBe('off');
  });
});

describe('the effective value: the route field, else the box default (D-8121)', () => {
  it('`browser=on` composes no denial and the spawn line is the one the harness pin produces', () => {
    install(); seed(TOP);
    h.sh(`_reg_set ${TOP} browser on`);
    const on = spawnBoth(TOP);
    for (const l of on.lines) expect(settingsOf(l)).toEqual([acctFile()]);
    expect(h.reg(TOP, 'browsermcp')).toBe('on');
    h.sh(`rm -f "$HOME/.cc-sessions/${TOP}.browser"`);
    expect(spawnBoth(TOP, {}).lines).toEqual(on.lines);   // the harness's `on` pin: the same argv
  });

  it('a box default of on (ccrc.env) composes nothing, and a session\'s `browser=off` still denies them', () => {
    install(); seed(TOP);
    ccrcEnv('CCRC_BROWSER_MCP_DEFAULT=on\n');
    for (const l of spawnBoth(TOP).lines) expect(settingsOf(l)).toEqual([acctFile()]);
    expect(h.reg(TOP, 'browsermcp')).toBe('on');
    h.sh(`_reg_set ${TOP} browser off`);
    for (const l of spawnBoth(TOP).lines) expect(denied(l)).toEqual(named(DEFAULT_NAMES));
    expect(h.reg(TOP, 'browsermcp')).toBe('off');
  });

  it('CCRC_BROWSER_MCP_SERVERS names the servers denied', () => {
    install(); seed(TOP);
    ccrcEnv('CCRC_BROWSER_MCP_SERVERS=plugin:a:b,local-x\n');
    for (const l of spawnBoth(TOP).lines) expect(denied(l)).toEqual(named(['plugin:a:b', 'local-x']));
  });

  it('a refused default reads as off and a refused list as the default list, each with one warning; an unrecognised route word reads as absent', () => {
    install(); seed(TOP);
    ccrcEnv('CCRC_BROWSER_MCP_DEFAULT=maybe\nCCRC_BROWSER_MCP_SERVERS=bad/name\n');
    h.sh(`_reg_set ${TOP} browser yes`);
    const r = spawnBoth(TOP);
    expect(r.code, r.err).toBe(0);
    for (const l of r.lines) expect(denied(l)).toEqual(named(DEFAULT_NAMES));
    const warns = r.err.split('\n').filter((l) => /CCRC_BROWSER_MCP/.test(l));
    expect(warns, r.err).toHaveLength(2);   // composed once, above both spawn lines
    expect(warns[0]).toMatch(/CCRC_BROWSER_MCP_DEFAULT must be on or off — read as off/);
    expect(warns[1]).toMatch(/CCRC_BROWSER_MCP_SERVERS must be .* read as the default list/);
    expect(fs.readFileSync(path.join(h.home, '.cc-sessions', 'swap.log'), 'utf8')).toMatch(/route-reject .*browser/);
  });

  it('a missing settings reader composes nothing, records on, warns and never refuses the spawn', () => {
    install(); seed(TOP);
    const copy = path.join(h.home, 'ccd-copy');
    fs.cpSync(path.dirname(CCD), copy, { recursive: true });
    fs.rmSync(path.join(copy, 'lib', 'ccrc-settings.sh'));
    const r = spawnBoth(TOP, BOX, path.join(copy, 'ccd'));
    expect(r.code, r.err).toBe(0);
    expect(r.lines).toHaveLength(2);
    for (const l of r.lines) expect(settingsOf(l)).toEqual([acctFile()]);
    expect(h.reg(TOP, 'browsermcp')).toBe('on');
    expect(r.err).toMatch(/settings reader \(ccrc-settings\.sh\) is missing or broken/);
  });
});

describe('the route verb and the caps (D-8121)', () => {
  it('`ccd route --set browser=on|off` writes the field; another word is refused and writes nothing', () => {
    seed(TOP);
    expect(h.sh(`cmd_route --session ${TOP} --set browser=on`, BOX)).toContain(`set ${TOP} browser=on`);
    expect(h.reg(TOP, 'browser')).toBe('on');
    expect(() => h.sh(`cmd_route --session ${TOP} --set browser=maybe 2>&1`, BOX)).toThrow();
    expect(h.reg(TOP, 'browser')).toBe('on');
    h.sh(`cmd_route --session ${TOP} --set browser=off`, BOX);
    expect(h.reg(TOP, 'browser')).toBe('off');
  });

  it('caps advertises browser-route-v1', () => {
    expect(h.sh('cmd_caps').split('\n')).toContain('browser-route-v1');
  });

  it('SETTINGS_UNION_JQ unions `deniedMcpServers` across sides, first seen kept, where plain `*` keeps only the right side', () => {
    const out = h.sh(`jq -c -n '[{"deniedMcpServers":[{"serverName":"a"}],"x":1},{"deniedMcpServers":[{"serverName":"b"},{"serverName":"a"}]}]' | jq -c "$SETTINGS_UNION_JQ"`);
    expect(JSON.parse(out)).toEqual({ x: 1, deniedMcpServers: [{ serverName: 'a' }, { serverName: 'b' }] });
  });
});

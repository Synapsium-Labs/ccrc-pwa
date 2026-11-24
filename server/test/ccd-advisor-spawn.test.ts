// server/test/ccd-advisor-spawn.test.ts
//
// The coordinator advisor in ccd (plan 2026-11-23-coordinator-advisor, PR A; D-8967, D-8968): the lane-only route field
// `advisor` (`fable`|`opus`) adds `--advisor <model>` to the spawn's flags, and `$REG/<id>.advisorspawn` records what each
// spawn applied. Fixture HOMEs only; the spawn substrate is `ccd-launch-profile.test.ts`'s (both spawn lines).
//
// CHARACTERIZATION FIRST (plan PR A Task 1): a coordinator row (`profile=coordinator`) with no `advisor` field spawns byte
// for byte as on the branch point, flags, environment and stderr, on a first start and a resume (both lines). The
// recording was taken on the branch point's `ccd/ccd` (1b1bcc577) before the advisor existed (`ADV_RECORD=1`).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, ghContainedEnv, CCD, type CcdHarness } from './ccdWsHelpers.js';
import { spawnSyncGroup } from './spawnGroup.js';

const ID = 'lane-a-project-a';
const UUID = 'deadbeef-0000-4000-8000-000000000000';
const RESUME_DIES = `sleep() { :; };
    tmux() {
      echo "tmux $*" >> "$HOME/ccd-calls"
      case "$1" in
        new-session)  case "$*" in *--session-id*) : > "$HOME/pane-up" ;; esac ;;
        has-session)  [[ -e "$HOME/pane-up" ]] ;;
        list-sessions) return 0 ;;
      esac
    };`;

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-advisor-'); });
afterEach(() => { h.cleanup(); });

const seed = (route: readonly (readonly [string, string])[] = []): void => {
  h.sh(`_reg_set ${ID} wrapper claude
        _reg_set ${ID} workdir '${h.home}'
        _reg_set ${ID} uuid ${UUID}
        ${route.map(([f, v]) => `_reg_set ${ID} ${f} '${v}'`).join('\n        ')}`);
};
// What differs by platform is normalised, each arm matched as an exact literal (never a pattern), so everything else the
// line carries stays byte for byte: the stat spelling in the workdir-id snippet (`stat -c` on Linux, `stat -f` on BSD),
// that snippet's rename (GNU `mv -fT` on Linux, a directory check and `mv -f` on macOS: `_plat_workdirid_pane`), and the
// tool-child priority's two assignments, which `_tool_adj_env` writes on Linux only. The recording was made on macOS;
// CI runs it on Linux (the launch-profile recording was made on Linux and reads `stat -c` there only).
const PLAT_MV = ['mv -fT "$t" "$f" 2>/dev/null || rm -f "$t"',
  'if [ -d "$f" ] && [ ! -L "$f" ]; then rm -f "$t"; exit 0; fi; [ -L "$f" ] && rm -f "$f"; mv -f "$t" "$f" 2>/dev/null || rm -f "$t"'];
const TOOL_ADJ = ` CCD_TOOL_ADJ_INNER="\${CLAUDE_CODE_SHELL_PREFIX-}" CLAUDE_CODE_SHELL_PREFIX='<HOME>/.local/bin/ccd-tool-adj'`;
const home = (l: string): string => l.split(h.home).join('<HOME>');
const norm = (l: string): string => PLAT_MV.reduce((a, m) => a.split(m).join('<PLATMV>'), home(l).split(TOOL_ADJ).join(''))
  .replace(/CCRC_SESSION_TMPDIR='[^']*'/g, "CCRC_SESSION_TMPDIR='<TMP>'")
  .replace(/stat -[cf] %d:%i:%[A-Za-z]/g, 'stat <PLAT>');
const spawn = (mode: 'new' | 'resume', pre = ''): { lines: string[]; raw: string[]; err: string } => {
  h.sh(`rm -f "$HOME/ccd-calls" "$HOME/pane-up"`);
  const r = spawnSyncGroup('bash', ['-c', 'a_src=$A_SRC a_snip=$A_SNIP; unset A_SRC A_SNIP; source "$a_src"; eval "$a_snip"'], {
    env: ghContainedEnv(h.home, { ...h.env(), A_SRC: CCD, A_SNIP: `${RESUME_DIES} ${pre} _spawn_start ${ID} ${mode}` }, { systemd: true, tmux: true, net: true }),
    cwd: h.home, encoding: 'utf8', timeout: 60_000, killSignal: 'SIGKILL',
  });
  const raw = h.calls().filter((c) => c.startsWith('tmux new-session'));
  return { lines: raw.map(norm), raw, err: r.stderr.split(h.home).join('<HOME>') };
};
const spawnRec = (): string => path.join(h.home, '.cc-sessions', `${ID}.advisorspawn`);
const regFile = (f: string): string => path.join(h.home, '.cc-sessions', `${ID}.${f}`);
const swapLog = (): string => {
  const f = path.join(h.home, '.cc-sessions', 'swap.log');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
};
const route = (args: string, env: NodeJS.ProcessEnv = {}): { status: number; out: string } => {
  try {
    const out = execFileSync('bash', ['-c', `source "${CCD}"; exec 2>&1; cmd_route ${args}`],
      { encoding: 'utf8', cwd: h.home, env: ghContainedEnv(h.home, { ...process.env, HOME: h.home, ...env }, { systemd: true, tmux: true }) });
    return { status: 0, out };
  } catch (e) {
    const err = e as { status?: number | null; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
};
const nowS = (): number => Math.floor(Date.now() / 1000);

const RECORDED = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/advisor/branch-point.json'), 'utf8')) as Record<string, string[]>;

describe('no advisor field, no change: a coordinator spawn is byte for byte the branch point (plan PR A Task 1)', () => {
  const cases: [string, 'new' | 'resume', readonly (readonly [string, string])[]][] = [
    ['coordinator, first start', 'new', [['profile', 'coordinator']]],
    ['coordinator, resume, both lines', 'resume', [['profile', 'coordinator']]],
    ['coordinator with a window and a class, resume', 'resume', [['profile', 'coordinator'], ['compactwindow', '350000'], ['class', 'opus']]],
    ['no profile, first start', 'new', []],
  ];
  for (const [name, mode, rt] of cases) {
    it(name, () => {
      seed(rt);
      const { lines, raw, err } = spawn(mode);
      const errLines = err.split('\n').filter((l) => l !== '');
      if (process.env.ADV_RECORD === '1') console.log(`RECORD ${JSON.stringify([name, lines, errLines])}`);
      expect(lines).toStrictEqual(RECORDED[name]);
      // what the normalisation took out is exactly this platform's arm, once per line
      const linux = process.platform === 'linux';
      for (const l of raw.map(home)) {
        expect(l.split(TOOL_ADJ).length - 1).toBe(linux ? 1 : 0);
        expect(l.split(PLAT_MV[linux ? 0 : 1]!).length - 1).toBe(1);
      }
      expect(errLines).toStrictEqual(RECORDED[`${name} (stderr)`]);
      // and no record is left: a session the advisor never touched gains no registry file
      expect(fs.existsSync(spawnRec())).toBe(false);
    });
  }
});

describe('the advisor field adds --advisor and records what the spawn applied (D-8967)', () => {
  it.each(['fable', 'opus'])('%s: both resume lines carry --advisor, the record names the model', (m) => {
    seed([['profile', 'coordinator'], ['advisor', m]]);
    const { lines } = spawn('resume');
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l).toContain(` --advisor ${m} `);
    expect(fs.readFileSync(spawnRec(), 'utf8')).toMatch(new RegExp(`^${m} \\d+$`));
  });

  it('a word outside the vocabulary is never rendered; route-reject names the field', () => {
    seed([['profile', 'coordinator'], ['advisor', 'sonnet']]);
    const { lines } = spawn('new');
    expect(lines[0]).not.toContain('--advisor');
    expect(swapLog()).toMatch(/route-reject .*advisor/);
    expect(fs.existsSync(spawnRec())).toBe(false);
  });

  it('a field removed after a spawn that applied it records off at the next spawn', () => {
    seed([['profile', 'coordinator']]);
    fs.writeFileSync(spawnRec(), `fable ${nowS() - 3600}`);
    const { lines } = spawn('new');
    expect(lines[0]).not.toContain('--advisor');
    expect(fs.readFileSync(spawnRec(), 'utf8')).toMatch(/^off \d+$/);
  });

  it('a spawn within 90 s of one that applied it omits the flag, records off fastdeath and writes one swap.log line (D-8968)', () => {
    seed([['profile', 'coordinator'], ['advisor', 'fable']]);
    fs.writeFileSync(spawnRec(), `fable ${nowS() - 10}`);
    const { lines } = spawn('new');
    expect(lines[0]).not.toContain('--advisor');
    expect(fs.readFileSync(spawnRec(), 'utf8')).toMatch(/^off fastdeath \d+$/);
    expect(swapLog().match(/advisor-dropped lane-a-project-a: /g)).toHaveLength(1);
  });

  it('a fast-death record stands through a later spawn without the field, so the drop holds for its day (review F4)', () => {
    seed([['profile', 'coordinator']]);
    const rec = `off fastdeath ${nowS() - 600}`;
    fs.writeFileSync(spawnRec(), rec);
    expect(spawn('new').lines[0]).not.toContain('--advisor');
    expect(fs.readFileSync(spawnRec(), 'utf8').trim()).toBe(rec);
  });

  it('a row whose only route field is advisor is not a routed row (_route_any)', () => {
    seed([['advisor', 'fable']]);
    const r = spawnSync('bash', ['-c', `source "${CCD}"; _route_any ${ID}; echo "rc=$?"`],
      { encoding: 'utf8', cwd: h.home, env: ghContainedEnv(h.home, { ...h.env() }, { systemd: true, tmux: true }) });
    expect(r.stdout).toContain('rc=1');
  });

  it('a spawn past the 90 s applies it again', () => {
    seed([['profile', 'coordinator'], ['advisor', 'fable']]);
    fs.writeFileSync(spawnRec(), `fable ${nowS() - 600}`);
    expect(spawn('new').lines[0]).toContain(' --advisor fable ');
  });
});

describe('ccd route --set advisor=… (lane-only)', () => {
  const seedRow = (): void => { h.sh(`_reg_set ${ID} wrapper claude; _reg_set ${ID} uuid ${UUID}`); };
  it('writes fable or opus, and the empty value clears it', () => {
    seedRow();
    expect(route(`--session ${ID} --set advisor=fable`).status).toBe(0);
    expect(h.reg(ID, 'advisor')).toBe('fable');
    expect(route(`--session ${ID} --set advisor=`).status).toBe(0);
    expect(fs.existsSync(regFile('advisor'))).toBe(false);
  });
  it('refuses a word outside the vocabulary', () => {
    seedRow();
    const r = route(`--session ${ID} --set advisor=sonnet`);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('bad value for advisor');
  });
  it("refuses a session's own shell (CLAUDECODE set)", () => {
    seedRow();
    const r = route(`--session ${ID} --set advisor=fable`, { CCRC_TEST_CLAUDECODE: '1' });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('advisor-lane-only');
    expect(fs.existsSync(regFile('advisor'))).toBe(false);
  });
  it('is refused at the mint (_route_argv_check)', () => {
    const r = spawnSync('bash', ['-c', `source "${CCD}"; exec 2>&1; _route_argv_check advisor=fable`],
      { encoding: 'utf8', cwd: h.home, env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }) });
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain("'advisor' is written only by ccd route --session");
  });
  it('ccd caps advertises route-advisor-v1', () => {
    const r = spawnSync('bash', ['-c', `source "${CCD}"; cmd_caps`],
      { encoding: 'utf8', cwd: h.home, env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }) });
    expect(r.stdout.split('\n')).toContain('route-advisor-v1');
  });
});
